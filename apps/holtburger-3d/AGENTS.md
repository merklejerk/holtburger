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

**The harness renders on the real GPU with `--gpu`, and CPU and GPU timing both
work there.**

```
npm run harness:browser -- --brief --gpu --profile-renderer --measure-ms 6000 ...
```

SwiftShader is only the default because it is deterministic and available
everywhere. Pass `--gpu` for anything meant to be performance evidence.

Capture your own numbers; do not quote numbers recorded here or in any other
doc. A timing is only meaningful alongside the scene interest radius, content,
and hardware that produced it, and those are exactly the facts a pasted figure
loses. A stale capture taken at an unrepresentative radius reads as a budget and
will be believed. Record what a measurement _means_ in a plan or commit message
next to its configuration, not as a standing figure in this file.

### Looking at Particles

Particle changes are verified by looking, not by diffing. A known close-up
pose exists because every particle verification that failed did so on framing
rather than on run-to-run noise:

```
npm run harness:browser -- --landblock 0xda55ffff \
  --building-radius 1 --explicit-object-radius 1 --generated-object-radius 1 \
  --camera-position 42087,37.9,-16638.4 --camera-yaw 0 --camera-pitch 0 \
  --particle-seed 7 --screenshot <path>
```

That frames a lit candle a couple of metres away, large enough to judge flame
direction, billboard orientation, and blending. `--particle-seed` makes
emission repeatable; `--frame-interval-ms` and `--capture-frame` additionally
freeze simulation time, though captures are still not byte-identical for
reasons that were never isolated.

Emitter positions are discoverable rather than guessable: the scene-space
origin of every live emitter passes through `collectCohorts`, so a temporary
probe there yields real coordinates to point a camera at.

GPU spans are **elapsed-time** queries, not timestamps: Chrome reports zero
`QUERY_COUNTER_BITS_EXT` for `TIMESTAMP_EXT`, because absolute GPU timestamps
are a timing-attack vector, while `TIME_ELAPSED_EXT` is fully supported.
Elapsed queries cannot nest, so phases are sequential and `gpu.totalMs` is the
**sum of measured phases**, not wall-clock across the frame. There is
deliberately no GPU `otherMs`: unattributed GPU work is unmeasurable rather
than zero.

Treat the profile as attribution evidence, not a final diagnosis. GPU results
arrive delayed by a frame or more, and a disjoint GPU clock discards them.
Corroborate surprising results against the underlying code path before
optimizing.

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

Do not assume the harness is less capable than it is. Recorded limitations have
twice turned out to be untested inheritances: "GPU timing needs hardware we do
not have" was false — `--gpu` works — and the real cause was a profiler built on
an extension capability Chrome does not grant. **Before recording a capability
as unavailable, run the command and paste the failure.** A limitation without a
reproduction is a guess, and whoever reads it next will believe it.

## Coordinate Frames

Four frames are in play, and values in them are indistinguishable at runtime — every one is three
numbers. They are separated by type instead:

| frame           | origin                        | brands                      |
| --------------- | ----------------------------- | --------------------------- |
| AC authored     | per asset, **Z-up**, +Y north | `AcVector3`                 |
| landblock-local | that landblock's corner       | `LandblockVec3`             |
| canonical scene | world (0, 0)                  | `SceneVector3`, `SceneVec3` |
| anchor-relative | the **camera's** landblock    | `RenderVector3`             |

Two representations exist because two halves of the app want different shapes: assets, particles and
audio work in tuples, while camera, matrix and scene code works in the `Vec3` class. The `*Vector3`
brands are tuples and the `*Vec3` brands are `Vec3`. Both are erased at build time and cost nothing
at runtime — `renderVector3(v)` returns the same reference, and the brand symbols emit no code.

**The rule: brand positions in retained or cross-system contracts. Leave everything else a plain
`Vec3`.** A scale, a size, a direction, or an immediately-consumed function parameter has no origin
and therefore no frame to get wrong. A position that is stored, or that crosses a system boundary,
does.

Only `SceneVector3` and `LandblockVec3` may be **retained**. `RenderVector3` is measured from the
camera's landblock, so a stored one silently means a different world point once the camera crosses a
boundary — the value is unchanged, its origin moved.

The enforcement gap worth knowing: this is compiler-checked at every boundary that already uses a
branded type, and unchecked when someone declares a _new_ contract field as bare `Vec3`. That is
exactly how an unbranded position once reached `AudioListenerPlacement`, with the runtime asserting a
frame it could not verify. If you write `sceneVec3(...)` or `renderVector3(...)` inside a consumer
rather than at the producer that knows the frame, that assertion is a guess.

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

## Retail Decompile

When referencing the retail decompile, we generally want to approximate its behavior but not necessarily its architecture. Do not fall into the trap of rebuilding the retail client in rust/typescript. That client was written in 1999 under 1999 constraints. We have modern techniques and more mature software patterns available to us and should be able to improve on its design and performance.

### Marking Retail Behavior Divergence

Two greppable markers make the whole compatibility surface enumerable, which a third-party client
needs to be able to answer in one command:

- `RETAIL QUIRK:` — we **reproduce** a retail defect on purpose, because authored content was tuned
  against it and "fixing" it would change how shipped content looks or sounds.
- `RETAIL DIVERGENCE:` — we **deliberately depart** from retail, because the defect is provable and
  content cannot observe the difference, or because a 1999 constraint no longer applies to us.

```
grep -rn "RETAIL QUIRK\|RETAIL DIVERGENCE" apps crates
```

Both require, in the same comment:

1. An `acclient.c:` line reference for the behavior being matched or departed from.
2. What breaks if someone "corrects" it, or what evidence proves departing is safe.
3. The census that sized the blast radius, when one was run.

Reserve the markers for **observable behavior**. An unimplemented case that no shipped content
authors is a documented gap, not a divergence; say so plainly without a marker. Our own structural
choices — what a batch key contains, which frame a value is retained in — are not divergences either.

The bar for departing: authored content must be unable to observe the difference, or the difference
must be provably an improvement no content depended on. Prove the defect from the decompile rather
than inferring it, and measure how much content is affected before changing anything.

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
