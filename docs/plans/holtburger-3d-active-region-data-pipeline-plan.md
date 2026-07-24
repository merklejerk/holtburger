# Holtburger 3D Active Region Data Pipeline Plan

Status: In progress

## Goal and Boundaries

Expose the complete decoded static records of the active `RegionDesc` to the 3D frontend once,
then make both terrain presentation and Explorer-controlled regional environment presentation
resolve from that frontend-owned static data.

### In Scope

- Decode every proven `RegionDesc` field losslessly: complete `LandDefs`, `GameTime`, `SkyDesc`,
  sound, scene, optional terrain, region misc, and the raw `PartsMask`.
- Define a client-agnostic active-region static-data asset in `holtburger-content`.
- Make that asset an explicit 3D runtime bootstrap dependency, installed once independently of
  scene interest or terrain resolution.
- Add one narrow versioned Tauri host capability that returns the active region's decoded records
  and references. It has no region selector: the host repository remains the active content scope.
- Add a frontend active-region source/cache and typed conversion to the existing terrain
  composition/detail facts.
- Cut terrain source transport over to raw landblock facts only: height indices, terrain samples,
  and typed availability. Remove derived heights, topology constants, and all regional composition,
  detail, and region-number payloads from `HBTR`.
- Add Explorer-owned day, time-of-day, and sky-day-group controls plus a pure frontend resolver for
  regional lighting, fog, and sky state.
- Apply resolved distance fog to the current terrain program. Preserve the resolved lighting and
  sky state as renderer input even where no corresponding pass exists yet.
- Preserve a clean later path for a client runtime to provide the same selection inputs from
  authoritative server time and weather state.

### Out of Scope

- Active content-region switching, multi-region archive mounting, or a frontend region picker.
  Current content discovery selects one active repository; that remains sufficient for this slice.
- A client-mode authoritative clock, server-driven weather protocol, or player preference policy.
- Skybox/celestial-object geometry, weather particles, regional sound playback, and terrain or
  object lighting implementation. Their static data and resolved state are prepared here, but
  their render systems are separate work.
- Passing raw DAT bytes to TypeScript, exposing the Rust `RegionDesc` type as a public API, or
  duplicating archive discovery in the frontend.

## Terminology and Ownership

`RegionDesc` is a fixed DAT resource ID (`0x13000000`) decoded from the host's active content
scope. Its `region_number` is provenance from that record, not a frontend asset selector. The
current repository contains one active region, so no runtime can conflate two regional material
tables. Do not introduce a region selector or a speculative content-scope revision in this plan.

Use these terms consistently:

| Term | Meaning | Owner |
| --- | --- | --- |
| Active region data | Complete decoded static record set from the host's active `RegionDesc`. | `holtburger-content` / Tauri host |
| Active region source | Immutable runtime-scoped frontend cache and typed source port for that one static payload. | `apps/holtburger-3d` |
| Terrain source | Raw landblock height indices, terrain samples, and availability only. Heights and presentation derive from installed active-region/static world data. | Tauri host / frontend terrain pipeline |
| Explorer environment selection | Explicit Explorer UI choices for day index, time of day, and optional day-group override. | Explorer frontend |
| Resolved scene environment | Frontend-derived lighting, fog, and sky state ready for a render frame. | Explorer frontend |

`RegionDesc.id` must not be called a region identity in new contracts: it is the fixed DAT record
ID. The active region's number, name, and format version are provenance metadata only.

## Ground Truth and Existing Precedent

### Authoritative References

- `ACE/Source/ACE.DatLoader/FileTypes/RegionDesc.cs` defines the complete RegionDesc record
  order and optional `PartsMask` sections.
- `ACE/Source/ACE.DatLoader/Entity/GameTime.cs`, `SkyDesc.cs`, `DayGroup.cs`,
  `SkyTimeOfDay.cs`, `SkyObject.cs`, `SkyObjectReplace.cs`, `SoundDesc.cs`, `RegionMisc.cs`, and
  `LandDefs.cs` define the region records.
- `acclient-eor-source/acclient.c`:
  - `CRegionDesc::UnPack` proves terrain is conditional on `PartsMask & 0x04`; `0x08` consumes no
    record payload in the observed retail path.
  - `GameTime::UseTime`, `CalcDayBegin`, and `CalcTimeOfDay` define retail calendar conversion.
  - `SkyDesc::CalcPresentDayGroup` defines automatic day-group selection.
  - `DayGroup::GetTimeOfDay`, `SkyDesc::GetLighting`, `SkyDesc::GetWorldFog`, and
    `SkyDesc::GetSky` define interpolation and the fog-enable rule.
- `ACE/Source/ACE.Server/Network/NetworkSession.cs` and
  `crates/holtburger-core/src/client/runtime.rs` establish that future client mode already has a
  server-time synchronization source. It is evidence for the follow-on, not an implementation
  dependency for Explorer.

### Current Code to Preserve or Replace

- `crates/holtburger-dat/src/file_type/region.rs` currently drops most `LandDefs` scalars, skips
  game time, sky, sound, and misc sections, does not retain `PartsMask`, and treats terrain as
  unconditional. It is the decoding seam.
- `crates/holtburger-content/src/material_graph.rs` resolves terrain material and regional detail
  facts from the active RegionDesc. It is the precedent for client-agnostic static derivation.
- `crates/holtburger-core/src/content_assets.rs` exposes active-region provenance beside assembled
  scene assets, and supplies the app's content request service.
- `apps/holtburger-3d/src-tauri/src/lib.rs` currently builds `HBTR` by embedding regional terrain
  composition and landscape detail in every landblock response and serializing heights resolved
  through the regional height table. This is the duplicated boundary to delete.
- `apps/holtburger-3d/src/lib/assets/decode-terrain-source.ts` and
  `src/lib/game/terrain/types.ts` are the frontend source/contract seams.
- `apps/holtburger-3d/src/lib/game/renderer/renderer.ts` and
  `src/lib/game/renderer/webgl2-terrain-program.ts` are the frame-state and first fog consumer.
- `docs/plans/holtburger-3d-terrain-loading-pipeline-plan.md` records the implemented terrain
  source boundary that this plan replaces; retain it as history and update its status only after a
  completed cutover.

## North Stars

- The frontend receives typed, complete static records and references, never DAT bytes and never
  an app-specific Rust projection disguised as a shared content type.
- Active-region data is a bootstrap asset, not a terrain side effect. It is installed before
  interest-driven scene/terrain realization begins and may be consumed while no scene is loaded.
- Explorer owns presentation choices. It can scrub time and select a day group without host clock
  events, a session, or a fake weather authority.
- There is one frontend environment resolver for Explorer, not one resolver per renderer pass.
  Future client mode changes the selection producer, not the static-data or rendering contract.
- Terrain landblock requests carry only raw landblock data. The frontend resolves heights from
  `LandDefs.land_height_table`, derives fixed outdoor topology from shared world constants, and
  shares regional tables across every interested landblock.
- Current one-active-region behavior remains explicit and honest. Do not solve hypothetical
  multi-region mounting by adding a misleading `regionNumber` selector to frontend APIs.
- Static content data remains client-agnostic in Rust. Tauri transport, Explorer controls, and
  WebGL presentation policy remain app-local.
- Tests use synthetic region records and transport fixtures. No permanent test depends on local
  DAT/HBA assets.

## Target Flow and Shapes

```text
ContentRepository (active scope)
  └─ RegionDesc
      └─ ActiveRegionData asset ──► Tauri `load_active_region_data`
                                         │
                                         ▼
                     3D runtime bootstrap installs ActiveRegionSource
                                ├─ Explorer environment controller
                                ├─ terrain composition/detail facts
                                └─ future sky/object render passes

Tauri `load_terrain_source`
  └─ raw height indices + terrain samples ─► TerrainSystem
                                            └─ requires ActiveRegionSource to resolve heights
```

The wire payload should be versioned and self-validating, following the existing `HBTR`/`HBTP`
header plus JSON-manifest/binary-section precedent. Choose a distinct active-region transport
magic during implementation; do not overload `HBTR`. Scalar/reference records may remain in the
manifest, while the 256-entry `f32` land-height table should use a declared aligned binary section.

The Rust static asset and the frontend transport should represent all decoded RegionDesc sections
without loss of authored fields. An illustrative frontend view is:

```ts
interface ActiveRegionData {
  readonly provenance: { number: number; version: number; name: string; partsMask: number };
  readonly land: RegionLandDefinitions;
  readonly calendar: RegionCalendar;
  readonly sky: RegionSkyDescription | null;
  readonly terrain: RegionTerrainDescription | null;
  readonly scenes: RegionSceneDescription | null;
  readonly sound: RegionSoundDescription | null;
  readonly misc: RegionMiscDescription | null;
}
```

The actual types must be driven by complete DAT decoding, not invented from this illustrative
shape. `RegionLandDefinitions` retains all eight authored scalars plus the height table. The raw
`partsMask` remains provenance/diagnostics data, including known payload-free bits such as `0x08`;
it is not a frontend feature switch. Asset references remain typed DAT IDs; models, textures,
sound tables, and particle effects continue to load through their dedicated content paths.

Explorer state is intentionally app-local:

```ts
interface ExplorerEnvironmentSelection {
  readonly dayIndex: number;
  readonly timeOfDay: number; // normalized [0, 1)
  readonly dayGroupOverride: number | null;
}

interface ResolvedSceneEnvironment {
  readonly calendar: ResolvedCalendarTime;
  readonly dayGroup: ResolvedDayGroup;
  readonly lighting: ResolvedLighting;
  readonly distanceFog: ResolvedDistanceFog | null;
  readonly sky: ResolvedSkyState;
}
```

The frontend resolver must reproduce retail's deterministic calendar-derived automatic day-group
choice and cyclic keyframe interpolation exactly. It should treat day groups as static regional
sky variants; `chanceOfOccur` is retained authored data, not an automatic-selection weight. Do
not name or implement a live weather system without protocol evidence.

## Phased Implementation

### Evidence Baseline — Completed Separately

The separate, user-steered evidence review established these implementation constraints before
this plan begins:

- `RegionDesc` is fixed resource `0x13000000`. The active Dereth record is version 3, region 1,
  and has `PartsMask = 0x21F`.
- Retail consumes payloads for `0x01` sound, `0x02` scene, `0x04` terrain, `0x10` sky, and
  `0x200` region misc. It does not consume a payload for observed set bit `0x08`; retain the raw
  mask but do not invent a record for that bit.
- Terrain is optional under `PartsMask & 0x04`; an absent terrain record is not a decoder error.
- Dereth contains a complete game calendar, 20 sky day groups, sky-object replacement records,
  and 37 ambient sound tables. Sky fog is authored on every observed Dereth keyframe.
- Retail picks automatic day groups deterministically from calendar day/year rather than weighting
  `DayGroup.chance_of_occur`, and only returns fog when both cyclically bracketing keyframes enable
  it.
- `HBTR.heights` is derived from raw CellLandblock height indices and
  `LandDefs.land_height_table`. Keep this derivation inside Rust where canonical meshes/BVH/scenery
  need it, but remove it from the frontend transport and reproduce it in TypeScript.
- Outdoor topology is presently fixed at a 9×9 vertex grid with 24-unit spacing. It is shared
  world geometry, not a per-landblock transport fact.

The remaining payload-free `0x08` semantic meaning is deliberately deferred: retaining the raw
mask is sufficient until a real consumer gives that flag behavior. Do not block this plan on it.

### Phase 1 — Complete client-agnostic region decoding — Completed 2026-07-23

Deliverables:

- Expand `holtburger-dat::RegionDesc` and colocated record types to decode every proven region
  subsection losslessly, including complete `LandDefs`, the raw `PartsMask`, and optional terrain.
- Update `holtburger-content` cache/assemblers and affected synthetic fixtures for the completed
  RegionDesc shape.
- Add `ActiveRegionData` (or a better evidence-backed name) as a static content asset derived from
  the active descriptor; it must not depend on Tauri or TypeScript.

Acceptance criteria:

- Existing terrain/scenery resolution remains byte-for-byte equivalent for the active archive.
- An archive with no terrain payload produces an explicit absent terrain record rather than reading
  the next record at the wrong offset.
- Static environment data can be fetched once without requesting a landblock.
- All direct RegionDesc consumers use named decoded records rather than offset assumptions or
  duplicate parsing.

Checklist:

- [x] Add typed complete land definitions, calendar, sky, day-group, keyframe, sky-object, sound,
      scene, optional terrain, misc, and raw parts-mask records.
- [x] Preserve source IDs and authored colors/flags without frontend-specific reinterpretation.
- [x] Preserve known payload-free PartsMask bits as raw provenance; do not synthesize record types
      for them.
- [x] Add a content query that returns the active descriptor's complete static data without taking
      a region-number selector.
- [x] Remove misleading `region_id` identity terminology where it means fixed resource
      `0x13000000`; retain it only when explicitly describing the source record ID.

Decision checkpoint:

- Keep raw/static records in `holtburger-content`; do not place environment-selection or renderer
  policy there.

#### Implementation record

- `holtburger-dat` now decodes the proven RegionDesc layout through every payload-bearing
  `PartsMask` section and rejects unexpected trailing bytes. This made a core synthetic fixture
  fail immediately: it emitted an empty terrain record while declaring no terrain bit. The fixture
  now declares `0x04`, matching its bytes.
- `LandSurf` is represented as its authored tagged form: `TextureMerge` or `PaletteShift`. Current
  terrain-material consumers require `TextureMerge` and fail explicitly for `PaletteShift`; no
  fallback or reinterpretation was introduced. Frontend terrain projection must retain that same
  honest behavior until palette-shift terrain receives separate evidence and implementation.
- `ActiveRegionData` is a client-agnostic `holtburger-content` static asset, returned through the
  reusable core content-asset service without a region-number request parameter. It wraps the
  decoded active descriptor; no Tauri or frontend concerns leaked into content.
- Verification: `cargo test -p holtburger-content -p holtburger-core -p holtburger-dat` passed on
  2026-07-23 (303 unit tests plus 2 DAT integration fixtures). Decoder coverage uses synthetic
  region bytes only; the temporary archive inspection harness was removed and no test requires
  local HBA/DAT assets.

### Phase 2 — Add the active-region host/frontend boundary — Completed 2026-07-23

Deliverables:

- A narrow Tauri `load_active_region_data` command and versioned response decoder.
- `ActiveRegionSource` in `apps/holtburger-3d`, including a 3D-runtime startup/load lifecycle,
  a typed cached active value, and explicit teardown with that runtime.
- Frontend validation for every manifest field, binary section, source ID, finite scalar, list
  count, and transport version.

Acceptance criteria:

- The 3D runtime installs active-region data before it accepts interest-driven terrain
  realization; Explorer environment controls may consume it with no terrain interest requested.
- A malformed or mismatched response fails loudly before entering frontend state.
- No raw Rust type name, DAT byte buffer, or archive path appears in the frontend contract.

Checklist:

- [x] Reuse the existing binary transport framing helpers where doing so does not blur distinct
      response identities.
- [x] Define a frontend active-region identity as provenance only; it is not a region loader key.
- [x] Load, validate, and install active-region data as part of 3D runtime initialization; do not
      install it as a consequence of a terrain request.
- [x] Ensure runtime destruction clears the active-region cache and all derived regional
      resources together.
- [x] Add host projection and frontend decoder tests with synthetic region fixtures.

Decision checkpoint:

- Current active-region data is immutable for the lifetime of one Explorer runtime. If host-side
  scope switching is added later, introduce an explicit replacement event and full derived-resource
  teardown then; do not emulate it now with polling or a region-number parameter.

#### Implementation record

- Tauri now exposes only `load_active_region_data`, with no selector argument. It returns a
  versioned `HBAR` response: complete semantic static records in a JSON manifest and the fixed
  256-entry `LandDefs.land_height_table` as an aligned `f32` binary section. `HBAR` is deliberately
  distinct from landblock `HBTR`; shared framing does not mean shared response identity.
- The app-local host projection retains all decoded sections, including nullable absent sections
  and both tagged `LandSurf` variants. DAT references are serialized as canonical hexadecimal IDs
  under semantic fields; the frontend never receives DAT bytes or a Rust record name.
- `TauriActiveRegionSource` validates the whole transport shape with a schema, memoizes the one
  immutable result, and clears that cache during Explorer teardown. Explorer awaits this bootstrap
  before it creates the terrain commit pipeline, so terrain realization cannot race the regional
  facts. The source is not yet consumed by terrain; that deliberate handoff is Phase 3.
- Verification: synthetic host projection test, synthetic frontend binary-decoder tests,
  `cargo test -p holtburger-3d`, strict `cargo clippy -p holtburger-3d --all-targets -- -D
  warnings`, and the 3D app's `check`, TypeScript test, and formatting scripts passed on
  2026-07-23. No GUI app or local content archive was launched/required.

### Phase 3 — Cut terrain over to active-region data — Completed 2026-07-23

Deliverables:

- Remove `regionNumber`, `TerrainCompositionManifest`, regional material tables, alpha-map IDs,
  landscape-detail IDs, resolved `heights`, `gridSize`, and `tileSize` from `HBTR`.
- Make `LandblockTerrainSource` contain raw landblock height indices, terrain samples, and typed
  availability only.
- Build resolved heights, `TerrainCompositionFacts`, texture requirements, and composition-texture
  keys in the frontend from `ActiveRegionSource`, fixed outdoor-world constants, and the raw
  landblock source.
- Delete now-redundant terrain-manifest validation/projection code and migrate focused tests.

Acceptance criteria:

- Loading two outdoor landblocks uses one active-region payload and does not repeat regional
  material metadata or height-table-derived floats per response.
- Existing terrain geometry, pcode composition, textures, detail overlay, and LOD behavior remain
  unchanged for the active region.
- A terrain request fails clearly when active-region data has not been installed rather than
  inventing composition facts.
- A terrain request fails clearly when the installed active region has no terrain payload.

Checklist:

- [x] Make terrain commits require the ActiveRegionSource installed by runtime bootstrap; a
      terrain fetch must never load or replace regional data as a side effect.
- [x] Resolve all 81 canonical terrain heights from raw height indices and the installed
      `LandDefs.land_height_table`; validate the table and indices before realization.
- [x] Derive the canonical 9×9/24-unit outdoor topology from shared world geometry rather than a
      terrain response manifest.
- [x] Port the current terrain interpretation rules into a pure frontend resolver: road material
      selection from terrain type `0x20`, and ordered landscape/building/environment/object detail
      roles from the terrain-description table.
- [x] Replace terrain's regional cache-key decoration with identities derived from the installed
      active-region source, retaining current one-region semantics.
- [x] Update the Tauri terrain-host tests and `decode-terrain-source` fixtures to the reduced
      contract.
- [x] Remove the repeated regional payload rather than supporting both old and new `HBTR` versions
      indefinitely.

Decision checkpoint:

- The frontend owns the terrain-material and height projection because it owns renderer-facing
  static data. Rust continues to decode canonical records, derive internal canonical meshes/BVH as
  needed, and serve texture pixels; it must not recreate a terrain-specific presentation manifest
  elsewhere.

#### Implementation record

- `HBTR` now has exactly two binary sections for an available landblock: raw `heightIndices` and
  raw `terrainSamples`. It no longer contains regional provenance, composition/material/detail
  records, derived heights, grid size, or tile size. There is no compatibility version left behind.
- `active-region-terrain-resolver.ts` is the single frontend projection point. It derives all 81
  height values through the installed `LandDefs` table, uses the shared outdoor 9×9/24-unit
  constants from `landblocks.ts`, rejects absent terrain and unsupported palette-shift terrain
  explicitly, and converts tagged `TextureMerge` records into renderer composition facts.
- Detail roles are retained in authored terrain-description order (`landscape`, `building`,
  `environment`, `object`); the existing composition lookup keeps terrain type `0x20` as the road
  material selection with its established fallback. Renderer texture-array and composition keys
  now use the installed active-region record/version provenance, not `regionNumber`.
- Both Tauri and the headless HTTP harness bootstrap active-region data before constructing their
  terrain source. The old generic Rust material/profile queries remain for the independent legacy
  app and diagnostics, but the new 3D host no longer calls or serializes either. They are not a
  second `HBTR` contract.
- Verification: synthetic host transport tests, 111 TypeScript tests (including raw-index height,
  ordered-detail-role, and road-descriptor coverage), app type checks/formatting, strict 3D Rust
  clippy, and `git diff --check` passed on 2026-07-23. No app instance or real archive was used.

### Phase 4 — Explorer regional environment selection and resolution — Completed 2026-07-23

Deliverables:

- An Explorer-local environment controller/store with explicit day index, normalized time-of-day,
  and optional day-group override.
- A pure TypeScript resolver from `ActiveRegionData` and Explorer selection to
  `ResolvedSceneEnvironment`.
- Unit tests proving retail-compatible calendar-derived automatic day-group selection, cyclic
  keyframe wrapping, both-keyframe fog enable behavior, and interpolation using synthetic region
  data.
- A compact Explorer UI section for regional time/day-group controls; it must not grow a second
  manual camera-control panel.

Acceptance criteria:

- Changing Explorer controls updates the resolved state without any host clock/event dependency.
- `auto` day-group selection is deterministic for a given calendar year/day and region profile;
  it does not reinterpret `chanceOfOccur` as a weight.
- The frontend consumes no generic RegionDesc parser or raw archive asset.

Checklist:

- [x] Keep UI control policy and labels in the Explorer app; do not move them into shared crates.
- [x] Expose sky-day-group names only as static metadata from active-region data.
- [x] Model a missing sky section explicitly as an unavailable environment profile, not a default
      fake daylight/fog configuration.
- [x] Retain resolved sky data even before a sky pass exists.

Decision checkpoint:

- Future client mode supplies an `EnvironmentSelection` from its authoritative runtime and reuses
  this frontend resolver. It does not require a Rust fog/sky resolver or host-pushed resolved
  presentation state.

#### Implementation record

- `scene-environment.ts` is a pure frontend resolver over installed active-region data. Explorer
  supplies absolute day, normalized time, and an optional explicit day-group index; no host clock
  or weather event is involved. Automatic selection uses the retail unsigned day/year hash, never
  `chanceOfOccur`.
- The resolver performs cyclic keyframe bracketing and retains a background/sky color alongside
  optional fog. It returns no fog unless both bracketing `worldFog` flags are enabled.
- Explorer's compact World panel exposes day, time, and Auto/named sky-group controls only after
  static sky data has loaded. Missing sky remains an unavailable profile (black background, no
  fabricated daylight), not a silent default region.

### Phase 5 — Consume resolved environment state in the renderer — Completed 2026-07-23

Deliverables:

- Add resolved environment state to the frontend runtime/frame input.
- Establish a common view-environment binding contract rather than adding terrain-only global
  policy fields.
- Apply eased distance fog to terrain after terrain composition and detail blending, using
  horizontal camera distance in the terrain plane.
- Where the current renderer has no sky pass, clear the display surface to the resolved distance
  fog color when fog is active; otherwise clear to the resolved sky/background color. Terrain fog
  and the clear color must consume the same resolved environment input.

Acceptance criteria:

- Explorer fog changes visibly and continuously as its selected time/day-group changes.
- Fully fogged terrain converges into the display-surface clear color without a horizon seam while
  no sky pass exists.
- Fog derives its effective range from frontend-owned terrain interest without changing scene
  interest, residency, terrain LOD choice, or asset retention.
- Terrain detail fade remains an independent material rule and keeps its retail 10–50 forward-depth
  behavior.
- The renderer can hand the same resolved lighting/sky values to future static/object/sky passes
  without a new region query API.

#### Implementation record

- `GameRuntime` accepts frontend-resolved environment state independently of residency and scene
  interest, then supplies it to every `FrameInput`. This preserves the intended future host-client
  swap: only the selection producer changes.
- Terrain fog applies after terrain composition and detail. The WebGL frame clear uses that exact
  fog color while fog is active, otherwise the resolved regional background color, preventing the
  terrain horizon from fading into a stale fixed clear color.
- Verification: synthetic cyclic-fog resolver tests, app type checks, 113 TypeScript tests,
  terrain shader compile validation, formatter, strict 3D clippy, and diff whitespace checks
  passed on 2026-07-23. Visual review remains user-owned; no GUI app was launched.

#### Follow-on implementation record — 2026-07-24

- Retail keeps `LScape::mid_radius` and authored region fog ranges independent. Explorer instead
  deliberately derives the effective fog range from its retained terrain window so increasing
  terrain distance does not load terrain behind an unchanged fog wall.
- `terrain-fog.ts` retains the region-authored fog color and near/far ratio, but maps its far edge
  to the nearest X/Z edge of the configured terrain window around the current camera. It ignores
  world-up and fully fogs the view at or beyond that window edge.
- The terrain shader now uses the same horizontal radial distance for fog. Retail-compatible
  terrain-detail fade remains independently camera-forward-depth based.
- The fog blend uses a cubic smoothstep-equivalent curve instead of a linear ramp, retaining the
  same safe endpoints while reducing visible haze across the near portion of the terrain window.
- Verification: 118 TypeScript tests, app type checks, terrain shader compilation, Prettier, and
  diff whitespace checks passed on 2026-07-24. Visual review remains user-owned; no GUI app was
  launched.

Checklist:

- [x] Keep fog state optional and require both regional bracketing keyframes to enable it.
- [x] Place fog after final terrain material composition; do not fog individual texture samples.
- [x] Bind the same resolved fog color to the display-surface clear operation and terrain program;
      use resolved sky/background color only when fog is unavailable.
- [x] Add shader compile validation and CPU resolver tests; visual comparison remains user-owned.
- [x] Do not create permanent image tests based on local retail assets.

### Phase 6 — Re-steer and clean up — Completed 2026-07-23

Deliverables:

- A consumer audit of all `regionNumber`, `region_id`, `RegionRenderProfile`, terrain composition,
  and `HBTR` uses.
- Removal of dead terrain host fields, duplicate regional projections, obsolete test fixtures, and
  misleading documentation.
- An updated implementation record in this plan and in the older terrain-loading plan that points
  to the completed cutover.

Acceptance criteria:

- There is one active-region frontend source and one terrain landblock source; no compatibility
  branch supports the duplicated regional `HBTR` payload.
- All regional presentation reads originate from installed active-region data.
- The app check, focused Rust tests, TypeScript tests, shader validation, and strict relevant
  clippy/lint checks pass, apart from documented pre-existing unrelated failures.

Checklist:

- [ ] Dry-run the remaining future sky/weather work against the new state contract.
- [ ] Decide whether the next slice is sky rendering, terrain lighting, or static-object material
      realization based on the now-visible Explorer evidence.
- [ ] Record any proven host/client time-selection transport requirement as a new focused plan,
      not an append-only expansion of this one.

#### Implementation record and remaining debt

- Audit found no `regionNumber`, `TerrainCompositionManifest`, or `RegionRenderProfile` consumer
  in the new 3D app or its Tauri host. There is one active-region source per Explorer runtime and
  one raw terrain source boundary; no old `HBTR` branch remains.
- The historical terrain-loading plan now explicitly labels its former `HBTR` metadata/height
  contract as superseded. The generic Rust material/profile helpers remain only for the independent
  legacy app and diagnostics; removing them is a legacy-app migration, not a hidden requirement of
  this new frontend cutover.
- Sky geometry, weather, regional sound playback, terrain lighting, and static-object material
  realization remain separate slices. The frame contract now retains sky selection and ambient
  lighting facts, so the next slice can be chosen from Explorer evidence without a new region API.
- No host/client authoritative time transport is proven or added. Explorer controls remain the
  selection producer; client mode can later replace that producer with server time.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| ACE and retail differ or leave fields undocumented. | Treat ACE as binary-layout ground truth and retail as behavior ground truth; preserve unresolved proven records rather than guessing semantics. |
| “Complete RegionDesc” turns into raw bytes or a TypeScript mirror of Rust internals. | Use typed, versioned DTO records with semantic field names; preserve fields, but do not expose decoder implementation or binary framing. |
| Terrain cutover regresses rendering because the active region is not ready or frontend height resolution differs. | Make active-region installation an explicit prerequisite; compare synthetic index-to-height and terrain-composition projections before realization. |
| A sky/fog plan accidentally becomes a weather implementation. | Keep dynamic weather and protocol work out of scope; model day groups only as static regional variants. |
| Region number is mistaken for a runtime region selector. | Expose no selector in the host command and document active content scope as the owner. |
| Real-asset tests become permanent. | Keep asset inspection in the debug harness; retain only synthetic unit/integration fixtures. |
| Future client authority requires a different data shape. | Keep `EnvironmentSelection` separate from static region data and resolved renderer state; only the selection producer changes. |

## Definition of Done

- [ ] The active RegionDesc is fully decoded into typed static records with no silent skipped
      sections, including its raw PartsMask and optional terrain payload.
- [ ] Explorer loads one validated `ActiveRegionData` payload from the active host repository.
- [ ] Terrain `HBTR` responses contain only raw landblock height indices, terrain samples, and
      availability; terrain still renders identically from active-region data plus shared topology.
- [ ] Explorer can select day/time/day-group and observe resolved regional fog state in terrain
      rendering.
- [ ] Resolved lighting and sky state have stable frame-input contracts even if their visual passes
      remain deferred.
- [ ] No frontend API selects a region or reads raw DAT bytes.
- [ ] Synthetic tests cover decoder alignment/mask handling, transport validation, frontend
      index-to-height and terrain-composition projection, terrain dependency ordering, automatic
      day-group selection, cyclic keyframe interpolation, and fog enable/interpolation.
- [ ] Relevant Rust checks/clippy, frontend tests/type-check, shader validation, and formatting
      checks pass; no app instances are launched for automated verification.

## Open Questions

- Which exact retail rules govern applying regional fog and sky state to interior and portal views?
  Keep `SceneEnvironmentContext` narrow until evidence answers this.
- Does the active archive contain sky-object assets that the current model/texture pipeline can
  already resolve, or does sky rendering need missing material capabilities first?
