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
