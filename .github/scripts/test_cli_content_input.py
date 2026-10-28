"""Generated content integrity tests using synthetic, asset-independent payloads."""

import hashlib
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import zipfile

from cli_content_input import (
    CONTENT_FILES, NAVIGATION_HEADER, NAVIGATION_FORMAT_VERSION, archive_components, unpack_cli_content,
    validate_components, verify_staged_content,
)
from fetch_cli_content import fetch_cli_content


def components() -> dict[str, bytes]:
    bootstrap = b"HBA\0synthetic bootstrap"
    navigation = NAVIGATION_HEADER.pack(
        b"HLTBNAV\0", NAVIGATION_FORMAT_VERSION, 0, NAVIGATION_HEADER.size,
    )
    return dict(zip(CONTENT_FILES, (bootstrap, navigation)))


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
            verify_staged_content(output, checksum)
            self.assertEqual((output / "navigation.hnav").read_bytes(), components()["navigation.hnav"])
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
            unpack_cli_content(data, digest, output)
            verify_staged_content(output, digest)
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

    def test_existing_dev_directory_keeps_full_hba_and_refuses_replacing_managed_inputs(self):
        data, digest = archive(components())
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            full_hba = output / "assets.hba"
            full_hba.write_bytes(b"existing full retail content")
            unpack_cli_content(data, digest, output)
            self.assertEqual(full_hba.read_bytes(), b"existing full retail content")
            with self.assertRaises(FileExistsError):
                unpack_cli_content(data, digest, output)
            self.assertEqual(full_hba.read_bytes(), b"existing full retail content")

    def test_missing_headers_and_unsupported_format_are_refused(self):
        cases = (("bootstrap.hba", b"not an HBA", "HBA header"),
                 ("navigation.hnav", b"truncated", "truncated"),
                 ("navigation.hnav", b"notmagic" + bytes(NAVIGATION_HEADER.size - 8), "navigation header"),
                 ("navigation.hnav", NAVIGATION_HEADER.pack(b"HLTBNAV\0", NAVIGATION_FORMAT_VERSION + 1, 0, NAVIGATION_HEADER.size), "Unsupported CLI navigation format"))
        for name, payload, message in cases:
            payloads = components()
            payloads[name] = payload
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                validate_components(payloads)


if __name__ == "__main__":
    unittest.main()
