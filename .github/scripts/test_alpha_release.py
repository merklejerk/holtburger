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
    record_suite_flatpak, suite_flatpak_manifest,
    record_tui_flatpak,
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
            hba_sha256 = hashlib.sha256(b"synthetic HBA").hexdigest()
            for target in TARGETS:
                archive = root / f"suite-{target.triple}.zip"
                archive.write_bytes(target.triple.encode())
                record = {
                    "commit": commit, "version": version, "modified": False,
                    "target": target.triple, "microSha256": digest(micro),
                    "microHbaSha256": hba_sha256,
                    "noticesSha256": digest(notices), "archive": archive.name,
                    "sha256": digest(archive),
                }
                (root / f"metadata-{target.triple}.json").write_text(json.dumps(record))
            for stem in ("holtburger-cli", "holtburger-alpha"):
                bundle = root / f"{stem}-{version}-x86_64.flatpak"
                bundle.write_bytes(stem.encode())
                record = {
                    "commit": commit, "version": version, "modified": False,
                    "target": next(target.triple for target in TARGETS if target.platform == "linux"),
                    "microSha256": digest(micro), "microHbaSha256": hba_sha256,
                    "noticesSha256": digest(notices), "appId": f"io.github.merklejerk.{stem}",
                    "archive": bundle.name, "sha256": digest(bundle),
                }
                (root / f"metadata-{stem}-flatpak.json").write_text(json.dumps(record))
            (root / ".github").mkdir()
            descriptor = root / ".github/alpha-content.json"
            descriptor.write_text(json.dumps({"sha256": digest(micro)}))
            with patch("alpha_release.source_identity", return_value=(commit, False)), \
                 patch("alpha_release.ROOT", root):
                files = manifest(root)
                self.assertIn(notices, files)
                self.assertIn("THIRD_PARTY_NOTICES.html", (root / "SHA256SUMS").read_text())
                full_suite = root / f"holtburger-alpha-{version}-x86_64.flatpak"
                self.assertIn(full_suite, files)
                self.assertEqual(len(files), 9)
                full_suite.write_bytes(b"substituted bundle")
                with self.assertRaisesRegex(ValueError, "Flatpak release archive mismatch"):
                    manifest(root)
                full_suite.unlink()
                with self.assertRaises(FileNotFoundError):
                    manifest(root)
                full_suite.write_bytes(b"holtburger-alpha")
                receipt = root / "metadata-holtburger-alpha-flatpak.json"
                record = json.loads(receipt.read_text())
                receipt.write_text(json.dumps({**record, "commit": "b" * 40}))
                with self.assertRaisesRegex(ValueError, "Flatpak release identity mismatch"):
                    manifest(root)
                receipt.write_text(json.dumps(record))
                notices.write_text("different notices")
                with self.assertRaisesRegex(ValueError, "Release identity mismatch"):
                    manifest(root)
                notices.write_text("original notices")
                (root / f"metadata-{TARGETS[-1].triple}.json").unlink()
                with self.assertRaises(FileNotFoundError):
                    manifest(root)


class SuiteFlatpakTests(unittest.TestCase):
    """A second package format must preserve the inspected candidate's identity and bytes."""

    def setUp(self):
        self.commit = "a" * 40
        self.info = {
            "commit": self.commit, "version": check_versions(), "modified": False,
            "target": next(target.triple for target in TARGETS if target.platform == "linux"),
        }

    def test_manifest_binds_the_inspected_suite_and_resolves_source_paths(self):
        recipe = {"modules": [{
            "name": "helper", "sources": [{"type": "patch", "path": "helper.patch"}],
        }, {
            "name": "holtburger-alpha", "build-commands": [],
            "sources": [{"type": "file", "path": "launcher"}],
        }]}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            suite, output = root / "inspected suite", root / "generated/manifest.json"
            with patch("alpha_release.verify_suite", return_value=self.info), \
                 patch("alpha_release.source_identity", return_value=(self.commit, False)), \
                 patch("alpha_release.run", return_value=json.dumps(recipe)):
                suite_flatpak_manifest(suite, output)
            modules = json.loads(output.read_text())["modules"]
            self.assertTrue(Path(modules[0]["sources"][0]["path"]).is_absolute())
            sources = modules[1]["sources"]
            self.assertTrue(Path(sources[0]["path"]).is_absolute())
            self.assertEqual(sources[-1], {"type": "dir", "path": str(suite.resolve()), "dest": "suite"})

    def test_wrong_commit_modified_input_and_wrong_platform_are_refused(self):
        for change in ({"commit": "b" * 40}, {"modified": True}, {"target": "other-target"}):
            with self.subTest(change=change), \
                 patch("alpha_release.verify_suite", return_value={**self.info, **change}), \
                 patch("alpha_release.source_identity", return_value=(self.commit, False)), \
                 patch("alpha_release.run") as command:
                with self.assertRaises(ValueError):
                    suite_flatpak_manifest(Path("suite"), Path("manifest.json"))
                command.assert_not_called()

    def test_changed_installed_executable_is_refused_even_with_matching_build_info(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            suite, files = root / "native", root / "files"
            installed = files / "lib/holtburger"
            suite.mkdir()
            installed.mkdir(parents=True)
            (suite / "executable").write_bytes(b"inspected native executable")
            (installed / "executable").write_bytes(b"changed executable")
            with patch("alpha_release.verify_suite", return_value=self.info), \
                 patch("alpha_release.source_identity", return_value=(self.commit, False)):
                with self.assertRaisesRegex(ValueError, "suite file differs"):
                    record_suite_flatpak(files, suite, root / "bundle", root / "receipt")


class TuiFlatpakTests(unittest.TestCase):
    """Installed TUI receipts must bind the binary and data, not just a bundle filename."""

    def test_installed_inputs_are_hashed_and_substitution_is_refused(self):
        commit = "a" * 40
        version = check_versions()
        recipe = {"id": "io.github.merklejerk.holtburger-cli",
                  "runtime": "org.example.Runtime", "runtime-version": "test"}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            files = root / "app/files"
            binary = files / "bin/holtburger-cli"
            binary.parent.mkdir(parents=True)
            elf = bytearray(64)
            elf[:6] = b"\x7fELF\x02\x01"
            struct.pack_into("<H", elf, 18, 62)
            binary.write_bytes(elf)
            micro = files / "share/holtburger/dats/assets.hba"
            micro.parent.mkdir(parents=True)
            micro.write_bytes(b"synthetic content")
            notices = files / "share/licenses/holtburger/THIRD_PARTY_NOTICES.html"
            notices.parent.mkdir(parents=True)
            notices.write_text("original notices")
            runtime = "org.example.Runtime/x86_64/test"
            (files.parent / "metadata").write_text(
                f"[Application]\nname={recipe['id']}\nruntime={runtime}\n"
            )
            info = {"commit": commit, "version": version, "modified": False,
                    "target": next(target.triple for target in TARGETS if target.platform == "linux"),
                    "binarySha256": digest(binary), "microHbaSha256": digest(micro),
                    "noticesSha256": digest(notices)}
            (files / "share/holtburger/build-info.json").write_text(json.dumps(info))
            bundle, output = root / "tui.flatpak", root / "receipt.json"
            bundle.write_bytes(b"test bundle")
            with patch("alpha_release.source_identity", return_value=(commit, False)), \
                 patch("alpha_release.run", return_value=json.dumps(recipe)):
                record_tui_flatpak(files, bundle, output)
                record = json.loads(output.read_text())
                self.assertEqual(record["sha256"], digest(bundle))
                self.assertEqual(record["runtime"], runtime)
                self.assertEqual(record["appId"], recipe["id"])
                micro.write_bytes(b"substituted content")
                with self.assertRaisesRegex(ValueError, "Installed TUI Flatpak input differs"):
                    record_tui_flatpak(files, bundle, output)


class DraftPublicationTests(unittest.TestCase):
    """Reruns must reuse matching bytes and must never modify a published release."""

    def test_created_draft_response_is_used_when_release_lists_remain_empty(self):
        commit = "a" * 40
        tag = "alpha-20261027-" + commit[:8]
        with tempfile.TemporaryDirectory() as temporary:
            artifact = Path(temporary) / "suite.zip"
            artifact.write_bytes(b"verified candidate")
            calls = []

            def github(*arguments):
                calls.append(arguments)
                if "--paginate" in arguments:
                    return ""
                if arguments[2].endswith("commits/" + tag):
                    return commit
                if arguments[:3] == ("gh", "api", "repos/merklejerk/holtburger/releases"):
                    self.assertIn("draft=true", arguments)
                    self.assertIn("prerelease=true", arguments)
                    return json.dumps({"draft": True, "target_commitish": commit,
                                       "assets": [], "html_url": "https://example.invalid/draft"})
                self.assertEqual(arguments[:3], ("gh", "release", "upload"))
                return ""

            with patch("alpha_release.manifest", return_value=[artifact]), \
                 patch("alpha_release.source_identity", return_value=(commit, False)), \
                 patch("alpha_release.run", side_effect=github):
                stage(Path(temporary), tag)
            self.assertEqual(sum("--paginate" in call for call in calls), 1)
            self.assertEqual(sum(call[:3] == ("gh", "release", "upload") for call in calls), 1)

    def test_remote_tag_for_another_commit_is_refused_before_creating_a_draft(self):
        commit = "a" * 40
        with patch("alpha_release.manifest", return_value=[]), \
             patch("alpha_release.source_identity", return_value=(commit, False)), \
             patch("alpha_release.run", side_effect=["", "b" * 40]) as command:
            with self.assertRaisesRegex(ValueError, "Remote alpha tag"):
                stage(Path("artifacts"), "alpha-20261027-" + commit[:8])
            self.assertEqual(command.call_count, 2)

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
