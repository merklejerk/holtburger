"""Exercise native archive contracts and release refusal paths with temporary synthetic inputs."""

import hashlib
import io
import json
from pathlib import Path
import stat
import struct
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from alpha_release import (
    TARGETS, archive_suite, digest, executable_architecture, extract_suite,
    manifest, stage, validate_tag,
)
from fetch_alpha_content import unpack_micro
from release_version import check_versions, validate_version


class NativeArchiveTests(unittest.TestCase):
    """Synthetic headers and links catch mislabeled and flattened native packages."""

    def test_native_architecture_uses_the_executable_header(self):
        elf = bytearray(64)
        elf[:6] = b"\x7fELF\x02\x01"
        struct.pack_into("<H", elf, 18, 62)
        pe = bytearray(70)
        pe[:2] = b"MZ"
        struct.pack_into("<I", pe, 60, 64)
        pe[64:68] = b"PE\0\0"
        struct.pack_into("<H", pe, 68, 0x8664)
        macho = b"\xcf\xfa\xed\xfe" + struct.pack("<I", 0x0100000C) + bytes(56)
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "misleading-arm64-name"
            for data, expected in ((elf, "x64"), (pe, "x64"), (macho, "arm64")):
                path.write_bytes(data)
                self.assertEqual(executable_architecture(path), expected)
            path.write_bytes(bytes(64))
            with self.assertRaisesRegex(ValueError, "Unsupported native executable format"):
                executable_architecture(path)

    def test_zip_encodes_framework_links_instead_of_copying_targets(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            suite = root / "suite"
            (suite / "Versions/A").mkdir(parents=True)
            (suite / "Versions/A/library").write_bytes(b"library")
            (suite / "Versions/Current").symlink_to("A", target_is_directory=True)
            destination = root / "suite.zip"
            target = next(target for target in TARGETS if target.platform == "darwin")
            archive_suite(suite, destination, target)
            with zipfile.ZipFile(destination) as archive:
                entry = archive.getinfo("suite/Versions/Current")
                self.assertTrue(stat.S_ISLNK(entry.external_attr >> 16))
                self.assertEqual(archive.read(entry), b"A")

    def test_tar_round_trip_preserves_executable_mode(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            suite = root / "suite"
            suite.mkdir()
            executable = suite / "client"
            executable.write_bytes(b"native executable")
            executable.chmod(0o755)
            archive = root / "suite.tar.gz"
            target = next(target for target in TARGETS if target.platform == "linux")
            archive_suite(suite, archive, target)
            extracted = root / "extracted"
            extracted.mkdir()
            result = extract_suite(archive, extracted)
            self.assertTrue((result / "client").stat().st_mode & stat.S_IXUSR)


class MicroInputTests(unittest.TestCase):
    """Verify archive integrity before any content reaches a staging directory."""

    @staticmethod
    def archive(entries: dict[str, bytes]) -> bytes:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            for name, payload in entries.items():
                archive.writestr(name, payload)
        return buffer.getvalue()

    def test_digest_mismatch_does_not_extract(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "content"
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                unpack_micro(b"untrusted", "0" * 64, output)
            self.assertFalse(output.exists())

    def test_zip_paths_are_not_used_as_extraction_destinations(self):
        data = self.archive({"../assets.hba": b"HBA\0"})
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(ValueError, "exactly assets.hba"):
                unpack_micro(data, hashlib.sha256(data).hexdigest(), Path(temporary) / "content")

    def test_verified_payload_and_original_zip_are_retained(self):
        payload = b"HBA\0" + bytes(20)
        data = self.archive({"assets.hba": payload})
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "content"
            unpack_micro(data, hashlib.sha256(data).hexdigest(), output)
            self.assertEqual((output / "assets.hba").read_bytes(), payload)
            self.assertEqual((output / "micro-hba.zip").read_bytes(), data)


class ReleaseVersionTests(unittest.TestCase):
    """Check consistency and tag ownership without invoking package-manager mutations."""

    def test_semver_and_tag_namespaces(self):
        validate_version("0.1.0-alpha.1")
        with self.assertRaisesRegex(ValueError, "leading zeros"):
            validate_version("0.1.0-alpha.01")
        with self.assertRaisesRegex(ValueError, "Invalid suite SemVer"):
            validate_version("alpha-20261026")
        commit = "a" * 40
        validate_tag("alpha-20261026-" + commit[:8], commit)
        with self.assertRaisesRegex(ValueError, "Alpha tag must"):
            validate_tag("v0.1.0-alpha.1", commit)
        with self.assertRaisesRegex(ValueError, "does not match"):
            validate_tag("alpha-20261026-" + "b" * 8, commit)

    def test_checker_detects_a_manifest_lockfile_disagreement(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "member").mkdir()
            (root / "Cargo.toml").write_text(
                '[workspace]\nmembers = ["member"]\n[workspace.package]\nversion = "0.1.0-alpha.1"\n'
            )
            (root / "member/Cargo.toml").write_text(
                '[package]\nname = "member"\nversion.workspace = true\n'
            )
            (root / "Cargo.lock").write_text(
                '[[package]]\nname = "member"\nversion = "0.1.0-alpha.1"\n'
            )
            app = root / "apps/holtburger-3d"
            app.mkdir(parents=True)
            (app / "package.json").write_text(json.dumps({"version": "0.1.0-alpha.1"}))
            lock = {"version": "0.1.0-alpha.1", "packages": {"": {"version": "0.1.0-alpha.1"}}}
            (app / "package-lock.json").write_text(json.dumps(lock))
            self.assertEqual(check_versions(root), "0.1.0-alpha.1")
            lock["packages"][""]["version"] = "0.1.0"
            (app / "package-lock.json").write_text(json.dumps(lock))
            with self.assertRaisesRegex(ValueError, "package-lock.json root package"):
                check_versions(root)


class ReleaseManifestTests(unittest.TestCase):
    """Aggregate metadata must describe one complete candidate, including shared notices."""

    def test_complete_matrix_and_shared_notices_are_required(self):
        version = check_versions()
        commit = "a" * 40
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            micro = root / f"holtburger-micro-{version}.zip"
            micro.write_bytes(b"synthetic micro")
            notices = root / "THIRD_PARTY_NOTICES.html"
            notices.write_text("original notices")
            (root / f"holtburger-cli-{version}-x86_64.flatpak").write_bytes(b"flatpak")
            for target in TARGETS:
                archive = root / f"suite-{target.triple}.zip"
                archive.write_bytes(target.triple.encode())
                record = {
                    "commit": commit, "version": version, "modified": False,
                    "target": target.triple, "microSha256": digest(micro),
                    "noticesSha256": digest(notices), "archive": archive.name,
                    "sha256": digest(archive),
                }
                (root / f"metadata-{target.triple}.json").write_text(json.dumps(record))
            (root / ".github").mkdir()
            descriptor = root / ".github/alpha-content.json"
            descriptor.write_text(json.dumps({"sha256": digest(micro)}))
            with patch("alpha_release.source_identity", return_value=(commit, False)), \
                 patch("alpha_release.ROOT", root):
                files = manifest(root)
                self.assertIn(notices, files)
                self.assertIn("THIRD_PARTY_NOTICES.html", (root / "SHA256SUMS").read_text())
                notices.write_text("different notices")
                with self.assertRaisesRegex(ValueError, "Release identity mismatch"):
                    manifest(root)
                notices.write_text("original notices")
                (root / f"metadata-{TARGETS[-1].triple}.json").unlink()
                with self.assertRaises(FileNotFoundError):
                    manifest(root)


class DraftPublicationTests(unittest.TestCase):
    """Reruns must reuse matching bytes and must never modify a published release."""

    def test_existing_matching_asset_is_reused_and_only_missing_asset_is_uploaded(self):
        commit = "a" * 40
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            existing = root / "existing.zip"
            missing = root / "missing.zip"
            existing.write_bytes(b"already staged")
            missing.write_bytes(b"newly staged")
            release = {
                "draft": True, "target_commitish": commit, "html_url": "https://example.invalid/draft",
                "assets": [{"name": existing.name, "digest": "sha256:" + hashlib.sha256(existing.read_bytes()).hexdigest()}],
            }
            calls = []

            def github(*arguments):
                calls.append(arguments)
                if arguments[:2] == ("gh", "api"):
                    return json.dumps(release)
                self.assertEqual(arguments[:3], ("gh", "release", "upload"))
                return ""

            with patch("alpha_release.manifest", return_value=[existing, missing]), \
                 patch("alpha_release.source_identity", return_value=(commit, False)), \
                 patch("alpha_release.run", side_effect=github):
                stage(root, "alpha-20261026-" + commit[:8])
            uploads = [call for call in calls if call[:3] == ("gh", "release", "upload")]
            self.assertEqual(len(uploads), 1)
            self.assertIn(str(missing), uploads[0])
            self.assertNotIn("--clobber", uploads[0])

    def test_published_release_and_conflicting_draft_are_refused_before_upload(self):
        commit = "a" * 40
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            artifact = root / "suite.zip"
            artifact.write_bytes(b"verified candidate")
            for draft, asset_digest, diagnostic in (
                (False, None, "published release"),
                (True, "sha256:" + "0" * 64, "conflicts with verified candidate"),
            ):
                release = {
                    "draft": draft, "target_commitish": commit,
                    "assets": [{"name": artifact.name, "digest": asset_digest}],
                }
                with patch("alpha_release.manifest", return_value=[artifact]), \
                     patch("alpha_release.source_identity", return_value=(commit, False)), \
                     patch("alpha_release.run", return_value=json.dumps(release)) as github:
                    with self.assertRaisesRegex(ValueError, diagnostic):
                        stage(root, "alpha-20261026-" + commit[:8])
                    self.assertEqual(github.call_count, 1)


if __name__ == "__main__":
    unittest.main()
