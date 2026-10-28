#!/usr/bin/env python3
"""Assemble, inspect, and stage an alpha bundle without publishing it."""

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
    NativeTarget("aarch64-apple-darwin", "macos-14", "darwin", "arm64"),
)
SCRIPTS = ("fighter.js", "mage.js", "mage.data.json", "mage.data.bin")
TOOLS = ("holtburger-cli", "dat2hba", "dat-tool")
APP = ROOT / "apps/holtburger-3d"
THREED_FLATPAK_RECIPE = ROOT / ".github/flatpak/io.github.merklejerk.holtburger-alpha.json"
CLI_FLATPAK_RECIPE = ROOT / "apps/holtburger-cli/dist/io.github.merklejerk.holtburger-cli-alpha.yaml"
CLI_NIGHTLY_FLATPAK_RECIPE = ROOT / "apps/holtburger-cli/dist/io.github.merklejerk.holtburger-cli.yaml"
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


def plan(product: str, target: str, purpose: str) -> None:
    version = check_versions()
    commit, modified = source_identity()
    if modified:
        raise ValueError("Release planning requires a clean source checkout")
    tagged = os.environ.get("GITHUB_REF_TYPE") == "tag"
    candidate = tagged or purpose == "candidate"
    if candidate and (product != "both" or target != "all"):
        raise ValueError("Alpha candidates require both products and every supported native target")
    tag = ""
    if os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch" and candidate:
        if os.environ["GITHUB_REF"] != "refs/heads/3d-next":
            raise ValueError("Run the alpha candidate workflow on the 3d-next branch")
        # Preserve upstream's source-owned date so later-day retries reuse the same candidate.
        commit_date = run("git", "show", "-s", "--format=%cs", commit).replace("-", "")
        tag = f"alpha-{commit_date}-{commit[:9]}"
    elif tagged:
        tag = os.environ["GITHUB_REF_NAME"]
    if tag:
        validate_tag(tag, commit)
        subprocess.run(
            ["git", "merge-base", "--is-ancestor", commit, "origin/3d-next"],
            cwd=ROOT, check=True,
        )
    selected = [entry for entry in TARGETS if target == "all" or entry.triple == target]
    result = {
        "version": version, "commit": commit, "product": product, "tag": tag,
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
        if (renderer["version"], renderer["revision"], renderer["modified"]) != (
            info["version"], info["commit"][:8], info["modified"]
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


def assemble(arguments) -> None:
    target = target_named(arguments.target)
    if target.platform != sys.platform:
        raise ValueError("Build each bundle on its native platform")
    version = check_versions()
    commit, modified = source_identity()
    product = arguments.product
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
            "version": version, "commit": commit, "modified": modified,
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
                shutil.copy2(ROOT / "scripts" / script, bundle / "scripts" / script)
            (bundle / "content").mkdir()
            for filename in CONTENT_FILES:
                shutil.copy2(content / filename, bundle / "content" / filename)
            info.update({"contentSha256": expected,
                         "contentFiles": {filename: digest(content / filename) for filename in CONTENT_FILES}})
        else:
            shutil.copytree(arguments.package, bundle / "h3d", symlinks=True)
            if digest(executable_paths(bundle, target, product)[-1]) != digest(binaries / f"holtburger-3d-host{suffix}"):
                raise ValueError("Forge bundled a different Rust host than the target build")
        shutil.copy2(ROOT / f"docs/ALPHA_{product.upper()}_QUICKSTART.md", bundle / "QUICKSTART.md")
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


def manifest(artifacts: Path) -> list[Path]:
    """Require both products on every release target before recording public assets."""
    version = check_versions()
    commit, modified = source_identity()
    if modified:
        raise ValueError("Refusing release metadata for a modified source checkout")
    notices = artifacts / "THIRD_PARTY_NOTICES.html"
    if not notices.stat().st_size:
        raise ValueError("Empty dependency notices")
    notices_digest = digest(notices)
    identity = {"commit": commit, "version": version, "modified": False,
                "noticesSha256": notices_digest}
    content_digest = json.loads(CLI_CONTENT_DESCRIPTOR.read_text())["sha256"]
    records, flatpaks, files = [], [], [notices]
    for product in PRODUCTS:
        for target in TARGETS:
            record = json.loads((artifacts / f"metadata-{product}-{target.triple}.json").read_text())
            expected = {**identity, "product": product, "target": target.triple}
            if any(record[key] != value for key, value in expected.items()):
                raise ValueError(f"Release identity mismatch for {product}/{target.triple}")
            if product == "cli":
                if record["contentSha256"] != content_digest or set(record["contentFiles"]) != set(CONTENT_FILES):
                    raise ValueError(f"CLI content identity mismatch for {target.triple}")
            path = artifacts / record["archive"]
            extension = ".tar.gz" if target.platform == "linux" else ".zip"
            expected_name = f"holtburger-{product}-{version}-{target.triple}{extension}"
            if record["archive"] != expected_name or digest(path) != record["sha256"]:
                raise ValueError(f"Release archive digest/path mismatch: {product}/{target.triple}")
            files.append(path)
            records.append(record)
    cli_records = [record for record in records if record["product"] == "cli"]
    if any(record["contentFiles"] != cli_records[0]["contentFiles"] for record in cli_records):
        raise ValueError("CLI native targets contain different content companions")
    runtime = flatpak_runtime_ref(json.loads(THREED_FLATPAK_RECIPE.read_text()))
    app_ids = {"cli": "io.github.merklejerk.holtburger-cli-alpha",
               "3d": "io.github.merklejerk.holtburger-alpha"}
    for product in PRODUCTS:
        native = next(record for record in records if record["product"] == product and record["target"] == "x86_64-unknown-linux-gnu")
        record = json.loads((artifacts / f"metadata-{product}-flatpak.json").read_text())
        expected = {**identity, "product": product, "target": native["target"],
                    "appId": app_ids[product], "runtime": runtime}
        if product == "cli":
            expected.update({"contentSha256": content_digest, "contentFiles": native["contentFiles"]})
        if any(record[key] != value for key, value in expected.items()):
            raise ValueError(f"Flatpak release identity mismatch: {product}")
        expected_name = f"holtburger-{product}-{version}-x86_64.flatpak"
        path = artifacts / expected_name
        if record["archive"] != expected_name or not path.stat().st_size or digest(path) != record["sha256"]:
            raise ValueError(f"Flatpak release archive mismatch: {product}")
        files.append(path)
        flatpaks.append(record)
    description = artifacts / "release-manifest.json"
    write_json(description, {
        "version": version, "commit": commit, "noticesSha256": notices_digest,
        "native": records, "flatpaks": flatpaks,
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


def flatpak_recipe_path(product: str, *, nightly_cli: bool = False) -> Path:
    """Keep main's CLI installation separate from the alpha products."""
    if nightly_cli:
        if product != "cli":
            raise ValueError("The nightly CLI recipe requires a CLI native package")
        return CLI_NIGHTLY_FLATPAK_RECIPE
    return CLI_FLATPAK_RECIPE if product == "cli" else THREED_FLATPAK_RECIPE


def flatpak_recipe(product: str, *, nightly_cli: bool = False) -> dict:
    """Expand one product recipe, using the alpha's shared Freedesktop runtime generation."""
    path = flatpak_recipe_path(product, nightly_cli=nightly_cli)
    recipe = json.loads(run("flatpak-builder", "--show-manifest", str(path)))
    runtime = json.loads(THREED_FLATPAK_RECIPE.read_text())
    for key in ("runtime", "runtime-version", "sdk"):
        recipe[key] = runtime[key]
    return recipe


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


def flatpak_manifest(native: Path, output: Path, *, nightly_cli: bool = False) -> None:
    """Package one inspected native inventory without rebuilding or duplicating its receipt."""
    info = verify_bundle(native)
    require_flatpak_candidate(info)
    product = info["product"]
    recipe_path = flatpak_recipe_path(product, nightly_cli=nightly_cli)
    recipe = flatpak_recipe(product, nightly_cli=nightly_cli)
    module = next(module for module in recipe["modules"] if module["name"] == f"holtburger-{product}")
    payload = next(source for source in module["sources"] if source.get("dest") == "bundle")
    payload["path"] = str(native.resolve())
    for dependency in recipe["modules"]:
        for source in dependency["sources"]:
            if "path" in source:
                source["path"] = str((recipe_path.parent / source["path"]).resolve())
    output.parent.mkdir(parents=True, exist_ok=True)
    write_json(output, recipe)


def prepare_flatpak(artifacts: Path, product: str, output: Path, *, nightly_cli: bool = False) -> Path:
    """Extract the selected verified Linux archive as its Flatpak's immutable input."""
    record = json.loads((artifacts / f"metadata-{product}-x86_64-unknown-linux-gnu.json").read_text())
    require_flatpak_candidate(record)
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
    flatpak_manifest(native, output, nightly_cli=nightly_cli)
    return native.resolve()


def record_flatpak(files: Path, native: Path, bundle: Path, output: Path) -> None:
    """Bind installed inventory and bytes to the selected native product and runtime."""
    info = verify_bundle(native)
    installed = files / "lib/holtburger"
    if json.loads((installed / "build-info.json").read_text()) != info:
        raise ValueError("Installed Flatpak identity differs from its native input")
    require_flatpak_candidate(info)
    expected = {path.relative_to(native) for path in native.rglob("*")}
    actual = {path.relative_to(installed) for path in installed.rglob("*")}
    if actual != expected:
        raise ValueError("Installed Flatpak inventory differs from its native input")
    for relative in expected:
        source, destination = native / relative, installed / relative
        if source.is_symlink():
            if not destination.is_symlink() or os.readlink(source) != os.readlink(destination):
                raise ValueError(f"Installed Flatpak link differs: {relative}")
        elif source.is_file():
            if destination.is_symlink() or digest(source) != digest(destination):
                raise ValueError(f"Installed Flatpak file differs: {relative}")
    # Exact byte/link equality already binds the architecture and package resources. Check the
    # remaining install-specific executable mode without repeating renderer/archive inspection.
    for executable in executable_paths(installed, target_named(info["target"]), info["product"]):
        if not os.access(executable, os.X_OK):
            raise ValueError(f"Installed Flatpak executable has lost permissions: {executable}")
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
    planning.add_argument("--purpose", choices=("candidate", "diagnostic"), default="candidate")
    planning.add_argument("--product", choices=("both", *PRODUCTS), default="both")
    planning.add_argument("--target", choices=("all", *(entry.triple for entry in TARGETS)), default="all")
    tag = commands.add_parser("create-tag")
    tag.add_argument("tag")
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
    prepare.add_argument("--nightly-cli", action="store_true",
                         help="Keep the main CLI Flatpak identity instead of the alpha identity")
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
    elif arguments.command == "create-tag":
        create_tag(arguments.tag)
    elif arguments.command == "assemble":
        assemble(arguments)
    elif arguments.command == "verify":
        print(json.dumps(verify_bundle(arguments.bundle)))
    elif arguments.command == "manifest":
        manifest(arguments.artifacts.resolve())
    elif arguments.command == "flatpak-manifest":
        flatpak_manifest(arguments.native.resolve(), arguments.output)
    elif arguments.command == "prepare-flatpak":
        print(prepare_flatpak(arguments.artifacts.resolve(), arguments.product, arguments.output.resolve(),
                              nightly_cli=arguments.nightly_cli))
    elif arguments.command == "record-flatpak":
        record_flatpak(arguments.files.resolve(), arguments.native.resolve(),
                       arguments.bundle.resolve(), arguments.output)
    else:
        stage(arguments.artifacts.resolve(), arguments.tag)


if __name__ == "__main__":
    main()
