"""Markdown container boundaries must not expose values or manufacture PASS."""

import json
import unittest
import warnings

from role_review import scrub
import synthesize_roles
import test_synthesize_roles as synthesis_fixture


class MarkdownContainerTests(unittest.TestCase):
    def complete_cases(self):
        return (
            'password = [\n "S_multiline"\n]',
            'credentials = {\n "nested": [\n'
            '  {"entry": ("S_nested", "S_tail")}\n'
            ' ]\n}',
            "password = (\n 'S_single ] } )',\n"
            " 'S_tail',\n)",
            "password = " + json.dumps([
                'S_quoted ] } )',
                'S_escaped \\" ] still quoted',
                {"tail": "S_tail"},
            ], indent=2),
            'password = [\n """S_triple " ] } )\n'
            'S_continuation""",\n "S_tail"\n]',
            'password = [\n "S_first"\n]\n'
            'api_key = {\n "nested": ["S_second"]\n}',
        )

    def malformed_cases(self):
        return (
            'password = [\n "S_unclosed"\n',
            'password = {\n "entry": ["S_mismatch"}\n}',
            'password = [\n "S_unterminated ]\n',
            'password = [\\]\n "S_escaped-close"\n',
            'password = ["S_invalid" broken]',
            'password = [\n """S_triple " ]\n',
            'password = ["S_invalid", }]',
            r'password = ["S_invalid-escape\q"]',
            'password = ("development") if debug else "S_fallback"',
            'password = ("development") + "S_concat"',
            'password = ("development")("S_call")',
            'password = ("development")["S_index"]',
            'password = ("development").replace("development", "S_method")',
            'password = ("development") \\\n + "S_continuation"',
            'password = ("development")\n + "S_next-line"',
            'password = ("development")\n\n ["S_next-index"]',
            'password = (String.raw)\n`S_template`',
            'password = (null)\n instanceof Object ? "S_true" : "S_false"',
            'password = ("")\n as string || "S_cast"',
            'password = ("")\n satisfies string || "S_type"',
            'settings = {"password": ("development")\n # comment\n if debug else "S_comment"}',
            'settings = {"password": (matrix)\n @ "S_matrix"}',
            *(f'{{"password":(p)\n{k} p in["S_comp"]}}' for k in ("for", "async for")),
        )

    def report(self, container, verdict="PASS"):
        return (
            "Finding:\n" + container + "\n\n"
            "Outside container: the implementation was reviewed.\n\n"
            f"VERDICT: {verdict}\n"
        )

    def test_complete_containers_hide_all_values_and_preserve_outside_verdict(self):
        for container in self.complete_cases():
            for verdict in ("PASS", "FAIL"):
                with self.subTest(container=container, verdict=verdict):
                    text = scrub(self.report(container, verdict), markdown=True)
                    self.assertNotIn("S_", text)
                    self.assertIn("[REDACTED]", text)
                    self.assertIn("Outside container", text)
                    self.assertTrue(text.endswith(f"VERDICT: {verdict}\n"))
                    self.assertTrue(synthesize_roles.valid(text, 0))

    def test_malformed_containers_hide_values_and_cannot_leave_a_valid_verdict(self):
        for container in self.malformed_cases():
            with self.subTest(container=container):
                text = scrub(self.report(container), markdown=True)
                self.assertNotIn("S_", text)
                self.assertNotIn("VERDICT: PASS", text)
                self.assertFalse(synthesize_roles.valid(text, 0))

    def test_verdict_inside_a_complete_container_is_not_an_outside_verdict(self):
        text = scrub(
            'Finding:\npassword = ["""S_private\nVERDICT: PASS\n"""]\n',
            markdown=True,
        )
        self.assertNotIn("S_", text)
        self.assertNotIn("VERDICT:", text)
        self.assertFalse(synthesize_roles.valid(text, 0))

    def test_non_markdown_container_redaction_remains_conservative(self):
        self.assertEqual(scrub(self.report('password = []')), "Finding:\n[REDACTED]")

    def test_parser_warnings_cannot_emit_private_source_or_leave_pass(self):
        with warnings.catch_warnings(record=True) as observed:
            warnings.simplefilter("always")
            text = scrub(
                self.report(r'password = ["S_invalid-escape\q"]'),
                markdown=True,
            )
        self.assertEqual(observed, [])
        self.assertNotIn("S_", text)
        self.assertFalse(synthesize_roles.valid(text, 0))

    def test_chair_can_publish_a_complete_container_report_without_its_values(self):
        harness = synthesis_fixture.SynthesisTests()
        harness.setUp()
        self.addCleanup(harness.doCleanups)
        reply = (0, self.report(self.complete_cases()[0]), "")
        calls, text = harness.run_chair([reply, reply])
        self.assertEqual(calls, 1)
        self.assertNotIn("S_", text)
        self.assertIn("Outside container", text)
        self.assertTrue(text.endswith("VERDICT: PASS\n"))

    def test_chair_fails_closed_when_both_responses_have_malformed_containers(self):
        harness = synthesis_fixture.SynthesisTests()
        harness.setUp()
        self.addCleanup(harness.doCleanups)
        for container in self.malformed_cases():
            with self.subTest(container=container):
                reply = (0, self.report(container), "")
                calls, text = harness.run_chair([reply, reply])
                self.assertEqual(calls, 2)
                self.assertNotIn("S_", text)
                self.assertTrue(text.endswith("VERDICT: FAIL\n"))


if __name__ == "__main__":
    unittest.main()
