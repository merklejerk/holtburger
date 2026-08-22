import type { AABB3 } from "../math/types";
import { evaluateHostDynamicEntityPath } from "../motion/host-dynamic-entity-path";
import type {
	DynamicEntityAdvance,
	DynamicEntityAdvanceBatch,
} from "../runtime/dynamic-entity-feed";
import type { SceneGraph, SceneNodeId, SceneSpatialPlacement } from "../scene";

interface ActiveDynamicEntityPath {
	readonly advance: DynamicEntityAdvance;
	readonly durationMs: DynamicEntityAdvanceBatch["durationMs"];
	readonly startedAtMs: number;
}

/** Sole writer of dynamic entity root placement in the frontend scene graph. */
export class DynamicEntityPlacementSystem {
	readonly #scene: SceneGraph;
	readonly #roots = new Set<SceneNodeId>();
	readonly #activePaths = new Map<SceneNodeId, ActiveDynamicEntityPath>();

	constructor(scene: SceneGraph) {
		this.#scene = scene;
	}

	/** Create one staged root at the producer's accepted placement. */
	createRoot(
		placement: SceneSpatialPlacement,
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
	updateRoot(nodeId: SceneNodeId, placement: SceneSpatialPlacement): void {
		this.#requireRoot(nodeId);
		this.#activePaths.delete(nodeId);
		this.#scene.updateRootSpatialPlacement(nodeId, placement);
	}

	/** Replace transient playback with one newer host-accepted path or discontinuous correction. */
	applyPath(
		nodeId: SceneNodeId,
		advance: DynamicEntityAdvance,
		durationMs: DynamicEntityAdvanceBatch["durationMs"],
		startedAtMs: number,
	): void {
		this.#requireRoot(nodeId);
		if (advance.kind === "integrated") {
			this.#activePaths.set(nodeId, { advance, durationMs, startedAtMs });
			this.#scene.updateRootSpatialPlacement(
				nodeId,
				evaluateHostDynamicEntityPath(advance, durationMs, 0),
			);
			return;
		}
		this.#activePaths.delete(nodeId);
		this.#scene.updateRootSpatialPlacement(
			nodeId,
			evaluateHostDynamicEntityPath(advance, durationMs, durationMs),
		);
	}

	/** Evaluate every active path at frontend render cadence without consulting host topology. */
	advance(nowMs: number): void {
		for (const [nodeId, active] of this.#activePaths) {
			const elapsedMs = nowMs - active.startedAtMs;
			this.#scene.updateRootSpatialPlacement(
				nodeId,
				evaluateHostDynamicEntityPath(
					active.advance,
					active.durationMs,
					elapsedMs,
				),
			);
			if (elapsedMs >= active.durationMs) this.#activePaths.delete(nodeId);
		}
	}

	/** Retire one leaf root after its presentation children have been removed. */
	destroyRoot(nodeId: SceneNodeId): void {
		this.#requireRoot(nodeId);
		this.#activePaths.delete(nodeId);
		this.#scene.destroyNode(nodeId);
		this.#roots.delete(nodeId);
	}

	#requireRoot(nodeId: SceneNodeId): void {
		if (!this.#roots.has(nodeId)) {
			throw new Error(`Dynamic placement does not own root ${nodeId}.`);
		}
	}
}
