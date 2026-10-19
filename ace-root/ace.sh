#!/usr/bin/env bash
set -euo pipefail

ace_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
server_dir="$ace_root/server"

case "${1:-}" in
    build)
        dotnet publish "$ace_root/../ACE/Source/ACE.Server/ACE.Server.csproj" \
            --configuration Release --output "$server_dir" --nologo
        ;;
    run)
        for required in "$server_dir/ACE.Server.dll" "$ace_root/config/Config.js" "$ace_root/config/log4net.config"; do
            if [[ ! -f "$required" ]]; then
                echo "Missing $required. See $ace_root/README.md for setup." >&2
                exit 1
            fi
        done

        ln -sfn "$ace_root/config/Config.js" "$server_dir/Config.js"
        ln -sfn "$ace_root/config/log4net.config" "$server_dir/log4net.config"
        mkdir -p "$ace_root/content" "$ace_root/logs" "$ace_root/mods"
        ln -sfnT "$ace_root/content" "$server_dir/Content"

        # Native ACE stores patch history beside its SQL scripts. Keep the existing
        # container history in config so rebuilds do not cause patches to replay.
        for database in Authentication Shard World; do
            history="$ace_root/config/${database}_applied_updates.txt"
            updates_dir="$server_dir/DatabaseSetupScripts/Updates/$database"
            if [[ ! -d "$updates_dir" ]]; then
                echo "Missing $updates_dir. Rebuild ACE before running." >&2
                exit 1
            fi
            touch "$history"
            ln -sfn "$history" "$updates_dir/applied_updates.txt"
        done

        # Explicitly select the DB-only compose file, ignoring old server overrides.
        docker compose -f "$ace_root/docker-compose.yml" up -d --wait ace-db
        cd -- "$server_dir"
        exec dotnet ACE.Server.dll
        ;;
    *)
        echo "Usage: $0 {build|run}" >&2
        exit 1
        ;;
esac
