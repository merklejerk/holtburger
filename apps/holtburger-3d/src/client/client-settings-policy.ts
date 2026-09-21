import type { FrameSettings } from "../lib/game/renderer/renderer";
import type { SceneInterestRadii } from "../lib/game/runtime/types";
import type { ClientGraphicsSettings } from "./client-settings-contract";
import { SHARED_FRAME_SETTINGS } from "../lib/frontend-frame-settings";

/** Absence defaults composed from shared rendering policy and client-only view choices. */
export const CLIENT_GRAPHICS_DEFAULTS = {
	viewDistance: 6,
	ambientOcclusionEnabled: SHARED_FRAME_SETTINGS.ambientOcclusion.enabled,
	entityShadowMode: SHARED_FRAME_SETTINGS.entityShadows.mode,
	verticalFovDegrees: 75,
	textureFiltering: SHARED_FRAME_SETTINGS.quality.textureFiltering,
	renderScale: SHARED_FRAME_SETTINGS.quality.renderScale,
	weatherEnabled: SHARED_FRAME_SETTINGS.weatherEnabled,
} as const satisfies ClientGraphicsSettings;

const EXPLICIT_OBJECT_RADIUS_CAP = 1;
const GENERATED_OBJECT_RADIUS_CAP = 2;
const ENV_CELL_RADIUS_CAP = 1;

/** Client detail stays capped while the user extends scenery distance. */
export function clientSceneInterestRadii(
	viewDistance: number,
): SceneInterestRadii {
	return {
		terrainRadius: viewDistance,
		buildingRadius: viewDistance,
		explicitObjectRadius: Math.min(viewDistance, EXPLICIT_OBJECT_RADIUS_CAP),
		generatedObjectRadius: Math.min(viewDistance, GENERATED_OBJECT_RADIUS_CAP),
		envCellRadius: Math.min(viewDistance, ENV_CELL_RADIUS_CAP),
	};
}

/** Apply only user-facing graphics choices to the existing renderer policy. */
export function frameSettingsWithGraphics(
	settings: FrameSettings,
	graphics: ClientGraphicsSettings,
): FrameSettings {
	return {
		...settings,
		ambientOcclusion: {
			...settings.ambientOcclusion,
			enabled: graphics.ambientOcclusionEnabled,
		},
		entityShadows: {
			...settings.entityShadows,
			mode: graphics.entityShadowMode,
		},
		quality: {
			...settings.quality,
			textureFiltering: graphics.textureFiltering,
			renderScale: graphics.renderScale,
		},
		weatherEnabled: graphics.weatherEnabled,
	};
}
