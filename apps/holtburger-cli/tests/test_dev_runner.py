"""Exercise the dev wrapper's real child process without launching the interactive TUI."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]


@unittest.skipIf(os.name == "nt", "The convenience wrapper is POSIX; Windows uses documented environment setup")
class DevRunnerTests(unittest.TestCase):
    def launch(self, arguments, overrides):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            capture = directory / "capture.json"
            cargo = directory / "cargo"
            cargo.write_text(
                f"#!{sys.executable}\n"
                "import json, os, sys\n"
                "from pathlib import Path\n"
                "Path(os.environ['RUNNER_CAPTURE']).write_text(json.dumps({"
                "'args': sys.argv[1:], 'cwd': os.getcwd(), "
                "'content': os.environ['HOLTBURGER_DEFAULT_CONTENT'], "
                "'scripts': os.environ['SCRIPT_DIR'], 'bundle': os.environ['SCRIPT_BUNDLE_DIR']}))\n"
                "sys.exit(19)\n"
            )
            cargo.chmod(0o755)
            environment = {key: value for key, value in os.environ.items() if key not in {
                "HOLTBURGER_DEFAULT_CONTENT", "SCRIPT_DIR", "SCRIPT_BUNDLE_DIR",
            }}
            environment.update(overrides)
            environment.update(PATH=str(directory) + os.pathsep + environment["PATH"], RUNNER_CAPTURE=str(capture))
            result = subprocess.run([str(ROOT / "apps/holtburger-cli/dev.sh"), *arguments],
                                    cwd=directory, env=environment, check=False)
            self.assertEqual(result.returncode, 19)
            return json.loads(capture.read_text())

    def test_defaults_and_arguments_work_outside_the_workspace(self):
        captured = self.launch(["--content", "chosen directory", "-a", "example"], {})
        self.assertEqual(captured["content"], str(ROOT / "local/content"))
        self.assertEqual(captured["scripts"], str(ROOT / "local/scripts"))
        self.assertEqual(captured["bundle"], str(ROOT / "assets/scripts"))
        self.assertEqual(captured["args"], ["run", "--manifest-path", str(ROOT / "Cargo.toml"),
                         "-p", "holtburger-cli", "--bin", "tui", "--", "--content", "chosen directory", "-a", "example"])

    def test_release_profile_preserves_user_defaults(self):
        captured = self.launch(["--release", "--content", "explicit"], {
            "HOLTBURGER_DEFAULT_CONTENT": "configured", "SCRIPT_DIR": "writable", "SCRIPT_BUNDLE_DIR": "bundled",
        })
        self.assertEqual(captured["args"][:2], ["run", "--release"])
        self.assertEqual(captured["args"][-3:], ["--", "--content", "explicit"])
        self.assertEqual((captured["content"], captured["scripts"], captured["bundle"]),
                         ("configured", "writable", "bundled"))

    def test_empty_default_is_preserved_for_lazy_application_validation(self):
        captured = self.launch([], {"HOLTBURGER_DEFAULT_CONTENT": ""})
        self.assertEqual(captured["content"], "")


if __name__ == "__main__":
    unittest.main()
