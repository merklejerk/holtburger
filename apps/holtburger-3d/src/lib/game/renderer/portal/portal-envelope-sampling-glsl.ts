/**
 * Conservative atlas-envelope dilation radius. Zero keeps exact texel ownership; positive values
 * pre-dilate child envelopes into uncovered gutter texels before composition without crossing tile edges.
 */
export const PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS: number = 2;

/** Shared envelope lookup used by opaque and deferred composition after pre-dilation. */
export const PORTAL_ENVELOPE_SAMPLING_GLSL = `
uniform highp sampler2D uPortalEnvelopeDepth;

ivec2 portalScopeAtlasPixel(PortalScopeMetadata scope, ivec2 screenPixel) {
	return ivec2(scope.atlasAndScreenOrigin.xy)
		+ screenPixel - ivec2(scope.atlasAndScreenOrigin.zw);
}

float portalEnvelopeDepthAtAtlasPixel(ivec2 atlasPixel) {
	return texelFetch(uPortalEnvelopeDepth, atlasPixel, 0).r;
}
`;
