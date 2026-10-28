#!/usr/bin/env python3
"""Exercise each product's sandbox I/O using checked-in synthetic DAT data."""

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

from release_version import ROOT

# Authored palette in the checked-in minimal-content fixtures; compare raw and converted exports.
PALETTE_FIXTURE_ID = "0x04000001"
# Electron v44.0.0: shell/browser/ui/file_dialog_linux_portal.cc defaults to FileChooser v3.
MIN_FILE_CHOOSER_PORTAL_VERSION = 3


def probe_cli_tools(inputs: Path, outputs: Path) -> None:
    """CLI utilities use explicit input/output grants and need no graphical portal backend."""
    app_id = "io.github.merklejerk.holtburger-cli-alpha"
    dat = str(inputs / "client_portal.dat")
    converted = outputs / "converted.hba"
    prefix = ["flatpak", "run", "--user", f"--filesystem={inputs}:ro", f"--filesystem={outputs}:rw"]
    subprocess.run([
        *prefix, "--command=sh", app_id, "-c",
        'test -r "$1/client_portal.dat" && test ! -w "$1/client_portal.dat" && test -w "$2"',
        "tool-grant-probe", str(inputs), str(outputs),
    ], check=True)
    subprocess.run([
        *prefix, "--command=dat2hba", app_id, "--profile", "full",
        f"eor/portal={dat}", str(converted),
    ], check=True)
    for path, namespace, output in (
        (dat, [], outputs / "source.palette"),
        (str(converted), ["--namespace", "eor/portal"], outputs / "converted.palette"),
    ):
        subprocess.run([
            *prefix, "--command=dat-tool", app_id, "export", path,
            PALETTE_FIXTURE_ID, *namespace, "--output", str(output),
        ], check=True)
    if (outputs / "source.palette").read_bytes() != (outputs / "converted.palette").read_bytes():
        raise ValueError("Flatpak DAT conversion changed the authored palette bytes")
    print(json.dumps({"probe": "flatpak-cli-tool-io", "inputReadOnly": True,
                      "explicitOutputGrant": True, "conversionExportMatches": True}))


def probe_3d_portal(inputs: Path) -> None:
    """Check document-portal access in the 3D app's own sandbox without CLI utilities."""
    recipe = json.loads((ROOT / ".github/flatpak/io.github.merklejerk.holtburger-alpha.json").read_text())
    app_id = recipe["id"]
    version = json.loads(subprocess.check_output([
        "busctl", "--user", "--json=short", "get-property", "org.freedesktop.portal.Desktop",
        "/org/freedesktop/portal/desktop", "org.freedesktop.portal.FileChooser", "version",
    ], text=True))["data"]
    if version < MIN_FILE_CHOOSER_PORTAL_VERSION:
        raise ValueError(f"FileChooser portal version {version} is below Electron's required version")
    portal = subprocess.check_output([
        "flatpak", "document-export", "--unique", "--allow-read", f"--app={app_id}", str(inputs),
    ], text=True).strip()
    try:
        subprocess.run([
            "flatpak", "run", "--user", "--command=sh", app_id, "-c",
            'test ! -r "$1/client_portal.dat" && test -r "$2/client_portal.dat" && test ! -w "$2/client_portal.dat"',
            "portal-probe", str(inputs), portal,
        ], check=True)
        print(json.dumps({"probe": "flatpak-3d-portal-io", "portalReadOnly": True,
                          "fileChooserVersion": version}))
    finally:
        subprocess.run(["flatpak", "document-unexport", "--doc-id", Path(portal).parent.name], check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--product", choices=("cli", "3d"), required=True)
    args = parser.parse_args()
    fixture = ROOT / "apps/holtburger-3d/scripts/fixtures/minimal-content.dat.fixture"
    with tempfile.TemporaryDirectory(prefix="holtburger-flatpak-io-") as temporary:
        root = Path(temporary)
        inputs = root / "retail inputs 雪"
        inputs.mkdir()
        shutil.copyfile(fixture, inputs / "client_portal.dat")
        if args.product == "cli":
            outputs = root / "tool outputs"
            outputs.mkdir()
            probe_cli_tools(inputs, outputs)
        else:
            probe_3d_portal(inputs)


if __name__ == "__main__":
    main()
