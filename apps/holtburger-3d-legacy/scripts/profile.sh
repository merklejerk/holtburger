#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
app_dir="$(cd -- "$script_dir/.." && pwd)"
repo_root="$(cd -- "$app_dir/../.." && pwd)"

profile_name="${HOLTBURGER_PROFILE_NAME:-holtburger-3d-profile}"
profile_freq="${HOLTBURGER_PROFILE_FREQ:-49}"
devtools="${HOLTBURGER_PROFILE_DEVTOOLS:-1}"
output_dir="${HOLTBURGER_PROFILE_DIR:-$repo_root/target/profiles}"
perf_data="$output_dir/$profile_name.perf.data"
perf_script="$output_dir/$profile_name.perf.script"

require_command() {
	local name="$1"

	if ! command -v "$name" >/dev/null 2>&1; then
		echo "Missing required command: $name" >&2
		exit 127
	fi
}

write_perf_script() {
	local status="$1"

	if [[ -f "$perf_data" ]]; then
		echo "Generating perf script: $perf_script"
		if perf script --input "$perf_data" >"$perf_script"; then
			echo "Profile artifacts:"
			echo "  $perf_data"
			echo "  $perf_script"
		else
			echo "Failed to generate perf script from $perf_data" >&2
		fi
	fi

	exit "$status"
}

require_command perf
require_command npm

mkdir -p "$output_dir"
rm -f "$perf_data" "$perf_script"

trap 'write_perf_script "$?"' EXIT

echo "Profiling Holtburger 3D."
echo "Close the app or press Ctrl-C after the workload you want to capture finishes."
echo "Writing perf data to: $perf_data"
if [[ "$devtools" == "1" ]]; then
	echo "Tauri devtools enabled for this profiling build."
fi

cd "$app_dir"

tauri_features=()
if [[ "$devtools" == "1" ]]; then
	tauri_features=(--features profile-devtools)
fi

if [[ "${HOLTBURGER_PROFILE_SKIP_PREBUILD:-0}" != "1" ]]; then
	echo "Building Holtburger 3D with the Cargo profiling profile before recording."
	cargo build --manifest-path src-tauri/Cargo.toml --profile profiling "${tauri_features[@]}"
fi

perf record \
	--call-graph dwarf \
	--freq "$profile_freq" \
	--output "$perf_data" \
	npm run tauri:dev -- "${tauri_features[@]}" -- --profile profiling "$@"
