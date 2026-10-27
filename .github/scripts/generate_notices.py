"""Generate the alpha's Rust and native dependency notices with cargo-about."""

import argparse
import hashlib
from html import escape
import json
from pathlib import Path
import re
import subprocess
import tempfile
import tomllib

ROOT = Path(__file__).resolve().parents[2]
CARGO_ABOUT_VERSION = "0.9.3"
NOTICE_PATH = Path(".github/licenses/THIRD_PARTY_NOTICES.html")
INPUT_RECORD_PATH = NOTICE_PATH.with_suffix(".inputs.json")
# This crate publishes an MIT declaration and authors, but no original standalone notice.
# Its actual ICU data is covered separately by the pinned native notices below.
METADATA_ONLY = ("deno_core_icudata", "0.74.0")
PLACEHOLDER = re.compile(r"Copyright[^\n]*(?:<year>|<owner>|<copyright holders>)", re.I)


def input_digest(root: Path) -> str:
    """Fingerprint the locked dependency graph, local package metadata and notice sources."""
    workspace = tomllib.loads((root / "Cargo.toml").read_text())
    native = json.loads((root / ".github/native-notices.json").read_text())
    inputs = {
        Path("Cargo.toml"), Path("Cargo.lock"), Path("LICENSE.md"),
        Path(".github/about.toml"), Path(".github/native-notices.json"),
        Path(".github/scripts/generate_notices.py"),
        *(Path(member) / "Cargo.toml" for member in workspace["workspace"]["members"]),
        *(Path(".github") / notice["path"] for notice in native["files"]),
    }
    hashes = {
        path.as_posix(): hashlib.sha256((root / path).read_bytes()).hexdigest()
        for path in inputs
    }
    return hashlib.sha256(json.dumps(hashes, sort_keys=True).encode()).hexdigest()


def check(root: Path = ROOT) -> None:
    """Check committed inputs/output without installing cargo-about or accessing the network."""
    regenerate = "Run python .github/scripts/generate_notices.py generate and commit both outputs."
    for path in (NOTICE_PATH, INPUT_RECORD_PATH):
        if not (root / path).is_file():
            raise ValueError(f"Missing committed notices file: {path}. {regenerate}")
    record = json.loads((root / INPUT_RECORD_PATH).read_text())
    if record["inputsSha256"] != input_digest(root):
        raise ValueError(f"Notice inputs changed since local generation. {regenerate}")
    if record["noticesSha256"] != hashlib.sha256((root / NOTICE_PATH).read_bytes()).hexdigest():
        raise ValueError(f"Committed notice output differs from its generated digest. {regenerate}")
    print(f"Committed notices are current: {NOTICE_PATH}")


def render(report: dict, native_manifest: Path) -> str:
    """Keep original texts intact and reject unreviewed template attributions."""
    packages = {
        (entry["package"]["name"], entry["package"]["version"])
        for entry in report["crates"]
    }
    native = json.loads(native_manifest.read_text())
    for name, version in native["packages"].items():
        versions = {value for package, value in packages if package == name}
        if versions != {version}:
            raise ValueError(f"Native notices need review for {name}: {sorted(versions)}")
    sections = [
        "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\">",
        "<title>Holtburger third-party notices</title>",
        "<style>body{max-width:75em;margin:2em auto;padding:0 1em}"
        "pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>",
        "<h1>Holtburger third-party notices</h1>",
        "<p>Rust runtime and build dependencies across the alpha targets, generated "
        f"with cargo-about {CARGO_ABOUT_VERSION}. Electron/Chromium and font notices "
        "are also included inside the h3d application.</p>",
    ]
    for license in report["licenses"]:
        text = license["text"]
        used_by = [usage["crate"] for usage in license["used_by"]]
        if PLACEHOLDER.search(text[:400]):
            if {(crate["name"], crate["version"]) for crate in used_by} != {METADATA_ONLY}:
                raise ValueError("Unresolved template attribution: " + ", ".join(
                    f"{crate['name']} {crate['version']}" for crate in used_by
                ))
            # Remove only the generator's canonical template line, never an upstream notice.
            text = PLACEHOLDER.sub("", text, count=1)
            authors = ", ".join(used_by[0]["authors"])
            sections.append(
                "<p>deno_core_icudata 0.74.0: MIT license declared in published package "
                "metadata; no original standalone notice was supplied. The text below is "
                "the canonical license with its template attribution omitted. Published "
                f"authors: {escape(authors)}. ICU data notices follow separately.</p>"
            )
        sections.append(f"<h2>{escape(license['name'])}</h2><ul>")
        for crate in used_by:
            sections.append(f"<li>{escape(crate['name'])} {escape(crate['version'])}</li>")
        sections.append(f"</ul><pre>{escape(text)}</pre>")
    sections.append("<h1>Native libraries and packaging helpers</h1>")
    if not native["files"]:
        raise ValueError("No embedded native-library notices")
    for notice in native["files"]:
        path = native_manifest.parent / notice["path"]
        if not path.resolve().is_relative_to(native_manifest.parent.resolve()):
            raise ValueError("Native notice path escapes its source directory")
        data = path.read_bytes()
        if not data.strip() or hashlib.sha256(data).hexdigest() != notice["sha256"]:
            raise ValueError(f"Native notice digest/contents mismatch: {notice['path']}")
        sections.append(f"<h2>{escape(notice['component'])}: {escape(path.name)}</h2>"
                        f'<p><a href="{escape(notice["sourceUrl"], quote=True)}">'
                        "Original pinned source</a></p>"
                        f"<pre>{escape(data.decode(notice['encoding']))}</pre>")
    return "\n".join(sections) + "\n</html>\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("tool-version")
    commands.add_parser("check")
    generate = commands.add_parser("generate")
    generate.add_argument("--cargo-about", default="cargo-about")
    args = parser.parse_args()
    if args.command == "tool-version":
        print(CARGO_ABOUT_VERSION)
        return
    if args.command == "check":
        check()
        return
    inputs = input_digest(ROOT)
    version = subprocess.check_output([args.cargo_about, "--version"], text=True).strip()
    if version != f"cargo-about {CARGO_ABOUT_VERSION}":
        raise ValueError(f"Expected cargo-about {CARGO_ABOUT_VERSION}, got {version}")
    with tempfile.TemporaryDirectory(prefix="holtburger-notices-") as temporary:
        report = Path(temporary) / "report.json"
        subprocess.run([
            args.cargo_about, "generate", "--locked", "--fail", "--workspace",
            "--config", str(ROOT / ".github/about.toml"), "--format", "json",
            "--output-file", str(report),
        ], cwd=ROOT, check=True)
        html = render(json.loads(report.read_text()), ROOT / ".github/native-notices.json")
    if input_digest(ROOT) != inputs:
        raise ValueError("Notice inputs changed during generation; rerun with stable inputs")
    output = ROOT / NOTICE_PATH
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html, encoding="utf-8")
    (ROOT / INPUT_RECORD_PATH).write_text(json.dumps({
        "inputsSha256": inputs,
        "noticesSha256": hashlib.sha256(output.read_bytes()).hexdigest(),
    }, indent=2) + "\n")
    check()


if __name__ == "__main__":
    main()
