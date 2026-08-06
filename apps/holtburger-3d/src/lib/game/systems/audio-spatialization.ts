/**
 * Retail's positional audio math, transcribed from `SoundManager` (acclient.c:366427-366519).
 *
 * Deliberately a pure module: gain and pan are computed **once at trigger time** from the emitting
 * object's position and never updated, so a moving source does not re-pan. That is retail's
 * behavior, and it is also why this needs no per-frame work at all.
 */

/** Below this distance retail applies no attenuation and no panning. */
const FLAT_GAIN_RADIUS_METERS = 5;

/** Numerator of retail's inverse-square falloff beyond the flat radius. */
const INVERSE_SQUARE_SCALE = 25;

/**
 * Gain floor below which retail does not play the sound at all.
 *
 * -50 dB, which at full volume works out to roughly 89 m.
 */
const AUDIBLE_GAIN_FLOOR = 10 ** (-50 / 20);

export interface SpatialAudioPlacement {
	/** Linear gain in (0, volume]; a sound below the audible floor is not placed at all. */
	readonly gain: number;
	/** Stereo pan in [-1, 1], left to right. Zero inside the flat radius. */
	readonly pan: number;
}

/**
 * Place one sound relative to the listener, or return `null` if retail would not play it.
 *
 * `listenerRight` is the listener's right-hand unit vector; panning is the source's projection onto
 * it, which is retail's heading-based pan expressed without a heading angle.
 */
export function placeSpatialAudio(
	sourcePosition: readonly [number, number, number],
	listenerPosition: readonly [number, number, number],
	listenerRight: readonly [number, number, number],
	volume: number,
): SpatialAudioPlacement | null {
	if (!(volume > 0)) return null;
	const delta = [
		sourcePosition[0] - listenerPosition[0],
		sourcePosition[1] - listenerPosition[1],
		sourcePosition[2] - listenerPosition[2],
	] as const;
	const distance = Math.hypot(delta[0], delta[1], delta[2]);

	// Inside the flat radius retail neither attenuates nor pans, so a sound at the listener's own
	// position is centred rather than dividing by zero.
	if (distance <= FLAT_GAIN_RADIUS_METERS) {
		return volume >= AUDIBLE_GAIN_FLOOR ? { gain: volume, pan: 0 } : null;
	}

	const gain = (INVERSE_SQUARE_SCALE * volume) / (distance * distance);
	if (gain < AUDIBLE_GAIN_FLOOR) return null;

	const rightLength = Math.hypot(
		listenerRight[0],
		listenerRight[1],
		listenerRight[2],
	);
	if (rightLength === 0) return { gain, pan: 0 };
	const projection =
		(delta[0] * listenerRight[0] +
			delta[1] * listenerRight[1] +
			delta[2] * listenerRight[2]) /
		(rightLength * distance);
	return { gain, pan: Math.max(-1, Math.min(1, projection)) };
}

/** Distance beyond which a sound at `volume` falls below the audible floor. */
export function audibleRadiusMeters(volume: number): number {
	if (!(volume > 0)) return 0;
	return Math.max(
		FLAT_GAIN_RADIUS_METERS,
		Math.sqrt((INVERSE_SQUARE_SCALE * volume) / AUDIBLE_GAIN_FLOOR),
	);
}
