import type { AuthoredDynamicSource } from "../resolution/landblock-layer";
import { AABB3, Mat4, Vec3 } from "../math/types";
import { multiplyMat4, transformAABB3 } from "../math/matrices";
import type { SceneGraph, SceneNodeId } from "../scene";
import { scopeKey } from "../scene/scope";
import {
	resolveObjectPresentationBounds,
	type ResolvedObjectPresentation,
} from "../resolution/presentation";
import { composeObjectPartTransform } from "../resolution/object-part-transform";
import type {
	ActiveDynamicPart,
	ArticulatedPose,
	DynamicEntityRenderable,
	VisibleRigidPartContribution,
} from "./components";
import type { DynamicPresentationSample } from "./animation-system";
import {
	objectVisualTemplateKey,
	type ObjectVisualTemplateRepositoryPort,
	type PartVisualTemplate,
	type StagedObjectVisualTemplateOwner,
} from "./object-visual-template-repository";
import {
	AnimationAssetRepository,
	type PreparedAnimationHandle,
} from "../animation/animation-asset-repository";
import {
	prepareDynamicAnimation,
	type PreparedDynamicAnimation,
} from "../animation/prepared-dynamic-animation";

interface DynamicEntityRecord {
	readonly rootNodeId: SceneNodeId;
	readonly visualRootNodeId: SceneNodeId;
	/** Closed authored source retained for animation staging and deterministic phase identity. */
	readonly source: AuthoredDynamicSource;
	renderable: DynamicEntityRenderable;
	articulatedPose: ArticulatedPose;
	animationHandle: PreparedAnimationHandle | null;
	preparedAnimation: PreparedDynamicAnimation | null;
	/** Conservative object-local envelope matching the exact pose currently published to draw. */
	publishedPresentationBounds: AABB3;
}

interface DynamicOwnerRecord<TTemplateOwnerId extends string> {
	/** Monotonic owner generation guarding asynchronous preparation publication. */
	readonly generation: number;
	readonly entities: readonly DynamicEntityRecord[];
	/** Generation-private geometry owner retained until this active generation retires. */
	readonly templateOwnerId: TTemplateOwnerId;
}

/** Atomic authored-owner installation and its complete visual-staging outcome. */
export interface DynamicOwnerInstallation {
	readonly nodeIds: readonly SceneNodeId[];
	readonly ready: Promise<"ready" | "superseded">;
	/** Read complete staged animation facts after `ready` resolves successfully. */
	getPreparedEntities(): readonly PreparedDynamicEntity[];
	/** Validate and apply initial samples while staged nodes remain unpublished. */
	prepareCommit(initialSamples: readonly DynamicPresentationSample[]): void;
	/** Publish the already validated generation and retire its predecessor. */
	commit(): void;
	/** Release a successfully prepared generation that will not be committed. */
	release(): void;
}

/** Runtime activation facts for one fully prepared but unpublished dynamic entity. */
interface PreparedDynamicEntity {
	readonly animation: PreparedDynamicAnimation;
	readonly nodeId: SceneNodeId;
	readonly source: AuthoredDynamicSource;
}

/** Owns dynamic entity trees, rigid-part components, and reusable visual preparation. */
export class DynamicEntitySystem<
	TOwnerId extends string,
	TTemplateOwnerId extends string = TOwnerId,
> {
	readonly #scene: SceneGraph;
	readonly #templates: ObjectVisualTemplateRepositoryPort<TTemplateOwnerId>;
	readonly #animations: AnimationAssetRepository;
	readonly #templateOwnerId: (
		ownerId: TOwnerId,
		generation: number,
	) => TTemplateOwnerId;
	readonly #owners = new Map<TOwnerId, DynamicOwnerRecord<TTemplateOwnerId>>();
	readonly #entities = new Map<SceneNodeId, DynamicEntityRecord>();
	readonly #ownerGenerations = new Map<TOwnerId, number>();
	/** Preparations awaited during shutdown so acquired handles cannot outlive repositories. */
	readonly #pendingPreparations = new Set<Promise<unknown>>();
	/** Current provisional template stage per owner, cancelled immediately on supersession. */
	readonly #pendingTemplateStages = new Map<
		TOwnerId,
		StagedObjectVisualTemplateOwner<TTemplateOwnerId>
	>();
	#destroyed = false;
	#lastPresentationPublicationDurationMs = 0;
	#lastPublishedPresentationCount = 0;

	constructor(
		scene: SceneGraph,
		templates: ObjectVisualTemplateRepositoryPort<TTemplateOwnerId>,
		animations: AnimationAssetRepository,
		templateOwnerId: (
			ownerId: TOwnerId,
			generation: number,
		) => TTemplateOwnerId,
	) {
		this.#scene = scene;
		this.#templates = templates;
		this.#animations = animations;
		this.#templateOwnerId = templateOwnerId;
	}

	/** Replace one authored layer's complete promoted population as a single owner generation. */
	replaceOwner(
		ownerId: TOwnerId,
		sources: readonly AuthoredDynamicSource[],
	): DynamicOwnerInstallation {
		if (this.#destroyed)
			throw new Error("Cannot install a destroyed dynamic system.");
		const entities: DynamicEntityRecord[] = [];
		try {
			for (const source of sources) entities.push(this.#createEntity(source));
		} catch (cause) {
			for (const entity of entities) this.#destroyEntityTree(entity);
			throw cause;
		}
		let templatePreparation: StagedObjectVisualTemplateOwner<TTemplateOwnerId>;
		try {
			templatePreparation = this.#templates.stageOwner(sources);
		} catch (cause) {
			for (const entity of entities) this.#destroyEntityTree(entity);
			throw cause;
		}
		const generation = (this.#ownerGenerations.get(ownerId) ?? 0) + 1;
		this.#ownerGenerations.set(ownerId, generation);
		this.#pendingTemplateStages.get(ownerId)?.release();
		this.#pendingTemplateStages.set(ownerId, templatePreparation);
		const templateOwnerId = this.#templateOwnerId(ownerId, generation);
		let state:
			| "preparing"
			| "ready"
			| "prepared-to-commit"
			| "superseded"
			| "committed"
			| "released" = "preparing";
		const preparationPromise = this.#prepareOwner(
			ownerId,
			generation,
			entities,
			templatePreparation,
			templateOwnerId,
			entities.map((entity) =>
				this.#animations.acquire(entity.source.behavior.animationId),
			),
		);
		this.#pendingPreparations.add(preparationPromise);
		const ready = preparationPromise
			.then((outcome) => {
				state = outcome;
				return outcome;
			})
			.finally(() => {
				this.#pendingPreparations.delete(preparationPromise);
				if (this.#pendingTemplateStages.get(ownerId) === templatePreparation) {
					this.#pendingTemplateStages.delete(ownerId);
				}
			});
		return {
			commit: () => {
				if (state !== "prepared-to-commit")
					throw new Error(`Cannot commit a dynamic owner in state ${state}.`);
				this.#publishPreparedOwner(
					ownerId,
					generation,
					entities,
					templateOwnerId,
				);
				state = "committed";
			},
			prepareCommit: (initialSamples) => {
				if (state !== "ready")
					throw new Error(
						`Cannot prepare a dynamic owner commit in state ${state}.`,
					);
				try {
					this.#prepareOwnerCommit(
						ownerId,
						generation,
						entities,
						initialSamples,
					);
					state = "prepared-to-commit";
				} catch (cause) {
					state = "released";
					this.#releaseStagedOwner(entities, templateOwnerId);
					throw cause;
				}
			},
			getPreparedEntities: () => {
				if (state !== "ready")
					throw new Error(`Cannot inspect a dynamic owner in state ${state}.`);
				return entities.map((entity) => {
					if (!entity.preparedAnimation)
						throw new Error(
							`Dynamic entity ${entity.rootNodeId} is not prepared.`,
						);
					return {
						animation: entity.preparedAnimation,
						nodeId: entity.rootNodeId,
						source: entity.source,
					};
				});
			},
			nodeIds: entities.map(({ rootNodeId }) => rootNodeId),
			ready,
			release: () => {
				if (state !== "ready" && state !== "prepared-to-commit") return;
				state = "released";
				this.#releaseStagedOwner(entities, templateOwnerId);
			},
		};
	}

	#createEntity(resident: AuthoredDynamicSource): DynamicEntityRecord {
		const rootNodeId = this.#scene.createNode({
			...resident.placement,
			cullingGroup: "dynamic",
			// The staged generation publishes conservative bounds with playback activation.
			localBounds: null,
			parentId: null,
		});
		const pose = defaultPose(resident.presentation);
		let parts: readonly ActiveDynamicPart[];
		const visualRootNodeId = this.#scene.createNode({
			localBounds: null,
			localTransform: Mat4.identity(),
			parentId: rootNodeId,
		});
		try {
			parts = createActiveParts(
				this.#scene,
				visualRootNodeId,
				resident.presentation,
				pose,
				resident.scale,
			);
		} catch (cause) {
			this.#scene.destroyNode(visualRootNodeId);
			this.#scene.destroyNode(rootNodeId);
			throw cause;
		}
		const record: DynamicEntityRecord = {
			animationHandle: null,
			articulatedPose: pose,
			renderable: { parts },
			rootNodeId,
			source: resident,
			preparedAnimation: null,
			publishedPresentationBounds: staticPresentationBounds(resident),
			visualRootNodeId,
		};
		return record;
	}

	removeOwner(ownerId: TOwnerId): void {
		this.#ownerGenerations.set(
			ownerId,
			(this.#ownerGenerations.get(ownerId) ?? 0) + 1,
		);
		this.#pendingTemplateStages.get(ownerId)?.release();
		this.#pendingTemplateStages.delete(ownerId);
		this.#removeOwnerEntities(ownerId);
	}

	getRenderable(nodeId: SceneNodeId): DynamicEntityRenderable | null {
		return this.#entities.get(nodeId)?.renderable ?? null;
	}

	/** Return the current drawn-pose envelope without expanding rigid-part contributions. */
	getPublishedPresentationBounds(nodeId: SceneNodeId): AABB3 | null {
		return this.#entities.get(nodeId)?.publishedPresentationBounds ?? null;
	}

	/** Resolve every active rigid part into the selected entity's current render domain. */
	getVisibleContributions(
		nodeId: SceneNodeId,
	): readonly VisibleRigidPartContribution[] | null {
		const entity = this.#entities.get(nodeId);
		if (!entity) return null;
		return entity.renderable.parts.flatMap((part) => {
			const translucency = part.renderState.translucency;
			// Retail sets the skip-draw bit only at exactly full translucency.
			if (translucency === 1) return [];
			const placement = this.#scene.getResolvedPlacement(part.nodeId);
			if (!placement) {
				throw new Error(`Dynamic part node ${part.nodeId} no longer exists.`);
			}
			return part.drawUnits.map((activeDrawUnit) => {
				const drawUnit = activeDrawUnit.drawUnit;
				const ordering =
					translucency !== 0 && drawUnit.ordering === "opaque"
						? "transparent"
						: drawUnit.ordering;
				return {
					domain: {
						key: `${placement.landblockId}/${scopeKey(placement.scope)}`,
						landblockId: placement.landblockId,
						scope: placement.scope,
					},
					drawUnit:
						ordering === drawUnit.ordering
							? drawUnit
							: { ...drawUnit, ordering },
					instance: {
						color: { a: 1 - translucency, b: 1, g: 1, r: 1 },
						sourceToLandblock: placement.localToLandblock,
					},
					transparentSort:
						ordering === "transparent"
							? {
									center: activeDrawUnit.transparentSortCenter,
									stableId: `${entity.source.identity.sourceId}/part:${part.partIndex}/${drawUnit.batchKey}`,
								}
							: null,
				};
			});
		});
	}

	getPose(nodeId: SceneNodeId): ArticulatedPose | null {
		const entity = this.#entities.get(nodeId);
		return entity ? entity.articulatedPose : null;
	}

	/** Inspect complete preparation without exposing repository handles or mutable staging state. */
	getPreparedAnimation(nodeId: SceneNodeId): PreparedDynamicAnimation | null {
		return this.#entities.get(nodeId)?.preparedAnimation ?? null;
	}

	getDiagnostics() {
		const prepared = [...this.#entities.values()].map(
			(entity) => entity.preparedAnimation,
		);
		return {
			activatableEntityCount: prepared.filter(
				(animation) => animation?.kind === "activatable",
			).length,
			animationResources: this.#animations.getDiagnostics(),
			entityCount: this.#entities.size,
			lastPresentationPublicationDurationMs:
				this.#lastPresentationPublicationDurationMs,
			lastPublishedPresentationCount: this.#lastPublishedPresentationCount,
			staticFallbackEntityCount: prepared.filter(
				(animation) => animation?.kind === "retain-static-presentation",
			).length,
			templates: this.#templates.getDiagnostics(),
		};
	}

	/** Publish sparse current samples to entity-owned state before the frame is selected. */
	publishPresentation(samples: readonly DynamicPresentationSample[]): void {
		const startedAt = performance.now();
		const publishedNodeIds = new Set<SceneNodeId>();
		const publications = samples.map((sample) => {
			if (publishedNodeIds.has(sample.nodeId))
				throw new Error(
					`Dynamic presentation repeats entity ${sample.nodeId}.`,
				);
			publishedNodeIds.add(sample.nodeId);
			const entity = this.#entities.get(sample.nodeId);
			if (!entity)
				throw new Error(`Dynamic entity ${sample.nodeId} does not exist.`);
			return { entity, sample };
		});
		for (const { entity, sample } of publications) {
			this.#applySample(entity, sample);
		}
		this.#lastPresentationPublicationDurationMs = performance.now() - startedAt;
		this.#lastPublishedPresentationCount = samples.length;
	}

	async destroy(): Promise<void> {
		if (this.#destroyed) return;
		this.#destroyed = true;
		for (const preparation of this.#pendingTemplateStages.values()) {
			preparation.release();
		}
		this.#pendingTemplateStages.clear();
		for (const ownerId of [...this.#owners.keys()]) this.removeOwner(ownerId);
		await Promise.allSettled([...this.#pendingPreparations]);
		await this.#templates.destroy();
		this.#animations.destroy();
	}

	async #prepareOwner(
		ownerId: TOwnerId,
		generation: number,
		entities: readonly DynamicEntityRecord[],
		preparation: StagedObjectVisualTemplateOwner<TTemplateOwnerId>,
		templateOwnerId: TTemplateOwnerId,
		animationPreparations: readonly Promise<PreparedAnimationHandle>[],
	): Promise<"ready" | "superseded"> {
		const [templateResult, ...animationResults] = await Promise.allSettled([
			preparation.completion,
			...animationPreparations,
		]);
		const acquiredHandles = animationResults.flatMap((result) =>
			result.status === "fulfilled" ? [result.value] : [],
		);
		const current =
			!this.#destroyed && this.#ownerGenerations.get(ownerId) === generation;
		if (!current) {
			for (const handle of acquiredHandles) handle.release();
			preparation.release();
			for (const entity of entities) this.#destroyEntityTree(entity);
			return "superseded";
		}
		const failure = [templateResult, ...animationResults].find(
			(result) => result.status === "rejected",
		);
		if (failure?.status === "rejected") {
			for (const handle of acquiredHandles) handle.release();
			preparation.release();
			for (const entity of entities) this.#destroyEntityTree(entity);
			throw failure.reason;
		}
		if (templateResult.status !== "fulfilled") {
			throw new Error(
				"Dynamic template preparation settled without an outcome.",
			);
		}
		const templates = templateResult.value;
		try {
			const prepared = entities.map((entity, index) => {
				const template = templates.get(objectVisualTemplateKey(entity.source));
				if (!template) {
					throw new Error(
						`Visual template for ${entity.source.identity.sourceId} was not prepared.`,
					);
				}
				const animationResult = animationResults[index];
				if (animationResult?.status !== "fulfilled") {
					throw new Error(
						`Animation for ${entity.source.identity.sourceId} settled without a handle.`,
					);
				}
				return {
					animation: prepareDynamicAnimation(
						animationResult.value.animation,
						template,
						entity.source.scale,
						staticPresentationBounds(entity.source),
					),
					handle: animationResult.value,
					parts: mergePreparedParts(entity.renderable.parts, template.parts),
				};
			});
			preparation.commit(templateOwnerId);
			for (let index = 0; index < entities.length; index += 1) {
				const entity = entities[index]!;
				const result = prepared[index]!;
				entity.animationHandle = result.handle;
				entity.preparedAnimation = result.animation;
				entity.renderable = { parts: result.parts };
			}
		} catch (cause) {
			for (const handle of acquiredHandles) handle.release();
			preparation.release();
			for (const entity of entities) this.#destroyEntityTree(entity);
			throw cause;
		}
		return "ready";
	}

	#prepareOwnerCommit(
		ownerId: TOwnerId,
		generation: number,
		entities: readonly DynamicEntityRecord[],
		initialSamples: readonly DynamicPresentationSample[],
	): void {
		if (this.#destroyed || this.#ownerGenerations.get(ownerId) !== generation)
			throw new Error("Cannot prepare a superseded dynamic owner generation.");
		const samples = new Map(
			initialSamples.map((sample) => [sample.nodeId, sample] as const),
		);
		if (samples.size !== initialSamples.length)
			throw new Error(
				"Initial pose samples contain a duplicate dynamic entity.",
			);
		for (const entity of entities) {
			const animation = entity.preparedAnimation;
			if (!animation)
				throw new Error(`Dynamic entity ${entity.rootNodeId} is not prepared.`);
			const sample = samples.get(entity.rootNodeId);
			if (animation.kind === "activatable" && !sample)
				throw new Error(
					`Animated entity ${entity.rootNodeId} has no initial pose sample.`,
				);
			if (animation.kind !== "activatable" && sample)
				throw new Error(
					`Static-fallback entity ${entity.rootNodeId} received an animated pose.`,
				);
			if (sample) this.#applySample(entity, sample);
			this.#scene.updateBounds(entity.rootNodeId, animation.localBounds);
			samples.delete(entity.rootNodeId);
		}
		if (samples.size > 0)
			throw new Error(
				"Initial pose samples contain an unknown dynamic entity.",
			);
	}

	#publishPreparedOwner(
		ownerId: TOwnerId,
		generation: number,
		entities: readonly DynamicEntityRecord[],
		templateOwnerId: TTemplateOwnerId,
	): void {
		if (this.#destroyed || this.#ownerGenerations.get(ownerId) !== generation)
			throw new Error("Cannot publish a superseded dynamic owner generation.");
		const previous = this.#owners.get(ownerId);
		for (const entity of entities)
			this.#entities.set(entity.rootNodeId, entity);
		this.#owners.set(ownerId, { entities, generation, templateOwnerId });
		if (!previous) return;
		for (const entity of previous.entities) {
			this.#entities.delete(entity.rootNodeId);
			this.#destroyEntityTree(entity);
		}
		this.#templates.dropOwner(previous.templateOwnerId);
	}

	#applySample(
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
		const updatedParts = entity.renderable.parts.map((part) => {
			const transform =
				sample.articulatedPose.partToObjectTransforms[part.partIndex];
			const renderState = sample.effects.partRenderStates[part.partIndex];
			if (!transform || !renderState)
				throw new Error(
					`Dynamic entity ${entity.rootNodeId} has an incomplete presentation for part ${part.partIndex}.`,
				);
			return { part, renderState, transform };
		});
		const publishedPresentationBounds = presentationBoundsForSample(
			updatedParts,
			entity.source.scale,
			sample.effects.rootRotationModifier,
		);
		this.#scene.updateLocalTransform(
			entity.visualRootNodeId,
			sample.effects.rootRotationModifier,
		);
		for (const { part, transform } of updatedParts) {
			this.#scene.updateLocalTransform(
				part.nodeId,
				composeObjectPartTransform(
					transform,
					entity.source.scale,
					part.defaultScale,
				),
			);
		}
		entity.renderable = {
			parts: updatedParts.map(({ part, renderState }) => ({
				...part,
				renderState,
			})),
		};
		entity.articulatedPose = sample.articulatedPose;
		entity.publishedPresentationBounds = publishedPresentationBounds;
	}

	#releaseStagedOwner(
		entities: readonly DynamicEntityRecord[],
		templateOwnerId: TTemplateOwnerId,
	): void {
		this.#templates.dropOwner(templateOwnerId);
		for (const entity of entities) this.#destroyEntityTree(entity);
	}

	#removeOwnerEntities(ownerId: TOwnerId): void {
		const owner = this.#owners.get(ownerId);
		if (owner) {
			for (const entity of owner.entities) {
				this.#destroyEntityTree(entity);
				this.#entities.delete(entity.rootNodeId);
			}
			this.#owners.delete(ownerId);
			this.#templates.dropOwner(owner.templateOwnerId);
		}
	}

	#destroyEntityTree(entity: DynamicEntityRecord): void {
		entity.animationHandle?.release();
		entity.animationHandle = null;
		for (const part of entity.renderable.parts) {
			this.#scene.destroyNode(part.nodeId);
		}
		this.#scene.destroyNode(entity.visualRootNodeId);
		this.#scene.destroyNode(entity.rootNodeId);
	}
}

function staticPresentationBounds(source: AuthoredDynamicSource) {
	const pose = defaultPose(source.presentation);
	const bounds = resolveObjectPresentationBounds(
		source.presentation.parts,
		pose.partToObjectTransforms,
		source.scale,
	);
	if (bounds === null) {
		throw new Error(
			`Dynamic presentation ${source.presentation.id} has no static geometry bounds.`,
		);
	}
	return bounds;
}

function createActiveParts(
	scene: SceneGraph,
	visualRootNodeId: SceneNodeId,
	presentation: ResolvedObjectPresentation,
	pose: ArticulatedPose,
	scale: Vec3,
): readonly ActiveDynamicPart[] {
	const parts: ActiveDynamicPart[] = [];
	const partIndices = new Set<number>();
	try {
		for (const part of presentation.parts) {
			const partIndex = part.partIndex;
			if (partIndices.has(partIndex)) {
				throw new Error(
					`Presentation ${presentation.id} contains duplicate part index ${partIndex}.`,
				);
			}
			partIndices.add(partIndex);
			const transform = pose.partToObjectTransforms[partIndex];
			if (!transform)
				throw new Error(
					`Presentation ${presentation.id} has no pose for part ${partIndex}.`,
				);
			parts.push({
				defaultScale: part.defaultScale,
				drawUnits: [],
				localBounds: requiredPartBounds(part.geometry.bounds, partIndex),
				nodeId: scene.createNode({
					localBounds: null,
					localTransform: composeObjectPartTransform(
						transform,
						scale,
						part.defaultScale,
					),
					parentId: visualRootNodeId,
				}),
				partIndex,
				renderState: { translucency: 0 },
			});
		}
	} catch (cause) {
		for (const part of parts) scene.destroyNode(part.nodeId);
		throw cause;
	}
	return parts;
}

function mergePreparedParts(
	activeParts: readonly ActiveDynamicPart[],
	templateParts: readonly PartVisualTemplate[],
): readonly ActiveDynamicPart[] {
	const activeByIndex = new Map(
		activeParts.map((part) => [part.partIndex, part] as const),
	);
	return templateParts.map((template) => {
		const active = activeByIndex.get(template.partIndex);
		if (!active)
			throw new Error(
				`Prepared template has no active part ${template.partIndex}.`,
			);
		const localBounds = requiredPartBounds(
			template.localBounds,
			template.partIndex,
		);
		return {
			...active,
			defaultScale: template.defaultScale,
			localBounds,
			drawUnits: template.drawUnits.map((drawUnit) => ({
				drawUnit,
				transparentSortCenter: requiredBoundsCenter(
					localBounds,
					template.partIndex,
				),
			})),
		};
	});
}

function presentationBoundsForSample(
	parts: readonly {
		readonly part: ActiveDynamicPart;
		readonly transform: Mat4;
	}[],
	sourceScale: Vec3,
	rootTransform: Mat4,
): AABB3 {
	let bounds: AABB3 | null = null;
	for (const { part, transform } of parts) {
		const partToObject = composeObjectPartTransform(
			transform,
			sourceScale,
			part.defaultScale,
		);
		const partBounds = transformAABB3(
			multiplyMat4(rootTransform, partToObject),
			part.localBounds,
		);
		if (bounds === null) bounds = partBounds;
		else bounds.union(partBounds);
	}
	if (bounds === null)
		throw new Error("Dynamic presentation has no bounded active parts.");
	return bounds;
}

function requiredPartBounds(bounds: AABB3 | null, partIndex: number): AABB3 {
	if (!bounds)
		throw new Error(
			`Renderable dynamic part ${partIndex} has no local bounds.`,
		);
	return bounds.clone();
}

function requiredBoundsCenter(bounds: AABB3 | null, partIndex: number): Vec3 {
	if (!bounds)
		throw new Error(
			`Renderable dynamic part ${partIndex} has no local bounds for transparent sorting.`,
		);
	return new Vec3(
		(bounds.min.x + bounds.max.x) / 2,
		(bounds.min.y + bounds.max.y) / 2,
		(bounds.min.z + bounds.max.z) / 2,
	);
}

/** Pose retail requests for an object at rest (`CPhysicsObj::InitObjectEnd`, `acclient.c:305765`). */
const RESTING_PLACEMENT_KEY = 0x65;

/** Fallback key `CPartArray::SetPlacementFrame` uses when a setup lacks the requested pose. */
const FALLBACK_PLACEMENT_KEY = 0;

/**
 * Select one authored pose by placement key, falling back exactly as retail does.
 *
 * `CPartArray::SetPlacementFrame` (`acclient.c:314297`) looks the requested key up in the setup's
 * placement frames and drops to key 0 when it is absent.
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
