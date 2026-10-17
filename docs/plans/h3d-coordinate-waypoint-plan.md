# H3D coordinate waypoint plan

Status: Implemented on 2026-10-17; final verification and completion audit recorded below.

## Context and boundaries

Give the player one local navigation waypoint, set through `@waypoint` (alias `@wp`), with distance and
direction on the minimap and a destination icon on the World panel.

In scope:

- Set, replace, inspect, and clear one waypoint through local chat commands.
- Case-insensitive AC latitude/longitude notation, with an optional separating comma.
- Horizontal straight-line distance, a player-relative compass pointer, and geographic markers.
- Near-waypoint presentation, explicit clearing, and pause/resume across unavailable placement,
  indoor residency, and portal transitions.
- Character/session lifetime, focused unit coverage, and browser-harness behavioral evidence.

Out of scope:

- Route finding, obstacle avoidance, automatic movement, elevation targets, and dungeon navigation.
- Multiple waypoints, names, lists, saved destinations, settings persistence, and automatic clearing.
- Click-to-set map gestures, chat-coordinate links, and Explorer navigation controls.
- Protocol/host commands, shared Rust crate changes, and retail compatibility claims for this new UX.

## Agreed behavior

| Input or event                                                     | Result                                                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `@waypoint 42.3N, 12.7E`                                           | Atomically replace the target and print a local confirmation with its coordinates.      |
| `@waypoint 42.3n 12.7e`                                            | Same behavior; surrounding whitespace is accepted.                                      |
| `@waypoint clear`                                                  | Remove the target from both maps and confirm; already clear is a valid reported result. |
| `@waypoint` with a target                                          | Print target coordinates and current distance or the reason guidance is paused.         |
| `@waypoint` without a target                                       | Print usage and the clear command.                                                      |
| Malformed or out-of-world target                                   | Print an actionable local error; retain the previous target.                            |
| Within the near radius                                             | Show “Near waypoint”; hide the compass pointer; retain destination markers.             |
| Move outside the radius                                            | Resume distance and direction without another command.                                  |
| Indoors, portal space, resync, or missing/unknown player placement | Retain target; hide directional guidance and distance; show a paused status.            |
| Return to coherent outdoor placement in-world                      | Resume using the new player position.                                                   |
| Character retirement/change, logout, or session teardown           | Clear; no destination leaks to a later character or connection.                         |

Recognize the exact `@waypoint` and `@wp` command tokens, including invalid arguments, before server chat routing.
Do not intercept `@waypoints`, ordinary chat, or change `@loc`. Invalid recognized commands must never
be transmitted as chat. Preserve the existing sent-input history and error-display conventions.
Set/report/clear require the existing active chat session; setting does not require outdoor placement.

Initial near radius: 25 m, an editable frontend tuning value, not an arrival guarantee. Use `<=`
for the near boundary. No arrival notification or hysteresis state in v1; if the boundary flickers,
reassess with observed behavior rather than adding speculative timers.

## Ground truth and existing patterns

All app paths below are relative to `apps/holtburger-3d/`.

| Layer                       | Reference and relevance                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server coordinate semantics | `ACE/Source/ACE.Server/Entity/PositionExtensions.cs:GetMapCoords/GetMapCoordStr`: 240 meters per map degree, origin offset, magnitude display bias, and no map coordinates for environment cells. |
| Server inverse reference    | `ACE/Source/ACE.Entity/Position.cs:Position(Vector2)`: signed offset differs from this app's hemisphere-aware display inverse; do not copy it blindly.                                            |
| App coordinate math         | `src/lib/game/map/map-coordinates.ts` and tests: formatter and printed-degree-to-landblock inverse.                                                                                               |
| App world bounds            | `src/lib/game/landblocks.ts`: `OUTDOOR_LANDBLOCK_COUNT`, world size, `isOutdoorLandblock`, and `landblockAtWorldPoint`; derive bounds rather than hardcoding degrees.                             |
| Explorer input policy       | `src/explorer/world-input.ts`: coordinate parsing currently resolves/clamps to a landblock and accepts an optional elevation suffix.                                                              |
| Client command boundary     | `src/client/ClientApp.svelte:sendChat`; `client-location-command.ts` and tests: local interception, durable feedback, and history.                                                                |
| Client lifetime boundary    | `ClientApp.svelte:acceptEvent`, identity acceptance, session construction/cleanup; `client-host-contract.ts:lifecycleSchema` distinguishes portal-space from character entry and exit.            |
| Presented placement         | `src/client/client-presentation-session.ts:readMinimapFrame`: coherent player placement and heading already feed both maps.                                                                       |
| App map contract            | `src/app/minimap-frame.ts`: imperative frame, subject, and separate GPU invalidation contract.                                                                                                    |
| Minimap presentation        | `src/app/Minimap.svelte`: subject-up compass, projected map center, overlay RAF, footer ResizeObserver, entity hit testing, and breadcrumb trail.                                                 |
| Client UI composition       | `src/client/ClientWorldView.svelte`: minimap footer currently contains `ClientMinimapEnvironment`; World panel is retained inside `ClientHudWindow`.                                              |
| World map presentation      | `src/client/ClientWorldPanel.svelte`: `drawPositionMarkers`, `drawOverlays`, image draw subscription, visibility-gated 30 Hz player timer, and tooltips.                                          |
| Map projection              | `src/lib/game/world-map/view.ts`: `projectWorldMapPoint`, outdoor-player residency guard, and map-plane coordinates.                                                                              |
| Existing icon overlays      | `src/client/client-contracts-map-overlay.ts`, housing marker, and `src/assets/icons/world-map-*.svg`.                                                                                             |
| Verification infrastructure | `src/harness/browser/ClientHudHarness.svelte`, `WorldMapHarness.svelte`, `scripts/browser-harness.mjs`, and package scripts.                                                                      |

Reference code is evidence for coordinate and lifecycle facts, not a mandate to reproduce retail
architecture. No reference source needs modification.

## North stars and ownership

1. Keep navigation intent and UX policy in h3d. A server-authoritative world fact is unnecessary
   for a local destination. No API is added to `core`, `world`, or the host.
2. Retain one canonical destination and derive guidance in one owner. The command and both maps
   consume its result; none independently decides distance, eligibility, or near status.
3. Separate geographic placement from player-relative bearing. Minimap panning and camera orbit
   cannot change navigation direction or distance.
4. Preserve frame coherence and imperative delivery. Movement never publishes hot Svelte state.
5. Prefer a small pure calculation plus a small owner over a navigation framework or marker registry.
6. A map coordinate is an approximate surface location. Neither distance nor proximity promises
   walkability, a route, correct floor, or discovery of the intended destination.

## Coordinate contract

Extend `map-coordinates.ts` with a commented hemisphere-aware printed-coordinate pair and reusable
conversion. Keep magnitude and hemisphere together until conversion; signed numbers alone lose the
distinction between `0.0N` and `0.0S` through common normalization operations.

For each axis, unbias the nonnegative magnitude first, then apply its hemisphere sign. Convert to
canonical scene X/Z with existing origin and scale constants. Interpret input as printed notation,
including extra decimal digits; do not infer a different coordinate convention from precision.
Do not claim the conversion recovers the original position: displayed coordinates are quantized.

Retained destinations use a small branded `SceneMapPoint` with named X/Z fields, declared beside
the coordinate conversion. The converter owns construction of this type. Existing projection helpers
can consume its X/Z fields structurally. Do not invent a real elevation, discard the brand through
`Pick`, store camera-anchor-relative coordinates, or add consumer casts.

Waypoint parsing accepts two finite, nonnegative decimal magnitudes with N/S then E/W, whitespace,
and an optional comma. Reject signs, altitude, hex identifiers, extra tokens, missing hemispheres,
and nonfinite conversion results. Validate the converted point against the finite outdoor grid,
using existing landblock constants/helpers; the upper edge belongs outside the grid. Do not clamp.
Allow targets in the valid grid without loading terrain or proving that the point is walkable.

Share conversion with Explorer's coordinate branch while preserving its existing syntax, optional
elevation handling, and clamping policy. Lexical parsing can remain Explorer-local where required
by its wider input grammar; do not create a configurable parser framework. Remove the old signed
inverse if it has no remaining consumer, and replace its tests with meaningful conversion coverage.
Do not “fix” unrelated Explorer UX as part of this feature.

## Data flow and lifecycle

```text
chat input ── local @waypoint handler ── set / report / clear
                                      │
character identity + session lifetime ─┤
                                      ▼
                        ClientNavigationWaypointOwner
                        one target; no timer or renderer
                                      ▲
                                      │ sample coherent subject + availability
                         ClientApp.readMinimapFrame
                                      │
                   MinimapFrame + owner-produced waypoint display
                         ┌────────────┴──────────────┐
                         ▼                           ▼
                  Minimap overlay             World panel overlay
                  compass + footer            geographic icon + tooltip
```

Suggested files:

- `src/lib/game/map/map-waypoint.ts`: app-local display contract and pure horizontal geometry.
- `src/client/client-navigation-waypoint.ts`: intent owner and narrow command handler, with
  colocated tests. Split the handler only if it materially improves readability.
- `src/assets/icons/map-waypoint.svg` and `map-waypoint-direction.svg`: authored static artwork.

Use a discriminated display contract with these valid shapes:

```text
null                                             no target
{ target, kind: paused, reason }                  target, no fabricated distance/bearing
{ target, kind: near, distanceMeters }            target and distance, no bearing
{ target, kind: guiding, distanceMeters,
  relativeBearingRadians }                       target, distance, and compass bearing
```

The target contains its canonical plane position and a normalized coordinate label that preserves
the entered numeric precision and hemisphere (uppercase letters and a consistent separator). Do not
reformat it through the existing one-decimal player-position formatter. Both fields
have consumers: map projection and chat/tooltip/readout respectively. Keep formatting policy in
one helper. No duplicate stored raw input, signed degrees, absolute bearing, or arrival flag.
Compute horizontal distance using X/Z; compute bearing clockwise from north, then subtract the
player's heading. At zero distance the result is `near`, so no undefined direction escapes.

`ClientApp` owns the navigation owner within the mounted client session. It samples the existing
map frame once and enriches it with a nullable waypoint display. Add the explicit nullable field to
`MinimapFrame`; update scene-only producers, Explorer, fixtures, and tests with `null`. The
presentation session itself does not own command intent. Leave waypoint data out of
`captureMinimapGpuDrawState`: navigation overlays must not invalidate terrain rendering.

The owner's display calculation has one implementation and runs on demand for a coherent input.
Do not add memoization, revisions, a publisher, or a central movement timer unless measurement
demonstrates a need. Different UI pulls can observe different moments; each frame must be internally
coherent. Do not claim all consumers share a single wall-clock sample.

Eligibility requires in-world lifecycle, a controlled player subject, known outdoor residency, and
ready presentation (`ClientPresentationSession.status().kind === "ready"`). Use explicit
unavailable/indoor reasons. Portal-space and resync must suspend guidance even if the previous
presented player remains available. Require `!session.mirror.isAwaitingSnapshot()` alongside
lifecycle and presentation readiness; this existing capability is already used by presentation
event handling. Pass the resulting availability into the owner at read time. Do not create a second
resync flag or silently treat unknown residency as outdoors. Resume when the existing synchronization,
activation, and residency facts permit it.

Clear on accepted character replacement/retirement, character-selection/exit, and mounted-session
cleanup. An `in-world -> portal-space (teleport) -> in-world` transition retains the target.
Initial-entry portal activation clears intent even when no preceding entering-world event arrives. Do not attach clear
to a blanket `lifecycle.kind !== in-world` branch or renderer teardown; both occur during travel.
Reset operations are idempotent and do not emit unsolicited chat during teardown.

## Presentation contract

### Minimap

- Draw the destination SVG at its actual projected point when visible on the outdoor minimap.
- Draw the arc-and-triangle directional pointer on the compass rim while `guiding` and the
  destination is outside the minimap disc. Its angle is relative
  to the player, independent of map pan/zoom and boom-camera heading.
- The geographic icon follows the viewed map center; the compass pointer remains a bearing cue
  even when the player is off-center. They deliberately communicate different facts.
- Keep waypoint artwork outside entity hit targets, selected-GUID logic, and breadcrumb history.
- Combine coordinates and time/weather on one HUD line, separated by a bullet.
- Place `Waypoint · 842 m`, `Near waypoint · 12 m`, or a paused message below that line.
  The entire waypoint label clears the target; its inline × has no separate button chrome.
  Include target coordinates in the accessible description/title.
- Update imperative SVG/DOM nodes from the existing coherent overlay frame. Change text only
  when its formatted content differs; do not introduce movement-driven reactive state.
- Add a nullable clear callback to the minimap's app-local props; client supplies it and Explorer
  supplies `null`. An active client waypoint must always have the clear control wired.
- Put the row inside the existing measured footer; preserve environment content, error feedback,
  resize observer, anchoring, and placement policy. Reuse shared button styles and input ownership.
- With a paused target, retain the footer and clear control but hide minimap geographic/directional
  overlays. The World panel remains the place to inspect the surface destination indoors.

Distance readouts use meters below 1 km and kilometers above it, with a shared formatter and modest
rounding. Direction and near decisions use unrounded distance. No extra HUD window or settings UI.

### World panel

- Add one fixed-screen-size SVG destination marker; project with `projectWorldMapPoint`.
- Display it whenever a target exists, including while guidance is paused. Clip/hide it outside
  the viewport; retain its facts when the image is unavailable or still loading.
- Include `Waypoint · {coordinates}` in the existing hover surface. Combine overlapping waypoint
  and existing marker information so the new marker does not make contracts/settlements undiscoverable.
- Update on image draw callbacks and the existing visible-world-tab overlay cadence. This is
  necessary because setting/replacing/clearing a waypoint does not necessarily redraw map terrain.
- Refresh a stationary hover when the waypoint changes, and sample on show/reopen so a retained
  hidden panel cannot resurrect an old marker. Hidden panels/tabs add no new polling or drawing.
- Preserve map view, recall, teleport, settlement toggles, and gesture behavior.

## Phased implementation

### Phase 1: Coordinate math and pure guidance

- [x] Add hemisphere-aware parsing/conversion to `map-coordinates.ts`; document the display bias.
- [x] Define the canonical plane destination and discriminated display shapes in `map-waypoint.ts`.
- [x] Add pure distance/relative-bearing/near calculation and shared display formatting.
- [x] Reuse conversion in `explorer/world-input.ts`; remove any newly dead signed inverse.
- [x] Add a commented navigation near-radius tuning value in `client-tuning.ts`, following its
      standalone feature-tuning exports. Inject policy into pure calculations.
- [x] Cover all hemispheres and zero hemispheres, extra precision, malformed syntax, finite-grid
      edges, same-point distance, cardinal bearings, rotated player heading, and near-radius boundaries.

Acceptance: focused coordinate, Explorer input, and guidance unit tests pass. Tests use explicit
test-owned radii; integration tests import runtime tuning. No asset-dependent tests or consumer casts.

### Phase 2: Intent, commands, and session composition

- [x] Implement the owner with set/replace/clear/read and explicit availability/identity handling.
- [x] Wire exact-token local command interception into `ClientApp.sendChat` alongside `@loc`.
- [x] Keep failed parsing atomic, normal chat forwarding intact, and feedback in durable chat.
- [x] Extend/enrich `MinimapFrame` and update every producer/fixture, including Explorer.
- [x] Wire identity, portal-space, resync/current-state, exit, and cleanup paths.
- [x] Test set/replace/report/clear, no-target behavior, invalid-input retention, server-send
      exclusion, normal chat passthrough, indoor/missing placement, resync, same-character portal travel,
      character replacement, and teardown. Exercise both incremental lifecycle and current-state paths.

Acceptance: commands work through the production handler with a fake chat sink/server spy, local
errors never reach the server, target lifetime matches the table, and TypeScript checks pass.

### Phase 3: Minimap and World panel integration

- [x] Add the authored waypoint and direction SVG assets with existing theme hooks.
- [x] Add minimap marker, compass pointer, measured footer readout, and clear callback.
- [x] Thread clear through `ClientWorldView`; preserve weather/time and keyboard ownership.
- [x] Add World panel marker and combined tooltip content, including movement-independent updates.
- [x] Keep navigation out of terrain invalidation and preserve hidden-panel suspension.
- [x] Update existing harness consumers of changed contracts in the same phase.

Acceptance: one target feeds both maps; map panning changes only geographic projection; camera
orbit does not change bearing; near/paused states hide the pointer; clear removes both markers;
World reopen shows current state. No new map gesture or WebGL resource is introduced.

### Phase 4: Behavioral verification and cleanup

- [x] Extend `ClientHudHarness.svelte` and `WorldMapHarness.svelte` with focused waypoint scenarios;
      wire a focused probe into `scripts/browser-harness.mjs` or its existing probe modules.
- [x] Use production command and navigation owner code, synthetic placement, and a fake server
      sink. Assert DOM/SVG transforms, labels, visibility, clear-button behavior, and send counts.
- [x] Verify a distant target, heading changes, camera orbit, pan/zoom, a target inside the minimap,
      near/away transitions, indoor/unavailable/portal pause and resume, and character teardown.
- [x] Verify stationary-map set/replace/clear, stationary hover refresh, hidden-tab/window changes,
      reopen, overlap discovery, and unchanged map-click teleport/drag behavior.
- [x] Verify footer extent and HUD placement at bottom anchoring and nondefault UI scale; clicking
      clear returns/retains game keyboard ownership through the existing input policy.
- [x] Run affected unit tests, then `npm run check`, `npm run lint:ts`, `npm run lint:dead`,
      `npm run build`, and relevant browser harness probes from the app directory. Use package scripts;
      add the new focused probe flag before invoking it. No Rust checks are needed without Rust changes.
- [x] Check formatting of touched files, imports, unused helpers/assets, old coordinate vocabulary,
      and complete frame-producer coverage. Review the diff for scope and layering.
- [x] Update this plan with actual checks and material deviations. Leave visual acceptance to the user.

Acceptance: automated behavior, type/build, and applicable lint checks pass; diagnostics are retained
only where useful and remain harness-local. No runtime asset becomes a checked-in test prerequisite.
No TUI launch, agent visual acceptance, staging, or commits.

## Risks, concessions, and course corrections

| Risk or finding                                                                    | Resolution                                                                                                                                    |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Coordinate parser aimed at landblock centers would give misleading final guidance. | Convert to a canonical horizontal point; only Explorer reduces to landblocks.                                                                 |
| Display bias and signed zero can mirror or shift a destination.                    | Keep hemispheres through conversion; test N/S/E/W zero cases and expected positions.                                                          |
| “Exact inverse” language overstates quantized coordinates.                         | Describe the destination as the representative point for printed notation; report proximity, not arrival.                                     |
| Interior coordinates can resemble an unrelated outdoor location.                   | Use the existing explicit outdoor-residency restriction; retain the target while paused. Even surface-connected interiors pause in v1.        |
| Scene retains a stale player during portal activation/resync.                      | Gate guidance on lifecycle, existing mirror snapshot readiness, and presentation status as well as placement.                                 |
| Existing non-in-world cleanup branches also run for portal travel.                 | Integrate at character/session ownership boundaries and test portal retention explicitly.                                                     |
| Existing World draw callbacks do not run for a stationary target edit.             | Include waypoint and stationary-hover reconciliation in the visible overlay update path.                                                      |
| Footer growth moves the minimap beyond the viewport.                               | Use its existing measured footer extent and client placement resolver.                                                                        |
| New marker masks entity selection or other map tooltips.                           | Keep it outside entity hit testing and combine overlapping World tooltip content.                                                             |
| Extending a shared app frame couples Explorer to client intent.                    | Frame contains only a nullable app-local presentation contract; Explorer supplies null and owns no waypoint policy. No Rust contract changes. |

Expected production scope is several hundred added TypeScript/Svelte lines plus two SVG assets,
with focused tests and harness evidence separately. This is an estimate, not a target. If production
code approaches a thousand lines, reassess duplicated command routing, polling, overlay machinery,
and unnecessary contract fields before continuing. No generic command bus, marker registry, or
navigation service should be needed.

## Definition of done

- [x] Every agreed command and lifecycle behavior is implemented and covered by appropriate checks.
- [x] One owner supplies distance, relative bearing, pause state, and near status to consumers.
- [x] Coordinates retain precision and hemisphere intent without clamping waypoint input.
- [x] Both maps and the footer agree on the active target; replacing and clearing work while stationary.
- [x] Panning, zooming, camera orbit, interiors, and portal travel preserve the documented semantics.
- [x] Existing keyboard, map gestures, terrain invalidation, and retained-window lifetimes remain sound.
- [x] Applicable formatting, lint, tests, build, and browser behavior checks pass.
- [x] User receives a concise implementation report and the remaining visual acceptance scenarios.

## Open questions

No blocking product questions remain for this scope. The user accepted the icon and readout
refinements. The initial near radius remains a gameplay tuning choice.
Automatic clearing, persistence, and click-to-set require a separate scope decision.

## Implementation evidence and review

- `npm run test:ts -- src/lib/game/map/map-coordinates.test.ts src/explorer/world-input.test.ts src/client/client-navigation-waypoint.test.ts src/client/client-location-command.test.ts src/app/minimap-frame.test.ts`: 77 tests passed across five files. Coverage includes malformed/out-of-world input retaining the previous target, exact command-token interception, hemisphere-zero/precision conversion, cardinal and player-relative bearings, inclusive near radius, target replacement/clearing, unavailable/indoor placement, atomic current-state replacement, initial entry, teleport retention, character retirement, and overlay-only GPU invalidation.
- `npm run check`: app/Svelte, node, test, and Electron TypeScript checks; zero Svelte errors/warnings.
- `npm run lint:ts`, `npm run lint:dead`, and `npm run build`: passed. Vite reports its large-chunk advisory; no bundle splitting or warning suppression was introduced.
- `npm run harness:browser -- --client-waypoint --brief`: 26 DOM/owner assertions plus real-pointer minimap pan and whole-label clear checks; no browser errors. Repeated successfully with `--device-scale-factor 2`.
- `npm run harness:browser -- --world-map --brief`: real-content map passed exact destination projection, off-viewport clipping, stationary clear, and combined waypoint/settlement hover. Existing progressive loading, marker projection, controls, teleport/drag, visibility, retry, and disposal checks passed too.
- `npm run harness:browser -- --client-environment --brief`: passed server-source isolation, environment controls, clipboard success/failure/retry, time rollover, unavailable state, and expanded-font footer bounds; no browser errors.
- The first real-pointer run exposed overlapping fixture windows/dock, confirmed through `elementFromPoint`. The probe now closes World and places the minimap clear of the dock; production layering policy was not changed.
- The environment probe contained a stale whole-UI settings order assertion that omitted existing Vital warnings and Combat indicators sections. Replaced it with a check for the environment section it actually owns; all production settings controls remain unchanged.
- UI text/icon scaling controls are currently disabled planned controls. Layout evidence uses enlarged footer text and 2x browser device scale rather than pretending those controls work.
- Review traced chat interception through the owner and frame composition to both maps, plus incremental lifecycle, atomic state replacement, exit, and cleanup. Navigation remains app-local, imperative, and excluded from terrain invalidation. The old signed-degree inverse has no surviving code consumers; Explorer shares the hemisphere-aware conversion while retaining its own grammar and clamping policy.
- No agent visual acceptance was performed and no runtime asset dependency was added to unit tests. The pre-existing ACE submodule worktree state is excluded from this feature.

The initial 25 m near radius can be tuned during normal play.
Use `@waypoint 42.3N, 12.7E`, `@waypoint`, and `@waypoint clear`; clicking the minimap waypoint label uses the same clear owner.

The chat command is `@waypoint`, with `@wp` as an equivalent alias for setting, reporting, and clearing. Internal types, owners, assets, and UI labels use waypoint terminology.

### Final code-quality review

Reviewed the accumulated diff and new files, including command interception, coordinate conversion
and its Explorer caller, lifecycle/current-state adapters, presentation-frame producers, both map
consumers, clear callback wiring, and production-consumer browser probes. Navigation intent and
proximity policy remain app-local; coordinate geometry is shared within the frontend. Explorer's
broader input grammar and clamping policy remain separate from waypoint rejection semantics.

One bounded ownership finding was corrected: World-panel marker sampling initially read live
presentation facts inside the visibility effect, implicitly making those facts own the timer.
The immediate refresh is now an untracked initialization snapshot, while subsequent samples run
on the visibility-owned timer. Tooltip preparation runs once after the relevant overlays have
been projected, rather than twice during image redraws. No additional abstraction was needed.

Review does not establish live-server behavior or replace the user's visual acceptance.
