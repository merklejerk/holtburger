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
	ScenePortalTraceQuery,
	ScenePortalTraceResult,
	SceneScope,
	SceneTopologyScope,
	SceneTopologyView,
	PortalCrossingId,
	ResolvedScenePlacement,
	ResolvedSceneBounds,
	ScenePointResidencyCandidates,
	VisibleScene,
} from ".";
import { cellContainsLandblockPoint } from "./cell-containment";
import {
	traceScenePortalSegment,
	type SceneUnavailablePortalBoundary,
} from "./portal-trace";
import { scopeFor, sameScope, scopeKey } from "./scope";
import { createSceneNodeId } from "./utils";

const EMPTY_PORTAL_CROSSINGS: readonly ScenePortalCrossingInput[] =
	Object.freeze([]);

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
	/** Directed topology indexed once at publication rather than scanned during traversal. */
	readonly #outgoingCrossings = new Map<
		string,
		Map<PortalCrossingId, ScenePortalCrossingInput>
	>();
	/** Outdoor-side blockers synthesized only for unclaimed one-way exterior endpoints. */
	readonly #unavailableExteriorBoundaries = new Map<
		string,
		Map<string, SceneUnavailablePortalBoundary>
	>();
	/** Reused by every visibility query; contains only primitive selections. */
	readonly #visibleEntries: SceneNodeId[] = [];
	readonly #visibleScene: VisibleScene = {
		entries: this.#visibleEntries,
	};
	/** Reused explicit selection state for frame-time spatial queries. */
	readonly #selectedScopeKeys = new Set<string>();
	/** Reused landblock translation during frustum testing. */
	readonly #queryOffset = Vec3.zero();
	/** Monotonic source revision for retained renderer-facing topology facts. */
	#topologyRevision = 0;
	/** Lazily rebuilt only after scope or crossing publication changes. */
	#topologyView: SceneTopologyView | null = null;
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

	/** Return the producer-owned broad-phase group for one live scene node. */
	getCullingGroup(nodeId: SceneNodeId): string | null {
		return this.#nodes.get(nodeId)?.cullingGroup ?? null;
	}

	/** Return a copied resolved placement for inspection outside frame-time spatial queries. */
	getResolvedPlacement(
		nodeId: SceneNodeId,
	): ResolvedScenePlacement | undefined {
		if (!this.#nodes.has(nodeId)) return undefined;
		return copyResolvedPlacement(this.#resolvePlacement(nodeId));
	}

	/** Return one bounded node's colocated local envelope and resolved placement. */
	getResolvedBounds(nodeId: SceneNodeId): ResolvedSceneBounds | null {
		const node = this.#nodes.get(nodeId);
		if (!node?.localBounds) return null;
		return {
			localBounds: node.localBounds.clone(),
			placement: copyResolvedPlacement(this.#resolvePlacement(nodeId)),
		};
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

	/**
	 * Move a root node under another object's node, so that object owns its position.
	 *
	 * This is object-to-object attachment, the only hierarchy retail actually has. It takes an
	 * already-resolved target node and offset transform rather than a named attach point, because
	 * the same mechanism carries wielded items, particle emitters, and scripts
	 * (`ParticleEmitter::SetParenting`, `acclient.c:317404`); only wielding derives its target from a
	 * holding-location lookup, and that lookup belongs to the caller.
	 *
	 * The node crosses from the root arm of the node union to the child arm, surrendering its own
	 * residency and inheriting its new ancestor's. Detaching requires a placement precisely because
	 * that residency is gone rather than remembered.
	 */
	attachToPart(
		nodeId: SceneNodeId,
		parentNodeId: SceneNodeId,
		localTransform: Mat4,
	): void {
		const node = this.#requireNode(nodeId);
		if (node.parentId !== null) {
			throw new Error(`Scene node ${nodeId} is already attached.`);
		}
		this.#requireNode(parentNodeId);
		if (this.#isSelfOrDescendant(parentNodeId, nodeId)) {
			throw new Error(
				`Cannot attach scene node ${nodeId} to its own descendant ${parentNodeId}.`,
			);
		}
		this.#nodes.set(nodeId, {
			...carriedNodeFields(node, localTransform),
			parentId: parentNodeId,
		});
		this.#requireNode(parentNodeId).children.add(nodeId);
		this.#syncSpatialSubtree(nodeId);
	}

	/** Return an attached node to the world under its own residency. */
	detachToPlacement(nodeId: SceneNodeId, placement: ScenePlacement): void {
		const node = this.#requireNode(nodeId);
		if (node.parentId === null) {
			throw new Error(`Scene node ${nodeId} is not attached.`);
		}
		this.#requireNode(node.parentId).children.delete(nodeId);
		this.#nodes.set(nodeId, {
			...carriedNodeFields(node, placement.localTransform),
			envCellId: placement.envCellId,
			landblockId: placement.landblockId,
			parentId: null,
		});
		this.#syncSpatialSubtree(nodeId);
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
			containmentPlanes: new Float32Array(input.containmentPlanes),
			landblockBounds: input.landblockBounds?.clone() ?? null,
			potentiallyVisibleEnvCellIds: new Set(input.potentiallyVisibleEnvCellIds),
			scope: { ...input.scope },
			structureToLandblock: input.structureToLandblock.clone(),
			visibilityIslandId: input.visibilityIslandId,
		});
		this.#syncEnvCellRoots(input.scope.envCellId);
		this.#markTopologyChanged();
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
		const removed = this.#envCellScopes.delete(scope.envCellId);
		this.#syncEnvCellRoots(scope.envCellId);
		if (removed) this.#markTopologyChanged();
	}

	upsertPortalCrossing(input: ScenePortalCrossingInput): void {
		const existing = this.#portalCrossings.get(input.id);
		if (existing) {
			this.#removeOutgoingCrossing(existing);
			this.#removeUnavailableExteriorBoundary(existing);
		}
		const crossing = copyPortalCrossing(input);
		this.#portalCrossings.set(input.id, crossing);
		const sourceKey = scopeKey(crossing.source);
		const outgoing =
			this.#outgoingCrossings.get(sourceKey) ??
			new Map<PortalCrossingId, ScenePortalCrossingInput>();
		outgoing.set(crossing.id, crossing);
		this.#outgoingCrossings.set(sourceKey, outgoing);
		this.#upsertUnavailableExteriorBoundary(crossing);
		this.#markTopologyChanged();
	}

	removePortalCrossing(crossingId: PortalCrossingId): void {
		const crossing = this.#portalCrossings.get(crossingId);
		if (crossing) {
			this.#removeOutgoingCrossing(crossing);
			this.#removeUnavailableExteriorBoundary(crossing);
			this.#portalCrossings.delete(crossingId);
			this.#markTopologyChanged();
		}
	}

	/** Trace a future camera endpoint from caller-supplied authoritative actor residency. */
	tracePortalSegment(query: ScenePortalTraceQuery): ScenePortalTraceResult {
		return traceScenePortalSegment(query, {
			isScopeAvailable: (scope) => {
				if (scope.kind === "outdoor") return true;
				const installed = this.#envCellScopes.get(scope.envCellId);
				return installed !== undefined && sameScope(installed.scope, scope);
			},
			maximumCrossingCount: this.#portalCrossings.size,
			outgoing: (scope) => [
				...(this.#outgoingCrossings.get(scopeKey(scope))?.values() ?? []),
			],
			unavailableBoundaries: (scope) => [
				...(this.#unavailableExteriorBoundaries
					.get(scopeKey(scope))
					?.values() ?? []),
			],
		});
	}

	/**
	 * Select bounded nodes from caller-chosen scopes without applying portal traversal policy.
	 *
	 * The result buffer is reused by later queries. Callers that need retained per-scope content
	 * must consume or copy the primitive node identities before issuing another scene query.
	 */
	queryScopesFrustum(
		frustum: Frustum,
		anchorLandblockId: ScenePlacement["landblockId"],
		scopes: readonly SceneScope[],
	): VisibleScene {
		this.#selectedScopeKeys.clear();
		for (const scope of scopes) {
			this.#requireResidentScope(scope);
			this.#selectedScopeKeys.add(scopeKey(scope));
		}
		this.#selectEntries(frustum, anchorLandblockId);
		return this.#visibleScene;
	}

	/** Select outdoor plus every resident EnvCell scope without consulting portal topology. */
	queryFlatFrustum(
		frustum: Frustum,
		anchorLandblockId: ScenePlacement["landblockId"],
	): VisibleScene {
		this.#selectedScopeKeys.clear();
		this.#selectedScopeKeys.add(scopeKey({ kind: "outdoor" }));
		for (const { scope } of this.#envCellScopes.values()) {
			this.#selectedScopeKeys.add(scopeKey(scope));
		}
		this.#selectEntries(frustum, anchorLandblockId);
		return this.#visibleScene;
	}

	/** Return the retained topology facts for the current publication revision. */
	getPortalTopologyView(): SceneTopologyView {
		if (this.#topologyView?.revision === this.#topologyRevision) {
			return this.#topologyView;
		}
		const scopes: SceneTopologyScope[] = [
			{
				potentiallyVisibleEnvCellIds: new Set(),
				scope: { kind: "outdoor" },
				visibilityIslandId: null,
			},
			...[...this.#envCellScopes.values()]
				.sort((left, right) =>
					scopeKey(left.scope).localeCompare(scopeKey(right.scope)),
				)
				.map(({ potentiallyVisibleEnvCellIds, scope, visibilityIslandId }) => ({
					potentiallyVisibleEnvCellIds: new Set(potentiallyVisibleEnvCellIds),
					scope: { ...scope },
					visibilityIslandId,
				})),
		];
		const crossings = [...this.#portalCrossings.values()].sort((left, right) =>
			left.id.localeCompare(right.id),
		);
		const outgoing = new Map<string, readonly ScenePortalCrossingInput[]>();
		for (const [source, sourceCrossings] of this.#outgoingCrossings) {
			outgoing.set(
				source,
				Object.freeze(
					[...sourceCrossings.values()].sort((left, right) =>
						left.id.localeCompare(right.id),
					),
				),
			);
		}
		const view: SceneTopologyView = {
			crossings: Object.freeze(crossings),
			outgoing: (scope) =>
				outgoing.get(scopeKey(scope)) ?? EMPTY_PORTAL_CROSSINGS,
			revision: this.#topologyRevision,
			scopes: Object.freeze(scopes),
		};
		this.#topologyView = Object.freeze(view);
		return this.#topologyView;
	}

	#selectEntries(
		frustum: Frustum,
		anchorLandblockId: ScenePlacement["landblockId"],
	): void {
		this.#visibleEntries.length = 0;
		for (const scope of this.#selectedScopeKeys) {
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
	}

	/** Return every broad-phase scope candidate and its exact retail containment verdict. */
	queryWorldPointResidencyCandidates(
		point: Vec3,
	): ScenePointResidencyCandidates | null {
		const landblockId = landblockAtWorldPoint(point);
		if (!landblockId) return null;

		const localPoints = new Map<ScenePlacement["landblockId"], Vec3>();
		const envCells = [];
		for (const {
			containmentPlanes,
			landblockBounds,
			scope,
			structureToLandblock,
		} of this.#envCellScopes.values()) {
			if (landblockBounds === null) continue;
			let localPoint = localPoints.get(scope.landblockId);
			if (!localPoint) {
				const origin = createLandblockWorldOrigin(scope.landblockId);
				localPoint = new Vec3(
					point.x - origin.x,
					point.y - origin.y,
					point.z - origin.z,
				);
				localPoints.set(scope.landblockId, localPoint);
			}
			if (!containsPoint(landblockBounds, localPoint)) continue;
			envCells.push({
				containsPoint: cellContainsLandblockPoint(
					containmentPlanes,
					structureToLandblock,
					localPoint,
				),
				envCellId: scope.envCellId,
				landblockId: scope.landblockId,
			});
		}
		envCells.sort((left, right) =>
			left.envCellId.localeCompare(right.envCellId),
		);
		return {
			envCells,
			outdoor: { envCellId: null, landblockId },
		};
	}

	/** Test one explicitly selected resident EnvCell without deriving identity from world overlap. */
	queryEnvCellPointContainment(
		envCellId: EnvCellId,
		point: Vec3,
	): boolean | null {
		const cell = this.#envCellScopes.get(envCellId);
		if (!cell?.landblockBounds) return null;
		const origin = createLandblockWorldOrigin(cell.scope.landblockId);
		const localPoint = new Vec3(
			point.x - origin.x,
			point.y - origin.y,
			point.z - origin.z,
		);
		return (
			containsPoint(cell.landblockBounds, localPoint) &&
			cellContainsLandblockPoint(
				cell.containmentPlanes,
				cell.structureToLandblock,
				localPoint,
			)
		);
	}

	/** Whether at least one EnvCell scope from this landblock is currently resident. */
	hasEnvCellTopology(landblockId: ScenePlacement["landblockId"]): boolean {
		for (const { scope } of this.#envCellScopes.values()) {
			if (scope.landblockId === landblockId) return true;
		}
		return false;
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

	/** Return the proof-backed render-scheduling island for one installed EnvCell scope. */
	getEnvCellVisibilityIslandId(
		envCellId: EnvCellId,
	): SceneEnvCellScopeInput["visibilityIslandId"] | null {
		return this.#envCellScopes.get(envCellId)?.visibilityIslandId ?? null;
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

	/** Guard the acyclic invariant `#resolvePlacement`'s ancestor walk depends on. */
	#isSelfOrDescendant(
		candidateId: SceneNodeId,
		ancestorId: SceneNodeId,
	): boolean {
		let node = this.#requireNode(candidateId);
		while (true) {
			if (node.id === ancestorId) return true;
			if (node.parentId === null) return false;
			node = this.#requireNode(node.parentId);
		}
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
			if (groups?.size === 0)
				landblockGroups?.delete(entry.placement.landblockId);
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
			} else {
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

	#markTopologyChanged(): void {
		this.#topologyRevision += 1;
		this.#topologyView = null;
	}

	#requireResidentScope(scope: SceneScope): void {
		if (scope.kind === "outdoor") return;
		const installed = this.#envCellScopes.get(scope.envCellId);
		if (!installed || !sameScope(installed.scope, scope)) {
			throw new Error(
				`Selected scene scope ${scopeKey(scope)} is not resident.`,
			);
		}
	}

	#removeOutgoingCrossing(crossing: ScenePortalCrossingInput): void {
		const sourceKey = scopeKey(crossing.source);
		const outgoing = this.#outgoingCrossings.get(sourceKey);
		outgoing?.delete(crossing.id);
		if (outgoing?.size === 0) this.#outgoingCrossings.delete(sourceKey);
	}

	#upsertUnavailableExteriorBoundary(crossing: ScenePortalCrossingInput): void {
		if (
			crossing.source.kind !== "env-cell" ||
			crossing.target.kind !== "outdoor" ||
			crossing.reciprocalCrossingId !== null ||
			crossing.spatialRelationship.kind !== "exterior-transition"
		) {
			return;
		}
		const source: SceneScope = { kind: "outdoor" };
		const sourceKey = scopeKey(source);
		const boundaries =
			this.#unavailableExteriorBoundaries.get(sourceKey) ??
			new Map<string, SceneUnavailablePortalBoundary>();
		const id = unavailableExteriorBoundaryId(crossing);
		boundaries.set(id, {
			acceptedSide:
				crossing.acceptedSide === "positive" ? "negative" : "positive",
			aperture: crossing.sourceAperture,
			id,
			source,
		});
		this.#unavailableExteriorBoundaries.set(sourceKey, boundaries);
	}

	#removeUnavailableExteriorBoundary(crossing: ScenePortalCrossingInput): void {
		const sourceKey = scopeKey({ kind: "outdoor" });
		const boundaries = this.#unavailableExteriorBoundaries.get(sourceKey);
		boundaries?.delete(unavailableExteriorBoundaryId(crossing));
		if (boundaries?.size === 0) {
			this.#unavailableExteriorBoundaries.delete(sourceKey);
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

/**
 * Fields that survive a node moving between arms of the union.
 *
 * Identity, children, bounds, and culling group belong to the node; residency belongs to the arm.
 * Rebuilding the record rather than mutating it is what keeps the arms enforced by construction.
 */
function carriedNodeFields(node: SceneNodeRecord, localTransform: Mat4) {
	return {
		children: node.children,
		cullingGroup: node.cullingGroup,
		id: node.id,
		localBounds: node.localBounds,
		localTransform: node.localTransform.copy(localTransform),
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
		acceptedSide: crossing.acceptedSide,
		exactMatch: crossing.exactMatch,
		id: crossing.id,
		maskDepthPolicy: crossing.maskDepthPolicy,
		reciprocalCrossingId: crossing.reciprocalCrossingId,
		source: { ...crossing.source },
		sourceAperture: copyPortalAperture(crossing.sourceAperture),
		spatialRelationship: { ...crossing.spatialRelationship },
		target: { ...crossing.target },
		visibilityAperture: copyPortalAperture(crossing.visibilityAperture),
	};
}

function copyPortalAperture(
	aperture: ScenePortalCrossingInput["sourceAperture"],
): ScenePortalCrossingInput["sourceAperture"] {
	return {
		...aperture,
		indices: new Uint32Array(aperture.indices),
		landblockBounds: aperture.landblockBounds.clone(),
		plane: {
			d: aperture.plane.d,
			normal: aperture.plane.normal.clone(),
		},
		vertices: new Float32Array(aperture.vertices),
	};
}

function unavailableExteriorBoundaryId(
	crossing: ScenePortalCrossingInput,
): string {
	return `portal-unavailable:${crossing.id}/reverse`;
}
