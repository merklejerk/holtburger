#!/usr/bin/env python3
"""Wrap verified native archives in manual-upgrade installers on their native OS."""

import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from alpha_release import (
    APP, INSTALLER_TARGETS, digest, extract_bundle, target_named, verify_bundle,
    verify_payload, write_json,
)
from release_version import validate_version

# Stable across versions; the recipe and native verifier consume the same identity.
WINDOWS_APP_ID = "io.github.merklejerk.holtburger-3d-alpha"
WINDOWS_APP_NAME = "Holtburger 3D Alpha"


def numeric_version(version: str) -> str:
    """Windows binary resources have four unsigned 16-bit components, not SemVer labels."""
    validate_version(version)
    parts = version.split("+", 1)[0].split("-", 1)[0].split(".")
    if any(int(part) > 65535 for part in parts):
        raise ValueError("Suite version exceeds Windows installer resource limits")
    return ".".join([*parts, "0"])


def compile_windows(native: Path, version: str, destination: Path, compiler: Path) -> None:
    """Compile the production recipe without rebuilding or editing its native payload."""
    subprocess.run([
        str(compiler), "/Qp", f"/DPayloadDir={native}",
        f"/DInstallerAppId={WINDOWS_APP_ID}", f"/DDisplayName={WINDOWS_APP_NAME}",
        f"/DReleaseVersion={version}", f"/DNumericVersion={numeric_version(version)}",
        f"/DInstallerName={destination.stem}", f"/DInstallerDir={destination.parent}",
        str(APP / "packaging/windows.iss"),
    ], check=True)


def dmg_documents(native: Path) -> dict[str, Path]:
    """Preserve release documents and Electron's package-level version marker."""
    documents = [path for path in native.iterdir() if path.name != "h3d"]
    documents.extend(path for path in (native / "h3d").iterdir() if path.name != "holtburger-3d.app")
    if any(not path.is_file() or path.is_symlink() for path in documents):
        raise ValueError("DMG companion documents must be regular files")
    if len({path.name for path in documents}) != len(documents):
        raise ValueError("DMG companion document names collide")
    return {path.name: path for path in documents}


def dmg_layout(native: Path, staging: Path) -> None:
    """Flatten only the app location; all original release documents remain available."""
    shutil.copytree(native / "h3d/holtburger-3d.app", staging / "holtburger-3d.app", symlinks=True)
    for name, path in dmg_documents(native).items():
        shutil.copy2(path, staging / name)
    (staging / "Applications").symlink_to("/Applications", target_is_directory=True)


@contextmanager
def mounted_dmg(image: Path, mount: Path):
    """Read-only inspection always detaches the image, including after probe failures."""
    mount.mkdir()
    subprocess.run(["hdiutil", "attach", "-readonly", "-nobrowse", "-mountpoint", str(mount), str(image)], check=True)
    try:
        yield mount
    finally:
        subprocess.run(["hdiutil", "detach", str(mount)], check=True)


def verify_dmg(native: Path, mounted: Path, installed: Path) -> None:
    """Check the explicit DMG layout, then copy back to the native probe's layout."""
    documents = dmg_documents(native)
    expected = documents.keys() | {"holtburger-3d.app", "Applications"}
    if {path.name for path in mounted.iterdir()} != expected:
        raise ValueError("DMG contains unexpected or missing entries")
    if not (mounted / "Applications").is_symlink() or os.readlink(mounted / "Applications") != "/Applications":
        raise ValueError("DMG Applications shortcut is incorrect")
    verify_payload(native / "h3d/holtburger-3d.app", mounted / "holtburger-3d.app")
    for name, source in documents.items():
        if digest(source) != digest(mounted / name):
            raise ValueError(f"DMG document differs from its native input: {name}")
    # Whole-app replacement, rather than ditto merging, removes obsolete files.
    app = installed / "h3d/holtburger-3d.app"
    if app.exists():
        shutil.rmtree(app)
    app.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ditto", str(mounted / "holtburger-3d.app"), str(app)], check=True)
    for name, source in documents.items():
        shutil.copy2(mounted / name, installed / source.relative_to(native))
    verify_payload(native, installed)
    verify_bundle(installed)


def profile_fixture(operation: str, root: Path) -> dict:
    """Use the app's settings owner to generate and verify valid retained credentials."""
    return json.loads(subprocess.check_output([
        "node", "scripts/installer-profile.mjs", operation, str(root),
    ], cwd=APP, text=True))


def probe_installed(executable: Path, profile: Path, server_name: str) -> None:
    """Exercise real startup and prove that this installed app loads the retained profile."""
    subprocess.run([
        "node", "scripts/content-startup-probe.mjs", "--package", str(executable),
        "--profile-root", str(profile), "--expected-server", server_name,
    ], cwd=APP, check=True, timeout=180)
    profile_fixture("verify", profile)


@contextmanager
def windows_file_lock(path: Path):
    """Hold a real Windows sharing lock; this is not a simulated installer result."""
    import ctypes
    from ctypes import wintypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                  ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    handle = kernel.CreateFileW(str(path), 0x80000000, 0, None, 3, 0, None)
    if handle == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        yield
    finally:
        if not kernel.CloseHandle(handle):
            raise ctypes.WinError(ctypes.get_last_error())


def verify_windows_installer(native: Path, installer: Path, compiler: Path, work: Path) -> None:
    """Test real setup, repair, upgrade, locks, and uninstall in a disposable OS account."""
    import winreg

    if os.environ.get("GITHUB_ACTIONS") != "true" and os.environ.get("HOLTBURGER_DISPOSABLE_INSTALL_TESTS") != "1":
        raise ValueError("Windows installation tests require a disposable CI account or HOLTBURGER_DISPOSABLE_INSTALL_TESTS=1")
    key_name = rf"Software\Microsoft\Windows\CurrentVersion\Uninstall\{WINDOWS_APP_ID}_is1"
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_name):
            raise ValueError("Refusing to test over an existing Holtburger installation")
    except FileNotFoundError:
        pass
    shortcut = Path(os.environ["APPDATA"]) / "Microsoft/Windows/Start Menu/Programs" / f"{WINDOWS_APP_NAME}.lnk"
    if shortcut.exists():
        raise ValueError("Refusing to overwrite an existing Holtburger Start menu shortcut")
    install = work / "installed application with spaces"
    payload = install / "payload"
    uninstaller = install / "unins000.exe"
    profile = work / "retained profile"
    server = profile_fixture("seed", profile)["serverName"]
    quiet = ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"]

    def setup(path: Path, select_destination: bool) -> None:
        destination = [f"/DIR={install}"] if select_destination else []
        subprocess.run([str(path), *quiet, *destination], check=True, timeout=180)
        verify_payload(native, payload)
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_name) as key:
            if Path(winreg.QueryValueEx(key, "InstallLocation")[0]) != install:
                raise ValueError("Installer registry location differs from its destination")
            if winreg.QueryValueEx(key, "DisplayVersion")[0] != json.loads((native / "build-info.json").read_text())["version"]:
                raise ValueError("Installer registry version differs from its payload")
        if not shortcut.is_file():
            raise ValueError("Installer did not create its Start menu shortcut")
        probe_installed(payload / "h3d/holtburger-3d.exe", profile, server)

    try:
        setup(installer, True)
        subprocess.run([str(uninstaller), *quiet], check=True, timeout=180)
        profile_fixture("verify", profile)
        if payload.exists() or shortcut.exists():
            raise ValueError("Uninstall left owned program files or shortcut")
        # A controlled predecessor uses the same recipe and current app, with an
        # earlier installer version and obsolete file. No historical runtime assets.
        previous = work / "predecessor payload"
        shutil.copytree(native, previous, symlinks=True)
        (previous / "obsolete-upgrade-fixture.txt").write_text("obsolete")
        predecessor = work / "predecessor.exe"
        compile_windows(previous, "0.0.0", predecessor, compiler)
        subprocess.run([str(predecessor), *quiet, f"/DIR={install}"], check=True, timeout=180)
        verify_payload(previous, payload)
        probe_installed(payload / "h3d/holtburger-3d.exe", profile, server)
        setup(installer, False)
        # Repair must replace same-version files and remove obsolete payload entries.
        (payload / "QUICKSTART.md").write_text("damaged repair fixture")
        (payload / "obsolete-repair-fixture.txt").write_text("obsolete")
        setup(installer, False)
        for executable in ["h3d/holtburger-3d.exe", "h3d/resources/holtburger-3d-host.exe"]:
            with windows_file_lock(payload / executable):
                result = subprocess.run([str(installer), *quiet, f"/DIR={install}"], timeout=180)
                if result.returncode == 0:
                    raise ValueError("Installer accepted a locked payload")
                verify_payload(native, payload)
                result = subprocess.run([str(uninstaller), *quiet], timeout=180)
                if result.returncode == 0:
                    raise ValueError("Uninstaller accepted a locked payload")
                verify_payload(native, payload)
    finally:
        if uninstaller.exists():
            subprocess.run([str(uninstaller), *quiet], check=True, timeout=180)
    profile_fixture("verify", profile)
    if payload.exists() or shortcut.exists():
        raise ValueError("Final uninstall left owned program files or shortcut")
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_name):
            raise ValueError("Uninstall retained its application registration")
    except FileNotFoundError:
        pass


def build(artifacts: Path, triple: str, output: Path, compiler: Path | None) -> Path:
    """Create and natively verify an installer before emitting its release metadata."""
    target = target_named(triple)
    if target.platform != sys.platform:
        raise ValueError("Generate desktop installers on their native platform")
    installer = next(entry for entry in INSTALLER_TARGETS if entry.triple == triple)
    record = json.loads((artifacts / f"metadata-3d-{triple}.json").read_text())
    validate_version(record["version"])
    archive = artifacts / record["archive"]
    expected_name = f"holtburger-3d-{record['version']}-{triple}.zip"
    if record["archive"] != expected_name or digest(archive) != record["sha256"]:
        raise ValueError("Installer native archive digest/path mismatch")
    output.mkdir(parents=True, exist_ok=True)
    destination = output / installer.filename(record["version"])
    with tempfile.TemporaryDirectory(prefix="holtburger-installer-") as directory:
        work = Path(directory)
        extracted = work / "native"
        extracted.mkdir()
        native = extract_bundle(archive, extracted)
        info = verify_bundle(native)
        if info["product"] != "3d" or info["target"] != triple:
            raise ValueError("Installer input product/target mismatch")
        if any(info[key] != record[key] for key in info):
            raise ValueError("Installer archive identity differs from its metadata")
        if target.platform == "win32":
            if compiler is None:
                raise ValueError("Windows installer generation requires --iscc")
            compile_windows(native, info["version"], destination, compiler)
            verify_windows_installer(native, destination, compiler, work)
        else:
            staging = work / "dmg"
            staging.mkdir()
            dmg_layout(native, staging)
            subprocess.run(["hdiutil", "create", "-volname", "Holtburger 3D Alpha", "-srcfolder", str(staging),
                            "-format", "UDZO", str(destination)], check=True)
            subprocess.run(["hdiutil", "verify", str(destination)], check=True)
            with mounted_dmg(destination, work / "mounted") as mounted:
                installed = work / "installed"
                verify_dmg(native, mounted, installed)
                profile = work / "retained profile"
                server = profile_fixture("seed", profile)["serverName"]
                app = installed / "h3d/holtburger-3d.app"
                executable = app / "Contents/MacOS/holtburger-3d"
                probe_installed(executable, profile, server)
                # Prove that native verification rejects mutation of an existing sealed
                # resource, rather than only validating our own receipt's host digest.
                icon = app / "Contents/Resources/icon.png"
                icon.write_bytes(icon.read_bytes() + b"tampered resource")
                rejection = subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], capture_output=True)
                if rejection.returncode == 0:
                    raise ValueError("Mac signature verification accepted a changed sealed resource")
                (app / "Contents/Resources/obsolete-upgrade-fixture.txt").write_text("obsolete")
                verify_dmg(native, mounted, installed)
                probe_installed(executable, profile, server)
                # Gatekeeper is a separate diagnostic; unsigned publisher rejection
                # is not misreported as a failure of code-signature integrity.
                assessment = subprocess.run(["spctl", "--assess", "--type", "execute", "--verbose=4",
                                             str(app)], capture_output=True, text=True)
                print(json.dumps({"gatekeeperExitCode": assessment.returncode,
                                  "gatekeeperDiagnostic": assessment.stdout + assessment.stderr}))
                shutil.rmtree(app)
                profile_fixture("verify", profile)
        if not destination.stat().st_size:
            raise ValueError("Generated installer is empty")
        write_json(output / f"metadata-3d-installer-{triple}.json", {
            **info, "format": installer.format, "installer": destination.name,
            "sha256": digest(destination), "nativeArchiveSha256": record["sha256"],
        })
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--target", choices=[entry.triple for entry in INSTALLER_TARGETS], required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--iscc", type=Path)
    args = parser.parse_args()
    print(build(args.artifacts.resolve(), args.target, args.output.resolve(), args.iscc))


if __name__ == "__main__":
    main()
