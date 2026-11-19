import { PORTAL_SCOPE_ATLAS_TEXTURE_UNITS } from "./portal-scope-atlas-command-model";
import { PORTAL_ENVELOPE_SAMPLING_GLSL } from "./portal-envelope-sampling-glsl";
import {
	bindPortalScopeAtlasMetadataBlock,
	PORTAL_SCOPE_ATLAS_METADATA_BINDING_POINT,
	PORTAL_SCOPE_ATLAS_METADATA_GLSL,
} from "./portal-scope-atlas-metadata-glsl";
import { requireWebGL2Uniform } from "../../webgl/shader-program";

/** Draw-varying render-domain selector for one physical deferred submission. */
export interface WebGL2PortalDeferredVisibilityUniforms {
	readonly renderDomain: WebGLUniformLocation;
}

/**
 * Fragment-stage render-domain envelope predicate for transparent objects and scoped overlays.
 *
 * Opaque depth remains ordinary fixed-function depth testing. This predicate only answers whether
 * the fragment lies inside any admitted appearance of its owning domain and before that domain's
 * farthest admitted exit at the current pixel.
 */
const PORTAL_DEFERRED_VISIBILITY_BODY_GLSL = `
${PORTAL_SCOPE_ATLAS_METADATA_GLSL}
${PORTAL_ENVELOPE_SAMPLING_GLSL}
bool portalDeferredFragmentVisible(uint renderDomain) {
	PortalScopeMetadata scope = uScopes[renderDomain];
	ivec2 screenPixel = ivec2(gl_FragCoord.xy);
	ivec2 relativePixel = screenPixel - ivec2(scope.atlasAndScreenOrigin.zw);
	ivec2 scopeExtent = ivec2(scope.extentAndReserved.xy);
	if (any(lessThan(relativePixel, ivec2(0)))
		|| any(greaterThanEqual(relativePixel, scopeExtent))) {
		return false;
	}
	if (scope.extentAndReserved.z != 0u) {
		return true;
	}
	ivec2 atlasPixel = portalScopeAtlasPixel(scope, screenPixel);
	float envelopeDepth = portalEnvelopeDepthAtAtlasPixel(atlasPixel);
	return envelopeDepth == 1.0 || gl_FragCoord.z * 0.5 < envelopeDepth;
}
`;

/** Draw-uniform selector for ordinary transparent submissions. */
export const PORTAL_DEFERRED_VISIBILITY_GLSL = `
${PORTAL_DEFERRED_VISIBILITY_BODY_GLSL}
uniform uint uPortalRenderDomain;
bool portalDeferredFragmentVisible() {
	return portalDeferredFragmentVisible(uPortalRenderDomain);
}
`;

/** Per-instance selector for ordered scoped overlays sharing one physical draw. */
export const PORTAL_DEFERRED_VISIBILITY_INSTANCE_GLSL =
	PORTAL_DEFERRED_VISIBILITY_BODY_GLSL;

/** Bind the shared metadata and envelope sampler for an instance-routed program. */
export function bindWebGL2PortalDeferredVisibilityInstanceProgram(
	gl: WebGL2RenderingContext,
	program: WebGLProgram,
): void {
	bindPortalScopeAtlasMetadataBlock(
		gl,
		program,
		PORTAL_SCOPE_ATLAS_METADATA_BINDING_POINT,
	);
	gl.useProgram(program);
	gl.uniform1i(
		requireWebGL2Uniform(gl, program, "uPortalEnvelopeDepth"),
		PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.envelopeDepth,
	);
}

/** Bind invariant metadata/sampler state and return the sole per-draw scope uniform. */
export function bindWebGL2PortalDeferredVisibilityProgram(
	gl: WebGL2RenderingContext,
	program: WebGLProgram,
): WebGL2PortalDeferredVisibilityUniforms {
	bindWebGL2PortalDeferredVisibilityInstanceProgram(gl, program);
	return {
		renderDomain: requireWebGL2Uniform(gl, program, "uPortalRenderDomain"),
	};
}

/** Scope routing supplied by the active portal view to deferred overlay passes. */
export interface PortalDeferredScopeRouting {
	routeDeferredSubmission(
		renderScopeKey: string,
		uniforms: WebGL2PortalDeferredVisibilityUniforms,
	): void;
}
