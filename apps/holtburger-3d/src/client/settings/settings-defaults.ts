import type { InputPlatform } from "../../lib/input/input-platform.js";
import type { ClientUserSectionValues } from "./settings-sections.js";
import {
	CLIENT_DEFAULT_THEME_ID,
	CLIENT_MUSIC_VOLUME_DEFAULT,
	CLIENT_TEXT_SCALE,
	CLIENT_UI_SCALE,
	CLIENT_HUD_WINDOW_OPACITY,
	CLIENT_VITAL_WARNING_THRESHOLDS,
} from "./settings-values.js";
import { MAP_DEFAULT_VIEW_DIAMETERS } from "../../lib/game/map/map-appearance.js";
import { CLIENT_CHAT_FILTER_TAGS } from "../social/chat-policy.js";
import {
	createClientHudLayout,
	type ClientHudViewport,
} from "../hud/hud-layout.js";
import { initialActionBar } from "../hud/action-bar-state.js";
import { initialSpellBarBindings } from "../magic/spell-bar-state.js";
import {
	clientCameraSettingsSchema,
	clientChatSuppressionSettingsSchema,
	clientLockInteractionSettingsSchema,
} from "./settings-contract.js";
import type {
	ClientAudioSettings,
	ClientCharacterSettings,
	ClientUserSettings,
} from "./settings-contract.js";
import { CLIENT_TUNING } from "./tuning.js";
import { CLIENT_UI_DEFAULTS } from "../hud/ui-defaults.js";
import {
	CLIENT_GRAPHICS_DEFAULTS,
	CLIENT_NAMEPLATE_DEFAULTS,
} from "./settings-policy.js";
import { createClientInputDefaults } from "./input-settings.js";
import {
	CLIENT_CLOCK_FORMAT_DEFAULT,
	CLIENT_ENVIRONMENT_OVERRIDES_DEFAULT,
} from "./environment-settings.js";

/** First-run and reset mix; frontend preferences remain separate from engine tuning. */
export const CLIENT_AUDIO_DEFAULTS = {
	masterVolume: 1,
	musicVolume: CLIENT_MUSIC_VOLUME_DEFAULT,
	effectVolume: 1,
	ambientVolume: 1,
	muted: false,
	playInBackground: false,
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
		camera: clientCameraSettingsSchema.parse({}),
		graphics: { ...CLIENT_GRAPHICS_DEFAULTS },
		nameplates: { ...CLIENT_NAMEPLATE_DEFAULTS },
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
