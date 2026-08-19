/**
 * Sampling density policy, in device pixels rendered per CSS pixel.
 *
 * Explicit policy rather than the display's `devicePixelRatio`. Reading the drawing buffer size
 * from the monitor made sampling density a hardware fact instead of a choice: the same scene cost
 * four times the fragments on a HiDPI panel, and — because footprint cutoffs resolve against the
 * drawing buffer — drew a different set of objects there. One renders at native CSS resolution and
 * lets the browser composite the result to the display.
 *
 * Above one this is ordered-grid supersampling, which is the only anti-aliasing the renderer has:
 * every pass draws into the offscreen scene target at this density and the compositor resolves it.
 */

/** Below this the composited image is too soft to judge geometry or texture work against. */
export const MINIMUM_RENDER_SCALE = 0.5;
/** Four times the fragments of native CSS resolution, which is the practical ceiling. */
export const MAXIMUM_RENDER_SCALE = 2;

/** Test a density a frontend means to offer, so no surface can present one the renderer rejects. */
export function isRenderScale(renderScale: number): boolean {
	return (
		Number.isFinite(renderScale) &&
		renderScale >= MINIMUM_RENDER_SCALE &&
		renderScale <= MAXIMUM_RENDER_SCALE
	);
}

/** Reject a density the renderer cannot honour before it reaches target allocation. */
export function validateRenderScale(renderScale: number, owner: string): void {
	if (!isRenderScale(renderScale)) {
		throw new Error(
			`${owner} render scale must be within ${MINIMUM_RENDER_SCALE} and ${MAXIMUM_RENDER_SCALE}; got ${renderScale}.`,
		);
	}
}

/**
 * Convert a CSS-pixel area cutoff into the device-pixel area the projected footprint math yields.
 *
 * Footprint classification works in drawing-buffer pixels, so a cutoff authored in device pixels
 * would cull differently at every density and turn a sampling choice into a visibility choice.
 */
export function devicePixelArea(
	cssPixelArea: number,
	renderScale: number,
): number {
	return cssPixelArea * renderScale * renderScale;
}
