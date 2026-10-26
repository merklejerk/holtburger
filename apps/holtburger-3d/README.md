<img src="../../assets/branding/portal-static.svg" width="96" height="96" alt="Holtburger portal logo" />

# Holtburger 3D

Electron-backed development surface for Holtburger's replacement 3D client. Authoritative app-local
content and simulation behavior runs in the `holtburger-3d-host` Rust sidecar; the renderer reaches
it through the context-isolated Electron preload boundary.

The Explorer runs the shared content, scene, runtime, and WebGL2 rendering architecture against real
client data. Client mode is a separate first-cut composition: `ClientRuntime` owns the network,
world, collision, movement, and camera authorities, while the renderer consumes the focused dynamic
feed and collision-safe third-person camera path. Its UI intentionally remains a small lifecycle and
in-world shell rather than a TUI feature mirror.

Explorer weenie discovery remains app-local: the Rust host lazily indexes the optional offline
catalog and returns bounded ranked identity results to the Entities picker. The browser commits one
exact WCID and the existing numeric spawn path remains the sole mutation contract; neither complete
catalog records nor fuzzy scores cross the adapter.

Outdoor content requests stop at the retail map boundary (landblock coordinates 0–254).
The 3D runtime fills the portion of the current terrain viewing window beyond that boundary with
an ocean backdrop at sea level, using the active region's deep-sea material. All backdrop tiles
share one mesh and resource lease; they have no DAT identities, collision surfaces, map entries,
or ambient spawns. Terrain shading, fog, layer visibility, and outdoor portal masking apply to
the backdrop. Missing content inside the map remains an error. Boundary seam matching and an
infinite ocean horizon are outside this presentation's scope.

## Character creation and selection

Character selection uses the server roster and slot capacity. Selecting a row does not enter the
world. Create opens a staged appearance, Skills & Stats, and review flow; successful server
confirmation selects the new character without entering automatically. The h3d creator always
uses the shared Custom/default build for its heritage. Starter clothing is randomized, with a
Randomize clothes action. Face framing hides headgear only in the preview and retains the same
idle pose; the submitted outfit is unchanged.

`ClientPresentationRoot` starts world presentation during pre-game and retains one canvas,
WebGL2 device/runtime, worker composition and audio context through gameplay. Its pre-game
`ClientPregameScene` uses a fixed DAT staging cell, camera framing from the active page rectangle,
and a local environmental clock. Scene reveal uses
existing static activation readiness; later weather and audio preparation follows normal runtime
policy. Scene-content failures offer retry; failed resource construction or driver retirement
requires restarting presentation rather than reusing uncertain mutable state.

`ClientApp` keeps the dedicated `ClientLoadingPage` visible until the authority supplies a
character roster and the world-scene status is ready. Connection and scene preparation
run concurrently behind this opaque page; the persistent canvas continues loading and drawing.
The app reveals selection and its background together, clears previous readiness before returning
from gameplay, and keeps scene retry and disconnect available while loading. The page only displays
app-owned status/actions. Selected-character previews retain their independent loading and missing
appearance states; there is no additional frame receipt or asset-preload barrier.

`ClientGameplayPresentation` borrows those resources to connect live entities, camera and portal
transitions. Mode handoffs detach authority, invalidate pending work and withdraw old presentation
state before the next controller is admitted. `ClientGameplayView` supplies the HUD and input over
the app-owned canvas; the common interaction boundary includes both for drag/drop hit testing.

`CLIENT_PREGAME_SCENE_TUNING.locations` holds authored pregame compositions. Each app launch picks
one uniformly and retains it across selection/creation pages, renderer retries, and gameplay returns.
Character positions stay in landblock-local AC format; camera poses use canonical scene
coordinates. Characters face the fitted camera position, including off-center UI layouts. Pregame
`initialYawRadians` defaults to zero and user drag rotates from that facing; isolated inspection
retains its own initial-yaw preset. Character and camera have separate authored cell IDs. Framing preserves the selected camera
orientation while translating it for the UI rectangle; a unique containing-cell query updates camera
visibility membership when that movement crosses an interior portal. Authors supply safe locations; no room-clearance
boxes are required. FOV, framing offsets, fill light, and calendar policy are shared across locations.

Selection and creation place the character and held equipment directly in that world scene. They
use ordinary dynamic rendering, scene depth, animation, effects, particles, and spatial membership,
without fabricating host entities. The camera moves to frame the page's reserved rectangle; source
scale stays unchanged. Body framing covers the animated body alone; held equipment can extend outside the framing area. Face framing
uses the heritage-specific focus volume. Both keep their focus on the staging axis and fit a full
turn, so dragging the character does not move the camera. Inspection previews retain their bounds-center
orbit pivot and fit a full orbit at a constant distance. Authored locations are responsible for sufficient space around the character and camera.
Layouts too small for the framing margin show a local limitation and recover when resized; the
environment continues drawing.

`ClientPregameCharacter` owns a transparent interaction surface, layout observation, and drag input.
The root's `ClientPregameCharacterService` retains page intent during construction/retry and revokes
outgoing surfaces before another page can publish. Revocation releases pointer capture and layout
observers. `LocalSceneModelHandle` coalesces source preparation and installs complete linked groups.
Compatible appearance edits preserve scene nodes and playback; failed same-character edits retain
the last complete visual. Switching character identity withdraws the previous subject immediately.
Equipment uses captured holding locations, placement poses, and independent source scales.

Pregame vertical FOV (`fovDegrees`) and independent body/face camera height/distance
preferences are adjustable in `CLIENT_PREGAME_CAMERA_TUNING` in `client-pregame-tuning.ts`. `heightOffsetFraction` shifts the focus by a fraction of the body or face-focus height;
`distanceOffsetFraction` changes the calculated full-turn fit distance: `0.1` retreats another 10%,
while `-0.5` moves 50% closer and can crop the frame. Only a small positive camera distance is enforced
to keep the eye in front of its focus. Authored offsets may move geometry outside the world renderer’s
clipping planes; normal rendering handles that clipping.

Pregame supplies an ordinary point light through the scene driver's scoped light input. It shares
renderer light budgeting and remains independent of the viewer headlamp preference. The local body,
equipment, and part targets suppress authored sound hooks at the behavior/audio seam. All pregame
world audio is silenced by withdrawing the runtime listener. Gameplay restores its own listener on entry. Leaving pregame withdraws local models and lights before gameplay starts,
including when source preparation is still pending.

`HostPresentationAssets` owns shared lazy CPU/content capabilities. World presentation and isolated
inspection borrow them; inspection keeps its separate WebGL context and GPU resources through
`ClientModelPreview` and `StandardClientObjectPreviewService`. Both paths share resolved sequence
traversal and model-fit calculations. A persistent world device preserves renderer infrastructure,
not permanent scene residency; ordinary resource eviction still applies. App shutdown drains both
borrowers before destroying shared assets.

The server roster contains no appearance. During gameplay core publishes a complete
`PlayerVisualCapture` after containment and equipment readiness, retaining it in application
snapshots for event-stream recovery. Saved visuals use default idle, accepted base scale, and
opaque visibility, excluding movement, transient script scale, and portal/invisibility fades.
Incomplete equipment updates retain the last complete capture; normal equipment removal can
replace it with an empty equipment list.

The renderer forwards captures immediately through the narrow visual-cache preload bridge.
Electron main scopes each immutable capture to the launch endpoint and GUID, coalesces disk
writes, and atomically replaces independent version-1 files in `userData/character-visuals`.
Filenames hash the existing canonical endpoint/GUID profile key. This optional cache is separate
from user settings. Missing, corrupt, unsupported, or unavailable previews never prevent entry.
Only the selected roster character is read; cached appearances are labeled "Last observed
appearance." A new character gets a placeholder until first observed during gameplay.

Orderly quit closes cache admission and waits for accepted main-process captures to reach disk,
even if the renderer closes before debounce fires. It cannot guarantee packets still in flight or
captures lost to an unclean process exit. Failed writes report a warning, preserve the previous
successful file, and leave the latest capture pending for retry.

`npm run harness:browser -- --pregame-preview --pregame-location 0 --brief` exercises production content, creator and
picker controls with synthetic server/cache results, mounted scene surfaces, equipment transforms,
replacement races, camera limitations/recovery, reproducible fill-light readbacks, and world/inspection
resource lifetimes. It does not create a real server character. Visual
acceptance remains a user check. Use `--pregame-location 1` to run the second configured scene;
standalone review URLs accept `&pregame-location=1`.

`npm run harness:browser -- --client-presentation --brief` verifies the production app flow.
The browser harness route `?client-presentation=1&contentHost=<local-content-host-url>` mounts the
production `ClientApp` with controlled authority and local settings/cache fixtures. It supports
selection, scene-based creation, a portal reveal and return to selection without a real server.
`__HOLTBURGER_CLIENT_PRESENTATION__` is diagnostic-only: its `read()` reports world canvas/context
requests and portal reveals, and `returnSelection()` supplies the fixture authority edge. The
canonical pre-game suite also exercises two real gameplay-adapter handoffs on one renderer, an
outdoor rainy scene with particles/audio, canceled construction and final GPU retirement.

## Input configuration

`src/lib/input/input-defaults.ts` owns the default character, Explorer fly, client shortcut, and
viewport button maps. Keyboard bindings use browser `key` names (case-insensitive), with optional
modifier constraints. Multiple bindings may activate the same action. Pointer maps use browser
button numbers: primary `0`, middle `1`, secondary `2`.

`APP_INPUT` is the shared configuration entry point for both modes. Its `InputContext` resolves
presses to semantic actions, suppresses repeat, and retains physical-key ownership until release.
Each mounted frontend owns its action context. `provideAppInputPolicy()` provides one keyboard
router and one `ViewportInputGate`; descendants access them with `useAppInputPolicy()`.
`ClientApp` and `ExplorerApp` mount keyboard routing at their app lifetimes. Gameplay action
contexts and viewport gestures are admitted only in their appropriate authority phase; the
pre-game scene accepts character rotation through its foreground surface, without gameplay movement or picking. Pre-game foreground declares native keyboard controls so roster arrows and Tab retain browser behavior.

Keyboard ownership defaults to the game. Ordinary HUD buttons, toggles, inventory controls, and
panel gestures do not acquire it. Text/number editors, editable content, and native selects acquire
it through focus. Tab and Shift+Tab never traverse the interface, including within dialogs;
`tabindex="-1"` still permits intentional programmatic focus. Clicking a `data-game-viewport`
surface or leaving an editor returns keyboard ownership to the game. Mouse gestures remain local.

Components with keyboard behavior declare it with `use:keyboard.scope={{ keydown: handleKeydown }}`.
Registration does not activate a scope. Native editor focus activates editing automatically;
custom surfaces use `keyboard.activate(element)` or declare an `activation` key matcher in the
scope. Chat demonstrates command activation. Custom scopes can also provide `keyup` and `cancel`
when they maintain held actions.
Do not add component-level global keyboard listeners or blanket key propagation suppression.

The pointer-over-text toggle enables mouse selection and native copying in chat history. Clicking
interactive history activates its keyboard scope; Escape returns to the game without disabling the
toggle. New messages preserve the scroll position while interaction is enabled; disabling it resumes
following the newest messages.

Dialogs use `use:keyboard.modal` on a `<dialog tabindex="-1">`. The action owns opening, world-input
blocking, cleanup, and restoration of the previous valid editor or scope. A modal's contents receive
keyboard input without forwarding to scopes outside it. Native dialog cancellation and the
component's confirmation/submission behavior stay local. Escape goes to the active scope first;
outside a modal, an unconsumed Escape returns to the game. The active scope handles keys before
another scope can activate. Activation shortcuts are suppressed while editing or in a modal.
A scope's unhandled keys never fall through to game bindings.

`ViewportInputGate` handles scene/lifecycle availability and world gesture cancellation. Modal and
scene blockers are independent; releasing one cannot release another. Editing suspends game keys
without blocking mouse gestures. Keyboard ownership changes, window blur, visibility loss, and
world blocking cancel held actions without releasing charged jumps. Repeats and releases from a
cancelled press cannot activate the replacement owner. Precise jump remains a client-owned
interaction within the viewport. Host movement contracts do not contain browser bindings.

Settings → Input → Mouse exposes one **Use mouse movement/steering** switch. When enabled,
right-button holds steer the character and adjust camera pitch; middle-button or left-and-right
holds also run forward. Left-button drags orbit the camera independently of that switch. Camera
holds capture the pointer and hide the cursor until release, retaining capture when switching
between steering and orbit. The viewport input owner applies the ordinary click/drag threshold
to captured movement. **Restore default input settings** resets both keyboard bindings and mouse
movement policy.

The asset-free `npm run harness:browser -- --client-hud` suite drives real browser keyboard and
pointer events through the policy, production Explorer controls, chat, and modal integration.

An `AppInput` accepts a complete `InputConfiguration`, allowing future installation settings to
resolve defaults and overrides at startup. Persistence, live rebinding, and a binding editor are
not implemented. Camera rates and sensitivity remain in the existing tuning files. Tests should
use explicit test bindings or derive expectations from defaults, so editing a default does not
require updating tests.

## Client UI defaults

### Appearance and UI scaling

`src/app/ui-base.css` owns shared UI recipes and semantic font lengths (body, caption, micro,
and three heading sizes). Feature styles belong to `@layer components`; themes and user stylesheet
overrides follow them in the `theme` and `overrides` layers. Keep feature layout local and reuse
shared control recipes. Common panel insets and stacked editor-label gaps use `--ui-body-padding`
and `--ui-label-gap`. Different controls retain their own appearance contracts: for example,
`--ui-button-background-color` styles buttons, while a theme can style tabs through `.ui-tab` and
its state selectors.

Client `ui.textScale` is a user-scoped multiplier. Its default and control bounds live in
`client-settings-values.ts`; `client-settings-contract.ts` validates it and supplies a neutral
value for older UI sections without discarding saved fonts or warning thresholds. Client startup
loads settings before mounting. `ClientApp` applies scale and font-family choices at
`client-appearance-scope`, covering startup screens, the world UI, and dialogs. Live scale changes
update CSS through the existing UI-section persistence path; they do not own runtime lifetimes.
Explorer uses the same typography recipes at neutral scale and does not load this preference.

Theme font-size roles are **unscaled absolute CSS lengths**. Their CSS consumers multiply them by
`--ui-text-scale` once, at the element that sets an absolute font size. Nested `ui-theme` roots
resolve the authored body role again rather than multiplying their inherited computed font size.
Relative `em`/percentage text inherits already scaled text and must not multiply the preference
again. The document root font size and geometry expressed in `rem` remain independent of the
preference. Specialized absolute size hooks such as party-name and jump-readout sizes follow the
same rule; relative hooks such as trade status and enchantment subsection headings inherit it.

The neutral theme uses 15px body text with 14px captions and 13px micro text. Panels, dialogs,
tooltips, chat, and ordinary HUD readouts follow text scale. Inline `em` symbols follow that text.

Client `ui.iconScale` independently controls UI artwork. It defaults to 100%, preserving authored
icon sizes, and uses the same settings lifecycle as text scale. Consumers multiply raw icon lengths
by `--ui-icon-scale` exactly once: inventory cells and strips, equipment symbols, spell/action bars,
list and currency artwork, fixed icon controls, and shortcut/status trays grow with their hit targets.
Item counts, equipped marks, shortcut/tab hints, and numeric action-bar menus follow icon scale.
Count typography uses `--ui-item-count-font-size` and `--ui-item-count-font-family`. Map labels/cardinals,
world markers, renderer nameplates, and theme-sized combat text retain their own size policies. Party name
rows and character vital rows grow with their text; the character component publishes its natural
minimum height to the frontend layout owner. Font/theme measurements affect fitted geometry without
overwriting preferred saved placements. Existing name ellipsis and tooltips remain intentional.

Combat indicators have no user-settings overrides. `--ui-combat-text-size`,
`--ui-combat-text-font` (or the body font role), and `--ui-combat-text-damage-color`,
`--ui-combat-text-critical-color`, and `--ui-combat-text-avoidance-color` own their appearance.
The client resolves those CSS values and publishes theme/font changes to the retained renderer;
animation, placement, and budget policy remain in the combat-effects module. Text scaling has a
single slider; returning it to 100% restores neutral scaling.

`npm run harness:browser -- --client-text-scaling --brief` verifies live endpoint sizing, nested
roots, mixed text/icon scales, theme overrides, native dialogs, window reopening, and HUD
measurements. Use `--viewport-width` and `--viewport-height` for constrained layouts. The existing
`npm run probe:client:settings` checks real Electron restoration with an isolated settings file.

### Placement defaults

`src/client/client-ui-defaults.ts` owns the initial in-world HUD arrangement: named anchors,
offsets, preferred sizes, minimum sizes, and panel resizability. Values are CSS pixels. Edge
offsets point inward; offsets on centered axes are signed, positive right/down. The minimap uses
a single diameter to preserve its circular shape.

Sizes are ordinarily numbers. Chat height uses `{ viewportMinus, min, max }` to reserve room above
it, while shortcut width uses `{ perShortcut }` to account for the visible button count. These
are startup preferences, not continuously recomputed constraints. The layout resolver fits panels
to the current viewport without discarding preferred geometry.

`ClientGameplayView.svelte` owns live drag/resize state, component composition, and gameplay-driven
visibility. Diagnostics windows retain their normal border resizing. Internal component styling
and the layout-lock button remain CSS-owned. User HUD sections persist placement edits; viewport
fitting preserves the preferred geometry stored in those sections.
Tests exercise geometry with explicit fixtures rather than pinning the current defaults.

## Salvaging

Use an Ust or choose Salvage on a carried item's selected-entity HUD to open the salvage window.
Drag additional items into the queue; mixed materials have separate estimated output rows.
Drag queued items outside the queue to remove them, or use their remove button. These gestures
edit only the local draft; the physical items stay in inventory.
Items with sufficient source facts preview immediately. Missing details are appraised automatically,
one source at a time, through the session's shared appraisal requests. This does not open or
retarget an inspector. Rejected, incomplete, or transport-failed appraisals keep the item queued
and expose an item-specific explanation with Retry; they do not retry on every display sample.
Removing items, clearing the queue, or closing the window retires only salvage's subscriptions.
The whole batch must have a valid authoritative review before Salvage can be confirmed. Entire
stacks are included, and the server remains authoritative for destruction and output inventory.
The destruction warning appears in the confirmation modal, which offers the same one-hour
suppression control as Give. Suppression is independent for each action, survives window closure
and portal travel, and clears on logout. It skips only the modal; each batch still requires clicking
Salvage and passing the current review checks.

## Object examination

Select an entity and press `E`, use the magnifying-glass button in the selected-entity HUD, or
right-click an entity in the world, an item cell, or an item-backed action cell to select and examine
it. Every entry point captures the target GUID at activation. A later
selection change does not retarget the pending request or an open inspection, and the window does
not open until a successful appraisal response arrives. Starting a request for another target
replaces the previous pending/open inspection; duplicate requests for the same pending target are
suppressed. Rejected, missing, and transport-failed requests remain distinct warning messages.

App-local consumers acquire appraisal data through `session.appraisals.request(guid, receive)`.
The session shares one in-flight request per GUID and gives each consumer a cancellable
subscription. Cancelling an inspector subscription leaves other consumers and the outstanding
wire reply intact. An inspector applies only results delivered through its own subscription;
background results cannot open, retarget, or replace an otherwise idle/ready inspection. When
both consumers are awaiting the same item, they intentionally share its result. Creature-preview
updates are accepted only after an appraisal requested by that inspector. Portal/resync, character
replacement, and teardown retire subscriptions. Raw appraisal events remain available as shared
facts and diagnostics rather than instructions to open UI.

Successful results open one independently draggable and resizable inspection window. Its placement
survives snapshot replacement for the current mounted world view. Closing the window changes only
frontend presentation: it does not change selection or send a close command to the server. Portal,
resynchronization, character replacement, and session teardown close it automatically.

Item inspection uses the shared appraisal snapshot for artwork, descriptions, state, combat facts,
requirements, effects, spell references, and inscriptions. It holds a display lease in the existing
UI icon repository; artwork and spell-definition failures stay visible without hiding the remaining
facts. Creature inspection uses a separate vitals-and-attributes layout rather than forcing creature
data through the item property stream. Appraisal-supplied creature enhancement masks color effective
attributes and vitals without inventing unavailable base values. The current first slice intentionally
does not yet present hook profiles, body-region armor levels, enhanced resistances, or the broader
retail appraisal fields listed in the implementation plan's fast-follow phase.

Equipment values use the appraisal response's per-stat enchantment masks. Effective beneficial and
harmful values are colorized like retail; when the response also exposes an authoritative base
value, the inspector includes it parenthetically. It never reverse-calculates a missing base value.

The asset-free `npm run harness:browser -- --client-hud --brief` suite covers the configured shortcut,
button, viewport/item/action-cell right-click, delayed/latest-target responses, failure and lifecycle
teardown, close/drag/resize, small-viewport fitting, and coexistence with world-container and system
windows.

## Inventory interactions

Drag contents cells onto another cell to merge compatible stacks or insert before
that item when the target cannot accept a merge. Inventory-to-inventory movement
and header appends require Native sorting. Sorted views allow merges and equipping;
unequipping into sorted contents appends to the selected container. Drag onto an
equipment row to equip, or from equipment to a contents cell/header to unequip. Core preflights displaced equipment storage and
sequences the server requests. Failures use existing action feedback.

Select a stack and press Y (configurable under Settings → Input → Split stack),
or use the selected-item Split stack action, to choose an amount with a number
field or slider. The inventory-local dialog opens only after capacity preflight. Splits prefer the
source pack, then main pack and remaining packs in native order; selecting the
whole quantity is a no-op. Ctrl+Shift+I toggles Electron DevTools; game interactions
own right-click globally.

Real pack cells exchange native positions. Main Pack stays first, foci stay last,
and neither is a reorder target. The panel sends semantic intent and renders
accepted host state; it has no operation-progress subscription or optimistic
inventory model. See [inventory ownership and protocol semantics](../../docs/inventory.md).

## Inventory artwork

The recoverable entity-facts stream carries base/overlay/underlay DIDs and effects
from the world's property map, independently of scene residency. The persistent
`ClientInventoryState` owns inventory preferences and references; mounted panels only
sample its view. `UiIconRepository` shares prepared images by complete appearance
and uses the existing lease registry for both persistent owners and temporary DOM uses.

The shared host command `prepare_ui_icons` prepares at most 32 icons per batch in
`spawn_blocking`, with no gameplay actor or renderer dependency. `holtburger-dat`
decodes DID mappers, `holtburger-content` resolves static sources and normalizes pixels,
and the app host owns retail recipe/composition policy. Responses contain native
32×32 PNGs and per-icon diagnostics, with a 256 KiB frame ceiling. Required failures
leave selectable names; missing optional layers retain usable artwork and report why.
See [item UI theme hooks](ITEM_UI_THEMING.md) for cell visuals and selection styling.

`HOLTBURGER_PROBE_MODE=inventory npm run probe:client:ui` uses the existing
live probe credentials to check artwork and close/reopen retention without moving
the character. This is a diagnostic command requiring local game assets. The canonical
`npm run harness:browser -- --client-hud --brief` covers inventory behavior with
synthetic artwork; the scoping worksheet retains the completed burst measurements.

## Spells panel

The Spells system button opens a movable, resizable window listing the character's
known spells alphabetically with retail-composed artwork. Loading and an empty
spellbook are distinct; missing definitions or artwork remain visible as diagnostics.
Click a spell to expand its school, description, authored mana, applicable duration,
range and ordered formula components. One spell expands at a time. Range matches
retail inspection and ACE's ordinary spellbook casting rule (ranks plus initial
skill bonus, capped at 75 metres). Formula selection uses the account-customized
recipe or the school's foci/infused-augmentation recipe. Inventory readiness and
component lookup failures remain explicit. Casting and spell-bar bindings are
separate follow-up features.

Core snapshots and `PlayerSpellsUpdated` supply complete knowledge after the initial
character description. Static `load_spell_references` queries are independent of that
membership: content resolves formula tiers from decoded DAT components, and the app
host selects the complete artwork recipe. Spell icons use the same `prepare_ui_icons`
pipeline as inventory, with their own composition order. `SpellReferences` caches
definitions for the content lifetime. `ClientSpellState` lazily retains requested
known-spell artwork until removal or character/session teardown, so closing and
reopening the panel reuses prepared images. Each panel or future bar also holds
independent display leases until its displayed images are replaced.

The browser HUD harness exercises a large spell list, missing definitions, updates
while closed, and character replacement during a pending static lookup.

## UI themes

Both modes use the complete base appearance in `src/app/ui-base.css`.
Its colors, shared controls, and decoration can evolve together in that stylesheet.
CSS themes can replace variables and styling rules; component CSS owns layout.

Toast entrances use `--ui-toast-pop-animation`, `--ui-toast-pop-duration`,
`--ui-toast-pop-scale` (starting scale), `--ui-toast-pop-peak-scale` (overshoot),
and `--ui-toast-pop-easing`.
`--ui-toast-exit-duration` controls fade-out. Persistent guidance and layout previews do not pop.
Status icons pulse on appearance or a category change using `--ui-hud-pulse-animation`,
`--ui-hud-pulse-duration`, `--ui-hud-pulse-scale` (peak scale), and `--ui-hud-pulse-easing`.
Defaults live in `src/app/ui-base.css`. Animation-name tokens accept a custom global
CSS keyframe name or `none` to disable the effect; set the exit duration to `0s` to
remove the toast fade. Reduced-motion preferences disable both animations and the fade.
Enchantment countdown ticks do not pulse; burden pulses only on severity changes.

The jump HUD uses `--ui-jump-bar-width`, `--ui-jump-readout-font-size`,
`--ui-jump-gap` and `--ui-jump-fill-color` for density
and appearance. The percentage follows the fill edge, with an underline extending left to the bar.
A rotated PRECISE JUMP / MANUAL JUMP label sits closely beside the bar, aligned
to its bottom edge.
Enter precise targeting with its configured shortcut (Shift+J by default),
and return to manual controls with Escape. Arc feedback remains in the viewport. Position and outer
bounds belong to HUD layout editing, including resizing; themes style the contents
within those bounds.

During precise targeting, hold the configured increase/decrease power controls (W/S by
default) to adjust power continuously. These have independent entries under Settings → Input → Movement. Click the bar to set an absolute power,
or use Shift+wheel for steps. Plain wheel zooms the camera. The precise-mode caption shows the configured power keys as shared keycaps on
the line below POWER. Only the bar receives pointer input; other jump HUD content lets
input reach the viewport. Held power input clears on release, focus loss and mode exit. Drag in the viewport
to orbit the camera; a click launches on release. Configured turn controls (A/D by
default) rotate the character in place while precise targeting blocks translation.

Optional theme and override stylesheets use the same loader without recreating
runtime owners. Both inherit unspecified properties from the base appearance;
removing both sheets restores the base without loading another stylesheet.
The client defaults to **Traveler’s Kit**, selectable alongside Base in Settings → UI → Theme.
Existing saved theme choices are preserved. It also supports local theme folders with CSS, images, and fonts. In pregame or
in-game Settings → UI, use **Open themes folder**, add a subfolder containing
`theme.css`, click **Refresh list**, and select it. **Reload theme** refreshes the
bundle while preserving the running client. Selection is saved; a missing theme
falls back visibly to Base while retaining its ID for retry. Explicit font choices
continue to override theme defaults. Explorer retains Base.

See [UI_STYLE_GUIDE.md](UI_STYLE_GUIDE.md#installing-and-using-local-themes) for the
folder contract, supported assets, cascade rules, and recovery. Run
`npm run probe:user-themes` for the focused Electron verification.

For lightweight theme iteration, run `npm run dev:ui` from this directory. It opens
one fixture-backed client stage with the real HUD, minimap, action bars and floating
windows, without a Rust host or game server. The sidebar opens panel specimens in
place and controls backdrops, text/icon scale, layout editing and low-vitals
screen-edge effects. Common controls, dropdowns, dialogs and pregame samples live
in the **Component showcase** window. Hiding that window retains its contents.
Edit the theme CSS and click **Reload theme** to preserve the running client and drafts.
Visual review belongs to the user; browser probes exercise DOM and interactions,
and the showcase probe captures screenshots only when explicitly requested.

See the [UI style guide](UI_STYLE_GUIDE.md) for configuration, recipes, extension
rules, semantic visualization exceptions, accessibility, and browser verification.

### Party HUD dimensions

The party HUD reads `--ui-party-*` properties from the active theme. Defaults live in
`src/app/ui-base.css`; overrides belong in the theme stylesheet. For example:

```css
:root {
	--ui-party-cell-width: 120px;
	--ui-party-name-height: 18px;
	--ui-party-health-height: 24px;
	--ui-party-stamina-height: 6px;
	--ui-party-mana-height: 6px;
	--ui-party-vital-gap: 3px;
	--ui-party-grid-gap: 6px;
	--ui-party-name-font-size: 12px;
	--ui-party-name-gap: 4px;
	--ui-party-leader-icon-size: 12px;
}
```

Cell height is derived from the four row heights plus three vital gaps, so bar and
spacing edits stay consistent. CSS lengths such as `rem` and `calc()` are supported.
Cell dimensions and minimum resize bounds update with the theme; the saved window
position and preferred size remain user layout preferences. The four-column cap is
app behavior. Rows beyond the saved panel height remain visible without scrolling.
Health, stamina, mana, and backing colors use the existing shared theme hooks.

Capture the real component with eight synthetic teammates using
`npm run harness:browser -- --client-party-screenshots /tmp/party-hud --viewport-height 1000`.
The screenshot fixture reads the active theme dimensions too.

## Development

Install Node.js 22.12 or newer, a current stable Rust toolchain, and the frontend dependencies:

```bash
cd apps/holtburger-3d
npm ci
```

Use `npm run dev:explorer` for the Explorer and `npm run dev` or `npm run dev:client` for client mode.
Development startup incrementally builds the Rust sidecar, starts Vite, launches Electron, and stops
Vite after the application exits. Add `:release` to either named route to use an optimized host build.
Pass `--uncapped` to either mode, with a debug or release host, to disable Chromium's foreground
frame-rate limit and GPU vsync:

```bash
npm run dev:client -- --account YOUR_ACCOUNT --uncapped
npm run dev:client:release -- --account YOUR_ACCOUNT --uncapped
npm run dev:explorer:release -- --uncapped
```

Pass `--debug` to enable renderer diagnostics and expose Chrome DevTools on port 9222.
Use `--debug-port <port>` (or `--debug-port=<port>`) to override the port; `0` requests
an assigned port. The port option also works on its own without enabling renderer diagnostics.

```bash
npm run dev:client -- --debug
npm run dev:explorer -- --debug --debug-port 9223
```

Unfocused windows still use the app's 10 FPS background limit. Uncapping can increase CPU/GPU use.

The app launchers choose a free loopback port at random by default. Pin one explicitly with
`--vite-port <port>` when a deterministic URL is useful:

```bash
npm run dev:client -- --vite-port 1432
```

For client mode, `--port` remains the ACE server port; use `--vite-port` for the renderer server.
Client launch options accept long and one-character spellings:

| Long option                | Short option | Value               |
| -------------------------- | ------------ | ------------------- |
| `--server`                 | `-s`         | Host or `host:port` |
| `--host`                   | `-h`         | Host                |
| `--port`                   | `-P`         | ACE server port     |
| `--account`                | `-a`         | Account name        |
| `--password`               | `-p`         | Password            |
| `--ignore-config`          | `-i`         | No value            |
| `--ignore-world-map-cache` |              | No value            |
| `--settings-file`          |              | JSON file path      |

Valued long and short options accept either `--name=value`/`-x=value` or separated values.
Connection credentials stay in Electron main and are never copied into the renderer URL.

The World panel bakes a north-up 2048×2048 terrain image in the Rust host, with mean diffuse
colors and fixed hillshading. All present landblocks contribute terrain, including dungeon-only
owners. Up to four bake workers process bounded batches after the first tile. Its 128×128 tiles appear as they finish; the progress footer leaves
pan, zoom, and the bottom-right Reset view icon usable during generation. Reset view recenters
and fits the whole world without added padding; the HUD-styled button appears only when the view differs from that reset.
Hovering terrain shows outdoor coordinates in a floating tooltip. Panning keeps the viewport inside the map; axes larger than the map stay
centered. The World and Housing tabs retain the same map and view; Housing is a placeholder. Canvas2D scales a retained image, drawing only
on arrival, interaction, resize, or reopening. The player marker reprojects in each image draw, with a 30 Hz movement timer between draws.

Characters with ACE's `IsAdmin`, `IsArch`, or `IsPsr` permission can click a terrain point to request
a map teleport. Dragging beyond the map's pointer threshold pans instead; canceled gestures never
teleport. The clicked horizontal coordinates are preserved, and ACE resolves terrain height and
building placement and rejects entirely-water landblocks. Permission and in-world admission are
rechecked in core. The image may still be streaming when a location is clicked.

The map overlays 52 default-world settlements using verified ACE portal arrivals and an outdoor
vendor placement as approximate anchors. Labels default to hidden: hovering a dot shows its name and anchor coordinates only in the
tooltip. The bottom-left eye icon toggle shows all in-view names; its state is retained while the panel stays
mounted and resets to off on a new panel lifetime. Labels can overlap and the map surface clips
them at its edges. Annotations appear during terrain streaming and reproject in the terrain draw callback. The retained
[SQL and conversion recipe](../holtburger-tools/sql/README.md) reproduces the bundled data without
runtime database access. Crater Lake Village uses Silencia’s placement, confirmed by four vendors
with ACE’s `TownName = CraterLake` tag. Island/geographic labels are outside this settlement list. Custom-server town locations can differ.

Settlement labels use `.ui-world-map-label` and dots use `.ui-world-map-settlement-dot` in the
shared theme layer. Label properties are `--ui-world-map-label-font` (a CSS font shorthand),
`--ui-world-map-label-color`, `--ui-world-map-label-outline-color`,
`--ui-world-map-label-outline-width`, and `--ui-world-map-label-offset`. Dots expose
`--ui-world-map-settlement-dot-radius`, `--ui-world-map-settlement-dot-color`,
`--ui-world-map-settlement-dot-outline-color`, and `--ui-world-map-settlement-dot-outline-width`.
Themes can also style those classes directly, including letter spacing and text decoration.
The default label font uses `--ui-font-body` and its color uses `--ui-color-text`.
Theme changes apply to retained SVG nodes without text measurement or image regeneration.

Only successful completion publishes the raw RGBA8 cache under `<userData>/cache/world-map`.
Pixels occupy 16 MiB plus a small header. Source archive revisions and bake settings invalidate
stale caches; incomplete output is discarded. First activation starts generation; login does not.

Pass `--ignore-world-map-cache` to regenerate the world map on its first request, even if a valid
cache exists. Concurrent requests and panel reopenings still reuse the prepared image for that
host lifetime. Successful generation atomically replaces the disk cache; the flag does not delete
it at launch or change when map loading begins.

```sh
npm run dev:client -- --account YOUR_ACCOUNT --ignore-world-map-cache
```

Pass `--ignore-config` or `-i` to treat persisted user and character settings as absent for that
run. Native window placement still restores normally. Persistence remains enabled, so the newly
defaulted supported user settings and any character settings edited during the session overwrite
their corresponding saved values. Sections from a newer client remain untouched and are reported
as unavailable.

Development builds use `client-settings.json` in their shared development user-data directory by
default. The packaged app uses the same filename in its separate user-data directory. The app
does not convert a legacy file during startup; it rejects that file without changing it. Use
`--settings-file` to select a worktree-local collection while the shared file is still legacy. A
missing collection starts with defaults. To launch with a converted local collection:

```bash
npm run dev:client -- --settings-file=../../.holtburger-local/client-settings-sections.json --account YOUR_ACCOUNT
```

The example assumes you invoke npm from this app directory. Relative `--settings-file` paths
resolve from the directory where you invoked `npm run dev:client`; absolute paths also work.

This worktree's local collection was created by a one-time conversion; no migration command ships
with the app. Its neighboring `.legacy-source.sha256` file records the source hash. Compare that
hash with the legacy source before replacing the global file, since another worktree may have
changed the source since conversion. Replacing that shared file with the collection format means
older worktrees can no longer load it; continue using the override until those worktrees are done.

The sidecar has one explicit composition root and mode-owned capabilities. Shared content lives in
`host/src/shared_host_content.rs`; Explorer authority and client authority live in
`host/src/explorer_host.rs` and `host/src/client_runtime.rs`; client wire projection lives in
`host/src/client_projection.rs`. The protocol decodes into shared, Explorer, or client command
inventories and dispatches only the selected authority. Event publication uses separate client and
Explorer sink traits; the stdio writer is the only adapter that implements both.

### Client assets and startup

Both desktop modes accept `--content <path>` (or `--content=<path>`) to select an exact archive or
asset directory for that launch:

```bash
npm run dev:explorer -- --content "/path/to/Asherons Call"
npm run dev:client -- --account example --content "/path/to/Asherons Call"
```

Directories prefer HBA archives. If no HBA exists, the host opens retail DATs and identifies their
roles from their headers. The standard base portal/highres pair is supported: highres resources
take precedence by membership, with base portal supplying other portal resources. Cell and
language archives retain their own namespaces. Duplicate archives of the same retail role are an
error. Invalid HBA content is reported rather than silently repaired with DAT resources.

Two independent desktop flags control asset setup:

- `--no-content-search` disables default automatic discovery for this launch, including retries.
  A saved location and explicit `--content` remain usable; choosing a folder is still available.
- `--clear-content` clears the saved location and its attention marker before startup, then follows
  normal selection policy. Default discovery can find and save another location.
- Use both to open Provide assets directly:
  `npm run dev:explorer -- --no-content-search --clear-content`.

Client accepts the same flags alongside its usual launch arguments. With `--clear-content` and
`--content` together, the requested clear is persisted, then the explicit selection stays temporary.
These flags do not delete archives or clear other settings. The disabled-search policy is not saved.
Standalone browser/live diagnostics do not own desktop preferences and reject these desktop flags.

Without an override, startup tries the last successful location, then `dats` beside the packaged
executable (the repository `dats` directory in development), then the platform Holtburger data
directory. Absent candidates are skipped. An existing installation that cannot initialize is
reported. Paths supplied through npm are resolved from the invocation directory; packaged default
discovery does not depend on process working directory.

The app shows the existing pregame loading page before constructing Client or Explorer. Its bundled
portal animation and theme need no game assets. The startup shell feeds native asset-initialization
status into that page; missing, failed, or flagged content opens a dedicated asset setup component
inside the same pregame shell. Its form layout and styles are independent of the loading component. Choose a folder or retry the previous location. After content admission, Client uses
the same loading component for connection and scene progress. Native asset recovery and the Client
session lifecycle keep separate ownership. Loading pages keep the asset location in the pregame footer when known;
`/assets` (also `@assets`) prints the active launch location to the in-game chat console.
`/help assets` describes the command. The active location includes temporary CLI selections,
independently of the saved preference. The native folder browser is the only OS-styled part
of this flow. The asset form requests all end-of-retail DAT files or a full-profile HBA, uses
consistent left alignment, and shows failure causes inline. It remains visible while the folder
browser is open, with duplicate actions disabled; loading begins only after a folder is selected.
Canceling the browser leaves setup open; Quit
works before a game host or renderer exists.

The canonical successful location is saved in `content-selection.json` under Electron's user-data
profile, shared by both modes and separate from character/server settings. Development uses a
separate profile. A required resource read/decode failure marks that saved installation as needing
attention, causing the next launch to open setup with the prior diagnostic. Optional content
failures do not mark the installation. `--content` and any replacement chosen during an override
launch are temporary and never rewrite the saved preference. `--ignore-config` does not bypass
asset recovery.

Startup checks are shallow, so an installation can fail when a necessary resource is first used.
Such failures remain visible; restart to choose another installation. Content is not replaced
inside a running game. A failed preference write offers Retry saving and does not pretend that
the selection or recovery marker reached disk.

The launcher and host recognize these other environment variables:

- `HOLTBURGER_VITE_PORT` pins the renderer server port when a shell-level override is preferable to
  the `--vite-port` argument. Omit it to use a random free port.
- `HOLTBURGER_ELECTRON_OZONE_PLATFORM` accepts `auto`, `wayland`, or `x11` for Linux display-backend
  diagnosis. It is not a product default.
- `HOLTBURGER_ELECTRON_DISABLE_GPU=1` disables GPU acceleration for diagnosis. It is not a supported
  rendering mode.
- `HOLTBURGER_HOST_BIN` overrides the development sidecar executable for launcher and CI
  diagnostics. Packaged applications always use their bundled host. Normal development should let
  the launcher select the freshly built binary.

Electron owns one product window and at most one content-host attempt. Recoverable content setup
reaps a failed attempt before starting another. Normal application exit requests orderly host
shutdown and waits for process completion; acknowledgement alone is not completion. Executable,
protocol, and unexpected host failures remain application errors. Renderer reload is unsupported
because it would retain host-owned sessions while replacing their renderer owner; restart the
whole application after renderer or WebGL context failure.

`npm run probe:content` verifies native startup/recovery in an isolated temporary profile without
screenshots. The synthetic archive intentionally lacks necessary scene/bootstrap assets: the
probe verifies their failure marker, next-launch setup, override isolation, and bounded shutdown in
both modes. Client retirement preserves the failed-construction outcome as a nonzero exit; a
setup-only close must exit successfully.

## Verification and diagnostics

Use these checks from `apps/holtburger-3d`:

```bash
npm run check
npm run lint
npm run test:ts
npm run check:rust
```

`npm run smoke:sidecar` exercises the compiled release host with an empty content repository and
verifies handshake, status, orderly shutdown, and process exit. Rust diagnostics are written to
stderr and appear with a `[holtburger-host]` prefix under Electron; stdout is reserved for the
bounded MessagePack protocol.

Use `npm run harness:browser -- ...` for non-interactive browser, runtime, renderer,
content-lifecycle, and WebGL verification. The harness is an agent-operated diagnostic playground
and is not limited to terrain scenarios. Pass `--vite-port 1432` (or another isolated port) when
running it alongside another worktree.

The `--client-hud` suite prints a compact summary after its assertions pass. Use
`--full-report` when investigating the complete snapshot evidence. Screenshots are captured
only when requested with `--screenshot`; ordinary behavior checks do not need image output.

The non-interactive live client probe is kept separate from the interactive app and TUI. It accepts
credentials from the environment, drives the private sidecar protocol, and reports lifecycle,
entity, camera, movement, and encoded-frame measurements without putting secrets in process
arguments or URLs.

With a live ACE endpoint available, run it without putting credentials in shell history or process
arguments:

```bash
HOLTBURGER_PROBE_ACCOUNT=test \
HOLTBURGER_PROBE_PASSWORD='your-password' \
npm run probe:client
```

Override `HOLTBURGER_PROBE_HOST`, `HOLTBURGER_PROBE_PORT`, `HOLTBURGER_PROBE_DURATION_MS`, or
`HOLTBURGER_PROBE_CHARACTER_GUID` through the environment. The probe emits one JSON result and
never starts Electron, Vite, or the TUI.

Set `HOLTBURGER_PROBE_MODE=passive` to observe the current character without sending teleport,
chat, or drive commands. Passive mode rejects teleport options instead of silently becoming an
active probe. The default `drive` mode retains the movement phases used by the ordinary motion
probe.

Set `HOLTBURGER_PROBE_MAP_POINT` to canonical `x,z` coordinates to exercise the typed map action
instead of chat teleport or ordinary drive phases. The live probe verifies destination coordinates
and activation/reveal, then requests a map teleport back to the source horizontal position.
`HOLTBURGER_PROBE_MAP_WATER=x,z` additionally checks ACE's entirely-water diagnostic and absence
of a portal-space transition. These options require an eligible character and are rejected in
passive mode; choose a verified entirely-water location for the water check.

## Packaging and platform status

The app uses the repository's portal logo for browser tabs, native windows, and packaged
Windows/macOS application icons. `assets/branding/portal.svg` at the repository root owns the
animated artwork; `npm run generate:branding` exports the static SVG, PNG, ICO, and ICNS plus
the browser and Flatpak copies. Commit these exports after artwork changes and run
`npm run check:branding` to detect drift. Regular builds consume the checked-in icons.

`npm run package` builds an unpacked application and `npm run make` creates the configured ZIP.
Both commands build the frontend, Electron main/preload code, and release Rust sidecar first.
`npm run check:package` verifies the native host, compiled entries, branding assets, bundled fonts
and their licenses, application license, and Electron/Chromium notices in the unpacked package.
Required ASAR files must be nonempty. After `npm run make`, `npm run check:archive`
extracts the ZIP and applies the same inspection to the downloadable shape.
Font packaging checks compare every file under `public/fonts/` with its packaged bytes,
so adding or replacing fonts and notices does not require updating a verification inventory.

The portability workflow also runs `npm run probe:user-themes:built` after building, reusing the
compiled frontend and Electron output. It checks native theme loading and bundled font decoding
in development HTTP and built-file modes, discovering registered faces from the Base font roles
rather than assuming particular families or a fixed face count. Linux CI runs it under Xvfb. Use
`npm run probe:user-themes` locally when those outputs need rebuilding first.

The packages are unsigned experimental artifacts. Hosted CI has built and structurally inspected
Linux x86-64, Windows x86-64, and macOS arm64 packages, but that does not certify GPU, input, audio,
display scaling, Gatekeeper, or SmartScreen behavior. Only the available Linux desktop has received
interactive Explorer verification. Do not advertise another platform as supported until its
packaged application has been exercised on that operating system.

The branch-scoped `holtburger-3d-portability.yml` workflow is diagnostic only: it has read-only
permissions, retains artifacts briefly, and cannot publish a GitHub release. The repository's
canonical release workflow remains CLI-only until the 3D product is ready for an explicit publishing
decision.

## Security and dependency maintenance

The renderer has no Node integration. Electron enables context isolation and sandboxing, exposes
only the typed host bridge from preload, accepts IPC only from the product window's main frame,
restricts navigation to the development origin or packaged `dist` tree, denies new windows, and
applies a Content Security Policy. Rust validates the closed command protocol independently.

Review Electron and Electron Forge updates at least monthly and before sharing a build. Apply normal
compatible updates through npm, inspect `npm audit` rather than using a forced downgrade or override,
then run the full checks and package inspection above. Electron upgrades additionally require the
branch portability probe and a fresh manual smoke check on available hardware. There is no automatic
updater because there is no 3D release channel yet.

The packaged resources contain Holtburger's AGPLv3 license alongside the Electron and Chromium
notices supplied by Electron. Public distribution guidance, checksums, and reproducible build
instructions remain part of the later 3D release roadmap.

The WebGL2 backend has one flat-frame schedule: opaque scene color and depth are
rendered into a renderer-owned target, optionally receive near-field ambient
occlusion, and are presented with depth intact before transparent objects and
particles. Portal frames retain their packed-atlas compositor; optional ambient
occlusion consumes its planner-owned tiles after opaque submission without
introducing an alternate portal execution path. Sky, weather, transparent
objects, and particles remain outside ambient occlusion.
Particle owners still pass CPU scope admission, while admitted particles use one
program with ordinary depth testing and blending. They omit per-fragment portal
clipping as an accepted visual/performance trade-off; other geometry retains it.
The Explorer's Render quality panel adjusts AO strength, radius, bias, edge
threshold, and distance fade live without reallocating its scratch targets.

Dynamic entity meshes use one ordinary indexed-draw representation. Effective part geometry
defines a reusable source-local merged layout; replaceable appearances own material tables and
index batches. Per-part pose/color records retain landblock-relative transforms. The renderer
prepares all camera, selection, and shadow consumers, uploads their union of required poses, then
executes the prepared draws. Portal domains, texture bindings, render state, and transparent order
still impose draw boundaries. Neither multi-draw nor dynamic mesh instancing is a fallback.

The runtime stages same-generation appearance replacements and checks the current request and
residency before committing. Animation, held-entity ancestry, particle frame targets, and CPU
picking retain part identity. Visual-root and part transforms publish together before spatial
descendants synchronize. Shared geometry leases remain independent of appearance and landblock
ownership; pose data is rebased for each camera at submission, not rebuilt when the anchor changes.
Static/particle instancing remains separate. The authored portal-transition tunnel still draws
ordinary per-part geometry under its own explicit resource lease.

The previous implementation is retained in `../holtburger-3d-legacy` as a runnable reference. Do not import TypeScript from the legacy app into this source tree.

## Item UI styling

See [Item UI theme hooks](ITEM_UI_THEMING.md) for cell, selection, empty-slot, strip-arrow, and inventory layout properties.

Spell inspection separates immutable `load_spell_references` / `load_spell_components`
content from character-bound `query_client_spell_inspection` results. Core emits a
context revision when relevant skill, account or foci inputs change; independent
inspectors discard older correlated replies. Requested component artwork survives
collapse, with character-model leases retired on context changes and display leases
protecting images until their DOM is replaced. Component icons use retail's exact
opaque-white to opaque-black transform. Inventory availability shading is not included.

## Contracts journal

The Journal dock shortcut opens a retained, searchable contracts list with status
icons and expandable authored details. Definitions arrive through shared content;
server trackers own membership and progress. The session owner retains controls
and timer receipt anchors while hidden, and character changes clear local row
state. The panel polls display facts only while visible. Removal uses the existing
confirmation owner and keeps the row until the server deletes it; quest progress
is retained. This is the contracts log, without the retail personal notebook.

Status icon pills use the shared spellbook/enchantments styling. Selected statuses
form a union, search narrows that union, and no selected statuses shows all contracts.

In progress uses a circled-arrow status icon; the quill identifies the Journal.
Accepted incremental additions/removals during active play produce journal
toasts even while the panel is closed. World classifies membership transitions,
core suppresses login activity, and h3d owns wording and short burst summaries.
Full tables, recovery, duplicate updates, progress changes, and retirement do
not announce membership changes. Removal dispatch alone never announces success.
Activity is ephemeral and is not replayed after missed events or reconnection.

The World map has a default-on Contracts icon toggle. It shows the selected
outdoor contact and, while In progress, an outdoor quest-area point. Contacts use
person icons; areas and exactly coincident groups use diamond-and-dot markers.
The Journal shortcut and Contracts toggle use a quill icon, matching ACE's
contract-acceptance message. Hover reveals
name, status, role/NPC, and map coordinates; crowded lists scroll within the map.
There are no persistent contract labels or area radii. Positions use the original
authored offsets; Journal search/filter controls never affect map membership.
The toggle survives panel/tab closure and resets to on for a new character. Hidden or
disabled layers stop display sampling; expiry refreshes tooltip status without
rebuilding marker geometry.

Run `npm run harness:browser -- --client-contracts --brief` for nonvisual checks
of the production Journal/World windows, dialogs, filters, timers, contract
marker projection/grouping/tooltips, hidden cadence, and authoritative deletion.
The shared synthetic payload fixture is also verified against Rust sidecar
serialization and the TypeScript schema. Live acquisition/relogin verification
requires credentials for the existing noninteractive client probe.
