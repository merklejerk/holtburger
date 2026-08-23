# Holtburger 3D Explorer Entity Panel Redesign Plan

Status: Awaiting user recheck — Phase 6 UX and hot-path corrections landed (2026-08-23)
Created: 2026-08-23
Parent: follow-on to `holtburger-3d-explorer-weenie-dynamic-runtime-plan.md`

## Context and Boundaries

### Goal

Replace the Explorer Entities tab's single crowded control column with a compact master/detail tool
that searches the offline ACE weenie catalog by fuzzy name or class name, preserves direct decimal
and hexadecimal WCID entry, and makes spawn, selection, possession, and lifecycle actions explicit.

### Current State

`ExplorerEntitiesPanel.svelte` currently owns all of the following in one component and one vertical
flow:

- catalog capability and path presentation;
- raw WCID parsing and camera-relative spawning;
- wearer/held-child hierarchy rendering;
- entity selection and wearer despawn actions;
- possession and stance controls;
- placement, physics, and boom-camera diagnostics; and
- one shared pending flag and one shared operation-error slot.

The panel lives in a 420 px-wide Explorer dock. Its spawn row divides that width between WCID and
distance, the current-entity list has a fixed 235 px ceiling, row-local trash buttons compete with
selection, and diagnostics remain expanded below the list. Adding autocomplete to that shape would
increase state and vertical churn without resolving the underlying ownership and information-order
problems.

The spawn runtime itself is already correctly narrow. The frontend sends a numeric WCID in
`ExplorerEntitySpawnRequest`; the Tauri host resolves the corresponding ACE-derived
`WeenieTemplate`; the shared dynamic-entity path never consumes search text. This plan preserves
that contract.

### In Scope

- A bounded app-host catalog query over display names and ACE class names.
- Fuzzy matching with deterministic exact/prefix priority and WCID tie-breaking.
- Direct decimal and `0x` WCID entry through the same visible picker.
- A real accessible combobox/listbox with explicit selection and stale-response rejection.
- A clean-cutover master/detail Entities panel:
  - compact catalog status and population header;
  - persistently open spawn composer;
  - compact wearer/held-child population list;
  - selected-entity actions and applicable controls; and
  - collapsed diagnostics.
- Component decomposition around spawn composition, population selection, and inspection.
- Operation-specific pending and error presentation.
- Tauri access to the host search decision.
- Focused Rust and TypeScript contract/state verification, followed by user-run visual and
  interaction acceptance in the real Explorer.
- A vocabulary sweep from user-facing “WCID spawning” to “Weenie spawning,” while retaining WCID
  wherever it names the actual identifier.

### Out of Scope

- Changing `ExplorerEntitySpawnRequest` to accept names or search results.
- Promoting Explorer discovery or interaction policy into `holtburger-core`, `holtburger-world`, or
  `holtburger-content`.
- Sending the complete 43,913-record catalog to the browser.
- Modifying the `.hwc` file format or requiring a catalog re-export.
- Pre-validating every candidate against DAT/setup preparation or promising that every catalog
  result can be physically realized.
- Filtering or searching the already-spawned population; current population sizes do not justify a
  second search box.
- Recent/favorite weenies, spawn history, persistence, bulk spawn, or saved presets.
- A generic application-wide combobox framework or redesign of other Explorer tabs.
- A browser-harness mount of the Entities panel or a debug-HTTP catalog-search endpoint solely for
  automated visual verification.
- Changes to shared entity lifecycle, physics, possession, rendering, or camera behavior.
- Retail behavior research or compatibility markers. This is Explorer-local discovery and UX; ACE
  catalog facts remain the authority for names and WCIDs.
- Running the interactive TUI client.

## Ground Truth and Evidence

### Current Contracts to Preserve or Extend

- `crates/holtburger-weenie-catalog/src/reader.rs`
  - `WeenieCatalog` validates the fixed index, enumerates canonical WCIDs, and performs positioned
    point lookup without retaining decoded templates.
- `crates/holtburger-weenie-catalog/src/codec.rs`
  - Every payload begins with WCID, weenie type, class name, and optional display name. A lightweight
    identity projection can stop there without changing the format.
- `apps/holtburger-3d/src-tauri/src/explorer_weenie_catalog.rs`
  - Owns optional app-local catalog discovery/capability and is the correct owner for an immutable
    search index and fuzzy ranking policy.
- `apps/holtburger-3d/src-tauri/src/explorer_entity_driver.rs`
  - Owns the injected catalog boundary used by production and focused host tests. Search is a
    read-only catalog operation and must not take the serialized entity-mutation lock.
- `apps/holtburger-3d/src-tauri/src/lib.rs`
  - Exposes `explorer_catalog_capability` and `spawn_explorer_entity`; the new Tauri command belongs
    beside the former and must run blocking catalog work off the async command executor.
- `apps/holtburger-3d/src/explorer/explorer-entity-commands.ts`
  - Owns validated frontend DTOs, direct WCID parsing, and camera-relative spawn-request creation.
- `apps/holtburger-3d/src/explorer/explorer-dynamic-entity-session.ts`
  - Owns the injectable invoke boundary and response decoding.
- `apps/holtburger-3d/src/explorer/ExplorerApp.svelte`
  - Owns live runtime/camera coordination and should continue to receive a resolved numeric WCID.
- `apps/holtburger-3d/src/explorer/ExplorerTools.svelte`
  - Routes app-local data and actions into the active Entities tab.
- `apps/holtburger-3d/src/explorer/ExplorerEntitiesPanel.svelte`
  - Current composition and the clean-cutover target.
- `apps/holtburger-3d/src/styles.css`
  - Existing Explorer control, panel, action, and selectable-row visual language.

### Measured Catalog Distribution

Measured on 2026-08-23 against the current `dats/weenies.hwc`:

| Measure                                     |     Count |
| ------------------------------------------- | --------: |
| Catalog bytes                               | 7,359,454 |
| Records                                     |    43,913 |
| Records with display names                  |    43,913 |
| Records with setup DIDs                     |    43,913 |
| Unique case-normalized display names        |    27,203 |
| Duplicate display-name groups               |     3,279 |
| Records belonging to duplicate-name groups  |    19,989 |
| Mean display-name UTF-8 bytes               |     18.28 |
| Maximum display-name UTF-8 bytes            |        62 |
| Display names beginning with an ASCII digit |        44 |

The largest duplicate groups include `Apartment` (3,001), `Cottage` (2,637), `Villa` (588),
`Surface` (452), and `Door` (354). A result is therefore always a distinct WCID record; neither the
host nor frontend may collapse results by display name. Display name alone is not an adequate
selection receipt, so every row and selected state must expose WCID and class name.

A warm diagnostic loop that fully decoded all 43,913 templates through the existing point-lookup
API took about 305 ms on the current development machine. The implementation must measure the new
prefix-only identity projection separately. This plan does not justify either a `.hwc` format change
or full-template decoding per query.

## Confirmed Product Decisions

1. The picker is one visible field labeled **Weenie**, with placeholder “Name, class, or WCID.”
2. All-decimal text and any text beginning with the explicit `0x`/`0X` prefix stay in direct-WCID
   mode and bypass fuzzy search. Valid values can spawn; partial, malformed, or overflowing values
   show numeric validation without briefly becoming name queries. Other digit-leading text such as
   `11-sec Firespurt` remains searchable by name.
3. Text searches display name primarily and ACE class name secondarily.
4. Selecting a suggestion resolves an exact WCID but does not spawn it.
5. Enter selects the highlighted suggestion while the listbox is open; a later Enter submits the
   selected or direct-WCID target.
6. Blur never selects the first fuzzy result. Only click or explicit keyboard selection commits.
7. Editing a committed catalog selection immediately returns the picker to editing state and drops
   the stored WCID.
8. Successful spawn retains weenie selection and distance for repeat-spawn workflows.
9. The result list shows display name, decimal WCID, and class name. It initially carries no fuzzy
   match ranges or per-character highlighting.
10. Results are bounded to 32 entries in both the frontend request and host hard maximum and
    ordered completely by the host. Scores are not transported because the frontend has no named
    consumer for them.
11. The spawn composer remains persistently open; the primary creation workflow does not require a
    disclosure click.
12. Despawn moves from every wearer row into the selected wearer's inspector action bar.
13. Held children remain selectable for inspection but receive no fake independent despawn or
    possession controls; the inspector identifies and can select their wearer.
14. Possession/stance controls render only when applicable. Verbose boom-camera and control-source
    data move into a collapsed Diagnostics disclosure.
15. Search errors remain local to the picker and do not disable valid direct WCID spawning.
16. The complete catalog never crosses into JavaScript; only bounded result DTOs do.
17. The current population row marks the exact possessed GUID and generation visibly; replacement
    generations cannot inherit the marker.

## Target Ownership and UI Shape

### Ownership

| Decision or state                                                   | Owner                              | Consumers                                    |
| ------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------- |
| Catalog identity-prefix decoding                                    | `holtburger-weenie-catalog`        | Explorer host index construction             |
| Searchable candidates and fuzzy ordering                            | Explorer Tauri host                | Tauri command                                |
| Query bounds and result limit                                       | Explorer Tauri host contract       | Frontend session                             |
| Query revision, highlighted option, and committed catalog selection | Spawn composer                     | Combobox presentation and submit resolution  |
| Direct WCID parsing                                                 | Frontend command helper            | Spawn composer                               |
| Camera-relative spawn placement                                     | `ExplorerApp`                      | Existing host spawn command                  |
| Current dynamic entities                                            | Existing entity mirror             | Entity list and inspector                    |
| Selected live GUID                                                  | Entities panel composition         | List and inspector                           |
| Active mutation kind/identity                                       | Entities panel composition         | Spawn composer and inspector action feedback |
| Hierarchy semantics                                                 | Existing `buildExplorerEntityTree` | Entity list and child inspector context      |
| Diagnostic disclosure state                                         | Inspector                          | Inspector presentation only                  |

The frontend computes the resolved spawn target once. `ExplorerApp` receives `(wcid: number,
distance: number)` and does not parse names, inspect catalog selections, or re-derive WCIDs.

### Proposed Component Cutover

- `ExplorerEntitiesPanel.svelte`
  - composition, selected GUID, tagged mutation coordination, and operation routing;
- `ExplorerEntitySpawnComposer.svelte`
  - discriminated picker state, debounced search, stale response rejection, listbox keyboard model,
    distance, and spawn submission;
- `ExplorerEntityList.svelte`
  - pure wearer/child population projection and selection;
- `ExplorerEntityInspector.svelte`
  - selected identity, wearer-only actions, applicable possession/stance controls, compact semantic
    facts, and collapsed diagnostics.

Do not introduce a generic store, context, component superclass, or application-wide combobox. The
four components share one narrow Entities-tab composition and explicit typed props.

### Intended Layout

```text
spawned 12 · catalog ready (43,913)

┌─ Spawn entity ──────────────────────────────────────────┐
│ Weenie                                                  │
│ [ Rynthid ass…                                       × ] │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Rynthid Assessment Crystal              WCID 52077 │ │
│ │ rynthidassessmentcrystal                           │ │
│ └─────────────────────────────────────────────────────┘ │
│ Distance [ 5.0 ]                    [ Spawn in front ] │
└─────────────────────────────────────────────────────────┘

CURRENT ENTITIES
┌ Clay                                         WCID 1 ┐
│ 0x70000001 · simulated                              │
├─ Long Sword                                WCID 359 ┤
│ 0x70000002 · held at right hand                     │
└─────────────────────────────────────────────────────┘

SELECTED
Clay · WCID 1
0x70000001 · generation 4

[Possess]                                      [Despawn]

Placement   grounded
Physical    simulated

Stance      [ NonCombat                       ]

▶ Diagnostics
```

The suggestion list should visually overlay content below the picker, use a bounded internal scroll,
and remain within the Explorer dock's clipping/stacking context. If the existing scroll container
prevents a robust overlay, prefer an in-flow bounded list over adding portal or top-layer machinery.
The interaction must remain stable and readable at the dock's current 420 px maximum width.

## North Stars

1. **Search resolves identity; it never becomes identity.** Every mutation still enters the runtime
   with one explicit WCID.
2. **Creation stays ready; population stays primary.** The compact composer is always available,
   while the live entity list remains the panel's central master view and diagnostics disclose only
   when requested.
3. **Ambiguity must be visible.** Duplicate names remain separate records with class name and WCID.
4. **One decision per layer.** The host orders results, the picker commits one result, and the app
   places one resolved WCID; no consumer repeats another layer's choice.
5. **Keyboard behavior is part of correctness.** The picker cannot be considered complete if it is
   only usable by mouse or silently commits on blur.
6. **Applicable controls only.** Held children and unpossessed entities do not display actions they
   cannot perform.
7. **The cutover pays down the component debt it touches.** Remove the shared pending/error blob,
   row-local despawn chrome, fixed list height, and stale WCID-only vocabulary in the same change.
8. **Bound the work by the real population.** Forty-four thousand short names deserve a compact
   in-memory host index, not a database, browser-side catalog replica, or format migration.

## Phased Implementation

### Phase 0: Baseline and Contract Dry Run

#### Deliverables

- Re-run and record the catalog identity census if `dats/weenies.hwc` changed since this plan.
- Trace the proposed result DTO through catalog reader → Explorer catalog source → driver → Tauri
  adapter → session → panel without adding an alternate authority.
- Prepare the final user-run visual and interaction acceptance checklist before UI implementation.

#### Task Checklist

- [x] Verify the current `.hwc` format version and prefix field order.
- [x] Verify current record/name/setup counts and largest duplicate groups.
- [x] Record baseline host startup and full-template scan timings on the implementation machine.
- [x] Confirm all nonvisual picker decisions that can be extracted as pure state transitions have a
      focused TypeScript test path without mirroring Svelte markup.
- [x] Record the exact final Explorer scenarios the user will inspect, including duplicate names,
      long names, direct WCID input, held children, and constrained dock width.
- [x] Dry-run every new field to a named consumer and remove fields with no consumer.
- [x] Record any course correction in this plan before Phase 1.

#### Acceptance Criteria

- The source, ownership, serialization, and consumer of every proposed field are explicit.
- Automated contract/state coverage and the final user acceptance checklist are concrete before UI
  code begins.
- No `.hwc` migration, shared-runtime change, or catalog-to-browser bulk transfer is required.

#### Decisions and Course Corrections

- Completed 2026-08-23. The current artifact remains format v6 with 43,913 records, names, and setup
  DIDs; the duplicate and digit-leading distributions above are unchanged.
- A warm existing full-template loop completed in 279 ms (`237 ms` user, `40 ms` system). The full
  debug host reached its ready message in 5,043 ms after a warm build. These are local baselines, not
  performance budgets; Phase 1 records the identity-only scan separately.
- The result contract dry-runs without unused facts: Rust ranking consumes normalized name/class
  text but returns only `wcid`, `name`, and `className`; the picker consumes all three and resolves
  one numeric WCID; `ExplorerApp` consumes that WCID for the unchanged spawn request.
- Picker coordination will expose pure input classification and request-revision decisions for
  TypeScript tests. DOM focus/stacking remains Phase 6 user acceptance, per the user's explicit
  verification choice.
- No plan expansion or blocking gap was found. Phase 1 proceeds without a catalog format change.

### Phase 1: Add the Lightweight Catalog Identity Projection

#### Deliverables

- A documented `holtburger-weenie-catalog` identity-summary type carrying only WCID, class name,
  and optional display name.
- A reader API that enumerates those summaries in canonical WCID order by decoding only the payload
  prefix.
- Focused codec/reader coverage for absent names, UTF-8 errors, malformed prefix fields, canonical
  ordering, and unchanged point lookup.
- Measured identity-scan latency and retained index footprint against the current catalog.

#### Task Checklist

- [x] Add and comment the public summary type beside `WeenieTemplate`.
- [x] Reuse the codec's existing string validation; do not create a second permissive decoder.
- [x] Stop decoding after the display-name field while retaining exact malformed-prefix errors.
- [x] Read records in index order without performing a binary search for every WCID.
- [x] Keep full template lookup behavior and `.hwc` version unchanged.
- [x] Add reader tests with multiple records and malformed identity prefixes.
- [x] Measure the complete 43,913-record summary scan before choosing any further optimization.

#### Acceptance Criteria

- The current catalog produces 43,913 ordered summaries with the measured name distribution.
- No full appearance, physics, or wielded payload is decoded to construct the search projection.
- The catalog file is not re-exported and its version does not change.
- Catalog crate tests pass without weakening existing corruption checks.

#### Decisions and Course Corrections

- Completed 2026-08-23. `WeenieTemplateIdentity` is the deliberately incomplete public projection;
  `WeenieCatalog::template_identities` is its only constructor over a catalog.
- The reader performs one contiguous read of the already-validated payload region and slices records
  in canonical index order. It decodes only WCID, the otherwise-discarded weenie type, class name,
  and optional display name; full lookup remains the only complete decoder/validator.
- Three warm scans of the current 43,913-record catalog took 33.953, 30.291, and 29.575 ms. The
  returned vector and owned string capacities retain approximately 4,206,489 bytes. The temporary
  7.36 MB payload buffer is released when the scan returns.
- No format migration, re-export, cache, or additional indexing machinery was justified. The
  temporary measurement binary was removed after recording these figures.
- Focused tests now cover canonical ordering, absent names, invalid option tags, invalid UTF-8,
  unchanged point lookup, and the existing corruption suite. All 21 catalog tests and catalog
  Clippy with warnings denied pass.

### Phase 2: Own and Expose Bounded Search in the Explorer Host

#### Deliverables

- An immutable search index owned by `ExplorerWeenieCatalog`, initialized once on first search and
  cached for later queries without blocking application startup.
- A focused search request/result/error contract.
- Fuzzy ranking using a proven Rust library added through Cargo tooling without a guessed version.
- One read-only driver method consumed by the Tauri adapter.
- A `search_explorer_weenies` Tauri command.

#### Search Contract

- Request:
  - trimmed textual query;
  - positive result limit with a host maximum of 32;
  - a bounded query length with one named constant and one exact error.
- Result:
  - ordered entries containing `wcid`, `name`, and `className` only.
- Behavior:
  - empty text returns an empty list;
  - missing display names are not suggested because spawn currently requires a display name;
  - display-name exact and prefix matches outrank ordinary fuzzy display-name matches;
  - class-name matching is supported with a lower default priority than comparable display-name
    matching;
  - duplicate names remain distinct;
  - ties within the same match quality and field priority resolve by WCID;
  - no score or match-range field crosses the adapter boundary.

#### Task Checklist

- [x] Add the fuzzy dependency with Cargo so the package manager selects the current compatible
      version.
- [x] Add a lazy once-only index whose initialization failure is retained and returned loudly on
      every later search rather than silently retrying or producing partial results.
- [x] Keep the index immutable after construction and safe for concurrent read-only searches.
- [x] Ensure search does not acquire the entity driver's mutation mutex or touch entity state.
- [x] Run Tauri search work through `spawn_blocking`.
- [x] Test exact, prefix, typo, class-name, duplicate, deterministic-limit, invalid-limit,
      overlong-query, unavailable-catalog, and index-initialization failure cases.
- [x] Measure first-query index construction and warm-query latency over representative short,
      duplicate-heavy, typo, and no-match queries.

#### Acceptance Criteria

- Tauri returns the driver's ordered DTO unchanged for the same request and catalog.
- Search never mutates or serializes against entity lifecycle operations.
- Duplicate names remain individually selectable by WCID.
- First-query and warm-query measurements are recorded in this plan; no additional indexing
  machinery is added without a measured need.
- Clippy reports no warnings.

#### Decisions and Course Corrections

- Completed 2026-08-23. The app-local host now owns one immutable, lazily initialized candidate
  index and uses `nucleo-matcher` 0.3.1, selected through `cargo add`, for Unicode-aware fuzzy
  scoring. Exact and prefix quality are explicit boosts; comparable display-name matches outrank
  class-name matches; WCID provides the deterministic final tie-break.
- The request boundary validates a positive limit no greater than 32 and a query no greater than
  128 UTF-8 bytes. Results contain only WCID, display name, and class name. Empty queries do not
  initialize the index, nameless records are omitted, and the first identity-read failure is cached
  and returned on every later request.
- Search delegates through a read-only driver method without taking the entity mutation mutex. The
  Tauri adapter performs the synchronous scan through `spawn_blocking` and returns the ordered DTO
  unchanged.
- Against the current 43,913-record artifact, an optimized first query including identity decode
  and index construction took 12.874 ms. Warm averages were 0.983 ms for an exact long name, 2.753
  ms for duplicate-heavy `Apartment`, 1.631 ms for typo `Rynthd Assesment`, and 1.386 ms for a
  no-match query. Unoptimized warm timings were 9.983, 35.399, 19.003, and 13.531 ms respectively.
  These measurements do not justify a database, background worker, incremental matcher, or catalog
  format change; the temporary measurement binary was removed.
- All 202 `holtburger-3d` library tests, workspace formatting, and app-host Clippy with warnings
  denied pass.

### Phase 3: Add the Typed Frontend Search and Spawn-Target Contract

#### Deliverables

- Zod-validated search request/result DTOs in `explorer-entity-commands.ts`.
- An `ExplorerDynamicEntitySession.searchWeenies` method over the existing injected transport.
- A discriminated picker-state and spawn-target resolver owned by the spawn composer layer.
- A numeric `(wcid, distance)` spawn callback into `ExplorerApp`.

#### Task Checklist

- [x] Decode every returned WCID as unsigned 32-bit and require non-empty name/class-name strings.
- [x] Keep direct decimal and prefixed-hex parsing behavior unchanged.
- [x] Classify all-decimal and `0x`/`0X`-prefixed input as numeric intent before validating it, while
      leaving mixed digit-leading names available to text search.
- [x] Represent editing and committed selection as distinct typed states; do not pair nullable
      selection fields with assertions or fallbacks.
- [x] Compute the final numeric spawn target once before calling `ExplorerApp`.
- [x] Change `ExplorerApp.spawnExplorerEntity` to accept a validated numeric WCID and remove its raw
      input parsing responsibility.
- [x] Add session tests for command name, request envelope, response decoding, and malformed host
      responses.
- [x] Add pure tests for numeric target resolution and selection invalidation.
- [x] Do not expose fuzzy scores, catalog paths, or whole catalog records to the picker.

#### Acceptance Criteria

- Existing decimal and hexadecimal unit cases still pass.
- A selected result and a direct numeric entry both produce the existing numeric spawn request.
- Arbitrary unselected text cannot reach `createExplorerSpawnRequest`.
- Host response validation fails loudly before invalid data reaches Svelte state.

#### Decisions and Course Corrections

- Completed 2026-08-23. Search request and result DTOs are runtime-validated at the injected
  transport boundary. Returned WCIDs must be unsigned 32-bit integers and result names/class names
  must be nonempty; malformed host output fails before entering component state.
- `ExplorerWeeniePickerState` is a discriminated editing/selected union. Its pure classifier keeps
  partial hex, overflowing decimal, and other numeric intent out of fuzzy search while preserving
  mixed digit-leading catalog names. Its resolver is the only frontend decision that turns picker
  state into a spawn WCID.
- `ExplorerApp.spawnExplorerEntity` now accepts a numeric WCID and only owns camera-relative
  placement. The old panel temporarily calls the existing parser at its composition boundary until
  the Phase 4 clean cutover replaces that UI with the picker resolver; no second parsing path was
  introduced.
- Focused command, picker-state, and session suites pass (18 tests), including the exact Tauri
  envelope, malformed responses, direct decimal/hex resolution, numeric-intent errors, explicit
  selection, and edit invalidation. The full TypeScript/Svelte check reports no diagnostics.

### Phase 4: Clean-Cutover the Entities Panel

#### Deliverables

- `ExplorerEntitySpawnComposer.svelte`.
- `ExplorerEntityList.svelte`.
- `ExplorerEntityInspector.svelte`.
- A reduced `ExplorerEntitiesPanel.svelte` that composes those focused pieces.
- Master/detail styling consistent with existing Explorer primitives at 420 px and narrower viewport
  constraints.
- Complete ARIA combobox/listbox semantics and keyboard behavior.

#### Spawn Composer Checklist

- [x] Add the full-width Weenie picker and second-row Distance/Spawn controls.
- [x] Debounce textual queries and attach a monotonically increasing local revision to each request.
- [x] Ignore every response whose revision is not current, including errors from stale requests.
- [x] Bypass search for all numeric-intent input, including partial or invalid `0x` forms and decimal
      overflow; render its exact validation state locally.
- [x] Render no list for empty input; render expected no-match feedback without `role="alert"`.
- [x] Render search failures locally with `role="alert"` while keeping valid direct WCID entry usable.
- [x] Support Arrow Up/Down, Enter, Escape, pointer selection, explicit clear, and Tab/blur without
      implicit selection.
- [x] Use `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`,
      `role="listbox"`, `role="option"`, and `aria-activedescendant` correctly.
- [x] Preserve the committed target and distance after successful spawn.
- [x] Keep the result list bounded and internally scrollable; do not let it resize the entire panel
      on every query.

#### Population and Inspector Checklist

- [x] Replace the hard 235 px list ceiling with a bound derived from available dock/viewport space.
- [x] Keep wearer/child connectors and atomic hierarchy semantics through
      `buildExplorerEntityTree`.
- [x] Remove row-local trash actions and their compensating right padding.
- [x] Show one compact primary row plus muted identity/placement detail.
- [x] Move wearer despawn and possession into the selected wearer action bar.
- [x] For a selected held child, identify its wearer and offer selection of that wearer without
      pretending the child has an independent lifecycle.
- [x] Show stance controls only for the currently possessed eligible wearer.
- [x] Keep compact placement/physics facts visible and move boom/control-source telemetry under a
      collapsed Diagnostics disclosure.
- [x] Replace the shared boolean pending state with a tagged operation carrying the affected action
      and identity where applicable.
- [x] Present spawn, despawn, and possession failures adjacent to their originating action.
- [x] Clear or reconcile selection when the selected generation leaves the current feed.

#### Composition and Vocabulary Checklist

- [x] Add a compact `spawned N · catalog ready (M)` header above the always-open spawn composer.
- [x] Keep the exact catalog path available through a title/disclosure without spending a permanent
      full line on it.
- [x] Rename user-facing capability/error language from “WCID spawning” to “Weenie spawning.”
- [x] Preserve WCID terminology in identifiers, result rows, selected identity, and exact errors.
- [x] Remove superseded CSS, event handlers, shared error state, and old component branches in the
      same cutover.

#### Acceptance Criteria

- The panel has one source of truth for selected live identity and one tagged mutation state.
- No component re-parses a catalog result or re-derives its WCID.
- Keyboard-only use can search, inspect duplicate results, select, clear, and spawn.
- Direct numeric entry is no slower or more complicated than before.
- Held children expose no unsupported wearer lifecycle actions.
- The component cutover reduces responsibility in `ExplorerEntitiesPanel.svelte`; it does not merely
  move markup while duplicating state.

#### Decisions and Course Corrections

- Completed 2026-08-23, pending the explicitly deferred Phase 6 visual acceptance. The old monolith
  now composes a focused spawn composer, hierarchy list, and inspector. The parent retains only
  exact live selection and one serialized tagged operation/failure authority.
- The combobox debounces 160 ms, requests 32 host-ranked results, rejects stale success and failure
  through one tested revision decision, and implements explicit keyboard/pointer selection without
  blur commitment. Active options are scrolled into the bounded list viewport as keyboard focus
  moves.
- Population rows no longer carry destructive chrome. Their scroll ceiling now derives from the
  viewport, held children expose wearer navigation rather than unsupported lifecycle controls, and
  generation-aware selection clears when the exact selected generation leaves the feed.
- Wearer actions, applicable stance controls, compact semantic facts, and collapsed diagnostics are
  separated in the inspector. Tagged operations include exact entity generation where applicable;
  the whole action surface serializes safely while progress labels and failures remain local.
- The search list currently uses the plan's preferred narrow absolute overlay. Its real dock
  clipping and stacking behavior deliberately remains a user-owned Phase 6 check; an in-flow
  bounded fallback is the recorded response if the existing scroll container clips it.
- Full frontend tests (1,351), Svelte/TypeScript checks, ESLint, dead-code lint, Rust Clippy with
  warnings denied, and Prettier all pass after the cutover.

### Phase 5: Cleanup, Automated Verification, and Documentation Reconciliation

#### Deliverables

- Removed dead WCID-only UI paths, obsolete CSS, unused props, and superseded tests.
- Focused automated coverage of catalog decoding, ranking, DTO validation, numeric intent, picker
  state transitions, stale-response rejection, hierarchy projection, and mutation coordination.
- Updated app/catalog architecture documentation only where the new durable boundary changes it.
- Final measurements, decisions, and course corrections recorded in this plan.
- Full scoped format, test, check, and lint evidence.

#### Task Checklist

- [x] Sweep `apps/holtburger-3d` for obsolete “WCID spawning” labels and old callback signatures.
- [x] Ensure the pure picker-state tests cover direct WCID, numeric-intent errors, explicit catalog
      selection, selection invalidation, stale success, stale failure, and retained post-spawn state.
- [x] Run `cargo fmt --all --check`.
- [x] Run focused `holtburger-weenie-catalog` and `holtburger-3d` Rust tests.
- [x] Run `npm run test:ts` from `apps/holtburger-3d`.
- [x] Run `npm run check` from `apps/holtburger-3d`.
- [x] Run `npm run lint` from `apps/holtburger-3d`, treating Clippy warnings as errors.
- [x] Run `npm run format:check` from `apps/holtburger-3d`.
- [x] Inspect final diffs for unused DTO fields, duplicated ranking, assertions/fallbacks over own
      types, stale styles, and accidental shared-crate UX policy.
- [x] Update this plan's measurements, phase outcomes, and remaining debt.

#### Acceptance Criteria

- All focused and package-wide checks pass without inline lint suppression.
- The final code contains one host ranking implementation and one frontend spawn-target decision.
- No vestigial row-local despawn, shared pending boolean, fixed list ceiling, or raw-string spawn
  callback survives.
- Automated tests prove every nonvisual state transition extracted from the Svelte component.
- Documentation describes the landed ownership rather than the discarded implementation shape.

#### Decisions and Course Corrections

- Completed 2026-08-23. The vocabulary/signature sweep found no surviving Explorer WCID-only spawn
  callback or user-facing “WCID spawning” label. The browser harness retains its independent raw
  WCID diagnostic API, which is outside this panel cutover and still consumes the shared parser.
- Pure state coverage now includes numeric intent and failures, explicit selection/edit
  invalidation, one stale-settlement rule for successes and failures, retained committed state after
  target resolution, and generation-scoped mutation feedback. Existing hierarchy tests continue to
  cover wearer/child/orphan projection.
- Durable docs now distinguish the host-only full catalog/template boundary from the bounded ranked
  identity DTOs returned to the Explorer picker. No frontend UX policy moved into a shared runtime
  crate; only format-level prefix decoding lives in `holtburger-weenie-catalog`.
- Final automated evidence: 21 catalog tests; 202 app-host tests plus binary/doc targets; 1,351
  frontend tests; zero Svelte/TypeScript diagnostics; ESLint and dead-export checks clean; app and
  catalog Clippy clean with warnings denied; Cargo and Prettier format checks clean; `git diff
--check` clean.
- The component cutover adds deserved interaction/state surface while shrinking the coordinator
  from 514 to 248 lines. The three focused UI components and two pure state modules make the total
  panel implementation larger than the old WCID-only monolith, but each new state/field has a named
  combobox, hierarchy, inspector, accessibility, or verification consumer; dead-code lint found no
  unused exports.
- No implementation debt remains besides the explicitly deferred real-Explorer visual/interaction
  acceptance and its possible in-flow suggestion-list fallback.

### Phase 6: User Visual and Interaction Acceptance

#### Deliverables

- A user-run review in the real Explorer after implementation and automated cleanup are complete.
- Visual feedback and any resulting course correction recorded in this plan.
- Final plan status set only after the user accepts the panel or requested corrections land.

#### Task Checklist

- [x] Hand the user the exact startup command and a concise acceptance checklist.
- [ ] At the normal dock width, inspect empty, searching, no-match, duplicate-result, committed
      selection, populated-list, wearer-selected, and held-child-selected states.
- [ ] Constrain the window/dock and inspect long names, result scrolling, horizontal overflow,
      clipping, control collision, and readable focus outlines.
- [ ] Exercise decimal and `0x` direct entry, typo search, class-name search, keyboard result
      selection, Escape, blur, clear, repeated spawn, selection, possession, stance, and despawn.
- [ ] Confirm Enter selects while the list is open and does not spawn until the later submit.
- [ ] Confirm duplicate results remain distinguishable by WCID and class name.
- [ ] Confirm held children expose wearer context but no independent lifecycle actions.
- [x] Record the user's findings and implement requested corrections before marking the plan
      complete.
- [ ] Have the user recheck corrected Olthoi ordering, 32-result scrolling, possessed-row
      indication, the always-open composer, and responsive gameplay with the Entities tab open.

#### Acceptance Criteria

- The user accepts the panel's hierarchy, density, visual treatment, clipping behavior, and focus
  flow in the real Explorer.
- The user confirms both fuzzy-selection and direct-WCID spawn workflows behave as intended.
- Every requested correction either lands and is rechecked or is recorded as explicitly accepted
  follow-up debt.

#### Decisions and Course Corrections

- Handoff prepared 2026-08-23. Run `cd /home/cluracan/code/holtburger/apps/holtburger-3d &&
npm run dev:explorer`, open the Entities tab, and use the checklist above. The highest-risk visual
  observation is whether the autocomplete overlay remains unclipped inside the dock's scrolling
  body at normal and constrained heights. No remaining Phase 6 observation has been pre-accepted.
- First user review recorded 2026-08-23: the panel mostly works well. Requested corrections were a
  less surprising `Olthoi` result order, 32 rather than 12 suggestions, and a visible possessed
  entity marker in the population list.
- The current artifact proves WCID 3 is authored as `Olthoi Worker` / `olthoiworker`; the exact-name
  `Olthoi` records are WCIDs 42906 and 44756. Exact names therefore remain first. The surprising
  behavior came from alphabetic display-name ordering among equal-quality prefixes, which placed
  `Olthoi Worker` below many higher WCIDs and outside the old 12-result window. Equal-quality ties
  now use WCID. Against the production catalog, `Olthoi` now returns
  WCIDs 42906 and 44756 first as exact names, followed by WCID 3, then 212, 213, 214, 248, and 384.
- The frontend and host bound were cleanly cut over together from 12/20 to 32/32. This remains a
  bounded DTO and internally scrollable list; no complete catalog data crosses into JavaScript.
- Population rows now receive the active possession's composite GUID/generation identity and render
  a visible `possessed` label plus inset status rule only on that exact generation.
- Second user review correction recorded 2026-08-23: the spawn composer now remains mounted and
  visible whenever the Entities tab is open. The disclosure state and button were deleted rather
  than retained as a dormant mode.
- Third user review correction recorded 2026-08-23: possession is ordinary selected-entity state,
  not a separate information tier. The redundant Possession disclosure was removed and its
  applicable stance control now renders directly in the Selected group; Diagnostics remains the
  panel's only inspector disclosure.
- Hot-path review found two reactive publication leaks. Integrated entity advances cloned, sorted,
  and assigned the entire mirror into Svelte at the 30 Hz host cadence, rebuilding the selected and
  hierarchy projections. Boom status was also allocated and assigned into Svelte on every render
  frame even while Diagnostics was closed. Neither publication was required by presentation.
- The entity panel now receives a cold mirror snapshot only for snapshots, upserts, removals, and
  discontinuous teleport/reset corrections. Integrated advances continue directly from the host
  session into runtime presentation without touching panel state. This remains a projection of the
  one authoritative mirror rather than a second entity authority.
- Volatile selected-entity and boom status are now pull-only callbacks. Population rows retain only
  structural placement facts; while Diagnostics is expanded, the inspector samples the exact
  selected generation at 2 Hz and samples boom status only when that entity is possessed. Closing
  the disclosure, changing selection, or unmounting the Entities tab tears down the timer. No boom
  diagnostic state crosses Svelte at RAF cadence.
- Correction verification is clean: 21 catalog tests, 202 app-host tests, 1,352 frontend tests,
  Svelte/TypeScript checks, ESLint, dead-code lint, app/catalog Clippy with warnings denied, and
  Cargo/Prettier formatting all pass.
- The pre-commit quality pass collapsed numeric picker validity into a discriminated result,
  removed unconsumed possession/stance operation fields, made inspector possession checks
  generation-aware, named the ranking kind/field priorities, and deleted an unreachable tie-break
  after unique WCID ordering. The frontend boundary now owns one named 32-result constant for both
  requests and responses and rejects duplicate result WCIDs before keyed Svelte state observes
  them. The complete gate above remains clean after these corrections.

## Risks and Mitigations

| Risk                                                                                         | Mitigation                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate names make results appear interchangeable                                          | Preserve every WCID record and show display name, WCID, and class name in both result and committed-selection UI                                                                                                                             |
| Fuzzy ranking becomes an invented algorithm with unstable results                            | Use a proven library, add explicit exact/prefix boosts, and pin deterministic tie-breaks in focused tests                                                                                                                                    |
| Initial index construction stalls app startup                                                | Build lazily on the blocking search path, cache the immutable result once, show honest first-search progress, and measure before adding more machinery                                                                                       |
| Fast typing allows an old response to replace current results                                | Frontend query revisions reject all stale successes and failures; the host remains stateless per request                                                                                                                                     |
| Partial numeric input flickers into fuzzy-name mode, while some real names begin with digits | All-decimal and explicit `0x`-prefixed text remains numeric intent even when invalid; other mixed digit-leading text remains searchable. The current catalog contains 44 digit-leading names, so a blanket first-character rule is forbidden |
| Enter accidentally spawns the first fuzzy result                                             | While the listbox is open, Enter only commits the highlighted result; blur never commits                                                                                                                                                     |
| An overlay is clipped by the dock's scrolling container                                      | Keep the overlay implementation narrow, then have the user prove stacking in Phase 6; fall back to an in-flow bounded list before introducing portal/top-layer infrastructure                                                                |
| Component extraction creates several state authorities                                       | Keep selected GUID and tagged mutation coordination in the parent; children own only their focused ephemeral presentation state                                                                                                              |
| Live entity/camera telemetry makes the panel part of simulation or render cadence             | Publish entity snapshots only for lifecycle/discontinuous corrections; route integrated advances directly to presentation; pull volatile selected-entity and boom diagnostics at 2 Hz only while their disclosure is open              |
| Search starts validating runtime spawnability and duplicates driver logic                    | Index only ACE name/class/WCID facts; actual spawn remains the sole setup/content/physics validation path                                                                                                                                    |
| Deferring visual verification until the end allows layout defects to survive longer          | Keep the UI cutover structurally simple, provide a precise final acceptance matrix, and do not mark the plan complete until the user's real-Explorer review and corrections finish                                                           |
| App-local search policy leaks into shared content/runtime crates                             | Keep only format-level identity decoding in `holtburger-weenie-catalog`; ranking, DTOs, limits, and UI remain under `apps/holtburger-3d`                                                                                                     |
| The redesign expands into all Explorer tooling                                               | Touch shared visual primitives only when an existing primitive cannot express the agreed Entities-tab design; do not migrate other tabs opportunistically                                                                                    |

## Definition of Done

- [ ] Users can enter decimal or prefixed hexadecimal WCIDs exactly as before.
- [ ] Users can fuzzy-search display names and ACE class names and see bounded autocomplete results.
- [ ] Duplicate display names remain distinct and visibly identified by WCID and class name.
- [ ] Search selection is explicit; blur never commits and one Enter cannot both select and spawn.
- [ ] Successful spawn retains the chosen target and distance.
- [x] The host owns one deterministic fuzzy ordering used by Tauri.
- [x] The browser receives only bounded DTOs, never the complete catalog or fuzzy scores.
- [x] The panel presents an always-open spawn composer, primary population list, and selected-entity
      detail separately.
- [x] Despawn and possession appear only for eligible wearer selections.
- [x] Verbose diagnostics are collapsed by default.
- [x] Pending and error UI identifies the operation that owns it.
- [ ] The user verifies keyboard behavior and ARIA-visible focus flow in the real Explorer.
- [ ] The user accepts the visual result at normal and constrained widths.
- [x] Search/index measurements justify the landed simple in-memory design.
- [x] Rust tests, TypeScript tests, checks, Clippy, lint, and formatting all pass.
- [x] No dead WCID-only panel path, duplicate ranking logic, compatibility shim, or unexplained debt
      remains.

## Open Questions

No product decision currently blocks implementation. The user owns final visual and interaction
acceptance in Phase 6. Implementation may reach “awaiting visual acceptance,” but the plan must not
be marked complete until that review and any requested corrections finish.
