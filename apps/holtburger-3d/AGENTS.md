# Holtburger 3D Frontend

This app is currently in an architectural stubbing phase. The immediate goal is
to define the domains, ownership boundaries, artifact shapes, and major runtime
flows for the replacement 3D client. It is not yet an end-to-end runnable game
client, and many implementations are intentionally absent.

## Current Expectations

- Treat `TODO` bodies, explicit `not implemented` errors, empty renderer plans,
  and incomplete subsystem adapters as expected scaffolding unless the current
  task asks to implement them.
- Do not expand the task into making the whole app run, eliminating every
  pre-existing type error, or filling every stub. Report unrelated scaffold
  holes without opportunistically implementing them.
- New or changed stubs should still communicate a coherent contract. Prefer
  honest names, discriminated unions, explicit coordinate spaces, and types that
  make invalid relationships difficult to represent.
- Keep changes minimal. Add only enough code to demonstrate the requested shape
  and flow. Apply YAGNI aggressively while the architecture is still moving.
- Do not use YAGNI to defer known behavior merely because its concrete lower-level
  consumer does not exist yet. In this phase, narrow types, pure reference
  algorithms, resource contracts, and call-site stubs are how established
  decisions are documented and protected. Defer inert implementation side
  effects, such as binding resources to a shader program that does not consume
  them, rather than deferring the contract those effects will eventually use.
- A stub is allowed to omit behavior; it should not pretend to implement
  behavior, silently swallow an invariant violation, or encode guesses as facts.
- Existing checks may fail because neighboring scaffolding is unfinished. Run
  focused checks for the touched area and clearly distinguish new failures from
  known unrelated holes.

## Design Review Priorities

When reviewing this app, prioritize architectural direction over feature or UX
completeness:

1. Are responsibilities assigned to the correct subsystem?
2. Do artifact shapes contain the facts required by their consumers without
   renderer, lifecycle, provenance, or diagnostic concerns leaking upstream?
3. Are ownership and lifetime explicit, without being confused with scene
   hierarchy or coordinate space?
4. Does the code illustrate the intended flow without speculative abstraction?
5. Can a missing implementation be added later without overturning the public
   shape?

Do not review the current stubs as if they were claiming production readiness.
Obvious no-op bodies are generally less important than a misleading domain
model.

## Legacy Frontend

`apps/holtburger-3d-legacy` is useful evidence for the kinds of source data,
render products, and game-client flows that must eventually exist. In
particular, compare legacy browser mode with this app's explorer mode.

Do not copy legacy architecture wholesale. The legacy frontend accumulated
excessive lifecycle indirection, diagnostics, provenance, ownership records, and
cross-system orchestration. Use it to answer concrete questions such as what a
static layer contains or what data a baker needs, then express that knowledge in
the simpler architecture being developed here.

Do not carry diagnostics or provenance through operational contracts merely
because legacy did. A separate metadata or diagnostics layer can be added when
there is a demonstrated need.

## Current Architectural Direction

### Commit Pipeline

- `StandardCommitPipeline` resolves source facts, plans texture placement, bakes
  render products, prepares atlas pages, and assembles commit bundles.
- `prepareLandblockLayers` may produce multiple bundles.
- Terrain commits retain canonical source metadata. The runtime terrain service
  generates complete landblock meshes according to current LOD policy.
- Non-terrain static layers cover buildings, explicit outdoor objects, generated
  scenery, and env-cell systems.
- Static-authored dynamic entities are promoted beside the static baked product;
  they are not baked into static geometry.
- Resolver source types should contain operational source facts needed by texture
  planning and baking, not task lifecycle, diagnostics, or renderer resources.

### Scene Graph

- `SceneGraph` owns canonical scene node identity, transform hierarchy, root
  residency, bounds, spatial indexing, and visibility queries.
- Every transform tree belongs to one landblock coordinate space through its
  root. A root may additionally reside in an env-cell within that landblock.
- Every node stores one `localTransform`. Root transforms are landblock-local;
  child transforms are parent-local.
- Child nodes inherit landblock and env-cell residency from their root.
- `SceneGraph` does not own layer lifetime, renderer resources, provenance, or
  diagnostic metadata.
- `destroyNode` accepts only root nodes and removes the complete transform tree.
  Destroying a parented node is an invariant violation.

### Runtime And Ownership

- `GameRuntime` bridges commit artifacts, terrain policy, scene graph nodes,
  atlas state, and renderer resources.
- Runtime layer ownership is tracked outside `SceneGraph`, currently through
  lease registries over the actual root node IDs and resource keys.
- Do not add synthetic scene nodes merely to represent a landblock layer or an
  ownership bundle.
- Spawned dynamic entities receive independent runtime ownership and scene roots.
  Their placement can change atomically over their lifetime.
- Renderer bindings and resources belong in runtime/renderer-facing structures,
  not in canonical scene nodes.

### Top-Level Lifecycle

- `ExplorerApp.svelte` owns the lifecycle of top-level subsystems such as
  `GameRuntime`, `StandardCommitPipeline`, renderer resource management, and the
  renderer.
- Each subsystem cleans up only resources it directly owns. `GameRuntime` must
  not transitively destroy injected top-level subsystems.
- The app coordinates shutdown order: stop frame production, dispose runtime
  work, stop the commit pipeline, release renderer resources, then destroy the
  renderer/context.

## Working Style

- Prefer clean cutovers. Do not leave aliases, compatibility wrappers, or dead
  files after a renamed or collapsed concept.
- Prefer addition through subtraction. Collapse duplicate representations before
  adding adapters between them.
- Do not introduce abstractions solely to anticipate hypothetical entity,
  renderer, tile, or diagnostics requirements.
- Comment new domain types and fields so the architectural intent survives while
  implementations remain stubbed.
- Add focused tests for implemented invariants and pure behavior. Do not write
  tests whose only purpose is asserting that an intentionally absent feature is
  still absent.
- Do not start the Tauri app or claim the app should run unless the user asks for
  runtime verification. Most current tasks should be verified with focused
  TypeScript tests, formatting, linting, and type checks where applicable.
