import type { DynamicEntityCommit } from "../commit/types";
import type {
	GeometryManager,
	GeometrySource,
} from "../geometry/geometry-manager";
import { createObjectGeometryKey } from "../geometry/types";
import { Mat4 } from "../math/types";
import type { ObjectGeometryData } from "../renderer/geometry";
import type { SceneGraph, SceneNodeId } from "../scene";
import type {
	ResolvedObjectPart,
	ResolvedObjectPresentation,
} from "../resolution/presentation";
import type {
	ArticulatedPose,
	DynamicEntityRenderable,
	RigidPartDrawUnit,
} from "./components";

/** CPU-heavy visual preparation boundary owned by the runtime's dynamic system. */
export interface DynamicVisualPreparer {
	prepare(
		presentation: ResolvedObjectPresentation,
	): Promise<DynamicPreparedPresentation>;
	destroy(): Promise<void>;
}

/** Reusable geometry and rigid draw selections produced by dynamic visual preparation. */
export interface DynamicPreparedPresentation {
	readonly geometry: readonly GeometrySource[];
	readonly parts: readonly RigidPartDrawUnit[];
}

/** Main-thread stand-in for the future worker protocol; it preserves its result contract. */
export class InlineDynamicVisualPreparer implements DynamicVisualPreparer {
	async prepare(
		presentation: ResolvedObjectPresentation,
	): Promise<DynamicPreparedPresentation> {
		return {
			geometry: presentation.parts.map((part) => ({
				geometry: objectGeometryData(part),
				key: createObjectGeometryKey(`${presentation.id}/${part.geometry.id}`),
			})),
			parts: presentation.parts.map((part) => ({
				geometry: createObjectGeometryKey(
					`${presentation.id}/${part.geometry.id}`,
				),
				materialId: firstMaterialId(part),
				partIndex: part.partIndex,
			})),
		};
	}

	async destroy(): Promise<void> {}
}

interface DynamicEntityRecord {
	readonly rootNodeId: SceneNodeId;
	renderable: DynamicEntityRenderable;
	pose: ArticulatedPose;
}

interface DynamicOwnerRecord {
	readonly entities: readonly DynamicEntityRecord[];
}

/** Owns dynamic entity trees, rigid-part components, and reusable visual preparation. */
export class DynamicEntitySystem<TOwnerId extends string> {
	readonly #scene: SceneGraph;
	readonly #geometry: GeometryManager<TOwnerId>;
	readonly #preparer: DynamicVisualPreparer;
	readonly #owners = new Map<TOwnerId, DynamicOwnerRecord>();
	readonly #entities = new Map<SceneNodeId, DynamicEntityRecord>();
	#destroyed = false;

	constructor(
		scene: SceneGraph,
		geometry: GeometryManager<TOwnerId>,
		preparer: DynamicVisualPreparer,
	) {
		this.#scene = scene;
		this.#geometry = geometry;
		this.#preparer = preparer;
	}

	/** Attach a resident root plus transform-only setup-part descendants. */
	install(ownerId: TOwnerId, resident: DynamicEntityCommit): SceneNodeId {
		if (this.#destroyed)
			throw new Error("Cannot install a destroyed dynamic system.");
		const existing = this.#owners.get(ownerId);
		if (existing) this.removeOwner(ownerId);
		const rootNodeId = this.#scene.createNode({
			...resident.placement,
			localBounds:
				resident.localBounds ?? resident.presentation.selectionBounds,
			parentId: null,
		});
		const pose = defaultPose(resident.presentation);
		const partNodes = createPartNodes(
			this.#scene,
			rootNodeId,
			resident.presentation,
			pose,
		);
		const record: DynamicEntityRecord = {
			pose,
			renderable: { partNodes, parts: [] },
			rootNodeId,
		};
		this.#entities.set(rootNodeId, record);
		this.#owners.set(ownerId, { entities: [record] });
		void this.#prepareVisual(ownerId, rootNodeId, resident.presentation);
		return rootNodeId;
	}

	removeOwner(ownerId: TOwnerId): void {
		const owner = this.#owners.get(ownerId);
		if (owner) {
			for (const entity of owner.entities) {
				this.#destroyEntityTree(entity);
				this.#entities.delete(entity.rootNodeId);
			}
			this.#owners.delete(ownerId);
		}
		this.#geometry.dropOwner(ownerId);
	}

	getRenderable(nodeId: SceneNodeId): DynamicEntityRenderable | null {
		return this.#entities.get(nodeId)?.renderable ?? null;
	}

	getPose(nodeId: SceneNodeId): ArticulatedPose | null {
		return this.#entities.get(nodeId)?.pose ?? null;
	}

	setPose(nodeId: SceneNodeId, pose: ArticulatedPose): void {
		const entity = this.#entities.get(nodeId);
		if (!entity) throw new Error(`Dynamic entity ${nodeId} does not exist.`);
		for (const [partIndex, partNodeId] of entity.renderable.partNodes) {
			const transform = pose.partToObjectTransforms[partIndex];
			if (!transform) {
				throw new Error(
					`Dynamic entity ${nodeId} has no pose for part ${partIndex}.`,
				);
			}
			this.#scene.updateLocalTransform(partNodeId, transform);
		}
		entity.pose = pose;
	}

	async destroy(): Promise<void> {
		if (this.#destroyed) return;
		this.#destroyed = true;
		for (const ownerId of [...this.#owners.keys()]) this.removeOwner(ownerId);
		await this.#preparer.destroy();
	}

	async #prepareVisual(
		ownerId: TOwnerId,
		rootNodeId: SceneNodeId,
		presentation: ResolvedObjectPresentation,
	): Promise<void> {
		const prepared = await this.#preparer.prepare(presentation);
		if (this.#entities.get(rootNodeId) === undefined) return;
		this.#geometry.reserveKeys(
			ownerId,
			prepared.geometry.map(({ key }) => key),
		);
		for (const source of prepared.geometry)
			this.#geometry.upsertGeometry(source);
		const entity = this.#entities.get(rootNodeId);
		if (!entity) return;
		entity.renderable = {
			...entity.renderable,
			parts: prepared.parts,
		};
	}

	#destroyEntityTree(entity: DynamicEntityRecord): void {
		for (const partNodeId of entity.renderable.partNodes.values()) {
			this.#scene.destroyNode(partNodeId);
		}
		this.#scene.destroyNode(entity.rootNodeId);
	}
}

function createPartNodes(
	scene: SceneGraph,
	rootNodeId: SceneNodeId,
	presentation: ResolvedObjectPresentation,
	pose: ArticulatedPose,
): ReadonlyMap<number, SceneNodeId> {
	const pending = new Map(
		presentation.parts.map((part) => [part.partIndex, part]),
	);
	const nodes = new Map<number, SceneNodeId>();
	while (pending.size > 0) {
		let created = false;
		for (const [partIndex, part] of pending) {
			const parentId =
				part.parentPartIndex === null
					? rootNodeId
					: nodes.get(part.parentPartIndex);
			if (!parentId) continue;
			const transform = pose.partToObjectTransforms[partIndex];
			if (!transform)
				throw new Error(
					`Presentation ${presentation.id} has no pose for part ${partIndex}.`,
				);
			nodes.set(
				partIndex,
				scene.createNode({
					localBounds: null,
					localTransform: transform,
					parentId,
				}),
			);
			pending.delete(partIndex);
			created = true;
		}
		if (!created)
			throw new Error(
				`Presentation ${presentation.id} has an invalid part hierarchy.`,
			);
	}
	return nodes;
}

function defaultPose(
	presentation: ResolvedObjectPresentation,
): ArticulatedPose {
	const firstPose = presentation.placementPoses.values().next().value;
	const transforms: Mat4[] = [];
	for (const part of presentation.parts) {
		transforms[part.partIndex] =
			firstPose?.partTransforms[part.partIndex] ?? Mat4.identity();
	}
	return { partToObjectTransforms: transforms };
}

function objectGeometryData(part: ResolvedObjectPart): ObjectGeometryData {
	return {
		indices: part.geometry.indices,
		kind: "object",
		materialSlots: part.geometry.materialSlotIndices,
		normals: part.geometry.normals,
		positions: part.geometry.positions,
		textureCoordinates: part.geometry.textureCoordinates,
	};
}

function firstMaterialId(part: ResolvedObjectPart): string {
	const material = part.materials[0];
	if (!material)
		throw new Error(`Object part ${part.partIndex} has no material.`);
	return material.id;
}
