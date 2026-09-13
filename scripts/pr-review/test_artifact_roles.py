"""Exercise receipt-only transport into a freshly prepared chair workspace."""

import json
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
        self.harness.prepare()
        self.harness.finish()
        chair = self.harness.root / "chair"
        shutil.copytree(self.harness.work, chair)
        shutil.rmtree(chair / "requests")
        self.harness.work = chair

    def restore(self, expected):
        result = subprocess.run(
            [sys.executable, str(Path(__file__).with_name("restore_role_frames.py")),
             "--work", str(self.harness.work)], capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(expected, result.returncode, result.stderr)

    def test_fresh_chair_restores_frames_without_transporting_raw_requests(self):
        self.harness.assert_blocked()
        self.restore(0)
        self.harness.cli("aggregate", "--work", self.harness.work)
        self.assertEqual("deterministic", self.harness.read("role-summary.json")["mode"])

    def test_modified_receipt_cannot_authorize_different_source(self):
        path = self.harness.work / "slot/codex-request.json"
        receipt = json.loads(path.read_text())
        receipt["head_sha"] = "c" * 40
        path.write_text(json.dumps(receipt))
        self.restore(2)
        self.harness.assert_blocked()

    def test_existing_modified_frame_is_not_silently_repaired(self):
        path = self.harness.work / "requests/codex.input"
        path.parent.mkdir()
        path.write_text("altered input")
        self.restore(2)
        self.assertEqual("altered input", path.read_text())
        self.harness.assert_blocked()


if __name__ == "__main__":
    unittest.main()
