"""Exercise native archive contracts and release refusal paths with temporary synthetic inputs."""

import hashlib
from contextlib import redirect_stdout
from argparse import Namespace
import io
import json
import os
from pathlib import Path
import stat
import shutil
import struct
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from alpha_release import (
    TARGETS, archive_bundle, digest, executable_architecture, extract_bundle,
    assemble, create_tag, manifest, plan, stage, validate_tag, verify_bundle,
    record_flatpak, flatpak_manifest,
    flatpak_runtime_ref, THREED_FLATPAK_RECIPE,
)
from cli_content_input import CONTENT_FILES, unpack_cli_content
from test_cli_content_input import archive as cli_archive, components as cli_components
from release_version import check_versions, validate_version
from alpha_changes import documentation_only


class ReleasePlanTests(unittest.TestCase):
    """Manual selections stay bounded; release tags retain the complete product/target contract."""

    def test_manual_selection_emits_only_the_requested_native_matrix(self):
        for product, target in (("both", "all"), ("cli", TARGETS[0].triple), ("3d", TARGETS[-1].triple)):
            with self.subTest(product=product, target=target), \
                 patch.dict("os.environ", {"GITHUB_REF_TYPE": "branch"}, clear=True), \
                 patch("alpha_release.source_identity", return_value=("a" * 40, False)):
                output = io.StringIO()
                with redirect_stdout(output):
                    plan(product, target, "diagnostic")
                result = json.loads(output.getvalue())
                selected = result["linux_matrix"]["include"] + result["desktop_matrix"]["include"]
                self.assertEqual(result["product"], product)
                self.assertEqual({entry["triple"] for entry in selected}, {entry.triple for entry in TARGETS if target == "all" or entry.triple == target})
                self.assertEqual(result["linux_enabled"], str(any(entry["platform"] == "linux" for entry in selected)).lower())
                self.assertEqual(result["desktop_enabled"], str(any(entry["platform"] != "linux" for entry in selected)).lower())

    def test_partial_release_tag_selection_is_refused(self):
        for product, target in (("cli", "all"), ("both", TARGETS[0].triple)):
            with self.subTest(product=product), \
                 patch.dict("os.environ", {"GITHUB_REF_TYPE": "tag", "GITHUB_REF_NAME": "alpha-20261028-aaaaaaaa"}, clear=True), \
                 patch("alpha_release.source_identity", return_value=("a" * 40, False)), \
                 patch("alpha_release.subprocess.run"):
                with self.assertRaisesRegex(ValueError, "both products and every supported native target"):
                    plan(product, target, "diagnostic")

    def test_diagnostic_dispatch_has_no_candidate_tag_or_release_ancestry_work(self):
        with (
            patch.dict(os.environ, {
                "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF_TYPE": "branch",
                "GITHUB_REF": "refs/heads/feature-navigation",
            }, clear=True),
            patch("alpha_release.source_identity", return_value=("a" * 40, False)),
            patch("alpha_release.run") as external,
            patch("alpha_release.subprocess.run") as ancestry,
            redirect_stdout(io.StringIO()) as output,
        ):
            plan("cli", TARGETS[0].triple, "diagnostic")
        result = json.loads(output.getvalue())
        self.assertEqual(result["tag"], "")
        self.assertEqual(result["product"], "cli")
        self.assertEqual(result["desktop_enabled"], "false")
        external.assert_not_called()
        ancestry.assert_not_called()

    def test_partial_manual_candidate_is_refused_before_deriving_or_creating_a_tag(self):
        for product, target in (("3d", "all"), ("both", TARGETS[0].triple)):
            with (
                self.subTest(product=product, target=target),
                patch.dict(os.environ, {
                    "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF_TYPE": "branch",
                    "GITHUB_REF": "refs/heads/3d-next",
                }, clear=True),
                patch("alpha_release.source_identity", return_value=("a" * 40, False)),
                patch("alpha_release.run") as external,
            ):
                with self.assertRaisesRegex(ValueError, "both products and every supported native target"):
                    plan(product, target, "candidate")
                external.assert_not_called()

    def test_shipped_product_quickstarts_are_build_inputs(self):
        self.assertTrue(documentation_only("docs/plans/investigation.md"))
        for path in ("docs/ALPHA_CLI_QUICKSTART.md", "docs/ALPHA_3D_QUICKSTART.md"):
            self.assertFalse(documentation_only(path))


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
            bundle = root / "bundle"
            (bundle / "Versions/A").mkdir(parents=True)
            (bundle / "Versions/A/library").write_bytes(b"library")
            (bundle / "Versions/Current").symlink_to("A", target_is_directory=True)
            destination = root / "bundle.zip"
            target = next(target for target in TARGETS if target.platform == "darwin")
            archive_bundle(bundle, destination, target)
            with zipfile.ZipFile(destination) as archive:
                entry = archive.getinfo("bundle/Versions/Current")
                self.assertTrue(stat.S_ISLNK(entry.external_attr >> 16))
                self.assertEqual(archive.read(entry), b"A")

    def test_tar_round_trip_preserves_executable_mode(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bundle = root / "bundle"
            bundle.mkdir()
            executable = bundle / "client"
            executable.write_bytes(b"native executable")
            executable.chmod(0o755)
            archive = root / "bundle.tar.gz"
            target = next(target for target in TARGETS if target.platform == "linux")
            archive_bundle(bundle, archive, target)
            extracted = root / "extracted"
            extracted.mkdir()
            result = extract_bundle(archive, extracted)
            self.assertTrue((result / "client").stat().st_mode & stat.S_IXUSR)


class NativeProductTests(unittest.TestCase):
    """Each assembler works with the other product's inputs completely absent."""

    def assemble_product(self, root: Path, product: str) -> Path:
        target = next(target for target in TARGETS if target.platform == "linux")
        version, commit = check_versions(), "a" * 40
        binaries = root / "target" / target.triple / "release"
        binaries.mkdir(parents=True)
        (root / "docs").mkdir()
        (root / f"docs/ALPHA_{product.upper()}_QUICKSTART.md").write_text("Product instructions")
        (root / "LICENSE.md").write_text("License")
        notices = root / "notices.html"
        notices.write_text("Notices")
        header = bytearray(64)
        header[:6] = b"\x7fELF\x02\x01"
        struct.pack_into("<H", header, 18, 62)

        def executable(path: Path):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(header)
            path.chmod(0o755)

        content, package = None, None
        descriptor = root / "cli-content.json"
        if product == "cli":
            for binary in ("tui", "dat2hba", "dat-tool"):
                executable(binaries / binary)
            (root / "scripts").mkdir()
            for name in ("fighter.js", "mage.js", "mage.data.json", "mage.data.bin"):
                (root / "scripts" / name).write_bytes(b"script or sidecar")
            data, checksum = cli_archive(cli_components())
            content = root / "staged-content"
            unpack_cli_content(data, checksum, content)
            descriptor.write_text(json.dumps({"sha256": checksum}))
        else:
            package = root / "electron"
            executable(binaries / "holtburger-3d-host")
            executable(package / "holtburger-3d")
            executable(package / "resources/holtburger-3d-host")
        args = Namespace(product=product, target=target.triple, content=content,
                         package=package, notices=notices, output=root / "output")
        with patch("alpha_release.ROOT", root), \
             patch("alpha_release.CLI_CONTENT_DESCRIPTOR", descriptor), \
             patch("alpha_release.sys.platform", "linux"), \
             patch("alpha_release.check_versions", return_value=version), \
             patch("alpha_release.source_identity", return_value=(commit, False)), \
             patch("alpha_release.inspect_linkage", return_value={}), \
             patch("alpha_release.run", return_value=json.dumps({"version": version, "revision": commit[:8], "modified": False})) as command:
            assemble(args)
            if product == "cli":
                command.assert_not_called()
            else:
                self.assertTrue(all(call.args[:2] == ("node", "scripts/verify-electron-package.mjs") for call in command.call_args_list))
            metadata = json.loads((args.output / f"metadata-{product}-{target.triple}.json").read_text())
            extracted = root / "extracted"
            extracted.mkdir()
            bundle = extract_bundle(args.output / metadata["archive"], extracted)
            self.assertEqual(verify_bundle(bundle)["product"], product)
        return bundle

    def test_cli_archive_has_complete_content_tools_and_scripts_without_electron(self):
        with tempfile.TemporaryDirectory() as temporary:
            bundle = self.assemble_product(Path(temporary), "cli")
            self.assertEqual({path.name for path in bundle.iterdir()}, {
                "holtburger-cli", "dat2hba", "dat-tool", "content", "scripts",
                "QUICKSTART.md", "LICENSE.md", "THIRD_PARTY_NOTICES.html", "build-info.json",
            })
            self.assertEqual({path.name for path in (bundle / "content").iterdir()}, set(CONTENT_FILES))
            info = json.loads((bundle / "build-info.json").read_text())
            self.assertEqual(set(info["contentFiles"]), set(CONTENT_FILES))
            (bundle / "content/bootstrap.hba").write_bytes(b"substituted")
            with self.assertRaisesRegex(ValueError, "CLI content digest mismatch"):
                verify_bundle(bundle)

    def test_3d_archive_contains_only_the_application_and_common_documents(self):
        with tempfile.TemporaryDirectory() as temporary:
            bundle = self.assemble_product(Path(temporary), "3d")
            self.assertEqual({path.name for path in bundle.iterdir()}, {
                "h3d", "QUICKSTART.md", "LICENSE.md", "THIRD_PARTY_NOTICES.html", "build-info.json",
            })
            info = json.loads((bundle / "build-info.json").read_text())
            self.assertEqual(info["product"], "3d")
            (bundle / "content").mkdir()
            with self.assertRaisesRegex(ValueError, "3d bundle root entries"):
                verify_bundle(bundle)


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


class CandidatePlanningTests(unittest.TestCase):
    """Manual candidates retain tag/source identity and rerun without moving tags."""

    def test_manual_plan_emits_one_tag_for_the_selected_source(self):
        commit = "a" * 40
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "outputs"
            with (
                patch.dict(os.environ, {
                    "GITHUB_EVENT_NAME": "workflow_dispatch",
                    "GITHUB_REF": "refs/heads/3d-next",
                    "GITHUB_OUTPUT": str(output),
                }, clear=True),
                patch("alpha_release.check_versions", return_value="0.1.0-alpha.4"),
                patch("alpha_release.source_identity", return_value=(commit, False)),
                patch("alpha_release.run", return_value="2026-10-27") as source_date,
                patch("alpha_release.subprocess.run") as ancestry,
                redirect_stdout(io.StringIO()) as stdout,
            ):
                plan("both", "all", "candidate")
            result = json.loads(stdout.getvalue())
            self.assertEqual(result["commit"], commit)
            self.assertEqual(result["tag"], f"alpha-20261027-{commit[:9]}")
            self.assertIn(f"tag={result['tag']}\n", output.read_text())
            source_date.assert_called_once_with("git", "show", "-s", "--format=%cs", commit)
            self.assertEqual(ancestry.call_args.args[0], [
                "git", "merge-base", "--is-ancestor", commit, "origin/3d-next",
            ])

    def test_manual_plan_rejects_another_branch_before_packaging(self):
        with (
            patch.dict(os.environ, {
                "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF": "refs/heads/main",
            }, clear=True),
            patch("alpha_release.check_versions", return_value="0.1.0-alpha.4"),
            patch("alpha_release.source_identity", return_value=("a" * 40, False)),
        ):
            with self.assertRaisesRegex(ValueError, "3d-next branch"):
                plan("both", "all", "candidate")

    def test_tag_plan_preserves_the_requested_tag(self):
        commit = "a" * 40
        tag = f"alpha-20261026-{commit[:8]}"
        with (
            patch.dict(os.environ, {"GITHUB_REF_TYPE": "tag", "GITHUB_REF_NAME": tag}, clear=True),
            patch("alpha_release.check_versions", return_value="0.1.0-alpha.4"),
            patch("alpha_release.source_identity", return_value=(commit, False)),
            patch("alpha_release.subprocess.run"),
            redirect_stdout(io.StringIO()) as stdout,
        ):
            plan("both", "all", "candidate")
        self.assertEqual(json.loads(stdout.getvalue())["tag"], tag)

    def test_tag_creation_ignores_longer_prefix_matches(self):
        commit = "a" * 40
        tag = f"alpha-20261027-{commit[:9]}"
        with (
            patch.dict(os.environ, {"GITHUB_REPOSITORY": "owner/repo"}),
            patch("alpha_release.source_identity", return_value=(commit, False)),
            patch("alpha_release.run", side_effect=[
                json.dumps([{"ref": f"refs/tags/{tag}0"}]), "{}",
            ]) as api,
            redirect_stdout(io.StringIO()),
        ):
            create_tag(tag)
        self.assertEqual(api.call_args.args, (
            "gh", "api", "repos/owner/repo/git/refs", "--method", "POST",
            "--raw-field", f"ref=refs/tags/{tag}", "--raw-field", f"sha={commit}",
        ))

    def test_tag_rerun_reuses_only_the_same_lightweight_source(self):
        commit = "a" * 40
        tag = f"alpha-20261027-{commit[:9]}"
        for kind, target in (("commit", commit), ("commit", "b" * 40), ("tag", "b" * 40)):
            with (
                self.subTest(kind=kind, target=target),
                patch.dict(os.environ, {"GITHUB_REPOSITORY": "owner/repo"}),
                patch("alpha_release.source_identity", return_value=(commit, False)),
                patch("alpha_release.run", return_value=json.dumps([{
                    "ref": f"refs/tags/{tag}", "object": {"type": kind, "sha": target},
                }])) as api,
                redirect_stdout(io.StringIO()),
            ):
                if kind == "commit" and target == commit:
                    create_tag(tag)
                else:
                    with self.assertRaisesRegex(ValueError, "does not identify"):
                        create_tag(tag)
                self.assertEqual(api.call_count, 1)


class ReleaseManifestTests(unittest.TestCase):
    """Aggregate metadata requires both products, shared source identity, and exact inputs."""

    def test_complete_products_targets_content_and_notices_are_required(self):
        version, commit = check_versions(), "a" * 40
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            notices = root / "THIRD_PARTY_NOTICES.html"
            notices.write_text("original notices")
            content = {"contentSha256": "c" * 64,
                       "contentFiles": {name: hashlib.sha256(name.encode()).hexdigest() for name in CONTENT_FILES}}
            identity = {"commit": commit, "version": version, "modified": False,
                        "noticesSha256": digest(notices)}
            for product in ("cli", "3d"):
                for target in TARGETS:
                    extension = ".tar.gz" if target.platform == "linux" else ".zip"
                    archive = root / f"holtburger-{product}-{version}-{target.triple}{extension}"
                    archive.write_bytes(f"{product}/{target.triple}".encode())
                    record = {**identity, "product": product, "target": target.triple,
                              "archive": archive.name, "sha256": digest(archive)}
                    if product == "cli":
                        record.update(content)
                    (root / f"metadata-{product}-{target.triple}.json").write_text(json.dumps(record))
                bundle = root / f"holtburger-{product}-{version}-x86_64.flatpak"
                bundle.write_bytes(product.encode())
                record = {**identity, "product": product,
                          "target": next(target.triple for target in TARGETS if target.platform == "linux"),
                          "appId": f"io.github.merklejerk.holtburger-{'cli' if product == 'cli' else 'alpha'}",
                          "archive": bundle.name, "sha256": digest(bundle),
                          "runtime": flatpak_runtime_ref(json.loads(THREED_FLATPAK_RECIPE.read_text()))}
                if product == "cli":
                    record.update(content)
                (root / f"metadata-{product}-flatpak.json").write_text(json.dumps(record))
            descriptor = root / "cli-content.json"
            descriptor.write_text(json.dumps({"sha256": content["contentSha256"]}))
            with patch("alpha_release.source_identity", return_value=(commit, False)), \
                 patch("alpha_release.CLI_CONTENT_DESCRIPTOR", descriptor):
                files = manifest(root)
                expected_downloads = {notices.name, "release-manifest.json", "SHA256SUMS"}
                expected_downloads.update(record["archive"] for record in json.loads((root / "release-manifest.json").read_text())["native"])
                expected_downloads.update(f"holtburger-{product}-{version}-x86_64.flatpak" for product in ("cli", "3d"))
                self.assertEqual({path.name for path in files}, expected_downloads)
                self.assertIn("THIRD_PARTY_NOTICES.html", (root / "SHA256SUMS").read_text())
                threed = root / f"holtburger-3d-{version}-x86_64.flatpak"
                threed.write_bytes(b"substituted bundle")
                with self.assertRaisesRegex(ValueError, "Flatpak release archive mismatch"):
                    manifest(root)
                threed.unlink()
                with self.assertRaises(FileNotFoundError):
                    manifest(root)
                threed.write_bytes(b"3d")
                receipt = root / "metadata-3d-flatpak.json"
                record = json.loads(receipt.read_text())
                for change in ({"commit": "b" * 40}, {"runtime": "org.example.Other/x86_64/test"},
                               {"appId": "io.github.merklejerk.holtburger-3d"}):
                    receipt.write_text(json.dumps({**record, **change}))
                    with self.subTest(change=change), self.assertRaisesRegex(ValueError, "Flatpak release identity mismatch"):
                        manifest(root)
                receipt.write_text(json.dumps(record))
                cli_receipt = root / f"metadata-cli-{TARGETS[-1].triple}.json"
                cli_record = json.loads(cli_receipt.read_text())
                cli_receipt.write_text(json.dumps({**cli_record, "contentFiles": {**content["contentFiles"], "navigation.hnav": "d" * 64}}))
                with self.assertRaisesRegex(ValueError, "different content companions"):
                    manifest(root)
                cli_receipt.write_text(json.dumps(cli_record))
                notices.write_text("different notices")
                with self.assertRaisesRegex(ValueError, "Release identity mismatch"):
                    manifest(root)
                notices.write_text("original notices")
                (root / f"metadata-3d-{TARGETS[-1].triple}.json").unlink()
                with self.assertRaises(FileNotFoundError):
                    manifest(root)


class ProductFlatpakTests(unittest.TestCase):
    """Both formats preserve the selected native product's identity and payload bytes."""

    def setUp(self):
        self.commit = "a" * 40
        self.info = {
            "commit": self.commit, "version": check_versions(), "modified": False,
            "target": next(target.triple for target in TARGETS if target.platform == "linux"),
            "product": "3d",
        }

    def test_manifests_bind_only_the_selected_native_payload(self):
        for product in ("cli", "3d"):
            recipe = {"modules": [{
                "name": "helper", "sources": [{"type": "patch", "path": "helper.patch"}],
            }, {
                "name": f"holtburger-{product}", "build-commands": [],
                "sources": [{"type": "file", "path": "launcher"},
                            {"type": "dir", "path": "placeholder", "dest": "bundle"}],
            }]}
            with self.subTest(product=product), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                native, output = root / "inspected native", root / "generated/manifest.json"
                with patch("alpha_release.verify_bundle", return_value={**self.info, "product": product}), \
                     patch("alpha_release.source_identity", return_value=(self.commit, False)), \
                     patch("alpha_release.flatpak_recipe", return_value=recipe):
                    flatpak_manifest(native, output)
                modules = json.loads(output.read_text())["modules"]
                self.assertTrue(Path(modules[0]["sources"][0]["path"]).is_absolute())
                sources = modules[1]["sources"]
                self.assertTrue(Path(sources[0]["path"]).is_absolute())
                self.assertEqual(sources[-1], {"type": "dir", "path": str(native.resolve()), "dest": "bundle"})

    def test_wrong_commit_modified_input_and_wrong_platform_are_refused(self):
        for change in ({"commit": "b" * 40}, {"modified": True}, {"target": "other-target"}):
            with self.subTest(change=change), \
                 patch("alpha_release.verify_bundle", return_value={**self.info, **change}), \
                 patch("alpha_release.source_identity", return_value=(self.commit, False)), \
                 patch("alpha_release.flatpak_recipe") as recipe:
                with self.assertRaises(ValueError):
                    flatpak_manifest(Path("native"), Path("manifest.json"))
                recipe.assert_not_called()

    def test_changed_installed_executable_is_refused_even_with_matching_build_info(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            native, files = root / "native", root / "files"
            installed = files / "lib/holtburger"
            native.mkdir()
            installed.mkdir(parents=True)
            (native / "build-info.json").write_text(json.dumps(self.info))
            (installed / "build-info.json").write_text(json.dumps(self.info))
            (native / "executable").write_bytes(b"inspected native executable")
            (installed / "executable").write_bytes(b"changed executable")
            with patch("alpha_release.verify_bundle", return_value=self.info), \
                 patch("alpha_release.source_identity", return_value=(self.commit, False)):
                with self.assertRaisesRegex(ValueError, "Flatpak file differs"):
                    record_flatpak(files, native, root / "bundle", root / "receipt")

    def test_installed_cli_contains_the_full_native_inventory_with_bound_receipt(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            native = NativeProductTests().assemble_product(root, "cli")
            files = root / "flatpak/files"
            installed = files / "lib/holtburger"
            shutil.copytree(native, installed)
            (files / "bin").mkdir()
            for tool in ("holtburger-cli", "dat2hba", "dat-tool"):
                (files / "bin" / tool).symlink_to(f"/app/lib/holtburger/{tool}")
            recipe = {"id": "io.github.merklejerk.holtburger-cli",
                      "runtime": "org.freedesktop.Platform", "runtime-version": "26.08"}
            runtime = flatpak_runtime_ref(recipe)
            (files.parent / "metadata").write_text(f"[Application]\nname={recipe['id']}\nruntime={runtime}\n")
            bundle = root / "cli.flatpak"
            bundle.write_bytes(b"synthetic Flatpak container")
            output = root / "record.json"
            with patch("alpha_release.source_identity", return_value=(self.commit, False)), \
                 patch("alpha_release.flatpak_recipe", return_value=recipe):
                record_flatpak(files, native, bundle, output)
                record = json.loads(output.read_text())
                self.assertEqual(record["product"], "cli")
                self.assertEqual(record["sha256"], digest(bundle))
                self.assertEqual(record["runtime"], runtime)
                self.assertEqual(record["contentFiles"], json.loads((native / "build-info.json").read_text())["contentFiles"])
                executable = installed / "dat-tool"
                executable.chmod(0o644)
                with self.assertRaisesRegex(ValueError, "executable has lost permissions"):
                    record_flatpak(files, native, bundle, output)
                executable.chmod(0o755)
                metadata = files.parent / "metadata"
                for field, value, message in (("name", "io.github.merklejerk.holtburger-alpha", "application ID"),
                                               ("runtime", "org.example.Wrong/x86_64/test", "runtime differs")):
                    values = {"name": recipe["id"], "runtime": runtime, field: value}
                    metadata.write_text(f"[Application]\nname={values['name']}\nruntime={values['runtime']}\n")
                    with self.subTest(field=field), self.assertRaisesRegex(ValueError, message):
                        record_flatpak(files, native, bundle, output)
                metadata.write_text(f"[Application]\nname={recipe['id']}\nruntime={runtime}\n")
                (installed / "content/navigation.hnav").write_bytes(b"substituted")
                with self.assertRaisesRegex(ValueError, "Flatpak file differs: content/navigation.hnav"):
                    record_flatpak(files, native, bundle, output)


class DraftPublicationTests(unittest.TestCase):
    """Reruns must reuse matching bytes and must never modify a published release."""

    def test_created_draft_response_is_used_when_release_lists_remain_empty(self):
        commit = "a" * 40
        tag = "alpha-20261027-" + commit[:8]
        with tempfile.TemporaryDirectory() as temporary:
            artifact = Path(temporary) / "bundle.zip"
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
            artifact = root / "bundle.zip"
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
