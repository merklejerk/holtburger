import type { PortalCrossingId } from "../scene";
import type { WebGL2GeometryBinding } from "./webgl2-resource-manager";

/** Existing GPU draw range for one graph-selected effective visibility aperture. */
export interface ResolvedPortalMask {
	/** Complete aperture transform into the active view's clip frame. */
	readonly clipFromLocal: Float32Array;
	/** Existing immutable geometry resource; portal execution never uploads aperture geometry. */
	readonly geometry: WebGL2GeometryBinding;
	/** Number of aperture indices submitted to the mask pass. */
	readonly indexCount: number;
	/** First aperture index submitted to the mask pass. */
	readonly indexStart: number;
}

/** Fail before target allocation when a graph-selected aperture resolves to an invalid draw. */
export function validateResolvedPortalMask(
	mask: ResolvedPortalMask,
	crossingId: PortalCrossingId,
): void {
	if (
		mask.clipFromLocal.length !== 16 ||
		![...mask.clipFromLocal].every(Number.isFinite)
	) {
		throw new Error(
			`Portal crossing ${crossingId} resolved an invalid clip transform.`,
		);
	}
	if (
		!Number.isInteger(mask.indexStart) ||
		!Number.isInteger(mask.indexCount) ||
		mask.indexStart < 0 ||
		mask.indexCount <= 0 ||
		mask.indexStart + mask.indexCount > mask.geometry.indexCount
	) {
		throw new Error(
			`Portal crossing ${crossingId} resolved an invalid aperture draw range.`,
		);
	}
}
