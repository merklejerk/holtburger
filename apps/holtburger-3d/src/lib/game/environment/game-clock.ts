/**
 * Resolve the regional day fraction from elapsed time at retail's lighting cadence.
 *
 * Retail recomputes lighting only every `SkyDesc::light_tick_size` seconds of game time
 * (`LScape::UseTime`, acclient.c:296190), so lighting steps between authored keyframe samples
 * rather than drifting continuously. Quantizing the elapsed time before converting to a day
 * fraction reproduces that exactly and keeps this a pure function: no clock state to advance,
 * no accumulated drift, and identical output for identical inputs.
 *
 * `dayLengthSeconds` is the region's authored day length and `lightTickSeconds` its authored
 * light tick; both come from region data rather than the retail code defaults, because EoR
 * Dereth authors values that differ from them.
 */
export function resolveClockDayFraction(
	elapsedSeconds: number,
	dayLengthSeconds: number,
	lightTickSeconds: number,
): number {
	if (!(dayLengthSeconds > 0)) {
		throw new Error("Region day length must be positive to resolve a clock.");
	}
	if (!(lightTickSeconds > 0)) {
		throw new Error("Region light tick must be positive to resolve a clock.");
	}
	if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
		throw new Error("Elapsed clock seconds must be a non-negative number.");
	}
	const ticked =
		Math.floor(elapsedSeconds / lightTickSeconds) * lightTickSeconds;
	const fraction = (ticked / dayLengthSeconds) % 1;
	// Guard the exact-1 boundary so callers always receive a value in [0, 1).
	return fraction >= 1 ? 0 : fraction;
}
