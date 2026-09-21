# Item inspector cantrip indicators

Status: complete.

## Goal and scope

Show compact pill summaries directly beneath an inspected item's icon, grouped by
Feeble, Minor, Moderate, Major, Epic, Legendary, and Other.

The user approved compact category/power rules and accepts occasional differences
from ACE's server-side bonus values. Nonstandard or ambiguous strengths belong in
Other. A dense spell-ID-to-tier mapping is explicitly rejected.

In scope:

- App-local classification of static spell definitions.
- Standard tier names within recognized cantrip categories, plus exact
  category-specific power matches for named spells.
- Reviewed additional stacking categories presented as Other.
- Intrinsic item spell counts rendered as pills beneath the item icon.
- A corpus audit and focused tests of the actual implementation.

Out of scope: duration filtering, server database dependencies at runtime,
equipment comparisons, active buff effectiveness, inventory-wide filters, new
network requests, server changes, and a general stacking simulator. This feature
does not claim that all independent bonus systems are conventional cantrips.

## Evidence and boundaries

Ground truth and integration points:

| Source                                                                                       | Purpose                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ACE/Source/ACE.Server/Network/Structure/AppraiseInfo.cs`, `BuildSpells` / `AddEnchantments` | Intrinsic spell IDs are unmarked; active item enchantments have bit `0x80000000` set. Primary and proc spells also appear in the intrinsic list. |
| `crates/holtburger-world/src/inspection.rs`, `InspectionSpell`                               | Existing decoded ID and `active_enchantment` fact. Reuse it.                                                                                     |
| `ACE/Source/ACE.Server/WorldObjects/Managers/EnchantmentManager.cs`                          | Spell category and power govern enchantment competition; power is not necessarily bonus magnitude.                                               |
| `ACE/Source/ACE.Entity/Models/PropertiesEnchantmentRegistryExtensions.cs`                    | Effect selection filters stat types/keys and groups enchantment categories. Category alone is not a complete effect identity.                    |
| `ACE/Source/ACE.Server/Factories/LootTables.cs` and `Factories/Tables/Cantrips/*Cantrips.cs` | Canonical generated-loot cantrip families.                                                                                                       |
| `ACE/Source/ACE.Server/Factories/Tables/SpellLevelProgression.cs`                            | Minor/Major/Epic/Legendary progression identities.                                                                                               |
| `crates/holtburger-dat/src/file_type/spell_table.rs`                                         | Authored name, category, flags, and power already decoded.                                                                                       |
| `crates/holtburger-content/src/spells.rs`                                                    | Existing static reference query; expose raw category/power here if needed.                                                                       |
| `apps/holtburger-3d/host/src/spell_references.rs`                                            | Existing host reference projection and proposed classification consumer.                                                                         |
| `apps/holtburger-3d/src/app/spell-references.ts`                                             | Strict Zod reference contract and reference repository.                                                                                          |
| `apps/holtburger-3d/src/client/ClientItemInspection.svelte`                                  | Existing reference loading, spell rows, and active-enchantment labels.                                                                           |
| `apps/holtburger-tools/src/spell_export.rs` and `src/bin/dat-tool.rs`                        | Existing corpus export; reuse rather than create another DAT decoder.                                                                            |

The 2026-09-20 census used 6,266 records in `dats/assets.hba`, namespace
`eor/portal`, SHA-256
`20fa252ad80b4daf314fd098d1f48a386ce6a8f326b4007f3f33561c38be75b7`.
ACE's loot tables yielded 66 families, 264 spell IDs, and 65 distinct categories.
Blood Thirst and Spirit Thirst share category 323 but use different power ladders.

The exploratory census found 358 standard-named anchors across 72 categories,
which reduce to 19 observed power profiles. It also examined 150 other beneficial
members of those categories and 14 spells explicitly described as stacking with
both ordinary spells and cantrips. These are candidate discovery counts, not a
complete proof that every alternate stacking effect has been found.

Earlier tier totals for 522 candidates used ACE `stat_Mod_Val` to assign named
spell tiers. Those totals are superseded: rerun classification using the policy
below. Do not preserve them as expected test results.

Temporary investigation exports, when still available:

- `/tmp/holtburger-cantrip-formulas.json`: DAT facts and raw formula components.
- `/tmp/holtburger-ace-spell-effects.tsv`: server-side effect comparison.
- `/tmp/holtburger-item-spell-usage.tsv`: supporting static template usage counts.

These files are disposable investigation inputs, not build or test prerequisites.
Static template usage is supporting evidence only; generated loot and custom
content can use definitions absent from those templates.

## Classification policy

Compute the static classification once in the app host. The inspector separately
uses item provenance to decide which spell entries contribute to its summary.

1. Require the beneficial flag (`0x4`). Harmful spells are unclassified.
2. Resolve the category to a reviewed conventional profile or an Other-only
   category. Unknown categories are unclassified, not Other.
3. Other-only categories return Other regardless of name or power.
4. Within a conventional category, recognize an exact leading tier word followed
   by a space: Feeble, Minor, Moderate, Major, Epic, or Legendary. This preserves
   authored tier labels, including historical aliases.
5. Otherwise match power exactly to the category's conventional tier anchors.
   A unique match yields that tier; absent or conflicting matches yield Other.

Do not interpolate, round, infer tiers across categories, or consult duration.
Do not require `0x400`: it is `ExcludedFromItemDescriptions`, and valid cantrips
such as Hermetic Link and several older named spells lack it. Names alone never
establish membership in a cantrip category.

Rare mismatches between power, description, and server bonus are an accepted
presentation tradeoff. A tier label describes this static classification, not a
guarantee of numeric effect equivalence on every server. For example, under this
policy Corrupted Essence is Major (power 15), while Ardent Defense and True
Loyalty are Other (power 12).

### Compact profile seed

This table records observed DAT anchors for implementation review. It is not a
runtime spell-ID table. Omitted tiers have no inferred breakpoint.

| Categories                                              | Power → tier                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 293,333,337,339,343,347,349,353,355,359,361,365,367,369 | 1 Minor; 2 Major; 25 Epic; 35 Legendary                                                           |
| 261,263,265,267,269,271,311,313,331,363,371,595         | 3 Feeble; 5 Minor; 10 Moderate; 15 Major; 25 Epic; 35 Legendary                                   |
| 251,253,255,299,335,351,357,646                         | 5 Minor; 10 Moderate; 15 Major; 25 Epic; 35 Legendary                                             |
| 381,383,385,387,391,393,395,397                         | 1 Minor; 2 Major; 3 Epic; 4 Legendary                                                             |
| 666,669,672,675,678,698                                 | 1 Minor; 2 Major; 10 Moderate; 25 Epic; 35 Legendary                                              |
| 287,289,401,405                                         | 10 Minor; 15 Major; 20 Epic; 25 Legendary                                                         |
| 257,259,407                                             | 15 Minor; 30 Major; 45 Epic; 60 Legendary                                                         |
| 285,291                                                 | 1 Minor; 2 Major; 20 Epic; 25 Legendary                                                           |
| 297,602                                                 | 10 Moderate                                                                                       |
| 329,389                                                 | 3 Minor; 5 Major; 6 Epic; 9 Legendary                                                             |
| 377,654                                                 | 5 Minor; 15 Major; 25 Epic; 35 Legendary                                                          |
| 323                                                     | 1/2 Minor; 3 Major; 5 Epic; 7/10 Legendary; 4 ambiguous → Other                                   |
| 345                                                     | 1 Minor; 15 Major; 25 Epic; 35 Legendary                                                          |
| 379                                                     | 20 Minor; 40 Major; 60 Epic; 80 Legendary                                                         |
| 399                                                     | 10 Minor; 20 Major; 25 Epic; 40 Legendary                                                         |
| 403                                                     | 1 Minor; 2 Major; 20/50 Epic; 25 Legendary                                                        |
| 425                                                     | 5 Feeble; 10 Minor; 15 Moderate; 20 Major; 25 Epic; 30 Legendary                                  |
| 437                                                     | 5 Minor; 10 Major; 25 Epic; 35 Legendary                                                          |
| 422,423                                                 | Standard prefix only; named spells always Other. Shared power 500 does not distinguish strengths. |

Category 323 is deliberately approximate for unnamed spells: a value can match a
different effect family's ladder. Standard names still give the correct authored
tier. Accept this limitation rather than grow a spell-ID exception registry.

Additional Other-only category seeds from explicit stacking descriptions are
413,414,415,416,428,517,527. Before adopting each whole category, review all its
members and verify its relationship to the normal spell categories. The previous
14-spell count is a discovery seed, not an instruction to keep only those IDs.
Other special categories found during the audit should be documented and either
included by the same evidence standard or explicitly deferred; do not expand to
every beneficial category merely because it differs from a normal buff.

The category-level review included every DAT member of those seven categories:
4 in 413, 2 in 414, 3 in 415, 3 in 416, 1 in 428, 6 in 517, and 1 in 527.
All are beneficial, and the families consistently represent effects authored as
layering above ordinary spells/cantrips or the corresponding named family members.
The implementation therefore includes each whole category as Other.

Seven beneficial spells begin with `Minor` outside the reviewed categories:
Mists of Bur, Ward of Rebirth, Skin of the Fiazhat, Vision Beyond the Grave,
Evil Thirst, Gift of the Fiazhat, and Eyes Beyond the Mist. They are quest or
special-effect families with unrelated categories. They remain unclassified;
their adjective alone is insufficient evidence of cantrip membership.

## Completed corpus audit

The production classifier was run over all 6,266 definitions in the recorded DAT
corpus. It classified 528 spells across 79 categories:

| Tier      | Count |
| --------- | ----: |
| Feeble    |    20 |
| Minor     |    88 |
| Moderate  |    58 |
| Major     |    92 |
| Epic      |    84 |
| Legendary |    69 |
| Other     |   117 |

All 264 unique spell IDs generated by ACE's 66 canonical loot families retained
their authored Minor/Major/Epic/Legendary tier. All 358 standard-prefix anchors
inside the reviewed categories agreed with their prefix. Category 323 power 4
and every absent/nonstandard breakpoint remain Other as designed. The seven
prefix-looking spells listed above were the only standard prefixes excluded by
the category gate, and none were canonical ACE loot cantrips.

## Ownership and contract

```text
DAT SpellBase
  → content SpellReference (raw category/power if needed)
  → app host classifier → SpellDetails.cantripTier
  → existing reference transport/cache
  → item presentation joins intrinsic entries to references
  → compact tier-count pills beneath the item icon
```

- `holtburger-dat`: no new decoding should be necessary.
- `holtburger-content`: only raw facts needed by the host; no indicator policy.
- App host: a small stateless classifier and colocated typed tier enum, preferably
  in `host/src/spell_references/cantrips.rs`, integrated by the parent module.
- App frontend: typed reference consumption, intrinsic-entry filtering, count
  aggregation, loading state, and pill presentation. `ClientItemInspection`
  owns a left hero rail containing `ClientInspectionArtwork` and the pills;
  artwork loading remains isolated inside the existing artwork component.
- Diagnostics: existing tooling provides corpus facts. An app-host diagnostic can
  run the actual classifier over all definitions. Do not make shared tools depend
  on frontend policy or duplicate the classifier in a census script.

Proposed wire field on known `SpellDetails`:

```text
cantripTier: "feeble" | "minor" | "moderate" | "major" |
             "epic" | "legendary" | "other" | null
```

`null` means the known definition does not meet the classifier's membership rule.
Keep missing and failed reference variants distinct; they do not imply null.
Do not add a separate `isCantrip` flag or expose raw power/category to the browser
solely to repeat the classification there. Update Rust serialization, Zod schema,
and all affected reference fixtures together.

## Inspector behavior

- Count unique intrinsic spell IDs whose classification is non-null. The active
  enchantment high bit is already decoded; do not reimplement bit handling.
- Include the item-provided spell list as reported, including primary/proc spells.
  The summary describes spells the item contains, not guaranteed equip bonuses.
- In the hero's icon column, wrap `ClientInspectionArtwork` and a pill list in a
  dedicated left rail. Render the pills immediately below the artwork rather than
  near the later Spells section. Do not teach `ClientInspectionArtwork` about
  spells; it remains reusable icon presentation.
- Render one compact pill per nonzero tier, ordered Feeble through Legendary with
  Other last. Visible labels are `Feeb.`, `Min.`, `Mod.`, `Maj.`, `Epic`, `Leg.`,
  and `Other`, with distinct tier colors. Append counts such as `Min. ×2`;
  omit `×1` for a single spell.
  The pill list has an accessible `Cantrips` label and each pill's accessible name
  includes its full tier and count. Pills may wrap within the icon column but must
  not widen or displace the item identity column materially.
- Do not add tier labels to individual spell rows. The pills are the single compact
  presentation of this derived fact; existing spell names, descriptions, and
  active-enchantment annotations remain unchanged.
- If all lookups finish with no classified intrinsic spells, omit the summary.
- While relevant references load, show a loading state. If any relevant lookup
  is missing/failed, retain known counts and add one compact incomplete indicator
  in the pill area. It must not claim that an unresolved spell is a cantrip.
- Reset derived results when inspection changes; late responses must not publish
  counts for the previously inspected item. Active-only references do not make
  the intrinsic summary incomplete.
- Use text as well as any color styling. Reuse existing inspector/theme styling.
  Visual placement and appearance remain subject to user acceptance.

Target layout:

```text
┌──────────┬────────────────────────────────┐
│  [icon]  │ Item name                      │
│          │ Level and description          │
│ [Minor]  │                                │
│[Epic ×2] │                                │
│ [Other]  │                                │
└──────────┴────────────────────────────────┘
```

The pills belong to the hero rail, so they stay visually associated with the item
at the top of a long inspection. They should form a short wrapping or vertical
cluster under the existing 64 px icon inside the current approximately 84 px
artwork column. Exact padding, color, and wrapping are a visual acceptance detail.

## Phased implementation

### Phase 1 — Compact classifier and corpus audit

- [x] Implement the app-local enum, category profiles, prefix handling, and exact
      breakpoint lookup. Comment the flag semantics and deliberate ambiguous cases.
- [x] Audit all members of the Other-only category seeds; record category-level
      inclusion decisions and additional explicitly deferred families here.
- [x] Run the actual classifier over the complete DAT table using production
      decoding. Produce sorted diagnostic rows and counts by tier/category, plus
      standard-prefix disagreements, ambiguous powers, and unknown candidate groups.
- [x] Cross-check the 264 canonical ACE loot spells: every one must retain its
      authored Minor/Major/Epic/Legendary tier. Inspect every disagreement.
- [x] Record the resulting counts and accepted approximations. Do not compare
      totals against the superseded ACE-effect-based 522-spell classification.
- [x] Add small in-memory unit fixtures for standard prefixes, named exact matches,
      missing breakpoints, harmful spells, unknown categories, shared-category
      ambiguity, prefix-only categories, and Other-only categories.

Acceptance: no dense ID table, no duration/ACE database dependency, deterministic
results, canonical tiers preserved, and each exceptional policy explained.

### Phase 2 — Reference contract integration

- [x] Add raw category/power to the content reference only if needed by the chosen
      projection path; the host already has the parsed table.
- [x] Populate `SpellDetails.cantripTier` using the classifier once per projected
      reference; retain existing caching and transport.
- [x] Extend the strict frontend schema and affected fixtures/contract tests.
- [x] Verify classification survives icon preparation failure and that missing
      definitions remain distinguishable from known non-cantrips.

Acceptance: the browser receives and validates the tier without recomputing it;
existing spell reference consumers continue to work.

### Phase 3 — Item icon pills

- [x] Add a small pure app-local presentation helper for intrinsic spell joins,
      unique counts, tier ordering, and loading/incomplete state as needed.
- [x] In `ClientItemInspection.svelte`, replace the bare artwork node in the hero
      with a left-rail wrapper containing the unchanged artwork component and the
      derived pill list. Integrate with existing spell loading and failure handling.
- [x] Style compact, wrapping pills through the existing inspection-window style
      ownership. Keep the identity column readable and avoid a new general badge
      component until another real consumer proves the abstraction.
- [x] Add focused tests for mixed tiers, duplicate IDs, intrinsic plus active copy
      of the same spell, no cantrips, missing definitions, and inspection replacement.
- [x] Exercise the real component through the browser harness with mixed-tier,
      Other, active-only, and failed-reference fixtures. Capture reviewable screenshots.

Acceptance: pills render beneath the item icon in canonical order; active effects
do not inflate counts; unknown lookups never masquerade as a complete zero count;
the identity column remains readable; no stale item results.

### Phase 4 — Cleanup and validation

- [x] Remove duplicated classification attempts and unused fields/helpers; keep
      comments and UI vocabulary consistently using Other rather than Special.
- [x] Run Rust formatting, focused host/content tests for touched behavior, and
      clippy with warnings denied for affected packages.
- [x] From `apps/holtburger-3d`, run `npm run check`, focused `npm run test:ts -- ...`,
      `npm run lint:ts`, and `npm run lint:dead`; check formatting of touched files.
- [x] Run `npm run harness:browser -- ...` for component integration evidence.
      Do not run the interactive TUI. Permanent tests must use checked-in/synthetic
      fixtures, not depend on the untracked HBA or local ACE database.
- [x] Present screenshots to the user for visual acceptance.

Keep the implementation proportional: one compact classifier, one contract
field, and a small aggregation/rendering change. A generic rule engine, generated
spell database, or broad shared-semantic refactor requires reassessing scope.

## Risks and accepted concessions

- Prefixes are display text and can change with custom/localized data. Category
  membership gates their use; named spells still have the power path.
- Different server effect values can disagree with labels. This is accepted;
  do not reintroduce server-specific exceptions to eliminate rare differences.
- Shared categories can mix effect families. Ambiguous power 4 in category 323
  is Other; other cross-family matches remain an acknowledged approximation.
- The exploratory census did not exhaustively classify every extra bonus system.
  Audit included categories fully and state excluded families explicitly rather
  than claiming universal detection.
- The displayed spell list does not prove an effect is currently active or applies
  merely by equipping the item. Avoid wording that makes that claim.

## Definition of done

- [x] Accepted compact policy implemented app-locally and audited against the corpus.
- [x] Revised census results and remaining approximation boundaries recorded.
- [x] Reference contract carries a single typed result with explicit lookup failures.
- [x] Inspector displays correct intrinsic pill counts beneath the icon, including
      Other and an honest incomplete state.
- [x] Targeted tests, type checks, lint, and browser verification pass.
- [x] User completes visual acceptance; no staging or commits unless requested.

Implementation and visual acceptance are complete. Pill spacing uses flex gap
with an explicit margin reset to override the inspector's vertical-list spacing.
