import type { InputPlatform } from "../lib/input/input-platform.js";
import type { ClientUserSectionValues } from "./client-settings-sections.js";
import {
	CLIENT_DEFAULT_THEME_ID,
	CLIENT_MUSIC_VOLUME_DEFAULT,
	CLIENT_TEXT_SCALE,
	CLIENT_UI_SCALE,
	CLIENT_HUD_WINDOW_OPACITY,
	CLIENT_VITAL_WARNING_THRESHOLDS,
} from "./client-settings-values.js";
import { MAP_DEFAULT_VIEW_DIAMETERS } from "../lib/game/map/map-appearance.js";
import { CLIENT_CHAT_FILTER_TAGS } from "./client-chat-policy.js";
import {
	createClientHudLayout,
	type ClientHudViewport,
} from "./client-hud-layout.js";
import { initialActionBar } from "./client-action-bar-state.js";
import { initialSpellBarBindings } from "./client-spell-bar-state.js";
import {
	clientChatSuppressionSettingsSchema,
	clientLockInteractionSettingsSchema,
} from "./client-settings-contract.js";
import type {
	ClientAudioSettings,
	ClientCharacterSettings,
	ClientUserSettings,
} from "./client-settings-contract.js";
import { CLIENT_TUNING } from "./client-tuning.js";
import { CLIENT_UI_DEFAULTS } from "./client-ui-defaults.js";
import { CLIENT_GRAPHICS_DEFAULTS } from "./client-settings-policy.js";
import { createClientInputDefaults } from "./client-input-settings.js";
import {
	CLIENT_CLOCK_FORMAT_DEFAULT,
	CLIENT_ENVIRONMENT_OVERRIDES_DEFAULT,
} from "./client-environment-settings.js";

/** First-run and reset mix; frontend preferences remain separate from engine tuning. */
export const CLIENT_AUDIO_DEFAULTS = {
	masterVolume: 1,
	musicVolume: CLIENT_MUSIC_VOLUME_DEFAULT,
	effectVolume: 1,
	ambientVolume: 1,
	muted: false,
} as const satisfies ClientAudioSettings;

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
		chatSuppression: clientChatSuppressionSettingsSchema.parse({}),
		lockInteractions: clientLockInteractionSettingsSchema.parse({}),
		graphics: { ...CLIENT_GRAPHICS_DEFAULTS },
		audio: { ...CLIENT_AUDIO_DEFAULTS },
		ui: {
			showFps: false,
			showHelpLabels: true,
			useUnlockHelper: true,
			textScale: CLIENT_TEXT_SCALE.initial,
			uiScale: CLIENT_UI_SCALE.initial,
			hudWindowOpacity: CLIENT_HUD_WINDOW_OPACITY.initial,
			vitalWarningThresholds: CLIENT_VITAL_WARNING_THRESHOLDS,
			themeId: CLIENT_DEFAULT_THEME_ID,
			fonts: { body: "theme", heading: "theme", mono: "theme" },
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
		entityAlerts: [],
		actionBars: [initialActionBar()],
		spellBarBindings: initialSpellBarBindings(),
		combatControls: {
			melee: { height: "medium", power: 0.5 },
			missile: { height: "medium", accuracy: 0.5 },
		},
	};
}
