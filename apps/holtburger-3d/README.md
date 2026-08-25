# Holtburger 3D

Electron-backed development surface for Holtburger's replacement 3D client. Authoritative app-local
content and simulation behavior runs in the `holtburger-3d-host` Rust sidecar; the renderer reaches
it through the context-isolated Electron preload boundary.

The Explorer runs the shared content, scene, runtime, and WebGL2 rendering
architecture against real client data. The primary client route is still a
minimal shell while gameplay-facing application work catches up with the
underlying runtime.

Explorer weenie discovery remains app-local: the Rust host lazily indexes the optional offline
catalog and returns bounded ranked identity results to the Entities picker. The browser commits one
exact WCID and the existing numeric spawn path remains the sole mutation contract; neither complete
catalog records nor fuzzy scores cross the adapter.

Use `npm run dev:explorer` for the Explorer and `npm run dev` or `npm run dev:client` for the client
route. Development startup incrementally builds the Rust sidecar, starts Vite, and supervises both
processes under Electron. `HOLTBURGER_DATS` may point at an explicit content installation; otherwise
development discovers the repository `dats` directory when present.

Use `npm run check`, `npm run check:electron`, `npm run lint`, and `npm run test:ts` for local static
and unit verification. `npm run package` creates an unpacked Electron package and `npm run make`
creates the configured distributable; cross-platform packaging and certification remain separate
release gates.

Use `npm run harness:browser -- ...` for non-interactive browser, runtime,
renderer, content-lifecycle, and WebGL verification. The harness is an
agent-operated diagnostic playground and is not limited to terrain scenarios.

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
