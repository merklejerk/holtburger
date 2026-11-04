#!/usr/bin/env python3
"""Maintain the suite SemVer in Cargo/npm manifests and their lockfiles."""

import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import tomllib
from typing import Literal

from semver import Version


ROOT = Path(__file__).resolve().parents[2]


def validate_version(version: str) -> None:
    """Require SemVer without unordered build metadata for release allocation."""
    try:
        parsed = Version.parse(version)
    except ValueError as error:
        raise ValueError(f"Invalid suite SemVer: {version}") from error
    if parsed.build is not None:
        raise ValueError("Suite release versions cannot contain build metadata")


def release_channel(root: Path = ROOT) -> Literal["beta"]:
    """Read the source-owned audience without inferring it from version suffixes."""
    channel = json.loads((root / "release/channel.json").read_text())
    if channel != "beta":
        raise ValueError("Release channel must be beta")
    return channel


def validate_channel_version(channel: str, version: str, kind: str = "release") -> None:
    """Beta distributions use an ordinary version or an exact source-stamped nightly."""
    validate_version(version)
    if channel != "beta":
        raise ValueError("Release channel must be beta")
    base = r"0\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)"
    if kind == "release":
        pattern = base
    elif kind == "nightly":
        pattern = base + r"-nightly-[0-9a-f]{40}"
    else:
        raise ValueError("Distribution kind must be release or nightly")
    if re.fullmatch(pattern, version) is None:
        raise ValueError("Beta distributions require an unsuffixed 0.x.y or source-stamped nightly version")


def check_versions(root: Path = ROOT) -> str:
    """Check every suite package and both dependency lockfiles without rewriting anything."""
    manifest = tomllib.loads((root / "Cargo.toml").read_text())
    version = manifest["workspace"]["package"]["version"]
    validate_version(version)
    members = manifest["workspace"]["members"]
    names = set()
    for member in members:
        package = tomllib.loads((root / member / "Cargo.toml").read_text())["package"]
        if package["version"] != {"workspace": True}:
            raise ValueError(f"{member}/Cargo.toml must inherit workspace version")
        names.add(package["name"])
    locked = tomllib.loads((root / "Cargo.lock").read_text())["package"]
    for name in names:
        versions = [entry["version"] for entry in locked if entry["name"] == name]
        if versions != [version]:
            raise ValueError(f"Cargo.lock version mismatch for {name}: {versions}, expected {version}")
    app = root / "apps/holtburger-3d"
    package = json.loads((app / "package.json").read_text())
    lock = json.loads((app / "package-lock.json").read_text())
    for source, actual in [
        ("package.json", package["version"]),
        ("package-lock.json", lock["version"]),
        ("package-lock.json root package", lock["packages"][""]["version"]),
    ]:
        if actual != version:
            raise ValueError(f"h3d {source} is {actual}, expected {version}")
    return version


def bump(version: str, root: Path) -> None:
    """Update the one Cargo version owner, then let npm and Cargo maintain lockfiles."""
    validate_version(version)
    npm = shutil.which("npm")
    if npm is None:
        raise RuntimeError("npm is required to update the Electron version and lockfile")
    path = root / "Cargo.toml"
    original = path.read_text()
    updated, count = re.subn(
        r'(\[workspace\.package\]\n(?:(?!\[).)*?^version\s*=\s*)"[^"]+"',
        lambda match: f'{match.group(1)}"{version}"',
        original,
        flags=re.MULTILINE | re.DOTALL,
    )
    if count != 1:
        raise ValueError("Expected exactly one workspace package version")
    path.write_text(updated)
    subprocess.run(
        [npm, "--prefix", str(root / "apps/holtburger-3d"), "version", version,
         "--no-git-tag-version", "--ignore-scripts", "--allow-same-version"],
        cwd=root, check=True,
    )
    subprocess.run(["cargo", "update", "--workspace", "--offline"], cwd=root, check=True)
    print(check_versions(root))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("check")
    update = commands.add_parser("bump")
    update.add_argument("version")
    arguments = parser.parse_args()
    if arguments.command == "bump":
        bump(arguments.version, ROOT)
    else:
        print(check_versions())


if __name__ == "__main__":
    main()
