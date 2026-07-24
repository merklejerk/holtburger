import type {
	GeometrySource,
	GeometryManager,
} from "../geometry/geometry-manager";
import type { AABB3 } from "../math/types";
import type { TexturePageCommit } from "../commit/types";
import type { SceneGraph, SceneNodeId, ScenePlacement } from "../scene";
import type { TextureManager } from "../textures/texture-manager";
import type { ResolvedMaterial } from "../resolution/presentation";
import type {
	StaticGeometryKey,
	StaticInstallResourceNamespace,
	StaticInstanceStreamKey,
	StaticInstanceStreamSource,
} from "./static-resources";
import type { InstanceStreamManager } from "./instance-stream-manager";

/** Source material plus polygon-owned facts; render pass policy remains renderer-private. */
export interface StaticObjectMaterialBinding {
	readonly source: ResolvedMaterial;
	readonly polygon: {
		readonly sidedness: "one-sided" | "two-sided";
		readonly positiveSurfaceId: string | null;
		readonly negativeSurfaceId: string | null;
		readonly stippled: boolean;
	};
}

/** Baked immutable geometry selected directly by one static draw. */
export interface BakedStaticDrawUnit {
	readonly kind: "baked";
	readonly geometry: StaticGeometryKey;
	readonly indexStart: number;
	readonly indexCount: number;
	readonly material: StaticObjectMaterialBinding;
}

/** Instanced immutable geometry selected by one persistent instance cohort. */
export interface InstancedStaticDrawUnit {
	readonly kind: "instanced";
	readonly geometry: StaticGeometryKey;
	readonly instances: StaticInstanceStreamKey;
	readonly indexStart: number;
	readonly indexCount: number;
	readonly material: StaticObjectMaterialBinding;
}

/** Logical immutable-object draw contribution retained beside its spatial node. */
export type StaticObjectDrawUnit =
	| BakedStaticDrawUnit
	| InstancedStaticDrawUnit;

/** Persistent immutable-object presentation attached to one spatial scene node. */
export interface StaticObjectRenderable {
	readonly drawUnits: readonly StaticObjectDrawUnit[];
}

/** One immutable object publication emitted before SceneGraph assigns its node identity. */
export interface StaticObjectArtifact {
	readonly placement: ScenePlacement;
	/** Bounds in the object root's local coordinate space. */
	readonly localBounds: AABB3;
	readonly renderable: StaticObjectRenderable;
}

/** Complete static-object publication installed under one runtime owner. */
export interface StaticObjectInstallSet {
	/** Collision-free namespace allocated before worker dispatch. */
	readonly resourceNamespace: StaticInstallResourceNamespace;
	readonly objects: readonly StaticObjectArtifact[];
	readonly geometry: readonly GeometrySource[];
	readonly instanceStreams: readonly StaticInstanceStreamSource[];
	readonly texturePages: readonly TexturePageCommit[];
}

interface StaticObjectOwnerRecord {
	readonly nodes: readonly SceneNodeId[];
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

	installObjects(ownerId: TOwnerId, installSet: StaticObjectInstallSet): void {
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
				cullingGroup: "static",
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
}
