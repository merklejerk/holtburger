"""Generated content integrity tests using synthetic, asset-independent payloads."""

import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import zipfile

from cli_content_input import (
    CONTENT_FILES, NAVIGATION_HEADER, archive_components, unpack_cli_content,
    validate_components, verify_staged_content,
)
from fetch_cli_content import fetch_cli_content


def components() -> dict[str, bytes]:
    bootstrap = b"HBA\0synthetic bootstrap"
    navigation = NAVIGATION_HEADER.pack(
        b"HLTBNAV\0", 1, 0, NAVIGATION_HEADER.size, hashlib.sha256(bootstrap).digest(),
    )
    info = {"navigation_format": 1, "generator_version": "0.1.0-alpha.3"}
    for name, payload in (("bootstrap", bootstrap), ("navigation", navigation)):
        info[name] = {"bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}
    return dict(zip(CONTENT_FILES, (bootstrap, navigation, json.dumps(info).encode())))


def archive(payloads: dict[str, bytes]) -> tuple[bytes, str]:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as output:
        for name, payload in payloads.items():
            output.writestr(name, payload)
    data = buffer.getvalue()
    return data, hashlib.sha256(data).hexdigest()


class CliContentInputTests(unittest.TestCase):
    def test_fetch_uses_only_the_pinned_repository_asset_and_checks_received_bytes(self):
        data, checksum = archive(components())
        url = "https://api.github.com/repos/merklejerk/holtburger/releases/assets/123"
        with tempfile.TemporaryDirectory() as temporary, patch("fetch_cli_content.subprocess.run", return_value=Mock(stdout=data)) as request:
            output = Path(temporary) / "content"
            fetch_cli_content({"url": url, "sha256": checksum}, output)
            self.assertEqual(verify_staged_content(output, checksum)["navigation_format"], 1)
            self.assertEqual(request.call_args.args[0], ["gh", "api", url, "--header", "Accept: application/octet-stream"])

    def test_missing_or_foreign_asset_urls_never_start_authenticated_fetch(self):
        descriptors = ({"sha256": "0" * 64},
                       {"url": "https://example.invalid/releases/assets/123"},
                       {"url": "https://api.github.com/repos/another/repo/releases/assets/123"},
                       {"url": "https://api.github.com/repos/merklejerk/holtburger/releases/assets/123/extra"})
        for descriptor in descriptors:
            with self.subTest(descriptor=descriptor), patch("fetch_cli_content.subprocess.run") as request:
                with self.assertRaises(ValueError):
                    fetch_cli_content(descriptor, Path("unused-output"))
                request.assert_not_called()

    def test_verified_pair_and_input_zip_are_preserved_and_rechecked(self):
        payloads = components()
        data, digest = archive(payloads)
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "content"
            info = unpack_cli_content(data, digest, output)
            self.assertEqual(info, verify_staged_content(output, digest))
            self.assertEqual((output / "cli-content.zip").read_bytes(), data)
            for name, payload in payloads.items():
                self.assertEqual((output / name).read_bytes(), payload)
            (output / "navigation.hnav").write_bytes(b"substituted")
            with self.assertRaisesRegex(ValueError, "navigation.hnav differs"):
                verify_staged_content(output, digest)

    def test_invalid_input_does_not_create_staging_directory(self):
        data, _ = archive(components())
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "content"
            with self.assertRaisesRegex(ValueError, "ZIP SHA-256 mismatch"):
                unpack_cli_content(data, "0" * 64, output)
            self.assertFalse(output.exists())

    def test_extra_nested_and_duplicate_entries_are_refused(self):
        for name in ("../bootstrap.hba", "content/bootstrap.hba", "unneeded.hba"):
            payloads = components()
            payloads[name] = b"extra"
            data, digest = archive(payloads)
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "must contain exactly"):
                archive_components(data, digest)
        # A ZIP can contain duplicate names despite dict-based readers collapsing them.
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as output:
            output.writestr("bootstrap.hba", b"HBA\0one")
            output.writestr("navigation.hnav", b"one")
            with self.assertWarnsRegex(UserWarning, "Duplicate name"):
                output.writestr("navigation.hnav", b"two")
        data = buffer.getvalue()
        with self.assertRaisesRegex(ValueError, "must contain exactly"):
            archive_components(data, hashlib.sha256(data).hexdigest())

    def test_mismatched_companions_and_inaccurate_provenance_are_refused(self):
        payloads = components()
        payloads["bootstrap.hba"] += b"new generation"
        with self.assertRaisesRegex(ValueError, "different bootstrap"):
            validate_components(payloads)
        for component, field, incorrect in (("bootstrap", "bytes", 0), ("navigation", "sha256", "0" * 64)):
            payloads = components()
            info = json.loads(payloads["content-info.json"])
            info[component][field] = incorrect
            payloads["content-info.json"] = json.dumps(info).encode()
            expected = "size" if field == "bytes" else "digest"
            with self.subTest(component=component), self.assertRaisesRegex(ValueError, f"{component} {expected}"):
                validate_components(payloads)

    def test_existing_staging_is_not_overwritten(self):
        data, digest = archive(components())
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(FileExistsError):
                unpack_cli_content(data, digest, Path(temporary))

    def test_missing_headers_and_unsupported_format_are_refused(self):
        cases = (("bootstrap.hba", b"not an HBA", "HBA header"),
                 ("navigation.hnav", b"truncated", "truncated"),
                 ("navigation.hnav", b"notmagic" + bytes(NAVIGATION_HEADER.size - 8), "navigation header"),
                 ("navigation.hnav", NAVIGATION_HEADER.pack(b"HLTBNAV\0", 2, 0, NAVIGATION_HEADER.size, bytes(32)), "Unsupported CLI navigation format"))
        for name, payload, message in cases:
            payloads = components()
            payloads[name] = payload
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                validate_components(payloads)

    def test_provenance_format_must_match_the_payload(self):
        payloads = components()
        info = json.loads(payloads["content-info.json"])
        info["navigation_format"] = 2
        payloads["content-info.json"] = json.dumps(info).encode()
        with self.assertRaisesRegex(ValueError, "provenance disagrees"):
            validate_components(payloads)


if __name__ == "__main__":
    unittest.main()
