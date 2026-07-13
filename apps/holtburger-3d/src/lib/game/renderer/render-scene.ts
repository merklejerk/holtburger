import type { Mat4 } from "../math/types";
import type { ResolvedScenePlacement, SceneNodeId } from "../scene";
import {
	RenderResourceRegistry,
	type ObjectRenderResource,
	type ObjectRenderResourceId,
	type TerrainRenderResource,
	type TerrainRenderResourceId,
} from "./render-resources";

/** Opaque identity for one renderer occurrence linked to scene topology. */
export type RenderInstanceId = `render-instance:${number}`;

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

/** One terrain resource occurrence linked to a scene node. */
export interface TerrainRenderInstance {
	readonly id: RenderInstanceId;
	readonly kind: "terrain";
	readonly nodeId: SceneNodeId;
	readonly resourceId: TerrainRenderResourceId;
}

/** One object resource occurrence linked to a scene node. */
export interface ObjectRenderInstance {
	readonly id: RenderInstanceId;
	readonly kind: "object";
	readonly nodeId: SceneNodeId;
	readonly resourceId: ObjectRenderResourceId;
	readonly pose: ObjectRenderPose;
}

/** Terrain instance selected and resolved for one camera or portal view. */
export interface TerrainFrameInstance {
	readonly instance: TerrainRenderInstance;
	readonly resource: TerrainRenderResource;
	readonly placement: ResolvedScenePlacement;
}

/** Object instance selected and resolved for one camera or portal view. */
export interface ObjectFrameInstance {
	readonly instance: ObjectRenderInstance;
	readonly resource: ObjectRenderResource;
	readonly placement: ResolvedScenePlacement;
}

/** Renderer-facing scene content selected for one view. */
export interface FrameViewScene {
	readonly terrain: readonly TerrainFrameInstance[];
	readonly objects: readonly ObjectFrameInstance[];
}

type RenderInstance = TerrainRenderInstance | ObjectRenderInstance;

/** Persistent render instances indexed against canonical SceneGraph nodes. */
export class RenderScene {
	readonly #resources: RenderResourceRegistry;
	readonly #instances = new Map<RenderInstanceId, RenderInstance>();
	readonly #instanceIdsByNode = new Map<SceneNodeId, Set<RenderInstanceId>>();
	#nextInstanceId = 0;

	constructor(resources: RenderResourceRegistry) {
		this.#resources = resources;
	}

	createTerrainInstance(
		nodeId: SceneNodeId,
		resourceId: TerrainRenderResourceId,
	): RenderInstanceId {
		this.#resources.getTerrainResource(resourceId);
		return this.#addInstance({ kind: "terrain", nodeId, resourceId });
	}

	createObjectInstance(
		nodeId: SceneNodeId,
		resourceId: ObjectRenderResourceId,
		pose: ObjectRenderPose,
	): RenderInstanceId {
		this.#resources.getObjectResource(resourceId);
		return this.#addInstance({ kind: "object", nodeId, pose, resourceId });
	}

	resolveView(
		nodeIds: readonly SceneNodeId[],
		resolvePlacement: (nodeId: SceneNodeId) => ResolvedScenePlacement,
	): FrameViewScene {
		const terrain: TerrainFrameInstance[] = [];
		const objects: ObjectFrameInstance[] = [];
		for (const nodeId of nodeIds) {
			const instanceIds = this.#instanceIdsByNode.get(nodeId);
			if (!instanceIds) continue;
			const placement = resolvePlacement(nodeId);
			for (const instanceId of instanceIds) {
				const instance = this.#requireInstance(instanceId);
				if (instance.kind === "terrain") {
					terrain.push({
						instance,
						placement,
						resource: this.#resources.getTerrainResource(instance.resourceId),
					});
				} else {
					objects.push({
						instance,
						placement,
						resource: this.#resources.getObjectResource(instance.resourceId),
					});
				}
			}
		}
		return { objects, terrain };
	}

	removeNodes(nodeIds: Iterable<SceneNodeId>): void {
		for (const nodeId of nodeIds) {
			const instanceIds = this.#instanceIdsByNode.get(nodeId);
			if (!instanceIds) continue;
			for (const instanceId of [...instanceIds])
				this.#removeInstance(instanceId);
		}
	}

	#addInstance(
		input: Omit<TerrainRenderInstance, "id"> | Omit<ObjectRenderInstance, "id">,
	): RenderInstanceId {
		const id: RenderInstanceId = `render-instance:${this.#nextInstanceId++}`;
		const instance = { ...input, id } as RenderInstance;
		this.#instances.set(id, instance);
		addToSetMap(this.#instanceIdsByNode, input.nodeId, id);
		return id;
	}

	#removeInstance(id: RenderInstanceId): void {
		const instance = this.#requireInstance(id);
		this.#instances.delete(id);
		deleteFromSetMap(this.#instanceIdsByNode, instance.nodeId, id);
	}

	#requireInstance(id: RenderInstanceId): RenderInstance {
		const instance = this.#instances.get(id);
		if (!instance) throw new Error(`Render instance ${id} does not exist.`);
		return instance;
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
