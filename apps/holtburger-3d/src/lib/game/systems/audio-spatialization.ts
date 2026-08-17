import type { RenderVector3, SceneVector3 } from "../../assets/ac-frame";
/**
 * Retail's positional audio math, transcribed from `SoundManager` (acclient.c:366427-366519).
 *
 * Deliberately a pure module: one placement from one listener pose, no state. Retail called this
 * once at trigger time and never again; we additionally call it per frame for every live voice
 * (the divergence is owned and marked by `AudioSystem`), which is why it stays allocation-light —
 * scalar arithmetic plus one small result object per audible placement.
 */

/** Below this distance retail applies no attenuation and no panning. */
const FLAT_GAIN_RADIUS_METERS = 5;

/** Numerator of retail's inverse-square falloff beyond the flat radius. */
const INVERSE_SQUARE_SCALE = 25;

/**
 * Gain ceiling retail applies after attenuation (`if (v4 > 1.0) v4 = 1.0`, acclient.c:366438).
 *
 * Not defensive: 45 of the 4,185 authored sound-table candidates carry a volume above 1.0, the
 * loudest at 10.0. Those are authored to *carry further* — a volume of 10 stays above the floor out
 * to 281 m — not to play ten times louder up close, and without the clamp they reach the device as a
 * tenfold gain overdrive.
 */
const MAXIMUM_GAIN = 1;

/**
 * Gain floor below which retail does not play the sound at all.
 *
 * `SoundManager::VOL_MIN = -50` dB (acclient.c:44588), which at full volume works out to roughly
 * 89 m under the falloff above.
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
 *
 * `categoryVolume` is the user's setting for the sound's retail category, applied **after** the
 * ceiling and **before** the floor test, exactly as `GetAttenuation` does. Turning a category down
 * therefore shortens its audible range rather than only quietening it, which is retail's behaviour
 * and not an accident of ordering.
 *
 * Positions arrive in scene space rather than anchor-relative. Distance and projection are both
 * invariant under the anchor's pure translation, so spatial audio never needs to know where the
 * anchor is — and taking anchored positions would mean retaining one on the listener, which goes
 * silently wrong by a landblock the moment the camera crosses a boundary.
 */
export function placeSpatialAudio(
	sourcePosition: SceneVector3,
	listenerPosition: SceneVector3,
	listenerRight: RenderVector3,
	volume: number,
	categoryVolume: number,
): SpatialAudioPlacement | null {
	if (!(volume > 0) || !(categoryVolume > 0)) return null;
	// Scalars rather than a delta tuple: this runs per live voice per frame, and the components are
	// only ever read element-wise below.
	const deltaX = sourcePosition[0] - listenerPosition[0];
	const deltaY = sourcePosition[1] - listenerPosition[1];
	const deltaZ = sourcePosition[2] - listenerPosition[2];
	const distance = Math.hypot(deltaX, deltaY, deltaZ);

	// Inside the flat radius retail neither attenuates nor pans, so a sound at the listener's own
	// position is centred rather than dividing by zero.
	if (distance <= FLAT_GAIN_RADIUS_METERS) {
		const near = Math.min(volume, MAXIMUM_GAIN) * categoryVolume;
		return near >= AUDIBLE_GAIN_FLOOR ? { gain: near, pan: 0 } : null;
	}

	const gain =
		Math.min(
			(INVERSE_SQUARE_SCALE * volume) / (distance * distance),
			MAXIMUM_GAIN,
		) * categoryVolume;
	if (gain < AUDIBLE_GAIN_FLOOR) return null;

	const rightLength = Math.hypot(
		listenerRight[0],
		listenerRight[1],
		listenerRight[2],
	);
	if (rightLength === 0) return { gain, pan: 0 };
	// RETAIL DIVERGENCE: retail pans by the sine of the *horizontal* heading difference
	// (acclient.c:366509-366514), discarding the vertical offset entirely; this projects the full 3D
	// delta and normalizes by 3D distance, which softens pan for steeply overhead or underfoot
	// sources. Deliberate product choice: stereo pan is pure presentation that no shipped content
	// can observe, and vertical-aware panning is the behavior a modern client wants. "Correcting"
	// this to retail would hard-pan sources directly above the listener.
	const projection =
		(deltaX * listenerRight[0] +
			deltaY * listenerRight[1] +
			deltaZ * listenerRight[2]) /
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
