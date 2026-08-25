# Holtburger 3D

Electron-backed development surface for Holtburger's replacement 3D client. Authoritative app-local
content and simulation behavior runs in the `holtburger-3d-host` Rust sidecar; the renderer reaches
it through the context-isolated Electron preload boundary.

The Explorer runs the shared content, scene, runtime, and WebGL2 rendering architecture against real
client data. The primary client route is still a minimal shell while gameplay-facing application
work catches up with the underlying runtime.

Explorer weenie discovery remains app-local: the Rust host lazily indexes the optional offline
catalog and returns bounded ranked identity results to the Entities picker. The browser commits one
exact WCID and the existing numeric spawn path remains the sole mutation contract; neither complete
catalog records nor fuzzy scores cross the adapter.

## Development

Install Node.js 22.12 or newer, a current stable Rust toolchain, and the frontend dependencies:

```bash
cd apps/holtburger-3d
npm ci
```

Use `npm run dev:explorer` for the Explorer and `npm run dev` or `npm run dev:client` for the client
route. Development startup incrementally builds the Rust sidecar, starts Vite, launches Electron,
and stops Vite after the application exits. Add `:release` to either named route to use an optimized
host build.

The launcher and host recognize these environment variables:

- `HOLTBURGER_DATS` selects an explicit content installation. Development otherwise uses the
  repository `dats` directory when present, followed by the normal content-repository discovery
  rules.
- `HOLTBURGER_ELECTRON_OZONE_PLATFORM` accepts `auto`, `wayland`, or `x11` for Linux display-backend
  diagnosis. It is not a product default.
- `HOLTBURGER_ELECTRON_DISABLE_GPU=1` disables GPU acceleration for diagnosis. It is not a supported
  rendering mode.
- `HOLTBURGER_HOST_BIN` overrides the development sidecar executable for launcher and CI
  diagnostics. Packaged applications always use their bundled host. Normal development should let
  the launcher select the freshly built binary.

Electron owns one product window and one host process. Normal application exit requests orderly
host shutdown, then force-terminates a host that does not acknowledge within the bounded grace
period. Host startup, protocol, or crash failures are reported as fatal application errors. Renderer
reload is unsupported because it would retain host-owned sessions while replacing their renderer
owner; restart the whole application after renderer or WebGL context failure.

## Verification and diagnostics

Use these checks from `apps/holtburger-3d`:

```bash
npm run check
npm run lint
npm run test:ts
npm run check:rust
```

`npm run smoke:sidecar` exercises the compiled release host with an empty content repository and
verifies handshake, status, orderly shutdown, and process exit. Rust diagnostics are written to
stderr and appear with a `[holtburger-host]` prefix under Electron; stdout is reserved for the
bounded MessagePack protocol.

Use `npm run harness:browser -- ...` for non-interactive browser, runtime, renderer,
content-lifecycle, and WebGL verification. The harness is an agent-operated diagnostic playground
and is not limited to terrain scenarios.

## Packaging and platform status

`npm run package` builds an unpacked application and `npm run make` creates the configured ZIP.
Both commands build the frontend, Electron main/preload code, and release Rust sidecar first.
`npm run check:package` verifies the native host, compiled entries, application license, and
Electron/Chromium notices in the unpacked package. After `npm run make`, `npm run check:archive`
extracts the ZIP and applies the same inspection to the downloadable shape.

The packages are unsigned experimental artifacts. Hosted CI has built and structurally inspected
Linux x86-64, Windows x86-64, and macOS arm64 packages, but that does not certify GPU, input, audio,
display scaling, Gatekeeper, or SmartScreen behavior. Only the available Linux desktop has received
interactive Explorer verification. Do not advertise another platform as supported until its
packaged application has been exercised on that operating system.

The branch-scoped `holtburger-3d-portability.yml` workflow is diagnostic only: it has read-only
permissions, retains artifacts briefly, and cannot publish a GitHub release. The repository's
canonical release workflow remains CLI-only until the 3D product is ready for an explicit publishing
decision.

## Security and dependency maintenance

The renderer has no Node integration. Electron enables context isolation and sandboxing, exposes
only the typed host bridge from preload, accepts IPC only from the product window's main frame,
restricts navigation to the development origin or packaged `dist` tree, denies new windows, and
applies a Content Security Policy. Rust validates the closed command protocol independently.

Review Electron and Electron Forge updates at least monthly and before sharing a build. Apply normal
compatible updates through npm, inspect `npm audit` rather than using a forced downgrade or override,
then run the full checks and package inspection above. Electron upgrades additionally require the
branch portability probe and a fresh manual smoke check on available hardware. There is no automatic
updater because there is no 3D release channel yet.

The packaged resources contain Holtburger's AGPLv3 license alongside the Electron and Chromium
notices supplied by Electron. Public distribution guidance, checksums, and reproducible build
instructions remain part of the later 3D release roadmap.

The WebGL2 backend has one flat-frame schedule: opaque scene color and depth are
rendered into a renderer-owned target, optionally receive near-field ambient
occlusion, and are presented with depth intact before transparent objects and
particles. Portal frames retain their packed-atlas compositor; optional ambient
occlusion consumes its planner-owned tiles after opaque submission without
introducing an alternate portal execution path. Sky, weather, transparent
objects, and particles remain outside ambient occlusion.
The Explorer's Render quality panel adjusts AO strength, radius, bias, edge
threshold, and distance fade live without reallocating its scratch targets.

The previous implementation is retained in `../holtburger-3d-legacy` as a runnable reference. Do not import TypeScript from the legacy app into this source tree.
