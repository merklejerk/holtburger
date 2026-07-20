import type { AABB3, Mat4 } from "../math/types";
import { multiplyMat4, transformAABB3 } from "../math/matrices";
import type { Camera } from "../runtime/types";
import type {
	SceneNode,
	SceneNodeId,
	SceneNodeInput,
	ScenePlacement,
	ResolvedScenePlacement,
	VisibleScene,
	VisibleSceneEntry,
} from ".";

type SceneNodeRecord = {
	id: SceneNodeId;
	localBounds: AABB3 | null;
	localTransform: Mat4;
	readonly children: Set<SceneNodeId>;
} & (
	| {
			envCellId: ScenePlacement["envCellId"];
			landblockId: ScenePlacement["landblockId"];
			parentId: null;
	  }
	| {
			parentId: SceneNodeId;
	  }
);

/** Derived landblock-local entry used by the composed spatial index. */
interface SpatialEntry extends VisibleSceneEntry {
	/** Conservative bounds in the root landblock coordinate frame. */
	readonly landblockBounds: AABB3;
}

export class SceneGraph {
	readonly #nodes = new Map<SceneNodeId, SceneNodeRecord>();
	/** Brute-force stand-in for the composed per-landblock spatial index. */
	readonly #spatialEntries = new Map<SceneNodeId, SpatialEntry>();
	#nextNodeId = 0;

	createNode(input: SceneNodeInput): SceneNodeId {
		if (input.parentId !== null) {
			this.#requireNode(input.parentId);
		}

		const nodeId = createSceneNodeId(this.#nextNodeId);
		this.#nextNodeId += 1;
		const node = createSceneNodeRecord(nodeId, input);
		this.#nodes.set(nodeId, node);
		if (node.parentId !== null) {
			this.#requireNode(node.parentId).children.add(nodeId);
		}
		this.#syncSpatialSubtree(node.id);
		return nodeId;
	}

	getNode(nodeId: SceneNodeId): SceneNode | undefined {
		const node = this.#nodes.get(nodeId);
		if (!node) return undefined;
		if (node.parentId === null) {
			return {
				envCellId: node.envCellId,
				id: node.id,
				landblockId: node.landblockId,
				localBounds: node.localBounds,
				localTransform: node.localTransform,
				parentId: null,
			};
		}
		return {
			id: node.id,
			localBounds: node.localBounds,
			localTransform: node.localTransform,
			parentId: node.parentId,
		};
	}

	updateRootPlacement(nodeId: SceneNodeId, placement: ScenePlacement): void {
		const node = this.#requireNode(nodeId);
		if (node.parentId !== null) {
			throw new Error(`Scene node ${nodeId} is not a root.`);
		}
		node.envCellId = placement.envCellId;
		node.landblockId = placement.landblockId;
		node.localTransform = placement.localTransform;
		this.#syncSpatialSubtree(node.id);
	}

	updateLocalTransform(nodeId: SceneNodeId, transform: Mat4): void {
		const node = this.#requireNode(nodeId);
		if (node.parentId === null) {
			throw new Error(`Scene root ${nodeId} requires a complete placement.`);
		}
		node.localTransform = transform;
		this.#syncSpatialSubtree(node.id);
	}

	updateBounds(nodeId: SceneNodeId, localBounds: AABB3 | null): void {
		const node = this.#requireNode(nodeId);
		node.localBounds = localBounds;
		this.#syncSpatialEntry(node);
	}

	/** Destroy a root node and all of its transform descendants. */
	destroyNode(nodeId: SceneNodeId): readonly SceneNodeId[] {
		const root = this.#requireNode(nodeId);
		if (root.parentId !== null) {
			throw new Error(`Cannot destroy parented scene node ${nodeId}.`);
		}
		const nodeIds = this.#collectDescendants(nodeId).reverse();
		for (const removedNodeId of nodeIds) {
			const node = this.#requireNode(removedNodeId);
			if (node.parentId !== null) {
				this.#requireNode(node.parentId).children.delete(removedNodeId);
			}
			this.#spatialEntries.delete(removedNodeId);
			this.#nodes.delete(removedNodeId);
		}
		return nodeIds;
	}

	/**
	 * Return spatial-query results with placements captured from the entries used to query.
	 * Frustum tests and portal traversal will replace the current brute-force selection.
	 */
	updateVisibility(camera: Camera): VisibleScene {
		// TODO: transform the camera query into each landblock frame and query portals.
		void camera;
		return {
			entries: [...this.#spatialEntries.values()].map(
				({ nodeId, placement }) => ({
					nodeId,
					placement,
				}),
			),
		};
	}

	/** Resolve inherited residency and flatten one node transform into landblock-local coordinates. */
	#resolvePlacement(nodeId: SceneNodeId): ResolvedScenePlacement {
		let node = this.#requireNode(nodeId);
		let localToLandblock = node.localTransform;
		while (node.parentId !== null) {
			node = this.#requireNode(node.parentId);
			localToLandblock = multiplyMat4(node.localTransform, localToLandblock);
		}
		return {
			envCellId: node.envCellId,
			landblockId: node.landblockId,
			localToLandblock,
		};
	}

	#collectDescendants(nodeId: SceneNodeId): SceneNodeId[] {
		const node = this.#requireNode(nodeId);
		const nodeIds = [node.id];
		for (const childId of node.children) {
			nodeIds.push(...this.#collectDescendants(childId));
		}
		return nodeIds;
	}

	#requireNode(nodeId: SceneNodeId): SceneNodeRecord {
		const node = this.#nodes.get(nodeId);
		if (!node) {
			throw new Error(`Scene node ${nodeId} does not exist.`);
		}
		return node;
	}

	#syncSpatialSubtree(nodeId: SceneNodeId): void {
		const node = this.#requireNode(nodeId);
		this.#syncSpatialEntry(node);
		for (const childId of node.children) this.#syncSpatialSubtree(childId);
	}

	#syncSpatialEntry(node: SceneNodeRecord): void {
		if (node.localBounds === null) {
			this.#spatialEntries.delete(node.id);
		} else {
			const placement = this.#resolvePlacement(node.id);
			this.#spatialEntries.set(node.id, {
				landblockBounds: transformAABB3(
					placement.localToLandblock,
					node.localBounds,
				),
				nodeId: node.id,
				placement,
			});
		}
	}
}

function createSceneNodeRecord(
	nodeId: SceneNodeId,
	input: SceneNodeInput,
): SceneNodeRecord {
	const fields = {
		children: new Set<SceneNodeId>(),
		id: nodeId,
		localBounds: input.localBounds,
		localTransform: input.localTransform,
	};
	if (input.parentId === null) {
		return {
			...fields,
			envCellId: input.envCellId,
			landblockId: input.landblockId,
			parentId: null,
		};
	}
	return {
		...fields,
		parentId: input.parentId,
	};
}

function createSceneNodeId(id: number): SceneNodeId {
	return `scene-node:${id}`;
}
