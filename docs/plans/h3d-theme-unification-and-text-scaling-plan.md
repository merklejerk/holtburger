# H3D theme unification and UI text scaling

Status: user accepted the implemented UI and authorized final code-quality review and commit. Two bounded review findings have been fixed and final regression verification passes. Ready to commit within the reviewed scope. The broad theme contrast check has a reproduced baseline failure outside this change. Created 2026-10-22.

## Goal and boundaries

Survey H3D's styling system, consolidate demonstrated inconsistencies, and complete the global UI text-scaling preference without compromising theme customization or usable layouts.

The sequence is survey → evidence-based design → prerequisite consolidation → text scaling → remaining theme consolidation → cleanup and acceptance. Typography is a candidate first implementation slice, not a conclusion established before the survey. Reorder the implementation slices if the survey exposes a more fundamental ownership problem.

In scope:

- Survey theme variables, shared style recipes, component-local styling, cascade ownership, and text/layout sizing across client, Explorer, and shared app UI.
- Consolidate duplicate or competing styles and variables where consumers demonstrate the same responsibility. Cover colors, typography, spacing, control states, and chrome; do not reduce the survey to font sizes.
- Implement the existing disabled Text scaling control as a persistent user preference with consistent coverage, live updates, and safe startup application.
- Resolve text-related layout constraints and explicitly classify text that has independent sizing policy.
- Automated behavioral verification and user-owned visual acceptance.

Out of scope:

- Implementing the separate Icon scaling placeholder, whole-application zoom, a new theme editor, or a visual redesign.
- Adding an Explorer preferences surface unless separately requested. Shared styles still need Explorer regression coverage.
- Moving frontend appearance policy into shared Rust crates or changing gameplay/protocol behavior.
- A new generic UI framework or a variable for every individual declaration.

Implementation authorized by the user on 2026-10-22; stop for a major blocker, gap, or required user acceptance.

## Ground truth and initial evidence

Paths in this section are relative to `apps/holtburger-3d/`. These observations are an initial inspection, not the completed survey.

| Concern | References and observed facts |
| --- | --- |
| Existing controls | `src/client/ClientSettingsPanel.svelte`: body/heading/mono family selectors work; Text scaling and Icon scaling are disabled ranges showing 100, with placeholder bounds of 50–200. Those bounds are not an accepted product requirement. |
| Preference contract | `src/client/client-settings-contract.ts`, `client-settings-defaults.ts`, `client-settings-values.ts`: UI settings contain fonts and vital thresholds; no text-scale field exists. |
| Persistence | `src/client/client-settings-sections.ts`, `client-settings-persistence.ts`, `client-settings-transport.ts`, `src/client/main.ts`, `electron/client-settings-store.ts`: independently stored sections, validation, bootstrap, and coalesced writes already exist. Inspect current contracts rather than copying historical whole-document migration advice from older plans. |
| Current application | `src/client/ClientApp.svelte`: font-family preferences are applied as custom properties on `client-font-scope`. Survey descendants and independently mounted UI before choosing the scale boundary. |
| Cascade and common controls | `src/app/base.css`, `src/app/ui-base.css`: ordered `base`, `components`, `theme`, `overrides` layers, shared UI classes, typography roles, palette defaults, and component-specific hooks. |
| Default theme | `src/app/themes/holtburger-standard.css`: theme palette, family choices, control appearance, and decorative rules. Some declarations repeat base defaults; determine which repetitions express intentional standalone defaults. |
| Theme lifecycle | `src/app/ui-theme.ts`: stylesheet selection and a change event; imperative appearance consumers can observe theme changes and local scope attributes. Trace each consumer's actual invalidation boundary. |
| Mixed sizing | `src/explorer/explorer.css` and Explorer panels use many local `rem` sizes; `src/app/Minimap.svelte` and `src/client/ClientVendorWindow.svelte` include fixed pixel sizes. Other panels use shared size variables or inherited `em` sizes. |
| Special text | `src/app/ItemCountOverlay.svelte`, `ItemCellVisual.svelte`, `src/client/client-combat-effects-appearance.ts`, `ClientCombatIndicatorSettings.svelte`, and `src/lib/game/renderer/webgl2-nameplate-*`: inventory overlays and world text require explicit classification. Combat text already has an independent size preference. |
| Geometry | `src/client/ClientHudWindow.svelte`, `client-hud-layout.ts`, `ClientPartyHud.svelte`, `ClientSpellBar.svelte`: retained placements, minimum extents, measured HUD geometry, and compact fixed-height controls interact with larger text. |
| Existing verification | `src/harness/browser/UiThemeHarness.svelte`, `UiThemeSpecimen.svelte`, `ClientHudHarness.svelte`, `scripts/ui-theme-probe.mjs`, `client-theme-probe.mjs`, `explorer-theme-probe.mjs`, and `package.json`: extend existing specimens/probes and package scripts. |

The live code is authoritative for app behavior. ACE/ACViewer/retail sources are needed only if a proposed change depends on a game-data or retail-behavior claim; aesthetic choices do not require inventing such a claim. Historical plans are context, not current contracts.

## Ownership and north stars

1. App-wide presentation primitives belong to H3D's shared frontend layer (`src/app`). Theme styles own appearance choices; feature components own feature-specific layout and interaction policy. Electron owns durable storage, not CSS decisions.
2. One owner for each decision. User scale is independent of theme-authored typography; consumers must not each rederive preference policy.
3. Consolidate by deleting competing recipes and migrating real consumers. Similar numeric values alone do not prove shared meaning.
4. Preserve intentional differences. A semantic caption, an icon-bound quantity, and a world label need not share one size merely because all contain text.
5. Ordinary text scales exactly once. No cumulative scaling through nested roots or relative-size chains.
6. Prefer existing CSS and components. Extract a component only for demonstrated shared responsibility; new tokens need named consumers and a reason existing roles cannot serve them.
7. Appearance updates are cold configuration changes. They must not recreate sessions, renderers, windows, or feature owners, or add frame-rate Svelte state.
8. Retain theme customization and observable errors. No hidden fallback that masks invalid persisted settings or a broken appearance contract.

Conceptual flow; exact field/token names remain a survey/design deliverable:

```text
Theme stylesheet ──> authored typography and appearance defaults ─┐
                                                               ├─> app appearance scope
User preference ──> validated text multiplier (neutral = 1) ─────┘       │
        │                                                              ├─> DOM controls/text
        └─> existing section persistence → Electron store               └─> included imperative text

Component layout consumes resulting dimensions; it does not own the preference.
```

## Phase 1 — Survey and coverage inventory

- [x] Inventory stylesheet imports, theme roots, style layers, root/default definitions, override mechanisms, and inline appearance application in both app entries and diagnostic roots.
- [x] Census custom-property definitions and uses, literal appearance values, typography declarations/shorthands, and duplicated common-control recipes. Include Svelte styles, TypeScript-created DOM, SVG text, and canvas/WebGL text consumers.
- [x] Group findings by responsibility: palette/status semantics, typography, spacing, controls/states, surfaces/chrome, and feature-specific geometry. Record unused variables and aliases separately from useful specialization.
- [x] Trace dialogs, tooltips, popup menus, startup/disconnected screens, retained hidden panels, and other independently mounted surfaces for inheritance and override behavior.
- [x] For each text category record units, theme hooks, effective owner, inclusion in global text scaling, layout constraints, and evidence. Mark unresolved coverage choices explicitly.
- [x] Trace DOM-to-imperative appearance reads, font readiness, cached text/texture invalidation, and geometry measurements that must respond to scale or theme changes.
- [x] Record actionable findings in this document with paths, representative consumers, proposed deletions/migrations, intentional exceptions, and rough file/sLOC impact per slice.

Acceptance: every surveyed category has a disposition; each consolidation proposal has concrete producers and consumers; each excluded text surface has a stated reason. Search counts are evidence of coverage, not proof that every literal is a defect. Production files remain unchanged during the survey.

## Phase 2 — Resolve ownership, coverage, and implementation order

- [x] Turn the survey into a bounded migration table: current owners → final owner → affected consumers → removed declarations/symbols → verification.
- [x] Decide whether typography can lead or whether palette/cascade/common-control ownership must be corrected first. Keep unrelated cleanup out of the slider's dependency chain while retaining explicit follow-up slices for the broader unification goal.
- [x] Specify theme-authored sizes, the user multiplier, application scope, and where scaling occurs. Check custom-property computed-value inheritance: multiplying a root-defined variable must actually see a descendant preference, if that is the chosen scope.
- [x] Specify how existing `px`, `rem`, `em`, font shorthands, and specialized size hooks participate without multiplying inherited text twice. Avoid changing the document root size without accounting for every geometry value expressed in `rem`.
- [x] Decide slider range/step behavior, client versus Explorer preference scope, and whether inventory text, map text, nameplates, and independently configured combat text participate.
- [x] Define usable layout behavior at the accepted endpoints: wrapping, scrolling, minimums, truncation policy, and viewport fitting. Preserve reachable close controls and the text slider.
- [x] Select the current section schema-evolution strategy. Define behavior for older UI sections, malformed values, unsupported versions, and preservation of sibling preferences; do not silently reset fonts or vital thresholds.
- [x] Walk the proposed startup, live edit, theme replacement, reset, reopen, and character-switch paths end to end. Revise the phases below to name actual owners, contracts, and files.

Acceptance: coverage and exceptions are explicit, schema evolution is specified, and each consumer has one scaling path. Material product choices are resolved with the user before dependent implementation; routine implementation choices need no additional approval once implementation is authorized.

## Phase 3 — Consolidate prerequisite styles and typography

- [x] Execute the prerequisite slices selected in Phase 2 using existing shared classes and semantic roles where they fit.
- [x] Migrate affected consumers together and remove duplicate recipes, aliases, and obsolete declarations in the same slice.
- [x] Preserve theme override precedence and deliberate component-specific hooks. Keep feature geometry local unless actual shared responsibility is demonstrated.
- [x] Add focused browser assertions for representative token propagation, normal/hover/active/disabled states, and theme overrides. Keep the neutral-scale baseline stable except for explicitly recorded intentional corrections.

Acceptance: prerequisite responsibilities have one owner, touched consumers use it, and baseline behavior passes targeted checks. Explain any justified net code growth against the survey's estimate.

## Phase 4 — Implement persistent text scaling and layout response

- [x] Add the validated preference/default and section evolution, then connect the existing Text scaling control through the current `onUiChange` path. Leave icon scaling disabled and honest.
- [x] Apply restored settings before the affected client UI becomes observable. Reuse existing persistence/error reporting and ensure changes survive reload and character switches.
- [x] Apply the multiplier at the selected appearance boundary and migrate remaining in-scope text consumers. Keep theme family selection, authored size choices, and user scale composable.
- [x] Update included imperative text consumers and measurements on relevant appearance changes. Invalidate only affected caches; do not tie resource lifetime to the preference.
- [x] Fix demonstrated row/control clipping, window minimums, scrolling, and edge anchoring. Do not rescale or overwrite saved HUD placements as a side effect unless Phase 2 explicitly selects that policy.
- [x] Test contract validation/evolution, persistence, and actual computed sizing. Include nested controls, hidden-then-opened panels, dialogs/menus, independent text policies, live changes, and a nondefault theme.

Acceptance: every included text category scales once; excluded categories retain their documented policy; startup/reload/live edits agree; controls remain operable at accepted endpoints.

## Phase 5 — Reassess and finish broader theme consolidation

- [x] Compare the implemented behavior with the survey and revisit remaining risks, code growth, newly discovered consumers, and open decisions.
- [x] Reorder or subdivide the remaining theme slices based on evidence. Do not declare broad unification complete merely because typography and the slider work.
- [x] Complete the migration table's remaining palette, spacing, common-control/state, and surface/chrome consolidations. Preserve deliberate feature-specific variation.
- [x] Verify both client and Explorer after shared style changes, including independently mounted/imperative surfaces and theme replacement.

Acceptance: each survey finding is completed, accepted as intentional, or explicitly deferred with rationale and user agreement for material scope reduction. No duplicate old/new path remains for a completed consolidation.

## Phase 6 — Cleanup and acceptance

- [x] Sweep obsolete token names, aliases, dead CSS, stale scaling comments, misleading tests, and superseded harness expectations. Do not rewrite unrelated historical plans.
- [x] Put any lasting theme-authoring and scaling contract in an appropriate existing app architecture/style document; this plan remains working notes.
- [x] Run relevant package scripts from `apps/holtburger-3d`: `npm run check`, `npm run lint:ts`, `npm run lint:dead`, `npm run format:check`, and focused tests via `npm run test:ts -- <files>`. Fix warnings without inline suppression.
- [x] Use `npm run harness:browser -- ...` and existing theme probes for computed-style, overflow/reachability, lifecycle, and browser-error evidence. Select current arguments from harness help; include client and Explorer paths, alternate themes, small viewports, and accepted scale endpoints. Exercise Electron storage/runtime checks when the settings contract changes.
- [x] Broaden build/test checks only where touched boundaries or failures justify them. No Rust checks are needed for a frontend-only diff.
- [x] Report measured behavior and remaining limitations; hand visual and interactive acceptance to the user. Do not perform visual acceptance on their behalf or run the TUI.

Acceptance: required checks pass, the migration table is reconciled, and user visual acceptance is recorded separately from automated verification.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| A root font change also changes `rem` geometry | Inventory both text and geometry consumers before choosing the scale mechanism. |
| Root-defined derived variables ignore a narrower scale override | Verify the actual computed-value boundary in a browser with distinct theme and user scales. |
| Nested inheritance scales text twice or misses fixed shorthands | Verify computed font-size ratios across representative nesting and each special text category. |
| Larger text fits the font contract but breaks fixed-height HUDs | Pair font measurements with reachability, clipping, overflow, and viewport-bound checks. |
| Cached canvas/WebGL text becomes stale | Trace and test appearance/font invalidation at the owning consumer; avoid per-frame recomputation. |
| Unification erases meaningful distinctions or creates too many tokens | Require responsibility-based evidence and named consumers; track deletion and growth per slice. |
| A new field invalidates existing UI settings | Exercise old-section loading, malformed values, unsupported versions, and sibling preservation against the current section store. |
| Survey grows indefinitely | Cover all categories, then bound implementation by the concrete migration table and reassess between slices. |

## Definition of done

- [x] Survey, decisions, exclusions, and migration table are recorded with source evidence.
- [x] Shared appearance responsibilities have clear frontend-layer ownership and completed migrations have no competing path.
- [x] Global text scaling works consistently across its agreed coverage and composes with themes and family preferences.
- [x] Existing settings survive schema evolution; valid scale values persist and restore before use.
- [x] Included text, layout measurements, and caches update without restarting runtime owners.
- [ ] Broad theme-suite contrast acceptance: focused/static/unit/Electron checks pass, but the pre-existing bright-backdrop contrast failure remains for user disposition. No runtime-asset-dependent tests were added.
- [x] User accepted the implemented typography and scaled layouts before requesting final review and commit.

## Open questions and decision log

Resolved during the survey/design pass; retained here as the original questions for traceability:

- Is the preference client-only, or should the same saved preference also apply to Explorer without adding a settings UI there?
- Which inventory/map overlays count as ordinary UI text? Should nameplates and independently configured combat text remain separate?
- What scale endpoints and increments are useful and supportable? The placeholder's 50–200 range is not evidence of usability.
- Which layout concessions are acceptable at large sizes: additional scrolling, wrapping, or selective truncation?

2026-10-22: Plan requested and created. Initial inspection confirms working family choices, disabled scaling controls, existing theme infrastructure, mixed sizing conventions, and section-based settings persistence. The complete survey and final implementation design are pending.


## Survey findings and migration decisions (2026-10-22)

The census covered 698 production CSS/Svelte/TypeScript files (excluding harness and tests), with 302 custom properties and 1,069 CSS `var()` reads. Forty-one files contain font declarations. SVG assets and imperative string readers were checked separately: absence of a CSS `var()` read does not imply a dead token.

### Ownership and coverage

- `app/mount.ts` loads the document theme before mounting and adds `ui-theme` to `#app`. Client startup restores settings before mounting. The client appearance wrapper contains both the world and startup/character-selection screens, plus dialogs. Production components do not portal text into an unrelated `document.body` tree; native dialogs/popovers retain DOM inheritance in the top layer.
- Nested `ui-theme` roots exist in the world, Minimap, ToggleField, and Explorer tools. They explicitly establish body typography; each must resolve the authored body size and multiplier once, rather than scale its inherited computed font again.
- Palette, controls/states, overlays, management lists, and shared item chrome already have one common recipe in `ui-base.css`. The default theme's repeated palette/family/radius values express its choices independently of generic base defaults; retaining those is intentional. Feature `--filter-color` values represent actual category data. Nearest matching literal values are not grounds for collapsing independent component geometry.
- Eight client components have unlayered styles: CharacterSheetPanel, CombatBar, EmoteWheel, WaypointLink, JournalPanel, BookWindow, ChatFormattedText, CreaturePreview. These outrank the documented theme/overrides layers; put their recipes into `components` so authors can override them consistently.
- Base defaults for `--ui-action-alternate-outline-width` and `--ui-action-alternate-outline-color` have no production consumer, including SVG assets. Delete them. Other apparent unused defaults are consumed by imperative readers or SVG stroke styling and stay.
- User confirmed client-only scaling for panels, dialogs, tooltips, HUD readouts; Explorer retains neutral scale. Icon-bound quantities, equipped marks, key hints (including spell/combat hints), emoji/symbol artwork, map labels/cardinals, world nameplates, and independently sized combat text keep their existing size policies. Map footer coordinates and waypoint readouts are ordinary HUD text and scale.
- World labels/combat text have renderer-owned size/caches; no new invalidation path is needed because they are excluded. DOM and SVG theme consumers already update through the cascade. Party HUD uses a ResizeObserver on a CSS metrics probe, which can accommodate a scale-dependent name row without an additional event bus. Minimap footer bounds are measured; verify their scale response in the browser.

### Bounded migration table

All source paths below are relative to `apps/holtburger-3d/src/`.

| Finding/current owner | Final owner and consumers | Removed/retained behavior | Verification |
| --- | --- | --- | --- |
| Local absolute text sizes across client/Explorer panels | Shared authored size roles in `app/ui-base.css`; migrate ordinary text declarations to roles, resolve the scale at their actual CSS consumers | Collapse small differences into body/caption/micro/heading roles; preserve specialized symbol/artwork sizes. Neutral typography changes are intentional and need user visual acceptance | Computed role sizes, alternate-theme role overrides, client/Explorer probes |
| Scale preference absent | `client-settings-values.ts` owns range/default, schema owns validity/absence evolution; `ClientApp` applies multiplier at its appearance scope | Use 75–200%, 5% slider steps, neutral 100%; validate finite continuous values within bounds. No per-character setting or document-wide zoom | Schema, section store and persistence tests; live control and startup scope assertions |
| Root-defined role values versus local multiplier | Keep authored role lengths unscaled; multiply absolute role lengths at CSS declarations | Relative `em`/percentage child sizes inherit the already scaled parent and receive no second multiplier; document root font size/`rem` geometry stay unchanged | Nested roots and relative text ratios; separate roots at neutral scale |
| Eight unlayered feature styles | Existing `components` layer | Remove cascade escape; keep component-specific layout local | Existing component/browser suites plus override assertions |
| Shared panel body/label spacing literals repeated | Shared `--ui-body-padding` and `--ui-label-gap` hooks, used by existing shared recipes and settings labels | Two demonstrated shared responsibilities; preserve overlay/menu/list/feature geometry hooks that have distinct consumers | Scoped overrides on shared body/label consumers |
| Hardcoded duplicate black UI shadows | Existing shadow palette in common key hints and character labels | Keep chat alpha-mask black, image contrast/meter semantics, and inspection cantrip rarity palette specialized; replace only actual shared text-shadow/backing recipes | Theme override checks and existing UI probes |
| Dead alternate-action outline defaults | No owner; remove definitions | SVG stroke-width and action filter remain live | Repository reference census |
| Fixed party/character vital rows and window close controls | Feature geometry consumes computed text size where needed; shared window close affordance fits its label | Party and character vital rows grow to fit scaled line height; character component publishes its measured minimum to the frontend viewport owner. Persisted placements remain untouched, names retain existing ellipsis/title behavior | Party metrics and viewport reachability at scale endpoints |

Expected implementation footprint: typography/cascade migration across roughly 30 files, mostly declaration replacements and layer wrappers; about 50–100 production lines added for the preference, shared hooks, and geometry. Tests/probes add behavioral coverage. No new production component or framework is planned. Reassess actual growth after implementation.

### Schema and lifecycle decisions

Use an additive absence default for `ui.textScale` inside the existing version-1 section, matching the current warning-threshold schema evolution. Existing font/threshold values survive; explicitly malformed scale values reject the section through the existing unavailable/error path. Unsupported versions and opaque siblings retain existing store behavior. No whole-document migration or new storage path is needed. Mixed-build writes remain subject to the existing strict section contract; no compatibility aliases are introduced.

A live control edit replaces the validated UI section through `changeUi`; its multiplier changes inherited CSS only. Existing persistence coalesces writes. Startup gets the same value before mounting, character switches do not own the user section, and themes retain authored sizes independently of the multiplier. Returning the slider to 100% changes only text scale. Selected range endpoints are implementation policy to verify, not an assertion that every panel already fits them.

Typography can lead: no palette/control abstraction replacement is warranted by this survey. Cascade layer repair and shared spacing/shadow cleanup remain explicit slices of broader theme unification. No material survey finding has been silently deferred.


### Implementation course corrections

- The first broad HUD run exposed a probe lifetime mistake: Settings is currently in the `activePanel` conditional and remounts on close. Reacquire its DOM after the reopen test. Existing retained windows still inherit appearance through the same scope; this feature does not redesign system-window lifetime.
- The first UI-theme run exposed an inherited probe/contract mismatch: `scripts/ui-theme-probe.mjs` expected `--ui-button-background-color` to paint tabs, but the tab recipe intentionally uses transparent backgrounds and theme selectors. Both relevant rules are identical in HEAD and the initial worktree. Correct the probe to use actual tab CSS selectors and additionally verify the independent transparent default. Do not add a production alias or merge distinct controls just to satisfy the old expectation.
- Character vital quantities needed more than font-size wiring: a fixed 16px focused row could not hold scaled text. The component now owns scaled row geometry and publishes its intrinsic minimum height through `onMinimumHeightChange`; `ClientWorldView` and the showcase apply that minimum through existing placement fitting. A cold ResizeObserver/theme subscription follows CSS changes, without rewriting saved geometry or rebuilding runtime owners. This is justified production growth beyond the initial 50–100-line estimate.
- The focused `--client-text-scaling` harness mode permits inexpensive endpoint/viewport verification without repeatedly executing unrelated inventory/trade interactions. It is diagnostic-only; the full HUD suite also invokes the same probe.


## Verification and handoff (2026-10-22)

Completed evidence:

- `npm run check`: Svelte, browser/Node TypeScript, test types, and Electron types pass with zero Svelte warnings/errors.
- `npm run lint:ts` and `npm run lint:dead`: pass.
- Focused `npm run test:ts -- src/client/client-settings-contract.test.ts electron/client-settings-store.test.ts src/client/client-settings-persistence.test.ts src/client/client-settings-transport.test.ts src/client/client-party-hud.test.ts src/client/client-hud-layout.test.ts`: 79 tests across six files pass. New cases cover additive older-section loading, explicit invalid scales, persistence/reload, unknown siblings, and preservation of other UI choices.
- `npm run harness:browser -- --client-hud --brief`: the full HUD suite passes, including settings, inventory/trade, character sheet, native window interactions, input policy, client theme replacement, startup shell, and the text-scaling probe. Three warnings are deliberate missing-image fixture injections.
- `npm run harness:browser -- --client-text-scaling --brief`: passes at the default viewport; endpoint body sizes resolve to 9.75px, 19.5px, and 26px at 75%, 150%, and 200%. Party name rows resolve to 18px, 22.265625px, and 29.6875px. Nested roots, relative children, top-layer dialogs, scoped theme sizes, excluded text sizes, and viewport identity are asserted.
- Focused text-scaling runs at 400×300 and 320×240 pass. The final 320×240 run additionally checks real Explorer entity-list/composer components remain at neutral scale and consume scoped theme typography, checks horizontal Settings overflow and reset reachability, and checks character vital rows fit and their minimum shrinks after reset.
- `npm run probe:client:settings`: real Electron/preload startup passes using a temporary file seeded with nondefault font choices and 150% text scale. The actual `ClientApp` scope applies restored scaling; existing unsupported sibling reporting still works.
- `npm run build`: succeeds. Vite reports its large-chunk advisory; this change does not alter chunking policy.
- The first whole-app formatting pass found one pre-existing spacing violation in `src/harness/browser/client-precise-jump-probe.ts`, byte-identical to HEAD. Applied its single whitespace-only Prettier correction to complete the required formatting gate. The final `npm run format:check` passes.

Broad theme-suite limitation:

`npm run harness:browser -- --ui-theme --brief` now passes its palette/state/override/backdrop checks, then fails the existing screenshot-based bright-backdrop secondary-text contrast gate: **1.53 < 4.5**. A controlled rerun temporarily substituted the exact HEAD `src/app/ui-base.css`, obtained the identical ratio and sample geometry/colors, and restored the implementation stylesheet in `finally`; byte comparison confirmed restoration. No palette/backing adjustment or contrast-threshold reduction was made. This is an inherited appearance/acceptance issue, not evidence of a text-scale regression. The suite stops there, so its later cases are not claimed as passing. The dedicated scale probe separately verifies alternate-theme composition and actual Explorer consumers. User judgment is needed before expanding into a contrast redesign or accepting the inherited limitation.

Final quality review:

Verdict: implementation is ready for user visual review within the agreed coverage; broad contrast acceptance remains unresolved as documented above.

- Traced UI control → `changeUi` schema validation → user-section publication/coalesced persistence → Electron validation/storage → pre-mount restoration → appearance scope → CSS consumers. Startup/restoration and the section store have runtime evidence; the live real-client settings mutation path was source-reviewed rather than exercised against a game server.
- Reviewed absolute versus relative sizing, nested roots, independent renderer text, CSS layer ownership, and the character/party geometry consumers. No shared Rust or host contract changes are needed. Appearance state stays cold and existing runtime lifetimes are unchanged.
- The sole new production callback carries the character component's measured intrinsic height to its actual frontend layout consumers. It does not duplicate a preference or introduce a framework. Renderer/world text remains independent; no glyph-cache invalidation machinery was added.
- Ignoring indentation-only churn, 31 production files changed by +206/−92 lines (net +114). The increase is principally the usable slider/preference and measured HUD geometry; eight layer wrappers add structural braces rather than new behavior. The dedicated 256-line probe and other verification changes stay under harness/scripts/tests. No new production component was introduced.
- Swept the old `client-font-scope`, disabled text-scaling vocabulary, and unused alternate-outline token definitions. The icon-scaling placeholder remains intentional. Current appearance contracts are documented in `apps/holtburger-3d/README.md`; older plans remain historical notes.
- The pre-existing ACE submodule worktree modification was not touched. No changes were staged or committed.

User acceptance still needed: inspect client Settings → UI at 100%, 150%, and 200%, including character/inspection text, party and character vitals, chat, menus/dialogs, and saved bottom/edge HUD placements. Assess the intentional normalization of formerly different local font sizes and decide how to handle the inherited bright-backdrop contrast issue. No visual acceptance was performed on the user's behalf.


## User-reported save failure (2026-10-22)

The user reports that scaling works visually but `settings:save-user-patch` fails in `assertWritable` with `user.ui has an invalid value`. Their launch uses the default settings path, `/home/me/.config/holtburger-3d-dev/client-settings.json`, rather than the local/new-format filenames used by earlier probes.

Read-only inspection found a version-1 UI entry with the historical `vitalWarningPercent: 20` and font choices, but no independent thresholds. Current strict validation rejects that obsolete key. The rejection is of the existing persisted entry, not the new slider value. No write-guard bypass or runtime schema alias is warranted.

A temporary copy of that exact file reproduced the reported rejection. Converting only its UI value to the current shape (preserving fonts, assigning the old 20% threshold to health/stamina/mana, and neutral text scale) allowed an actual `ClientSettingsStore.saveUserPatch` at 150% and reload. Assertions confirmed all sibling and character sections remained unchanged. Temporary copies were removed.

Automatic approval review initially rejected the profile write because explicit permission to modify the config was absent. The user subsequently approved the repair and explicitly requested no backup. After reconfirming the exact legacy UI shape, converted only that section and verified an actual `ClientSettingsStore.saveUserPatch` against the repaired profile. An exact document comparison confirmed every other section was preserved. No backup was created. The save failure is resolved; the user can retry the slider.


## User-directed simplification (2026-10-22)

The user requested removing combat-indicator appearance controls because the theme variables/module should own those choices, and removing the dedicated text-scaling reset button. Removed the entire combat appearance preference path: editor and probe shell, durable schema/default/section registration, forwarding props/callbacks, override resolution, and obsolete persistence tests. Existing stored sections not owned by this build remain opaque through the collection store's general unknown-section policy; no obsolete preference is loaded or applied and no special compatibility path was added.

Combat appearance now resolves exclusively from theme size/font/color variables, retaining the existing theme/font observer and renderer/module policy. Replaced the old editor-based appearance probe with direct production CSS publication checks. Text scaling now uses its slider for both edits and returning to neutral; the focused browser probe checks slider reachability and restores neutral through that control. Verification for this simplification is complete:

- `npm run check`, `npm run lint:ts`, `npm run lint:dead`, `npm run format:check`, and `npm run build:electron:main` (including Node runtime import verification) pass.
- Five focused settings/store/persistence/transport/combat-system test files pass all 67 tests. The obsolete override-persistence test was deleted with its contract rather than retained as an absence test.
- `npm run harness:browser -- --client-text-scaling --brief --viewport-width 320 --viewport-height 240` passes, including slider reachability, neutral scaling through the slider, theme composition, character/party geometry, and independent Explorer roots.
- `npm run harness:browser -- --fixture combat-effects --brief` passes. The rewritten appearance probe verifies stylesheet publication, all three theme colors, live scoped size/color/font changes, dedicated combat-font precedence, and independence from global UI text scale. The existing GPU/runtime fixture also verifies retained placement, profiles, atlas/resource reuse, and cleanup.
- Source reference and whitespace sweeps are clean. No replacement override abstraction, schema alias, or per-feature reset mechanism was introduced.


## Authorized extension — independent icon scaling and larger neutral typography

The user authorized implementing both scales independently after finding the old text default too
small while the existing icon size was appropriate. This supersedes the original icon-scaling
exclusion. No change to renderer/world marker or combat-text sizing is included.

Survey findings and decisions:

- Shared theme roles own the neutral baseline: body 15px, captions 14px, micro 13px, headings
  22/18/16px. Both user multipliers remain neutral at 100%; artwork dimensions remain unchanged there.
- Add user-scoped `ui.iconScale` (75–200%, 5% steps), additive defaulting for older UI sections, and
  the existing settings-patch path. UI text and icon controls do not share state.
- Raw theme lengths remain unscaled; actual consumers apply the inherited icon multiplier once.
  Inventory cells/strips, equipment, currency, spell/action art, list symbols, icon controls, and HUD
  trays include their hit geometry. Attached counts, equipped marks, shortcut/tab hints, and numeric
  bar menus follow artwork. Inline em symbols continue to follow surrounding text.
- Action/spell bars already measure resolved CSS lengths. Extend action-bar menu measurement;
  measure tray dimensions through CSS and preserve their saved anchors and unscaled preferences.
- Replace the sole count-font shorthand hook with size/family hooks so font sizing composes with
  icon scaling. No compatibility alias or separate badge-size preference.
- Verify old-profile restoration and persistence, separate axes and mixed endpoint cases, scoped
  overrides, real cell art/badge/hit geometry, bar/tray dimensions, and constrained Settings access.
  Final visual acceptance remains with the user.

Implementation is complete. Verification and cleanup:

- [x] Independent saved controls and additive schema/default evolution; no dedicated reset buttons.
- [x] Larger neutral semantic font roles, with the original 100% artwork dimensions retained.
- [x] Scale artwork, cell/hit geometry, attached badges, icon menus, bar measurements, and tray extents.
- [x] Preserve saved tray dimensions/anchors through drag/rotation. Constrained trays scroll at the
  requested size. Only actual geometry constraints enable scrolling; hover artwork must not create
  scrollbars over the rotation control. Resize publication is deferred outside ResizeObserver
  delivery because it changes an observed ancestor; pending callbacks are cancelled on destruction.
- [x] Contract/store evolution, independent bounds, round-trip restoration, and sibling preservation:
  five focused settings/store/persistence/transport/combat-system files pass all 68 tests.
- [x] Real Electron startup restores independent nondefault scales through the preload bridge.
- [x] The focused browser probe passes at requested 320×240: text endpoints and mixed axes; real
  shared cell art/count/equipped/meter geometry; currency art; action/spell cells; shortcut buttons
  and SVG art; scoped icon theme overrides; independent Explorer typography; native dialogs; Settings
  remount retention; and neutral text/icon geometry restoration. No browser errors.
- [x] Chat/keyboard browser suite passes. Increased typography exposed a brittle scrollbar probe's
  fixed click offset; it now targets the thumb from measured viewport/content proportions.
- [x] Complete `--client-hud --brief` suite passes: HUD/layout rotation, inventory/action/loadout/item
  use, targeting, inspection, themes, keyboard/chat, and the integrated scaling probe. Its three
  warnings are the intentional missing-artwork/no-live-connection fixtures; no resize-observer
  delivery errors remain.
- [x] Final `check`, `lint:ts`, `lint:dead`, `format:check`, Electron main/runtime import verification,
  and whitespace/reference sweeps pass. No files were staged or committed; existing ACE changes
  were left untouched.
- [x] User accepted the larger neutral text baseline and enlarged icons.

The icon extension stays in the frontend appearance/settings layer. It adds no Rust/shared-game
contracts, renderer scale, generic zoom mechanism, compatibility alias, or badge-size setting.
The count shorthand hook has one clean size/family replacement, and the obsolete icon placeholder
has been removed. The earlier bright-backdrop contrast finding remains outside this extension.



## Fractional-display tray scrollbar regression

The user reported native scrollbars on both the status tray and game-shortcut dock at 115% icon
scale. Reproduced with 110% display scaling: the natural shortcut tray measured 369.588043 CSS px,
while reassigning that measurement to the panel produced 369.573853 CSS px. The strict geometry
comparison treated the 0.01419 px round-trip loss as genuine constraint and enabled native scrollbars.

The tray owner now rounds its requested panel width/height outward to whole CSS pixels. Authored
artwork/cell sizes remain fractional and unchanged; the containing panel reserves enough space.
This avoids a tolerance branch or suppressing genuine overflow. Existing constrained-tray scrolling
and the deferred/cancelled ResizeObserver lifecycle remain intact.

The browser probe now covers fractional icon scales (105%, 110%, 115%, 135%) in addition to existing
endpoints, verifies fitting trays stay unconstrained, and mounts explicit fitting/constrained tray
fixtures to verify real scrolling is retained. The regression failed before the production fix and
passes afterward at 110% display scaling. Final runs pass at 110% display scaling with requested
320×240 viewport and at 125% display scaling, with no browser errors. Type/Svelte checks, TypeScript
lint, formatting, and whitespace checks pass. Visual confirmation remains with the user.


## Tray layout controls overlay content

The user clarified that unlocking should overlay move/rotate controls, following the other
placeable components. Additional editing space is not desired. Removed the tray's editing-only
52 px long-axis padding and its obsolete modifier class. `ClientHudPanel` continues to overlay
its shared move handle; the tray's rotation button is now a sibling of the scrolling content,
anchored to the outer panel and above its icons. This also keeps rotation reachable when the
natural tray requires scrolling. Locked/unlocked content positions and sizes remain identical.

The focused scaling probe passes lock/unlock button-bound comparisons across all sampled icon
scales, including 115%, at 110% display scaling. The full HUD probe now compares both trays'
button bounds across layout toggles, including a vertically rotated status tray, and retains
native rotation hit-testing. Type/Svelte, TypeScript lint, formatting, and whitespace checks pass.
Complete HUD regression suite passes, including native rotation hit-testing and horizontal/vertical
button-bound comparisons. The constrained 320×240 scaling probe also passes at 110% display scale.
Visual acceptance remains with the user.


## Final code-quality review

Boundary: the complete accumulated H3D feature diff against HEAD, including new harness files,
deleted combat-settings paths, CSS layers and consumers, settings tests, scripts, and README.
The unrelated ACE submodule changes are excluded. No shared Rust/game/protocol changes are included.

Confirmed findings, resolved before commit:

- **P2 — Trade reset hit geometry did not follow artwork.** `ClientTradeWindow.svelte` scaled the
  reset SVG while retaining fixed reset-button and surrounding-control extents. At 200% icons the
  40px artwork exceeded its 32px hit target. Scale the existing reset-size/inset consumers and retain
  the same theme hooks. The real trade browser probe failed before the fix and passes afterward,
  checking endpoint dimensions, artwork containment, theme overrides, and native reset interaction.
- **P2 — Party name-row sizing omitted scaled leader artwork.** `ClientPartyHud.svelte` derived the
  shared row height from text only, allowing its 24px leader icon to exceed the 18px row at 200%
  icons with neutral/smaller text. Include the existing leader-size hook in the row's CSS maximum;
  both the metric node and member rows consume the same derived height. The mixed-scale browser
  probe failed before the fix and passes afterward, without another setting or JS geometry path.

Seam coverage:

- UI controls → `changeUi` validation → existing coalesced user-section persistence → transport
  request/result validation → Electron section read/write guards → startup defaults and appearance
  scope. Inspected older-section defaults, independent scales, save failure reporting, character
  independence, and unknown sibling preservation. No storage guard bypass or legacy field alias.
- Theme roles/layers → client/Explorer DOM consumers, nested roots, native dialog top layer, and
  theme overrides. Raw semantic lengths compose at their consumers; relative typography inherits.
  Ordinary text, icon-bound labels, map/world text, and combat effects keep distinct sizing policies.
- Natural character height → WorldView/showcase minimums, and measured action/spell/tray dimensions
  → HUD fitting/drag/rotation. Saved anchors and preferred dimensions retain their meaning. Tray
  ResizeObserver feedback is deferred and cancelled on teardown; overlay controls reserve no space.
- Theme publication/font completion → combat appearance → retained renderer resources. Removed the
  complete preference override/editor path and its obsolete tests; theme observation owns updates,
  while renderer/session lifetimes remain independent.

Consolidation judgment: keep the explicit CSS consumer calculations. A root-resolved scaled alias
would lose descendant overrides; a generic scaling component or observer framework adds machinery
without a shared responsibility. Independent text/icon ranges express separately adjustable policy.
The new production state is limited to cold measured dimensions with named layout consumers; new
verification-only fixtures and diagnostics remain in harness/scripts/tests. Ignoring indentation-only
churn, the complete production source diff adds 581 and removes 544 lines across 60 files (net +37);
the increase is bounded settings controls and measured layout, offset by the deleted combat editor
and preference path. No new production component or generic framework was introduced. Removed incidental empty
lines left by the combat-settings deletion.

Accepted limits: this is a bounded appearance/layout review, not a renderer/gameplay or general
settings-store audit. The earlier broad bright-backdrop contrast failure was reproduced with HEAD's
stylesheet and remains a separate palette/accessibility issue. The user supplied visual acceptance;
no agent-owned screenshot acceptance is claimed.

Final verdict: ready within the reviewed scope, with no remaining blocking findings. Both new
regression checks failed before their fixes and pass afterward. The final complete HUD suite,
focused trade probe, fractional-display/constrained scaling probe, 68 focused unit tests, Svelte/TS
checks, TypeScript/dead-code lint, formatting, and whitespace checks pass. Electron startup/settings
restoration and combat-appearance runtime verification passed during implementation. The three
full-HUD warnings are its deliberate missing-artwork/no-live-connection fixtures.
