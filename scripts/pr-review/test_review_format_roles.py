"""The approved presentation contract gates publication, not metadata."""

import unittest
from pathlib import Path
import subprocess
import sys
import tempfile
from unittest.mock import patch

import role_review
import synthesize_roles
import test_role_review
import test_synthesize_roles


class ReviewFormatTests(unittest.TestCase):
    def test_shell_adapter_gets_instructions_and_fixed_failure(self):
        script = Path(__file__).with_name("review_format.py")
        result = subprocess.run([sys.executable, str(script), "instructions"],
                                capture_output=True, text=True, check=True)
        self.assertIn("fenced code blocks", result.stdout)
        with tempfile.TemporaryDirectory() as root:
            text = Path(root) / "reply.md"
            for value, expected in (("Checked `validate()`.", 0),
                                    ("password='synthetic-private'", 2)):
                text.write_text(value)
                result = subprocess.run([sys.executable, str(script), "check", str(text)],
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode, expected)
                self.assertEqual(result.stdout, "" if expected == 0 else
                                 "unsupported_review_format\n")
                self.assertNotIn("synthetic-private", result.stdout + result.stderr)

    def test_stream_adapter_emits_nothing_before_rejecting_invalid_output(self):
        script = Path(__file__).with_name("review_format.py")
        for value, accepted in (("Checked `validate()`.\n", True),
                                ("Public prefix.\npassword='synthetic-private'\n", False)):
            result = subprocess.run([sys.executable, str(script), "filter"], input=value,
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0 if accepted else 2)
            self.assertEqual(result.stdout, value if accepted else "")
            self.assertEqual(result.stderr, "" if accepted else "unsupported_review_format\n")

    def response(self, evidence):
        path = "src/password=example.py"
        plan = {"head_sha": "a" * 40, "roles": {
            "codex": {"role": "implementation", "paths": [path]}}}
        response = {
            "head_sha": plan["head_sha"], "role": "implementation",
            "scope_complete": True, "reviewed_paths": [path],
            "checks": [{"path": path, "evidence": evidence}],
            "findings": [], "uncertainties": [],
        }
        return response, plan

    def test_supported_prose_references_and_fenced_examples(self):
        for text in (
            "Checked `validate()` and `src/service.py:12` against the caller.",
            "See `AWS::IAM::Role`, `--context`, `$NAME`, and `[REDACTED]`.",
            "Example:\n```sh\npassword='synthetic'\n```\nThe caller rejects it.",
            "Example:\n~~~~js\nconst text = `template`;\n~~~~\nChecked the caller.",
            "Example:\n````md\n```sh\npassword='synthetic'\n```\n````\nChecked.",
        ):
            with self.subTest(text=text):
                response, plan = self.response(text)
                role_review.validate_response(response, plan, "codex")

    def test_unsupported_examples_in_each_prose_field(self):
        for text in (
            "Example: `password='synthetic'`.",
            "Run `echo hello`.",
            "Run `first\nsecond`.",
            "Checked `unclosed.",
            "Example:\n```sh\npassword='synthetic'\n",
            "Example:\n```sh\npassword='synthetic'\n~~~",
            "Example:\n> ```sh\n> password='synthetic'\n> ```",
            "Example:\n    ```sh\n    password='synthetic'\n    ```",
            "Example:\npassword = 'synthetic'",
            'Example:\n"api_key": "synthetic"',
            "Example:\npassword\n= 'synthetic'",
            "Example: `` password='synthetic' ``.",
            "Set `password` = 'synthetic-private'.",
            "Set `api_key`: 'synthetic-private'.",
            "Set `password`\n= 'synthetic-private'.",
        ):
            for field in ("check", "condition", "evidence", "uncertainty"):
                with self.subTest(text=text, field=field):
                    response, plan = self.response("Checked the changed caller.")
                    if field == "check":
                        response["checks"][0]["evidence"] = text
                    elif field == "uncertainty":
                        response["uncertainties"] = [text]
                    else:
                        finding = {"severity": "MAJOR", "path": response["reviewed_paths"][0],
                                   "condition": "The caller fails.", "evidence": "Checked the caller."}
                        finding[field] = text
                        response["findings"] = [finding]
                    with self.assertRaisesRegex(role_review.Invalid, "^unsupported_review_format$"):
                        role_review.validate_response(response, plan, "codex")

    def chair(self, replies):
        helper = test_synthesize_roles.SynthesisTests()
        helper.setUp()
        self.addCleanup(helper.doCleanups)
        return helper.run_chair(replies)

    def test_chair_does_not_publish_unsupported_examples(self):
        reply = (0, "Example: `password='synthetic-private'`.\nVERDICT: PASS\n", "")
        calls, text = self.chair([reply, reply])
        self.assertEqual(calls, 2)
        self.assertTrue(text.endswith("VERDICT: FAIL\n"))
        self.assertIn("format", text.lower())
        self.assertNotIn("synthetic-private", text)

    def test_chair_checks_sanitized_format_too(self):
        reply = (0, "Checked `validate()`.\nVERDICT: PASS\n", "")
        with patch.object(synthesize_roles, "scrub_decoded",
                          return_value="Checked `unclosed.\nVERDICT: PASS\n"):
            _, text = self.chair([reply, reply])
        self.assertTrue(text.endswith("VERDICT: FAIL\n"))

    def test_format_failure_does_not_hide_account_limit(self):
        calls, text = self.chair([
            (0, "Run `bad\nexample`.\nVERDICT: PASS\n", "quota exceeded"),
            (0, "Must not run.\nVERDICT: PASS\n", ""),
        ])
        self.assertEqual(calls, 1)
        self.assertTrue(text.endswith("VERDICT: FAIL\n"))
        self.assertNotIn("bad", text)

    def test_invalid_specialist_output_blocks_coverage_without_public_payload(self):
        helper = test_role_review.RoleReviewTests()
        helper.setUp()
        self.addCleanup(helper.tearDown)
        helper.prepare()
        response = helper.response("codex", checks=[{
            "path": test_role_review.FRONTEND,
            "evidence": "Run `password='synthetic-private'`.",
        }])
        result = helper.record("codex", response, expected=2)
        self.assertFalse(result["valid"])
        self.assertEqual(result["failure_codes"], ["unsupported_review_format"])
        self.assertIsNone(result["response"])
        helper.record("claude-self")
        helper.aggregate(expected=2)
        published = (helper.work / "deterministic-review.md").read_text()
        self.assertTrue(published.endswith("VERDICT: FAIL\n"))
        self.assertNotIn("synthetic-private", published)
        self.assertIn("unsupported_review_format", published)

    def test_deterministic_findings_keep_embedded_fences_and_verdicts_literal(self):
        helper = test_role_review.RoleReviewTests()
        helper.setUp()
        self.addCleanup(helper.tearDown)
        helper.prepare()
        response = helper.response("codex", findings=[{
            "severity": "MINOR", "path": test_role_review.FRONTEND,
            "condition": "The rendering fixture contains a verdict marker.",
            "evidence": "Fixture:\n````text\n```\nVERDICT: FAIL\n```\n````",
        }])
        helper.finish({"codex": response})
        published = (helper.work / "deterministic-review.md").read_text()
        self.assertIn("```json\n", published)
        self.assertEqual([line for line in published.splitlines() if line.startswith("VERDICT:")],
                         ["VERDICT: PASS"])
        self.assertIn("\\nVERDICT: FAIL\\n", published)


if __name__ == "__main__":
    unittest.main()
