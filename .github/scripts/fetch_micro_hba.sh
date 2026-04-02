#!/usr/bin/env bash

set -euo pipefail

archive_name="${HBA_MICRO_ARCHIVE_NAME:-micro-hba.zip}"
keep_archive="${HBA_MICRO_KEEP_ARCHIVE:-0}"

if [[ -z "${HBA_MICRO_LATEST_URL:-}" ]]; then
  echo "HBA_MICRO_LATEST_URL is not set" >&2
  exit 1
fi

mkdir -p dats
curl -L "${HBA_MICRO_LATEST_URL}" -o "${archive_name}"
unzip -o "${archive_name}" -d dats
test -f dats/assets.hba

if [[ "${keep_archive}" != "1" ]]; then
  rm -f "${archive_name}"
fi