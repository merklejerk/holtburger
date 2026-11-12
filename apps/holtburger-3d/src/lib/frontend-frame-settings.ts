import { SHARED_FRONTEND_TUNING } from "./frontend-tuning.js";
import { normalizedRgbaColor } from "./frontend-color.js";
import { DEFAULT_AMBIENT_OCCLUSION_PARAMETERS } from "./game/renderer/ambient-occlusion-policy.js";
import { DEFAULT_COLOR_GRADE_PARAMETERS } from "./game/renderer/color-grade-policy.js";
import { DEFAULT_ENTITY_SHADOW_SETTINGS } from "./game/renderer/entity-shadow-policy.js";
import type { NameplateSettings } from "./game/renderer/nameplate-policy";
import type { FrameSettings } from "./game/renderer/renderer";
import { LandblockLayerKind } from "./game/runtime/scene-interest.js";

const NAMEPLATE_TUNING = SHARED_FRONTEND_TUNING.rendering.nameplates;

/** Resolve tuning-only hex colors once into the normalized renderer frame contract. */
const SHARED_NAMEPLATE_SETTINGS = {
	...NAMEPLATE_TUNING,
	appearance: {
		...NAMEPLATE_TUNING.appearance,
		fillColors: {
			mob: normalizedRgbaColor(NAMEPLATE_TUNING.appearance.fillColors.mob),
			npc: normalizedRgbaColor(NAMEPLATE_TUNING.appearance.fillColors.npc),
			other: normalizedRgbaColor(NAMEPLATE_TUNING.appearance.fillColors.other),
			player: normalizedRgbaColor(
				NAMEPLATE_TUNING.appearance.fillColors.player,
			),
			portal: normalizedRgbaColor(
				NAMEPLATE_TUNING.appearance.fillColors.portal,
			),
			selfPlayer: normalizedRgbaColor(
				NAMEPLATE_TUNING.appearance.fillColors.selfPlayer,
			),
		},
		outlineColor: normalizedRgbaColor(NAMEPLATE_TUNING.appearance.outlineColor),
	},
	healthBar: {
		...NAMEPLATE_TUNING.healthBar,
		fillColor: normalizedRgbaColor(NAMEPLATE_TUNING.healthBar.fillColor),
		backgroundColor: normalizedRgbaColor(
			NAMEPLATE_TUNING.healthBar.backgroundColor,
		),
		borderColor: normalizedRgbaColor(NAMEPLATE_TUNING.healthBar.borderColor),
	},
} satisfies NameplateSettings;

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
	sealedInteriorAmbientLevel:
		SHARED_FRONTEND_TUNING.rendering.frameDefaults.sealedInteriorAmbientLevel,
	nameplates: SHARED_NAMEPLATE_SETTINGS,
	ambientOcclusion: {
		enabled: SHARED_FRONTEND_TUNING.rendering.ambientOcclusion.enabledByDefault,
		parameters: DEFAULT_AMBIENT_OCCLUSION_PARAMETERS,
	},
	colorGrade: {
		enabled: SHARED_FRONTEND_TUNING.rendering.colorGrade.enabledByDefault,
		parameters: DEFAULT_COLOR_GRADE_PARAMETERS,
	},
	entityShadows: DEFAULT_ENTITY_SHADOW_SETTINGS,
	entitySelectionOutline: {
		...SHARED_FRONTEND_TUNING.rendering.entitySelectionOutline,
		colors: null,
	},
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
