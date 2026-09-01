import { requireWebGL2Uniform } from "../webgl/shader-program";
import type { OutdoorDirectionalShadowSettings } from "./entity-shadow-policy";
import type { OutdoorDirectionalShadowSelection } from "./entity-grounding";
import { MAX_ENTITY_ANALYTIC_SHADOW_CASTERS_PER_RECEIVER } from "./entity-shadow-policy";

/** Terrain-only capsule evaluator compiled into directional and hybrid receiver variants. */
export const WEBGL2_OUTDOOR_DIRECTIONAL_SHADOW_GLSL = `
const int MAX_OUTDOOR_DIRECTIONAL_SHADOW_CASTERS = ${MAX_ENTITY_ANALYTIC_SHADOW_CASTERS_PER_RECEIVER};
uniform int uOutdoorDirectionalShadowCasterCount;
uniform vec4 uOutdoorDirectionalShadowAnchorsAndRadii[MAX_OUTDOOR_DIRECTIONAL_SHADOW_CASTERS];
uniform vec2 uOutdoorDirectionalShadowProjectedEnds[MAX_OUTDOOR_DIRECTIONAL_SHADOW_CASTERS];
uniform float uOutdoorDirectionalShadowStrength;
uniform float uOutdoorDirectionalShadowRadiusScale;
uniform float uOutdoorDirectionalShadowSoftness;
uniform float uOutdoorDirectionalShadowMaximumReceiverDrop;
uniform float uOutdoorDirectionalShadowMinimumUpFacing;
uniform float uOutdoorDirectionalShadowFullStrengthUpFacing;
uniform float uOutdoorDirectionalShadowContactBias;
uniform float uOutdoorDirectionalShadowTailStrength;

float evaluateOutdoorDirectionalShadowVisibility(
	vec3 receiverPosition,
	float receiverUpFacing
) {
	float upWeight = smoothstep(
		uOutdoorDirectionalShadowMinimumUpFacing,
		uOutdoorDirectionalShadowFullStrengthUpFacing,
		receiverUpFacing
	);
	if (uOutdoorDirectionalShadowCasterCount == 0 || upWeight <= 0.0) return 1.0;
	float strongest = 0.0;
	for (int index = 0; index < MAX_OUTDOOR_DIRECTIONAL_SHADOW_CASTERS; index += 1) {
		if (index >= uOutdoorDirectionalShadowCasterCount) break;
		vec4 caster = uOutdoorDirectionalShadowAnchorsAndRadii[index];
		float drop = caster.y - receiverPosition.y
			+ uOutdoorDirectionalShadowContactBias;
		if (drop < 0.0 || drop > uOutdoorDirectionalShadowMaximumReceiverDrop) continue;
		vec2 start = caster.xz;
		vec2 segment = uOutdoorDirectionalShadowProjectedEnds[index] - start;
		vec2 fromStart = receiverPosition.xz - start;
		float along = clamp(
			dot(fromStart, segment) / max(dot(segment, segment), 0.000001),
			0.0,
			1.0
		);
		vec2 nearest = start + segment * along;
		float radius = caster.w * uOutdoorDirectionalShadowRadiusScale;
		float outerSquared = radius * radius;
		vec2 separation = receiverPosition.xz - nearest;
		float distanceSquared = dot(separation, separation);
		if (distanceSquared >= outerSquared) continue;
		float innerRadius = radius * (1.0 - uOutdoorDirectionalShadowSoftness);
		float radial = 1.0 - smoothstep(
			innerRadius * innerRadius,
			outerSquared,
			distanceSquared
		);
		float dropWeight = 1.0 - drop / uOutdoorDirectionalShadowMaximumReceiverDrop;
		float tailWeight = mix(
			1.0,
			uOutdoorDirectionalShadowTailStrength,
			smoothstep(0.5, 1.0, along)
		);
		strongest = max(strongest, radial * dropWeight * tailWeight);
	}
	return 1.0 - strongest * upWeight * uOutdoorDirectionalShadowStrength;
}
`;

/** Typed locations owned only by terrain programs with directional analytic shadows. */
export interface WebGL2OutdoorDirectionalShadowUniforms {
	readonly anchorsAndRadii: WebGLUniformLocation;
	readonly casterCount: WebGLUniformLocation;
	readonly contactBias: WebGLUniformLocation;
	readonly fullStrengthUpFacing: WebGLUniformLocation;
	readonly maximumReceiverDrop: WebGLUniformLocation;
	readonly minimumUpFacing: WebGLUniformLocation;
	readonly projectedEnds: WebGLUniformLocation;
	readonly radiusScale: WebGLUniformLocation;
	readonly softness: WebGLUniformLocation;
	readonly strength: WebGLUniformLocation;
	readonly tailStrength: WebGLUniformLocation;
}

export function requireWebGL2OutdoorDirectionalShadowUniforms(
	gl: WebGL2RenderingContext,
	program: WebGLProgram,
): WebGL2OutdoorDirectionalShadowUniforms {
	return {
		anchorsAndRadii: requireWebGL2Uniform(
			gl,
			program,
			"uOutdoorDirectionalShadowAnchorsAndRadii[0]",
		),
		casterCount: requireWebGL2Uniform(
			gl,
			program,
			"uOutdoorDirectionalShadowCasterCount",
		),
		contactBias: requireWebGL2Uniform(
			gl,
			program,
			"uOutdoorDirectionalShadowContactBias",
		),
		fullStrengthUpFacing: requireWebGL2Uniform(
			gl,
			program,
			"uOutdoorDirectionalShadowFullStrengthUpFacing",
		),
		maximumReceiverDrop: requireWebGL2Uniform(
			gl,
			program,
			"uOutdoorDirectionalShadowMaximumReceiverDrop",
		),
		minimumUpFacing: requireWebGL2Uniform(
			gl,
			program,
			"uOutdoorDirectionalShadowMinimumUpFacing",
		),
		projectedEnds: requireWebGL2Uniform(
			gl,
			program,
			"uOutdoorDirectionalShadowProjectedEnds[0]",
		),
		radiusScale: requireWebGL2Uniform(
			gl,
			program,
			"uOutdoorDirectionalShadowRadiusScale",
		),
		softness: requireWebGL2Uniform(
			gl,
			program,
			"uOutdoorDirectionalShadowSoftness",
		),
		strength: requireWebGL2Uniform(
			gl,
			program,
			"uOutdoorDirectionalShadowStrength",
		),
		tailStrength: requireWebGL2Uniform(
			gl,
			program,
			"uOutdoorDirectionalShadowTailStrength",
		),
	};
}

/** Bind one terrain receiver's bounded capsule set. */
export function bindWebGL2OutdoorDirectionalShadowUniforms(
	gl: WebGL2RenderingContext,
	uniforms: WebGL2OutdoorDirectionalShadowUniforms,
	selection: OutdoorDirectionalShadowSelection,
	settings: OutdoorDirectionalShadowSettings,
): void {
	gl.uniform1i(uniforms.casterCount, selection.count);
	if (selection.count === 0) return;
	gl.uniform4fv(uniforms.anchorsAndRadii, selection.anchorsAndRadii);
	gl.uniform2fv(uniforms.projectedEnds, selection.projectedEnds);
	gl.uniform1f(uniforms.strength, settings.strength);
	gl.uniform1f(uniforms.radiusScale, settings.radiusScale);
	gl.uniform1f(uniforms.softness, settings.softness);
	gl.uniform1f(uniforms.maximumReceiverDrop, settings.maximumReceiverDrop);
	gl.uniform1f(uniforms.minimumUpFacing, settings.minimumUpFacing);
	gl.uniform1f(uniforms.fullStrengthUpFacing, settings.fullStrengthUpFacing);
	gl.uniform1f(uniforms.contactBias, settings.contactBias);
	gl.uniform1f(uniforms.tailStrength, settings.tailStrength);
}
