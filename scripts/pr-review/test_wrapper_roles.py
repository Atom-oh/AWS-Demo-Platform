"""ADP context-limit tests."""

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
            environment = {'PATH': str(binary) + os.pathsep + os.environ['PATH'], 'REVIEW_CAP_TEST_LOG': str(log)}
            if cap is not None:
                environment["REVIEW_CONTEXT_CAP"] = cap
            result = subprocess.run(
                ["bash", str(WRAPPER), "unused.diff", "unused-lenses", str(work)],
                capture_output=True, text=True, env=environment, timeout=10,
            )
            return (result, [json.loads(p.read_text()) for p in log.iterdir()], sentinel.exists())

    def test_default(self):
        result, calls, _ = self.run_wrapper()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(calls), 6)
        self.assertEqual({item["cap"] for item in calls}, {"12288"})

    def test_lower(self):
        for cap in ("1", "4096", "12288"):
            with self.subTest(cap=cap):
                result, calls, _ = self.run_wrapper(cap)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(len(calls), 6)
                self.assertEqual({item["cap"] for item in calls}, {cap})

    def test_invalid(self):
        for cap in ("12289", "24000", "0", "-1", "invalid", "9" * 100):
            with self.subTest(cap=cap):
                result, calls, preserved = self.run_wrapper(cap)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(calls, [])
                self.assertTrue(preserved)
                self.assertIn("REVIEW_CONTEXT_CAP", result.stderr)

    def test_panel_stops_before_executor_on_unsafe_slot(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "work").mkdir()
            (root / "target").mkdir()
            (root / "work/slot").symlink_to(root / "target", target_is_directory=True)
            (root / "bin").mkdir()
            marker = root / "executor-started"
            fake = root / "bin/python3"
            fake.write_text(f"#!{sys.executable}\nfrom pathlib import Path\nPath({str(marker)!r}).touch()\n")
            fake.chmod(0o755)
            result = subprocess.run(
                ["bash", str(WRAPPER.with_name("run-panel.sh")), "unused", "unused",
                 str(root / "work"), "codex"],
                env={"PATH": str(root / "bin") + os.pathsep + os.environ["PATH"],
                     "ROLE_REVIEW": "1"}, capture_output=True, text=True, timeout=10,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(marker.exists())
            self.assertTrue((root / "work/slot").is_symlink())

    def test_prepare_exports_positional_shas(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            binary = root / "bin"
            binary.mkdir()
            log = root / "environment.json"
            gh = binary / "gh"
            gh.write_text(
                f"#!{sys.executable}\nimport base64,sys\n"
                "if '/contents/' in sys.argv[2]:\n"
                " print(base64.b64encode(b'Trusted context.').decode())\n"
                "else:\n print('diff --git a/x.py b/x.py\\n--- a/x.py\\n+++ b/x.py\\n@@ -1 +1 @@\\n-old\\n+new')\n"
            )
            python = binary / "python3"
            python.write_text(
                f"#!{sys.executable}\nimport json,os,pathlib\n"
                f"pathlib.Path({str(log)!r}).write_text(json.dumps("
                "{k:os.environ.get(k) for k in ['HEAD_SHA','BASE_SHA']}))\n"
            )
            gh.chmod(0o755)
            python.chmod(0o755)
            result = subprocess.run(
                ["bash", str(WRAPPER.with_name("prepare-inputs.sh")),
                 "a" * 40, "b" * 40, str(root / "work")],
                env={"PATH": str(binary) + os.pathsep + os.environ["PATH"],
                     "ROLE_REVIEW": "1", "GH_REPO": "owner/repo"},
                capture_output=True, text=True, timeout=10,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(log.read_text()),
                             {"HEAD_SHA": "a" * 40, "BASE_SHA": "b" * 40})


if __name__ == "__main__":
    unittest.main()
