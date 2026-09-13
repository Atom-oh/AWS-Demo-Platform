"""Project-policy tests."""

import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import prepare_roles
import synthesize_roles


POLICY = {
    "schema_version": 1, "input_adapter": "prepare_project_roles.py",
    "context_sources": ["CLAUDE.md", "scripts/pr-review/context.md"],
    "chair": {"timeout_seconds": 600, "max_turns": 8, "fallback_max_turns": 12,
              "allowed_tools": ["Read", "Grep", "Glob"],
              "disallowed_tools": ["Bash", "Write", "Edit", "NotebookEdit",
                                   "WebFetch", "WebSearch", "Task"]},
}


class ProjectPolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_optional(self):
        self.assertEqual(prepare_roles.project_policy(self.root), {})

    def test_duplicates(self):
        (self.root / "role-project.json").write_text(
            '{"schema_version":1,"schema_version":2}'
        )
        with self.assertRaises(ValueError):
            prepare_roles.project_policy(self.root)

    def test_adapter(self):
        data = dict(POLICY, input_adapter="../../outside.py")
        (self.root / "role-project.json").write_text(json.dumps(data))
        with self.assertRaises(ValueError):
            prepare_roles.project_policy(self.root)

    def test_defaults(self):
        options = synthesize_roles.chair_options(POLICY)
        self.assertEqual(options["timeout"], 600)
        self.assertEqual(options["turns"], (8, 12))
        self.assertIn("Bash", options["deny"])
        self.assertIn("Task", options["deny"])

    def test_turns(self):
        for value in ("0", "9"):
            with self.subTest(value=value), patch.dict(os.environ, {"CHAIR_MAX_TURNS": value}):
                with self.assertRaises(ValueError):
                    synthesize_roles.chair_options(POLICY)

    def test_denials(self):
        data = json.loads(json.dumps(POLICY))
        data["chair"]["disallowed_tools"] = ["Write"]
        with self.assertRaises(ValueError):
            synthesize_roles.chair_options(data)


if __name__ == "__main__":
    unittest.main()
