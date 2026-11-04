#!/usr/bin/env bash
set -euo pipefail

workspace=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
# Preserve explicitly configured values, including empty values rejected by discovery.
export HOLTBURGER_DEFAULT_CONTENT="${HOLTBURGER_DEFAULT_CONTENT-$workspace/local/content}"
export SCRIPT_DIR="${SCRIPT_DIR-$workspace/local/scripts}"
export SCRIPT_BUNDLE_DIR="${SCRIPT_BUNDLE_DIR-$workspace/assets/scripts}"
profile=()
if [[ "${1-}" == --release ]]; then
    profile=(--release)
    shift
fi
exec cargo run "${profile[@]}" --manifest-path "$workspace/Cargo.toml" -p holtburger-cli --bin tui -- "$@"
