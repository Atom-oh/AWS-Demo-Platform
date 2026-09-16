"""Fencing a JSON example must preserve structured credential masking."""

import json
import unittest

import test_role_review as roles
import test_synthesize_roles as chairs


CANARY = "FENCED_NAMED_PRIVATE_CANARY"


class FencedJsonTests(unittest.TestCase):
    def examples(self):
        for name, value, label in (
            ("name", "value", "password:admin"),
            ("headerName", "headerValue", "token=abc"),
        ):
            for fence in ("```", "~~~~"):
                data = {name: label, value: CANARY, "public": "PUBLIC_KEEP"}
                yield fence + "json\n" + json.dumps(data) + "\n" + fence

    def test_specialist_record_and_summary_hide_named_values(self):
        for example in self.examples():
            with self.subTest(example=example):
                helper = roles.RoleReviewTests()
                helper.setUp()
                self.addCleanup(helper.tearDown)
                helper.prepare()
                finding = {"severity": "MINOR", "path": roles.FRONTEND,
                           "condition": "The example uses a named credential.",
                           "evidence": example}
                result = helper.record("codex", helper.response("codex", findings=[finding]))
                self.assertTrue(result["valid"])
                self.assertNotIn(CANARY, json.dumps(result))
                self.assertIn("PUBLIC_KEEP", json.dumps(result))
                helper.record("claude-self")
                helper.aggregate()
                self.assertNotIn(CANARY, (helper.work / "deterministic-review.md").read_text())

    def test_chair_keeps_review_prose_and_masks_named_values(self):
        for example in self.examples():
            with self.subTest(example=example):
                helper = chairs.SynthesisTests()
                helper.setUp()
                self.addCleanup(helper.doCleanups)
                reply = (0, "Checked the caller.\n" + example + "\nVERDICT: PASS\n", "")
                calls, published = helper.run_chair([reply, reply])
                self.assertEqual(calls, 1)
                self.assertNotIn(CANARY, published)
                self.assertIn("PUBLIC_KEEP", published)
                self.assertTrue(published.endswith("VERDICT: PASS\n"))

    def test_example_json_does_not_inherit_protocol_path_exemptions(self):
        helper = roles.RoleReviewTests()
        helper.setUp()
        self.addCleanup(helper.tearDown)
        helper.prepare()
        example = "```json\n" + json.dumps({
            "path": "password=" + CANARY, "reviewed_paths": ["token=" + CANARY],
            "public": "PUBLIC_KEEP",
        }) + "\n```"
        response = helper.response("codex", checks=[{"path": roles.FRONTEND, "evidence": example}])
        result = helper.record("codex", response)
        self.assertNotIn(CANARY, json.dumps(result))
        self.assertEqual(result["response"]["reviewed_paths"], [roles.FRONTEND])
        self.assertIn("PUBLIC_KEEP", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
