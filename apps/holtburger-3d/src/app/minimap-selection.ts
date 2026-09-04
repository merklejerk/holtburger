/** Canvas-space identity used by minimap pointer hit testing. */
export interface MinimapSelectionHitTarget {
	readonly guid: number;
	readonly x: number;
	readonly y: number;
}

/** Choose pointer distance first and GUID second so overlapping blips are deterministic. */
export function closestMinimapSelectionGuid(
	targets: readonly MinimapSelectionHitTarget[],
	x: number,
	y: number,
	hitRadius: number,
): number | null {
	let closest: { readonly distance: number; readonly guid: number } | null =
		null;
	for (const target of targets) {
		const distance = Math.hypot(target.x - x, target.y - y);
		if (distance > hitRadius) continue;
		if (
			closest === null ||
			distance < closest.distance ||
			(distance === closest.distance && target.guid < closest.guid)
		)
			closest = { distance, guid: target.guid };
	}
	return closest?.guid ?? null;
}
