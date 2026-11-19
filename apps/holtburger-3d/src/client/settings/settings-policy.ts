import type { FrameSettings } from "../../lib/game/renderer/renderer";
import type { SceneInterestRadii } from "../../lib/game/runtime/types";
import type {
	ClientGraphicsSettings,
	ClientNameplateSettings,
} from "./settings-contract";
import { SHARED_FRAME_SETTINGS } from "../../lib/frontend-frame-settings.js";

/** Absence defaults composed from shared rendering policy and client-only view choices. */
export const CLIENT_GRAPHICS_DEFAULTS = {
	viewDistance: 6,
	sealedInteriorAmbientLevel: SHARED_FRAME_SETTINGS.sealedInteriorAmbientLevel,
	ambientOcclusionEnabled: SHARED_FRAME_SETTINGS.ambientOcclusion.enabled,
	entityShadowMode: SHARED_FRAME_SETTINGS.entityShadows.mode,
	verticalFovDegrees: 75,
	textureFiltering: SHARED_FRAME_SETTINGS.quality.textureFiltering,
	renderScale: SHARED_FRAME_SETTINGS.quality.renderScale,
	weatherEnabled: SHARED_FRAME_SETTINGS.weatherEnabled,
} as const satisfies ClientGraphicsSettings;

/** Smart Nameplates are the default cutover mode for new and upgraded installs. */
export const CLIENT_NAMEPLATE_DEFAULTS = {
	mode: "smart",
} as const satisfies ClientNameplateSettings;

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
		sealedInteriorAmbientLevel: graphics.sealedInteriorAmbientLevel,
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
