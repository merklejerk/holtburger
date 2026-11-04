"""Project accepted published release manifests into the public Pages update feeds."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
from typing import Callable

from semver import Version

from release_suite import validate_manifest, validate_tag, write_json


# Both API requests and public links are confined to this repository.
REPOSITORY = "merklejerk/holtburger"


def generate_feeds(releases: list[dict], load_manifest: Callable[[int], bytes], output: Path) -> None:
    """Reconcile the whole public inventory; event order and GitHub latest labels are irrelevant."""
    distributions = []
    versions: set[str] = set()
    for release in releases:
        if release["draft"] or re.fullmatch(r"v0\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", release["tag_name"]) is None:
            continue
        assets = release["assets"]
        manifests = [asset for asset in assets if asset["name"] == "release-manifest.json"]
        if len(manifests) != 1:
            raise ValueError(f"Published release requires exactly one release manifest: {release['tag_name']}")
        data = load_manifest(manifests[0]["id"])
        document = json.loads(data)
        inventory = validate_manifest(document)
        validate_tag(release["tag_name"], inventory.version, inventory.commit, inventory.kind)
        if inventory.version in versions:
            raise ValueError(f"Multiple published distributions claim suite version {inventory.version}")
        versions.add(inventory.version)
        expected = {*inventory.assets, "release-manifest.json", "SHA256SUMS"}
        if len(assets) != len(expected) or {asset["name"] for asset in assets} != expected:
            raise ValueError(f"Published release asset inventory is incomplete or unexpected: {release['tag_name']}")
        for asset in assets:
            if asset["state"] != "uploaded" or asset["size"] <= 0:
                raise ValueError(f"Published release asset is not ready: {asset['name']}")
            expected_digest = (hashlib.sha256(data).hexdigest() if asset["name"] == "release-manifest.json"
                               else inventory.assets.get(asset["name"]))
            # Older GitHub uploads can omit digests; local staging already verified their bytes.
            if asset.get("digest") is not None:
                digest = asset["digest"]
                if re.fullmatch(r"sha256:[0-9a-f]{64}", digest) is None:
                    raise ValueError(f"Unsupported published asset digest: {asset['name']}")
                if expected_digest is not None and digest != f"sha256:{expected_digest}":
                    raise ValueError(f"Published asset digest differs from its manifest: {asset['name']}")
        distributions.append((Version.parse(inventory.version), release["tag_name"]))
    # Validate everything before mutating output, so a malformed release cannot create a partial site.
    output.mkdir(parents=True, exist_ok=True)
    updates = output / "updates"
    updates.mkdir(exist_ok=True)
    path = updates / "beta.json"
    if distributions:
        version, tag = max(distributions, key=lambda item: item[0])
        write_json(path, {"schemaVersion": 1, "version": str(version), "tag": tag})
    else:
        path.unlink(missing_ok=True)
    for retired in ("alpha.json", "nightly.json"):
        (updates / retired).unlink(missing_ok=True)
    (output / "index.html").write_text(
        '<!doctype html><html lang="en"><meta charset="utf-8">'
        '<title>Holtburger updates</title><h1>Holtburger updates</h1>'
        '<p><a href="https://github.com/merklejerk/holtburger/releases">Downloads</a></p></html>\n'
    )


def github(*arguments: str) -> bytes:
    """Use the workflow's scoped token without exposing it in command arguments."""
    return subprocess.check_output(["gh", "api", *arguments], timeout=60)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    arguments = parser.parse_args()
    pages = json.loads(github(f"repos/{REPOSITORY}/releases", "--paginate", "--slurp"))
    releases = [release for page in pages for release in page]
    generate_feeds(releases, lambda asset: github(
        f"repos/{REPOSITORY}/releases/assets/{asset}", "--header", "Accept: application/octet-stream",
    ), arguments.output)


if __name__ == "__main__":
    main()
