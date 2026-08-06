/** One authored keyframe pair straddling a day fraction, plus the interpolation ratio between them. */
export interface KeyframeBracket<T> {
	readonly before: T;
	readonly after: T;
	readonly ratio: number;
}

/**
 * Bracket a cyclic day-fraction keyframe list, reproducing `DayGroup::GetTimeOfDay`
 * (acclient.c:290881).
 *
 * Retail wraps the final keyframe into the first with a `1.0 - before.begin` denominator; this
 * treats the first keyframe as beginning one full day later instead. The two agree exactly when
 * the first keyframe begins at zero, which every shipped day group does (verified by the sky
 * census recorded in the sky pass plan). Expressing the wrap this way also handles a hypothetical
 * region whose first keyframe begins later, where retail's formula would misreport the ratio.
 */
export function bracketKeyframes<T extends { readonly begin: number }>(
	keyframes: readonly T[],
	dayFraction: number,
): KeyframeBracket<T> {
	const ordered = [...keyframes].sort(
		(left, right) => left.begin - right.begin,
	);
	let before = ordered.at(-1);
	let after = ordered[0];
	if (before === undefined || after === undefined)
		throw new Error("Sky day group has no keyframes.");
	for (const keyframe of ordered) {
		if (keyframe.begin <= dayFraction) before = keyframe;
		if (keyframe.begin > dayFraction) {
			after = keyframe;
			break;
		}
	}
	const beforeTime = before.begin;
	const afterTime = after.begin <= beforeTime ? after.begin + 1 : after.begin;
	const currentTime = dayFraction < beforeTime ? dayFraction + 1 : dayFraction;
	return {
		before,
		after,
		ratio: (currentTime - beforeTime) / (afterTime - beforeTime),
	};
}
