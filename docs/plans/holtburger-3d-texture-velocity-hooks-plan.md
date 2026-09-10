# Texture velocity hooks

Status: implemented and verified, 2026-09-10. No outstanding implementation work or major blockers.

## Goal and approved decisions

Execute `TextureVelocity` and `TextureVelocityPart` hooks in Explorer and Client using **object-owned part velocities and one universal presentation clock**.

The user approved these simplifications after reviewing the initial retail-faithful proposal:

- Each object's parts own their velocities. A whole-object hook writes every part; a part hook writes only the selected part.
- Derive phase from `velocity × shared time`; do not accumulate phase or track activation timestamps.
- Activation joins the current phase. Changing rate may jump phase; zero rate resets that axis's offset to zero rather than freezing it.
- Objects receiving the same rate scroll in sync. A command on one object never changes another object, even when they share graphics/material resources.

In scope: both commands, existing behavior dispatch and replay, per-part effect state, object-renderer transport, repeat/clamp and direct/indexed sampling, existing blended/cutout/portal paths, focused tests, and a real-content browser demonstration.

Out of scope: an asset-wide velocity registry, static copies scrolling because another object received a hook, static graphics-identity preservation for this feature, accumulated phase, historical scheduling, new protocol/world behavior, TUI changes, new UI, or changing region-authored sky behavior. An object with its own script must use the existing behavior-capable presentation path; authored scenery is not necessarily a baked static render object.

## Ground truth and current neighborhood

App paths below are relative to `apps/holtburger-3d`.

| Boundary               | Evidence and implication                                                                                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decode                 | `crates/holtburger-dat/src/file_type/setup_model.rs`, `host/src/behavior_hook_source.rs`, and `src/lib/assets/decode-behavior-hook.ts` already decode, validate, and project both commands.                                                                                        |
| Dispatch               | `src/lib/game/behavior/behavior-event-router.ts:335` returns `no-consumer`. Extend the existing effect port and wire both runtime router compositions.                                                                                                                             |
| State                  | `src/lib/game/systems/effect-system.ts` already owns per-node, per-part effects. `systems/components.ts` defines `PartRenderState`, consumed by `dynamic-entity-system.ts`. These are the natural ownership seams.                                                                 |
| Shared resources       | Visual templates, dynamic appearances, geometry, and material tables are shared immutable resources. Per-object rates or offsets must not be written into them.                                                                                                                    |
| Dynamic batching       | `geometry/dynamic-layout.ts` retains dense part selectors; `renderer/dynamic-batched-ranges.ts` merges compatible ranges across parts. A single draw-wide offset cannot represent different part rates.                                                                            |
| Per-instance GPU state | `renderer/webgl2-dynamic-pose-pages.ts` already packs entity-specific matrix/color rows once per frame. `webgl2-object-program.ts` selects them using `aPart` and `uFirstPoseRow`. Extend this existing transport for per-part offset rather than mutating shared material tables. |
| Phase                  | `renderer/texture-scroll-phase.ts` computes wrapped phase in CPU double precision and is used by `webgl2-sky-pass.ts`. Reuse its arithmetic where wrapping is appropriate; its comment's authored consumer claim is currently stale.                                               |
| Sampling               | `renderer/webgl2-object-program.ts` treats base/indexed sampling and tiled detail separately. Offset the base coordinates without moving detail or palette lookup coordinates.                                                                                                     |

Retail references in `acclient-eor-source/acclient.c` establish what we deliberately change:

- `328864`, `328892`: dispatch to part/whole-object setters.
- `305404`, `305425`: setters register current parts' GfxObj DataIDs globally. Local ownership deliberately removes that cross-object effect.
- `300193`: nonzero commands replace a registered rate without resetting accumulated phase; zero removes an existing active entry, leaving its mesh offset. Universal-cursor rate changes and zero reset differ deliberately.
- `299999`: accumulated offsets and asymmetric wrapping (subtract one if prior total is at least one; negative values remain unnormalized). Do not describe modulo normalization as identical for clamped sampling.
- `341519`: retail stores offset on a shared mesh, without changing vertex buffers.
- `434352`: texture transform is set on stage zero. Preserve separate detail coordinates; inspect adjacent code while implementing the sampling change.

The approved ownership and cursor choices take precedence over the initial retail-faithful proposal. Document them with `RETAIL DIVERGENCE:` citations, practical consequences, and the census below. Do not claim every difference is unobservable: activation/rate changes and non-hook copies can differ visibly.

## Data distribution: measured, with limits

An offline census on 2026-09-10 read `/home/cluracan/code/holtburger/dats/assets.hba` through `ContentRepository`. It decoded every portal-namespace animation and physics script and then scanned setup defaults. Read/decode failures were fatal; the process completed successfully.

- 2,066 animations: zero hooks of either texture-velocity type.
- 4,248 physics scripts: 11 whole-object hooks in 11 scripts; zero part-scoped hooks.
- All 11 commands occur at authored time 1 second; rates are positive and equal on both axes: nine at 0.03, one at 0.05, one at 0.1.
- Eleven setups directly reference these scripts, covering 13 distinct GfxObj IDs. One setup repeats a GfxObj six times; its parts will derive identical offsets from identical rates and the shared clock.

| Script     | Setup      | GfxObj IDs                                     | U/V rate |
| ---------- | ---------- | ---------------------------------------------- | -------- |
| `33000D34` | `02000D79` | `01002A65`, `01002A64`, `01002A63` (six parts) | 0.1      |
| `33000D3C` | `02000DA8` | `01002B70`                                     | 0.03     |
| `33000D3D` | `02000DA9` | `01002B71`                                     | 0.05     |
| `33000D70` | `02000E68` | `01002CBE`                                     | 0.03     |
| `330012C0` | `02001A78` | `010046AC`                                     | 0.03     |
| `330012C1` | `02001A79` | `010046AE`                                     | 0.03     |
| `330012C2` | `02001A7A` | `010046AD`                                     | 0.03     |
| `330012C3` | `02001A7B` | `010046AF`                                     | 0.03     |
| `3300135D` | `02001BEF` | `01004D3C`                                     | 0.03     |
| `3300135E` | `02001BF0` | `01004D3D`                                     | 0.03     |
| `33001360` | `02001BF3` | `01004D40`                                     | 0.03     |

Method: temporary harness binary `texture_velocity_scope` iterated resource types `0x03`/`0x33`, matched typed payloads, reported frame/time/rates, then joined `0x02` setup default animation/script IDs to carriers. Command: `cargo run -q -p holtburger-debug-harness --bin texture_velocity_scope`. The temporary source was removed after the scan; raw output was written to `/tmp/texture-velocity-scope.txt`. The table above is the retained evidence.

This is not a full reachability or material census. It does not prove absence of indirect script-table/CallPES activations, other setups sharing these graphics assets, appearance substitutions, clamped surfaces, or visible placements. It also does not prove that arbitrary runtime activations cannot assign distinct rates to the same asset. Do not promote these 13 IDs into an implementation allowlist.

## Implementation evidence (2026-09-10)

- Material census decoded the 13 carrier GfxObjs: all rendered polygon sides repeat except two clamped polygons on `01004D3C` (setup `02001BEF`). Use the universal wrapped cursor for both sampling modes; clamp still applies to the offset UV. This deliberately cycles the clamped cursor instead of accumulating signed retail history.
- A complete portal setup scan found two additional shared-geometry definitions without default scripts: `02000E6E` and `020010A2`. Neither was placed in the scanned cell data.
- Scanning outdoor LandblockInfo objects and indoor EnvCell static objects found four directly placed non-hook graphics copies: `01002A63` in `00F10125`, `00F10126`, `00F10138`, and `01004D3C` in outdoor `2C31FFFE`. These stay stationary under the approved ownership rule. This scan does not enumerate generated Scene templates or runtime server spawns and makes no broader visibility claim.
- The same placement scan found 171 direct setup placements carrying the hooks: 34 `02000DA8`, 28 `02000DA9`, 27 `02000E68`, 4/3/4/4 of `02001A78`–`02001A7B`, and 25/37/5 of `02001BEF`/`02001BF0`/`02001BF3`.
- Region sky PES closure traversal decoded `33000428`, `33000429`, `3300042C`, `3300042D`, `33000453`, `330007DB`, including chained CallPES records: zero texture hooks. The new consumer remains scene-effect-owned; sky behavior is unchanged and no unsupported sky target is silently accepted.
- `DynamicEntitySystem.stageVisualReplacement` preserves effect state for the same setup and authored part indices. A different setup/part layout returns `requires-owner-replacement`; normal removal/install resets rates. Tests exercise rates through actual appearance/geometry replacement and verify sibling isolation.
- Both runtime routers already share the same `EffectSystem`, so extending its existing port covers both compositions. Scripted scenery uses dynamic presentation. All ordinary dynamic color paths use pose-table programs; uniform/attribute paths are static resources, sky/particles, or separately owned transition visuals and need no object-hook rate field.
- The material-table browser probe drives the actual EffectSystem through activation, equal rates, rate changes, effect/GPU resource recreation, and stop/reset at clock positions 2 and 3 seconds. It compares independent uniform reference draws against merged production pose pages in 240 cases: 48 material/wrap/cutout/opacity combinations for each lifecycle scenario, with a fixed patterned detail layer. Existing static material-table and all portal/fog/PSSM shader variants remain covered. The brittle source-string gradient assertion was removed in favor of rendered coverage.

## Contracts and implementation shape

**Effect state:** extend the existing `EffectSystem` and `EffectCommandPort`; do not create a separate `TextureVelocitySystem`. Store one U/V velocity pair per part alongside related effect state. Collapse related per-part fields where practical rather than adding parallel arrays with matching-index invariants. Installation initializes zero velocity; removal/generation replacement follows the existing object lifecycle. Ordinary material/appearance refresh preserves rates for retained parts; a replacement part layout follows the existing effect-state reinstall boundary, which Phase 1 must trace explicitly.

**Sampling:** expose rates through the existing per-part presentation contract. At renderer frame preparation, derive offsets once per selected object part using the same presentation time for every view. Rates are cold until a command changes them: deriving phase in the renderer must not make effect sampling, transforms, or Svelte state dirty every frame. No elapsed-time integration, activation time, or retained phase is needed. Initial replay folds the final rates in existing command order, then rendering samples the current shared cursor. It does not replay elapsed scrolling.

**GPU transport:** extend the entity-specific part rows in `webgl2-dynamic-pose-pages.ts` with the derived offset, read through the existing part selector. This preserves merged draws and per-object isolation. Use uniforms only for relevant existing single-part/uniform draw paths; audit attribute-based paths before choosing any extension there. Shared appearances and material tables remain immutable. Pass the offset separately from the original UV so base sampling can scroll while detail remains fixed.

One additional RGBA32F texel would increase the existing five-texel pose row by 20% (16 bytes per uploaded part). This is a concrete transport cost, not a measured frame-time regression. Verify actual upload bytes and update existing byte accounting/constants. Prefer this bounded extension to an extra independently allocated effects table unless measurements justify another design.

**Wrapping:** repeat surfaces use wrapped phase from the existing helper. Inspect actual hook carriers for clamp modes before finalizing their phase convention; a universal wrapped cursor can visibly cycle a clamped surface. This is a bounded implementation check, not a reason to reintroduce accumulators. If carriers require a different convention, document the evidence and the narrowest compatible sampling rule.

**Targets:** retain router generation checks, authored part validation, and existing direction filtering. Cover both runtime router compositions. Sky targets do not become scene nodes: inspect reachability and route only through an appropriate existing owner, or retain an explicit honest unsupported outcome for an unimplemented target class. This feature does not introduce a second owner for region-authored sky rates.

## Phases and acceptance

### Phase 1 — Confirm the remaining renderer and content seams

- [x] Inspect carrier materials/wrap modes and choose a real-content close-up fixture from the census.
- [x] Check whether visible non-hook static copies relied on retail's asset-wide activation; record the blast radius of the approved local-ownership divergence. Do not silently restore shared ownership if such copies exist.
- [x] Trace behavior-capable scenery into dynamic presentation, both router compositions, and target/layout replacement. Confirm per-part state survives ordinary appearance changes.
- [x] Trace per-instance pose packing and all consuming object draw variants. Name where shared frame time enters and where offset is computed once.

Acceptance: concrete fixture, explicit clamp convention, correct lifecycle seam, and a complete per-object transport path. No user preference remains pending. Report any newly discovered material impact on the accepted visual tradeoff.

### Phase 2 — Consume hooks in existing effect state

Touch `behavior-event-router.ts`, `effect-system.ts`, `components.ts`, runtime wiring, and the immediate presentation consumers/tests.

- [x] Implement whole-object and selected-part velocity assignment through the existing effect consumer.
- [x] Carry rates through per-part presentation without mutating templates/materials or adding per-frame effect invalidations.
- [x] Cover independent objects sharing a template, whole/part command order, repeated assignment, zero/negative rates, initial replay, stale generations, appearance refresh, and layout replacement.
- [x] Update dispatch outcomes to reflect actual application and replay folding.

Acceptance: commands update only their target's parts; repeated assignment has no phase reset mechanism; other copies are unaffected. Removal needs no graphics-asset registry cleanup.

### Phase 3 — Derive and render phase

Touch `texture-scroll-phase.ts` as needed, `webgl2-dynamic-pose-pages.ts`, `webgl2-object-program.ts`, renderer preparation, and any required existing uniform-path binding seam.

- [x] Derive phase in CPU double precision once per selected part/frame, using the universal presentation cursor. New/reloaded objects join the current phase when their hook is active.
- [x] Extend entity-specific GPU rows and layout/byte accounting; retain current merged draws and shared immutable materials.
- [x] Apply offsets before base/indexed wrapping and atlas mapping; preserve gradients, detail coordinates, and palette lookup coordinates.
- [x] Verify repeat/clamp, opaque/cutout/blended paths, differently scrolling merged parts, and multiple views. GPU recreation derives current offsets without restoring stored phase.

Acceptance: two objects sharing one appearance can have different rates; equal rates synchronize regardless of activation time; rate changes use the new absolute-time phase; zero resets offset. No static grouping changes or per-frame mesh/atlas rebuilds.

### Phase 4 — Browser proof and cleanup

- [x] Add asset-independent synthetic browser fixtures with controlled time for activation, equal/different rates on shared resources, part isolation, zero reset, and reload. Include indexed sampling, detail, and a relevant portal/view case.
- [x] Use `npm run harness:browser -- ...` for a censused setup before/after its one-second activation. Record content ID, camera, times, render scale, browser errors, and affected upload bytes. Do not run the TUI.
- [x] Run focused `npm run test:ts -- ...`, `npm run check`, `npm run lint:ts`, and `npm run lint:dead`; check formatting using configured Prettier through npm. Run Rust checks/clippy if Rust production contracts change.
- [x] Update the helper's comments to describe the actual consumer and accepted phase jumps. Replace obsolete router tests/comments and add the required divergence markers with evidence.
- [x] Remove temporary probes and asset-dependent tests; review ownership, shared-resource isolation, and frame invalidation; run `git diff --check`.

Acceptance: independent tests and real browser evidence agree, required checks pass, and the final implementation has no unused global-registry or phase-integration vocabulary. No staging or commits without a separate request.

## Risks, scope, and definition of done

| Risk                                                      | Mitigation                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Per-object effects accidentally mutate shared appearances | Pack offsets in entity-specific part rows; test two instances sharing one appearance.             |
| Phase sampling dirties effects/transforms every frame     | Keep velocities in effect snapshots; derive phase in renderer preparation using its frame time.   |
| Static copies no longer inherit another object's hook     | Accepted divergence; inspect real placements and record consequences without adding shared state. |
| Wrapped phase behaves unexpectedly on clamp surfaces      | Material census and targeted pixels before finalizing sampling.                                   |
| Additional pose row width increases upload work           | Account for the 16-byte-per-part increment and verify actual bytes; retain existing batching.     |
| Small archive population leaves generic commands untested | Synthetic part-scoped, negative, zero, and rate-change cases.                                     |

This remains a bounded renderer integration, but is smaller than the initial proposal: no global registry, asset-retention bookkeeping, static material-row expansion, or historical timing contract. Expect a few hundred production lines across existing effect/presentation/renderer seams; reassess before introducing another subsystem. The earlier 10–16-module/600–900-line scope estimate is superseded, not an implementation budget.

- [x] Both commands visibly affect only their target's selected parts.
- [x] Equal velocities share phase through the universal clock; activation, rate changes, and zero reset follow the approved behavior.
- [x] Shared immutable resources remain shared and unmodified; batching and all relevant views render correctly.
- [x] Appearance/lifecycle changes, tests, browser evidence, checks, divergence documentation, and cleanup are complete.

There are no remaining product questions for the user. Material wrapping, static-copy blast radius, behavior-target coverage, and exact renderer packing are implementation checks in Phase 1. The approved design does not depend on matching retail stop/freeze semantics or proving that every ownership difference is invisible.

## Final verification and review

- `npm run test:ts`: **275 files, 2,155 tests passed**. The obsolete shader-string assertion was removed. The browser reference independently checks phase and pose transport, but shares the production fragment shader; it is not an independent oracle for gradient or detail-coordinate correctness. Those expressions were reviewed directly.
- `npm run check`: Svelte, app/node, test, and Electron type checks passed with zero Svelte diagnostics.
- `npm run lint:ts` and `npm run lint:dead`: passed. Configured Prettier check on all changed TypeScript files passed; `git diff --check` passed.
- Final browser material probe: **240 pixel-exact lifecycle cases**, 16 static table cases, eight dynamic and eight static shader variants linked, and last-legal-pose-row rendering passed. Two part rows upload **192 bytes**, consistent with six RGBA32F texels per part. No shared material expansion is required.
- Real-content fixture: landblock `0x2c30ffff`, setup `02001BEF` near local AC position `(83.5,108,200)`. Camera render position `(8531.5,220,-9300)`, yaw `0` degrees, pitch `-35` degrees, time of day `0.5`, render scale `1`; building and explicit-object radius `1`, generated-object radius `0`. The settled live run recorded **67 executed texture-velocity hooks**, zero `no-consumer` texture outcomes, and no browser console errors. The frame uploaded 29,760 pose bytes; this is workload evidence, not a comparative performance claim.
- The same active scene passed the existing frozen multi-view probe in **flat and portal modes**: standalone versus combined views had identical pixels, repeated views did not duplicate pose uploads, and combined views uploaded the selected union (29,760 bytes for the first view, 39,360 for the union).
- Before-activation capture froze at frame 1 with 100 ms frame time and recorded no texture hooks. `/tmp/texture-before.png` and `/tmp/texture-active.png` were visually inspected. They are context captures, not a pixel-diff oracle: weather/particles and independent loading also change between sessions. The deterministic synthetic probe supplies the pixel oracle.
- An initial live capture during source HMR was discarded. Two early fixed-frame captures froze before content activation; they are not evidence of active scrolling. A software-rendered 120-frame capture exceeded the harness deadline. Final active/multi-view proof uses the live settled clock on hardware rendering; no simulation behavior was changed to accommodate the harness.
- Temporary Rust material/placement/sky probes were deleted. Their read-only outputs remain under `/tmp/texture-material-scope.txt` and `/tmp/texture-sky-scope.txt`; measured facts are retained above. No runtime-asset-dependent tests, production Rust changes, staged files, or commits remain.

Final ownership review: the effect owner assigns cold per-part rates, active presentation carries those rates, renderer pose preparation derives each selected part's offset once, and the GPU reads instance rows independently of shared material records. Appearance refresh and cloak handling preserve texture state independently from translucency. No global velocity registry, source-ID classifier, phase accumulator, new scheduler, or frame-rate UI state was introduced. The implementation adds roughly 90 net production TypeScript lines; most diff volume is browser/unit coverage and formatting around the expanded probe cases.

The requested pre-commit code-quality pass covered the complete implementation and test diff, router-to-effect ownership, appearance/cloak lifecycle, pose uploads for all views, shader sampling, and verification claims. No blocking design or correctness findings were identified. Cleanup removed an adjacent duplicate documentation block and bounded the browser oracle claim above. The user also confirmed the result visually in the client. The accepted retail divergences and 16-byte-per-part upload increase remain intentional tradeoffs.

Reproduce the final browser proof from `apps/holtburger-3d`:

```sh
HOLTBURGER_DATS=/home/cluracan/code/holtburger/dats HOLTBURGER_PROBE_MATERIAL_TABLES=1 npm run harness:browser -- --brief --gpu --landblock 0x2c30ffff --building-radius 1 --explicit-object-radius 1 --generated-object-radius 0 --camera-position 8531.5,220,-9300 --camera-yaw 0 --camera-pitch -35 --time-of-day 0.5 --measure-ms 1000 --screenshot /tmp/texture-final.png
```

For multi-view verification, use the same scene/camera with `--probe-dynamic-views --measure-ms 2000` and a screenshot path. The harness chooses independent loopback ports; it requires permission to bind local servers and launch Chromium outside the restricted sandbox.
