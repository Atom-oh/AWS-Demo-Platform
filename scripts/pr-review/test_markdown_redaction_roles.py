"""Markdown redaction tests."""

import json
import unittest
import warnings

from role_review import scrub
import synthesize_roles
import test_synthesize_roles as synthesis_fixture


class MarkdownContainerTests(unittest.TestCase):
    def complete_cases(self):
        return (
            'password = [\n "synthetic-multiline-private"\n]',
            'credentials = {\n "nested": [\n'
            '  {"entry": ("synthetic-nested-private", "synthetic-tail-private")}\n'
            ' ]\n}',
            "password = (\n 'synthetic-single-private ] } )',\n"
            " 'synthetic-tail-private',\n)",
            "password = " + json.dumps([
                'synthetic-quoted-private ] } )',
                'synthetic-escaped-private \\" ] still quoted',
                {"tail": "synthetic-tail-private"},
            ], indent=2),
            'password = [\n """synthetic-triple-private " ] } )\n'
            'synthetic-continuation-private""",\n "synthetic-tail-private"\n]',
            'password = [\n "synthetic-first-private"\n]\n'
            'api_key = {\n "nested": ["synthetic-second-private"]\n}',
        )

    def malformed_cases(self):
        return (
            'password = [\n "synthetic-unclosed-private"\n',
            'password = {\n "entry": ["synthetic-mismatch-private"}\n}',
            'password = [\n "synthetic-unterminated-private ]\n',
            'password = [\\]\n "synthetic-escaped-close-private"\n',
            'password = ["synthetic-invalid-private" broken]',
            'password = [\n """synthetic-triple-private " ]\n',
            'password = ["synthetic-invalid-private", }]',
            r'password = ["synthetic-invalid-escape-private\q"]',
            'password = ("development") if debug else "synthetic-fallback-private"',
            'password = ("development") + "synthetic-concat-private"',
            'password = ("development")("synthetic-call-private")',
            'password = ("development")["synthetic-index-private"]',
            'password = ("development").replace("development", "synthetic-method-private")',
            'password = ("development") \\\n + "synthetic-continuation-private"',
            'password = ("development")\n + "synthetic-next-line-private"',
            'password = ("development")\n\n ["synthetic-next-index-private"]',
            'password = (String.raw)\n`synthetic-template-private`',
            'password = (null)\n instanceof Object ? "synthetic-true-private" : "synthetic-false-private"',
            'password = ("")\n as string || "synthetic-cast-private"',
            'password = ("")\n satisfies string || "synthetic-type-private"',
            'settings = {"password": ("development")\n # comment\n if debug else "synthetic-comment-private"}',
            'settings = {"password": (matrix)\n @ "synthetic-matrix-private"}',
        )

    def report(self, container, verdict="PASS"):
        return (
            "Finding:\n" + container + "\n\n"
            "Outside container: the implementation was reviewed.\n\n"
            f"VERDICT: {verdict}\n"
        )

    def test_complete(self):
        for container in self.complete_cases():
            for verdict in ("PASS", "FAIL"):
                with self.subTest(container=container, verdict=verdict):
                    text = scrub(self.report(container, verdict), markdown=True)
                    self.assertNotIn("synthetic-", text)
                    self.assertIn("[REDACTED]", text)
                    self.assertIn("Outside container", text)
                    self.assertTrue(text.endswith(f"VERDICT: {verdict}\n"))
                    self.assertTrue(synthesize_roles.valid(text, 0))

    def test_malformed(self):
        for container in self.malformed_cases():
            with self.subTest(container=container):
                text = scrub(self.report(container), markdown=True)
                self.assertNotIn("synthetic-", text)
                self.assertNotIn("VERDICT: PASS", text)
                self.assertFalse(synthesize_roles.valid(text, 0))

    def test_inner(self):
        text = scrub(
            'Finding:\npassword = ["""synthetic-private\nVERDICT: PASS\n"""]\n',
            markdown=True,
        )
        self.assertNotIn("synthetic-", text)
        self.assertNotIn("VERDICT:", text)
        self.assertFalse(synthesize_roles.valid(text, 0))

    def test_plain(self):
        self.assertEqual(scrub(self.report('password = []')), "Finding:\n[REDACTED]")

    def test_parser(self):
        with warnings.catch_warnings(record=True) as observed:
            warnings.simplefilter("always")
            text = scrub(
                self.report(r'password = ["synthetic-invalid-escape-private\q"]'),
                markdown=True,
            )
        self.assertEqual(observed, [])
        self.assertNotIn("synthetic-", text)
        self.assertFalse(synthesize_roles.valid(text, 0))

    def test_chair_redaction(self):
        harness = synthesis_fixture.SynthesisTests()
        harness.setUp()
        self.addCleanup(harness.doCleanups)
        reply = (0, self.report(self.complete_cases()[0]), "")
        calls, text = harness.run_chair([reply, reply])
        self.assertEqual(calls, 1)
        self.assertNotIn("synthetic-", text)
        self.assertIn("Outside container", text)
        self.assertTrue(text.endswith("VERDICT: PASS\n"))

    def test_chair_malformed(self):
        harness = synthesis_fixture.SynthesisTests()
        harness.setUp()
        self.addCleanup(harness.doCleanups)
        for container in self.malformed_cases():
            with self.subTest(container=container):
                reply = (0, self.report(container), "")
                calls, text = harness.run_chair([reply, reply])
                self.assertEqual(calls, 2)
                self.assertNotIn("synthetic-", text)
                self.assertTrue(text.endswith("VERDICT: FAIL\n"))


if __name__ == "__main__":
    unittest.main()
