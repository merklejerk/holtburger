import { requireWebGL2Uniform } from "../webgl/shader-program";
import type { IndoorGroundingSettings } from "./entity-shadow-policy";
import { MAX_ENTITY_ANALYTIC_SHADOW_CASTERS_PER_RECEIVER } from "./entity-shadow-policy";
import type { EntityGroundingSelection } from "./entity-grounding";

const EMPTY_ENTITY_GROUNDING_UNIFORM_ATTEMPTS = 1;
const POPULATED_ENTITY_GROUNDING_UNIFORM_ATTEMPTS = 10;

/** Fixed analytic grounding evaluator compiled only into explicit receiver variants. */
export const WEBGL2_ENTITY_GROUNDING_GLSL = `
const int MAX_ENTITY_GROUNDING_CASTERS = ${MAX_ENTITY_ANALYTIC_SHADOW_CASTERS_PER_RECEIVER};
uniform int uGroundingCasterCount;
uniform vec4 uGroundingCasters[MAX_ENTITY_GROUNDING_CASTERS];
uniform float uGroundingStrength;
uniform float uGroundingRadiusScale;
uniform float uGroundingSoftness;
uniform float uGroundingDropSpread;
uniform float uGroundingMaximumDrop;
uniform float uGroundingMinimumUpFacing;
uniform float uGroundingFullStrengthUpFacing;
uniform float uGroundingContactBias;

float evaluateEntityGrounding(vec3 receiverPosition, float receiverUpFacing) {
	float upWeight = smoothstep(
		uGroundingMinimumUpFacing,
		uGroundingFullStrengthUpFacing,
		receiverUpFacing
	);
	if (uGroundingCasterCount == 0 || upWeight <= 0.0) return 0.0;
	float strongest = 0.0;
	for (int index = 0; index < MAX_ENTITY_GROUNDING_CASTERS; index += 1) {
		if (index >= uGroundingCasterCount) break;
		vec4 caster = uGroundingCasters[index];
		float drop = caster.y - receiverPosition.y + uGroundingContactBias;
		if (drop < 0.0 || drop > uGroundingMaximumDrop) continue;
		float dropRatio = drop / uGroundingMaximumDrop;
		float radius = caster.w * uGroundingRadiusScale
			* (1.0 + dropRatio * uGroundingDropSpread);
		float outerSquared = radius * radius;
		vec2 horizontal = receiverPosition.xz - caster.xz;
		float distanceSquared = dot(horizontal, horizontal);
		if (distanceSquared >= outerSquared) continue;
		float innerRadius = radius * (1.0 - uGroundingSoftness);
		float radial = 1.0 - smoothstep(
			innerRadius * innerRadius,
			outerSquared,
			distanceSquared
		);
		strongest = max(strongest, radial * (1.0 - dropRatio));
	}
	return strongest * upWeight * uGroundingStrength;
}
`;

/** Typed locations owned only by explicit analytic-grounding receiver programs. */
export interface WebGL2EntityGroundingUniforms {
	readonly casterCount: WebGLUniformLocation;
	readonly casters: WebGLUniformLocation;
	readonly contactBias: WebGLUniformLocation;
	readonly dropSpread: WebGLUniformLocation;
	readonly fullStrengthUpFacing: WebGLUniformLocation;
	readonly maximumDrop: WebGLUniformLocation;
	readonly minimumUpFacing: WebGLUniformLocation;
	readonly radiusScale: WebGLUniformLocation;
	readonly softness: WebGLUniformLocation;
	readonly strength: WebGLUniformLocation;
}

/** Minimal cached-uniform port implemented by the renderer device-state applicator. */
export interface WebGL2EntityGroundingUniformApplicator {
	applyUniform1f(location: WebGLUniformLocation, value: number): boolean;
	applyUniform1i(location: WebGLUniformLocation, value: number): boolean;
	applyUniform4fv(location: WebGLUniformLocation, value: Float32Array): boolean;
}

export function requireWebGL2EntityGroundingUniforms(
	gl: WebGL2RenderingContext,
	program: WebGLProgram,
): WebGL2EntityGroundingUniforms {
	return {
		casterCount: requireWebGL2Uniform(gl, program, "uGroundingCasterCount"),
		casters: requireWebGL2Uniform(gl, program, "uGroundingCasters[0]"),
		contactBias: requireWebGL2Uniform(gl, program, "uGroundingContactBias"),
		dropSpread: requireWebGL2Uniform(gl, program, "uGroundingDropSpread"),
		fullStrengthUpFacing: requireWebGL2Uniform(
			gl,
			program,
			"uGroundingFullStrengthUpFacing",
		),
		maximumDrop: requireWebGL2Uniform(gl, program, "uGroundingMaximumDrop"),
		minimumUpFacing: requireWebGL2Uniform(
			gl,
			program,
			"uGroundingMinimumUpFacing",
		),
		radiusScale: requireWebGL2Uniform(gl, program, "uGroundingRadiusScale"),
		softness: requireWebGL2Uniform(gl, program, "uGroundingSoftness"),
		strength: requireWebGL2Uniform(gl, program, "uGroundingStrength"),
	};
}

/** Apply one receiver record set and return the number of physical uniform writes issued. */
export function applyWebGL2EntityGroundingUniforms(
	state: WebGL2EntityGroundingUniformApplicator,
	uniforms: WebGL2EntityGroundingUniforms,
	selection: EntityGroundingSelection,
	settings: IndoorGroundingSettings,
): number {
	let issued = Number(
		state.applyUniform1i(uniforms.casterCount, selection.count),
	);
	if (selection.count === 0) return issued;
	issued += Number(state.applyUniform4fv(uniforms.casters, selection.records));
	issued += Number(state.applyUniform1f(uniforms.strength, settings.strength));
	issued += Number(
		state.applyUniform1f(uniforms.radiusScale, settings.radiusScale),
	);
	issued += Number(state.applyUniform1f(uniforms.softness, settings.softness));
	issued += Number(
		state.applyUniform1f(uniforms.dropSpread, settings.dropSpread),
	);
	issued += Number(
		state.applyUniform1f(uniforms.maximumDrop, settings.maximumDrop),
	);
	issued += Number(
		state.applyUniform1f(uniforms.minimumUpFacing, settings.minimumUpFacing),
	);
	issued += Number(
		state.applyUniform1f(
			uniforms.fullStrengthUpFacing,
			settings.fullStrengthUpFacing,
		),
	);
	issued += Number(
		state.applyUniform1f(uniforms.contactBias, settings.contactBias),
	);
	return issued;
}

/** Number of cacheable uniform applications made for one receiver selection. */
export function entityGroundingUniformAttemptCount(
	selection: Pick<EntityGroundingSelection, "count">,
): number {
	return selection.count === 0
		? EMPTY_ENTITY_GROUNDING_UNIFORM_ATTEMPTS
		: POPULATED_ENTITY_GROUNDING_UNIFORM_ATTEMPTS;
}
