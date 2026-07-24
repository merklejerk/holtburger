import { Vec3, type AABB3, type Mat4 } from "../math/types";
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
	VisiblePortalCrossing,
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
interface SpatialEntry {
	readonly nodeId: SceneNodeId;
	readonly placement: ResolvedScenePlacement;
	/** Conservative bounds in the root landblock coordinate frame. */
	readonly landblockBounds: AABB3;
}

/** Mutable backing record for one frame-scoped portal selection buffer slot. */
interface VisiblePortalCrossingBufferSlot {
	id: VisiblePortalCrossing["id"];
	apertureId: VisiblePortalCrossing["apertureId"];
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
	/** Reused by every visibility query; contains only primitive selections. */
	readonly #visibleEntries: SceneNodeId[] = [];
	/** Reused portal-selection records, grown only to the largest query result. */
	readonly #visibleCrossings: VisiblePortalCrossingBufferSlot[] = [];
	readonly #visibleScene: VisibleScene = {
		crossings: this.#visibleCrossings,
		entries: this.#visibleEntries,
	};
	/** Reused traversal state for frame-time visibility queries. */
	readonly #reachableScopeKeys = new Set<string>();
	readonly #pendingScopes: SceneScope[] = [];
	readonly #traversedCrossings: ScenePortalCrossingInput[] = [];
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
				localBounds: node.localBounds?.clone() ?? null,
				localTransform: node.localTransform.clone(),
				parentId: null,
			};
		}
		return {
			id: node.id,
			localBounds: node.localBounds?.clone() ?? null,
			localTransform: node.localTransform.clone(),
			parentId: node.parentId,
		};
	}

	/** Return a copied resolved placement for inspection outside frame-time spatial queries. */
	getResolvedPlacement(
		nodeId: SceneNodeId,
	): ResolvedScenePlacement | undefined {
		if (!this.#nodes.has(nodeId)) return undefined;
		return copyResolvedPlacement(this.#resolvePlacement(nodeId));
	}

	updateRootPlacement(nodeId: SceneNodeId, placement: ScenePlacement): void {
		const node = this.#requireNode(nodeId);
		if (node.parentId !== null) {
			throw new Error(`Scene node ${nodeId} is not a root.`);
		}
		node.envCellId = placement.envCellId;
		node.landblockId = placement.landblockId;
		node.localTransform.copy(placement.localTransform);
		this.#syncSpatialSubtree(node.id);
	}

	updateLocalTransform(nodeId: SceneNodeId, transform: Mat4): void {
		const node = this.#requireNode(nodeId);
		if (node.parentId === null) {
			throw new Error(`Scene root ${nodeId} requires a complete placement.`);
		}
		node.localTransform.copy(transform);
		this.#syncSpatialSubtree(node.id);
	}

	updateBounds(nodeId: SceneNodeId, localBounds: AABB3 | null): void {
		const node = this.#requireNode(nodeId);
		node.localBounds =
			localBounds === null
				? null
				: (node.localBounds ?? localBounds.clone()).copy(localBounds);
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
		this.#envCellScopes.set(input.scope.envCellId, {
			landblockBounds: input.landblockBounds?.clone() ?? null,
			potentiallyVisibleEnvCellIds: new Set(input.potentiallyVisibleEnvCellIds),
			scope: { ...input.scope },
		});
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
		this.#portalCrossings.set(input.id, copyPortalCrossing(input));
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
		this.#traverseScopes(camera, origin);
		this.#visibleEntries.length = 0;
		for (const entry of this.#spatialEntries.values()) {
			if (
				this.#reachableScopeKeys.has(scopeKey(entry.placement.scope)) &&
				this.#frustumIntersectsEntry(camera, entry)
			) {
				this.#visibleEntries.push(entry.nodeId);
			}
		}
		this.#syncVisibleCrossings(this.#traversedCrossings);
		return this.#visibleScene;
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

		const localPoint = new Vec3(0, 0, 0);
		for (const { landblockBounds, scope } of this.#envCellScopes.values()) {
			if (scope.landblockId === landblockId && landblockBounds !== null) {
				const origin = createLandblockWorldOrigin(scope.landblockId);
				localPoint.x = point.x - origin.x;
				localPoint.y = point.y - origin.y;
				localPoint.z = point.z - origin.z;
				if (containsPoint(landblockBounds, localPoint)) {
					return {
						envCellId: scope.envCellId,
						landblockId: scope.landblockId,
					};
				}
			}
		}
		return { envCellId: null, landblockId };
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
		let localToLandblock = node.localTransform.clone();
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
					this.#spatialEntries.get(node.id)?.landblockBounds,
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

	#syncVisibleCrossings(crossings: readonly ScenePortalCrossingInput[]): void {
		for (let index = 0; index < crossings.length; index += 1) {
			const crossing = crossings[index]!;
			const target =
				this.#visibleCrossings[index] ??
				(this.#visibleCrossings[index] = {
					apertureId: crossing.aperture.id,
					id: crossing.id,
				});
			target.apertureId = crossing.aperture.id;
			target.id = crossing.id;
		}
		this.#visibleCrossings.length = crossings.length;
	}

	#traverseScopes(camera: Camera, origin: SceneScope): void {
		this.#reachableScopeKeys.clear();
		this.#reachableScopeKeys.add(scopeKey(origin));
		this.#pendingScopes.length = 0;
		this.#pendingScopes.push(origin);
		this.#traversedCrossings.length = 0;
		while (this.#pendingScopes.length > 0) {
			const scope = this.#pendingScopes.pop();
			if (!scope) continue;
			for (const crossing of this.#portalCrossings.values()) {
				if (
					!sameScope(crossing.source, scope) ||
					!this.#frustumIntersectsAperture(camera, crossing)
				) {
					continue;
				}
				this.#traversedCrossings.push(crossing);
				const targetKey = scopeKey(crossing.target);
				if (this.#reachableScopeKeys.has(targetKey)) continue;
				this.#reachableScopeKeys.add(targetKey);
				this.#pendingScopes.push(crossing.target);
			}
		}
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
		localBounds: input.localBounds?.clone() ?? null,
		localTransform: input.localTransform.clone(),
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

function copyResolvedPlacement(
	placement: ResolvedScenePlacement,
): ResolvedScenePlacement {
	return {
		...placement,
		localToLandblock: placement.localToLandblock.clone(),
	};
}

function copyPortalCrossing(
	crossing: ScenePortalCrossingInput,
): ScenePortalCrossingInput {
	return {
		aperture: {
			...crossing.aperture,
			indices: new Uint32Array(crossing.aperture.indices),
			landblockBounds: crossing.aperture.landblockBounds.clone(),
			vertices: new Float32Array(crossing.aperture.vertices),
		},
		id: crossing.id,
		source: { ...crossing.source },
		target: { ...crossing.target },
	};
}
