import type { AABB3, Mat4, Vec3 } from "../math/types";
import type { EnvCellId } from "../game-types";
import { multiplyMat4, transformAABB3 } from "../math/matrices";
import { containsPoint, translateBounds } from "../math/geometry-utils";
import {
	createLandblockWorldOrigin,
	landblockAtWorldPoint,
} from "../landblocks";
import type { Camera } from "../runtime/types";
import type {
	SceneNode,
	SceneNodeId,
	SceneNodeInput,
	ScenePlacement,
	SceneEnvCellScopeInput,
	ScenePortalCrossingInput,
	SceneScope,
	PortalCrossingId,
	ResolvedScenePlacement,
	SceneResidency,
	VisibleScene,
	VisibleSceneEntry,
} from ".";
import { scopeFor, sameScope, scopeKey } from "./scope";
import { createSceneNodeId } from "./utils";

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
	readonly #envCellScopes = new Map<EnvCellId, SceneEnvCellScopeInput>();
	readonly #portalCrossings = new Map<
		PortalCrossingId,
		ScenePortalCrossingInput
	>();
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

	/** Destroy one leaf; resident systems remove owned trees explicitly from leaves to roots. */
	destroyNode(nodeId: SceneNodeId): void {
		const node = this.#requireNode(nodeId);
		if (node.children.size > 0) {
			throw new Error(
				`Cannot destroy scene node ${nodeId} while it still has children.`,
			);
		}
		if (node.parentId !== null) {
			this.#requireNode(node.parentId).children.delete(nodeId);
		}
		this.#spatialEntries.delete(nodeId);
		this.#nodes.delete(nodeId);
	}

	upsertEnvCellScope(input: SceneEnvCellScopeInput): void {
		this.#envCellScopes.set(input.scope.envCellId, input);
		this.#syncEnvCellRoots(input.scope.envCellId);
	}

	removeEnvCellScope(scope: Extract<SceneScope, { kind: "env-cell" }>): void {
		for (const crossing of this.#portalCrossings.values()) {
			if (
				sameScope(crossing.source, scope) ||
				sameScope(crossing.target, scope)
			) {
				throw new Error(
					`Cannot remove env-cell scope ${scope.envCellId} while crossing ${crossing.id} references it.`,
				);
			}
		}
		this.#envCellScopes.delete(scope.envCellId);
		this.#syncEnvCellRoots(scope.envCellId);
	}

	upsertPortalCrossing(input: ScenePortalCrossingInput): void {
		this.#portalCrossings.set(input.id, input);
	}

	removePortalCrossing(crossingId: PortalCrossingId): void {
		this.#portalCrossings.delete(crossingId);
	}

	/**
	 * Conservatively query the scopes reachable through apertures intersecting the original frustum.
	 *
	 * Node and aperture intersection remain always-pass stubs. Future spatial tests must use the
	 * original camera volume throughout traversal rather than clipping it at each aperture.
	 */
	queryFrustum(camera: Camera, origin: SceneScope): VisibleScene {
		const { crossings, reachable } = this.#traverseScopes(camera, origin);
		return {
			entries: [...this.#spatialEntries.values()]
				.filter(
					(entry) =>
						reachable.has(scopeKey(entry.placement.scope)) &&
						this.#frustumIntersectsEntry(camera, entry),
				)
				.map(({ nodeId, placement }) => ({
					nodeId,
					placement,
				})),
			crossings,
		};
	}

	/**
	 * Resolve one canonical scene-space point against currently resident scopes.
	 *
	 * Environment-cell containment is conservatively bounds-based until prepared
	 * BSP queries are available. Overlapping bounds select the first resident
	 * scope in stable scene insertion order.
	 */
	queryWorldPointResidency(point: Vec3): SceneResidency | null {
		const landblockId = landblockAtWorldPoint(point);
		if (!landblockId) return null;

		const containingCell = [...this.#envCellScopes.values()].find(
			({ landblockBounds, scope }) =>
				scope.landblockId === landblockId &&
				landblockBounds !== null &&
				containsPoint(
					translateBounds(
						landblockBounds,
						createLandblockWorldOrigin(scope.landblockId),
					),
					point,
				),
		);
		return containingCell
			? {
					envCellId: containingCell.scope.envCellId,
					landblockId: containingCell.scope.landblockId,
				}
			: { envCellId: null, landblockId };
	}

	/** Return the current world-space bounds for one installed environment-cell scope. */
	queryEnvCellBounds(envCellId: EnvCellId): AABB3 | null {
		const scope = this.#envCellScopes.get(envCellId);
		if (!scope?.landblockBounds) return null;
		return translateBounds(
			scope.landblockBounds,
			createLandblockWorldOrigin(scope.scope.landblockId),
		);
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
			scope: scopeFor(node.landblockId, node.envCellId),
			localToLandblock,
		};
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
		if (node.localBounds === null || !this.#isResolved(node.id)) {
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

	#isResolved(nodeId: SceneNodeId): boolean {
		const placement = this.#resolvePlacement(nodeId);
		return (
			placement.envCellId === null ||
			this.#envCellScopes.has(placement.envCellId)
		);
	}

	#syncEnvCellRoots(envCellId: EnvCellId): void {
		for (const node of this.#nodes.values()) {
			if (node.parentId === null && node.envCellId === envCellId) {
				this.#syncSpatialSubtree(node.id);
			}
		}
	}

	#traverseScopes(
		camera: Camera,
		origin: SceneScope,
	): {
		readonly crossings: ScenePortalCrossingInput[];
		readonly reachable: Set<string>;
	} {
		const reachable = new Set([scopeKey(origin)]);
		const pending = [origin];
		const crossings: ScenePortalCrossingInput[] = [];
		while (pending.length > 0) {
			const scope = pending.pop();
			if (!scope) continue;
			for (const crossing of this.#portalCrossings.values()) {
				if (
					!sameScope(crossing.source, scope) ||
					!this.#frustumIntersectsAperture(camera, crossing)
				) {
					continue;
				}
				crossings.push(crossing);
				const targetKey = scopeKey(crossing.target);
				if (reachable.has(targetKey)) continue;
				reachable.add(targetKey);
				pending.push(crossing.target);
			}
		}
		return { crossings, reachable };
	}

	#frustumIntersectsEntry(camera: Camera, entry: SpatialEntry): boolean {
		void camera;
		void entry;
		return true;
	}

	#frustumIntersectsAperture(
		camera: Camera,
		crossing: ScenePortalCrossingInput,
	): boolean {
		void camera;
		void crossing;
		return true;
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
