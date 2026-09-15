# Known-spells floating panel and retail artwork

Status: implemented; automated verification complete. User visual and interactive acceptance pending. Prerequisite investigation completed 2026-09-14; implementation verified 2026-09-15.

## Goal and boundaries

Implement the Spells system-button panel as a floating window listing every spell
the current character knows, with its name and retail-composed icon. Establish
session-owned spell data and independent artwork ownership that a subsequent spell
bar can consume without depending on the panel being open.

### In scope

- Correct DAT formula decoding and its existing consumers.
- Static spell reference lookup through content and the app host.
- Initial known-spell snapshots, subsequent membership updates, and character resets.
- Extend the existing icon pipeline with retail spell composition.
- Alphabetical, scrollable spell list in the existing floating-window system.
- Explicit loading, empty, missing-metadata, and artwork-failure presentation.
- Focused automated checks and real-content/browser verification.

### Out of scope

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

- [ ] Inspect spell artwork and name legibility, including the representative
      tier/effect/overlay cases above.
- [ ] Toggle, move, resize, close, and reopen the window; switch system panels.
- [ ] Scroll a large spell list and assess loading behavior and responsiveness.
- [ ] Confirm the visible experience for empty/loading/error states and character changes.

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

Visual and interactive acceptance remains assigned to the user. No staging or
commits were performed, and the pre-existing ACE/ACViewer submodule state was left alone.

Final checks after cleanup: type/Svelte/Electron checks, ESLint, Knip, host Clippy
with warnings denied, Rust formatting, and changed frontend-file Prettier checks all
passed. The final source-wire test passed. Only the four user-owned acceptance
checkboxes remain open.


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
bounded icon work. User visual/interactive acceptance remains pending. This audit
covers changed seams and their immediate consumers, not the entire transport,
renderer, or future casting implementation. Existing real-content census and
browser/lifecycle verification above remain the behavioral evidence.
