import type { GeometryResourceKey } from "./resource-manager";
import type { TextureKey } from "../textures/types";

/** Opaque identity for one logical terrain render resource. */
export type TerrainRenderResourceId = `terrain-render-resource:${number}`;

/** Opaque identity for one logical object render resource. */
export type ObjectRenderResourceId = `object-render-resource:${number}`;

/** Identity of any logical render resource. */
export type RenderResourceId = TerrainRenderResourceId | ObjectRenderResourceId;

/** Draw ordering class selected from resolved object material behavior. */
export type ObjectMaterialPass =
	| "opaque"
	| "alpha-test"
	| "transparent"
	| "additive";

/** Terrain material bindings consumed by one compatible index range. */
export interface TerrainRenderMaterial {
	readonly colorTexture: TextureKey;
	readonly detailTexture: TextureKey;
	readonly roadMaskTexture: TextureKey;
}

/** Object-style material behavior shared by direct and instanced submission. */
export interface ObjectRenderMaterial {
	readonly family: "flat-color" | "indexed-paletted" | "texture-rgba";
	readonly pass: ObjectMaterialPass;
	readonly depthWrite: boolean;
	readonly textureKeys: readonly TextureKey[];
}

/** Terrain index range sharing one terrain material configuration. */
export interface TerrainRenderDrawUnit {
	readonly indexStart: number;
	readonly indexCount: number;
	readonly material: TerrainRenderMaterial;
}

/** Object index range sharing material, render state, and optional part pose. */
export interface ObjectRenderDrawUnit {
	readonly indexStart: number;
	readonly indexCount: number;
	readonly material: ObjectRenderMaterial;
	/** Articulated pose entry used by this slice, or null for baked/rigid geometry. */
	readonly poseIndex: number | null;
}

/** Uploaded terrain geometry and its compatible draw ranges. */
export interface TerrainRenderResource {
	readonly kind: "terrain";
	readonly id: TerrainRenderResourceId;
	readonly geometryKey: GeometryResourceKey;
	readonly drawUnits: readonly TerrainRenderDrawUnit[];
}

/** Uploaded object/interior geometry and its compatible draw ranges. */
export interface ObjectRenderResource {
	readonly kind: "object";
	readonly id: ObjectRenderResourceId;
	readonly geometryKey: GeometryResourceKey;
	readonly drawUnits: readonly ObjectRenderDrawUnit[];
}

type RenderResource = TerrainRenderResource | ObjectRenderResource;

/** Persistent logical render resources independent of scene occurrences. */
export class RenderResourceRegistry {
	readonly #resources = new Map<RenderResourceId, RenderResource>();
	#nextTerrainResourceId = 0;
	#nextObjectResourceId = 0;

	createTerrainResource(
		geometryKey: GeometryResourceKey,
		drawUnits: readonly TerrainRenderDrawUnit[],
	): TerrainRenderResourceId {
		const id: TerrainRenderResourceId = `terrain-render-resource:${this.#nextTerrainResourceId++}`;
		this.#resources.set(id, { drawUnits, geometryKey, id, kind: "terrain" });
		return id;
	}

	replaceTerrainResource(
		id: TerrainRenderResourceId,
		drawUnits: readonly TerrainRenderDrawUnit[],
	): void {
		const resource = this.getTerrainResource(id);
		this.#resources.set(id, { ...resource, drawUnits });
	}

	getTerrainResource(id: TerrainRenderResourceId): TerrainRenderResource {
		const resource = this.#requireResource(id);
		if (resource.kind !== "terrain") {
			throw new Error(`Render resource ${id} is not terrain geometry.`);
		}
		return resource;
	}

	removeTerrainResource(id: TerrainRenderResourceId): TerrainRenderResource {
		const resource = this.getTerrainResource(id);
		this.#resources.delete(id);
		return resource;
	}

	createObjectResource(
		geometryKey: GeometryResourceKey,
		drawUnits: readonly ObjectRenderDrawUnit[],
	): ObjectRenderResourceId {
		const id: ObjectRenderResourceId = `object-render-resource:${this.#nextObjectResourceId++}`;
		this.#resources.set(id, { drawUnits, geometryKey, id, kind: "object" });
		return id;
	}

	replaceObjectResource(
		id: ObjectRenderResourceId,
		drawUnits: readonly ObjectRenderDrawUnit[],
	): void {
		const resource = this.getObjectResource(id);
		this.#resources.set(id, { ...resource, drawUnits });
	}

	getObjectResource(id: ObjectRenderResourceId): ObjectRenderResource {
		const resource = this.#requireResource(id);
		if (resource.kind !== "object") {
			throw new Error(`Render resource ${id} is not object geometry.`);
		}
		return resource;
	}

	removeObjectResource(id: ObjectRenderResourceId): ObjectRenderResource {
		const resource = this.getObjectResource(id);
		this.#resources.delete(id);
		return resource;
	}

	#requireResource(id: RenderResourceId): RenderResource {
		const resource = this.#resources.get(id);
		if (!resource) throw new Error(`Render resource ${id} does not exist.`);
		return resource;
	}
}
