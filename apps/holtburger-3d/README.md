<img src="../../assets/branding/portal-docs.png" width="96" height="96" alt="Holtburger portal logo" />

# Holtburger 3D development

Player guides: [3D client tour](https://merklejerk.github.io/holtburger/3d/),
[installation](https://merklejerk.github.io/holtburger/start/), and
[controls/reference](https://merklejerk.github.io/holtburger/reference/3d-controls/).

The sections below cover development, implementation details, and diagnostics.

Electron application for Holtburger's 3D client and offline Explorer. Authoritative app-local
content and simulation behavior runs in the `holtburger-3d-host` Rust sidecar; the renderer reaches
it through the context-isolated Electron preload boundary.

The launcher's gear button opens **App settings** for process-wide graphics preferences.
Windows defaults to Direct3D 11 with display synchronization off. GPU compositing is enabled by default on all platforms for performance.
If panels or text develop intermittent transparent holes, as observed on some Windows NVIDIA
laptops, try **Use defaults** to restore Direct3D 11 and accelerated compositing first.
If artifacts persist, turn off **Use GPU compositing** as a compatibility workaround. Disabling it can
significantly reduce frame rates.
macOS and Linux default to Automatic with synchronization and GPU compositing on.
Graphics preferences start fresh on every platform in a shared `graphics` section, so earlier
choices do not override the platform defaults. Subsequent saved choices persist.
**Use defaults** restores the current platform's defaults. Automatic backend selection delegates
to Chromium.
Windows offers Direct3D 11 and OpenGL overrides, macOS offers Metal, and Linux offers OpenGL.
The modal shows the renderer reported by Chromium when available, hardware acceleration status,
and explicit launch overrides. **Save and restart** saves preferences, flushes native state,
and restarts the application. Unsaved launcher
entries are discarded on restart. Preferences live in `app-settings.json` in Electron's
user-data directory, independently of server profiles and game settings. The shared `graphics`
section replaces the retired `settings` section, which is removed on the next save. An unreadable
file is reported in the modal and preserved as a sibling backup on explicit save.
During `npm run dev:client`, the development launcher restarts Electron while keeping Vite
running on the same port. Quit still stops both processes. Packaged apps use Electron relaunch.

**Current graphics → Copy hardware info** copies a formatted JSON issue-report attachment with build,
runtime, OS, CPU, memory, display, saved/startup graphics settings, selected native GPU details,
and an on-demand launcher WebGL2 probe. The probe releases its context after collection.
The report excludes raw launch arguments, local paths, credentials, hostnames, and display IDs.
Missing native GPU information is recorded without preventing the rest of the report from copying.

Explicit native `--use-angle=...`, `--disable-gpu-vsync`, `--disable-gpu-compositing`, and `--uncapped` launch arguments
take precedence over saved preferences and remain in effect after restarting from the modal.
Windows startup also supplies
`--force-high-performance-gpu` to request the faster adapter on hybrid laptops, and the
world and 3D preview contexts request `powerPreference: "high-performance"`. These hints
may be ignored; Windows Graphics settings may still be needed to select the dedicated GPU.
The app-owned `--enable-vsync`
flag restores GPU vsync on any platform, overriding saved preferences, an explicit
`--disable-gpu-vsync`, and `--uncapped` regardless of argument order. It also removes
`--disable-frame-rate-limit`, because Chromium's frame-rate bypass implicitly disables
GPU vsync. Chromium has no matching native enable switch; `--disable-gpu-vsync=false`
does not restore vsync.
The optional Windows OpenGL backend can cause transient UI presentation artifacts on some systems.

Windows packaging also exports `NvOptimusEnablement = 1` and
`AmdPowerXpressRequestHighPerformance = 1` from the unsigned Electron executable.
Forge patches the final packaged executable with LIEF, preserving existing exports and section
bytes; package/archive inspection requires both hints. This selected the dedicated GPU in an
OpenGL test on an NVIDIA/Intel hybrid laptop, but is not a guarantee across drivers or machines.
Before packaging on Windows, install Python 3.12 or newer and run
`npm run setup:windows-packaging`; `npm run test:windows-packaging` checks synthetic PE fixtures.
Release CI installs the pinned build dependency and runs these checks automatically.

The live client and offline Explorer share content, scene, runtime and WebGL2 rendering
infrastructure. In client mode, `ClientRuntime` owns network, world, collision and movement
behavior; the frontend owns camera presentation, gameplay panels and interaction policy.

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

`createInputDefaults(platform)` resolves the maps from an explicit platform fact. Mac uses Command
for held chat-history interaction to preserve native Control-click behavior; other platforms use
Control. Startup settings, missing-binding repair, and input resets use the same policy. Saved
bindings remain explicit choices. Each frontend constructs its own `AppInput` from the resolved
configuration. `InputContext` resolves presses to semantic actions, suppresses repeat, and retains
physical-key ownership until release.
Each mounted frontend owns its action context. `provideAppInputPolicy()` provides one keyboard
router and one `ViewportInputGate`; descendants access them with `useAppInputPolicy()`.
`ClientApp` and `ExplorerApp` mount keyboard routing at their app lifetimes. Gameplay action
contexts and viewport gestures are admitted only in their appropriate authority phase; the
pre-game scene accepts character rotation through its foreground surface, without gameplay movement or picking.
The shared `ClientPregameScreen` uses `keyboard.nativePage` for its mounted lifetime. Launcher,
setup, loading, and character pages retain browser Tab/Shift+Tab traversal and pointer focus even
before a control has focus. This context blocks gameplay commands and retires with the page.

Keyboard ownership defaults to the game. Ordinary HUD buttons, toggles, inventory controls, and
panel gestures do not acquire it. Text/number editors, editable content, and native selects acquire
it through focus. During gameplay, Tab and Shift+Tab do not traverse ordinary HUD controls or dialogs;
an explicitly active scope with `nativeControls` retains browser traversal.
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
world blocking cancel held actions without releasing charged jumps. Editor handoff, window blur, and
visibility loss preserve autorun; modal/scene blocking and lifecycle resets retire it. Repeats and releases from a
cancelled press cannot activate the replacement owner. Precise jump remains a client-owned
interaction within the viewport. Host movement contracts do not contain browser bindings.

Settings → Input → Mouse includes **Use mouse movement/steering**. When enabled,
right-button holds steer the character and adjust camera pitch; middle-button or left-and-right
holds also run forward. Left-button drags orbit the camera independently of that switch. Camera
holds capture the pointer and hide the cursor until release, retaining capture when switching
between steering and orbit. The viewport input owner applies the ordinary click/drag threshold
to captured movement. Independent horizontal and vertical inversion toggles are available for
left-drag camera rotation and mouse steering. Steering's vertical axis tilts the camera; its
horizontal axis turns the character. Axis edits apply on the next mouse sample without releasing
capture. **Restore default input settings** resets keyboard bindings and all mouse preferences.

The asset-free `npm run harness:browser -- --client-hud` suite drives real browser keyboard and
pointer events through the policy, production Explorer controls, chat, and modal integration.

An `AppInput` accepts a complete `InputConfiguration`. The client resolves saved keyboard bindings
at startup and supports live rebinding through its settings editor; Explorer uses the default
configuration. Camera rates and sensitivity remain in the existing tuning files. Tests should use
explicit test bindings or derive expectations from defaults, so editing a default does not require
updating tests.

## Client UI defaults

### Appearance and UI scaling

`src/app/ui-base.css` owns shared UI recipes and semantic font lengths (body, caption, micro,
and three heading sizes). Feature styles belong to `@layer components`; themes and user stylesheet
overrides follow them in the `theme` and `overrides` layers. Keep feature layout local and reuse
shared control recipes. Common panel insets and stacked editor-label gaps use `--ui-body-padding`
and `--ui-label-gap`. Always-visible control groups use `ui-fieldset ui-fieldset-section` with a
`legend` and `ui-fieldset-body`. The `--ui-fieldset-heading-*` tokens control heading size, weight,
color, underline, and spacing; `--ui-fieldset-control-gap` and `--ui-fieldset-control-indent` control
the body layout. Set `--ui-fieldset-heading-border: none` to remove the underline. Palette defaults
resolve at the consuming element so locally scoped themes apply.

Different controls retain their own appearance contracts: for example,
`--ui-button-background-color` styles buttons, while a theme can style tabs through `.ui-tab` and
its state selectors.

Client `ui.uiScale` controls the whole interface: text, icons, controls, spacing, windows,
HUDs, dialogs, menus, and hit targets. It defaults to 100%; its bounds live in
`client-settings-values.ts`. Client UI boundaries apply layout scaling once through
`src/app/ui-scale.ts`. The world canvas, camera input, screen-space target indicators,
renderer nameplates, and combat effects retain their own policies. Explorer stays at neutral scale.

`ui.textScale` adds text enlargement relative to UI scale. For example, 125% UI scale and
120% text scale display ordinary text at 150% of its authored size. Absolute theme font-size
roles are unscaled lengths; their consumers apply `--ui-text-scale` once. Relative
`em`/percentage text inherits the result. Item counts, equipped marks, and shortcut labels also
follow the text preference; authored icon dimensions have no separate user multiplier.
Map labels/cardinals retain their local typography policy while their containing UI scales.

Theme lengths and saved HUD geometry use logical UI units. At 125% UI scale, a 400-unit window
with a 20-unit right anchor displays 500 pixels wide and 25 pixels from that edge. Fitting a
window into a smaller logical viewport never overwrites its saved preferred geometry. Explicit
drag/resize edits save logical units; scale changes cancel active geometry gestures. Character
specific action-bar anchors use the same units. Independent windows may overlap when enlarged;
there is no automatic packing. Natural content measurements remain local, while browser bounds
and hit testing use displayed viewport pixels.

Startup resolves the saved scale before assembling missing or repaired placement defaults, then
mounts the client with complete settings. UI edits use the existing settings-patch persistence
path and do not recreate session or rendering owners. The retired icon preference is stripped
by ordinary persisted-field repair; existing fonts, warning thresholds, and valid placements survive.

The Electron settings store normalizes every supported collection to the running build. It removes
unknown sections and unsupported section versions across user preferences, native window settings,
HUD entries, and all character profiles, including inactive profiles. Supported sections retain
field-level repair. Missing sections use defaults in memory and become durable on explicit save/reset.
Normalization runs before restoration and every queued reread/write, backs up the exact source
before discarding choices, and reports changes after successful replacement. Valid no-op operations
do not rewrite the file. Malformed JSON and unsupported collection formats still fail explicitly.
Launching an older build can intentionally discard preferences introduced by a newer build.

Combat indicators have no user-settings overrides. `--ui-combat-text-size`,
`--ui-combat-text-font` (or the body font role), and `--ui-combat-text-damage-color`,
`--ui-combat-text-critical-color`, and `--ui-combat-text-avoidance-color` own their appearance.
The client resolves those CSS values and publishes theme/font changes to the retained renderer;
animation, placement, and budget policy remain in the combat-effects module. Text scaling has a
single slider; returning it to 100% restores neutral scaling.

`npm run harness:browser -- --client-ui-scaling --brief` verifies live endpoint sizing, nested
roots, mixed UI/text scales, theme overrides, native dialogs, window reopening, and HUD
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

## Summon presentation

Public summon ownership drives player-palette name colors and immediate-only smart Tab admission.
Names remain server-authored. An observed local summon death or server removal produces one combat
chat notice and toast: “Your summon is no longer active”. Local cleanup and session resets are silent.
Server removal can mean loss of tracking rather than global destruction.

`ClientSummonPresentation` requests lifetime once through the existing shared appraisal router;
it does not open the inspector or change the health subscription. Missing timing disables expiry
flicker. A rare late reply after GUID reuse may make cosmetic timing inaccurate.

The h3d runtime draws a summon leash between current posed body anchors. The leash uses green chain
links for your own summons and pale blue links for other players’ summons, with the same faint opacity.
It uses one reusable link mesh and shader-instanced placement. Links fade inside the current posed
body bounds (enclosing scene-axis boxes) toward transparent center anchors, with terminal overhang trimmed. A subtle idle sway
keeps the anchors fixed; a glow pulse travels from the summoner toward the summon. Fixed link
spacing avoids whole-chain redistribution when moving endpoints add or remove links. Leashes draw
once against composed scene depth, spanning indoor cells and indoor/outdoor transitions without per-fragment portal
clipping, like particles. A binary presentation-opacity gate flashes the model, its equipment and
its leash in phase near estimated expiry without changing retail alpha, cloak, motion, collision or
selection geometry. It suppresses color,
selection-mask and shadow submissions on faded frames. Estimated expiry never removes a summon.
Themes own leash colors and opacity through `--ui-summon-leash-own-color` and
`--ui-summon-leash-other-color`. CSS colors, including alpha and inherited values, are resolved on
theme/scope changes and update existing leashes without recreating the renderer. Expiry flicker
does not depend on the theme palette being ready. Base colors remain
faint green for your summons and pale blue for other players' summons.
`CLIENT_SUMMON_TUNING` in `src/client/client-tuning.ts` owns leash geometry, endpoint fade power, sway amplitude/frequency, pulse
frequency/wavelength/strength, glow and the flicker window
(default 10 seconds) and frequency. `npm run harness:browser -- --fixture summons --brief` exercises
the actual GPU pass and runtime lifecycle; the targeting/HUD probe also checks chat and toast.

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

The focused asset-free inspection diagnostic is
`npm run harness:browser -- --client-inspection --brief`.

## Inventory interactions

Drag contents cells onto another cell to merge compatible stacks or insert before
that item when the target cannot accept a merge. Inventory-to-inventory movement
and header transfers require Native sorting. Sorted views allow merges and equipping;
unequipping into sorted contents prepends to the selected container. Drag onto an
equipment row to equip, or from equipment to a contents cell/header to unequip. Core preflights displaced equipment storage and
sequences the server requests. Automatic pickups, unequips, equipment replacements,
and container drops prepend; explicit item drops retain their target position.
Failures use existing action feedback.

Select a stack and press Y (configurable under Settings → Input → Split stack),
or use the selected-item Split stack action, to choose an amount with a number
field or slider. The inventory-local dialog opens only after capacity preflight.
Splits prefer the source pack, then main pack and remaining packs in native order.
New stacks go immediately after their source when stored in the same pack,
otherwise at the front of the destination pack. Selecting the whole quantity is a no-op. Ctrl+Shift+I toggles Electron DevTools; game interactions
own right-click globally.

Real pack cells exchange native positions. Main Pack stays first, foci stay last,
and neither is a reorder target. The panel sends semantic intent and renders
accepted host state; it has no operation-progress subscription or optimistic
inventory model.

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
`npm run harness:browser -- --client-inventory --brief` exercises inventory behavior with
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
component lookup failures remain explicit. The panel supports casting in magic stance and dragging spells into character-specific spell-bar
bindings. The [spell guide](https://merklejerk.github.io/holtburger/3d/spells/) explains the player workflow.

Core snapshots and `PlayerSpellsUpdated` supply complete knowledge after the initial
character description. Static `load_spell_references` queries are independent of that
membership: content resolves formula tiers from decoded DAT components, and the app
host selects the complete artwork recipe. Spell icons use the same `prepare_ui_icons`
pipeline as inventory, with their own composition order. `SpellReferences` caches
definitions for the content lifetime. `ClientSpellState` lazily retains requested
known-spell artwork until removal or character/session teardown, so closing and
reopening the panel reuses prepared images. Each panel or bar also holds
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
Status icons pulse on appearance or a category change; the selected-entity HUD pulses
when a selection appears or changes. Progression's available XP and skill-credit counts
pulse on appearance and balance changes. All use `--ui-hud-pulse-animation`,
`--ui-hud-pulse-duration`, `--ui-hud-pulse-scale` (peak scale), and `--ui-hud-pulse-easing`.
`--ui-hud-pulse-intensity` multiplies growth above normal size (default `1`).
The selected-entity HUD uses `--ui-selected-entity-pulse-intensity` (default `0.2`),
reducing the default peak from `1.5` to `1.1` without changing pulse timing.
Defaults live in `src/app/ui-base.css`. Animation-name tokens accept a custom global
CSS keyframe name or `none` to disable the effect; set the exit duration to `0s` to
remove the toast fade. Reduced-motion preferences disable both animations and the fade.
Enchantment countdown ticks do not pulse; burden pulses only on severity changes.
Selected-entity display updates and empty layout previews do not pulse.

The jump HUD uses `--ui-jump-bar-width`, `--ui-jump-readout-font-size`,
`--ui-jump-gap` and `--ui-jump-fill-color` for density
and appearance. The percentage follows the fill edge, with an underline extending left to the bar.
A rotated PRECISE JUMP / MANUAL JUMP label sits closely beside the bar, aligned
to its bottom edge.
Enter precise targeting with its configured shortcut (Ctrl+Space by default),
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
place and controls backdrops, UI/text scale, layout editing and low-vitals
screen-edge effects. Common controls, dropdowns, dialogs and pregame samples live
in the **Component showcase** window. Hiding that window retains its contents.
Edit the theme CSS and click **Reload theme** to preserve the running client and drafts.
Visual review belongs to the user; browser probes exercise DOM and interactions,
and the showcase probe captures screenshots only when explicitly requested.
Keep automated checks focused on behavior such as input ownership, session commands,
and resource lifetime. Review HUD appearance and layout manually in the showcase;
there is no aggregate HUD acceptance suite.

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

Packaged applications open the integrated server/profile launcher by default. Play starts the Rust
sidecar and asset setup, then connects; highlighting a profile does not start the game. Disconnect
returns to the launcher in the same window. Character logout keeps the connection and returns to
character selection. Complete CLI account/connection arguments bypass the launcher initially;
`--account` remains required for a direct connection. Use an explicit `explorer` argument for offline
exploration. Both clients use `-p` for port and `-P` for password. See the
[3D quickstarts](../../release/quickstarts/3d) for platform-specific installation and launch instructions.

Add `--no-launcher` with `--account` for a direct session that exits on disconnect, cancellation,
or connection/startup failure. This flag takes no value. Without it, direct CLI sessions return to
the launcher when they end. Both paths finish session cleanup and flush settings before exit/return.

Add `--no-updates` to disable update lookups for this process, with or without a direct connection.
It takes no value and does not change saved settings or prevent browsing the server directory.

The main launcher places server selection and profile configuration in separate, aligned columns.
The selected server has a pregame diamond marker and accent edge. Each server has Edit/Delete icon
actions revealed on hover or keyboard focus (always available on touch devices). Editing or deleting
an unselected server preserves the active selection and any entered credential draft.

Profiles are optional credential presets. Account/password and Play are always shown; choose a server
and enter credentials to launch without creating a named profile. Selecting a profile fills the editable fields.
**Save to new profile** opens a naming dialog and creates a preset; **Overwrite profile** saves
current credentials to the selected preset under its existing name. Both save actions encrypt account/password together.
Play uses the current form values without creating or overwriting profiles. Selecting **No profile**
loads that server's own saved credentials. Play with **No profile** encrypts and saves the current
account/password for that server, including failed login attempts. Named profile credentials remain
unchanged. An empty password is supported; an account is required.
Each server remembers the profile selected on its last Play, including **No profile**, and restores
that preset and its credentials when selected again. Launcher file version 4 preserves this history
and profile-free credentials; older files migrate without changing existing saved credentials.
The launcher restores the last server used and lists servers in order of most recent Play. New
servers appear below existing entries; editing server details preserves their position in the list.

Use **Import from TreeStats** beside **Add server** to browse the public directory, search its entries,
and add servers immediately using each row's **Add** icon button. Matching saved endpoints have a disabled
button with an **Added** tooltip. Type and software appear as muted text beside each server name. Additive pill
filters for both categories sit behind a collapsed Filters disclosure with an active selection count.
A compact sort button beside Filters cycles between Name (alphabetical) and Population (highest reported
count first, unreported counts last, ties by name). Sorting applies together with the active filters.
Add uses the existing icon-button treatment; Refresh and Done live in the bottom action row.
Expanded details separate labelled host/port/player-report fields from a titled Description section. Entries expand using the shared pregame character-creator row. Imports copy only
the server name and endpoint; enter credentials or optionally save a profile afterward. Directory metadata and reported player
counts are for browsing and do not establish server availability or H3D compatibility. The directory
loads on demand, is cached in memory, and has an explicit Refresh action. Imported servers remain local
copies; directory changes never update saved endpoints or credentials automatically.

Install the repository's Node.js/npm versions and a current stable Rust toolchain.
Install both tooling packages and run launch commands from the repository root:

```bash
npm ci
npm --prefix apps/holtburger-3d ci
```

Use `npm run dev:explorer` for the Explorer and `npm run dev:client` for client mode.
Both root launch commands support `--help` without building or opening the app.
Development startup incrementally builds the Rust sidecar, starts Vite, launches Electron, and stops
Vite after the application exits. Add `:release` to either named route to use an optimized host build.
Pass `--uncapped` to either mode, with a debug or release host, to disable Chromium's foreground
frame-rate limit and GPU vsync:

```bash
npm run dev:client -- --account YOUR_ACCOUNT --uncapped
npm run dev:client:release -- --account YOUR_ACCOUNT --uncapped
npm run dev:explorer:release -- --uncapped
```

The client main view uses the shared browser animation-frame loop. Background throttling and
preview cadence remain independent. `--enable-vsync` takes precedence over `--uncapped`.

Pass `--dev` to enable renderer diagnostics and expose Chrome DevTools on port 9222,
including in release bundles. This flag does not change the build or optimization mode.
The development launchers also accept `--debug`; use `--dev` with bundles because Electron
interprets `--debug` before the application can handle it.
Use `--debug-port <port>` (or `--debug-port=<port>`) to override the port; `0` requests
an assigned port. The port option also works on its own without enabling renderer diagnostics.

```bash
npm run dev:client -- --account YOUR_ACCOUNT --dev
npm run dev:explorer -- --dev --debug-port 9223
# Pass the same flags to the executable in a release bundle:
./holtburger-3d --account YOUR_ACCOUNT --dev --debug-port 9223
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
npm run dev:client -- --settings-file=.holtburger-local/client-settings-sections.json --account YOUR_ACCOUNT
```

The example assumes you invoke npm from the repository root. Relative `--settings-file` paths
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

Both desktop modes accept `--content <directory>` (or `--content=<directory>`) to select an
installation directory for that launch. Individual archives are artifact-tool inputs:

```bash
npm run dev:explorer -- --content "/path/to/Asherons Call"
npm run dev:client -- --account example --content "/path/to/Asherons Call"
```

The client launcher has an optional Content path override field inside its initially collapsed
Advanced section. Leave it empty to use the application default. Browse selects an installation folder; individual archive paths are rejected. Selecting a profile restores
its path and credentials. Play uses the current form; Save to new profile or Overwrite profile
persists it. Explicit session paths never replace the application default in `content-selection.json`.

With direct-login arguments, `--content` selects assets for that initial session. Otherwise it
initializes the first launcher form after the remembered profile is loaded. Later profile selections
and edits own the value. Returning from a session does not reapply the CLI path. Explorer continues
to use `--content` for its launch. Recovery replacements for explicit selections apply only to the
current attempt; return to the launcher to save a different profile path.

Directories prefer HBA archives. If no HBA exists, the host opens retail DATs and identifies their
roles from their headers. The standard base portal/highres pair is supported: highres resources
take precedence by membership, with base portal supplying other portal resources. Cell and
language archives retain their own namespaces. Duplicate archives of the same retail role are an
error. Invalid HBA content is reported rather than silently repaired with DAT resources.

Two independent desktop flags control asset setup:

- `--no-content-search` disables default automatic discovery for this launch, including retries.
  A saved location and explicit `--content` remain usable; choosing a folder is still available.
- `--clear-content` clears the saved location and its attention marker once before the first game
  attempt (at Explorer startup, or after Play in the client), then follows normal selection policy. Default discovery can find and save another location.
- Use both to open Provide assets directly:
  `npm run dev:explorer -- --no-content-search --clear-content`.

Client accepts the same flags alongside its usual launch arguments. With `--clear-content` and
`--content` together, the requested clear is persisted, then the explicit selection stays temporary.
These flags do not delete archives or clear other settings. The disabled-search policy is not saved.
Standalone browser/live diagnostics do not own desktop preferences and reject these desktop flags.

Without an override, startup first uses the saved selection. Automatic discovery starts at
`HOLTBURGER_DEFAULT_CONTENT` when supplied, otherwise `dats/` beside the executable, then tries
the platform Holtburger data directory. Development runners supply absolute workspace
`local/content/` as the default. Missing, empty, and unsuitable automatic candidates may fall
through; corrupt or unreadable content is reported. The default is consulted only when search
is needed and does not override `--no-content-search`. Paths supplied through npm are resolved
from the invocation directory; installed discovery is independent of working directory.

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
failures do not mark the installation. CLI and launcher overrides, including replacements chosen during recovery,
never rewrite the saved application preference. Profile paths are saved separately in the launcher catalog. `--ignore-config` does not bypass
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

Electron owns one product window and at most one game attempt. Each Play uses a fresh client
document and Rust sidecar. Return to the launcher waits for renderer preparation, accepted settings
and capture writes, and native host termination before reopening Play. Quit joins the same retirement
and also flushes application-lived launcher settings. Unexpected host/connection failures retain their
diagnostics and return through this attempt boundary. Uncoordinated renderer reload remains
unsupported; renderer process failure is application-fatal.

`launcher-settings.json` stores the server/profile catalog, last selection, launcher window size and maximized state,
and encrypted account/password payloads for saved profiles independently of `client-settings.json` and game
window size/maximized state. Neither surface saves or restores window position; old coordinates are
discarded when settings are read. Game resets and `--settings-file` do not affect launcher settings. The embedded universal seed
provides obfuscation against casual plaintext scraping, not a private key: copying this file preserves
its saved credentials. No key file or OS credential service is required. Adding or editing a
server rejects an endpoint already used by another saved server. Server edits preserve its profiles
and saved credentials. Unreadable launcher files require explicit
recovery, which preserves the original in a sibling backup. Older catalogs load without changing
servers or encrypted envelopes and upgrade to version 4 on the next save. Incomplete older profiles
remain editable. Saved credentials are
loaded through a picker-only native command to fill the masked password field; catalog snapshots
exclude passwords and encrypted envelopes.

`npm run probe:content` verifies native startup/recovery in an isolated temporary profile without
screenshots. The synthetic archive intentionally lacks necessary scene/bootstrap assets: the
probe verifies their failure marker, next-launch setup, override isolation, and bounded shutdown in
both modes. Recoverable client attempt failures return to the launcher; failed application retirement
retains a failure exit status. A setup-only close must exit successfully.

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
Windows/macOS application icons. `assets/branding/portal-source.png` at the repository root owns
the static artwork; root `npm run generate:branding` exports sized PNGs, ICO, and ICNS plus
the browser and Flatpak copies. `assets/branding/portal.svg` supplies the loading animation. Commit these exports after artwork changes and run
`npm run check:branding` from the repository root to detect drift. Regular builds consume the checked-in icons.

`npm run package` builds an unpacked application, compiling the frontend, Electron
main/preload code, and release Rust sidecar first. The repository release suite
assembles downloadable native archives from the inspected package.
`npm run check:package` verifies the native host, compiled entries, branding assets, bundled fonts
and their licenses, application license, and Electron/Chromium notices in the unpacked package.
Required ASAR files must be nonempty.
Desktop installer construction belongs to `scripts/installers/`. From this app directory, `npm run package:installer --
--native DIR --output FILE [--iscc PATH]` consumes an extracted native release
bundle, verifies its identity/signatures, and creates the platform's installer. The repository release command
owns archive admission and suite receipts. Use `npm run check:installers` and
`npm run test:installers` for the app-owned tooling checks. Native installer
generation runs on Windows/macOS; portable contract and process tests also run on Linux.
Setup, repair, upgrade, retained settings, and uninstall require manual verification.
The shared filesystem comparison/hash helper uses only Node built-ins and needs no
repository-root dependency installation.

Font packaging checks compare every file under `public/fonts/` with its packaged bytes,
so adding or replacing fonts and notices does not require updating a verification inventory.

Run `npm run probe:user-themes:built` manually to check native theme loading and bundled
font decoding with compiled frontend and Electron output. It exercises development HTTP and
built-file modes, discovering registered faces from the Base font roles. Use
`npm run probe:user-themes` when those outputs need rebuilding first.
Renderer startup, content recovery, and theme/font probes are manual diagnostics.
Build and publication checks verify package contents and generate installers.

The packages are unsigned experimental artifacts. Hosted CI has built and structurally inspected
Linux x86-64, Windows x86-64, and macOS arm64 packages, but that does not certify GPU, input, audio,
display scaling, Gatekeeper, or SmartScreen behavior. Only the available Linux desktop has received
interactive Explorer verification. Do not advertise another platform as supported until its
packaged application has been exercised on that operating system.

The shared `release.yml` workflow builds both products from main, verifies native packages
and installers, and publishes complete beta releases or nightly prereleases after checks
succeed. Diagnostic builds use the same builders without publication. Nightly builds do
not check for updates. See [release preparation](../../release/RELEASING.md) for the
publication policy and limits of automated acceptance.

## Security and dependency maintenance

The renderer has no Node integration. Electron enables context isolation and sandboxing, exposes
only the typed host bridge from preload, accepts IPC only from the product window's main frame,
restricts navigation to the development origin or packaged `dist` tree, denies new windows, and
applies a Content Security Policy. Rust validates the closed command protocol independently.

Review Electron and Electron Forge updates at least monthly and before sharing a build. Apply normal
compatible updates through npm, inspect `npm audit` rather than using a forced downgrade or override,
then run the full checks and package inspection above. Electron upgrades additionally require the
release workflow's diagnostic builds across all native targets and a fresh manual smoke check on available hardware. Update alerts open the published release downloads page; downloading and installing updates
remain manual.

The packaged resources contain Holtburger's AGPLv3 license alongside the Electron and Chromium
notices supplied by Electron. The release suite adds download checksums, build identity, and
documented build/publication instructions in `release/RELEASING.md`.

The WebGL2 backend renders opaque color and depth into a renderer-owned scene target.
Portal views first compose static geometry and terrain from their packed atlas, preserving
original scene depth. Admitted dynamic entity meshes then draw once per physical range and
applicable pass against that depth, independently of their number of spatial memberships.
Both flat and portal views apply one optional near-field ambient occlusion pass to complete
static/entity opaque depth. Outdoor after-landscape weather follows AO on the final target,
so foreground rain can cover interior images seen through doorways and windows. Cameras in
EnvCells suppress that weather pass. Transparent static and entity ranges retain one shared
ordering sequence; particles and other overlays follow it.

Particle owners still pass CPU scope admission, while admitted particles use ordinary depth
testing and blending. Summon leashes and entity color also use composed depth without
per-fragment portal clipping. Static transparency, ordinary nameplates and scoped overlays retain
their portal visibility envelopes. Selected and hovered nameplates draw once as overlays
without scene-depth or portal clipping; entity admission still determines candidate availability.
World spatial memberships, selection feedback and
independent shadow eligibility remain unchanged. The Explorer's Render quality panel
adjusts AO strength, radius, bias, edge threshold, and distance fade live without reallocating
its scratch targets.

Dynamic entity meshes use one ordinary indexed-draw representation. Effective part geometry
defines a reusable source-local merged layout; replaceable appearances own material tables and
index batches. Per-part pose/color records retain landblock-relative transforms. The renderer
prepares all camera, selection, and shadow consumers, uploads their union of required poses, then
executes the prepared draws. Texture bindings, render state, and transparent order still impose
draw boundaries. Neither multi-draw nor dynamic mesh instancing is a fallback.

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
