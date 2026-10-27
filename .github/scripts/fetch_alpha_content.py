#!/usr/bin/env python3
"""Fetch only the digest-pinned alpha micro ZIP from its public content prerelease."""

import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import zipfile


ROOT = Path(__file__).resolve().parents[2]


def unpack_micro(data: bytes, digest: str, output: Path) -> None:
    """Verify before extraction and admit exactly one named HBA rather than arbitrary ZIP paths."""
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError("Alpha micro ZIP SHA-256 mismatch")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if archive.namelist() != ["assets.hba"]:
            raise ValueError("Alpha micro ZIP must contain exactly assets.hba")
        hba = archive.read("assets.hba")
    if not hba.startswith(b"HBA\0"):
        raise ValueError("Alpha micro payload has no HBA header")
    output.mkdir(parents=True, exist_ok=True)
    (output / "assets.hba").write_bytes(hba)
    (output / "micro-hba.zip").write_bytes(data)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    arguments = parser.parse_args()
    descriptor = json.loads((ROOT / ".github/alpha-content.json").read_text())
    url = descriptor["url"]
    # Credentials are sent only to this repository's GitHub API asset endpoint.
    prefix = "https://api.github.com/repos/merklejerk/holtburger/releases/assets/"
    if not url.startswith(prefix) or not url[len(prefix):].isdigit():
        raise ValueError("Alpha content URL must identify a release asset in this repository")
    # GitHub CLI owns authentication and signed-download redirects, keeping tokens out of argv.
    data = subprocess.run(
        ["gh", "api", url, "--header", "Accept: application/octet-stream"],
        check=True, stdout=subprocess.PIPE, timeout=60,
    ).stdout
    unpack_micro(data, descriptor["sha256"], arguments.output)
    print(f"Verified alpha micro: {descriptor['sha256']}")


if __name__ == "__main__":
    main()
