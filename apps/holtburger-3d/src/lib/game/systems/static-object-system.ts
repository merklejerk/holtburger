import type { GeometryManager } from "../geometry/geometry-manager";
import type {
	StaticObjectLayerArtifact,
	StaticObjectRenderable,
} from "../commit/artifacts";
import type { SceneGraph, SceneNodeId } from "../scene";
import type { StaticInstanceStreamManager } from "./static-instance-stream-manager";
import type { OutdoorStaticLayerKind } from "../runtime/scene-interest";
import type { SceneInterestRevision } from "../runtime/scene-availability";

interface StaticObjectOwnerRecord<TResourceOwner extends string> {
	readonly nodes: readonly SceneNodeId[];
	readonly resourceOwner: TResourceOwner;
	readonly revision: SceneInterestRevision;
}

/** Aggregate immutable-object ownership counts for runtime diagnostics. */
export interface StaticObjectSystemDiagnostics {
	readonly ownerCount: number;
	readonly nodeCount: number;
}

/** Renderer culling identity for one independently switchable immutable-object cohort. */
export type StaticObjectCullingGroup =
	| OutdoorStaticLayerKind
	| "env-cell-static-residents";

/** Owns immutable object nodes, node-keyed render components, and resource leases. */
export class StaticObjectSystem<
	TOwnerId extends string,
	TResourceOwner extends string = TOwnerId,
> {
	readonly #renderables = new Map<SceneNodeId, StaticObjectRenderable>();
	readonly #owners = new Map<
		TOwnerId,
		StaticObjectOwnerRecord<TResourceOwner>
	>();
	readonly #scene: SceneGraph;
	readonly #geometry: GeometryManager<TResourceOwner>;
	readonly #instances: StaticInstanceStreamManager<TResourceOwner>;
	readonly #resourceOwner: (
		owner: TOwnerId,
		revision: SceneInterestRevision,
	) => TResourceOwner;

	constructor(
		scene: SceneGraph,
		geometry: GeometryManager<TResourceOwner>,
		instances: StaticInstanceStreamManager<TResourceOwner>,
		resourceOwner: (
			owner: TOwnerId,
			revision: SceneInterestRevision,
		) => TResourceOwner,
	) {
		this.#scene = scene;
		this.#geometry = geometry;
		this.#instances = instances;
		this.#resourceOwner = resourceOwner;
	}

	/**
	 * Stage a complete static replacement before retiring the visible revision.
	 *
	 * Geometry/instance identities are revision-scoped, so staged resources never alias the
	 * previous record. A failed publication drops only the staged owner and leaves the old scene
	 * record untouched.
	 */
	replaceObjects(
		ownerId: TOwnerId,
		revision: SceneInterestRevision,
		installSet: StaticObjectLayerArtifact | null,
		cullingGroup: StaticObjectCullingGroup,
	): void {
		const resourceOwner = this.#resourceOwner(ownerId, revision);
		const nodes: SceneNodeId[] = [];
		try {
			if (installSet === null) {
				const previous = this.#owners.get(ownerId);
				if (previous) this.#removeRecord(ownerId, previous);
				this.#owners.set(ownerId, { nodes, resourceOwner, revision });
				return;
			}
			this.#geometry.reserveKeys(
				resourceOwner,
				installSet.geometry.map(({ key }) => key),
			);
			for (const source of installSet.geometry)
				this.#geometry.upsertGeometry(source);
			this.#instances.reserveKeys(
				resourceOwner,
				installSet.instanceStreams.map(({ key }) => key),
			);
			for (const source of installSet.instanceStreams)
				this.#instances.publish(source);
			for (const object of installSet.objects) {
				const nodeId = this.#scene.createNode({
					...object.placement,
					cullingGroup,
					localBounds: object.localBounds,
					parentId: null,
				});
				this.#renderables.set(nodeId, object.renderable);
				nodes.push(nodeId);
			}
		} catch (cause) {
			this.#dropStaged(nodes, resourceOwner);
			throw cause;
		}
		const previous = this.#owners.get(ownerId);
		if (previous) this.#removeRecord(ownerId, previous);
		this.#owners.set(ownerId, { nodes, resourceOwner, revision });
	}

	/** Remove only the record installed by this exact realization revision. */
	removeExact(ownerId: TOwnerId, revision: SceneInterestRevision): void {
		const record = this.#owners.get(ownerId);
		if (record?.revision === revision) this.#removeRecord(ownerId, record);
	}

	/** Eviction cannot remove a later replacement for the same static owner. */
	evict(ownerId: TOwnerId, revision: SceneInterestRevision): void {
		const record = this.#owners.get(ownerId);
		if (record && record.revision <= revision)
			this.#removeRecord(ownerId, record);
	}

	removeOwner(ownerId: TOwnerId): void {
		const record = this.#owners.get(ownerId);
		if (record) this.#removeRecord(ownerId, record);
	}

	getRenderable(nodeId: SceneNodeId): StaticObjectRenderable | null {
		return this.#renderables.get(nodeId) ?? null;
	}

	/** Return aggregate ownership facts without exposing scene or resource mutation. */
	getDiagnostics(): StaticObjectSystemDiagnostics {
		return { nodeCount: this.#renderables.size, ownerCount: this.#owners.size };
	}

	#removeRecord(
		ownerId: TOwnerId,
		record: StaticObjectOwnerRecord<TResourceOwner>,
	): void {
		for (const nodeId of record.nodes) {
			this.#renderables.delete(nodeId);
			this.#scene.destroyNode(nodeId);
		}
		this.#owners.delete(ownerId);
		this.#geometry.dropOwner(record.resourceOwner);
		this.#instances.dropOwner(record.resourceOwner);
	}

	#dropStaged(
		nodes: readonly SceneNodeId[],
		resourceOwner: TResourceOwner,
	): void {
		for (const nodeId of nodes) {
			this.#renderables.delete(nodeId);
			this.#scene.destroyNode(nodeId);
		}
		this.#geometry.dropOwner(resourceOwner);
		this.#instances.dropOwner(resourceOwner);
	}
}
