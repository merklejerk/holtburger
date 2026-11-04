"""Resolve immutable release identities and verify disposable nightly preparation."""

from dataclasses import dataclass
import json
from pathlib import Path
import re
import subprocess
import tomllib
from typing import Literal

from release_version import bump, check_versions, validate_channel_version


RELEASE_BRANCH = "main"
VERSION_FILES = (
    "Cargo.toml", "Cargo.lock", "apps/holtburger-3d/package.json",
    "apps/holtburger-3d/package-lock.json",
)
DistributionKind = Literal["release", "nightly"]


def git(root: Path, *arguments: str) -> str:
    """Capture Git output without hiding a failed identity/provenance check."""
    return subprocess.check_output(["git", *arguments], cwd=root, text=True).strip()


def validate_base_version(version: str) -> None:
    """Checked-in beta versions are canonical unsuffixed zero-major SemVers."""
    validate_channel_version("beta", version)


@dataclass(frozen=True)
class Distribution:
    """Identity shared by build preparation, packaging, and publication."""

    kind: DistributionKind  # Selects preparation, publication, and update eligibility.
    version: str  # Effective package version, including the nightly suffix when present.
    commit: str  # Original immutable source, before temporary version preparation.

    def __post_init__(self) -> None:
        if re.fullmatch(r"[0-9a-f]{40}", self.commit) is None:
            raise ValueError("Distribution requires a full lowercase source SHA")
        if self.kind == "release":
            validate_base_version(self.version)
        elif self.kind == "nightly":
            suffix = f"-nightly-{self.commit}"
            if not self.version.endswith(suffix):
                raise ValueError("Nightly version must end with its full source SHA")
            validate_base_version(self.version.removesuffix(suffix))
        else:
            raise ValueError("Distribution kind must be release or nightly")

    @property
    def tag(self) -> str:
        """Immutable GitHub release tag; never a floating nightly alias."""
        return f"v{self.version}"


def source_distribution(root: Path, kind: DistributionKind) -> Distribution:
    """Resolve an identity from the original source documents, even after preparation."""
    commit = git(root, "rev-parse", "HEAD")
    base = tomllib.loads(git(root, "show", f"{commit}:Cargo.toml"))["workspace"]["package"]["version"]
    validate_base_version(base)
    version = base if kind == "release" else f"{base}-nightly-{commit}"
    return Distribution(kind, version, commit)


def validate_tag(root: Path, distribution: Distribution) -> None:
    """Accept lightweight/annotated tags only at the expected reachable source commit."""
    if git(root, "rev-parse", f"refs/tags/{distribution.tag}^{{commit}}") != distribution.commit:
        raise ValueError("Release tag points to another source commit")
    subprocess.run(
        ["git", "merge-base", "--is-ancestor", distribution.commit, f"origin/{RELEASE_BRANCH}"],
        cwd=root, check=True,
    )


def validate_prepared_source(root: Path, distribution: Distribution) -> None:
    """Permit only the exact generated nightly version delta, including both lockfiles."""
    if source_distribution(root, distribution.kind) != distribution:
        raise ValueError("Distribution differs from the checked-out source identity")
    if git(root, "diff", "--cached", "--name-only"):
        raise ValueError("Build preparation cannot contain staged changes")
    untracked = git(root, "ls-files", "--others", "--exclude-standard")
    if untracked:
        raise ValueError(f"Build preparation contains untracked source files:\n{untracked}")
    if git(root, "diff", "HEAD", "--summary"):
        raise ValueError("Build preparation cannot change file modes or paths")
    changed = set(git(root, "diff", "HEAD", "--name-only").splitlines())
    expected = set(VERSION_FILES) if distribution.kind == "nightly" else set()
    if changed != expected:
        raise ValueError("Build preparation differs from the expected version files")
    workspace = tomllib.loads(git(root, "show", "HEAD:Cargo.toml"))
    names = {
        tomllib.loads(git(root, "show", f"HEAD:{member}/Cargo.toml"))["package"]["name"]
        for member in workspace["workspace"]["members"]
    }
    for path in VERSION_FILES:
        decode = tomllib.loads if path.endswith((".toml", ".lock")) else json.loads
        original = decode(git(root, "show", f"HEAD:{path}"))
        actual = decode((root / path).read_text())
        if path == "Cargo.toml":
            original["workspace"]["package"]["version"] = distribution.version
        elif path == "Cargo.lock":
            for package in original["package"]:
                if package["name"] in names:
                    package["version"] = distribution.version
        else:
            original["version"] = distribution.version
            if path.endswith("package-lock.json"):
                original["packages"][""]["version"] = distribution.version
        if original != actual:
            raise ValueError(f"Build preparation changes more than suite versions: {path}")
    if check_versions(root) != distribution.version:
        raise ValueError("Prepared package version differs from the distribution")


def prepare_source(root: Path, distribution: Distribution) -> None:
    """Stamp disposable nightly checkouts; repeated preparation must verify the same delta."""
    if source_distribution(root, distribution.kind) != distribution:
        raise ValueError("Distribution differs from the checked-out source identity")
    if git(root, "status", "--porcelain", "--ignore-submodules=none"):
        # A retry may reuse a prepared checkout, but never accept an unrelated dirty tree.
        validate_prepared_source(root, distribution)
        return
    check_versions(root)
    if distribution.kind == "nightly":
        bump(distribution.version, root)
    validate_prepared_source(root, distribution)
