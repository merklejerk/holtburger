"""Check sandbox-probe product routing without installing applications or a desktop."""

import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from probe_flatpak_io import MIN_FILE_CHOOSER_PORTAL_VERSION, probe_3d_portal, probe_cli_tools


class FlatpakIoTests(unittest.TestCase):
    def test_cli_conversion_and_exports_use_its_own_explicit_filesystem_grants(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            inputs, outputs = root / "input 雪", root / "output with spaces"
            inputs.mkdir()
            outputs.mkdir()

            def run_tool(arguments, *, check):
                self.assertTrue(check)
                self.assertIn("io.github.merklejerk.holtburger-cli", arguments)
                self.assertIn(f"--filesystem={inputs}:ro", arguments)
                self.assertIn(f"--filesystem={outputs}:rw", arguments)
                if "--command=dat-tool" in arguments:
                    Path(arguments[-1]).write_bytes(b"same authored palette")

            with patch("probe_flatpak_io.subprocess.run", side_effect=run_tool) as run:
                probe_cli_tools(inputs, outputs)
            commands = {argument for call in run.call_args_list for argument in call.args[0] if argument.startswith("--command=")}
            self.assertEqual(commands, {"--command=sh", "--command=dat2hba", "--command=dat-tool"})

    def test_3d_document_grant_is_read_in_the_alpha_app_sandbox_and_retired(self):
        with tempfile.TemporaryDirectory() as temporary:
            inputs = Path(temporary) / "input 雪"
            inputs.mkdir()
            portal = "/run/user/1000/doc/probe-document/input 雪"
            with patch("probe_flatpak_io.subprocess.check_output", side_effect=[
                json.dumps({"data": MIN_FILE_CHOOSER_PORTAL_VERSION}), portal,
            ]) as query, patch("probe_flatpak_io.subprocess.run") as run:
                probe_3d_portal(inputs)
            self.assertIn("--app=io.github.merklejerk.holtburger-alpha", query.call_args_list[1].args[0])
            self.assertIn("io.github.merklejerk.holtburger-alpha", run.call_args_list[0].args[0])
            self.assertIn("--command=sh", run.call_args_list[0].args[0])
            self.assertEqual(run.call_args_list[-1].args[0], ["flatpak", "document-unexport", "--doc-id", "probe-document"])


if __name__ == "__main__":
    unittest.main()
