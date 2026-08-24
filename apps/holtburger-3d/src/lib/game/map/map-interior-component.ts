import type { EnvCellId } from "../game-types";
import type { ResolvedPortalCrossing } from "../resolution/landblock-layer";

/**
 * Select the interior the anchor is actually inside, by flooding the portal graph.
 *
 * Stacked interiors routinely share one landblock at different heights, so "every cell in this
 * record" is the wrong set to draw — it bleeds an unrelated dungeon into the map. The right set is
 * the connected component containing the anchor's cell.
 *
 * Traversal is **undirected**, and deliberately so. A one-way authored portal still names its
 * target, so a drop you can fall through but not climb back up stays on the map, and an anchor
 * teleported into a sealed region floods from where it stands rather than needing a canonical
 * entrance that AC does not author. The shipped census found 108 such one-way edges out of 1.35
 * million, so this costs almost nothing and avoids inventing reachability policy.
 *
 * Only cell-to-cell crossings carry connectivity: an exterior transition leads outdoors, which is
 * a different map mode rather than another room. Cells with no portals at all are excluded by
 * construction, which is exactly the wanted answer — they are not part of this interior.
 */
export function floodInteriorComponent(
	crossings: readonly ResolvedPortalCrossing[],
	originEnvCellId: EnvCellId,
): ReadonlySet<EnvCellId> {
	const adjacency = new Map<EnvCellId, EnvCellId[]>();
	const link = (from: EnvCellId, to: EnvCellId): void => {
		const existing = adjacency.get(from);
		if (existing) existing.push(to);
		else adjacency.set(from, [to]);
	};
	for (const crossing of crossings) {
		if (crossing.source.kind !== "env-cell") continue;
		if (crossing.target.kind !== "env-cell") continue;
		link(crossing.source.envCellId, crossing.target.envCellId);
		link(crossing.target.envCellId, crossing.source.envCellId);
	}

	const component = new Set<EnvCellId>([originEnvCellId]);
	const pending: EnvCellId[] = [originEnvCellId];
	while (pending.length > 0) {
		const current = pending.pop();
		if (current === undefined) break;
		for (const neighbour of adjacency.get(current) ?? []) {
			if (component.has(neighbour)) continue;
			component.add(neighbour);
			pending.push(neighbour);
		}
	}
	return component;
}

/**
 * Whether a previously flooded component still describes where the anchor is.
 *
 * Undirected connected components are equivalence classes, so flooding from any member returns the
 * same set. Membership is therefore a complete validity test, and the map can hold one component
 * across an entire dungeon walk instead of re-flooding as the anchor moves.
 */
export function interiorComponentContains(
	component: ReadonlySet<EnvCellId>,
	envCellId: EnvCellId | null,
): boolean {
	return envCellId !== null && component.has(envCellId);
}
