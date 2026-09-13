"""Check producer packaging and the real launcher; never invoke Kiro."""
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[2]
LAUNCHER = ROOT / "k8s/system/actions-runner/ohmy-kiro-cli.sh"
VENDOR = "/home/runner/.local/bin/kiro-cli"
STDOUT = b"vendor stdout\x00bytes\n"
STDERR = b"vendor stderr\n"
STDIN = b"opaque stdin\x00with\nmultiple lines\n"
WORKING_NAMES = ("argv", "legacy", "headless", "explicit_engine", "option_end", "index")


class KiroCompat(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="ohmy-kiro-compat-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.cwd = self.root / "task directory"
        self.cwd.mkdir()
        self.vendor = self.root / "vendor-fixture"
        self.vendor.write_text(
            f"#!{sys.executable}\n"
            "import json, os, pathlib, signal, sys\n"
            "root = pathlib.Path(os.environ['FIXTURE_ROOT'])\n"
            "(root / 'invocation.json').write_text(json.dumps({\n"
            " 'argv': sys.argv[1:], 'cwd': os.getcwd(), 'pid': os.getpid(),\n"
            " 'opaque_env': os.environ.get('OPAQUE_FIXTURE'), 'path': os.environ['PATH'],\n"
            f" 'working_names': {{name: os.environ.get(name) for name in {WORKING_NAMES!r}}}}}))\n"
            "(root / 'stdin.bin').write_bytes(sys.stdin.buffer.read())\n"
            f"sys.stdout.buffer.write({STDOUT!r}); sys.stdout.buffer.flush()\n"
            f"sys.stderr.buffer.write({STDERR!r}); sys.stderr.buffer.flush()\n"
            "if os.environ.get('FIXTURE_SIGNAL'):\n"
            " os.kill(os.getpid(), int(os.environ['FIXTURE_SIGNAL']))\n"
            "sys.exit(int(os.environ.get('FIXTURE_EXIT', '0')))\n"
        )
        self.vendor.chmod(0o755)
        # Intercept only the final exec boundary, without rewriting the launcher
        # or introducing a production override for its fixed vendor path.
        self.bash_env = self.root / "exec-boundary.sh"
        self.bash_env.write_text(
            "exec() {\n"
            f"  [[ $1 == {VENDOR} ]] || return 98\n"
            "  shift\n"
            '  builtin exec "$FIXTURE_VENDOR" "$@"\n'
            "}\n"
        )

    def invoke(self, args, *, status=0, termination=None, extra_env=None):
        self.assertTrue(LAUNCHER.is_file(), "The scoped compatibility launcher is missing")
        env = {
            "PATH": "/usr/bin:/bin",
            "HOME": str(self.root),
            "BASH_ENV": str(self.bash_env),
            "FIXTURE_ROOT": str(self.root),
            "FIXTURE_VENDOR": str(self.vendor),
            "FIXTURE_EXIT": str(status),
            "OPAQUE_FIXTURE": "unchanged value with spaces\nand a newline",
        }
        if termination:
            env["FIXTURE_SIGNAL"] = str(int(termination))
        env.update(extra_env or {})
        child = subprocess.Popen(
            ["/bin/bash", str(LAUNCHER), *args], cwd=self.cwd, env=env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        stdout, stderr = child.communicate(STDIN, timeout=5)
        self.assertEqual(child.returncode, -termination if termination else status)
        self.assertEqual(stdout, STDOUT)
        self.assertEqual(stderr, STDERR, "The launcher must not log prompts or argv")
        recorded = json.loads((self.root / "invocation.json").read_text())
        self.assertEqual(recorded["pid"], child.pid, "The launcher must exec the vendor")
        self.assertEqual(recorded["cwd"], str(self.cwd))
        self.assertEqual(recorded["opaque_env"], env["OPAQUE_FIXTURE"])
        self.assertEqual(recorded["path"], env["PATH"])
        self.assertEqual(recorded["working_names"], {name: env.get(name) for name in WORKING_NAMES})
        self.assertEqual((self.root / "stdin.bin").read_bytes(), STDIN)
        return recorded["argv"]

    def test_injects_only_for_legacy_noninteractive_chat(self):
        for args in [
            ["chat", "prompt", "--legacy-ui", "--no-interactive"],
            ["chat", "--no-interactive", "prompt", "--classic"],
            ["chat", "prompt", "--legacy-ui", "--classic", "--no-interactive",
             "--model", "fixture-model", "--agent", "pr-review-notools"],
        ]:
            with self.subTest(args=args):
                self.assertEqual(self.invoke(args), args + ["--agent-engine", "v1"])

    def test_other_invocations_pass_through(self):
        for args in [
            [], ["--version"], ["chat", "--help"], ["settings", "chat.agentEngine"],
            ["agent", "validate", "--legacy-ui", "--no-interactive"],
            ["chat", "prompt", "--legacy-ui"], ["chat", "prompt", "--no-interactive"],
            ["chat", "--legacy-ui=true", "--no-interactive"],
            ["chat", "--legacy-ui", "--no-interactive=true"],
            ["--verbose", "chat", "prompt", "--legacy-ui", "--no-interactive"],
            ["chat", "prompt says --legacy-ui and --no-interactive"],
        ]:
            with self.subTest(args=args):
                self.assertEqual(self.invoke(args), args)

    def test_explicit_engine_selection_is_never_changed(self):
        for selection in [
            ["--agent-engine", "v1"], ["--agent-engine", "v2"],
            ["--agent-engine", "v3"], ["--agent-engine=v1"],
            ["--agent-engine=v2"], ["--agent-engine=v3"],
            ["--agent-engine="], ["--agent-engine"], ["--v1"], ["--v2"], ["--v3"],
        ]:
            args = ["chat", "prompt", "--legacy-ui", "--no-interactive", *selection]
            with self.subTest(selection=selection):
                self.assertEqual(self.invoke(args), args)

    def test_delimiter_stops_option_detection_and_is_preserved(self):
        for args, expected in [
            (["chat", "--", "--legacy-ui", "--no-interactive"],
             ["chat", "--", "--legacy-ui", "--no-interactive"]),
            (["chat", "--legacy-ui", "--", "--no-interactive"],
             ["chat", "--legacy-ui", "--", "--no-interactive"]),
            (["chat", "--legacy-ui", "--no-interactive", "--", "--agent-engine", "v2", ""],
             ["chat", "--legacy-ui", "--no-interactive", "--agent-engine", "v1",
              "--", "--agent-engine", "v2", ""]),
            (["chat", "--classic", "--no-interactive", "--v3", "--", "prompt"],
             ["chat", "--classic", "--no-interactive", "--v3", "--", "prompt"]),
        ]:
            with self.subTest(args=args):
                self.assertEqual(self.invoke(args), expected)

    def test_hostile_prompt_and_arguments_remain_opaque(self):
        marker = self.root / "must-not-exist"
        prompt = f'$(touch "{marker}") `touch "{marker}"`; echo leaked >&2\n--agent-engine v3'
        args = ["chat", prompt, "--model", "model with spaces", "--legacy-ui",
                "--no-interactive", "", "한글\nsecond line", "*", "'quoted'"]
        self.assertEqual(self.invoke(args), args + ["--agent-engine", "v1"])
        self.assertFalse(marker.exists())

    def test_exit_streams_cwd_and_environment_survive_both_paths(self):
        for flags in [[], ["--legacy-ui", "--no-interactive"]]:
            for status in [0, 7, 64, 255]:
                args = ["chat", "prompt", *flags]
                expected = args + ["--agent-engine", "v1"] if flags else args
                with self.subTest(flags=flags, status=status):
                    self.assertEqual(self.invoke(args, status=status), expected)

    def test_vendor_signal_is_not_hidden_by_a_waiting_shell(self):
        self.assertEqual(self.invoke(["--version"], termination=signal.SIGTERM), ["--version"])

    def test_exported_caller_variables_cannot_be_replaced_by_parser_state(self):
        exported = {name: f"caller value for {name}" for name in WORKING_NAMES}
        args = ["chat", "prompt", "--legacy-ui", "--no-interactive"]
        self.assertEqual(self.invoke(args, extra_env=exported), args + ["--agent-engine", "v1"])


class ProducerPackaging(unittest.TestCase):
    def test_generator_pins_one_immutable_launcher_revision(self):
        config = yaml.safe_load(
            (ROOT / "k8s/system/actions-runner/kustomization.yaml").read_text()
        )
        mapping = "kiro-cli=ohmy-kiro-cli.sh"
        generators = [
            item for item in config.get("configMapGenerator", [])
            if mapping in item.get("files", [])
        ]
        self.assertEqual(len(generators), 1, "Exactly one generator must package the current launcher")
        generator = generators[0]
        digest = hashlib.sha256(LAUNCHER.read_bytes()).hexdigest()
        self.assertEqual(generator["name"], f"demo-platform-ohmy-kiro-compat-{digest[:12]}")
        self.assertEqual(generator["files"], [mapping])
        for other_source in ("literals", "envs", "env"):
            self.assertFalse(generator.get(other_source), "The launcher must be the only data source")
        self.assertIs(generator["options"].get("immutable"), True)
        self.assertIs(generator["options"].get("disableNameSuffixHash"), True)


if __name__ == "__main__":
    unittest.main()
