import { Vec3, type AABB3, type Mat4 } from "../math/types";
import type { EnvCellId } from "../game-types";
import { multiplyMat4, transformAABB3 } from "../math/matrices";
import { containsPoint, translateBounds } from "../math/geometry-utils";
import { frustumIntersectsAABB, type Frustum } from "../math/frustum";
import {
	createLandblockWorldOrigin,
	createLandblockOffset,
	getLandblockCoordinates,
	landblockAtWorldPoint,
} from "../landblocks";
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
	cullingGroup: string;
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
	readonly cullingGroup: string;
	readonly nodeId: SceneNodeId;
	readonly placement: ResolvedScenePlacement;
	/** Conservative bounds in the root landblock coordinate frame. */
	readonly landblockBounds: AABB3;
}

interface CullingGroup {
	/** Exact scene entries guarded by this aggregate broad-phase bounds. */
	readonly entries: Set<SceneNodeId>;
	/** Retained bounds buffer, lazily rebuilt after membership or bounds changes. */
	bounds: AABB3 | null;
	/** Whether the retained aggregate must be rebuilt before its next query. */
	dirty: boolean;
	/** Root-landblock coordinate frame shared by all member entry bounds. */
	readonly landblockId: ScenePlacement["landblockId"];
}

/** Mutable backing record for one frame-scoped portal selection buffer slot. */
interface VisiblePortalCrossingBufferSlot {
	id: VisiblePortalCrossing["id"];
	apertureId: VisiblePortalCrossing["apertureId"];
}

export class SceneGraph {
	readonly #nodes = new Map<SceneNodeId, SceneNodeRecord>();
	/** Entries remain individually addressable for exact post-group frustum tests. */
	readonly #spatialEntries = new Map<SceneNodeId, SpatialEntry>();
	/** Scope -> landblock -> producer group -> aggregate bounds and member entries. */
	readonly #cullingGroups = new Map<
		string,
		Map<ScenePlacement["landblockId"], Map<string, CullingGroup>>
	>();
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
	/** Reused landblock translation during frustum testing. */
	readonly #queryOffset = Vec3.zero();
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
		this.#removeSpatialEntry(nodeId);
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
	 * Apertures use broad AABB plus facing tests; nodes use broad AABB tests. Future portal clipping
	 * must preserve the original camera volume for downstream scope traversal.
	 */
	queryFrustum(
		frustum: Frustum,
		anchorLandblockId: ScenePlacement["landblockId"],
		origin: SceneScope,
	): VisibleScene {
		this.#traverseScopes(frustum, anchorLandblockId, origin);
		this.#visibleEntries.length = 0;
		for (const scope of this.#reachableScopeKeys) {
			const landblockGroups = this.#cullingGroups.get(scope);
			if (!landblockGroups) continue;
			for (const groups of landblockGroups.values()) {
				for (const group of groups.values()) {
					const bounds = this.#resolveCullingGroupBounds(group);
					if (
						!bounds ||
						!this.#frustumIntersectsLandblockBounds(
							frustum,
							anchorLandblockId,
							group.landblockId,
							bounds,
						)
					)
						continue;
					for (const nodeId of group.entries) {
						const entry = this.#spatialEntries.get(nodeId);
						if (
							entry &&
							this.#frustumIntersectsEntry(frustum, anchorLandblockId, entry)
						)
							this.#visibleEntries.push(nodeId);
					}
				}
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
		const existingEntry = this.#spatialEntries.get(node.id);
		const existingBounds = existingEntry?.landblockBounds;
		if (node.localBounds === null) {
			this.#removeSpatialEntry(node.id);
			return;
		}
		const placement = this.#resolvePlacement(node.id);
		if (
			placement.envCellId !== null &&
			!this.#envCellScopes.has(placement.envCellId)
		) {
			this.#removeSpatialEntry(node.id);
			return;
		}
		const retainsCullingGroup =
			existingEntry !== undefined &&
			existingEntry.cullingGroup === node.cullingGroup &&
			existingEntry.placement.landblockId === placement.landblockId &&
			sameScope(existingEntry.placement.scope, placement.scope);
		this.#removeSpatialEntry(node.id, !retainsCullingGroup);
		this.#spatialEntries.set(node.id, {
			landblockBounds: transformAABB3(
				placement.localToLandblock,
				node.localBounds,
				existingBounds,
			),
			cullingGroup: node.cullingGroup,
			nodeId: node.id,
			placement,
		});
		this.#addSpatialEntry(this.#spatialEntries.get(node.id)!);
	}

	#removeSpatialEntry(nodeId: SceneNodeId, pruneEmptyGroup = true): void {
		const entry = this.#spatialEntries.get(nodeId);
		if (!entry) return;
		this.#spatialEntries.delete(nodeId);
		const scope = scopeKey(entry.placement.scope);
		const landblockGroups = this.#cullingGroups.get(scope);
		const groups = landblockGroups?.get(entry.placement.landblockId);
		const group = groups?.get(entry.cullingGroup);
		group?.entries.delete(nodeId);
		if (group) group.dirty = true;
		if (pruneEmptyGroup && group?.entries.size === 0) {
			groups?.delete(entry.cullingGroup);
			if (groups?.size === 0) landblockGroups?.delete(entry.placement.landblockId);
			if (landblockGroups?.size === 0) this.#cullingGroups.delete(scope);
		}
	}

	#addSpatialEntry(entry: SpatialEntry): void {
		const scope = scopeKey(entry.placement.scope);
		let landblockGroups = this.#cullingGroups.get(scope);
		if (!landblockGroups)
			this.#cullingGroups.set(scope, (landblockGroups = new Map()));
		let groups = landblockGroups.get(entry.placement.landblockId);
		if (!groups)
			landblockGroups.set(entry.placement.landblockId, (groups = new Map()));
		let group = groups.get(entry.cullingGroup);
		if (!group)
			groups.set(
				entry.cullingGroup,
				(group = {
					bounds: null,
					dirty: true,
					entries: new Set(),
					landblockId: entry.placement.landblockId,
				}),
			);
		group.entries.add(entry.nodeId);
		group.dirty = true;
	}

	#resolveCullingGroupBounds(group: CullingGroup): AABB3 | null {
		if (!group.dirty) return group.bounds;
		let hasBounds = false;
		for (const nodeId of group.entries) {
			const bounds = this.#spatialEntries.get(nodeId)?.landblockBounds;
			if (!bounds) continue;
			if (!hasBounds) {
				group.bounds = (group.bounds ?? bounds.clone()).copy(bounds);
				hasBounds = true;
			}
			else {
				const groupBounds = group.bounds;
				if (!groupBounds)
					throw new Error("Culling group lost bounds during aggregation.");
				groupBounds.union(bounds);
			}
		}
		if (!hasBounds) group.bounds = null;
		group.dirty = false;
		return group.bounds;
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

	#traverseScopes(
		frustum: Frustum,
		anchorLandblockId: ScenePlacement["landblockId"],
		origin: SceneScope,
	): void {
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
					!this.#frustumIntersectsAperture(frustum, anchorLandblockId, crossing)
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

	#frustumIntersectsEntry(
		frustum: Frustum,
		anchorLandblockId: ScenePlacement["landblockId"],
		entry: SpatialEntry,
	): boolean {
		return this.#frustumIntersectsLandblockBounds(
			frustum,
			anchorLandblockId,
			entry.placement.landblockId,
			entry.landblockBounds,
		);
	}

	#frustumIntersectsLandblockBounds(
		frustum: Frustum,
		anchorLandblockId: ScenePlacement["landblockId"],
		landblockId: ScenePlacement["landblockId"],
		bounds: AABB3,
	): boolean {
		const offset = createLandblockOffset(
			getLandblockCoordinates(landblockId),
			getLandblockCoordinates(anchorLandblockId),
			this.#queryOffset,
		);
		return frustumIntersectsAABB(frustum, bounds, offset.x, offset.y, offset.z);
	}

	#frustumIntersectsAperture(
		frustum: Frustum,
		anchorLandblockId: ScenePlacement["landblockId"],
		crossing: ScenePortalCrossingInput,
	): boolean {
		const offset = createLandblockOffset(
			getLandblockCoordinates(crossing.aperture.landblockId),
			getLandblockCoordinates(anchorLandblockId),
			this.#queryOffset,
		);
		if (
			!frustumIntersectsAABB(
				frustum,
				crossing.aperture.landblockBounds,
				offset.x,
				offset.y,
				offset.z,
			)
		)
			return false;
		return apertureFacesCamera(frustum, crossing.aperture, offset);
	}
}

function createSceneNodeRecord(
	nodeId: SceneNodeId,
	input: SceneNodeInput,
): SceneNodeRecord {
	const fields = {
		children: new Set<SceneNodeId>(),
		cullingGroup: input.cullingGroup ?? "default",
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

/**
 * Retain broad portal visibility only when the camera is on the aperture's configured side.
 *
 * Aperture index winding is prepared so its geometric normal faces the positive side; malformed
 * aperture geometry fails open so a missing normal cannot hide an otherwise reachable scope.
 */
function apertureFacesCamera(
	frustum: Frustum,
	aperture: ScenePortalCrossingInput["aperture"],
	offset: Vec3,
): boolean {
	if (aperture.visibleSide === "both") return true;
	if (aperture.vertices.length < 9) return true;
	const ax = aperture.vertices[0]! + offset.x;
	const ay = aperture.vertices[1]! + offset.y;
	const az = aperture.vertices[2]! + offset.z;
	const edgeBX = aperture.vertices[3]! - aperture.vertices[0]!;
	const edgeBY = aperture.vertices[4]! - aperture.vertices[1]!;
	const edgeBZ = aperture.vertices[5]! - aperture.vertices[2]!;
	const edgeCX = aperture.vertices[6]! - aperture.vertices[0]!;
	const edgeCY = aperture.vertices[7]! - aperture.vertices[1]!;
	const edgeCZ = aperture.vertices[8]! - aperture.vertices[2]!;
	const normalX = edgeBY * edgeCZ - edgeBZ * edgeCY;
	const normalY = edgeBZ * edgeCX - edgeBX * edgeCZ;
	const normalZ = edgeBX * edgeCY - edgeBY * edgeCX;
	const signedDistance =
		normalX * (frustum.cameraPosition.x - ax) +
		normalY * (frustum.cameraPosition.y - ay) +
		normalZ * (frustum.cameraPosition.z - az);
	if (signedDistance === 0) return true;
	return aperture.visibleSide === "positive"
		? signedDistance > 0
		: signedDistance < 0;
}
