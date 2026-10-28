#!/usr/bin/env python3
"""Fetch the digest-pinned generated CLI content ZIP from this repository."""

import argparse
import json
from pathlib import Path
import subprocess
from cli_content_input import unpack_cli_content


ROOT = Path(__file__).resolve().parents[2]


def fetch_cli_content(descriptor: dict, output: Path) -> None:
    """Keep authenticated requests confined to this repository's release assets."""
    if "url" not in descriptor:
        raise ValueError("CLI content asset URL is not pinned; upload the approved ZIP before running CI")
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
    unpack_cli_content(data, descriptor["sha256"], output)
    print(f"Verified CLI content: {descriptor['sha256']}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    arguments = parser.parse_args()
    descriptor = json.loads((ROOT / ".github/cli-content.json").read_text())
    fetch_cli_content(descriptor, arguments.output)


if __name__ == "__main__":
    main()
