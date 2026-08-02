# Holtburger 3D

Tauri-backed development surface for Holtburger's replacement 3D client.

The Explorer runs the shared content, scene, runtime, and WebGL2 rendering
architecture against real client data. The primary client route is still a
minimal shell while gameplay-facing application work catches up with the
underlying runtime.

Use `npm run harness:browser -- ...` for non-interactive browser, runtime,
renderer, content-lifecycle, and WebGL verification. The harness is an
agent-operated diagnostic playground and is not limited to terrain scenarios.

The previous implementation is retained in `../holtburger-3d-legacy` as a runnable reference. Do not import TypeScript from the legacy app into this source tree.
