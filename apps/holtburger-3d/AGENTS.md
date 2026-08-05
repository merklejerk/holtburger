# Holtburger 3D Frontend

This app contains the working browser runtime and WebGL2 renderer used to prove
the future replacement client architecture. The Explorer is the current
working development surface: it loads real client content, manages
scene interest and residency, realizes static and dynamic objects, renders
outdoor and EnvCell scenes, executes portal views, and exposes focused
inspection controls. The primary `ClientApp` route remains intentionally thin,
but that bounded product gap does not make the shared runtime, content, scene,
or renderer paths scaffolding.

## Current Expectations

- Treat implemented code paths as real code. Investigate failures to their root
  cause; do not attribute them to scaffolding without concrete evidence.
- Distinguish an explicitly absent feature from a stubbed implementation. A
  placeholder Explorer panel or thin client route does not weaken invariants in
  neighboring runtime systems.
- Do not expand a focused task into completing the product surface. Report
  unrelated missing features without opportunistically implementing them.
- Prefer complete, honest vertical slices over speculative contracts. New
  abstractions must serve a demonstrated runtime, renderer, content, or frontend
  requirement.
- Fail loudly when source contracts, ownership, lifecycle, or renderer
  invariants are violated. Do not silently swallow failures or encode guesses as
  fallback behavior.
- Treat formatting, type-check, lint, test, and runtime failures as actionable.
  A failure is not presumed to be pre-existing or unrelated; prove that
  distinction when it matters.
- Preserve the boundary between frontend policy and shared game behavior.
  Explorer panels, controls, camera gestures, diagnostics presentation, and
  layout remain app-local. Reusable runtime semantics should live in the
  appropriate shared runtime subsystem.

## Runtime Verification and Browser Harness

Runtime verification is expected whenever a change crosses browser, WebGL,
worker, content-loading, lifecycle, scene-selection, or rendering boundaries.
Static checks alone are not sufficient evidence for those changes.

Use `npm run harness:browser -- ...` as the canonical non-interactive browser
playground. It can exercise production content and synthetic fixtures while
collecting machine-readable state, browser errors, timings, portal evidence,
and screenshots. It is not limited to terrain. Always run the harness using
a deterministic port based on your current branch, because another agent may
be working on the same machine under a different worktree and running their
own harness instance.

### Renderer Profiling

The Explorer Frame panel exposes explicit renderer CPU/GPU profiling. The
browser-harness equivalent is `npm run harness:browser -- --profile-renderer
...`. Use either to locate the responsible renderer boundary before changing a
performance-sensitive path.

Profiling is intentionally opt-in. When disabled, renderer hot paths must not
perform profiling clocks, GPU-query work, or retain profiling samples. Enabling
it may add CPU clocks and asynchronous GPU timestamp queries; disabling it must
tear down those resources again.

Treat the profile as attribution evidence, not a final diagnosis. GPU timestamp
results can be delayed or unsupported, and the SwiftShader browser harness is
useful for controlled before/after evidence but not for matching hardware
timings. Corroborate surprising results with a browser-native profile and the
underlying code path before optimizing.

The browser harness is agent-owned diagnostic infrastructure:

- Modify it freely to investigate and verify the current task.
- Add or retain fixtures, browser globals, probes, counters, controls,
  instrumentation, screenshots, and machine-readable output whenever useful.
- Use production content, synthetic content, targeted fault injection, or a
  combination of them.
- Reshape the canonical harness as its diagnostic role evolves. Harness API
  stability and product-level cleanliness are not requirements.
- Create another harness when that is more convenient, not because the
  canonical harness must remain narrow or pristine.
- Keep harness-only policy and diagnostics out of production contracts unless
  the production system independently needs the same capability.

Do not conclude that runtime verification is unavailable merely because the
interactive Tauri application is unsuitable for automation. Adapt the browser
harness or create a focused harness. If required local content, Chrome, or
another external prerequisite is genuinely unavailable, report the exact
missing prerequisite and use synthetic evidence where practical.

## Design Review Priorities

When reviewing or changing this app, prioritize:

1. Correct ownership and subsystem boundaries.
2. Lossless artifact and runtime shapes that contain the facts their consumers
   require without leaking renderer, lifecycle, provenance, or UI concerns.
3. Explicit resource and asynchronous lifetimes that are not confused with
   scene hierarchy or coordinate space.
4. Structural correctness across content, commit, runtime, scene, renderer, and
   frontend boundaries.
5. Preservation of richer future-client needs rather than optimization solely
   for the current Explorer UI.
6. Runtime evidence for behavior that static tests cannot prove.

Implemented behavior is subject to normal correctness and regression scrutiny.
Obvious placeholders should remain honest and localized, but they do not lower
the quality bar for the surrounding system.

## Legacy Frontend

`apps/holtburger-3d-legacy` remains useful evidence for source data, render
products, and client flows that must eventually exist. Compare its browser mode
with the current Explorer only to answer concrete behavioral or data-shape
questions.

Do not copy the legacy architecture wholesale. It accumulated excessive
lifecycle indirection, diagnostics, provenance, ownership records, and
cross-system orchestration. Express proven knowledge using the simpler current
architecture, and do not carry diagnostics or provenance through operational
contracts merely because the legacy app did.

## Working Style

- Prefer clean cutovers. Remove aliases, compatibility wrappers, stale comments,
  and dead files after a concept is renamed or collapsed.
- Prefer addition through subtraction. Collapse duplicate representations
  before adding adapters between them.
- Do not introduce abstractions for hypothetical entity, renderer, tile, or
  diagnostics requirements.
- Comment new domain types, fields, and unintuitive invariants so their intent
  survives future iteration.
- Add focused tests for implemented invariants and pure behavior. Do not write
  tests whose only purpose is asserting that an intentionally absent feature is
  still absent.
- Pair automated checks with browser-harness verification whenever the changed
  behavior depends on a real browser or GPU execution path.
- Be mindful of hot path operations that can cause GC churn in the renderer. Use reusable buffers, in-place, or output-to-target semantics where appropriate.
- Don't hide magic numbers and constants that are likely to need tweaking. Put them in places that can be easily found and accessed.
