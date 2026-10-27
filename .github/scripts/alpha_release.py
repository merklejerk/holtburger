#!/usr/bin/env python3
"""Assemble, inspect, and stage an alpha suite without publishing it."""

import argparse
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

from release_version import ROOT, check_versions


@dataclass(frozen=True)
class NativeTarget:
    """One native build contract, consumed by the Actions matrix and suite inspector."""

    triple: str  # Cargo target and downloadable artifact identity.
    runner: str  # Pinned Actions runner image.
    platform: str  # Electron platform spelling, also matching sys.platform.
    architecture: str  # Electron architecture, checked against actual executable headers.


TARGETS = (
    NativeTarget("x86_64-unknown-linux-gnu", "ubuntu-22.04", "linux", "x64"),
    NativeTarget("x86_64-pc-windows-msvc", "windows-2022", "win32", "x64"),
    NativeTarget("aarch64-apple-darwin", "macos-14", "darwin", "arm64"),
    NativeTarget("x86_64-apple-darwin", "macos-15-intel", "darwin", "x64"),
)
SCRIPTS = ("fighter.js", "mage.js", "mage.data.json", "mage.data.bin")
TOOLS = ("holtburger-cli", "dat2hba", "dat-tool")
APP = ROOT / "apps/holtburger-3d"


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


def source_identity() -> tuple[str, bool]:
    commit = run("git", "rev-parse", "HEAD")
    supplied = os.environ.get("HOLTBURGER_SOURCE_REVISION")
    if supplied is not None and supplied != commit:
        raise ValueError("Source revision does not match the checked-out commit")
    modified = os.environ.get("HOLTBURGER_SOURCE_MODIFIED")
    if modified is not None:
        if modified not in ("0", "1"):
            raise ValueError("HOLTBURGER_SOURCE_MODIFIED must be 0 or 1")
        return commit, modified == "1"
    return commit, bool(run("git", "status", "--porcelain", "--ignore-submodules=none"))


def validate_tag(tag: str, commit: str) -> None:
    match = re.fullmatch(r"alpha-[0-9]{8}-([0-9a-f]{7,40})", tag)
    if match is None:
        raise ValueError("Alpha tag must be alpha-YYYYMMDD-<source-commit-prefix>")
    if not commit.startswith(match.group(1)):
        raise ValueError("Alpha tag commit prefix does not match the source checkout")


def plan() -> None:
    version = check_versions()
    commit, modified = source_identity()
    if modified:
        raise ValueError("Release planning requires a clean source checkout")
    if os.environ.get("GITHUB_REF_TYPE") == "tag":
        validate_tag(os.environ["GITHUB_REF_NAME"], commit)
        subprocess.run(
            ["git", "merge-base", "--is-ancestor", commit, "origin/3d-next"],
            cwd=ROOT, check=True,
        )
    result = {
        "version": version, "commit": commit,
        "matrix": {"include": [asdict(target) for target in TARGETS]},
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


def executable_paths(suite: Path, target: NativeTarget) -> list[Path]:
    suffix = ".exe" if target.platform == "win32" else ""
    tools = [suite / f"{name}{suffix}" for name in TOOLS]
    package = suite / "h3d"
    if target.platform == "darwin":
        app = package / "holtburger-3d.app/Contents"
        return tools + [app / "MacOS/holtburger-3d", app / "Resources/holtburger-3d-host"]
    return tools + [package / f"holtburger-3d{suffix}", package / f"resources/holtburger-3d-host{suffix}"]


def verify_suite(suite: Path) -> dict:
    """Validate the downloaded shape against its identity and the native package verifier."""
    info = json.loads((suite / "build-info.json").read_text())
    target = target_named(info["target"])
    if sys.platform != target.platform:
        raise ValueError("Suite inspection must run on its native platform")
    expected = {"h3d", "scripts", "dats", "QUICKSTART.md", "LICENSE.md", "build-info.json",
                "THIRD_PARTY_NOTICES.html"}
    suffix = ".exe" if target.platform == "win32" else ""
    expected.update(f"{name}{suffix}" for name in TOOLS)
    if {path.name for path in suite.iterdir()} != expected:
        raise ValueError("Unexpected or missing suite root entries")
    if {path.name for path in (suite / "scripts").iterdir()} != set(SCRIPTS):
        raise ValueError("Unexpected or missing bundled script entries")
    if {path.name for path in (suite / "dats").iterdir()} != {"assets.hba"}:
        raise ValueError("Unexpected or missing TUI content entries")
    if digest(suite / "dats/assets.hba") != info["microHbaSha256"]:
        raise ValueError("Suite micro HBA digest mismatch")
    if digest(suite / "THIRD_PARTY_NOTICES.html") != info["noticesSha256"]:
        raise ValueError("Suite dependency notices digest mismatch")
    for name in ("QUICKSTART.md", "LICENSE.md", "THIRD_PARTY_NOTICES.html",
                 *(f"scripts/{name}" for name in SCRIPTS)):
        if (suite / name).stat().st_size == 0:
            raise ValueError(f"Empty suite resource: {name}")
    for path in executable_paths(suite, target):
        if executable_architecture(path) != target.architecture:
            raise ValueError(f"Executable architecture does not match {target.triple}: {path}")
        if target.platform != "win32" and not os.access(path, os.X_OK):
            raise ValueError(f"Suite executable has lost permissions: {path}")
    for path in (suite / "h3d").rglob("*"):
        if path.suffix.lower() in (".hba", ".hwc"):
            raise ValueError(f"Unexpected content archive in h3d: {path}")
        if path.is_symlink() and not path.resolve().is_relative_to(suite.resolve()):
            raise ValueError(f"Suite symlink escapes the installation: {path}")
    renderer = json.loads(run("node", "scripts/verify-electron-package.mjs", str((suite / "h3d").resolve()), cwd=APP))
    if (renderer["version"], renderer["revision"], renderer["modified"]) != (
        info["version"], info["commit"][:8], info["modified"]
    ):
        raise ValueError("Suite build identity differs from the packaged renderer")
    return info


def archive_suite(suite: Path, destination: Path, target: NativeTarget) -> None:
    """Preserve native links and file modes; ordinary zip helpers dereference macOS frameworks."""
    if target.platform == "linux":
        with tarfile.open(destination, "w:gz", dereference=False) as archive:
            archive.add(suite, arcname=suite.name)
        return
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(suite.rglob("*")):
            name = path.relative_to(suite.parent).as_posix()
            if path.is_symlink():
                entry = zipfile.ZipInfo(name)
                entry.create_system = 3
                entry.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(entry, os.readlink(path))
            else:
                archive.write(path, name)


def extract_suite(archive: Path, destination: Path) -> Path:
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
        raise ValueError("Suite archive must contain one installation directory")
    return roots[0]


def inspect_linkage(suite: Path, target: NativeTarget) -> dict[str, str]:
    reports = {}
    for path in executable_paths(suite, target):
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
        reports[path.relative_to(suite).as_posix()] = report
    return reports


def assemble(arguments) -> None:
    target = target_named(arguments.target)
    if target.platform != sys.platform:
        raise ValueError("Build each suite on its native platform")
    version = check_versions()
    commit, modified = source_identity()
    content = arguments.content.resolve()
    expected = json.loads((ROOT / ".github/alpha-content.json").read_text())["sha256"]
    if digest(content / "micro-hba.zip") != expected:
        raise ValueError("Assembly input does not match the pinned micro ZIP")
    with zipfile.ZipFile(content / "micro-hba.zip") as micro:
        if hashlib.sha256(micro.read("assets.hba")).hexdigest() != digest(content / "assets.hba"):
            raise ValueError("Assembly HBA differs from the pinned ZIP payload")
    output = arguments.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    name = f"holtburger-alpha-{version}-{target.triple}"
    with tempfile.TemporaryDirectory(prefix="holtburger-suite-") as temporary:
        suite = Path(temporary) / name
        suite.mkdir()
        binaries = ROOT / "target" / target.triple / "release"
        suffix = ".exe" if target.platform == "win32" else ""
        for source, published in (("tui", "holtburger-cli"), ("dat2hba", "dat2hba"), ("dat-tool", "dat-tool")):
            shutil.copy2(binaries / f"{source}{suffix}", suite / f"{published}{suffix}")
        shutil.copytree(arguments.package, suite / "h3d", symlinks=True)
        if digest(executable_paths(suite, target)[-1]) != digest(binaries / f"holtburger-3d-host{suffix}"):
            raise ValueError("Forge bundled a different Rust host than the target build")
        (suite / "scripts").mkdir()
        for script in SCRIPTS:
            shutil.copy2(ROOT / "scripts" / script, suite / "scripts" / script)
        (suite / "dats").mkdir()
        shutil.copy2(content / "assets.hba", suite / "dats/assets.hba")
        shutil.copy2(ROOT / "docs/ALPHA_QUICKSTART.md", suite / "QUICKSTART.md")
        shutil.copy2(ROOT / "LICENSE.md", suite / "LICENSE.md")
        shutil.copy2(arguments.notices, suite / "THIRD_PARTY_NOTICES.html")
        info = {
            "version": version, "commit": commit, "modified": modified,
            "target": target.triple, "microSha256": expected,
            "microHbaSha256": digest(content / "assets.hba"),
            "noticesSha256": digest(arguments.notices),
        }
        write_json(suite / "build-info.json", info)
        verify_suite(suite)
        linkage = inspect_linkage(suite, target)
        extension = ".tar.gz" if target.platform == "linux" else ".zip"
        destination = output / (name + extension)
        archive_suite(suite, destination, target)
        with tempfile.TemporaryDirectory(prefix="holtburger-extracted-") as extracted:
            verify_suite(extract_suite(destination, Path(extracted)))
        write_json(output / f"metadata-{target.triple}.json", {
            **info, "archive": destination.name, "sha256": digest(destination),
            "linkage": linkage, "runner": target.runner,
        })
        print(destination)


def manifest(artifacts: Path) -> list[Path]:
    """Require the entire matrix before computing the public inventory and checksum file."""
    version = check_versions()
    commit, modified = source_identity()
    if modified:
        raise ValueError("Refusing release metadata for a modified source checkout")
    records = []
    files = []
    expected_micro = json.loads((ROOT / ".github/alpha-content.json").read_text())["sha256"]
    notices = artifacts / "THIRD_PARTY_NOTICES.html"
    if not notices.stat().st_size:
        raise ValueError("Empty dependency notices")
    notices_digest = digest(notices)
    for target in TARGETS:
        record = json.loads((artifacts / f"metadata-{target.triple}.json").read_text())
        if any((record["commit"] != commit, record["version"] != version,
                record["modified"], record["target"] != target.triple,
                record["microSha256"] != expected_micro,
                record["noticesSha256"] != notices_digest)):
            raise ValueError(f"Release identity mismatch for {target.triple}")
        path = artifacts / record["archive"]
        if path.parent != artifacts or digest(path) != record["sha256"]:
            raise ValueError(f"Release archive digest/path mismatch: {target.triple}")
        files.append(path)
        records.append(record)
    micro = artifacts / f"holtburger-micro-{version}.zip"
    if digest(micro) != expected_micro:
        raise ValueError("Standalone micro download differs from suite input")
    flatpak = artifacts / f"holtburger-cli-{version}-x86_64.flatpak"
    if flatpak.stat().st_size == 0:
        raise ValueError("Empty TUI Flatpak")
    files.extend([micro, flatpak, notices])
    description = artifacts / "release-manifest.json"
    write_json(description, {
        "version": version, "commit": commit, "microSha256": expected_micro,
        "noticesSha256": notices_digest,
        "platforms": records,
        "assets": [{"name": path.name, "sha256": digest(path)} for path in files],
    })
    files.append(description)
    sums = artifacts / "SHA256SUMS"
    sums.write_text("".join(f"{digest(path)}  {path.name}\n" for path in sorted(files)))
    return files + [sums]


def stage(artifacts: Path, tag: str) -> None:
    files = manifest(artifacts)
    commit, _ = source_identity()
    validate_tag(tag, commit)
    # Query drafts as well as published releases. A rerun may fill a partial matching draft.
    lines = run("gh", "api", "repos/merklejerk/holtburger/releases", "--paginate", "--jq",
                f".[] | select(.tag_name == {json.dumps(tag)}) | @json")
    releases = [json.loads(line) for line in lines.splitlines()]
    if not releases:
        run("gh", "release", "create", tag, "--repo", "merklejerk/holtburger", "--verify-tag",
            "--target", commit, "--draft", "--prerelease", "--title", f"Holtburger {check_versions()}",
            "--notes-file", str(ROOT / "docs/ALPHA_RELEASE_NOTES.md"))
        lines = run("gh", "api", "repos/merklejerk/holtburger/releases", "--paginate", "--jq",
                    f".[] | select(.tag_name == {json.dumps(tag)}) | @json")
        releases = [json.loads(line) for line in lines.splitlines()]
    if len(releases) != 1:
        raise ValueError("Expected exactly one alpha draft release")
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
                raise ValueError(f"Draft asset conflicts with verified candidate: {path.name}")
        else:
            run("gh", "release", "upload", tag, str(path), "--repo", "merklejerk/holtburger")
    print(f"Draft staged for final user verification: {release['html_url']}")


def flatpak_manifest(notices: Path, output: Path) -> None:
    """Extend the shared recipe for alpha without changing the main nightly's inputs."""
    recipe = ROOT / "apps/holtburger-cli/dist/io.github.merklejerk.holtburger-cli.yaml"
    manifest = json.loads(run("flatpak-builder", "--show-manifest", str(recipe)))
    module, = manifest["modules"]
    for source in module["sources"]:
        source["path"] = str((recipe.parent / source["path"]).resolve())
    for path in (notices.resolve(), ROOT / "LICENSE.md"):
        if not path.stat().st_size:
            raise ValueError(f"Empty Flatpak notice input: {path}")
        module["sources"].append({"type": "file", "path": str(path)})
        module["build-commands"].append(
            f"install -Dm644 {path.name} /app/share/licenses/holtburger/{path.name}"
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    write_json(output, manifest)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("plan")
    build = commands.add_parser("assemble")
    build.add_argument("--target", choices=[target.triple for target in TARGETS], required=True)
    build.add_argument("--package", type=Path, required=True)
    build.add_argument("--content", type=Path, required=True)
    build.add_argument("--notices", type=Path, required=True)
    build.add_argument("--output", type=Path, required=True)
    inspect = commands.add_parser("verify")
    inspect.add_argument("suite", type=Path)
    describe = commands.add_parser("manifest")
    describe.add_argument("artifacts", type=Path)
    upload = commands.add_parser("stage")
    upload.add_argument("artifacts", type=Path)
    upload.add_argument("tag")
    flatpak = commands.add_parser("flatpak-manifest")
    flatpak.add_argument("--notices", type=Path, required=True)
    flatpak.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    if arguments.command == "plan":
        plan()
    elif arguments.command == "assemble":
        assemble(arguments)
    elif arguments.command == "verify":
        print(json.dumps(verify_suite(arguments.suite)))
    elif arguments.command == "manifest":
        manifest(arguments.artifacts.resolve())
    elif arguments.command == "flatpak-manifest":
        flatpak_manifest(arguments.notices, arguments.output)
    else:
        stage(arguments.artifacts.resolve(), arguments.tag)


if __name__ == "__main__":
    main()
