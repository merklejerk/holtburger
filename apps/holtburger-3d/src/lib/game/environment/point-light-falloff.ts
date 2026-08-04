/**
 * Retail's authored point-light falloff, shared by the interior bake and the runtime shader.
 *
 * This is `calc_point_light` (acclient.c:434189), the shape retail uses when burning static light
 * into EnvCell vertex colors. We use it for **every authored light**, baked or evaluated, rather
 * than retail's hardware `1/d`, because authored magnitudes make `1/d` unusable: at the measured
 * median intensity of 100 and falloff of 6, `intensity / d` is 20 at five units and still 11 at
 * the nine-unit edge, so a lamp saturates to full colour across its whole reach and then stops
 * dead. This shape saturates the same core but tapers smoothly to zero at the boundary, and it
 * degrades correctly for small intensities such as the viewer light's 2.25.
 *
 * The constants live here so the TypeScript baker and the GLSL mirror cannot drift apart on a
 * magic number; the GLSL interpolates them directly from this module.
 */

/** Half-Lambert wrap: `(WRAP_DISTANCE_SCALE * d + dot(N, D)) / WRAP_DIVISOR`. */
export const WRAP_DISTANCE_SCALE = 0.5;
export const WRAP_DIVISOR = 1.5;

/**
 * Evaluate one light's contribution scale at a point.
 *
 * Returns the scalar `s` that retail multiplies into the light colour before clamping each
 * channel to that colour. Zero means the light does not reach, faces away, or is out of range.
 *
 * `delta` is deliberately **not** normalized before the dot product, matching retail — which is
 * why a zero normal still receives a direction-independent glow rather than nothing.
 */
export function pointLightFalloff(
	deltaX: number,
	deltaY: number,
	deltaZ: number,
	normalX: number,
	normalY: number,
	normalZ: number,
	range: number,
	intensity: number,
): number {
	const distanceSquared = deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
	const distance = Math.sqrt(distanceSquared);
	if (distance >= range) return 0;
	const wrapped =
		(WRAP_DISTANCE_SCALE * distance +
			(normalX * deltaX + normalY * deltaY + normalZ * deltaZ)) /
		WRAP_DIVISOR;
	if (wrapped <= 0) return 0;
	const attenuation =
		distanceSquared <= 1
			? wrapped / distance
			: wrapped / (distanceSquared * distance);
	return attenuation * (1 - distance / range) * intensity;
}

/**
 * GLSL mirror of `pointLightFalloff`, with the wrap constants interpolated from this module.
 *
 * Structure is duplicated across the language boundary by necessity; the numbers are not.
 */
export const POINT_LIGHT_FALLOFF_GLSL = `
float pointLightFalloff(vec3 delta, vec3 normal, float range, float intensity) {
	float distanceSquared = dot(delta, delta);
	float lightDistance = sqrt(distanceSquared);
	if (lightDistance >= range) return 0.0;
	float wrapped = (${WRAP_DISTANCE_SCALE} * lightDistance + dot(normal, delta)) / ${WRAP_DIVISOR};
	if (wrapped <= 0.0) return 0.0;
	float attenuation = distanceSquared <= 1.0
		? wrapped / lightDistance
		: wrapped / (distanceSquared * lightDistance);
	return attenuation * (1.0 - lightDistance / range) * intensity;
}
`;
