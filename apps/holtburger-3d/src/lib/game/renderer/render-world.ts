import type { GeometryResourceKey } from "./resource-manager";
import type { Mat4 } from "../math/types";
import type { SceneNodeId, ScenePlacement } from "../scene";
import type { TextureKey } from "../textures/types";

/** Opaque identity for one logical terrain resource in RenderWorld. */
export type TerrainRenderResourceId = `terrain-render-resource:${number}`;

/** Opaque identity for one logical object resource in RenderWorld. */
export type ObjectRenderResourceId = `object-render-resource:${number}`;

/** Opaque identity for one renderer occurrence attached to scene topology. */
export type RenderAttachmentId = `render-attachment:${number}`;

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

/** Geometry already expressed in its root landblock coordinate frame. */
export interface BakedObjectPose {
	readonly kind: "baked";
}

/** One rigid occurrence of source-local object geometry. */
export interface RigidObjectPose {
	readonly kind: "rigid";
	readonly resourceTransform: Mat4;
}

/** One AC-style multipart occurrence driven by rigid per-part transforms. */
export interface ArticulatedObjectPose {
	readonly kind: "articulated";
	readonly partTransforms: readonly Mat4[];
}

/** Placement strategy for one object resource occurrence. */
export type ObjectRenderPose =
	| BakedObjectPose
	| RigidObjectPose
	| ArticulatedObjectPose;

/** One baked terrain occurrence attached to a landblock scene root. */
export interface TerrainRenderAttachment {
	readonly id: RenderAttachmentId;
	readonly kind: "terrain";
	readonly nodeId: SceneNodeId;
	readonly resourceId: TerrainRenderResourceId;
}

/** One object resource occurrence attached to a scene node. */
export interface ObjectRenderAttachment {
	readonly id: RenderAttachmentId;
	readonly kind: "object";
	readonly nodeId: SceneNodeId;
	readonly resourceId: ObjectRenderResourceId;
	readonly pose: ObjectRenderPose;
}

/** Terrain occurrence selected for one camera or portal view. */
export interface TerrainFrameAttachment {
	readonly attachment: TerrainRenderAttachment;
	readonly resource: TerrainRenderResource;
	readonly placement: ScenePlacement;
}

/** Object occurrence selected for one camera or portal view. */
export interface ObjectFrameAttachment {
	readonly attachment: ObjectRenderAttachment;
	readonly resource: ObjectRenderResource;
	readonly placement: ScenePlacement;
}

/** Renderer-facing scene content selected for one view. */
export interface FrameViewScene {
	readonly terrain: readonly TerrainFrameAttachment[];
	readonly objects: readonly ObjectFrameAttachment[];
}

type RenderResource = TerrainRenderResource | ObjectRenderResource;
type RenderAttachment = TerrainRenderAttachment | ObjectRenderAttachment;

/** Persistent renderer-facing world composed with, but separate from, SceneGraph. */
export class RenderWorld {
	readonly #resources = new Map<
		TerrainRenderResourceId | ObjectRenderResourceId,
		RenderResource
	>();
	readonly #attachments = new Map<RenderAttachmentId, RenderAttachment>();
	readonly #attachmentIdsByNode = new Map<
		SceneNodeId,
		Set<RenderAttachmentId>
	>();
	readonly #attachmentIdsByResource = new Map<
		TerrainRenderResourceId | ObjectRenderResourceId,
		Set<RenderAttachmentId>
	>();
	#nextTerrainResourceId = 0;
	#nextObjectResourceId = 0;
	#nextAttachmentId = 0;

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
		geometryKey: GeometryResourceKey,
		drawUnits: readonly TerrainRenderDrawUnit[],
	): void {
		this.#requireTerrainResource(id);
		this.#resources.set(id, { drawUnits, geometryKey, id, kind: "terrain" });
	}

	getTerrainResource(id: TerrainRenderResourceId): TerrainRenderResource {
		return this.#requireTerrainResource(id);
	}

	createObjectResource(
		geometryKey: GeometryResourceKey,
		drawUnits: readonly ObjectRenderDrawUnit[],
	): ObjectRenderResourceId {
		const id: ObjectRenderResourceId = `object-render-resource:${this.#nextObjectResourceId++}`;
		this.#resources.set(id, { drawUnits, geometryKey, id, kind: "object" });
		return id;
	}

	createTerrainAttachment(
		nodeId: SceneNodeId,
		resourceId: TerrainRenderResourceId,
	): RenderAttachmentId {
		this.#requireTerrainResource(resourceId);
		return this.#addAttachment({ kind: "terrain", nodeId, resourceId });
	}

	createObjectAttachment(
		nodeId: SceneNodeId,
		resourceId: ObjectRenderResourceId,
		pose: ObjectRenderPose,
	): RenderAttachmentId {
		this.#requireObjectResource(resourceId);
		return this.#addAttachment({ kind: "object", nodeId, pose, resourceId });
	}

	resolveView(
		nodeIds: readonly SceneNodeId[],
		resolvePlacement: (nodeId: SceneNodeId) => ScenePlacement,
	): FrameViewScene {
		const terrain: TerrainFrameAttachment[] = [];
		const objects: ObjectFrameAttachment[] = [];
		for (const nodeId of nodeIds) {
			for (const attachmentId of this.#attachmentIdsByNode.get(nodeId) ?? []) {
				const attachment = this.#requireAttachment(attachmentId);
				const placement = resolvePlacement(nodeId);
				if (attachment.kind === "terrain") {
					terrain.push({
						attachment,
						placement,
						resource: this.#requireTerrainResource(attachment.resourceId),
					});
				} else {
					objects.push({
						attachment,
						placement,
						resource: this.#requireObjectResource(attachment.resourceId),
					});
				}
			}
		}
		return { objects, terrain };
	}

	removeNodes(nodeIds: Iterable<SceneNodeId>): readonly GeometryResourceKey[] {
		const releasedResources: GeometryResourceKey[] = [];
		for (const nodeId of nodeIds) {
			const attachmentIds = this.#attachmentIdsByNode.get(nodeId);
			if (!attachmentIds) continue;
			for (const attachmentId of [...attachmentIds]) {
				releasedResources.push(...this.#removeAttachment(attachmentId));
			}
		}
		return releasedResources;
	}

	#addAttachment(
		input:
			| Omit<TerrainRenderAttachment, "id">
			| Omit<ObjectRenderAttachment, "id">,
	): RenderAttachmentId {
		const id: RenderAttachmentId = `render-attachment:${this.#nextAttachmentId++}`;
		const attachment = { ...input, id } as RenderAttachment;
		this.#attachments.set(id, attachment);
		addToSetMap(this.#attachmentIdsByNode, input.nodeId, id);
		addToSetMap(this.#attachmentIdsByResource, input.resourceId, id);
		return id;
	}

	#removeAttachment(id: RenderAttachmentId): readonly GeometryResourceKey[] {
		const attachment = this.#requireAttachment(id);
		this.#attachments.delete(id);
		deleteFromSetMap(this.#attachmentIdsByNode, attachment.nodeId, id);
		deleteFromSetMap(this.#attachmentIdsByResource, attachment.resourceId, id);
		if (this.#attachmentIdsByResource.has(attachment.resourceId)) return [];

		const resource = this.#requireResource(attachment.resourceId);
		this.#resources.delete(attachment.resourceId);
		return [resource.geometryKey];
	}

	#requireResource(
		id: TerrainRenderResourceId | ObjectRenderResourceId,
	): RenderResource {
		const resource = this.#resources.get(id);
		if (!resource) throw new Error(`Render resource ${id} does not exist.`);
		return resource;
	}

	#requireTerrainResource(id: TerrainRenderResourceId): TerrainRenderResource {
		const resource = this.#requireResource(id);
		if (resource.kind !== "terrain") {
			throw new Error(`Render resource ${id} is not terrain geometry.`);
		}
		return resource;
	}

	#requireObjectResource(id: ObjectRenderResourceId): ObjectRenderResource {
		const resource = this.#requireResource(id);
		if (resource.kind !== "object") {
			throw new Error(`Render resource ${id} is not object geometry.`);
		}
		return resource;
	}

	#requireAttachment(id: RenderAttachmentId): RenderAttachment {
		const attachment = this.#attachments.get(id);
		if (!attachment) throw new Error(`Render attachment ${id} does not exist.`);
		return attachment;
	}
}

function addToSetMap<TKey, TValue>(
	map: Map<TKey, Set<TValue>>,
	key: TKey,
	value: TValue,
): void {
	let values = map.get(key);
	if (!values) {
		values = new Set();
		map.set(key, values);
	}
	values.add(value);
}

function deleteFromSetMap<TKey, TValue>(
	map: Map<TKey, Set<TValue>>,
	key: TKey,
	value: TValue,
): void {
	const values = map.get(key);
	if (!values) return;
	values.delete(value);
	if (values.size === 0) map.delete(key);
}
