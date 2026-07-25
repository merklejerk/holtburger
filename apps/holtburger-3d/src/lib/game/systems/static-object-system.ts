import type { GeometryManager } from "../geometry/geometry-manager";
import type {
	StaticObjectLayerArtifact,
	StaticObjectRenderable,
} from "../commit/artifacts";
import type { SceneGraph, SceneNodeId } from "../scene";
import type { TextureManager } from "../textures/texture-manager";
import type { InstanceStreamManager } from "./instance-stream-manager";
import type { LandblockLayerKind } from "../runtime/scene-interest";

interface StaticObjectOwnerRecord {
	readonly nodes: readonly SceneNodeId[];
}

/** Aggregate immutable-object ownership counts for runtime diagnostics. */
export interface StaticObjectSystemDiagnostics {
	readonly ownerCount: number;
	readonly nodeCount: number;
}

/** Owns immutable object nodes, node-keyed render components, and resource leases. */
export class StaticObjectSystem<TOwnerId extends string> {
	readonly #renderables = new Map<SceneNodeId, StaticObjectRenderable>();
	readonly #owners = new Map<TOwnerId, StaticObjectOwnerRecord>();
	readonly #scene: SceneGraph;
	readonly #geometry: GeometryManager<TOwnerId>;
	readonly #textures: TextureManager<TOwnerId>;
	readonly #instances: InstanceStreamManager<TOwnerId>;

	constructor(
		scene: SceneGraph,
		geometry: GeometryManager<TOwnerId>,
		textures: TextureManager<TOwnerId>,
		instances: InstanceStreamManager<TOwnerId>,
	) {
		this.#scene = scene;
		this.#geometry = geometry;
		this.#textures = textures;
		this.#instances = instances;
	}

	installObjects(
		ownerId: TOwnerId,
		installSet: StaticObjectLayerArtifact,
		cullingGroup: Exclude<LandblockLayerKind, LandblockLayerKind.Terrain>,
	): void {
		this.removeOwner(ownerId);
		this.#geometry.reserveKeys(
			ownerId,
			installSet.geometry.map(({ key }) => key),
		);
		for (const source of installSet.geometry)
			this.#geometry.upsertGeometry(source);
		this.#instances.reserveKeys(
			ownerId,
			installSet.instanceStreams.map(({ key }) => key),
		);
		for (const source of installSet.instanceStreams)
			this.#instances.publish(source);
		for (const page of installSet.texturePages) {
			this.#textures.installAtlasPage(ownerId, page.pageId, page);
		}

		const nodes = installSet.objects.map((object) => {
			const nodeId = this.#scene.createNode({
				...object.placement,
				cullingGroup,
				localBounds: object.localBounds,
				parentId: null,
			});
			this.#renderables.set(nodeId, object.renderable);
			return nodeId;
		});
		this.#owners.set(ownerId, { nodes });
	}

	removeOwner(ownerId: TOwnerId): void {
		const record = this.#owners.get(ownerId);
		if (record) {
			for (const nodeId of record.nodes) {
				this.#renderables.delete(nodeId);
				this.#scene.destroyNode(nodeId);
			}
			this.#owners.delete(ownerId);
		}
		this.#textures.dropOwner(ownerId);
		this.#geometry.dropOwner(ownerId);
		this.#instances.dropOwner(ownerId);
	}

	getRenderable(nodeId: SceneNodeId): StaticObjectRenderable | null {
		return this.#renderables.get(nodeId) ?? null;
	}

	/** Return aggregate ownership facts without exposing scene or resource mutation. */
	getDiagnostics(): StaticObjectSystemDiagnostics {
		return { nodeCount: this.#renderables.size, ownerCount: this.#owners.size };
	}
}
