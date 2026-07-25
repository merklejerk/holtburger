# Holtburger 3D Frontend

This app is in a vertical-slice phase: its architecture is still moving, but
outdoor terrain is no longer only a set of contracts. A working path runs from
shared Rust content through Tauri or HTTP transport, TypeScript decoding,
runtime residency, and WebGL rendering. The app is not yet a full replacement
client: the primary client route is still a shell, terrain is the only typed
static source capability, and many subsystem implementations remain absent.

## Current Expectations

- Treat clearly marked `TODO` bodies, explicit `not implemented` errors, empty
  renderer plans, and incomplete subsystem adapters as expected scaffolding
  unless the current task asks to implement them. Do not dismiss a failure in
  the working terrain content, runtime, resource, scene, or WebGL path as
  "just stubbing."
- Do not expand the task into making the whole app run, eliminating every
  pre-existing type error, or filling every stub. Report unrelated scaffold
  holes without opportunistically implementing them.
- Preserve the working terrain vertical slice when changing its contracts or
  lifecycle. Its behavior is a proved architectural decision, not disposable
  scaffolding; use focused tests and the browser terrain harness when the task
  calls for runtime verification.
- New or changed stubs should still communicate a coherent contract. Prefer
  honest names, discriminated unions, explicit coordinate spaces, and types that
  make invalid relationships difficult to represent.
- Keep changes minimal. Add only enough code to demonstrate the requested shape
  and flow. Apply YAGNI aggressively while the architecture is still moving.
- Do not use YAGNI to defer known behavior merely because its concrete lower-level
  consumer does not exist yet. While the architecture is moving, narrow types, pure reference
  algorithms, resource contracts, and call-site stubs are how established
  decisions are documented and protected. Defer inert implementation side
  effects, such as binding resources to a shader program that does not consume
  them, rather than deferring the contract those effects will eventually use.
- A stub is allowed to omit behavior; it should not pretend to implement
  behavior, silently swallow an invariant violation, or encode guesses as facts.
- Treat visual realization as best-effort: a source may be available for
  camera placement or inspection before its geometry and textures are ready to
  render. Log texture, generation, and device-realization failures to the
  console with enough context to diagnose them, but do not add durable runtime
  error state, availability events, UI error history, or retry policy unless a
  concrete frontend workflow requires it. This does not weaken the rule to fail
  loudly for violated invariants or source-contract errors.
- Existing checks may fail because neighboring scaffolding is unfinished. Run
  focused checks for the touched area and clearly distinguish new failures from
  known unrelated holes.

## Design Review Priorities

When reviewing this app, prioritize architectural direction and the correctness
of proved vertical slices over feature or UX completeness:

1. Are responsibilities assigned to the correct subsystem?
2. Do artifact shapes contain the facts required by their consumers without
   renderer, lifecycle, provenance, or diagnostic concerns leaking upstream?
3. Are ownership and lifetime explicit, without being confused with scene
   hierarchy or coordinate space?
4. Does the code illustrate the intended flow without speculative abstraction?
5. Can a missing implementation be added later without overturning the public
   shape?
6. Does a change preserve the working terrain content-to-render path without
   promoting Explorer policy or renderer details into shared contracts?

Do not review unfinished subsystems as if they were claiming production
readiness. Obvious no-op bodies are generally less important than a misleading
domain model, but implemented terrain behavior is subject to normal correctness
and regression scrutiny.

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

## Working Style

- Prefer clean cutovers. Do not leave aliases, compatibility wrappers, or dead
  files after a renamed or collapsed concept.
- Prefer addition through subtraction. Collapse duplicate representations before
  adding adapters between them.
- Do not introduce abstractions solely to anticipate hypothetical entity,
  renderer, tile, or diagnostics requirements.
- Comment new domain types and fields so the architectural intent survives while
  implementations are incomplete or still changing.
- Add focused tests for implemented invariants and pure behavior. Do not write
  tests whose only purpose is asserting that an intentionally absent feature is
  still absent.
- Do not start the Tauri app or claim the app should run unless the user asks for
  runtime verification. Most current tasks should be verified with focused
  TypeScript tests, formatting, linting, and type checks where applicable.
