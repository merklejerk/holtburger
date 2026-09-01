import { SHARED_FRONTEND_TUNING } from "./frontend-tuning";
import { DEFAULT_AMBIENT_OCCLUSION_PARAMETERS } from "./game/renderer/ambient-occlusion-policy";
import { DEFAULT_COLOR_GRADE_PARAMETERS } from "./game/renderer/color-grade-policy";
import { DEFAULT_ENTITY_SHADOW_SETTINGS } from "./game/renderer/entity-shadow-policy";
import type { FrameSettings } from "./game/renderer/renderer";
import { LandblockLayerKind } from "./game/runtime/scene-interest";

/**
 * Shared starting display policy for a mode composition.
 *
 * The renderer consumes a frame policy but does not choose one. Explorer and client modules may
 * compose explicit overrides over this baseline before passing their result to the runtime.
 */
export const SHARED_FRAME_SETTINGS = {
	layerVisibility: {
		[LandblockLayerKind.Terrain]: true,
		[LandblockLayerKind.Buildings]: true,
		[LandblockLayerKind.Objects]: true,
		[LandblockLayerKind.Generated]: true,
		[LandblockLayerKind.EnvCells]: true,
	},
	showRetailHiddenGeometry: false,
	nameplates: SHARED_FRONTEND_TUNING.rendering.nameplates,
	ambientOcclusion: {
		enabled: SHARED_FRONTEND_TUNING.rendering.ambientOcclusion.enabledByDefault,
		parameters: DEFAULT_AMBIENT_OCCLUSION_PARAMETERS,
	},
	colorGrade: {
		enabled: SHARED_FRONTEND_TUNING.rendering.colorGrade.enabledByDefault,
		parameters: DEFAULT_COLOR_GRADE_PARAMETERS,
	},
	entityShadows: DEFAULT_ENTITY_SHADOW_SETTINGS,
	distanceFogEnabled:
		SHARED_FRONTEND_TUNING.rendering.frameDefaults.distanceFogEnabled,
	viewerLightEnabled:
		SHARED_FRONTEND_TUNING.rendering.viewerLight.enabledByDefault,
	weatherEnabled: SHARED_FRONTEND_TUNING.rendering.frameDefaults.weatherEnabled,
	staticLightsEnabled:
		SHARED_FRONTEND_TUNING.rendering.frameDefaults.staticLightsEnabled,
	envCellRenderMode:
		SHARED_FRONTEND_TUNING.rendering.frameDefaults.envCellRenderMode,
	quality: {
		minimumObjectFootprintCssPixelArea:
			SHARED_FRONTEND_TUNING.rendering.frameDefaults
				.minimumObjectFootprintCssPixelArea,
		minimumPortalFootprintCssPixelArea:
			SHARED_FRONTEND_TUNING.rendering.frameDefaults
				.minimumPortalFootprintCssPixelArea,
		renderScale: SHARED_FRONTEND_TUNING.rendering.frameDefaults.renderScale,
		textureFiltering:
			SHARED_FRONTEND_TUNING.rendering.frameDefaults.textureFiltering,
	},
} as const satisfies FrameSettings;
