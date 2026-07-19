import type { Mat4 } from "../math/types";
import type { ResolvedScenePlacement, SceneNodeId } from "../scene";
import {
	RenderResourceRegistry,
	type ObjectRenderResourceId,
	type ResolvedObjectRenderResource,
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

/** One object resource occurrence linked to a scene node. */
export interface ObjectRenderInstance {
	readonly id: RenderInstanceId;
	readonly kind: "object";
	readonly nodeId: SceneNodeId;
	readonly resourceId: ObjectRenderResourceId;
	readonly pose: ObjectRenderPose;
}

/** Object occurrence selected and resolved for one camera or portal view. */
export interface ObjectFrameOccurrence {
	readonly kind: "object";
	readonly instance: ObjectRenderInstance;
	readonly resource: ResolvedObjectRenderResource;
	readonly placement: ResolvedScenePlacement;
}

/** Terrain occurrence linked to the landblock-resident scene root it draws. */
export interface TerrainRenderInstance {
	readonly id: RenderInstanceId;
	readonly kind: "terrain";
	readonly nodeId: SceneNodeId;
}

/** Visible terrain occurrence with its resolved landblock placement. */
export interface TerrainFrameOccurrence {
	readonly kind: "terrain";
	readonly instance: TerrainRenderInstance;
	readonly placement: ResolvedScenePlacement;
}

/** Renderer-facing scene content selected for one view. */
export interface FrameViewScene {
	readonly objects: readonly ObjectFrameOccurrence[];
}

type RenderInstance = ObjectRenderInstance | TerrainRenderInstance;

/** Renderer occurrence registered against one canonical scene node. */
export type RenderInstanceInput =
	| {
			readonly kind: "object";
			readonly nodeId: SceneNodeId;
			readonly pose: ObjectRenderPose;
			readonly resourceId: ObjectRenderResourceId;
	  }
	| {
			readonly kind: "terrain";
			readonly nodeId: SceneNodeId;
	  };

/** Visible renderer occurrence with a transform flattened into its landblock. */
export type VisibleRenderOccurrence =
	| ObjectFrameOccurrence
	| TerrainFrameOccurrence;

/** Persistent render instances indexed against canonical SceneGraph nodes. */
export class RenderScene {
	readonly #resources: RenderResourceRegistry;
	readonly #instances = new Map<RenderInstanceId, RenderInstance>();
	readonly #instanceIdsByNode = new Map<SceneNodeId, Set<RenderInstanceId>>();
	#nextInstanceId = 0;

	constructor(resources: RenderResourceRegistry) {
		this.#resources = resources;
	}

	createInstance(input: RenderInstanceInput): RenderInstanceId {
		if (input.kind === "object")
			this.#resources.getObjectResource(input.resourceId);
		return this.#addInstance(input);
	}

	resolveVisibleOccurrences(
		nodeIds: readonly SceneNodeId[],
		resolvePlacement: (nodeId: SceneNodeId) => ResolvedScenePlacement,
	): readonly VisibleRenderOccurrence[] {
		const visibleOccurrences: VisibleRenderOccurrence[] = [];
		for (const nodeId of nodeIds) {
			const instanceIds = this.#instanceIdsByNode.get(nodeId);
			if (!instanceIds) continue;
			const placement = resolvePlacement(nodeId);
			for (const instanceId of instanceIds) {
				const instance = this.#requireInstance(instanceId);
				if (instance.kind === "terrain") {
					visibleOccurrences.push({ kind: "terrain", instance, placement });
					continue;
				}
				visibleOccurrences.push({
					kind: "object",
					instance,
					placement,
					resource: this.#resources.resolveObjectResource(instance.resourceId),
				});
			}
		}
		return visibleOccurrences;
	}

	removeNodes(nodeIds: Iterable<SceneNodeId>): void {
		for (const nodeId of nodeIds) {
			const instanceIds = this.#instanceIdsByNode.get(nodeId);
			if (!instanceIds) continue;
			for (const instanceId of [...instanceIds])
				this.#removeInstance(instanceId);
		}
	}

	#addInstance(input: RenderInstanceInput): RenderInstanceId {
		const id: RenderInstanceId = `render-instance:${this.#nextInstanceId++}`;
		const instance: RenderInstance =
			input.kind === "object" ? { ...input, id } : { ...input, id };
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
