#!/usr/bin/env python3
"""Plan, assemble, inspect, and stage an immutable suite distribution."""

import argparse
import configparser
from dataclasses import asdict, dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import struct
import subprocess
import sys
import tarfile
import tempfile
import zipfile

from release_version import ROOT, check_versions, release_channel, validate_channel_version
from release_identity import (
    Distribution, RELEASE_BRANCH, prepare_source, source_distribution,
    validate_prepared_source, validate_tag as validate_source_tag,
)
from cli_content_input import CONTENT_FILES, verify_staged_content


@dataclass(frozen=True)
class NativeTarget:
    """One native build contract, consumed by the Actions matrix and bundle inspector."""

    triple: str  # Cargo target and downloadable artifact identity.
    runner: str  # Pinned Actions runner image.
    platform: str  # Electron platform spelling, also matching sys.platform.
    architecture: str  # Electron architecture, checked against actual executable headers.


TARGETS = (
    NativeTarget("x86_64-unknown-linux-gnu", "ubuntu-22.04", "linux", "x64"),
    NativeTarget("x86_64-pc-windows-msvc", "windows-2022", "win32", "x64"),
    NativeTarget("aarch64-apple-darwin", "macos-15", "darwin", "arm64"),
)


@dataclass(frozen=True)
class InstallerTarget:
    """One desktop format required by complete distribution staging."""

    triple: str  # Native archive identity consumed by the installer generator.
    format: str  # Explicit packaging format recorded in the release manifest.
    suffix: str  # Canonical downloadable filename suffix, checked during staging.

    def filename(self, version: str) -> str:
        return f"holtburger-3d-{version}-{self.triple}{self.suffix}"


INSTALLER_TARGETS = (
    InstallerTarget("x86_64-pc-windows-msvc", "inno-setup", "-setup.exe"),
    InstallerTarget("aarch64-apple-darwin", "dmg", ".dmg"),
)
SCRIPTS = ("fighter.js", "mage.js", "mage.data.json", "mage.data.bin")
TOOLS = ("holtburger-cli", "dat2hba", "dat-tool")
APP = ROOT / "apps/holtburger-3d"
THREED_FLATPAK_RECIPE = ROOT / ".github/flatpak/io.github.merklejerk.holtburger-3d.json"
CLI_FLATPAK_RECIPE = ROOT / "apps/holtburger-cli/dist/io.github.merklejerk.holtburger-cli.yaml"
CLI_CONTENT_DESCRIPTOR = ROOT / ".github/cli-content.json"
PRODUCTS = ("cli", "3d")


def run(*arguments: str, cwd: Path = ROOT) -> str:
    """Capture diagnostic commands while preserving nonzero exits as failures."""
    return subprocess.check_output(arguments, cwd=cwd, text=True).strip()


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def target_named(triple: str) -> NativeTarget:
    return next(target for target in TARGETS if target.triple == triple)


def distribution_kind() -> str:
    """Build preparation selects the kind; local and ordinary package builds are releases."""
    kind = os.environ.get("HOLTBURGER_DISTRIBUTION", "release")
    if kind not in ("release", "nightly"):
        raise ValueError("Distribution kind must be release or nightly")
    return kind


def source_identity() -> tuple[str, bool]:
    commit = run("git", "rev-parse", "HEAD")
    supplied = os.environ.get("HOLTBURGER_SOURCE_REVISION")
    if supplied is not None and supplied != commit:
        raise ValueError("Source revision does not match the checked-out commit")
    if distribution_kind() == "nightly":
        identity = source_distribution(ROOT, "nightly")
        validate_prepared_source(ROOT, identity)
        return commit, False
    modified = os.environ.get("HOLTBURGER_SOURCE_MODIFIED")
    if modified is not None and modified not in ("0", "1"):
        raise ValueError("HOLTBURGER_SOURCE_MODIFIED must be 0 or 1")
    return commit, modified == "1" or bool(run("git", "status", "--porcelain", "--ignore-submodules=none"))


def validate_tag(tag: str, version: str, commit: str, kind: str) -> None:
    """Public tag and version must describe exactly the same distribution."""
    identity = Distribution(kind, version, commit)
    if tag != identity.tag:
        raise ValueError("Release tag must equal v followed by the distribution version")


def release_records(tag: str) -> list[dict]:
    """Include drafts so retries distinguish incomplete staging from publication."""
    lines = run("gh", "api", "repos/merklejerk/holtburger/releases", "--paginate", "--jq",
                f".[] | select(.tag_name == {json.dumps(tag)}) | @json")
    records = [json.loads(line) for line in lines.splitlines()]
    if len(records) > 1:
        raise ValueError("Expected at most one release for the immutable tag")
    return records


def already_published(identity: Distribution) -> bool:
    """Skip builds only after checking the complete published inventory and provenance."""
    records = release_records(identity.tag)
    if not records:
        return False
    record = records[0]
    if record["target_commitish"] != identity.commit:
        raise ValueError("Existing release belongs to another source commit")
    if record["draft"]:
        return False
    if record["prerelease"] != (identity.kind == "nightly"):
        raise ValueError("Published release has conflicting distribution policy")
    descriptions = [asset for asset in record["assets"] if asset["name"] == "release-manifest.json"]
    if len(descriptions) != 1:
        raise ValueError("Published release requires exactly one release manifest")
    data = subprocess.check_output([
        "gh", "api", f"repos/merklejerk/holtburger/releases/assets/{descriptions[0]['id']}",
        "--header", "Accept: application/octet-stream",
    ])
    inventory = validate_manifest(json.loads(data))
    if (inventory.version, inventory.commit, inventory.kind) != (identity.version, identity.commit, identity.kind):
        raise ValueError("Published manifest differs from the requested distribution")
    expected = {**inventory.assets, "release-manifest.json": hashlib.sha256(data).hexdigest()}
    assets = record["assets"]
    if len(assets) != len(expected) + 1 or {asset["name"] for asset in assets} != {*expected, "SHA256SUMS"}:
        raise ValueError("Published release asset inventory is incomplete or unexpected")
    for asset in assets:
        if asset["state"] != "uploaded" or asset["size"] <= 0:
            raise ValueError("Published release asset is not ready")
        if asset["name"] in expected and asset["digest"] != f"sha256:{expected[asset['name']]}":
            raise ValueError("Published release asset digest differs from its manifest")
    return True


def plan(product: str, target: str, purpose: str) -> None:
    """Resolve the immutable main source before selecting the shared native matrix."""
    version = check_versions()
    commit, modified = source_identity()
    if modified:
        raise ValueError("Release planning requires a clean source checkout")
    tagged = os.environ.get("GITHUB_REF_TYPE") == "tag"
    if purpose != "diagnostic" and (product != "both" or target != "all"):
        raise ValueError("Releases require both products and every supported native target")
    kind = "nightly" if purpose == "nightly" else "release"
    identity = source_distribution(ROOT, kind)
    tag = ""
    if tagged:
        if purpose != "release":
            raise ValueError("Tag events only build stable releases")
        validate_tag(os.environ["GITHUB_REF_NAME"], version, commit, kind)
        validate_source_tag(ROOT, identity)
        tag = identity.tag
    elif purpose != "diagnostic":
        if os.environ.get("GITHUB_REF") != f"refs/heads/{RELEASE_BRANCH}":
            raise ValueError(f"Run release builds on the {RELEASE_BRANCH} branch")
        subprocess.run(["git", "merge-base", "--is-ancestor", commit,
                        f"origin/{RELEASE_BRANCH}"], cwd=ROOT, check=True)
        tag = identity.tag
        existing = subprocess.run(["git", "show-ref", "--verify", "--quiet", f"refs/tags/{tag}"], cwd=ROOT)
        if existing.returncode == 0:
            validate_source_tag(ROOT, identity)
        elif existing.returncode == 1:
            run("git", "tag", tag, commit)
            run("git", "push", "origin", f"refs/tags/{tag}")
        else:
            existing.check_returncode()
    published = bool(tag) and already_published(identity)
    selected = [entry for entry in TARGETS if target == "all" or entry.triple == target]
    result = {
        "version": identity.version, "commit": commit, "kind": kind, "product": product, "tag": tag,
        "skip": str(published).lower(),
        "linux_enabled": str(any(entry.platform == "linux" for entry in selected)).lower(),
        "desktop_enabled": str(any(entry.platform != "linux" for entry in selected)).lower(),
        "linux_matrix": {"include": [asdict(entry) for entry in selected if entry.platform == "linux"]},
        "desktop_matrix": {"include": [asdict(entry) for entry in selected if entry.platform != "linux"]},
    }
    if "GITHUB_OUTPUT" in os.environ:
        with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
            for key, value in result.items():
                encoded = json.dumps(value) if isinstance(value, dict) else value
                output.write(f"{key}={encoded}\n")
    print(json.dumps(result))


def executable_architecture(path: Path) -> str:
    """Inspect 64-bit ELF, PE, or thin Mach-O headers rather than trusting a filename."""
    with path.open("rb") as binary:
        header = binary.read(64)
        if header.startswith(b"\x7fELF") and header[4:6] == b"\x02\x01":
            machine = struct.unpack_from("<H", header, 18)[0]
            architectures = {62: "x64", 183: "arm64"}
        elif header.startswith(b"MZ"):
            binary.seek(struct.unpack_from("<I", header, 60)[0])
            pe = binary.read(6)
            if pe[:4] != b"PE\0\0":
                raise ValueError(f"Invalid PE header: {path}")
            machine = struct.unpack_from("<H", pe, 4)[0]
            architectures = {0x8664: "x64", 0xAA64: "arm64"}
        elif header[:4] == b"\xcf\xfa\xed\xfe":
            machine = struct.unpack_from("<I", header, 4)[0]
            architectures = {0x01000007: "x64", 0x0100000C: "arm64"}
        else:
            raise ValueError(f"Unsupported native executable format: {path}")
    if machine not in architectures:
        raise ValueError(f"Unsupported executable machine {machine}: {path}")
    return architectures[machine]


def executable_paths(bundle: Path, target: NativeTarget, product: str) -> list[Path]:
    suffix = ".exe" if target.platform == "win32" else ""
    if product == "cli":
        return [bundle / f"{name}{suffix}" for name in TOOLS]
    if product != "3d":
        raise ValueError(f"Unsupported native product: {product}")
    package = bundle / "h3d"
    if target.platform == "darwin":
        app = package / "holtburger-3d.app/Contents"
        return [app / "MacOS/holtburger-3d", app / "Resources/holtburger-3d-host"]
    return [package / f"holtburger-3d{suffix}", package / f"resources/holtburger-3d-host{suffix}"]


def verify_bundle(bundle: Path) -> dict:
    """Validate the downloaded shape against its identity and the native package verifier."""
    info = json.loads((bundle / "build-info.json").read_text())
    target = target_named(info["target"])
    if sys.platform != target.platform:
        raise ValueError("Bundle inspection must run on its native platform")
    product = info["product"]
    validate_channel_version(info["channel"], info["version"], info["kind"])
    Distribution(info["kind"], info["version"], info["commit"])
    if product not in PRODUCTS:
        raise ValueError(f"Unsupported native product: {product}")
    expected = {"QUICKSTART.md", "LICENSE.md", "build-info.json", "THIRD_PARTY_NOTICES.html"}
    suffix = ".exe" if target.platform == "win32" else ""
    if product == "cli":
        expected.update({"scripts", "content"})
        expected.update(f"{name}{suffix}" for name in TOOLS)
    else:
        expected.add("h3d")
    if {path.name for path in bundle.iterdir()} != expected:
        raise ValueError(f"Unexpected or missing {product} bundle root entries")
    resources = ["QUICKSTART.md", "LICENSE.md", "THIRD_PARTY_NOTICES.html"]
    if product == "cli":
        if {path.name for path in (bundle / "scripts").iterdir()} != set(SCRIPTS):
            raise ValueError("Unexpected or missing bundled script entries")
        if {path.name for path in (bundle / "content").iterdir()} != set(CONTENT_FILES):
            raise ValueError("Unexpected or missing CLI content entries")
        for name in CONTENT_FILES:
            if digest(bundle / "content" / name) != info["contentFiles"][name]:
                raise ValueError(f"CLI content digest mismatch: {name}")
        resources.extend(f"scripts/{name}" for name in SCRIPTS)
    if digest(bundle / "THIRD_PARTY_NOTICES.html") != info["noticesSha256"]:
        raise ValueError("Bundle dependency notices digest mismatch")
    for name in resources:
        if (bundle / name).stat().st_size == 0:
            raise ValueError(f"Empty bundle resource: {name}")
    for path in executable_paths(bundle, target, product):
        if executable_architecture(path) != target.architecture:
            raise ValueError(f"Executable architecture does not match {target.triple}: {path}")
        if target.platform != "win32" and not os.access(path, os.X_OK):
            raise ValueError(f"Bundle executable has lost permissions: {path}")
    for path in bundle.rglob("*"):
        if product == "3d" and path.suffix.lower() in (".hba", ".hwc"):
            raise ValueError(f"Unexpected content archive in h3d: {path}")
        if path.is_symlink() and not path.resolve().is_relative_to(bundle.resolve()):
            raise ValueError(f"Bundle symlink escapes the installation: {path}")
    if product == "3d":
        renderer = json.loads(run("node", "scripts/verify-electron-package.mjs", str((bundle / "h3d").resolve()), cwd=APP))
        if (renderer["version"], renderer["revision"], renderer["modified"], renderer["channel"], renderer["kind"]) != (
            info["version"], info["commit"][:8], info["modified"], info["channel"], info["kind"]
        ):
            raise ValueError("3D build identity differs from the packaged renderer")
    return info


def archive_bundle(bundle: Path, destination: Path, target: NativeTarget) -> None:
    """Preserve native links and file modes; ordinary zip helpers dereference macOS frameworks."""
    if target.platform == "linux":
        with tarfile.open(destination, "w:gz", dereference=False) as archive:
            archive.add(bundle, arcname=bundle.name)
        return
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(bundle.rglob("*")):
            name = path.relative_to(bundle.parent).as_posix()
            if path.is_symlink():
                entry = zipfile.ZipInfo(name)
                entry.create_system = 3
                entry.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(entry, os.readlink(path))
            else:
                archive.write(path, name)


def extract_bundle(archive: Path, destination: Path) -> Path:
    if archive.name.endswith(".tar.gz"):
        with tarfile.open(archive) as source:
            source.extractall(destination, filter="data")
    elif sys.platform == "darwin":
        run("unzip", "-q", str(archive.resolve()), "-d", str(destination))
    else:
        with zipfile.ZipFile(archive) as source:
            source.extractall(destination)
    roots = list(destination.iterdir())
    if len(roots) != 1 or not roots[0].is_dir():
        raise ValueError("Bundle archive must contain one installation directory")
    return roots[0]


def inspect_linkage(bundle: Path, target: NativeTarget, product: str) -> dict[str, str]:
    reports = {}
    for path in executable_paths(bundle, target, product):
        if target.platform == "linux":
            report = run("ldd", str(path.resolve()))
            if "not found" in report:
                raise ValueError(f"Unresolved native library: {path}\n{report}")
            report += "\n" + run("readelf", "--version-info", str(path))
        elif target.platform == "darwin":
            report = run("otool", "-L", str(path))
        else:
            inspector = shutil.which("llvm-readobj")
            if inspector is None:
                inspector = str(Path(os.environ["ProgramFiles"]) / "LLVM/bin/llvm-readobj.exe")
            report = run(inspector, "--coff-imports", str(path))
        reports[path.relative_to(bundle).as_posix()] = report
    return reports


def verify_host_origin(bundle: Path, source: Path, target: NativeTarget) -> None:
    """Bind a final packaged host to Cargo, accounting for Mac signing mutations."""
    host = executable_paths(bundle, target, "3d")[-1]
    source_digest = digest(source)
    if target.platform == "darwin":
        provenance = json.loads(host.with_name("host-provenance.json").read_text())
        if provenance["sourceHostSha256"] != source_digest:
            raise ValueError("Mac signing provenance identifies a different Cargo host")
        if provenance["packagedHostSha256"] != digest(host):
            raise ValueError("Mac signing provenance identifies a different packaged host")
    elif digest(host) != source_digest:
        raise ValueError("Forge bundled a different Rust host than the target build")


def assemble(arguments) -> None:
    target = target_named(arguments.target)
    if target.platform != sys.platform:
        raise ValueError("Build each bundle on its native platform")
    version = check_versions()
    commit, modified = source_identity()
    product = arguments.product
    channel = release_channel(ROOT)
    validate_channel_version(channel, version, distribution_kind())
    if product == "cli" and arguments.content is None:
        raise ValueError("CLI assembly requires --content staging")
    if product == "3d" and arguments.package is None:
        raise ValueError("3D assembly requires --package")
    output = arguments.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    name = f"holtburger-{product}-{version}-{target.triple}"
    with tempfile.TemporaryDirectory(prefix="holtburger-bundle-") as temporary:
        bundle = Path(temporary) / name
        bundle.mkdir()
        binaries = ROOT / "target" / target.triple / "release"
        suffix = ".exe" if target.platform == "win32" else ""
        info = {
            "version": version, "commit": commit, "modified": modified, "channel": channel, "kind": distribution_kind(),
            "product": product, "target": target.triple,
            "noticesSha256": digest(arguments.notices),
        }
        if product == "cli":
            content = arguments.content.resolve()
            expected = json.loads(CLI_CONTENT_DESCRIPTOR.read_text())["sha256"]
            verify_staged_content(content, expected)
            for source, published in (("tui", "holtburger-cli"), ("dat2hba", "dat2hba"), ("dat-tool", "dat-tool")):
                shutil.copy2(binaries / f"{source}{suffix}", bundle / f"{published}{suffix}")
            (bundle / "scripts").mkdir()
            for script in SCRIPTS:
                shutil.copy2(ROOT / "assets" / "scripts" / script, bundle / "scripts" / script)
            (bundle / "content").mkdir()
            for filename in CONTENT_FILES:
                shutil.copy2(content / filename, bundle / "content" / filename)
            info.update({"contentSha256": expected,
                         "contentFiles": {filename: digest(content / filename) for filename in CONTENT_FILES}})
        else:
            shutil.copytree(arguments.package, bundle / "h3d", symlinks=True)
            verify_host_origin(bundle, binaries / f"holtburger-3d-host{suffix}", target)
        shutil.copy2(ROOT / f"release/{product.upper()}_QUICKSTART.md", bundle / "QUICKSTART.md")
        shutil.copy2(ROOT / "LICENSE.md", bundle / "LICENSE.md")
        shutil.copy2(arguments.notices, bundle / "THIRD_PARTY_NOTICES.html")
        write_json(bundle / "build-info.json", info)
        verify_bundle(bundle)
        linkage = inspect_linkage(bundle, target, product)
        extension = ".tar.gz" if target.platform == "linux" else ".zip"
        destination = output / (name + extension)
        archive_bundle(bundle, destination, target)
        with tempfile.TemporaryDirectory(prefix="holtburger-extracted-") as extracted:
            verify_bundle(extract_bundle(destination, Path(extracted)))
        write_json(output / f"metadata-{product}-{target.triple}.json", {
            **info, "archive": destination.name, "sha256": digest(destination),
            "linkage": linkage, "runner": target.runner,
        })
        print(destination)


@dataclass(frozen=True)
class ReleaseInventory:
    """Validated public release identity and expected downloadable file digests."""

    version: str  # SemVer compared by the feed generator.
    channel: str  # Explicit audience used by channel selection.
    commit: str  # Full source commit checked against the public release tag.
    assets: dict[str, str]  # Exact downloadable payload names and expected SHA-256 values.
    kind: str  # Distribution policy validated together with its version and source.


def validate_manifest(document: dict) -> ReleaseInventory:
    """Validate complete inventory without needing native packages or the current checkout."""
    if document["schemaVersion"] != 2:
        raise ValueError("Unsupported managed release manifest schema")
    version, channel, commit = document["version"], document["channel"], document["commit"]
    validate_channel_version(channel, version, document["kind"])
    Distribution(document["kind"], version, commit)
    notices_digest = document["noticesSha256"]
    identity = {"version": version, "channel": channel, "commit": commit,
                "modified": False, "noticesSha256": notices_digest, "kind": document["kind"]}
    expected_assets = {"THIRD_PARTY_NOTICES.html": notices_digest}
    native = document["native"]
    pairs = [(item["product"], item["target"]) for item in native]
    expected_pairs = {(product, target.triple) for product in PRODUCTS for target in TARGETS}
    if len(pairs) != len(expected_pairs) or set(pairs) != expected_pairs:
        raise ValueError("Release manifest requires both products on every native target")
    for record in native:
        if any(record[key] != value for key, value in identity.items()):
            raise ValueError("Release identity mismatch for native archive")
        target = target_named(record["target"])
        extension = ".tar.gz" if target.platform == "linux" else ".zip"
        filename = f"holtburger-{record['product']}-{version}-{target.triple}{extension}"
        if record["archive"] != filename:
            raise ValueError("Release archive filename mismatch")
        expected_assets[filename] = record["sha256"]
    cli = [item for item in native if item["product"] == "cli"]
    content = {"contentSha256": cli[0]["contentSha256"], "contentFiles": cli[0]["contentFiles"]}
    if set(content["contentFiles"]) != set(CONTENT_FILES):
        raise ValueError("CLI content inventory differs from its required companions")
    if any(any(record[key] != value for key, value in content.items()) for record in cli):
        raise ValueError("CLI native targets contain different content companions")
    flatpaks = document["flatpaks"]
    if len(flatpaks) != len(PRODUCTS) or {item["product"] for item in flatpaks} != set(PRODUCTS):
        raise ValueError("Release manifest requires both product Flatpaks")
    runtime = flatpaks[0]["runtime"]
    if re.fullmatch(r"org\.freedesktop\.Platform/x86_64/[0-9.]+", runtime) is None:
        raise ValueError("Flatpak runtime is outside the supported runtime family")
    app_ids = {"cli": "io.github.merklejerk.holtburger-cli",
               "3d": "io.github.merklejerk.holtburger-3d"}
    for record in flatpaks:
        product = record["product"]
        expected = {**identity, "target": "x86_64-unknown-linux-gnu",
                    "appId": app_ids[product], "runtime": runtime}
        if product == "cli":
            expected.update(content)
        if any(record[key] != value for key, value in expected.items()):
            raise ValueError("Flatpak release identity mismatch")
        filename = f"holtburger-{product}-{version}-x86_64.flatpak"
        if record["archive"] != filename:
            raise ValueError("Flatpak release filename mismatch")
        expected_assets[filename] = record["sha256"]
    installers = document["installers"]
    if len(installers) != len(INSTALLER_TARGETS) or {item["target"] for item in installers} != {item.triple for item in INSTALLER_TARGETS}:
        raise ValueError("Release manifest requires every desktop installer")
    for record in installers:
        installer = next(item for item in INSTALLER_TARGETS if item.triple == record["target"])
        archive = next(item for item in native if item["product"] == "3d" and item["target"] == installer.triple)
        expected = {**identity, "product": "3d", "format": installer.format,
                    "nativeArchiveSha256": archive["sha256"]}
        if any(record[key] != value for key, value in expected.items()):
            raise ValueError("Installer release identity mismatch")
        filename = installer.filename(version)
        if record["installer"] != filename:
            raise ValueError("Installer release filename mismatch")
        expected_assets[filename] = record["sha256"]
    assets = document["assets"]
    if len(assets) != len(expected_assets) or {item["name"]: item["sha256"] for item in assets} != expected_assets:
        raise ValueError("Release manifest asset inventory or digests differ from its payload records")
    for checksum in [*expected_assets.values(), content["contentSha256"], *content["contentFiles"].values()]:
        if re.fullmatch(r"[0-9a-f]{64}", checksum) is None:
            raise ValueError("Release manifest contains an invalid SHA-256 digest")
    return ReleaseInventory(version, channel, commit, expected_assets, document["kind"])


def manifest(artifacts: Path) -> list[Path]:
    """Validate the public inventory, then verify each file before freezing the draft."""
    version = check_versions()
    channel = release_channel(ROOT)
    commit, modified = source_identity()
    if modified:
        raise ValueError("Refusing release metadata for a modified source checkout")
    notices = artifacts / "THIRD_PARTY_NOTICES.html"
    if not notices.stat().st_size:
        raise ValueError("Empty dependency notices")
    native = [json.loads((artifacts / f"metadata-{product}-{target.triple}.json").read_text())
              for product in PRODUCTS for target in TARGETS]
    flatpaks = [json.loads((artifacts / f"metadata-{product}-flatpak.json").read_text()) for product in PRODUCTS]
    installers = [json.loads((artifacts / f"metadata-3d-installer-{item.triple}.json").read_text()) for item in INSTALLER_TARGETS]
    assets = [{"name": notices.name, "sha256": digest(notices)}]
    assets.extend({"name": record["archive"], "sha256": record["sha256"]} for record in [*native, *flatpaks])
    assets.extend({"name": record["installer"], "sha256": record["sha256"]} for record in installers)
    document = {"schemaVersion": 2, "channel": channel, "version": version, "commit": commit, "kind": distribution_kind(),
                "noticesSha256": digest(notices), "native": native, "flatpaks": flatpaks,
                "installers": installers, "assets": assets}
    inventory = validate_manifest(document)
    content_digest = json.loads(CLI_CONTENT_DESCRIPTOR.read_text())["sha256"]
    if any(item["contentSha256"] != content_digest for item in native if item["product"] == "cli"):
        raise ValueError("CLI release content differs from the pinned source input")
    runtime = flatpak_runtime_ref(json.loads(THREED_FLATPAK_RECIPE.read_text()))
    if any(item["runtime"] != runtime for item in flatpaks):
        raise ValueError("Flatpak release identity mismatch with the source runtime")
    files = []
    for name, checksum in inventory.assets.items():
        path = artifacts / name
        if not path.stat().st_size:
            raise ValueError(f"Empty release asset: {name}")
        if digest(path) != checksum:
            raise ValueError(f"Release asset digest mismatch: {name}")
        files.append(path)
    description = artifacts / "release-manifest.json"
    write_json(description, document)
    files.append(description)
    sums = artifacts / "SHA256SUMS"
    sums.write_text("".join(f"{digest(path)}  {path.name}\n" for path in sorted(files)))
    return files + [sums]


def stage(artifacts: Path, tag: str) -> None:
    files = manifest(artifacts)
    commit, _ = source_identity()
    validate_tag(tag, check_versions(), commit, distribution_kind())
    # Query drafts as well as published releases. A rerun may fill a partial matching draft.
    releases = release_records(tag)
    if not releases:
        remote = run("gh", "api", f"repos/merklejerk/holtburger/commits/{tag}", "--jq", ".sha")
        if remote != commit:
            raise ValueError("Remote release tag does not point to the release commit")
        # The create response owns the draft identity. A fresh list can omit the new draft.
        created = run("gh", "api", "repos/merklejerk/holtburger/releases", "--method", "POST",
                      "--raw-field", f"tag_name={tag}", "--raw-field", f"target_commitish={commit}",
                      "--raw-field", f"name=Holtburger {check_versions()}",
                      "--field", "draft=true", "--field", f"prerelease={str(distribution_kind() == 'nightly').lower()}",
                      "--raw-field", "make_latest=false",
                      "--field", f"body=@{ROOT / 'release/RELEASE_NOTES.md'}")
        releases = [json.loads(created)]
    if len(releases) != 1:
        raise ValueError("Expected exactly one draft release")
    release = releases[0]
    if not release["draft"] or release["target_commitish"] != commit:
        raise ValueError("Refusing to modify a published release or a draft for another commit")
    uploaded = {asset["name"]: asset["digest"] for asset in release["assets"]}
    expected = {path.name for path in files}
    if uploaded.keys() - expected:
        raise ValueError("Draft contains unexpected release assets")
    for path in files:
        if path.name in uploaded:
            if uploaded[path.name] != f"sha256:{digest(path)}":
                raise ValueError(f"Draft asset conflicts with verified release: {path.name}")
        else:
            run("gh", "release", "upload", tag, str(path), "--repo", "merklejerk/holtburger")
    print(f"Draft staged for final user verification: {release['html_url']}")


def flatpak_recipe_path(product: str) -> Path:
    """Both distributions share one installation identity per product."""
    return CLI_FLATPAK_RECIPE if product == "cli" else THREED_FLATPAK_RECIPE


def flatpak_recipe(product: str) -> dict:
    """Expand one product recipe, using the suite's shared Freedesktop runtime generation."""
    path = flatpak_recipe_path(product)
    recipe = json.loads(run("flatpak-builder", "--show-manifest", str(path)))
    runtime = json.loads(THREED_FLATPAK_RECIPE.read_text())
    for key in ("runtime", "runtime-version", "sdk"):
        recipe[key] = runtime[key]
    return recipe


def require_flatpak_release(info: dict) -> None:
    """Admit only an inspected Linux package with the current release identity."""
    if info["target"] != "x86_64-unknown-linux-gnu":
        raise ValueError("The release Flatpaks require Linux x86-64 inputs")
    commit, _ = source_identity()
    if (info["commit"], info["version"], info["modified"]) != (commit, check_versions(), False):
        raise ValueError("Flatpak input does not match the clean release identity")


def flatpak_runtime_ref(recipe: dict) -> str:
    """Canonical runtime identity for the release's supported Linux x86-64 architecture."""
    return f"{recipe['runtime']}/x86_64/{recipe['runtime-version']}"


def installed_flatpak_runtime(files: Path, recipe: dict) -> str:
    """Check the installed application's ID/runtime against its owning recipe."""
    metadata = configparser.ConfigParser(interpolation=None)
    metadata.read(files.parent / "metadata")
    runtime = flatpak_runtime_ref(recipe)
    if metadata["Application"]["name"] != recipe["id"]:
        raise ValueError("Installed Flatpak application ID differs from its recipe")
    if metadata["Application"]["runtime"] != runtime:
        raise ValueError("Installed Flatpak runtime differs from its recipe")
    return runtime


def flatpak_manifest(native: Path, output: Path) -> None:
    """Package one inspected native inventory without rebuilding or duplicating its receipt."""
    info = verify_bundle(native)
    require_flatpak_release(info)
    product = info["product"]
    recipe_path = flatpak_recipe_path(product)
    recipe = flatpak_recipe(product)
    module = next(module for module in recipe["modules"] if module["name"] == f"holtburger-{product}")
    payload = next(source for source in module["sources"] if source.get("dest") == "bundle")
    payload["path"] = str(native.resolve())
    for dependency in recipe["modules"]:
        for source in dependency["sources"]:
            if "path" in source:
                source["path"] = str((recipe_path.parent / source["path"]).resolve())
    output.parent.mkdir(parents=True, exist_ok=True)
    write_json(output, recipe)


def prepare_flatpak(artifacts: Path, product: str, output: Path) -> Path:
    """Extract the selected verified Linux archive as its Flatpak's immutable input."""
    record = json.loads((artifacts / f"metadata-{product}-x86_64-unknown-linux-gnu.json").read_text())
    require_flatpak_release(record)
    if record["product"] != product:
        raise ValueError("Flatpak input product differs from the requested product")
    archive = artifacts / record["archive"]
    if archive.parent != artifacts or digest(archive) != record["sha256"]:
        raise ValueError("Flatpak input archive digest/path mismatch")
    output.parent.mkdir(parents=True, exist_ok=True)
    extracted = Path(tempfile.mkdtemp(prefix=f"{product}-flatpak-input-", dir=output.parent))
    native = extract_bundle(archive, extracted)
    info = json.loads((native / "build-info.json").read_text())
    for key in info:
        if info[key] != record[key]:
            raise ValueError(f"Flatpak archive metadata differs from its native input: {key}")
    flatpak_manifest(native, output)
    return native.resolve()


def verify_payload(native: Path, installed: Path) -> None:
    """Compare an owned installed subtree with its verified native input, including links."""
    expected = {path.relative_to(native) for path in native.rglob("*")}
    actual = {path.relative_to(installed) for path in installed.rglob("*")}
    if actual != expected:
        raise ValueError("Installed payload inventory differs from its native input")
    for relative in expected:
        source, destination = native / relative, installed / relative
        if source.is_symlink():
            if not destination.is_symlink() or os.readlink(source) != os.readlink(destination):
                raise ValueError(f"Installed payload link differs: {relative}")
        elif source.is_file():
            if destination.is_symlink() or digest(source) != digest(destination):
                raise ValueError(f"Installed payload file differs: {relative}")
            if sys.platform != "win32" and (source.stat().st_mode & 0o111) != (destination.stat().st_mode & 0o111):
                raise ValueError(f"Installed payload executable mode differs: {relative}")
        elif not destination.is_dir() or destination.is_symlink():
            raise ValueError(f"Installed payload directory differs: {relative}")


def record_flatpak(files: Path, native: Path, bundle: Path, output: Path) -> None:
    """Bind installed inventory and bytes to the selected native product and runtime."""
    info = verify_bundle(native)
    installed = files / "lib/holtburger"
    if json.loads((installed / "build-info.json").read_text()) != info:
        raise ValueError("Installed Flatpak identity differs from its native input")
    require_flatpak_release(info)
    verify_payload(native, installed)
    helper_identity = {}
    if info["product"] == "cli":
        for tool in TOOLS:
            if os.readlink(files / "bin" / tool) != f"/app/lib/holtburger/{tool}":
                raise ValueError(f"Installed Flatpak tool entry differs: {tool}")
    else:
        if digest(files / "bin/holtburger-3d") != digest(THREED_FLATPAK_RECIPE.parent / "holtburger-3d"):
            raise ValueError("Installed Flatpak launcher differs from the sandbox wrapper")
        for component in ("zypak", "nickle"):
            original = ROOT / ".github/licenses/native" / component / "LICENSE"
            if digest(files / "share/licenses" / component / "LICENSE") != digest(original):
                raise ValueError(f"Installed Flatpak helper notice needs review: {component}")
        for executable in ("zypak-helper", "zypak-sandbox"):
            if executable_architecture(files / "bin" / executable) != "x64":
                raise ValueError(f"Installed Flatpak helper architecture differs: {executable}")
        helper = json.loads((THREED_FLATPAK_RECIPE.parent / "zypak.json").read_text())
        helper_identity["sandboxHelperCommit"] = helper["sources"][0]["commit"]
    recipe = flatpak_recipe(info["product"])
    runtime = installed_flatpak_runtime(files, recipe)
    if not bundle.stat().st_size:
        raise ValueError("Empty Flatpak bundle")
    output.parent.mkdir(parents=True, exist_ok=True)
    write_json(output, {
        **info, **helper_identity, "appId": recipe["id"], "runtime": runtime,
        "archive": bundle.name, "sha256": digest(bundle),
    })


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    planning = commands.add_parser("plan")
    planning.add_argument("--purpose", choices=("release", "nightly", "diagnostic"), default="release")
    planning.add_argument("--product", choices=("both", *PRODUCTS), default="both")
    planning.add_argument("--target", choices=("all", *(entry.triple for entry in TARGETS)), default="all")
    preparation = commands.add_parser("prepare-source")
    preparation.add_argument("--kind", choices=("release", "nightly"), required=True)
    build = commands.add_parser("assemble")
    build.add_argument("--product", choices=PRODUCTS, required=True)
    build.add_argument("--target", choices=[target.triple for target in TARGETS], required=True)
    build.add_argument("--package", type=Path)
    build.add_argument("--content", type=Path)
    build.add_argument("--notices", type=Path, required=True)
    build.add_argument("--output", type=Path, required=True)
    inspect = commands.add_parser("verify")
    inspect.add_argument("bundle", type=Path)
    describe = commands.add_parser("manifest")
    describe.add_argument("artifacts", type=Path)
    upload = commands.add_parser("stage")
    upload.add_argument("artifacts", type=Path)
    upload.add_argument("tag")
    flatpak = commands.add_parser("flatpak-manifest")
    flatpak.add_argument("--native", type=Path, required=True)
    flatpak.add_argument("--output", type=Path, required=True)
    prepare = commands.add_parser("prepare-flatpak")
    prepare.add_argument("--product", choices=PRODUCTS, required=True)
    prepare.add_argument("--artifacts", type=Path, required=True)
    prepare.add_argument("--output", type=Path, required=True)
    record = commands.add_parser("record-flatpak")
    record.add_argument("--files", type=Path, required=True)
    record.add_argument("--native", type=Path, required=True)
    record.add_argument("--bundle", type=Path, required=True)
    record.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    if arguments.command == "plan":
        plan(arguments.product, arguments.target, arguments.purpose)
    elif arguments.command == "prepare-source":
        prepare_source(ROOT, source_distribution(ROOT, arguments.kind))
    elif arguments.command == "assemble":
        assemble(arguments)
    elif arguments.command == "verify":
        print(json.dumps(verify_bundle(arguments.bundle)))
    elif arguments.command == "manifest":
        manifest(arguments.artifacts.resolve())
    elif arguments.command == "flatpak-manifest":
        flatpak_manifest(arguments.native.resolve(), arguments.output)
    elif arguments.command == "prepare-flatpak":
        print(prepare_flatpak(arguments.artifacts.resolve(), arguments.product, arguments.output.resolve()))
    elif arguments.command == "record-flatpak":
        record_flatpak(arguments.files.resolve(), arguments.native.resolve(),
                       arguments.bundle.resolve(), arguments.output)
    else:
        stage(arguments.artifacts.resolve(), arguments.tag)


if __name__ == "__main__":
    main()
