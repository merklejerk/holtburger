import type {
	DynamicEntityAttachedPlacement,
	DynamicEntityView,
} from "../lib/game/runtime/dynamic-entity-feed";

/**
 * One entity the feed placed on a parent rather than in the world.
 *
 * The narrowing is carried in the contract so consumers read `parentLocation` and `placement`
 * directly. Re-testing the placement arm at the consumer would be asserting past a fact this
 * module already established.
 */
type AttachedEntityView = DynamicEntityView & {
	readonly placement: DynamicEntityAttachedPlacement;
};

/** One world-placed wearer together with the held children whose transforms it owns. */
interface ExplorerEntityTreeNode {
	readonly entity: DynamicEntityView;
	readonly children: readonly AttachedEntityView[];
}

/**
 * The spawned feed arranged by attachment ownership.
 *
 * `orphans` is not a tidy-up bucket: the host publishes a wearer and its complete child set in one
 * ordered generation, so an attached entity whose wearer is absent is a group-atomicity violation.
 * Naming it in the contract keeps the panel able to show the break instead of hiding it under a
 * root it does not belong to.
 */
export interface ExplorerEntityTree {
	readonly roots: readonly ExplorerEntityTreeNode[];
	readonly orphans: readonly AttachedEntityView[];
}

function isAttached(entity: DynamicEntityView): entity is AttachedEntityView {
	return entity.placement.kind === "attached";
}

/**
 * Group one flat feed generation by attachment, preserving the host's published order.
 *
 * Only the wearer/child relationship is modelled, because that is the only depth the placement
 * contract can express: a child carries `EntityPlacement::Attached`, which no child of its own can
 * name as a parent while children remain bodyless.
 */
export function buildExplorerEntityTree(
	entities: readonly DynamicEntityView[],
): ExplorerEntityTree {
	const worldEntities = entities.filter(
		(entity) => entity.placement.kind === "world",
	);
	const worldGuids = new Set(
		worldEntities.map((entity) => entity.identity.guid),
	);
	const children = new Map<number, AttachedEntityView[]>();
	const orphans: AttachedEntityView[] = [];
	for (const entity of entities.filter(isAttached)) {
		const parent = entity.placement.parent;
		if (!worldGuids.has(parent)) {
			orphans.push(entity);
			continue;
		}
		const siblings = children.get(parent);
		if (siblings) siblings.push(entity);
		else children.set(parent, [entity]);
	}
	const roots = worldEntities.map((entity) => ({
		entity,
		children: children.get(entity.identity.guid) ?? [],
	}));
	return { roots, orphans };
}
