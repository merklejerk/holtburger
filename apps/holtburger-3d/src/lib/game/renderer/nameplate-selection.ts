import type { Mat4, Vec3 } from "../math/types";
import type { NameplateSettings } from "./nameplate-policy";

/** Facts required to make deterministic nearest-first budget decisions. */
export interface DistanceRankedNameplate {
	readonly distanceSquared: number;
	readonly identity: string;
}

interface AnchoredNameplate {
	readonly anchor: Vec3;
}

/** Derive the camera-forward cutoff from the exact pixel scaling used by the billboard shader. */
export function maximumLegibleNameplateDepth(
	settings: NameplateSettings,
): number {
	return (
		(settings.referenceDistance * settings.appearance.name.fontSizePixels) /
		settings.minimumLegibleNamePixels
	);
}

/** Remove plates whose projected name line is below the configured legibility threshold. */
export function retainLegibleNameplates<T extends AnchoredNameplate>(
	candidates: T[],
	clipFromAnchor: Mat4,
	settings: NameplateSettings,
): void {
	const maximumDepth = maximumLegibleNameplateDepth(settings);
	let retainedCount = 0;
	for (const candidate of candidates) {
		const { anchor } = candidate;
		// This is the exact homogeneous W computed by the vertex shader. For our perspective
		// projection it is positive camera-forward depth, which directly controls plate pixel scale.
		const depth =
			clipFromAnchor.m14 * anchor.x +
			clipFromAnchor.m24 * anchor.y +
			clipFromAnchor.m34 * anchor.z +
			clipFromAnchor.m44;
		if (depth <= 0 || depth > maximumDepth) continue;
		candidates[retainedCount] = candidate;
		retainedCount += 1;
	}
	candidates.length = retainedCount;
}

/** Retain the deterministic nearest budget, ordered back-to-front for alpha blending. */
export function retainNearestNameplates<T extends DistanceRankedNameplate>(
	candidates: T[],
	maximumVisible: number,
): void {
	if (!Number.isSafeInteger(maximumVisible) || maximumVisible < 0)
		throw new Error("Nameplate budget must be a nonnegative safe integer.");
	candidates.sort(
		(left, right) =>
			left.distanceSquared - right.distanceSquared ||
			left.identity.localeCompare(right.identity),
	);
	candidates.length = Math.min(candidates.length, maximumVisible);
	candidates.reverse();
}
