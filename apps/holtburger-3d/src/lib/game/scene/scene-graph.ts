import type { AABB3, Mat4 } from "../math/types";
import { multiplyMat4 } from "../math/matrices";
import type { Camera } from "../runtime/types";
import type {
	SceneNode,
	SceneNodeId,
	SceneNodeInput,
	ScenePlacement,
	ResolvedScenePlacement,
	VisibleScene,
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

export class SceneGraph {
	readonly #nodes = new Map<SceneNodeId, SceneNodeRecord>();
	/** Placeholder for the composed spatial index. Entries are derived from nodes. */
	readonly #spatialNodeIds = new Set<SceneNodeId>();
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
		this.#syncSpatialMembership(node);
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

	resolvePlacement(nodeId: SceneNodeId): ResolvedScenePlacement {
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

	updateRootPlacement(nodeId: SceneNodeId, placement: ScenePlacement): void {
		const node = this.#requireNode(nodeId);
		if (node.parentId !== null) {
			throw new Error(`Scene node ${nodeId} is not a root.`);
		}
		node.envCellId = placement.envCellId;
		node.landblockId = placement.landblockId;
		node.localTransform = placement.localTransform;
		// TODO: reindex this transform tree when the spatial index is implemented.
	}

	updateLocalTransform(nodeId: SceneNodeId, transform: Mat4): void {
		const node = this.#requireNode(nodeId);
		if (node.parentId === null) {
			throw new Error(`Scene root ${nodeId} requires a complete placement.`);
		}
		node.localTransform = transform;
	}

	updateBounds(nodeId: SceneNodeId, localBounds: AABB3 | null): void {
		const node = this.#requireNode(nodeId);
		node.localBounds = localBounds;
		this.#syncSpatialMembership(node);
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
			this.#spatialNodeIds.delete(removedNodeId);
			this.#nodes.delete(removedNodeId);
		}
		return nodeIds;
	}

	updateVisibility(camera: Camera): VisibleScene {
		// TODO: transform the camera query into each landblock frame and query portals.
		void camera;
		return { nodeIds: [...this.#spatialNodeIds] };
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

	#syncSpatialMembership(node: SceneNodeRecord): void {
		if (node.localBounds === null) {
			this.#spatialNodeIds.delete(node.id);
		} else {
			this.#spatialNodeIds.add(node.id);
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
