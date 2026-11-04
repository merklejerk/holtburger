"""Prove source/version binding and nightly preparation using isolated Git fixtures."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from release_identity import Distribution, git, prepare_source, source_distribution, validate_tag


def write_version(root: Path, version: str) -> None:
    """Write the four suite version owners without package-manager dependencies."""
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


class ReleaseIdentityTests(unittest.TestCase):
    """Real Git objects distinguish original source from generated build inputs."""

    def setUp(self):
        configuration = patch.dict(os.environ, {"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull})
        configuration.start()
        self.addCleanup(configuration.stop)
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        subprocess.run(["git", "init", "--initial-branch=main", str(self.root)], check=True, capture_output=True)
        git(self.root, "config", "user.name", "Release fixture")
        git(self.root, "config", "user.email", "fixture@example.invalid")
        (self.root / "member").mkdir()
        (self.root / "member/Cargo.toml").write_text('[package]\nname = "member"\nversion.workspace = true\n')
        write_version(self.root, "0.2.0")
        git(self.root, "add", ".")
        git(self.root, "commit", "-m", "Source")
        self.commit = git(self.root, "rev-parse", "HEAD")
        git(self.root, "update-ref", "refs/remotes/origin/main", self.commit)

    def test_release_and_nightly_bind_the_same_original_source(self):
        release = source_distribution(self.root, "release")
        nightly = source_distribution(self.root, "nightly")
        self.assertEqual(release, Distribution("release", "0.2.0", self.commit))
        self.assertEqual(release.tag, "v0.2.0")
        self.assertEqual(nightly.version, f"0.2.0-nightly-{self.commit}")
        self.assertEqual(nightly.tag, f"v{nightly.version}")
        for version in (f"0.2.1-nightly-{'a' * 40}", "0.2.0-nightly-abcdef12"):
            with self.subTest(version=version), self.assertRaisesRegex(ValueError, "source SHA"):
                Distribution("nightly", version, self.commit)

    def test_preparation_is_idempotent_and_never_changes_source_commit(self):
        identity = source_distribution(self.root, "nightly")
        with patch("release_identity.bump", side_effect=lambda version, root: write_version(root, version)) as bump:
            prepare_source(self.root, identity)
            prepare_source(self.root, identity)
        bump.assert_called_once_with(identity.version, self.root)
        self.assertEqual(git(self.root, "rev-parse", "HEAD"), self.commit)
        self.assertEqual(source_distribution(self.root, "nightly"), identity)

    def test_preparation_rejects_dependency_changes_and_untracked_files(self):
        identity = source_distribution(self.root, "nightly")
        write_version(self.root, identity.version)
        path = self.root / "Cargo.toml"
        path.write_text(path.read_text() + '\n[profile.release]\nopt-level = 1\n')
        with self.assertRaisesRegex(ValueError, "more than suite versions"):
            prepare_source(self.root, identity)
        write_version(self.root, identity.version)
        (self.root / "unexpected").write_text("untracked input")
        with self.assertRaisesRegex(ValueError, "untracked"):
            prepare_source(self.root, identity)

    def test_real_package_managers_prepare_nightly_without_external_dependencies(self):
        (self.root / "member/src").mkdir()
        (self.root / "member/src/lib.rs").write_text("// Fixture.\n")
        lock = self.root / "Cargo.lock"
        lock.write_text("version = 4\n" + lock.read_text())
        app = self.root / "apps/holtburger-3d"
        (app / "package.json").write_text(json.dumps({"name": "holtburger-3d", "version": "0.2.0"}))
        (app / "package-lock.json").write_text(json.dumps({
            "name": "holtburger-3d", "version": "0.2.0", "lockfileVersion": 3,
            "requires": True, "packages": {"": {"name": "holtburger-3d", "version": "0.2.0"}},
        }))
        git(self.root, "add", ".")
        git(self.root, "commit", "-m", "Package manager fixture")
        identity = source_distribution(self.root, "nightly")
        with tempfile.TemporaryDirectory() as cache, patch.dict(os.environ, {
            "CARGO_HOME": str(Path(cache) / "cargo"), "npm_config_cache": str(Path(cache) / "npm"),
        }):
            prepare_source(self.root, identity)
            prepare_source(self.root, identity)
        self.assertEqual(git(self.root, "rev-parse", "HEAD"), identity.commit)

    def test_release_preparation_requires_a_clean_source(self):
        identity = source_distribution(self.root, "release")
        prepare_source(self.root, identity)
        write_version(self.root, "0.2.1")
        with self.assertRaisesRegex(ValueError, "expected version files"):
            prepare_source(self.root, identity)

    def test_initial_release_can_tag_a_merge_commit(self):
        git(self.root, "checkout", "-b", "topic")
        git(self.root, "commit", "--allow-empty", "-m", "Topic development")
        git(self.root, "checkout", "main")
        git(self.root, "commit", "--allow-empty", "-m", "Main development")
        git(self.root, "merge", "--no-ff", "topic", "-m", "Beta cutover merge")
        identity = source_distribution(self.root, "release")
        git(self.root, "update-ref", "refs/remotes/origin/main", identity.commit)
        git(self.root, "tag", identity.tag)
        prepare_source(self.root, identity)
        validate_tag(self.root, identity)
        self.assertEqual(len(git(self.root, "show", "-s", "--format=%P", identity.commit).split()), 2)

    def test_annotated_tag_survives_main_advancement(self):
        identity = source_distribution(self.root, "release")
        git(self.root, "tag", "-a", identity.tag, "-m", "Release")
        git(self.root, "commit", "--allow-empty", "-m", "Later development")
        git(self.root, "update-ref", "refs/remotes/origin/main", git(self.root, "rev-parse", "HEAD"))
        validate_tag(self.root, identity)
        changed = Distribution("release", "0.2.0", git(self.root, "rev-parse", "HEAD"))
        with self.assertRaisesRegex(ValueError, "another source"):
            validate_tag(self.root, changed)
