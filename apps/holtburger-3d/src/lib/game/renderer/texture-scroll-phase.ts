/**
 * Derive a looping U/V cursor from the shared presentation clock, in CPU double precision.
 * Equal rates remain synchronized across independently activated objects and all frame views.
 *
 * RETAIL DIVERGENCE: acclient.c:299999 integrates rates from activation; :300193 retains phase
 * on a rate change and freezes the mesh when stopping. Our absolute-time cursor joins the
 * current phase on activation, may jump on rate changes, and resets a zero-rate axis to zero.
 * Restoring integration would require phase history and activation/lifetime bookkeeping.
 * Census 2026-09-10: all 11 script hooks author constant positive rates; zero animation and
 * part-scoped hooks. Sky layers also use this helper, including negative authored rates.
 * Wrapping the offset before clamped sampling deliberately makes its cursor periodic too.
 *
 * The product is computed in f64 before conversion to GPU f32, avoiding long-session f32
 * multiplication jitter. Call once per selected part/frame, not per view or shader vertex.
 */
export function textureScrollPhase(
	velocity: readonly [number, number],
	clockSeconds: number,
): [number, number] {
	return [
		wrapUnit(velocity[0] * clockSeconds),
		wrapUnit(velocity[1] * clockSeconds),
	];
}

function wrapUnit(value: number): number {
	const wrapped = value % 1;
	return wrapped < 0 ? wrapped + 1 : wrapped;
}
