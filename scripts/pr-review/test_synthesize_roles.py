"""Offline chair tests."""

import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import synthesize_roles


class SynthesisTests(unittest.TestCase):
    def setUp(self):
        self.module = synthesize_roles
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

    def test_markdown(self):
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

    def test_throttle(self):
        calls, text = self.run_chair([
            (1, "", "An error occurred (ThrottlingException) invoking the primary model"),
            (0, "Fallback completed the review.\nVERDICT: PASS\n", ""),
        ])
        self.assertEqual(calls, 2)
        self.assertTrue(text.endswith("VERDICT: PASS\n"))

    def test_account(self):
        for error in ('ThrottlingException: MONTHLY_REQUEST_COUNT exhausted', 'You have reached the limit for overages'):
            with self.subTest(error=error):
                calls, text = self.run_chair([
                    (0, "Must not pass.\nVERDICT: PASS\n", error),
                    (0, "Must not be used.\nVERDICT: PASS\n", ""),
                ])
                self.assertEqual(calls, 1)
                self.assertTrue(text.endswith("VERDICT: FAIL\n"))

    def test_overage(self):
        calls, text = self.run_chair([
            (1, "", "You have reached the limit for overages"),
            (0, "Must not be used.\nVERDICT: PASS\n", ""),
        ])
        self.assertEqual(calls, 1)
        self.assertTrue(text.endswith("VERDICT: FAIL\n"))

    def test_stdout(self):
        for code in (0, 1):
            for message in (
                "UsageLimitReachedError",
                "Monthly request limit reached",
                "Error: insufficient credits",
                "You have reached the limit for overages",
            ):
                with self.subTest(code=code, message=message):
                    calls, text = self.run_chair([
                        (code, message + "\nVERDICT: PASS\n", ""),
                        (0, "Must not run.\nVERDICT: PASS\n", ""),
                    ])
                    self.assertEqual(calls, 1)
                    self.assertTrue(text.endswith("VERDICT: FAIL\n"))

    def test_quotes(self):
        report = (
            "Reviewed quota handling for UsageLimitReachedError.\n"
            '- The test covers "Monthly request limit reached".\n'
            "Example provider diagnostic:\n```\nUsageLimitReachedError\n```\n"
            "VERDICT: PASS\n"
        )
        calls, text = self.run_chair([(0, report, "")])
        self.assertEqual(calls, 1)
        self.assertTrue(text.endswith("VERDICT: PASS\n"))

    def test_default(self):
        summary = '{"findings":["' + "x" * 200000 + '"]}'
        self.prepare_chair(summary)
        (self.root / "review.md").write_text("Stale review.\nVERDICT: PASS\n")
        with patch.dict(os.environ), \
                patch.object(self.module, "record_status") as status, \
                patch.object(self.module, 'execute', return_value=(0, 'Provider should not run.\nVERDICT: PASS\n', '')) as invoke:
            os.environ.pop("CHAIR_PANEL_TOTAL_CAP", None)
            self.module.synthesize(self.root, self.root / "review.md")
        self.assertEqual(invoke.call_count, 0)
        text = (self.root / "review.md").read_text()
        self.assertTrue(text.endswith("VERDICT: FAIL\n"))
        self.assertIn("CHAIR_PANEL_TOTAL_CAP", text)
        self.assertNotIn("Stale review", text)
        self.assertEqual((self.root / "role-summary.json").read_text(), summary)
        self.assertTrue(status.call_args.kwargs["failed"])

    def test_utf8(self):
        summary = '{"findings":["' + "한" * 20 + '"]}'
        limit = len(summary)
        self.assertGreater(len(summary.encode("utf-8")), limit)
        with patch.dict(os.environ, {"CHAIR_PANEL_TOTAL_CAP": str(limit)}):
            calls, text = self.run_chair([(0, 'Provider should not run.\nVERDICT: PASS\n', '')], summary)
        self.assertEqual(calls, 0)
        self.assertTrue(text.endswith("VERDICT: FAIL\n"))

    def test_boundary(self):
        summary = '{"findings":["한글"]}'
        context = "Trusted base context.\n" * 20
        diff = "Complete diff evidence.\n" * 20
        self.prepare_chair(summary, context, diff)
        limit = len(summary.encode("utf-8"))
        with patch.dict(os.environ, {"CHAIR_PANEL_TOTAL_CAP": str(limit)}), \
                patch.object(self.module, 'execute', return_value=(0, 'All evidence reviewed.\nVERDICT: PASS\n', '')) as invoke:
            self.module.synthesize(self.root, self.root / "review.md")
        self.assertEqual(invoke.call_count, 1)
        command, _, _, supplied, _ = invoke.call_args.args
        self.assertIn(context, command[2])
        self.assertIn(diff, supplied)
        self.assertIn(summary, supplied)
        self.assertGreater(len(supplied.encode("utf-8")), limit)

    def test_positive(self):
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

    def test_no_chair(self):
        (self.root / "chair-mode.txt").write_text("deterministic\n")
        (self.root / "deterministic-review.md").write_text("Scope complete.\nVERDICT: PASS\n")
        with patch.object(self.module, "execute", side_effect=AssertionError("Unexpected call")):
            self.module.synthesize(self.root, self.root / "review.md")
        self.assertTrue((self.root / "review.md").read_text().endswith("VERDICT: PASS\n"))

    def test_blocked(self):
        (self.root / "chair-mode.txt").write_text("blocked\n")
        (self.root / "deterministic-review.md").write_text("Missing required role.\nVERDICT: FAIL\n")
        with patch.object(self.module, "execute", side_effect=AssertionError("Unexpected call")):
            self.module.synthesize(self.root, self.root / "review.md")
        self.assertTrue((self.root / "review.md").read_text().endswith("VERDICT: FAIL\n"))

    def test_verdict(self):
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


    def test_generic_budget_overrides(self):
        limits = {'CHAIR_MAX_TURNS': '8', 'CHAIR_FALLBACK_MAX_TURNS': '12', 'CHAIR_FAST_FAIL_S': '5'}
        with patch.dict(os.environ, limits):
            options = self.module.chair_options({})
        self.assertEqual(options["turns"], (8, 12))
        self.assertEqual(options["fast_fail"], 5)
        for name in limits:
            for value in ("0", "-1"):
                with self.subTest(name=name, value=value), \
                        patch.dict(os.environ, {name: value}), \
                        self.assertRaises(ValueError):
                    self.module.legacy_limit(name)


if __name__ == "__main__":
    unittest.main()
