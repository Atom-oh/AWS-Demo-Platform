"""Behavioral tests for the subprocess boundary; no provider calls."""

import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import run_role
import role_review
import test_role_review as fixture


MODULE = Path(__file__).with_name("run_role.py")
START = {"type": "turn.started"}
DONE = {"type": "turn.completed", "usage": {
    "input_tokens": 1, "cached_input_tokens": 0, "output_tokens": 1,
}}


def message(text, ident="reply"):
    return {"type": "item.completed", "item": {
        "id": ident, "type": "agent_message", "text": text,
    }}


def stream(*events):
    return "\n".join(json.dumps(event) for event in events)


class RoleExecutionTests(unittest.TestCase):
    runner = run_role

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.final_file = self.root / "final.txt"
        self.final_file.write_text("{}\n")

    def executable(self, text):
        path = self.root / "fake-cli"
        path.write_text("#!/usr/bin/env python3\n" + text)
        path.chmod(0o755)
        return str(path)

    def test_stdout_cannot_override_exit_status(self):
        cli = self.executable("print('a plausible review'); raise SystemExit(7)\n")
        code, output, error = self.runner.execute([cli], self.root, os.environ.copy(), "", 2)
        self.assertEqual(code, 7)
        self.assertEqual(output.strip(), "a plausible review")

    def test_timeout_kills_uncooperative_child(self):
        cli = self.executable(
            "import signal,time\n"
            "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
            "print('partial output', flush=True)\ntime.sleep(30)\n"
        )
        code, output, error = self.runner.execute([cli], self.root, os.environ.copy(), "", 0.1)
        self.assertEqual(code, 124)
        self.assertIn("partial output", output)

    def test_kiro_environment_contains_no_cloud_or_repository_credentials(self):
        source = {
            "PATH": "/usr/bin", "KIRO_API_KEY": "test-key",
            "AWS_SECRET_ACCESS_KEY": "private", "GH_TOKEN": "private",
            "AWS_CONTAINER_CREDENTIALS_FULL_URI": "private",
        }
        result = self.runner.kiro_environment(self.root, source)
        self.assertEqual(result["KIRO_API_KEY"], "test-key")
        self.assertEqual(result["HOME"], str(self.root))
        self.assertFalse(any(k.startswith("AWS_") or k == "GH_TOKEN" for k in result))

    def test_preflight_rejects_quota_and_fallback(self):
        for message in (
            "Monthly request limit reached",
            "[warn] failed to set model: Method not found",
            "Falling back to user specified default",
        ):
            with self.subTest(message=message):
                cli = self.executable(
                    "import sys\nprint('NO_TOOLS')\n"
                    f"print({message!r}, file=sys.stderr)\n"
                )
                ok, code, error = self.runner.preflight(
                    cli, "claude-opus-5", self.root, os.environ.copy(), 2
                )
                self.assertFalse(ok)

    def test_preflight_catalog_and_no_pr_input(self):
        cli = self.executable(
            "import json,pathlib,sys\n"
            "agent=json.loads(pathlib.Path('.kiro/agents/inline-review.json').read_text())\n"
            "assert agent['tools']==[] and agent['allowedTools']==[]\n"
            "assert sys.stdin.read()==''\n"
            "assert '--agent' in sys.argv and '--v3' not in sys.argv\n"
            "assert 'preflight-canary.txt' in sys.argv[2]\n"
            "print('> NO_TOOLS')\n"
        )
        ok, code, error = self.runner.preflight(
            cli, "claude-opus-5", self.root, os.environ.copy(), 2
        )
        self.assertTrue(ok, error)
        self.assertEqual(code, 0)

    def test_codex_rejects_ambiguous_events(self):
        reply = message('{"review":"exact"}')
        for events in ([START, reply], [START, DONE],
                       [START, reply, {"type": "turn.failed", "error": {"message": "failed"}}],
                       [START, reply, DONE, reply],
                       [START, reply, START, DONE], [START, reply, DONE, "invalid"]):
            with self.subTest(events=events):
                raw = stream(*events)
                output, error, valid = self.runner.codex_response(raw, self.final_file)
                self.assertFalse(valid)
                self.assertEqual(output, "")

    def test_codex_uses_final_file_not_progress(self):
        raw = stream(START, message('{"first":true}\n', "first"),
                     message('{"second":true}\n', "second"), DONE)
        self.final_file.write_text('{"second":true}\n')
        output, error, valid = self.runner.codex_response(raw, self.final_file)
        self.assertTrue(valid, error)
        self.assertEqual(output, '{"second":true}\n')
        self.assertEqual(error, "")

    def test_codex_retains_recovered_error(self):
        raw = stream(START,
            {"type": "error", "message": "Reconnecting... stream disconnected before completion"},
            message('{"review":"complete"}'), DONE)
        self.final_file.write_text('{"review":"complete"}\n')
        output, error, valid = self.runner.codex_response(raw, self.final_file)
        self.assertTrue(valid, error)
        self.assertEqual(output, '{"review":"complete"}\n')
        self.assertIn("Reconnecting", error)

    def test_controls_preserve_json_and_utf8(self):
        plain = json.dumps({
            "path": "fixtures/이한-password=abcdefghijklmnop.txt",
            "value": "escaped control \x1b and newline\n",
            "token": "ghp_" + "A" * 36,
        }, ensure_ascii=False) + "\n"
        for prefix, suffix in (
            ("\x1b[32m", "\x1b[0m"),
            ("\x9b32m", "\x9b0m"),
            ("\x1b]8;;https://example.invalid\x07", "\x1b]8;;\x07"),
        ):
            with self.subTest(prefix=repr(prefix)):
                result = subprocess.run(
                    ["bash", "-c", 'source "$1" && strip_ansi', "control-test",
                     str(MODULE.with_name("role-controls.sh"))],
                    input=prefix + plain + suffix, capture_output=True, text=True,
                    timeout=5,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout), json.loads(plain))


class RoleRecordingTests(unittest.TestCase):
    def setUp(self):
        self.harness = fixture.RoleReviewTests()
        self.harness.setUp()
        self.addCleanup(self.harness.tearDown)
        self.path = "fixtures/password=abcdefghijklmnop.txt"
        self.harness.prepare(fixture.patch(self.path))
        self.private_value = "synthetic_private_response_value"
        response = self.harness.response("codex", findings=[{
            "severity": "MINOR", "path": self.path, "condition": "On change",
            "evidence": f"password={self.private_value}",
        }])
        self.original = json.dumps(response) + "\n"
        self.raw_paths = []
        self.recorded_bytes = []
        self.recorded_modes = []

    def fake_codex(self, command, cwd, environment, input_text, timeout):
        self.assertEqual(command[:2], ["codex", "exec"])
        final = Path(command[command.index("--output-last-message") + 1])
        final.write_bytes(self.original.encode("utf-8"))
        events = [
            {"type": "turn.started"},
            {"type": "item.completed", "item": {
                "type": "agent_message", "text": self.original,
            }},
            {"type": "turn.completed"},
        ]
        return (0, "\n".join(json.dumps(event) for event in events),
                "Fixture diagnostic password=synthetic_diagnostic_value")

    def run_recording(self, record_error=None, record_code=None, tag="codex", execute=None):
        real_run = subprocess.run

        def observe_record(command, **kwargs):
            if (len(command) > 2 and command[2] == "record"
                    and Path(command[1]).name == "role_review.py"):
                raw = Path(command[command.index("--output") + 1])
                self.raw_paths.append(raw)
                self.recorded_bytes.append(raw.read_bytes())
                self.recorded_modes.append(stat.S_IMODE(raw.stat().st_mode))
                if record_error is not None:
                    raise record_error
                if record_code is not None:
                    return subprocess.CompletedProcess(command, record_code)
            return real_run(command, **kwargs)

        with patch.object(run_role, "execute", side_effect=execute or self.fake_codex), \
                patch.object(run_role.subprocess, "run", side_effect=observe_record):
            run_role.run(self.harness.work, tag)

    def assert_private_response_removed(self):
        self.assertEqual(len(self.raw_paths), 1)
        self.assertFalse(self.raw_paths[0].exists())
        self.assertFalse(self.raw_paths[0].is_relative_to(self.harness.work))
        self.assertEqual(self.recorded_modes, [0o600])

    def test_record_preserves_valid_paths(self):
        self.run_recording()
        result = self.harness.read("slot/codex-result.json")
        self.assertTrue(result["valid"], result["failure_codes"])
        self.assertEqual(result["response"]["reviewed_paths"], [self.path])
        self.assertEqual(result["response"]["findings"][0]["path"], self.path)
        self.assertEqual(self.recorded_bytes, [self.original.encode("utf-8")])
        self.assertNotIn(self.private_value, json.dumps(result))
        error = (self.harness.work / "runtime/codex.err").read_text()
        self.assertNotIn("synthetic_diagnostic_value", error)
        self.assertIn("[REDACTED]", error)
        self.assertFalse((self.harness.work / "runtime/codex.txt").exists())
        self.assert_private_response_removed()

    def test_private_response_is_removed_when_recording_raises(self):
        with self.assertRaisesRegex(OSError, "synthetic recording failure"):
            self.run_recording(record_error=OSError("synthetic recording failure"))
        self.assert_private_response_removed()

    def test_record_error_removes_private_file(self):
        with self.assertRaisesRegex(RuntimeError, "recording failed"):
            self.run_recording(record_code=7)
        self.assert_private_response_removed()

    def test_colored_kiro_response_records_without_scrubbing_valid_paths(self):
        self.path = "fixtures/이한-password=abcdefghijklmnop.txt"
        self.harness.prepare(fixture.patch(self.path))
        report = self.harness.response("kiro-sol", findings=[{
            "severity": "MINOR", "path": self.path, "condition": "On change",
            "evidence": f"password={self.private_value}",
        }], checks=[{"path": self.path, "evidence": "이한 escaped control \x1b"}])
        payload = json.dumps(report, ensure_ascii=False) + "\n"
        calls = []

        def kiro(command, cwd, environment, input_text, timeout):
            self.assertEqual(command[1], "chat")
            calls.append(command)
            if "preflight-canary.txt" in command[2]:
                return 0, "\x1b[32m> NO_TOOLS\x1b[0m\n", ""
            return 0, "\x1b[32m> \x1b[0m" + payload + "\x1b[0m", ""

        self.run_recording(tag="kiro-sol", execute=kiro)
        result = self.harness.read("slot/kiro-sol-result.json")
        self.assertEqual(len(calls), 2)
        self.assertTrue(result["valid"], result["failure_codes"])
        self.assertEqual(result["response"]["reviewed_paths"], [self.path])
        self.assertEqual(role_review.parse_response(self.recorded_bytes[0].decode()), report)
        self.assertNotIn(self.private_value, json.dumps(result))
        self.assert_private_response_removed()

    def test_claude_stdout_quota_blocks_retry(self):
        calls = []
        def execute(command, *arguments):
            calls.append(command)
            if len(calls) == 1:
                return 1, "Error: insufficient credits\n", ""
            return 0, json.dumps(self.harness.response("claude-self")), ""
        self.run_recording(tag="claude-self", execute=execute)
        result = self.harness.read("slot/claude-self-result.json")
        self.assertEqual(len(calls), 1)
        self.assertFalse(result["valid"])
        self.assertIn("quota_diagnostic", result["failure_codes"])
        self.assert_private_response_removed()

    def test_kiro_stdout_quota_is_retained(self):
        calls = []
        def execute(command, *arguments):
            calls.append(command)
            if "preflight-canary.txt" in command[2]:
                return 0, "NO_TOOLS\n", ""
            return 0, "\x1b[32m> UsageLimitReachedError\x1b[0m\n", ""
        self.run_recording(tag="kiro-sol", execute=execute)
        result = self.harness.read("slot/kiro-sol-result.json")
        self.assertEqual(len(calls), 2)
        self.assertFalse(result["valid"])
        self.assertIn("quota_diagnostic", result["failure_codes"])
        self.assert_private_response_removed()

    def test_json_quota_text_is_not_an_error(self):
        response = self.harness.response("claude-self", checks=[{
            "path": self.path, "evidence": "Checked MONTHLY_REQUEST_COUNT handling."
        }])
        self.run_recording(tag="claude-self", execute=lambda *args: (
            0, json.dumps(response), "",
        ))
        result = self.harness.read("slot/claude-self-result.json")
        self.assertTrue(result["valid"], result["failure_codes"])
        self.assert_private_response_removed()


if __name__ == "__main__":
    unittest.main()
