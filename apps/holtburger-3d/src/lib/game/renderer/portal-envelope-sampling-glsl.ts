/**
 * Conservative atlas-envelope sampling radius. Zero keeps exact texel ownership; positive values
 * tolerate small raster disagreements at genuine portal boundaries without crossing tile edges.
 */
const PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS: number = 2;

const gutterSampling =
	PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS === 0
		? ""
		: `
	if (envelopeDepth == 0.0) {
		for (int y = -${PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS}; y <= ${PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS}; y += 1) {
			for (int x = -${PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS}; x <= ${PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS}; x += 1) {
				ivec2 candidatePixel = clamp(
					atlasPixel + ivec2(x, y),
					atlasMinimum,
					atlasMaximum
				);
				envelopeDepth = max(
					envelopeDepth,
					texelFetch(uPortalEnvelopeDepth, candidatePixel, 0).r
				);
			}
		}
	}`;

/** Shared exact-or-guttered envelope lookup used by opaque and deferred composition. */
export const PORTAL_ENVELOPE_SAMPLING_GLSL = `
uniform highp sampler2D uPortalEnvelopeDepth;

ivec2 portalScopeAtlasPixel(PortalScopeMetadata scope, ivec2 screenPixel) {
	return ivec2(scope.atlasAndScreenOrigin.xy)
		+ screenPixel - ivec2(scope.atlasAndScreenOrigin.zw);
}

float portalEnvelopeDepthAtAtlasPixel(
	PortalScopeMetadata scope,
	ivec2 atlasPixel
) {
	float envelopeDepth = texelFetch(uPortalEnvelopeDepth, atlasPixel, 0).r;
	ivec2 atlasMinimum = ivec2(scope.atlasAndScreenOrigin.xy);
	ivec2 atlasMaximum = atlasMinimum
		+ ivec2(scope.extentAndReserved.xy) - ivec2(1);
${gutterSampling}
	return envelopeDepth;
}
`;
