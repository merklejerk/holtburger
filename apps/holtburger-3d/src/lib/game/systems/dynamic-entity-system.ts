import type {
	PhysicsScriptRepository,
	PreparedPhysicsScriptClosure,
} from "../behavior/physics-script-repository";
import type {
	ParticleEmitterRepository,
	PreparedParticleEmitter,
} from "../behavior/particle-emitter-repository";
import type { PreparedAssetHandle } from "../behavior/prepared-asset-repository";
import type { EffectSystem } from "./effect-system";
import type { SoundTableRepository } from "../behavior/sound-table-repository";
import type { DecodedSoundTable } from "../../assets/decode-sound-table-record";
import type {
	DynamicEntityPresentationState,
	DynamicPresentationSource,
	NameplateContent,
	PlacedDynamicPresentationSource,
} from "./dynamic-presentation-source";
import type { NameplateSourceVisual } from "../renderer/nameplate-policy";
import { AABB3, Mat4, Vec3 } from "../math/types";
import { multiplyMat4, transformAABB3 } from "../math/matrices";
import type { LandblockOwnerId } from "../game-types";
import type { SceneChildTransform, SceneGraph, SceneNodeId } from "../scene";
import type { SceneSpatialPlacement } from "../scene";
import {
	type ParentLocation,
	RESTING_PLACEMENT_KEY,
	resolveObjectPresentationBounds,
	type ResolvedObjectPresentation,
	resolvePlacementPose,
} from "../resolution/presentation";
import { composeObjectPartTransform } from "../resolution/object-part-transform";
import type {
	ActiveDynamicPart,
	ArticulatedPose,
	DynamicEntityRenderable,
	VisibleDynamicPresentation,
} from "./components";
import type { DynamicPresentationSample } from "./animation-system";
import {
	objectVisualTemplateKey,
	type ObjectVisualTemplate,
	type ObjectVisualTemplateRepositoryPort,
	type PartVisualTemplate,
	type StagedObjectVisualTemplateOwner,
} from "./object-visual-template-repository";
import {
	AnimationAssetRepository,
	type PreparedAnimation,
	type PreparedAnimationHandle,
	type PreparedMotionClosure,
} from "../animation/animation-asset-repository";
import type { DatAssetId } from "../game-types";
import { expandBounds } from "../math/geometry-utils";
import {
	prepareDynamicAnimation,
	type PreparedDynamicAnimation,
} from "../animation/prepared-dynamic-animation";
import {
	prepareMotionPlayback,
	type PreparedMotionPlayback,
} from "../animation/prepared-motion-playback";
import type { DynamicEntityPlacementSystem } from "./dynamic-entity-placement-system";
import type { RuntimeLight } from "../environment/runtime-lights";
import type { ObjectGeometryData } from "../renderer/geometry";
import { resolveObjectRuntimeLights } from "../environment/object-runtime-lights";
import type {
	DynamicEntityAdvance,
	DynamicEntityTickBatch,
} from "../runtime/dynamic-entity-feed";
import type { SelectionGeometryMorphology } from "../selection/entity-interaction-shape";

interface DynamicEntityRecord {
	readonly rootNodeId: SceneNodeId;
	readonly visualRootNodeId: SceneNodeId;
	/** Source-neutral visual facts retained for behavior staging and deterministic phase identity. */
	source: DynamicPresentationSource;
	/** Current authoritative whole-object scale, mutable without replacing immutable visual assets. */
	readonly rootScale: Vec3;
	/** Current presentation-only root transform retained so scale-only updates can rebuild bounds. */
	readonly visualRootTransform: Mat4;
	/** Immutable dimensionality copied from the resolved appearance template at preparation. */
	selectionGeometryMorphology: SelectionGeometryMorphology | null;
	/** Mutable display content updated independently from immutable visual setup facts. */
	nameplateContent: NameplateContent | null;
	renderable: DynamicEntityRenderable;
	/** Stable borrowed part matrices submitted together with the visual root's transform. */
	partTransformPublication: readonly SceneChildTransform[];
	articulatedPose: ArticulatedPose;
	animationHandle: PreparedAnimationHandle | null;
	/**
	 * Staged script closure for a resident whose setup owns a default script.
	 *
	 * Held here rather than in the script clock so it is released by the same teardown that frees
	 * every other per-entity resource, and so a superseded generation cannot leak one.
	 */
	scriptClosure: PreparedPhysicsScriptClosure | null;
	/** Every animation this entity's motion table reaches, staged before activation. */
	motionClosure: PreparedMotionClosure | null;
	/**
	 * The playable subset of that closure and the one bound covering it.
	 *
	 * Present exactly when the entity animates from a motion table, which is also when its played
	 * clip can change at runtime.
	 */
	motionPlayback: PreparedMotionPlayback | null;
	/**
	 * Emitter definitions named by this resident's script closure.
	 *
	 * Staged with the closure so a `CreateParticle` reached mid-playback resolves from memory; the
	 * particle runtime reads them through the repository rather than holding them itself.
	 */
	emitterHandles: PreparedAssetHandle<PreparedParticleEmitter>[];
	/** The resident's installed sound table, staged so a `SoundTable` key resolves from memory. */
	soundTableHandle: PreparedAssetHandle<DecodedSoundTable> | null;
	preparedAnimation: PreparedDynamicAnimation | null;
	/** Exact object-local rigid bounds matching the pose currently published to draw. */
	rigidPresentationBounds: AABB3;
	/** Current rigid pose expanded only by its particle-preservation envelope. */
	publishedPresentationBounds: AABB3;
	/**
	 * Pose-independent envelope the scene graph's broadphase culls against, before any particle
	 * envelope. Covers every pose the entity's animation can reach, so it is published once at
	 * install and only revisited when the particle envelope changes.
	 */
	cullingBounds: AABB3 | null;
	/** Envelope already folded into both culling bounds, so a change republishes them. */
	appliedEnvelopeRadius: number;
	presentationState: DynamicEntityPresentationState;
}

/** One currently drawn rigid part borrowed for the duration of an exact-selection visit. */
interface DynamicEntitySelectionPart {
	readonly geometry: ObjectGeometryData;
	readonly localBounds: AABB3;
	readonly sourceToLandblock: Mat4;
	readonly ranges: readonly {
		readonly cullFace: "back" | "front";
		readonly indexStart: number;
		readonly indexCount: number;
	}[];
}

/** Current realized geometry in the landblock-local frame that owns it. */
export interface DynamicEntitySelectionGeometry {
	readonly landblockId: LandblockOwnerId;
	/** Current object-local rigid bounds used when policy replaces triangles with a sphere. */
	readonly localBounds: AABB3;
	readonly parts: readonly DynamicEntitySelectionPart[];
	/** Current visual-root placement, including attachment ancestry. */
	readonly sourceToLandblock: Mat4;
}

interface DynamicOwnerRecord<TTemplateOwnerId extends string> {
	/** Monotonic owner generation guarding asynchronous preparation publication. */
	readonly generation: number;
	readonly entities: readonly DynamicEntityRecord[];
	/** Generation-private geometry owner retained until this active generation retires. */
	readonly templateOwnerId: TTemplateOwnerId;
}

/** Prepared mesh replacement, or a topology change requiring full behavior-owner activation. */
export type DynamicVisualReplacement =
	| { readonly kind: "requires-owner-replacement" }
	| {
			readonly kind: "staged";
			/** Publish against the still-current owner without resetting behavior or part targets. */
			commit(): void;
			/** Withdraw uncommitted resources; safe after cancellation or commit. */
			release(): void;
	  };

/** Atomic authored-owner installation and its complete visual-staging outcome. */
export interface DynamicOwnerInstallation {
	/**
	 * Monotonic owner generation this installation belongs to.
	 *
	 * Exposed so behavior producers can stamp it onto their dispatch targets: a node id alone is
	 * recycled across generations, and a command must never land on a successor.
	 */
	readonly generation: number;
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
/** One resident's complete behavior staging: its script closure and every emitter it can reach. */
/** Everything one entity needs to commit, resolved before any of it is applied. */
interface StagedBehaviorAssets {
	readonly closure: PreparedPhysicsScriptClosure;
	readonly emitterHandles: PreparedAssetHandle<PreparedParticleEmitter>[];
	readonly soundTableHandle: PreparedAssetHandle<DecodedSoundTable> | null;
}

interface PreparedDynamicEntity {
	readonly animation: PreparedDynamicAnimation;
	/** Complete setup pose retained beneath any partial-part animation clip. */
	readonly initialPartToObjectTransforms: readonly Mat4[];
	readonly nodeId: SceneNodeId;
	readonly source: DynamicPresentationSource;
	/** Staged script closure, or `null` for a resident whose setup owns no default script. */
	readonly scriptClosure: PreparedPhysicsScriptClosure | null;
	readonly motionClosure: PreparedMotionClosure | null;
	/** The resident's installed sound table, or `null` when its setup installs none. */
	readonly soundTable: DecodedSoundTable | null;
}

/** Owns dynamic entity trees, rigid-part components, and reusable visual preparation. */
export class DynamicEntitySystem<
	TOwnerId extends string,
	TTemplateOwnerId extends string = TOwnerId,
> {
	readonly #scene: SceneGraph;
	readonly #placements: DynamicEntityPlacementSystem;
	readonly #templates: ObjectVisualTemplateRepositoryPort<TTemplateOwnerId>;
	readonly #animations: AnimationAssetRepository;
	readonly #scripts: PhysicsScriptRepository;
	readonly #emitters: ParticleEmitterRepository;
	readonly #effects: EffectSystem;
	readonly #soundTables: SoundTableRepository;
	readonly #particleEnvelopeRadiusOf: (nodeId: SceneNodeId) => number;
	readonly #templateOwnerId: (
		ownerId: TOwnerId,
		generation: number,
	) => TTemplateOwnerId;
	readonly #owners = new Map<TOwnerId, DynamicOwnerRecord<TTemplateOwnerId>>();
	readonly #entities = new Map<SceneNodeId, DynamicEntityRecord>();
	/** Scratch used only by synchronous bounds derivation, never returned to consumers. */
	readonly #boundsScratch = {
		transform: Mat4.identity(),
		bounds: AABB3.zero(),
	};
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
	/** Entities visited by the last complete presentation sweep. */
	#lastPresentationEntityVisitCount = 0;
	#lastPublishedPresentationCount = 0;
	/** Publications for residents with behavior but no playback, which animation cannot cover. */
	#lastEffectOnlyPresentationCount = 0;
	/** Envelope lookups whose result changed the owner radius during the last publication. */
	#lastParticleEnvelopeChangeCount = 0;
	/** Owner-aggregate lookups performed during the last publication. */
	#lastParticleEnvelopeQueryCount = 0;
	/** Changes only when the installed nameplate population or one of its visual values changes. */
	#nameplatePopulationRevision = 0;

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
		this.#particleEnvelopeRadiusOf = particleEnvelopeRadiusOf;
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
			for (const entity of entities) this.#destroyEntityTree(entity);
			throw cause;
		}
		let templatePreparation: StagedObjectVisualTemplateOwner<TTemplateOwnerId>;
		try {
			templatePreparation = this.#templates.stageOwner(
				placedSources.map(({ source }) => source),
			);
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
				// A script-only resident has no playback to prepare, only behavior.
				entity.source.behavior.animationId === null
					? Promise.resolve(null)
					: this.#animations.acquire(entity.source.behavior.animationId),
			),
			// Transitive `CallPES` and emitter staging happens here, before activation, so nothing
			// reached mid-playback can trigger a load at frame time.
			entities.map((entity) => this.#stageBehaviorAssets(entity)),
			// The motion table's whole closure stages on the same terms: a body transitions into
			// clips it has not played, and a transition must not trigger a load at frame time.
			entities.map((entity) =>
				entity.source.behavior.motionTableId === null
					? Promise.resolve(null)
					: this.#animations.acquireMotionClosure(
							entity.source.behavior.motionTableId,
						),
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
						initialPartToObjectTransforms:
							entity.articulatedPose.partToObjectTransforms,
						nodeId: entity.rootNodeId,
						scriptClosure: entity.scriptClosure,
						motionClosure: entity.motionClosure,
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

	#createEntity(
		resident: PlacedDynamicPresentationSource,
	): DynamicEntityRecord {
		const source = resident.source;
		const rootScale = source.scale.clone();
		const rootNodeId = this.#placements.createRoot(
			resident.placement,
			// The staged generation publishes conservative bounds with playback activation.
			null,
		);
		const pose = defaultPose(source.presentation);
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
				source.presentation,
				pose,
				rootScale,
			);
		} catch (cause) {
			this.#scene.destroyNode(visualRootNodeId);
			this.#scene.destroyNode(rootNodeId);
			throw cause;
		}
		const rigidPresentationBounds = staticPresentationBounds(source);
		const record: DynamicEntityRecord = {
			animationHandle: null,
			emitterHandles: [],
			motionClosure: null,
			motionPlayback: null,
			scriptClosure: null,
			soundTableHandle: null,
			articulatedPose: pose,
			renderable: { kind: "preparing", parts },
			partTransformPublication: parts.map((part) => ({
				nodeId: part.nodeId,
				transform: part.localToVisualRoot,
			})),
			rootNodeId,
			rootScale,
			source,
			nameplateContent: source.nameplate,
			preparedAnimation: null,
			rigidPresentationBounds,
			publishedPresentationBounds: rigidPresentationBounds.clone(),
			cullingBounds: null,
			appliedEnvelopeRadius: 0,
			presentationState: resident.initialPresentationState,
			visualRootNodeId,
			visualRootTransform: Mat4.identity(),
			selectionGeometryMorphology: null,
		};
		return record;
	}

	/** Stage changed appearance resources while preserving the live entity and all owner siblings. */
	async stageVisualReplacement(
		ownerId: TOwnerId,
		rootNodeId: SceneNodeId,
		source: DynamicPresentationSource,
	): Promise<DynamicVisualReplacement> {
		const owner = this.#owners.get(ownerId);
		const entity = this.#entities.get(rootNodeId);
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
		return {
			kind: "staged",
			release,
			commit: () => {
				if (
					this.#destroyed ||
					this.#owners.get(ownerId) !== owner ||
					this.#entities.get(rootNodeId) !== entity ||
					this.#pendingTemplateStages.get(ownerId) !== stage
				)
					throw new Error(
						`Cannot commit superseded visual replacement for ${source.identity}.`,
					);
				// Preparation can span many animation ticks. Derive bounds and transforms from the
				// current pose/scale now, before publishing any replacement resource or scene state.
				const visual = prepareEntityVisualState(
					source,
					entity.rootScale,
					template,
					entity.animationHandle?.asset ?? null,
					entity.motionClosure,
				);
				const parts = mergePreparedParts(
					entity.renderable.parts,
					template.parts,
				).map((part) => {
					const pose =
						entity.articulatedPose.partToObjectTransforms[part.partIndex];
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
				const rigidBounds = this.#presentationBoundsForSample(
					parts,
					entity.visualRootTransform,
				);
				const expandedBounds = expandBounds(
					rigidBounds,
					entity.appliedEnvelopeRadius,
					AABB3.zero(),
				);
				stage.commit(owner.templateOwnerId);
				entity.source = source;
				entity.renderable = renderable;
				entity.partTransformPublication = parts.map((part) => ({
					nodeId: part.nodeId,
					transform: part.localToVisualRoot,
				}));
				entity.motionPlayback = visual.motionPlayback;
				entity.preparedAnimation = visual.animation;
				entity.cullingBounds = visual.animation.localBounds;
				entity.rigidPresentationBounds = rigidBounds;
				entity.publishedPresentationBounds = expandedBounds;
				entity.selectionGeometryMorphology =
					template.selectionGeometryMorphology;
				this.#publishCullingBounds(entity);
				for (const part of parts)
					this.#scene.updateLocalTransform(part.nodeId, part.localToVisualRoot);
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

	/**
	 * Scene node carrying one authored part's pose, for behavior that attaches to a part.
	 *
	 * `CreateParticle` names a part index and `-1` for the whole object, so a consumer that ignores it
	 * places every part-attached emitter at the object's origin instead of the part's — and, since the
	 * emitter frame drives spawn rotation too, aims it with the object's frame as well.
	 */
	resolvePartNode(
		rootNodeId: SceneNodeId,
		partIndex: number,
	): SceneNodeId | null {
		const entity = this.#entities.get(rootNodeId);
		if (!entity) return null;
		return (
			entity.renderable.parts.find((part) => part.partIndex === partIndex)
				?.nodeId ?? null
		);
	}

	/** Copy one live entity's resolved object placement for synchronous child staging. */
	resolvedRootPlacement(rootNodeId: SceneNodeId): SceneSpatialPlacement | null {
		if (!this.#entities.has(rootNodeId)) return null;
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

	/**
	 * Pose one child by its own setup and attach its root to a named point on the parent setup.
	 *
	 * Lookup stays caller-side, matching retail's `CPhysicsObj::add_child`: the scene graph receives
	 * only a resolved part node and rigid holding frame, so parent geometry scale cannot leak into
	 * the child's independently scaled parts.
	 */
	attachEntity(
		childRootNodeId: SceneNodeId,
		parentRootNodeId: SceneNodeId,
		location: ParentLocation,
		placementKey: number,
	): void {
		const child = this.#entities.get(childRootNodeId);
		if (!child)
			throw new Error(`Dynamic child ${childRootNodeId} does not exist.`);
		const parent = this.#entities.get(parentRootNodeId);
		if (!parent)
			throw new Error(`Dynamic parent ${parentRootNodeId} does not exist.`);
		const attachPoint =
			parent.source.presentation.holdingLocations.get(location);
		if (!attachPoint) {
			// RETAIL DIVERGENCE: `CPhysicsObj::add_child` silently refuses a missing holding
			// location (`acclient.c:305203`). The Explorer throws because silence would hide broken
			// mounted data; an archive/ACE census found 8 missing pairs among 2,288, all on three
			// arrow templates carrying degenerate wield lists and none on genuine creatures.
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
		const pose = poseFor(child.source.presentation, placementKey);
		for (const part of child.renderable.parts) {
			const transform = pose.partToObjectTransforms[part.partIndex];
			if (!transform) {
				throw new Error(
					`Dynamic child ${childRootNodeId} placement ${placementKey} has no frame for part ${part.partIndex}.`,
				);
			}
		}
		for (const part of child.renderable.parts) {
			const transform = pose.partToObjectTransforms[part.partIndex];
			if (!transform)
				throw new Error("Validated child pose became incomplete.");
			composeObjectPartTransform(
				transform,
				child.rootScale,
				part.defaultScale,
				part.localToVisualRoot,
			);
			this.#scene.updateLocalTransform(part.nodeId, part.localToVisualRoot);
		}
		child.articulatedPose = pose;
		const placedBounds = presentationBoundsForPose(child.source, pose);
		child.rigidPresentationBounds = placedBounds;
		child.publishedPresentationBounds = expandBounds(
			placedBounds,
			child.appliedEnvelopeRadius,
			child.publishedPresentationBounds,
		);
		if (child.cullingBounds) {
			child.cullingBounds.union(placedBounds);
			this.#publishCullingBounds(child);
		}
		this.#scene.attachToPart(
			child.rootNodeId,
			parentPart.nodeId,
			attachPoint.offsetTransform,
		);
	}

	getRenderable(nodeId: SceneNodeId): DynamicEntityRenderable | null {
		return this.#entities.get(nodeId)?.renderable ?? null;
	}

	/** Publish one installed visual and current part payloads without visiting material ranges. */
	getVisiblePresentation(
		nodeId: SceneNodeId,
	): VisibleDynamicPresentation | null {
		const entity = this.#entities.get(nodeId);
		if (
			entity === undefined ||
			entity.renderable.kind === "preparing" ||
			entity.presentationState.noDraw ||
			entity.presentationState.hidden
		)
			return null;
		const placement = this.#scene.getResolvedPlacement(entity.visualRootNodeId);
		const membership = this.#scene.getResolvedSpatialMembership(
			entity.visualRootNodeId,
		);
		if (placement === undefined || membership === undefined)
			throw new Error(
				`Dynamic visual root ${entity.visualRootNodeId} no longer exists.`,
			);
		for (const part of entity.renderable.parts) {
			multiplyMat4(
				placement.localToLandblock,
				part.localToVisualRoot,
				part.frameInstance.sourceToLandblock,
			);
			// Hidden parts still occupy their dense layout selector; the shader clips zero opacity.
			part.frameInstance.color.a = 1 - part.renderState.translucency;
		}
		return {
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
		const entity = this.#entities.get(nodeId);
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
			if (part.renderState.translucency === 1 || part.geometryData === null)
				continue;
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
		return this.#entities.get(nodeId)?.selectionGeometryMorphology ?? null;
	}

	/** Return producer-resolved presentation policy without exposing the mutable entity record. */
	getPresentationClass(
		nodeId: SceneNodeId,
	): DynamicPresentationSource["entityClass"] | null {
		return this.#entities.get(nodeId)?.source.entityClass ?? null;
	}

	/** Return producer-stable identity for deterministic frontend presentation policy. */
	getPresentationIdentity(nodeId: SceneNodeId): string | null {
		return this.#entities.get(nodeId)?.source.identity ?? null;
	}

	/** Return the revision guarding exact installed nameplate-content enumeration. */
	getNameplatePopulationRevision(): number {
		return this.#nameplatePopulationRevision;
	}

	/** Visit each installed nameplate source with the identity needed for viewer classification. */
	forEachNameplateVisual(
		visit: (identity: string, visual: NameplateSourceVisual) => void,
	): void {
		for (const entity of this.#entities.values()) {
			if (entity.nameplateContent !== null)
				visit(entity.source.identity, {
					entityClass: entity.source.entityClass,
					content: entity.nameplateContent,
				});
		}
	}

	/** Return display content and current rigid bounds for one already-selected entity. */
	getNameplateFacts(nodeId: SceneNodeId): {
		readonly content: NameplateContent;
		readonly identity: string;
		readonly rigidBounds: AABB3;
	} | null {
		const entity = this.#entities.get(nodeId);
		if (entity === undefined || entity.nameplateContent === null) return null;
		return {
			content: entity.nameplateContent,
			identity: entity.source.identity,
			rigidBounds: entity.rigidPresentationBounds,
		};
	}

	/** Replace one installed entity's display value without rebuilding visual resources. */
	updateNameplateContent(nodeId: SceneNodeId, content: NameplateContent): void {
		const entity = this.#entities.get(nodeId);
		if (!entity) throw new Error(`Dynamic entity ${nodeId} does not exist.`);
		if (
			entity.nameplateContent?.name === content.name &&
			entity.nameplateContent.level === content.level
		)
			return;
		entity.nameplateContent = content;
		this.#nameplatePopulationRevision += 1;
	}

	/** Borrow current particle-expanded bounds until the next publication; clone to retain a snapshot. */
	getPublishedPresentationBounds(nodeId: SceneNodeId): AABB3 | null {
		return this.#entities.get(nodeId)?.publishedPresentationBounds ?? null;
	}

	/** Borrow current rigid-pose bounds until the next publication; clone to retain a snapshot. */
	getPublishedRigidPresentationBounds(nodeId: SceneNodeId): AABB3 | null {
		return this.#entities.get(nodeId)?.rigidPresentationBounds ?? null;
	}

	/** Apply one complete producer placement through the sole dynamic-root writer. */
	updatePlacement(nodeId: SceneNodeId, placement: SceneSpatialPlacement): void {
		if (!this.#entities.has(nodeId))
			throw new Error(`Dynamic entity ${nodeId} does not exist.`);
		this.#placements.updateRoot(nodeId, placement);
	}

	/** Apply one host-accepted transient path through the sole dynamic-root placement owner. */
	updatePlacementPath(
		nodeId: SceneNodeId,
		advance: DynamicEntityAdvance,
		durationMs: DynamicEntityTickBatch["durationMs"],
		startedAtMs: number,
	): void {
		if (!this.#entities.has(nodeId))
			throw new Error(`Dynamic entity ${nodeId} does not exist.`);
		this.#placements.applyPath(nodeId, advance, durationMs, startedAtMs);
	}

	/** Apply one projected absolute root scale without reloading or replacing visual resources. */
	updateRootScale(nodeId: SceneNodeId, scale: number): void {
		if (!Number.isFinite(scale) || scale <= 0)
			throw new Error("Dynamic entity root scale must be finite and positive.");
		const entity = this.#entities.get(nodeId);
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
		for (const part of entity.renderable.parts) {
			const transform =
				entity.articulatedPose.partToObjectTransforms[part.partIndex];
			if (!transform)
				throw new Error(
					`Dynamic entity ${nodeId} has no current pose for part ${part.partIndex}.`,
				);
			composeObjectPartTransform(
				transform,
				entity.rootScale,
				part.defaultScale,
				part.localToVisualRoot,
			);
			this.#scene.updateLocalTransform(part.nodeId, part.localToVisualRoot);
		}
		entity.rigidPresentationBounds = this.#presentationBoundsForSample(
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
		this.#publishCullingBounds(entity);
	}

	/** Replace presentation-only physics consequences without rebuilding entity resources. */
	updatePresentationState(
		nodeId: SceneNodeId,
		state: DynamicEntityPresentationState,
	): void {
		const entity = this.#entities.get(nodeId);
		if (!entity) throw new Error(`Dynamic entity ${nodeId} does not exist.`);
		if (
			state.translucency !== entity.presentationState.translucency &&
			!entity.presentationState.cloaked &&
			!state.cloaked
		) {
			// RETAIL QUIRK: CPhysicsPart::SetTranslucency ignores whole-object writes while
			// cloaked, and CPhysicsObj::set_state does not replay them on uncloak
			// (acclient.c:303936-303962, 310307-310336). Correcting this would make property
			// updates received during cloak observable when retail leaves the prior part state.
			// Census 2026-09-02: 928 templates author object translucency; live cloak/update
			// overlap is runtime state and cannot be sized from static content.
			this.#effects.applyObjectTranslucency(nodeId, state.translucency);
		}
		entity.presentationState = state;
	}

	/** Resolve every enabled setup light from its current object frame into canonical scene space. */
	getRuntimeLights(): readonly RuntimeLight[] {
		const lights: RuntimeLight[] = [];
		for (const entity of this.#entities.values()) {
			if (!entity.presentationState.lighting) continue;
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

	/** Inspect complete preparation without exposing repository handles or mutable staging state. */
	getPreparedAnimation(nodeId: SceneNodeId): PreparedDynamicAnimation | null {
		return this.#entities.get(nodeId)?.preparedAnimation ?? null;
	}

	/**
	 * Resolve one animation from a motion-driven entity's staged closure.
	 *
	 * `null` means the closure reached this animation and refused it as unplayable, which
	 * `prepareMotionPlayback` already complained about; the caller keeps the current pose. Throws
	 * for an entity with no motion playback at all, because the host names a clip only for a body
	 * whose motion table this entity staged, so a mismatch there is a contract defect rather than
	 * a content one.
	 */
	getMotionClip(
		nodeId: SceneNodeId,
		animationId: DatAssetId,
	): PreparedAnimation | null {
		const entity = this.#entities.get(nodeId);
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
		const entity = this.#entities.get(nodeId);
		if (!entity) throw new Error(`Dynamic entity ${nodeId} does not exist.`);
		return entity.articulatedPose.partToObjectTransforms;
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
			lastPresentationEntityVisitCount: this.#lastPresentationEntityVisitCount,
			lastPublishedPresentationCount: this.#lastPublishedPresentationCount,
			lastEffectOnlyPresentationCount: this.#lastEffectOnlyPresentationCount,
			lastParticleEnvelopeChangeCount: this.#lastParticleEnvelopeChangeCount,
			lastParticleEnvelopeQueryCount: this.#lastParticleEnvelopeQueryCount,
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
		let particleEnvelopeChangeCount = 0;
		let particleEnvelopeQueryCount = 0;
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
			particleEnvelopeQueryCount += 1;
			if (this.#refreshParticleEnvelope(entity)) {
				particleEnvelopeChangeCount += 1;
			}
			this.#applySample(entity, sample);
		}
		let effectOnlyCount = 0;
		for (const [nodeId, entity] of this.#entities) {
			// An entity animation covers is either in this frame's samples or was deliberately
			// skipped by the presentation cadence; publishing it here would override that choice.
			if (entity.animationHandle !== null) continue;
			if (publishedNodeIds.has(nodeId)) continue;
			// An idle resident resolves to the same presentation every frame; republishing it is
			// the per-frame streaming this split was meant to remove, not add. Its particle
			// envelope is not idle, though: emitters start and stop independently of effect state,
			// and skipping on effects alone left the envelope out of the bounds entirely, so a
			// swarm vanished the moment its owner's mesh left the frustum.
			particleEnvelopeQueryCount += 1;
			const envelopeChanged = this.#refreshParticleEnvelope(entity);
			if (envelopeChanged) particleEnvelopeChangeCount += 1;
			if (!this.#effects.needsPresentation(nodeId) && !envelopeChanged) {
				continue;
			}
			// A script-only resident holds the pose it was installed with. Its effect state still
			// ramps, rotates, and fades, and before this had no path to the scene at all.
			this.#applySample(entity, {
				articulatedPose: entity.articulatedPose,
				effects: this.#effects.samplePresentation(nodeId),
				nodeId,
			});
			effectOnlyCount += 1;
		}
		this.#lastPresentationPublicationDurationMs = performance.now() - startedAt;
		this.#lastPresentationEntityVisitCount = this.#entities.size;
		this.#lastPublishedPresentationCount = samples.length + effectOnlyCount;
		this.#lastEffectOnlyPresentationCount = effectOnlyCount;
		this.#lastParticleEnvelopeChangeCount = particleEnvelopeChangeCount;
		this.#lastParticleEnvelopeQueryCount = particleEnvelopeQueryCount;
	}

	/**
	 * Fold the current particle envelope into every bounds that culls this entity.
	 *
	 * Two independent culls read two different bounds: the scene graph's pose-independent broadphase
	 * bounds, and the per-pose presentation bounds behind the renderer's footprint test. An envelope
	 * applied to only one of them still loses the whole swarm at the other, which is exactly what
	 * happened — the mesh left the broadphase frustum while its particles were still on screen.
	 *
	 * Returns whether the radius moved, which is what lets an otherwise idle resident skip
	 * republication without stranding a stale envelope.
	 */
	#refreshParticleEnvelope(entity: DynamicEntityRecord): boolean {
		const radius = this.#particleEnvelopeRadiusOf(entity.rootNodeId);
		if (radius === entity.appliedEnvelopeRadius) return false;
		entity.appliedEnvelopeRadius = radius;
		this.#publishCullingBounds(entity);
		return true;
	}

	/** Publish the broadphase envelope for the radius currently folded into this entity. */
	#publishCullingBounds(entity: DynamicEntityRecord): void {
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

	/**
	 * Stage one resident's script closure and every emitter definition it can reach.
	 *
	 * Emitters are staged in the same lane as the closure rather than a parallel one, because the
	 * emitter set is only knowable once the closure has resolved. A failure part-way releases what
	 * was already taken, so this either yields a complete behavior staging or nothing.
	 */
	async #stageBehaviorAssets(
		entity: DynamicEntityRecord,
	): Promise<StagedBehaviorAssets | null> {
		const scriptId = entity.source.behavior.physicsScriptId;
		if (scriptId === null) return null;
		const closure = await this.#scripts.acquireClosure(scriptId);
		const emitterHandles: PreparedAssetHandle<PreparedParticleEmitter>[] = [];
		let soundTableHandle: PreparedAssetHandle<DecodedSoundTable> | null = null;
		try {
			const emitterIds = new Set(
				[...closure.scripts.values()].flatMap(
					(script) => script.dependencies.emitterInfoIds,
				),
			);
			for (const emitterInfoId of emitterIds) {
				emitterHandles.push(await this.#emitters.acquire(emitterInfoId));
			}
			// The table is the *object's*, installed from its setup, so it is staged per resident
			// rather than per script: two residents running one script may resolve a key to
			// different sounds.
			const soundTableId = entity.source.behavior.soundTableId;
			if (soundTableId !== null) {
				soundTableHandle = await this.#soundTables.acquire(soundTableId);
			}
		} catch (cause) {
			soundTableHandle?.release();
			for (const handle of emitterHandles) handle.release();
			closure.release();
			throw cause;
		}
		return { closure, emitterHandles, soundTableHandle };
	}

	async #prepareOwner(
		ownerId: TOwnerId,
		generation: number,
		entities: readonly DynamicEntityRecord[],
		preparation: StagedObjectVisualTemplateOwner<TTemplateOwnerId>,
		templateOwnerId: TTemplateOwnerId,
		animationPreparations: readonly Promise<PreparedAnimationHandle | null>[],
		scriptPreparations: readonly Promise<StagedBehaviorAssets | null>[],
		motionPreparations: readonly Promise<PreparedMotionClosure | null>[],
	): Promise<"ready" | "superseded"> {
		// Settled separately rather than in one array so each lane keeps its own result type; a
		// single `allSettled` would widen them into a union the release paths cannot discriminate.
		const [templateResult, animationResults, scriptResults, motionResults] =
			await Promise.all([
				Promise.allSettled([preparation.completion]).then(
					(results) => results[0]!,
				),
				Promise.allSettled(animationPreparations),
				Promise.allSettled(scriptPreparations),
				Promise.allSettled(motionPreparations),
			]);
		const settled = [
			templateResult,
			...animationResults,
			...scriptResults,
			...motionResults,
		];
		// Everything acquired must be releasable on any failure path, including a closure whose
		// sibling animation rejected.
		const acquiredHandles = animationResults.flatMap((result) =>
			result.status === "fulfilled" && result.value !== null
				? [result.value]
				: [],
		);
		const acquiredBehaviorAssets = scriptResults.flatMap((result) =>
			result.status === "fulfilled" && result.value !== null
				? [result.value]
				: [],
		);
		const acquiredMotionClosures = motionResults.flatMap((result) =>
			result.status === "fulfilled" && result.value !== null
				? [result.value]
				: [],
		);
		const releaseBehaviorAssets = () => {
			for (const staged of acquiredBehaviorAssets) {
				staged.closure.release();
				staged.soundTableHandle?.release();
				for (const handle of staged.emitterHandles) handle.release();
			}
			for (const closure of acquiredMotionClosures) closure.release();
		};
		const current =
			!this.#destroyed && this.#ownerGenerations.get(ownerId) === generation;
		if (!current) {
			for (const handle of acquiredHandles) handle.release();
			releaseBehaviorAssets();
			preparation.release();
			for (const entity of entities) this.#destroyEntityTree(entity);
			return "superseded";
		}
		const failure = settled.find((result) => result.status === "rejected");
		if (failure?.status === "rejected") {
			for (const handle of acquiredHandles) handle.release();
			releaseBehaviorAssets();
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
						`Visual template for ${entity.source.identity} was not prepared.`,
					);
				}
				const animationResult = animationResults[index];
				if (animationResult?.status !== "fulfilled") {
					throw new Error(
						`Animation for ${entity.source.identity} settled without a result.`,
					);
				}
				const scriptResult = scriptResults[index];
				if (scriptResult?.status !== "fulfilled") {
					throw new Error(
						`Script closure for ${entity.source.identity} settled without a result.`,
					);
				}
				const motionResult = motionResults[index];
				if (motionResult?.status !== "fulfilled") {
					throw new Error(
						`Motion closure for ${entity.source.identity} settled without a result.`,
					);
				}

				return {
					...prepareEntityVisualState(
						entity.source,
						entity.rootScale,
						template,
						animationResult.value?.asset ?? null,
						motionResult.value,
					),
					handle: animationResult.value,
					renderable: prepareRenderable(
						mergePreparedParts(entity.renderable.parts, template.parts),
						template,
					),
					selectionGeometryMorphology: template.selectionGeometryMorphology,
					effectPartCount: template.parts.length,
					emitterHandles: scriptResult.value?.emitterHandles ?? [],
					soundTableHandle: scriptResult.value?.soundTableHandle ?? null,
					scriptClosure: scriptResult.value?.closure ?? null,
					motionClosure: motionResult.value,
				};
			});
			preparation.commit(templateOwnerId);
			for (let index = 0; index < entities.length; index += 1) {
				const entity = entities[index]!;
				const result = prepared[index]!;
				// Effect state is installed here, before any producer can dispatch into it, and is
				// owned by the entity rather than by animation: a script-only resident has effect
				// state and no playback at all.
				// Retail applies semantic state before PhysicsDesc translucency; an initially cloaked
				// object therefore ignores that initial whole-object write (acclient.c:310488-310498,
				// 303936-303962).
				this.#effects.install(
					entity.rootNodeId,
					result.effectPartCount,
					entity.presentationState.cloaked
						? 0
						: entity.presentationState.translucency,
				);
				entity.animationHandle = result.handle;
				entity.scriptClosure = result.scriptClosure;
				entity.motionClosure = result.motionClosure;
				entity.motionPlayback = result.motionPlayback;
				entity.emitterHandles = result.emitterHandles;
				entity.soundTableHandle = result.soundTableHandle;
				entity.preparedAnimation = result.animation;
				entity.renderable = result.renderable;
				entity.selectionGeometryMorphology = result.selectionGeometryMorphology;
			}
		} catch (cause) {
			for (const handle of acquiredHandles) handle.release();
			releaseBehaviorAssets();
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
			// Assigned before the first sample so every `#applySample` can publish an envelope.
			entity.cullingBounds = animation.localBounds;
			this.#publishCullingBounds(entity);
			if (sample) {
				this.#refreshParticleEnvelope(entity);
				this.#applySample(entity, sample);
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
	): void {
		if (this.#destroyed || this.#ownerGenerations.get(ownerId) !== generation)
			throw new Error("Cannot publish a superseded dynamic owner generation.");
		const previous = this.#owners.get(ownerId);
		for (const entity of entities)
			this.#entities.set(entity.rootNodeId, entity);
		if (
			entities.some((entity) => entity.nameplateContent !== null) ||
			previous?.entities.some((entity) => entity.nameplateContent !== null)
		)
			this.#nameplatePopulationRevision += 1;
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
			const transform =
				sample.articulatedPose.partToObjectTransforms[part.partIndex];
			const sampledRenderState =
				sample.effects.partRenderStates[part.partIndex];
			if (!transform || !sampledRenderState) {
				throw new Error("Validated dynamic sample became incomplete.");
			}
			if (!entity.presentationState.cloaked) {
				part.renderState = sampledRenderState;
			}
			composeObjectPartTransform(
				transform,
				entity.rootScale,
				part.defaultScale,
				part.localToVisualRoot,
			);
		}
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
		const rigidPresentationBounds = this.#presentationBoundsForSample(
			entity.renderable.parts,
			visualRootTransform,
			entity.rigidPresentationBounds,
		);
		const publishedPresentationBounds = expandBounds(
			rigidPresentationBounds,
			entity.appliedEnvelopeRadius,
			entity.publishedPresentationBounds,
		);
		this.#scene.updateLocalTransformWithChildren(
			entity.visualRootNodeId,
			visualRootTransform,
			entity.partTransformPublication,
		);
		entity.visualRootTransform.copy(visualRootTransform);
		entity.articulatedPose = sample.articulatedPose;
		entity.rigidPresentationBounds = rigidPresentationBounds;
		entity.publishedPresentationBounds = publishedPresentationBounds;
	}

	/** Derive the current rigid bound with reusable part scratch and optional retained output. */
	#presentationBoundsForSample(
		parts: readonly ActiveDynamicPart[],
		rootTransform: Mat4,
		target: AABB3 = AABB3.zero(),
	): AABB3 {
		if (parts.length === 0)
			throw new Error("Dynamic presentation has no bounded active parts.");
		let first = true;
		for (const part of parts) {
			const partBounds = transformAABB3(
				multiplyMat4(
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
			if (owner.entities.some((entity) => entity.nameplateContent !== null))
				this.#nameplatePopulationRevision += 1;
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
		entity.scriptClosure?.release();
		entity.scriptClosure = null;
		entity.motionClosure?.release();
		entity.motionClosure = null;
		entity.motionPlayback = null;
		for (const handle of entity.emitterHandles) handle.release();
		entity.emitterHandles = [];
		entity.soundTableHandle?.release();
		entity.soundTableHandle = null;
		this.#effects.remove(entity.rootNodeId);
		for (const part of entity.renderable.parts) {
			this.#scene.destroyNode(part.nodeId);
		}
		this.#scene.destroyNode(entity.visualRootNodeId);
		this.#placements.destroyRoot(entity.rootNodeId);
	}
}

/** Rebuild geometry-dependent envelopes from retained animation assets, without starting playback. */
function prepareEntityVisualState(
	source: DynamicPresentationSource,
	scale: Vec3,
	template: ObjectVisualTemplate,
	animationAsset: PreparedAnimation | null,
	motionClosure: PreparedMotionClosure | null,
): {
	readonly animation: PreparedDynamicAnimation;
	readonly motionPlayback: PreparedMotionPlayback | null;
} {
	const staticBounds = staticPresentationBounds({ ...source, scale });
	const motionPlayback =
		motionClosure === null
			? null
			: prepareMotionPlayback(motionClosure, template, scale, staticBounds);
	const animation: PreparedDynamicAnimation =
		motionPlayback !== null
			? { kind: "none", localBounds: motionPlayback.localBounds }
			: animationAsset === null
				? { kind: "none", localBounds: staticBounds }
				: prepareDynamicAnimation(
						animationAsset,
						template,
						scale,
						staticBounds,
					);
	return { animation, motionPlayback };
}

function staticPresentationBounds(source: DynamicPresentationSource) {
	const pose = defaultPose(source.presentation);
	return presentationBoundsForPose(source, pose);
}

function presentationBoundsForPose(
	source: DynamicPresentationSource,
	pose: ArticulatedPose,
) {
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
			const localToVisualRoot = composeObjectPartTransform(
				transform,
				scale,
				part.defaultScale,
			);
			parts.push({
				defaultScale: part.defaultScale,
				depthDrawUnits: [],
				frameInstance: {
					color: { a: 1, b: 1, g: 1, r: 1 },
					sourceToLandblock: Mat4.zero(),
				},
				geometryData: null,
				localBounds: requiredPartBounds(part.geometry.bounds, partIndex),
				localToVisualRoot,
				nodeId: scene.createNode({
					localBounds: null,
					localTransform: localToVisualRoot,
					parentId: visualRootNodeId,
				}),
				partIndex,
				// Staging-only placeholder. The required effect sample replaces it before the owner
				// can publish, including a nonzero object-translucency baseline.
				renderState: { translucency: 0 },
			});
		}
	} catch (cause) {
		for (const part of parts) scene.destroyNode(part.nodeId);
		throw cause;
	}
	return parts;
}

/** Install dense selector order once; frame consumers do not rejoin authored part identities. */
function prepareRenderable(
	parts: readonly ActiveDynamicPart[],
	template: Pick<ObjectVisualTemplate, "layout" | "appearance">,
): Extract<DynamicEntityRenderable, { kind: "ready" }> {
	const ordered = [...parts].sort(
		(left, right) => left.partIndex - right.partIndex,
	);
	if (ordered.length !== template.layout.parts.length)
		throw new Error(
			`Dynamic layout ${template.layout.key} has a different active part count.`,
		);
	for (const [selector, part] of ordered.entries()) {
		if (template.layout.parts[selector]?.partIndex !== part.partIndex)
			throw new Error(
				`Dynamic layout ${template.layout.key} selector ${selector} does not address active part ${part.partIndex}.`,
			);
	}
	return {
		kind: "ready",
		parts: ordered,
		layout: template.layout,
		appearance: template.appearance,
	};
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
			depthDrawUnits: template.depthDrawUnits,
			geometryData: template.geometryData,
			localBounds,
		};
	});
}

/** Rescale one origin-relative authored bound without revisiting the geometry or animation sweep. */
function boundsAtRootScale(
	bounds: AABB3,
	authoredScale: Vec3,
	currentScale: Vec3,
): AABB3 {
	if (
		!Number.isFinite(authoredScale.x) ||
		!Number.isFinite(authoredScale.y) ||
		!Number.isFinite(authoredScale.z) ||
		authoredScale.x <= 0 ||
		authoredScale.y <= 0 ||
		authoredScale.z <= 0
	)
		throw new Error("Authored dynamic root scale must be finite and positive.");
	const ratio = new Vec3(
		currentScale.x / authoredScale.x,
		currentScale.y / authoredScale.y,
		currentScale.z / authoredScale.z,
	);
	return new AABB3(
		new Vec3(
			bounds.min.x * ratio.x,
			bounds.min.y * ratio.y,
			bounds.min.z * ratio.z,
		),
		new Vec3(
			bounds.max.x * ratio.x,
			bounds.max.y * ratio.y,
			bounds.max.z * ratio.z,
		),
	);
}

function requiredPartBounds(bounds: AABB3 | null, partIndex: number): AABB3 {
	if (!bounds)
		throw new Error(
			`Renderable dynamic part ${partIndex} has no local bounds.`,
		);
	return bounds.clone();
}

function poseFor(
	presentation: ResolvedObjectPresentation,
	placementKey: number,
): ArticulatedPose {
	return {
		// A static placement pose has no clip and therefore no authored root frame.
		authoredRootTransform: null,
		partToObjectTransforms: resolvePlacementPose(presentation, placementKey)
			.partTransforms,
	};
}

function defaultPose(
	presentation: ResolvedObjectPresentation,
): ArticulatedPose {
	return poseFor(presentation, RESTING_PLACEMENT_KEY);
}
