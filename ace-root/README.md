## Native ACE with Docker MySQL

ACE runs on the host using the `../ACE` submodule. Docker runs only MySQL 8.0,
using the existing `db-data` directory. Client connections remain on UDP ports
9000 and 9001; MySQL is published on `127.0.0.1:3306`.

### Setup

On Arch, install the .NET 10 SDK: `sudo pacman -Syu dotnet-sdk-10.0`.
Docker and its Compose plugin are also required.

1. Create `docker.env` from `docker.example.env` if it does not already exist.
   It supplies the database container credentials; native ACE reads `config/Config.js`.
2. For a new configuration, copy `../ACE/Source/ACE.Server/Config.js.example`
   to `config/Config.js`, and `log4net.config.example` from the same directory
   to `config/log4net.config`. Preserve existing configurations when migrating.
3. In `config/Config.js`, set all three `MySql` hosts to `127.0.0.1`, port 3306,
   and use the existing database names and credentials from `docker.env`.
   Set `Server.Network.Host` to `127.0.0.1` for local development, and set
   `Server.DatFilesDirectory` and `Server.ModsDirectory` to absolute host paths.
   The DAT directory must contain `client_cell_1.dat`, `client_portal.dat`, and
   `client_local_English.dat`.
4. In `config/log4net.config`, change the file appender path to an absolute
   path under this directory's `logs/` folder.

Keep credentials and generated files untracked. The `config`, `content`, `logs`,
`mods`, `server`, and `db-data` directories are ignored by Git.

### Build and run

From the repository root:

```bash
./ace-root/ace.sh build
./ace-root/ace.sh run
```

Build publishes only the server project, including its referenced libraries, to
`ace-root/server`. It still needs NuGet access for uncached packages. Run starts
the database container, waits for its health check, then opens ACE's interactive
console in the current terminal. Use ACE's `shutdown` command for a graceful shutdown.
Re-run `build` after changing ACE source; `run` does not build implicitly.

The launcher links the configuration and database patch histories from `config/`
into the runtime directory. Keep existing `*_applied_updates.txt` files when
migrating so previously applied patches are not replayed.

To stop only the database:

```bash
docker compose -f ace-root/docker-compose.yml stop ace-db
```

The explicit Compose file selection ignores legacy `docker-compose.override.yml`
files that configured the old server container. Use that same `-f` selection for
other Compose commands. The existing `db_tool.sh` backup/restore/shell commands
still work when run from `ace-root/` with the database container running.

### Migrating an existing Docker server

Stop the old `ace-holtburger-server` container before running native ACE. Preserve
`db-data`, `docker.env`, and `config/`; no database dump/import is needed.
Do not use Compose's volume deletion options.

Move any old server-only `docker-compose.override.yml` out of the Compose directory.
Once the old server is stopped, `docker rm ace-holtburger-server` removes its
obsolete container without deleting the bind-mounted data.

Docker ACE persists the `content_folder` server property as `/ace/Content` in the
shard database. Change it once to the absolute host path of `ace-root/content`
using the database shell, replacing the path and shard database name as needed:

```sql
UPDATE ace_shard.config_properties_string
SET value = '/absolute/path/to/holtburger/ace-root/content'
WHERE `key` = 'content_folder';
```

This matters for live content imports and automatic world customizations, which
can run before the server console is available. The launcher also links `Content`
beside the executable for installations using ACE's default relative property.
Other stored properties containing custom container paths need host equivalents.
