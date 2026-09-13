"""The deterministic path must never start a model."""

import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


MODULE = Path(__file__).with_name("synthesize_roles.py")


class SynthesisTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(MODULE.exists(), "Conditional synthesis is not implemented")
        spec = importlib.util.spec_from_file_location("synthesize_roles", MODULE)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def prepare_chair(self, summary='{"findings":[]}', context="Trusted base.",
                      diff="A complete supplied diff."):
        (self.root / "chair-mode.txt").write_text("review\n")
        (self.root / "role-summary.json").write_text(summary, encoding="utf-8")
        (self.root / "project-context.md").write_text(context)
        (self.root / "roles").mkdir(exist_ok=True)
        (self.root / "roles/codex.diff").write_text(diff)

    def run_chair(self, replies, summary='{"findings":[]}'):
        self.prepare_chair(summary)
        with patch.dict(os.environ, {"CHAIR_TIMEOUT": "10",
                "CHAIR_PRIMARY_MODEL": "global.anthropic.claude-fable-5-1",
                "CHAIR_FALLBACK_MODEL": "global.anthropic.claude-opus-5"}), \
                patch.object(self.module, "execute", side_effect=replies) as invoke:
            self.module.synthesize(self.root, self.root / "review.md")
        return invoke.call_count, (self.root / "review.md").read_text()

    def test_markdown_container_examples_do_not_remove_final_verdict(self):
        for example in (
            "Checked credentials = []\nExample: secret = {private-value}",
            "-----BEGIN PRIVATE KEY-----\nprivate-value\n-----END PRIVATE KEY-----",
            '{"name":"DATABASE_PASSWORD","value":"private-value"}',
        ):
            with self.subTest(example=example):
                reply = (0, example + "\nThe proposed behavior is valid.\nVERDICT: PASS\n", "")
                calls, text = self.run_chair([reply, reply])
                self.assertEqual(calls, 1)
                self.assertTrue(text.endswith("VERDICT: PASS\n"))
                self.assertIn("proposed behavior", text)
                self.assertNotIn("private-value", text)

    def test_transient_throttle_uses_configured_fallback(self):
        calls, text = self.run_chair([
            (1, "", "An error occurred (ThrottlingException) invoking the primary model"),
            (0, "Fallback completed the review.\nVERDICT: PASS\n", ""),
        ])
        self.assertEqual(calls, 2)
        self.assertTrue(text.endswith("VERDICT: PASS\n"))

    def test_account_quota_still_prevents_fallback(self):
        calls, text = self.run_chair([
            (1, "", "ThrottlingException: MONTHLY_REQUEST_COUNT exhausted"),
            (0, "Must not be used.\nVERDICT: PASS\n", ""),
        ])
        self.assertEqual(calls, 1)
        self.assertTrue(text.endswith("VERDICT: FAIL\n"))

    def test_default_panel_byte_cap_blocks_before_any_provider_call(self):
        summary = '{"findings":["' + "x" * 200000 + '"]}'
        self.prepare_chair(summary)
        (self.root / "review.md").write_text("Stale review.\nVERDICT: PASS\n")
        with patch.dict(os.environ), \
                patch.object(self.module, "record_status") as status, \
                patch.object(self.module, "execute", return_value=(
                    0, "Provider should not run.\nVERDICT: PASS\n", ""
                )) as invoke:
            os.environ.pop("CHAIR_PANEL_TOTAL_CAP", None)
            self.module.synthesize(self.root, self.root / "review.md")
        self.assertEqual(invoke.call_count, 0)
        text = (self.root / "review.md").read_text()
        self.assertTrue(text.endswith("VERDICT: FAIL\n"))
        self.assertIn("CHAIR_PANEL_TOTAL_CAP", text)
        self.assertNotIn("Stale review", text)
        self.assertEqual((self.root / "role-summary.json").read_text(), summary)
        self.assertTrue(status.call_args.kwargs["failed"])

    def test_configured_panel_cap_counts_utf8_bytes_not_characters(self):
        summary = '{"findings":["' + "한" * 20 + '"]}'
        limit = len(summary)
        self.assertGreater(len(summary.encode("utf-8")), limit)
        with patch.dict(os.environ, {"CHAIR_PANEL_TOTAL_CAP": str(limit)}):
            calls, text = self.run_chair([
                (0, "Provider should not run.\nVERDICT: PASS\n", ""),
            ], summary)
        self.assertEqual(calls, 0)
        self.assertTrue(text.endswith("VERDICT: FAIL\n"))

    def test_panel_cap_allows_exact_limit_without_counting_diff_or_context(self):
        summary = '{"findings":["한글"]}'
        context = "Trusted base context.\n" * 20
        diff = "Complete diff evidence.\n" * 20
        self.prepare_chair(summary, context, diff)
        limit = len(summary.encode("utf-8"))
        with patch.dict(os.environ, {"CHAIR_PANEL_TOTAL_CAP": str(limit)}), \
                patch.object(self.module, "execute", return_value=(
                    0, "All evidence reviewed.\nVERDICT: PASS\n", ""
                )) as invoke:
            self.module.synthesize(self.root, self.root / "review.md")
        self.assertEqual(invoke.call_count, 1)
        command, _, _, supplied, _ = invoke.call_args.args
        self.assertIn(context, command[2])
        self.assertIn(diff, supplied)
        self.assertIn(summary, supplied)
        self.assertGreater(len(supplied.encode("utf-8")), limit)

    def test_panel_cap_cannot_be_disabled_with_nonpositive_values(self):
        self.prepare_chair()
        for limit in ("0", "-1"):
            with self.subTest(limit=limit), \
                    patch.dict(os.environ, {"CHAIR_PANEL_TOTAL_CAP": limit}), \
                    patch.object(self.module, "execute", return_value=(
                        0, "Provider should not run.\nVERDICT: PASS\n", ""
                    )) as invoke:
                with self.assertRaises(ValueError):
                    self.module.synthesize(self.root, self.root / "review.md")
                self.assertEqual(invoke.call_count, 0)

    def test_complete_clean_review_does_not_call_chair(self):
        (self.root / "chair-mode.txt").write_text("deterministic\n")
        (self.root / "deterministic-review.md").write_text("Scope complete.\nVERDICT: PASS\n")
        with patch.object(self.module, "execute", side_effect=AssertionError("Unexpected call")):
            self.module.synthesize(self.root, self.root / "review.md")
        self.assertTrue((self.root / "review.md").read_text().endswith("VERDICT: PASS\n"))

    def test_incomplete_review_cannot_be_waived_by_chair(self):
        (self.root / "chair-mode.txt").write_text("blocked\n")
        (self.root / "deterministic-review.md").write_text("Missing required role.\nVERDICT: FAIL\n")
        with patch.object(self.module, "execute", side_effect=AssertionError("Unexpected call")):
            self.module.synthesize(self.root, self.root / "review.md")
        self.assertTrue((self.root / "review.md").read_text().endswith("VERDICT: FAIL\n"))

    def test_unique_final_verdict_and_body_are_required(self):
        self.assertTrue(self.module.valid("Evidence reviewed.\nVERDICT: PASS\n", 0))
        for output, status in [
            ("VERDICT: PASS", 0),
            ("Evidence reviewed.\nVERDICT: PASS", 2),
            ("Evidence reviewed.\nVERDICT: PASS\nVERDICT: PASS", 0),
            ("Evidence reviewed.\nVERDICT: PASS\nmore text", 0),
            ("Evidence reviewed.\n VERDICT: PASS", 0),
            ("Evidence reviewed.\nVERDICT: PASS ", 0),
            ("Evidence reviewed without a verdict.", 0),
        ]:
            self.assertFalse(self.module.valid(output, status))


if __name__ == "__main__":
    unittest.main()
