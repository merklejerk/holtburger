import { PORTAL_SCOPE_ATLAS_TEXTURE_UNITS } from "./portal-scope-atlas-command-model";
import {
	bindPortalScopeAtlasMetadataBlock,
	PORTAL_SCOPE_ATLAS_METADATA_BINDING_POINT,
	PORTAL_SCOPE_ATLAS_METADATA_GLSL,
} from "./portal-scope-atlas-metadata-glsl";
import { requireWebGL2Uniform } from "./webgl2-shader-utils";

/** Draw-varying scope selector for one physical deferred submission. */
export interface WebGL2PortalDeferredVisibilityUniforms {
	readonly scope: WebGLUniformLocation;
}

/**
 * Fragment-stage scope-envelope predicate shared by transparent objects and particles.
 *
 * Opaque depth remains ordinary fixed-function depth testing. This predicate only answers whether
 * the fragment lies inside any admitted appearance of its authored scope and before that scope's
 * farthest admitted exit at the current pixel.
 */
export const PORTAL_DEFERRED_VISIBILITY_GLSL = `
${PORTAL_SCOPE_ATLAS_METADATA_GLSL}

// Keep depth lookup coordinates high precision independently of the consuming shader's defaults.
// Particle fragments do not otherwise need a sampler precision declaration, and mediump lookup
// coordinates visibly shimmer along distant portal boundaries.
uniform highp sampler2D uPortalEnvelopeDepth;
uniform uint uPortalScope;

bool portalDeferredFragmentVisible() {
	PortalScopeMetadata scope = uScopes[uPortalScope];
	ivec2 screenPixel = ivec2(gl_FragCoord.xy);
	ivec2 relativePixel = screenPixel - ivec2(scope.atlasAndScreenOrigin.zw);
	ivec2 scopeExtent = ivec2(scope.extentAndReserved.xy);
	if (any(lessThan(relativePixel, ivec2(0)))
		|| any(greaterThanEqual(relativePixel, scopeExtent))) {
		return false;
	}
	ivec2 atlasPixel = ivec2(scope.atlasAndScreenOrigin.xy) + relativePixel;
	float envelopeDepth = texelFetch(uPortalEnvelopeDepth, atlasPixel, 0).r;
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
	return { scope: requireWebGL2Uniform(gl, program, "uPortalScope") };
}
