#!/usr/bin/env python3
"""Run the alpha's OS contracts without compiling unrelated Rust test targets."""

import argparse
from pathlib import Path
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "apps/holtburger-3d"

# Each entry builds only this package's library test target. Dependencies remain Cargo-owned.
RUST_TESTS = {
    "holtburger-content": ("repository::mounting::tests::",),
    "holtburger-weenie-catalog": (
        "tests::empty_catalog_reopens_as_a_valid_empty_catalog",
        "tests::writer_canonicalizes_input_and_produces_deterministic_bytes",
        "tests::failed_replacement_preserves_existing_catalog",
    ),
    "holtburger-cli": (
        "scripting::tests::discoverable_script_basenames",
        "scripting::tests::script_",
        "scripting::tests::json_file_helpers",
    ),
    "holtburger-3d-host": ("world_map::tests::", "explorer_weenie_catalog::tests::"),
}

# These files exercise real filesystem or native-path behavior, rather than renderer/game logic.
FRONTEND_TESTS = (
    "scripts/entry-paths.test.ts",
    "electron/client-user-data.test.ts",
    "electron/client-launch.test.ts",
    "electron/client-settings-store.test.ts",
    "electron/client-settings-repair.test.ts",
    "electron/client-visual-cache-store.test.ts",
    "electron/ui-theme-catalog.test.ts",
    "electron/navigation-policy.test.ts",
    "electron/content-startup.test.ts",
)


def rust_tests() -> None:
    """Check every selector against the compiled inventory before executing the selected tests."""
    for package, selectors in RUST_TESTS.items():
        command = ["cargo", "test", "--locked", "-p", package, "--lib", "--", *selectors]
        inventory = subprocess.check_output([*command, "--list"], cwd=ROOT, text=True)
        names = [line.removesuffix(": test") for line in inventory.splitlines() if line.endswith(": test")]
        for selector in selectors:
            if not any(selector in name for name in names):
                raise ValueError(f"OS test selector matched no tests in {package}: {selector}")
        print(f"OS contracts: {package} --lib ({len(names)} tests)", flush=True)
        subprocess.run(command, cwd=ROOT, check=True)


def frontend_tests() -> None:
    """Use the existing npm test command with a checked, explicit file selection."""
    for filename in FRONTEND_TESTS:
        if not (APP / filename).is_file():
            raise FileNotFoundError(f"OS test file is missing: {filename}")
    npm = shutil.which("npm")
    if npm is None:
        raise RuntimeError("npm is required to run the frontend OS contracts")
    # Windows npm uses a batch shim; all arguments here are fixed CI-owned filenames.
    subprocess.run(
        [npm, "run", "test:ts", "--", *FRONTEND_TESTS], cwd=APP, check=True,
        shell=Path(npm).suffix.lower() in (".cmd", ".bat"),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("suite", choices=("rust", "frontend"))
    arguments = parser.parse_args()
    if arguments.suite == "rust":
        rust_tests()
    else:
        frontend_tests()


if __name__ == "__main__":
    main()
