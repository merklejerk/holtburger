# H3D character creator improvements

Status: complete. Implementation, machine verification, user visual acceptance, and final code-quality review are finished.

## Context and boundaries

Goal: Make character creation informative and easy to adjust while preserving player choices across race changes.

In scope:

- Persistent two-icon gender toggle below the name input, removed from Appearance and hidden for both Olthoi variants.
- Preserve gender during appearance randomization and race changes.
- Preserve the existing per-race/per-gender appearance memory.
- Preserve attributes and skills across race changes; reconcile only incompatible choices and budget overruns.
- Move starting-town selection from Race to Review.
- Show selected-race lore and mechanical benefits on Race.
- Add themed decrement/increment controls on either side of Appearance sliders.
- Animate the Face/Body camera transition.
- Expand attribute descriptions using the skill disclosure pattern.
- Highlight the complete hovered skill row, including its adjustment controls.
- Preview starting Health, Stamina, Mana, and numerical skill values for ordinary races as allocations change, and summarize them on Review. Omit these previews for both Olthoi variants.

Out of scope: server rule changes, a general character-builder framework, character templates UI, TUI redesign, Olthoi starting-stat prediction, equipment/buff/leveling simulations, and unrelated creator layout changes. Starting-stat previews describe the normal creation rules supported locally; server acceptance and any custom server initialization remain authoritative.

## Ground truth and existing patterns

| Source | What it establishes |
| --- | --- |
| `apps/holtburger-3d/src/client/ClientCharacterCreator.svelte` | Step layout, name overlay, disclosures, body appearance cache, `changeBody`, `changeHeritage`, review and submit gating. Race changes currently call `initialCreationDraft`; `changeHeritage` explicitly selects the first gender. |
| `apps/holtburger-3d/src/client/client-character-creation.ts` | Initialization, separate appearance/clothing randomizers, budget accounting, preview request coalescing. Appearance randomization already preserves gender. |
| `apps/holtburger-3d/src/client/client-character-creation-build.ts` | App-local attribute bounds and skill actions; costs and minimum tiers arrive resolved in the catalog. |
| `apps/holtburger-3d/src/client/client-character-creation-contract.ts` | Browser creation contract and validation. Extend together with host projection. |
| `apps/holtburger-3d/host/src/character_creation.rs` | Typed catalog projection: heritage budgets, defaults, resolved costs, minimum training, gender choices, and allowed starting towns. |
| `crates/holtburger-content/src/character_gen.rs` | DAT creation catalog; `skill_costs_for_heritage` applies race overrides and interprets specialization costs. |
| `crates/holtburger-content/src/character_titles.rs` | Existing localized token hashing and StringTable join pattern; inspect its repository-loading callers before adding another loader. |
| `crates/holtburger-core/src/character_gen.rs` | Shared minimum advancement and authoritative build validation; normal submission requires exact attribute spend. |
| `ACE/Source/ACE.Server/Factories/PlayerFactory.cs:141` | Attribute values are submitted directly and validated against the race budget. |
| `ACE/Source/ACE.Server/Factories/PlayerFactory.cs:175` | Race-specific training/specialization overrides and server-applied masteries/innate augmentations. `GetMasteries` and `SetInnateAugmentations` are the mechanical reference. |
| `ACE/Source/ACE.Server/Factories/PlayerFactory.cs:606` | Common attribute bounds; Olthoi bypass the normal creation branch and require separate investigation. |
| `acclient-eor-source/acclient.c:182584` | `gmCGHeritagePage::Update`: localized race text tokens, including `ID_CharGen_AluvianText`, `ID_CharGen_GaruText`, and race-specific bonus-skill text. |
| `acclient-eor-source/acclient.c:476563` | `SkillSystem::InqAttributeDescription`: six embedded retail attribute descriptions. |
| `apps/holtburger-3d/src/client/client-pregame-scene.ts` and `client-pregame-camera.ts` | Imperative camera composition and camera-cell residency; current framing installs the target pose immediately. |
| `apps/holtburger-3d/src/app/ui-base.css`, existing creator buttons, `UiTabPanel.svelte` | Existing chrome, controls, keyboard policy, and retained page lifecycle. Reuse these. |
| `apps/holtburger-3d/src/harness/browser/PregameCreatorHarness.svelte` | Production creator with static content and synthetic server outcomes; extend for machine verification. |

Evidence limits: retail proves which lore tokens are requested, but their actual DAT payloads and coverage have not been inspected yet. Do not promise coverage or author missing lore from memory. The current creator accounts for racial costs and required training, but does not expose masteries or innate augmentations and does not calculate numerical skill values.

## North stars

1. Preserve explicit player choices unless a proven game constraint prevents it.
2. Preserve the build and reconcile only incompatible choices; keep the Race page focused on lore and benefits.
3. Compute each rule once at its owning layer and pass the result through typed contracts.
4. Keep frontend reconciliation policy and presentation inside h3d. Content lookup belongs in `holtburger-content`; reusable game semantics belong in `core` or `world` as appropriate.
5. Prefer existing controls, disclosures, and renderer lifecycle over new frameworks.
6. Keep animation state imperative and bounded by the existing scene lifetime.
7. Use source-backed prose and mechanics; distinguish narrative from actionable benefits.

## Contracts, flows, and decisions

### Race change transaction

```text
current draft + selected heritage + catalog + appearance memory
    -> app-local pure reconciliation
    -> reconciled draft
    -> publish once + request one preview
    -> existing host builder validates on submission
```

The result is the reconciled draft. No report metadata or retained notice state is needed. Keep appearance randomness outside pure build reconciliation.

Proposed deterministic reconciliation policy:

1. Preserve name and gender identity. Validate that the target heritage supports that gender; never silently select its first entry. The content census determines how unsupported choices are presented (see open questions).
2. Save outgoing appearance and restore the target race/gender's cached appearance, or initialize it once with that body's valid choices. Appearance indices are body-specific and cannot be copied blindly.
3. Preserve the starting town if allowed by the target race. Otherwise choose its first authored allowed town. No town choices is an explicit unsupported/error state.
4. Preserve attribute values within catalog bounds. If the new budget is lower, remove one point at a time from the highest current attribute above minimum, resolving ties in the existing attribute tuple order, until the draft fits. This retains relative investment without a wholesale reset. Leave newly available points unspent for the player; retain existing submit gating.
5. Preserve every usable skill's tier, promoting to the new race's required minimum and lowering unavailable tiers to the highest legal tier. Inactive wire slots remain inactive; a removed free-training entitlement does not itself erase the player's trained choice if they can afford it.
6. Reprice with the target race's resolved costs. If over budget, remove optional specialization steps before optional training steps. Within each pass, downgrade the step with the largest refund first; tie-break by skill ID. Remove zero-refund optional specialization when needed to unlock its paid training refund. Never go below the target race's minimum. Recompute after each step; do not assume specialization costs are totals.
7. If mandatory choices alone exceed budget, fail explicitly as an inconsistent/unsupported catalog rather than erasing requirements or looping. Validate that the minimum attribute allocation fits, too.
8. Return the current reconciled build without a Race-page report. Do not restore an old race's build over the player's current build.

The reduction order is a proposed UX decision, not retail behavior. Tests must make it explicit. Core validation remains authoritative; do not put frontend reduction preferences in shared crates.

### Reference information ownership

```text
DAT decode (dat) -> localized reference lookup (content)
ACE-proven reusable racial semantics (core, where needed)
    -> narrow host catalog projection
    -> browser contract
    -> Race lore/benefits and attribute disclosures (h3d)
```

Use the existing string-loading path; no per-selection disk lookup. Preserve paragraph boundaries and display text safely, without interpreting DAT strings as arbitrary HTML. Prefer authentic lore prose. If the text needs rewriting for the requested lore-like style, record its source and preserve its factual meaning.

Race benefits should distinguish free/required skills, masteries, and innate augmentations. Generate free-training explanations from the same resolved skill facts used by the editor. Trace each mastery/augmentation's actual effect before adding percentages or numerical claims. If shared semantics already exist, reuse them. If they do not, introduce only the narrow reusable facts needed for these explanations, with citations; do not encode server rules in Svelte or mislabel hardcoded ACE rules as DAT fields.

Attribute descriptions are known to exist in the retail executable. First inspect whether appropriate localized DAT descriptions also exist; use one explicit source path, not an implicit fallback chain. If using the embedded text, preserve a source citation alongside the canonical reference data.

### Camera lifecycle

```text
Face/Body cold control -> target fitted camera pose
existing scene frame -> interpolate from currently displayed pose -> install pose
                    -> resolve residency for that displayed position
dispose/hide -> cancel transition and release existing scene resources
```

Use a short tunable eased duration (initial proposal: 250 ms). Reversing midway starts from the current pose. Keep the initial fit immediate; animate explicit Face/Body changes. Resize/model changes must resolve a fresh valid fit without reviving an obsolete target. Honor reduced-motion preference. Frame positions and interpolation progress never enter Svelte `$state`. Preserve rotation interaction, model placement, lighting, and the existing visibility/limited-framing decisions. Headgear visibility already changes with face mode; exercise this asynchronous preview path explicitly.

## Phased implementation

### Phase 1: Prove content coverage and mechanical facts

Deliverables: a content census recorded here; precise loader and semantic-owner decisions before extending contracts.

- [x] Inspect actual race lore/bonus strings using retail token mappings and the existing StringTable decoder, including all offered heritages.
- [x] Census gender IDs, attribute/skill budgets, required tiers, allowed towns, and exceptional Olthoi rules for offered races.
- [x] Trace masteries and innate augmentation effects through ACE consumers; compare existing shared code before adding representations.
- [x] Locate localized attribute descriptions or choose the cited embedded retail definitions explicitly.
- [x] Record missing content and unsupported creation cases with exact evidence. Do not invent lore or assume all races follow human creation rules.

Acceptance: every offered race has a documented source/coverage outcome and feasible required build, or a precise existing support limitation. Any unsupported-gender case is resolved before Phase 3.

Decisions/course corrections: pending evidence. Do not turn this phase into implementing an unsupported race's entire creation system.

### Phase 2: Add narrow reference contracts and information UI

Deliverables: content lookup, any required reusable semantic projection, host/browser contracts, Race information, and attribute descriptions.

- [x] Extend the existing content assembly path and host catalog projection with sourced lore, attribute descriptions, and the minimum facts needed to explain racial benefits.
- [x] Keep localized reference text in content and mechanical rules in their appropriate shared semantic owner; annotate new fields/types and cite unintuitive mappings.
- [x] Update browser schemas and all catalog fixture producers together; avoid optional defaults that hide an incomplete migration.
- [x] Render selected-race prose with paragraphs and a clearly separated mechanical-benefits section.
- [x] Add attribute disclosures matching skill behavior, with allocation controls outside the disclosure activation target.
- [x] Cover lookup mappings, missing/duplicate/malformed required content, and contract integrity with synthetic checked-in fixtures.

Acceptance: selected-race information uses the actual current heritage; required text failures are visible and actionable; the editor's racial costs and displayed training benefits agree; attribute controls do not toggle disclosures accidentally.

Decisions/course corrections: pending. Missing optional lore must have an explicit visible unavailable state if accepted; malformed required catalog data is an error.

### Phase 3: Preserve and reconcile race changes

Deliverables: app-local pure reconciliation in the existing creation/build modules, replacing the initialization path used for race switching.

- [x] Implement the transaction and deterministic adjustment order above, consuming resolved catalog facts.
- [x] Keep `initialCreationDraft` for first initialization only; replace race-change reset logic completely.
- [x] Retain appearance memory, name, supported gender, valid town, and all compatible allocations.
- [x] Keep reconciliation output limited to the draft; preserve existing preview coalescing and rejection handling.
- [x] Unit-test unchanged-budget preservation, lost/free training, changed specialization cost, required promotions, illegal tiers, lower/higher budgets, tie-breaking, minimum-only infeasibility, invalid towns, and repeated race changes.
- [x] Verify reconciled complete builds against the host/shared builder using asset-independent fixtures. Verify incomplete drafts remain editable and blocked from submission as appropriate.

Acceptance: valid choices survive switches; results are deterministic and idempotent for the same target; no budget overruns or forbidden tiers escape reconciliation; compatible player choices are preserved.

Decisions/course corrections: proposed reduction order above is the default pending user feedback.

### Phase 4: Reassess the remaining integration

- [x] Review actual contract/line-count growth and delete duplicate reference mappings or cost calculations.
- [x] Walk a complete race switch through body cache, catalog facts, UI state, preview, and submission.
- [x] Resolve any exceptional race rules from the census; narrow unsupported scope explicitly rather than introducing guessed compatibility.
- [x] Revisit remaining UI/camera steps against the resulting code and update this plan with discovered debt.

Acceptance: one rule owner per fact, one race-change path, and no unresolved major integration decision before further implementation.

### Phase 5: Creator controls and interaction polish

Deliverables: `ClientCharacterCreator.svelte` and existing app-local control/style primitives as justified.

- [x] Move gender selection into a persistent large two-icon overlay below the name, with selected state, accessible names, and busy/loading guards. Remove the old Appearance selector.
- [x] Keep both user-invoked and new-body appearance randomization gender-neutral; verify race changes retain gender by identity.
- [x] Move the starting-town select to Review; remove its Race markup and stale labels.
- [x] Add themed decrement/increment buttons beside every Appearance slider, using each slider's step, bounds, and existing change handler. Disable at endpoints; do not wrap values. Retain swatch controls as swatches.
- [x] Highlight the whole skill row on hover, including disclosure and action areas; use theme tokens and preserve disabled/action legibility. Include deliberate keyboard focus styling consistent with global keyboard policy.
- [x] Preserve busy guards, retained tab state, native slider keyboard behavior, and game keyboard ownership. Do not add panel-specific blur/focus hacks.

Acceptance: one gender control and one town control remain; buttons reach exactly the same values as sliders; row highlighting is continuous across controls; accessibility names and selected/disabled semantics are machine-verifiable.

Decisions/course corrections: visual acceptance belongs to the user. Reuse existing theme chrome before adding feature CSS.

### Phase 6: Animate camera focus

Deliverables: pregame scene/camera owner and focused camera tests; no reactive animation transport.

- [x] Add the smallest transition state needed in the imperative owner, using the existing frame clock and scene lifetime.
- [x] Implement eased retargeting, immediate initial framing, reduced motion, and completion without continual idle invalidation.
- [x] Resolve camera residency for the interpolated pose; preserve character/scene visibility behavior.
- [x] Exercise headgear preview resolution, race/gender changes during motion, resized viewport, hidden creator, reopening, and disposal.
- [x] Test start/midpoint/end, interruption without discontinuity, elapsed-time progression, and cancellation with an injected clock.

Acceptance: explicit Face/Body changes traverse intermediate poses and land on the existing fitted targets; reversal begins at the displayed pose; no frame-hot Svelte state or leaked frame work is introduced.

Decisions/course corrections: proposed 250 ms easing is tunable and subject to user visual acceptance.

### Phase 7: Cleanup and verification

- [x] Remove obsolete reset code, moved-control CSS, stale terminology, duplicate mappings, and temporary diagnostics without consumers. Keep initialization and reconciliation purposes distinct.
- [x] Review final line-count growth, touched types, rule ownership, and unnecessary abstractions.
- [x] Run `npm run check`, `npm run lint:ts`, `npm run lint:dead`, `npm run format:check`, and focused `npm run test:ts -- <affected test files>` in `apps/holtburger-3d`.
- [x] Run relevant Rust package tests, formatting checks, and `cargo clippy` with `--all-targets -- -D warnings` for changed packages, including the host when its projection changes.
- [x] Extend and run `npm run harness:browser -- ...` using the creator fixture; inspect supported flags before choosing the invocation. Collect machine evidence for switching, costs, controls, submission gating, camera progression, and browser errors.
- [x] Do not run the TUI. Do not retain tests that require untracked DAT assets; use local assets only for diagnostics and source census.
- [x] Hand visual acceptance to the user: overlay composition, icon treatment, prose, hover contrast, sliders, and animation feel. Do not perform agent visual acceptance unless requested.

Acceptance: required static/unit/runtime checks pass, or exact external prerequisites and remaining failures are reported with evidence; visual acceptance is explicitly tracked as pending until reviewed by the user.

### Phase 8: Prove starting-stat inputs and reuse the shared calculator

Extension agreed after the initial implementation: show live starting vitals beneath attribute allocation, numerical values beside skill training controls, and a compact summary on Review. Both Olthoi variants (heritages 12 and 13) omit these previews entirely. Preserve their existing editor behavior; this extension does not implement their server-defined builds.

Ground truth for this extension:

| Source | Rule or existing capability |
| --- | --- |
| `crates/holtburger-dat/src/file_type/secondary_attribute_table.rs` | Decodes max-vital formulas from portal record `0x0E000003`; reference formulas are Health = Endurance / 2, Stamina = Endurance, Mana = Self. Production must consume the loaded table. |
| `crates/holtburger-world/src/player/stats_calc.rs` | Existing attribute-formula rounding, untrained usability, vital evaluation, skill evaluation, and augmentation application. `derive_skill_value` and `SkillCalculationContext` already support shared skill computation. |
| `ACE/Source/ACE.Server/Factories/PlayerFactory.cs` | Normal creation applies submitted attributes, initializes full vitals, invokes training/specialization, and grants innate augmentations; both Olthoi variants bypass that branch. |
| `ACE/Source/ACE.Server/WorldObjects/Player_Skills.cs:171` | Creation-trained skills receive 5 ranks (526 XP); specialized skills instead have 0 ranks and an initial level of 10. These bonuses are alternatives, not cumulative. |
| `ACE/Source/ACE.Server/WorldObjects/Entity/CreatureSkill.cs` | Formula applies only to usable skills; untrained usability uses the DAT `MinLevel`. Base/current values differ through augmentation rules. |
| `ACE/Source/ACE.Server/WorldObjects/Entity/CreatureVital.cs` | Vital maximum includes its starting value and ranks as well as the attribute formula. Verify normal player-template seeds before assuming they are zero. |
| `ACE/Source/ACE.Server/Factories/PlayerFactory.cs:539` | Aluvian, Gharundim, Sho, and Viamontian receive Jack of All Trades, contributing 5 to current skill values through the existing calculator. Other innate effects must not be invented as flat skill bonuses. |
| `apps/holtburger-3d/src/client/client-character-creation.ts` | `CharacterCreationServices` is the existing production/harness seam; appearance resolution takes appearance-only inputs and should stay independent. |
| `apps/holtburger-3d/host/src/shared_host_content.rs` | Existing static-content request boundary; add the stat query here without requiring a connected character or loading world systems. |

Ownership and proposed flow:

```text
loaded DAT skill/vital tables (content)
draft heritage + six attributes + complete skill advancement vector
    -> narrow static-content host query
    -> core creation evaluator seeds normal starting ranks/initial levels/innate benefits
    -> existing world stat calculator evaluates those inputs
    -> typed starting-stat result
    -> h3d allocation pages and Review
```

Core owns reusable creation initialization rules. World owns derived-stat arithmetic. Content supplies decoded tables; the host adapts typed requests/results. Svelte owns display placement and request lifetime, with no second skill/vital calculator in TypeScript. First try the existing `PlayerState` calculation API with transient calculation inputs, without constructing a live world/session. If that requires unrelated player hydration or synthetic network events, extract the smallest pure evaluator inside world and migrate the existing player caller to it; do not keep two arithmetic paths or introduce a general simulation framework.

- [x] Verify ordinary player-template vital and skill seeds, rounding at fractional boundaries, formula-free skills, untrained usability, and all currently offered innate augmentations against the sources above. Trace any nonzero template seed to a locally available authoritative source before promising complete values.
- [x] Define one core starting-stat evaluator using shared heritage facts and the world calculation API. Apply trained +5 versus specialized +10 exactly once; derive current skill values with applicable innate effects.
- [x] Allow bounded, legal but incomplete allocations: unspent attribute/skill credits and an empty name must not block calculation. Reject unknown heritage, malformed skill vectors, invalid attributes, and illegal tiers explicitly. Reuse existing validation primitives; keep exact-spend/name/submission validation separate.
- [x] Represent Olthoi exclusion explicitly in the result contract, rather than returning fabricated zeros or treating it as a failure. Compute applicability in the semantic owner; consumers read that result.
- [x] Use synthetic checked-in tables/fixtures to prove rounding, creation bonuses, usable/unusable untrained skills, no-formula behavior, racial current bonuses, and incomplete allocations. Check at least one complete build against the existing builder.

Acceptance: one authoritative arithmetic path; all inputs needed for normal starting values are source-backed. If template seeds or another material rule cannot be established locally, record the specific blocker and stop before presenting incomplete numbers as complete starting values.

### Phase 9: Connect stat queries to the creator lifetime

Deliverables: a narrow typed request/result at the existing host boundary, browser schema, services implementation, and harness producer. Suggested result is a discriminated union: normal stats with named vital maxima and skill entries keyed by stable skill ID, or an explicit Olthoi exclusion. For each skill return its calculated starting value and usability together; do not make the UI reconstruct usability from training or a zero value. No unused breakdown/telemetry fields.

- [x] Extend `host/src/character_creation.rs`, static-content dispatch, browser contracts, and `CharacterCreationServices` together, including every production transport and harness implementation found by searching service consumers.
- [x] Request only when heritage, attributes, or skill advancement changes. Name, town, gender, appearance, and Face/Body changes must not trigger stat calculation or rebuild the rendered model because of it.
- [x] Reuse the existing coalescing/lifetime pattern: one active query and the newest pending input; install results only for the current input and creator lifetime. Retain the last complete snapshot during same-race allocation edits and replace it atomically when the current query resolves. Clear it on race changes, including an interrupted switch back. Hide results on Olthoi even while an older normal-race request is in flight.
- [x] Keep allocation controls editable during calculation. Keep the existing numbers visible during same-race recalculation, expose pending state through `aria-busy`, and surface actual failures through existing error presentation. Do not replace numbers with ellipses or block submission merely because this informational query is pending.
- [x] Invalidate requests on teardown; retained page switching must not recreate the calculator, session, or renderer. Returning from Olthoi calculates the preserved/reconciled normal build.

Acceptance: machine tests with deferred responses prove latest-input behavior, race transitions, error visibility, and disposal. Stat updates are independent of appearance preview resolution and network submission.

### Phase 10: Display starting values and verify the complete flow

- [x] Add a small Health/Stamina/Mana summary beneath attribute allocation, using existing vital labels, theme typography, and layout patterns. Show maximum starting pools; creation initializes them full, so duplicate current/max notation is unnecessary.
- [x] Add a numerical starting skill value beside each training control. Label the column clearly; distinguish unusable untrained skills with an explicit unavailable treatment, even if an augmentation contributes to their calculated numeric total. Preserve hover coverage, disclosures, itemized free skills, and control geometry.
- [x] Display the same result on Review: three vitals and the selected trained/specialized skills with their values. Reuse the result and existing summary styles; no second query or recalculation for the Review page.
- [x] Omit all three preview surfaces for both Olthoi variants, using the existing explanation of server-defined allocation rather than adding repeated warnings.
- [x] Extend `PregameCreatorHarness.svelte` to exercise attribute edits, training/specialization changes, innate-bonus race changes, incomplete allocation, both Olthoi exclusions, return from Olthoi, and stale-response rejection. Verify exact values from checked-in semantic fixtures, not UI-derived expectations.

Acceptance: the allocation pages and Review agree for the same draft; derived values reflect the latest attributes, training, and applicable innate effects. User performs visual acceptance of numeric placement and readability; agent verification is structural and behavioral.

### Phase 11: Cleanup and extension verification

- [x] Review the final call graph and line growth. Remove duplicate arithmetic, unnecessary projected formula fields introduced solely for calculation, dead request paths, and temporary diagnostics. Keep the existing formula explanation contract where its disclosure still consumes it.
- [x] Run focused core/world/host tests and Clippy with warnings denied for changed Rust packages, Rust formatting, h3d type checks, ESLint, focused TypeScript tests, and formatting for touched files.
- [x] Run the canonical creator browser harness for the new host/browser/lifetime boundary and inspect machine evidence and browser errors. Retain only asset-independent unit fixtures; local DATs may support diagnostics/browser runs.
- [x] Update execution notes with proven rules, any accepted limitations, verification results, and pending user visual acceptance. Existing test results above do not verify this extension.

Acceptance: no unresolved material stat-rule gap, no duplicate calculator, no obsolete-response publication or cross-race values, and no changes to Olthoi creation or server submission semantics. Implementation was authorized by the resumed goal; visual acceptance remains with the user.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Localized lore contains old mechanical claims | Separate lore from live benefits; reconcile claims against ACE and resolved catalog facts. |
| Missing tokens or unusual gender availability | Census all offered races before designing an implicit fallback; surface explicit unsupported states. |
| Race change forces unwanted allocation loss | Preserve all compatible choices, use documented stable reduction order, without adding a Race-page report. |
| New budget leaves unspent attributes | Keep editable drafts valid for editing and preserve exact-spend submission gating; never allocate extra points arbitrarily. |
| Specialization costs or free training are counted twice | Consume existing resolved costs and minimum tiers; no second pricing implementation. |
| Racial benefit UI becomes a server-rule copy in Svelte | Reuse or add narrow shared semantic facts with source citations; frontend owns phrasing/layout. |
| Camera interpolation crosses cells or races preview completion | Resolve residency from displayed position and retarget using current valid model fit; exercise async headgear and stale requests. |
| Scope balloons into a general build simulator or Olthoi implementation | Limit previews to normal starting builds, omit both Olthoi variants, and exclude gear, buffs, and future progression. |
| Formula-only preview misses creation ranks or racial current bonuses | Seed normal creation inputs in core and call the shared world calculator; verify +5 trained, +10 specialized, and Jack of All Trades separately. |
| Static tables omit server-side starting seeds or custom initialization | Prove standard template seeds first; describe previews as normal starting rules and leave actual server initialization authoritative. Stop for material missing inputs. |
| Delayed host response shows another race's stats | Input/lifetime matching, pending-state invalidation, and explicit Olthoi exclusion; test response races with deferred promises. |

## Definition of done

- [x] All requested controls, information, and hover behavior are implemented without duplicate paths.
- [x] Gender survives both randomization paths and every supported race change.
- [x] Compatible allocations survive race switches; forced changes are deterministic.
- [x] Racial costs, required training, and benefit explanations agree with verified sources.
- [x] Every offered race has a source-backed lore outcome; all six attributes have expandable descriptions.
- [x] Face/Body transition passes temporal and lifecycle runtime checks.
- [x] Host validation remains authoritative and frontend UX policy remains app-local.
- [x] Changed-code checks pass with warnings treated as errors; no asset-dependent retained tests or unrequested commits. Repository-wide baseline exceptions are recorded below.
- [x] User visual acceptance: received after the final skill-number placement and stable-refresh changes.
- [x] Ordinary races show current starting vitals and skill values on the allocation pages and Review, using the shared rules and verified creation bonuses.
- [x] Both Olthoi variants omit numerical stat previews; switching races cannot display an obsolete result.
- [x] Preview calculations accept editable incomplete allocations without weakening submission validation, and pass focused semantic and browser lifecycle checks.

## Resolved choices and remaining acceptance

- Allocation reductions: use the explicit highest-attribute and specialization-first refund policy above unless the user prefers another order. This is a UX trade-off: predictable preservation does not infer the player's build priorities.
- Gender coverage: all offered races support both identities; the existing content requires no unsupported-gender concession.
- Lore editing: authentic DAT prose is used directly; no editorial rewrite is needed.
- Lore coverage: all mappings are present. Missing/empty required lore is a catalog error, covered by synthetic tests.
- User acceptance: received for the creator and final stat-display refinements. No agent visual acceptance was performed.

## Execution notes

### Content census and decisions (2026-10-28)

- Local `dats/assets.hba` contains creation lore in language table `0x23000002` for all 13 offered heritages. Umbraen/Penumbraen share the retail shadow token; both Olthoi variants have their own tokens with the same text. Literal `\n` pairs encode paragraphs and are normalized by the content loader. No editorial rewrite or invented lore was needed.
- All 13 heritages expose gender IDs 1 (Male) and 2 (Female). No unsupported-gender policy is required for installed content.
- All ordinary heritages and acid Olthoi have 330 attribute/52 skill credits; melee Olthoi has 60 attribute/68 skill credits. All have feasible minimum training at zero cost: Arcane Lore, Magic Defense, Jump, Run, Loyalty, and Salvaging. Normal races allow towns 0–3; both Olthoi variants allow only town 4. Production Olthoi creation remains server-specialized; this task does not replace ACE's creation path.
- DAT inspection found localized Strength help. The implementation uses the complete six-description retail `SkillSystem::InqAttributeDescription` set explicitly, rather than mixing sources or guessing further localized hashes. Text is in protocol tuple order; Coordination and Quickness differ from DAT numeric-ID order.
- Both Olthoi variants bypass normal allocation in ACE. Their benefit panel explicitly explains server-defined attributes/skills and does not claim the ordinary free-training list applies. The host prepares all applicable training explanations once from the resolved catalog; the browser only renders them.
- Innate benefits were traced through `CreatureSkill.GetAugBonus_Current`, `Creature_Rating`, `DamageEvent`, `Player_Spells.HasFoci`, and carrying-capacity calculations. The shared core projects the server-granted identities; h3d owns explanatory wording.
- Important correction: `PropertyManager.cs:604` defaults `universal_masteries` to true, and `Player_Skills.cs:646` bypasses heritage restrictions in that mode. The UI labels the old racial weapon pair as traditional affinities conditional on server rules; it does not infer the connected server's configuration. Innate augmentations and DAT training costs remain separate.
- Appearance initialization and manual randomization remain gender-neutral. The existing per-body cache is retained. Race switching no longer calls initial build construction.
- Reconciliation needs zero-refund specialization downgrades to unlock optional paid training refunds. This was added to the documented reduction policy and covered by a focused test.
- Camera movement remains in the existing scene frame, with residency resolved from the displayed position. Retargeting to an unchanged fit must retain transition start time so rotation cannot indefinitely restart animation.

### Verification

- `npm run check`: passed, zero Svelte errors/warnings; includes node, test, and Electron TypeScript checks.
- `npm run lint:ts`: passed.
- Focused `npm run test:ts`: 63 passed across creator, contract, pregame scene, and presentation-root tests. Covers changed costs, free/required training, forbidden/inactive tiers, refund ordering/ties, lower/higher budgets, immutable inputs, idempotence, gender identity, towns, and temporal camera behavior.
- `cargo test -q -p holtburger-content -p holtburger-core -p holtburger-3d-host character_`: 115 passed (10 host, 17 content, 88 core).
- `cargo clippy -p holtburger-content -p holtburger-core -p holtburger-3d-host --all-targets -- -D warnings`: passed.
- Rust formatting and focused Prettier checks for every changed TypeScript/Svelte file: passed. New SVGs were formatted with the HTML parser.
- Repository-wide `npm run lint:dead` reports an unlisted `python` binary from the existing package script. Repository-wide `npm run format:check` reports only `scripts/cdp-client.test.ts`. Both exact failures were reproduced on an isolated clean HEAD archive, with output in `/tmp/h3d-creator-baseline-checks.txt`; those unrelated files were not changed.
- The initial browser attempt could not bind its loopback content server under the sandbox (`Operation not permitted`). The escalated `npm run harness:browser -- --pregame-preview --brief` passed, with proof in `/tmp/h3d-creator-browser-proof.json`. The final rerun after cleanup also passed, with proof in `/tmp/h3d-creator-browser-proof-final.json`: zero browser errors, all creator workflow assertions true, 26 prepared bodies, and 16 distinct focus-transition poses.
- The checked-in `crates/holtburger-core/tests/fixtures/character_creation_reconciliation.json` is consumed by the browser reconciler test and the Rust builder test: both agree on target costs/requirements, the browser produces the exact expected tiers, and Rust rejects the original over-budget allocation then admits that result without runtime assets.
- Browser evidence covers the production creator, host builder admission/retry, preserved race/gender/build choices, remembered appearance, slider endpoints/step, lore/help, lower-budget reconciliation, exact-spend gating, all 26 race/gender body preparations, 16 focus-transition poses, stable rotations, and scene/resource retirement.
- Temporary DAT census binaries were removed. Retained unit tests use synthetic fixtures; local DATs are only used for diagnostic/browser verification.

### Final code-quality review

Reviewed the complete changed feature, including untracked text/icon files and immediate callers. Contract inventory: content table -> lore paragraphs -> host catalog -> browser schema -> Race/disclosure markup; core benefit enum -> app-local benefit wording; app-local reconciliation -> reconciled draft -> preview and host submission; cold focus selection -> imperative scene transition -> rendered camera residency and teardown. The browser harness exercises real producer output across those seams.

Removed the race-reset path, old gender selector, Race town selector, duplicate Review town summary, and redundant preview on clicking the selected gender. Benefit variants now enforce the normal/Olthoi distinction; their augmentation enum is exhaustive for the host consumer. Unknown-race behavior remains an explicit error. No shared crate owns frontend reduction order or camera UX.

Accepted costs: source-backed text assembly, one cohesive pure reconciliation function, a small scene-owned transition, and focused verification code add lines. No general reconciliation framework, extra animation loop, per-frame reactive state, broad static-data loader, or numerical skill calculator was introduced. Traditional weapon affinities are explicitly conditional on server rules. No unresolved structural finding remains within the reviewed feature; user aesthetic acceptance is pending.

User feedback: gender buttons should be round with a stronger mutually exclusive selected appearance; remove the Race-page allocation report; show free skills as itemized names under one heading. The report state, result metadata, and report-only tests were deleted. Benefit prose and typed, alphabetized training groups now cross the host/browser contract separately. Gender appearance belongs to the pregame theme so its selected state overrides the theme's ordinary hover treatment. No commits or staging were performed.

Earlier follow-up verification: 33 focused creator/contract tests and 3 host character-creation tests passed; full TypeScript/Svelte check, ESLint, host Clippy with warnings denied, Rust formatting, and focused Prettier checks passed. `/tmp/h3d-creator-review-feedback-proof.json` records a successful production creator/browser lifecycle run with zero browser errors, including computed round geometry, distinct active/inactive button colors, and exact itemized skill groups. Visual acceptance remains with the user.

Current gender treatment: glyph stroke is authored at 3. One 64 px base size owns the layout slot, button, and proportional 48 px glyph. Inactive controls apply one 0.8125 transform to the complete button, producing a 52 px circle and 39 px glyph together. Fixed slots keep centers stable, with a 16 px gap. The row starts 24 px below the name area. Blue/pink icon hues no longer change with selection, and the gold selected fill was removed. Overall control scale and a subtle highlighted border/ring indicate selection. The user explicitly authorized hiding the toggle for both Olthoi variants; IDs 12 and 13 hide it without changing the stored gender choice.

Olthoi visibility verification: `npm run check` and `npm run lint:ts` passed. The production creator browser harness passed with zero browser errors (`/tmp/h3d-creator-olthoi-gender-proof.json`), checking that both Olthoi variants hide the control while retaining the Female draft value, and that returning to the original race restores the selected Female button.

Earlier sizing verification (superseded by proportional consolidation): static source analysis found explicit state-dependent icon color overrides, which were deleted. The browser fixture now snapshots each glyph before/after selection and checks constant icon width, height, stroke color, stroke width, and center; selected-button size must be larger, and the row must have clearance from the name input. `npm run check`, `npm run lint:ts`, and focused Prettier checks passed; the browser run passed with zero errors (`/tmp/h3d-creator-gender-sizing-proof.json`), including selection-size reversal, stable icon geometry/color/stroke/centers, name clearance, and retained Olthoi visibility behavior.

Consolidation correction: the prior fixed-glyph implementation shrank only the surrounding circle. It was replaced with one base dimension, proportional glyph sizing, and a transform on the complete inactive button. The browser check now requires matching button/glyph scale ratios while retaining hue, authored stroke styling, centers, name clearance, and Olthoi visibility behavior. No new component abstraction was introduced.

Proportional-control verification: TypeScript/Svelte checks, ESLint, focused formatting, and the production browser harness passed. `/tmp/h3d-creator-cohesive-gender-proof.json` records zero browser errors; the new assertions verify that both glyphs scale proportionally with their circles in both toggle directions while hue, authored stroke styling, centers, name clearance, and Olthoi behavior remain correct.

Appearance step-button correction: the generic two-column `.creation-variant` rule was overriding the earlier appearance-specific four-column rule, and the arrows used text-action sizing. The appearance modifier now has explicit precedence, both arrows use compact icon-button semantics with 24 px dimensions, and a shared pregame round-button class owns circular chrome for both gender and step controls. The browser fixture now checks every appearance row for circular compact controls flanking and vertically aligned with a positive-width slider, alongside the existing step/bounds behavior.

Appearance step-button verification: TypeScript/Svelte checks, ESLint, focused formatting, and the production browser harness passed. `/tmp/h3d-creator-slider-buttons-proof.json` records zero browser errors and verifies every appearance slider has compact circular controls on either side, aligned on the same row, with working increments and disabled endpoints.

Expanded attribute descriptions now use the same `creation-description` wrapper and theme styling as skill descriptions, including indentation, spacing, wrapping, and muted text. The former skill-specific class was renamed across both consumers and styles rather than copying its rules.


### Starting-stat extension: rules and integration (2026-10-28)

- SELECT-only inspection of the running local ACE World database verified WCID 1 (`human`): six primary starting values of 55, all purchased ranks/XP zero; Health/Stamina/Mana `init_Level` and `level_From_C_P` are all zero; no `weenie_properties_skill` rows exist. `CharacterHandler` selects this template for ordinary characters, and `PlayerFactory` replaces primary values and initializes submitted active skills. Existing vital `current_Level` values (28/55/55) are replaced with the calculated maxima during creation.
- The shared core evaluator applies trained ranks of 5 or specialized initial level of 10, then invokes the existing world calculator with the selected heritage's innate augmentation. It consumes the loaded skill and secondary-attribute tables. No TypeScript stat arithmetic was introduced. Both Olthoi variants return an explicit exclusion before normal allocation validation.
- The world calculator now offers an unenchanted attribute-input constructor and its existing skill evaluation/breakdown API; no world activation, synthetic packets, XP table, or network session is needed. Existing submission attribute/skill validation is reused, with exact attribute spending still required only by submission. Preview-specific checks enforce minimum tiers and unavailable advances. The now-unused `CharacterGenBuild::attribute_total` method was removed after validation moved to the shared attribute tuple.
- A host-owned lazy rules service retains one coherent parsed catalog/skill/vital set. Production shared-content dispatch and the diagnostic HTTP host use the same service. The browser's allocation request contains only heritage, attributes, and skill advancement.
- Appearance and stat requests share one app-local latest-request primitive while preserving distinct display policy: appearance retains a usable visual; same-race stat edits retain a complete numerical snapshot until its replacement is ready. The snapshot is retired immediately on a race change. A new race has no numerical surfaces until its current result arrives; Olthoi never display normal previews. Identity, town, appearance, gender, and Face/Body changes do not recalculate stats.
- Skills & Stats shows full starting pools and skill values beside each skill name, in the theme accent color, with adjustment arrows on the right; unusable untrained skills display an unavailable dash rather than a misleading innate-bonus total. Review consumes the same result for vitals and trained/specialized skill values. Actual errors use existing error presentation and calculations do not gate submission.
- `character_creation_starting_stats.json` supplies independent numerical expectations shared by core tests and the browser workflow: 55 in every attribute yields 28/55/55 vitals, and Aluvian Melee Defense yields 42/47/52 across untrained/trained/specialized. The browser also checks the authored formula and the five-point difference when switching to Gear Knight. The production browser workflow passed these exact values and the authored formula-order check.


Starting-stat extension verification:

- `npm run check`: passed with zero Svelte errors/warnings, including test and Electron TypeScript checks. `npm run lint:ts`, touched-file Prettier checks, `cargo fmt --all --check`, and final Clippy for core/world/host with `--all-targets -- -D warnings`: passed.
- Focused creator/contract/pregame scene/presentation-root TypeScript tests: 67 passed. This includes allocation coalescing, cosmetic/name deduplication, stale normal/Olthoi responses, current errors, and disposal through the shared request owner.
- Core `character_` tests: 93 passed, including the new numerical fixture, incomplete drafts, training/specialization seed differences, usability, malformed formulas, normal builder admission, and explicit Olthoi exclusion. Full world library tests: 1,024 passed, 3 ignored. Full host library run: 393 passed and one sandbox-denied UDP-bind failure; that exact startup/disconnect test passed when rerun with loopback access, completing the 394 host tests.
- Production browser harness: `npm run harness:browser -- --pregame-preview --brief` passed with `passed: true`, zero browser errors, `startingStatsVerified: true`, preserved race/build choices, obsolete-response rejection, no appearance resolution from name/stat edits, and zero retained local surfaces. Evidence: `/tmp/h3d-starting-stats-browser-proof-verified.json`.
- The first browser attempt overlapped a source reload and failed an existing slider assertion, so it was discarded. The stable run then exposed a fixture-only authored-order mismatch: the DAT names Quickness before Coordination for Melee Defense. A direct static-host census proved the actual formula and all three numerical tiers for Aluvian and Gear Knight; the fixture and synthetic table now preserve that authored order. The final stable workflow passed.
- Repository-wide dead-code checking still reports only the existing unlisted `python` package-script binary when run with source revision environment variables; global formatting still reports only the existing `scripts/cdp-client.test.ts`. These match the baseline exceptions proved during the initial implementation; neither unrelated file was changed.
- Final seam/quality review: loaded tables -> host-cached rules -> core creation seeding -> existing world arithmetic -> explicit normal/Olthoi result -> strict browser contract -> allocation-only request owner -> Skills & Stats and Review. Inspected production service, shared command allowlists/dispatch, diagnostic HTTP transport, creator/presentation/showcase harness services, coalescing tests, and the actual browser producer/consumer flow. No duplicate TypeScript calculator, live-player bootstrap, per-frame reactive state, or general build-simulation layer was introduced. No unresolved structural finding remains within this extension.
- Starting-vital placement and skill-number readability were subsequently accepted by the user. Agent checks remained structural and behavioral.


### Skill-level placement and stable refresh follow-up

- Skill levels now sit immediately beside their names inside the disclosure summary, using the pregame theme's gold accent color. The adjustment arrows remain in their separate right-hand group. Name-based machine probes now read the dedicated name span, so changing numbers cannot change skill identity.
- Same-race allocation updates retain the last complete vital/skill snapshot until the current host result arrives, replacing all derived values together. Pending work remains exposed through `aria-busy`; numerical ellipsis placeholders and the former support-only pending flag were removed. A race change retires the stored snapshot immediately, including a switch back before the intervening query completes. Current errors and Olthoi exclusion remain explicit.
- Verification: Svelte/TypeScript checks, ESLint, focused formatting, and 38 creator/contract tests passed. The placement browser run passed (`/tmp/h3d-skill-level-placement-proof.json`); the final combined browser run also passed (`/tmp/h3d-stable-stat-values-proof.json`), both with zero browser errors. The final workflow verifies name proximity, distinct computed text colors, unchanged visible numbers while a stat response is deliberately held, refreshed values after release, race/Olthoi behavior, and zero retained local surfaces.
- User visual acceptance was subsequently received; the user requested a final code-quality review and commit.


### Final accumulated code-quality review and commit preparation

Verdict: ready within the reviewed scope, after fixing the stale browser-probe consumers below. The user accepted the visual result and explicitly authorized the commit.

Reviewed all 32 changed/new files against HEAD `08717edfd`, including deleted paths, the new lore/starting-stat modules, icons, JSON fixtures, and this working plan. Inspected the immediate callers and source references for these seams:

- DAT StringTable -> content lore lookup -> host catalog -> strict browser schema -> Race prose and shared attribute/skill descriptions.
- Core heritage benefits and resolved training costs -> host benefit wording/itemized groups -> Race explanations; traditional weapon affinities remain conditional on server mastery rules.
- Current draft -> app-local pure reconciliation -> body cache/preview -> host/shared submission validation, including incomplete allocations and infeasible catalogs.
- Host-cached static tables -> core creation seeds -> existing world stat arithmetic -> typed normal/Olthoi projection -> every production/harness transport -> latest-request owner -> allocation and Review surfaces. Same-race snapshots and request revisions have distinct purposes; no duplicate TypeScript arithmetic or live-player hydration was added.
- Face/Body controls -> character service -> imperative scene transition -> displayed-pose cell residency -> persistent renderer, including resize, interruption, reduced motion, hidden state, and teardown.

Confirmed findings, fixed before commit:

1. The broader `client-presentation-probe.mjs` consumer still expected the removed Appearance Body dropdown. It now selects the permanent gender buttons and compares gender-specific appearance memory. Its Review assertions now target the Review identity/attribute sections rather than counting summaries across retained hidden tabs.
2. The same probe's generic `.ui-mono` formula lookup could select the new numeric skill label. Formula checks now explicitly target the description wrapper; name-based training checks use the dedicated skill-name span.
3. An inherited tab-order expectation in that touched probe omitted Settings. HEAD already contains the Settings button and the same stale expected list; the expectation now includes it. No selection or keyboard-policy production code was changed.
4. Renamed the copied `visual` response variable in the diagnostic stat endpoint to `stats`, matching its actual contract.

Consolidation decisions: retain the small app-local latest-request primitive for its two concrete consumers; keep their visual/stat snapshot policy separate. Reuse world arithmetic and core allocation validation without a general simulator. Keep frontend budget-reduction order, layout, and camera policy inside h3d. Keep reference prose in content and game benefits in core. Independent raw-formula validation at the display and calculation boundaries remains justified because both public paths accept raw static data. No remaining demonstrated ownership, contract, lifecycle, or unjustified-production-abstraction finding was identified. This verdict does not claim new support for custom server initialization or Olthoi numerical builds.

Final verification: 68 focused TypeScript tests and 120 focused Rust tests passed; Svelte/TypeScript checks, ESLint, Clippy for content/core/world/host with all targets and warnings denied, Rust formatting, and formatting of every changed frontend/fixture/icon passed. The dedicated creator browser workflow passed with held-response number-stability checks (`/tmp/h3d-stable-stat-values-proof.json`). The broader production client presentation workflow passed after the probe fixes (`/tmp/h3d-creator-review-presentation-proof-final.json`), including creator, gameplay, roster keyboard navigation, reentry, connection loss, and shutdown, with zero browser errors. Existing repository-wide unlisted-`python` and `cdp-client.test.ts` formatting exceptions remain documented above and unchanged.

Commit scope excludes the pre-existing untracked contents in the ACE and ACViewer submodules. No retail-decompile modifications, temporary diagnostic binaries, runtime-asset unit tests, or unrelated baseline fixes are included.
