import type { BehaviorTargetId } from "../behavior/behavior-event-router";
import { resolveObjectRuntimeLights } from "../environment/object-runtime-lights";
import type { RuntimeLight } from "../environment/runtime-lights";
import { expandBounds } from "../math/geometry-utils";
import { multiplyMat4, transformAffineAABB3 } from "../math/matrices";
import { AABB3, Mat4 } from "../math/types";
import type { NameplateSourceVisual } from "../renderer/overlays/nameplate-policy";
import type { SceneGraph, SceneNodeId } from "../scene";
import { sceneNodeIdOf } from "../scene/utils";
import type { SelectionGeometryMorphology } from "../selection/entity-interaction-shape";
import type { DynamicPresentationSample } from "./animation-system";
import type {
	ActiveDynamicPart,
	DynamicEntityRenderable,
	VisibleDynamicPresentation,
} from "./components";
import type { DynamicEntityDiagnostics } from "./dynamic-entity-diagnostics";
import {
	composeValidatedPartTransforms,
	dynamicModelIsVisible,
	hasFiniteBoundsCoefficients,
	isIdentityBoundsRoot,
	type DynamicEntityRecord,
	type DynamicEntitySelectionGeometry,
	type DynamicEntitySelectionPart,
} from "./dynamic-entity-types";
import {
	nameplateContentEqual,
	type DynamicEntityPresentationState,
	type DynamicPresentationSource,
	type NameplateContent,
} from "./dynamic-presentation-source";
import type { DynamicEntitySceneAndAttachmentAdapter } from "./dynamic-scene-attachments";
import type { EffectSystem } from "./effect-system";

/** Owns dynamic presentation publication, bounds/envelope maintenance, selection geometry, and overlays. */
export class DynamicPresentationAndBoundsPublisher {
	readonly #scene: SceneGraph;
	readonly #effects: EffectSystem;
	readonly #particleEnvelopeRadiusOf: (nodeId: SceneNodeId) => number;
	readonly #takeDirtyParticleEnvelopeOwners: () => ReadonlySet<BehaviorTargetId>;
	readonly #sceneAttachments: DynamicEntitySceneAndAttachmentAdapter;
	readonly #diagnostics: DynamicEntityDiagnostics;
	/** Published residents that currently contribute authored runtime lights. */
	readonly litEntities = new Set<DynamicEntityRecord>();
	/** Scratch used only by synchronous bounds derivation, never returned to consumers. */
	readonly #boundsScratch = {
		transform: Mat4.identity(),
		bounds: AABB3.zero(),
	};
	/** Changes only when the installed nameplate population or one of its visual values changes. */
	nameplatePopulationRevision = 0;

	constructor(
		scene: SceneGraph,
		effects: EffectSystem,
		particleEnvelopeRadiusOf: (nodeId: SceneNodeId) => number,
		takeDirtyParticleEnvelopeOwners: () => ReadonlySet<BehaviorTargetId>,
		sceneAttachments: DynamicEntitySceneAndAttachmentAdapter,
		diagnostics: DynamicEntityDiagnostics,
	) {
		this.#scene = scene;
		this.#effects = effects;
		this.#particleEnvelopeRadiusOf = particleEnvelopeRadiusOf;
		this.#takeDirtyParticleEnvelopeOwners = takeDirtyParticleEnvelopeOwners;
		this.#sceneAttachments = sceneAttachments;
		this.#diagnostics = diagnostics;
	}

	/** Publish sparse current samples to entity-owned state before the frame is selected. */
	publishPresentation(samples: readonly DynamicPresentationSample[]): void {
		const publishedNodeIds = new Set<SceneNodeId>();
		const candidateNodeIds = new Set<SceneNodeId>(
			this.#effects.presentationNodeIds(),
		);
		for (const targetId of this.#takeDirtyParticleEnvelopeOwners()) {
			const nodeId = sceneNodeIdOf(targetId);
			if (nodeId !== null) candidateNodeIds.add(nodeId);
		}
		let particleEnvelopeChangeCount = 0;
		let particleEnvelopeQueryCount = 0;
		let visitedEntityCount = 0;
		const publications = samples.map((sample) => {
			if (publishedNodeIds.has(sample.nodeId))
				throw new Error(
					`Dynamic presentation repeats entity ${sample.nodeId}.`,
				);
			publishedNodeIds.add(sample.nodeId);
			const entity = this.#sceneAttachments.entities.get(sample.nodeId);
			if (!entity)
				throw new Error(`Dynamic entity ${sample.nodeId} does not exist.`);
			visitedEntityCount += 1;
			return { entity, sample };
		});
		for (const { entity, sample } of publications) {
			particleEnvelopeQueryCount += 1;
			if (this.refreshParticleEnvelope(entity)) {
				particleEnvelopeChangeCount += 1;
			}
			this.applySample(entity, sample);
		}
		let effectOnlyCount = 0;
		for (const nodeId of candidateNodeIds) {
			if (publishedNodeIds.has(nodeId)) continue;
			const entity = this.#sceneAttachments.entities.get(nodeId);
			if (!entity) continue;
			visitedEntityCount += 1;
			const effectNeedsPresentation = this.#effects.needsPresentation(nodeId);
			particleEnvelopeQueryCount += 1;
			if (this.refreshParticleEnvelope(entity))
				particleEnvelopeChangeCount += 1;
			// An entity animation covers is either in this frame's samples or was deliberately
			// skipped by the presentation cadence; publishing it here would override that choice.
			if (
				entity.animationHandles.size > 0 ||
				entity.playback.kind === "resolved"
			)
				continue;
			if (!effectNeedsPresentation) continue;
			// A script-only resident holds the pose it was installed with. Its effect state still
			// ramps, rotates, and fades, and before this had no path to the scene at all.
			this.applySample(entity, {
				articulatedPose: entity.articulatedPose,
				effects: this.#effects.samplePresentation(nodeId),
				nodeId,
				localPoseChanged: false,
			});
			effectOnlyCount += 1;
		}
		this.#diagnostics.lastPresentationEntityVisitCount = visitedEntityCount;
		this.#diagnostics.lastPublishedPresentationCount =
			samples.length + effectOnlyCount;
		this.#diagnostics.lastEffectOnlyPresentationCount = effectOnlyCount;
		this.#diagnostics.lastParticleEnvelopeChangeCount =
			particleEnvelopeChangeCount;
		this.#diagnostics.lastParticleEnvelopeQueryCount =
			particleEnvelopeQueryCount;
	}

	/** Publish one installed visual and current part payloads without visiting material ranges. */
	getVisiblePresentation(
		nodeId: SceneNodeId,
	): VisibleDynamicPresentation | null {
		const entity = this.#sceneAttachments.entities.get(nodeId);
		if (
			entity === undefined ||
			entity.presentationOpacity === 0 ||
			!dynamicModelIsVisible(entity)
		)
			return null;
		const resolved = this.#scene.readResolvedState(entity.visualRootNodeId);
		if (resolved === undefined)
			throw new Error(
				`Dynamic visual root ${entity.visualRootNodeId} no longer exists.`,
			);
		const { placement, spatialMembership: membership } = resolved;
		if (
			entity.composedTransformRevision !== placement.transformRevision ||
			entity.composedLocalPartsRevision !== entity.localPartsRevision
		) {
			for (const part of entity.renderable.parts) {
				multiplyMat4(
					placement.localToLandblock,
					part.localToVisualRoot,
					part.frameInstance.sourceToLandblock,
				);
			}
			entity.composedTransformRevision = placement.transformRevision;
			entity.composedLocalPartsRevision = entity.localPartsRevision;
		}
		return {
			allPartsOpaque: entity.allPartsOpaque,
			visual: entity.renderable,
			identity: entity.source.identity,
			landblockId: placement.landblockId,
			renderScopes: membership.scopes,
		};
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
		const entity = this.#sceneAttachments.entities.get(nodeId);
		if (
			entity === undefined ||
			entity.presentationState.noDraw ||
			entity.presentationState.hidden
		)
			return null;
		const visualPlacement = this.#scene.getResolvedPlacement(
			entity.visualRootNodeId,
		);
		if (visualPlacement === undefined) return null;
		const parts: DynamicEntitySelectionPart[] = [];
		for (const part of entity.renderable.parts) {
			// Selection follows posed geometry even when an effect makes the part fully transparent.
			if (part.geometryData === null) continue;
			const ranges = part.depthDrawUnits.filter(
				(range) => range.retailVisibility === "normally-visible",
			);
			if (ranges.length === 0) continue;
			parts.push({
				geometry: part.geometryData,
				localBounds: part.localBounds,
				ranges,
				sourceToLandblock: multiplyMat4(
					visualPlacement.localToLandblock,
					part.localToVisualRoot,
				),
			});
		}
		return visit({
			landblockId: visualPlacement.landblockId,
			localBounds: entity.rigidPresentationBounds,
			parts,
			sourceToLandblock: visualPlacement.localToLandblock,
		});
	}

	/** Return the immutable morphology installed with this entity's resolved appearance. */
	getSelectionGeometryMorphology(
		nodeId: SceneNodeId,
	): SelectionGeometryMorphology | null {
		return (
			this.#sceneAttachments.entities.get(nodeId)
				?.selectionGeometryMorphology ?? null
		);
	}

	/** Return producer-resolved presentation policy without exposing the mutable entity record. */
	getPresentationClass(
		nodeId: SceneNodeId,
	): DynamicPresentationSource["entityClass"] | null {
		return (
			this.#sceneAttachments.entities.get(nodeId)?.source.entityClass ?? null
		);
	}

	/** Return producer-stable identity for deterministic frontend presentation policy. */
	getPresentationIdentity(nodeId: SceneNodeId): string | null {
		return this.#sceneAttachments.entities.get(nodeId)?.source.identity ?? null;
	}

	getRenderable(nodeId: SceneNodeId): DynamicEntityRenderable | null {
		return this.#sceneAttachments.entities.get(nodeId)?.renderable ?? null;
	}

	/** Hard cosmetic opacity withdraws every color/depth submission, preserving selection geometry. */
	setPresentationOpacity(nodeId: SceneNodeId, opacity: 0 | 1): void {
		const entity = this.#sceneAttachments.entities.get(nodeId);
		if (entity === undefined)
			throw new Error(`Dynamic entity ${nodeId} does not exist.`);
		entity.presentationOpacity = opacity;
	}

	/** Read the app-owned binary opacity for selection-mask admission. */
	getPresentationOpacity(nodeId: SceneNodeId): 0 | 1 {
		const entity = this.#sceneAttachments.entities.get(nodeId);
		if (entity === undefined)
			throw new Error(`Dynamic entity ${nodeId} does not exist.`);
		return entity.presentationOpacity;
	}

	/** Hidden and NoDraw suppress meshes; authored emitters retain their own spatial admission. */
	canRenderParticles(nodeId: SceneNodeId): boolean {
		const entity = this.#sceneAttachments.entities.get(nodeId);
		return entity !== undefined && entity.renderable.kind !== "preparing";
	}

	/** Return the revision guarding exact installed nameplate-content enumeration. */
	getNameplatePopulationRevision(): number {
		return this.nameplatePopulationRevision;
	}

	/** Visit each installed nameplate source with the identity needed for viewer classification. */
	forEachNameplateVisual(
		visit: (identity: string, visual: NameplateSourceVisual) => void,
	): void {
		for (const entity of this.#sceneAttachments.entities.values()) {
			if (entity.nameplateContent !== null)
				visit(entity.source.identity, {
					entityClass: entity.source.entityClass,
					content: entity.nameplateContent,
				});
		}
	}

	/** Visit each installed scene node carrying nameplate content for ambient overlay resolution. */
	forEachNameplateNode(
		visit: (
			nodeId: SceneNodeId,
			entityClass: DynamicPresentationSource["entityClass"],
		) => void,
	): void {
		for (const [nodeId, entity] of this.#sceneAttachments.entities) {
			if (entity.nameplateContent !== null)
				visit(nodeId, entity.source.entityClass);
		}
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
		const entity = this.#sceneAttachments.entities.get(nodeId);
		if (entity === undefined) return null;
		return {
			content: entity.nameplateContent,
			identity: entity.source.identity,
			rigidBounds: entity.rigidPresentationBounds,
		};
	}

	/** Replace one installed entity's display value without rebuilding visual resources. */
	updateNameplateContent(nodeId: SceneNodeId, content: NameplateContent): void {
		const entity = this.#sceneAttachments.entities.get(nodeId);
		if (!entity) throw new Error(`Dynamic entity ${nodeId} does not exist.`);
		if (nameplateContentEqual(entity.nameplateContent, content)) return;
		entity.nameplateContent = content;
		this.nameplatePopulationRevision += 1;
	}

	/** Borrow current particle-expanded bounds until the next publication; clone to retain a snapshot. */
	getPublishedPresentationBounds(nodeId: SceneNodeId): AABB3 | null {
		return (
			this.#sceneAttachments.entities.get(nodeId)
				?.publishedPresentationBounds ?? null
		);
	}

	/** Borrow current rigid-pose bounds until the next publication; clone to retain a snapshot. */
	getPublishedRigidPresentationBounds(nodeId: SceneNodeId): AABB3 | null {
		return (
			this.#sceneAttachments.entities.get(nodeId)?.rigidPresentationBounds ??
			null
		);
	}

	/** Replace presentation-only physics consequences without rebuilding entity resources. */
	updatePresentationState(
		nodeId: SceneNodeId,
		state: DynamicEntityPresentationState,
	): void {
		const entity = this.#sceneAttachments.entities.get(nodeId);
		if (!entity) throw new Error(`Dynamic entity ${nodeId} does not exist.`);
		if (
			state.translucency !== entity.presentationState.translucency &&
			!entity.presentationState.cloaked &&
			!state.cloaked
		) {
			// RETAIL QUIRK: retail part translucency assignment ignores whole-object writes
			// while cloaked, and retail physics-state reconciliation does not replay them on
			// uncloak. Correcting this would make property updates received during cloak
			// observable when retail leaves the prior part state. Census 2026-09-02: 928
			// templates author object translucency; live cloak/update overlap is runtime state
			// and cannot be sized from static content.
			this.#effects.applyObjectTranslucency(nodeId, state.translucency);
		}
		this.#effects.setCloaked(nodeId, state.cloaked);
		entity.presentationState = state;
		this.syncLitEntity(entity);
	}

	/** Resolve every enabled setup light from its current object frame into canonical scene space. */
	getRuntimeLights(): readonly RuntimeLight[] {
		const lights: RuntimeLight[] = [];
		for (const entity of this.litEntities) {
			const placement = this.#scene.getResolvedPlacement(entity.rootNodeId);
			if (!placement)
				throw new Error(
					`Dynamic entity ${entity.rootNodeId} no longer exists.`,
				);
			lights.push(
				...resolveObjectRuntimeLights(
					entity.source.presentation.lights,
					placement.localToLandblock,
					placement.landblockId,
				),
			);
		}
		return lights;
	}

	syncLitEntity(entity: DynamicEntityRecord): void {
		if (
			entity.presentationState.lighting &&
			entity.source.presentation.lights.length > 0
		)
			this.litEntities.add(entity);
		else this.litEntities.delete(entity);
	}

	/**
	 * Fold the current particle envelope into every bounds that culls this entity.
	 *
	 * Two independent culls read two different bounds: the scene graph's conservative broadphase
	 * bounds, and the per-pose presentation bounds behind the renderer's footprint test. An envelope
	 * applied to only one of them still loses the whole swarm at the other, which is exactly what
	 * happened — the mesh left the broadphase frustum while its particles were still on screen.
	 *
	 * Returns whether the radius moved, which is what lets an otherwise idle resident skip
	 * republication without stranding a stale envelope.
	 */
	refreshParticleEnvelope(entity: DynamicEntityRecord): boolean {
		const radius = this.#particleEnvelopeRadiusOf(entity.rootNodeId);
		if (radius === entity.appliedEnvelopeRadius) return false;
		entity.appliedEnvelopeRadius = radius;
		this.publishCullingBounds(entity);
		expandBounds(
			entity.rigidPresentationBounds,
			radius,
			entity.publishedPresentationBounds,
		);
		return true;
	}

	/** Publish the broadphase envelope for the radius currently folded into this entity. */
	publishCullingBounds(entity: DynamicEntityRecord): void {
		if (entity.cullingBounds === null) {
			throw new Error(
				`Dynamic entity ${entity.rootNodeId} has no culling bounds to publish.`,
			);
		}
		this.#scene.updateBounds(
			entity.rootNodeId,
			expandBounds(
				entity.cullingBounds,
				entity.appliedEnvelopeRadius,
				this.#boundsScratch.bounds,
			),
		);
	}

	applySample(
		entity: DynamicEntityRecord,
		sample: DynamicPresentationSample,
	): void {
		if (
			sample.effects.partRenderStates.length !== entity.renderable.parts.length
		) {
			throw new Error(
				`Dynamic entity ${entity.rootNodeId} effect sample has ${sample.effects.partRenderStates.length} parts, expected ${entity.renderable.parts.length}.`,
			);
		}
		let allPartsOpaque = true;
		for (const part of entity.renderable.parts) {
			const transform =
				sample.articulatedPose.partToObjectTransforms[part.partIndex];
			const sampledRenderState =
				sample.effects.partRenderStates[part.partIndex];
			if (!transform || !sampledRenderState)
				throw new Error(
					`Dynamic entity ${entity.rootNodeId} has an incomplete presentation for part ${part.partIndex}.`,
				);
		}
		for (const part of entity.renderable.parts) {
			const sampledRenderState =
				sample.effects.partRenderStates[part.partIndex];
			if (!sampledRenderState) {
				throw new Error("Validated dynamic sample became incomplete.");
			}
			// Effect ownership admits material writes, including cloak behavior, before publication.
			part.renderState = sampledRenderState;
			// Hidden parts retain their dense selector; the shader clips zero opacity.
			part.frameInstance.color.a = 1 - sampledRenderState.translucency;
			allPartsOpaque &&= part.frameInstance.color.a === 1;
		}
		if (sample.localPoseChanged) {
			composeValidatedPartTransforms(
				entity.renderable.parts,
				sample.articulatedPose.partToObjectTransforms,
				entity.rootScale,
				"Validated dynamic pose became incomplete.",
			);
			entity.localPartsRevision += 1;
		}
		entity.allPartsOpaque = allPartsOpaque;
		// Two independent sources can turn the visual root: continuous effect omega and an
		// authored root frame. They compose rather than compete, with the authored frame innermost
		// because it is part of the pose the clip describes.
		const visualRootTransform =
			sample.articulatedPose.authoredRootTransform === null
				? sample.effects.rootTransformModifier
				: multiplyMat4(
						sample.articulatedPose.authoredRootTransform,
						sample.effects.rootTransformModifier,
						entity.visualRootTransform,
					);
		const rigidPresentationBounds = this.presentationBoundsForSample(
			entity.renderable.parts,
			visualRootTransform,
			entity.rigidPresentationBounds,
		);
		const cullingBounds = entity.cullingBounds;
		if (cullingBounds === null)
			throw new Error(
				"Dynamic pose publication requires prepared culling bounds.",
			);
		// Composing independently authored poses can exceed either clip's prepared sweep.
		// Retain the union for this visual lifetime so broadphase selection covers every sampled pose.
		if (
			rigidPresentationBounds.min.x < cullingBounds.min.x ||
			rigidPresentationBounds.min.y < cullingBounds.min.y ||
			rigidPresentationBounds.min.z < cullingBounds.min.z ||
			rigidPresentationBounds.max.x > cullingBounds.max.x ||
			rigidPresentationBounds.max.y > cullingBounds.max.y ||
			rigidPresentationBounds.max.z > cullingBounds.max.z
		) {
			cullingBounds.union(rigidPresentationBounds);
			this.publishCullingBounds(entity);
		}
		const publishedPresentationBounds = expandBounds(
			rigidPresentationBounds,
			entity.appliedEnvelopeRadius,
			entity.publishedPresentationBounds,
		);
		this.#sceneAttachments.publishAttachmentFrames(
			entity,
			visualRootTransform,
			sample.articulatedPose,
		);
		entity.visualRootTransform.copy(visualRootTransform);
		entity.articulatedPose = sample.articulatedPose;
		entity.rigidPresentationBounds = rigidPresentationBounds;
		entity.publishedPresentationBounds = publishedPresentationBounds;
	}

	/** Derive the current rigid bound with reusable part scratch and optional retained output. */
	presentationBoundsForSample(
		parts: readonly ActiveDynamicPart[],
		rootTransform: Mat4,
		target: AABB3 = AABB3.zero(),
	): AABB3 {
		if (parts.length === 0)
			throw new Error("Dynamic presentation has no bounded active parts.");
		// With no visual-root modifier, each posed part is already in the entity's bounds frame.
		const rootIsIdentity = isIdentityBoundsRoot(rootTransform);
		let first = true;
		for (const part of parts) {
			const partBounds = transformAffineAABB3(
				rootIsIdentity && hasFiniteBoundsCoefficients(part.localToVisualRoot)
					? part.localToVisualRoot
					: multiplyMat4(
							rootTransform,
							part.localToVisualRoot,
							this.#boundsScratch.transform,
						),
				part.localBounds,
				this.#boundsScratch.bounds,
			);
			if (first) target.copy(partBounds);
			else target.union(partBounds);
			first = false;
		}
		return target;
	}
}
