/** Positive pixel extent shared by renderer-owned WebGL2 targets. */
export interface WebGL2RenderExtent {
	readonly height: number;
	readonly width: number;
}

/** Reject malformed target dimensions before any WebGL state or resource mutation. */
export function validateWebGL2RenderExtent(
	extent: WebGL2RenderExtent,
	owner: string,
): void {
	if (
		!Number.isSafeInteger(extent.width) ||
		!Number.isSafeInteger(extent.height) ||
		extent.width <= 0 ||
		extent.height <= 0
	) {
		throw new Error(
			`${owner} extent must contain positive integers within the safe range.`,
		);
	}
}
