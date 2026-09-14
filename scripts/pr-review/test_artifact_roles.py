"""Private-frame transport tests."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import unittest

import test_role_review as fixture


class ArtifactTransportTests(unittest.TestCase):
    def setUp(self):
        self.harness = fixture.RoleReviewTests()
        self.harness.setUp()
        self.addCleanup(self.harness.tearDown)
        diff = fixture.patch("infra/network.tf")
        plan = self.harness.prepare(diff)
        self.harness.finish()
        producer = self.harness.work
        self.assertEqual(plan, self.harness.prepare(diff, case="chair"))
        shutil.copytree(producer / "slot", self.harness.work / "slot", dirs_exist_ok=True)

    def restore(self, expected):
        result = subprocess.run(
            [sys.executable, str(Path(__file__).with_name("restore_role_frames.py")),
             "--work", str(self.harness.work)], capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(expected, result.returncode, result.stderr)

    def test_restore(self):
        self.harness.assert_blocked()
        self.restore(0)
        self.harness.cli("aggregate", "--work", self.harness.work)
        self.assertEqual("deterministic", self.harness.read("role-summary.json")["mode"])

    def test_receipt(self):
        path = self.harness.work / "slot/codex-request.json"
        receipt = json.loads(path.read_text())
        receipt["head_sha"] = "c" * 40
        path.write_text(json.dumps(receipt))
        self.restore(2)
        self.harness.assert_blocked()

    def test_preserve(self):
        path = self.harness.work / "requests/codex.input"
        path.parent.mkdir()
        path.write_text("altered input")
        self.restore(2)
        self.assertEqual("altered input", path.read_text())
        self.harness.assert_blocked()

    def shell_report(self):
        binary = self.harness.root / "bin"
        binary.mkdir()
        marker = self.harness.root / "unexpected-chair"
        fake = binary / "claude"
        fake.write_text(f"#!{sys.executable}\nfrom pathlib import Path\nPath({str(marker)!r}).touch()\n")
        fake.chmod(0o755)
        env = dict(os.environ, ROLE_REVIEW="1",
                   PATH=str(binary) + os.pathsep + os.environ["PATH"])
        directory = Path(__file__).parent
        output = self.harness.work / "review.md"
        for command in (
            ["bash", str(directory / "aggregate.sh"), "unused", str(self.harness.work)],
            ["bash", str(directory / "synthesize.sh"), "unused", str(self.harness.work),
             "1", "fixture", str(output)],
        ):
            result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(marker.exists(), "Deterministic paths must not call a chair")
        return output.read_text()

    def test_shell_clean_publication(self):
        self.assertTrue(self.shell_report().endswith("VERDICT: PASS\n"))

    def test_shell_restore_failure_publication(self):
        path = self.harness.work / "slot/codex-request.json"
        receipt = json.loads(path.read_text())
        receipt["head_sha"] = "c" * 40
        path.write_text(json.dumps(receipt))
        self.assertTrue(self.shell_report().endswith("VERDICT: FAIL\n"))
        self.assertTrue((self.harness.work / "role-frame-restore.flag").exists())


if __name__ == "__main__":
    unittest.main()
