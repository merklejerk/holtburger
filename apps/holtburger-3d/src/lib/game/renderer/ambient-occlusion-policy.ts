import { FRONTEND_TUNING } from "../../frontend-tuning";

declare const ambientOcclusionDistanceFadeBrand: unique symbol;

/** Validated camera-distance interval over which ambient occlusion becomes neutral. */
export interface AmbientOcclusionDistanceFade {
	readonly fullStrengthUntil: number;
	readonly disabledAt: number;
	readonly [ambientOcclusionDistanceFadeBrand]: true;
}

/** User-tunable SAO values that can change without rebuilding GPU resources. */
export interface AmbientOcclusionParameters {
	/** World-space neighborhood radius sampled around each receiving surface. */
	readonly sampleRadius: number;
	/** Minimum view-space separation required before a sample can occlude. */
	readonly bias: number;
	/** Strength applied to accumulated obscurance before composition. */
	readonly intensity: number;
	/** View-space depth separation at which bilateral neighbors stop contributing. */
	readonly bilateralDepthThreshold: number;
}

/** Complete optional AO presentation choice snapshotted with every frame. */
export interface AmbientOcclusionSettings {
	readonly enabled: boolean;
	readonly parameters: AmbientOcclusionParameters;
}

/** Per-frame ambient-occlusion policy after user enablement is resolved. */
export type EffectiveAmbientOcclusionPolicy =
	| { readonly kind: "disabled" }
	| {
			readonly kind: "enabled";
			/** Validated user values retained without per-frame copying. */
			readonly parameters: AmbientOcclusionParameters;
			/** Renderer-owned near-field fade shared by every enabled frame. */
			readonly distanceFade: AmbientOcclusionDistanceFade;
	  };

const DISABLED_AMBIENT_OCCLUSION_POLICY = { kind: "disabled" } as const;

/** Largest fixed kernel accepted by the first-version SAO shader contract. */
const MAX_AMBIENT_OCCLUSION_SAMPLE_COUNT = 32;

/** Validate shader and allocation tuning together before any WebGL resource is created. */
function validateAmbientOcclusionResourceTuning(
	tuning: typeof FRONTEND_TUNING.rendering.ambientOcclusion,
): void {
	if (
		!Number.isFinite(tuning.resolutionScale) ||
		tuning.resolutionScale <= 0 ||
		tuning.resolutionScale > 1
	) {
		throw new Error(
			"Ambient-occlusion resolution scale must be finite and in (0, 1].",
		);
	}
	createAmbientOcclusionParameters({
		sampleRadius: tuning.sampleRadius,
		bias: tuning.bias,
		intensity: tuning.intensity,
		bilateralDepthThreshold: tuning.bilateralDepthThreshold,
	});
	createAmbientOcclusionDistanceFade(
		tuning.distanceFade.fullStrengthUntil,
		tuning.distanceFade.disabledAt,
	);
	createAmbientOcclusionSampleKernel(tuning.sampleCount);
}

/** Validate and retain one complete runtime-adjustable SAO parameter set. */
export function createAmbientOcclusionParameters(
	parameters: AmbientOcclusionParameters,
): AmbientOcclusionParameters {
	if (
		!Number.isFinite(parameters.sampleRadius) ||
		parameters.sampleRadius <= 0
	) {
		throw new Error(
			"Ambient-occlusion sample radius must be finite and positive.",
		);
	}
	if (
		!Number.isFinite(parameters.bias) ||
		parameters.bias < 0 ||
		parameters.bias >= parameters.sampleRadius
	) {
		throw new Error(
			"Ambient-occlusion bias must be finite, non-negative, and smaller than the sample radius.",
		);
	}
	if (!Number.isFinite(parameters.intensity) || parameters.intensity < 0) {
		throw new Error(
			"Ambient-occlusion intensity must be finite and non-negative.",
		);
	}
	if (
		!Number.isFinite(parameters.bilateralDepthThreshold) ||
		parameters.bilateralDepthThreshold <= 0
	) {
		throw new Error(
			"Ambient-occlusion bilateral depth threshold must be finite and positive.",
		);
	}
	return parameters;
}

/** Create a non-empty finite ambient-occlusion distance fade. */
export function createAmbientOcclusionDistanceFade(
	fullStrengthUntil: number,
	disabledAt: number,
): AmbientOcclusionDistanceFade {
	validateAmbientOcclusionDistanceFade(fullStrengthUntil, disabledAt);
	return {
		fullStrengthUntil,
		disabledAt,
	} as AmbientOcclusionDistanceFade;
}

/** Validate distance-fade scalars without allocating during per-frame policy resolution. */
function validateAmbientOcclusionDistanceFade(
	fullStrengthUntil: number,
	disabledAt: number,
): void {
	if (
		!Number.isFinite(fullStrengthUntil) ||
		!Number.isFinite(disabledAt) ||
		fullStrengthUntil < 0 ||
		disabledAt <= fullStrengthUntil
	) {
		throw new Error(
			"Ambient-occlusion distance fade requires finite non-negative bounds with disabledAt greater than fullStrengthUntil.",
		);
	}
}

/** Resolve the one effective near-field policy consumed by rendering and diagnostics. */
export function resolveEffectiveAmbientOcclusionPolicy(
	settings: AmbientOcclusionSettings,
	distanceFade: AmbientOcclusionDistanceFade,
): EffectiveAmbientOcclusionPolicy {
	const parameters = createAmbientOcclusionParameters(settings.parameters);
	if (!settings.enabled) return DISABLED_AMBIENT_OCCLUSION_POLICY;
	return {
		kind: "enabled",
		parameters,
		distanceFade,
	};
}

/** Reconstruct positive camera distance from a WebGL depth-buffer sample. */
export function linearizeWebGLDepth(
	depth: number,
	near: number,
	far: number,
): number {
	if (
		!Number.isFinite(depth) ||
		depth < 0 ||
		depth > 1 ||
		!Number.isFinite(near) ||
		!Number.isFinite(far) ||
		near <= 0 ||
		far <= near
	) {
		throw new Error(
			"WebGL depth linearization requires depth in [0, 1] and a finite non-empty camera range.",
		);
	}
	const normalizedDeviceDepth = depth * 2 - 1;
	return (2 * near * far) / (far + near - normalizedDeviceDepth * (far - near));
}

/** Return the smooth near-field contribution in [0, 1] for a linear camera distance. */
export function ambientOcclusionDistanceWeight(
	distance: number,
	fade: AmbientOcclusionDistanceFade,
): number {
	if (!Number.isFinite(distance) || distance < 0) {
		throw new Error(
			"Ambient-occlusion distance weighting requires a finite non-negative distance.",
		);
	}
	if (distance <= fade.fullStrengthUntil) return 1;
	if (distance >= fade.disabledAt) return 0;
	const ratio =
		(distance - fade.fullStrengthUntil) /
		(fade.disabledAt - fade.fullStrengthUntil);
	const smoothRatio = ratio * ratio * (3 - 2 * ratio);
	return 1 - smoothRatio;
}

/** Build the fixed concentric spiral sampled by the first-version SAO pass. */
export function createAmbientOcclusionSampleKernel(
	sampleCount: number,
): Float32Array {
	if (
		!Number.isInteger(sampleCount) ||
		sampleCount <= 0 ||
		sampleCount > MAX_AMBIENT_OCCLUSION_SAMPLE_COUNT
	) {
		throw new Error(
			`Ambient-occlusion sample count must be an integer from 1 through ${MAX_AMBIENT_OCCLUSION_SAMPLE_COUNT}.`,
		);
	}
	const kernel = new Float32Array(sampleCount * 2);
	const goldenAngle = Math.PI * (3 - Math.sqrt(5));
	for (let index = 0; index < sampleCount; index += 1) {
		const radius = Math.sqrt((index + 0.5) / sampleCount);
		const angle = index * goldenAngle;
		kernel[index * 2] = Math.cos(angle) * radius;
		kernel[index * 2 + 1] = Math.sin(angle) * radius;
	}
	return kernel;
}

const tuning = FRONTEND_TUNING.rendering.ambientOcclusion;
validateAmbientOcclusionResourceTuning(tuning);

/** Validated configured fade shared by every frame until frontend tuning changes. */
export const DEFAULT_AMBIENT_OCCLUSION_PARAMETERS =
	createAmbientOcclusionParameters({
		sampleRadius: tuning.sampleRadius,
		bias: tuning.bias,
		intensity: tuning.intensity,
		bilateralDepthThreshold: tuning.bilateralDepthThreshold,
	});

/** Validated renderer-owned near-field fade shared by every enabled frame. */
export const AMBIENT_OCCLUSION_DISTANCE_FADE =
	createAmbientOcclusionDistanceFade(
		tuning.distanceFade.fullStrengthUntil,
		tuning.distanceFade.disabledAt,
	);

/** Fixed spatial kernel shared by flat and portal SAO evaluation. */
export const AMBIENT_OCCLUSION_SAMPLE_KERNEL =
	createAmbientOcclusionSampleKernel(tuning.sampleCount);
