# H3D shortcut presentation

Status: implementation verified; user visual and interactive acceptance received; code quality review complete.

## Goal and boundaries

Make HUD shortcut hints, tooltips, and input settings reflect the accepted user bindings using consistent platform-specific labels, without expanding the HUD footprint.

This is app-local presentation work in `apps/holtburger-3d`. Include action bars, spell bars, combat controls, the combat stance launcher, and settings binding labels. Keep persisted modifier names (`ctrl`, `alt`, `meta`, `shift`), input matching, user-scoped persistence, and defaults unchanged. Language translation, automatic Control-to-Command substitution, Mac-specific defaults, keyboard-layout discovery, and new bindings are outside this change.

## Ground truth

Paths below are relative to `apps/holtburger-3d/src`:

- `lib/input/input-contract.ts`: key versus physical-code selectors; omitted modifier constraints accept either modifier state.
- `lib/input/input-context.ts`: exact matching rules; Control and Meta remain independent.
- `lib/input/input-defaults.ts`: action-cell shortcuts allow modifiers; bar-focus chords and alternate-action modifiers have separate meanings.
- `client/client-binding-catalog.ts`: existing formatters and settings action catalog. Extract formatting; retain catalog and conflict policy here.
- `client/ClientWorldView.svelte`: already receives accepted `ClientKeyboardConfiguration`; supplies HUD children.
- `client/ClientActionBar.svelte`, `ActionCell.svelte`: configured tooltip text exists, but visible digits also serve navigation, drag, and anchor identities.
- `client/ClientSpellBar.svelte`, `SpellCell.svelte`: slot-derived digits; the caster cell is unnumbered and must not acquire an invented shortcut.
- `client/ClientCombatBar.svelte`: hardcoded height hints and preset markers; preset markers currently ignore pointer events and move outward on hover.
- `client/ClientShortcutDock.svelte`: combat stance tooltip hardcodes `~`.
- `client/ClientSettingsPanel.svelte`: binding pills, conflict descriptions, removal accessibility labels, and alternate-modifier options need the same platform vocabulary.
- `app/UiIcon.svelte`: degraded/failed artwork overrides the parent title with a diagnostic title built from `tooltipLabel`.

## Presentation contract and decisions

Use one pure formatting module in the app's input layer, provisionally `lib/input/input-presentation.ts`. Accept platform explicitly in pure functions. Resolve the runtime platform once at the frontend composition boundary and share that value with settings and HUD consumers. Inspect existing browser/Electron bootstrap contracts before selecting the smallest platform adapter; avoid adding host IPC solely for labels when browser platform information suffices. Unknown platforms use explicit generic `Meta` terminology, not an assumed OS.

The module owns modifier naming, key naming, compact chord formatting, and full chord formatting. Consumers own action names and contextual prose. Do not add another binding registry or persist derived labels.

| Binding             | Windows/Linux HUD | Mac HUD | Mac full text       |
| ------------------- | ----------------- | ------- | ------------------- |
| Shift + 1           | S1                | ⇧1      | Shift + 1           |
| Control + 1         | C1                | ⌃1      | Control + 1         |
| Alt + Q             | AQ                | ⌥Q      | Option + Q          |
| Meta + 1            | W1 / M1           | ⌘1      | Command + 1         |
| Control + Shift + 1 | CS1               | ⌃⇧1     | Control + Shift + 1 |

- Use a fixed modifier order: Control, Alt/Option, Shift, Meta. Render a modifier-only key once, not both as prefix and base key.
- Windows full text calls Meta “Windows”; Linux calls it “Super”; Mac calls it “Command”. Control remains Control on every platform.
- First configured binding supplies the HUD hint. Full tooltips list all alternatives in their configured order. No primary-binding preference or reordering UI is needed.
- Empty binding lists produce no icon overlay, an em dash on tab/menu controls, and an “Unbound” tooltip description. A control with no associated binding concept, such as the caster cell, does not acquire an “Unbound” label.
- Settings pills retain complete chords, with platform symbols/names, rather than HUD abbreviations. Full readable text remains available in titles and accessibility labels.
- Use familiar base-key abbreviations and arrow glyphs. Preserve distinctions such as numpad versus main keyboard keys. `Digit1` and `KeyQ` retain the existing 1/Q key-position shorthand; the formatter does not resolve keyboard layouts.
- Bound the hint with CSS and ellipsize overflow without enlarging cells. Keep modifier prefixes visually distinguishable where practical. Do not silently drop modifiers or guess a shorter alternative binding.
- Stable bar/tab/slot numbers remain identity, independent of shortcut text. Spell tabs and action-bar menus show their configured compact chords; accessible names and tooltips keep numbered identities and full chords. Icon overlays represent shortcuts.
- Update on accepted settings changes through ordinary cold Svelte reactivity; no polling, subscriptions to frame state, or refresh callbacks.

Flow:

```text
accepted input settings + resolved display platform
    -> shared pure binding formatter
    -> compact hint / full binding description
    -> HUD labels, settings pills, tooltips, accessible names
```

## Phase 1: Shared formatting and settings

- [x] Introduce the pure formatting module and a minimal platform resolver at the frontend boundary.
- [x] Move existing formatting consumers off `client-binding-catalog.ts`; remove superseded exports rather than retain wrappers.
- [x] Apply platform terminology to settings pills, conflict text, removal labels, and alternate-modifier options.
- [x] Give pills full readable shortcut tooltips while preserving the “Remove binding” instruction.
- [x] Add focused unit tests for all platforms, unknown platform, modifier-only keys, combined modifiers, key/code selectors, long key names, alternatives, and unbound lists.

Acceptance: the same stored binding has platform-appropriate display text without changing its serialized value or matching semantics. Existing conflict/capture behavior remains intact.

## Phase 2: HUD integration

- [x] Pass accepted input settings and shared platform presentation into spell, combat, and dock consumers, following the existing action-bar path. Pass only the configuration sections each child needs where practical.
- [x] Separate action-cell address props from shortcut presentation. Preserve `data-action-cell`, navigation selectors, drag addresses, and anchor uniqueness.
- [x] Render configured action-cell hints; include full chords, focused-bar context, and the configured alternate-action modifier in tooltip prose.
- [x] Do not synthesize an alternate chord by blindly prepending a modifier: explicit constraints may reject that chord. Describe alternate behavior conditionally and retain actual dispatch semantics.
- [x] Render configured spell-cell hints and full tooltips; show compact bindings on spell tabs and full shortcuts in their tooltips while preserving tab identity.
- [x] Replace combat-height and preset hint constants with configured bindings and full descriptive tooltips. Describe the five preset values as 0%, 25%, 50%, 75%, and 100% melee power or missile accuracy.
- [x] Make preset labels hoverable without adding click behavior or blocking the power gauge's drag surface. Check their outward hover movement for tooltip stability. Expose equivalent readable information accessibly.
- [x] Replace the combat dock's hardcoded shortcut with its configured toggle-combat binding.
- [x] Pass the complete cell tooltip label into `UiIcon`, so diagnostic tooltips retain shortcuts and artwork error details.

Acceptance: rebinding, adding alternatives, removing all bindings, and restoring defaults immediately update every relevant surface. Tooltips describe the actual activation context. Cell identity and pointer interactions remain stable.

## Phase 3: Verification and cleanup

- [x] Extend the existing client HUD browser fixture/harness narrowly to exercise a remapped action cell, spell cell, combat control, and settings labels; reuse existing setup rather than build a new harness.
- [x] Verify visible first-binding selection, all alternatives in full labels, unbound behavior, and restoration of defaults.
- [x] Verify action-bar focus/navigation and drag addressing still use stable slot identity after rebinding.
- [x] Verify combat preset hover and power dragging coexist; verify diagnostic artwork titles retain full shortcut text.
- [x] Test platform formatting through explicit platform inputs. Native Mac event delivery remains unverified.
- [x] Run focused `npm run test:ts -- ...`, `npm run check`, `npm run lint:ts`, formatting checks for touched files, and `npm run harness:browser -- --client-hud --brief` from the app directory.
- [x] Sweep touched shortcut display code for hardcoded chords, obsolete formatter exports, and presentation-only `digit` vocabulary. Retain genuine address/index terminology.
- [x] User accepted presentation and interaction. Native Mac validation remains outside the completed Linux browser checks.

## Risks and concessions

- Compact labels trade detail for space. Full tooltips and accessible descriptions are authoritative; long hints may be clipped with an ellipsis.
- Platform names normalize presentation only. OS-reserved chords and native Mac event behavior require validation on that platform and are not solved by formatting.
- Omitted modifiers are wildcards in the current binding contract. Render required modifiers, not invented restrictions. Context prose must not promise that a chord bypasses higher-priority focus commands.
- Existing exact key capture and physical-code defaults differ. This change must not alter their semantics while improving labels.
- Native title tooltips need real hover targets. Combat marker positioning and diagnostic child titles are concrete integration checks, not reasons to introduce a global tooltip system.

## Definition of done

- [x] All scoped shortcut displays derive from accepted bindings.
- [x] HUD, tooltips, accessibility labels, and settings share platform naming.
- [x] No settings schema, persistence, matching, or default-binding change.
- [x] Stable HUD identities remain independent of shortcut labels.
- [x] Required checks pass and the user accepts presentation and interaction.

No blocking product questions remain. Exact prefix typography and clipping width are implementation choices subject to visual acceptance.

User acceptance feedback: combat preset labels now state the power or accuracy percentage; spell tabs show `S1` style hints; action-bar menus show `C1` style hints; action-cell native tooltips use short, separate lines for the item, focused-bar key, and available alternate click. The browser harness verifies the compact labels and their live rebinding, mode-specific combat percentages, and multiline action-cell titles.

Verification: focused formatter and binding-catalog tests passed (9 tests); `npm run check` and `npm run lint:ts` passed; the client HUD browser harness passed after exercising live action, spell, and combat rebindings, unbound and multiple alternatives, preset hover, and gauge dragging. The browser run used a Linux Chromium environment. The user accepted presentation and interaction.

## Code quality review

No blocking code findings. Corrected the Linux compact Meta example to match `M1`; full text remains `Super + 1`.

Reviewed seams: accepted settings through `ClientWorldView` into action, spell, combat, dock, and settings consumers; formatter inputs against the key/code and modifier contract; stable cell addresses through presentation and pointer selectors; full tooltip text through `ItemCellVisual` and `UiIcon`; combat marker hover against the gauge drag surface; and browser probes for rebinding, alternatives, unbound state, and reset. The old catalog formatter has no surviving callers.

Presentation remains app-local and derived from accepted settings, with no new persisted state or refresh lifecycle. Compact physical-key shorthand and ellipsis are accepted space tradeoffs. This review does not validate native Mac event delivery, OS-reserved shortcuts, or unrelated host/persistence internals.
