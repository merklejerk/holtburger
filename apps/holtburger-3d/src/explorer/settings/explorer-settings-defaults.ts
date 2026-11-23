import { MAP_DEFAULT_VIEW_DIAMETERS } from "../../lib/game/map/map-appearance.js";
import type {
	FlyAction,
	InputBindings,
	KeyBinding,
} from "../../lib/input/input-contract.js";
import { EXPLORER_TUNING } from "../explorer-tuning.js";
import type { ExplorerHudLayout } from "./explorer-settings-contract.js";

/** Default HUD-hide / screenshot toggle shortcut (GNOME-safe, remappable). */
const DEFAULT_TOGGLE_HUD_BINDING = {
	key: "h",
	ctrl: true,
	shift: true,
	alt: false,
	meta: false,
} as const satisfies KeyBinding;

/** Default shortcut to despawn the currently selected Explorer entity. */
const DEFAULT_DESPAWN_SELECTED_BINDING = {
	key: "Delete",
	ctrl: false,
	shift: false,
	alt: false,
	meta: false,
} as const satisfies KeyBinding;

/** Default shortcut to possess or release the currently selected Explorer entity. */
const DEFAULT_TOGGLE_POSSESSION_BINDING = {
	key: "f",
	ctrl: false,
	shift: false,
	alt: false,
	meta: false,
} as const satisfies KeyBinding;

/** AC-aligned fly keybindings used for first-run and reset Explorer settings. */
const EXPLORER_FLY_DEFAULTS: InputBindings<FlyAction> = {
	forward: [{ key: "w" }],
	backward: [{ key: "s" }],
	strafeLeft: [{ key: "z" }],
	strafeRight: [{ key: "c" }],
	turnLeft: [{ key: "a" }, { key: "ArrowLeft" }],
	turnRight: [{ key: "d" }, { key: "ArrowRight" }],
	ascend: [{ code: "Space", ctrl: false }],
	descend: [{ code: "Space", ctrl: true }],
	precision: [{ key: "Shift" }],
};

/** Bounded fly-camera translation speed in world units per second. */
export const EXPLORER_FLY_SPEED_RANGE = {
	minimum: 5,
	maximum: 1_000,
	default: EXPLORER_TUNING.camera.controls.moveSpeed,
} as const;

/** Persisted Explorer Launcher form preferences. */
export const EXPLORER_LAUNCHER_DEFAULTS = {
	contentPath: null as string | null,
	weenieCatalogPath: null as string | null,
	initialLocation: "22S, 2W" as string | null,
} as const;

/** Explorer-scoped world, residency, and camera defaults. */
export const EXPLORER_WORLD_DEFAULTS = {
	radii: { ...EXPLORER_TUNING.residency.defaultRadii },
	interestFollowsCamera: true,
	audioFollowsCamera: true,
	flySpeed: EXPLORER_TUNING.camera.controls.moveSpeed,
	minimapViewDiameters: { ...MAP_DEFAULT_VIEW_DIAMETERS },
	showNameplates: true,
} as const;

/** Explorer-scoped input defaults (fly bindings, fly look inversion, and Explorer shortcuts). */
export const EXPLORER_INPUT_DEFAULTS = {
	fly: EXPLORER_FLY_DEFAULTS,
	toggleHud: [DEFAULT_TOGGLE_HUD_BINDING] as readonly KeyBinding[],
	despawnSelected: [DEFAULT_DESPAWN_SELECTED_BINDING] as readonly KeyBinding[],
	togglePossession: [
		DEFAULT_TOGGLE_POSSESSION_BINDING,
	] as readonly KeyBinding[],
	invertFlyHorizontal: false,
	invertFlyVertical: false,
} as const;

/** Default placement map for Explorer's 14 HUD surfaces in logical HUD coordinates. */
export function createDefaultExplorerHudLayout(): ExplorerHudLayout {
	return {
		navigation: {
			horizontal: { alignment: "end", offset: 16 },
			vertical: { alignment: "center", offset: 0 },
			preferredWidth: 640,
			preferredHeight: 640,
		},
		scene: {
			horizontal: { alignment: "end", offset: 16 },
			vertical: { alignment: "center", offset: 0 },
			preferredWidth: 380,
			preferredHeight: 500,
		},
		visuals: {
			horizontal: { alignment: "end", offset: 16 },
			vertical: { alignment: "center", offset: 0 },
			preferredWidth: 380,
			preferredHeight: 540,
		},
		entities: {
			horizontal: { alignment: "end", offset: 16 },
			vertical: { alignment: "center", offset: 0 },
			preferredWidth: 420,
			preferredHeight: 540,
		},
		inspection: {
			horizontal: { alignment: "start", offset: 16 },
			vertical: { alignment: "center", offset: 0 },
			preferredWidth: 380,
			preferredHeight: 500,
		},
		diagnostics: {
			horizontal: { alignment: "end", offset: 16 },
			vertical: { alignment: "start", offset: 260 },
			preferredWidth: 460,
			preferredHeight: 420,
		},
		settings: {
			horizontal: { alignment: "end", offset: 16 },
			vertical: { alignment: "center", offset: 0 },
			preferredWidth: 430,
			preferredHeight: 500,
		},
		minimap: {
			horizontal: { alignment: "end", offset: 48 },
			vertical: { alignment: "start", offset: 30 },
			preferredWidth: 220,
			preferredHeight: 220,
		},
		selectedEntity: {
			horizontal: { alignment: "center", offset: 0 },
			vertical: { alignment: "start", offset: 42 },
			preferredWidth: 360,
			preferredHeight: 72,
		},
		shortcuts: {
			horizontal: { alignment: "end", offset: 16 },
			vertical: { alignment: "end", offset: 16 },
			preferredWidth: 252,
			preferredHeight: 42,
		},
		frameRate: {
			horizontal: { alignment: "center", offset: 0 },
			vertical: { alignment: "start", offset: 8 },
			preferredWidth: 120,
			preferredHeight: 26,
		},
		jumpPower: {
			horizontal: { alignment: "center", offset: 112 },
			vertical: { alignment: "center", offset: 0 },
			preferredWidth: 140,
			preferredHeight: 184,
		},
		possessionRelease: {
			horizontal: { alignment: "center", offset: 0 },
			vertical: { alignment: "end", offset: 16 },
			preferredWidth: 112,
			preferredHeight: 36,
		},
		toast: {
			horizontal: { alignment: "center", offset: 0 },
			vertical: { alignment: "center", offset: 256 },
			preferredWidth: 420,
			preferredHeight: 64,
		},
	};
}
