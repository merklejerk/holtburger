import type { DecodedSoundTable } from "../../assets/decode-sound-table-record";
import type {
	AnimationAssetRepository,
	PreparedAnimation,
	PreparedAnimationHandle,
	PreparedMotionAssets,
} from "../animation/animation-asset-repository";
import type { PreparedDynamicAnimation } from "../animation/prepared-dynamic-animation";
import type {
	ParticleEmitterRepository,
	PreparedParticleEmitter,
} from "../behavior/particle-emitter-repository";
import type {
	PhysicsScriptRepository,
	PreparedPhysicsScriptClosure,
} from "../behavior/physics-script-repository";
import type { PreparedAssetHandle } from "../behavior/prepared-asset-repository";
import type { SoundTableRepository } from "../behavior/sound-table-repository";
import type { DatAssetId } from "../game-types";
import { expandBounds } from "../math/geometry-utils";
import { AABB3, Mat4 } from "../math/types";
import { composeObjectPartTransform } from "../resolution/object-part-transform";
import { completePresentationOperations } from "../runtime/presentation-teardown";
import type { SceneGraph, SceneNodeId } from "../scene";
import type { DynamicPresentationSample } from "./animation-system";
import type { DynamicEntityPlacementSystem } from "./dynamic-entity-placement-system";
import {
	animationIdsFor,
	createActiveParts,
	defaultPose,
	mergePreparedParts,
	prepareEntityVisualState,
	prepareRenderable,
	staticPresentationBounds,
	type DynamicEntityRecord,
	type DynamicOwnerInstallation,
	type DynamicOwnerRecord,
	type DynamicVisualReplacement,
	type StagedBehaviorAssets,
} from "./dynamic-entity-types";
import type {
	DynamicPresentationSource,
	PlacedDynamicPresentationSource,
} from "./dynamic-presentation-source";
import type { DynamicPresentationAndBoundsPublisher } from "./dynamic-presentation-bounds";
import type { DynamicEntitySceneAndAttachmentAdapter } from "./dynamic-scene-attachments";
import type { EffectSystem } from "./effect-system";
import {
	objectVisualTemplateKey,
	type ObjectVisualTemplate,
	type ObjectVisualTemplateRepositoryPort,
	type StagedObjectVisualTemplateOwner,
} from "./object-visual-template-repository";
import type { DynamicEntityDiagnostics } from "./dynamic-entity-diagnostics";

/** Owns dynamic owner generations, async asset staging, visual replacement, and entity teardown. */
export class DynamicOwnerPreparationAndStaging<
	TOwnerId extends string,
	TTemplateOwnerId extends string = TOwnerId,
> {
	readonly #scene: SceneGraph;
	readonly #placements: DynamicEntityPlacementSystem;
	/** World-owned GPU templates are borrowed; this system retires only its resident handles. */
	readonly #templates: ObjectVisualTemplateRepositoryPort<TTemplateOwnerId>;
	/** App-owned CPU animation repository also serves isolated previews after world retirement. */
	readonly #animations: AnimationAssetRepository;
	readonly #scripts: PhysicsScriptRepository;
	readonly #emitters: ParticleEmitterRepository;
	readonly #effects: EffectSystem;
	readonly #soundTables: SoundTableRepository;
	readonly #templateOwnerId: (
		ownerId: TOwnerId,
		generation: number,
	) => TTemplateOwnerId;
	readonly #sceneAttachments: DynamicEntitySceneAndAttachmentAdapter;
	readonly #presentationBounds: DynamicPresentationAndBoundsPublisher;
	readonly #owners = new Map<TOwnerId, DynamicOwnerRecord<TTemplateOwnerId>>();
	readonly #ownerGenerations = new Map<TOwnerId, number>();
	/** Preparations awaited during shutdown so acquired handles cannot outlive repositories. */
	readonly #pendingPreparations = new Set<Promise<unknown>>();
	/** Current provisional template stage per owner, cancelled immediately on supersession. */
	readonly #pendingTemplateStages = new Map<
		TOwnerId,
		StagedObjectVisualTemplateOwner<TTemplateOwnerId>
	>();
	#destroyed = false;

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
		sceneAttachments: DynamicEntitySceneAndAttachmentAdapter,
		presentationBounds: DynamicPresentationAndBoundsPublisher,
	) {
		this.#scene = scene;
		this.#placements = placements;
		this.#templates = templates;
		this.#animations = animations;
		this.#scripts = scripts;
		this.#emitters = emitters;
		this.#effects = effects;
		this.#soundTables = soundTables;
		this.#templateOwnerId = templateOwnerId;
		this.#sceneAttachments = sceneAttachments;
		this.#presentationBounds = presentationBounds;
	}

	/** Replace one producer's complete dynamic population as a single owner generation. */
	replaceOwner(
		ownerId: TOwnerId,
		placedSources: readonly PlacedDynamicPresentationSource[],
	): DynamicOwnerInstallation {
		if (this.#destroyed)
			throw new Error("Cannot install a destroyed dynamic system.");
		const entities: DynamicEntityRecord[] = [];
		try {
			for (const source of placedSources)
				entities.push(this.#createEntity(source));
		} catch (cause) {
			this.destroyEntityTrees(entities);
			throw cause;
		}
		let templatePreparation: StagedObjectVisualTemplateOwner<TTemplateOwnerId>;
		try {
			templatePreparation = this.#templates.stageOwner(
				placedSources.map(({ source }) => source),
			);
		} catch (cause) {
			this.destroyEntityTrees(entities);
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
		const animationPreparations = entities.map((entity) =>
			this.#animations.acquireAvailable(
				animationIdsFor(entity.source, entity.playback),
			),
		);
		const motionPreparations = entities.map((entity) =>
			entity.playback.kind === "resolved" ||
			entity.source.behavior.motionTableId === null
				? Promise.resolve(null)
				: this.#animations.acquireMotionAssets(
						entity.source.behavior.motionTableId,
					),
		);
		const behaviorPreparations = entities.map((entity, index) =>
			Promise.all([
				animationPreparations[index],
				motionPreparations[index],
			]).then(([animation, motion]) =>
				this.#stageBehaviorAssets(entity, [
					...[...animation.values()].flatMap((handle) =>
						handle === null ? [] : [handle.asset],
					),
					...(motion?.animations.values() ?? []),
				]),
			),
		);
		const preparationPromise = this.#prepareOwner(
			ownerId,
			generation,
			entities,
			templatePreparation,
			templateOwnerId,
			animationPreparations,
			behaviorPreparations,
			motionPreparations,
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
				const previous = this.#publishPreparedOwner(
					ownerId,
					generation,
					entities,
					templateOwnerId,
				);
				state = "committed";
				if (previous !== undefined)
					completePresentationOperations(
						[
							() => this.destroyEntityTrees(previous.entities),
							() => this.#templates.dropOwner(previous.templateOwnerId),
						],
						"Previous dynamic owner could not release every resource.",
					);
			},
			prepareCommit: (initialSamples, attachments) => {
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
					const links = this.#sceneAttachments.prepareStagedAttachments(
						entities,
						attachments,
					);
					for (const link of links)
						this.#sceneAttachments.applyAttachment(link);
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
						emitters: entity.emitterHandles.map((handle) => handle.asset),
						initialPartToObjectTransforms:
							entity.articulatedPose.partToObjectTransforms,
						nodeId: entity.rootNodeId,
						scriptClosure: entity.scriptClosure,
						animationScriptClosures: entity.animationScriptClosures,
						motionAssets: entity.motionAssets,
						soundTable: entity.soundTableHandle?.asset ?? null,
						source: entity.source,
					};
				});
			},
			generation,
			nodeIds: entities.map(({ rootNodeId }) => rootNodeId),
			ready,
			release: () => {
				if (state !== "ready" && state !== "prepared-to-commit") return;
				state = "released";
				this.#releaseStagedOwner(entities, templateOwnerId);
			},
		};
	}

	/** Stage changed appearance resources while preserving the live entity and all owner siblings. */
	async stageVisualReplacement(
		ownerId: TOwnerId,
		rootNodeId: SceneNodeId,
		source: DynamicPresentationSource,
	): Promise<DynamicVisualReplacement> {
		const owner = this.#owners.get(ownerId);
		const entity = this.#sceneAttachments.entities.get(rootNodeId);
		if (
			owner === undefined ||
			entity === undefined ||
			!owner.entities.includes(entity)
		)
			throw new Error(
				`Dynamic visual replacement has no entity ${rootNodeId} in owner ${ownerId}.`,
			);
		if (source.identity !== entity.source.identity)
			throw new Error(
				`Dynamic visual replacement changed identity ${entity.source.identity} to ${source.identity}.`,
			);
		const nextPartIndices = new Set(
			source.presentation.parts.map((part) => part.partIndex),
		);
		if (nextPartIndices.size !== source.presentation.parts.length)
			throw new Error(
				`Replacement presentation ${source.presentation.id} contains duplicate part indices.`,
			);
		if (
			source.setupId !== entity.source.setupId ||
			nextPartIndices.size !== entity.renderable.parts.length ||
			entity.renderable.parts.some(
				(part) => !nextPartIndices.has(part.partIndex),
			)
		)
			return { kind: "requires-owner-replacement" };
		const stage = this.#templates.stageOwner(
			owner.entities.map((sibling) =>
				sibling === entity ? source : sibling.source,
			),
		);
		this.#pendingTemplateStages.get(ownerId)?.release();
		this.#pendingTemplateStages.set(ownerId, stage);
		const release = () => {
			stage.release();
			if (this.#pendingTemplateStages.get(ownerId) === stage)
				this.#pendingTemplateStages.delete(ownerId);
		};
		this.#pendingPreparations.add(stage.completion);
		let templates: ReadonlyMap<
			ReturnType<typeof objectVisualTemplateKey>,
			ObjectVisualTemplate
		>;
		try {
			templates = await stage.completion;
		} catch (cause) {
			release();
			throw cause;
		} finally {
			this.#pendingPreparations.delete(stage.completion);
		}
		const template = templates.get(objectVisualTemplateKey(source));
		if (template === undefined) {
			release();
			throw new Error(
				`Replacement template for ${source.identity} was not prepared.`,
			);
		}
		const preparedScale = entity.rootScale.clone();
		let preparedVisual: ReturnType<typeof prepareEntityVisualState>;
		try {
			preparedVisual = prepareEntityVisualState(
				source,
				preparedScale,
				template,
				entity.animationHandles,
				entity.playback,
				entity.motionAssets,
			);
		} catch (cause) {
			release();
			throw cause;
		}
		return {
			kind: "staged",
			animation: preparedVisual.animation,
			release,
			commit: () => {
				if (
					this.#destroyed ||
					this.#owners.get(ownerId) !== owner ||
					this.#sceneAttachments.entities.get(rootNodeId) !== entity ||
					this.#pendingTemplateStages.get(ownerId) !== stage
				)
					throw new Error(
						`Cannot commit superseded visual replacement for ${source.identity}.`,
					);
				// Preparation can span many animation ticks. Derive bounds and transforms from the
				// current pose/scale now, before publishing any replacement resource or scene state.
				const visual =
					entity.rootScale.x === preparedScale.x &&
					entity.rootScale.y === preparedScale.y &&
					entity.rootScale.z === preparedScale.z
						? preparedVisual
						: prepareEntityVisualState(
								source,
								entity.rootScale,
								template,
								entity.animationHandles,
								entity.playback,
								entity.motionAssets,
							);
				// Placement changes update unanimated parts without restarting scripts or playback.
				const replacementPose =
					source.placementFrame !== entity.source.placementFrame &&
					entity.animationHandles.size === 0 &&
					entity.playback.kind === "source-owned" &&
					entity.motionPlayback === null
						? defaultPose(source)
						: entity.articulatedPose;
				const parts = mergePreparedParts(
					entity.renderable.parts,
					template.parts,
				).map((part) => {
					const pose = replacementPose.partToObjectTransforms[part.partIndex];
					if (pose === undefined)
						throw new Error(
							`Replacement part ${part.partIndex} has no current pose.`,
						);
					return {
						...part,
						localToVisualRoot: composeObjectPartTransform(
							pose,
							entity.rootScale,
							part.defaultScale,
						),
					};
				});
				const renderable = prepareRenderable(parts, template);
				// Requested rigid frames retain their identities across geometry replacement.
				for (const frame of entity.attachmentFrames) {
					const part = parts.find((part) => part.partIndex === frame.partIndex);
					if (!part)
						throw new Error(
							`Replacement removes requested attachment part ${frame.partIndex}.`,
						);
				}
				const rigidBounds =
					this.#presentationBounds.presentationBoundsForSample(
						parts,
						entity.visualRootTransform,
					);
				const expandedBounds = expandBounds(
					rigidBounds,
					entity.appliedEnvelopeRadius,
					AABB3.zero(),
				);
				const setupBounds = staticPresentationBounds(source);
				stage.commit(owner.templateOwnerId);
				entity.source = source;
				entity.articulatedPose = replacementPose;
				entity.setupBounds = setupBounds;
				entity.renderable = renderable;
				entity.allPartsOpaque = true;
				entity.localPartsRevision += 1;
				entity.motionPlayback = visual.motionPlayback;
				entity.preparedAnimation = visual.animation;
				entity.cullingBounds = visual.animation.localBounds
					.clone()
					.union(rigidBounds);
				entity.rigidPresentationBounds = rigidBounds;
				entity.publishedPresentationBounds = expandedBounds;
				entity.selectionGeometryMorphology =
					template.selectionGeometryMorphology;
				this.#presentationBounds.publishCullingBounds(entity);
				this.#sceneAttachments.publishAttachmentFrames(
					entity,
					entity.visualRootTransform,
					replacementPose,
				);
				this.#pendingTemplateStages.delete(ownerId);
			},
		};
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

	async destroy(): Promise<void> {
		if (this.#destroyed) return;
		this.#destroyed = true;
		for (const preparation of this.#pendingTemplateStages.values()) {
			preparation.release();
		}
		this.#pendingTemplateStages.clear();
		for (const ownerId of [...this.#owners.keys()]) this.removeOwner(ownerId);
		await Promise.allSettled([...this.#pendingPreparations]);
	}

	/** Inspect complete preparation without exposing repository handles or mutable staging state. */
	getPreparedAnimation(nodeId: SceneNodeId): PreparedDynamicAnimation | null {
		return (
			this.#sceneAttachments.entities.get(nodeId)?.preparedAnimation ?? null
		);
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
		const entity = this.#sceneAttachments.entities.get(nodeId);
		if (!entity) throw new Error(`Dynamic entity ${nodeId} does not exist.`);
		if (entity.motionPlayback === null) {
			throw new Error(
				`Dynamic entity ${nodeId} was named clip ${animationId} but staged no motion table.`,
			);
		}
		return entity.motionPlayback.clips.get(animationId) ?? null;
	}

	/** Complete currently published pose used to seed a motion-driven entity's first clip. */
	getPartToObjectTransforms(nodeId: SceneNodeId): readonly Mat4[] {
		const entity = this.#sceneAttachments.entities.get(nodeId);
		if (!entity) throw new Error(`Dynamic entity ${nodeId} does not exist.`);
		return entity.articulatedPose.partToObjectTransforms;
	}

	getDiagnostics(diagnostics: DynamicEntityDiagnostics) {
		return diagnostics.getDiagnostics(
			this.#sceneAttachments.entities,
			this.#animations,
			this.#templates,
		);
	}

	#createEntity(
		resident: PlacedDynamicPresentationSource,
	): DynamicEntityRecord {
		const source = resident.source;
		const rootScale = source.scale.clone();
		const pose = defaultPose(source);
		const parts = createActiveParts(source.presentation, pose, rootScale);
		const rootNodeId = this.#placements.createRoot(
			resident.placement,
			// The staged generation publishes conservative bounds with playback activation.
			null,
		);
		const visualRootNodeId = this.#scene.createNode({
			localBounds: null,
			localTransform: Mat4.identity(),
			parentId: rootNodeId,
		});
		const rigidPresentationBounds = staticPresentationBounds(source);
		const record: DynamicEntityRecord = {
			allPartsOpaque: true,
			setupBounds: rigidPresentationBounds.clone(),
			playback: resident.playback,
			animationHandles: new Map(),
			animationScriptClosures: [],
			emitterHandles: [],
			motionAssets: null,
			motionPlayback: null,
			scriptClosure: null,
			soundTableHandle: null,
			articulatedPose: pose,
			renderable: { kind: "preparing", parts },
			localPartsRevision: 0,
			composedTransformRevision: -1,
			composedLocalPartsRevision: -1,
			attachmentFrames: [],
			rootNodeId,
			rootScale,
			source,
			nameplateContent: source.nameplate,
			preparedAnimation: null,
			rigidPresentationBounds,
			publishedPresentationBounds: rigidPresentationBounds.clone(),
			cullingBounds: null,
			appliedEnvelopeRadius: 0,
			presentationOpacity: 1,
			presentationState: resident.initialPresentationState,
			visualRootNodeId,
			visualRootTransform: Mat4.identity(),
			selectionGeometryMorphology: null,
		};
		this.#sceneAttachments.modelRoots.set(rootNodeId, rootNodeId);
		this.#sceneAttachments.modelRoots.set(visualRootNodeId, rootNodeId);
		return record;
	}

	/**
	 * Stage one resident's script closure and emitters referenced by scripts and animations.
	 *
	 * Emitters are staged in the same lane as the closure rather than a parallel one, because the
	 * emitter set is only knowable once the closure has resolved. A failure part-way releases what
	 * was already taken, so this either yields a complete behavior staging or nothing.
	 */
	async #stageBehaviorAssets(
		entity: DynamicEntityRecord,
		animations: readonly PreparedAnimation[],
	): Promise<StagedBehaviorAssets> {
		const scriptId = entity.source.behavior.physicsScriptId;
		let closure =
			scriptId === null
				? null
				: await this.#scripts.acquireOptionalClosure(scriptId);
		const emitterHandles: PreparedAssetHandle<PreparedParticleEmitter>[] = [];
		const animationScriptClosures: PreparedPhysicsScriptClosure[] = [];
		let soundTableHandle: PreparedAssetHandle<DecodedSoundTable> | null = null;
		try {
			const scriptRoots = new Set(
				animations.flatMap((animation) =>
					animation.hooks.flatMap((hook) =>
						hook.kind === "call-pes" ? [hook.scriptId] : [],
					),
				),
			);
			if (scriptId !== null) scriptRoots.delete(scriptId);
			for (const root of scriptRoots) {
				const staged = await this.#scripts.acquireOptionalClosure(root);
				if (staged !== null) animationScriptClosures.push(staged);
			}
			const scripts = [closure, ...animationScriptClosures].flatMap((item) =>
				item === null ? [] : [...item.scripts.values()],
			);
			const emitterIds = new Set([
				...animations.flatMap((animation) => animation.emitterInfoIds),
				...scripts.flatMap((script) => script.dependencies.emitterInfoIds),
			]);
			const available = await this.#emitters.acquireAvailable(emitterIds);
			emitterHandles.push(
				...[...available.values()].flatMap((handle) =>
					handle === null ? [] : [handle],
				),
			);
			// An effect graph is indivisible even when other independent roots on the body survive.
			const complete = (graph: PreparedPhysicsScriptClosure) =>
				[...graph.scripts.values()].every((script) =>
					script.dependencies.emitterInfoIds.every((id) => {
						const handle = available.get(id);
						if (handle === undefined)
							throw new Error(`Script emitter ${id} was not staged.`);
						return handle !== null;
					}),
				);
			if (closure !== null && !complete(closure)) {
				closure.release();
				closure = null;
			}
			for (
				let index = animationScriptClosures.length - 1;
				index >= 0;
				index--
			) {
				const graph = animationScriptClosures[index];
				if (graph !== undefined && !complete(graph)) {
					graph.release();
					animationScriptClosures.splice(index, 1);
				}
			}
			const needed = new Set([
				...animations.flatMap((animation) => animation.emitterInfoIds),
				...[closure, ...animationScriptClosures].flatMap((graph) =>
					graph === null
						? []
						: [...graph.scripts.values()].flatMap(
								(script) => script.dependencies.emitterInfoIds,
							),
				),
			]);
			for (let index = emitterHandles.length - 1; index >= 0; index--) {
				const handle = emitterHandles[index];
				if (handle !== undefined && !needed.has(handle.asset.id)) {
					emitterHandles.splice(index, 1);
					handle.release();
				}
			}
			// The table is the *object's*, installed from its setup, so it is staged per resident
			// rather than per script: two residents running one script may resolve a key to
			// different sounds.
			const soundTableId = entity.source.behavior.soundTableId;
			if (soundTableId !== null) {
				soundTableHandle =
					await this.#soundTables.acquireOptional(soundTableId);
			}
		} catch (cause) {
			soundTableHandle?.release();
			for (const handle of emitterHandles) handle.release();
			closure?.release();
			for (const script of animationScriptClosures) script.release();
			throw cause;
		}
		return {
			closure,
			emitterHandles,
			soundTableHandle,
			animationScriptClosures,
		};
	}

	async #prepareOwner(
		ownerId: TOwnerId,
		generation: number,
		entities: readonly DynamicEntityRecord[],
		preparation: StagedObjectVisualTemplateOwner<TTemplateOwnerId>,
		templateOwnerId: TTemplateOwnerId,
		animationPreparations: readonly Promise<
			ReadonlyMap<DatAssetId, PreparedAnimationHandle | null>
		>[],
		behaviorPreparations: readonly Promise<StagedBehaviorAssets>[],
		motionPreparations: readonly Promise<PreparedMotionAssets | null>[],
	): Promise<"ready" | "superseded"> {
		// Settled separately rather than in one array so each lane keeps its own result type; a
		// single `allSettled` would widen them into a union the release paths cannot discriminate.
		const [templateResult, animationResults, behaviorResults, motionResults] =
			await Promise.all([
				Promise.allSettled([preparation.completion]).then(
					(results) => results[0]!,
				),
				Promise.allSettled(animationPreparations),
				Promise.allSettled(behaviorPreparations),
				Promise.allSettled(motionPreparations),
			]);
		const settled = [
			templateResult,
			...animationResults,
			...behaviorResults,
			...motionResults,
		];
		// Everything acquired must be releasable on any failure path, including a closure whose
		// sibling animation rejected.
		const acquiredHandles = animationResults.flatMap((result) =>
			result.status === "fulfilled"
				? [...result.value.values()].flatMap((handle) =>
						handle === null ? [] : [handle],
					)
				: [],
		);
		const acquiredBehaviorAssets = behaviorResults.flatMap((result) =>
			result.status === "fulfilled" ? [result.value] : [],
		);
		const acquiredMotionAssets = motionResults.flatMap((result) =>
			result.status === "fulfilled" && result.value !== null
				? [result.value]
				: [],
		);
		const releaseBehaviorAssets = () => {
			for (const staged of acquiredBehaviorAssets) {
				staged.closure?.release();
				for (const closure of staged.animationScriptClosures) closure.release();
				staged.soundTableHandle?.release();
				for (const handle of staged.emitterHandles) handle.release();
			}
			for (const closure of acquiredMotionAssets) closure.release();
		};
		const current =
			!this.#destroyed && this.#ownerGenerations.get(ownerId) === generation;
		if (!current) {
			for (const handle of acquiredHandles) handle.release();
			releaseBehaviorAssets();
			preparation.release();
			this.destroyEntityTrees(entities);
			return "superseded";
		}
		const failures = settled.flatMap((result) =>
			result.status === "rejected" ? [result.reason as unknown] : [],
		);
		if (failures.length > 0) {
			for (const handle of acquiredHandles) handle.release();
			releaseBehaviorAssets();
			preparation.release();
			this.destroyEntityTrees(entities);
			// A failed staging lane must not hide a sibling failure from the caller.
			throw failures.length === 1
				? failures[0]
				: new AggregateError(
						failures,
						"Multiple dynamic preparation stages failed.",
					);
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
						`Visual template for ${entity.source.identity} was not prepared.`,
					);
				}
				const animationResult = animationResults[index];
				if (animationResult?.status !== "fulfilled") {
					throw new Error(
						`Animation for ${entity.source.identity} settled without a result.`,
					);
				}
				const behaviorResult = behaviorResults[index];
				if (behaviorResult?.status !== "fulfilled") {
					throw new Error(
						`Behavior assets for ${entity.source.identity} settled without a result.`,
					);
				}
				const motionResult = motionResults[index];
				if (motionResult?.status !== "fulfilled") {
					throw new Error(
						`Motion closure for ${entity.source.identity} settled without a result.`,
					);
				}

				return {
					entity,
					...prepareEntityVisualState(
						entity.source,
						entity.rootScale,
						template,
						animationResult.value,
						entity.playback,
						motionResult.value,
					),
					handles: animationResult.value,
					renderable: prepareRenderable(
						mergePreparedParts(entity.renderable.parts, template.parts),
						template,
					),
					selectionGeometryMorphology: template.selectionGeometryMorphology,
					effectPartCount: template.parts.length,
					emitterHandles: behaviorResult.value.emitterHandles,
					soundTableHandle: behaviorResult.value.soundTableHandle,
					scriptClosure: behaviorResult.value.closure,
					animationScriptClosures: behaviorResult.value.animationScriptClosures,
					motionAssets: motionResult.value,
				};
			});
			preparation.commit(templateOwnerId);
			for (const result of prepared) {
				const { entity } = result;
				// Effect state is installed here, before any producer can dispatch into it,
				// and is owned by the entity rather than by animation: a script-only resident
				// has effect state and no playback at all. Retail applies semantic state
				// before PhysicsDesc translucency; an initially cloaked object therefore
				// ignores that initial whole-object write.
				this.#effects.install(
					entity.rootNodeId,
					result.effectPartCount,
					entity.presentationState,
				);
			}
			// Transfer leases only after every fallible installation succeeds. Rollback still owns
			// all acquired handles until this point, so no partially assigned entity can release twice.
			for (const result of prepared) {
				const { entity } = result;
				entity.animationHandles = result.handles;
				entity.animationScriptClosures = result.animationScriptClosures;
				entity.scriptClosure = result.scriptClosure;
				entity.motionAssets = result.motionAssets;
				entity.motionPlayback = result.motionPlayback;
				entity.emitterHandles = result.emitterHandles;
				entity.soundTableHandle = result.soundTableHandle;
				entity.preparedAnimation = result.animation;
				entity.renderable = result.renderable;
				entity.allPartsOpaque = true;
				entity.selectionGeometryMorphology = result.selectionGeometryMorphology;
			}
		} catch (cause) {
			for (const handle of acquiredHandles) handle.release();
			releaseBehaviorAssets();
			preparation.release();
			this.#templates.dropOwner(templateOwnerId);
			this.destroyEntityTrees(entities);
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
			if (
				(animation.kind === "activatable" || animation.kind === "sequence") &&
				!sample
			)
				throw new Error(
					`Animated entity ${entity.rootNodeId} has no initial pose sample.`,
				);
			if (
				animation.kind !== "activatable" &&
				animation.kind !== "sequence" &&
				sample
			)
				throw new Error(
					`Static-fallback entity ${entity.rootNodeId} received an animated pose.`,
				);
			// Assigned before the first sample so every `applySample` can publish an envelope.
			entity.cullingBounds = animation.localBounds.clone();
			this.#presentationBounds.publishCullingBounds(entity);
			if (sample) {
				this.#presentationBounds.refreshParticleEnvelope(entity);
				this.#presentationBounds.applySample(entity, sample);
			}
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
	): DynamicOwnerRecord<TTemplateOwnerId> | undefined {
		if (this.#destroyed || this.#ownerGenerations.get(ownerId) !== generation)
			throw new Error("Cannot publish a superseded dynamic owner generation.");
		const previous = this.#owners.get(ownerId);
		for (const entity of entities)
			this.#sceneAttachments.entities.set(entity.rootNodeId, entity);
		for (const entity of entities)
			this.#presentationBounds.syncLitEntity(entity);
		if (
			entities.some((entity) => entity.nameplateContent !== null) ||
			previous?.entities.some((entity) => entity.nameplateContent !== null)
		)
			this.#presentationBounds.nameplatePopulationRevision += 1;
		this.#owners.set(ownerId, { entities, generation, templateOwnerId });
		if (previous !== undefined)
			for (const entity of previous.entities) {
				this.#presentationBounds.litEntities.delete(entity);
				this.#sceneAttachments.entities.delete(entity.rootNodeId);
			}
		return previous;
	}

	#releaseStagedOwner(
		entities: readonly DynamicEntityRecord[],
		templateOwnerId: TTemplateOwnerId,
	): void {
		completePresentationOperations(
			[
				() => this.destroyEntityTrees(entities),
				() => this.#templates.dropOwner(templateOwnerId),
			],
			"Staged dynamic owner could not release every resource.",
		);
	}

	#removeOwnerEntities(ownerId: TOwnerId): void {
		const owner = this.#owners.get(ownerId);
		if (!owner) return;
		if (owner.entities.some((entity) => entity.nameplateContent !== null))
			this.#presentationBounds.nameplatePopulationRevision++;
		this.#owners.delete(ownerId);
		for (const entity of owner.entities)
			this.#presentationBounds.litEntities.delete(entity);
		for (const entity of owner.entities)
			this.#sceneAttachments.entities.delete(entity.rootNodeId);
		this.#releaseStagedOwner(owner.entities, owner.templateOwnerId);
	}

	/** Read ancestry once before teardown so every owned descendant retires before its parent. */
	destroyEntityTrees(entities: readonly DynamicEntityRecord[]): void {
		const ordered = entities
			.map((entity) => {
				let nodeId: SceneNodeId | null = entity.rootNodeId;
				let depth = 0;
				while (nodeId !== null) {
					const node = this.#scene.getNode(nodeId);
					if (!node)
						throw new Error(`Dynamic retirement cannot find node ${nodeId}.`);
					nodeId = node.parentId;
					depth++;
				}
				return { entity, depth };
			})
			.sort((a, b) => b.depth - a.depth);
		completePresentationOperations(
			ordered.map(
				({ entity }) =>
					() =>
						this.destroyEntityTree(entity),
			),
			"Dynamic group could not retire every model.",
		);
	}

	destroyEntityTree(entity: DynamicEntityRecord): void {
		this.#sceneAttachments.modelRoots.delete(entity.rootNodeId);
		this.#sceneAttachments.modelRoots.delete(entity.visualRootNodeId);
		for (const frame of entity.attachmentFrames)
			this.#sceneAttachments.modelRoots.delete(frame.nodeId);
		const steps: (() => void)[] = [
			...[...entity.animationHandles.values()].map(
				(handle) => () => handle?.release(),
			),
			...entity.animationScriptClosures.map(
				(closure) => () => closure.release(),
			),
			...entity.emitterHandles.map((handle) => () => handle.release()),
		];
		if (entity.scriptClosure !== null) {
			const closure = entity.scriptClosure;
			steps.push(() => closure.release());
		}
		if (entity.motionAssets !== null) {
			const closure = entity.motionAssets;
			steps.push(() => closure.release());
		}
		if (entity.soundTableHandle !== null) {
			const handle = entity.soundTableHandle;
			steps.push(() => handle.release());
		}
		entity.animationHandles = new Map();
		entity.animationScriptClosures = [];
		entity.scriptClosure = null;
		entity.motionAssets = null;
		entity.motionPlayback = null;
		entity.emitterHandles = [];
		entity.soundTableHandle = null;
		steps.push(
			() => this.#effects.remove(entity.rootNodeId),
			...entity.attachmentFrames.map(
				(frame) => () => this.#scene.destroyNode(frame.nodeId),
			),
			() => this.#scene.destroyNode(entity.visualRootNodeId),
			() => this.#placements.destroyRoot(entity.rootNodeId),
		);
		completePresentationOperations(
			steps,
			`Dynamic model ${entity.rootNodeId} could not release every resource.`,
		);
	}
}
