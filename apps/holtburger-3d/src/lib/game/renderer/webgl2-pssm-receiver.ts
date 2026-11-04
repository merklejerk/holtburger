import { writeMat4ToFloat32Array } from "../math/matrices";
import { requireWebGL2Uniform } from "../webgl/shader-program";
import {
	MAX_OUTDOOR_PSSM_CASCADES,
	MAX_OUTDOOR_PSSM_PCF_RADIUS,
} from "./entity-shadow-policy";
import type { ActiveOutdoorPssmFrame } from "./webgl2-outdoor-pssm-pass";

/** Reserved beyond terrain's seven live units and object's three material units. */
export const OUTDOOR_PSSM_TEXTURE_UNIT = 7;

/** Bounded fragment-stage directional shadow lookup shared by eligible receiver variants. */
export const WEBGL2_OUTDOOR_PSSM_GLSL = `
uniform highp sampler2DArrayShadow uOutdoorPssmDepth;
uniform mat4 uOutdoorPssmLightClip[${MAX_OUTDOOR_PSSM_CASCADES}];
uniform float uOutdoorPssmSplitFar[${MAX_OUTDOOR_PSSM_CASCADES}];
uniform float uOutdoorPssmTransitionStart[${MAX_OUTDOOR_PSSM_CASCADES}];
uniform int uOutdoorPssmCascadeCount;
uniform float uOutdoorPssmTexelSize;
uniform float uOutdoorPssmReceiverDepthBias;
uniform float uOutdoorPssmNormalOffsetBias;
uniform int uOutdoorPssmPcfRadius;
uniform float uOutdoorPssmStrength;

vec3 outdoorPssmSafeNormal(vec3 normal) {
	float lengthSquared = dot(normal, normal);
	return lengthSquared > 0.0 ? normal * inversesqrt(lengthSquared) : vec3(0.0);
}

float sampleOutdoorPssmCascade(int cascade, vec3 receiverPosition, vec3 receiverNormal) {
	vec3 offsetPosition = receiverPosition
		+ outdoorPssmSafeNormal(receiverNormal) * uOutdoorPssmNormalOffsetBias;
	vec4 lightClip = uOutdoorPssmLightClip[cascade] * vec4(offsetPosition, 1.0);
	vec3 coordinate = lightClip.xyz / lightClip.w * 0.5 + 0.5;
	if (
		coordinate.x <= 0.0 || coordinate.x >= 1.0
		|| coordinate.y <= 0.0 || coordinate.y >= 1.0
		|| coordinate.z <= 0.0 || coordinate.z >= 1.0
	) return 1.0;
	float referenceDepth = coordinate.z - uOutdoorPssmReceiverDepthBias;
	float visibility = 0.0;
	float sampleCount = 0.0;
	for (int y = -${MAX_OUTDOOR_PSSM_PCF_RADIUS}; y <= ${MAX_OUTDOOR_PSSM_PCF_RADIUS}; y += 1) {
		for (int x = -${MAX_OUTDOOR_PSSM_PCF_RADIUS}; x <= ${MAX_OUTDOOR_PSSM_PCF_RADIUS}; x += 1) {
			if (abs(x) > uOutdoorPssmPcfRadius || abs(y) > uOutdoorPssmPcfRadius) continue;
			vec2 offset = vec2(float(x), float(y)) * uOutdoorPssmTexelSize;
			visibility += texture(
				uOutdoorPssmDepth,
				vec4(coordinate.xy + offset, float(cascade), referenceDepth)
			);
			sampleCount += 1.0;
		}
	}
	return visibility / sampleCount;
}

float evaluateOutdoorPssmVisibility(
	float cameraForwardDepth,
	vec3 receiverPosition,
	vec3 receiverNormal
) {
	if (
		cameraForwardDepth < 0.0
		|| cameraForwardDepth > uOutdoorPssmSplitFar[uOutdoorPssmCascadeCount - 1]
	) return 1.0;
	int cascade = 0;
	for (int index = 0; index < ${MAX_OUTDOOR_PSSM_CASCADES - 1}; index += 1) {
		if (index + 1 < uOutdoorPssmCascadeCount && cameraForwardDepth > uOutdoorPssmSplitFar[index]) {
			cascade = index + 1;
		}
	}
	float visibility = sampleOutdoorPssmCascade(
		cascade,
		receiverPosition,
		receiverNormal
	);
	if (
		cascade + 1 < uOutdoorPssmCascadeCount
		&& cameraForwardDepth >= uOutdoorPssmTransitionStart[cascade]
	) {
		float transition = clamp(
			(cameraForwardDepth - uOutdoorPssmTransitionStart[cascade])
				/ max(
					uOutdoorPssmSplitFar[cascade] - uOutdoorPssmTransitionStart[cascade],
					0.000001
				),
			0.0,
			1.0
		);
		visibility = mix(
			visibility,
			sampleOutdoorPssmCascade(cascade + 1, receiverPosition, receiverNormal),
			transition
		);
	}
	return mix(1.0, visibility, uOutdoorPssmStrength);
}
`;

/** Complete uniform contract compiled into one outdoor receiver program. */
export interface WebGL2OutdoorPssmUniforms {
	readonly cascadeCount: WebGLUniformLocation;
	readonly depth: WebGLUniformLocation;
	readonly lightClip: WebGLUniformLocation;
	readonly normalOffsetBias: WebGLUniformLocation;
	readonly pcfRadius: WebGLUniformLocation;
	readonly receiverDepthBias: WebGLUniformLocation;
	readonly splitFar: WebGLUniformLocation;
	readonly strength: WebGLUniformLocation;
	readonly texelSize: WebGLUniformLocation;
	readonly transitionStart: WebGLUniformLocation;
}

/** Reusable typed-array staging for one receiver-program activation. */
export interface WebGL2OutdoorPssmUniformScratch {
	readonly lightClip: Float32Array;
	readonly splitFar: Float32Array;
	readonly transitionStart: Float32Array;
}

export function createWebGL2OutdoorPssmUniformScratch(): WebGL2OutdoorPssmUniformScratch {
	return {
		lightClip: new Float32Array(MAX_OUTDOOR_PSSM_CASCADES * 16),
		splitFar: new Float32Array(MAX_OUTDOOR_PSSM_CASCADES),
		transitionStart: new Float32Array(MAX_OUTDOOR_PSSM_CASCADES),
	};
}

/** Resolve every required location from one linked receiver variant. */
export function requireWebGL2OutdoorPssmUniforms(
	gl: WebGL2RenderingContext,
	program: WebGLProgram,
): WebGL2OutdoorPssmUniforms {
	return {
		cascadeCount: requireWebGL2Uniform(gl, program, "uOutdoorPssmCascadeCount"),
		depth: requireWebGL2Uniform(gl, program, "uOutdoorPssmDepth"),
		lightClip: requireWebGL2Uniform(gl, program, "uOutdoorPssmLightClip[0]"),
		normalOffsetBias: requireWebGL2Uniform(
			gl,
			program,
			"uOutdoorPssmNormalOffsetBias",
		),
		pcfRadius: requireWebGL2Uniform(gl, program, "uOutdoorPssmPcfRadius"),
		receiverDepthBias: requireWebGL2Uniform(
			gl,
			program,
			"uOutdoorPssmReceiverDepthBias",
		),
		splitFar: requireWebGL2Uniform(gl, program, "uOutdoorPssmSplitFar[0]"),
		strength: requireWebGL2Uniform(gl, program, "uOutdoorPssmStrength"),
		texelSize: requireWebGL2Uniform(gl, program, "uOutdoorPssmTexelSize"),
		transitionStart: requireWebGL2Uniform(
			gl,
			program,
			"uOutdoorPssmTransitionStart[0]",
		),
	};
}

/** Upload one active view's complete cascade contract, excluding physical texture binding. */
export function bindWebGL2OutdoorPssmUniforms(
	gl: WebGL2RenderingContext,
	uniforms: WebGL2OutdoorPssmUniforms,
	frame: ActiveOutdoorPssmFrame,
	scratch: WebGL2OutdoorPssmUniformScratch,
): void {
	const count = frame.cascades.length;
	for (let index = 0; index < count; index += 1) {
		const cascade = frame.cascades[index]!;
		writeMat4ToFloat32Array(cascade.lightClip, scratch.lightClip, index * 16);
		scratch.splitFar[index] = cascade.splitFar;
		scratch.transitionStart[index] = cascade.transitionStart;
	}
	gl.uniform1i(uniforms.depth, OUTDOOR_PSSM_TEXTURE_UNIT);
	gl.uniform1i(uniforms.cascadeCount, count);
	gl.uniformMatrix4fv(
		uniforms.lightClip,
		false,
		scratch.lightClip,
		0,
		count * 16,
	);
	gl.uniform1fv(uniforms.splitFar, scratch.splitFar, 0, count);
	gl.uniform1fv(uniforms.transitionStart, scratch.transitionStart, 0, count);
	gl.uniform1f(uniforms.texelSize, 1 / frame.targets.resolution);
	gl.uniform1f(uniforms.receiverDepthBias, frame.settings.receiverDepthBias);
	gl.uniform1f(uniforms.normalOffsetBias, frame.settings.normalOffsetBias);
	gl.uniform1i(uniforms.pcfRadius, frame.settings.pcfRadius);
	gl.uniform1f(uniforms.strength, frame.settings.strength);
}
