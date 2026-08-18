# Holtburger 3D Explorer Held Item Attachments Plan

Status: Complete 2026-08-18 — implementation verified; four unrelated socket tests require an
unsandboxed runner
Created: 2026-08-18
Parent: follow-on to `holtburger-3d-explorer-weenie-appearance-plan.md` (complete 2026-08-17);
resumes the seam left by `holtburger-object-attachment-parity-plan.md` Phase 5 (2026-07-30)

## Context and Boundaries

### Goal

Explorer-spawned NPCs render their wielded weapons, shields, and held items as separate child
objects attached to the correct hand, positioned by the shared attachment mechanism a live server
will drive through the same types.

### Why

The weenie appearance plan (complete 2026-08-17) paints worn clothing and armor into the wearer's
own setup via the CLO system. Held items are a different mechanism entirely: retail renders a
wielded weapon as a separate `CPhysicsObj` child attached to a parent part plus a holding-location
frame (`CPhysicsObj::add_child(obj, part_index, frame)`, `acclient.c:305226`), posed by its own
placement frame (`CSequence::set_placement_frame`, `acclient.c:326272`). The appearance plan
explicitly scoped this out; the `worn_bucket` partition already excludes held slots from painting,
so armed NPCs currently spawn empty-handed.

An earlier plan (`holtburger-object-attachment-parity-plan.md`) built much of the substrate and
stopped at a seam it could not cross: no world-to-frontend entity feed existed. That feed now
exists (the dynamic entity feed, landed 2026-08-17), but the intervening dynamic-runtime rewrite
deleted the caller-side attachment machinery while keeping the scene-graph primitives. The
2026-08-18 archaeology pass established exactly what survives:

- **Alive and tested:** `SceneGraph.attachToPart(nodeId, parentNodeId, localTransform)` and
  `detachToPlacement(nodeId, placement)` (`scene-graph.ts:200,224`), with parent-chain transform
  inheritance through `#resolvePlacement`. `holdingLocations` decode through
  `decode-static-source-record.ts` into `presentation.ts:216` `ResolvedAttachPoint` — currently
  with zero consumers. Every rigid part of a dynamic entity is already its own scene node parented
  to the entity's visual root (`dynamic-entity-system.ts:1048`).
- **Deleted by the rewrite:** `DynamicEntitySystem.attachEntity`, the entity system's
  part-node/holding-location lookup, and the attachment-carrying `world` arm of the resident
  identity union (`landblock-layer.ts:20` is authored-only today). The old plan's Phase 5
  decisions are design reference, not living code.
- **Still open from the old plan:** the host ships exactly one placement pose.
  `select_setup_default_frames` (`object_resource_closure.rs:572`) resolves `0x65 → 0` in Rust and
  ships the result under one key, so a `Placement` request cannot change an attached item's pose.
- **Feed contract today:** one entity view is one setup, one appearance, one world pose
  (`dynamic-entity-feed.ts`). No child concept exists anywhere in the pipeline.

The catalog already carries the selection inputs: `WieldEntry` rows with wcid, destination,
palette template, and shade; templates with `setup_did`, `clothing_base_did`, `item_type`, and
`valid_locations`; and `select_wielded` already rolls the spawn's loadout, weapons included. The
single missing fact is `PropertyInt::DefaultCombatStyle`, which ACE consults to decide which hand
a missile weapon rides in.

### Evidence Pass (2026-08-18)

Censuses run against live `ace_world` (decimal literals throughout; hex literals coerce as binary
strings) and the local HBA archive, joining wield rows to item facts and setups:

- **Scale.** 2,340 held-slot wield rows across 609 distinct items and 1,321 distinct wearers.
  By slot: MeleeWeapon 1,306, MissileWeapon 381, Shield 266, TwoHanded 259, Held 76,
  MissileAmmo 52 (excluded by the mapping).
- **`ItemType` absence on held slots: zero.** Every held-slot item carries PropertyInt 1; the
  Shield split's input always exists. The risk entry is resolved, not mitigated.
- **`DefaultCombatStyle` (PropertyInt 46, not 353 as an earlier draft said) absence on
  MissileWeapon: zero.** All 381 rows carry it: Bow 115, Thrown 236, Crossbow 23, Atlatl 7.
  Absences elsewhere (222 of 266 Shield rows) are irrelevant — the mapping consults it only for
  MissileWeapon.
- **Holding locations: 2,280 of 2,288 (wearer, required location) pairs satisfied.** The 8
  failures are three degenerate wearers — WCIDs 47072, 48266, 48285, all *arrows* carrying wield
  lists (ACE data quirks, not creatures). Every genuine creature setup authors the attach points
  its items need. A loud per-entity error will fire only on data errors.
- **Retail's missing-location behavior, cited.** `CPhysicsObj::add_child` returns 0 when
  `CSetup::GetHoldingLocation` finds no entry (`acclient.c:305203`): the attach silently fails
  and the child is simply not parented. The explorer surfaces this loudly as diagnostics policy
  (it indicates broken data); a connected client consuming server state should mirror retail's
  refusal-without-crash.
- **Placement frames: the key-0 fallback is load-bearing, not an edge case.** Of 321 held-item
  setups: `Default` 321, `RightHandCombat` 245, `LeftHand` 241, `RightHandNonCombat` 203,
  `LeftWeapon` 28, `Shield` 1. Nearly every shield resolves its pose through the fallback;
  missing placement keys are normal content, never an error.
- **Per-branch live examples for Phase 5:** melee wearer 400 (item 301), shield wearer 975
  (item 91), bow wearer 185 (item 306), thrown wearer 1 (item 141), held-caster wearer 5763
  (item 2366).

### In Scope

- Catalog format v4 adding `PropertyInt::DefaultCombatStyle` to item templates.
- Shared attachment semantics in `holtburger-world`: the wield-slot to
  `(ParentLocation, Placement)` mapping mirroring ACE `GetPlacementLocation`, unified with the
  existing clothing/armor partition into one three-way classification.
- A shared entity attachment contract: a child entity placed by
  `parent GUID + ParentLocation + Placement` instead of a world pose.
- Explorer-side held-child emission: each held wield row becomes a child entity carrying the
  item's own setup and its own CLO-painted appearance, lifecycle-coupled to the wearer.
- Feed and frontend plumbing: the attachment placement variant through the Tauri boundary, host
  serialization of all placement frames keyed by `Placement`, and re-established caller-side
  attach in the current dynamic entity system using the surviving scene-graph primitives.
- Browser-harness visual proof against a known armed NPC.

### Out of Scope

- Motion tables, combat stances, and stance-driven placement switching. Attached items follow
  whatever pose the parent's parts are in; when motion tables land, attachment inherits them
  through the scene graph with no further work.
- Stowed placement (`Belt`, `Quiver`, back-slot sheathing). Same mechanism, different enum
  values; a natural fast-follow once the held path is proven.
- Missile ammo rendering (retail excludes `MissileAmmo` from the children list).
- Weapon particle effects and physics scripts on children beyond what the existing entity
  pipeline already grants a spawned object.
- Live-server wield/unwield routing. The contract is shaped for it; the producer here is the
  explorer driver only.

## Ground Truth

- `ACE/Source/ACE.Server/WorldObjects/Creature_Equipment.cs:496` `TrySetChild` and `:515`
  `GetPlacementLocation` — the authoritative slot mapping, including the Shield `ItemType` split
  and the `DefaultCombatStyle` bow/crossbow left-hand split.
- `acclient-eor-source/acclient.c:305226` `CPhysicsObj::add_child(obj, part_index, frame)` and
  `:6271` `set_parent` — attachment is parent-part-relative with an offset frame.
- `acclient.c:326272` `CSequence::set_placement_frame` — the child poses its own parts from its
  setup's placement frame, falling back to key `0`.
- `crates/holtburger-common/src/attachment.rs:37,90` — `ParentLocation` and `Placement` are
  already shared primitives.
- `crates/holtburger-dat/src/file_type/setup_model.rs:493` — `holding_locations` and
  `placement_frames` are already parsed.
- `docs/plans/holtburger-object-attachment-parity-plan.md` Phase 5 — prior art for the
  caller-side lookup design, the pose fallback rule, and parent-teardown semantics.
- Existing precedent for a catalog version bump: the v3 `ItemType` addition
  (`crates/holtburger-weenie-catalog`, commit `d2c4be35`).

## North Stars

1. The attachment contract is what a live server will feed; the explorer driver is just its first
   producer. Judge every type against that future, not against the explorer's convenience.
2. Attachment is a scene-graph relationship established at spawn/equip, not per-frame math. The
   graph already inherits transforms; do not add a parallel path.
3. One three-way partition owns worn-versus-held classification. No consumer re-derives slot
   semantics.
4. Retail's rules are ported with citations, not approximated. Where ACE and retail disagree, the
   divergence is marked per the repository convention.
5. Children are ordinary entities everywhere except placement. Resist special-casing them in
   rendering, residency, or appearance paths.
6. Illegal attachment states are unrepresentable, not rejected: motion facts live inside the
   world placement arm, and untyped input is narrowed exactly once at each boundary.

## Phased Implementation

### Phase 1: Catalog v4 — DefaultCombatStyle

#### Deliverables

- `crates/holtburger-weenie-catalog`: `default_combat_style: Option<i32>` on the template
  (`PropertyInt::DefaultCombatStyle`, 46 per `PropertyInt.cs:76`), codec support, fixture
  coverage, `CATALOG_FORMAT_VERSION = 4`.
- `apps/holtburger-tools/src/weenie_catalog_export.rs`: export property 46.
- Regenerated local `dats/weenies.hwc` (local artifact; the file is gitignored and every checkout
  re-exports).

#### Acceptance Criteria

- Round-trip test proves `default_combat_style` survives encode/decode with absence preserved.
- A live-export spot check shows a bow, a thrown weapon, and a melee weapon carrying the expected
  ACE values.

#### Task Checklist

- [x] Model, codec, version bump, fixtures.
- [x] Exporter property dispatch and query.
- [x] Re-export and spot-check against `ace_world`.

#### Decisions and Course Corrections

- `DefaultCombatStyle` is a raw item appearance/classification fact alongside `ItemType` and
  `ValidLocations`, so it lives in `TemplateAppearance` rather than on the top-level template.
  The codec appends the optional signed value to that composite and rejects v3 files via the clean
  v4 cutover; there is no compatibility reader.
- The live exporter regenerated all 43,913 templates from `ace_world` into the ignored
  `dats/weenies.hwc`. A temporary decoder probe (deleted immediately afterward) read melee WCID
  301 as `2`, bow WCID 306 as `16`, and thrown WCID 141 as `128`, byte-for-byte matching direct SQL.
- Verification: all 19 `holtburger-weenie-catalog` tests, all 34 `holtburger-tools` library tests,
  the exporter binary test, targeted all-target clippy with warnings denied, and rustfmt pass.
- Debt: `docs/ace_world_weenie_catalog.md` still describes the original v1 payload despite the
  pre-existing v2/v3 additions. Phase 6 already owns architecture-doc reconciliation; update it
  once the attachment contract settles rather than partially documenting only v4 now.

### Phase 2: Shared Attachment Semantics in `holtburger-world`

#### Deliverables

- One three-way classification owning worn-versus-held semantics, colocated with
  `entity_appearance.rs`: an item's slot facts (`valid_locations`, `item_type`,
  `default_combat_style`) resolve to `Painted(Clothing | Armor)`, `Held(ParentLocation,
  Placement)`, or neither. Ports `GetPlacementLocation` exactly: MeleeWeapon/Held/TwoHanded to
  `RightHand + RightHandCombat`; Shield split on `ItemType::Armor`; MissileWeapon split on
  bow/crossbow versus thrown; `MissileAmmo` excluded.
- The existing clothing/armor partition (`worn_bucket` and its EquipMask/ItemType constants in
  `apps/holtburger-3d/src-tauri/src/weenie_appearance.rs`) moves into this classification; the
  app-local copy is deleted in the same change.
- The entity attachment contract: entity placement becomes a two-arm enum — `World`, carrying
  every motion promise (pose, velocity, acceleration, omega, contact, sample mode), or
  `Attached`, carrying `parent GUID + ParentLocation + Placement` and nothing else. The motion
  facts live *inside* the world arm, never beside the enum: a pair of optionals would encode
  states the domain forbids (an attached child with a velocity), while the enum makes them
  unrepresentable. Path/advance events carry the world arm's motion type directly, so advancing
  an attached child is unwritable rather than rejected.

#### Acceptance Criteria

- Every mapping branch has a test with real catalog values, and each test is falsified (inverting
  the branch fails it).
- `weenie_appearance.rs` no longer defines EquipMask or ItemType constants.
- The wearer's painted appearance is byte-identical before and after the partition move.

#### Task Checklist

- [x] Port the mapping with `Creature_Equipment.cs` citations per branch.
- [x] Move and unify the paint partition; delete the app-local constants.
- [x] Define the placement two-arm contract on the world entity model.
- [x] Per-branch falsified tests; identity check on the painted output.

#### Decisions and Course Corrections

- `holtburger-world::classify_wielded_item` is the sole three-way owner. It consumes a composite
  `WieldedItemSlotFacts` and returns painted clothing/armor, a typed held placement, or no visual
  classification. The app-local `ItemType`/`EquipMask` constants and `worn_bucket` are deleted.
- Classification now happens before CLO lookup. This is both simpler and more honest: a held item
  carrying a `ClothingBase` never loads a clothing table or asks whether it covers the wearer's
  setup. Previously that dead work happened before `worn_bucket` discarded the item.
- Shield and missile properties fail only on the branch that consumes them. A melee or held caster
  with absent `ItemType`/`DefaultCombatStyle` still classifies; a shield without `ItemType` or a
  missile weapon without `DefaultCombatStyle` fails with one distinct error.
- Per-branch tests use live catalog tuples: melee 359, held caster 8904, two-handed 52631, armor
  shield 93, non-armor shield 52636, bow 306, thrown weapon 320, missile ammo 300, and WCID 33614's
  worn plate/shirt/sollerets. The shield, missile, and painted forks explicitly prove that
  inverting the deciding input changes the result.
- `EntityPlacement<W>` is the shared mutually exclusive contract. `World(W)` owns the complete
  motion payload for that layer; `Attached(PhysicsAttachment)` owns only parent GUID, location, and
  child pose. It is generic because creation, solver projection, and feed projection carry
  different world-motion composites, but all forbid motion facts on the attached arm.
- Existing host appearance tests remained green unchanged, including exact part/texture ordering
  for clothing and armor; the new Royal Guard sword test additionally proves held items cannot
  enter CLO. Verification: 383 world tests, 171 host tests, rustfmt, and all-target clippy with
  warnings denied.
- Concession: Holtburger's existing shared `EquipMask` calls ACE's `Held` bit `CASTER`. The
  classifier cites that vocabulary mismatch at its only use. Renaming the long-standing protocol
  primitive and every gameplay/UI consumer is unrelated churn; Phase 6 should decide whether the
  broader repository wants that clean cutover.

### Phase 3: Explorer Held-Child Emission

#### Deliverables

- `apps/holtburger-3d/src-tauri` driver/runtime: for each wield row classified `Held`, spawn a
  child entity carrying the item's own `setup_did` and its own appearance — the item's
  `ClothingBase` applied to the item's own setup with the wield row's palette template and shade,
  through the existing CLO pipeline.
- Child GUID allocation in the explorer runtime; children are pose-only, non-physical,
  path-less.
- Lifecycle coupling: despawn, replace, and reset of the wearer despawn its children; a child is
  never orphaned or leaked across replaces.
- Explorer commands that assume a world pose (relocate, launch, replace-physics-state) narrow the
  wire GUID to the placement enum exactly once at the command boundary: resolution yields either
  the world arm or a typed rejection naming the wearer. Everything downstream of resolution takes
  the world arm's types, so operating on an attached child is inexpressible internally — the
  runtime check exists only where untyped input enters.

#### Acceptance Criteria

- A dev-host probe of a known armed NPC (e.g. WCID 33614) lists its held children with correct
  setups, appearances, and `(ParentLocation, Placement)`.
- Despawning the wearer removes the children in the same feed generation.
- An item whose wcid is missing from the catalog fails loudly, consistent with the existing
  unresolvable-wielded-item error path.

#### Task Checklist

- [x] Held-branch resolution joining wield rows to item templates.
- [x] Child GUID allocation and lifecycle coupling in runtime/simulation.
- [x] Driver tests: emission, lifecycle, and the missing-template error path.

#### Decisions and Course Corrections

- Wield selection joins every selected row to its item template once and stores the resulting
  `WieldedItemClassification` in the consumer contract. Wearer CLO merge and held-child emission
  consume that value; neither can re-derive slot semantics.
- Held children are ordinary `DynamicEntityDefinition`s with `EntityPlacement::Attached`, their
  own setup/scalars/appearance, and no host body. Publishing a fake pose-only body would have
  violated the placement invariant and created a second transform authority.
- Spawn, replace, despawn, and reset mutate a wearer plus its complete child set under one registry
  lock. Rare group lifecycle mutations publish a complete snapshot event, placing every member in
  one ordered feed generation; ordinary world-only physics/advance changes retain focused events.
- Physics planning originally reached host-body state before narrowing placement. The implementation
  corrected that gap: plan/apply physics, launch, relocate, and independent despawn reject an
  attached GUID immediately with a typed error naming its wearer.
- The real dev-host specimen is WCID 42945 Royal Guard, not the stale WCID 33614 example. It emits
  shield WCID 42717 at `Shield + Shield` and sword WCID 24611 at
  `RightHand + RightHandCombat`. WCID 33614 remains the painted-outfit specimen and emits no held
  child for its deterministic spawn.
- Verification: 173 host Rust tests, including item-owned CLO, group lifecycle, reset, typed
  command rejection, and the pre-existing missing-template failure.

### Phase 4: Feed and Frontend Attachment Install

#### Deliverables

- Feed schema: the entity view's `placement` becomes a zod discriminated union mirroring the
  Phase 2 enum, so malformed host payloads fail at decode and TypeScript narrowing forces every
  frontend consumer to answer the attached arm, exactly as `match` does in Rust. Consumers match
  both arms exhaustively — no default branches. Precedent: the scene graph's own node union
  (`parentId: null` versus parented) and the parity plan's identity union, which carried
  attachment only in the arm where it is legal.
- Host placement frames: `object_resource_closure.rs` serializes all placement frames keyed by
  `Placement`, replacing the single-pose `select_setup_default_frames` resolution; the frontend
  applies the requested key with retail's fall-through to key `0`
  (`CPartArray::SetPlacementFrame`). This closes the gap recorded by the parity plan.
- Caller-side attach in the current `DynamicEntitySystem`: resolve the parent's
  `ResolvedAttachPoint` by `ParentLocation` to a part node and holding frame, then
  `SceneGraph.attachToPart` the child's visual root. Re-establishes the deleted `attachEntity`
  behavior against today's system, following the parity plan's Phase 5 decisions (caller-side
  lookup, unrepresentable-wrong-parent, teardown detaches children).
- Deferred attach: a child arriving before its parent's parts are staged attaches when the parent
  completes visual preparation; a parent arriving after its child is not an error.
- Attachment composes against the part node's rigid pose only. The child's scale comes from its
  own `objectScale`; the parent part's geometry scale must not leak into the child
  (`composeObjectPartTransform` already separates the two — the attach path must preserve that
  separation).

#### Acceptance Criteria

- An attached entity's world transform equals the parent part's rigid pose composed with the
  holding frame, verified against a hand-computed transform in a unit test.
- Placement key selection is load-bearing: requesting a non-default `Placement` changes the
  child's part poses in a test.
- Parent despawn detaches and removes children without scene-graph invariant violations.
- Out-of-order arrival (child first, parent first) both converge to an attached render.

#### Task Checklist

- [x] Feed schema, decode, and runtime routing for the placement two-arm.
- [x] Serialize all placement frames; frontend key selection with the retail fallback.
- [x] Attach/detach install path over `attachToPart`/`detachToPlacement`.
- [x] Deferred attach and teardown ordering.
- [x] Rigid-pose composition test; placement-key load-bearing test; lifecycle tests.

#### Decisions and Course Corrections

- The Rust and Zod feed use the same strict discriminated union. The attached arm accepts only
  `parent`, `parentLocation`, and `placement`; mixed world-motion fields are rejected, and advance
  events explicitly reject attached entities.
- Setup projection replaced per-part `defaultPlacement` with every authored placement-frame list,
  stably ordered by numeric `Placement`. Decode rejects duplicate keys and incomplete frame lists.
  `poseFor` requests the child key and falls through to key 0 exactly as retail does.
- `DynamicEntitySystem.attachEntity` owns caller-side holding-location lookup. It selects the
  child's own pose, resolves the parent part, and hands only that rigid node plus holding transform
  to `SceneGraph.attachToPart`; object and part scale stay on the child's own part nodes.
- Game-runtime reconciliation realizes world parents before children, defers a child whose parent
  is absent, and retries it on the next current-state reconciliation. Removal and shutdown recurse
  through attached descendants first so leaf-only scene teardown remains valid.
- The hand-computed composition test is intentionally falsifiable: wearer root 10 + animated hand
  part 3 + holding frame 2 + requested child pose 4 = 19. Falling back to the key-0 child pose
  would yield 16. Parent-first, child-first, lifecycle, strict-schema, and placement-map tests all
  pass.
- Concession: group spawn/despawn uses full snapshot publication instead of a multi-delta batch.
  These are rare Explorer mutations, and the snapshot already supplies the required atomic
  current-state boundary without adding a second event grammar.

### Phase 5: Visual Proof and Steering

#### Deliverables

- Browser-harness capture: spawn a known armed NPC and prove held geometry renders at the hand
  (pixel-diff against an empty-handed control, measured against same-build capture noise as the
  appearance plan established).
- A sweep of armed NPCs (melee, shield, bow, caster) spot-checked for hand assignment parity with
  ACE's mapping.
- Reassess remaining debt and decide whether stowed placement (`Belt`/`Quiver`) is worth an
  immediate follow-on phase or a separate plan.

#### Acceptance Criteria

- WCID 33614 (or an equivalent armed NPC) renders its weapon in the correct hand in a harness
  capture.
- A bow-wielding NPC holds the bow in the left hand; a shield rides the shield location.

#### Task Checklist

- [x] Harness scenario and captures.
- [x] Cross-check hand assignment for each mapping branch with at least one live WCID.
- [x] Steering notes: debt, follow-ons, and any divergence markers required.

#### Decisions and Course Corrections

- The production browser harness spawned WCID 42945 through the real catalog/content host and
  realized three visible entities with 109 visible parts. Its shield and sword are visibly carried
  at their authored locations. Exact despawn returned entity, template, effect, emitter, and visual
  resource counts to zero.
- A harness-only `--exclude-spawned-attachments` workload-isolation switch supplies the honest
  empty-handed control without changing host state. With particle seed 7, 16.6666667 ms frame
  steps, and capture frame 120, two parent-only controls differed by 0 pixels. Enabling the two
  attached children changed 2,749 pixels at normalized RMSE 0.00704499.
- Hand assignment is covered with live catalog tuples across the mapping: melee 359 and held caster
  8904 use right hand/combat; armor shield 93 uses shield/shield; non-armor shield 52636 uses left
  weapon/right-hand-noncombat; bow 306 uses left hand; thrown 320 uses right hand; missile ammo 300
  is excluded. The Royal Guard feed additionally proves shield and melee branches end to end.
- The Explorer's loud missing-holding-location policy is now marked `RETAIL DIVERGENCE` at the
  throw, citing `acclient.c:305203`, the consequence of silence, and the 8-of-2,288 census.
- Stowed belt/quiver presentation remains a separate follow-on. Nothing in the current Explorer
  producer emits stowed state, so adding policy now would be speculative rather than reuse of the
  proven mechanism.

### Phase 6: Cleanup

#### Task Checklist

- [x] Sweep vocabulary: no surviving symbol implies held items are painted, and the ACE-derived
      worn/held classification has one owner in `holtburger-world`.
- [x] Remove temporary probes and diagnostic output. Keep only the deterministic harness workload
      switch that provides a reusable parent-only A/B control.
- [x] Update `holtburger-world` and `holtburger-core` architecture docs, the catalog format doc,
      and the predecessor parity plan's resolved one-pose limitation.
- [x] Run formatting, lint, type checks, frontend tests, Rust clippy, and every Rust workspace test
      that the restricted runner can execute.

#### Decisions and Course Corrections

- Removed the obsolete per-entity `removed` delivery helper after group snapshots became the
  atomic lifecycle contract. No compatibility arm remains.
- Retained `--exclude-spawned-attachments` as a small, deterministic visual-isolation primitive;
  screenshots and ad-hoc probe output remain under `/tmp` and are not repository artifacts.
- Did not rename the existing `EquipMask::CASTER` vocabulary. It is the shared protocol property
  primitive, not an app-local held-item classification, and renaming every unrelated consumer would
  be noisy scope expansion. The Phase 2 classifier owns the semantic interpretation.
- Verification is green for `cargo clippy --workspace --all-targets -- -D warnings`, all workspace
  tests excluding `holtburger-scripting` and `holtburger-session`, 1,110 frontend tests,
  `svelte-check`, all TypeScript compiler configurations, ESLint, knip, Prettier, and
  `git diff --check`. The full Rust command additionally reached four pre-existing tests that bind
  loopback sockets; this runner denied those binds with `Operation not permitted`. An unsandboxed
  retry was unavailable because the approval service reported its usage-credit limit. The failures
  are environmental and outside the changed code paths, but the literal full-suite checkbox below
  remains open until an unrestricted runner executes them.

## Risks and Mitigations

- **Parent-part scale leaking into children.** The known dragon: attaching under a draw transform
  would scale the sword by the hand. Mitigation: Phase 4 pins composition to the rigid pose with
  a hand-computed unit test, cross-checked against `CPhysicsObj::add_child`.
- **Out-of-order arrival between parent and child.** Visual preparation is async; both orders
  must converge. Mitigation: explicit deferred-attach state with tests for both orders.
- **Setups missing the requested holding location or placement frame.** Sized by the 2026-08-18
  evidence pass: 8 of 2,288 pairs lack a holding location, all on three arrow weenies carrying
  wield lists — genuine creatures are fully covered, so the loud per-entity error fires only on
  data errors (retail silently fails the attach instead, `acclient.c:305203`). Missing placement
  keys are normal (`Shield` exists on 1 of 321 item setups); the key-`0` fallback is the routine
  path, never an error.
- **`ItemType` absent on some wielded rows.** Resolved by the evidence pass: zero held-slot items
  lack it, and zero MissileWeapon items lack `DefaultCombatStyle`. No absence rule is needed;
  absence in future data fails loudly at classification.
- **Feed contract churn.** The placement two-arm invalidates a bundle of per-entity promises —
  pose, velocity, acceleration, omega, contact, sample mode, and advance paths — for attached
  children, across every consumer: `explorer_entity_simulation` integration and the
  relocate/launch/replace-physics commands (Rust), the feed schema and both hosts (Tauri and the
  harness HTTP host), `dynamic-entity-placement-system` and `game-runtime` residency routing
  (which computes residency from the pose; a child's residency is instead inherited through the
  scene graph), and the explorer entity panels. The dangerous failure mode is quiet: a missed
  consumer treats a child as an entity with a default pose rather than erroring. Mitigation: a
  discriminated union with no transitional dual-shape, so Rust `match` and TS narrowing force
  every consumer to answer the attached arm at compile time; the schema, decode, runtime, and
  tests land in one phase.

## Definition of Done

- [ ] Workspace clippy clean; full Rust suite and frontend suites pass; svelte-check and knip
      clean.
- [x] All mapping branches tested with real catalog values and falsified.
- [x] Armed NPC harness capture shows held items in the correct hands.
- [x] Wearer painting is byte-identical to the pre-plan output for unarmed NPCs.
- [x] No app-local slot-semantics constants remain outside `holtburger-world`.
- [x] Plan updated with decisions, concessions, and debt per phase.

## Open Questions

- Placement key for non-combat idle: retail NPCs hold weapons in `RightHandCombat` placement per
  ACE's mapping even outside combat stance. Accept ACE's rule as-is unless harness captures look
  wrong against retail screenshots.
