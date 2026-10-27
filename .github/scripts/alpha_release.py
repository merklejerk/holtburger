#!/usr/bin/env python3
"""Assemble, inspect, and stage an alpha suite without publishing it."""

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
)
SCRIPTS = ("fighter.js", "mage.js", "mage.data.json", "mage.data.bin")
TOOLS = ("holtburger-cli", "dat2hba", "dat-tool")
APP = ROOT / "apps/holtburger-3d"
SUITE_FLATPAK_RECIPE = ROOT / ".github/flatpak/io.github.merklejerk.holtburger-alpha.json"
TUI_FLATPAK_RECIPE = ROOT / "apps/holtburger-cli/dist/io.github.merklejerk.holtburger-cli.yaml"


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
    tag = ""
    if os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch":
        if os.environ["GITHUB_REF"] != "refs/heads/3d-next":
            raise ValueError("Run the alpha candidate workflow on the 3d-next branch")
        # Source-owned dates keep retries on later days attached to the same candidate.
        commit_date = run("git", "show", "-s", "--format=%cs", commit).replace("-", "")
        tag = f"alpha-{commit_date}-{commit[:9]}"
    elif os.environ.get("GITHUB_REF_TYPE") == "tag":
        tag = os.environ["GITHUB_REF_NAME"]
    if tag:
        validate_tag(tag, commit)
        subprocess.run(
            ["git", "merge-base", "--is-ancestor", commit, "origin/3d-next"],
            cwd=ROOT, check=True,
        )
    result = {
        "version": version, "commit": commit, "tag": tag,
        "linux_matrix": {"include": [asdict(target) for target in TARGETS if target.platform == "linux"]},
        "desktop_matrix": {"include": [asdict(target) for target in TARGETS if target.platform != "linux"]},
    }
    if "GITHUB_OUTPUT" in os.environ:
        with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
            for key, value in result.items():
                encoded = json.dumps(value) if isinstance(value, dict) else value
                output.write(f"{key}={encoded}\n")
    print(json.dumps(result))


def create_tag(tag: str) -> None:
    """Create an immutable lightweight candidate tag; reruns may reuse the same source."""
    commit, modified = source_identity()
    if modified:
        raise ValueError("Candidate tagging requires a clean source checkout")
    validate_tag(tag, commit)
    repository = os.environ["GITHUB_REPOSITORY"]
    ref = f"refs/tags/{tag}"
    matches = json.loads(run("gh", "api", f"repos/{repository}/git/matching-refs/tags/{tag}"))
    existing = [entry for entry in matches if entry["ref"] == ref]
    if existing:
        target = existing[0]["object"]
        if target["type"] != "commit" or target["sha"] != commit:
            raise ValueError("Existing candidate tag does not identify the source commit")
    else:
        run("gh", "api", f"repos/{repository}/git/refs", "--method", "POST",
            "--raw-field", f"ref={ref}", "--raw-field", f"sha={commit}")
    print(f"Candidate tag ready: {tag}")


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
    flatpaks = []
    runtime = flatpak_runtime_ref(json.loads(SUITE_FLATPAK_RECIPE.read_text()))
    linux = next(record for record in records if record["target"] == "x86_64-unknown-linux-gnu")
    for stem in ("holtburger-cli", "holtburger-alpha"):
        record = json.loads((artifacts / f"metadata-{stem}-flatpak.json").read_text())
        if any((record["commit"] != commit, record["version"] != version, record["modified"],
                record["target"] != linux["target"], record["microSha256"] != expected_micro,
                record["microHbaSha256"] != linux["microHbaSha256"],
                record["noticesSha256"] != notices_digest,
                record["appId"] != f"io.github.merklejerk.{stem}", record["runtime"] != runtime)):
            raise ValueError(f"Flatpak release identity mismatch: {stem}")
        expected_name = f"{stem}-{version}-x86_64.flatpak"
        if record["archive"] != expected_name or digest(artifacts / expected_name) != record["sha256"]:
            raise ValueError(f"Flatpak release archive mismatch: {stem}")
        if stem == "holtburger-alpha":
            files.append(artifacts / expected_name)
        flatpaks.append(record)
    description = artifacts / "release-manifest.json"
    write_json(description, {
        "version": version, "commit": commit, "microSha256": expected_micro,
        "noticesSha256": notices_digest,
        "platforms": records,
        "flatpaks": flatpaks,
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
        remote = run("gh", "api", f"repos/merklejerk/holtburger/commits/{tag}", "--jq", ".sha")
        if remote != commit:
            raise ValueError("Remote alpha tag does not point to the candidate commit")
        # The create response owns the draft identity. A fresh list can omit the new draft.
        created = run("gh", "api", "repos/merklejerk/holtburger/releases", "--method", "POST",
                      "--raw-field", f"tag_name={tag}", "--raw-field", f"target_commitish={commit}",
                      "--raw-field", f"name=Holtburger {check_versions()}",
                      "--field", "draft=true", "--field", "prerelease=true",
                      "--field", f"body=@{ROOT / 'docs/ALPHA_RELEASE_NOTES.md'}")
        releases = [json.loads(created)]
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


def tui_flatpak_recipe() -> dict:
    """Use the alpha runtime while preserving the main nightly's independent TUI recipe."""
    recipe = json.loads(run("flatpak-builder", "--show-manifest", str(TUI_FLATPAK_RECIPE)))
    suite = json.loads(SUITE_FLATPAK_RECIPE.read_text())
    for key in ("runtime", "runtime-version", "sdk"):
        recipe[key] = suite[key]
    return recipe


def flatpak_manifest(notices: Path, output: Path) -> None:
    """Extend the shared recipe for alpha without changing the main nightly's inputs."""
    manifest = tui_flatpak_recipe()
    module, = manifest["modules"]
    # Preserve the inspected prebuilt binary; its receipt binds the exact input bytes.
    module.setdefault("build-options", {})["no-debuginfo"] = True
    for source in module["sources"]:
        source["path"] = str((TUI_FLATPAK_RECIPE.parent / source["path"]).resolve())
    for path in (notices.resolve(), ROOT / "LICENSE.md"):
        if not path.stat().st_size:
            raise ValueError(f"Empty Flatpak notice input: {path}")
        module["sources"].append({"type": "file", "path": str(path)})
        module["build-commands"].append(
            f"install -Dm644 {path.name} /app/share/licenses/holtburger/{path.name}"
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    commit, modified = source_identity()
    identity = output.parent / "tui-build-info.json"
    write_json(identity, {
        "commit": commit, "modified": modified, "version": check_versions(),
        "target": "x86_64-unknown-linux-gnu",
        "microSha256": json.loads((ROOT / ".github/alpha-content.json").read_text())["sha256"],
        "microHbaSha256": digest(ROOT / "dats/assets.hba"),
        "noticesSha256": digest(notices),
        "binarySha256": digest(ROOT / "target/release/holtburger-cli"),
    })
    module["sources"].append({"type": "file", "path": str(identity.resolve())})
    module["build-commands"].append(
        "install -Dm644 tui-build-info.json /app/share/holtburger/build-info.json"
    )
    write_json(output, manifest)


def require_flatpak_candidate(info: dict) -> None:
    """Admit only an inspected Linux package with the current candidate identity."""
    if info["target"] != "x86_64-unknown-linux-gnu":
        raise ValueError("The alpha Flatpaks require Linux x86-64 inputs")
    commit, _ = source_identity()
    if (info["commit"], info["version"], info["modified"]) != (commit, check_versions(), False):
        raise ValueError("Flatpak input does not match the clean candidate identity")


def flatpak_runtime_ref(recipe: dict) -> str:
    """Canonical runtime identity for the alpha's supported Linux x86-64 architecture."""
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


def record_tui_flatpak(files: Path, bundle: Path, output: Path) -> None:
    """Bind the TUI artifact to its installed binary, content, notices, and build identity."""
    info = json.loads((files / "share/holtburger/build-info.json").read_text())
    require_flatpak_candidate(info)
    binary = files / "bin/holtburger-cli"
    if executable_architecture(binary) != "x64":
        raise ValueError("Installed TUI Flatpak executable is not x86-64")
    for path, field in ((binary, "binarySha256"),
                        (files / "share/holtburger/dats/assets.hba", "microHbaSha256"),
                        (files / "share/licenses/holtburger/THIRD_PARTY_NOTICES.html", "noticesSha256")):
        if digest(path) != info[field]:
            raise ValueError(f"Installed TUI Flatpak input differs: {path.name}")
    recipe = tui_flatpak_recipe()
    runtime = installed_flatpak_runtime(files, recipe)
    if not bundle.stat().st_size:
        raise ValueError("Empty TUI Flatpak")
    output.parent.mkdir(parents=True, exist_ok=True)
    write_json(output, {**info, "appId": recipe["id"], "runtime": runtime,
                        "archive": bundle.name, "sha256": digest(bundle)})


def suite_flatpak_manifest(suite: Path, output: Path) -> None:
    """Package the already-inspected Linux suite without rebuilding its executables."""
    info = verify_suite(suite)
    require_flatpak_candidate(info)
    manifest = json.loads(run("flatpak-builder", "--show-manifest", str(SUITE_FLATPAK_RECIPE)))
    for dependency in manifest["modules"]:
        for source in dependency["sources"]:
            if "path" in source:
                source["path"] = str((SUITE_FLATPAK_RECIPE.parent / source["path"]).resolve())
    module = next(module for module in manifest["modules"] if module["name"] == "holtburger-alpha")
    module["sources"].append({"type": "dir", "path": str(suite.resolve()), "dest": "suite"})
    module["build-commands"].extend(
        f"ln -s /app/lib/holtburger/{tool} /app/bin/{tool}" for tool in TOOLS
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    write_json(output, manifest)


def prepare_suite_flatpak(artifacts: Path, output: Path) -> Path:
    """Extract only the verified Linux job's archive as the full Flatpak's immutable input."""
    record = json.loads((artifacts / "metadata-x86_64-unknown-linux-gnu.json").read_text())
    require_flatpak_candidate(record)
    archive = artifacts / record["archive"]
    if archive.parent != artifacts or digest(archive) != record["sha256"]:
        raise ValueError("Full-suite Flatpak input archive digest/path mismatch")
    output.parent.mkdir(parents=True, exist_ok=True)
    extracted = Path(tempfile.mkdtemp(prefix="suite-flatpak-input-", dir=output.parent))
    suite = extract_suite(archive, extracted)
    suite_flatpak_manifest(suite, output)
    return suite.resolve()


def record_suite_flatpak(files: Path, suite: Path, bundle: Path, output: Path) -> None:
    """Verify the installed app against its native input before recording bundle identity."""
    info = verify_suite(suite)
    installed = files / "lib/holtburger"
    if verify_suite(installed) != info:
        raise ValueError("Installed Flatpak suite identity differs from its native input")
    require_flatpak_candidate(info)
    expected = {path.relative_to(suite) for path in suite.rglob("*")}
    actual = {path.relative_to(installed) for path in installed.rglob("*")}
    if actual != expected:
        raise ValueError("Installed Flatpak suite inventory differs from its native input")
    for relative in expected:
        source, destination = suite / relative, installed / relative
        if source.is_symlink():
            if not destination.is_symlink() or os.readlink(source) != os.readlink(destination):
                raise ValueError(f"Installed Flatpak suite link differs: {relative}")
        elif source.is_file():
            if destination.is_symlink() or digest(source) != digest(destination):
                raise ValueError(f"Installed Flatpak suite file differs: {relative}")
    if digest(files / "bin/holtburger-3d") != digest(SUITE_FLATPAK_RECIPE.parent / "holtburger-3d"):
        raise ValueError("Installed Flatpak launcher differs from the sandbox wrapper")
    for tool in TOOLS:
        if os.readlink(files / "bin" / tool) != f"/app/lib/holtburger/{tool}":
            raise ValueError(f"Installed Flatpak tool entry differs: {tool}")
    for component in ("zypak", "nickle"):
        original = ROOT / ".github/licenses/native" / component / "LICENSE"
        if digest(files / "share/licenses" / component / "LICENSE") != digest(original):
            raise ValueError(f"Installed Flatpak helper notice needs review: {component}")
    for executable in ("zypak-helper", "zypak-sandbox"):
        if executable_architecture(files / "bin" / executable) != "x64":
            raise ValueError(f"Installed Flatpak helper architecture differs: {executable}")
    recipe = json.loads(SUITE_FLATPAK_RECIPE.read_text())
    runtime = installed_flatpak_runtime(files, recipe)
    if not bundle.stat().st_size:
        raise ValueError("Empty full-suite Flatpak")
    helper = json.loads((SUITE_FLATPAK_RECIPE.parent / "zypak.json").read_text())
    output.parent.mkdir(parents=True, exist_ok=True)
    write_json(output, {
        **info, "appId": recipe["id"], "runtime": runtime,
        "sandboxHelperCommit": helper["sources"][0]["commit"],
        "archive": bundle.name, "sha256": digest(bundle),
    })


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("plan")
    tag = commands.add_parser("create-tag")
    tag.add_argument("tag")
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
    suite_flatpak = commands.add_parser("suite-flatpak-manifest")
    suite_flatpak.add_argument("--suite", type=Path, required=True)
    suite_flatpak.add_argument("--output", type=Path, required=True)
    prepare_flatpak = commands.add_parser("prepare-suite-flatpak")
    prepare_flatpak.add_argument("--artifacts", type=Path, required=True)
    prepare_flatpak.add_argument("--output", type=Path, required=True)
    flatpak_record = commands.add_parser("record-suite-flatpak")
    flatpak_record.add_argument("--files", type=Path, required=True)
    flatpak_record.add_argument("--suite", type=Path, required=True)
    flatpak_record.add_argument("--bundle", type=Path, required=True)
    flatpak_record.add_argument("--output", type=Path, required=True)
    tui_record = commands.add_parser("record-tui-flatpak")
    tui_record.add_argument("--files", type=Path, required=True)
    tui_record.add_argument("--bundle", type=Path, required=True)
    tui_record.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    if arguments.command == "plan":
        plan()
    elif arguments.command == "create-tag":
        create_tag(arguments.tag)
    elif arguments.command == "assemble":
        assemble(arguments)
    elif arguments.command == "verify":
        print(json.dumps(verify_suite(arguments.suite)))
    elif arguments.command == "manifest":
        manifest(arguments.artifacts.resolve())
    elif arguments.command == "flatpak-manifest":
        flatpak_manifest(arguments.notices, arguments.output)
    elif arguments.command == "suite-flatpak-manifest":
        suite_flatpak_manifest(arguments.suite.resolve(), arguments.output)
    elif arguments.command == "prepare-suite-flatpak":
        print(prepare_suite_flatpak(arguments.artifacts.resolve(), arguments.output.resolve()))
    elif arguments.command == "record-suite-flatpak":
        record_suite_flatpak(arguments.files.resolve(), arguments.suite.resolve(),
                             arguments.bundle.resolve(), arguments.output)
    elif arguments.command == "record-tui-flatpak":
        record_tui_flatpak(arguments.files.resolve(), arguments.bundle.resolve(), arguments.output)
    else:
        stage(arguments.artifacts.resolve(), arguments.tag)


if __name__ == "__main__":
    main()
