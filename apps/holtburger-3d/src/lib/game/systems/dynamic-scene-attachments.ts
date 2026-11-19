import type { DatAssetId } from "../game-types";
import { expandBounds } from "../math/geometry-utils";
import { AABB3, Mat4 } from "../math/types";
import { composeObjectPartFrame } from "../resolution/object-part-transform";
import type {
	ParentLocation,
	SetupSidewaysSpan,
} from "../resolution/presentation";
import type {
	DynamicEntityAdvance,
	DynamicEntityTickBatch,
} from "../runtime/dynamic-entity-feed";
import type { SceneGraph, SceneNodeId, SceneSpatialPlacement } from "../scene";
import type { ActiveDynamicPart, ArticulatedPose } from "./components";
import type { DynamicEntityPlacementSystem } from "./dynamic-entity-placement-system";
import {
	boundsAtRootScale,
	composeValidatedPartTransforms,
	poseFor,
	type DynamicAttachmentFrame,
	type DynamicEntityRecord,
	type DynamicModelAttachment,
	type PreparedDynamicAttachment,
} from "./dynamic-entity-types";

export interface DynamicBoundsPublicationPort {
	presentationBoundsForSample(
		parts: readonly ActiveDynamicPart[],
		rootTransform: Mat4,
		target?: AABB3,
	): AABB3;
	publishCullingBounds(entity: DynamicEntityRecord): void;
}

/** Owns dynamic entity scene nodes, attachment frames, placements, and root scaling. */
export class DynamicEntitySceneAndAttachmentAdapter {
	readonly #scene: SceneGraph;
	/** Model ownership of roots, visual roots, and requested part frames, including staged nodes. */
	readonly modelRoots = new Map<SceneNodeId, SceneNodeId>();
	readonly #placements: DynamicEntityPlacementSystem;
	readonly entities = new Map<SceneNodeId, DynamicEntityRecord>();
	readonly #boundsPort: DynamicBoundsPublicationPort;

	constructor(
		scene: SceneGraph,
		placements: DynamicEntityPlacementSystem,
		boundsPort: DynamicBoundsPublicationPort,
	) {
		this.#scene = scene;
		this.#placements = placements;
		this.#boundsPort = boundsPort;
	}

	/**
	 * Materialize a stable authored part frame on first request, initialized from the current pose.
	 *
	 * `CreateParticle` names a part index and `-1` for the whole object, so a consumer that ignores it
	 * places every part-attached emitter at the object's origin instead of the part's — and, since the
	 * emitter frame drives spawn rotation too, aims it with the object's frame as well.
	 */
	requestPartNode(
		rootNodeId: SceneNodeId,
		partIndex: number,
	): SceneNodeId | null {
		const entity = this.entities.get(rootNodeId);
		if (!entity) return null;
		const part = entity.renderable.parts.find(
			(part) => part.partIndex === partIndex,
		);
		return part ? this.attachmentFrame(entity, part).nodeId : null;
	}

	/** Resolve behavior/particle targets to their model without walking or copying scene ancestry. */
	modelRootOf(nodeId: SceneNodeId): SceneNodeId | null {
		return this.modelRoots.get(nodeId) ?? null;
	}

	/** Copy one live entity's resolved object placement for synchronous child staging. */
	resolvedRootPlacement(rootNodeId: SceneNodeId): SceneSpatialPlacement | null {
		if (!this.entities.has(rootNodeId)) return null;
		const resolved = this.#scene.getResolvedPlacement(rootNodeId);
		const spatialMembership =
			this.#scene.getResolvedSpatialMembership(rootNodeId);
		if (!resolved || !spatialMembership) return null;
		return {
			envCellId: resolved.envCellId,
			landblockId: resolved.landblockId,
			localTransform: resolved.localToLandblock,
			spatialMembership,
		};
	}

	/** Identify the installed setup that prevents a live child from attaching. */
	setupMissingHoldingLocation(
		parentNodeId: SceneNodeId,
		location: ParentLocation,
	): DatAssetId | null {
		const parent = this.entities.get(parentNodeId);
		if (!parent)
			throw new Error(`Dynamic parent ${parentNodeId} does not exist.`);
		return parent.source.presentation.holdingLocations.has(location)
			? null
			: parent.source.setupId;
	}

	/**
	 * Pose one child by its own setup and attach its root to a named point on the parent
	 * setup.
	 *
	 * Lookup stays caller-side, matching retail child attachment: the scene graph receives
	 * only a resolved part node and rigid holding frame, so parent geometry scale cannot leak
	 * into the child's independently scaled parts.
	 */
	attachEntity(
		childRootNodeId: SceneNodeId,
		parentRootNodeId: SceneNodeId,
		location: ParentLocation,
		placementKey: number,
	): void {
		const child = this.entities.get(childRootNodeId);
		if (!child)
			throw new Error(`Dynamic child ${childRootNodeId} does not exist.`);
		const parent = this.entities.get(parentRootNodeId);
		if (!parent)
			throw new Error(`Dynamic parent ${parentRootNodeId} does not exist.`);
		this.applyAttachment(
			this.prepareAttachment(
				child,
				parent,
				location,
				poseFor(child.source.presentation, placementKey),
			),
		);
	}

	/** Apply one complete producer placement through the sole dynamic-root writer. */
	updatePlacement(nodeId: SceneNodeId, placement: SceneSpatialPlacement): void {
		if (!this.entities.has(nodeId))
			throw new Error(`Dynamic entity ${nodeId} does not exist.`);
		this.#placements.updateRoot(nodeId, placement);
	}

	/** Apply a pose-stable membership refresh without replacing movement or animation. */
	refreshPlacementMembership(
		nodeId: SceneNodeId,
		point: DynamicEntityAdvance["path"]["initial"],
	): void {
		if (!this.entities.has(nodeId))
			throw new Error(`Dynamic entity ${nodeId} does not exist.`);
		this.#placements.refreshMembership(nodeId, point);
	}

	/** Apply one host-accepted transient path through the sole dynamic-root placement owner. */
	updatePlacementPath(
		nodeId: SceneNodeId,
		advance: DynamicEntityAdvance,
		durationMs: DynamicEntityTickBatch["durationMs"],
		startedAtMs: number,
	): void {
		if (!this.entities.has(nodeId))
			throw new Error(`Dynamic entity ${nodeId} does not exist.`);
		this.#placements.applyPath(nodeId, advance, durationMs, startedAtMs);
	}

	/** Approximate authored sideways span; no animation or mesh work occurs during map sampling. */
	setupSidewaysSpan(nodeId: SceneNodeId): SetupSidewaysSpan | null {
		const entity = this.entities.get(nodeId);
		if (!entity) return null;
		const bounds = entity.setupBounds;
		const xScale = entity.rootScale.x / entity.source.scale.x;
		const zScale = entity.rootScale.z / entity.source.scale.z;
		return {
			minX: bounds.min.x * xScale,
			maxX: bounds.max.x * xScale,
			z: (bounds.min.z + bounds.max.z) * 0.5 * zScale,
		};
	}

	/** Apply one projected absolute root scale without reloading or replacing visual resources. */
	updateRootScale(nodeId: SceneNodeId, scale: number): void {
		if (!Number.isFinite(scale) || scale <= 0)
			throw new Error("Dynamic entity root scale must be finite and positive.");
		const entity = this.entities.get(nodeId);
		if (!entity) throw new Error(`Dynamic entity ${nodeId} does not exist.`);
		if (
			entity.rootScale.x === scale &&
			entity.rootScale.y === scale &&
			entity.rootScale.z === scale
		)
			return;

		entity.rootScale.x = scale;
		entity.rootScale.y = scale;
		entity.rootScale.z = scale;
		composeValidatedPartTransforms(
			entity.renderable.parts,
			entity.articulatedPose.partToObjectTransforms,
			entity.rootScale,
			(partIndex) =>
				`Dynamic entity ${nodeId} has no current pose for part ${partIndex}.`,
		);
		entity.localPartsRevision += 1;
		this.publishAttachmentFrames(
			entity,
			entity.visualRootTransform,
			entity.articulatedPose,
		);
		entity.rigidPresentationBounds =
			this.#boundsPort.presentationBoundsForSample(
				entity.renderable.parts,
				entity.visualRootTransform,
				entity.rigidPresentationBounds,
			);
		entity.publishedPresentationBounds = expandBounds(
			entity.rigidPresentationBounds,
			entity.appliedEnvelopeRadius,
			entity.publishedPresentationBounds,
		);
		const prepared = entity.preparedAnimation;
		if (!prepared || entity.cullingBounds === null)
			throw new Error(
				`Dynamic entity ${nodeId} has no prepared culling bounds.`,
			);
		entity.cullingBounds = boundsAtRootScale(
			prepared.localBounds,
			entity.source.scale,
			entity.rootScale,
		).union(entity.rigidPresentationBounds);
		this.#boundsPort.publishCullingBounds(entity);
	}

	/** Cold attachment lookup; ordinary mesh parts need no scene node or per-frame scene copy. */
	attachmentFrame(
		entity: DynamicEntityRecord,
		part: ActiveDynamicPart,
	): DynamicAttachmentFrame {
		const existing = entity.attachmentFrames.find(
			(frame) => frame.partIndex === part.partIndex,
		);
		if (existing) return existing;
		const pose = entity.articulatedPose.partToObjectTransforms[part.partIndex];
		if (!pose)
			throw new Error(
				`Requested attachment part ${part.partIndex} has no current pose.`,
			);
		const transform = composeObjectPartFrame(
			pose,
			entity.rootScale,
			Mat4.zero(),
		);
		const frame = {
			partIndex: part.partIndex,
			nodeId: this.#scene.createNode({
				localBounds: null,
				localTransform: transform,
				parentId: entity.visualRootNodeId,
			}),
			transform,
		};
		entity.attachmentFrames.push(frame);
		this.modelRoots.set(frame.nodeId, entity.rootNodeId);
		return frame;
	}

	/** Held descendants must observe the completed root and all requested part transforms. */
	publishAttachmentFrames(
		entity: DynamicEntityRecord,
		visualRootTransform: Mat4,
		pose: ArticulatedPose,
	): void {
		for (const frame of entity.attachmentFrames) {
			const partPose = pose.partToObjectTransforms[frame.partIndex];
			if (!partPose)
				throw new Error(
					`Requested attachment part ${frame.partIndex} has no current pose.`,
				);
			composeObjectPartFrame(partPose, entity.rootScale, frame.transform);
		}
		this.#scene.updateLocalTransformWithChildren(
			entity.visualRootNodeId,
			visualRootTransform,
			entity.attachmentFrames,
		);
	}

	prepareAttachment(
		child: DynamicEntityRecord,
		parent: DynamicEntityRecord,
		location: ParentLocation,
		pose: ArticulatedPose,
	): PreparedDynamicAttachment {
		const childRootNodeId = child.rootNodeId;
		const parentRootNodeId = parent.rootNodeId;
		const attachPoint =
			parent.source.presentation.holdingLocations.get(location);
		if (!attachPoint) {
			throw new Error(
				`Dynamic parent ${parentRootNodeId} has no holding location ${location}.`,
			);
		}
		const parentPart = parent.renderable.parts.find(
			(part) => part.partIndex === attachPoint.partIndex,
		);
		if (!parentPart) {
			throw new Error(
				`Dynamic parent ${parentRootNodeId} holding location ${location} names missing part ${attachPoint.partIndex}.`,
			);
		}
		for (const part of child.renderable.parts) {
			const transform = pose.partToObjectTransforms[part.partIndex];
			if (!transform) {
				throw new Error(
					`Dynamic child ${childRootNodeId} attachment pose has no frame for part ${part.partIndex}.`,
				);
			}
		}
		return { child, parent, parentPart, attachPoint, pose };
	}

	applyAttachment({
		child,
		parent,
		parentPart,
		attachPoint,
		pose,
	}: PreparedDynamicAttachment): void {
		composeValidatedPartTransforms(
			child.renderable.parts,
			pose.partToObjectTransforms,
			child.rootScale,
			"Validated child pose became incomplete.",
		);
		this.publishAttachmentFrames(child, child.visualRootTransform, pose);
		child.articulatedPose = pose;
		child.localPartsRevision += 1;
		const placedBounds = this.#boundsPort.presentationBoundsForSample(
			child.renderable.parts,
			child.visualRootTransform,
		);
		child.rigidPresentationBounds = placedBounds;
		child.publishedPresentationBounds = expandBounds(
			placedBounds,
			child.appliedEnvelopeRadius,
			child.publishedPresentationBounds,
		);
		if (child.cullingBounds) {
			child.cullingBounds.union(placedBounds);
			this.#boundsPort.publishCullingBounds(child);
		}
		this.#scene.attachToPart(
			child.rootNodeId,
			this.attachmentFrame(parent, parentPart).nodeId,
			attachPoint.offsetTransform,
		);
	}

	/** Resolve every link before mutating the staged graph; local compositions are direct forests. */
	prepareStagedAttachments(
		entities: readonly DynamicEntityRecord[],
		attachments: readonly DynamicModelAttachment[],
	): readonly PreparedDynamicAttachment[] {
		const models = new Map(
			entities.map((entity) => [entity.rootNodeId, entity]),
		);
		const children = new Set(attachments.map((link) => link.childNodeId));
		if (children.size !== attachments.length)
			throw new Error("Staged attachments contain a duplicate child.");
		return attachments.map((link) => {
			const child = models.get(link.childNodeId);
			if (!child)
				throw new Error(
					`Staged child ${link.childNodeId} does not belong to this installation.`,
				);
			const parent = models.get(link.parentNodeId);
			if (!parent)
				throw new Error(
					`Staged parent ${link.parentNodeId} does not belong to this installation.`,
				);
			if (children.has(link.parentNodeId))
				throw new Error(
					"Staged attachments must link direct children to independent parents.",
				);
			return this.prepareAttachment(
				child,
				parent,
				link.location,
				child.articulatedPose,
			);
		});
	}
}
