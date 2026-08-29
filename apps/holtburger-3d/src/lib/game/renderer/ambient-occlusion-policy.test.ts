import { describe, expect, it } from "vitest";
import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";
import {
	AMBIENT_OCCLUSION_SAMPLE_KERNEL,
	AMBIENT_OCCLUSION_DISTANCE_FADE,
	DEFAULT_AMBIENT_OCCLUSION_PARAMETERS,
	ambientOcclusionDistanceWeight,
	createAmbientOcclusionDistanceFade,
	createAmbientOcclusionParameters,
	createAmbientOcclusionSampleKernel,
	linearizeWebGLDepth,
	resolveEffectiveAmbientOcclusionPolicy,
} from "./ambient-occlusion-policy";

const CAMERA_NEAR = 0.5;
const CAMERA_FAR = 2_000;
const MID_DEPTH_DISTANCE = 10;

function depthForLinearDistance(
	distance: number,
	near: number,
	far: number,
): number {
	const normalizedDeviceDepth =
		(far + near - (2 * near * far) / distance) / (far - near);
	return (normalizedDeviceDepth + 1) / 2;
}

describe("ambient occlusion policy", () => {
	const enabledSettings = {
		enabled: true,
		parameters: DEFAULT_AMBIENT_OCCLUSION_PARAMETERS,
	} as const;

	it("rejects invalid configured fade ranges", () => {
		expect(() => createAmbientOcclusionDistanceFade(1, 1)).toThrow(
			"disabledAt greater than fullStrengthUntil",
		);
		expect(() => createAmbientOcclusionDistanceFade(-1, 2)).toThrow(
			"finite non-negative bounds",
		);
	});

	it("retains the renderer-owned fade when enabled", () => {
		const policy = resolveEffectiveAmbientOcclusionPolicy(
			enabledSettings,
			AMBIENT_OCCLUSION_DISTANCE_FADE,
		);

		expect(policy).toEqual({
			kind: "enabled",
			parameters: DEFAULT_AMBIENT_OCCLUSION_PARAMETERS,
			distanceFade: AMBIENT_OCCLUSION_DISTANCE_FADE,
		});
		if (policy.kind !== "enabled") throw new Error("Expected enabled policy.");
		expect(policy.parameters).toBe(DEFAULT_AMBIENT_OCCLUSION_PARAMETERS);
	});

	it("disables AO only when the user setting is off", () => {
		const disabledBySetting = resolveEffectiveAmbientOcclusionPolicy(
			{ ...enabledSettings, enabled: false },
			AMBIENT_OCCLUSION_DISTANCE_FADE,
		);
		expect(disabledBySetting).toEqual({ kind: "disabled" });
	});

	it("linearizes WebGL depth at the camera planes and an interior distance", () => {
		expect(linearizeWebGLDepth(0, CAMERA_NEAR, CAMERA_FAR)).toBeCloseTo(
			CAMERA_NEAR,
		);
		expect(linearizeWebGLDepth(1, CAMERA_NEAR, CAMERA_FAR)).toBeCloseTo(
			CAMERA_FAR,
		);
		expect(
			linearizeWebGLDepth(
				depthForLinearDistance(MID_DEPTH_DISTANCE, CAMERA_NEAR, CAMERA_FAR),
				CAMERA_NEAR,
				CAMERA_FAR,
			),
		).toBeCloseTo(MID_DEPTH_DISTANCE);
	});

	it("weights the configured fade with a smooth neutral boundary", () => {
		const fade = AMBIENT_OCCLUSION_DISTANCE_FADE;
		const midpoint = (fade.fullStrengthUntil + fade.disabledAt) / 2;
		expect(ambientOcclusionDistanceWeight(0, fade)).toBe(1);
		expect(ambientOcclusionDistanceWeight(fade.fullStrengthUntil, fade)).toBe(
			1,
		);
		expect(ambientOcclusionDistanceWeight(midpoint, fade)).toBeCloseTo(0.5);
		expect(ambientOcclusionDistanceWeight(fade.disabledAt, fade)).toBe(0);
		expect(ambientOcclusionDistanceWeight(fade.disabledAt * 2, fade)).toBe(0);
	});

	it("rejects interdependent runtime parameters before rendering", () => {
		expect(() =>
			createAmbientOcclusionParameters({
				...DEFAULT_AMBIENT_OCCLUSION_PARAMETERS,
				bias: DEFAULT_AMBIENT_OCCLUSION_PARAMETERS.sampleRadius,
			}),
		).toThrow("smaller than the sample radius");
	});

	it("builds one deterministic bounded spatial kernel", () => {
		const sampleCount =
			SHARED_FRONTEND_TUNING.rendering.ambientOcclusion.sampleCount;
		const rebuilt = createAmbientOcclusionSampleKernel(sampleCount);
		expect(rebuilt).toEqual(AMBIENT_OCCLUSION_SAMPLE_KERNEL);
		expect(rebuilt).toHaveLength(sampleCount * 2);
		for (let index = 0; index < sampleCount; index += 1) {
			const x = rebuilt[index * 2]!;
			const y = rebuilt[index * 2 + 1]!;
			expect(Math.hypot(x, y)).toBeLessThanOrEqual(1);
		}
	});
});
