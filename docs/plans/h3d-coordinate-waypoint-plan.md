# H3D coordinate waypoint plan

Status: Original waypoint feature implemented and committed as `0381168ca` on 2026-10-17.
Content-coordinate linking is implemented below. Automated checks pass; the user confirmed manual
selection and contract-panel behavior on 2026-10-17. Successful sets now use status toasts, and the
minimap waypoint label shows an SVG pin, destination coordinates, and distance only while guiding.
Source-level dry run completed for the extension on 2026-10-17. The scope was subsequently
simplified; implementation and verification evidence are recorded at the end.

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
- Click-to-set map gestures and Explorer navigation controls. Content-coordinate links were
  excluded from the original increment and are now scoped in the extension below.
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
- `src/assets/icons/map-waypoint-pin.svg` and `map-waypoint-direction.svg`: authored static artwork.

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
- [x] Keep failed parsing atomic, normal chat forwarding intact, and set feedback in status toasts; report/clear feedback stays in chat.
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

## Extension: Set waypoints from content

Make coordinate text in chat, books, examine descriptions, inscriptions, and contracts clickable
so the player can replace the current waypoint without retyping coordinates. This extends the
completed feature; phases 1–4 and their evidence describe the original increment only.

### Scope and agreed interaction

| Surface      | Included content                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| Chat         | Message bodies across channels, including system messages; retain sender prefixes and filtering.                  |
| Books        | Loaded page text and book-level inscriptions.                                                                     |
| Examine      | Item and creature descriptions, including the existing item description disclosure, plus portal destination text. |
| Inscriptions | Item inscription text; retain scribe attribution.                                                                 |
| Contracts    | Description and progress text, plus structured outdoor contact and quest-area locations.                          |

- Activate a coordinate to replace the one current waypoint. Preserve existing lifecycle,
  paused/near behavior, minimap clear, and command aliases.
- Link each valid coordinate occurrence independently, preserving the source text exactly.
  Whitespace, line breaks, punctuation, coordinate precision, and surrounding prose remain intact.
- Use an underlined inline native button styled as a link: this is a local action, with no browser
  destination. Supply a descriptive accessible name/title such as `Set waypoint: 42.3N, 12.7E`.
  Reuse the app's input policy for pointer activation and deliberate keyboard navigation.
- Chat coordinates become links only while the existing chat-history interactive/select-copy mode
  is enabled. In normal mode, message bodies remain plain text with the existing click-through
  behavior; no coordinate controls or keyboard tab stops are present. Turning interaction off
  restores plain text without changing the waypoint. Other content surfaces remain link-enabled.
- Selecting/copying content must not set a waypoint. A pointer drag that creates a text selection
  must not activate a link on release. Verify selection behavior in interactive chat and the other
  linked content surfaces; normal chat has no coordinate actions to suppress. Native selection and
  copying through links are verified; fresh drag-selection creation still needs the user check below.
- Successful activation uses the existing status toast surface for the local waypoint confirmation. Clicks never send server
  chat or enter sent-command history.
- Reuse existing session teardown and the waypoint owner's character check. Do not add a dedicated
  activation-rejection flow, click-error UI, captured permission, or stale-click machinery. Invalid
  coordinates remain plain text. Command validation and error presentation remain unchanged.
  Setting indoors remains allowed.

Out of scope: a general rich-text/HTML renderer, URL auto-linking, arbitrary command links, map-click
gestures, multi-waypoint storage, persistence, pathfinding, guessing entrances for indoor contracts,
and protocol or Rust changes. Author names, sender names, item names, and unrelated numeric stats
are not new scanning surfaces in this increment.

### Ground truth and integration points

App paths are relative to `apps/holtburger-3d/` unless otherwise stated.

| Owner or consumer             | Reference and implication                                                                                                                                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coordinate syntax/conversion  | `src/lib/game/map/map-coordinates.ts`: exact pair parser, hemisphere preservation, printed bias, branded horizontal point.                                                                                                                           |
| Intent mutation               | `src/client/client-navigation-waypoint.ts`: setting is currently embedded in `runCommand`; extract the shared typed operation here.                                                                                                                  |
| Client composition            | `src/client/ClientApp.svelte`, `ClientWorldView.svelte`: existing session lifetime, local confirmation, and callbacks to mounted consumers.                                                                                                          |
| Chat text/input               | `src/client/ClientChat.svelte`: plain message interpolation, click-through buffer, explicit select/copy mode, keyboard scope.                                                                                                                        |
| Book content                  | `src/client/ClientBookWindow.svelte`, `client-book-reader.ts`: page loading/replacement and book inscription rendering.                                                                                                                              |
| Examine content               | `src/client/ClientInspectionWindow.svelte`, `ClientItemInspection.svelte`, `ClientCreatureInspection.svelte`: description, portal destination, and inscription rendering.                                                                            |
| Description truncation        | `src/client/client-object-inspection-format.ts:truncateInspectionDescription` and `ClientItemInspection.svelte`: collapsed text can otherwise cut a coordinate in half.                                                                              |
| Journal content               | `src/client/ClientJournalPanel.svelte`, `client-contracts-view.ts`: plain prose and structured location labels.                                                                                                                                      |
| Exact contract placement      | `src/client/client-contracts-map.ts:contractMapMarkers`: existing AC-local-to-scene conversion and outdoor bounds checks.                                                                                                                            |
| Contract coordinate semantics | Repository-root `crates/holtburger-world/src/state/contracts.rs:ContractLocation::from_position`: journal latitude/longitude are cell-based labels; original authored placement is retained separately. Retail citations are already recorded there. |
| UI/input reuse                | `src/app/ui-base.css`, `src/lib/input/`, and existing native client controls: reuse theme and ownership policy; inspect existing inline description-toggle styling before adding shared link styling.                                                |
| Behavioral evidence           | `src/harness/browser/ClientHudHarness.svelte`, `client-waypoint-probe.ts`, contract/book/inspection fixtures, and `scripts/browser-harness.mjs`.                                                                                                     |

The inspected fixture `src/client/fixtures/object-inspection-wire.json` contains the portal
destination `Holtburg (42.1N, 33.6E).`, establishing parentheses and trailing punctuation as concrete
cases. `host/src/client_projection.rs:ClientBookWire::from_world` copies page text and inscriptions
without formatting; `ACE/Source/ACE.Server/WorldObjects/Book.cs:AddPage/ModifyPage` stores page text.
No host change is needed to expose these strings. Start with the existing supported notation and
representative examples; no broad content census is required. Extend recognition when actual content
demonstrates another format.

### Ownership and contracts

```text
free text -> pure coordinate scanner -> text spans / prepared coordinate spans
                                                  |
                                         shared inline renderer
                                                  |
structured contract location -> exact destination control
                                                  |
                                     typed client set-waypoint action
                                                  |
@waypoint / @wp -> parse --------------------------+-> existing waypoint owner
                                                         |
                                              existing frame -> both maps
```

- Recognition and coordinate conversion belong in the frontend map/text utilities. Add a pure
  scanner beside the existing coordinate parser, sharing lexical rules rather than maintaining
  divergent regexes for command and prose parsing. Do not turn the exact command parser into a
  permissive substring parser or change Explorer's independent grammar.
- Begin with explicit N/S latitude followed by E/W longitude: case-insensitive integer or decimal
  magnitudes, optional comma, whitespace, and existing precision semantics. Delimit matches so
  embedded identifiers, signed invalid inputs, malformed decimals, or a valid-looking suffix of
  an invalid number cannot accidentally become links. Test punctuation and multiline pairs.
- In prose, malformed/nonfinite/out-of-world candidates stay plain text without unsolicited
  errors. Command input retains its existing rejection behavior. Share destination preparation
  and bounds validation so rendering eligibility and mutation cannot disagree.
- A scanner span carries its original source text and a prepared typed destination for the inline
  renderer. It need not retain a duplicate source string, signed degrees, or a parsed command.
  Raw text stays escaped by Svelte; never generate HTML strings or use DOM-wide text rewriting.
  Keep existing description truncation and scan the displayed text. Complete coordinate pairs
  become links; a cut-off pair stays plain text until expansion. No retained offsets or
  coordinate-aware truncation are required.
- The reusable inline renderer owns link appearance and activation behavior, not target state,
  character lifetime, or distance. Prefer one explicit typed callback through the existing client
  component tree. Do not introduce a navigation context, event bus, or global registry merely to
  avoid a few prop handoffs. Migrate harness callers with each changed prop contract.
  `ClientChat` selects plain message interpolation or the shared renderer using its existing
  `historyInteractive` state; no second interaction flag, global permission, or per-link pointer
  override is needed for normal chat.
- Extract one typed set operation from the navigation owner's command branch. The owner checks
  character eligibility and commits only a valid target; client composition supplies the existing
  local confirmation. Both entry paths preserve atomic replacement and reuse existing lifetime checks.
  Avoid simulating command submission from clicks or giving leaf components chat-session access.
- Use normal Svelte derivation for text spans. No dedicated rescanning guarantees, performance
  assertions for countdown updates, persistent match cache, or new polling timer are required.

### Input integration

Start with the inline native control and existing input policy. Verify clicking, selecting/copying
text, and keyboard activation in the browser. Change shared input policy only if these checks
reproduce a problem; do not prescribe selectable-control opt-ins or custom gesture machinery in
advance. Selection dragging must not set a waypoint, and an unrelated old selection must not block
an intentional click.

The source review found that `KeyboardInputPolicy.#pointerDown` prevents button pointer defaults;
this is a reason to test selection, not evidence that a new mechanism is required.

Keep keyboard accessibility through existing scopes. `ClientJournalPanel` already has
`nativeControls: true`; extend the chat-history scope and wire book/inspection content scopes as
needed for deliberate keyboard navigation. Preserve Escape and game key routing. Chat links exist
only in interactive mode, so normal chat needs no new hit-testing policy.

### Structured contracts preserve exact placement

Journal location labels are rounded cell-based coordinates and may omit the hemisphere at zero.
They are not equivalent to ordinary printed player-position coordinates. Feeding those labels
through the prose parser would lose authored offsets and can disagree with the contract map icon.

For an outdoor contact or area, keep the journal label as visible text but supply a destination
prepared directly from its retained authored position. Reuse the conversion currently owned by
`contractMapMarkers`; extract only that proven common calculation and use it in both consumers.
The waypoint point constructor must preserve the branded coordinate contract without caller casts.
Use the normal waypoint coordinate formatter for the target's canonical location label; the journal
keeps its original label. Make the action tooltip identify the destination being set.

Share coordinate conversion without accidentally unifying different bounds policies. The current
contract map includes points on its outer image edge, while waypoint eligibility uses a half-open
outdoor grid. A boundary-only map point may remain visible but is not a valid navigation target;
render its journal label as plain text. Do not silently change map-overlay visibility while
extracting conversion. Use one finite, half-open destination validator for both prose and structured
waypoint preparation. Conversion from authored positions belongs with the contract adapter; the
canonical point factory and grid eligibility belong with the frontend map primitives.

Missing and indoor locations remain noninteractive. Do not infer an exterior entrance or treat
missing data as zero coordinates. Quest-area text can be clickable wherever the journal displays a
valid outdoor area; do not inherit the map overlay's in-progress-only visibility policy. Contract
description/progress prose uses the ordinary scanner and its printed-coordinate semantics.

### Remaining implementation phases

#### Phase 5: Recognition and shared destination preparation

- [x] Use the existing coordinate notation with representative prose examples; add formats only
      when encountered in actual content.
- [x] Add pure span scanning with shared lexical rules, preserving source text byte-for-byte.
- [x] Extract typed destination preparation, bounds validation, and the owner's atomic set operation;
      route existing commands through it without changing command errors/history.
- [x] Share exact outdoor contract conversion with the existing contract map consumer. Keep
      journal formatting, free-text parsing, and map visibility policy distinct.
- [x] Add focused unit cases for punctuation, adjacency, multiple/multiline matches, malformed
      prefixes/suffixes, nonfinite magnitudes, world edges, precision, and zero hemispheres.
- [x] Verify reconstruction of all spans equals original input and retain existing owner coverage
      for invalid command replacement and character lifetime.

Acceptance: one lexical definition and one owner mutation path serve commands and content; exact
contract targets match existing map placements, including nonzero local offsets and zero labels.

#### Phase 6: Inline rendering across the requested surfaces

- [x] Add one shared coordinate-text renderer and explicit typed activation callback.
- [x] Integrate chat bodies, loaded book pages/inscriptions, item/creature descriptions, portal
      destination text, item inscriptions, and contract descriptions/progress.
- [x] Render structured journal outdoor locations using their exact prepared destinations.
- [x] Preserve source text, wrapping, attribution, disclosure controls, and loading/error states.
- [x] Preserve existing description truncation; link complete pairs in displayed text and leave
      cut-off pairs plain until expanded.
- [x] Render chat coordinate controls only while `historyInteractive` is true; otherwise retain
      plain message interpolation and existing click-through behavior. Preserve select/copy and
      verify that selection dragging in linked content does not activate a waypoint.
- [x] Route the existing local success confirmation through client composition and update all
      harness consumers. Add no dedicated content-activation rejection flow.
- [x] Register or extend native-control scopes on the affected content containers without changing
      pointer-acquired keyboard ownership; preserve the Journal's existing scope.

Acceptance: every listed text surface uses the shared path; structured locations use exact geometry;
no content click calls `sendChat`, modifies command history, or creates a second waypoint state.

#### Phase 7: Reassess integration and verify behavior

- [x] Check supported notation, existing truncation, contract conversion reuse, and input ownership
      against representative cases.
- [x] Extend browser probes using production renderer/owner code and representative text fixtures.
- [x] With chat interaction off, verify coordinate text has no actionable/focusable controls and
      retains normal click-through. With it on, verify pointer activation, selection dragging/copying,
      and existing keyboard ownership. Toggle off again and verify links disappear while the target
      remains. Verify deliberate keyboard activation through existing native-control navigation.
- [x] Verify selection/copying across links, ordinary activation with an unrelated selection, and
      no world pointer action from link activation. Add input machinery only for reproduced problems.
- [x] Exercise multiple links and replacement from each requested surface, newly loaded book text,
      collapsed/expanded descriptions, contract progress refresh, and exact structured destinations.
- [x] Verify no outgoing server messages/history changes, no action for invalid prose, no target
      leakage across character/session retirement, and both maps updating while stationary.
- [x] Source-trace the `ClientApp` callback through `ClientWorldView` to the text consumers and
      waypoint owner. Browser automation exercises the real components and owner through harness
      composition, including toast output and server/history exclusion; it does not mount `ClientApp`
      or independently prove its one-line toast wiring. No production adapter was added for testing.
- [x] Run affected unit tests, `npm run check`, `npm run lint:ts`, `npm run lint:dead`, `npm run build`,
      and relevant browser probes from the app directory; check touched-file formatting.

- [x] User verified that the interaction works, including the contracts panel, after the requested
      manual drag-selection check (2026-10-17).

Acceptance: behavioral evidence covers actual component-to-owner composition, not just isolated
tokenizer fixtures. No live asset dependency is introduced into permanent unit tests.

#### Phase 8: Cleanup and completion review

- [x] Remove duplicate regexes, conversion/validation branches, dead command preparation, and
      feature-local styling that an existing shared control can provide.
- [x] Review producer/callback/consumer contracts, retained window lifetime, and source-text fidelity.
- [x] Record actual checks, limitations, and any evidence-driven grammar changes in this extension.
- [x] Leave visual acceptance to the user; report remaining appearance/readability choices.

Extension definition of done: all requested surfaces are covered, prose links preserve visible text,
structured contract links agree with authored map positions, input policy and selection still work,
one owner controls replacement/lifetime, and applicable automated checks pass. Completion of phases
1–4 does not imply completion of this extension. Implementation was authorized by the subsequent user goal; no commit is requested for this increment.

### Risks and remaining decisions

- False positives: use explicit hemisphere pairs and lexical boundary tests; expand notation only
  with content evidence. Bare number pairs remain plain text.
- Chat interaction: reuse the existing mode as the sole gate. Normal chat remains entirely
  click-through; interactive links must never also trigger a world action. No mixed hit-testing
  policy is introduced into normal chat.
- Text selection: verify real drag/release, not only synthetic `.click()` assertions.
- Native-control integration: verify ordinary native controls with existing input policy before
  considering any shared-policy changes; preserve keyboard accessibility.
- Structured label/position differences: preserve exact authored positions and show the actual target
  in the action tooltip; never round-trip the journal label through the printed-coordinate parser.
- Scope estimate: a small scanner and inline renderer, focused owner/conversion extraction, and
  wiring across existing components should suffice. If implementation grows into a general rich-text
  engine, command dispatcher, or navigation framework, stop and reassess the design.

No blocking product questions remain from the agreed scope. Start with existing coordinate notation;
consider additional formats when encountered rather than requiring a content census.
The dry run traced normal activation, malformed prose, an invalid world edge, description collapse,
book updates, contract countdown refresh, and existing character retirement through immediate
callers. It did not execute browser input experiments or establish a complete authored-content census.

### Extension implementation evidence and quality review

- `npm run test:ts -- src/lib/game/map/map-coordinates.test.ts src/lib/game/map/map-waypoint.test.ts src/client/client-navigation-waypoint.test.ts src/client/client-contracts-map.test.ts src/explorer/world-input.test.ts src/lib/input/keyboard-input-policy.test.ts src/client/client-location-command.test.ts src/client/client-book-reader.test.ts src/client/client-object-inspection-format.test.ts src/app/minimap-frame.test.ts`: 131 tests across ten files passed.
- `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and `npm run build` passed. Svelte reported
  zero errors/warnings. The existing Vite large-chunk advisory remains; no suppression was added.
- `--client-waypoint`: original 26 assertions and real pointer pan/clear checks pass, plus content
  activation across chat, loaded/deferred book pages, both inscription surfaces, item/creature
  descriptions, portal destinations, and contract prose/progress/contact/area. The probe verifies
  native Tab/Enter activation, native selection through links, actual clipboard transfer, a drag
  with an existing selection causing no navigation, unrelated selection allowing activation,
  local confirmation, no server/history changes, and no camera/entity-selection changes from links.
- `--client-keyboard`, `--client-book`, `--client-inspection`, `--client-contracts`, and real-content
  `--world-map` regression probes passed. Inspection's synthetic artwork-failure scenario emits
  its expected icon-preparation warning. No visual acceptance was performed.
- Fresh character/word drag-selection creation could not be verified: it also failed in an isolated
  iframe containing ordinary text without app handlers. Native word selection plus Shift-click
  extension and clipboard transfer pass. The content report explicitly records
  `dragSelectionCreationVerified: false`; this records the automation limitation. The user subsequently
  confirmed that the interaction works, including the contracts panel, resolving manual acceptance.
- Real pointer input reproduced loss of chat hit testing when a native-control click ended keyboard
  ownership. Interactive-mode CSS now owns buffer pointer availability; normal mode remains plain
  and click-through. The keyboard probe now distinguishes explicit interaction mode from focus.
- Native-control traversal requires the chat buffer's `nativeControls` scope. Its existing native
  copy regression failed after that change until explicit text-scope pointer reactivation was
  allowed. `KeyboardScope.pointerActivation` is a small opt-in consumed only by chat's text container;
  ordinary buttons retain existing ownership policy. No selectable-control attributes, custom
  gesture trackers, focus-rejection timers, or per-panel focus/blur repairs were retained.
- The Journal regression assumed the first button in a resolved row was removal. Coordinate
  buttons invalidated that assumption. Its probe now finds the named removal control; production
  removal behavior was unchanged and the full regression passes.
- `ClientApp` directly invokes the production owner setter with a status-toast callback; the callback has
  no server or history path. Unit coverage proves that setter's character check and confirmation;
  browser coverage uses the same setter with the actual text components and toast overlay, and checks that activation leaves chat unchanged.
  No action adapter was added solely for testing this one-line composition.
- Quality review traced lexical parsing/preparation through both command and content inputs,
  canonical geometry through contract map and Journal consumers, every UI callback handoff, and
  character/session retirement. Intent remains owned by the existing frontend owner. The shared
  inline style also replaces the inspection disclosure's duplicate style. No additional structural
  blocker was found within that scope; manual selection acceptance was subsequently confirmed.
- Unrelated ACE submodule state remains untouched. No files were staged or committed.

### Post-acceptance feedback refinement (2026-10-17)

- Successful sets from both command aliases and content links publish a status toast through the
  existing toast center. Report, usage, and clear command responses retain their chat behavior.
- The minimap waypoint row shows a dedicated SVG pin and the stored destination label. Distance
  appears only while guiding; near and paused states show coordinates alone. The inline clear
  affordance and whole-label click behavior remain. The accessible description uses the same text.
- Focused unit checks cover the separate notification and chat sinks. The waypoint browser probe
  checks the destination coordinates in the HUD, actual toast text, and unchanged chat on activation.
- Validation after this refinement: 61 focused tests, full Svelte/TypeScript checks (zero errors
  or warnings), TypeScript/dead-code lint, production build, touched-file formatting, and the
  waypoint/content browser probe passed. The existing Vite large-chunk advisory remains.
- Compact-label follow-up: the waypoint browser probe passes all 26 assertions plus content
  interactions, including coordinates-only near/paused labels and real-pointer clearing. The probe
  now selects the first text span by type because the SVG precedes it. Build, lint, and formatting
  pass; no visual acceptance was performed.
- The minimap and World destination markers share the label's SVG pin. Its SVG viewport places
  the tip at the projected coordinate; map consumers retain accent coloring while the label uses
  its text color. The obsolete diamond asset was removed. The off-disc direction cue is unchanged.

### Theme styling cleanup (2026-10-18)

- Shared `.ui-waypoint-pin` and `.ui-waypoint-marker` CSS hooks replace inline pin presentation
  and map colors. Pins inherit their consumer color; markers default to the shared accent.
- Decorative waypoint pins are excluded from the shared HUD hover enlargement rather than
  overriding transforms inside the SVG. Themes can style the hooks through the existing cascade.
- Shared inline actions use the highlight color on hover and the existing themed keyboard focus
  ring. No waypoint-specific palette variables or theme-supplied artwork mechanism were added.
- SVG dimensions/offsets remain authored geometry: the map pin tip and hover area must agree.
  The minimap edge cue retains its authored shape and existing fill/outline palette variables.
- Browser verification passes existing navigation/content checks plus stylesheet overrides for
  pin fill and map color, fixed-size/text-colored hover behavior, and native keyboard focus styling.
  Production build, lint, and touched-file formatting pass; no visual acceptance was performed.

### Final code-quality review (2026-10-18)

Verdict: ready within the reviewed feature scope. The baseline is `0381168ca`; all accumulated
waypoint changes, including new files and the removed diamond asset, were included. Unrelated ACE
submodule state was excluded.

- Traced command and content parsing/preparation through `ClientWaypointText`/`ClientWaypointLink`,
  `ClientWorldView`, `ClientApp`, and `ClientNavigationWaypointOwner` to toast and map consumers.
  Commands and content reuse the same setter without giving leaf components server access.
- Inspected both authored contract consumers: map markers and Journal navigation reuse one exact
  placement conversion. Their closed-image versus half-open navigable bounds remain intentionally
  distinct; rounded cell labels never become navigation geometry.
- Inspected character replacement, portal transitions, unavailable/indoor placement, clearing, and
  session cleanup. The existing owner retains intent; maps own only derived presentation.
- Reviewed keyboard-policy producers/consumers, chat interaction gating, native selection handling,
  book/inspection scopes, CSS theme hooks, SVG placement, and browser fixture changes. No extra
  navigation registry, cache, custom selection gesture tracker, or shared-crate dependency was added.
- Consolidation retained shared coordinate grammar, exact contract conversion, and inline action
  styling. Plain-text spans and prepared destinations remain distinct; descriptive command reports
  and the compact HUD intentionally use different wording.
- Corrected the plan's composition-test claim: app wiring was source-traced, while browser tests
  exercise actual components and the owner in harness composition. Fresh drag creation remains a
  headless automation limitation previously resolved by user verification. No visual acceptance or
  new live-server test was performed during this review.
- Accepted constraint: SVG dimensions and the World-map hover offset describe the same fixed pin
  geometry. Arbitrary theme-driven resizing and replacement artwork are outside the agreed scope.
  No blocking correctness, ownership, or maintainability finding remains within this boundary.
- Final affected unit run: 131 tests passed across 10 files. Latest production type checks, lint,
  build, formatting, and the waypoint/content/theme browser probe passed before this review; only
  documentation changed during the review. Earlier keyboard, book, inspection, contracts, and
  real-content World-map regression evidence remains recorded above.
