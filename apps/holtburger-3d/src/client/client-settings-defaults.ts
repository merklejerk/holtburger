import {
	CLIENT_DEFAULT_THEME_ID,
	CLIENT_TEXT_SCALE,
	CLIENT_ICON_SCALE,
	CLIENT_VITAL_WARNING_THRESHOLDS,
} from "./client-settings-values";
import { MAP_DEFAULT_VIEW_DIAMETERS } from "../lib/game/map/map-appearance";
import { CLIENT_CHAT_FILTER_TAGS } from "./client-chat-policy";
import {
	createClientHudLayout,
	type ClientHudViewport,
} from "./client-hud-layout";
import { initialActionBar } from "./client-action-bar-state";
import { initialSpellBarBindings } from "./client-spell-bar-state";
import {
	clientChatSuppressionSettingsSchema,
	clientLockInteractionSettingsSchema,
} from "./client-settings-contract";
import type {
	ClientAudioSettings,
	ClientCharacterSettings,
	ClientUserSettings,
} from "./client-settings-contract";
import { CLIENT_TUNING } from "./client-tuning";
import { CLIENT_UI_DEFAULTS } from "./client-ui-defaults";
import { CLIENT_GRAPHICS_DEFAULTS } from "./client-settings-policy";
import { CLIENT_INPUT_DEFAULTS } from "./client-input-settings";
import {
	CLIENT_CLOCK_FORMAT_DEFAULT,
	CLIENT_ENVIRONMENT_OVERRIDES_DEFAULT,
} from "./client-environment-settings";

/** First-run and reset mix; frontend preferences remain separate from engine tuning. */
export const CLIENT_AUDIO_DEFAULTS = {
	masterVolume: 1,
	effectVolume: 1,
	ambientVolume: 1,
	muted: false,
} as const satisfies ClientAudioSettings;

/** Build absence defaults from the same constants consumed by the live client. */
export function createDefaultClientUserSettings(
	viewport: ClientHudViewport,
	shortcutCount: number,
): ClientUserSettings {
	return {
		hudLayout: createClientHudLayout(
			CLIENT_UI_DEFAULTS,
			viewport,
			shortcutCount,
		),
		spellBarShape: "single",
		minimapViewDiameters: { ...MAP_DEFAULT_VIEW_DIAMETERS },
		recentEmotes: [],
		chatFilters: [...CLIENT_CHAT_FILTER_TAGS],
		chatSuppression: clientChatSuppressionSettingsSchema.parse({}),
		lockInteractions: clientLockInteractionSettingsSchema.parse({}),
		graphics: { ...CLIENT_GRAPHICS_DEFAULTS },
		audio: { ...CLIENT_AUDIO_DEFAULTS },
		ui: {
			showFps: false,
			showHelpLabels: true,
			useUnlockHelper: true,
			textScale: CLIENT_TEXT_SCALE.initial,
			iconScale: CLIENT_ICON_SCALE.initial,
			vitalWarningThresholds: CLIENT_VITAL_WARNING_THRESHOLDS,
			themeId: CLIENT_DEFAULT_THEME_ID,
			fonts: { body: "theme", heading: "theme", mono: "theme" },
		},
		input: structuredClone(CLIENT_INPUT_DEFAULTS),
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
