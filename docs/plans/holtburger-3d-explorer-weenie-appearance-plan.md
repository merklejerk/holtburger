# Holtburger 3D Explorer Weenie Appearance Plan

Status: Draft
Created: 2026-08-17
Parent: follow-on to `holtburger-3d-explorer-weenie-dynamic-runtime-plan.md` (complete 2026-08-17)

## Context and Boundaries

### Goal

Explorer-spawned NPCs render with their authored appearance facts, CharGen-derived faces, and
their worn clothing and armor, so the shared appearance pipeline is proven end to end before a
server ever feeds it.

### Why

Explorer spawns of humanoid NPCs (e.g. WCIDs 3921/3922, the Trophy Collectors) currently render as
the bare base setup: same face, same skin, underwear. Investigation against the live ACE World
database (2026-08-17) established the mechanism:

- The wire/client appearance pipeline is already landed and lossless: `ModelData` decode →
  `EntityAppearance` → `material_appearance_input` → visual source → frontend feed. A server
  sending a resolved ObjDesc renders correctly today.
- ACE servers *assemble* that ObjDesc before sending. For every non-player creature,
  `Creature.SetEphemeralValues` calls `GenerateNewFace()` (`Creature.cs:95,148`), which resolves
  heritage/gender, then fills every face property the weenie does not explicitly set by rolling
  CharGen tables. Equipment is merged separately via `create_list` and the CLO system.
- Of 9,329 creature weenies, 2,016 are generation-eligible (parseable heritage and gender). Within
  those: 1,859 are fully randomized, 143 fully authored (skin+hair+eyes), 14 partly authored.
  ~299 weenies carry explicit face DIDs; ~12 carry raw ObjDesc palette/texture/animpart rows.
- Our catalog exports none of the face inputs: DID filter is `(1,2,3,6,22)`, string filter is
  name-only, int filter is `PhysicsState`-only.

The user-selected scope (2026-08-17): resolve authored appearance facts exactly; fill the
remaining features from CharGen with a deterministic roll; and render worn clothing/armor from the
weenie's wielded `create_list` items through CLO resolution. We deliberately do not match ACE's
nondeterministic roll. Evidence pass (2026-08-17) verified all six Collector CLO tables decode
from the local HBA with human-male coverage and 28 palette templates each, and that
`ContentRepository` already loads `CharGen`. Key discovery reducing the cost: `holtburger-dat`
already ships
`ClothingTable::build_obj_desc(setup, palette_template, shade, palette_set_resolver)` — the CLO
core exists; the remaining work is the wield export, per-item fact lookup, and the layer-priority
merge. 2,888 weenies carry 10,946 `Wield`/`WieldTreasure` entries.

### In Scope

- Catalog format v2 carrying the appearance-relevant template facts ACE's resolver consumes,
  including wielded `create_list` entries and the per-item facts the visual merge needs.
- One app-local, pure, deterministic appearance resolver: explicit weenie facts win per property;
  CharGen fills the gaps; output is the existing `EntityAppearance`.
- Worn clothing/armor: resolve each wielded item's `ClothingBase` through the landed
  `ClothingTable::build_obj_desc` against the wearer's setup, and merge in ACE's layer-priority
  order on top of the base model data.
- Explorer spawn/replacement integration and browser-harness visual proof.
- Recorded divergences from ACE where the user has chosen them.

### Out of Scope

- Held weapons and shields as visible objects. A wielded weapon is not ObjDesc data: ACE renders
  it as a separate child physics object parented to an attach point. That is the
  animated-attachment/parenting mechanism the dynamic-runtime plan explicitly deferred, and it
  arrives with that feature, not with appearance. Clothing paints the wearer's model; weapons are
  their own entities.
- The `ObjDescEvent` (0xF625) live-update handler. Client-path work, tracked as known debt from the
  2026-08-17 investigation; it does not gate Explorer realization.
- Player character creation/barber flows, `AlternateSetup` body-style switching, and the
  Gearknight/Olthoi "hairstyle as body style" special cases (`WorldObject_Networking.cs:986-1005`).
- Any frontend or renderer change. The resolver feeds the landed pipeline unchanged.
- Matching ACE's `ThreadSafeRandom` behavior or seeding.

## Ground Truth

| Question | Source |
| --- | --- |
| Face generation algorithm, property precedence, fill order | `ACE/Source/ACE.Server/WorldObjects/Creature.cs:148-262` (`GenerateNewFace`) |
| Heritage/gender resolution incl. apostrophe strip and int-over-string | `Creature.cs:152-161`; `ACE/Source/ACE.Entity/Enum/HeritageGroup.cs` |
| ObjDesc assembly order and palette offsets (skin 0x0/0x18, hair 0x18/0x8, eyes 0x20/0x8) | `ACE/Source/ACE.Server/WorldObjects/WorldObject_Networking.cs:906-1040` (`AddBaseModelData`) |
| PaletteSet-by-hue selection | ACE `PaletteSet.GetPaletteID`; our `holtburger-dat` `PaletteSet` (`material.rs:29`) |
| CharGen shapes (strips carry complete ObjDescs, incl. bald variants) | `crates/holtburger-dat/src/file_type/char_gen.rs` (landed decode) |
| Property type numbers | `PropertyDataId.cs` (6,7,9-18), `PropertyInt.cs` (113,188), string types 3/4 |
| Live-DB distributions cited above | `ace_world` via `ace-root` compose (2026-08-17 queries) |
| Equipment selection, armor/clothing split, layer sort | `ACE/Source/ACE.Server/WorldObjects/Creature_Networking.cs:35-180` |
| Visual priority from CLO part coverage | `ACE/Source/ACE.DatLoader/FileTypes/ClothingTable.cs:50-110` (`GetVisualPriority`) |
| CLO resolution core (landed) | `crates/holtburger-dat/src/file_type/material.rs:350+` (`ClothingTable`, `build_obj_desc`) |
| Wield population | `weenie_properties_create_list` destination types 2 (`Wield`, 10,103 rows) and 10 (`WieldTreasure`, 843 rows) across 2,888 weenies |
| Existing appearance pipeline | `crates/holtburger-world/src/entity_appearance.rs`, `crates/holtburger-core/src/dynamic_entity.rs::material_appearance_input`, `apps/holtburger-3d/src-tauri/src/dynamic_entity_visual_source.rs`, driver `appearance()` |
| Catalog format contract | `docs/ace_world_weenie_catalog.md`, `crates/holtburger-weenie-catalog` |

## North Stars

1. The resolver is a pure function of (template facts, CharGen, seed). Same inputs, same face,
   every run — reproducibility is a feature, not a concession.
2. Explicit authored data always wins per property, mirroring ACE's `HasValue` guards. Generation
   fills; it never overwrites.
3. This is ACE-server emulation, not client behavior: a real client only ever consumes the
   resolved ObjDesc from the wire. The resolver is therefore producer policy owned by the Explorer
   composition in `src-tauri`, beside the driver that already projects template facts. Only format
   semantics over DAT types (palette-set-by-hue, CLO coverage priority) belong in `holtburger-dat`,
   following the `build_obj_desc` precedent. The shared surface is the existing `EntityAppearance`
   value — contract shared, policy app-local.
4. Lossless catalog, lossy nowhere: v2 exports raw template facts; interpretation happens at
   realization, exactly like the physics-state precedent.
5. Divergences from ACE are deliberate, few, and written down. No silent drift.
6. No appearance state is retained anywhere new — the resolved `EntityAppearance` flows through
   the existing definition/registry/feed contracts untouched.

## Phased Implementation

### Phase 1: Catalog v2 With Appearance Facts

Progress: Pending.

#### Deliverables

- Extend `WeenieTemplate` with the appearance template facts: optional DIDs `clothing_base` (7),
  `eyes_texture` (9), `nose_texture` (10), `mouth_texture` (11), `default_eyes_texture` (12),
  `default_nose_texture` (13), `default_mouth_texture` (14), `hair_palette` (15), `eyes_palette`
  (16), `skin_palette` (17), `head_object` (18); optional ints `gender` (113) and
  `heritage_group` (188); optional strings `sex` (3) and `heritage_group_name` (4).
  `clothing_base` and the three `default_*` types are zero-populated or equipment-facing today but
  cost nothing and complete the ACE-consumer surface; record that choice.
- Bump the codec to format version 2: header version, record fields in the documented canonical
  order, decode limits for the two new strings. Version 1 remains rejected-with-reason, not
  migrated — the only artifact is a local regenerable file.
- Export wielded equipment: `weenie_properties_create_list` rows with destination types
  `Wield` (2) and `WieldTreasure` (10), as ordered `{ wcid, palette_template, shade,
  destination_type }` entries on the wearer template, preserving source row order (probability
  groups are positional). Other destination types (Contain, Shop, Treasure) stay out — they are
  inventory/loot, not appearance.
- The `shade` column is overloaded at the source: on a `Treasure`-flagged destination it is a
  selection probability, not a CLO shade (`CreateListSelect`,
  `Creature_Equipment.cs:636-680`; `WorldObjectFactory.cs:409-414`). The catalog stores the raw
  row losslessly with its destination type; interpretation stays in the resolver. Palette and
  shade columns are NOT NULL at the source, and ACE treats `0` as unset (`Palette > 0` guard,
  shade applied only when non-treasure), so no absence encoding is needed.
- Export the two item-side facts the visual merge consumes: optional ints `clothing_priority`
  (type 4, 2,090 rows) and `valid_locations` (type 9, 20,788 rows). `item_type` (1) is already
  derivable from the exported `weenie_type`; `TopLayerPriority` (bool 123) and
  `CurrentWieldedLocation` (int 10) have zero world-DB rows — both are runtime state, so the
  catalog does not carry them.
- Update `docs/ace_world_weenie_catalog.md` for every new byte, and extend the synthetic fixtures:
  absence vs explicit zero for each new field, string bounds, round-trip determinism.
- Regenerate `dats/weenies.hwc` from the running compose database and revalidate provenance.
- Extend `survey-weenie-catalog` with the appearance census (counts per new field, eligibility
  split) so the recorded 2026-08-17 distributions become reproducible tool output instead of chat
  history.

#### Acceptance Criteria

- Byte-identical re-export; v1 file rejected with a distinct unsupported-version error.
- Survey reproduces the recorded distributions: 299 explicit-face weenies, 2,016 eligible,
  143/14/1,859 fixed/partial/random split, zero rows for DID types 12-14.
- MySQL remains confined to the exporter feature; catalog crate dependency graph unchanged.

#### Decisions and Course Corrections

- Populate during execution.

### Phase 2: Deterministic Appearance Resolver

Progress: Pending.

#### Deliverables

- A pure resolver in a new app-local `weenie_appearance` module in
  `apps/holtburger-3d/src-tauri`, beside the driver that owns the sibling raw-ObjDesc projection,
  consuming template facts + `CharGen` + `PaletteSet` lookups (via `ContentRepository`) + a `u64`
  seed, producing the shared `EntityAppearance`. No new symbol enters `holtburger-core`,
  `holtburger-world`, or `holtburger-content`.
- Two format-semantics helpers land in `holtburger-dat` beside `build_obj_desc`, as pure functions
  over its own decoded types: `PaletteSet` selection by hue fraction (ACE `GetPaletteID`) and
  coverage-derived visual priority over a `ClothingTable` (`GetVisualPriority`).
- Heritage/gender resolution: int properties win; else parse the strings case-insensitively with
  apostrophes stripped (`"Gharu'ndim"` → `Gharundim`), against a fixed name table mirroring
  `HeritageGroup`/`Gender`. Unresolvable heritage/gender is not an error: the weenie is simply
  ineligible and keeps its explicit facts only (matches ACE's early return).
- Per-property fill mirroring `GenerateNewFace` + `AddBaseModelData`:
  hairstyle roll selects the `HairStyle` entry (its ObjDesc carries head/hair texture and part
  changes; honor `bald` for eye strips); hair color/hue → `hair_color_list` PaletteSet by hue →
  sub-palette 0x18/0x8; skin hue → `skin_palette_set` by hue → 0x0/0x18; eye color →
  `eye_color_list` → 0x20/0x8; eye/nose/mouth strips contribute their complete authored
  ObjDescs. Explicit template DIDs suppress the corresponding fill exactly where ACE's
  `HasValue` guards do.
- Deterministic seeding: a small splitmix-style generator seeded by the caller. Explorer seeds
  from the spawn GUID. Document as deliberate ACE divergence #1.
- Explicit template `palette_base` wins over the heritage `base_palette` (ACE unconditionally
  stomps it). Deliberate divergence #2, benefiting the 299 authored weenies.
- ACE's retail hairstyle-range clamp (`npc_hairstyle_fullrange` off ⇒ indices 0-8): adopt the
  retail-compiled clamp as our fixed behavior.
- Focused tests: fixed-vs-random precedence per property, bald eye-strip selection, palette-set
  hue indexing boundaries, determinism (same seed ⇒ same appearance; different GUIDs ⇒ different),
  ineligible weenie passthrough, and a WCID 189-shaped fixture proving authored skin/hair/eyes
  survive while nose/mouth/head fill from CharGen.

#### Acceptance Criteria

- Resolver is side-effect-free and clock-free; all tests use synthetic CharGen/PaletteSet fixtures,
  no real DAT dependency.
- Composition order matches `AddBaseModelData` (verifiable by comparing sub-palette/texture
  ordering against an ACE-derived expectation fixture).
- No new retained state, cache, or registry anywhere.

#### Decisions and Course Corrections

- Populate during execution.

### Phase 3: Worn Equipment Merge

Progress: Pending.

#### Deliverables

- Extend the app-local resolver (or a sibling pure function composed with it) to accept the
  wearer's wield list plus a per-item fact lookup, and produce the merged `EntityAppearance`:
  for each wielded item, resolve its template's `clothing_base` through the landed
  `ClothingTable::build_obj_desc(wearer_setup, palette_template, shade, palette_set_resolver)`;
  skip items whose CLO table has no entry for the wearer's setup, exactly as ACE does.
- Wield-location semantics: NPCs wield at the item's full `ValidLocations`
  (`Monster_Inventory.cs:323-345`, `TryWieldObject(item, item.ValidLocations)`), so the
  armor-versus-clothing partition (`ItemType == Armor || ValidLocations & (Armor|Extremity)`)
  is a pure function of exported template facts. Verified against the Collector items: boots
  (0x180) partition as armor via FootWear; shirt/tunic/pants (0x1E/0xE/0xC4/0x44) partition as
  clothing.
- Port the ordering rules from `Creature_Networking.CalculateObjDesc`: clothing sorted by
  `ClothingPriority` first, then armor sorted by the coverage-derived visual priority. Implement
  `GetVisualPriority` as a pure function over our decoded `ClothingTable` part coverage
  (`ClothingTable.cs:50-110`). `TopLayerPriority` has zero world-DB rows, so every template item
  sorts in the no-preference bucket; implement the three-bucket rule anyway (it is three lines)
  so a future biota/server source cannot silently mis-sort.
- `WieldTreasure` probability groups: rows accumulate shade-as-probability in source order and
  one row per 0-1 chunk is selected. Resolve with the same GUID-seeded generator as the face
  roll, so treasure-wield outfits are per-spawn stable.
- Merge order overall: base model data (face fill) first, then equipment in sorted order, matching
  ACE. Later sub-palettes/texture changes append; the existing pipeline already applies them in
  sequence.
- The item-template lookup is by catalog point query at spawn preparation; a missing wielded item
  WCID or a malformed CLO reference is a typed, loud preparation error naming wearer, item, and
  resource.
- Focused tests with synthetic CLO fixtures: setup-gated skip, palette-template fallback to the
  first defined effect (ACE behavior when the requested template is absent), shade-to-palette-set
  indexing, and a two-item layering fixture proving sort order changes the outcome.

#### Acceptance Criteria

- A Collector-shaped fixture (base body + shirt + pants + boots with palettes and shades) produces
  the expected merged appearance deterministically.
- Items whose CLO lacks the wearer's setup vanish visually without failing the spawn (matching
  ACE), while genuinely broken references fail loudly.
- No CLO, clothing, or equipment state is retained outside spawn preparation.

#### Decisions and Course Corrections

- Populate during execution.

### Phase 4: Explorer Integration and Visual Proof

Progress: Pending.

#### Deliverables

- The Explorer driver resolves appearance during spawn/replacement preparation: raw ObjDesc rows
  from the template (existing `appearance()` path) merged with resolver output, explicit facts
  winning. `ContentRepository::read_asset` parses on every call, so the driver retains the
  immutable decoded `CharGen` beside its existing content handle rather than re-parsing per spawn.
  That is retained immutable content, not appearance state; per-spawn appearance remains derived.
- Replacement re-resolves with the successor's GUID seed; despawn/respawn of the same GUID yields
  the same face.
- Browser-harness proof (screenshots; reproducible because the roll is GUID-seeded): 3921 and
  3922 spawn visibly distinct — different faces AND their authored outfits (shirt/breeches/boots
  vs tunic/pants/boots with their palette templates and shades); WCID 189 shows its authored
  skin/hair/eye palettes under its equipment; one non-humanoid (147 Crate) and one raw ObjDesc
  weenie render unchanged.
- If CharGen or a referenced PaletteSet is absent from mounted content, spawning that eligible
  WCID fails loudly with a typed reason — no silent bare-setup fallback for eligible weenies.

#### Acceptance Criteria

- The three harness scenarios above pass with zero browser errors; teardown counts return to
  baseline (existing lifecycle checks unchanged).
- Client-path contracts are untouched: no frontend, feed-schema, or protocol change in the diff.

#### Decisions and Course Corrections

- Populate during execution.

### Phase 5: Cleanup, Docs, and Gates

Progress: Pending.

#### Deliverables

- Sweep temporary probes and any vocabulary drift; update `holtburger-weenie-catalog`
  ARCHITECTURE and the runtime survey doc with the appearance census and both recorded
  divergences.
- Collapse the pre-existing duplicate appearance projection found during this plan's ownership
  audit: `dynamic_entity_visual_source.rs::material_appearance` (app) duplicates the exported
  `holtburger-core::material_appearance_input`, whose only consumer is core's own test. The visual
  source adopts the core function and the app-local copy is deleted — one projection, one owner.
- Record the deferred debt explicitly: held weapons/shields await the parenting/animated-
  attachment feature; `ObjDescEvent` handler remains client-path debt.
- Full gate battery: fmt, clippy `-D warnings`, workspace tests, frontend checks, harness
  scenarios.

#### Acceptance Criteria

- All gates pass; plan records final evidence; no dormant scaffolding for the weapons feature.

#### Decisions and Course Corrections

- Populate during execution.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| CharGen decode gaps vs ACE's reader (landed decode was player-creation-driven) | `ContentRepository` already reads `CharGen` (`repository.rs:1117-1130`); Phase 2 fixture derived from a real heritage/gender entry; WCID 189 comparison in Phase 4 |
| Overloaded create_list `shade` misread as CLO shade on treasure rows | Catalog stores raw rows with destination type; resolver owns the split; probe-verified semantics cited in Phase 1 |
| Palette offset unit confusion (DB stores /8 units, DAT stores raw) | Single conversion at the existing `appearance()` boundary; resolver emits raw units like the rest of `EntityAppearance`; ordering fixture catches double-scaling |
| Divergences read as bugs later | Both are named in this plan, the survey doc, and resolver comments |
| Catalog v2 breaks the byte-portability guarantees | Same fixture discipline as v1: canonical order, absence-vs-zero, round-trip determinism |
| Layer sort diverges from ACE (wrong garment on top) | Priority is pure over decoded CLO coverage; two-item layering fixture plus WCID 3921/3922 visual comparison |
| Scope bleed into held-weapon rendering | Out-of-scope names the parenting mechanism as the boundary; Phase 5 forbids dormant scaffolding |
| A second composition later wants catalog-backed appearance | Promotion out of `src-tauri` only when proven, per the app boundary rules; the shared `EntityAppearance` contract already insulates consumers |

## Definition of Done

- [ ] Catalog v2 exports every listed appearance fact losslessly; survey reproduces the recorded
      distributions; v1 is rejected distinctly.
- [ ] One pure, deterministic, tested app-local resolver fills unauthored features from CharGen
      while explicit facts win per property, in ACE's composition order; the only shared-crate
      additions are the two `holtburger-dat` format helpers.
- [ ] Wielded clothing/armor resolves through the landed CLO core and merges in ACE's layer
      order; setup-gated items skip silently, broken references fail loudly.
- [ ] Explorer spawns prove it in the browser: distinct, stable, fully dressed Collectors,
      authored WCID 189, unchanged non-humanoids.
- [ ] Both ACE divergences (GUID-seeded roll; explicit PaletteBase wins) are recorded in code and
      docs.
- [ ] No frontend, feed, protocol, or client-path change; no equipment scaffolding.
- [ ] All gates pass.

## Open Questions

None blocking. The seed source (spawn GUID) and both divergences were user-approved 2026-08-17.
