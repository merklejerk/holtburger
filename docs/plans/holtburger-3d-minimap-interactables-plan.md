# Minimap doors and switches

Status: Complete (Phases 1–7). User accepted approximate setup width along authored local X, including unusual models. Pressure plates and lock-state colors remain excluded.
Native Switch (26) classification accepted after four live lever examples.
Door colors now represent authored direct-use eligibility, not lock state.
Direct-use admission and its app-local diagnostic override are implemented.

## Goal and boundaries

Show selectable abstract depictions of received/spawned doors and the switches,
buttons, and levers the user identifies, with door colors distinguishing direct use allowed versus disabled.

In scope:

- Doors: world-sized bars aligned with authored sideways direction and approximate setup width, with
  frontend-tuned screen-space thickness. Distinct frontend-tuned colors represent direct
  use allowed versus disabled (`ItemUseable & NO`), not lock state.
- Buttons/levers/switches: one shared symbol for native WeenieType::Switch (26).
- Hover names and existing GUID selection in Client and Explorer.
- An explicit radar-visibility exception for the supported classes.
- Client debug-panel selected-entity details so examples can be identified by WCID.

Out of scope: pressure plates and region rendering/hit testing, server-only trigger
revelation, activation links, automatic appraisal requests, a general emote
interpreter, new server messages, and changes to existing selection lifetime rules.
Native Switch coverage is accepted; creature-authored exceptions remain out of scope.
Lock colors and appraisal normalization are deferred from this feature.

## North stars

- Resolve identity and useability at their owning layer; app-local code owns
  symbols, colors, and minimap policy.
- Prefer existing presentation feeds, imperative display cadence, and selection
  owners. No new renderer pass or frame-rate reactive transport.
- Spawned public ItemUseable supplies use admission; never infer lock state from
  useability. UNDEF (missing property) is not NO, matching retail's predicate.
- Missing metadata is explicit; no inferred weenie type from a display name.
- Keep content discovery/query access in content, parsed facts in world/core,
  and Explorer search/inspector UX inside the app.

## Phase 1: completed investigation

- [x] Census template classifications, radar/visibility flags, lock properties,
      and geometry; inspect naming exceptions against source-database emotes.
- [x] Trace creation, assessment, public lock changes, view refresh, and removal.
- [x] Establish a bounded static-classification access design.
- [x] Prove the server-only plate limitation and remove plates following user input.

Evidence, source references, asset fingerprints, and counts remain below.

## Prerequisite: collect representative controls

- [x] Wire the selected entity into Client diagnostics using its current received
      presentation view, sampled at the panel's existing bounded cadence.
- [x] Show name, GUID, decimal/hex WCID, presentation/radar classification, setup
      and motion IDs, plus selectable JSON for the full received presentation snapshot.
- [x] User supplies representative WCIDs or snapshots for real-world controls.
      Four live lever examples received: 285, 286, 2609, and 14565.
- [x] Compare those examples with ACE templates and emotes, then choose the narrow
      classification policy and record its coverage. Do not equate presentation class
      with authoritative WeenieType or imply the JSON contains server-only properties.

### User-provided live lever examples

The four screenshots match these records in the Phase 1 catalog census:

| WCID  | ACE class name  | WeenieType  | Setup in screenshot and catalog | Motion table in screenshot |
| ----- | --------------- | ----------- | ------------------------------- | -------------------------- |
| 286   | levergearswitch | Switch (26) | 0x02000261                      | 0x0900006E                 |
| 285   | leverboxswitch  | Switch (26) | 0x020004B5                      | 0x0900006D                 |
| 2609  | leverbigswitch  | Switch (26) | 0x0200031F                      | 0x0900006F                 |
| 14565 | leverhightech   | Switch (26) | 0x02000C2F                      | 0x090000D4                 |

All four omit authored radar behavior, matching the live diagnostic screenshots.
Their live presentation/radar category is currently `other`; that is the existing
projection's category, not their authoritative ACE WeenieType. Different setup
and motion IDs illustrate why geometry IDs should not define the classification.

The user accepted matching native Switch (26). No creature-authored exceptions or
name/model heuristics are needed for the current scope.

### Direct-use bug and fix

Live example WCID 4145 (`doorprisonactivatedfast`) authors ItemUseable=1 (NO) and
ActivationResponse=2 (Use). ACE transmits authored ItemUseable during CreateObject
(`WorldObject_Networking.cs:102-103,733`). Retail checks the NO bit in
`ItemUses::IsUseable` (`acclient.c:286680-286683`) and emits the door-specific refusal
instead of a normal Use request (`414496-414557`). Core previously suppressed only
progress feedback for NO, then sent the request anyway; ACE's door handler accepted it.

- [x] Reject explicit NO before arming busy state or sending Use; emit the existing
      client action-feedback event with the door-specific or generic refusal message.
- [x] Add an Unrestricted use debug toggle, off by default and reset on interaction
      session creation. Capture the choice in each use command. Busy and server rules
      remain enforced; the override never rewrites authoritative ItemUseable facts.
- [x] Update TUI callers to request ordinary restricted use explicitly.
- [x] Cover rejection/no packet/no busy, override admission, and busy preservation
      in core tests; exercise the toggle and warning toast in the browser harness.

## Phase 2: carry confirmed facts

- [x] Extract reusable optional catalog path/open/capability access into content;
      keep environment input and Explorer fuzzy search at the app boundary. Reuse the
      existing catalog decoder and build immutable parsed classification at startup.
- [x] Retain authored ItemUseable in the catalog for Explorer (it currently omits
      this property), update model/exporter/codec together, and bump/rebuild the format.
      Locked/DefaultLocked catalog fields are no longer needed for this feature.
- [x] Carry a typed door/switch/ordinary/unclassified distinction through the
      existing dynamic view. Door treatment consumes producer-resolved NO-bit useability
      from the same shared predicate used for admission; do not rederive it in the map.
      Missing public useability follows retail UNDEF semantics and is not a lock claim.
- [x] Feed property changes through existing entity upserts. Keep optional missing
      WCID metadata explicit and preserve network DOOR identity when the catalog is absent.

Acceptance: focused tests cover native switch classification, missing metadata,
NO/UNDEF/REMOTE useability, property updates, and generation/removal behavior.

## Phase 3: minimap symbols and selection

- [x] Extend the existing map appearance union and radar eligibility policy for the
      confirmed classes; retain runtime Hidden/NoDraw filtering for new markers.
- [x] Draw frontend-tuned door and switch symbols in the existing canvas overlay.
      Reuse point hit testing, hover labels, and selected-marker feedback.
- [x] Wire Explorer's currently empty minimap selection callback to its existing
      selection/inspector owner and return the selected identity to the map.
- [x] Update retail visibility comments with the actual decompile citation and
      final classified-template census; do not reuse broad counts as final coverage.

Acceptance: symbol, useability color, visibility, and click/drag behavior are correct in
both modes. No duplicate region or selection infrastructure remains from plate scope.

## Phase 4: verification and cleanup

- [x] Use the non-interactive browser/HUD harness for selected/unselected markers,
      stationary useability changes, hover, selection, removal, and indoor/outdoor readability.
- [x] Run relevant TypeScript/Rust tests, app type checks, frontend lint/dead-code
      checks, and clippy with warnings denied for touched Rust crates. Verify formatting.
- [x] Remove temporary asset-dependent probes; do not retain tests requiring
      untracked runtime content. No TUI diagnostics and no commits unless requested.
- [x] Review contract ownership and added lines; remove dead terminology and paths.

## Follow-up: world-sized, oriented doorway markers

User feedback: the current door rectangles remain the same pixel size at every zoom
and all share one screen-space orientation. They should align with the level and
scale with map zoom. The intended marker represents the stable doorway, rather than
the moving door leaf. Switches retain their fixed-size diamonds.

### Ground truth and ownership

- `src/lib/game/runtime/game-presentation-runtime.ts`,
  `listPresentedSpawnedEntities`: currently supplies entity identity/view and live
  scene placement, but no stable footprint.
- `src/lib/game/systems/object-visual-template-repository.ts`: prepared part geometry,
  part scales, and bounds are already available during visual preparation.
- `src/lib/game/systems/dynamic-entity-system.ts`: retains the complete setup pose
  beneath animation. Current selection geometry and rigid presentation bounds follow
  the animated pose; they must not silently become the stable doorway footprint.
- `src/lib/game/map/map-blips.ts` and `map-view.ts`: existing scene-to-map projection
  handles zoom, heading, and aspect ratio. Current eligibility clips the entity origin,
  which needs extending for bars whose origin is outside the map but span is visible.
- `src/app/Minimap.svelte` and `minimap-selection.ts`: current door drawing and pointer
  tests use fixed-size rectangles and point targets. Hover, clicking, and selected
  feedback must consume the same projected bar geometry.
- `ACE/Source/ACE.Server/WorldObjects/Door.cs`: door open/close uses NonCombat On/Off
  motions. This proves that entity placement alone does not describe the moving leaf;
  it does not prove that every setup pose matches the closed doorway.

Frontend paths above are relative to `apps/holtburger-3d/`. No protocol, catalog-format,
shared Rust, or new renderer-pass changes are expected. Extend the existing app-local
presentation-to-map contract with cached geometry; avoid per-frame mesh scans or a
second marker feed. A demonstrated need beyond that boundary requires re-scoping.

## Phase 5: establish stable door geometry

- [x] Inspect representative door setups, including WCID 4145, and sample the distinct
      model/pose families available in the catalog. Record setup IDs, local width axes,
      pivot offsets, part scales, and the relationship between setup and closed poses.
- [x] Check hinged, sliding, and multipart examples where present. Establish whether
      setup-local geometry supports a simple stable span; do not assume local X is
      always width or that the entity origin is the span's center.
- [x] Choose and document the narrowest evidence-backed footprint derivation. Include
      a deliberate policy for unavailable, degenerate, or ambiguous geometry. Do not
      silently substitute guessed dimensions or current animated bounds.

Acceptance: recorded asset evidence establishes how to derive the doorway span,
including its local offset, or identifies the exact families needing a different
approach. Resolve this before implementing the geometry contract. If closed-motion
sampling is necessary, assess that added work explicitly rather than treating setup
pose as closed by default.

### Phase 5 findings (historical; superseded by accepted approximation)

Read the current local catalog and DAT content with a temporary Rust probe using
`ContentRepository`, `SetupModel`, `MotionTable`, `Animation`, and `GfxObj` decoders.
Compared transformed model vertices in setup placement (Resting with the existing
placement-0 fallback) against the NonCombat Off cycle's authored initial frame,
retaining setup transforms for parts outside a clip's authored prefix.

- All 542 Door templates decoded, covering 58 distinct setups, 36 motion tables,
  and 59 setup/motion-table combinations. No template authors part substitutions.
- All 59 combinations have an Off cycle consisting of one zero-framerate clip;
  these closed poses can be sampled deterministically. No Off clip authors root frames.
- None has a Resting placement; all use the existing placement-0 fallback. In 52
  combinations (532 templates), at least one transformed vertex differs from the
  closed pose by more than 1 mm. Differences range from small offsets to substantial
  movement; do not interpret all 532 as equally visible errors.
- The prison setup `0x02000281`, including WCID 4145, differs by approximately
  0.875 m at its most displaced vertex. Using setup bounds as closed geometry is
  therefore not a justified simplification even for the user's example.
- Setup geometry's longer horizontal axis is local X for 52 combinations and local Y
  for seven. A fixed X-width convention is also invalid.
- The closed poses include non-bar shapes:

| Example                       | Setup        | Closed horizontal extent (unscaled metres) | Consequence                                                      |
| ----------------------------- | ------------ | ------------------------------------------ | ---------------------------------------------------------------- |
| 25581, `doortwosarcophaguses` | `0x02000fe6` | 3.33 × 3.43                                | Multipart obstacle has no obvious single width axis.             |
| 29935, `doormetalgrate10x10`  | `0x02001215` | 10.00 × 10.00                              | Horizontal grate; a bar would misrepresent its footprint.        |
| 72919, `ace72919-walkway`     | `0x020018c4` | 3.30 × 3.30                                | Closed pose is a horizontal surface, approximately 0.575 m tall. |

Two decisions remain:

1. Use authored closed-pose geometry rather than setup bounds. The frontend already
   retains the animation clips, but `PreparedMotionClosure` exposes only the table ID
   and clip map, not the cycle-to-frame mapping needed to find Off independently of
   current playback. Trace and scope that metadata addition before implementing;
   the previous expectation of purely map/presentation edits is not yet proven.
2. Choose the depiction for non-bar doors. Recommended direction: retain world-sized
   bars for ordinary upright doors and use a thin closed-footprint outline for broad
   horizontal/ambiguous cases. This needs user review; do not silently pick an axis,
   hide these entities, or introduce per-WCID exceptions. A reliable distinction must
   be established from geometry after the intended visual policy is agreed.

User requested stopping for a major gap or when visual judgment is needed. This is
that checkpoint: Phase 6 has not started, and existing production rendering is unchanged.

Evidence artifacts (temporary): `/tmp/door-footprint-census.json`,
`/tmp/door-footprint-summary.json`, `/tmp/door-footprint-evidence.png`, and
`/tmp/door-footprint-probe.rs`. The temporary asset-dependent binary was removed from
the repository. Plot shows model vertices, not inferred collision or doorway regions.

Input SHA-256:

- `dats/weenies.hwc`: `1822ccd3fc285bd810c3664145d329c8ab8b8ba312ac43a47fc7abd18b7825ba`
- `dats/assets.hba`: `bae373093edfd745c63ba8c2f03f3e0de7b0451982c31eeb49d7340ea703ff0f`

### Follow-up decision: approximate setup geometry and authored axes

The user accepts that setup poses are often half open and that minimap dimensions
need only be approximate. Closed-pose sampling and new motion metadata are therefore
not required for this feature. The earlier proposal to require closed-pose geometry
is superseded. Before implementation, the user requested verification of the authored
forward/sideways convention rather than inferring orientation from the longest bound.

Axis verification against the unchanged census inputs:

- `ACE/Source/ACE.Entity/Position.cs:80-82` defines heading as local +Y transformed by
  object rotation. `WorldObjects/WorldObject.cs:990-1006` uses the target's heading for
  Front/Back classification, and `Door.cs:91-93` consumes that classification for use.
  Local X is therefore the conventional sideways axis in AC's Z-up coordinates.
- As a diagnostic census (not a proposed runtime threshold), comparing closed horizontal
  extents with a 2:1 aspect threshold finds 533 templates clearly spanning X, five
  clearly spanning Y, and four broad cases. This distinguishes model construction from
  semantic heading; object rotation alone cannot correct a model authored sideways.
- WCID 4145's setup X extent is approximately [-1.6664, 1.6733] m (width 3.3397 m),
  versus closed X width 3.3412 m. Approximate width along the authored sideways axis
  works particularly well for this example despite the leaves' different poses.
- Clear Y-width exceptions are WCID 72907 (setup `0x020018f7`), 46310
  (`0x02001b7c`), 46311/46312 (`0x02001b7d`, distinct motion tables), and 46575
  (`0x02001b92`). Their closed widths along Y range from 1.277 to 20.55 m;
  forcing an X bar would make them both undersized and perpendicular to the opening.

Accepted implementation: use authored local X for every door, including sideways and
broad exceptions. The user explicitly accepts approximate depiction; no model-specific
exceptions, longest-axis inference, closed-motion metadata, or footprint outlines are
needed. Retain the setup bounds' X endpoints and scene-local Z center so off-center
pivots remain represented. Missing or zero-width geometry uses a selectable point
in the same category color. Animation does not change the cached setup span.

## Phase 6: project door spans and update interaction

- [x] Derive/cache stable local door geometry at visual preparation, using existing
      prepared geometry and pose helpers. Respect appearance replacement, scale changes,
      entity generation, and disposal through the existing resource owners.
- [x] Expose the cached span through the existing presentation-to-minimap path. Apply
      the correct live root placement and scale exactly once, then use the existing
      world-to-map projection for both endpoints.
- [x] Replace the fixed horizontal rectangle with the projected span. Width scales
      with zoom; thickness remains frontend-tuned in screen pixels.
      Preserve cyan/orange meaning, height treatment, and Hidden/NoDraw filtering.
- [x] Extend the existing hit-target representation for door spans. Use distance to
      the entire span, plus a generous screen-space tolerance, for both hover and click.
      Preserve deterministic overlap resolution and click-versus-drag behavior.
- [x] Make selected feedback follow the span and retain partially visible bars when
      their span intersects the map even if the entity origin does not. Keep ordinary
      point markers on the existing path; remove obsolete door-specific point rendering.

Acceptance: door position, width, and direction align with scene geometry across map
rotation and zoom; both ends can be hovered and selected. Open/close animation leaves
its doorway marker stable. Client and Explorer share the implementation without new
selection owners or hot Svelte state.

## Phase 7: follow-up verification and cleanup

- [x] Add focused geometry/projection tests for local pivot offsets, authored sideways
      spans, root rotation/scale, map rotation/zoom, and span intersection at map edges.
- [x] Test endpoint/midpoint hits, misses, overlap tie-breaking, and span-aware selected
      feedback while preserving point-marker and drag behavior.
- [x] Use the browser HUD harness for indoor/outdoor rendering, zoom, rotation,
      hover, and endpoint selection; verify a real door in Explorer. Cover animation
      stability, removal, scale, and visual replacement with focused unit tests.
- [x] Run relevant TypeScript tests, app checks, lint/dead-code checks, formatting, and
      browser verification. Run Rust checks only if the evidence expands scope into Rust.
- [x] Remove temporary asset-dependent probes and stale fixed-size-door assumptions.
      Record evidence and update plan status; do not retain tests requiring untracked DATs.

Acceptance: behavior is verified against actual door geometry, all relevant checks
pass, and cached footprint ownership adds no duplicate geometry or selection pipeline.

## Remaining questions and definition of done

No blocking classification questions remain: native Switch is accepted, plates and
lock colors are excluded. Draw doors by authored direct-use eligibility; the debug
override must not alter their minimap meaning. Whether some other mechanism exists
is not guaranteed by NO and should not be asserted in a label.

Done means confirmed doors/controls appear and are selectable in both modes, direct
use obeys received useability unless explicitly overridden, property updates refresh
without movement, optional metadata absence is explained, and appropriate checks pass.
The follow-up uses stable approximate setup widths, authored sideways orientation,
and world scale. Bars remain useful across zoom levels and selectable along their
visible length. The user accepted the uniform approximation for unusual door families;
no geometry policy questions remain.

## Follow-up implementation and verification

- Cached stable setup bounds in the existing dynamic entity owner; replacement and
  root-scale updates feed the same presentation-to-map contract. No Rust, protocol,
  motion-metadata, renderer-pass, or selection-owner changes were needed.
- Door endpoints use existing scene/map transforms. Rendering, selected outlines,
  hovering, and clicking consume the same projected segment. Partial spans remain
  visible when the entity origin is outside the circular map.
- Passed 141 focused TypeScript tests across map, selection, dynamic entities, and
  presentation runtime. The 27 dynamic-entity tests passed again after adding an
  explicit removed-span assertion. Svelte/TypeScript checks, ESLint and Knip passed.
- Browser HUD probes passed rotation, zoom scaling, both endpoint hover/clicks,
  selected feedback, colors, indoor/outdoor treatment, visibility, and drag behavior.
  Capture: `/tmp/door-span-hud.png.door-span.png`.
- Real-content Electron Explorer: WCID 4145 produced a rotated orange segment;
  one zoom step increased its projected length by 1.2, and an endpoint click selected
  the door in the existing inspector. Capture: `/tmp/door-span-explorer.png`.
  A later supplementary removal probe was invalidated by a development-page reload;
  removal coverage comes from the passing unit/HUD checks, not that probe.

## Final accumulated-diff quality review

Reviewed tracked and new files against HEAD, including the catalog exporter/codec,
content discovery and type index, both host compositions, world bootstrap, core
classification and Use admission, TUI callers, host command decoding, client interaction
and diagnostics owners, Explorer selection lifetime, presentation bounds, minimap
projection/drawing/hit testing, input binding, fixtures, and documentation.

- Made catalog state construction private: callers can no longer pair a reader with
  a type index from another catalog while advertising a coherent capability.
- Prepared replacement setup bounds before committing template resources, keeping
  potentially failing geometry preparation on the preparation side of publication.
- Removed a redundant shape-test branch and corrected discovery/interaction comments.
- Confirmed public NO-bit admission is independent of locks and the diagnostic override;
  neither map color nor the authoritative entity is rewritten by that override.
- Traced stationary property publication, selection removal/generation replacement,
  visual replacement, root scaling, and animation-independent setup bounds. Hover and
  clicks use the same projected segment. The R binding reuses the session interaction
  owner and guards editing, blocked input, repeats, composition, and browser modifiers.
- Accepted concessions remain: uniform approximate authored-X bars, native Switch
  classification only, optional offline catalog assumptions, and no pressure plates.
  No additional architecture changes or blocking quality findings remain.

Verification after review: 175 focused TypeScript tests, app type checks, ESLint,
Knip, focused Rust catalog/classification/command/export tests, and all-target clippy
with warnings denied passed. Browser HUD probes, 11 host protocol tests, two world interaction tests, and
the TUI Use-command mapping test also passed. Keyboard dispatch was source-reviewed; the HUD harness
exercises the shared use controller and controls, not the ClientApp window handler.
No live server or TUI session was used during this review.

## Initial implementation and verification

- Extended the existing map category contract with `door`, `door-no-direct-use`,
  and `switch`; no second marker feed or region infrastructure was needed.
  Cyan/orange door bars express the shared NO-bit admission predicate, and gold
  diamonds represent native Switch. Runtime radar omission no longer hides these
  landmarks; Hidden/NoDraw still do. The debug override does not change marker color.
- Shared content owns optional catalog discovery, capability, reader, and an immutable
  startup-parsed WCID type index. Environment configuration and Explorer search stay
  app-local. Both hosts expose capability; the client debug panel explains missing
  metadata. World bootstrap consumes parsed types, without filesystem work in core.
- Catalog v11 retains authored ItemUseable for Explorer. Rebuilt this worktree's
  `dats/weenies.hwc` successfully: 43,913 templates. Older artifacts require re-export.
- Explorer selection now lives in ExplorerApp and feeds the existing entity inspector,
  runtime outline, and minimap ring. Marker selection opens/expands the Entities tab;
  removal or generation replacement clears the selection.
- Passed 131 focused Rust tests (catalog/exporter, core commands and dynamic views,
  shared catalog capability/search), including stationary useability updates and
  explicit unrestricted-use admission. Passed 84 focused TypeScript tests covering
  map behavior, interaction dispatch, and Explorer entity/session behavior.
- App Svelte/TypeScript checks, ESLint, Knip, and clippy with warnings denied passed.
  Clippy covered common, catalog, content, world, core, tools, CLI, and 3D host,
  including all targets. Formatting and diff whitespace checks passed.
- Browser HUD harness passed shape/color checks for both door categories and switches,
  indoor/outdoor treatment, stationary changes, Hidden/NoDraw removal from hit tests,
  actual clicks, existing drag behavior, diagnostics and unrestricted-use controls.
  Screenshots: `/tmp/minimap-interactables.png.*.png`.
- Real-content harness spawned WCID 4145 from the rebuilt catalog, verified rendered
  selection, then exact-despawned it with resource cleanup.
- Headless Electron Explorer verification used real WCIDs 286 and 4145. Hover identified
  the lever; a minimap click switched from World to Entities and selected its inspector.
  Despawn cleared selection. The orange door marker expanded collapsed tools and selected
  GUID 0xf0000002, generation 2. Captures: `/tmp/explorer-minimap-lever.png` and
  `/tmp/explorer-minimap-door.png`. No game-server connection was used for this UI check.

The Phase 1 evidence below is historical; its proposed catalog extraction, missing
HostStatus field, and requests to confirm scope have been resolved by this implementation.

## Phase 1 evidence (historical investigation)

The plate findings below explain why plates were dropped. Lock-state investigation
and proposed appraisal/catalog changes below are also historical and deferred; the
active scope above uses immediate public useability instead. Plate rendering, region
hit testing, hidden-trigger revelation, and server changes are no longer planned.
Recommendations below about 19 WCID classifications are superseded by the decision
to collect the user's real-world examples before choosing switch classification.

### Census provenance and limits

Ran the existing Rust catalog and DAT decoders through a temporary harness binary:
`cargo run -q -p holtburger-debug-harness --bin minimap_interactable_census`.
The probe read all catalog records, selected native types 19/24/26 and button/lever
name candidates, decoded every selected native template's setup and effective
GfxObj parts, and measured default-pose vertex extents with part and template scale.
It applied catalog animation-part substitutions. Missing/invalid assets failed the
probe rather than disappearing from counts. The temporary source was removed.

Also ran SELECT-only queries against `ace-holtburger-db`, database `ace_world`, for
properties absent from the catalog and emote evidence. Both database and catalog
contain 43,913 templates; native type counts agree. This is template evidence, not a
count of spawned instances or a guarantee about server-side instance overrides.
No server state was changed, and no live client/TUI session was started.

Input fingerprints:

- `dats/weenies.hwc`, format 10, SHA-256
  `4e278705c2963555cfbb340c9f9e20e8f4ac1e52bd2b396d2688f20f0e5bb8f8`.
- `dats/assets.hba`, SHA-256
  `bae373093edfd745c63ba8c2f03f3e0de7b0451982c31eeb49d7340ea703ff0f`.

| Native type   | Templates | Distinct setups | Missing radar behavior | Hidden/NoDraw mask or NoDraw override | No drawable polygons |
| ------------- | --------: | --------------: | ---------------------: | ------------------------------------: | -------------------: |
| Door          |       542 |              58 |                    542 |                                     0 |                    0 |
| PressurePlate |        80 |               6 |                     80 |                                     0 |                    0 |
| Switch        |       193 |              44 |                    193 |                                     0 |                    0 |

All 815 native templates lack radar visibility and would need the exception
when present in the feed; only 649 are eligible for normal-client delivery under
their template Visibility setting (see below). Retail's predicate
at `acclient-eor-source/acclient.c:417954-417970` only accepts the three show values;
this provides the source and measured population for the eventual marker comment.

UiHidden is a separate flag: 18 doors, one switch (WCID 10706, Wheel of Fortune),
and zero plates author it. Do not conflate UiHidden with PhysicsState.Hidden.
No native template is fully translucent: 79 plates omit translucency and WCID 8639
uses 0.5; two switches use 0.25; all doors omit it. This does not prove final material
visibility or actual runtime placement. Runtime Hidden/NoDraw still need respecting.
The current minimap only explicitly checks Hidden; the new interactable eligibility
should also honor NoDraw rather than silently reveal a runtime-invisible object.

Scale coverage: doors have 539 absent scales and three at 0.6; plates have 71 absent,
three at 3.0, two at 1.75, one at 2.0, two at 1.5, and one at 0.8. Switches have
152 absent and 41 explicit scales spanning 0.3–2.0. Absence uses the producer's
existing effective scale; do not independently default scale in the minimap.

### Critical correction: server-only Visibility is not a rendering flag

`Player_Tracking.cs:58-62` returns before sending CreateObject when
`worldObject.Visibility && !Adminvision`. `WorldObject_Properties.cs:2404-2407`
reads this from PropertyBool.Visibility (18), default false. This is independent
of PhysicsState.Hidden, NoDraw, UiHidden, and translucency.

| Native type   | Server-only Visibility=true | Potentially delivered to normal clients |
| ------------- | --------------------------: | --------------------------------------: |
| Door          |                     0 / 542 |                                     542 |
| PressurePlate |                 **74 / 80** |                                   **6** |
| Switch        |                    92 / 193 |                                     101 |

The six plate templates without the server-only restriction are Tripwire 299,
Wedding Pressure Plate 15278, Pile of Stones 25573, and Pile of Rocks 25574,
27561, 29941. None of the 19 reviewed creature controls below authors
Visibility=true. These are delivery eligibility counts, not actual live spawns.

**Implication:** a catalog supplies classification and geometry references, but
not live instance GUIDs/positions. It cannot make the other 74 plates appear in
normal-client entity feeds. Typical Pressure Plate 298 and large plate 2131 are
server-only. The proposed feature can depict those when explicitly spawned in
Explorer, or when an authorized admin session receives them, but cannot promise
them in a normal live session. No minimap filter change fixes absent network data.

Recommendation: retain the user's spawned/received-entity scope, explicitly accept
this coverage limit, and keep server changes or an offline world-instance overlay
out of this feature. If the intended outcome is revealing most dungeon plates,
re-scope before Phase 2: that is materially larger than the current architecture
extension. No permissions or server settings were changed during this investigation.

### Plates: region geometry is feasible, but the type means collision trigger

| Setup      | Templates | Example WCID/name             | Measured default-pose horizontal extent at that example's scale |
| ---------- | --------: | ----------------------------- | --------------------------------------------------------------- |
| 0x0200025A |         5 | 298, Pressure Plate           | 0.90 × 0.90 m                                                   |
| 0x020000EB |         1 | 299, Tripwire                 | about 0.288 × 0.198 m                                           |
| 0x02000450 |        68 | 2131, Pressure Plate          | about 2.258 × 2.258 m                                           |
| 0x020009AC |         1 | 8639, Shrine of Sodhi         | 1.00 × 2.924 m                                                  |
| 0x02000C75 |         1 | 15278, Wedding Pressure Plate | 0.90 × 0.90 m                                                   |
| 0x02000FA2 |         4 | 25573, Pile of Stones         | about 1.517 × 1.893 m                                           |

These extents are diagnostic vertex bounds, not a new production bounding algorithm.
All six setups have a default placement and nonzero horizontal geometry. The first
three have sphere collision primitives, the pile has a cylinder, and the shrine and
wedding setup have neither setup sphere nor cylinder. Do not infer exact activation
coverage from the visible rectangle or from the presence of a setup sphere alone.

Production already publishes rigid-pose bounds in
`DynamicEntitySystem.getPublishedRigidPresentationBounds`; use those with the same
resolved placement, as `GamePresentationRuntime.#dynamicEntityFrame` does. They
exclude particle expansion and track the presented pose. No additional physics
geometry contract or DAT query from the minimap is required. Clone borrowed bounds
only if retaining beyond their publication lifetime.

All 80 plates author ItemUseable=1 (No), consistent with `PressurePlate.ActOnUse`
doing nothing. Local minimap GUID selection remains feasible independently of use.
Many names are collision triggers rather than literal floor plates: Scene Trigger,
Spell Trap, Jester Checkpoint, disguised piles, and spawn generators. Use the actual
entity name in hover text. The recommendation is one region treatment for this
semantic type, with no promise that every region depicts a conventional floor plate.

### Switch classification: the simple type-only proposal misses real controls

Native Switch includes 193 templates, including fountains, wells, magic traps,
ore deposits, and other activatable scenery. Its usability distribution is 99 at
48, 92 at 1, and two at 32. Do not equate this class with a promise of direct use.

The name-candidate census additionally found 19 creature-authored controls:

- Buttons: 26534 and 26650–26656.
- Levers: 40779, 40782, 40785.
- Lever Box: 46573.
- Colored levers: 52071, 52072, 52074, 52075, 52076, 52088.
- Lever: 72259.

All 19 author NpcLooksLikeObject=true and ItemUseable=32. Source-database emotes
confirm these are scripted interactions: the eight buttons use Activate (15);
the three earlier levers branch through quest checks to Activate; Lever Box has
Give-triggered Activate; colored levers use quest/counter scripts; 72259 reaches
Activate through a GotoSet branch. ACE's `WorldObject_Use.cs:121` dispatches creature
use to the emote manager; `Creature.cs:334-336` confirms this path.

Counterexamples prevent a general name or property heuristic: Button Thrungus
28672 is an ordinary creature; Ned the Clever matches a naive substring; Broken
Lever items are CraftTool and Lever Handle is Generic. NpcLooksLikeObject applies
to **1,448 creatures**, including furniture and puzzle objects. Even Activate in an
emote does not uniquely mean a switch. This census identifies these 19 candidates;
it does not prove that all unnamed/disguised scripted controls have been enumerated.

**Recommended scope decision before Phase 2:** keep native Switch as the shared
activatable-scenery symbol, and include these 19 reviewed controls through explicit
content-owned WCID classifications, with source evidence. This classifies 212 switch
templates (120 eligible for normal-client delivery) without guessing from names
at runtime. Preserve creature
identity/behavior; only the map interaction classification changes. The alternative
is a deliberately native-type-only first release, with these known controls omitted.
Do not build a general emote interpreter just to choose a minimap symbol.

Native representative fixtures: Button 269, Lever 285/286, ordinary Door 278,
explicit unlocked Door 562, locked Door 564. Add the creature Button 26534 and
Lever 40779 to contract fixtures if the recommended coverage is accepted.

### Door lock knowledge and lifecycle

Source trace:

1. `WorldObject_Networking.cs:56-81` writes WCID, item type, description flags, and
   optional header fields during create. It does not send a general property-bool
   bucket or WeenieType. `Door.cs:39` supplies the DOOR description flag. A new
   live door starts with unknown lock state regardless of static default.
   `Player_Tracking.cs:62` sends that create during tracking; no initial Locked
   property update is appended by this tracking path.
2. `AppraiseInfo.cs:73,342-346` builds assessment property buckets; Locked is an
   AssessmentProperty. `WorldObject_Properties.cs:1754-1757` removes Locked when
   false and treats absence as false. A successful complete appraisal therefore
   establishes unlocked when Locked is omitted. `AppraiseInfo.cs:154-156` also
   explicitly emits false for an unlocked object with DefaultLocked present.
3. `Lock.cs:274-277` broadcasts false after key success; `Lock.cs:309-310` does the
   same for lockpicking. `Door.cs:211-224` broadcasts true on default-locked reset.
   Opening is not evidence of unlocking: `Door.cs:93` allows use from behind while
   locked. Never derive lock color from open pose, ethereal state, or animation.
4. `world/src/handlers/properties.rs:111` applies public bool updates and emits
   PropertiesUpdated. `core/src/client/mod.rs:879-888` already republishes the
   dynamic view. No motion or new refresh mechanism is needed.
5. Successful identify flows through `world/src/handlers/inventory.rs:190` and
   `world/src/identify.rs:25`; core republishes at `client/mod.rs:846-852`.
   **Current gap:** identify only merges properties. Normalize omitted Locked to
   explicit false for a successfully assessed door at entity ingestion; otherwise
   ordinary unlocked doors remain unknown and an older true can survive a complete
   appraisal. Failed assessment returns without merging and must remain unchanged.
6. Entity removal already publishes a dynamic removal with generation
   (`core/src/client/mod.rs:864`); classification/lock knowledge must leave with
   that entity instance. Static WCID metadata can remain in the immutable catalog.

Authored door combinations (absence shown as absent):

| Locked | DefaultLocked | Templates |
| ------ | ------------- | --------: |
| absent | absent        |       188 |
| false  | false         |         5 |
| true   | true          |       341 |
| true   | absent        |         3 |
| false  | absent        |         1 |
| absent | false         |         4 |

`Door.cs:58-64` promotes Locked=true to DefaultLocked=true, then sets initial
Locked from DefaultLocked. Thus 344 templates initially lock and 198 do not under
these constructor rules. Retain both raw optional catalog inputs and resolve once
in the Explorer producer. The three Locked-only cases are 28768, 31223, and 87684.
No live lock default may be imported from these static facts. No polling/appraisal
traffic is required by this feature; unknown remains until received evidence exists.

### Bounded architecture extension

- Add `holtburger-weenie-catalog` as a dependency of `holtburger-content`; keep the
  portable decoder there, not in core/world/frontend. Extract deterministic catalog
  path resolution/open/capability from the Explorer adapter into content. The host
  supplies the environment override; Explorer fuzzy search and inspector UX remain
  app-local. This is an extension of optional static content, not a SQL runtime.
- Build an immutable WCID classification index once when composing content, using
  exact decoded records. Keep all indexed WCIDs (or explicit unknown results) so
  a known ordinary template is distinct from an absent custom-server template.
  Include reviewed overrides only after the coverage decision above. Do not add
  an unbounded on-demand disk cache or per-frame lookups.
- Supply parsed static classification through the existing WorldBootstrap/static
  content assembly (`world/src/bootstrap.rs`, `host/src/shared_host_content.rs`).
  World/core consumes values and performs no path discovery. Resolve game identity
  separately from app marker treatment. Network DOOR evidence takes precedence;
  missing/mismatched WCID metadata must not invent a switch/plate or alter physics.
- A custom server can reuse a WCID with different semantics; static classification
  is a catalog assumption, not server authority. Keep the metadata capability
  visible, and do not claim the catalog proves custom-server behavior.
- Missing catalog should preserve connection, ordinary radar, and network-detected
  doors. Switch/plate metadata is explicitly unavailable. Invalid catalog is a
  reported content error, not silently treated as an empty catalog. Existing
  `host_status` routing can carry an added typed metadata capability; current
  `HostStatus` only has app_name/status, so this field still needs implementing.
- Add typed interaction/lock facts to the existing dynamic view, and optional rigid
  bounds to the presented map read. No new transport protocol, renderer pass,
  simulation loop, universal host adapter, or selection authority is necessary.

Phase 2 therefore includes a small content-access extraction, catalog format update,
explicit appraisal normalization, and contract extension. Geometry and update delivery require no broader architecture change. However,
most native plates never reach a normal client. Supporting those would require
a different source of instance positions or a server change, outside this plan.
Confirm that received-entity coverage is sufficient before proceeding with Phase 2;
do not describe this as a general plate-revealing minimap.
