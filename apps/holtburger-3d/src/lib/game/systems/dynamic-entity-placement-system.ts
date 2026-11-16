import { AABB3, Mat4 } from "../math/types";
import {
	dynamicEntityPlacementFromPoint,
	interpolateDynamicEntityTransform,
} from "../runtime/dynamic-entity-presentation";
import { evaluateHostDynamicEntityPath } from "../motion/host-dynamic-entity-path";
import { validateHostPlacedPath } from "../motion/host-placed-path";
import type {
	DynamicEntityAdvance,
	DynamicEntityTickBatch,
} from "../runtime/dynamic-entity-feed";
import type { SceneGraph, SceneNodeId, SceneSpatialPlacement } from "../scene";
import type { PreparedSceneRootMembership } from "../scene/scene-graph";

interface ActiveDynamicEntityPath {
	readonly advance: DynamicEntityAdvance;
	readonly durationMs: DynamicEntityTickBatch["durationMs"];
	readonly startedAtMs: number;
	/** Exact points, including pre-resolved residency and membership for each leg boundary. */
	readonly points: PreparedPathPoint[];
	/** Reused only during this path's synchronous frame evaluation. */
	readonly scratchTransform: Mat4;
	appliedPointIndex: number;
}

interface PreparedPathPoint {
	readonly point: DynamicEntityAdvance["path"]["initial"];
	readonly placement: SceneSpatialPlacement;
	readonly membership: PreparedSceneRootMembership;
}

function preparePathPoint(
	point: DynamicEntityAdvance["path"]["initial"],
	scene: SceneGraph,
): PreparedPathPoint {
	const placement = dynamicEntityPlacementFromPoint(point);
	return {
		point,
		placement,
		membership: scene.prepareRootSpatialMembership(placement),
	};
}

/** Sole writer of dynamic entity root placement in the frontend scene graph. */
export class DynamicEntityPlacementSystem {
	readonly #scene: SceneGraph;
	readonly #roots = new Set<SceneNodeId>();
	readonly #activePaths = new Map<SceneNodeId, ActiveDynamicEntityPath>();
	#revision = 0;

	constructor(scene: SceneGraph) {
		this.#scene = scene;
	}

	/** Changes whenever an owned dynamic root's presented placement may have changed. */
	get revision(): number {
		return this.#revision;
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
		this.#markChanged();
		return nodeId;
	}

	/** Apply one complete accepted root placement; residency and transform stay atomic. */
	updateRoot(nodeId: SceneNodeId, placement: SceneSpatialPlacement): void {
		this.#requireRoot(nodeId);
		this.#activePaths.delete(nodeId);
		this.#scene.updateRootSpatialPlacement(nodeId, placement);
		this.#markChanged();
	}

	/** Refresh the canonical endpoint's membership without interrupting accepted travel. */
	refreshMembership(
		nodeId: SceneNodeId,
		point: DynamicEntityAdvance["path"]["initial"],
	): void {
		this.#requireRoot(nodeId);
		const active = this.#activePaths.get(nodeId);
		if (active) {
			// The level producer guarantees an unchanged canonical pose. Earlier path legs
			// retain their placement proofs; the refreshed membership applies at arrival.
			const legs = active.advance.path.legs.map((leg, index, all) =>
				index === all.length - 1 ? { ...leg, end: point } : leg,
			);
			this.#activePaths.set(nodeId, {
				...active,
				advance: { ...active.advance, path: { ...active.advance.path, legs } },
				points: [
					...active.points.slice(0, -1),
					preparePathPoint(point, this.#scene),
				],
			});
			return;
		}
		this.updateRoot(nodeId, dynamicEntityPlacementFromPoint(point));
	}

	/** Replace transient playback with one newer host-accepted path or discontinuous correction. */
	applyPath(
		nodeId: SceneNodeId,
		advance: DynamicEntityAdvance,
		durationMs: DynamicEntityTickBatch["durationMs"],
		startedAtMs: number,
	): void {
		this.#requireRoot(nodeId);
		if (!Number.isFinite(startedAtMs)) {
			throw new Error("Dynamic placement receipt time must be finite.");
		}
		if (advance.kind === "integrated") {
			validateHostPlacedPath(advance.path, durationMs);
			const points = [
				preparePathPoint(advance.path.initial, this.#scene),
				...advance.path.legs.map((leg) =>
					preparePathPoint(leg.end, this.#scene),
				),
			];
			this.#activePaths.set(nodeId, {
				advance,
				durationMs,
				startedAtMs,
				points,
				scratchTransform: Mat4.zero(),
				appliedPointIndex: 0,
			});
			this.#scene.updateRootPreparedSpatialPlacement(
				nodeId,
				points[0].membership,
				points[0].placement.localTransform,
			);
			this.#markChanged();
			return;
		}
		this.#activePaths.delete(nodeId);
		this.#scene.updateRootSpatialPlacement(
			nodeId,
			evaluateHostDynamicEntityPath(advance, durationMs, durationMs),
		);
		this.#markChanged();
	}

	/** Evaluate every active path at frontend render cadence without consulting host topology. */
	advance(nowMs: number): void {
		if (!Number.isFinite(nowMs)) {
			throw new Error("Dynamic placement sample time must be finite.");
		}
		let changed = false;
		for (const [nodeId, active] of this.#activePaths) {
			const elapsedMs = nowMs - active.startedAtMs;
			const pointIndex = this.#samplePath(active, elapsedMs);
			if (pointIndex !== active.appliedPointIndex) {
				const point = active.points[pointIndex];
				this.#scene.updateRootPreparedSpatialPlacement(
					nodeId,
					point.membership,
					active.scratchTransform,
				);
				active.appliedPointIndex = pointIndex;
			} else {
				this.#scene.updateRootLocalTransform(nodeId, active.scratchTransform);
			}
			changed = true;
			if (elapsedMs >= active.durationMs) this.#activePaths.delete(nodeId);
		}
		if (changed) this.#markChanged();
	}

	/** Select half-open leg metadata, writing only its current transform into owned scratch. */
	#samplePath(active: ActiveDynamicEntityPath, elapsedMs: number): number {
		const progress = Math.min(Math.max(elapsedMs / active.durationMs, 0), 1);
		let startFraction = 0;
		for (let index = 0; index < active.advance.path.legs.length; index += 1) {
			const endFraction = active.advance.path.legs[index].endFraction;
			if (progress < endFraction) {
				interpolateDynamicEntityTransform(
					active.points[index].point,
					active.points[index + 1].point,
					(progress - startFraction) / (endFraction - startFraction),
					active.scratchTransform,
				);
				return index;
			}
			if (progress === endFraction) {
				active.scratchTransform.copy(
					active.points[index + 1].placement.localTransform,
				);
				return index + 1;
			}
			startFraction = endFraction;
		}
		throw new Error(
			"Validated dynamic path did not cover its current progress.",
		);
	}

	/** Retire one leaf root after its presentation children have been removed. */
	destroyRoot(nodeId: SceneNodeId): void {
		this.#requireRoot(nodeId);
		this.#activePaths.delete(nodeId);
		this.#scene.destroyNode(nodeId);
		this.#roots.delete(nodeId);
		this.#markChanged();
	}

	#markChanged(): void {
		this.#revision += 1;
		if (!Number.isSafeInteger(this.#revision)) {
			throw new Error("Dynamic placement revision exhausted.");
		}
	}

	#requireRoot(nodeId: SceneNodeId): void {
		if (!this.#roots.has(nodeId)) {
			throw new Error(`Dynamic placement does not own root ${nodeId}.`);
		}
	}
}
