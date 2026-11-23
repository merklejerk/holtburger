import {
	SHARED_AUDIO_DEFAULTS,
	SHARED_FONT_FAMILY_OPTIONS,
	SHARED_GRAPHICS_DEFAULTS,
	SHARED_GRAPHICS_RANGES,
	SHARED_HUD_WINDOW_OPACITY,
	SHARED_TEXT_SCALE,
	SHARED_UI_SCALE,
} from "../../app/settings/shared-settings-contract.js";
import { TRAVELERS_KIT_THEME_ID } from "../../app/theme/ui-theme-contract.js";
import { MAP_DEFAULT_VIEW_DIAMETERS } from "../../lib/game/map/map-appearance.js";
import type { InputPlatform } from "../../lib/input/input-platform.js";
import { initialActionBar } from "../hud/action-bar-state.js";
import {
	createClientHudLayout,
	type ClientHudViewport,
} from "../hud/hud-layout.js";
import { CLIENT_UI_DEFAULTS } from "../hud/ui-defaults.js";
import { initialSpellBarBindings } from "../magic/spell-bar-state.js";
import { CLIENT_CHAT_FILTER_TAGS } from "../social/chat-policy.js";
import {
	CLIENT_CLOCK_FORMAT_DEFAULT,
	CLIENT_ENVIRONMENT_OVERRIDES_DEFAULT,
} from "./environment-settings.js";
import { createClientInputDefaults } from "./input-settings.js";
import type {
	ClientCharacterSettings,
	ClientUserSettings,
} from "./settings-contract.js";
import type { ClientUserSectionValues } from "./settings-sections.js";
import { CLIENT_TUNING } from "./tuning.js";

// --- Bounds and closed option sets shared by validation and settings controls ---

/** World-idle dwell before camera orbit starts, in seconds; zero disables idle orbit. */
export const CLIENT_IDLE_CAMERA_ORBIT_DELAY_SECONDS = {
	initial: 60,
	minimum: 0,
	maximum: 300,
	step: 5,
} as const;

/** Editable client graphics ranges, shared by durable validation and controls. */
export const CLIENT_GRAPHICS_RANGES = SHARED_GRAPHICS_RANGES;

/** Theme used by fresh/reset settings and sections without an explicit theme choice. */
export const CLIENT_DEFAULT_THEME_ID = TRAVELERS_KIT_THEME_ID;

/** Additional client text enlargement, composed with the overall UI scale. */
export const CLIENT_TEXT_SCALE = SHARED_TEXT_SCALE;

/** Overall client interface scale, applied once at UI layout boundaries. */
export const CLIENT_UI_SCALE = SHARED_UI_SCALE;

/** Background opacity for floating gameplay windows; foreground content stays opaque. */
export const CLIENT_HUD_WINDOW_OPACITY = SHARED_HUD_WINDOW_OPACITY;

/** Closed font choices for each client UI role; Theme default inherits the active theme. */
export const CLIENT_FONT_FAMILY_OPTIONS = SHARED_FONT_FAMILY_OPTIONS;
export type ClientFontFamily = (typeof CLIENT_FONT_FAMILY_OPTIONS)[number];

/** Fixed recovery buffer prevents warning flicker near the user's threshold. */
export const CLIENT_VITAL_WARNING_RECOVERY_MARGIN_PERCENT = 5;
/** Remaining-vital percentage limits apply to each vital's glow and veins. */
export const CLIENT_VITAL_WARNING_PERCENT = {
	initial: 20,
	minimum: 1,
	maximum: 100 - CLIENT_VITAL_WARNING_RECOVERY_MARGIN_PERCENT,
	step: 1,
} as const;

/** Canonical vital order and labels for the warning controls and policy. */
export const CLIENT_VITAL_WARNING_KINDS = [
	{ kind: "health", label: "Health" },
	{ kind: "stamina", label: "Stamina" },
	{ kind: "mana", label: "Mana" },
] as const;
/** Absence defaults for independently saved vital percentages. */
export const CLIENT_VITAL_WARNING_THRESHOLDS = {
	health: CLIENT_VITAL_WARNING_PERCENT.initial,
	stamina: CLIENT_VITAL_WARNING_PERCENT.initial,
	mana: CLIENT_VITAL_WARNING_PERCENT.initial,
} as const;

// --- Section defaults for first-run, reset, and schema upgrade fallbacks ---

/** Local camera behavior defaults. */
export const CLIENT_CAMERA_DEFAULTS = {
	idleOrbitDelaySeconds: CLIENT_IDLE_CAMERA_ORBIT_DELAY_SECONDS.initial,
} as const;

/** Local chat admission defaults; suppressed messages never enter retained history. */
export const CLIENT_CHAT_SUPPRESSION_DEFAULTS = {
	hideSelfEvasionsAndResists: true,
	hideSpellIncantations: true,
} as const;

/** Local lock interaction defaults; server gameplay options do not own this automation. */
export const CLIENT_LOCK_INTERACTION_DEFAULTS = {
	autoUseKeys: false,
} as const;

/** Absence defaults composed from shared rendering policy and client-only view choices. */
export const CLIENT_GRAPHICS_DEFAULTS = SHARED_GRAPHICS_DEFAULTS;

/** Smart Nameplates are the default cutover mode for new and upgraded installs. */
const CLIENT_NAMEPLATE_DEFAULTS = {
	mode: "smart",
} as const;

/** First-run and reset mix; frontend preferences remain separate from engine tuning. */
export const CLIENT_AUDIO_DEFAULTS = SHARED_AUDIO_DEFAULTS;

/** First-run and reset UI preferences; schema upgrades draw per-field defaults from here. */
export const CLIENT_UI_SETTINGS_DEFAULTS = {
	showFps: false,
	showHelpLabels: true,
	useUnlockHelper: true,
	textScale: CLIENT_TEXT_SCALE.initial,
	uiScale: CLIENT_UI_SCALE.initial,
	hudWindowOpacity: CLIENT_HUD_WINDOW_OPACITY.initial,
	vitalWarningThresholds: CLIENT_VITAL_WARNING_THRESHOLDS,
	themeId: CLIENT_DEFAULT_THEME_ID,
	fonts: { body: "theme", heading: "theme", mono: "theme" },
} as const;

// --- Composite profile builders ---

/** Build absence defaults from the same constants consumed by the live client. */
export function createDefaultClientUserSettings(
	viewport: ClientHudViewport,
	shortcutCount: number,
	platform: InputPlatform,
): ClientUserSettings {
	return {
		...createDefaultClientUserSections(platform),
		hudLayout: createClientHudLayout(
			CLIENT_UI_DEFAULTS,
			viewport,
			shortcutCount,
		),
	};
}

/** Non-layout defaults can be repaired before the saved UI scale determines placement defaults. */
export function createDefaultClientUserSections(
	platform: InputPlatform,
): ClientUserSectionValues {
	return {
		spellBarShape: "single",
		minimapViewDiameters: { ...MAP_DEFAULT_VIEW_DIAMETERS },
		recentEmotes: [],
		chatFilters: [...CLIENT_CHAT_FILTER_TAGS],
		chatChannelFilters: {
			general: true,
			trade: true,
			lfg: true,
			roleplay: true,
			allegiance: true,
			society: true,
			olthoi: true,
		},
		chatTimestamps: true,
		chatSuppression: { ...CLIENT_CHAT_SUPPRESSION_DEFAULTS },
		lockInteractions: { ...CLIENT_LOCK_INTERACTION_DEFAULTS },
		camera: { ...CLIENT_CAMERA_DEFAULTS },
		graphics: { ...CLIENT_GRAPHICS_DEFAULTS },
		nameplates: { ...CLIENT_NAMEPLATE_DEFAULTS },
		audio: { ...CLIENT_AUDIO_DEFAULTS },
		ui: {
			...CLIENT_UI_SETTINGS_DEFAULTS,
			vitalWarningThresholds: {
				...CLIENT_UI_SETTINGS_DEFAULTS.vitalWarningThresholds,
			},
			fonts: { ...CLIENT_UI_SETTINGS_DEFAULTS.fonts },
		},
		input: createClientInputDefaults(platform),
		clockFormat: CLIENT_CLOCK_FORMAT_DEFAULT,
		environmentOverrides: CLIENT_ENVIRONMENT_OVERRIDES_DEFAULT,
		inspection: {
			previewHeight: CLIENT_TUNING.objectPreview.height.initial,
		},
	};
}

/** Create a genuinely absent character profile without any server-derived settings. */
export function createDefaultClientCharacterSettings(): ClientCharacterSettings {
	return {
		packAffinities: {},
		entityAlerts: [],
		actionBars: [initialActionBar()],
		spellBarBindings: initialSpellBarBindings(),
		combatControls: {
			melee: { height: "medium", power: 0.5 },
			missile: { height: "medium", accuracy: 0.5 },
		},
	};
}
