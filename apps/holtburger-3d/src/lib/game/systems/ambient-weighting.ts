/**
 * Retail's ambient weighting and direction bucketing, transcribed from `Ambient`
 * (acclient.c:367152-367210).
 *
 * Every function here evaluates in **AC's authored axes**: x east, y north, z up. That is not a
 * formality — `ambientDirection` compares |x| against |y| and the headings below are compass
 * bearings in that plane, so evaluating them against render-axis vectors would bucket sounds into the
 * wrong quadrant while still type-checking and still looking plausible on screen.
 */

/** Inside this distance a source is at full weight and has no direction. */
export const AMBIENT_MIN_DISTANCE = 20;

/** `Ambient::ambient_sound_min_dist_sq` (acclient.c:44610). */
const AMBIENT_MIN_DISTANCE_SQUARED = AMBIENT_MIN_DISTANCE ** 2;

/** `Ambient::ambient_sound_max_dist_sq` (acclient.c:44611); 120 m, beyond which nothing contributes. */
export const AMBIENT_MAX_DISTANCE_SQUARED = 14400;

/**
 * `Ambient::ambient_sound_min_vol` (acclient.c:44612).
 *
 * A continuous sound whose weighted volume falls below this is not scheduled at all, rather than
 * scheduled and played inaudibly (`ConstantSound::CanHear`, acclient.c:367227).
 */
export const AMBIENT_MIN_VOLUME = 0.029999999;

/** Half-width of the distance band one contributing cell contributes to its direction. */
export const AMBIENT_DISTANCE_BAND_HALF_WIDTH = AMBIENT_MIN_DISTANCE * 0.5;

/**
 * Band a cell sitting on top of the listener contributes to *every* direction.
 *
 * Retail writes the minimum as `5.0 - 1.0` inline (acclient.c:367571), which is preserved rather than
 * folded so the odd literal stays recognizable against the decompile.
 */
export const AMBIENT_OMNIDIRECTIONAL_MIN_DISTANCE = 5 - 1;

/**
 * `LandDefs::Direction` (acclient.h:3616), as retail numbers it.
 *
 * `inViewerBlock` is the "too close to have a direction" bucket rather than a ninth compass point:
 * a source there is added to all eight instead.
 */
export const AMBIENT_DIRECTION = {
	inViewerBlock: 0,
	north: 1,
	south: 2,
	east: 3,
	west: 4,
	northwest: 5,
	southwest: 6,
	northeast: 7,
	southeast: 8,
} as const;

export type AmbientDirection =
	(typeof AMBIENT_DIRECTION)[keyof typeof AMBIENT_DIRECTION];

/** The eight compass buckets, in retail's order; excludes the omnidirectional sentinel. */
export const AMBIENT_COMPASS_DIRECTIONS: readonly AmbientDirection[] = [
	AMBIENT_DIRECTION.north,
	AMBIENT_DIRECTION.south,
	AMBIENT_DIRECTION.east,
	AMBIENT_DIRECTION.west,
	AMBIENT_DIRECTION.northwest,
	AMBIENT_DIRECTION.southwest,
	AMBIENT_DIRECTION.northeast,
	AMBIENT_DIRECTION.southeast,
];

/**
 * Compass bearing per direction (`LandDefs::heading`, acclient.c:446441), in radians.
 *
 * Zero is north and bearings increase clockwise through east, which is why placement takes `sin` for
 * AC's x (east) and `cos` for AC's y (north) rather than the other way round.
 */
export const AMBIENT_DIRECTION_HEADING: Readonly<
	Record<AmbientDirection, number>
> = {
	[AMBIENT_DIRECTION.inViewerBlock]: 0,
	[AMBIENT_DIRECTION.north]: 0,
	[AMBIENT_DIRECTION.south]: 3.1415927,
	[AMBIENT_DIRECTION.east]: 1.5707964,
	[AMBIENT_DIRECTION.west]: 4.712389,
	[AMBIENT_DIRECTION.northwest]: 5.497787,
	[AMBIENT_DIRECTION.southwest]: 3.9269907,
	[AMBIENT_DIRECTION.northeast]: 0.78539819,
	[AMBIENT_DIRECTION.southeast]: 2.3561945,
};

/**
 * Width of the arc a placed sound may land within, centred on its direction's bearing
 * (`DIR_ANGLE_IN_RAD`, acclient.c:44613).
 *
 * 0.3927 rad is 22.5°, half a compass sector, so a sound jitters ±11.25° about its bearing rather
 * than snapping to eight exact headings.
 */
export const AMBIENT_DIRECTION_ARC = 0.39269909;

/** Axis-dominance tolerance below which retail treats a component as zero. */
const AXIS_EPSILON = 0.00019999999;

/** Ratio at which one horizontal axis is considered to dominate the other. */
const AXIS_DOMINANCE_RATIO = 2;

/**
 * How much one source at this squared distance contributes (`Ambient::CalcWeight`).
 *
 * Full weight inside the flat radius, inverse-square between, and nothing beyond the maximum. This
 * is a *presence* weight rather than a gain: it scales an intermittent sound's probability and a
 * continuous sound's volume, so more surrounding cells authoring a sound make it likelier or louder
 * rather than making several copies of it.
 */
export function ambientWeight(distanceSquared: number): number {
	if (distanceSquared > AMBIENT_MAX_DISTANCE_SQUARED) return 0;
	if (distanceSquared >= AMBIENT_MIN_DISTANCE_SQUARED) {
		return AMBIENT_MIN_DISTANCE_SQUARED / distanceSquared;
	}
	return 1;
}

/**
 * Which of eight compass buckets a source falls into (`Ambient::CalcDir`).
 *
 * Takes AC's horizontal plane as two scalars — eastward and northward displacement — rather than a
 * vector, because the scan calls this once per contributing entry and a tuple per call is exactly
 * the allocation the baked walk exists to avoid.
 *
 * Returns `inViewerBlock` for a source close enough that a direction would be meaningless; retail's
 * caller then contributes it to all eight instead of dropping it.
 */
export function ambientDirection(x: number, y: number): AmbientDirection {
	if (AMBIENT_MIN_DISTANCE_SQUARED * 0.5 > y * y + x * x) {
		return AMBIENT_DIRECTION.inViewerBlock;
	}
	const absoluteX = Math.abs(x);
	const absoluteY = Math.abs(y);
	if (
		absoluteX < AXIS_EPSILON ||
		absoluteY / absoluteX > AXIS_DOMINANCE_RATIO
	) {
		return y < 0 ? AMBIENT_DIRECTION.south : AMBIENT_DIRECTION.north;
	}
	if (
		absoluteY < AXIS_EPSILON ||
		absoluteX / absoluteY > AXIS_DOMINANCE_RATIO
	) {
		return x < 0 ? AMBIENT_DIRECTION.west : AMBIENT_DIRECTION.east;
	}
	if (x < 0) {
		return y < 0 ? AMBIENT_DIRECTION.southwest : AMBIENT_DIRECTION.northwest;
	}
	return y < 0 ? AMBIENT_DIRECTION.southeast : AMBIENT_DIRECTION.northeast;
}

/** How far away a direction's contributors sit; widened as more cells contribute to it. */
export interface AmbientDistanceBand {
	minimum: number;
	maximum: number;
}

/**
 * Merge one contributor's band into a direction's accumulated band (`IntermitSound::AddDir`).
 *
 * Retail widens an existing entry rather than appending a second, so a direction ends up with the
 * full span its contributors cover and placement rolls anywhere inside it.
 */
export function widenDistanceBand(
	bands: Map<AmbientDirection, AmbientDistanceBand>,
	direction: AmbientDirection,
	minimum: number,
	maximum: number,
): void {
	const existing = bands.get(direction);
	if (!existing) {
		bands.set(direction, { maximum, minimum });
		return;
	}
	if (minimum < existing.minimum) existing.minimum = minimum;
	if (maximum > existing.maximum) existing.maximum = maximum;
}
