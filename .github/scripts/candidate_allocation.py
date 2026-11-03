"""Allocate a suite version once, before any candidate build starts."""

from dataclasses import dataclass
import json
from pathlib import Path
import re
import subprocess
import tomllib
from typing import Callable

from semver import Version

from release_version import check_versions, release_channel, validate_channel_version


# The beta merge changes this source policy; the default branch is not an implicit source.
RELEASE_BRANCH = "3d-next"
VERSION_FILES = (
    "Cargo.toml", "Cargo.lock", "apps/holtburger-3d/package.json",
    "apps/holtburger-3d/package-lock.json",
)


@dataclass(frozen=True)
class CandidateAllocation:
    """Identity consumed by every validation, build and staging job."""

    version: str  # Suite SemVer recorded in the candidate commit.
    commit: str  # Immutable version commit, not the dispatch event's source commit.
    tag: str  # Immutable candidate identity; intentionally outside SemVer tag publishers.


def git(root: Path, *arguments: str) -> str:
    """Run Git in the selected checkout and preserve every command failure."""
    return subprocess.check_output(["git", *arguments], cwd=root, text=True).strip()


def candidate_tag(root: Path, commit: str) -> str:
    """Source date and source hash make allocation retries independent of wall time."""
    date = git(root, "show", "-s", "--format=%cs", commit).replace("-", "")
    return f"candidate-{date}-{commit[:9]}"


def version_at(root: Path, commit: str) -> str:
    """Read the suite owner at an immutable Git object without checking it out."""
    return tomllib.loads(git(root, "show", f"{commit}:Cargo.toml"))["workspace"]["package"]["version"]


def validate_version_commit(root: Path, source: str, commit: str, version: str) -> None:
    """A retry can reuse only the same source with a mechanically changed suite version."""
    if git(root, "rev-list", "--parents", "-n", "1", commit).split() != [commit, source]:
        raise ValueError("Candidate version is already allocated from a different source")
    changed = set(git(root, "diff", "--name-only", source, commit).splitlines())
    if changed != set(VERSION_FILES):
        raise ValueError("Candidate allocation must change exactly the suite version files")
    workspace = tomllib.loads(git(root, "show", f"{source}:Cargo.toml"))
    workspace_names = {
        tomllib.loads(git(root, "show", f"{source}:{member}/Cargo.toml"))["package"]["name"]
        for member in workspace["workspace"]["members"]
    }
    for path in VERSION_FILES:
        decode = tomllib.loads if path.endswith((".toml", ".lock")) else json.loads
        original = decode(git(root, "show", f"{source}:{path}"))
        allocated = decode(git(root, "show", f"{commit}:{path}"))
        if path == "Cargo.toml":
            original["workspace"]["package"]["version"] = version
        elif path == "Cargo.lock":
            for package in original["package"]:
                if package["name"] in workspace_names:
                    package["version"] = version
        else:
            original["version"] = version
            if path.endswith("package-lock.json"):
                original["packages"][""]["version"] = version
        if original != allocated:
            raise ValueError(f"Candidate allocation contains changes beyond the suite version: {path}")


def recorded_candidates(root: Path) -> list[CandidateAllocation]:
    """Read existing allocations, including frozen alpha versions, without moving the checkout."""
    allocations: list[CandidateAllocation] = []
    for tag in git(root, "tag", "--list", "candidate-*", "alpha-*").splitlines():
        if re.fullmatch(r"(?:candidate|alpha)-[0-9]{8}-[0-9a-f]{7,40}", tag) is None:
            continue
        if tag.startswith("candidate-") and git(root, "cat-file", "-t", f"refs/tags/{tag}") != "commit":
            raise ValueError("Candidate allocations require immutable lightweight tags")
        commit = git(root, "rev-parse", f"{tag}^{{commit}}")
        allocated_version = version_at(root, commit)
        allocations.append(CandidateAllocation(allocated_version, commit, tag))
    return allocations


def validate_tagged_candidate(root: Path, tag: str, commit: str) -> None:
    """Tag-triggered retries still require one recorded version-only allocation."""
    if candidate_tag(root, commit) != tag:
        raise ValueError("Tagged candidate differs from its allocated source identity")
    parents = git(root, "show", "-s", "--format=%P", commit).split()
    if len(parents) != 1:
        raise ValueError("Candidate version commit must have exactly one source parent")
    version = version_at(root, commit)
    validate_version_commit(root, parents[0], commit, version)
    validate_channel_version(release_channel(root), version)
    if Version.parse(version) <= Version.parse(version_at(root, parents[0])):
        raise ValueError("Candidate version must increase from its source parent")
    if [item.tag for item in recorded_candidates(root) if item.version == version] != [tag]:
        raise ValueError("Tagged candidate must uniquely own its suite version")


def allocate_candidate(
    root: Path, version: str, apply_version: Callable[[str], None],
) -> CandidateAllocation:
    """Record a version-only commit and tag in one fast-forward push, or reuse a retry."""
    validate_channel_version(release_channel(root), version)
    if git(root, "status", "--porcelain", "--ignore-submodules=none"):
        raise ValueError("Candidate allocation requires a clean source checkout")
    source = git(root, "rev-parse", "HEAD")
    git(root, "fetch", "origin", f"refs/heads/{RELEASE_BRANCH}:refs/remotes/origin/{RELEASE_BRANCH}", "--tags")
    allocations = recorded_candidates(root)
    matches = [item for item in allocations if item.version == version]
    if matches:
        if len(matches) != 1 or not matches[0].tag.startswith("candidate-"):
            raise ValueError("Requested version has ambiguous or historical candidate allocations")
        existing = matches[0]
        validate_version_commit(root, source, existing.commit, version)
        if candidate_tag(root, existing.commit) != existing.tag:
            raise ValueError("Existing candidate tag differs from its source identity")
        subprocess.run(["git", "merge-base", "--is-ancestor", existing.commit,
                        f"origin/{RELEASE_BRANCH}"], cwd=root, check=True)
        git(root, "checkout", "--detach", existing.commit)
        check_versions(root)
        return existing
    if source != git(root, "rev-parse", f"origin/{RELEASE_BRANCH}"):
        raise ValueError("Release branch advanced after dispatch; request a candidate from its current head")
    previous = [check_versions(root), *(item.version for item in allocations)]
    if any(Version.parse(version) <= Version.parse(value) for value in previous):
        raise ValueError("Fresh candidate version must be greater than every allocated and source version")
    apply_version(version)
    if check_versions(root) != version:
        raise ValueError("Version bump did not record the requested suite version")
    if set(git(root, "diff", "--name-only").splitlines()) != set(VERSION_FILES):
        raise ValueError("Version bump must modify exactly the suite version files")
    git(root, "add", "--", *VERSION_FILES)
    git(root, "-c", "user.name=github-actions[bot]", "-c",
        "user.email=41898282+github-actions[bot]@users.noreply.github.com",
        "commit", "-m", f"Release candidate {version}")
    commit = git(root, "rev-parse", "HEAD")
    validate_version_commit(root, source, commit, version)
    tag = candidate_tag(root, commit)
    git(root, "tag", tag, commit)
    # A concurrent branch push rejects both updates; never force or retarget the allocation.
    git(root, "push", "--atomic", "origin", f"HEAD:refs/heads/{RELEASE_BRANCH}", f"refs/tags/{tag}")
    return CandidateAllocation(version, commit, tag)
