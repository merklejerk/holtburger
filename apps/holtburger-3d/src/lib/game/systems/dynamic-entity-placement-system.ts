import type { AABB3 } from "../math/types";
import type { SceneGraph, SceneNodeId, ScenePlacement } from "../scene";

/** Sole writer of dynamic entity root placement in the frontend scene graph. */
export class DynamicEntityPlacementSystem {
	readonly #scene: SceneGraph;
	readonly #roots = new Set<SceneNodeId>();

	constructor(scene: SceneGraph) {
		this.#scene = scene;
	}

	/** Create one staged root at the producer's accepted placement. */
	createRoot(
		placement: ScenePlacement,
		localBounds: AABB3 | null,
	): SceneNodeId {
		const nodeId = this.#scene.createNode({
			...placement,
			cullingGroup: "dynamic",
			localBounds,
			parentId: null,
		});
		this.#roots.add(nodeId);
		return nodeId;
	}

	/** Apply one complete accepted root placement; residency and transform stay atomic. */
	updateRoot(nodeId: SceneNodeId, placement: ScenePlacement): void {
		this.#requireRoot(nodeId);
		this.#scene.updateRootPlacement(nodeId, placement);
	}

	/** Retire one leaf root after its presentation children have been removed. */
	destroyRoot(nodeId: SceneNodeId): void {
		this.#requireRoot(nodeId);
		this.#scene.destroyNode(nodeId);
		this.#roots.delete(nodeId);
	}

	#requireRoot(nodeId: SceneNodeId): void {
		if (!this.#roots.has(nodeId)) {
			throw new Error(`Dynamic placement does not own root ${nodeId}.`);
		}
	}
}
