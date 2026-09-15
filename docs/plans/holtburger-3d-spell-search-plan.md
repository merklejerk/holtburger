# Spell search and automatic filter tags

Status: complete. Implementation, automated validation, user visual/manual acceptance, and final code-quality review are complete.

## Goal and boundaries

Make large known-spell lists easy to narrow using word-level fuzzy name search intersected with category-based tag filters.

In scope:

- Automatic beneficial/harmful, school, retail spellbook level, targeting, and damage/protection classifications.
- A search input and an ungrouped, wrapping row of themeable filter pills in the existing floating spells panel.
- Match any selected tag within each category, require every selected category and every search term.
- Reviewed category mappings and evidenced spell-ID exceptions for damage associations.
- Resource-lifetime regression checks and measured browser responsiveness.

Out of scope: casting, spell-bar drag/drop, custom keyboard navigation, saved searches,
server spell-data packaging, TUI changes, a general tagging framework, and speculative
search indexing or list virtualization. Existing stable spell IDs and independent
resource owners must remain suitable for the future spell bar. Visual and interactive
acceptance belongs to the user. This plan does not reopen the previous inspection plan.

## North stars

1. Tags help discovery; they do not establish castability or combat damage truth.
2. Derive facts once at their owning layer; consumers render or match them.
3. Prefer a small pure classifier and matcher over registries, query engines, or tries.
4. Filter visibility without changing knowledge, fetching formulas, or unloading artwork.
5. Unknown data must remain visible without filters and must not acquire guessed tags.

## Ground truth and measured evidence

References relative to repository root:

| Source | Evidence |
| --- | --- |
| `acclient-eor-source/acclient.c:189654` | Retail spellbook filtering calls the rough level heuristic. |
| `acclient-eor-source/acclient.c:429357` | Formula tier maps to level: tiers1–6 unchanged,7–8 subtract1,9–10 subtract2. |
| `acclient-eor-source/acclient.c:465529` | Power-component tier lookup; already decoded by our DAT code. |
| `acclient-eor-source/acclient.c:387490` | Casting selects self first, then formula-derived untargeted/selected-target routes. |
| `acclient-eor-source/acclient.c:429344`, `:464887`, `:464934`, `:464327` | Formula completeness and targeting-component interpretation. |
| `ACE/Source/ACE.Entity/Enum/SpellCategory.cs` | Named categories for protection, vulnerability, projectiles, and other effects. |
| `ACE/Source/ACE.Entity/Enum/SpellFlags.cs`, `SpellType.cs`, `ItemType.cs` | Self/fellowship flags, effect types, authored target masks. |
| `ACE/Source/ACE.Server/Entity/Spell.cs:135` | Fellowship is flag OR effect type11–14; known missing-flag cases. |
| `ACE/Source/ACE.Server/WorldObjects/Player_Magic.cs:436`, `:1379` | Self validation and item-target redirection. |
| `ACE/Source/ACE.Server/Entity/SpellProperties.cs:236` | Actual damage EType/stat modifier keys come from server DB, absent from client spell base. |

Census performed 2026-09-15 with production ContentRepository/SpellTable decoding of
local `dats/assets.hba`. All 6,266 static records were included; this is not a census
of learnability or one character's knowledge.

- 556 used categories; four absent from ACE category enum (700–703): Honeyed
  Life/Mana/Vigor Mead and Twisting Wounds. No elemental association established.
- Schools: War691, Life1501, Item1079, Creature2919, Void76.
- Retail levels I–VIII: 1053,735,847,472,502,1345,720,592. No unknown level in corpus.
  Raw tier9 appears in four Arcane Death/Pyramid records and maps to VII.
- 476 names ending in I–VIII disagree with retail filter level. Summon Primary Portal
  I/II/III maps to IV/V/VI. Never use the suffix or icon tier as the filter level.
- Self flag:2083. Non-self authored targets:3571 creature,330 other nonzero masks,282 zero.
- Fellowship:200, including six without the flag;142 also have self flag.
- Formula-derived targeting disagrees with the authored target field on zero/nonzero
  for46 non-self records, including Frost Blast. A filter must not become a casting API.
- Candidate damage mapping:1203 records across125 categories. Counts before exception
  review: Acid171, Bludgeoning177, Frost142, Lightning159, Fire191, Piercing169,
  Slashing139, Nether55. These are candidates, not certified coverage.
- An explicit-description phrase check found22 conflicts. This is a lower bound on
  suspicious records, not proof that the other records are correct.

Exception candidates requiring disposition:

- Nether Blast5544–5551: FireBurst category, description says nether.
- Clouded Soul5331: ElectricRing, description says nether.
- Lesser Elemental Fury2781–2784 and Essence's Fury3904–3907: BludgeoningStrike,
  descriptions say acid/fire/cold/electric respectively.
- Flame Grenade4092: PiercingStrike, description says fire.
- Present4269/Table4270: BludgeoningMissile, descriptions say slashing/piercing.
- Flame Blast3662 and Volcanic Blast2710: fire categories, descriptions say acid.

Exclude Fireworks from fire. Categories642/643 lower general damage/healing ratings;
do not infer nether damage merely from their category names. Category636–638 nether
DoT handling is corroborated by `WorldObject_Magic.cs:2025`.

Investigation artifacts currently reside at `/tmp/spell-tag-census/`,
`/tmp/spell-tags.json`, and `/tmp/spell-category-census.tsv`. This plan retains the
important findings independently of those temporary files. Re-run a temporary
production-decoder diagnostic if absent; do not retain tests dependent on local DATs.

Search prototype: Node24.13.1, normalized name words,512/1000/all6266 real records
sorted by ID, eight queries,100 warmup and1000 measured batches. Each sample averages
one eight-query batch. Median/p95 milliseconds per query:512=.055/.067;
1000=.119/.140;6266=.696/.766. Total name characters146544, maximum52.
No DOM, IPC, icons, or tag rejection included. This supports scanning; browser cost
must still be measured.

## Product behavior and contracts

### Search

Normalize names into lowercase Unicode letter/number words once per loaded reference
set. Normalize query using the same tokenizer once per change; punctuation separates
words. Each query word must be a character subsequence of at least one individual
name word. Word order does not matter; repeated terms are redundant, and one name
word may satisfy multiple terms. Do not let a match cross word boundaries.

`acid prot` matches Acid Protection VII; `amr oth` matches Armor Other. This is
abbreviation matching, not edit-distance typo correction. Keep alphabetical ordering
and spell ID tie-breaking. No debounce or worker initially.

### Filters

One ungrouped wrapping row: Beneficial, Harmful, target, school, damage/protection, and level pills. Labels normalize Cold/Frost to
Frost, Electric/Electrical/Lightning to Lightning, Flame/Fire to Fire, and physical
types to Bludgeoning/Piercing/Slashing. School includes War as well as Creature,
Life, Item, Void. Levels expose I–VIII for current content.

Selected pills union within each category and intersect across categories. Categories
without selected pills are unrestricted. Search intersects the resulting set and every
search term must still match. Acid+Frost includes either damage type; adding Life
requires Life school as well. Self+Beneficial excludes harmful caster spells.

Provide one Reset button clearing search and filters, a right-aligned result count,
and a distinct no-matches state. The disclosure says Filters with the selected count;
no matching-rule caption. Keep the flat wrapping pill row, category colors, and stable
pill ordering. Add theme-token spacing below expanded filters.

Target classification is discovery policy, not an exhaustive set of legal recipients.
Phase1 must finalize and document labels and exact predicates before UI work. Proposed
Self means authored self-routing flag; Other means non-self creature-directed spells;
additional Item target, Untargeted, Fellowship pills preserve distinctions. Fellowship
can overlap Self. Item target describes authored masks, including spells that permit
creature redirection. Do not implement Other as !Self. Resolve the46 discrepancies
explicitly for discovery classification, without changing the existing casting code.
If source evidence cannot support a clean label/predicate, narrow that tag's coverage
and record omissions rather than infer legal targeting.

Retain search/filter state across close/reopen for the current character, resetting
on character replacement. Store this cold view state in an app-local owner surviving
panel mount; do not put it in the shared core or host session protocol. Preserve the
existing resource lifetime. Collapse an expanded row when filtering hides it; clearing
filters does not automatically reopen it.

### Ownership

- **DAT:** decoded authored data only; reuse component tier decoding.
- **Content:** typed static discovery classification alongside `SpellReference`.
  Pure category/exception and retail-level interpretation belongs here. Do not build
  an authoritative combat model from descriptive metadata.
- **World:** only proven reusable targeting semantics if extraction is necessary;
  avoid duplicating existing self/fellowship decisions. No filter strings or pills.
- **App host:** narrow projection in `host/src/spell_references.rs` through existing
  load-spell-references command; no new query or event required.
- **Frontend:** strict schema in `src/app/spell-references.ts`; pure name matcher,
  selected tag IDs, labels, and panel interaction policy. Reuse school already in
  details; do not add a second school fact. Keep icon power tier distinct from level.

Prefer typed classification fields over a shared bag of presentation strings.
Damage association may be empty or plural; determine the minimal supported shape
from reviewed evidence. Preserve unresolved versus confidently absent classification
only if the diagnostic consumer needs that distinction; do not add unused provenance
fields to the wire contract. Keep exception evidence beside the mapping in code.

## Phases

### Phase 1 — Finalize classification evidence and predicates

- [x] Review all125 candidate categories; create an explicit category-ID mapping.
- [x] Give each of the22 conflicts a disposition: independently corroborated correction,
  stale-description/category evidence, or unresolved and excluded from damage tagging.
  Do not promote descriptions alone to verified gameplay truth.
- [x] Check available local ACE/server reference data read-only for disputed effects.
  If unavailable, use the unresolved disposition; importing server datasets is out of scope.
- [x] Review unassigned categories for omitted elemental associations; record coverage
  and limitations, including unknown700–703. No runtime spell-name/description parser.
- [x] Finalize Target pill predicates and source precedence using the46 discrepancies,
  portal/self overlap, item redirection, and fellowship exceptions.
- [x] Record reviewed mapping counts and any omissions here. Keep a reproducible
  diagnostic recipe; fixtures used by committed tests must be self-contained.

Acceptance: every candidate conflict has a documented disposition; every target pill
has an exact, evidenced meaning. No unsupported damage override. Classification can
be implemented without further guesses. A broad authoritative-data dependency is a
scope change to raise, not an implicit prerequisite.

### Phase 2 — Static classification through the existing reference path

- [x] Add focused classification types/helpers under `crates/holtburger-content/src/spells*`.
- [x] Reuse decoded tier; compute separate retail filter level. Preserve unknown values
  without a false tag. Add comments and source citations for exception mappings.
- [x] Extend `SpellReference`, app-host projection, and frontend strict schema together.
  Reuse existing school. Do not tie classification availability to icon success.
- [x] Update reference fixtures and `ClientHudHarness.svelte` using production schemas.
- [x] Test tier boundaries, category normalization, corrections/exclusions, targeting
  overlaps, unknown content, and projection/schema preservation with synthetic data.

Acceptance: content/host tests and frontend checks pass; missing artwork does not
prevent filtering by valid metadata; no new host command, formula fetch, or account
requirement. All consumers use the producer's classification.

### Phase 3 — Pure matching and cold view state

- [x] Add an app-local pure spell-search helper and focused tests.
- [x] Precompute normalized name words on reference publication; compose tag rejection
  and all-term matching without sorting or normalizing every record on each keystroke.
- [x] Add character-scoped search/filter state in the existing app composition; choose
  the smallest owner compatible with `ClientSpellState` lifetime, not a generic store.
- [x] Keep unknown/missing rows searchable by their existing fallback name; they match
  no metadata tags for which facts are absent.
- [x] Test cross-word rejection, word-order independence, case/punctuation, empty and
  repeated terms, tag unions intersected with search, unknown metadata, and deterministic ordering.

Acceptance: the specified truth table passes; no fuzzy match crosses words; filter
updates perform no host work. State survives panel remount and resets by character.

### Steering checkpoint

- [x] Trace known membership → references → classification → visible rows → expansion.
- [x] Confirm new fields have consumers and there is no duplicate school/classification
  derivation, parallel cache, or resource owner created by filtering.
- [x] Review exception/omission scope; flag any product-significant coverage gap.
  Otherwise continue without requiring a routine approval.

### Phase 4 — Panel controls and accordion integration

- [x] Update `src/client/ClientSpellsPanel.svelte` with search and ungrouped pill buttons,
  accessible labels/pressed state, clear actions, count, and no-matches messaging.
- [x] Keep controls anchored above the scrolling list. Use existing theme colors,
  typography, focus styling, and discoverable density tokens for new controls.
- [x] Retain keyed rows and hide nonmatches while retaining the full known reference/resource set.
- [x] Collapse hidden inspection and unsubscribe its consumer; retain persistent main
  and component artwork leases. Do not prune known spells when filtering.
- [x] Maintain current load/error/empty states and independent spell-ID identity.
- [x] Add no custom keyboard handlers/navigation; native input editing remains normal.

Acceptance: synthetic browser probe verifies tag union and all-term search semantics, controls/clear behavior,
empty results, expansion collapse, close/reopen state, and character reset.

### Phase 5 — Browser and performance verification

- [x] Extend `src/harness/browser/client-spells-probe.ts` and its fixture with realistic
  names/classifications and1000+ known spells. Exercise typing through production UI.
- [x] Measure matching separately from input-to-DOM update across repeated representative
  queries and restrictive/unrestrictive pill selections. Record browser, fixture size,
  repetitions, median/p95, and any long tasks. Node figures are context only.
- [x] Initial acceptance target: p95 input-to-updated-results below50ms on the documented
  harness setup, with no new browser errors. If exceeded, identify the measured cost
  and steer the plan before adding indexing or virtualization.
- [x] Verify filtering/clearing adds no reference/formula requests except deliberate
  inspection work; retained artwork URLs survive hide/show and close/reopen.
- [x] Exercise delayed references plus character reset so stale results cannot replace
  the new character's search state or list.
- [x] User acceptance: appearance, typing feel, pill density, scrolling, and accordion
  behavior. Accepted by the user with “lgtm” on 2026-09-15.

### Phase 6 — Cleanup and completion

- [x] Remove temporary asset-dependent diagnostics from the repository; retain meaningful
  synthetic tests and useful browser probes. Sweep superseded naming and fixtures.
- [x] Review added lines/abstractions: eliminate duplicate classifications and redundant
  state. Keep category exceptions localized and evidence commented.
- [x] Run affected Rust tests/Clippy with warnings denied, frontend tests, type/Svelte
  checks, lint, formatting, and browser probe using existing manifest scripts.
- [x] Record final coverage, performance results, limitations, and outstanding user
  acceptance. Do not stage or commit unless separately requested.

## Risks and accepted concessions

- **Category data is imperfect:** explicit reviewed exceptions; ambiguous records receive
  no damage association. Discovery tags are not a combat authority API.
- **Server/custom content can differ:** static classification reflects installed content;
  do not silently apply live-server claims or parse descriptions as a fallback.
- **Target labels can overpromise:** expose authored/discovery distinctions and separate
  them from eventual cast targeting; source disagreements are documented.
- **Composition follows visible color categories:** the option catalog owns both
  category styling and grouping; do not duplicate the category mapping.
- **DOM may dominate latency:** measure browser updates before choosing virtualization.
- **Filtering may disturb lifetimes:** full membership remains authoritative; visibility
  cannot release persistent spell resources or key future actions by row index.

## Definition of done

- [x] Reviewed classification and exception dispositions are implemented and tested.
- [x] Every name term matches; filters union within categories and intersect across categories and with search.
- [x] Missing metadata/artwork, remount, character changes, and async completions behave correctly.
- [x] No custom keyboard navigation; new controls use the theme system.
- [x] Required automated checks and documented browser performance gate pass.
- [x] User visual/interactive acceptance is recorded, or clearly reported as pending.

## Resolved decisions

Targeting predicates and damage exceptions were verified during execution. Filters
union within each category and intersect across categories and with search. Search
persists across panel remounts and resets with the character. The measured browser
gate passed. No open acceptance gates remain; earlier pending notes below record
the implementation history.

## Execution findings and decisions — 2026-09-15

Phase1 found local `ace-holtburger-db` with all6266 `ace_world.spell` records.
Read-only exports of id/name/EType/StatModType/StatModKey corroborated35 exceptions
in mapped projectile categories and six additional projectile IDs in generic vital
categories (3908,3911,4067,4113,4239,6156). No production database dependency was added.
Every mapped Float resistance/armor StatModKey agreed with the category mapping.

The original22 description conflicts are resolved by server precedence: Nether
Blast5544–5551, Lesser Elemental Fury2781–2784, Essence's Fury3904–3907, Flame
Grenade4092, Present4269 and Table4270 use verified EType corrections. Essence's
Fury3904–3907 all use acid despite three descriptions claiming other elements.
Clouded Soul5331 remains lightning; Flame Blast3662 and Volcanic Blast2710 remain
fire. Those three descriptions disagree with server data; they are not overrides.
Additional mapped mismatches include Nether Streak5370 and several monster effects;
all41 identity/category corrections are enumerated alongside their source in
`crates/holtburger-content/src/spells/classification.rs`.

155 EType associations outside the candidate mapping were reviewed:128 Fireworks
records,16 general damage/healing curses, five enchantment projectiles,
and six generic-category damaging projectiles. Fireworks and the21 debuff effects
remain without a damage/protection tag: an EType field alone does not make the spell
a damaging effect. The six damaging projectiles receive explicit associations.
Category700–703 remains unassociated. Total classified damage/protection records1209;
this is static installed-content discovery metadata, not a live server guarantee.

Target predicates finalized: Self uses flag8; Other uses non-self authored creature
mask16; Untargeted uses non-self mask0; Item target uses the eight other observed
masks (including portals, locks, lifestones). Unknown masks receive no target tag.
Fellowship is orthogonal (flag8192 OR meta11–14). The46 formula-target discrepancies
use authored mask precedence for discovery only. Existing casting semantics remain
outside this classifier. No reusable world helper was needed for this static projection.

First browser performance trial with1024 named spells plus a missing definition failed
at p95=71.1ms while alternating empty/full result sets. To avoid repeated row DOM
construction, the panel now retains keyed rows and toggles native `hidden` for
nonmatches. This preserves accessibility exclusion and reduces repeated DOM work,
at the cost of retaining the already-created row DOM while the panel is open.
No trie or virtualization added. Follow-up measurements passed; final results below.

Corrected the explanatory abbreviation example from `acr oth` to `amr oth`:
Armor contains no c. The matcher and test now demonstrate the intended subsequence rule.


## Final automated acceptance

- Production classifier census:1209 damage/protection associations: Acid177,
  Bludgeoning163, Frost149, Lightning161, Fire186, Piercing169, Slashing140, Nether64.
  Other5057 records have no association. All6266 have known retail levels/target
  classifications. All non-null server EType values were individual types, not
  combinations; a nullable single association is sufficient for the observed corpus.
- Final browser:1024 named spells plus one missing definition, four queries repeated
  20 times in separate input tasks. Median input-to-DOM5.5ms, p95=7.1ms; matching
  mean=.1925ms, p95=.4ms. No long tasks observed during the search measurement window.
  Query timing ends after Svelte DOM commit, not after presentation to the screen.
- Initial-policy name/tag intersections, same-group AND (superseded below), expanded-row hiding, saved query after
  remount, character reset with held metadata, and existing icon retention probes pass.
  Search/filter operations issued zero content requests. Inspection remains separately
  exercised by the existing formula/context-refresh tests.
- Tests:308 host +86 content Rust tests,16 focused frontend tests pass. Affected
  all-target Clippy with warnings denied, Svelte/TypeScript checks, ESLint, formatting
  and diff whitespace checks pass. Debug host binary rebuilt for the extended response.
- Final logs: `/tmp/spell-search-browser-acceptance2.log`,
  `/tmp/spell-search-rust-final.log`, `/tmp/spell-search-tests-final.log`,
  `/tmp/spell-search-clippy-final.log`, `/tmp/spell-search-check-final3.log`,
  `/tmp/spell-search-lint-final3.log`, `/tmp/spell-search-build.log`.
- A supplemental browser run was interrupted by development hot reload during comment
  formatting; the final run held sources stable and exited0. No product regression
  was inferred from the interrupted run.
- No changes staged or committed. Temporary census/export scripts remain outside the
  repository. Remaining acceptance belongs to the user: appearance, typing feel,
  density, scrolling, and accordion behavior with a real character.


## Follow-up — ungrouped pills and spell disposition

User requested a single wrapping pill row instead of category headings. The UI now
uses one flat option list; level labels include "Level" because their group heading
is gone. Filter intersection, persistence, and resource ownership are unchanged.

Beneficial/Harmful uses the authored flag0x4, exactly as ACE `Spell.IsBeneficial`
and its complementary `IsHarmful` (`ACE/Source/ACE.Server/Entity/Spell.cs:116`).
It is independent of self targeting: Strength Self/Heal Self are beneficial;
Weakness Self/Harm Self are harmful. The local6266-record census has3344 beneficial
and2922 harmful records. Classification computes one boolean; the UI supplies the
complementary pill labels. The initial intersection policy was subsequently replaced
by the user-requested union policy below.

Focused tests cover beneficial/harmful with and without self targeting and their
intersection; the browser probe exercises the new pills with the existing large
spellbook. Visual/manual acceptance remains user-owned. No commit requested.

Follow-up validation passed:395 Rust tests,17 focused frontend tests, Svelte/TypeScript,
ESLint, affected all-target Clippy, and browser harness. Debug host rebuilt. Logs:
`/tmp/spell-beneficial-{rust,ts,check,lint,clippy,browser,build}.log`.


## Follow-up — filter union, clear icon, and category colors

User changed filter composition to global OR: empty selection is unrestricted;
otherwise any selected pill matches. Search remains AND across its words and intersects
that union. This supersedes the earlier all-pill AND behavior and its acceptance examples.
Beneficial alone excludes harmful spells; adding Self also includes harmful self spells.

The clear-search action is an icon button with accessible label and tooltip. One flat
wrapping pill row remains, with separate theme colors for disposition, target, school,
damage/protection, and level. Selected pills use stronger category fill and outline.
Focused tests and browser probes now assert union across categories and within a
category, empty selection, search intersection, and the clear icon restoring results.

Union follow-up validation passed:17 focused frontend tests, Svelte/TypeScript checks,
ESLint and browser harness. The1024-spell browser run measured7.3ms p95 DOM update
and zero filtering content requests. Logs: `/tmp/spell-union-{tests,check,lint,browser}.log`.
No Rust/host contract change was needed for this follow-up. Visual acceptance remains
user-owned; nothing staged or committed.


## Follow-up — one Reset action

The user requested one action instead of separate clear-search, clear-filters, and
clear-all controls. A single Reset button beside the search field now clears both
text and selected pills. It is available with the filters collapsed and disabled
when nothing is set. This supersedes the earlier dedicated clear icon. The browser
probe verifies both inputs reset together and the full spell list returns.

Reset follow-up: Svelte/TypeScript, ESLint, and browser checks passed. Logs:
`/tmp/spell-reset-{check,lint,browser}.log`. Visual acceptance remains user-owned.


## Follow-up — union within categories, intersection across categories

User refined the composition rule: union selected pills within each of disposition,
target, school, damage/protection, and level; intersect those categories and search.
Empty categories impose no restriction. This supersedes the earlier global union.
The option catalog now defines selectable tag identities and category membership;
selected category groups are prepared once per filter change, not once per spell.

Removed the matching-rule caption from the disclosure, right-aligned the results
count, and added the existing theme gap below expanded filters. The single Reset
button, category colors, stable row ownership and search-term intersection remain.
Tests and the browser probe verify Acid+Frost union, Life school intersection,
Life+Item school union, search intersection, and empty-filter behavior.

Category-composition follow-up passed17 focused frontend tests, Svelte/TypeScript,
ESLint and browser verification. Logs: `/tmp/spell-category-tests-final.log`,
`/tmp/spell-category-check.log`, `/tmp/spell-category-lint-final.log`, and
`/tmp/spell-category-browser.log`. Visual acceptance remains user-owned.

## Follow-up — Direct damage

Added Direct to the damage category. ACE names this DamageType.Health (0x80):
WorldObject_Magic.cs:488–531 applies Harm as a vital delta and records Health damage;
:710–734 removes the health-transfer source vital. It is not a promise of bypassing
resistance: Harm uses HealthDrain resistance.

Read-only local ACE verification used damage_Type/Boost for boosts, EType for
projectiles, and Source/TransferBitfield for transfers. Category80 HealthLowering
contains64 direct-health effects plus five existing bludgeoning exceptions, which
remain bludgeoning. Category87 contains25 hostile target-health transfers and16
beneficial self-conversions; only the hostile transfers receive Direct. Healing and
beneficial health conversions remain untagged. Four verified exceptions: Matron's
Barb3047 in category84 uses negative health Boost; Dark Vortex3914/3931/3998 in
category223 uses Health EType despite the bludgeoning category.

Production-decoder census now finds93 Direct records and1299 total damage/protection
associations; three former bludgeoning records move to Direct. No description parser
or runtime database dependency. Tests cover Harm self/other, drains, healing exclusion,
self-conversion exclusion, retained bludgeoning exceptions, and category composition.

Direct follow-up passed396 Rust tests,18 focused frontend tests, Svelte/TypeScript,
ESLint, affected all-target Clippy and browser verification. Debug host rebuilt.
Logs: `/tmp/spell-direct-{rust,tests,check-final,lint-final,clippy,browser,build}.log`.
Visual acceptance remains user-owned; no changes staged or committed.

## Final code-quality review and closeout — 2026-09-15

The user accepted visual/manual behavior and authorized closeout and commit. Review
boundary: the accumulated spell-search feature against HEAD, including new files,
its tests and this plan. Preexisting ACE/ACViewer submodule dirt is excluded.

Contract and lifecycle coverage:

- Content classification → SpellReference → host SpellDetails → strict frontend
  schema: classification is computed in content and carried unchanged. Unknown
  associations remain absent; artwork failure does not discard spell metadata.
- SpellDetails → prepared search entry → category groups → panel visibility:
  frontend policy owns labels, grouping and word matching. Every search term must
  match, selected tags union within categories, and categories intersect.
- ClientSpellState → panel mount/session events: cold query survives remount and
  clears on character reset. Full known-spell membership owns reference/icon
  lifetimes; filtering only hides retained rows and collapses hidden inspection.
- Inspected reference adapters, state consumers, synthetic fixtures and browser
  probe, including delayed references, missing records and retained artwork.

No blocking quality findings. Corrected a misplaced theme-token comment and stale
plan status. No additional runtime abstraction or indexing system is warranted.
Static category/identity exceptions remain a deliberate installed-content concession,
not server combat authority. Retained DOM costs memory but avoids measured row
recreation latency; existing browser evidence supports that choice. Adding a damage
association requires content semantics, wire validation and UI labels to agree;
those are separate responsibilities rather than duplicated classification policy.

Validation remains the final Direct follow-up checks recorded above: 396 Rust tests,
18 frontend tests, Svelte/TypeScript, ESLint, warnings-denied Clippy and browser
verification. Closeout changes only documentation and a CSS comment. Review does
not claim coverage of future casting/drag behavior, unrelated renderer code or
custom-server combat rules.
