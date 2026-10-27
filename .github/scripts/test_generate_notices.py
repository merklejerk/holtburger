"""Notice validation uses synthetic text rather than installed runtime assets."""

import hashlib
from html import unescape
import json
from pathlib import Path
import tempfile
import unittest

from generate_notices import INPUT_RECORD_PATH, NOTICE_PATH, check, input_digest, render


class NoticeTests(unittest.TestCase):
    """Dependency drift and generator placeholders must not silently ship."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        text = b"Copyright Native <authors>\nOriginal notice.\n"
        (self.root / "LICENSE").write_bytes(text)
        self.native = {"packages": {"example": "1.0.0"}, "files": [{
            "path": "LICENSE", "component": "native-example", "encoding": "utf-8",
            "sha256": hashlib.sha256(text).hexdigest(),
            "sourceUrl": "https://example.com/pinned/LICENSE",
        }]}
        self.manifest = self.root / "native.json"
        self.manifest.write_text(json.dumps(self.native))

    @staticmethod
    def report(text, name="example", version="1.0.0"):
        crate = {"name": name, "version": version, "authors": ["Published author"]}
        return {"crates": [{"package": crate}], "licenses": [{
            "name": "MIT", "text": text, "used_by": [{"crate": crate}],
        }]}

    def test_original_text_survives_html_escaping(self):
        text = "Copyright Original <author> & Company\n\nLicensed text."
        result = render(self.report(text), self.manifest)
        self.assertIn(text, unescape(result))
        self.assertIn("&lt;author&gt; &amp; Company", result)
        self.assertIn("Copyright Native <authors>", unescape(result))

    def test_unreviewed_template_attribution_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Unresolved template attribution"):
            render(self.report("MIT\nCopyright (c) <year> <copyright holders>"), self.manifest)

    def test_bounded_metadata_case_is_labeled_without_inventing_attribution(self):
        report = self.report("MIT\nCopyright (c) <year> <copyright holders>\nPermission text.",
                             "deno_core_icudata", "0.74.0")
        self.native["packages"] = {"deno_core_icudata": "0.74.0"}
        self.manifest.write_text(json.dumps(self.native))
        result = render(report, self.manifest)
        self.assertIn("no original standalone notice was supplied", result)
        self.assertNotIn("&lt;year&gt;", result)
        self.assertIn("Published author", result)
        self.assertIn("Permission text.", result)

    def test_license_appendix_examples_are_preserved(self):
        text = "Original license text.\n" * 30 + "Copyright <year> <owner>"
        self.assertIn(text, unescape(render(self.report(text), self.manifest)))

    def test_dependency_version_drift_requires_notice_review(self):
        with self.assertRaisesRegex(ValueError, "Native notices need review"):
            render(self.report("Original license", version="2.0.0"), self.manifest)

    def test_changed_native_notice_fails_its_digest(self):
        (self.root / "LICENSE").write_text("altered")
        with self.assertRaisesRegex(ValueError, "Native notice digest/contents mismatch"):
            render(self.report("Original license"), self.manifest)


class CommittedNoticeTests(unittest.TestCase):
    """A source change or altered output must invalidate the locally generated notices."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        files = {
            "Cargo.toml": '[workspace]\nmembers = ["member"]\n',
            "member/Cargo.toml": '[package]\nname = "member"\nversion = "1.0.0"\n',
            "Cargo.lock": "locked dependency graph",
            "LICENSE.md": "project license",
            ".github/about.toml": "notice policy",
            ".github/scripts/generate_notices.py": "generator",
            ".github/licenses/native/example": "original native notice",
            ".github/native-notices.json": json.dumps({
                "files": [{"path": "licenses/native/example"}],
            }),
            NOTICE_PATH.as_posix(): "generated notices",
        }
        for name, text in files.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        (self.root / INPUT_RECORD_PATH).write_text(json.dumps({
            "inputsSha256": input_digest(self.root),
            "noticesSha256": hashlib.sha256((self.root / NOTICE_PATH).read_bytes()).hexdigest(),
        }))

    def test_committed_output_checks_without_the_generator_or_network(self):
        check(self.root)

    def test_notice_sources_and_graph_changes_require_regeneration(self):
        for name in (
            "Cargo.lock", "Cargo.toml", "member/Cargo.toml", "LICENSE.md",
            ".github/about.toml", ".github/native-notices.json",
            ".github/scripts/generate_notices.py", ".github/licenses/native/example",
        ):
            with self.subTest(path=name):
                path = self.root / name
                original = path.read_text()
                # Whitespace is valid for TOML/JSON and changes the recorded input bytes.
                path.write_text(original + "\n")
                with self.assertRaisesRegex(ValueError, "Notice inputs changed"):
                    check(self.root)
                path.write_text(original)

    def test_application_source_does_not_invalidate_unchanged_notices(self):
        (self.root / "member/lib.rs").write_text("fn changed_behavior() {}")
        check(self.root)

    def test_altered_output_and_missing_record_fail(self):
        (self.root / NOTICE_PATH).write_text("altered license text")
        with self.assertRaisesRegex(ValueError, "output differs"):
            check(self.root)
        (self.root / INPUT_RECORD_PATH).unlink()
        with self.assertRaisesRegex(ValueError, "Missing committed notices file"):
            check(self.root)


if __name__ == "__main__":
    unittest.main()
