import { SHARED_FRAME_SETTINGS } from "../../lib/frontend-frame-settings.js";
import type { EntityShadowMode } from "../../lib/game/renderer/shadows/entity-shadow-modes.js";
import type { TextureFilteringPolicy } from "../../lib/game/renderer/webgl2/texture-filtering-policy.js";

/** Closed font choices for each UI role; `"theme"` inherits the active theme. */
export const SHARED_FONT_FAMILY_OPTIONS = [
	"theme",
	"sans",
	"serif",
	"mono",
] as const;
export type SharedFontFamily = (typeof SHARED_FONT_FAMILY_OPTIONS)[number];

/** Editable graphics ranges shared by durable validation and settings controls. */
export const SHARED_GRAPHICS_RANGES = {
	sealedInteriorAmbientLevel: { minimum: 0, maximum: 1, step: 0.01 },
	viewDistance: { minimum: 0, maximum: 8, step: 1 },
	verticalFovDegrees: { minimum: 50, maximum: 100, step: 1 },
	renderScale: { minimum: 0.5, maximum: 2 },
} as const;

/** Shared graphics defaults composed from shared rendering policy and view choices. */
export const SHARED_GRAPHICS_DEFAULTS = {
	viewDistance: 6,
	sealedInteriorAmbientLevel: SHARED_FRAME_SETTINGS.sealedInteriorAmbientLevel,
	ambientOcclusionEnabled: SHARED_FRAME_SETTINGS.ambientOcclusion.enabled,
	entityShadowMode: SHARED_FRAME_SETTINGS.entityShadows.mode,
	verticalFovDegrees: 75,
	textureFiltering: SHARED_FRAME_SETTINGS.quality.textureFiltering,
	renderScale: SHARED_FRAME_SETTINGS.quality.renderScale,
	weatherEnabled: SHARED_FRAME_SETTINGS.weatherEnabled,
} as const;

/** Narrow structural contract for shared Graphics settings controls. */
export interface SharedGraphicsSettings {
	readonly viewDistance: number;
	readonly ambientOcclusionEnabled: boolean;
	readonly sealedInteriorAmbientLevel: number;
	readonly entityShadowMode: EntityShadowMode;
	readonly verticalFovDegrees: number;
	readonly textureFiltering: TextureFilteringPolicy;
	readonly renderScale: number;
	readonly weatherEnabled: boolean;
}

/** Additional text enlargement composed with overall UI scale. */
export const SHARED_TEXT_SCALE = {
	initial: 1,
	minimum: 0.75,
	maximum: 2,
	step: 0.05,
} as const;

/** Overall interface scale applied once at UI layout boundaries. */
export const SHARED_UI_SCALE = {
	initial: 1,
	minimum: 0.75,
	maximum: 2,
	step: 0.05,
} as const;

/** Background opacity for floating HUD windows; foreground content stays opaque. */
export const SHARED_HUD_WINDOW_OPACITY = {
	initial: 0.74,
	minimum: 0,
	maximum: 1,
	step: 0.01,
} as const;

/** Shared audio mix defaults. */
export const SHARED_AUDIO_DEFAULTS = {
	masterVolume: 1,
	effectVolume: 1,
	musicVolume: 0.75,
	ambientVolume: 1,
	playInBackground: false,
	muted: false,
} as const;

/** Narrow structural contract for shared Appearance settings controls. */
export interface SharedAppearanceSettings {
	readonly themeId: string | null;
	readonly textScale: number;
	readonly uiScale: number;
	readonly hudWindowOpacity: number;
	readonly fonts: {
		readonly body: SharedFontFamily;
		readonly heading: SharedFontFamily;
		readonly mono: SharedFontFamily;
	};
}

/** Narrow structural contract for shared Audio settings controls. */
export interface SharedAudioSettings {
	readonly masterVolume: number;
	readonly effectVolume: number;
	readonly musicVolume: number;
	readonly ambientVolume: number;
	readonly playInBackground: boolean;
	readonly muted: boolean;
}
