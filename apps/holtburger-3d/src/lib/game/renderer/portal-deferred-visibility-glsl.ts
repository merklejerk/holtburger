import { PORTAL_SCOPE_ATLAS_TEXTURE_UNITS } from "./portal-scope-atlas-command-model";
import { PORTAL_ENVELOPE_SAMPLING_GLSL } from "./portal-envelope-sampling-glsl";
import {
	bindPortalScopeAtlasMetadataBlock,
	PORTAL_SCOPE_ATLAS_METADATA_BINDING_POINT,
	PORTAL_SCOPE_ATLAS_METADATA_GLSL,
} from "./portal-scope-atlas-metadata-glsl";
import { requireWebGL2Uniform } from "./webgl2-shader-utils";

/** Draw-varying render-domain selector for one physical deferred submission. */
export interface WebGL2PortalDeferredVisibilityUniforms {
	readonly renderDomain: WebGLUniformLocation;
}

/**
 * Fragment-stage render-domain envelope predicate shared by transparent objects and particles.
 *
 * Opaque depth remains ordinary fixed-function depth testing. This predicate only answers whether
 * the fragment lies inside any admitted appearance of its owning domain and before that domain's
 * farthest admitted exit at the current pixel.
 */
export const PORTAL_DEFERRED_VISIBILITY_GLSL = `
${PORTAL_SCOPE_ATLAS_METADATA_GLSL}
${PORTAL_ENVELOPE_SAMPLING_GLSL}
uniform uint uPortalRenderDomain;

bool portalDeferredFragmentVisible() {
	PortalScopeMetadata scope = uScopes[uPortalRenderDomain];
	ivec2 screenPixel = ivec2(gl_FragCoord.xy);
	ivec2 relativePixel = screenPixel - ivec2(scope.atlasAndScreenOrigin.zw);
	ivec2 scopeExtent = ivec2(scope.extentAndReserved.xy);
	if (any(lessThan(relativePixel, ivec2(0)))
		|| any(greaterThanEqual(relativePixel, scopeExtent))) {
		return false;
	}
	ivec2 atlasPixel = portalScopeAtlasPixel(scope, screenPixel);
	float envelopeDepth = portalEnvelopeDepthAtAtlasPixel(scope, atlasPixel);
	return envelopeDepth == 1.0 || gl_FragCoord.z * 0.5 < envelopeDepth;
}
`;

/** Bind invariant metadata/sampler state and return the sole per-draw scope uniform. */
export function bindWebGL2PortalDeferredVisibilityProgram(
	gl: WebGL2RenderingContext,
	program: WebGLProgram,
): WebGL2PortalDeferredVisibilityUniforms {
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
	return {
		renderDomain: requireWebGL2Uniform(gl, program, "uPortalRenderDomain"),
	};
}
