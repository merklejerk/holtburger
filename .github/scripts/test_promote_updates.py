"""Update feeds are projections of complete, accepted published release inventories."""

import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from candidate_release import INSTALLER_TARGETS, PRODUCTS, TARGETS
from cli_content_input import CONTENT_FILES
from promote_updates import generate_feeds


def release_fixture(version: str, channel: str, commit: str, identifier: int) -> tuple[dict, bytes]:
    """A complete suite manifest and GitHub release, using synthetic immutable payload digests."""
    checksum = "a" * 64
    identity = {"version": version, "channel": channel, "commit": commit,
                "modified": False, "noticesSha256": checksum}
    content = {"contentSha256": checksum, "contentFiles": {name: checksum for name in CONTENT_FILES}}
    native = []
    for product in PRODUCTS:
        for target in TARGETS:
            extension = ".tar.gz" if target.platform == "linux" else ".zip"
            record = {**identity, "product": product, "target": target.triple,
                      "archive": f"holtburger-{product}-{version}-{target.triple}{extension}", "sha256": checksum}
            if product == "cli":
                record.update(content)
            native.append(record)
    flatpaks = []
    for product in PRODUCTS:
        record = {**identity, "product": product, "target": "x86_64-unknown-linux-gnu",
                  "archive": f"holtburger-{product}-{version}-x86_64.flatpak", "sha256": checksum,
                  "runtime": "org.freedesktop.Platform/x86_64/26.08",
                  "appId": f"io.github.merklejerk.holtburger-{'cli-alpha' if product == 'cli' else '3d-alpha'}"}
        if product == "cli":
            record.update(content)
        flatpaks.append(record)
    installers = [{**identity, "product": "3d", "target": installer.triple,
                   "format": installer.format, "installer": installer.filename(version),
                   "nativeArchiveSha256": checksum, "sha256": checksum} for installer in INSTALLER_TARGETS]
    assets = [{"name": "THIRD_PARTY_NOTICES.html", "sha256": checksum}]
    assets.extend({"name": record["archive"], "sha256": checksum} for record in [*native, *flatpaks])
    assets.extend({"name": record["installer"], "sha256": checksum} for record in installers)
    manifest = {"schemaVersion": 1, **{key: identity[key] for key in ("version", "channel", "commit", "noticesSha256")},
                "native": native, "flatpaks": flatpaks, "installers": installers, "assets": assets}
    data = json.dumps(manifest).encode()
    public = [{"name": asset["name"], "state": "uploaded", "size": 1, "digest": f"sha256:{checksum}"} for asset in assets]
    public.extend([
        {"id": identifier, "name": "release-manifest.json", "state": "uploaded", "size": len(data),
         "digest": f"sha256:{hashlib.sha256(data).hexdigest()}"},
        {"name": "SHA256SUMS", "state": "uploaded", "size": 1, "digest": None},
    ])
    return {"draft": False, "tag_name": f"candidate-20261103-{commit[:9]}", "assets": public}, data


class UpdatePromotionTests(unittest.TestCase):
    """Regeneration selects by SemVer and validates all advertised product coverage."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.output = Path(temporary.name) / "site"

    def test_beta_also_reaches_alpha_regardless_of_publication_order(self):
        alpha, alpha_data = release_fixture("0.1.4-alpha.10", "alpha", "a" * 40, 1)
        beta, beta_data = release_fixture("0.1.4", "beta", "b" * 40, 2)
        documents = {1: alpha_data, 2: beta_data}
        for releases in ([beta, alpha], [alpha, beta]):
            generate_feeds(releases, documents.__getitem__, self.output)
            for channel in ("alpha", "beta"):
                feed = json.loads((self.output / f"updates/{channel}.json").read_text())
                self.assertEqual(feed, {"schemaVersion": 1, "version": "0.1.4", "tag": beta["tag_name"]})
        self.assertTrue((self.output / "index.html").is_file())

    def test_cli_nightly_and_drafts_do_not_announce_or_require_manifests(self):
        draft, _ = release_fixture("0.2.0", "beta", "a" * 40, 1)
        draft["draft"] = True
        nightly = {"draft": False, "tag_name": "nightly"}
        def unexpected(_identifier):
            self.fail("Ignored release must not request its manifest")
        generate_feeds([draft, nightly], unexpected, self.output)
        self.assertEqual(list((self.output / "updates").iterdir()), [])

    def test_reconciliation_removes_withdrawn_beta_and_restores_alpha_selection(self):
        alpha, alpha_data = release_fixture("0.1.4-alpha.1", "alpha", "a" * 40, 1)
        beta, beta_data = release_fixture("0.1.4", "beta", "b" * 40, 2)
        documents = {1: alpha_data, 2: beta_data}
        generate_feeds([alpha, beta], documents.__getitem__, self.output)
        generate_feeds([alpha], documents.__getitem__, self.output)
        self.assertFalse((self.output / "updates/beta.json").exists())
        self.assertEqual(json.loads((self.output / "updates/alpha.json").read_text())["version"], "0.1.4-alpha.1")

    def test_incomplete_or_mismatched_public_assets_leave_prior_output_intact(self):
        release, data = release_fixture("0.1.4", "beta", "a" * 40, 1)
        generate_feeds([release], lambda _identifier: data, self.output)
        prior = (self.output / "updates/beta.json").read_bytes()
        for mutation, message in (("missing", "inventory"), ("digest", "digest differs"), ("empty", "not ready")):
            broken = copy.deepcopy(release)
            if mutation == "missing":
                broken["assets"].pop(0)
            elif mutation == "digest":
                broken["assets"][0]["digest"] = f"sha256:{'b' * 64}"
            else:
                broken["assets"][0]["size"] = 0
            with self.subTest(mutation=mutation), self.assertRaisesRegex(ValueError, message):
                generate_feeds([broken], lambda _identifier: data, self.output)
            self.assertEqual((self.output / "updates/beta.json").read_bytes(), prior)

    def test_manifest_requires_all_targets_and_matching_tag_commit(self):
        release, data = release_fixture("0.1.4", "beta", "a" * 40, 1)
        document = json.loads(data)
        document["native"].pop()
        with self.assertRaisesRegex(ValueError, "every native target"):
            generate_feeds([release], lambda _identifier: json.dumps(document).encode(), self.output)
        release["tag_name"] = "candidate-20261103-bbbbbbbbb"
        with self.assertRaisesRegex(ValueError, "does not match"):
            generate_feeds([release], lambda _identifier: data, self.output)

    def test_duplicate_versions_and_missing_manifest_fail_loudly(self):
        release, data = release_fixture("0.1.4", "beta", "a" * 40, 1)
        with self.assertRaisesRegex(ValueError, "Multiple published candidates"):
            generate_feeds([release, release], lambda _identifier: data, self.output)
        release["assets"] = []
        with self.assertRaisesRegex(ValueError, "exactly one release manifest"):
            generate_feeds([release], lambda _identifier: data, self.output)
