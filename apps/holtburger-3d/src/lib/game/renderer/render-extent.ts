import { validateRenderScale } from "./render-scale";

/** Positive drawing-buffer pixel extent shared by runtime camera and renderer targets. */
export interface RenderExtent {
	readonly height: number;
	readonly width: number;
}

/** Resolve the exact drawing extent from CSS size and frontend-owned sampling density. */
export function resolveRenderExtent(
	cssWidth: number,
	cssHeight: number,
	renderScale: number,
): RenderExtent {
	if (
		!Number.isFinite(cssWidth) ||
		!Number.isFinite(cssHeight) ||
		cssWidth < 0 ||
		cssHeight < 0
	) {
		throw new Error("Viewport CSS extent must be finite and non-negative.");
	}
	validateRenderScale(renderScale, "Viewport");
	return Object.freeze({
		height: Math.max(1, Math.floor(cssHeight * renderScale)),
		width: Math.max(1, Math.floor(cssWidth * renderScale)),
	});
}

/** Reject malformed drawing-buffer dimensions before camera or WebGL state changes. */
export function validateRenderExtent(
	extent: RenderExtent,
	owner: string,
): void {
	validateRenderDimensions(extent.width, extent.height, owner);
}

/** Validate scalar dimensions without manufacturing an extent record on a hot resize check. */
export function validateRenderDimensions(
	width: number,
	height: number,
	owner: string,
): void {
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width <= 0 ||
		height <= 0
	) {
		throw new Error(
			`${owner} extent must contain positive integers within the safe range.`,
		);
	}
}
