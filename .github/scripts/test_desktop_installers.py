"""Check installer origin and inventory contracts with generated, asset-free payloads."""

import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from candidate_release import digest, target_named, verify_host_origin, verify_payload
from desktop_installers import dmg_documents, dmg_layout, numeric_version, verify_dmg


class InstallerContracts(unittest.TestCase):
    """The same verified payload must survive each platform's different delivery layout."""
    def test_installer_numeric_version_preserves_semver_display_separately(self):
        self.assertEqual(numeric_version("1.2.3-alpha.4"), "1.2.3.0")
        self.assertEqual(numeric_version("0.2.0"), "0.2.0.0")
        with self.assertRaisesRegex(ValueError, "resource limits"):
            numeric_version("65536.0.0")
        with self.assertRaisesRegex(ValueError, "Invalid suite SemVer"):
            numeric_version("1.2")

    def test_mac_origin_accepts_signed_changes_but_rejects_wrong_source_or_final_host(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "cargo-host"
            host = root / "h3d/holtburger-3d.app/Contents/Resources/holtburger-3d-host"
            host.parent.mkdir(parents=True)
            source.write_bytes(b"unsigned build")
            host.write_bytes(b"signed build")
            record = {"sourceHostSha256": digest(source), "packagedHostSha256": digest(host)}
            receipt = host.parent / "host-provenance.json"
            receipt.write_text(json.dumps(record))
            target = target_named("aarch64-apple-darwin")
            verify_host_origin(root, source, target)
            source.write_bytes(b"wrong build")
            with self.assertRaisesRegex(ValueError, "different Cargo host"):
                verify_host_origin(root, source, target)
            source.write_bytes(b"unsigned build")
            host.write_bytes(b"changed after signing")
            with self.assertRaisesRegex(ValueError, "different packaged host"):
                verify_host_origin(root, source, target)

    def test_owned_inventory_rejects_stale_files_changed_bytes_and_replaced_links(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            native, installed = root / "native", root / "installed"
            native.mkdir()
            (native / "program").write_bytes(b"program")
            (native / "current").symlink_to("program")
            shutil.copytree(native, installed, symlinks=True)
            verify_payload(native, installed)
            (installed / "obsolete").write_text("old")
            with self.assertRaisesRegex(ValueError, "inventory differs"):
                verify_payload(native, installed)
            (installed / "obsolete").unlink()
            (installed / "program").write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "file differs"):
                verify_payload(native, installed)
            (installed / "program").write_bytes(b"program")
            (installed / "current").unlink()
            (installed / "current").write_bytes(b"program")
            with self.assertRaisesRegex(ValueError, "link differs"):
                verify_payload(native, installed)

    def test_dmg_keeps_provenance_documents_and_refuses_payload_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            native, staging = root / "native", root / "dmg"
            app = native / "h3d/holtburger-3d.app"
            (app / "Contents/Resources").mkdir(parents=True)
            (app / "program").write_bytes(b"signed bytes")
            (app / "Contents/Resources/host-provenance.json").write_text("receipt")
            (native / "THIRD_PARTY_NOTICES.html").write_text("notices")
            (native / "h3d/version").write_text("electron version")
            (native / "version").write_text("conflicting document")
            with self.assertRaisesRegex(ValueError, "names collide"):
                dmg_documents(native)
            (native / "version").unlink()
            (native / "h3d/unexpected directory").mkdir()
            with self.assertRaisesRegex(ValueError, "regular files"):
                dmg_documents(native)
            (native / "h3d/unexpected directory").rmdir()
            staging.mkdir()
            dmg_layout(native, staging)
            self.assertEqual((staging / "Applications").readlink(), Path("/Applications"))
            self.assertEqual((staging / "holtburger-3d.app/Contents/Resources/host-provenance.json").read_text(), "receipt")
            self.assertEqual((staging / "version").read_text(), "electron version")
            installed = root / "installed"
            # Substitute only native OS commands; compare the complete copied inventory.
            def ditto(command, **_kwargs):
                shutil.copytree(command[1], command[2], symlinks=True)
            with patch("desktop_installers.subprocess.run", side_effect=ditto), patch("desktop_installers.verify_bundle"):
                verify_dmg(native, staging, installed)
            verify_payload(native, installed)
            (staging / "holtburger-3d.app/program").write_bytes(b"substituted")
            with self.assertRaisesRegex(ValueError, "file differs"):
                verify_dmg(native, staging, root / "installed")


if __name__ == "__main__":
    unittest.main()
