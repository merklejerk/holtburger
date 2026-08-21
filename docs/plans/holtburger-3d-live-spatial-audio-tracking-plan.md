# Live Spatial Audio Tracking Plan

## Goal

Make playing voices track the listener continuously, so a sound's gain and pan follow the camera for
the whole of its playback instead of being frozen at the instant it fired.

## Scope

**In scope**

- Per-frame re-placement of every live voice against the current listener pose.
- A device contract that can update a playing voice's gain and pan without artifacts.
- A placement source on triggers, so continuous ambience stays head-locked in position while its gain
  tracks the listener live through `share` — the quantity that actually governs a bed — instead of
  waiting for its next firing.
- Removing the ambient scan's per-cell allocation, and splitting its two outputs onto the two cadences
  their consumers actually need. This is what makes live bed gain affordable at frame rate, so it is a
  prerequisite rather than an adjacent cleanup.
- Placing a warm-and-replay sound at replay time rather than replaying a stale placement.
- The two defects flagged during investigation: an orphaned doc comment in `game-runtime.ts`, and the
  unmarked pan-model departure in `placeSpatialAudio` — **decided**: we keep the 3D projection and
  mark it `RETAIL DIVERGENCE` in Phase 1; no content census required (see Decisions).
- Marking the whole behavior as a deliberate retail departure, with citations and a census.

**Out of scope**

- Emitters dragging their own sounds as the _emitting object_ moves. Voices deliberately outlive
  their owners (`audio-system.ts:136-140`, acclient.c:366405-366407), so a back-pointer to the owner
  needs a policy for the owner vanishing mid-playback. The retained-position shape this plan lands
  makes that a later, small addition; it is not attempted here. See Open Questions.
- HRTF, occlusion, reverb, environmental filtering, or a mixing graph. None of these exist in retail's
  hook path and none are needed to answer "does it follow the camera".
- Looping and streaming voices. The system plays one-shots only, on purpose.
- Replacing `placeSpatialAudio` with Web Audio's native `PannerNode`. Rejected under Ground Truth
  below; the reasoning is recorded there so it is not re-litigated.

## Ground Truth

**Reference sources**

- `acclient-eor-source/acclient.c:366427-366467` — `SoundManager::GetAttenuation`, the flat radius,
  the inverse-square falloff, the post-clamp category multiply, and the `VOL_MIN` floor.
- `acclient-eor-source/acclient.c:366495-366518` — `PlaySoundA`: distance and heading sampled once,
  pan computed as `sin(headingDiff) * -15.0`, both handed to `PlaySoundInternal` as plain integers.
- `acclient-eor-source/acclient.c:366405-366407` — playing voices are fire-and-forget copies with no
  back-pointer to the emitter.
- `acclient-eor-source/acclient.c:366840-366863` — `PlayAmbientSoundFromCenter`: distance `0.0` and
  pan `0` are both hardcoded. Continuous ambience has no position in retail, which is what Phase 4
  turns from an accident into a stated fact.
- **The census that justifies the departure:** `GetAttenuation` has exactly four call sites in the
  entire binary — 366516, 366859, 366879, 366904 — and every one of them sits inside a
  sound-_starting_ function. There is no update loop and no per-frame re-attenuation pass anywhere in
  the client. Retail's frozen placement is a fact about the whole binary, not about one path.

**Existing patterns**

- `apps/holtburger-3d/src/lib/game/systems/audio-spatialization.ts` — the pure placement function.
  It stays pure and stays the single owner of the retail curve; this plan changes how often it is
  called, not what it computes.
- `apps/holtburger-3d/src/lib/game/systems/audio-system.ts` — voice budget, outcome accounting,
  warm-and-replay.
- `apps/holtburger-3d/src/lib/assets/web-audio-device.ts` — the thin Web Audio adapter.
- `apps/holtburger-3d/src/lib/game/runtime/game-runtime.ts:1440-1460` — the frame `advance` hook that
  already drives effects, scripts, particles, ambience, and animation in order.
- `apps/holtburger-3d/src/lib/game/systems/ambient-system.ts:239-247` — ambience placement, including
  the synthesized position Phase 4 removes.

**Why not `PannerNode`**

The native panner would give per-frame tracking for free, and it is still the wrong trade. Its
`exponential` distance model with `refDistance = 5, rolloffFactor = 2` does reproduce retail's
`25 / d²` exactly, but three things do not survive: retail clamps gain to 1.0 _after_ attenuation and
_before_ the category multiply, which no `PannerNode` parameter expresses; retail refuses to play
below a `-50 dB` floor rather than playing inaudibly; and retail's pan is a sine of a horizontal
heading, not a spatialized HRTF or equal-power position. Re-running `placeSpatialAudio` for at most
16 voices per frame is a few hypots — genuinely free — and keeps one authority for the retail curve.
Taking the native panner would mean reimplementing the clamp and the floor around it anyway.

## Architecture Placement

Net new files: zero. Every deliverable reshapes a module that already owns the neighboring job:

| where                                                             | what changes                                                                                                                                                         |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `holtburger-dat`, `src-tauri` manifest, `active-region-source.ts` | nothing — authored tables, `squareLength`, and validation already flow through                                                                                       |
| `ambient-region.ts`                                               | assigns integer descriptor slots at install; the string `classificationKey` dies here                                                                                |
| `ambient-scan.ts`                                                 | the bake (`bakeAmbientBlock`), the per-frame weight pass (`accumulateAmbientWeights`), and the schedule scan rewritten over baked entries; stays pure and clock-free |
| `ambient-system.ts`                                               | owns the baked-block registry (terrain install/release), the reusable per-slot weight buffer, the schedule, and the live share suppliers                             |
| `audio-system.ts`                                                 | `AudioPlacementSource`, `LiveVoice`, `advance()` re-placement                                                                                                        |
| `audio-spatialization.ts`                                         | **frozen** — the single authority on the retail curve stays byte-identical so it is never the suspect                                                                |
| `web-audio-device.ts`                                             | `setPlacement` via `setTargetAtTime`; still the only file touching Web Audio                                                                                         |
| `game-runtime.ts`                                                 | wiring only: forwards terrain lifecycle to `AmbientSystem`, numeric rescan trigger, `advance` order                                                                  |

Nothing moves to the Rust crates: the shared part (authored data) is already in `holtburger-dat`;
everything above it is a frontend audio runtime that terminates in Web Audio and serves a listener
that is a camera. A future non-browser client swaps the device layer and reuses the same crates.

## North Stars

1. One authority for the retail curve. `placeSpatialAudio` stays pure and stays the only place gain
   and pan are decided; live tracking is a change in call frequency, not a second implementation.
2. Voices retain _facts_, not _derived results_. A voice remembers where it is in the world; gain and
   pan are recomputed from that, never stored and re-served.
3. The departure from retail is deliberate, marked, and cited — not an accident of writing modern
   code.
4. Frozen-at-trigger behavior does not survive anywhere by omission. If some path still needs a
   head-locked sound, it says so in its trigger rather than relying on nothing updating it.
5. Silence caused by our own logic stays diagnosable. The outcome counters exist because conflated
   silence was undebuggable once already.
6. Smooth is part of correct. A per-frame write to an `AudioParam` that clicks is not a working
   feature.
7. Audio parity with retail is **approximate by policy**. Match the authored intent — what plays,
   roughly where from, roughly how loud — not the bit-exact numerology. A sound being a few percent
   more or less likely, or a placement landing meters off retail's roll, is not a defect and must not
   deter a cleaner design. Reserve exactness for what the ear or the content actually observes, and
   spend divergence markers on _categorical_ departures (live tracking, pan model), not decimal ones.

## Phase 0 — Freebie: orphaned doc comment

Zero-risk, independent of everything below, done first so the file is honest before it is edited.

**Deliverables**

- Delete the stranded JSDoc block at `game-runtime.ts:1132-1138`. It documents "Apply user audio
  settings" and sits directly on top of a second, correct JSDoc for `installAmbientRegion`, which it
  now silently misdescribes. The method it belonged to moved; the comment did not.

**Acceptance criteria**

- `installAmbientRegion` carries exactly one doc comment, and it describes `installAmbientRegion`.
- Typecheck, lint, and format clean.

**Tasks**

- [x] Remove the orphaned block; confirm no other stranded doc pairs exist in the audio region of
      `game-runtime.ts`. **Done 2026-08-16.** Swept the whole file for consecutive JSDoc blocks:
      none remain. Course correction: the stray block was the _displaced_ doc of `setAudioSettings`
      (still live, ~90 lines later, undocumented) and its content had also gone stale — "only the
      effect category exists so far" predates the ambient category. Rather than pure deletion, the
      method received a fresh two-line doc stating what is still true (volume-of-zero equals retail's
      enable flag). Prettier, eslint, and `tsc --noEmit` clean.

## Phase 1 — Live placement

The core of the feature. A voice becomes something that can be re-placed, the system retains what it
needs to re-place it, and the frame loop does so.

**Deliverables**

- `AudioVoice` gains `setPlacement(gain: number, pan: number): void`. This is the whole reason the
  interface exists in this shape; document that a voice is now steerable and that calling it after
  the voice finished is a no-op rather than an error.
- `WebAudioDevice` implements it against the retained `GainNode` and `StereoPannerNode` it already
  builds. **Writes go through `setTargetAtTime`, not `.value`.** A direct per-frame assignment to an
  `AudioParam` steps the signal once per frame and produces zipper noise; the smoothing constant is a
  tuning knob, not an implementation detail.
- `FRONTEND_TUNING.audio.placementSmoothingSeconds` — the `setTargetAtTime` time constant. Start at
  `0.02`. Documented as the tradeoff it is: too small clicks, too large smears a fast pan.
- `AudioSystem` retains a `LiveVoice` record per playing voice — the voice handle plus the facts
  needed to re-place it (`position`, `volume`, `category`). The bare `AudioVoice[]` becomes
  `LiveVoice[]`.
- `AudioSystem.advance(timeSeconds: number): void` — sweep finished voices, then re-place the
  survivors against the current listener and settings. Named `advance` to match every other
  frame-driven system in the runtime.
- Below the audible floor, a live voice is **silenced (gain 0), not stopped.** The trigger-time
  audibility gate is unchanged and still refuses to _start_ an inaudible sound; but a free-flying
  explorer camera routinely leaves and re-enters earshot, and stopping would make return trips
  silently lossy. Comment this, because "why not stop it" is the obvious question.
- Call `this.#audio.advance(timeSeconds)` in `game-runtime.ts`, immediately after
  `this.#ambient.advance(timeSeconds)` — ambience triggers first, then every voice including the
  new ones places against the same listener pose.
- A second `RETAIL DIVERGENCE:` marker on `placeSpatialAudio`'s pan projection: retail pans by the
  sine of a _horizontal_ heading difference (acclient.c:366509-366514), we project the full 3D delta.
  Decided as a product choice — pan is presentation, no shipped content observes stereo placement, and
  the 3D behavior is the one a modern client wants. The marker cites the retail lines and records the
  decision rather than a census.
- A `RETAIL DIVERGENCE:` marker on `AudioSystem`, carrying the four-call-site census above, the
  `acclient.c:366516` citation, and the argument: authored content cannot observe the difference
  because no shipped content can depend on a sound _failing_ to track a listener that 1999 hardware
  could not afford to track. The 1999 constraint — DirectSound buffers and a CPU budget — no longer
  applies to us.

**Acceptance criteria**

- Unit test: a voice triggered at a fixed world position, followed by `setListener` to a farther
  position and `advance`, receives a strictly lower gain via `setPlacement`.
- Unit test: moving the listener so the source crosses from its right to its left flips the sign of
  the pan delivered to `setPlacement`.
- Unit test: a voice that recedes past the audible floor is silenced and **not** stopped, and
  regains audible gain when the listener returns.
- Unit test: `advance` sweeps finished voices and does not call `setPlacement` on them.
- `web-audio-device.test.ts` covers that `setPlacement` schedules on the params rather than writing
  `.value`, and that it is inert after `onended`.
- Dry-run note: every fake `AudioDevice`/`AudioVoice` in `audio-system.test.ts` grows `setPlacement`;
  budget for that churn here rather than discovering it mid-phase.

**Tasks** — all done 2026-08-16; full suite 1081/1081, both tsconfigs and svelte-check clean.

- [x] Extend `AudioVoice` and `AudioDevice` docs to describe a steerable voice.
- [x] Implement `setPlacement` in `WebAudioDevice` with `setTargetAtTime`.
- [x] Add the smoothing constant to `frontend-tuning.ts` (injected into the device constructor).
- [x] Introduce `LiveVoice` and migrate `#voices` and `#claimVoiceSlot`.
- [x] Implement `AudioSystem.advance`.
- [x] Wire it into the runtime frame loop after ambience.
- [x] Write both `RETAIL DIVERGENCE` markers (live tracking on `AudioSystem`, 3D pan in
      `placeSpatialAudio`).
- [x] Tests as above, plus a live-settings-change test.

**Decisions and course corrections (Phase 1)**

- `advance()` takes no clock, deviating from the sibling `advance(timeSeconds)` signature:
  re-placement is a pure function of the current listener and settings, and an unused parameter
  would be dishonest. Documented on the method.
- `#warmAndReplay` now threads the whole trigger (facts needed for `LiveVoice`), so a warm-replayed
  voice already rides `advance` and a stale start corrects on the next frame. Phase 2 shrinks to
  computing the _initial_ placement at replay time.
- The `maximumWarmupReplaySeconds` doc rewrite planned for Phase 2 was pulled into this phase — its
  frozen-placement rationale became false here, and the vocabulary rule says rewrite in the change
  that falsifies. Same for the module doc of `audio-spatialization.ts`; its curve stayed untouched.
- Voice-retention bookkeeping deduplicated into `#retain` (trigger and warm-replay paths).

## Phase 2 — Replay places at replay time

**Deliverables**

- `#warmAndReplay` stops carrying a `SpatialAudioPlacement` and carries the trigger's retained facts
  instead, re-placing when the buffer lands. Today it replays a placement computed before the decode,
  which is stale by construction — and with Phase 1 live, a sound that arrives late would snap from a
  stale placement to a live one on its first `advance`. Placing at replay time removes the snap and
  deletes a stale-value path rather than papering over it.
- `SpatialAudioPlacement` should now be retained by nothing anywhere. Confirm it is a pure return
  value and nothing stores one.
- Rewrite `FRONTEND_TUNING.audio.maximumWarmupReplaySeconds`'s doc comment. Its stated rationale is
  "playing it would place a sound where the listener no longer is, since retail fixes gain and pan at
  trigger time and never updates them" — that reason is gone. The bound survives, but now on purely
  temporal grounds: a footstep that arrives 300 ms late belongs to a moment that has passed. Say
  that instead.

**Acceptance criteria**

- Unit test: a device that refuses, then accepts after the listener has moved, plays at the
  _replay-time_ placement, not the trigger-time one.
- Grep confirms no retained `SpatialAudioPlacement`.
- The warmup tuning comment no longer cites frozen placement.

**Tasks** — all done 2026-08-16; 23/23 in `audio-system.test.ts`, tsc both configs, lint clean.

- [x] Rework `#warmAndReplay` to retain trigger facts (landed early, in Phase 1).
- [x] Re-place at replay; `SpatialAudioPlacement` import dropped — the type is now retained nowhere.
- [x] Rewrite the tuning doc comment (landed early, in Phase 1, per the vocabulary rule).
- [x] Tests: replay places from the replay-time listener (pan flips when the listener crossed the
      source mid-decode), plus the new gate below.

**Decision (Phase 2):** a warmed sound whose listener left earshot during the decode is not started —
the same audible-floor gate the trigger applies, applied at the moment that now matters — and counts
toward `inaudibleCount`, whose doc now names both moments. Starting it at gain 0 would burn a voice
slot for nothing; the trigger-time gate already establishes that inaudible sounds do not start.

## Phase 3 — Bake the static ambience map, stream the weights

A prerequisite for live bed gain, and a defect worth fixing on its own terms.

**Split what the scan computes into its static and dynamic halves.** Per cell, the scan currently
does two jobs every time it runs:

1. _What does this cell contribute?_ Terrain sample → terrain code and scene index → descriptor
   list, via a string-keyed classification map (`ambient-region.ts:73-76`). This depends only on the
   authored terrain and the installed region. It is the same answer every scan, for the lifetime of
   the block — recomputed, with string keys, on every cell crossing.
2. _How much, from here?_ Distance from the listener → weight → accumulate. This is the only part
   that actually depends on where the camera is, and it is trivial arithmetic.

Job 1 is baked **once per landblock, at terrain install** — the event when nearby cells actually
change, which the runtime already tracks (`#terrain.installationRevision` is in the rescan key
today). The bake emits flat parallel typed arrays per block: one entry per (cell, descriptor slot)
pair carrying the cell's scene position and the slot index. Blocks with no contributing cells bake to
an empty map and cost nothing thereafter. Job 2 becomes a loop over those arrays: subtract, square,
weight, add into a per-slot accumulator. No resolution, no maps, no strings, no allocation — cheap
enough to run every frame without asking.

**Why the _final_ map cannot be pre-baked per cell.** The full result is a function of exact listener
position, not of the cell the listener stands in. Precomputing finished share per 24 m cell — "the
ambient map for cell (x,z)" — would quantize share to cell granularity, which is exactly the step
artifact Phase 3 exists to remove; smoothing it back would need the interpolation machinery we just
deleted. Bake the terrain-derived facts, stream the listener-derived arithmetic.

**Why all the strings, currently.** Three families, all the same disease — composite identity
flattened into a string because a JS `Map` wants a primitive key:

- `classificationKey(terrainCode, localIndex)` per cell walked (`ambient-region.ts`), to look up
  static data. Dies with the bake: after install time nothing resolves classifications at all.
- `ambientDescriptorKey` = `` `${tableIndex}:${soundType}` `` per contributing cell
  (`ambient-scan.ts:98-100`). Becomes an integer slot assigned at `installAmbientRegion` — the
  descriptor set is fixed per region, so identity is an array index, and the accumulator becomes a
  `Float32Array` indexed by slot instead of a string-keyed `Map`.
- The rescan trigger key (`game-runtime.ts:1194`) — built **every frame** in `#refreshAmbient` just
  to compare against the previous frame's and usually bail. Becomes a numeric comparison of floored
  cell coordinates, env cell id, and installation revision.

**The cadence split that remains.** The schedule — which descriptors are audible, their direction
bands, their play chances — stays on the cell-crossing cadence, which is retail's:
`CellManager::ChangePosition` re-runs `Ambient::InitSounds` and `Ambient::UpdatePlayQueue` only when
`load_pos.objcell_id` changes (acclient.c:140449-140528), one terrain square, `square_length = 24.0`
(`crates/holtburger-dat/src/file_type/region.rs:725`). Those feed firing decisions that happen every
~3-7 s; recomputing them per frame buys nothing. The per-slot weight pass is the only thing Phase 4
runs at frame rate. Both consume the same baked map, so they cannot disagree about what the terrain
contains.

**And this removes the smoothing problem rather than managing it.** `ambientWeight` is continuous in
position between the flat radius and the 120 m cutoff (`AMBIENT_MIN_DISTANCE_SQUARED / distanceSquared`,
`ambient-weighting.ts:117-123`), so a share recomputed per frame varies smoothly. The only
discontinuity is a cell crossing the 120 m boundary, which enters at
`AMBIENT_MIN_DISTANCE_SQUARED / 14400` against a total summed over ~70 cells — a fraction of a percent,
and share is a ratio, so it is steadier still. No second smoothing constant, no 0.5 s glide hiding a
step. One short constant serves both bed gain and pan.

**Deliverables**

- Descriptor slots assigned once at `installAmbientRegion`; slot count fixed per region.
- A per-block baked ambience map: flat typed arrays of (cell position, slot) entries. Comment the
  representation — it is a hot-path layout choice, not incidental.
- **Bake lifecycle by revision diff, not new event plumbing** (dry-run finding): `TerrainSystem`
  already bumps `installationRevision` on every install _and_ release (`terrain-system.ts:179,188`)
  and enumerates blocks with ids. `AmbientSystem` reconciles lazily — when the revision differs from
  the last seen, diff installed landblock ids against baked ones, bake the new, drop the gone. No
  observer/event machinery.
- `accumulateAmbientWeights(listenerPosition, bakedBlocks, out)` — the allocation-free per-frame
  pass filling a caller-owned per-slot `Float32Array` plus a total. Pure and directly testable.
- The schedule scan rewritten to walk the baked map instead of raw terrain samples, keeping its
  direction/band outputs and its cell-crossing trigger. Its accumulator structures are reused across
  scans rather than rebuilt.
- The per-frame rescan trigger in `#refreshAmbient` compared numerically, not as a built string.
- Source the scan grid from authored data. `AMBIENT_SCAN_CELL_SIZE = 24` (`game-runtime.ts:365`) is a
  hardcoded duplicate of `land_defs.square_length`. Dry-run finding: no new plumbing needed — each
  installed block already carries `tileSize` (the same authored value) into `AmbientTerrainBlock`, so
  the refresh trigger reads it from terrain data in hand rather than importing manifest wiring.

**Acceptance criteria**

- **Characterization first** (dry-run finding): the old scan does not survive the cutover, so
  "equivalence against it" cannot be a live comparison. Before rewriting anything, capture the
  current `scanAmbientSources` outputs — descriptors, weights, directions, bands — over fixture
  terrain and listeners as golden expectations in the test file. The rewrite must keep those tests
  green unmodified; that is the no-observable-change gate.
- Unit test: `accumulateAmbientWeights` and the schedule scan agree on per-slot weights and total
  for the same listener and baked map — the two consumers must not drift.
- Unit test: repeated `accumulateAmbientWeights` calls reuse the caller's buffer; the pass takes the
  output buffer rather than returning a fresh one, and bakes are not repeated for uninstalled or
  re-visited blocks.
- Existing ambient scan and system tests still pass, or are rewritten where they asserted the old
  allocating shape.

**Tasks** — all done 2026-08-16; full suite 1090/1090, tsc both configs, lint clean.

- [x] Descriptor slots assigned in `createAmbientRegionResolution` (renamed from
      `createAmbientTableResolver`), which returns `{ resolve, descriptorsBySlot }`; slot uniqueness
      and registry/lookup identity pinned by test; u16 overflow asserted at install.
- [x] `bakeAmbientBlock` + `AmbientBakeRegistry` (revision-diff reconcile, cleared on region
      reinstall because baked slot ids belong to one region's registry).
- [x] `accumulateAmbientWeights` with caller-owned `Float32Array`; equivalence with the schedule
      scan and buffer-reset behavior tested; out-of-range slots throw rather than drop.
- [x] Schedule scan rewritten over baked entries. The existing scan tests served as the
      characterization goldens and passed unmodified through the cutover (modulo the slot-key type),
      which was the no-observable-change gate.
- [x] Numeric rescan trigger (floored cell coords + env cell + revision-diff result); the trigger
      string, `ambientScanCellKey`, and `AMBIENT_SCAN_CELL_SIZE` are gone — cell size now reads from
      installed terrain's `tileSize`.
- [x] `ambientDirection` takes (east, north) scalars, deleting the per-cell tuple allocation; the
      per-cell classification and descriptor-key strings are gone with the bake, and the region's
      classification map key is a packed integer.

**Decisions and concessions (Phase 3)**

- The schedule scan still allocates its result per call. After the bake its allocation is
  O(descriptors in earshot) at crossing cadence — a few dozen small objects — so pooling it would be
  ceremony without a scenario. The allocation-free guarantee lives where the frequency does, in
  `accumulateAmbientWeights`. This concedes the "reuse accumulator structures" deliverable
  deliberately.
- Before any terrain installs, the rescan trigger floors on cell 0 and the scan of zero blocks is
  empty — the revision diff, not the cell size, is what fires the first real refresh.

## Phase 4 — Live beds (follow modes)

Phase 1 exposes a real defect that this phase fixes, so the branch carries a known interim regression
between them: continuous beds audibly recede behind a moving listener from Phase 1 until this phase
lands (see below for why). Acceptable on a working branch; do not ship the interval. The underlying
defect predates this plan, and it is a shape error rather than a tracking error.

**Retail never gives a continuous ambient sound a position at all.**
`SoundManager::PlayAmbientSoundFromCenter` (acclient.c:366840-366863) calls
`GetAttenuation(0.0, center_volume, &attenuation, 1)` — distance hardcoded to `0.0` — and then
`PlaySoundInternal(Sound, 0, attenuation)` with pan hardcoded to `0`. No position is sampled, no
heading is computed. The sound is head-locked by construction. `ConstantSound::AddTo` matches: it
accumulates weight and deliberately never accumulates a direction (`ambient-scan.ts:279-282`).

Our code models that absent position by **synthesizing a fake one at the listener**:
`ambient-system.ts:239-247` ends in `?? listenerPosition`. That is a `??` fallback on our own type,
which by the house rule means the type's shape is wrong — "this sound has no position" is being
encoded as "this sound has a position that happens to equal the listener's, right now." It has been
latent since the day it was written, and it is invisible only because nothing moved afterwards.

Phase 1 is what makes it observable: once voices track, that synthesized position stays pinned to the
patch of ground the listener stood on and the ambience audibly recedes behind them. A river that gets
quieter as you walk _along_ it is strictly worse than the frozen behavior we started with.

### What a continuous bed tracks instead: live share

A continuous bed is head-locked in _position_, but that does not mean it is static. The quantity it
should track is the one that already governs it — `share` — applied to the **playing voice** rather
than only to the next firing.

Today `refresh` writes `existing.volume = volume` (`ambient-system.ts:150`) and a voice already
playing keeps its trigger-time gain for its whole ~6.4 s duration. So sprinting away from a river
holds the bed at full volume for up to 6.4 s and then drops it abruptly when it re-fires. That step
discontinuity is the artifact worth removing, and removing it is exactly "the sound responds to the
camera during playback" — just driven by share instead of by distance.

**Shape.** Collapse position and volume-liveness into the thing that determines both, so the illegal
states cannot be spelled:

```ts
type AudioPlacementSource =
  | {
      readonly mode: "world";
      readonly position: SceneVector3;
      readonly volume: number;
    }
  | { readonly mode: "listener"; readonly volume: () => number };
```

A world sound has a fixed position and a fixed volume. A listener-locked bed has neither a position
nor a fixed volume — it has a live gain supplier. `AmbientSystem` supplies
`() => this.#scheduled.get(key)?.volume ?? 0`, which handles both retirement paths without a branch:
a descriptor retired below `AMBIENT_MIN_VOLUME` was already near-silent, and one pruned for leaving
the scan entirely reads `0` and fades out rather than stranding a loud bed with no source.

This keeps ownership honest. `AmbientSystem` owns share and remains the only thing that knows what
share means; `AudioSystem` owns placement and reads a number. It is the same dependency-injection
shape `AmbientSystemDependencies` already uses.

It also mirrors an invariant the code already documents: the surroundings scale **exactly one** of
gain and probability, never both (`ambient-system.ts:56-59`). Continuous descriptors get share-scaled
gain, intermittent ones get share-scaled play chance and a flat authored volume. So a `"world"`
sound's static volume is not an omission — it is correct, and the union says so.

**Bed gain is not tied to the scan's cadence.** Phases 3-4 compute share directly at frame rate, which
is why this needs no long smoothing constant to hide a step. See that phase for why the scan's own
24 m cadence stays where it is and why share does not have to inherit it.

### Why not synthesize a position at trigger time and let distance fade it?

Because the fade is already there, share-shaped, and a synthesized position would double-count it
while getting the common case backwards.

**The fade already exists, as share rather than distance.** `ambient-system.ts:132-133` sets a
continuous descriptor's volume to `descriptor.volume * share`, where `share` is that descriptor's
proportion of the surrounding ground's total weight (retail's `total_weight` normalization,
acclient.c:367445 and 367532). Walk away from the river and fewer river cells fall inside the scan,
so share drops, so the sound gets quieter. Retail measures "how much of what I can hear is river"
rather than "how far is the river", and it re-measures every 24 m of listener travel
(`AMBIENT_SCAN_CELL_SIZE`, `game-runtime.ts:365`) — finer-grained than the sound's own re-fire
interval.

**The census (`crates/holtburger-debug-harness/src/bin/ambient_sound_census.rs`, run against
`dats/assets.hba`):**

|                               | n   | min    | median | max     |
| ----------------------------- | --- | ------ | ------ | ------- |
| continuous re-fire interval   | 40  | 1.40 s | 7.00 s | 18.70 s |
| continuous wave duration      | 40  | 1.82 s | 6.41 s | 20.00 s |
| intermittent re-fire interval | 343 | 0.00 s | 2.80 s | 30.00 s |

Duration tracks interval almost exactly, which confirms these are authored as a gapless bed: a ~6.4 s
wave re-fired every ~7 s. So a voice is _nearly always playing_, and drift accumulates for the whole
of it.

At a modest 5 m/s walk, a synthesized position drifts **32 m during a single median playback**, and
100 m for the longest. Against a 5 m flat radius that is six times the distance at which panning and
attenuation begin, and the Explorer's free-fly camera moves far faster than walking pace. The audible
result is a bed of sound that swings across the stereo field and fades out over ~6 s, then snaps back
to centre when it re-fires — a pumping cycle every 7 seconds.

**And the common case inverts.** Walking _along_ a river, share stays constant, which is correct: you
are still surrounded by river and it should stay steady. A synthesized position, however, recedes
behind you and fades — exactly backwards. There is no single point to place these at; a river
wrapping around you on three sides has no meaningful centroid, which is precisely why retail
accumulates weight instead of position.

Worth recording, because it determined the fix: the fallback is not defensive and is not shared.
`directions` is empty **if and only if** the descriptor is continuous — an intermittent descriptor
only ever reaches `accumulate` with `soundCount > 0`, and every such call widens at least one band
(all eight compass directions for ground underfoot, otherwise the specific one). So `?? listenerPosition`
is unreachable for intermittent ambience. It is the continuous case wearing a disguise, which is
exactly why it collapses cleanly into an explicit mode instead of needing a new branch.

**Deliverables**

- `AudioPlacementSource` as the discriminated union above, replacing `AudioTrigger`'s bare `position`
  and `volume` fields. `"world"` covers every hook sound and every _directional_ ambient firing;
  `"listener"` covers continuous ambience only.
- `AmbientSystem` chooses the variant where it already chooses the position, and the
  `?? listenerPosition` fallback disappears rather than being kept alongside it. A `"listener"`
  trigger carries no synthesized position at all, so the mode and the position cannot disagree.
- `AmbientSystem` runs Phase 3's narrow weight pass on its own `advance` and recomputes each
  scheduled descriptor's share from it, so a playing bed's gain is current rather than as of the last
  cell crossing. The supplier reads that live value, and `0` once the descriptor is no longer
  scheduled.
- **Two shares coexist on purpose** (dry-run finding): the schedule keeps using crossing-time share
  for its discrete decisions (audibility, retirement, play chance), while the gain supplier reads the
  per-frame value. This is the cadence split, not a re-derivation — document it on the field so the
  "compute once" rule is not misapplied against it.
- The per-frame weight pass honors the same seen-outside gate as the schedule refresh (Open
  Question 7): indoors it neither runs nor reports shares.
- Whether the narrow pass runs every frame or every other frame is a measurement, not a guess. Start
  every frame, and back off only if Phase 5's trace shows it costing something — `examinedCellCount`
  is already reported, so the cost is observable.
- Consider whether `placeAmbientSound`'s `SceneVector3 | null` return still earns the `null`. It
  currently means "this descriptor is continuous" while pretending to mean "placement failed", and the
  caller is the only thing that knows the difference. Fold it into the variant decision if it reads
  cleaner; leave it if the churn outweighs it.
- `LiveVoice` carries the source. `advance` passes the listener's own position as the source position
  for a `"listener"` voice and reads its gain supplier, which lands gain at the flat-radius value and
  pan at zero without any special case inside `placeSpatialAudio`.
- **No** second smoothing constant. Phase 3 makes share continuous, so `placementSmoothingSeconds`
  covers bed gain too. If a bed still steps audibly, that is evidence the narrow pass is not running
  often enough — fix the cadence, not the constant.

**Acceptance criteria**

- Unit test: a `"listener"` voice holds zero pan across large listener movements, and its gain
  follows its supplier rather than its distance.
- Unit test: a `"world"` voice under the same movement pans and attenuates.
- Unit test: a playing bed whose descriptor is re-weighted mid-playback changes gain **without**
  waiting for the next firing — this is the artifact the phase exists to remove.
- Unit test: a playing bed whose descriptor is retired or pruned reads gain `0` rather than holding
  its last value.
- Unit test: a continuous ambient descriptor produces a `"listener"` trigger and a directional one
  produces `"world"`.

**Tasks** — all done 2026-08-16; full suite 1096/1096, tsc both configs, lint and svelte-check clean.

- [x] `AudioPlacementSource` threaded through `AudioTrigger` and `LiveVoice`; a listener-locked
      source is placed at the listener's own position, landing in the flat radius with no special
      case in the retail curve (`AudioSystem.#place`).
- [x] `AmbientSystem.#place` collapsed into `#source` — one decision for mode and position, the
      `?? listenerPosition` fallback deleted. An intermittent descriptor with no directional
      contributors now throws as a broken scan invariant instead of being silently centred, and the
      old test fixture was leaning on exactly that fallback (empty direction maps real scans never
      produce) — the fixture now bands its intermittent descriptors like a real scan.
- [x] Live share: `AmbientSystem.advance` recomputes per-slot weights once per frame through the
      injected `accumulateWeights` (runtime closure owning the baked terrain and the seen-outside
      gate), skipped entirely while no bed is scheduled. Bed suppliers read
      `authoredVolume * weight / total` through the schedule, so retirement, region reset, and
      indoors all read `0` and fade.
- [x] `resetForRegion(slotCount)` clears the schedule with the weight buffer — slots are meaningful
      only within one region's registry (Open Questions 7 and 8 both landed as tests).
- [x] No second smoothing constant, as planned: share is continuous per frame.

**Decisions and course corrections (Phase 4)**

- `ScheduledAmbient` now carries both `volume` (crossing-time, drives discrete schedule decisions)
  and `authoredVolume` (live share re-scales it per frame). The two-shares duality is documented on
  the field per the dry-run finding.
- The weight pass runs inside `AmbientSystem.advance` via dependency injection rather than the
  system owning baked terrain: the runtime owns bakes and the seen-outside gate, the ambient system
  owns the buffer and what share means. Same split the architecture section records.
- The interim bed regression opened by Phase 1 is closed: beds are head-locked with live gain.

## Phase 5 — Resteering and runtime verification

Static tests cannot prove the thing the user actually asked for: that it _sounds_ like it follows.
This crosses the browser and Web Audio boundary, so per `apps/holtburger-3d/AGENTS.md` it needs
runtime evidence.

**Deliverables**

- Browser-harness evidence: fly a scripted camera past a known emitter and record the gain and pan
  handed to the device over time. A monotonic gain rise-then-fall and a pan sweep through zero is the
  proof. The candle pose in `AGENTS.md` is a known-good emitter to point at.
- Reassess: what did Phases 1-4 cost, does the bed-steal contention question (Open Question 6) now
  have evidence, and has anything about emitter-following moved from Out of Scope to obviously-cheap.

**Acceptance criteria**

- A recorded gain/pan trace over a scripted flyby showing continuous variation, attached to the plan.
- No browser console errors; no audible clicking in a captured render (judged by the trace's
  continuity, since the harness cannot listen).

**Tasks** — done 2026-08-16.

- [x] Harness probe: `--audio-flyby <x,y,z>` (+ `--audio-flyby-steps`, `--audio-flyby-frames-per-step`)
      drives `probeAudioFlyby`, which interpolates the camera from `--camera-position` to the target
      pumping real frames, with a recording `AudioDevice` standing in under `audioTrace=1`. Every
      voice's per-frame gain/pan series, ambient/audio diagnostics, and new bake diagnostics
      (`AmbientBakeRegistry.getDiagnostics`) come back in the machine-readable output.
- [x] Flyby traces recorded (landblocks `0xda55ffff` and `0x0080ffff`, low-altitude ~170 m paths,
      60×14 frames). Findings below.
- [x] Phase 6 dry-run: scope confirmed; the vocabulary sweep list below is current.

**Findings (Phase 5)**

- **Live tracking demonstrated end-to-end in the real runtime.** Seven world voices across runs, all
  re-placed for hundreds of consecutive frames: gain rose continuously on approach (0.042 → 0.60)
  and fell on recede (0.42 → 0.008); pan swept **through zero** on voices the camera passed —
  exactly the plan's proof criterion. Below-floor silencing engaged (`gain 0, pan 0`) without
  stopping voices. Largest single-frame gain step 0.038 _before_ device smoothing, so no audible
  stepping is expected after `setTargetAtTime`.
- **First probe found a real usage subtlety, not a bug:** with `--landblock` only one terrain block
  installs, and the AGENTS candle pose sits ~132 m from that block — outside the 120 m earshot — so
  the scan was honestly empty. Flybys must stay inside installed terrain.
- **No continuous bed scheduled at either probed pose** (its `volume × share ≥ 0.03` gate needs one
  table to dominate the surroundings). Bed head-lock, live share re-weighting, retirement-to-zero,
  and region-reset-to-zero are all unit-pinned; an in-the-wild bed trace remains **residual
  verification debt**, with the probe command ready when a dominant-ambience block is identified
  (the bake diagnostics now make that findable).
- **Voice budget contention: none.** Peak 5 of 16 voices across runs, zero steals. Open Question 6
  resolved: keep plain oldest-steal; revisit only with contention evidence.
- The smoothing constant still needs a human ear; the harness cannot listen. Unchanged at 0.02 s.

## Phase 6 — Cleanup

Itemized during implementation; seeded with what is already visible.

**Deliverables**

- Vocabulary sweep. "computed once at trigger time and never updated" appears in at least
  `audio-spatialization.ts:5-7`, `audio-system.ts:134-135`, `game-runtime.ts:887-888`, and the
  warmup tuning comment. Every one of those becomes false in Phase 1 and must be rewritten in the
  same change that falsifies it, per the deletion rule in the root `AGENTS.md`.
- Diagnostics review. Decide whether any new counter earns its place. A candidate is "live voices
  currently below the audible floor", which differs from `inaudibleCount` (a trigger-time refusal) in
  a real scenario: flying out of earshot with voices still playing. Add it only if Phase 5's trace
  shows it would have explained something; otherwise do not.
- Delete any test that now only asserts frozen-at-trigger behavior. Rewrite rather than migrate if
  the churn is large; those tests would be preserving dead architecture.
- Confirm the audio section of the app `AGENTS.md` or crate docs does not still describe frozen
  placement.

**Tasks** — done 2026-08-16; final gate 1096/1096 tests, tsc both configs, svelte-check, prettier,
eslint all clean.

- [x] Vocabulary sweep. Three of the four sites were already rewritten in the phase that falsified
      them (Phase 1); the last — the hook-sound wiring comment in `game-runtime.ts` — now says the
      accurate thing: the emitting position is sampled once as retail samples it, and the voice then
      tracks the listener from that fixed point. Every surviving "trigger time" mention describes
      either retail's cited behavior or the position-sampling rule, both true. Older plan documents
      retain the frozen-placement language deliberately (plans are historical records per AGENTS).
- [x] Diagnostics decision: **no** "live voices below the audible floor" counter. Phase 5's traces
      were fully explainable without it — the per-voice placement series shows silencing directly,
      which is a better diagnostic than a counter would be. Added instead, because the flyby debug
      needed it: `AmbientBakeRegistry.getDiagnostics()` (block and entry counts), which turned
      "silent flyby" from a mystery into "the camera is 132 m from the only installed block" in one
      read.
- [x] Test triage: no test asserting frozen-at-trigger behavior survives — each was rewritten in the
      phase that changed its subject, including the ambient fixture that had been leaning on the
      deleted `?? listenerPosition` fallback.
- [x] Doc sweep: no app or crate doc claims frozen placement.
      `grep -rn "RETAIL QUIRK\|RETAIL DIVERGENCE"` surfaces the live-tracking divergence
      (`audio-system.ts`), the 3D-pan divergence (`audio-spatialization.ts`), and the pre-existing
      ambient-volume divergence, each cited.

## Risks & Mitigations

| Risk                                                                                                        | Mitigation                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zipper noise from per-frame `AudioParam` writes.                                                            | `setTargetAtTime` with a tuned constant, landed in Phase 1 rather than bolted on; Phase 5's trace checks continuity.                                                                                                       |
| Continuous ambience audibly drifts behind the listener.                                                     | Phase 3 exists entirely for this and lands immediately after the change that exposes it. The root cause is a pre-existing synthesized position, not the tracking itself, so the fix is a shape change rather than a guard. |
| Voice budget pressure from silent-but-alive out-of-earshot voices.                                          | 16 voices with oldest-steal already bounds it. Preferentially stealing silenced voices is _not_ added speculatively — see Open Questions.                                                                                  |
| Oldest-steal cuts a playing bed, audibly dropping the ambience floor until its next re-fire.                | New failure mode created by beds becoming near-permanent voices. Open Question 6; decide from Phase 5 contention evidence rather than pre-engineering a priority scheme.                                                   |
| The narrow weight pass silently drifts from the schedule scan, so beds fade differently than they schedule. | Phase 3's equivalence tests assert bake-vs-old-scan and weight-pass-vs-schedule-scan identity; they are the phase's primary acceptance criteria, not an afterthought.                                                      |
| Removing allocation makes the scan harder to read for no measured win.                                      | `examinedCellCount` already reports the walk; capture the cost in Phase 5 alongside the trace. If two explicit loops read better than one shared iterator, take the loops.                                                 |
| Test churn across `audio-system.test.ts` (289 lines).                                                       | Expected and acceptable. Tests asserting frozen placement are preserving dead architecture and get rewritten, not migrated.                                                                                                |
| Scope creep into emitter-following.                                                                         | Explicitly Out of Scope; the retained-position shape makes it a cheap later addition, which is the whole reason to keep it out now.                                                                                        |

## Definition of Done

- [x] `npm run` typecheck, lint, format, and unit tests clean (1096/1096); clippy clean for the one
      Rust addition (`ambient_sound_census`).
- [x] A playing voice's gain and pan demonstrably change as the listener moves, proven by the
      `--audio-flyby` browser-harness traces (gain 0.042 → 0.60 on approach, 0.42 → 0.008 on recede,
      pan through zero on passing) and not only by unit tests.
- [x] Head-locked ambience stays head-locked in position with per-frame share-driven gain —
      unit-pinned; in-the-wild bed trace recorded as residual debt in Phase 5's findings.
- [x] The per-frame ambient path allocates nothing per entry (`accumulateAmbientWeights` with a
      caller-owned buffer), proven equivalent to the schedule scan; the schedule scan's own
      per-crossing result allocation is a documented concession.
- [x] Warm-and-replay places at replay time; `SpatialAudioPlacement` is a pure return value retained
      nowhere.
- [x] Every "fixed at trigger time" claim in comments, docs, and tuning rationale is either true or
      rewritten.
- [x] `grep -rn "RETAIL QUIRK\|RETAIL DIVERGENCE" apps crates` surfaces the live-tracking
      departure and the 3D-pan decision, each cited.
- [x] The orphaned `game-runtime.ts` doc comment is gone.

## Open Questions

1. **Emitter-following.** Should a sound emitted by a moving object track _that object_ as well as
   the listener? It needs a policy for the owner being destroyed mid-playback — freezing at the last
   known position is the obvious answer — and retail has no back-pointer to copy from. Recommendation:
   defer. Phase 1's retained-position shape makes it a small follow-up, and there is no confirmed
   moving emitter in the Explorer today to verify it against.
2. **Preferential stealing of silenced voices.** A voice that has receded below the floor is
   occupying a slot while contributing nothing. Recommendation: no. Oldest-steal is retail-equivalent
   and 16 slots is not under pressure; revisit only if Phase 5 shows starvation.
3. **Smoothing constant.** `0.02 s` is a starting guess, not evidence. Whether it is right is a
   listening judgement, and the harness cannot listen — this likely needs your ears.
4. **Should `"listener"` mode bypass the floor entirely?** A head-locked sound sits at distance zero,
   so it is always above the floor in practice. Leaving it to fall out of the normal math is simpler;
   flagging in case you want continuous ambience to be explicitly unkillable.
5. **Keep the census tool?** `ambient_sound_census.rs` is retained in the debug harness rather than
   deleted — it reads only from `dats/assets.hba` (no checked-in test fixture, so no retained test
   depends on absent assets) and it documents the bed timing facts the design rests on. Say the word if
   you would rather it went away with the investigation.
6. **Voice stealing can now cut a playing bed.** Beds are near-gapless ~6.4 s voices, so under budget
   pressure the oldest voice is often _the ambience floor_, and stealing it is an audible dropout
   until the next re-fire — a failure mode frozen playback never surfaced, since a cut bed used to be
   indistinguishable from one that had drifted inaudible. Options: exempt `"listener"` voices from
   stealing, steal the quietest instead of the oldest, or raise the budget. Recommendation: leave
   oldest-steal until Phase 5's trace shows real contention, then decide with evidence.
7. **Entering an interior now fades beds out.** An env cell not seen outside feeds the schedule an
   empty scan (`game-runtime.ts:1198-1206`), so live suppliers read 0 and beds glide out on dungeon
   entry — today the playing voice runs its remaining ~6 s into the dungeon. The new behavior seems
   strictly better, but it is a behavior change and deserves an explicit test plus a decision that the
   per-frame weight pass honors the same seen-outside gate rather than computing shares indoors.
8. **Region reinstall while beds play.** `installAmbientRegion` clears the schedule, so live suppliers
   read 0 and old-region beds fade rather than strand — correct by construction, but only if supplier
   keys are not accidentally reused across the reinstall. Needs a test, not a design change.
9. **Stalled frame loop leaves stale gains.** Placement updates ride `advance`; if the render loop
   halts (minimized window) while the `AudioContext` keeps running, voices hold their last gain and
   pan until frames resume. Bounded by one-shot duration (~6 s worst case) and matches how every other
   frame-driven system behaves here. Documented as accepted, not solved.

## Decisions and Course Corrections

- **2026-08-20 — Continuous admission made immediate; live audio control capped at 30 Hz.** A
  reported 5–10 second region-entry lag was not authored ambience or re-anchoring: new descriptors
  were initialized at `now + interval`, conflating recurrence with admission. Retail instead calls
  `Ambient::Play` immediately when `Ambient::UpdatePlayQueue` admits an unqueued descriptor
  (acclient.c:367842-367861), and only that play rearms at `now + GetPlayInterval`
  (acclient.c:367715). Continuous beds now enter due immediately and keep their flat wave-length
  interval only for recurrence. Intermittent sounds intentionally retain randomized admission to
  avoid synchronized streaming-entry bursts; the divergence is marked at the scheduler with the
  census (343 intermittent versus 40 continuous descriptors).

  The live narrow weight walk and voice re-placement no longer scale with uncapped render rate.
  `GameRuntime` owns one 30 Hz audio-control cadence and updates both together. A schedule refresh
  (terrain revision, scan-cell crossing, or indoor/outdoor transition) forces and rebases that tick,
  so retirement fades and new-bed admission do not wait up to 33 ms. Recurrence remains serviced
  every render: throttling it would introduce avoidable seams in continuous waves. Clock regression
  and long stalls rebase once with no catch-up burst. The existing 20 ms `AudioParam` smoothing is
  retained as interpolation between control targets, not as a competing scheduler.

  Browser verification used a 2 ms simulated render step. A same-cell flyby recorded one bed's
  placement at frames 96, 113, 130, 147, 164, and 181: exactly 17 render frames between writes,
  matching the 33.3 ms control interval without per-frame work. A ground-level follow flight from
  `0xda55ffff` through `0xda58ffff` crossed three landblocks, scheduled 33 descriptors, admitted five
  continuous voices, and retired 29 descriptors. New beds produced trigger and placement samples on
  their admission frame, while retired beds reached zero gain. Faster samples during that flight
  corresponded to forced 24 m scan-cell refreshes, which is the intended override rather than
  cadence drift. Both harness runs reported no browser console errors.

- **2026-08-17 — Loudness contour added** (`FRONTEND_TUNING.audio.loudnessCurveExponent`, default
  0.75, marked `RETAIL DIVERGENCE`): each voice's linear gain passes through `gain ** exponent` at
  the device boundary, lifting quiet-to-mid distant ambience with fixed points at 0 and 1. Applied
  at the last moment before the param write, so the audibility floor, diagnostics, and quietest-
  steal decisions all still reason in unshaped retail gain — which sounds play is unchanged, only
  how loud the quiet ones are. `1` restores retail exactly; the pan shadow stays dB-exact. A
  mix-bus `DynamicsCompressorNode` was considered and rejected: it compresses the summed waveform
  program-dependently (pumping), where the contour shapes each voice's distance gain
  deterministically.
- **2026-08-17 — "Too quiet on average" root-caused to the pan law; retail's transcribed.** The
  distance curve was never the problem — the positioned ambient path runs the same
  `GetAttenuation(distance, …)` as hooks (`PlaySoundInternal(SoundBufRef*, const Position*, …)`,
  acclient.c:366489-366518). The divergence was the panner: `SoundBuf::Play` clamps pan to ±15 and
  hands DirectSound `SetPan(100 × pan)` (acclient.c:369202-369232) — single-channel attenuation, at
  most 15 dB on the _far_ channel, never touching the near one — while `StereoPannerNode` is
  equal-power: −3 dB in both ears for every centred sound (every bed, everything in the flat
  radius) and total far-ear silence at full pan. `WebAudioDevice` now reproduces retail's law with
  a master gain fanned into per-channel gains and a merger, marked `RETAIL QUIRK` with the
  citation; tests pin full-both-channels at centre and the 15 dB shadow at full pan. A second,
  correct contributor acknowledged: live tracking fades receding voices that frozen playback used
  to hold loud.
- **2026-08-17 — Pre-commit quality pass (4-angle review), ~15 findings applied.** The structural
  ones: the two baked-cell walks collapsed into one `walkAudibleAmbientCells` owner of the
  cell-weighting semantics (the invariant whose duplication caused the share regression now has one
  home); the indoor `seenOutside` gate moved into `AmbientSystem` behind a `listenerHearsOutdoors`
  dependency so both cadences consume one fact structurally (with a new gate test: beds fade at the
  dungeon door and return outside); `ScheduledAmbient.volume` deleted as derivable (crossing-time
  share now lives only inside `refresh`); `#continuousScheduledCount` maintained at crossing cadence
  so the per-frame gate is one integer test; `reconcile` takes a terrain thunk (hoisted field) so
  the every-frame check truly allocates nothing; `WebAudioDevice.setPlacement` drops sub-epsilon
  re-targets, eliminating ~4k no-op cross-thread automation events/s at a stationary camera;
  `placeSpatialAudio` deltas inlined to scalars; shared `clamp` reused; flyby debug scaffolding
  (`scheduledByStep`, `installed`, `sampleCount`) deleted; census bin single-pass with one decode
  per table; doc triplication of the steal divergence trimmed to its mechanism. Skipped with
  reasons: `placeSpatialAudio`'s result object stays (purity of the retail-curve authority over the
  last ~2k tiny allocations/s; its header comment now says "allocation-light" instead of
  overclaiming); the bed supplier closure stays (one per firing, and it _is_ the fade-out
  mechanism); the scan-cell size stays terrain-sourced per the earlier plan decision; harness lerp
  stays local. Full gate re-verified: 1101 tests, flyby behavior unchanged within roll variance.
- **2026-08-17 — Voice budget raised to 32 and stealing re-targeted to the quietest voice.** Open
  Question 6 closed by decision. Retail's 16 was a DirectSound-era budget; ours doubles it (still
  bounded — an unbounded pool turns a trigger bug into a runaway mixer instead of a diagnosable
  steal counter) and the steal victim is now chosen by _current_ gain, computed from the same
  retained facts `advance` re-places from, with age as the tie-break — so equal-gain contests
  behave exactly as retail's oldest-steal did, and the existing steal tests passed unchanged. A
  below-floor silenced voice is the ideal victim, which also answers the bed-steal worry: a bed
  loud enough to matter is never the quietest. Marked `RETAIL DIVERGENCE` at both the constant and
  the policy. Flyby at the dense pose: steals 27 → 0 at budget 64, and at 32 any residual steal is
  the least audible cut available.
- **2026-08-17 — Post-completion regression: shares divided by table size; found by ear, fixed.**
  The Phase 3 bake emitted one entry per (cell, descriptor) and summed `totalWeight` per entry,
  where retail (and the pre-bake scan) count each cell once and then contribute it to every
  descriptor its table authors. Production tables author ~10-12 sounds, so every share — and with it
  every intermittent play chance and every bed's scheduling gate — was ~12× too small. The user
  reported "I rarely hear ambient noises"; the fix re-shapes the bake to one entry per cell
  referencing a deduplicated slot list (keyed by table index), which also shrinks the bake ~12× and
  computes direction once per cell. Same flyby before/after: fired 10 → 82, played 5 → 43, voices
  5 → 43 with the 16-voice budget saturating (27 steals).

  Two process lessons, recorded so they sting later: (1) every characterization fixture authored
  **one descriptor per cell** — the only case where per-cell and per-entry weighting coincide — so
  the "goldens passed unmodified" gate had a hole exactly where production data lives; the
  regression tests now pin multi-descriptor ground in both passes. (2) Phase 5's "no continuous bed
  scheduled at either pose" was this bug in plain sight, rationalized as terrain composition
  instead of investigated. A silent expected-signal deserved a root-cause before shipping.

  Fresh contention evidence: ambience alone now saturates 16 voices at a dense pose (27 oldest
  steals in ~14 s of one-shots). Open Question 6's "no contention" finding is obsolete; oldest-steal
  stands for now — the victims are the oldest, quietest one-shots — but a bed, once one schedules,
  is the likeliest steal target and the question is genuinely open again.

- **2026-08-16 — Plan complete.** Phases 0-6 landed in sequence on branch `claude`, uncommitted.
  Residual items, all recorded in their phases: an in-the-wild continuous-bed flyby trace (unit
  coverage stands in; bake diagnostics make a dominant-ambience block findable), the smoothing
  constant needing a human ear (0.02 s unvalidated by listening), and Open Question 1
  (emitter-following) still deliberately out of scope. Harness gained a permanent audio-trace
  capability (`--audio-flyby`); the runtime gained `AmbientBakeRegistry.getDiagnostics`.

- **2026-08-16 — Pan model decided: keep the 3D projection.** Product choice, recorded before
  implementation. The planned content census was dropped; the divergence is marked in Phase 1 with the
  retail citation instead. Rationale: stereo pan is pure presentation, no shipped content can observe
  it, and vertical-aware panning is the behavior a modern client wants.
- **2026-08-16 — Per-frame listener push verified during planning, not deferred to Phase 5.** The
  explorer render loop calls `syncFreeFlyCamera()` every `requestAnimationFrame` step
  (`ExplorerApp.svelte:842`), which reaches `setAudioListener` via `#applyCamera`
  (`explorer-camera-coordinator.ts:302-320`), gated on `audioFollowsCamera` — default `true` in both
  coordinator and UI. The audit deliverable and its risk row were removed. Residency-resolution
  failures skip `#applyCamera` for that frame, holding the last listener pose — acceptable.
- **2026-08-16 — Dry run completed; five findings folded in.** (1) Bake lifecycle rides an
  `installationRevision` diff — no event plumbing. (2) Phase 3 equivalence is characterization
  goldens captured _before_ the rewrite, since the old scan does not survive to be compared live.
  (3) The scan-grid constant comes from `tileSize` already flowing per block — no manifest plumbing.
  (4) Phase 1 budgets fake-device churn in `audio-system.test.ts`. (5) Schedule-share vs. live-share
  duality documented as intended. No phase reordering or scope changes resulted.
- **2026-08-16 — Resequenced for demoability and scope.** Replay-time placement moved up to Phase 2
  (small, closes Phase 1's shapes). The bake became Phase 3 as a behavior-preserving cutover — the
  schedule scan moves onto baked data with equivalence tests and no observable change — so Phase 4
  wires live beds onto proven primitives. Pan census phase deleted per the pan decision.
