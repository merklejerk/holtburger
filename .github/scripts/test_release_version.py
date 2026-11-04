"""Release ordering and explicit audience constraints shared with the desktop client."""

import json
from pathlib import Path
import tempfile
import unittest

from semver import Version

from release_version import ROOT, release_channel, validate_channel_version, validate_version


class ReleaseIdentityTests(unittest.TestCase):
    """Channel selection is source policy; SemVer is the sole ordering contract."""

    def test_shared_precedence_and_invalid_release_versions(self):
        cases = json.loads((ROOT / "release/semver-cases.json").read_text())
        for case in cases["comparisons"]:
            with self.subTest(case=case):
                validate_version(case["left"])
                validate_version(case["right"])
                self.assertEqual(Version.parse(case["left"]).compare(case["right"]), case["expected"])
        for version in cases["invalidReleaseVersions"]:
            with self.subTest(version=version), self.assertRaises(ValueError):
                validate_version(version)

    def test_beta_accepts_only_unsuffixed_zero_major_versions(self):
        validate_channel_version("beta", "0.2.0-nightly-" + "a" * 40, "nightly")
        validate_channel_version("beta", "0.1.4")
        for version in ("0.1.4-beta.1", "1.0.0"):
            with self.subTest(version=version), self.assertRaisesRegex(ValueError, "unsuffixed"):
                validate_channel_version("beta", version)

    def test_channel_is_a_required_explicit_source_value(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "release").mkdir()
            path = root / "release/channel.json"
            for channel in ("beta",):
                path.write_text(json.dumps(channel))
                self.assertEqual(release_channel(root), channel)
            for invalid in ("alpha", "stable", {"channel": "beta"}, None):
                path.write_text(json.dumps(invalid))
                with self.subTest(value=invalid), self.assertRaisesRegex(ValueError, "channel"):
                    release_channel(root)
