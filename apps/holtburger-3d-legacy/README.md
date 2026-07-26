# Holtburger 3D Legacy Archive

This directory preserves the retired 3D client as architectural and reverse-engineering
evidence. It is not a supported application, does not participate in the Cargo workspace or
continuous integration, and is expected to stop compiling as maintained shared contracts evolve.

Use it to answer focused historical questions. Do not preserve its contracts, dependencies, or
runtime behavior when changing maintained code.

## Boundaries

- `src/`: Svelte and TypeScript app code.
- `src/app/`: frontend mode state, browser-mode policy, and app-level view models.
- `src/pages/`: browser-mode pages and app-specific composition around shared renderer pieces.
- `src/lib/world-display/`: WebGL2 renderer foundation and render-scene helpers. Keep renderer infrastructure reusable inside this app, but do not make it own browser workflow policy.
- `src/lib/assets/`: frontend asset request planning, worker coordination, dependency scheduling, and hydration policy.
- `src/lib/host/`: typed frontend contracts for the Tauri host boundary.
- `src/workers/`: browser workers for expensive frontend-side preparation.
- `src-tauri/`: app-local Rust host adapter and Tauri command boundary.

Shared crates still own authoritative game state, protocol, content decoding, transport, and reusable client behavior. This app consumes those surfaces and decides how to present and interact with them in the browser.

## UX Direction

Browser mode should keep the 3D viewport primary. Panels, inspectors, and debug controls should support world inspection without scattering unrelated floating UI across the view. Prefer compact, workflow-oriented controls and app-local state over pushing browser presentation decisions into shared crates.
