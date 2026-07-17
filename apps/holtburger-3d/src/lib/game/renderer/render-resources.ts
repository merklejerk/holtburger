import type { GeometryResourceKey } from "./resource-manager";
import type { TextureKey } from "../textures/types";

/** Opaque identity for one logical object render resource. */
export type ObjectRenderResourceId = `object-render-resource:${number}`;

/** Identity of any logical render resource. */
export type RenderResourceId = ObjectRenderResourceId;

/** Draw ordering class selected from resolved object material behavior. */
export type ObjectMaterialPass =
	| "opaque"
	| "alpha-test"
	| "transparent"
	| "additive";

/** Object-style material behavior shared by direct and instanced submission. */
export interface ObjectRenderMaterial {
	readonly family: "flat-color" | "indexed-paletted" | "texture-rgba";
	readonly pass: ObjectMaterialPass;
	readonly depthWrite: boolean;
	readonly textureKeys: readonly TextureKey[];
}

/** Object index range sharing material, render state, and optional part pose. */
export interface ObjectRenderDrawUnit {
	readonly indexStart: number;
	readonly indexCount: number;
	readonly material: ObjectRenderMaterial;
	/** Articulated pose entry used by this slice, or null for baked/rigid geometry. */
	readonly poseIndex: number | null;
}

/** Uploaded object/interior geometry and its compatible draw ranges. */
export interface ObjectRenderResource {
	readonly kind: "object";
	readonly id: ObjectRenderResourceId;
	readonly geometryKey: GeometryResourceKey;
	readonly drawUnits: readonly ObjectRenderDrawUnit[];
}

type RenderResource = ObjectRenderResource;

/** Persistent logical render resources independent of scene occurrences. */
export class RenderResourceRegistry {
	readonly #resources = new Map<RenderResourceId, RenderResource>();
	#nextObjectResourceId = 0;

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
