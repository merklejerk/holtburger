"""Update feeds are projections of complete, accepted published release inventories."""

import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from release_suite import INSTALLER_TARGETS, PRODUCTS, TARGETS
from cli_content_input import CONTENT_FILES
from promote_updates import generate_feeds


def release_fixture(version: str, channel: str, commit: str, identifier: int, kind: str = "release") -> tuple[dict, bytes]:
    """A complete suite manifest and GitHub release, using synthetic immutable payload digests."""
    checksum = "a" * 64
    identity = {"version": version, "channel": channel, "commit": commit,
                "modified": False, "kind": kind, "noticesSha256": checksum}
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
                  "appId": f"io.github.merklejerk.holtburger-{product}"}
        if product == "cli":
            record.update(content)
        flatpaks.append(record)
    installers = [{**identity, "product": "3d", "target": installer.triple,
                   "format": installer.format, "installer": installer.filename(version),
                   "nativeArchiveSha256": checksum, "sha256": checksum} for installer in INSTALLER_TARGETS]
    assets = [{"name": "THIRD_PARTY_NOTICES.html", "sha256": checksum}]
    assets.extend({"name": record["archive"], "sha256": checksum} for record in [*native, *flatpaks])
    assets.extend({"name": record["installer"], "sha256": checksum} for record in installers)
    manifest = {"schemaVersion": 2, **{key: identity[key] for key in ("version", "channel", "commit", "noticesSha256", "kind")},
                "native": native, "flatpaks": flatpaks, "installers": installers, "assets": assets}
    data = json.dumps(manifest).encode()
    public = [{"name": asset["name"], "state": "uploaded", "size": 1, "digest": f"sha256:{checksum}"} for asset in assets]
    public.extend([
        {"id": identifier, "name": "release-manifest.json", "state": "uploaded", "size": len(data),
         "digest": f"sha256:{hashlib.sha256(data).hexdigest()}"},
        {"name": "SHA256SUMS", "state": "uploaded", "size": 1, "digest": None},
    ])
    return {"draft": False, "tag_name": f"v{version}", "assets": public}, data


class UpdatePromotionTests(unittest.TestCase):
    """Regeneration selects by SemVer and validates all advertised product coverage."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.output = Path(temporary.name) / "site"

    def test_highest_beta_wins_regardless_of_publication_order(self):
        older, older_data = release_fixture("0.2.0", "beta", "a" * 40, 1)
        newer, newer_data = release_fixture("0.2.1", "beta", "b" * 40, 2)
        documents = {1: older_data, 2: newer_data}
        for releases in ([newer, older], [older, newer]):
            generate_feeds(releases, documents.__getitem__, self.output)
            feed = json.loads((self.output / "updates/beta.json").read_text())
            self.assertEqual(feed, {"schemaVersion": 1, "version": "0.2.1", "tag": "v0.2.1"})

    def test_history_nightlies_and_drafts_do_not_request_manifests(self):
        draft, _ = release_fixture("0.2.0", "beta", "a" * 40, 1)
        draft["draft"] = True
        ignored = [draft, *({"draft": False, "tag_name": tag} for tag in (
            "nightly", "candidate-20261103-abcdef123", "alpha-20261103-abcdef123",
            "v0.2.0-nightly-" + "a" * 40,
        ))]
        def unexpected(_identifier):
            self.fail("Ignored release must not request its manifest")
        generate_feeds(ignored, unexpected, self.output)
        self.assertEqual(list((self.output / "updates").iterdir()), [])

    def test_withdrawal_restores_previous_beta_then_removes_feed(self):
        older, older_data = release_fixture("0.2.0", "beta", "a" * 40, 1)
        newer, newer_data = release_fixture("0.2.1", "beta", "b" * 40, 2)
        documents = {1: older_data, 2: newer_data}
        generate_feeds([older, newer], documents.__getitem__, self.output)
        generate_feeds([older], documents.__getitem__, self.output)
        self.assertEqual(json.loads((self.output / "updates/beta.json").read_text())["version"], "0.2.0")
        generate_feeds([], documents.__getitem__, self.output)
        self.assertFalse((self.output / "updates/beta.json").exists())

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
        release["tag_name"] = "v0.1.5"
        with self.assertRaisesRegex(ValueError, "must equal"):
            generate_feeds([release], lambda _identifier: data, self.output)

    def test_duplicate_versions_and_missing_manifest_fail_loudly(self):
        release, data = release_fixture("0.1.4", "beta", "a" * 40, 1)
        with self.assertRaisesRegex(ValueError, "Multiple published distributions"):
            generate_feeds([release, release], lambda _identifier: data, self.output)
        release["assets"] = []
        with self.assertRaisesRegex(ValueError, "exactly one release manifest"):
            generate_feeds([release], lambda _identifier: data, self.output)
