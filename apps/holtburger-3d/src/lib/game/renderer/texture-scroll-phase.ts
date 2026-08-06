/**
 * Derive the UV scroll phase for one authored rate.
 *
 * Retail accumulates instead (`CPhysics::UpdateTexVelocity`, acclient.c:299999, adds `rate * dt`
 * per frame and wraps at 1) into a registry keyed by GfxObj DataID, which is what keeps every
 * instance of a tiled flowing surface in phase at its seams. Deriving from a shared clock
 * reproduces that seam synchronization by arithmetic identity — two draws with the same rate are
 * always in lockstep — while keeping the renderer free of mutable per-frame state.
 *
 * The one precondition is that each scrolling texture's rate is constant for the session, since
 * `fract(r × t)` equals `fract(∫r dt)` only for constant `r`. Verified 2026-08-06 across the whole
 * archive: no GfxObj DataID is authored two distinct script-driven rates. The absolute phase origin
 * differs from retail's (its accumulators start at first activation) but is unobservable for a
 * looping scroll; only relative phase between same-texture instances is visible, and that matches.
 *
 * Computed in f64 before the result reaches an f32 uniform, because `rate × t` degrades in f32 over
 * a multi-hour session and would visibly quantize the scroll.
 *
 * Shared by the sky pass and the authored `TextureVelocity` effect consumer; neither derives its
 * own.
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
