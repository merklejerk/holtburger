# Known-spells floating panel and retail artwork

Status: original panel implementation and acceptance complete; committed as `bce405e3`. Extension implemented and automated verification complete; paused for user visual acceptance. Prerequisite investigation completed 2026-09-14; implementation verified 2026-09-15; original acceptance gates closed by user direction on 2026-09-15.

## Goal and boundaries

Implement the Spells system-button panel as a floating window listing every spell
the current character knows, with its name and retail-composed icon. Establish
session-owned spell data and independent artwork ownership that a subsequent spell
bar can consume without depending on the panel being open.

### Original implementation scope

- Correct DAT formula decoding and its existing consumers.
- Static spell reference lookup through content and the app host.
- Initial known-spell snapshots, subsequent membership updates, and character resets.
- Extend the existing icon pipeline with retail spell composition.
- Alphabetical, scrollable spell list in the existing floating-window system.
- Explicit loading, empty, missing-metadata, and artwork-failure presentation.
- Focused automated checks and real-content/browser verification.

### Original exclusions (inspection superseded by extension below)

- Casting, spell-bar UI, drag gestures, bindings persistence, or hotbar synchronization.
- Favorites, retail filters, school tabs, search, component inventory, or spell inspection.
- Generalizing the item drag controller or designing a universal action framework.
- Reworking unrelated world spell semantics or completing TUI parity.

The future bar is a concrete architectural constraint, not an additional feature
to implement in this slice. Do not add unused drag payloads or casting fields.

## Ground truth and completed investigation

Retail references in `acclient-eor-source/acclient.c`:

| Location | Established behavior |
| --- | --- |
| 386851, `CompositeSpellIcon` | Background, four-channel base blend, exact-white replacement, final optional overlay |
| 388127, `GetSpellIcon` | Native 32×32 output |
| 429170, `InqSpellFormula` | Name/description hash key derivation |
| 287412, legacy `compute_hash` | Character arithmetic and NUL termination |
| 465015, `SpellFormula::Decrypt` | Wrapping subtraction from nonzero slots only |
| 465529, `DeterminePowerLevelOfComponent` | Component-to-tier mapping, including tiers 9 and 10 |
| 121026, `SurfaceWindow::ReplaceColor` | Exact full-pixel comparison and same-coordinate substitution |

ACE references:

- `ACE/Source/ACE.DatLoader/FileTypes/SpellTable.cs:32`: signed Windows-1252 hashing.
- `ACE/Source/ACE.DatLoader/Entity/SpellBase.cs:121`: formula decoding and ACE's extra correction.
- `ACE/Source/ACE.Entity/Enum/SpellFlags.cs`: Reversed, SelfTargeted, FellowshipSpell flags.

Measured against locally mounted `dats/assets.hba`; counts cover the entire spell
table, not just player-learnable spells:

- 6,266 definitions; 277 unique base icon DIDs.
- 289 unique images including supporting artwork. All decode, all are 32×32:
  284 A8R8G8B8 and 5 R8G8B8. Existing `UiAssetReader` supports every one.
- Signed Windows-1252 hashing plus wrapping subtraction decodes every formula to
  component IDs within 0..198. ACE's extra mask changes none of them.
- Unsigned hashing produces incorrect formula/background results for all 11 spells
  containing extended characters. Preserve the source encoding and signed bytes.
- 6,673 zero component slots; no interior holes or embedded NULs observed.
  Preserve all eight slots nevertheless; retail does not compact them.
- Tier counts: 1=1053, 2=735, 3=847, 4=472, 5=502, 6=1197, 7=148,
  8=716, 9=4, 10=592. No spell resolves to tier 0, whose mapper entry is absent.
- Tiers 3, 7, and 9 share the same authored background.
- Fellowship overlay: 194 spells; self overlay: 1,945; neither: 4,127.
  138 have both flags; fellowship wins. Reversed is set on 1,360 spells.
- A temporary Rust diagnostic generated 33 sample compositions using the existing
  blend primitive. The sheet was visually inspected. This was not a pixel comparison
  against a running retail client or a browser rendering test.

Temporary evidence was written to `/tmp/holtburger-spell-probe/` (`findings.md`,
`census.json`, `decoded.json`, `sheet.png`, `sheet-index.json`, diagnostic sources).
It may disappear; this plan records the implementation-relevant findings. Tests
must not depend on those files or on untracked assets.

## Design decisions and ownership

1. **DAT layer owns decoding.** Decode formula components once, preserving their
   fixed eight-slot shape. Shared world conversion consumes decoded values.
2. **Content layer owns static queries.** Resolve definitions by spell ID without
   runtime player membership or frontend sorting. Core does not load archives.
3. **World/core own knowledge.** Membership comes from the player's authoritative
   spell collection. The app never infers knowledge from item spellbooks or art.
4. **App host owns icon presentation.** It chooses spell visual layers from static
   facts and prepares PNGs. Content supplies data and asset lookup; it does not own
   floating windows or spell-bar policy.
5. **Frontend session owns accessible current state.** A panel or future bar can
   read the current baseline and observe event-driven changes independently.
6. **Frontend models and consumers own separate artwork leases.** A character-owned
   model lazily retains requested known-spell artwork across panel closure and releases
   it on removal/reset. Display consumers protect images until DOM replacement.
   Reuse the existing repository.
7. **Spell IDs are identity.** Row order, names, cache keys, and blob URLs are never
   binding identities. A future drag payload carries the spell ID.
8. **Compute decisions once.** The static query resolves formula tier once; the
   host resolves the complete icon recipe once. Frontend consumers and validators
   read those decisions rather than repeating flag/tier logic.

Keep contracts minimal: membership IDs, names, and required icon inputs have named
consumers today. Leave targeting, costs, descriptions, and school grouping out of
the new UI contract until a feature consumes them. Existing full shared spell
representations remain available for future casting behavior.

## Phase 1 — Decode formulas at the DAT boundary

Primary files:

- `crates/holtburger-dat/src/file_type/spell_table.rs`
- `crates/holtburger-dat/src/utils.rs`, only if a shared encoding/hash primitive is warranted
- `crates/holtburger-world/src/spell.rs`
- `apps/holtburger-tools/src/spell_export.rs` and callers affected by raw-field changes

Tasks:

- [x] Inspect all raw-component consumers before changing the parsed shape.
- [x] Use a fixed `[u32; 8]` decoded formula, eliminating conversion padding/fallbacks.
- [x] Hash decoded Windows-1252 bytes with signed-byte arithmetic, wrapping
      operations, and retail NUL termination. Prefer preserving exact bytes at the
      parse boundary over a lossy decode/re-encode path.
- [x] Derive the name/description key and subtract it from nonzero component slots.
      Do not add ACE's unused >198 correction or reject unknown IDs merely because
      the current census ends at 198.
- [x] Update world conversion to consume the decoded shape. Handle the diagnostic
      raw export honestly: retain raw access only if its explicit diagnostic
      consumer requires it; otherwise cut over the export field and vocabulary.
      Never label decoded values as raw.
- [x] Put component-to-tier interpretation beside formula/content semantics;
      materialize the tier once when building the static reference result.

Acceptance:

- Synthetic decoding fixtures cover ASCII, signed extended bytes, wrapping,
  empty slots, and preservation of slot positions.
- Tier fixtures cover 1..6, 110→7, 112→8, 192→9, 193→10, and unknown→0.
- Existing affected consumers compile and exports retain honest semantics.

## Phase 2 — Static references and shared icon pipeline

Primary files:

- New focused spell-query module in `crates/holtburger-content/src/`, exported by `lib.rs`
- `apps/holtburger-3d/host/src/shared_host_content.rs`
- `apps/holtburger-3d/host/src/ui_icons/` (rename to general UI-icon vocabulary)
- `apps/holtburger-3d/src/app/ui-icon-source.ts`, `ui-icon-repository.ts`,
  `UiIcon.svelte`, their tests and callers (same clean rename)
- New frontend spell-reference source/cache, colocated with its host contract

Tasks:

- [x] Add bounded batch lookup by spell IDs, independent of whether the character
      knows those spells. Return one explicit result per requested ID.
- [x] Content supplies name, icon DID, formula tier, and relevant source flags;
      reuse the repository's parsed asset path rather than decoding the table per row.
- [x] The host adapter converts those facts into a complete spell icon spec:
      base DID, mapped background DID, replacement-image DID, optional overlay DID.
      Preserve an available name when artwork resolution fails.
- [x] Extend the existing icon spec union with a spell case. Its cache key includes
      all visual inputs; spells sharing a base DID must not share incorrect artwork.
- [x] Generalize item-only names across host commands, transport capabilities,
      schemas, repository/component names, diagnostics, tests, and current callers.
      Preserve established owner lifetimes, request bounds, batching, and errors.
- [x] Implement a small spell compositor alongside item composition, sharing
      canvas validation, blend, and exact-white substitution primitives as useful.
- [x] Frontend static references are cached within the content/transport lifetime;
      membership and panel visibility do not determine definition availability.
      Reject stale asynchronous results after that lifetime is retired.

Exact spell recipe:

1. Resolve background group `0x10000006` by formula tier and copy it to the canvas.
2. Blend the base `icon_id` with retail four-channel alpha behavior.
3. Replace exact `[255,255,255,255]` pixels using matching coordinates from group
   `0x10000007`: entry 1 when Reversed (`0x10`) is set, otherwise entry 2.
4. Four-channel blend entry 4 when FellowshipSpell (`0x2000`) is set; otherwise
   entry 3 when SelfTargeted (`0x8`) is set; otherwise no final overlay.

Missing definitions and required mappings are explicit failures, not substitution
with tier 1 or silent row removal. Preserve the existing artwork diagnostic model
for unavailable images. Do not invent a second caching/PNG system.

Acceptance:

- Synthetic pixels prove operation order, exact-white matching, alpha behavior,
  and fellowship precedence. Recipe tests cover shared bases with differing tiers/flags.
- All measured corpus artwork resolves through existing supported formats.
- Bounded lookup tests cover absent definitions, malformed requests, and partial
  artwork failures without losing successfully resolved names.
- Two consumers can retain the same icon and release one without invalidating the other.

## Phase 3 — Snapshot-backed known-spell state

Primary files:

- `crates/holtburger-core/src/client/{types,mod,messages}.rs` and relevant reset paths
- `crates/holtburger-world/src/player/` only if baseline availability belongs there
- `apps/holtburger-3d/host/src/client_projection.rs`
- `apps/holtburger-3d/src/client/client-host-contract.ts`
- `apps/holtburger-3d/src/client/client-lifecycle-session.ts`
- Focused session-owned spell model, if separate from the lifecycle owner is useful

Tasks:

- [x] Add a coherent pending/known membership representation to application snapshots;
      a known empty collection is distinct from pending initial description.
- [x] Track baseline availability at the authority that processes initial player
      description. Derive membership from the existing authoritative collection,
      avoiding a second independently mutable spellbook.
- [x] Project the existing full-replacement `PlayerSpellsUpdated` events to the host
      and frontend. Handle initial description, additions, removals, and late readers.
- [x] Inspect pre-baseline update ordering; an isolated learn/remove event must not
      falsely establish a complete initial spellbook.
- [x] Reset availability and membership with character/session replacement. Ordinary
      portal transitions must not discard character knowledge.
- [x] Expose a current read and cold membership-change subscription. Do not poll
      frame-hot entity snapshots or add this state to renderer cadence.
- [x] Preserve TUI behavior and update its event consumers only if the shared contract changes.

Important evidence: `client/messages.rs` enters the world on either `StartGame` or
`PlayerDescription`; lifecycle `InWorld` cannot stand in for spellbook availability.

Acceptance:

- Pre-description snapshot is pending; an empty description becomes known-empty.
- Late subscription receives current membership; learn/remove events agree with snapshots.
- Character replacement clears old knowledge; portal transitions preserve it.
- Updates around initial-description delivery do not produce a false complete baseline.
- Static lookup results arriving after session retirement cannot repopulate the old view.

## Integration checkpoint

Before writing panel markup, trace one spell from DAT definition to content lookup,
host recipe, cached PNG, initial membership snapshot, and later removal. Verify that
a second consumer can resolve and retain the same spell while the panel is absent.
Reassess any duplicated state, recipe decisions, or whole-table work at this point.
Resolve routine implementation choices directly; escalate only a material scope change.

## Phase 4 — Floating panel

Primary files under `apps/holtburger-3d/src/client/`:

- New `ClientSpellsPanel.svelte`
- `ClientShortcutDock.svelte`, `ClientWorldView.svelte`, `ClientApp.svelte`
- `client-hud-layout.ts`, the existing UI defaults, and tuning as needed

Tasks:

- [x] Wire Spells into the supported system-panel identity and button action.
      Remove its stub tooltip while retaining unrelated stubs.
- [x] Add placement/default sizes and render through `ClientHudWindow` with existing
      move/resize/close behavior and one-active-system-window policy.
- [x] Render alphabetically by name with spell ID as a deterministic tie-breaker.
      Key rows by ID. Sorting remains frontend policy and never changes membership.
- [x] Show the full list, native artwork with existing UI scaling policy, and names.
      Missing definitions remain visible by spell ID with an explicit diagnostic.
- [x] Distinguish pending membership, known-empty, pending art, and terminal failures.
      Artwork problems do not suppress names or spell identities.
- [x] Acquire artwork through a consumer owner and release it on panel teardown.
      Reopening reads current session knowledge; it does not require a new server event.
- [x] Reuse existing bounded loading. Start with the simple list; only introduce
      viewport loading or virtualization if the measured corpus produces a problem.

Acceptance:

- Button toggles the window; movement, resize, close, and switching panels work.
- Login, late opening, reopening, learning, removal, and character changes produce
  the correct list without stale rows or duplicate requests from render activity.
- Missing metadata/art is visible and diagnosed. The list stays usable while images load.

## Future spell-bar contract audit

- [x] A bar can retain a spell ID and resolve its definition without a panel row.
- [x] A bar can hold its own icon lease after panel closure.
- [x] Knowledge, static definition, and future slot configuration remain separate facts.
- [x] No spell contract depends on item GUIDs, inventory membership, item-use preview,
      list positions, component instances, or blob URLs.
- [x] Future drag/casting work can add a typed spell-ID binding and call shared core
      behavior without replacing this slice's data contracts.

The existing action-bar `ActionContent` and drag controller are item-specific.
Leave their behavior alone here. Adding spell binding/targeting belongs to the
follow-up, whether its UI reuses that bar or introduces a separate spell bar.

## Phase 5 — Verification, cleanup, and completion

Acceptance ownership: the user performs visual and interactive acceptance. The
implementation agent owns automated correctness and integration checks, prepares
the running feature and concise acceptance scenarios, and reports automated results.
Do not require agent screenshot inspection or manual gesture testing as a completion
gate. Automated browser checks remain appropriate for loading, lifecycle, resource
ownership, and browser-error behavior. Record user acceptance separately from
implementation readiness; do not claim visual acceptance before the user reports it.

- [x] Use `npm run harness:browser -- ...` for a client UI fixture exercising the
      production panel, session contracts, and icon loading. Extend harness support
      where needed; do not run the interactive TUI.
- [x] Prepare real-content samples covering tiers 1..10, reversed effects, self and
      fellowship overlays, and both flags for user visual acceptance.
- [x] Exercise a large known-spell fixture, loading/failure states, close/reopen,
      and character replacement during pending lookup. Check for leaked image URLs
      or leases and uncaught browser errors.
- [x] Keep retained unit fixtures synthetic or checked in. Temporary real-asset
      probes may be removed after recording results; do not retain asset-dependent tests.
- [x] Run relevant Rust tests for DAT/content/world/core/host changes and frontend
      `npm run test:ts -- ...`, followed by `npm run check` and relevant lint checks.
- [x] Run `npm run lint:ts`, `npm run lint:dead`, and `npm run lint:rust`; additionally
      run Clippy for changed shared crates with `--all-targets -- -D warnings`.
- [x] Verify Rust/frontend formatting using repository tooling. Do not update
      tuning-value tests to mirror defaults; test behavior with explicit inputs.
- [x] Sweep stale item-only icon names, unused wrappers, temporary diagnostics,
      comments, and exports. Update active architectural documentation only where
      the change alters a documented contract.
- [x] Review line-count growth: new code should pay for decoding, state delivery,
      spell composition, or visible UI. Collapse duplicate helpers and avoid unused abstractions.
- [x] Record results and material limitations in this plan. Commit only on user request.

### User-owned visual and interactive acceptance

Closed by explicit user direction on 2026-09-15. This records user sign-off, not additional agent-run manual verification.

- [x] Inspect spell artwork and name legibility, including the representative
      tier/effect/overlay cases above.
- [x] Toggle, move, resize, close, and reopen the window; switch system panels.
- [x] Scroll a large spell list and assess loading behavior and responsiveness.
- [x] Confirm the visible experience for empty/loading/error states and character changes.

Provide a concise handoff with launch instructions, available fixtures or sample
characters, and the scenarios above. User acceptance does not block completing the
authorized implementation, automated checks, and cleanup.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Extended-character formulas silently choose wrong icons | Signed Windows-1252 fixtures and all-definition census |
| “Ready” lifecycle masks missing spellbook baseline | Explicit baseline state tied to description processing |
| Icon cache aliases spells sharing a base image | Complete visual recipe keys |
| Rename churn obscures feature logic | Mechanical clean rename followed by focused recipe changes; no aliases |
| Closed panel or changed character owns asynchronous work | Separate session, content-cache, and consumer-lease lifetimes |
| Large list causes avoidable decoding or UI churn | Cached batched loading, event-driven membership, measure before adding complexity |
| Future bar inherits inventory assumptions | Spell-ID contracts and independent metadata/artwork ownership audit |

## Definition of done

Every known spell is visible in the floating panel, with retail-composed artwork
or an explicit diagnostic. Initial state and subsequent updates agree, empty and
pending are distinct, and character replacement cannot leak prior state. Static
references and icon ownership support another consumer without requiring the panel.
Required automated checks and browser integration verification pass, findings are
recorded, and no casting/bar features or temporary diagnostic dependencies have
entered production. Mark implementation ready for user acceptance at that point;
visual and interactive acceptance is complete only after the user confirms it.

No user-facing product decisions remain open for this slice. Source-level details
such as raw diagnostic export compatibility and exact baseline storage should be
settled during their phases using the ownership rules above.


## Implementation record — 2026-09-15

### Final shape and decisions

- DAT parsing hashes the original decoded Windows-1252 bytes before Unicode conversion.
  Both raw and decoded component arrays are fixed-size. Raw slots remain for the
  existing tools spell exporter; world data consumes decoded components directly.
- `content::spells::spell_reference` resolves name, base DID, formula tier, and flags
  from a parsed table. `SharedHostContent` caches that table for both bootstrap and
  reference requests. No world/core archive lookup was added.
- `host::spell_references` resolves complete spell icon specs in bounded requests.
  The renamed `ui_icons` host module and `UiIconRepository` share preparation and
  lease infrastructure with inventory. Spell and item composition retain distinct
  ordering while sharing pixel primitives. No old command aliases remain.
- Core tracks the character whose initial description established knowledge and
  derives snapshot membership from the existing authoritative collection. A separate
  mutable spellbook was unnecessary. Early incremental events do not establish readiness.
- `ClientLifecycleSession` owns readable current knowledge and change subscriptions;
  a second session spell model was unnecessary. It retires knowledge on character
  replacement, resynchronization, and stop, and preserves it across ordinary portals.
- `SpellReferences` holds immutable static results independently of membership;
  `ClientSpellState` lazily retains requested known-spell artwork until removal or
  character/session teardown, including while the panel is closed. The panel owns
  list policy and independent display leases. Delayed results are checked
  against the mounted consumer's generation before installation.
- The infrequent full host snapshot is boxed: adding its membership collection would
  otherwise enlarge every protocol frame beyond the existing Clippy size threshold.
  This does not allocate for each ordinary event or change the serialized shape.
- No new decoder formats, casting behavior, drag APIs, or bar configuration were needed.

### Verification evidence

- DAT formula tests: six pass, covering parse integration with extended bytes,
  signed hashing/NUL termination, wrapping/zero slots, and all retail tier cases.
- Shared library suites: DAT 119, content 82, world 800, core 449 tests pass.
  Core includes initial pending/empty knowledge, pre-description updates, learn/remove,
  portal preservation, and character-entry reset. The socket-dependent test was run
  with loopback permission after the sandbox denied it.
- Host suite: 303 tests passed, followed by all four focused reference tests including
  the added explicit command/response wire test. Host coverage includes recipe resolution, overlay
  precedence, missing metadata/mappings, bounded requests, and composition pixels.
- Full frontend suite: 2,375 tests passed; subsequently added response-diagnostic
  cases and final affected-source checks passed (84 focused tests). Final stop/reset
  handling also passed 66 lifecycle and immediate-consumer tests.
- `npm run check`, `npm run lint:ts`, and `npm run lint:dead` passed.
  Clippy passed for DAT/content/world/core/host with `--all-targets -- -D warnings`.
  Rust formatting and changed frontend-file formatting were checked.
- `cargo check -p holtburger-tools -p holtburger-cli --offline` passed, covering
  the unchanged raw-export consumer and TUI integration without running the TUI.
- `npm run harness:browser -- --client-hud --brief` passed. The production panel,
  session decoder, static-reference cache, and browser image repository exercised
  512 spells plus a missing definition, close/reopen with changed membership,
  known-empty state, and character replacement while reference loading was held.
  Retired results did not replace current rows. This uses synthetic art and does
  not claim user visual acceptance.
- A temporary production-path probe decoded every definition and prepared all
  6,266 icons with no failures or degradation. It saved 53 representative real-art
  samples spanning the authored tier/flag combinations. The probe source was removed
  from the repository; outputs and its source remain under `/tmp/holtburger-spells-acceptance/`.

Transient logs live under `/tmp/holtburger-spells-*.log`; they are evidence, not
runtime or test dependencies. Browser startup and one shared test required sandbox
escalation for loopback sockets; both then completed successfully.

### Quality and contract audit

Inspected DAT→world conversion, content→host lookup, shared command routing and
serialization, host event→frontend session projection, reference caching, icon keys
and leases, and panel teardown/replacement. The API can resolve and retain artwork
for a second consumer without a panel row or inventory identity. Tests exercise
independent icon owners and lookup sharing. No broad API-quality claim is made for
unrelated item-use or renderer systems.

The change adds approximately 1,250 nonblank code lines including inline Rust tests,
frontend tests, browser probes, and formatting churn, after accounting for renamed
files. The largest new pieces are static-reference loading, spell composition and
its tests, and the panel. Shared queues, PNG transport, pixel blending, image leases,
and floating-window mechanics were reused; no generic action framework was added.

### User acceptance handoff

Launch the client with the existing configured workflow (`npm run dev:client` from
`apps/holtburger-3d`, with your normal launch options), enter a character, and open
**Spells**. Check artwork/name legibility, scrolling, moving/resizing, switching
system panels, and closing/reopening. Characters with different spellbooks exercise
replacement behavior; the automated harness covers empty/error/delayed states.

For an isolated art review, open `/tmp/holtburger-spells-acceptance/index.html` in a
browser. Its `samples.json` names every image and records the spell ID, tier, and
flags. These temporary samples may disappear; they are not required by the feature.

At the implementation handoff, visual and interactive acceptance was assigned to the user.
The subsequent requested review and commit produced `bce405e3`; the pre-existing
ACE/ACViewer submodule state was left alone. The user has now closed those acceptance gates.

Final checks after cleanup: type/Svelte/Electron checks, ESLint, Knip, host Clippy
with warnings denied, Rust formatting, and changed frontend-file Prettier checks all
passed. The final source-wire test passed. The four user-owned acceptance
checkboxes were subsequently closed by user direction.


## Final accumulated-diff quality review — 2026-09-15

Boundary: the complete spells feature against pre-feature HEAD, including untracked
files, icon renames, immediate existing callers, tests, and documentation. Existing
untracked submodule contents in ACE and ACViewer are outside this change.

Seams inspected:

- DAT source bytes → decoded eight-slot components → world conversion, static tier
  query, and the existing raw spell exporter/TUI debug consumer.
- PlayerDescription and world spell events → core snapshot/event → host projection
  and stdio event serialization → frontend decoder/session → panel and artwork owner.
- Static content cache → reference request/response → frontend promise cache →
  complete spell icon spec → shared host resolution/composition/PNG pipeline →
  frontend validation, browser URL repository, panel rendering and teardown.
- Existing inventory, currency, equipment and action-cell consumers of renamed icon
  contracts; UI command/event capability lists; floating-panel defaults and dock.

Verdict: no blocking code-quality finding. The separate static-definition cache,
character-owned artwork leases, and display leases each have a distinct lifetime.
The future spell bar can bind by spell ID, request static definitions independently,
and retain its own images without introducing item identity or panel dependencies.
No unused casting/drag framework or duplicate icon pipeline was introduced.

Corrections: README/theming guidance now documents persistent spell artwork;
misattached field comments were corrected. Added a synthetic host preparation test
covering successful spell PNG output, each required-image failure, and optional
missing-overlay degradation. The test exercises the production resolver and PNG
encoder, supplementing the compositor and reference-projection tests.

Accepted limits: failed static lookups are cached for the content lifetime; no retry
UI is part of this slice. The list uses straightforward full-list rendering and
bounded icon work. User visual/interactive acceptance was subsequently closed. This audit
covers changed seams and their immediate consumers, not the entire transport,
renderer, or future casting implementation. Existing real-content census and
browser/lifecycle verification above remain the behavioral evidence.


## Extension — inline spell inspection (2026-09-15)

### Goal, scope, and north stars

Click a spell in the existing list to expand its details immediately below the row,
with retail-grounded text, player-derived range, and the applicable formula's
component names and icons. This section supersedes the original inspection exclusion.
The original implementation is complete; all unchecked tasks below are new work.

- Reuse the existing static lookup, parsed-table cache, icon pipeline, and window.
- Keep immutable definitions separate from character-derived results and local UI state.
- Compute game facts in shared world/core code; format labels and manage expansion in the app.
- Retain spell ID as identity for inspection and the future bar. Do not add casting,
  dragging, slot configuration, or an action framework in this extension.
- User steering: **no keyboard navigation**. No arrow-key navigation, focus-management
  system, shortcuts, or keyboard acceptance tasks. Preserve honest semantic markup
  and expanded-state attributes without adding a custom keyboard interaction layer.
- Working UI choice: one expanded spell at a time; click again to collapse. This is
  reversible app-local policy, not part of shared contracts.
- Component availability dimming/counts, component-item inspection, consumption,
  casting affordability and success estimates remain out of scope. Displaying the
  appropriate formula still requires foci ownership/augmentation facts.
- User owns visual and interactive acceptance for this extension too. Original
  sign-off does not imply acceptance of the future details UI.

### Evidence gathered and implementation consequences

All retail locations below refer to `acclient-eor-source/acclient.c`.

| Source | Verified fact / consequence |
| --- | --- |
| `SpellExamineUI::ExamineSpell`, 224273, especially 224396–224455 | School, authored mana, positive duration, computed range, description, then appropriate formula. Reuse existing decoded spell fields rather than another spell parser. |
| `SetManaText`, 224084 | Displays base mana plus a positive `mana_mod` as additional mana per target. This is not a prediction of actual mana expenditure. |
| `DetermineSpellRange`, 218245 | Uses the spell's associated `InqSkillLevel` result (ranks + initial bonus, not full current skill); when no skill is associated, chooses the maximum of the five magic skills. Computes `min(base_range_constant + base_range_mod * skill, 75)` metres; examination converts to yards using 0.9144 and suppresses zero. |
| `ExamineSpell`, 224397 | Positive duration only; retail truncates to whole minutes at 60 seconds, otherwise whole seconds. Keep numeric seconds in the contract and formatting in the app. |
| `CSpellBase::InqDuration`, 428910; `PortalSummonSpell::InqDuration`, 431006 | Duration is dispatched by spell type. Include portal lifetime as applicable, not only enchantment duration; verify the typed field against the misleading decompiler receiver/type names. |
| `GetAppropriateSpellFormula`, 387288 | School-specific infused augmentation or owned magic pack selects scarab-only formula; otherwise account-customized formula. This result must not enter the content-lifetime static cache. |
| `InqCustomizedSpellFormula`, 429244 | Decodes the formula, then randomizes for account name and formula version. Existing decoded slots are necessary but insufficient for player requirements. |
| `InqScarabOnlyFormula`, 429258 | Retains scarabs and chorizite (111), then appends repeated prismatic taper (188) slots. Taper count uses strongest power component: tiers 1→1, 2→2, 3/4/7→3, 5/6/8/9/10→4. Preserve order and multiplicity. |
| `CompositeSpellComponentIcon`, 386923; `GetSpellComponentIcon`, 388190 | Copies component image into 32×32 output, replacing exact opaque white with opaque black. **Correction to initial exploration:** standalone Base artwork alone does not reproduce this transform. |
| `UpdateComponents`, 216966 | Uses component ownership to toggle a child overlay. This is separate from image preparation; do not bake availability into PNG cache keys. Exact overlay appearance is not yet verified and is excluded here. |
| `ACE/Source/ACE.DatLoader/FileTypes/SpellComponentsTable.cs` | Table ID `0x0E00000F`; u32 ID, u16 count, alignment, keyed entries. |
| `ACE/Source/ACE.DatLoader/Entity/SpellComponentBase.cs` | Entry fields: obfuscated name, alignment, category, icon, type, gesture, time, obfuscated text, alignment, CDM. Decode losslessly; expose only fields with consumers. |
| `ACE/Source/ACE.DatLoader/FileTypes/SpellTable.cs:58` | Formula versions 1/2/3 have account-hash randomization; other versions return authored formula. Compare arithmetic and encoding with retail before porting. |
| `ACE/Source/ACE.Server/Entity/SpellFormula.cs:340` | Confirms retained scarabs/chorizite and repeated prismatic taper recipe; `GetCurrentFormula` selects via `HasFoci`. |
| `ACE/Source/ACE.Server/WorldObjects/Player_Spells.cs:460` | `HasFoci` checks matching infused augmentation, then inventory WCID. Inspect retail containment semantics before assuming all nested inventories count. |
| `apps/holtburger-cli/src/pages/game/panels/dashboard/debug.rs:956` | Existing TUI detail view displays name, ID, school, power, base mana, description. No range or formula implementation to transplant. |

Existing integration seams inspected:

- `crates/holtburger-dat/src/file_type/spell_table.rs`: description, school,
  mana/modifier, range coefficients, formula version, extras and eight decoded slots
  already exist. `file_type/mod.rs` has no component-table decoder.
- `crates/holtburger-world/src/spell.rs`: `SpellInfo` retains those facts;
  `MagicSchool` and `SpellExtrasInfo` already exist. Avoid parallel school enums.
- `crates/holtburger-content/src/spells.rs` and app host `spell_references.rs`:
  current reference projection exposes only name and artwork facts.
- `src/app/spell-references.ts`: immutable results are cached for content lifetime.
- `src/client/client-spells.ts`: character-owned art survives panel close, independent
  display leases survive model release. Extend ownership rather than bypassing it.
- `ClientSpellsPanel.svelte`: current membership refresh clears/rebuilds rows. Preserve
  the expanded ID through unrelated membership changes rather than coupling it to rows.
- Core already has `PlayerStatsSkillsUpdated`; the inspected 3D client projection
  has no equivalent skill detail stream. Range cannot be made live by changing only markup.
- Core `client/character_selection.rs` already retains account name. Formula evaluation
  should consume it there; do not add credentials/account strings to the UI wire contract.

Evidence limits: this extension investigation is source-level. No new component-image
or formula-version corpus census has been run. Original spell-icon counts do not prove
component coverage. The prerequisite tasks below explicitly acquire that evidence.

### Phase 6 — Basic details and accordion

Deliverables: extend `content::spells`, host `spell_references`, frontend reference
schema/fixtures, and `ClientSpellsPanel.svelte`; extract a focused presentation
component only if it makes row/details responsibilities clearer.

- [x] Add typed description, school, base/per-target mana, and applicable duration
      to static references. Preserve details when artwork fails; absent definition
      and absent applicable duration are different states.
- [x] Project duration once from the typed spell extras; verify enchantment and portal
      cases before choosing the contract. Keep numbers/units explicit, labels app-local.
- [x] Add mouse-driven one-row expansion keyed by spell ID, rendering details below
      the header. No custom keyboard navigation or global input handlers.
- [x] Preserve expansion when other spells are learned/removed; clear on selected
      spell removal or character reset. Closing the panel may reset expansion.
- [x] Make removal/reset distinguishable from transient row rebuilding; pending
      results must never restore retired details. Do not evict main spell art on collapse.
- [x] Keep definition data reusable without mounted panel state. Future drag remains
      spell-ID based; do not add pointer-down expansion that would interfere with dragging.

Acceptance: host/frontend fixtures prove exact detail contracts and missing/error
behavior; browser fixture proves click toggle, switching expanded rows, membership
updates and stale-result retirement. User judges layout, wrapping and scrolling.

### Phase 7 — Shared player-derived range

Deliverables: focused spell semantics in `holtburger-world`, orchestration in core,
app-host projection and frontend character-bound inspection results.

- [x] Trace `CSpellBase::InqSkillForSpell`, ranks/initial-bonus inputs, and existing
      world skill/enchantment handling; prove which value matches retail's `InqSkillLevel`.
- [x] Add a pure range calculation consuming a definition and explicit skill facts;
      cover associated-skill selection, no-school maximum, cap and zero display case.
- [x] Provide a bounded, spell-ID-based runtime inspection query independent of known
      membership or an open panel. Core owns evaluation against its current character;
      content owns definition lookup, with core using its parsed bootstrap catalog.
- [x] Carry character generation and a cold inspection-context revision through the
      app boundary so the frontend can reject replies computed for an old context.
      Increment only for inputs the evaluation consumes, including skill changes.
      Reuse an existing compatible revision if one exists; no frame polling.
- [x] Expanded consumers refresh on context changes. Keep runtime results out of
      `SpellReferences`; a future bar inspector can make the same query independently.
- [x] Present unavailable player context explicitly; never substitute skill zero
      and label that number as current range. Convert metres to yards in presentation.

Acceptance: synthetic shared tests prove calculations; host/session tests prove
initial readiness, skill updates, late responses, portal preservation and character
replacement. Browser fixture proves range updates without collapsing the row.

### Steering checkpoint — before formula integration

- [x] Trace a detail request from click through static reference and runtime query,
      including a concurrent skill change and character reset. Resolve duplicated
      derived facts and unnecessary request work before adding formula inputs.
- [x] Confirm minimal context invalidation can also represent foci/augmentation changes.
      Do not introduce a general subscription framework to serve one small query.
- [x] Reassess line growth and remaining formula prerequisites; settle routine choices
      directly and report any material scope expansion before implementing it.

### Phase 8 — Component data and applicable formula

Deliverables: new DAT component-table module/export, content parsed-table query/cache,
shared formula functions, core context inputs and runtime inspection formula result.

- [x] Decode the component table using ACE/ACViewer references and synthetic binary
      fixtures (encoding, alignment, duplicate/invalid records, truncated input).
- [x] Run a temporary real-content census: component count, referenced/missing IDs,
      icon DIDs/dimensions/formats, white pixels, formula versions, slot counts and
      multiple-scarab cases. Record results; retain no asset-dependent tests.
- [x] Trace retail `RandomizeForName` for versions 1/2/3 against ACE arithmetic and
      signed account hashing; use synthetic account names and fixed expected formulas.
      Cover the authored-formula default case without silently normalizing slots.
- [x] Implement pure account customization and scarab-only selection in shared gameplay
      code; keep DAT decoding independent of account/player facts. Reuse signed hash
      arithmetic at an appropriate shared boundary rather than duplicate it.
- [x] Verify foci WCIDs, augmentation properties, ownership/containment rules and
      their existing hydration/update paths. Core supplies those explicit inputs.
      Extend the phase-7 context revision for relevant inventory/property changes.
- [x] Return ordered component IDs with duplicates preserved in the runtime result.
      Resolve names/artwork through content separately; no item GUIDs in formula identity.
- [x] Missing account or authoritative inventory baseline yields pending/unavailable
      formula, not an assumed non-foci recipe. Evaluate the minimum required inputs
      per branch; an augmented character need not wait for irrelevant inventory data.

Acceptance: synthetic fixtures cover each formula version, two accounts, each foci
selection route, chorizite, repeated tapers, strongest scarab, missing context and
context change during a query. Real-content census has no unexplained missing inputs;
unhandled cases are explicit and reviewed before claiming full coverage.

### Phase 9 — Component artwork and details integration

- [x] Add an explicit component icon recipe to the existing `UiIconSpec` union and
      cache key: source image plus the fixed white-to-black transform. Reuse the
      host loading/PNG/batching path and exact-pixel helper; no parallel image cache.
- [x] Verify exact opaque-white replacement with synthetic pixels, including near-white
      and transparent-white nonmatches. Check native sizing against the component census.
- [x] Render component names and ordered formula artwork beneath the text details.
      Missing component records/images get explicit local diagnostics without hiding
      the other details. Preserve duplicate slots rather than silently deduplicating.
- [x] Lazily retain requested component art across collapse/reopen using the existing
      character model and independent display leases. Release obsolete formula keys
      after context changes only when no retained spell/consumer still needs them.
- [x] Reject component lookups for retired spell/context generations. Main spell art,
      component art and future independent consumers must share safe lease behavior.

Acceptance: browser fixture covers formula replacement, collapse/reopen reuse, delayed
component lookup, reset, shared component images and an independent consumer. No image
URL is revoked while displayed; no retired formula reappears. User judges component
legibility and the expanded panel layout. Availability shading is not claimed.

### Phase 10 — Cleanup, validation and extension completion

- [x] Sweep obsolete fixtures/comments/contract vocabulary; collapse duplicated row
      and reference state where it has no separate lifetime. Review added lines and
      avoid turning the panel or spell model into a general action/controller framework.
- [x] Run affected Rust/frontend tests, `npm run check`, `npm run lint:ts`,
      `npm run lint:dead`, relevant Clippy with `--all-targets -- -D warnings`, and
      repository formatting. Do not launch the TUI.
- [x] Run the browser harness through real production panel/data ownership paths;
      retain synthetic regression fixtures and record temporary census results.
- [x] Audit a future spell-bar consumer: it can resolve static details and request
      character-derived inspection by ID, hold independent images, and survive panel
      closure. Actual drag/casting remains a later feature.
- [ ] User acceptance: click expansion/collapse, layout and scrolling, formula changes
      after foci/augmentation changes, and visible pending/error states. No keyboard gate.
- [x] Record results, limitations and scope decisions. Commit only when requested.

### Risks, concessions and definition of done

Main risk is mixing player-dependent formulas/range into the immutable definition
cache. A separate character-bound result and explicit context invalidation prevent
that. The next risk is assuming decoded component slots equal current requirements;
account/foci selection and synthetic source-grounded fixtures address it. Inventory
baseline/containment and effective-skill hydration must be traced during their phases,
not replaced with guesses in the frontend.

The simple first phase adds fields to the existing batched reference payload; this
increases initial metadata transfer but avoids a second static details cache and
request protocol. Measure before splitting that path. Component art loads lazily;
its persistent leases trade modest retained memory for collapse/reopen reuse.

Done means the expanded row shows verified static details, current range and applicable
formula names/icons, handles pending and partial failure honestly, survives context
changes without stale data or revoked images, and passes automated and user-owned
acceptance. Inventory availability styling, keyboard navigation and casting/bar work
are excluded. No user answer is required to proceed with this plan; the recorded
single-expansion policy is a reversible implementation choice.


### Execution checkpoint — range decision (2026-09-15)

Phase 6 is implemented, not committed. Static references carry description, numeric
school identity, authored base/per-target mana and positive applicable duration.
Rows expand on click; one expanded ID survives unrelated membership refreshes and
is cleared on removal/reset. Native button semantics remain; no custom keyboard
navigation was added. Artwork failure does not hide detail text.

Verification: Svelte/TypeScript/Electron checks passed; nine focused frontend tests
passed; four host reference tests passed. Browser harness exited successfully with
`inlineDetails: true`, checking description rendering, click collapse, switching
expanded spells, preserving expansion through membership replacement and existing
image reuse/reset behavior. The new content duration test covers enchantment,
portal lifetime and non-applicable duration. User visual acceptance remains open.

**Material correction to phase 7:** retail `DetermineSpellRange` calls
`CACQualities::InqSkillLevel` (`acclient.c:423598`). That function adds words 3 and 4
of `Skill`; `acclient.h:15549` identifies them as `_init_level` and `_level_from_pp`.
It does not use attributes or enchantments. The separate `CACQualities::InqSkill`
(`acclient.c:424147`) adds the attribute-derived base, those ranks/initial values,
additional bonuses and enchantments. ACE's PlayerDescription writer
(`ACE/Source/ACE.Server/Network/GameEvent/Events/GameEventPlayerDescription.cs:308`)
likewise sends ranks and initial bonus separately. Our world `Skill.current` includes
attribute-derived contribution and buffs, so substituting it would intentionally
change the examined range relative to retail.

Decision needed before proceeding: match retail's examination number, or display a
useful current casting range after verifying server casting-range semantics. The
previous plan conflated them. No range implementation or compatibility marker has
been added pending this decision, and no component corpus census is claimed.
If choosing retail fidelity, revise phase 7's skill inputs/invalidation to ranks and
initial bonus and measure the affected spell corpus before any required quirk marker.
If choosing current casting range, verify ACE's casting checks and document the
intentional display difference rather than calling it retail parity.

This is the first blocked checkpoint for the active implementation goal. Remaining
phases retain their full scope; the goal is not marked complete or blocked.


### Range decision resolved — 2026-09-15

User requested both retail inspection and verified casting range, collapsing equal
values to one display. Inspection of `ACE/Source/ACE.Server/WorldObjects/Player_Magic.cs:481`
resolves the apparent conflict: `VerifySpellRange` explicitly replaces the skill
input with `InitLevel + Ranks` when `casterItem == null`, citing retail's
`DetermineSpellRange`. It caps at `Player.MaxRadarRange_Outdoors` (75 metres,
`Player.cs:74`). Therefore ordinary spellbook casting and retail examination agree:
show one Range value. Do not add a duplicate field without a differing consumer case.
Item-cast spells keep the supplied skill input and are not this panel's casting source.
The range is a distance limit, not a guarantee of castability: ACE also checks target
category, self-target exemption, wielder location, 2D distance and indoor restrictions.
No deliberate retail divergence is needed. Phase 7 consumes ranks + initial bonus,
not `Skill.current`; stat updates may invalidate conservatively until input comparison
suppresses unchanged results. The previously recorded decision blocker is resolved.


### Phase 7 implementation progress

Shared range tests pass (school-specific ranks/initial bonus, cap, missing context,
and schoolless maximum). Core now provides a read-only correlated query and a cold
context revision; it compares retained relevant inputs and retires the context on
character reset. Core context/reset test passes. The app host projects the query and
events, and the frontend model supports independently released inspectors, stale
reply rejection and query errors. Five model tests pass, including two concurrent
inspectors and context/reset retirement. Host/core/TUI compile and frontend
Svelte/TypeScript/Electron checks pass. Range markup and the browser fixture now
consume the new query; expanded browser verification is next. Phase 7 remains open
until that integration and the source/contract review are complete. Formula inputs,
component census/decoder and component artwork remain unimplemented.


### Component evidence and formula progress

The range browser harness exited successfully with inline details and 27.3-yard
range presentation through the production session/query path. Component-table
synthetic tests pass (2): encoding/alignment/full fields and malformed input.
A temporary production-repository census found 163 components and 158 distinct
icon DIDs, all 32×32 and supported by the existing image decoder. Every nonzero
component referenced by the 6,266 spells exists. 155 images contain exact opaque
white, totalling 13,446 pixels. Formula versions: 1=5,888, 2=163, 3=215.
Nonzero slot counts: 5=1,296, 6=970, 7=845, 8=3,155. There are 1,460 formulas
with multiple scarab/chorizite components under the retail retained-ID set.
The census log is `/tmp/spell-component-census.log`; its temporary diagnostic must
be removed from the repository before completion.

Retail account randomization implementations were inspected at acclient.c:465137,
465244 and 465281. Version 1 includes zero-sum guards absent from ACE's simplified
implementation; preserve the retail arithmetic with wrapping u32 operations.
Version 2 has a possible zero divisor for malformed content; surface that explicitly.
The new shared formula module implements all three versions and foci conversion;
account encoding, core foci context, full-corpus formula verification and component
reference/art integration remain pending. The byte-hash primitive was moved to
common for reuse by static DAT decoding and account personalization.


### Formula-context and artwork integration progress

Core inspection now includes an independently pending/ready/failed formula result
alongside ready range. It hashes the account as signed Windows-1252 bytes, rejects
unrepresentable identities, and never publishes the account string. Shared foci
selection uses the existing announced roster and missing-description facts. Retail
`MagicPackIsOwned` scans `CObjectInventory::_containersList` (acclient.h:16350),
so only direct pack-slot occupants qualify; nested inventory is not searched.
Infused augmentation bypasses irrelevant missing inventory data. Context comparison
now includes each school's foci selection and account hash as well as range inputs.

Component icon recipe/transform is implemented in the existing host and frontend
icon pipeline. Source loading, PNG encoding, complete recipe keys and leases are
reused. A synthetic exact-white/nonwhite/transparent-white test was added. Component
reference lookup, frontend formula component leases/rendering, expanded corpus
formula checks and final lifecycle/quality validation are still outstanding.
The temporary component census source was moved to `/tmp/spell_component_census.rs`
and removed from the repository.


### End-to-end formula display and corpus verification

The browser harness passed with `formulaComponents: true`: expanded rows render
component names and transformed artwork through the production reference cache,
model leases and Svelte formula component. Twenty focused frontend tests pass.
Host/content compilation and frontend checks pass. ESLint and dead-code checks pass;
Clippy across common/DAT/content/world/core/host passed before the final fixed-slot
correction below and must be rerun after cleanup.

A temporary full-corpus probe evaluated two synthetic account identities plus foci
for every spell. It exposed 23 foci recipes exceeding eight slots. Retail
`SetComponent` rejects writes at index >=8 (acclient.c:464902); the caller ignores
that return (429331). The shared foci function now preserves this inspected formula
truncation, marked RETAIL QUIRK with the 23/6,266 census and consequence. The rerun
passed all 18,798 formulas with no missing component IDs or evaluation failures.
Logs: `/tmp/spell-formula-census2.log`; diagnostic source moved to
`/tmp/spell_formula_census.rs` and removed from the repository.

Course correction: the component dictionary is only 163 records, so one lazy
content-lifetime lookup replaces the proposed per-component batching. PNG preparation
remains bounded and lazy. This avoids another per-ID request queue while keeping
formula multiplicity in the consuming ordered array. Pending/error formula results
remain separate from ready range. Final ownership tests, broader regression checks,
cleanup/documentation and user visual acceptance are still outstanding.


### Final implementation audit and acceptance handoff

Phases 6–10 are implemented. Immutable spell/component references, character-bound
range/formula evaluation, current-context delivery, ordered formula rendering,
independent inspector subscriptions and persistent/display image leases are connected.
The user-requested range comparison resolves to one value because ACE's ordinary
spellbook range matches retail. Casting/item-use and keyboard-navigation systems
were not added. Metadata fetch uses a single small component dictionary; prepared
images stay lazy and bounded.

Ownership verification covers two independent inspectors, stale replies, context
replacement, duplicate component slots, shared image preparation, pending component
lookup retirement, and an independent display lease surviving character reset.
Formula invalidation uses a separate epoch from static main-spell artwork; repeated
publication of the same context does not evict component images. Core refreshes on
stat changes and semantic entity/storage deltas, including roster-only messages,
rather than routine movement. Entity storage coverage is part of the existing
projected facts, so announced-empty rosters can end formula pending state.

Final checks: 2,384 frontend tests across 296 files passed. Rust library suites:
common 36, DAT 121, content 83, world 805, core 450, host 306 (1,801 total) passed.
The socket-dependent core test initially hit sandbox EPERM and passed with loopback
permission. Svelte/TypeScript/Electron checks, ESLint, Knip, and Clippy across all
six touched Rust packages with warnings denied passed. Rust and touched frontend
formatting are applied; `git diff --check` is clean. Tests do not depend on local
DAT assets. The successful corpus and earlier formula browser evidence are above;
the final expanded browser context-change run is being recorded separately.

Documentation now explains the inline details and ownership boundaries in the app
README and UI theming guide. Final audit removed a redundant frontend component
result union and avoided routing inspection through item identities or panel state.
The implementation adds explicit contracts, decoder/semantics and integration tests;
no generic action framework or second image pipeline was introduced.

User visual acceptance remains the only planned manual gate: open Spells, click a
spell, check wrapping and spacing, collapse/switch rows, and inspect formula names
and icons. Check a foci/augmentation change if convenient; automated fixtures exercise
context updates and incomplete/error states. No commit has been requested for this
extension. The implementation agent should stop for the user's eyes after final
browser verification, leaving the goal incomplete until that acceptance is resolved.


Final browser run (`/tmp/spell-acceptance-browser.log`) exited 0 with
`inlineDetails`, `formulaComponents`, and `contextRefresh` all true. The context
refresh changed the displayed range from 27.3 to 32.8 yards without collapsing the
row and rendered two separate Prismatic Taper slots. Final handoff type checks are
recorded in `/tmp/spell-handoff-check.log`. The agent is stopping for user-owned
visual acceptance, as requested; this is the first acceptance-wait checkpoint.


### Live acceptance correction — missing host command registration

User's live Electron run exposed `unknown host command "query_client_spell_inspection"`.
The enum and handler existed, but `CLIENT_COMMAND_NAMES` omitted the name; the
MessagePack command router rejected the request before reaching the handler.
The browser fixture bypassed that router, so prior browser success did not verify
this transport seam. Added the missing registration and two framed MessagePack
regression tests for inspection and component dictionary commands; both pass.
The earlier broad readiness claim was too strong at this boundary.

The user's accompanying Electron warning was a deprecated five-argument
`console-message` listener. Updated it to the installed Electron event object's
`level`, `message`, `lineNumber`, and `sourceId`, preserving warning/error and verbose
logging behavior. Electron type checks and ESLint pass. Rebuilding the debug sidecar
and Electron main output makes the fix available on restart. No commit was made.

### Visual acceptance follow-up — attached accordion and component rows

User requested a more structured expansion attached to the spell row, with
component icons merged into the component list. The expanded header and detail
body now share one outline and themed background, with a disclosure indicator,
a header separator, and a separated Components section. Each formula slot renders
its icon beside its name in one list; order and repeated ingredients are retained.
This is app-local presentation and does not alter inspection or icon ownership.

Svelte/TypeScript checks and ESLint pass. The browser probe's repeated-slot name
comparison now trims surrounding layout whitespace introduced by the inline icon.
Visual acceptance remains user-owned.

Browser rerun passed (`/tmp/spell-style-browser2.log`): inline details, formula
components, and context refresh all passed after the presentation change.

### Final code-quality review — extension commit

Reviewed the accumulated diff against the known-spells panel commit, including new
files, immediate callers, tests, and current documentation. ACE and ACViewer
untracked submodule contents are unrelated and excluded from this commit.

Contract coverage:
- DAT component decoding and shared signed-byte hashing through content lookup,
  host metadata projection, frontend validation, and ordered component rows.
- World range/customization/foci semantics through core context invalidation,
  query dispatch, host projection, MessagePack routing, transport event names,
  session validation, and independent frontend inspection subscriptions.
- Component image recipe through host composition, repository identity, persistent
  character leases, and mounted display leases. Traced collapse, removal, context
  replacement, character reset, pending lookup completion, and disposal.
- Native button expansion, theme variables, browser fixture/probe, and Electron
  console event adaptation. No custom keyboard navigation was added.

Two low-priority ownership cleanups were applied: hash unit tests moved with the
primitive to common, and the browser fixture now consumes the production query
schema rather than a weaker duplicate. No blocking design findings remain in this
scope. Persistent and display leases serve different lifetimes and should remain
separate; static metadata and character-bound results should also remain separate.
The added decoder and formula algorithms are justified by the authored formats,
while the existing image preparation machinery is reused.

Accepted friction: host commands still require enum plus name-registry registration
in the existing protocol architecture. The new commands have framed MessagePack
regression coverage, including the registration previously missed during live
acceptance. A general registry cutover is outside this feature review.
A future spell bar can consume stable spell IDs, static references, independent
inspection subscriptions, and its own artwork lease without owning panel state;
drag payloads and casting actions remain follow-up work.

Limitations: this pass did not rerun the real-DAT census or live server acceptance,
and does not approve every existing host command or renderer path. Latest browser
density verification passed in /tmp/spell-density-browser.log. Manual appearance
and live foci/augmentation acceptance remain user-owned.
