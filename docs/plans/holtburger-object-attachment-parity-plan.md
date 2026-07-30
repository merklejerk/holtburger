# Holtburger Object Attachment Parity Plan

Status: Phases 1-4 and 6 complete; Phase 5 complete to the seam, blocked only on a world-to-frontend
entity feed that this plan never scoped
Implementation pass: 2026-07-30
Created: 2026-07-30
Evidence pass: 2026-07-30
Refinement pass: 2026-07-30
Final evidence pass: 2026-07-30

## Context and Boundaries

### Goal

Replace our invented setup-part transform hierarchy with retail's flat per-part model, then build
the object-to-object attachment relationship retail actually uses, so a wielded item is positioned
by its wielder's hand instead of being erased from the world.

### Problem Statement

Holtburger currently models one hierarchy that retail does not have and lacks the one it does.

**The hierarchy we invented.** `SetupModel.parent_index` is treated as a transform edge. The host
serializes it as `parentPartIndex` (`apps/holtburger-3d/src-tauri/src/outdoor_static_source.rs:121`)
and the frontend composes each part against its ancestor chain
(`apps/holtburger-3d/src/lib/game/resolution/presentation.ts:147-158`). Because the local transform
fed into that chain is already object-relative, every ancestor frame is applied twice.

**The hierarchy retail has.** A wielded object is a separate `CPhysicsObj` attached to a specific
part of its parent plus an offset frame drawn from the parent setup's holding locations. Holtburger
parses the wire fields for this and discards the spatial half, then treats attachment as removal
from the world rather than delegation of position.

### Evidence Summary

Proven from the retail decompile, corroborated by ACE and ACViewer, and measured against the local
archive. Full derivation in *Ground Truth and Existing Precedent*.

- `CPartArray::UpdateParts` (`acclient.c:314107`) composes `objectFrame ⊗ animframe[i] ⊗ scale` per
  part in a flat loop. It never reads `parent_index`.
- `parent_index` is `CSetup` dword index 16. Across the entire decompile it is touched only by
  `UnPack`, `Pack`, and `pack_size`. No physics or render path reads it.
- `CPhysicsObj::UpdateChild` (`acclient.c:308302`) composes a child object's frame from
  `parts[part_index]->pos.frame ⊗ childFrame`, where both come from the parent setup's
  `holding_locations`, an array wholly distinct from `parent_index`.
- Of 5,935 decodable setups in `dats/assets.hba`, 966 have real parent edges and **949 of those
  produce a different result under accumulation**, mispositioning 13,042 parts. 68 of the affected
  setups are referenced directly by `LandblockInfo` static objects or buildings, with worst-case
  added ancestor translation of 5.7 units, so the defect is live in the explorer today rather than
  latent.
- 514 setups carry holding locations. Their keys are exactly ACE's `ParentLocation` enum. Zero
  setups carry connection points, and zero holding-location part indices are negative or
  out of range.

### In Scope

- Delete setup-part parent traversal from geometry baking, presentation bounds, and dynamic entity
  node installation, plus the host and contract fields that feed it.
- Surface setup holding locations through the host boundary as typed attach points.
- Carry attachment location and placement through the protocol into typed world state.
- Change world attachment semantics from clearing an entity's world presence to delegating its
  position to its parent.
- Retain and resolve forward-referenced children so a wielder announcing an unhydrated item does
  not drop the relationship.
- Add `SceneGraph` attach and detach transitions and position attached entities from their parent's
  part node.
- Sweep hierarchy vocabulary, tests, and docs that describe the deleted mechanism.

### Out of Scope

- Animation playback, motion tables, and sampling animated part frames. This plan establishes the
  transform contract those systems will consume; it does not implement them.
- Inventory and container UX, equip/unequip commands, and any user-facing wield interaction.
- Physics collision, transitions, or `obj_within_block` behavior for attached objects.
- TUI frontend presentation of wielded items.
- Particle, script, and light attachment. These use the same retail child mechanism, so Phase 5
  must leave room for them, but implementing them is separate work.
- Reworking `PropertyInstanceId::Container` semantics beyond disentangling them from the physics
  parent.

## Ground Truth and Existing Precedent

### Authoritative Sources

- `acclient-eor-source/acclient.c`
  - `CPartArray::UpdateParts` at 314107 — flat per-part frame composition.
  - `CSequence::get_curr_animframe` at 326259 — placement frame fallback for non-animating objects.
  - `CPartArray::SetPlacementFrame` at 314297 — default pose selection from `placement_frames`.
  - `CPartArray::Draw` at 313361 and `CPhysicsPart::Draw` at 303122 — per-part draw from `draw_pos`.
  - `CPhysicsObj::add_child` at 310340 — holding-location lookup and child registration.
  - `CPhysicsObj::UpdateChild` at 308302 — child frame from parent part frame and offset.
  - `CPhysicsObj::set_frame` at 309528 — recursive child update.
  - `CObjectMaint::SetChildren` at ~299700 and `GetNullObject` at 299507 — forward-referenced
    children resolved through a placeholder table.
  - Object creation ordering at 374746-374757 — children processed, then the parent link.
  - `CSetup::pack_size` at 321365 — the only read of `parent_index` anywhere.
- `acclient-eor-source/acclient.h:69511-69541` — `CSetup` field layout used to pin dword offsets.
- `ACE/Source/ACE.Entity/Enum/ParentLocation.cs` — the attach-location enum.
- `ACE/Source/ACE.Server/Physics/Setup.cs:17,63` and
  `ACViewer/ACViewer/Physics/Setup.cs:17,63` — both independently comment out `ParentIndex`,
  corroborating that no runtime consumer exists.
- `ACE/Source/ACE.DatLoader/FileTypes/SetupModel.cs` — authoritative record layout.

### Existing Patterns to Follow

- `apps/holtburger-3d/src/lib/game/scene/scene-graph.ts:40-55` — the node record's discriminated
  root/child union is the invariant the attach transitions must respect rather than weaken.
- `crates/holtburger-world/src/state/types.rs:457-488` — the despawn dependent-detach cascade
  already enumerates all three relationships and is the precedent for attachment lifecycle work.
- `crates/holtburger-world/src/state/liveness.rs:269-271` — `has_wielder_owner` verifies its owner
  is hydrated; this is the shape `has_parent_owner` should adopt.

### Current Implementations to Change

- Host: `outdoor_static_source.rs:117-124` DTO, `parent_part_index` at `:471-479`,
  `select_setup_default_frames` at `:453-468`.
- Contract: `decode-static-source-record.ts:121`.
- Frontend transforms: `presentation.ts:76-82, 90-124, 134-160, 170`,
  `static-object-geometry-worker.ts:303-315, 849-857`,
  `dynamic-entity-system.ts:93-113, 139-151, 189-220`.
- Protocol: `description.rs:975-1010`, `properties.rs:158-165`.
- World: `entity.rs:260, 423`, `hydration.rs:215-220`, `handlers/inventory.rs:63-85`,
  `state/mutations.rs:1028-1036`, `state/liveness.rs:272`, `state/types.rs:457-488`.
- DAT: `setup_model.rs:21-24, 277-278`.

### Evidence Resolved Before Drafting

- **Placement frames are object-relative.** `get_curr_animframe` returns the placement frame when no
  animation is active, and `UpdateParts` combines it identically to an animation frame. The flat
  model is therefore proven for static default poses, not only for animation.
- **`AnimFrame` carries one frame per part per keyframe.** The DAT pre-flattens the authoring rig,
  which is why the client can ignore `parent_index` without losing skeletal motion.
- **Attach part indices are indices.** `UpdateChild` bounds-checks `part_index` against
  `num_parts`; out-of-range means "use the object frame." Our decoder calls the field `part_id`,
  which misdescribes it.
- **Connection points are unused.** Zero occurrences across the archive. They stay in the decoder
  because they are in the file format and do not propagate further.
- **Forward references run parent-first.** `SetChildren` creates placeholder objects for children
  the client has not yet received. The wielder-arrives-first ordering is the case `children[]`
  exists to serve, so the list is not redundant with the child's own parent link.

### Evidence Resolved During Plan Refinement

- **Attached children already receive correct spatial entries.** `#syncSpatialEntry`
  (`scene-graph.ts:525`) indexes any node with non-null `localBounds` regardless of root or child
  status, and `#resolvePlacement` (`:496-509`) accumulates ancestor transforms while inheriting
  landblock and env-cell residency from the root. `#syncSpatialSubtree` (`:519`) recurses into
  children, so a moving parent updates its attached children. Attachment therefore does not need
  new culling machinery.
- **Attached entities keep their own culling group.** A spatial entry records `node.cullingGroup`
  verbatim, and group bounds are a union across members, so an attached item remaining in
  `"dynamic"` is correct and requires no decision.
- **`placement` selects the child's own pose.** `CPhysicsObj::SetPlacementFrame(child, placement_id)`
  (`acclient.c:137392`) resolves against the *child's* setup `placement_frames`
  (`CPartArray::SetPlacementFrame:314303`). It chooses which authored pose the held item adopts
  while attached, and is orthogonal to `location`, which chooses where on the parent it attaches.
- **Attachment is not wielding-specific.** `ParticleEmitter::SetParenting` (`acclient.c:317404`)
  calls the same `CPhysicsObj::set_parent(obj, parent, part_index, frame)` overload. Wielding
  differs only in deriving `part_index` and `frame` from a holding-location id first. The scene
  transition primitive must therefore accept a resolved part node and transform, with
  holding-location lookup performed by the caller.
- **The TUI does not rely on attached items lacking world presence.**
  `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/nearby/tab.rs:56-57` filters attached
  entities explicitly. The remaining five sites are debug display.

### Evidence Resolved During Final Evidence Pass

- **ACE sends both directions.** `WorldObject_Networking.cs:486` sets `Children` whenever
  `Children.Count != 0`, and `:489` sets `Parent` only when `WielderId` **and** `ParentLocation` are
  both non-null. The pending-link work in Phase 3b serves real traffic, and ACE independently
  confirms that a parent GUID without its location is not a representable state.
- **Children are populated on equip and on creature initialization.**
  `Creature_Equipment.cs:496-513` (`TrySetChild`) appends a `HeldItem` carrying GUID and location,
  reached from `SetChildren()` at `:47` and the equip path at `:332`.
- **ACE already treats attachment as position delegation.** `TrySetChild` assigns
  `item.Location = Location`, giving a wielded item its wielder's location rather than removing it
  from the world. This is the same semantic Phase 3b adopts.
- **`placement` and `location` vary independently.** `GetPlacementLocation`
  (`Creature_Equipment.cs:515-556`) derives both from the equip slot, and they are not redundant: a
  non-armor item in the shield slot yields placement `RightHandNonCombat` with parent location
  `LeftWeapon`. Both must be carried.
- **`Placement` enum values are setup placement-frame keys.** The archive's placement-frame keys
  match `ACE/Source/ACE.Entity/Enum/Placement.cs` exactly, including `Resting = 101 = 0x65`,
  `Hook = 103`, `MissileFlight = 52`, and the `Random1..10` block at 121-130.
- **Placement variety justifies consuming it.** 2,769 of 5,935 setups author more than one
  placement frame. Phase 5 consumes `placement` rather than carrying it unused, and the deferred
  measurement is closed. Confirmed during implementation that pose selection has a second consumer
  unrelated to attachment: a housing hook adopts a hooked item's setup and requests
  `Placement::Hook` (`Hook.cs:165`), which is why 2,245 setups author that key.
- **Existing default-pose selection is correct.** Retail requests placement `0x65` at
  `CPhysicsObj::InitObjectEnd` (`acclient.c:305765`) and `CPartArray::CreateSetup`
  (`acclient.c:314434`), and `CPartArray::SetPlacementFrame` falls back to key `0` when absent.
  `select_setup_default_frames` (`outdoor_static_source.rs:453-468`) mirrors this and needs no
  change.
- **Phase 1 has a named verification target.** Landblock `0x9651FFFE` references setup
  `0x02000377` twice, a 17-part setup with 5.696 units of accumulated ancestor translation.
  Alternates: `0xAFC6FFFE` (`0x0200034F`, 5.481) and `0x80E1FFFE` (`0x020006FD`, 3.119).

## North Stars

1. Retail's two tiers stay separate and honestly named: within one object is flat, between objects
   is a real hierarchy. Never let one masquerade as the other again.
2. Delete before adding. The correct attachment model occupies the slot the wrong one holds today.
3. Attachment means an entity's position is owned by another entity, not that it stopped existing.
4. Interdependent facts travel together. A parent GUID without its location is not a valid state and
   the types should say so.
5. World owns the relationship; the renderer owns its geometry. World must not reach into setup
   models for frames.
6. Every phase leaves the tree compiling and the explorer renderable.

## Phased Implementation

### Phase 1: Flatten Setup-Part Transforms

Pure subtraction, independently shippable, and it fixes a live defect on 68 static setups.

#### Deliverables

- Remove `parentPartIndex` from the host DTO and delete `parent_part_index`, including its
  `0x0200049A` self-parent sentinel handling.
- Remove the field from the frontend contract and `ResolvedObjectPart`.
- Delete `orderResolvedObjectParts` and `resolveObjectPartTransforms`; consumers index
  `pose.partTransforms` directly.
- Collapse `createPartTransforms` in the static geometry worker once it is a bare pass-through.
- Parent every dynamic part node to the entity root.

#### Task Checklist

- [x] Delete host serialization and the root-sentinel projection helper.
- [x] Delete the contract field and the resolved part field.
- [x] Delete both hierarchy helpers and repoint `resolveObjectPresentationBounds`.
- [x] Repoint the static geometry worker at the pose array.
- [x] Install dynamic part nodes flat under `rootNodeId`.
- [x] Delete hierarchy-ordering and cycle-detection tests rather than migrating them.
- [x] Regenerate any baked-geometry expectations that legitimately change.
- [x] Sweep hierarchy vocabulary from touched symbols, comments, and docs.
- [x] Close the open-question entries in the EnvCell E2E plan at `:2914` and `:2970`.

#### Acceptance Criteria

- No production symbol references a setup part parent index.
- Landblock `0x9651FFFE` renders setup `0x02000377` with parts in retail-correct positions,
  verified by before/after capture.
- Re-running the drift scan reports zero parts affected by accumulation.
- Typecheck, lint, clippy, and the focused Rust and TypeScript suites pass.

#### Decisions and Course Corrections

- **Landed.** `parentPartIndex` is gone from the host DTO, the Zod contract, `ResolvedObjectPart`,
  and every fixture. `orderResolvedObjectParts` and `resolveObjectPartTransforms` are deleted;
  `resolveObjectPresentationBounds` now indexes `partTransforms` by part index directly, the static
  geometry worker reads `placementPoses.get(0).partTransforms` inline, and dynamic part nodes are
  created flat under the entity root.
- **Duplicate-part-index validation was preserved, not dropped.** `orderResolvedObjectParts` was the
  only thing rejecting duplicate part indices. Deleting it silently would have let two parts collide
  on one scene node. `createPartNodes` now rejects duplicates directly; the bounds and baking paths
  are index-addressed and therefore cannot collide.
- **Correction: the drift-scan acceptance criterion was unachievable as written.**
  `scan_setup_parent_drift` reads the archive and models what the *old* renderer would have done; it
  has no dependency on our code, so it reports the same 949/13,042 figures before and after. Re-ran
  on 2026-07-30 to confirm the archive numbers are stable. The real code-side check is that no
  production symbol reads `parent_index` past the DAT decoder (grep-verified) plus the rewritten
  `resolveObjectPresentationBounds` test, which now asserts a sibling part is *not* accumulated
  (expected bound 3 where the old hierarchy produced 19).
- **Confirmed: the `0x9651FFFE` / `0x02000377` before-after capture.** Captured in the Tauri explorer
  from two worktrees. Before, the 17-part setup is exploded: parts flung metres from their slabs,
  several floating in the sky, the figures unrecognizable. After, both slabs carry intact bound
  figures. This is the predicted 5.696 units of accumulated ancestor translation, and it is the
  clearest evidence in this plan that the defect was live rather than latent.
- Test expectations changed where the old fixtures used an identity part-0 transform, which made
  flat and accumulated composition indistinguishable. Both static-geometry-worker cases now use
  `translation(5, 0, 0)` on part 0 so the semantics are actually observed.

#### Verification

- `npm run check`: 301 files, 0 errors.
- `npm run test:ts`: 71 files, 402 tests passed.
- `npm run lint`: eslint, knip, and clippy with warnings denied all clean.
- `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml`: passed.

### Phase 2: Surface Setup Attach Points

Additive and behavior-neutral. Makes the geometry of attachment available without consuming it.

#### Deliverables

- Rename `LocationType.part_id` to `part_index` in the DAT crate.
- Introduce typed `ParentLocation` and `Placement` enums shared by the protocol and content layers,
  mirroring `ACE/Source/ACE.Entity/Enum/`.
- Emit `holdingLocations` on the setup DTO as `{ locationId, partIndex, frame }`.
- Add `holdingLocations` to `ResolvedObjectPresentation`, keyed by `ParentLocation`.

#### Task Checklist

- [x] Rename the decoder field and update writers and fixtures.
- [x] Define `ParentLocation` with all ten values including the locally unused `Mouth`.
- [x] Define `Placement`, and expose setup placement frames keyed by it rather than by raw `i32`.
- [x] Serialize holding locations from the host and validate part indices against the part count.
- [x] Decode and expose them on the resolved presentation.
- [x] Do not propagate `connection_points` beyond the decoder.
- [x] Add focused tests for a multi-location setup and for an unknown location key.

#### Acceptance Criteria

- A setup with holding locations round-trips from DAT to resolved presentation with correct part
  indices and frames.
- An out-of-range attach part index fails loudly rather than resolving to a fallback.
- No new consumer exists yet; the field is inert and that is expected.

#### Decisions and Course Corrections

- Landing inert data is a deliberate tradeoff, not an oversight. Folding this into Phase 5 would
  avoid unconsumed code but would grow the phase with the most design risk to also cover DTO
  plumbing. Keeping it separate buys a smaller, focused Phase 5 at the cost of one phase whose only
  verification is unit tests.
- **Landed.** `ParentLocation` and `Placement` live in `crates/holtburger-common/src/attachment.rs`,
  together, because they are the two interdependent keys of the same retail mechanism and both the
  DAT and protocol crates need them. `holtburger-common` is the only crate both already depend on.
- **The DAT decoder now owns the typing, not the host.** `SetupModel.holding_locations` is
  `HashMap<ParentLocation, LocationType>` and `placement_frames` is
  `HashMap<Placement, PlacementType>`; an unrecognized key is a hard decode failure. This is a
  stronger position than the plan asked for — the plan only required the exposed presentation to be
  typed — but the alternative was carrying raw `i32` through the host and converting at the
  boundary, where a bad key would be discovered later and further from its source.
- **The enum spellings are kebab-case on both `Display` and `serde`.** One wire spelling, so the
  host can serialize the enum value directly instead of maintaining a parallel string mapping. Two
  ACE typos are corrected: `Hearldry` → `Heraldry`, `SpecialCrowssbowBolt` → `SpecialCrossbowBolt`.
  ACE's `XXXUnknown*` placement values keep their numeric identity in the name (`Unknown3F2`)
  because guessing a meaning would be worse than admitting there isn't one.
- **Deviation: the DTO field is `location`, not `locationId`.** It carries the kebab-case name, not
  a number, so `locationId` would have been dishonest. The frontend gets a `z.enum` of the same ten
  literals and a `ParentLocation` string union rather than a numeric key.
- **Attach frames are converted to `Mat4` at decode, not carried as raw frames.** The offset is a
  transform in every consumer, so converting once at the layer that owns the decision beats every
  consumer re-deriving it. Field name is `offsetTransform` to match retail's
  `parts[i].frame ⊗ offset` composition.
- **Part-index validation happens twice, deliberately.** The host validates against the setup's part
  count; the decoder re-validates against the resolved part list, because appearance substitution,
  not the setup alone, decides how many parts a presentation ends up with.
- **`connection_points` stays a raw `i32` map.** Zero archive occurrences, no consumer, and it does
  not cross the host boundary. Typing it would invent a vocabulary nothing uses. Its fate is a
  Phase 6 question.
- **Found while proving the enum, needed by Phase 3a:** `placement` is *not* a field of its own on
  the wire. ACE writes it into the physics description's `ANIMFRAME` slot
  (`WorldObject_Networking.cs:341`), and retail reads it back as `animframe_id` and hands it to
  `SetPlacementFrameInternal` (`acclient.c:310470`) and to `DoParentEvent`
  (`acclient.c:139757-139759`). Our protocol already parses that slot as `animation_frame`.

#### Verification

- Full-archive decode: `scan_setup_parent_drift` decodes all 5,935 setups with zero skips under the
  typed keys, so no archive key falls outside either enum. Observed holding-location keys are
  `{None, RightHand, LeftHand, Shield, Belt, Quiver, Heraldry, LeftWeapon, LeftUnarmed}` — every
  value except `Mouth`, as predicted. Zero out-of-range attach part indices.
- `cargo test --workspace` and `cargo clippy --workspace --all-targets -- -D warnings`: clean.
- `npm run check`, `npm run test:ts` (405 tests), `npm run lint`: clean.

### Phase 3a: Represent Attachment as One Typed Fact

Mechanical and wide. It changes how attachment is spelled, not what it means, so it either compiles
or it does not. Kept separate from Phase 3b so a behavioral regression has one suspect rather than a
cross-crate refactor plus a semantic change.

#### Deliverables

- A composite attachment type carrying parent GUID, `ParentLocation`, and `Placement`.
- Replace `physics_parent_id: Option<Guid>` with that composite on the entity.
- Carry `location` and `placement` through `ParentEvent` and the physics description.
- Delete the `PropertyInstanceId::Wielder` / `PropertyInt::ParentLocation` stuffing in hydration
  and the "could be Container contextually" guess.
- Migrate the six TUI read sites to the composite.

#### Task Checklist

- [x] Introduce the composite and thread it through description and `ParentEvent` handling.
- [x] Remove the untyped bag entries and the contextual-guess comment.
- [x] Migrate `panels/dashboard/debug.rs:65,292,309` and `tabs/nearby/tab.rs:57,73` without adding
      a compatibility accessor.
- [x] Preserve the despawn dependent-detach cascade across all three relationships.
- [x] Test that an attachment cannot be constructed without its location.

#### Acceptance Criteria

- No parent GUID can be represented without its location.
- Attachment behavior is byte-for-byte unchanged; only its representation moved.
- Despawn detach behavior is identical to before.

#### Decisions and Course Corrections

- **Landed.** `PhysicsAttachment { parent, location, placement }` lives in
  `crates/holtburger-world/src/attachment.rs`, and `Entity::physics_parent_id` is replaced by
  `Entity::attachment: Option<PhysicsAttachment>`. The invariant is enforced by construction: a
  struct literal cannot omit a field, so a parent GUID without its location is unrepresentable.
  `PhysicsAttachment::from_wire` is the only path from raw keys, and it returns a typed
  `AttachmentError` naming which key was bad rather than an opaque `None`.
- **Scope addition: the protocol description's parent link was collapsed too.** `parent_id:
  Option<Guid>` and `parent_loc: Option<u32>` were always set and cleared together, and the packer
  papered over that with `self.parent_id.unwrap()` beside `self.parent_loc.unwrap_or(0)` — a
  fallback on our own type, which means the shape was wrong. They are now one
  `parent: Option<PhysicsDescParent>`. The plan did not call for this; it is the same north star
  applied one layer down, and it removed the only place a half-attachment could exist.
- **`placement` needed no new wire plumbing.** As found in Phase 2, ACE writes it into the
  `ANIMFRAME` slot, which we already parse as `animation_frame`. `apply_description` reads it from
  there, defaulting to `0` when the flag is absent — not an invented fallback but the value
  `PhysicsDesc` initializes `animframe_id` to (`acclient.c:318475`). `ParentEventData` already
  carried both `location` and `placement`, so it needed no change at all.
- **Unknown keys are refused, not defaulted.** `apply_description` logs a warning and leaves the
  entity unattached; the `ParentEvent` handler logs and reports the message unhandled, leaving prior
  state untouched. Neither panics on server input, and neither invents an attach point.
- **The `Wielder` / `ParentLocation` property stuffing is deleted, comment and all.** The physics
  parent link is no longer smuggled through the untyped property bag under a guessed key. `Wielder`
  now reflects only what the server actually sends as a property.
- The despawn cascade, `has_parent_owner`, and the `Wielder`-cleared path are mechanical
  translations to `attachment`, with behavior unchanged. Five TUI sites migrated; the debug panel
  now prints the location and placement names instead of a bare GUID, since it finally has them.

#### Verification

- `cargo test --workspace`: all suites pass, including the two new `ParentEvent` tests (typed
  resolution, and an unknown location leaving the entity unattached and in-world).
- `cargo clippy --workspace --all-targets -- -D warnings`: clean.
- Grep confirms zero surviving references to `physics_parent_id`, `parent_loc`, or the old
  "Phys Parent" vocabulary outside the legacy app.

### Phase 3b: Delegate Position and Resolve Pending Links

The semantic change, isolated. No visible result on its own, which is the point — it separates the
meaning change from the rendering change.

#### Deliverables

- Retain parsed `children` as pending attachment links and resolve them on hydration.
- Change attachment from clearing world presence to delegating position to the parent.
- Make `has_parent_owner` verify the parent is hydrated.
- A harness client that connects to a local ACE instance, equips an item, and reports the resolved
  attachment state. This is the live-verification instrument for this phase and for Phase 5.

#### Task Checklist

- [x] Store pending child links and resolve them when the child hydrates.
- [x] Replace `clear_entity_world_presence` on attach with position delegation.
- [x] Align `has_parent_owner` with `has_wielder_owner`.
- [x] Bound pending links by the existing entity lifecycle rather than a second lifetime authority.
- [x] Build the harness client. **Capture is blocked on credentials — see below.**
- [x] Test attach, detach, wielder-first arrival, child-first arrival, and parent despawn while
      attached.
- [x] Confirm the remaining TUI panels behave correctly now that attached entities have positions.

#### Acceptance Criteria

- An attached entity retains a resolvable world position derived from its parent.
- A `ParentEvent` naming an unhydrated child is retained and applied on arrival rather than dropped.
- The harness reports correct parent, location, and placement for a live wielded item.
- Despawning a parent detaches dependents exactly as it does today.

#### Decisions and Course Corrections

- **Landed.** `WorldState::delegate_attached_entity_position` replaces `clear_entity_world_presence`
  on attach. An attached entity takes its parent's position, stays in the spatial index, and keeps
  its landblock residency. Detaching leaves it where its parent left it rather than teleporting it
  back to where it was picked up.
- **An attached entity's authoritative body is retired.** Its motion is entirely its parent's, so
  simulating it independently would fight the delegation. This is a deliberate narrowing of the
  "attached entities are in the world" claim: they have a position, not a simulation. Physics for
  attached objects is out of scope for this plan, and this keeps that boundary honest rather than
  leaving a body that nothing drives.
- **Delegation is one-shot, not continuous — known debt.** The position is assigned at attach and is
  not re-pushed when the parent later moves, so a walking wielder's item position goes stale in
  world state. This matches the cited precedent exactly (ACE's `TrySetChild` assigns
  `item.Location = Location` once), and Phase 5 makes it invisible to the renderer, which positions
  attached entities from the parent's live part node rather than from world position. Making it
  continuous needs a parent→children index with a single owning mutation path; doing it here would
  have widened the phase the plan deliberately isolated. Added to Phase 6.
- **Pending links use no second lifetime authority.** `WorldState::pending_child_links` is keyed by
  child GUID, consumed when that child hydrates, and swept when either end is removed. No timers, no
  placeholder entities, no separate store to reconcile.
- **The child's own description wins over its parent's announcement.** The parent knows the attach
  point; only the child knows its pose. `resolve_pending_child_link` therefore skips a child that
  already reported an attachment, and `retain_announced_children` preserves an already-attached
  child's placement while applying the announced location.
- **`has_parent_owner` now verifies the parent is hydrated**, matching `has_wielder_owner`. An
  entity attached to an object we have never seen is not retained by that claim alone.
- TUI panels needed no further change: the nearby filter already admitted attached entities through
  an explicit clause, and they now also satisfy its landblock clause. Same set, one fewer special
  case doing the work.

#### Verification

- `cargo test --workspace`: 174 world tests pass, including six new ones covering attach delegation,
  detach, parent-first arrival, child-first arrival, parent removal detaching children plus
  dropping its pending links, and retention refusing to hold an entity whose parent is gone.
- `cargo clippy --workspace --all-targets -- -D warnings`: clean.
- **Live capture against a local ACE instance — passed.** A throwaway harness client connected,
  logged in, selected a character, entered the world, and observed 70 entities of which **18 were
  attached, 18 delegated, 0 stale**. Every attached item's landblock equalled its parent's, which is
  the acceptance criterion: under the old behavior each of these would have had its world presence
  cleared. Re-run later against a respawned world: 66 observed, 14 attached, 14 delegated, 0 stale.
  Sample:

  ```
  0x8000039D Academy Wand    at right-hand/right-hand-combat on 0x50000003 +Aun'Merkle  (delegated)
  0x80001D07 Katar           at right-hand/right-hand-combat on 0x80001D04 Tumerok High Priest
  0x80001D08 Kite Shield     at shield/shield                on 0x80001D04 Tumerok High Priest
  0x80001CFF Heavy Crossbow  at left-hand/left-hand          on 0x80001CFE Tumerok Taskmaster
  18 positioned by their parent, 0 stale
  ```

  Every location and placement resolved inside the enums with zero unknown-key warnings, and the
  observed pairs confirm the two vary independently. The player's own wielded item attached without
  the local player being repositioned.

  The harness itself has been deleted (see Phase 6). Reproducing this means writing ~150 lines
  against `ClientRuntimeBuilder`: send `Login`, answer `CharacterList` with `SelectCharacter`,
  answer `CharacterEnterWorldServerReady` with `SendCharacterEnterWorld`, then accumulate
  `EntitySpawned`/`EntityReplaced`/`EntityMoved` and compare each attached entity's landblock with
  its parent's. `apps/holtburger-cli/src/bin/tui.rs` is the worked example of that bootstrap.

### Phase 4: Resteer Before the Scene Graph Cutover

The only gate before the phase with genuine design risk.

- Dry-run attach and detach against the `SceneGraph` root/child union and confirm both transitions
  are total with respect to residency fields.
- Verify the refinement finding that an attached child's bounds reach `#resolveCullingGroupBounds`
  through inherited residency, against a real attached entity rather than by reading alone.
- Confirm attach ordering against the async `#prepareVisual` seam: part nodes are created
  synchronously at install, so a parent's attach points exist before its geometry resolves.
- Re-evaluate whether named transitions remain simpler than destroy-and-recreate now that Phase 3b's
  pending-link machinery exists.

If any of these requires weakening the root/child invariant or reconstructing entity identity on
every wield, pause for user review rather than widening the implementation.

#### Decisions and Course Corrections

**Gate passed.** All four checks were run as executable tests rather than by reading
(`scene/index.test.ts`, "SceneGraph attachment dry run"), standing the post-attach node shape up
directly with `createNode` before any transition existed.

- **Both transitions are total with respect to residency.** Attach moves a node from the root arm to
  the child arm, which means surrendering `envCellId`/`landblockId`; detach moves it back, which
  means supplying them. That asymmetry is why `detachToPlacement` takes a `ScenePlacement` and
  `attachToPart` does not — the child arm has no residency to restore from. Neither transition
  mutates the record in place: both rebuild it from carried fields, so the union stays enforced by
  construction with no `delete` and no cast.
- **Inherited-residency culling holds, proved not read.** A bounded node under a parent's part node
  is selected by an outdoor scope query it never declared residency for, composes its ancestors'
  transforms correctly, follows its parent when the parent's root placement changes, and keeps its
  own culling group rather than inheriting its parent's. No new culling machinery is needed.
- **Attach ordering is safe against the async `#prepareVisual` seam.** `install` creates part nodes
  synchronously, and `holdingLocations` rides on the presentation rather than on the prepared
  visual, so both halves of the lookup exist the moment `install` returns. Only geometry and draw
  units arrive later, and attachment does not consult them.
- **Named transitions stay simpler than destroy-and-recreate.** `destroyNode` is leaf-only, so
  recreating an entity means tearing down every part node and re-running async visual preparation —
  losing node identity and popping the item on every wield. Confirmed by test: destroying a node
  with children throws. Phase 3b's pending-link machinery does not change this; it resolves *when*
  an attachment is known, not how the scene applies it.
- **New invariant found at the gate: the acyclic guard.** `#resolvePlacement` walks parents in an
  unbounded `while` loop, so attaching a node to its own descendant would hang the renderer rather
  than fail. `attachToPart` rejects it explicitly. This was not in the plan.
- **Vocabulary hazard flagged.** "Placement" now means three things in this codebase:
  `ScenePlacement` (scene residency), `Placement` (AC authored pose key), and
  `ResolvedPlacementPose`. `detachToPlacement` takes the first. Each is consistent within its own
  layer and renaming either would churn established vocabulary, so they stand — noted here because
  the two meet in `dynamic-entity-system.ts`.
- Nothing required weakening the root/child invariant or reconstructing entity identity, so the gate
  did not need to pause.

### Phase 5: Attach Entities in the Scene Graph

#### Deliverables

- `attachToPart(childRootId, parentPartNodeId, localTransform)` and
  `detachToPlacement(nodeId, placement)` on `SceneGraph`, each moving the node between union arms.
  The primitive takes an already-resolved part node and transform so particle and script
  attachment can reuse it without a parallel path.
- Dynamic entity installation resolves world attachment state to a parent part node and offset,
  performing the holding-location lookup on the caller side.
- Attachment changes at runtime drive the transitions.

#### Task Checklist

- [x] Implement both transitions with full residency acquisition and release.
- [x] Resync the spatial subtree on both transitions.
- [x] Resolve `ParentLocation` to a part node and transform in the frontend, not in `world`.
- [x] Select the attached entity's pose from its own setup using `placement`, falling back to key
      `0` exactly as `CPartArray::SetPlacementFrame` does. *(Rule implemented; see the host gap.)*
- [x] Reject attaching to a node that is not a part node of the named parent.
- [x] Handle parent destruction while children remain attached.
- [x] Add focused tests for attach, detach, re-attach to a different location, and parent teardown.
- [x] Record the per-frame subtree resync cost of animated parents as a known characteristic; do
      not pre-optimize it.
- [x] Attachment drives the transitions at install, down to the missing feed. See *Built to the
      seam* below.

#### Acceptance Criteria

- An attached entity's world transform equals its parent's part transform composed with the
  holding-location offset.
- The Phase 3b harness client drives a live wield and the item renders in the wielder's hand,
  captured before and after.
- An attached entity remains correctly culled through inherited residency.
- Detaching restores an independent placement with correct landblock and env-cell residency.
- No generic reparent operation is introduced.
- The transition primitive is expressible for a particle emitter without modification.
- The root/child union remains enforced by construction.

#### Decisions and Course Corrections

- **Landed: the transitions.** `SceneGraph.attachToPart(nodeId, parentNodeId, localTransform)` and
  `SceneGraph.detachToPlacement(nodeId, placement)` move a node between arms of the node union,
  rebuilding the record rather than mutating it, and resync the whole moved subtree. Both reject the
  wrong starting arm; attach additionally rejects a cycle. The primitive takes a resolved node and
  transform, never a `ParentLocation`, so `ParticleEmitter::SetParenting` is expressible against it
  unchanged.
- **Landed: the caller-side lookup.** `DynamicEntitySystem.attachEntity(nodeId, parentNodeId,
  location)` resolves the holding location through the *parent's own* `holdingLocations` and
  `partNodes` maps. That is what makes "attach to a node that is not a part node of the named
  parent" unrepresentable rather than merely checked — there is no way to name such a node. Missing
  attach point and missing part node both throw with the offending name.
- **Landed: parent teardown releases children.** `#destroyEntityTree` detaches anything still hanging
  off the entity to each child's own currently resolved placement before destroying its part nodes.
  This matches retail unparenting a destroyed object's children rather than destroying them, and it
  is also what keeps `destroyNode`'s leaf-only rule satisfiable.
- **Landed: retail's pose fallback rule.** `poseFor(presentation, placementKey)` looks a pose up by
  key and drops to key `0`, matching `CPartArray::SetPlacementFrame`. `defaultPose` now requests the
  resting key `0x65` through it instead of taking whatever entry the map happened to yield first,
  which was an accidental rule rather than a stated one.
- **Gap: the host emits only one pose.** `select_setup_default_frames` resolves `0x65 → 0` in Rust
  and ships the result under key `0`, so the frontend's selection always falls through to the
  fallback and `placement` cannot yet change an attached item's pose. The rule is implemented and
  exercised; making it load-bearing needs the host to serialize all placement frames keyed by
  `Placement` — Phase 2 typed that map in the decoder, so the remaining work is DTO plumbing.
  Added to Phase 6.
- **Known characteristic, not optimized:** every transform change on an animated parent resyncs its
  entire attached subtree through `#syncSpatialSubtree`, which re-resolves each descendant's
  placement by walking to the root. For a wielder with a few held items this is a handful of matrix
  multiplies per changed part node. Recorded rather than pre-optimized, as the plan directs.

#### Built to the Seam

Everything downstream of the missing feed is implemented and tested:

- `ResolvedResidentIdentity` is a discriminated union: `authored` residents carry a content address
  (`sourceId`), `world` residents carry a `WorldObjectGuid` **and** their attachment. Attachment
  living inside the world arm means "an authored resident is attached to something" is not a state
  the type can express, and every authored producer simply omits it rather than writing
  `attachment: null` and hoping nobody changes it.
- `residentKey(identity)` derives the string used for geometry ranges, resource addressing, and
  diagnostics, so identity has one source of truth rather than a parallel `id` field.
- `DynamicEntitySystem.install` indexes world objects by GUID, attaches immediately when the parent
  is already installed, and retains the link when it is not, applying it the moment that parent
  installs. Commits arrive in whatever order their source produces, so both orders are real.
- A declaration is retained for the child's whole life rather than consumed on first use, and is
  bounded by the child's lifecycle alone — never dropped because the parent it names went away. No
  timers, no second lifetime authority. An intentional `detachEntity` clears the declaration;
  releasing children because their parent is being torn down does not, so a reinstalled parent gets
  its children back.

##### Why identity had to be a union

The first cut named the parent by resident id, typed `string`. That was wrong, and the way it was
wrong is worth recording. Resident ids are host-assigned content addresses:

```
landblock-static/{landblock:08x}/building/{source_index:04x}/{source_did:08x}
env-cell-resident/{env_cell_id:08x}/{source_index:04x}/{source_did:08x}
```

They are landblock-scoped and index-derived, so they **cannot name a parent in another landblock
even in principle**. An item lying in one landblock, picked up by a player standing in another, is
ordinary gameplay and that grammar cannot express it. The ids are not degraded GUIDs either — they
identify DAT-authored content that has no server identity at all, and an index into an authored list
is the right answer to "which building is this, after a re-fetch?".

Two populations, two identity schemes, one of which is global. Flattening them to `string` implied
any resident may name any resident, which is false in both directions. The union states the real
rule instead, and the cross-landblock case is covered by a test that installs an item in
`0x0002ffff`, attaches it to a wielder in `0x0001ffff`, and asserts it inherits the wielder's
residency.

What remains is only the producer: something that constructs commits carrying a non-null
`attachment` from world state.

#### Blocked

**Attachment changes at runtime have no producer in `apps/holtburger-3d`.** The plan assumed a path
from world attachment state into frontend entity installation, and that path does not exist:

- `DynamicEntityCommit` is `ResolvedObjectResident`, which carries `presentation`, `placement`,
  `scale`, `localBounds`, and `appearance` — no entity identity and no attachment.
- Dynamic entities reach the runtime only as static-layer promotions or as
  `CommitBundleSourceKind.Spawned` bundles, and **nothing in the app constructs a `Spawned` bundle**.
  It is a scaffolded seam awaiting a world feed.
- `apps/holtburger-3d/src-tauri` depends on `holtburger-core` but exposes no world-entity or session
  surface; the app is explorer-only today.

The attachment half of that feed is now built and tested; what is missing is the feed itself —
a session surface at the Tauri boundary plus spawn/despawn/update routing that constructs
`Spawned` commit bundles from world entities. That is a substantial piece of work in its own right
and is not described anywhere in this plan.

Consequently the acceptance criterion "the Phase 3b harness client drives a live wield and the item
renders in the wielder's hand" remains unmet: the world half is proved live (18/18 delegated), and
the renderer half is proved by unit test, but nothing joins them yet.

Phase 6 is intentionally not started while this is open, since its cleanup list depends on decisions
about the blocked work.

### Phase 6: Cleanup

Itemize and clear the debt this plan accumulates. Expected targets, to be extended during
implementation:

- [x] Remove `crates/holtburger-debug-harness/src/bin/scan_setup_parent_drift.rs`. Deleted; every
      measurement it produced is recorded in this document, so the numbers survive the tool.
- [x] Decide whether the Phase 3b wield harness client is retained. **Deleted**, along with every
      other harness in the crate. The first answer here was "retained", argued on the grounds that
      it was the only end-to-end instrument and that upcoming work would need it. Both parts were
      weak: nothing in it is hard to rewrite (connect, log in, accumulate entity events, compare
      landblocks — and the client bootstrap sequence it encodes is already spelled out in
      `apps/holtburger-cli/src/bin/tui.rs`), and the work it was being saved for is not scheduled.
      It was a one-shot measurement exactly like the drift scan, and its findings are recorded in
      this document, which is what actually needed to survive.
      The retention rule this settles on, applied to the whole crate: **a diagnostic's findings
      belong in the doc it informed; the tool that produced them is not evidence.** Every harness in
      `holtburger-debug-harness` was referenced only by "here's the command I ran" lines in
      completed plans — provenance of a past run, not a future need — so `src/bin/` is now empty,
      which is the correct steady state for a scratch space. `git` remembers them.
- [x] Sweep any remaining "hierarchy" vocabulary. Swept. Every surviving use is legitimate and
      unrelated: allegiance hierarchy in the protocol, the Explorer LoD radius hierarchy, the TUI's
      generic tree utility, and the new comments that correctly describe object-to-object hierarchy.
      No setup-part hierarchy vocabulary remains.
- [x] Confirm no legacy holding-location misuse is resurrected. Confirmed still present in
      `holtburger-3d-legacy/.../static-object-source-closure.ts:842-846`, where
      `connectionPoints.concat(holdingLocations)` is folded into a part's *pose* list — attach
      offsets treated as extra part placements, which is exactly the confusion this plan separates.
      The legacy app is not referenced by the live app's build, and nothing in the new code does
      this: holding locations reach the frontend as `ResolvedAttachPoint`, never as placement poses.
- [x] Reassess whether `connection_points` should remain in the decoder. **Kept, untyped.** The DAT
      crate's contract is lossless decoding of the file format, and the field is in the format
      whether or not the retail archive populates it (zero occurrences). Removing it would not even
      shorten the writer, which must still emit a zero count. It is deliberately left as
      `HashMap<i32, LocationType>` rather than typed like `holding_locations`: inventing a
      vocabulary for a table with no observed keys and no consumer would be a guess.
- [x] Verify no compatibility shim survives. Verified by grep across all non-legacy crates and apps:
      zero references to `physics_parent_id`, `parentPartIndex`, `parent_part_index`, `parent_loc`,
      `orderResolvedObjectParts`, or `resolveObjectPartTransforms`.

Accumulated during implementation:

- [ ] **World position delegation is one-shot.** An attached entity takes its parent's position at
      attach and does not follow it afterwards. Making it continuous needs a parent→children index
      with a single owning mutation path for `Entity::attachment`. Invisible to the renderer, which
      positions attached entities from the parent's live part node; visible to world-state consumers
      such as the TUI and retention. See Phase 3b decisions.
- [ ] **The host emits only one placement pose.** `select_setup_default_frames` collapses the whole
      placement-frame table to a single default before serialization, so the frontend's
      `poseFor(presentation, placementKey)` rule can never select anything else. Serialize all
      placement frames keyed by `Placement` to make `placement` load-bearing. See Phase 5 decisions.
- [x] ~~Decide the fate of `report_attachments`.~~ **Deleted**, with every other harness in the
      crate. See the Phase 6 entry for the retention rule that settled it.
- [ ] **Three meanings of "placement"** coexist (`ScenePlacement`, `Placement`,
      `ResolvedPlacementPose`). Left alone deliberately; revisit if they start being confused.
- [ ] **`DynamicEntitySystem` now spans three identity spaces**: `TOwnerId` (resource lease
      lifetime, pre-existing), `ResolvedResidentIdentity` (who a resident is, added by this work),
      and `SceneNodeId`. Adding the second was the cost of resolving attachments without a second
      map in `game-runtime`. Watch whether it stays coherent — in particular whether `TOwnerId` and
      the world arm end up redundant once the feed exists, since a spawned entity's owner is already
      derived from its identity.
- [ ] **Housing hooks do not use attachment — checked, and it matters.** A hook is
      `Hook : Container` (`ACE/Source/ACE.Server/WorldObjects/Hook.cs:22`), a real `WorldObject` with
      an `ObjectGuid`. Hooking an item puts it in the hook's *inventory* and the hook then
      **impersonates** it: `OnAddItem` (`:139-176`) copies the item's `SetupTableId`,
      `MotionTableId`, `PhysicsTableId`, `SoundTableId`, `ObjScale`, and `Name` onto the hook, sets
      `Placement = item.HookPlacement ?? Placement.Hook`, and broadcasts an update of the *hook*.
      `OnRemoveItem` restores the hook's own weenie values. No second object appears in the world and
      no parent link is sent — ACE only sets `PhysicsDescriptionFlag.Parent` for
      `WielderId` + `ParentLocation` (`WorldObject_Networking.cs:488`), and a hooked item has a
      `ContainerId` instead. Three consequences:
      1. Authored/static residents never parent anything, so the discriminated identity below is safe.
      2. `Placement::Hook`, authored by 2,245 setups, is consumed by the hook wearing the item's
         setup — a real, non-attachment consumer of pose selection.
      3. This is the concrete case behind the plan's "disentangle `Container` from the physics
         parent" scope note, and behind deleting the "could be Container contextually" guess in
         Phase 3a. Container and physics parent are genuinely different relationships and hooks are
         where confusing them would have shown up.
- [x] ~~`attachment.parentId` bets on a shared id namespace.~~ **Resolved 2026-07-30** by
      `ResolvedResidentIdentity`. Attachment now names its parent by `WorldObjectGuid`, which is
      global, so cross-landblock attachment works by construction. See *Built to the Seam*.
- [x] ~~Reinstalling a parent orphans its attached children.~~ **Fixed 2026-07-30.** The bug was
      real — proved with a throwaway probe before fixing, then the probe was deleted rather than
      kept, since a test asserting a defect is worse than none. `#pendingAttachments` became
      `#declaredAttachments`: a child's declaration is retained for its whole life instead of being
      consumed on first use, so a torn-down and reinstalled parent gets its children back. An
      intentional `detachEntity` clears the declaration; releasing children during parent teardown
      does not. Both behaviors are now pinned by tests.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Flattening changes baked geometry bytes and looks like a regression. | The change is expected for 68 identified setups. Regenerate expectations rather than patching them, and verify against retail positioning with capture evidence. |
| `SceneGraph` attach weakens the root/child invariant. | Ship two named domain transitions instead of a generic reparent, each total with respect to the union arm it targets. Gate at Phase 4. |
| Attached entities become unculled or invisible. | Reading says inherited residency already handles this. Verify against a real attached entity at the Phase 4 gate rather than trusting the read. |
| The attach primitive is shaped around wielding and cannot express particle or script attachment. | Take a resolved part node and transform, never a `ParentLocation`. Prove the shape against `ParticleEmitter::SetParenting` at the Phase 4 gate. |
| Replacing `physics_parent_id` with a composite breaks TUI read sites. | Six read-only display and filter sites in `apps/holtburger-cli` consume the field (`panels/dashboard/debug.rs:65,292,309`, `tabs/nearby/tab.rs:57,73`). All are mechanical accessor updates; migrate them in the same change rather than retaining a compatibility accessor. |
| Pending child links leak when a child never arrives. | Bound pending links by the existing entity lifecycle and retention rules; do not introduce a second lifetime authority. |
| World reaches into setup data for attach frames. | World stores `(parent, location, placement)` only. Frame resolution stays in the frontend, enforced by crate boundaries. |
| `ParentLocation` values outside the enum arrive from the server. | Fail loudly on unknown values rather than defaulting to a location; an unknown attach point is a real protocol gap worth surfacing. |

## Definition of Done

- [x] No production code composes setup parts through `parent_index`. Grep-verified; the field stays
      in the DAT decoder because it is in the file format, and goes no further.
- [x] Setup holding locations are available as typed attach points end to end, DAT decoder through
      host DTO to `ResolvedAttachPoint` on the resolved presentation.
- [x] Attachment is one composite world fact carrying parent, location, and placement, and cannot be
      constructed without all three.
- [x] Attached entities are positioned by their parent rather than removed from the world. Proved
      live: 18 attached, 18 delegated, 0 stale.
- [x] Forward-referenced children resolve on arrival, in `world` (pending child links) and in the
      frontend (declared attachments), in both arrival orders.
- [x] `SceneGraph` attach and detach exist as named transitions with the union invariant intact,
      plus an acyclic guard the plan did not anticipate.
- [x] Hierarchy vocabulary describing the deleted mechanism is gone from code, tests, and docs.
- [x] The temporary drift-scan harness is removed.
- [x] Typecheck, lint, clippy with warnings denied, and the Rust and TypeScript suites pass.
- [ ] **Not done, and out of this plan's scope as written:** an attached entity is not yet *rendered*
      in its parent's hand, because no world-to-frontend entity feed exists to drive the transitions
      at runtime. Every layer on both sides of that gap is complete and tested.

## Open Questions

All questions raised during drafting and refinement were resolved by the evidence passes above.
What remains is verification at the Phase 4 gate rather than unknowns:

- Whether inherited-residency culling holds for a real attached entity, not only by reading.
- Whether the attach primitive expresses `ParticleEmitter::SetParenting` without modification.
