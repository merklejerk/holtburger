#!/usr/bin/env python3
"""Exercise document-portal reads and explicit tool output grants with synthetic DAT data."""

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


def main() -> None:
    recipe = json.loads((ROOT / ".github/flatpak/io.github.merklejerk.holtburger-alpha.json").read_text())
    app_id = recipe["id"]
    version = json.loads(subprocess.check_output([
        "busctl", "--user", "--json=short", "get-property", "org.freedesktop.portal.Desktop",
        "/org/freedesktop/portal/desktop", "org.freedesktop.portal.FileChooser", "version",
    ], text=True))["data"]
    if version < MIN_FILE_CHOOSER_PORTAL_VERSION:
        raise ValueError(f"FileChooser portal version {version} is below Electron's required version")
    fixture = ROOT / "apps/holtburger-3d/scripts/fixtures/minimal-content.dat.fixture"
    with tempfile.TemporaryDirectory(prefix="holtburger-flatpak-io-") as temporary:
        root = Path(temporary)
        inputs, outputs = root / "retail inputs 雪", root / "tool outputs"
        inputs.mkdir()
        outputs.mkdir()
        shutil.copyfile(fixture, inputs / "client_portal.dat")
        portal = subprocess.check_output([
            "flatpak", "document-export", "--unique", "--allow-read", f"--app={app_id}", str(inputs),
        ], text=True).strip()
        try:
            subprocess.run([
                "flatpak", "run", "--user", "--command=sh", app_id, "-c",
                'test ! -r "$1/client_portal.dat" && test -r "$2/client_portal.dat" && test ! -w "$2/client_portal.dat"',
                "portal-probe", str(inputs), portal,
            ], check=True)
            dat = str(Path(portal) / "client_portal.dat")
            converted = outputs / "converted.hba"
            prefix = ["flatpak", "run", "--user", f"--filesystem={outputs}:rw"]
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
            print(json.dumps({"probe": "flatpak-tool-io", "portalReadOnly": True,
                              "fileChooserVersion": version, "explicitOutputGrant": True,
                              "conversionExportMatches": True}))
        finally:
            subprocess.run(["flatpak", "document-unexport", "--doc-id", Path(portal).parent.name], check=True)


if __name__ == "__main__":
    main()
