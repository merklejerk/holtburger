import { MAP_DEFAULT_VIEW_DIAMETERS } from "../lib/game/map/map-appearance";
import { CLIENT_CHAT_FILTER_TAGS } from "./client-chat-policy";
import {
	createClientHudLayout,
	type ClientHudViewport,
} from "./client-hud-layout";
import { initialActionBar } from "./client-action-bar-state";
import { initialSpellBarBindings } from "./client-spell-bar-state";
import type {
	ClientCharacterSettings,
	ClientUserSettings,
} from "./client-settings-contract";
import { CLIENT_TUNING } from "./client-tuning";
import { CLIENT_UI_DEFAULTS } from "./client-ui-defaults";
import { CLIENT_GRAPHICS_DEFAULTS } from "./client-settings-policy";
import { CLIENT_KEYBOARD_DEFAULTS } from "./client-input-settings";

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
		chatFilters: [...CLIENT_CHAT_FILTER_TAGS],
		graphics: { ...CLIENT_GRAPHICS_DEFAULTS },
		ui: {
			fonts: { body: "theme", heading: "theme", mono: "theme" },
		},
		input: structuredClone(CLIENT_KEYBOARD_DEFAULTS),
		inspection: {
			previewHeight: CLIENT_TUNING.objectPreview.height.initial,
		},
	};
}

/** Create a genuinely absent character profile without any server-derived settings. */
export function createDefaultClientCharacterSettings(): ClientCharacterSettings {
	return {
		actionBars: [initialActionBar()],
		spellBarBindings: initialSpellBarBindings(),
		combatControls: {
			melee: { height: "medium", power: 0.5 },
			missile: { height: "medium", accuracy: 0.5 },
		},
	};
}
