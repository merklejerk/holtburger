# Holtburger 3D

Tauri-backed development surface for Holtburger's replacement 3D client.

The Explorer runs the shared content, scene, runtime, and WebGL2 rendering
architecture against real client data. The primary client route is still a
minimal shell while gameplay-facing application work catches up with the
underlying runtime.

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
