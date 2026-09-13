"""Repository context limits are enforced before invoking any staged executor."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


WRAPPER = Path(__file__).with_name("run-specialists.sh")


class WrapperContextTests(unittest.TestCase):
    def run_wrapper(self, cap=None):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            binary = root / "bin"
            binary.mkdir()
            log = root / "calls"
            log.mkdir()
            fake = binary / "python3"
            fake.write_text(
                f"#!{sys.executable}\n"
                "import json, os, pathlib, sys\n"
                "name = pathlib.Path(sys.argv[1]).name\n"
                "if name == 'run_role.py':\n"
                "    name += '-' + sys.argv[sys.argv.index('--tag') + 1]\n"
                "(pathlib.Path(os.environ['REVIEW_CAP_TEST_LOG']) / name).write_text(\n"
                "    json.dumps({'cap': os.environ.get('REVIEW_CONTEXT_CAP')}))\n"
            )
            fake.chmod(0o755)
            work = root / "work"
            (work / "slot").mkdir(parents=True)
            sentinel = work / "slot" / "existing-evidence"
            sentinel.write_text("Preserve on invalid configuration.")
            environment = {
                "PATH": str(binary) + os.pathsep + os.environ["PATH"],
                "REVIEW_CAP_TEST_LOG": str(log),
            }
            if cap is not None:
                environment["REVIEW_CONTEXT_CAP"] = cap
            result = subprocess.run(
                ["bash", str(WRAPPER), "unused.diff", "unused-lenses", str(work)],
                capture_output=True, text=True, env=environment, timeout=10,
            )
            return (result, [json.loads(p.read_text()) for p in log.iterdir()],
                    sentinel.exists())

    def test_unset_context_cap_defaults_to_repository_limit(self):
        result, calls, _ = self.run_wrapper()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(calls), 6)
        self.assertEqual({item["cap"] for item in calls}, {"12288"})

    def test_lower_context_limits_are_exported_to_every_stage(self):
        for cap in ("1", "4096", "12288"):
            with self.subTest(cap=cap):
                result, calls, _ = self.run_wrapper(cap)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(len(calls), 6)
                self.assertEqual({item["cap"] for item in calls}, {cap})

    def test_invalid_context_caps_fail_before_preparation_or_execution(self):
        for cap in ("12289", "24000", "0", "-1", "invalid", "9" * 100):
            with self.subTest(cap=cap):
                result, calls, preserved = self.run_wrapper(cap)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(calls, [])
                self.assertTrue(preserved)
                self.assertIn("REVIEW_CONTEXT_CAP", result.stderr)


if __name__ == "__main__":
    unittest.main()
