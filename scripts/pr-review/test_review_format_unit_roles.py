"""Independent formatter tests; importing the library does not activate runners."""

import itertools
from pathlib import Path
import random
import re
import runpy
import subprocess
import sys
import tempfile
import unittest

MODULE = Path(__file__).with_name("review_format.py")
FORMAT = runpy.run_path(str(MODULE))


class StandaloneReviewFormatTests(unittest.TestCase):
    def test_operator_free_tokens_finish_within_a_bounded_subprocess(self):
        code = (
            "import runpy,sys\n"
            "check=runpy.run_path(sys.argv[1])['format_violation']\n"
            "value='token-'*6000\n"
            "assert check(value) is None\n"
            "assert check(value+' ordinary: prose') is None\n"
            "assert check('`'+value+'`') is None\n"
            "assert check(value+\"='synthetic'\") == 'unsupported_review_format'\n"
        )
        try:
            result = subprocess.run([sys.executable, "-c", code, str(MODULE)],
                                    capture_output=True, text=True, timeout=5)
        except subprocess.TimeoutExpired:
            self.fail("A 36KB token sequence stalled the default assignment scan")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_adp_policy_and_citation_rules_are_preserved(self):
        accepted = (
            "Authorization: The caller is checked.",
            "**Secrets/credentials:** none introduced.",
            "See [token.py](src/token.py:42) for the caller.",
            "See src/token.py:42 for the caller.",
            "See src/token.py:42:7 for the caller.",
            "Checked `src/token.py`: the caller is checked.",
            "Authorization:\nThe caller is checked.",
            "Checked `token`\n===\nThe caller is checked.",
            "```json\n{\"password\":\"synthetic\"}\n```",
        )
        rejected = (
            "password='synthetic'", "password=", "password\n= 'synthetic'",
            "Set `password`: 'synthetic'.", "Authorization: Bearer synthetic",
            "password: !!str synthetic", "token: &saved synthetic",
            "See src/token.py:42; token='synthetic'",
            # These are ADP's existing policy, not the plugin's later additions.
            "Secrets: none.", "Credentials: unchanged!",
            "See src/token.py:L42.", "See src/token.py:42-45.",
        )
        for text in accepted:
            with self.subTest(text=text):
                self.assertIsNone(FORMAT["format_violation"](text))
        for text in rejected:
            with self.subTest(text=text):
                self.assertEqual(FORMAT["format_violation"](text), "unsupported_review_format")

    def test_default_matching_agrees_with_the_original_regex(self):
        pattern = re.compile(FORMAT["DEFAULT_SENSITIVE_KEY"])
        old = re.compile(pattern.pattern + r"""(?:\\?["'])?"""
                         + FORMAT["ASSIGNMENT_TAIL"].pattern, pattern.flags)
        keys = ("token", "token-token", "authentic", "auth", "password", "plain",
                "config.password", "AWS::SecretsManager::Secret", "apiKey", "paſſword",
                "épassword", "İtoken", "_token", "token:plain", ":token")
        tails = ("", ":42", ":L42-L45", ":42:7", "='x'", ": none.", ": bare",
                 ": checked here", ": [file](auth.ts)", '" : "x"', "\\\"='x'",
                 " :token='x'", "\n===\n", " ordinary: prose")
        corpus = [prefix + key + tail for prefix, key, tail in
                  itertools.product(("", "/", "\\", '"', "a "), keys, tails)]
        randomizer = random.Random(132)
        parts = ("token", "auth", "plain", "-", "_", ".", ":", "=", " ", "\n", '"', "\\", "é")
        corpus.extend("".join(randomizer.choices(parts, k=12)) for _ in range(1000))
        for text in corpus:
            with self.subTest(text=text):
                expected = [(match.start(), match.start("spacing"), match.end(),
                             match["spacing"], match["operator"]) for match in old.finditer(text)]
                actual = [(start, match.start("spacing"), match.end(),
                           match["spacing"], match["operator"])
                          for start, match in FORMAT["assignment_matches"](text, pattern)]
                self.assertEqual(actual, expected)
                self.assertEqual(bool(FORMAT["sensitive_reference"](text, pattern)),
                                 bool(pattern.search(text)))

    def test_custom_patterns_keep_the_original_fallback(self):
        for pattern in (re.compile(r"(?i:custom_secret)"),
                        re.compile(r"(?i:[\w -]*(?:token|password)[\w -]*)"),
                        re.compile(FORMAT["DEFAULT_SENSITIVE_KEY"], re.ASCII)):
            old = re.compile(pattern.pattern + r"""(?:\\?["'])?"""
                             + FORMAT["ASSIGNMENT_TAIL"].pattern, pattern.flags)
            for text in ("custom_secret='x'", "token='x'", "my token : x", "普通token=x",
                         "Ktoken=x", "path/token.py:42", 'token :password="x"'):
                with self.subTest(pattern=pattern.pattern, text=text):
                    expected = [(match.start(), match.end(), match["spacing"], match["operator"])
                                for match in old.finditer(text)]
                    actual = [(start, match.end(), match["spacing"], match["operator"])
                              for start, match in FORMAT["assignment_matches"](text, pattern)]
                    self.assertEqual(actual, expected)

    def test_cli_filter_keeps_supported_text_and_withholds_invalid_examples(self):
        for text, accepted in (("See `src/service.py` for the caller.\n", True),
                               ("Run `echo synthetic`.\n", False)):
            with self.subTest(text=text):
                result = subprocess.run([sys.executable, str(MODULE), "filter"],
                                        input=text, capture_output=True, text=True, timeout=5)
                self.assertEqual(result.returncode, 0 if accepted else 2)
                self.assertEqual(result.stdout, text if accepted else "")
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "review.txt"
            source.write_text("password='synthetic'\n")
            result = subprocess.run([sys.executable, str(MODULE), "check", str(source)],
                                    capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stdout.strip(), "unsupported_review_format")


if __name__ == "__main__":
    unittest.main()
