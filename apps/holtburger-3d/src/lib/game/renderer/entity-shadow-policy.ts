import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";
import type { DynamicEntityPresentationClass } from "../dynamic-entity-presentation-class";
import type { ObjectPresentationFootprint } from "./render-world";

/** Complete cascade capacity compiled into the bounded outdoor shadow shader family. */
export const MAX_OUTDOOR_PSSM_CASCADES = 2;

/** Smallest selectable square depth-map edge. */
const MIN_OUTDOOR_PSSM_MAP_RESOLUTION = 256;

/** Largest square depth-map edge guaranteed by baseline WebGL2. */
export const MAX_OUTDOOR_PSSM_MAP_RESOLUTION = 2_048;

/** Largest camera interval covered by outdoor actor shadows. */
const MAX_OUTDOOR_PSSM_DISTANCE = 2_048;

/** Largest square PCF kernel radius compiled into receiver shaders. */
export const MAX_OUTDOOR_PSSM_PCF_RADIUS = 2;

/**
 * Conservative ceiling after the baseline-sized static and dynamic light arrays consume their
 * fragment-uniform vectors. The configured value still sizes CPU storage and generated GLSL.
 */
const MAX_BASELINE_WEBGL2_ANALYTIC_SHADOW_CASTERS_PER_RECEIVER = 32;

const configuredAnalyticCasterCapacity =
	SHARED_FRONTEND_TUNING.rendering.entityShadows
		.maximumAnalyticShadowCastersPerReceiver;
if (
	!Number.isInteger(configuredAnalyticCasterCapacity) ||
	configuredAnalyticCasterCapacity < 1 ||
	configuredAnalyticCasterCapacity >
		MAX_BASELINE_WEBGL2_ANALYTIC_SHADOW_CASTERS_PER_RECEIVER
) {
	throw new Error(
		`Entity analytic-shadow caster capacity must be an integer from 1 through ${MAX_BASELINE_WEBGL2_ANALYTIC_SHADOW_CASTERS_PER_RECEIVER}.`,
	);
}

/** Build-time analytic-caster capacity shared by CPU selection and generated GLSL. */
export const MAX_ENTITY_ANALYTIC_SHADOW_CASTERS_PER_RECEIVER =
	configuredAnalyticCasterCapacity;

/** Exhaustive entity-shadow quality policy consumed directly by renderer scheduling. */
export const ENTITY_SHADOW_MODES = ["none", "simple", "shadow-maps"] as const;
export type EntityShadowMode = (typeof ENTITY_SHADOW_MODES)[number];

/** Complete runtime-adjustable outdoor directional-shadow policy. */
export interface OutdoorPssmSettings {
	/** Number of ordered camera-depth partitions. */
	readonly cascadeCount: number;
	/** Square depth-map edge in pixels. */
	readonly mapResolution: number;
	/** Maximum camera distance covered in world units. */
	readonly maximumDistance: number;
	/** Uniform/logarithmic split interpolation, from uniform 0 to logarithmic 1. */
	readonly splitLambda: number;
	/** Fraction of each cascade interval blended into its successor. */
	readonly transitionFraction: number;
	/** Constant receiver-side comparison bias in normalized light depth. */
	readonly receiverDepthBias: number;
	/** World-space receiver offset along its surface normal. */
	readonly normalOffsetBias: number;
	/** Rasterizer polygon-offset slope factor for caster depth. */
	readonly casterPolygonOffsetFactor: number;
	/** Rasterizer polygon-offset constant units for caster depth. */
	readonly casterPolygonOffsetUnits: number;
	/** Square percentage-closer-filter radius in texels. */
	readonly pcfRadius: number;
	/** Maximum fractional attenuation of regional-sun diffuse. */
	readonly strength: number;
}

/** Shared bounded projection policy for mapped and analytic outdoor entity shadows. */
export interface OutdoorShadowProjectionSettings {
	/** Minimum effective shadow elevation above the horizon; scene sunlight remains authored. */
	readonly minimumLightElevationDegrees: number;
	/** Maximum rigid caster height allowed to extend an outdoor shadow. */
	readonly maximumCasterHeight: number;
	/** Maximum horizontal distance reached by an outdoor shadow. */
	readonly maximumCastLength: number;
}

/** Complete-root budget independently enforced for every rendered outdoor view. */
export interface OutdoorShadowCasterBudget {
	/** Maximum eligible caster roots retained by one view (N). */
	readonly maximumSelectedRoots: number;
	/** Selected-root prefix admitted to mapped PSSM work (M). */
	readonly maximumMappedRoots: number;
}

/** Harness-backed safety ceiling; final defaults remain a visual/performance tuning decision. */
export const MAX_OUTDOOR_SHADOW_SELECTED_ROOTS = 512;

/** Complete runtime-adjustable radial-grounding policy for EnvCell shells. */
export interface IndoorGroundingSettings {
	/** Maximum fractional darkening applied to an upward-facing receiver surface. */
	readonly strength: number;
	/** Multiplier from horizontal presentation radius to contact radius. */
	readonly radiusScale: number;
	/** Fraction of the radius occupied by the soft radial edge. */
	readonly softness: number;
	/** Additional radius, in base-radius units, reached at maximum drop. */
	readonly dropSpread: number;
	/** Largest vertical distance below a caster reached by its grounding cue. */
	readonly maximumDrop: number;
	/** Up-facing scalar at or below which a surface receives no grounding. */
	readonly minimumUpFacing: number;
	/** Up-facing scalar at or above which a surface receives full grounding. */
	readonly fullStrengthUpFacing: number;
	/** Small downward offset compensating for bounds that end exactly on a receiver. */
	readonly contactBias: number;
}

/** Terrain-only sun-aligned analytic fallback appearance and receiver policy. */
export interface OutdoorDirectionalShadowSettings {
	/** Maximum fractional attenuation of regional-sun diffuse. */
	readonly strength: number;
	/** Multiplier from rigid horizontal radius to capsule radius. */
	readonly radiusScale: number;
	/** Fraction of the capsule radius occupied by its soft edge. */
	readonly softness: number;
	/** Largest vertical distance below the root contact that may receive the shadow. */
	readonly maximumReceiverDrop: number;
	/** Up-facing scalar at or below which terrain receives no analytic shadow. */
	readonly minimumUpFacing: number;
	/** Up-facing scalar at or above which terrain receives full analytic shadow strength. */
	readonly fullStrengthUpFacing: number;
	/** Small downward offset compensating for contact bounds exactly on terrain. */
	readonly contactBias: number;
	/** Default strength retained at the projected capsule endpoint. */
	readonly tailStrength: number;
}

/** Complete entity-shadow presentation choice snapshotted with every frame. */
export interface EntityShadowSettings {
	/** Sole authority for disabled, analytic-only, or hybrid shadow scheduling. */
	readonly mode: EntityShadowMode;
	/** Coupled per-view N/M limit; analytic capacity is the derived N-M remainder. */
	readonly casterBudget: OutdoorShadowCasterBudget;
	readonly pssm: OutdoorPssmSettings;
	/** Sole projection authority shared by both outdoor shadow mechanisms. */
	readonly projection: OutdoorShadowProjectionSettings;
	/** Radial indoor EnvCell grounding only. */
	readonly indoorGrounding: IndoorGroundingSettings;
	/** Terrain-only directional analytic fallback appearance. */
	readonly outdoorDirectional: OutdoorDirectionalShadowSettings;
}

/** Validate and retain one coupled complete-root budget. */
export function createOutdoorShadowCasterBudget(
	budget: OutdoorShadowCasterBudget,
): OutdoorShadowCasterBudget {
	if (
		!Number.isInteger(budget.maximumSelectedRoots) ||
		budget.maximumSelectedRoots < 1 ||
		budget.maximumSelectedRoots > MAX_OUTDOOR_SHADOW_SELECTED_ROOTS
	) {
		throw new Error(
			`Outdoor shadow selected-root budget must be an integer from 1 through ${MAX_OUTDOOR_SHADOW_SELECTED_ROOTS}.`,
		);
	}
	if (
		!Number.isInteger(budget.maximumMappedRoots) ||
		budget.maximumMappedRoots < 0
	) {
		throw new Error(
			"Outdoor shadow mapped-root budget must be a non-negative integer.",
		);
	}
	if (budget.maximumMappedRoots > budget.maximumSelectedRoots) {
		throw new Error(
			"Outdoor shadow mapped-root budget must not exceed the selected-root budget.",
		);
	}
	return budget;
}

/** Whether producer-resolved presentation policy admits a spawned entity as a shadow caster. */
export function isEntityShadowCasterClass(
	entityClass: DynamicEntityPresentationClass,
): boolean {
	return (
		entityClass === "player" || entityClass === "npc" || entityClass === "mob"
	);
}

/** Whether one static presentation is authored as an outdoor PSSM receiver. */
export function isOutdoorPssmReceiverFootprint(
	footprint: ObjectPresentationFootprint,
): boolean {
	return footprint.kind === "eligible" && footprint.objectClass === "building";
}

/** Validate and retain one complete outdoor policy. */
export function createOutdoorPssmSettings(
	settings: OutdoorPssmSettings,
): OutdoorPssmSettings {
	if (
		!Number.isInteger(settings.cascadeCount) ||
		settings.cascadeCount < 1 ||
		settings.cascadeCount > MAX_OUTDOOR_PSSM_CASCADES
	) {
		throw new Error(
			`Outdoor shadow cascade count must be an integer from 1 through ${MAX_OUTDOOR_PSSM_CASCADES}.`,
		);
	}
	if (
		!Number.isInteger(settings.mapResolution) ||
		settings.mapResolution < MIN_OUTDOOR_PSSM_MAP_RESOLUTION ||
		settings.mapResolution > MAX_OUTDOOR_PSSM_MAP_RESOLUTION ||
		(settings.mapResolution & (settings.mapResolution - 1)) !== 0
	) {
		throw new Error(
			`Outdoor shadow map resolution must be a power-of-two integer from ${MIN_OUTDOOR_PSSM_MAP_RESOLUTION} through ${MAX_OUTDOOR_PSSM_MAP_RESOLUTION}.`,
		);
	}
	finiteRange(
		settings.maximumDistance,
		0,
		MAX_OUTDOOR_PSSM_DISTANCE,
		false,
		"Outdoor shadow maximum distance must be finite and in (0, 2048].",
	);
	finiteRange(
		settings.splitLambda,
		0,
		1,
		true,
		"Outdoor shadow split lambda must be finite and within [0, 1].",
	);
	finiteRange(
		settings.transitionFraction,
		0,
		0.5,
		true,
		"Outdoor shadow transition fraction must be finite and within [0, 0.5].",
	);
	finiteRange(
		settings.receiverDepthBias,
		0,
		0.05,
		true,
		"Outdoor shadow receiver depth bias must be finite and within [0, 0.05].",
	);
	finiteRange(
		settings.normalOffsetBias,
		0,
		4,
		true,
		"Outdoor shadow normal-offset bias must be finite and within [0, 4].",
	);
	finiteRange(
		settings.casterPolygonOffsetFactor,
		0,
		8,
		true,
		"Outdoor shadow caster polygon-offset factor must be finite and within [0, 8].",
	);
	finiteRange(
		settings.casterPolygonOffsetUnits,
		0,
		16,
		true,
		"Outdoor shadow caster polygon-offset units must be finite and within [0, 16].",
	);
	if (
		!Number.isInteger(settings.pcfRadius) ||
		settings.pcfRadius < 0 ||
		settings.pcfRadius > MAX_OUTDOOR_PSSM_PCF_RADIUS
	) {
		throw new Error(
			`Outdoor shadow PCF radius must be an integer from 0 through ${MAX_OUTDOOR_PSSM_PCF_RADIUS}.`,
		);
	}
	finiteRange(
		settings.strength,
		0,
		1,
		true,
		"Outdoor shadow strength must be finite and within [0, 1].",
	);
	return settings;
}

/** Validate and retain the projection caps consumed by all outdoor entity shadows. */
export function createOutdoorShadowProjectionSettings(
	settings: OutdoorShadowProjectionSettings,
): OutdoorShadowProjectionSettings {
	finiteRange(
		settings.minimumLightElevationDegrees,
		0,
		90,
		true,
		"Outdoor shadow minimum light elevation must be finite and within [0, 90] degrees.",
	);
	finiteRange(
		settings.maximumCasterHeight,
		0,
		64,
		false,
		"Outdoor shadow maximum caster height must be finite and in (0, 64].",
	);
	finiteRange(
		settings.maximumCastLength,
		0,
		512,
		false,
		"Outdoor shadow maximum cast length must be finite and in (0, 512].",
	);
	return settings;
}

/** Validate and retain one complete analytic-grounding policy. */
export function createIndoorGroundingSettings(
	settings: IndoorGroundingSettings,
): IndoorGroundingSettings {
	finiteRange(
		settings.strength,
		0,
		1,
		true,
		"Entity grounding strength must be finite and within [0, 1].",
	);
	finiteRange(
		settings.radiusScale,
		0.1,
		4,
		true,
		"Entity grounding radius scale must be finite and within [0.1, 4].",
	);
	finiteRange(
		settings.softness,
		0,
		1,
		false,
		"Entity grounding softness must be finite and in (0, 1].",
	);
	finiteRange(
		settings.dropSpread,
		0,
		2,
		true,
		"Entity grounding drop spread must be finite and within [0, 2].",
	);
	finiteRange(
		settings.maximumDrop,
		0,
		16,
		false,
		"Entity grounding maximum drop must be finite and in (0, 16].",
	);
	finiteRange(
		settings.minimumUpFacing,
		0,
		1,
		true,
		"Entity grounding minimum up-facing threshold must be finite and within [0, 1].",
	);
	finiteRange(
		settings.fullStrengthUpFacing,
		0,
		1,
		false,
		"Entity grounding full-strength up-facing threshold must be finite and in (0, 1].",
	);
	if (settings.fullStrengthUpFacing <= settings.minimumUpFacing) {
		throw new Error(
			"Entity grounding up-facing thresholds must be strictly ordered.",
		);
	}
	finiteRange(
		settings.contactBias,
		0,
		1,
		true,
		"Entity grounding contact bias must be finite and within [0, 1].",
	);
	return settings;
}

/** Validate and retain the complete terrain-only analytic shadow policy. */
export function createOutdoorDirectionalShadowSettings(
	settings: OutdoorDirectionalShadowSettings,
): OutdoorDirectionalShadowSettings {
	finiteRange(
		settings.strength,
		0,
		1,
		true,
		"Outdoor shadow strength must be within [0, 1].",
	);
	finiteRange(
		settings.radiusScale,
		0.1,
		4,
		true,
		"Outdoor shadow radius scale must be within [0.1, 4].",
	);
	finiteRange(
		settings.softness,
		0,
		1,
		false,
		"Outdoor shadow softness must be within (0, 1].",
	);
	finiteRange(
		settings.maximumReceiverDrop,
		0,
		16,
		false,
		"Outdoor shadow maximum receiver drop must be within (0, 16].",
	);
	finiteRange(
		settings.minimumUpFacing,
		0,
		1,
		true,
		"Outdoor shadow minimum up-facing must be within [0, 1].",
	);
	finiteRange(
		settings.fullStrengthUpFacing,
		0,
		1,
		false,
		"Outdoor shadow full-strength up-facing must be within (0, 1].",
	);
	if (settings.fullStrengthUpFacing <= settings.minimumUpFacing) {
		throw new Error(
			"Outdoor shadow up-facing thresholds must be strictly ordered.",
		);
	}
	finiteRange(
		settings.contactBias,
		0,
		1,
		true,
		"Outdoor shadow contact bias must be within [0, 1].",
	);
	finiteRange(
		settings.tailStrength,
		0,
		1,
		true,
		"Outdoor shadow tail strength must be within [0, 1].",
	);
	return settings;
}

/** Validate one complete settings value before renderer resource or shader code consumes it. */
export function createEntityShadowSettings(
	settings: EntityShadowSettings,
): EntityShadowSettings {
	if (!ENTITY_SHADOW_MODES.includes(settings.mode)) {
		throw new Error("Entity shadow mode must be none, simple, or shadow-maps.");
	}
	createOutdoorShadowCasterBudget(settings.casterBudget);
	createOutdoorPssmSettings(settings.pssm);
	createOutdoorShadowProjectionSettings(settings.projection);
	createIndoorGroundingSettings(settings.indoorGrounding);
	createOutdoorDirectionalShadowSettings(settings.outdoorDirectional);
	return settings;
}

function finiteRange(
	value: number,
	minimum: number,
	maximum: number,
	minimumInclusive: boolean,
	message: string,
): void {
	if (
		!Number.isFinite(value) ||
		(minimumInclusive ? value < minimum : value <= minimum) ||
		value > maximum
	) {
		throw new Error(message);
	}
}

const tuning = SHARED_FRONTEND_TUNING.rendering.entityShadows;

/** Validated default-hybrid entity-shadow settings used by every frontend composition. */
export const DEFAULT_ENTITY_SHADOW_SETTINGS = createEntityShadowSettings({
	mode: tuning.defaultMode,
	casterBudget: createOutdoorShadowCasterBudget(tuning.casterBudget),
	pssm: createOutdoorPssmSettings(tuning.pssm),
	projection: createOutdoorShadowProjectionSettings(tuning.projection),
	indoorGrounding: createIndoorGroundingSettings(tuning.indoorGrounding),
	outdoorDirectional: createOutdoorDirectionalShadowSettings(
		tuning.outdoorDirectional,
	),
});
