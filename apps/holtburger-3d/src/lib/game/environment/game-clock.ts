/**
 * Convert elapsed real time into a normalized regional day fraction.
 *
 * This is the whole clock: one continuous fraction with no state to advance and no accumulated
 * drift. Retail samples that fraction on authored ticks rather than continuously
 * (`LScape::UseTime`, acclient.c:296190), but each domain ticks at its own authored rate, so the
 * quantization belongs to the environment layer that knows those rates rather than here.
 */
export function resolveDayFraction(
	elapsedSeconds: number,
	dayLengthSeconds: number,
): number {
	if (!(dayLengthSeconds > 0)) {
		throw new Error("Region day length must be positive to resolve a clock.");
	}
	if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
		throw new Error("Elapsed clock seconds must be a non-negative number.");
	}
	const fraction = (elapsedSeconds / dayLengthSeconds) % 1;
	// Guard the exact-1 boundary so callers always receive a value in [0, 1).
	return fraction >= 1 ? 0 : fraction;
}

/**
 * Snap a day fraction down to the authored tick that owns it, so a domain steps between samples
 * rather than drifting continuously.
 *
 * A tick at least as long as the region's day collapses to a single sample at zero, which is what
 * flooring already produces; no special case is needed.
 */
export function quantizeDayFraction(
	dayFraction: number,
	tickSeconds: number,
	dayLengthSeconds: number,
): number {
	if (!(dayLengthSeconds > 0)) {
		throw new Error("Region day length must be positive to quantize a tick.");
	}
	if (!(tickSeconds > 0)) {
		throw new Error("Region tick size must be positive to quantize a tick.");
	}
	if (!Number.isFinite(dayFraction) || dayFraction < 0 || dayFraction >= 1) {
		throw new Error("Day fraction must be normalized to [0, 1).");
	}
	const tickFraction = tickSeconds / dayLengthSeconds;
	return Math.floor(dayFraction / tickFraction) * tickFraction;
}
