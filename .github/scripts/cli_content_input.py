"""Verify and stage generated CLI content; never reads the source retail corpus."""

import argparse
import hashlib
import io
import json
from pathlib import Path
import struct
import zipfile


CONTENT_FILES = ("bootstrap.hba", "navigation.hnav", "content-info.json")
NAVIGATION_HEADER = struct.Struct("<8sIIQ32s")


def validate_components(components: dict[str, bytes]) -> dict:
    """Check release component identities; runtime codec validation remains in Rust."""
    if set(components) != set(CONTENT_FILES):
        raise ValueError("CLI content must contain exactly bootstrap.hba, navigation.hnav, content-info.json")
    bootstrap = components["bootstrap.hba"]
    navigation = components["navigation.hnav"]
    if not bootstrap.startswith(b"HBA\0"):
        raise ValueError("CLI bootstrap payload has no HBA header")
    if len(navigation) < NAVIGATION_HEADER.size:
        raise ValueError("CLI navigation header is truncated")
    magic, version, _, _, companion = NAVIGATION_HEADER.unpack_from(navigation)
    if magic != b"HLTBNAV\0":
        raise ValueError("CLI navigation payload has no navigation header")
    if version != 1:
        raise ValueError(f"Unsupported CLI navigation format: {version}")
    if companion != hashlib.sha256(bootstrap).digest():
        raise ValueError("CLI navigation is bound to a different bootstrap HBA")
    info = json.loads(components["content-info.json"])
    if info["navigation_format"] != version:
        raise ValueError("CLI content provenance disagrees with its navigation format")
    for component, filename in (("bootstrap", "bootstrap.hba"), ("navigation", "navigation.hnav")):
        payload = components[filename]
        if info[component]["bytes"] != len(payload):
            raise ValueError(f"CLI {component} size differs from its provenance")
        if info[component]["sha256"] != hashlib.sha256(payload).hexdigest():
            raise ValueError(f"CLI {component} digest differs from its provenance")
    return info


def archive_components(data: bytes, expected_sha256: str) -> dict[str, bytes]:
    """Verify the pinned ZIP before admitting only named files, never arbitrary paths."""
    if hashlib.sha256(data).hexdigest() != expected_sha256:
        raise ValueError("CLI content ZIP SHA-256 mismatch")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = archive.namelist()
        if len(names) != len(CONTENT_FILES) or set(names) != set(CONTENT_FILES):
            raise ValueError("CLI content ZIP must contain exactly bootstrap.hba, navigation.hnav, content-info.json")
        components = {name: archive.read(name) for name in CONTENT_FILES}
    validate_components(components)
    return components


def unpack_cli_content(data: bytes, expected_sha256: str, output: Path) -> dict:
    """Stage validated components and the original pinned input for package receipts."""
    components = archive_components(data, expected_sha256)
    # Refuse an existing destination: mixing a regenerated companion with older staged files
    # would make a locally inspected directory differ from the pinned input contract.
    output.mkdir(parents=True, exist_ok=False)
    for name, payload in components.items():
        (output / name).write_bytes(payload)
    (output / "cli-content.zip").write_bytes(data)
    return json.loads(components["content-info.json"])


def verify_staged_content(directory: Path, expected_sha256: str) -> dict:
    """Bind extracted package inputs to the retained pinned ZIP, including provenance."""
    data = (directory / "cli-content.zip").read_bytes()
    components = archive_components(data, expected_sha256)
    for name, payload in components.items():
        if (directory / name).read_bytes() != payload:
            raise ValueError(f"Staged CLI {name} differs from the pinned ZIP")
    return json.loads(components["content-info.json"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    info = unpack_cli_content(args.archive.read_bytes(), args.sha256, args.output)
    print(json.dumps(info, sort_keys=True))


if __name__ == "__main__":
    main()
