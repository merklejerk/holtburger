import type {
	AnimationAssetRepository,
	PreparedAnimation,
} from "../animation/animation-asset-repository";
import type { PreparedDynamicAnimation } from "../animation/prepared-dynamic-animation";
import type { BehaviorTargetId } from "../behavior/behavior-event-router";
import type { ParticleEmitterRepository } from "../behavior/particle-emitter-repository";
import type { PhysicsScriptRepository } from "../behavior/physics-script-repository";
import type { SoundTableRepository } from "../behavior/sound-table-repository";
import type { RuntimeLight } from "../environment/runtime-lights";
import type { DatAssetId } from "../game-types";
import type { AABB3, Mat4 } from "../math/types";
import type { NameplateSourceVisual } from "../renderer/overlays/nameplate-policy";
import type {
	ParentLocation,
	SetupSidewaysSpan,
} from "../resolution/presentation";
import type {
	DynamicEntityAdvance,
	DynamicEntityTickBatch,
} from "../runtime/dynamic-entity-feed";
import type { SceneGraph, SceneNodeId, SceneSpatialPlacement } from "../scene";
import type { SelectionGeometryMorphology } from "../selection/entity-interaction-shape";
import type { DynamicPresentationSample } from "./animation-system";
import type {
	DynamicEntityRenderable,
	VisibleDynamicPresentation,
} from "./components";
import { DynamicEntityDiagnostics } from "./dynamic-entity-diagnostics";
import type { DynamicEntityPlacementSystem } from "./dynamic-entity-placement-system";
import type {
	DynamicEntitySelectionGeometry,
	DynamicOwnerInstallation,
	DynamicVisualReplacement,
} from "./dynamic-entity-types";
import { DynamicOwnerPreparationAndStaging } from "./dynamic-owner-staging";
import { DynamicPresentationAndBoundsPublisher } from "./dynamic-presentation-bounds";
import type {
	DynamicEntityPresentationState,
	DynamicPresentationSource,
	NameplateContent,
	PlacedDynamicPresentationSource,
} from "./dynamic-presentation-source";
import { DynamicEntitySceneAndAttachmentAdapter } from "./dynamic-scene-attachments";
import type { EffectSystem } from "./effect-system";
import type { ObjectVisualTemplateRepositoryPort } from "./object-visual-template-repository";

export type {
	DynamicEntitySelectionGeometry,
	DynamicModelAttachment,
	DynamicOwnerInstallation,
	DynamicVisualReplacement,
	PreparedDynamicEntity,
} from "./dynamic-entity-types";

/** Owns dynamic entity trees, rigid-part components, and reusable visual preparation. */
export class DynamicEntitySystem<
	TOwnerId extends string,
	TTemplateOwnerId extends string = TOwnerId,
> {
	readonly #diagnostics: DynamicEntityDiagnostics;
	readonly #sceneAttachments: DynamicEntitySceneAndAttachmentAdapter;
	readonly #presentationBounds: DynamicPresentationAndBoundsPublisher;
	readonly #ownerStaging: DynamicOwnerPreparationAndStaging<
		TOwnerId,
		TTemplateOwnerId
	>;

	constructor(
		scene: SceneGraph,
		placements: DynamicEntityPlacementSystem,
		templates: ObjectVisualTemplateRepositoryPort<TTemplateOwnerId>,
		animations: AnimationAssetRepository,
		scripts: PhysicsScriptRepository,
		emitters: ParticleEmitterRepository,
		effects: EffectSystem,
		soundTables: SoundTableRepository,
		templateOwnerId: (
			ownerId: TOwnerId,
			generation: number,
		) => TTemplateOwnerId,
		/**
		 * Conservative radius around a target containing every particle it currently emits.
		 *
		 * Presentation bounds otherwise cover only the mesh, so an emitter whose particles reach
		 * past it would be culled while still visible. Injected because the live emitter set — and
		 * the authored hook offsets that displace it — belong to the particle system, not here.
		 */
		particleEnvelopeRadiusOf: (nodeId: SceneNodeId) => number,
		/** Owners whose emitter lifetime changed since the previous publication. */
		takeDirtyParticleEnvelopeOwners: () => ReadonlySet<BehaviorTargetId>,
	) {
		this.#diagnostics = new DynamicEntityDiagnostics();
		this.#sceneAttachments = new DynamicEntitySceneAndAttachmentAdapter(
			scene,
			placements,
			{
				presentationBoundsForSample: (parts, rootTransform, target) =>
					this.#presentationBounds.presentationBoundsForSample(
						parts,
						rootTransform,
						target,
					),
				publishCullingBounds: (entity) =>
					this.#presentationBounds.publishCullingBounds(entity),
			},
		);
		this.#presentationBounds = new DynamicPresentationAndBoundsPublisher(
			scene,
			effects,
			particleEnvelopeRadiusOf,
			takeDirtyParticleEnvelopeOwners,
			this.#sceneAttachments,
			this.#diagnostics,
		);
		this.#ownerStaging = new DynamicOwnerPreparationAndStaging(
			scene,
			placements,
			templates,
			animations,
			scripts,
			emitters,
			effects,
			soundTables,
			templateOwnerId,
			this.#sceneAttachments,
			this.#presentationBounds,
		);
	}

	/** Replace one producer's complete dynamic population as a single owner generation. */
	replaceOwner(
		ownerId: TOwnerId,
		placedSources: readonly PlacedDynamicPresentationSource[],
	): DynamicOwnerInstallation {
		return this.#ownerStaging.replaceOwner(ownerId, placedSources);
	}

	/** Stage changed appearance resources while preserving the live entity and all owner siblings. */
	stageVisualReplacement(
		ownerId: TOwnerId,
		rootNodeId: SceneNodeId,
		source: DynamicPresentationSource,
	): Promise<DynamicVisualReplacement> {
		return this.#ownerStaging.stageVisualReplacement(
			ownerId,
			rootNodeId,
			source,
		);
	}

	removeOwner(ownerId: TOwnerId): void {
		this.#ownerStaging.removeOwner(ownerId);
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
		return this.#sceneAttachments.requestPartNode(rootNodeId, partIndex);
	}

	/** Resolve behavior/particle targets to their model without walking or copying scene ancestry. */
	modelRootOf(nodeId: SceneNodeId): SceneNodeId | null {
		return this.#sceneAttachments.modelRootOf(nodeId);
	}

	/** Hidden and NoDraw suppress meshes; authored emitters retain their own spatial admission. */
	canRenderParticles(nodeId: SceneNodeId): boolean {
		return this.#presentationBounds.canRenderParticles(nodeId);
	}

	/** Copy one live entity's resolved object placement for synchronous child staging. */
	resolvedRootPlacement(rootNodeId: SceneNodeId): SceneSpatialPlacement | null {
		return this.#sceneAttachments.resolvedRootPlacement(rootNodeId);
	}

	/** Identify the installed setup that prevents a live child from attaching. */
	setupMissingHoldingLocation(
		parentNodeId: SceneNodeId,
		location: ParentLocation,
	): DatAssetId | null {
		return this.#sceneAttachments.setupMissingHoldingLocation(
			parentNodeId,
			location,
		);
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
		this.#sceneAttachments.attachEntity(
			childRootNodeId,
			parentRootNodeId,
			location,
			placementKey,
		);
	}

	getRenderable(nodeId: SceneNodeId): DynamicEntityRenderable | null {
		return this.#presentationBounds.getRenderable(nodeId);
	}

	/** Hard cosmetic opacity withdraws every color/depth submission, preserving selection geometry. */
	setPresentationOpacity(nodeId: SceneNodeId, opacity: 0 | 1): void {
		this.#presentationBounds.setPresentationOpacity(nodeId, opacity);
	}

	/** Read the app-owned binary opacity for selection-mask admission. */
	getPresentationOpacity(nodeId: SceneNodeId): 0 | 1 {
		return this.#presentationBounds.getPresentationOpacity(nodeId);
	}

	/** Publish one installed visual and current part payloads without visiting material ranges. */
	getVisiblePresentation(
		nodeId: SceneNodeId,
	): VisibleDynamicPresentation | null {
		return this.#presentationBounds.getVisiblePresentation(nodeId);
	}

	/**
	 * Visit current posed drawing geometry synchronously without copying mesh buffers.
	 *
	 * The scene resolution includes attached parent-part ancestry. The view and its composed matrices
	 * are ephemeral; consumers must finish their query before the callback returns.
	 */
	withSelectionGeometry<T>(
		nodeId: SceneNodeId,
		visit: (geometry: DynamicEntitySelectionGeometry) => T,
	): T | null {
		return this.#presentationBounds.withSelectionGeometry(nodeId, visit);
	}

	/** Return the immutable morphology installed with this entity's resolved appearance. */
	getSelectionGeometryMorphology(
		nodeId: SceneNodeId,
	): SelectionGeometryMorphology | null {
		return this.#presentationBounds.getSelectionGeometryMorphology(nodeId);
	}

	/** Return producer-resolved presentation policy without exposing the mutable entity record. */
	getPresentationClass(
		nodeId: SceneNodeId,
	): DynamicPresentationSource["entityClass"] | null {
		return this.#presentationBounds.getPresentationClass(nodeId);
	}

	/** Return producer-stable identity for deterministic frontend presentation policy. */
	getPresentationIdentity(nodeId: SceneNodeId): string | null {
		return this.#presentationBounds.getPresentationIdentity(nodeId);
	}

	/** Return the revision guarding exact installed nameplate-content enumeration. */
	getNameplatePopulationRevision(): number {
		return this.#presentationBounds.getNameplatePopulationRevision();
	}

	/** Visit each installed nameplate source with the identity needed for viewer classification. */
	forEachNameplateVisual(
		visit: (identity: string, visual: NameplateSourceVisual) => void,
	): void {
		this.#presentationBounds.forEachNameplateVisual(visit);
	}

	/** Visit each installed scene node carrying nameplate content for ambient overlay resolution. */
	forEachNameplateNode(
		visit: (
			nodeId: SceneNodeId,
			entityClass: DynamicPresentationSource["entityClass"],
		) => void,
	): void {
		this.#presentationBounds.forEachNameplateNode(visit);
	}

	/**
	 * Return the overlay anchor bounds, identity, and optional label content for one
	 * already-selected entity. Absent label content still anchors an independently admitted bar.
	 */
	getOverlayFacts(nodeId: SceneNodeId): {
		readonly content: NameplateContent | null;
		readonly identity: string;
		readonly rigidBounds: AABB3;
	} | null {
		return this.#presentationBounds.getOverlayFacts(nodeId);
	}

	/** Replace one installed entity's display value without rebuilding visual resources. */
	updateNameplateContent(nodeId: SceneNodeId, content: NameplateContent): void {
		this.#presentationBounds.updateNameplateContent(nodeId, content);
	}

	/** Borrow current particle-expanded bounds until the next publication; clone to retain a snapshot. */
	getPublishedPresentationBounds(nodeId: SceneNodeId): AABB3 | null {
		return this.#presentationBounds.getPublishedPresentationBounds(nodeId);
	}

	/** Borrow current rigid-pose bounds until the next publication; clone to retain a snapshot. */
	getPublishedRigidPresentationBounds(nodeId: SceneNodeId): AABB3 | null {
		return this.#presentationBounds.getPublishedRigidPresentationBounds(nodeId);
	}

	/** Apply one complete producer placement through the sole dynamic-root writer. */
	updatePlacement(nodeId: SceneNodeId, placement: SceneSpatialPlacement): void {
		this.#sceneAttachments.updatePlacement(nodeId, placement);
	}

	/** Apply a pose-stable membership refresh without replacing movement or animation. */
	refreshPlacementMembership(
		nodeId: SceneNodeId,
		point: DynamicEntityAdvance["path"]["initial"],
	): void {
		this.#sceneAttachments.refreshPlacementMembership(nodeId, point);
	}

	/** Apply one host-accepted transient path through the sole dynamic-root placement owner. */
	updatePlacementPath(
		nodeId: SceneNodeId,
		advance: DynamicEntityAdvance,
		durationMs: DynamicEntityTickBatch["durationMs"],
		startedAtMs: number,
	): void {
		this.#sceneAttachments.updatePlacementPath(
			nodeId,
			advance,
			durationMs,
			startedAtMs,
		);
	}

	/** Approximate authored sideways span; no animation or mesh work occurs during map sampling. */
	setupSidewaysSpan(nodeId: SceneNodeId): SetupSidewaysSpan | null {
		return this.#sceneAttachments.setupSidewaysSpan(nodeId);
	}

	/** Apply one projected absolute root scale without reloading or replacing visual resources. */
	updateRootScale(nodeId: SceneNodeId, scale: number): void {
		this.#sceneAttachments.updateRootScale(nodeId, scale);
	}

	/** Replace presentation-only physics consequences without rebuilding entity resources. */
	updatePresentationState(
		nodeId: SceneNodeId,
		state: DynamicEntityPresentationState,
	): void {
		this.#presentationBounds.updatePresentationState(nodeId, state);
	}

	/** Resolve every enabled setup light from its current object frame into canonical scene space. */
	getRuntimeLights(): readonly RuntimeLight[] {
		return this.#presentationBounds.getRuntimeLights();
	}

	/** Inspect complete preparation without exposing repository handles or mutable staging state. */
	getPreparedAnimation(nodeId: SceneNodeId): PreparedDynamicAnimation | null {
		return this.#ownerStaging.getPreparedAnimation(nodeId);
	}

	/**
	 * Resolve one animation from a motion-driven entity's staged assets.
	 *
	 * `null` means presentation could not prepare or play this table animation. Preparation has
	 * already reported the refusal; the caller keeps the current pose. Throws
	 * for an entity with no motion playback at all, because the host names a clip only for a body
	 * whose motion table this entity staged, so a mismatch there is a contract defect rather than
	 * a content one.
	 */
	getMotionClip(
		nodeId: SceneNodeId,
		animationId: DatAssetId,
	): PreparedAnimation | null {
		return this.#ownerStaging.getMotionClip(nodeId, animationId);
	}

	/** Complete currently published pose used to seed a motion-driven entity's first clip. */
	getPartToObjectTransforms(nodeId: SceneNodeId): readonly Mat4[] {
		return this.#ownerStaging.getPartToObjectTransforms(nodeId);
	}

	getDiagnostics() {
		return this.#ownerStaging.getDiagnostics(this.#diagnostics);
	}

	/** Publish sparse current samples to entity-owned state before the frame is selected. */
	publishPresentation(samples: readonly DynamicPresentationSample[]): void {
		this.#presentationBounds.publishPresentation(samples);
	}

	destroy(): Promise<void> {
		return this.#ownerStaging.destroy();
	}
}
