import {
	MINUTES_PER_GAME_DAY,
	type ClientClockFormat,
} from "./client-environment-settings";

/** Minutes in one display hour, independent of the authored real-time day length. */
const MINUTES_PER_HOUR = 60;

/** Format Dereth's fraction directly; timezone conversion would change its meaning. */
export function formatGameTime(
	dayFraction: number,
	format: ClientClockFormat,
): string {
	if (!Number.isFinite(dayFraction) || dayFraction < 0 || dayFraction >= 1)
		throw new Error("Game time must be a day fraction in [0, 1).");
	// Fractional-day subtraction can put an exact minute a few ulps below its boundary.
	// Snap only machine-precision error; ordinary sub-minute values still floor normally.
	const totalMinutes = Math.min(
		MINUTES_PER_GAME_DAY - 1,
		Math.floor(
			dayFraction * MINUTES_PER_GAME_DAY +
				Number.EPSILON * MINUTES_PER_GAME_DAY,
		),
	);
	const hour = Math.floor(totalMinutes / MINUTES_PER_HOUR);
	const minute = String(totalMinutes % MINUTES_PER_HOUR).padStart(2, "0");
	return format === "24-hour"
		? `${String(hour).padStart(2, "0")}:${minute}`
		: `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
}
