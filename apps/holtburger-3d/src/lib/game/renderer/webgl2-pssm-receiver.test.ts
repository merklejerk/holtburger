import { describe, expect, it } from "vitest";
import { Quat, Vec3 } from "../math/types";
import { DEFAULT_ENTITY_SHADOW_SETTINGS } from "./entity-shadow-policy";
import {
	buildOutdoorPssmCascades,
	resolveOutdoorShadowProjection,
} from "./outdoor-pssm";
import type { ActiveOutdoorPssmFrame } from "./webgl2-outdoor-pssm-pass";
import {
	bindWebGL2OutdoorPssmUniforms,
	createWebGL2OutdoorPssmUniformScratch,
	OUTDOOR_PSSM_TEXTURE_UNIT,
	WEBGL2_OUTDOOR_PSSM_GLSL,
	type WebGL2OutdoorPssmUniforms,
} from "./webgl2-pssm-receiver";

describe("outdoor PSSM receiver GLSL", () => {
	it("uses bounded PCF, camera-depth selection, and adjacent-cascade blending", () => {
		expect(WEBGL2_OUTDOOR_PSSM_GLSL).toContain(
			"uniform highp sampler2DArrayShadow uOutdoorPssmDepth",
		);
		expect(WEBGL2_OUTDOOR_PSSM_GLSL).toContain(
			"for (int y = -2; y <= 2; y += 1)",
		);
		expect(WEBGL2_OUTDOOR_PSSM_GLSL).toContain(
			"cameraForwardDepth > uOutdoorPssmSplitFar[index]",
		);
		expect(WEBGL2_OUTDOOR_PSSM_GLSL).toContain(
			"sampleOutdoorPssmCascade(cascade + 1",
		);
		expect(WEBGL2_OUTDOOR_PSSM_GLSL).toContain(
			"return mix(1.0, visibility, uOutdoorPssmStrength)",
		);
	});
});

describe("bindWebGL2OutdoorPssmUniforms", () => {
	it("uploads only live cascades into reusable fixed staging", () => {
		const settings = {
			...DEFAULT_ENTITY_SHADOW_SETTINGS.pssm,
			cascadeCount: 2,
			mapResolution: 512,
			maximumDistance: 64,
		};
		const cascades = buildOutdoorPssmCascades({
			camera: {
				aspectRatio: 1,
				far: 128,
				near: 1,
				position: Vec3.zero(),
				rotation: Quat.identity(),
				verticalFovDegrees: 60,
			},
			settings,
			projection: resolveOutdoorShadowProjection(
				new Vec3(0, 1, 0),
				DEFAULT_ENTITY_SHADOW_SETTINGS.projection,
			),
		});
		const frame: ActiveOutdoorPssmFrame = {
			cascades,
			instanceUploads: { bytes: 0, count: 0 },
			settings,
			targets: {
				cascadeCount: 2,
				depth: {} as WebGLTexture,
				framebuffer: {} as WebGLFramebuffer,
				resolution: 512,
			},
		};
		const calls: string[] = [];
		const gl = {
			uniform1f: (location: Location, value: number) =>
				calls.push(`${location.name}:${value}`),
			uniform1fv: (
				location: Location,
				_values: Float32Array,
				_offset: number,
				length: number,
			) => calls.push(`${location.name}:length=${length}`),
			uniform1i: (location: Location, value: number) =>
				calls.push(`${location.name}:${value}`),
			uniformMatrix4fv: (
				location: Location,
				_transpose: boolean,
				_values: Float32Array,
				_offset: number,
				length: number,
			) => calls.push(`${location.name}:length=${length}`),
		} as unknown as WebGL2RenderingContext;
		const uniforms = receiverUniforms();
		const scratch = createWebGL2OutdoorPssmUniformScratch();

		bindWebGL2OutdoorPssmUniforms(gl, uniforms, frame, scratch);

		expect(calls).toEqual([
			`depth:${OUTDOOR_PSSM_TEXTURE_UNIT}`,
			"cascadeCount:2",
			"lightClip:length=32",
			"splitFar:length=2",
			"transitionStart:length=2",
			"texelSize:0.001953125",
			`receiverDepthBias:${settings.receiverDepthBias}`,
			`normalOffsetBias:${settings.normalOffsetBias}`,
			`pcfRadius:${settings.pcfRadius}`,
			`strength:${settings.strength}`,
		]);
		expect(scratch.splitFar[0]).toBeCloseTo(cascades[0]!.splitFar);
		expect(scratch.splitFar[1]).toBeCloseTo(cascades[1]!.splitFar);
	});
});

interface Location extends WebGLUniformLocation {
	readonly name: string;
}

function receiverUniforms(): WebGL2OutdoorPssmUniforms {
	const location = (name: string): Location => ({ name }) as Location;
	return {
		cascadeCount: location("cascadeCount"),
		depth: location("depth"),
		lightClip: location("lightClip"),
		normalOffsetBias: location("normalOffsetBias"),
		pcfRadius: location("pcfRadius"),
		receiverDepthBias: location("receiverDepthBias"),
		splitFar: location("splitFar"),
		strength: location("strength"),
		texelSize: location("texelSize"),
		transitionStart: location("transitionStart"),
	};
}
