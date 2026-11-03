"""Exercise allocation against scratch Git repositories, never the project checkout."""

from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from candidate_allocation import CandidateAllocation, RELEASE_BRANCH, allocate_candidate, git, validate_tagged_candidate
from candidate_release import TARGETS, plan
from release_version import bump, check_versions


def write_version(root: Path, version: str) -> None:
    """Minimal consistent Cargo/npm suite fixture, including both lockfile owners."""
    (root / "Cargo.toml").write_text(
        f'[workspace]\nmembers = ["member"]\n[workspace.package]\nversion = "{version}"\n'
    )
    (root / "Cargo.lock").write_text(f'[[package]]\nname = "member"\nversion = "{version}"\n')
    app = root / "apps/holtburger-3d"
    app.mkdir(parents=True, exist_ok=True)
    (app / "package.json").write_text(json.dumps({"version": version}))
    (app / "package-lock.json").write_text(json.dumps({
        "version": version, "packages": {"": {"version": version}},
    }))


class CandidateAllocationTests(unittest.TestCase):
    """Atomic publication and source identity survive retries and concurrent branch writes."""

    def setUp(self):
        configuration = patch.dict(os.environ, {"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull})
        configuration.start()
        self.addCleanup(configuration.stop)
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        parent = Path(self.temporary.name)
        self.remote = parent / "remote.git"
        self.root = parent / "source"
        subprocess.run(["git", "init", "--bare", f"--initial-branch={RELEASE_BRANCH}", str(self.remote)],
                       check=True, capture_output=True)
        subprocess.run(["git", "clone", str(self.remote), str(self.root)], check=True, capture_output=True)
        git(self.root, "config", "user.name", "Allocation fixture")
        git(self.root, "config", "user.email", "fixture@example.invalid")
        (self.root / "member").mkdir()
        (self.root / "member/Cargo.toml").write_text('[package]\nname = "member"\nversion.workspace = true\n')
        (self.root / "release").mkdir()
        (self.root / "release/channel.json").write_text(json.dumps("alpha"))
        write_version(self.root, "0.1.4-alpha")
        git(self.root, "add", ".")
        git(self.root, "commit", "-m", "Source fixture")
        git(self.root, "push", "origin", RELEASE_BRANCH)
        self.source = git(self.root, "rev-parse", "HEAD")

    def allocate(self, version: str):
        return allocate_candidate(self.root, version, lambda value: write_version(self.root, value))

    def test_retry_reuses_same_version_commit_and_tag(self):
        first = self.allocate("0.1.4-alpha.1")
        self.assertNotEqual(first.commit, self.source)
        self.assertEqual(check_versions(self.root), first.version)
        self.assertEqual(git(self.root, "rev-parse", f"origin/{RELEASE_BRANCH}"), first.commit)
        self.assertEqual(git(self.root, "rev-parse", first.tag), first.commit)
        git(self.root, "checkout", "--detach", self.source)
        self.assertEqual(self.allocate(first.version), first)

    def test_package_managers_can_allocate_without_a_preexisting_cargo_cache(self):
        # This fixture needs no external dependencies, but exercises the actual npm/Cargo writers.
        (self.root / "member/src").mkdir()
        (self.root / "member/src/lib.rs").write_text("// Allocation fixture.\n")
        lock = self.root / "Cargo.lock"
        lock.write_text("version = 4\n" + lock.read_text())
        app = self.root / "apps/holtburger-3d"
        (app / "package.json").write_text(json.dumps({"name": "holtburger-3d", "version": "0.1.4-alpha"}))
        (app / "package-lock.json").write_text(json.dumps({
            "name": "holtburger-3d", "version": "0.1.4-alpha", "lockfileVersion": 3,
            "requires": True, "packages": {"": {"name": "holtburger-3d", "version": "0.1.4-alpha"}},
        }))
        git(self.root, "add", ".")
        git(self.root, "commit", "-m", "Package manager fixture")
        git(self.root, "push", "origin", RELEASE_BRANCH)
        with patch.dict(os.environ, {"CARGO_HOME": str(self.root.parent / "cargo-cache"),
                                     "npm_config_cache": str(self.root.parent / "npm-cache")}):
            allocated = allocate_candidate(self.root, "0.1.4-alpha.1", lambda value: bump(value, self.root))
        self.assertEqual(check_versions(self.root), allocated.version)

    def test_changed_source_cannot_reuse_a_reserved_version(self):
        first = self.allocate("0.1.4-alpha.1")
        (self.root / "README.md").write_text("new source")
        git(self.root, "add", "README.md")
        git(self.root, "commit", "-m", "Source change")
        git(self.root, "push", "origin", f"HEAD:{RELEASE_BRANCH}")
        with self.assertRaisesRegex(ValueError, "different source"):
            self.allocate(first.version)

    def test_tag_rebuild_requires_unique_version_ownership(self):
        allocated = self.allocate("0.1.4-alpha.1")
        validate_tagged_candidate(self.root, allocated.tag, allocated.commit)
        git(self.root, "tag", "candidate-20261102-" + allocated.commit[:9], allocated.commit)
        with self.assertRaisesRegex(ValueError, "uniquely own"):
            validate_tagged_candidate(self.root, allocated.tag, allocated.commit)

    def test_lower_or_equal_fresh_version_is_rejected(self):
        for version in ("0.1.3", "0.1.4-alpha"):
            with self.subTest(version=version), self.assertRaisesRegex(ValueError, "must be greater"):
                self.allocate(version)

    def test_non_version_changes_are_rejected_before_publication(self):
        def changed(version):
            write_version(self.root, version)
            path = self.root / "Cargo.toml"
            path.write_text(path.read_text() + '\n[profile.release]\nopt-level = 1\n')
        with self.assertRaisesRegex(ValueError, "beyond the suite version"):
            allocate_candidate(self.root, "0.1.4-alpha.1", changed)
        self.assertEqual(git(self.remote, "rev-parse", RELEASE_BRANCH), self.source)
        self.assertEqual(git(self.remote, "tag", "--list"), "")

    def test_concurrent_branch_push_rejects_tag_and_branch_together(self):
        other = self.root.parent / "other"
        subprocess.run(["git", "clone", str(self.remote), str(other)], check=True, capture_output=True)
        def race(version):
            write_version(self.root, version)
            (other / "README.md").write_text("concurrent source")
            git(other, "add", ".")
            git(other, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                "commit", "-m", "Concurrent source")
            git(other, "push", "origin", RELEASE_BRANCH)
        with self.assertRaises(subprocess.CalledProcessError):
            allocate_candidate(self.root, "0.1.4-alpha.1", race)
        self.assertEqual(git(self.remote, "tag", "--list"), "")
        self.assertEqual(git(self.remote, "rev-parse", RELEASE_BRANCH), git(other, "rev-parse", "HEAD"))

    def test_branch_advanced_before_dispatch_rejects_before_bump(self):
        first = self.allocate("0.1.4-alpha.1")
        git(self.root, "checkout", "--detach", self.source)
        with self.assertRaisesRegex(ValueError, "advanced after dispatch"):
            self.allocate("0.1.4-alpha.2")
        self.assertEqual(git(self.remote, "rev-parse", RELEASE_BRANCH), first.commit)


class CandidatePlanTests(unittest.TestCase):
    """The build matrix consumes the allocated source rather than the triggering event."""

    def test_dispatch_emits_the_allocated_commit_for_all_builds(self):
        allocated = CandidateAllocation("0.1.4-alpha.1", "b" * 40, "candidate-20261103-bbbbbbbbb")
        with patch.dict(os.environ, {"GITHUB_REF": f"refs/heads/{RELEASE_BRANCH}"}, clear=True), \
             patch("candidate_release.source_identity", return_value=("a" * 40, False)), \
             patch("candidate_release.allocate_candidate", return_value=allocated), \
             redirect_stdout(io.StringIO()) as output:
            plan("both", "all", "candidate", allocated.version)
        result = json.loads(output.getvalue())
        self.assertEqual(result["commit"], allocated.commit)
        self.assertEqual(result["tag"], allocated.tag)
        self.assertEqual(len(result["linux_matrix"]["include"]) + len(result["desktop_matrix"]["include"]), len(TARGETS))

    def test_candidate_dispatch_requires_configured_branch_and_version(self):
        for branch, version, expected in (("main", "0.1.5", "3d-next branch"),
                                          (RELEASE_BRANCH, None, "explicit suite version")):
            with self.subTest(branch=branch, version=version), \
                 patch.dict(os.environ, {"GITHUB_REF": f"refs/heads/{branch}"}, clear=True), \
                 patch("candidate_release.source_identity", return_value=("a" * 40, False)), \
                 self.assertRaisesRegex(ValueError, expected):
                plan("both", "all", "candidate", version)
