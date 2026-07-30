import type { DynamicEntityCommit } from "../commit/types";
import type { GeometryManager } from "../geometry/geometry-manager";
import {
	createObjectGeometryKey,
	type GeometrySource,
} from "../geometry/types";
import { Mat4 } from "../math/types";
import type { ObjectGeometryData } from "../renderer/geometry";
import type { WorldObjectGuid } from "../game-types";
import type {
	ResolvedEntityAttachment,
	ResolvedResidentIdentity,
} from "../resolution/landblock-layer";
import type { SceneGraph, SceneNodeId, ScenePlacement } from "../scene";
import {
	type ParentLocation,
	type ResolvedAttachPoint,
	type ResolvedObjectPart,
	type ResolvedObjectPresentation,
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
	/** Resident identity, which decides whether anything may name this entity as a parent. */
	readonly identity: ResolvedResidentIdentity;
	/** Attach points this entity offers to child objects, keyed by the name a server sends. */
	readonly attachPoints: ReadonlyMap<ParentLocation, ResolvedAttachPoint>;
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
	/** Attachments this system made, so a torn-down parent can release its children first. */
	readonly #attachedChildren = new Map<SceneNodeId, Set<SceneNodeId>>();
	readonly #attachedParents = new Map<SceneNodeId, SceneNodeId>();
	/** Installed world objects by GUID, so an attachment can find its parent's nodes. */
	readonly #nodesByWorldGuid = new Map<WorldObjectGuid, SceneNodeId>();
	/**
	 * What each attached entity declares about its parent, kept for the entity's whole life.
	 *
	 * Retained rather than consumed on first use: a parent can be torn down and reinstalled, and its
	 * children must find their way back rather than being left floating where its hand used to be.
	 * Bounded by the child's own lifecycle, which is the only lifetime authority involved.
	 */
	readonly #declaredAttachments = new Map<
		WorldObjectGuid,
		ResolvedEntityAttachment
	>();
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

	/** Attach a resident root plus one flat transform-only node per setup part. */
	install(ownerId: TOwnerId, resident: DynamicEntityCommit): SceneNodeId {
		if (this.#destroyed)
			throw new Error("Cannot install a destroyed dynamic system.");
		const existing = this.#owners.get(ownerId);
		if (existing) this.removeOwner(ownerId);
		const rootNodeId = this.#scene.createNode({
			...resident.placement,
			cullingGroup: "dynamic",
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
			attachPoints: resident.presentation.holdingLocations,
			identity: resident.identity,
			pose,
			renderable: { partNodes, parts: [] },
			rootNodeId,
		};
		this.#entities.set(rootNodeId, record);
		this.#owners.set(ownerId, { entities: [record] });
		// Only world objects can attach or be attached to; authored residents are placed by the
		// landblock or cell that authored them.
		if (resident.identity.kind === "world") {
			const { guid, attachment } = resident.identity;
			this.#nodesByWorldGuid.set(guid, rootNodeId);
			if (attachment) this.#declareAttachment(guid, rootNodeId, attachment);
			this.#resolveAttachmentsTo(guid);
		}
		void this.#prepareVisual(ownerId, rootNodeId, resident.presentation);
		return rootNodeId;
	}

	/**
	 * Hand one installed entity's position to a named attach point on another.
	 *
	 * The holding-location lookup happens here rather than in `SceneGraph` so the scene primitive
	 * stays expressible for particle and script attachment, which resolve their target differently.
	 * Resolving through the parent's own part-node map is also what makes attaching to a node that
	 * is not one of its parts unrepresentable.
	 */
	attachEntity(
		nodeId: SceneNodeId,
		parentNodeId: SceneNodeId,
		location: ParentLocation,
	): void {
		this.#requireEntity(nodeId);
		const parent = this.#requireEntity(parentNodeId);
		const attachPoint = parent.attachPoints.get(location);
		if (!attachPoint) {
			throw new Error(
				`Dynamic entity ${parentNodeId} offers no ${location} attach point.`,
			);
		}
		const partNodeId = parent.renderable.partNodes.get(attachPoint.partIndex);
		if (partNodeId === undefined) {
			throw new Error(
				`Dynamic entity ${parentNodeId} has no node for attach part ${attachPoint.partIndex}.`,
			);
		}
		this.#scene.attachToPart(nodeId, partNodeId, attachPoint.offsetTransform);
		const attached = this.#attachedChildren.get(parentNodeId) ?? new Set();
		attached.add(nodeId);
		this.#attachedChildren.set(parentNodeId, attached);
		this.#attachedParents.set(nodeId, parentNodeId);
	}

	/**
	 * Return an attached entity to the world under its own placement.
	 *
	 * This is an intentional detach, so it also clears what the entity declared. Releasing children
	 * because their parent is being torn down deliberately does not.
	 */
	detachEntity(nodeId: SceneNodeId, placement: ScenePlacement): void {
		const entity = this.#requireEntity(nodeId);
		this.#scene.detachToPlacement(nodeId, placement);
		this.#forgetAttachment(nodeId);
		if (entity.identity.kind === "world") {
			this.#declaredAttachments.delete(entity.identity.guid);
		}
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

	/**
	 * Record what this entity declares, and attach it if its parent is already here.
	 *
	 * Commits arrive in whatever order their source produces, so a wielder and the item it holds can
	 * land in either order. The declaration outlives a failed lookup so the pairing completes
	 * whenever the other half shows up — including after a parent is reinstalled.
	 */
	#declareAttachment(
		guid: WorldObjectGuid,
		nodeId: SceneNodeId,
		attachment: ResolvedEntityAttachment,
	): void {
		this.#declaredAttachments.set(guid, attachment);
		const parentNodeId = this.#nodesByWorldGuid.get(attachment.parent);
		if (parentNodeId === undefined) return;
		this.attachEntity(nodeId, parentNodeId, attachment.location);
	}

	/** Attach every entity still waiting on this parent, including any it just released. */
	#resolveAttachmentsTo(parent: WorldObjectGuid): void {
		for (const [guid, attachment] of [...this.#declaredAttachments]) {
			if (attachment.parent !== parent) continue;
			const nodeId = this.#nodesByWorldGuid.get(guid);
			if (nodeId === undefined) {
				this.#declaredAttachments.delete(guid);
				continue;
			}
			if (this.#attachedParents.has(nodeId)) continue;
			this.#declareAttachment(guid, nodeId, attachment);
		}
	}

	#requireEntity(nodeId: SceneNodeId): DynamicEntityRecord {
		const entity = this.#entities.get(nodeId);
		if (!entity) throw new Error(`Dynamic entity ${nodeId} does not exist.`);
		return entity;
	}

	#forgetAttachment(nodeId: SceneNodeId): void {
		const parentNodeId = this.#attachedParents.get(nodeId);
		if (parentNodeId === undefined) return;
		this.#attachedParents.delete(nodeId);
		const attached = this.#attachedChildren.get(parentNodeId);
		attached?.delete(nodeId);
		if (attached?.size === 0) this.#attachedChildren.delete(parentNodeId);
	}

	/**
	 * Release anything still hanging off this entity before tearing its nodes down.
	 *
	 * Retail unparents a destroyed object's children rather than destroying them with it, leaving
	 * them where they were. Detaching to each child's own current placement is that behavior, and it
	 * is also what keeps `destroyNode`'s leaf-only rule satisfiable.
	 */
	#releaseAttachedChildren(rootNodeId: SceneNodeId): void {
		const attached = this.#attachedChildren.get(rootNodeId);
		if (!attached) return;
		for (const childNodeId of [...attached]) {
			const placement = this.#scene.getResolvedPlacement(childNodeId);
			if (!placement) {
				throw new Error(
					`Attached dynamic entity ${childNodeId} has no resolvable placement.`,
				);
			}
			// Keep the child's declaration: if this parent comes back, the child returns to its hand.
			this.#scene.detachToPlacement(childNodeId, {
				envCellId: placement.envCellId,
				landblockId: placement.landblockId,
				localTransform: placement.localToLandblock,
			});
			this.#forgetAttachment(childNodeId);
		}
	}

	#destroyEntityTree(entity: DynamicEntityRecord): void {
		this.#releaseAttachedChildren(entity.rootNodeId);
		this.#forgetAttachment(entity.rootNodeId);
		if (entity.identity.kind === "world") {
			// A declaration dies with the entity that made it, never with the parent it names.
			const { guid } = entity.identity;
			this.#nodesByWorldGuid.delete(guid);
			this.#declaredAttachments.delete(guid);
		}
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
	const nodes = new Map<number, SceneNodeId>();
	for (const part of presentation.parts) {
		const partIndex = part.partIndex;
		if (nodes.has(partIndex)) {
			throw new Error(
				`Presentation ${presentation.id} contains duplicate part index ${partIndex}.`,
			);
		}
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
				parentId: rootNodeId,
			}),
		);
	}
	return nodes;
}

/** Pose retail requests for an object at rest (`CPhysicsObj::InitObjectEnd`, `acclient.c:305765`). */
const RESTING_PLACEMENT_KEY = 0x65;

/** Fallback key `CPartArray::SetPlacementFrame` uses when a setup lacks the requested pose. */
const FALLBACK_PLACEMENT_KEY = 0;

/**
 * Select one authored pose by placement key, falling back exactly as retail does.
 *
 * `CPartArray::SetPlacementFrame` (`acclient.c:314297`) looks the requested key up in the setup's
 * placement frames and drops to key 0 when it is absent. An attached object selects its own pose
 * this way, using the placement the server sent for it.
 */
function poseFor(
	presentation: ResolvedObjectPresentation,
	placementKey: number,
): ArticulatedPose {
	const pose =
		presentation.placementPoses.get(placementKey) ??
		presentation.placementPoses.get(FALLBACK_PLACEMENT_KEY);
	const transforms: Mat4[] = [];
	for (const part of presentation.parts) {
		transforms[part.partIndex] =
			pose?.partTransforms[part.partIndex] ?? Mat4.identity();
	}
	return { partToObjectTransforms: transforms };
}

function defaultPose(
	presentation: ResolvedObjectPresentation,
): ArticulatedPose {
	return poseFor(presentation, RESTING_PLACEMENT_KEY);
}

function objectGeometryData(part: ResolvedObjectPart): ObjectGeometryData {
	return {
		indices: part.geometry.indices,
		kind: "object",
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
