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
        for error in (
            'ThrottlingException: MONTHLY_REQUEST_COUNT exhausted',
            'You have reached the limit for overages',
            'unknown model\nquota exceeded',
            'Error:ThrottlingException\nquota exceeded',
        ):
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
                "Error: quota exceeded for this account",
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

    def test_scrubbing_cannot_accept_conflicting_original_verdicts(self):
        for failure in ("VERDICT: FAIL", "\x1b[31mVERDICT: FAIL\x1b[0m"):
            with self.subTest(failure=failure):
                reply = (0, f"Finding:\npassword = prior ||\n{failure}\nVERDICT: PASS\n", "")
                calls, text = self.run_chair([reply, reply])
                self.assertEqual(calls, 2)
                self.assertTrue(text.endswith("VERDICT: FAIL\n"))

    def test_complete_scalar_citations_preserve_the_verdict(self):
        secret = "SYNTHETIC_CITATION_VALUE"
        for example, accepted in (
            (f'Example: `password="{secret}"` is illustrative.', True),
            # An unquoted legacy marker still reaches the existing strict container guard.
            (f'Example: `password={secret}` is illustrative.', False),
            (f'Reviewed password="{secret}" isn\'t logged.', True),
            (f'Example: ``password = `{secret}` `` is illustrative.', True),
            (f'```js\npassword = prefix + `{secret}`;\n```\nReviewed the expression.', True),
        ):
            with self.subTest(example=example):
                reply = (0, example + "\nVERDICT: PASS\n", "")
                calls, text = self.run_chair([reply, reply])
                self.assertEqual(calls, 1 if accepted else 2)
                self.assertIn("VERDICT: PASS" if accepted else "VERDICT: FAIL", text)
                self.assertNotIn(secret, text)

    def test_adjacent_values_do_not_end_at_an_inline_delimiter(self):
        for example, accepted in (
            ("// `export\npassword=prefix`printf 'private-value'`", True),
            ("1. Summary\n\n    Example `password=prefix`'private-value'", False),
        ):
            with self.subTest(example=example):
                reply = (0, example + "\n\nReviewed behavior.\nVERDICT: PASS\n", "")
                calls, text = self.run_chair([reply, reply])
                self.assertNotIn("private-value", text)
                self.assertEqual(calls, 1 if accepted else 2)
                self.assertTrue(text.endswith("VERDICT: PASS\n" if accepted else "VERDICT: FAIL\n"))

    def test_normal_inline_closing_separators_preserve_review(self):
        for suffix in ("; reviewed.", ", reviewed.", ".", "**", "_", "~", ")", "]"):
            with self.subTest(suffix=suffix):
                reply = (0, "Checked `password=private-value`" + suffix
                         + "\nPUBLIC_AFTER\nVERDICT: PASS\n", "")
                calls, text = self.run_chair([reply, reply])
                self.assertEqual(calls, 1)
                self.assertNotIn("private-value", text)
                self.assertIn("PUBLIC_AFTER", text)
                self.assertTrue(text.endswith("VERDICT: PASS\n"))

    def test_literal_quote_context_keeps_whitespace_values_private(self):
        for example in (
            "echo '`'\npassword=prefix` printf 'private-value'`\nSee `service`.",
            "echo '`'\npassword=$(printf public)` printf 'private-value'`",
        ):
            with self.subTest(example=example):
                reply = (0, example + "\n\nReviewed behavior.\nVERDICT: PASS\n", "")
                calls, text = self.run_chair([reply, reply])
                self.assertNotIn("private-value", text)
                self.assertEqual(calls, 1)
                self.assertIn("Reviewed behavior.", text)
                self.assertTrue(text.endswith("VERDICT: PASS\n"))

    def test_comment_and_table_ticks_do_not_open_later_values(self):
        for example in (
            "// `\nconst password = tag` private-value`;",
            "| first | second |\n| --- | --- |\n| ` | public |\n"
            "| password=prefix` printf 'private-value'` | done |",
            "| first | second |\n| --- | --- |\n"
            "| ` | password=prefix` printf 'private-value'` |",
        ):
            with self.subTest(example=example):
                reply = (0, example + "\n\nReviewed behavior.\nVERDICT: PASS\n", "")
                calls, text = self.run_chair([reply, reply])
                self.assertNotIn("private-value", text)
                self.assertEqual(calls, 1)
                self.assertIn("Reviewed behavior.", text)
                self.assertTrue(text.endswith("VERDICT: PASS\n"))

    def test_table_recognition_preserves_cell_spans_and_offsets(self):
        import role_review
        for example in (
            "| a | b |\n| --- | --- |\n| ` | `keep()` |",
            "| ` | `keep()` |\n| --- | --- |",
            "a | b\n--- | ---\n` | `keep()`",
            "| a | b |\n| --- | --- |\n| ` | public |\n`keep()`",
            "| a | b |\n| --- | --- |\n| ` | public | extra |\n| `keep()` |",
            "- > | a | b |\n  > | --- | --- |\n  > | ` | `keep()` |",
            "- | π | b |\n\t| --- | --- |\n\t| ` | `keep()` |",
            "| a | b |\n| --- | --- |\n| `a\\|b` | `keep()` |",
        ):
            with self.subTest(example=example):
                spans = role_review._inline_code_spans(example)
                self.assertIn((example.index("keep()"), example.index("keep()") + 6), spans)
                if "a\\|b" in example:
                    self.assertIn("a\\|b", [example[start:end] for start, end in spans])
        even_slashes = "| a | b |\n| --- | --- |\n| `a\\\\|b` | public |"
        self.assertEqual(role_review._inline_code_spans(even_slashes), [])

    def test_table_scope_leaves_other_paragraphs_unchanged(self):
        import role_review
        for example, expected in (
            ("Use `open | middle\nclose` now.", "open | middle\nclose"),
            ("Header `open | extra | third\n--- | ---\nclose`", "open | extra | third\n--- | ---\nclose"),
            ("Header `open | extra\nxx | ---\nclose`", "open | extra\nxx | ---\nclose"),
            ("| a | b |\n| --- | --- |\n| ` | public |\n\nRun `open\nclose`.", "open\nclose"),
            ("| a | b |\n| --- | --- |\n| ` | public |\n# Heading\nRun `open\nclose`.", "open\nclose"),
            ("// Checked `keep()` now.", "keep()"),
            ("Use https://example.invalid/ `open\nclose`.", "open\nclose"),
        ):
            with self.subTest(example=example):
                self.assertIn(expected, [example[start:end]
                                        for start, end in role_review._inline_code_spans(example)])

    def test_inline_assignment_preserves_evidence_before_raw_blocks(self):
        for block in ("```text\npublic()\n```", "<pre>\necho '`'\n</pre>"):
            with self.subTest(block=block):
                reply = (0, "Checked `env password='private-value'`; "
                         "MAJOR rollback evidence.\n\n" + block + "\nVERDICT: FAIL\n", "")
                calls, text = self.run_chair([reply, reply])
                self.assertEqual(calls, 1)
                self.assertNotIn("private-value", text)
                self.assertIn("MAJOR rollback evidence.", text)
                self.assertIn("public()" if block.startswith("```") else "<pre>", text)
                self.assertTrue(text.endswith("VERDICT: FAIL\n"))

    def test_command_citations_preserve_following_findings(self):
        for prefix in ("env ", "curl -d ", "USER=demo ", "export\n"):
            with self.subTest(prefix=prefix):
                reply = (0, "Checked `" + prefix + "password='private-value'`; "
                         "MAJOR rollback evidence. See `service` and `validate()`.\nVERDICT: FAIL\n", "")
                calls, text = self.run_chair([reply, reply])
                self.assertEqual(calls, 1)
                self.assertNotIn("private-value", text)
                self.assertIn("MAJOR rollback evidence.", text)
                self.assertIn("`service`", text)
                self.assertTrue(text.endswith("VERDICT: FAIL\n"))

    def test_backtick_assignment_keeps_concatenated_suffix_private(self):
        for suffix in ("private-value", "'private-value'", "`printf private-value`"):
            for prefix in ("echo '`'\n", "- > echo '`'\n  > "):
                with self.subTest(suffix=suffix, prefix=prefix):
                    reply = (0, prefix + "password=prefix`printf public`" + suffix
                             + "\n\nReviewed behavior.\nVERDICT: PASS\n", "")
                    calls, text = self.run_chair([reply, reply])
                    self.assertNotIn("private-value", text)
                    self.assertEqual(calls, 1)
                    self.assertIn("Reviewed behavior.", text)
                    self.assertTrue(text.endswith("VERDICT: PASS\n"))

    def test_complex_backtick_values_remain_private(self):
        examples = (
            ("echo '`'\npassword=${PREFIX}`printf 'private-value'`", True),
            ("echo '`'\npassword=tags[0]`private-value`", True),
            ("Use `password=`! printf 'private-value'`` now.", False),
        )
        for example, accepted in examples:
            with self.subTest(example=example):
                reply = (0, example + "\n\nReviewed behavior.\nVERDICT: PASS\n", "")
                calls, text = self.run_chair([reply, reply])
                self.assertNotIn("private-value", text)
                self.assertEqual(calls, 1 if accepted else 2)
                self.assertTrue(text.endswith("VERDICT: PASS\n" if accepted else "VERDICT: FAIL\n"))

    def test_inline_assignment_citations_preserve_following_findings(self):
        for value in ("private-value", "'private-value'", '"private-value"'):
            with self.subTest(value=value):
                reply = (0, "Checked `password=" + value + "`; MAJOR rollback evidence. "
                         "See `service` and `validate()`.\nVERDICT: FAIL\n", "")
                calls, text = self.run_chair([reply, reply])
                self.assertEqual(calls, 1)
                self.assertNotIn("private-value", text)
                self.assertIn("MAJOR rollback evidence.", text)
                self.assertIn("`service`", text)
                self.assertTrue(text.endswith("VERDICT: FAIL\n"))

    def test_backtick_values_are_protected_before_markdown_boundaries(self):
        examples = (
            "echo '`'\npassword=`printf 'private-value'`",
            "echo '`'\npassword=prefix`printf 'private-value'`",
            'echo \'`\'\npassword="prefix"`printf \'private-value\'`',
            "echo '`'\npassword=`printf\n'private-value'`",
            "| command |\n| --- |\n| echo '`' |\n| password=`printf 'private-value'` |",
            "| first | second |\n| --- | --- |\n| echo '`' | password=`printf 'private-value'` |",
            "<script>\n</style>\necho '`'\npassword=`printf 'private-value'`\n</script>",
        )
        for example in examples:
            with self.subTest(example=example):
                reply = (0, example + "\n\nReviewed behavior.\nVERDICT: PASS\n", "")
                calls, text = self.run_chair([reply, reply])
                self.assertEqual(calls, 1)
                self.assertNotIn("private-value", text)
                self.assertTrue(text.endswith("VERDICT: PASS\n"))

    def test_ambiguous_nonempty_values_are_not_accepted_as_empty(self):
        for example in (
            "echo '`'\npassword=`printf 'private-value'",
            'Use `password=`"private-value"',
        ):
            with self.subTest(example=example):
                reply = (0, example + "\nReviewed behavior.\nVERDICT: PASS\n", "")
                calls, text = self.run_chair([reply, reply])
                self.assertEqual(calls, 2)
                self.assertNotIn("private-value", text)
                self.assertTrue(text.endswith("VERDICT: FAIL\n"))

    def test_any_standard_type1_end_tag_ends_the_html_block(self):
        reply = (0, "<script>\n</style>\nUse `export\npassword=private-value` now.\n"
                    "Reviewed behavior.\nVERDICT: PASS\n", "")
        calls, text = self.run_chair([reply, reply])
        self.assertEqual(calls, 1)
        self.assertNotIn("private-value", text)
        self.assertTrue(text.endswith("VERDICT: PASS\n"))

    def test_ordered_nested_containers_keep_literal_values_hidden(self):
        examples = (
            "- > ```bash\n  > echo '`'\n  > password=`printf 'private-value'`\n  > ```",
            "- > <pre>\n  > echo '`'\n  > password=`printf 'private-value'`\n  > </pre>",
            "- - ```bash\n    echo '`'\n    password=`printf 'private-value'`\n    ```",
            "- - <pre>\n    echo '`'\n    password=`printf 'private-value'`\n    </pre>",
            "> - > ```bash\n>   > echo '`'\n>   > password=`printf 'private-value'`\n>   > ```",
            "> - > <pre>\n>   > echo '`'\n>   > password=`printf 'private-value'`\n>   > </pre>",
            "- > - ```bash\n  >   echo '`'\n  >   password=`printf 'private-value'`\n  >   ```",
            "- > - <pre>\n  >   echo '`'\n  >   password=`printf 'private-value'`\n  >   </pre>",
            "1. > - ```bash\n   >   echo '`'\n   >   password=`printf 'private-value'`\n   >   ```",
            "1. > - <pre>\n   >   echo '`'\n   >   password=`printf 'private-value'`\n   >   </pre>",
        )
        for example in examples:
            with self.subTest(example=example):
                reply = (0, example + "\n\nReviewed behavior.\nVERDICT: PASS\n", "")
                calls, text = self.run_chair([reply, reply])
                self.assertEqual(calls, 1)
                self.assertNotIn("private-value", text)
                self.assertIn("Reviewed behavior.", text)
                self.assertTrue(text.endswith("VERDICT: PASS\n"))

    def test_literal_backticks_in_raw_blocks_keep_sensitive_values_hidden(self):
        examples = (
            "```bash\ncat <<'EOF'\n> ```\nEOF\necho '`'\npassword=`printf 'private-value'`\n```",
            "> ```bash\n> cat <<'EOF'\n> > ```\n> EOF\n> echo '`'\n> password=`printf 'private-value'`\n> ```",
            "- Example\n\n  ```bash\n  cat <<'EOF'\n  > ```\n  EOF\n  echo '`'\n  password=`printf 'private-value'`\n  ```",
            "<pre>\necho '`'\npassword=`printf 'private-value'`\n</pre>",
            '<SCRIPT type="text/plain">\necho \'`\'\npassword=`printf \'private-value\'`\n</SCRIPT>',
            "<style>\necho '`'\npassword=`printf 'private-value'`\n</style>",
            "<textarea>\necho '`'\npassword=`printf 'private-value'`\n</textarea>",
            "<!--\necho '`'\npassword=`printf 'private-value'`\n-->",
            "<?example\necho '`'\npassword=`printf 'private-value'`\n?>",
            "<!DOCTYPE\necho '`'\npassword=`printf 'private-value'`\n>",
            "<![CDATA[\necho '`'\npassword=`printf 'private-value'`\n]]>",
            "<div>\necho '`'\npassword=`printf 'private-value'`\n</div>",
            '<x-data attr="ok">\necho \'`\'\npassword=`printf \'private-value\'`\n</x-data>',
            "> <pre>\n> echo '`'\n> password=`printf 'private-value'`\n> </pre>",
        )
        examples += ("<div>\n\xa0\necho '`'\npassword=`printf 'private-value'`\n</div>",)
        examples += tuple(
            "<script>\n" + closer + "\necho '`'\npassword=`printf 'private-value'`\n</script>"
            for closer in ("</ſcript>", "</scrİpt>", "</scrıpt>")
        )
        for example in examples:
            with self.subTest(example=example):
                reply = (0, example + "\n\nReviewed behavior.\nVERDICT: PASS\n", "")
                calls, text = self.run_chair([reply, reply])
                self.assertEqual(calls, 1)
                self.assertNotIn("private-value", text)
                self.assertIn("Reviewed behavior.", text)
                self.assertTrue(text.endswith("VERDICT: PASS\n"))

    def test_raw_container_exit_restores_inline_lookup(self):
        examples = (
            "> ```text\n> echo '`'\nOutside `export\npassword=private-value` now.",
            "- Example\n\n  ```text\n  echo '`'\nOutside `export\npassword=private-value` now.",
            "> <pre>\n> echo '`'\nOutside `export\npassword=private-value` now.",
        )
        for example in examples:
            with self.subTest(example=example):
                reply = (0, example + "\n\nReviewed behavior.\nVERDICT: PASS\n", "")
                calls, text = self.run_chair([reply, reply])
                self.assertEqual(calls, 1)
                self.assertNotIn("private-value", text)
                self.assertIn("Reviewed behavior.", text)
                self.assertTrue(text.endswith("VERDICT: PASS\n"))

    def test_complete_custom_html_tag_does_not_interrupt_inline_prose(self):
        reply = (0, "Use `export\n<x-data attr='ok'>\npassword=private-value` now.\n"
                    "Reviewed behavior.\nVERDICT: PASS\n", "")
        calls, text = self.run_chair([reply, reply])
        self.assertEqual(calls, 1)
        self.assertNotIn("private-value", text)
        self.assertTrue(text.endswith("VERDICT: PASS\n"))

    def test_empty_sensitive_examples_preserve_the_review(self):
        for example in (
            "Checked `password=`; empty values are rejected.",
            "Checked `export password=   `; empty values are rejected.",
            "Checked ``password=``; empty values are rejected.",
            "```dotenv\npassword=\n```",
            "```dotenv\npassword=   \n```",
            "````dotenv\npassword=\n````",
            "> ```dotenv\n> password=\n> ```",
            "- Example\n\n  > ```dotenv\n  > password=\n  > ```",
        ):
            with self.subTest(example=example):
                reply = (0, example + "\nPUBLIC_AFTER\nVERDICT: PASS\n", "")
                calls, text = self.run_chair([reply, reply])
                self.assertEqual(calls, 1)
                self.assertIn("PUBLIC_AFTER", text)
                self.assertTrue(text.endswith("VERDICT: PASS\n"))

    def test_opening_fence_after_sensitive_label_still_hides_its_value(self):
        reply = (0, "password=\n```text\nprivate-value\n```\nPUBLIC_AFTER\nVERDICT: PASS\n", "")
        calls, text = self.run_chair([reply, reply])
        self.assertEqual(calls, 1)
        self.assertNotIn("private-value", text)
        self.assertIn("PUBLIC_AFTER", text)
        self.assertTrue(text.endswith("VERDICT: PASS\n"))

    def test_multiline_and_list_code_spans_preserve_review(self):
        for example in (
            "1. Summary\n\n    Run `export password=private-value` now.",
            "Run `export\npassword=private-value` now.",
            "1. Summary\n\n    Run `export\n    password=private-value` now.",
            "10. Summary\n\n     Run `export password=private-value` now.",
            "- Summary\n\n    Run `export password=private-value` now.",
            "-\n\n    Run `export password=private-value` now.",
        ):
            with self.subTest(example=example):
                reply = (0, example + "\n\nReviewed behavior.\nVERDICT: PASS\n", "")
                calls, text = self.run_chair([reply, reply])
                self.assertEqual(calls, 1)
                self.assertIn("Reviewed behavior.", text)
                self.assertTrue(text.endswith("VERDICT: PASS\n"))
                self.assertNotIn("private-value", text)

    def test_inline_boundaries_exclude_separate_blocks(self):
        import role_review
        for example in (
            "    `password=value`\n",
            "```text\n`password=value`\n```\n",
            "1. Summary\n\n   ```text\n   `password=value`\n   ```\n",
            "Example `open\n\nnew paragraph`\n",
            "Example `open\n```text\nclose`\n```\n",
            "Example `open\nclose``\n",
            "Example `open\n--\nclose`\n",
            "Example `open\n=\nclose`\n",
            "Example `open\n_ _ _\nclose`\n",
        ):
            with self.subTest(example=example):
                self.assertEqual(role_review._inline_code_spans(example), [])

    def test_shell_quoted_json_preserves_enclosing_boundary(self):
        for payload in (
            '{"password":"private-value"}',
            '{"public":"ok","password":"private-value"}',
            '[{"password":"private-value"}]',
            '{"password":"private-value","public":"ok"}',
        ):
            with self.subTest(payload=payload):
                reply = (0, f"Example: curl -d '{payload}' https://example.invalid\n"
                            "Reviewed behavior.\nVERDICT: PASS\n", "")
                calls, text = self.run_chair([reply, reply])
                self.assertEqual(calls, 1)
                self.assertTrue(text.endswith("VERDICT: PASS\n"))
                self.assertIn("Reviewed behavior", text)
                self.assertNotIn("private-value", text)


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
