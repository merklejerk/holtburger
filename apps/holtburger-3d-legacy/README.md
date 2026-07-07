# holtburger-3d

`holtburger-3d` is the browser/Tauri 3D client app for Holtburger. It is the proving ground for the future graphical client and currently focuses on browser mode: loading world content, inspecting landblocks and interiors, exercising the asset pipeline, and validating renderer-facing contracts.

The app is frontend-owned. Browser-mode UX, panels, tabs, viewport HUDs, camera gestures, selection affordances, debug overlays, and other presentation policy should stay in this app rather than moving into shared Rust crates.

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

## Development

Install dependencies from this directory:

```sh
npm install
```

Run the browser frontend:

```sh
npm run dev
```

Run the Tauri app:

```sh
npm run tauri:dev
```

Build outputs:

```sh
npm run build
npm run tauri:build
```

## Quality Gates

Run the TypeScript, Svelte, Rust, lint, dead-code, formatting, and test checks before handing off app changes:

```sh
npm run check
npm run check:rust
npm run test:ts
npm run lint
npm run format:check
```

`npm run lint` includes TypeScript ESLint, Knip dead-code checks, and Rust clippy with warnings treated as errors.

## UX Direction

Browser mode should keep the 3D viewport primary. Panels, inspectors, and debug controls should support world inspection without scattering unrelated floating UI across the view. Prefer compact, workflow-oriented controls and app-local state over pushing browser presentation decisions into shared crates.
