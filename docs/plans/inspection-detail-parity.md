# Inspection detail parity

Status: implemented; automated acceptance complete, user visual acceptance pending.

## Goal and boundaries

Expose the equipment and character appraisal facts currently missing from H3D and TUI, with correct replacement semantics during inspection refresh.

In scope:

- Equipment's Unenchantable status.
- Nine body-location armor levels and their unenchantable markers.
- Disclosed creature combat ratings, including the damage/critical damage and resistance values shown by retail.
- Character affiliation and disclosed personal details.
- Character-preview identity layout: name/level/title above the model, heritage and PK status
  below it, plus the selected-entity name-color policy.
- Shared semantic contracts, H3D and TUI presentation, and refresh tests.

Out of scope: server changes, new appraisal requests or refresh timers, preview renderer/canvas changes, reconstructing undisclosed base stats, full allegiance management, new DAT catalogs, and changing assessment success rules. No assets.hba regeneration is needed.

## Evidence and constraints

Ground truth (paths relative to repository root):

| Source | Evidence |
| --- | --- |
| `ACE/Source/ACE.Server/WorldObjects/Player.cs:302` | Assess Person versus Deception; cloaked Admin/Sentinel success override. Successful appraisal data is not admin-only. |
| `ACE/Source/ACE.Server/Network/Structure/CreatureProfile.cs:47` | Health and optional attributes/vitals; highlight/color masks. |
| `ACE/Source/ACE.Server/Network/Structure/AppraiseInfo.cs:342` | Privacy filtering, allegiance and fellowship properties. |
| `ACE/Source/ACE.Server/Network/Structure/AppraiseInfo.cs:558` | Armor levels sent on successful assessment for players or non-attackable creatures. Ratings assembled for creatures. |
| `ACE/Source/ACE.Server/Network/Structure/AppraiseInfo.cs:586` | Effective ratings assembled by server; computed zero ratings may be omitted. |
| `ACE/Source/ACE.Server/Network/Structure/ArmorLevel.cs` | Nine locations; sum equipment AL including enchantments; add 9999 when every covering layer is unenchantable. |
| `ACE/Source/ACE.Server/WorldObjects/WorldObject_Weapon.cs:532` | Equipment enchantability is `(ResistMagic ?? 0) < 9999`. |
| `acclient-eor-source/acclient.c:220774` | Item Unenchantable label checks integer property 36 (`ResistMagic`) against 9999. |
| `acclient-eor-source/acclient.c:223585` | Character armor rows, decoding each encoded AL and showing an asterisk. |
| `acclient-eor-source/acclient.c:223730` | Character rating property reads and display groups. |
| `acclient-eor-source/acclient.c:223920` | Character personal-information rows; inspect adjacent code for full affiliation and personal display behavior. |

Existing paths:

- Protocol: `crates/holtburger-protocol/src/messages/object/{events,types}.rs` already decode properties and `ArmorLevels`.
- World ingestion: `crates/holtburger-world/src/identify.rs`, `entity.rs`, `vendor.rs`, and `handlers/inventory.rs`.
- World semantics: `crates/holtburger-world/src/inspection.rs` owns `InspectionSource`, `CreatureInspection`, `ItemStatus`, and identity classification.
- Host: `apps/holtburger-3d/host/src/client_projection.rs` passes the shared result and tests wire fixtures.
- H3D: `apps/holtburger-3d/src/client/Client{Creature,Item}Inspection.svelte`, `client-object-inspection-contract.ts`, `client-object-inspection-format.ts`, and `fixtures/object-inspection-wire.json`.
- TUI: `apps/holtburger-cli/src/pages/game/panels/dashboard/assess.rs`.

The input is bounded: nine armor locations and a finite set of optional scalar/string appraisal properties. No generic property-browser framework is needed. Armor coverage can be supplied for NPCs; ratings can be supplied for ordinary creatures. Do not gate either solely on player identity.

Server values are authoritative. Preserve signed rating values, zero, and absence. Missing personal details must remain absent; do not recover them from older entity properties or static content. A rejected assessment is not a successful empty appraisal.

Concessions: report only server-disclosed values. Armor totals do not expose an unenchanted baseline or full damage mitigation. Neither AL nor rating values alone prove buff polarity. Existing rejection presentation remains unchanged. The current broader merged-property model remains for consumers outside these new facts.

## North stars

1. Derive game meaning once in world; frontends choose labels, grouping, and formatting.
2. Prefer a small typed extension over an appraisal-system rewrite.
3. Fresh successful appraisal replaces all facts introduced here, including absence.
4. Keep wire sentinels and property keys out of frontend contracts.
5. Preserve all disclosed detail without making UI layout a shared-crate policy.

## Shapes, ownership, and flow

Desired flow:

```text
protocol IdentifyObjectResponse (raw properties + optional ArmorLevels)
    |
    v
world apply_identify_response, on success
    +-- existing merge into live entity/vendor properties
    +-- replace typed supplemental appraisal snapshot from THIS response
              |
              v
world InspectionSource -> ItemInspection / CreatureInspection
              |
              +-- core/host transport -> strict TS schema -> H3D sections
              +-- TUI appraisal rendering

H3D entity mirror -> existing selected-name color policy
              |
              +-- inspection controller captures color for exact requested GUID
              +-- ready snapshot -> item heading / creature preview heading
```

Use a world-owned `InspectionSupplement` retained by entity/vendor appraisal owners. This is the bounded set of newly exposed facts, not a second copy of every property table. Keep its types and derivation alongside inspection semantics (a focused submodule is appropriate if needed). `IdentifyTarget` carries mutable access, so entity and vendor ingestion share replacement behavior.

Illustrative contract shape (names can follow local idiom; preserve these invariants):

```rust
InspectionSupplement {
    equipment_unenchantable: Option<bool>,
    armor_coverage: Option<ArmorCoverage>,
    ratings: CreatureRatings,
    max_health_bonus: Option<i32>,
    character_details: CharacterDetails,
}

ArmorCoverage {
    head, chest, abdomen, upper_arm, lower_arm,
    hand, upper_leg, lower_leg, foot: ArmorCoverageValue,
}
ArmorCoverageValue { level: u32, enchantable: bool }

CreatureRatings {
    // Named Option<i32> fields for the finite property set below.
}
CharacterDetails {
    // Named optional affiliation strings and personal values below.
}
```

An optional retained snapshot distinguishes no successful appraisal from a successful response containing no supplemental fields. Build it completely before replacement. Do not duplicate derivation between the retained snapshot and serialized inspection. The inspection result selects/clones the relevant semantic fields; it never reads these facts back out of the merged property bag.

`ItemStatus` gains `unenchantable: Option<bool>`: absent ResistMagic remains absent, below threshold is false, threshold or above is true. H3D/TUI show the label only for true. No armor value participates in this derivation.

`CreatureInspection` gains optional armor coverage, ratings, and character details. Character details are available only for the existing character-style identity variant; use its existing classification rather than inventing an IsPlayer check. Keep armor and ratings available regardless of identity variant. Prefer a typed optional detail block over duplicating identity data.

Armor decoding: raw >= 9999 means `{ level: raw - 9999, enchantable: false }`; otherwise `{ level: raw, enchantable: true }`. Use a named domain constant. Do not clamp, modulo, or infer armor coverage from the preview model. A zero location in a present block is a disclosed zero, not an absent location. The marker describes all covering layers collectively, not every item individually in a mixed set.

Rating fields to support, when disclosed: DamageRating, DamageResistRating, CritRating, CritDamageRating, CritResistRating, CritDamageResistRating, PKDamageRating, PKDamageResistRating, Overpower, OverpowerResist, HealingBoostRating, NetherResistRating, DotResistRating, LifeResistRating, and GearMaxHealth. Confirm exact enum spellings and units against ACE before assigning labels; GearMaxHealth is a health bonus and belongs with bonuses, not a rating percentage. Do not treat server aggregate ratings as equipment-only values or add bonuses again. Do not expose a property simply because an enum exists: every listed field must have a verified appraisal source and a named UI row. Overpower fields are conditional on property disclosure, not guaranteed by AddRatings.

Character details: allegiance name, patron title/name, monarch title/name, follower count; fellowship; DateOfBirth as the server-authored arrival text, Age as elapsed seconds, NumDeaths, NumCharacterTitles, ChessRank, FakeFishingSkill, and Enlightenment. Reuse existing enum mappings/formatters where available. Do not calculate age from arrival text, rename FakeFishingSkill as an actual trained skill, or locally expand server-authored patron/monarch strings. Rank-prefixed display names and society rank localization are separate work unless existing helpers make them a direct reuse; they are not necessary to close the discussed information gap.

Lifecycle:

| Event | Supplemental snapshot | Result |
| --- | --- | --- |
| First successful appraisal | Create from complete incoming response | New disclosed sections appear |
| Successful refresh, changed values | Replace | Values update |
| Successful refresh, fields omitted | Replace with absence | Old rows disappear |
| Failed appraisal | Preserve last successful retained snapshot | Existing Rejected outcome; no new Ready result |
| Missing target | No mutation | Existing Missing outcome |
| Entity/vendor removal | Dropped with owner | No global cache or extra cleanup |

## Phases

### Phase 1: Fresh appraisal foundation and equipment status

- [x] Audit existing entity/vendor constructors, identify fixtures, and inspection callers before adding the optional snapshot field.
- [x] Add the supplemental snapshot initially containing equipment status; initialize it absent and replace it from every successful response through the shared `IdentifyTarget` path.
- [x] Leave failed responses and unrelated live-property merges unchanged.
- [x] Add `ItemStatus.unenchantable` and update Rust serialization, strict TS schema, wire fixtures, H3D status text, and TUI status text together.
- [x] Test absent/below/equal/above threshold and a successful refresh removing the property. Verify unrelated live properties survive.

Acceptance: equipment shows Unenchantable from ResistMagic alone in both frontends; repeated successful appraisal cannot retain the old label after its source is removed. Existing player/item/vendor inspection tests remain valid.

### Phase 2: Armor coverage and combat ratings

- [x] Extend the snapshot, `InspectionSource`, and `CreatureInspection` with typed coverage and verified rating fields.
- [x] Decode the armor sentinel once at snapshot construction. Continue retaining raw ArmorLevels for existing diagnostic consumers; do not repurpose raw protocol fields as decoded levels.
- [x] Update host fixtures and strict browser contracts in the same change.
- [x] Add H3D Protection and Combat Ratings sections. Prefer individual location/value rows that can collapse to one column on narrow panels; comma-format values and keep individual numbers unbroken.
- [x] Show unenchantable markers with an explanation only when applicable. Preserve disclosed zero locations; omit the whole section when no armor block was supplied.
- [x] Give damage, critical damage, resistance, and other disclosed ratings explicit labels; no ambiguous slash-packed pairs or invented percentages. Omit absent values and empty sections.
- [x] Add equivalent compact TUI sections consuming the same semantic facts.
- [x] Test all nine location mappings, sentinel boundary, mixed marker values, signed/zero/missing ratings, and a nonzero rating disappearing on successful refresh.

Acceptance: the screenshot's armor and rating information is represented; ordinary creature ratings and non-player armor blocks also work. Neither frontend interprets raw property keys or sentinels. Existing attribute/vital colors remain intact.

### Phase 3: Character affiliation and personal details

- [x] Verify each property against ACE assessment annotations/BuildProperties and retail's character inspector. Record units beside semantic fields.
- [x] Extend the snapshot and character inspection with the explicit optional fields listed above, sourced only from the current successful appraisal.
- [x] Add H3D Affiliation and Character Details sections and compact TUI equivalents; use existing duration/number formatting where appropriate.
- [x] Preserve zero deaths/counts and server-authored strings. Omit unavailable fields and empty sections. Existing lineage/title/PK labels remain the single identity presentation.
- [x] Arrange character preview identity as name, level, and italicized title above the model,
  with heritage left-aligned and a tooltip-labeled PK-status icon right-aligned below it.
- [x] Reuse the selected-entity name-color policy, captured for the exact inspected GUID so
  later selection changes cannot recolor an open inspection.
- [x] Test disclosed data followed by omission, changed fellowship/allegiance, zero counts, and character versus ordinary-creature classification.

Acceptance: server-disclosed personal facts appear consistently in both frontends and disappear on a later successful response that withholds them. No privacy-controlled field is restored from merged properties.

### Phase 4: Cleanup and acceptance

- [x] Review whether the supplement has stayed bounded; remove redundant derivation and unused fields. Do not grow it into a second entity property store.
- [x] Sweep schema fixtures, constructors, comments, and status-format helpers for stale shapes. Extract only actual shared frontend formatting, not a generic inspection framework.
- [x] Exercise a synthetic browser inspection fixture through the existing harness, including narrow sizing and successive snapshots; check browser errors and content presence. Do not run the interactive TUI.
- [x] Run focused world, CLI, and host tests; Rust formatting and clippy with warnings denied for touched packages; H3D package check, relevant Vitest tests, lint, and formatting checks. Broaden testing when changed seams justify it.
- [ ] User visual acceptance: ordinary and privileged examiner if available, player/NPC/creature, mixed armor markers, item Unenchantable, absent and present ratings, and narrow/wide panel layouts.

Acceptance: tests prove replacement behavior and contracts; user verifies presentation. No commit is implied by this plan.

## Risks and mitigations

- **Merged properties retain old disclosures:** all new facts come from a response-owned snapshot. Never clear the entire live entity property table.
- **Dual raw and semantic representations:** protocol/entity diagnostics retain raw wire values; the supplement owns interpretation for inspection only. Derive once per successful response and use that result in both frontends.
- **Existing stale appraisal fields:** this plan fixes freshness for introduced sections. A wholesale correction of existing spell/enchantment/profile retention is separate; flag evidence of a dependency before expanding scope.
- **Overclaiming ratings:** ACE already computes effective totals and has its own documented omissions. Display the received values without trying to repair server calculations.
- **Retail formatting quirks:** retain facts while improving readability. If implementation deliberately changes a proven observable retail quirk, follow the repository's citation/marker convention rather than silently copying or correcting it.
- **UI density:** use grouped optional sections and responsive rows; preserve preview behavior and avoid forced panel growth.

## Definition of done

- [x] Equipment unenchantability, body armor, ratings, and listed character details reach H3D and TUI through shared world semantics.
- [x] Every added field has a verified source, units, and visible consumer.
- [x] Absent, zero, and negative values retain their intended meanings.
- [x] Success/omission/rejection refresh sequences have focused coverage.
- [x] Strict host/browser contracts agree and affected checks pass.
- [x] Visual acceptance is complete or explicitly reported as pending user verification.
- [x] No speculative framework, new polling path, asset regeneration, or renderer modification was introduced.

## Decisions and open questions

- Chosen: supplement successful appraisal retention for the new facts rather than replacing all existing property hydration.
- Chosen: expose readable individual armor locations; retain all nine values rather than retail's slash-packed strings.
- Chosen: include character details as a separate phase within this plan.
- No user decision blocks implementation. If source verification invalidates a listed field or changes the snapshot boundary materially, record the evidence and revise the affected phase before continuing.
