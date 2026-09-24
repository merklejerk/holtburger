# Shared enchantments and functional status tray

Status: implementation accepted by the user on 2026-09-24. The contribution-context
correction is in the shared resolver. Final quality review and commit evidence are
recorded below.

## Goal and scope

Expose one shared understanding of player enchantments to the TUI and 3D client,
then use it to power beneficial/harmful status icons and a searchable enchantment
HUD window grouped by affected stat.

In scope:

- Shared instance identity, stacking resolution, affected-stat mapping, and lifetime semantics.
- Reconciliation of existing winner selection used by player queries and stat calculations.
- TUI migration to the shared machinery, including removal of local semantic interpretation.
- Initial state, updates, and resynchronization through core and the 3D host/browser boundary.
- Two conditional, clickable tray icons and one normally placed, resizable HUD window.
- Grouped enchantment rows, overridden children, search, disposition/school pills,
  and name/power/remaining-duration sorting.
- Focused synthetic tests, browser harness evidence, and user visual acceptance.

Out of scope: additional status conditions, casting or dispelling from this window,
other entities' enchantment browsers, a flat/grouped view toggle, and a general-purpose
tree framework. Equipment effects are included when represented in the player's
enchantment state; crawling every equipped item's separate registry is not implied.

## Agreed behavior and proposed defaults

Confirmed requirements:

- Use the known-spells panel's existing search semantics: case-insensitive word
  subsequences, with every query term matching a spell or affected-stat heading
  word. Do not replace this with literal substring matching.
- Group by affected stat. Multiple independently effective spell categories may
  coexist beneath one stat heading.
- Nest overridden instances beneath the effective instance that overrides them.
- A multi-stat enchantment may appear under multiple headings. These are repeated
  views of one instance, not separate enchantments.
- Both clients must consume the same semantic machinery.
- Clicking either icon opens a HUD window using standard layout placement and
  selects the corresponding beneficial/harmful filter.

Defaults carried forward from the discussion, subject to visual review:

- One Enchantments window, using disposition pills rather than redundant disposition tabs.
- Tray visibility is derived from unique effective ordinary spell instances, independent of the
  window's filters or repeated rows. Unknown classification must not silently mean harmful.
- An icon click opens or focuses the existing window, sets its disposition, and
  clears name/school restrictions that could hide the triggering effects. Preserve sort choice.
- Closing the window does not clear enchantments. Losing the last effect hides its
  icon but leaves an open window showing an empty state.
- Sort affected-stat headings alphabetically in name mode. Power uses the highest
  effective power under each heading, strongest first; duration uses its shortest
  effective remaining duration, soonest first. Sort roots within each heading by
  the same mode. Cycle one compact borderless button through A-Z, Power, and a clock.
  Use stable instance identity to break display ties without changing gameplay priority.
- Overridden children stay with their parent and use deterministic ordering.
  Search/filter matching a child retains its parent as explicitly contextual and expands
  the path. A matching parent does not make unrelated children match the query.
- Permanent durations have an explicit label and deterministic placement after timed
  entries. Countdown updates must not continuously reshuffle rows with equal deadlines.
- Preserve a layout-edit affordance when there are no live icons, without presenting
  sample icons as real active conditions outside layout mode.
- Keep vitae and item cooldowns in shared state but outside these two ordinary-spell
  icons and this first-cut spell window. Preserve the TUI's separate vitae display.
  This is a proposed product default grounded in their separate retail registry paths.
- Clamp timed spell countdowns at zero and show that server removal is pending.
  A local clock reaching zero does not remove a spell or promote its overridden child.

## Ground truth and current integration points

Read these sources before changing semantics; references are starting points, not
an assertion that existing implementations are correct.

| Concern | Sources |
| --- | --- |
| Wire identity, timing, modifier fields | `crates/holtburger-protocol/src/messages/magic/types.rs` |
| Current competing priority rules | `crates/holtburger-world/src/player/magic.rs`, `crates/holtburger-world/src/magic.rs`, protocol `Enchantment::compare_priority` |
| Mutation and login paths | `crates/holtburger-world/src/player/mutations.rs`, `crates/holtburger-world/src/handlers/player.rs` |
| Stat consumers | `crates/holtburger-world/src/player/stats_calc.rs`, `crates/holtburger-world/src/magic.rs` |
| ACE stacking and expiration | `ACE/Source/ACE.Entity/Models/PropertiesEnchantmentRegistryExtensions.cs`, plus its callers and server enchantment serialization |
| Retail classification and registry behavior | `acclient-eor-source/acclient.c`, starting with `CEnchantmentRegistry::UpdateSpellTotals` around line 425784 |
| Parsed spell semantics and references | `crates/holtburger-world/src/spell.rs`, `crates/holtburger-content/src/spells.rs` |
| Core event and initial publication | `crates/holtburger-core/src/client/mod.rs`, `crates/holtburger-core/src/client/types.rs` |
| TUI semantic grouping and local ticking | `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/character/render.rs`, `apps/holtburger-cli/src/pages/game/domains/player.rs`, `apps/holtburger-cli/src/pages/game/data.rs` |
| Host projection and lifecycle | `apps/holtburger-3d/host/src/client_projection.rs`, `apps/holtburger-3d/host/src/client_runtime.rs` and their event/snapshot producers |
| Browser contracts and retained state | `apps/holtburger-3d/src/client/client-host-contract.ts`, `client-presentation-session.ts`, `client-lifecycle-session.ts` |
| HUD components and placement | `apps/holtburger-3d/src/client/ClientStatusTray.svelte`, `ClientHudWindow.svelte`, `ClientWorldView.svelte`, `client-hud-layout.ts`, `client-ui-defaults.ts`, `client-settings-contract.ts` |
| Search, metadata, icon ownership | `apps/holtburger-3d/src/client/ClientSpellsPanel.svelte`, `client-spell-search.ts`, `client-spells.ts`, `apps/holtburger-3d/src/app/spell-references.ts` |
| Browser verification | `apps/holtburger-3d/src/harness/browser/ClientHudHarness.svelte`, `UiShowcase.svelte`, `apps/holtburger-3d/package.json` |

Known architectural friction:

- The player query compares power then start time. World stat helpers additionally
  handle equipment-set ties. ACE's top-layer query includes a level-eight self-aura
  preference and uses set membership in its final tie expression. These are not
  interchangeable algorithms; inspect the relevant ACE paths and inputs before unifying.
- World stat helpers filter by modifier flags/stat key before category selection.
  Prove whether a global category result preserves that behavior. Do not replace
  it with an assumed global winner if effectiveness depends on contribution context.
- The TUI groups under stats but also locally decrements start times and removes
  expired entries. Core currently publishes raw enchantment vectors. Simply adding
  the same vector to the browser would create another independent interpretation.
- Retail classifies ordinary spells using authored beneficial metadata and excludes
  IDs at or above `0x8000` from those totals. Special records and cooldowns need an
  explicit census before deciding which are panel rows or tray contributors.
- The 3D tray is currently static placeholders. Its implementation is not a live
  state contract, and the existing host projection needs enchantment integration.

## North stars and ownership

1. A stat heading is a presentation grouping, never a winner-selection key.
2. Compute each semantic decision once at its owner; both frontends read it.
3. Preserve independent layers and full instance identity. Never key live rows by spell ID alone.
4. Prefer replacing existing duplicate logic over adding another solver beside it.
5. Keep live authority and static content separate from frontend interaction policy.
6. Keep the new UI small: stat groups, expandable spell families, and existing controls.

Layer responsibilities:

- `protocol`: lossless wire types and serialization. Move gameplay priority out of
  this layer when its callers are migrated.
- `world`: enchantment identity, affected-stat semantics, stacking relationships,
  contribution context, authoritative lifetime interpretation, and stat calculation rules.
- `content`: static reference queries and parsed spell metadata. No runtime status or UI policy.
- `core`: orchestrate world/content inputs already available as parsed data and publish
  coherent reusable client snapshots/updates. Do not add archive paths to core.
- 3D host: narrow typed transport projection; no second solver or metadata classifier.
- TUI and 3D frontend: labels, display ordering, filtering, expansion, layout, and bounded
  countdown formatting. Neither frontend interprets modifier flags or selects winners.

## Contract and lifecycle sketch

Illustrative relationships, not mandated type names:

```text
Server description / enchantment mutations
              |
              v
World registry + parsed spell facts + shared time basis
              |
              v
Resolved enchantment snapshot
  instances: identity -> lifetime, power, disposition, spell reference
  contributions: affected stat -> effective roots -> overridden instance references
              |
              v
Core snapshot / update publication
       |                       |
       v                       v
      TUI              Host projection -> Browser owner
       |                                  |
       v                                  +-> unique effective instances -> tray
Grouped character display                 +-> grouped rows -> HUD window
```

- Validate the identity against description, upsert, refresh, remove, equipment-set,
  and duplicate-spell cases; the current upsert uses spell ID plus layer.
- Return semantic stat identifiers, not English headings. Represent non-stat effects
  explicitly so unsupported records remain visible and diagnosable.
- Derive ordinary live-spell disposition once from the authoritative beneficial modifier
  flag (ACE sets it from spell metadata), after classifying special records. Static
  metadata still supplies names, school, and artwork. Represent unavailable
  facts honestly; display unresolved rows with identity and diagnostic context rather
  than silently discarding them or making up names/schools.
- If effectiveness differs by affected-stat context, represent it per contribution;
  do not force a single effective boolean onto the instance. Unique tray membership
  then follows the verified rule for effective contributions.
- Use a lifetime sum type for permanent versus timed records. Anchor time once at
  receipt in the shared owner; avoid re-anchoring every unchanged entry on an update.
  Host/browser clocks require an explicit mapping or sampled remaining duration;
  process-local monotonic timestamps cannot be passed through as interchangeable clocks.
- Ordinary spell removal is server-authoritative. Frontends format time locally but
  must not independently remove effects or promote children. Removal/dispel/purge
  messages or replacement descriptions change membership and trigger shared resolution.
- Initial state, incremental changes, and resync use the same resolver. Session changes
  clear old state and invalidate pending metadata requests. Distinguish unavailable
  state from a confirmed empty enchantment registry.
- Publish on membership, semantic, or expiry changes. Display countdowns at a bounded
  cadence; do not route frame-rate or per-second full snapshots through Svelte state.

## Phase 1: Verify rules and pin the contract

- [x] Trace ACE winner selection, set membership, self-aura preference, exact ties,
  category/flag filtering, refresh/removal identity, and timing from mutation to wire.
- [x] Trace retail classification and census ordinary spells, cantrips, set effects,
  multi-stat effects, vitae, cooldowns, and records without spell definitions.
- [x] Inspect the TUI mapping and name each affected-stat case, including skills,
  vitals, armor, resistances, regeneration, and non-stat effects.
- [x] Establish whether category selection is global or contribution-specific and
  how categories layering beneath the same stat remain independent.
- [x] Record exact source citations and resolved decisions here; distinguish selection
  effectiveness from final magnitude caps or other stat-combination rules.
- [x] Define the smallest typed contract and time basis that serve both consumers.

Acceptance: every selection/classification/lifetime branch has a grounded example;
no ambiguous special record is silently forced into ordinary spell handling. Remaining
product decisions are explicit before UI implementation.

## Phase 2: Implement shared resolution and time ownership

- [x] Add focused world types/functions, colocated with existing magic semantics;
  pass required parsed spell facts explicitly instead of discovering content in world.
- [x] Resolve independent stacking groups, overridden relationships, and affected-stat
  references without duplicating instance storage for display overlap.
- [x] Reconcile `get_active_enchantments`, stat helpers, and protocol priority methods.
  Share semantic selection while preserving verified stat-specific combination rules.
- [x] Establish shared refresh/expiry behavior and coherent recomputation of derived stats.
- [x] Publish the resolved contract through core's initial and update paths.
- [x] Add asset-independent unit tests for power/ties, set/self-aura cases, multiple
  effective categories under one stat, multi-stat overlap, independent beneficial and
  harmful effects, permanent/timed effects, refresh, removal, purge, and promotion on
  authoritative removal after the countdown reaches zero.

Acceptance: shared queries and stat calculations use the same verified rules; synthetic
cases expose identical effective contributions through core. Tests use checked-in data
or constructed inputs, not installed DAT files.

## Phase 3: Migrate the TUI and reassess

- [x] Replace TUI modifier interpretation and local winner selection with shared results.
- [x] Replace local lifetime mutation/removal with shared lifecycle semantics; retain
  only display countdown formatting where needed.
- [x] Preserve useful character/stat organization and expose overridden children using
  existing TUI rendering primitives. Repeated rows retain shared instance identity.
- [x] Sweep all TUI raw-enchantment consumers, distinguishing legitimate diagnostics
  from competing gameplay interpretation. Delete obsolete state and tests.
- [x] Verify the TUI with focused noninteractive tests; do not run its interactive client.
- [x] Reassess the contract using both the migrated TUI and the forthcoming host projection.
  Resolve context-specific effectiveness, missing metadata, and timing friction now.

Acceptance: TUI rendering receives semantic groups from shared code; no TUI tick removes
or promotes enchantments. The next phases require no browser-side gameplay solver.

## Phase 4: Carry coherent state to the 3D frontend

- [x] Extend host snapshots/events, browser schemas, retained session state, and fixtures.
  Trace the actual event producer rather than assuming the projection module owns it.
- [x] Add a small app-local enchantment owner using established session and icon ownership
  patterns. Reuse static spell-reference loading and release obsolete icon owners.
- [x] Handle initial hydration, updates, resync, reconnect, character replacement, and
  late metadata replies. Retain stable instance identities through unrelated updates.
- [x] Test wire validation and lifecycle behavior, including removal during loading,
  closing/reopening consumers, and a slow metadata reply from a previous character.

Acceptance: a synthetic shared snapshot reaches the browser losslessly; lifecycle
transitions cannot display another character's effects or restart all countdowns.

## Phase 5: Functional tray and grouped HUD window

- [x] Replace placeholder status entries with beneficial/harmful buttons driven by
  effective instance presence; retain existing tray rotation and layout behavior.
- [x] Add the Enchantments window as an independent HUD window so opening it need not
  replace the existing inventory/spells panel. Integrate saved placement, sizing,
  viewport clamping, reset, settings defaults, and existing layout validation.
- [x] Implement affected-stat headings and a small expandable effective/overridden list
  with keyboard-accessible disclosure buttons and stable keys for repeated instances.
- [x] Show icon, name, and remaining/permanent duration. Clicking a spell reveals
  its authored description, with a separate disclosure for overridden children.
  Keep numeric power and raw modifiers out of row content. Preserve honest loading,
  missing-reference, empty-registry, and no-search-results states.
- [x] Reuse known-spell search matching and disposition/school pill semantics: union
  within a filter category, intersection across categories. Share narrowly useful
  control markup/styles where duplication warrants it; do not build a generic query framework.
- [x] Search the affected-stat heading together with each spell name, so terms can
  identify a stat, a spell, or both.
- [x] Implement the compact sort cycle, stable group order, contextual parent retention, and
  search-driven expansion without losing the user's manual expansion state unnecessarily.
- [x] Implement icon focus/filter behavior and bounded visible countdown updates.
- [x] Add focused frontend tests for filtering children, independent roots, overlap,
  sort ties/permanent durations, and tray state independent of filters.

Acceptance: each icon appears only for its defined live condition, opens the same
normally placed window with the correct filter, and rows express independent stacking
categories accurately. Saved layouts without the new window entry load successfully.

## Phase 6: Cleanup, verification, and visual acceptance

- [x] Remove superseded priority methods, TUI grouping/ticking semantics, unused raw
  projections, placeholder vocabulary, dead fields, and tests preserving retired paths.
- [x] Review line-count growth: new transport/UI surface is expected; duplicate semantic
  paths must decrease. Every field has a named consumer; no speculative metrics or caches.
- [x] Run targeted Rust tests and checks for affected crates; run clippy with warnings
  denied and formatting checks. Include all affected targets, not only the new resolver.
- [x] In `apps/holtburger-3d`, use existing `npm run check`, `npm run test:ts -- ...`,
  lint scripts, and formatting checks appropriate to changed files. Fix all diagnostics.
- [x] Extend `ClientHudHarness` with shared-contract fixtures and run `npm run harness:browser -- ...`.
  Exercise icon changes, clicking, filtering, expansion, sorting, resize/placement,
  server-confirmed expiry promotion, and disconnect/reconnect; collect errors and screenshots.
- [x] Present the harness scenario for user visual acceptance. Automated assertions
  establish behavior; the user judges density, hierarchy, and layout.

Acceptance: relevant checks pass, harness reports no errors, both clients share the
same gameplay machinery, and the user accepts the visual presentation. Do not retain
tests depending on untracked runtime assets or modify the retail decompile.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Collapsing independent categories beneath one stat | Separate affected-stat grouping from proven stacking keys; test concurrent effective roots. |
| Existing solvers disagree | Verify ACE inputs and branch ordering before replacing any caller; test ties explicitly. |
| Global winner loses context | Preserve contribution-specific resolution if flags/keys require it. |
| Refresh/resync resets durations | Anchor once, preserve unchanged instance timing, and test delayed snapshots and updates. |
| Different clients promote different winners at expiry | Server-authoritative membership; frontend clocks only format displays. |
| Special records create false harmful icons | Census special IDs/flags; explicit classification and inclusion policy. |
| Search makes a suppressed spell look effective | Retain and distinguish its contextual effective parent. |
| Filtered and total counts use different units | Show filtered / total contribution groups, including repeated stat rows consistently. |
| New window breaks saved layouts or replaces another panel | Integrate default placement and independent window state with existing layout machinery. |

## Definition of done

- [x] Two real status icons and one grouped, searchable, sortable HUD window work end to end.
- [x] Multiple categories can remain effective beneath the same affected stat.
- [x] Overridden children and multi-stat duplication preserve instance identity.
- [x] TUI and 3D consume shared stacking, affected-stat, classification, and lifetime semantics.
- [x] Stat calculations agree with shared selection without losing stat-specific rules.
- [x] Initial publication, updates, refresh, expiry, purge, resync, and session reset are verified.
- [x] No competing semantic implementation remains in the TUI, browser, host, or protocol.
- [x] Relevant automated checks and browser evidence pass; user acceptance recorded on 2026-09-24.

## Open questions and implementation decision log

No user answer is required to begin Phase 1. Resolve source questions empirically;
bring product choices back only if evidence materially changes the agreed experience.

- Product default for review: exclude vitae/cooldowns from these spell icons/window,
  while retaining their shared state and existing TUI presentation.
- Implementation: finish concrete contract design using the findings below; specifically
  preserve contribution-specific winners and distinguish wire receipt from local republishing.
- Visual review: stat-group order, row density, and contextual-parent styling.
- During implementation, record decisions, source citations, course corrections,
  and any remaining debt here. This plan is a working document, not durable protocol documentation.

### Implementation evidence — 2026-09-23

- `holtburger-world` owns one timestamped registry and resolves each
  affected-stat/operation/channel/category query. An ordinary skill spell and an
  attack/defense-wide spell in the same category can both contribute. A record
  with both additive and multiplicative bits appears in both operation queries.
- Core publishes resolved state on initial/current snapshots and incremental
  changes. The host transports it without selecting winners. The browser keeps
  a local receipt clock; the TUI uses the same resolved groups and no longer
  removes effects when its display clock reaches zero.
- The 3D client uses two live tray icons and an independently placed Enchantments
  window. Search shares known-spell matching, filters use disposition/school
  pills, and roots can be sorted by name, power, or duration. Metadata loading is
  keyed to the unique spell IDs so routine enchantment updates do not reload it.
- `cargo test -p holtburger-world -p holtburger-core -p holtburger-cli --lib`
  passed 900, 534, and 308 tests. The four core tests requiring loopback sockets
  passed when run outside the restricted sandbox. Clippy with warnings denied,
  `npm run check`, TypeScript lint, dead-export lint, and all 2,688 frontend tests
  passed. The full `--client-hud` browser harness passed, including the zero-time
  and server-removal sequence; it captured
  `/tmp/holtburger-enchantments-hud.png.enchantments.png`.
- The browser harness also verifies Enchantments window resize, movement,
  reopen placement, resync, delayed metadata from the retired character, and
  replacement-character recovery. A subsequent review found that programmatic
  `.click()` calls had hidden disabled pointer hit testing on tray buttons; real
  Chrome pointer clicks now pass. The shared resolver supplies canonical names
  for attributes, vitals, skills, and integer/float properties. The TUI and 3D
  panel both consume those names, eliminating the 3D numeric lookup tables;
  unknown keys retain typed numeric fallback headings. Frontends still choose
  their own heading wording, such as "Maximum health" and "Slash resistance".
  ACE's `PropertyInt.cs` identifies 360/361 as weapon aura damage/speed, while
  `PropertyFloat.cs` identifies 3/4/5 as vital rates and 64 as slash resistance.
  After the shared-name cutover, 900 world and 308 TUI library tests, Rust clippy
  with warnings denied, 3D type/lint checks, all 2,688 frontend tests, and the
  full browser HUD harness passed again.
- Follow-up UI feedback on 2026-09-24 removed numeric power and raw modifiers
  from rows, made each spell reveal only its authored description, moved
  overridden-child disclosure to its own control, and replaced the dropdown and
  direction button with a single borderless sort cycle. Search now matches both
  spell names and affected-stat headings with the same word-subsequence rules.
  Type checks, TypeScript lint, seven focused projection tests, and the
  nonvisual browser HUD harness passed after these changes. Later feedback added
  filtered / total counts, explicit sort labels, and heading-level ordering.
  The user accepted the result on 2026-09-24 and requested final review and commit.

### Final code-quality review — 2026-09-24

- Reviewed the accumulated feature against HEAD, including new files, deleted
  protocol/TUI winner logic, world registry/stat consumers, core publication,
  host event and current-state adapters, browser lifecycle and metadata ownership,
  TUI rendering/scripting/raw inspection consumers, settings migration, and HUD
  harness extraction/reporting. The existing renderer-specific harness algorithms
  outside that extraction were not re-audited.
- World owns live timing, classification, query channels, and winner priority.
  Frontends retain receipt anchors only for countdown display; authoritative
  removal remains the membership boundary. TUI raw records still serve inspection
  and diagnostics; they no longer determine stacking or local expiry.
- Fixed a projection contract weakness: nonempty sections are now represented by
  a nonempty tuple, removing the impossible empty-section failure in sorting.
  Removed redundant reconstruction of unfiltered overridden rows.
- Preserved accepted tradeoffs: repeated stat rows, contextual parents for matching
  children, effective-only tray presence, and separate frontend display policies.
  Existing synthetic tests cover query competition and refresh/removal transitions;
  they do not establish live-server timing or visual equivalence with retail.

## Research findings — 2026-09-23

### 1. Winner selection: ACE is richer than either existing implementation

`ACE/Source/ACE.Entity/Models/PropertiesEnchantmentRegistryExtensions.cs:141`,
`:170`, and `:198` define three query contexts: global, modifier type, and modifier
type plus key. Each filters its candidates, then groups by spell category, then
selects descending by:

1. Power level.
2. Membership in the six level-eight self-aura spells listed at `:131`.
3. A numeric key: spell ID for members of `SpellSet.SetSpells`, otherwise start-time offset.

Complete ties retain the first candidate in the source enumeration (stable LINQ
ordering). Layer is not another priority key. Do not invent higher-layer or higher-ID
priority for ordinary spells. Preserve registry order through client projections;
do not let hash-map iteration choose tied winners. The server's collection order is
not explicitly transmitted as a separate field, so perfect tie equivalence across
all reconstructions is not guaranteed by the protocol.

`ACE/Source/ACE.Server/Entity/SpellSet.cs:13` builds that membership set by traversing
all DAT spell-set tiers and retaining spell IDs at or above `SetCoordination1` (4730).
It does **not** test whether an instance has a nonzero equipment-set ID, much less
whether the optional field was serialized. Existing `SpellCatalog.spell_sets`
already retains the parsed input; no new disk access is needed in world/core.

Concrete defect: `Network/Structure/Enchantment.cs:18` defaults `HasSpellSetID` to
one; ordinary entries can therefore decode to `Some(0)`. The current world helper's
`spell_set_id.is_some()` branch can treat ordinary spells as set spells and select
by spell ID instead of recency. Its missing self-aura preference is a second discrepancy.

The priority implementation must preserve ACE's numeric-key semantics after adding
clock anchoring. For non-set entries, obtain the current relative start offset from
the anchored start and current time; do not compare positive local timestamps directly
against set spell IDs. For ordinary versus ordinary entries, anchored start ordering
is sufficient. Higher layer and display sort order remain irrelevant.

Retail `Enchantment::Duel` (`acclient.c:478674`) compares only power and start time.
The registry duel (`:426222`) replaces the incumbent on a complete tie. ACE explicitly
documents its set-spell correction at `PropertiesEnchantmentRegistryExtensions.cs:217`.
Use ACE's server behavior for our shared resolution. When implementing an observable
retail departure, cite these routines and the census below using the project's marker
convention; do not claim that retail already follows ACE's enhanced rule.

### 2. Affected-stat groups require contribution-specific resolution

The ACE type/key overload at `PropertiesEnchantmentRegistryExtensions.cs:198` filters
before choosing category winners. With `handleMultiple`, it includes matching single-stat
records plus multiple-stat records with key zero, excluding vitae. Attribute, vital,
and skill callers enable this path (`EnchantmentManager.cs:680`, `:708`, `:759`).
Keep additive and multiplicative query contexts explicit. A global category winner
cannot substitute for these filtered results without proof about all possible content.

Attack/defense skill modifiers are additional real cases, not unknown-stat fallbacks:
`EnchantmentManager.cs:759` adds the results of `GetDefenseDebuffMod` (`:1104`) and
`GetAttackDebuffMod` (`:1116`) for skills listed in `ACE.Entity/Enum/Skill.cs:263` and
`:290`. ACE lists 20 attack skills (including legacy skills) and four defense skills.
Retail has corresponding predicates at `acclient.c:478754` and `:478781`; its modern
attack list is narrower. For this server-facing implementation use ACE's membership.

Retail also filters affected stats before dueling (`acclient.c:426356`). Thus the
shared contract should provide effective/overridden relationships **per contribution
context**, with stat sections referencing those relationships. The tray takes a union
of contributing ordinary instances; it does not count duplicated rows. Effects with
no conventional stat group still need the appropriate global-category resolution.

Direct effect targets belong in grouping. Do not recursively duplicate a Strength
enchantment under every skill whose formula depends on Strength. All-stat flags and
attack/defense groups are direct targets and should expand into their applicable stats.

The TUI's `character/render.rs:315` uses an exclusive `else if` chain and a single
key; it does not expand all-stat or attack/defense flags. World helpers currently
require an exact key for attributes/skills/vitals. Replace both interpretations with
the verified shared mapping instead of preserving either as an authority.

Some effects modify integer/float properties rather than attributes. Include typed
property groups, including damage/healing over time and ratings. ACE's heartbeat
(`EnchantmentManager.cs:1234`) explicitly processes `DamageOverTime`, `NetherOverTime`,
and `HealOverTime` after global-category selection. Body armor/damage/variance have
their own flag families. Unknown keys remain explicit unresolved effects; they must
not disappear from the window. Selection effectiveness does not mean a nonzero final
stat delta: caps, natural resistance, and other combination rules still apply afterward.

### 3. Timing: normalize on network receipt, remove on server instruction

ACE decrements start offsets each heartbeat, including permanent entries
(`PropertiesEnchantmentRegistryExtensions.cs:236`). A timed entry expires when
`start_offset <= -duration`. `EnchantmentManager.cs:1218` processes the heartbeat
and calls `Remove`; `:315` sends `GameEventMagicRemoveEnchantment` with spell ID and layer.
Heartbeat cadence means a displayed deadline is an estimate, not a removal message.

Retail `Enchantment::UnPack` (`acclient.c:478897`, specifically `:478924`) adds its
current clock to the received start offset. `EffectInfoRegion::GetDuration` (`:276312`)
subtracts the current clock from anchored start plus duration. The ordinary registry
selection routines at `:426332` and `:426356` do not prune expired records. Cooldowns
have a separate local expiration check at `:426298`; do not generalize it to spells.

Implementation decision:

- Normalize each incoming record at world ingestion: anchored start = receipt time
  + wire start offset. Normalize permanent effects too, because recency can break ties.
- Timed display deadline = anchored start + runtime duration; negative duration
  means permanent. Item-equipping effects get runtime duration `-1` in ACE
  `EnchantmentManager.cs:203`, even when the static definition has a positive duration.
- A newly received description/update is a new timing sample. A core/host/browser
  resnapshot of retained state is not; preserve its existing anchor. Do not infer
  freshness by comparing raw wire values (a real refresh can have identical values).
- Clamp displayed remaining time at zero, retain membership/effectiveness, and await
  authoritative removal. After removal, resolve and publish the replacement once.
- A browser resync transports remaining time with a defined sampling/clock mapping;
  it must not treat another process's monotonic timestamp as its own.

The existing protocol comment calling `start_time` world time is inaccurate for the
wire type and should be corrected during implementation. TUI local deletion is also
inconsistent with the above lifecycle and should be removed.

### 4. Special records and identity

The description contains four registry sections: multiplicative, additive, cooldown,
and vitae (`Network/Structure/EnchantmentRegistry.cs:36`). Our player-description
decoder currently flattens all four into one vector (`messages/player/events.rs:456`).
Classify record kind before ordinary spell resolution; flattening must not make all
cooldowns compete in one category or turn vitae into an ordinary debuff icon.

| Kind | Verified behavior | Planned first-cut treatment |
| --- | --- | --- |
| Ordinary spells, cantrips, set effects | Wire beneficial flag is set from `Spell.IsBeneficial` (`Network/Structure/Enchantment.cs:88`); runtime duration and modifier fields carry the actual effect. | Include, grouped by direct affected stat; classify from the live flag, not modifier sign. |
| Vitae | Spell 666; separate registry slot; wire layer zero (`Enchantment.cs:153`); restored through XP (`EnchantmentManager.cs:453`); retail has a separate indicator (`acclient.c:266098`). | Keep separate shared penalty semantics and TUI display; exclude from the two spell icons/window by default. |
| Item cooldown | ID is `0x8000 | sharedCooldownID`, category `0x8000`, explicit Cooldown flag, layer one (`EnchantmentManager.cs:284`, `:1179`). | Retain typed cooldown state; exclude from enchantment stacking and both icons/window. |
| Missing spell metadata | Runtime record still carries modifier, power, lifetime, and beneficial flag. | Show an identified unresolved row; missing name/school/artwork does not erase valid live state. |

Retail ordinary counts are updated on registry insertion, not winner selection
(`acclient.c:425884`, `:425784`), and description unpack recounts only additive and
multiplicative lists (`:426154`). Our effective-only icon policy is an intentional UI
choice, not a claim of exact retail parity. Retail's counter also excludes IDs at or
above `0x8000`; ACE's description categorizer uses `>` rather than `>=`. Use record
kind/flags and explicit ID validation, not an unexamined copy of one inequality.

Spell ID plus layer is the wire removal identity (`EnchantmentManager.cs:327`) and
matches our upsert/remove path. Preserve that identity across duplicated rows. Caster
GUID and equipment-set ID describe provenance; neither substitutes for the wire key.
ACE refreshes only if the new duration exceeds remaining time (`:188`); a weaker
recast can remain overridden. Retail has an additional timed same-spell replacement
path (`acclient.c:425829`); do not copy it into the shared ACE registry and lose layers.

### 5. Local content census and evidence limits

Read `dats/assets.hba`, namespace `eor/portal`, spell table `0x0E00000E` using the
existing `dat-tool` commands. No runtime assets or application code were changed.

```sh
cargo run -q -p holtburger-tools --bin dat-tool -- spell-export dats/assets.hba --namespace eor/portal --output /tmp/holtburger-enchantment-spells.json
cargo run -q -p holtburger-tools --bin dat-tool -- export dats/assets.hba 0x0E00000E --namespace eor/portal --output /tmp/holtburger-enchantment-spell-table.bin
```

A temporary Python decoder followed the checked-in `spell_table.rs` and ACE
`DatLoader/Entity/SpellBase.cs` field layouts to include meta types and set tiers.
It consumed the entire binary and cross-checked every decoded name and power against
the existing Rust exporter. The resulting research summary is temporarily available
at `/tmp/holtburger-enchantment-census.json`; the key results are recorded here so
the plan does not depend on that temporary file.

- Binary size: 1,479,136 bytes.
- SHA-256: `1aec26ba8c4dc13801d6b5cf8189959d29d77dd368f589e547c1f3914e42b3bf`.
- 6,266 spell definitions; 4,375 enchantment/fellowship-enchantment definitions
  (meta types 1 and 12): 3,107 beneficial and 1,268 non-beneficial by authored bit 4.
  These totals include vitae and NPC/content spells; they are not player population counts.
- 139 spell sets, 779 unique member spell IDs; 676 survive ACE's 4730 cutoff.
  All 676 have definitions in this table.
- Among those ACE set members, 45 `(category, power)` groups contain multiple
  enchantment definitions: 278 definitions across 14 categories. This establishes
  potential tie surface, not that all combinations are simultaneously obtainable.
- Concrete tie: Gauntlet Damage Boost I/II, IDs 6330/6331, category 729, both power 1.
  ACE selects II by ID regardless of ordinary recency when both participate.
- Six self/other aura pairs have identical category and power:
  4395/5997 (Blood Drinker), 4400/6006 (Defender), 4405/6014 (Heart Seeker),
  4414/6022 (Spirit Drinker), 4417/6031 (Swift Killer), 4418/5989 (Hermetic Link).
  Each first ID is the self aura preferred by ACE's explicit rule.
- Vitae 666 is authored as Creature, category 204, power 30, harmful, duration `-1`.
- No spell-table ID is at or above `0x8000`; cooldowns are synthetic runtime records.

Evidence limits: the client spell table does not contain the complete server modifier
type/key/value data. This census cannot prove that category members always have the
same affected-stat footprint, nor certify all custom-server content. The verified
filter-before-selection contract handles that uncertainty without requiring a global
winner assumption. No live gameplay session was run; heartbeat delay and simultaneous
instance transitions still need synthetic lifecycle tests and implementation verification.

### 6. Remaining query-context research: stat and category alone are insufficient

ACE's ordinary skill query selects `Skill | Additive` with `handleMultiple = true`
(`EnchantmentManager.cs:759-765`). It then adds the result of a **separate**
`Skill | Additive | DefenseSkills` or `Skill | Additive | AttackSkills` query with
key zero, depending on the skill (`:767-772`, `:1104-1122`). The latter queries do
not use `handleMultiple`; the ordinary query requires `SingleStat` with the skill
key or `MultipleStat` with key zero (`PropertiesEnchantmentRegistryExtensions.cs:198-226`).
`SkillHelper.AttackSkills` and `DefenseSkills` are explicit membership sets
(`ACE.Entity/Enum/Skill.cs:263-296`). The `EnchantmentTypeFlags` bits are distinct
(`ACE.Entity/Enum/EnchantmentTypeFlags.cs:12-27`).

Therefore, two additive enchantments of the **same spell category** can both be
effective for one skill if one contributes through its ordinary stat query and the
other through its attack/defense-wide query. A synthetic example is an Axe
`Skill | Additive | SingleStat` record with key Axe plus a
`Skill | Additive | AttackSkills` record with key zero and the same category. ACE
selects one winner per query and adds both values. This is a contract-level case,
not merely a display sort issue. The current work-in-progress resolver groups by
`(AffectedStat, operation, spellCategory)` and would incorrectly override one of
them. The current world `get_skill_additive` also only runs the ordinary query;
it omits ACE's attack/defense-wide contribution.

Correction: make contribution/query channel an explicit part of each resolved
family's identity. At minimum distinguish ordinary keyed/all-stat selection from
attack-wide and defense-wide selection; keep the affected skill as the presentation
heading. Use one candidate predicate and winner selector for stat calculations and
the exported families, so a category can have one effective root in each channel.
Add a synthetic same-category test with both roots effective under Axe, plus a test
that the calculated additive includes both. Audit other ACE query contexts before
claiming exact stat-calculation parity: property helpers use different required
flags, and `GetAdditiveMod(PropertyInt)` (`EnchantmentManager.cs:814-821`) requests
`Additive` plus key before excluding Skill modifiers. The window may show these
property effects by typed target while the calculation path retains its verified
query predicate.

Retail's `CullEnchantmentsFromList` (`acclient.c:426356-426388`) also admits
attack/defense-wide effects for matching skill keys, but its duel is a client
selection routine, not proof that ACE's separate arithmetic queries can be merged.
No real runtime record with this exact same-category collision was established by
the local spell-table census because that table lacks runtime modifier flags. The
synthetic case is sufficient to define behavior for valid wire records; do not
invent a claim that such a collision is common in shipped content.

### 7. Remaining 3D integration research

The live event route already reaches `ClientLifecycleSession`: core publishes raw
and resolved updates, host projects only the resolved payload, and the browser
anchors each received sample to `performance.now()`
(`core/client/mod.rs:809-817`, `host/client_projection.rs:1106-1107`,
`client-lifecycle-session.ts:807-815`). Current-state hydration carries a nullable
resolved snapshot (`client-lifecycle-session.ts:1096-1113`). `null` means no
character registry yet; `{ instances: [], groups: [] }` is a confirmed empty
registry. Preserve that distinction in tray and panel empty states. The browser
must continue clearing retained state on character retirement and resync, and
must discard spell-reference replies that arrive for an older membership/session.

`ClientSpellServices.load` supplies name, school, and artwork for arbitrary IDs;
`prepareSpellRow` provides an explicit missing-definition row and consumer-owned
icon lease (`client-spells.ts:19-57`). An enchantment consumer should use its own
display icon owner and an async generation guard, as `ClientSpellsPanel` does
(`ClientSpellsPanel.svelte:84-174`). Live disposition must remain the world-derived
flag even if a static spell reference disagrees. Reuse only the known-spell query
matching (`spellSearchWords`, `matchesSpellSearch`) and disposition/school pill
vocabulary (`client-spell-search.ts`); `spellSearchEntry` derives disposition from
static metadata and is unsuitable for live enchantments.

The tray is currently four unconditional stubs in `ClientStatusTray.svelte:24-30`.
Its outer `ClientHudPanel` already owns placement, rotation, and layout editing;
the two live buttons can replace the stubs inside that component. The new window
should be independent of `ClientWorldView`'s single `activePanel` switch
(`ClientWorldView.svelte:412`, `:980-1010`), with its own open state and saved
`hudLayout.enchantments` placement. Adding that placement requires a v12 durable
settings schema and v11-to-v12 migration because the current v11 schema is strict
and requires exactly its declared HUD fields (`client-settings-contract.ts:240-251`,
`:594-610`, `:1006-1059`). Update `ClientUiDefaults`, `CLIENT_UI_DEFAULTS`,
`createClientHudLayout`, and the settings default/fixture paths together; reuse the
standard `ClientHudWindow` drag, resize, and viewport fitting behavior.

Implementation checkpoint: a world registry/resolver, core and host projection,
browser contract/session retention, and TUI rendering migration are in the working
tree. These are unverified in aggregate. The context correction above, TUI lifetime
cleanup, 3D UI, settings migration, lifecycle tests, formatting, and visual review
remain required before any phase or definition-of-done box is checked.
