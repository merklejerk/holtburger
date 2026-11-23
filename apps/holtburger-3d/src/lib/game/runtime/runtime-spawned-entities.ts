import { formatError } from "../../format-error";
import { isContentFailure } from "../../host/host-command-result";
import type { DecodedStaticPresentation } from "../../assets/decode-static-source-record";
import { animationHookCommand } from "../../assets/decode-animation-record";
import type { DecodedSoundTable } from "../../assets/decode-sound-table-record";
import type { SetupVisualAppearance } from "../../assets/setup-visual-source";
import {
	resolveHumanoidBodyLayout,
	type HumanoidBodyLayout,
} from "../animation/humanoid-body-layout";
import type { AnimationAssetRepository } from "../animation/animation-asset-repository";
import {
	behaviorTargetId,
	type BehaviorTargetId,
} from "../behavior/behavior-event-router";
import type { PreparedAssetHandle } from "../behavior/prepared-asset-repository";
import type { DatAssetId, LandblockOwnerId } from "../game-types";
import type { GeometryManager } from "../geometry/geometry-manager";
import { adaptAuthoredDynamicPresentation } from "../resolution/authored-dynamic-presentation";
import type { AuthoredDynamicSource } from "../resolution/landblock-layer";
import { resolveObjectBehavior } from "../resolution/object-resident-classifier";
import type { SetupSidewaysSpan } from "../resolution/presentation";
import {
	SceneGraph,
	type SceneNodeId,
	type ScenePlacement,
	type SceneSpatialPlacement,
} from "../scene";
import { selectionSphereFromBounds } from "../selection/entity-interaction-shape";
import type { EntitySelectionGeometry } from "../selection/entity-selection-intersection";
import type { EntitySelectionBounds } from "../selection/entity-selection-bounds";
import type { AnimationInstallation } from "../systems/animation-system";
import { DynamicEntityPlacementSystem } from "../systems/dynamic-entity-placement-system";
import {
	DynamicEntitySystem,
	type DynamicModelAttachment,
	type PreparedDynamicEntity,
} from "../systems/dynamic-entity-system";
import type {
	NameplateDecoration,
	PlacedDynamicPresentationSource,
} from "../systems/dynamic-presentation-source";
import {
	ObjectVisualTemplateRepository,
	VisualTemplateStagingError,
	type ObjectVisualTemplate,
} from "../systems/object-visual-template-repository";
import type { AtlasRequirementHandle } from "../textures/atlas/resident-texture-atlas";
import type { ResidentTextureAtlas } from "../textures/atlas/resident-texture-atlas";
import { placementKey } from "./attachment-contract";
import type {
	DynamicEntityTickBatch,
	DynamicEntityView,
} from "./dynamic-entity-feed";
import type { DynamicEntityMotionState } from "./dynamic-entity-motion";
import {
	adaptDynamicEntityPresentation,
	datAssetId,
	dynamicEntityPlacement,
	hasUsableDynamicBody,
	type DynamicEntityRealizationDisposition,
	type DynamicEntityRealizationResults,
} from "./dynamic-entity-presentation";
import type { DynamicPresentationOverride } from "./dynamic-presentation-override";
import {
	prepareLocalModelPresentation,
	canReplaceLocalModelAppearance,
	type LocalModelPresentation,
} from "./local-model-presentation";
import {
	LocalSceneModelHandle,
	type LocalSceneModelSource,
} from "./local-scene-model";
import {
	dynamicEntityOwnerId,
	dynamicGenerationToResourceOwnerId,
	isLocalSceneModelOwnerId,
	localSceneModelOwnerId,
	type DynamicEntityOwnerId,
	type DynamicOwnerId,
	type DynamicPresentationResourceOwnerId,
	type EnvCellBehaviorOwnerId,
	type LocalSceneModelOwnerId,
	type OwnerId,
	type ResourceOwnerId,
} from "./owner-ids";
import type { PresentationAssetService } from "./presentation-asset-service";
import { setupVisualKey } from "./presentation-asset-service";
import type { PresentationProfiler } from "./presentation-profiler";
import { completePresentationOperations } from "./presentation-teardown";
import {
	releaseCueAssets,
	type BehaviorCueAndEffectsCoordinator,
} from "./runtime-behavior-effects";
import type { AuthoredDynamicResidentDiagnostic } from "./runtime-telemetry-lifecycle";
import type { LandblockLayerKind } from "./scene-interest";
import type { StaticLayerCompanionPublication } from "./static-layer-realizer";

export interface DynamicEntityPresentationRecord {
	/** Composition compatibility of the currently committed setup, resolved once per visual. */
	bodyLayout: HumanoidBodyLayout | null;
	readonly generation: number;
	/**
	 * Dynamics owner generation this node's behavior targets carry.
	 *
	 * Distinct from `generation`, which is the host's semantic entity generation: a later clip
	 * projection has to name the target the animation record was staged under, not the entity's.
	 */
	readonly behaviorGeneration: number;
	readonly nodeId: SceneNodeId;
	readonly ownerId: DynamicEntityOwnerId;
	/** Particle selection installed with this body. */
	particleKey: string | null;
	/** Appearance currently committed to the retained root and part targets. */
	visualKey: string;
	/** Last world-owned absolute scale applied to the installed visual root. */
	objectScale: number;
	/** Exact desired placement already applied to this scene root. */
	placementIdentity: DynamicEntityView["placement"];
	/** Mutable visibility/lighting level already applied to the dynamic system. */
	presentationStateIdentity: DynamicEntityView["physics"];
	/**
	 * Accepted levels and installation outcomes for each track, so restated levels are not re-entered.
	 *
	 * Mutable because it tracks playback state independently from appearance replacement.
	 */
	motionState: {
		ordinary: DynamicEntityMotionState | null;
		locomotion: DynamicEntityMotionState | null;
	} | null;
}

/** One unavailable prerequisite that can make a desired entity realizable later. */
type DynamicEntityDeferral =
	| {
			readonly kind: "parent";
			/** Null while the parent itself is absent. */
			readonly missingSlotSetup: DatAssetId | null;
	  }
	| { readonly kind: "residency"; readonly residencyKey: string };

/** Runtime-owned desired level and every derived fact consumed by realization decisions. */
export interface DesiredDynamicEntityRecord {
	/** Last queued intrinsic level, including transitions accepted before model installation. */
	cueHidden: boolean;
	/** Latest mirror-accepted entity, retained independently of local presentation. */
	authoritative: DynamicEntityView;
	/** Effective visual level; world placement and simulation remain authoritative. */
	entity: DynamicEntityView;
	/** Scoped local level captured for asynchronous currentness. */
	readonly override: DynamicPresentationOverride | null;
	/** Exact immutable visual lookup identity. */
	readonly visualKey: string;
	/** Stable immutable visual fields; callers may mutate an accepted view before the next upsert. */
	readonly visualIdentity: DynamicEntityView["presentation"];
	/** Placement comparison identity computed once when this desired level is accepted. */
	placementIdentity: DynamicEntityView["placement"];
	/** Current missing prerequisite, or null while eligible/installed. */
	deferral: DynamicEntityDeferral | null;
	/** Effective cue table: undefined until visual metadata resolves; null means no table. */
	scriptTableId: DatAssetId | null | undefined;
	/** Exclusive preparation outcome; a rejected source is retried only by a new level or explicit retry. */
	realization:
		| { readonly kind: "idle" }
		| {
				readonly kind: "preparing";
				/** Exact retained or installed playback owner; null means no presentation was committed. */
				readonly completion: Promise<DynamicEntityPresentationRecord | null>;
		  }
		| { readonly kind: "unavailable"; readonly error: Error };
}

interface RetainedSetupVisual {
	readonly completion: Promise<PreparedAssetHandle<DecodedStaticPresentation>>;
	readonly visualKey: string;
}

export interface SpawnedEntityLifecycleContext {
	readonly scene: SceneGraph;
	readonly geometry: GeometryManager<ResourceOwnerId>;
	readonly residentAtlas: ResidentTextureAtlas<ResourceOwnerId>;
	readonly presentationAssets: PresentationAssetService;
	readonly soundTables: ConstructorParameters<
		typeof DynamicEntitySystem<DynamicOwnerId, ResourceOwnerId>
	>[7];
	readonly behavior: BehaviorCueAndEffectsCoordinator;
	readonly clock: () => number;
	readonly isDestroyed: () => boolean;
	readonly getPresentationProfiler: () => PresentationProfiler | undefined;
	readonly reportContentFailure: (error: Error) => void;
	readonly pushPresentationFailure: (cause: unknown) => void;
	readonly trackRealizationContinuation: (
		continuation: Promise<unknown>,
	) => void;
	readonly setAuthoredDynamicResidents: (
		ownerId: OwnerId | EnvCellBehaviorOwnerId,
		diagnostics: AuthoredDynamicResidentDiagnostic[],
	) => void;
	readonly setTargetSoundTable: (
		targetId: BehaviorTargetId,
		soundTable: DecodedSoundTable,
	) => void;
	readonly deleteTargetSoundTable: (targetId: BehaviorTargetId) => void;
	readonly retainDynamicAppearance: (
		layout: ObjectVisualTemplate["layout"],
		appearance: ObjectVisualTemplate["appearance"],
	) => () => void;
	readonly isScopeReadyInInterest: (placement: ScenePlacement) => boolean;
	readonly hasInstalledTerrainSource: (
		landblockId: LandblockOwnerId,
	) => boolean;
	readonly getNameplateDecoration: (
		guid: number,
	) => NameplateDecoration | undefined;
	readonly deleteNameplateDecoration: (guid: number) => void;
	readonly usesSelectionSphereProxy: (nodeId: SceneNodeId) => boolean;
}

/**
 * Owns authoritative dynamic entity mirror realization, deferral, visual overrides,
 * bare-body attachment visibility, and local scene models.
 */
export class SpawnedEntityLifecycleCoordinator {
	readonly #context: SpawnedEntityLifecycleContext;
	/** Sole frontend writer of dynamic entity root placement and residency. */
	readonly #dynamicPlacements: DynamicEntityPlacementSystem;
	/** Shared visual-template residency for authored dynamics and the portal transition object. */
	readonly #objectVisualTemplates: ObjectVisualTemplateRepository<
		DynamicPresentationResourceOwnerId,
		AtlasRequirementHandle<ResourceOwnerId>
	>;
	/** Dynamic roots, articulated part nodes, and presentation preparation. */
	readonly #dynamics: DynamicEntitySystem<DynamicOwnerId, ResourceOwnerId>;
	/** Shared immutable animation residency used by world dynamics and the isolated preview. */
	readonly #animationAssets: AnimationAssetRepository;
	/** Narrow CPU preparation lifetime, borrowed from composition or owned by standalone builds. */
	readonly #presentationAssets: PresentationAssetService;
	/** Latest desired current views are liveness tokens and late-readiness endpoints, not authority. */
	readonly #spawnedDesiredEntities = new Map<
		number,
		DesiredDynamicEntityRecord
	>();
	/** Desired attachment adjacency used by parent replacement/removal and late readiness. */
	readonly #spawnedDesiredChildren = new Map<number, Set<number>>();
	/** Deferred world roots keyed by the static residency fact that can wake them. */
	readonly #spawnedDeferredResidencies = new Map<string, Set<number>>();
	/** Installed frontend resources keyed by producer identity. */
	readonly #spawnedPresentations = new Map<
		number,
		DynamicEntityPresentationRecord
	>();
	readonly #spawnedVisualKeys = new Map<number, string>();
	readonly #retainedSetupVisuals = new Map<string, RetainedSetupVisual>();
	/** Change fact for the overhead map's realized entity and radar picture. */
	#mapEntityRevision = 0;
	#presentationOverride: DynamicPresentationOverride | null = null;
	/** Equipment suppression follows the installed body, including while restoration loads. */
	#bareBodySubject: { guid: number; generation: number } | null = null;
	/** Frontend-owned preview visibility suppresses emitters independently of game Hidden/NoDraw. */
	readonly #suppressedParticleRoots = new Set<SceneNodeId>();
	/** Exact model roots installed by each shared dynamic owner. */
	readonly #dynamicPresentationNodes = new Map<
		DynamicOwnerId,
		ReadonlySet<SceneNodeId>
	>();
	/** Local roots retain their typed audio-policy owner during both staging and installation. */
	readonly #localModelNodeOwners = new Map<
		SceneNodeId,
		LocalSceneModelOwnerId
	>();
	/** Local visual handles are joined before their shared runtime repositories retire. */
	readonly #localSceneModels = new Set<LocalSceneModelHandle>();
	#nextLocalModelSerial = 1;

	constructor(context: SpawnedEntityLifecycleContext) {
		this.#context = context;
		this.#presentationAssets = context.presentationAssets;
		this.#animationAssets = context.presentationAssets.animations;
		this.#dynamicPlacements = new DynamicEntityPlacementSystem(context.scene);
		this.#objectVisualTemplates = new ObjectVisualTemplateRepository<
			DynamicPresentationResourceOwnerId,
			AtlasRequirementHandle<ResourceOwnerId>
		>(
			context.geometry,
			context.residentAtlas,
			context.presentationAssets.objectTemplates,
			(template) =>
				context.retainDynamicAppearance(template.layout, template.appearance),
		);
		this.#dynamics = new DynamicEntitySystem(
			context.scene,
			this.#dynamicPlacements,
			this.#objectVisualTemplates,
			this.#animationAssets,
			context.behavior.physicsScripts,
			context.behavior.particleEmitters,
			context.behavior.effects,
			context.soundTables,
			dynamicGenerationToResourceOwnerId,
			// Emitters ride their owner's visibility: its bounds grow to contain what it emits, so
			// the renderer's existing footprint test covers particles without a parallel path.
			(nodeId) =>
				context.behavior.particles.envelopeRadiusFor(behaviorTargetId(nodeId)),
			() => context.behavior.particles.takeDirtyEnvelopeOwnerIds(),
		);
	}

	get dynamics(): DynamicEntitySystem<DynamicOwnerId, ResourceOwnerId> {
		return this.#dynamics;
	}

	get objectVisualTemplates(): ObjectVisualTemplateRepository<
		DynamicPresentationResourceOwnerId,
		AtlasRequirementHandle<ResourceOwnerId>
	> {
		return this.#objectVisualTemplates;
	}

	get animationAssets(): AnimationAssetRepository {
		return this.#animationAssets;
	}

	get dynamicEntityPlacementRevision(): number {
		return this.#dynamicPlacements.revision;
	}

	get mapEntityRevision(): number {
		return this.#mapEntityRevision + this.#dynamicPlacements.revision;
	}

	getDesiredEntity(guid: number): DesiredDynamicEntityRecord | undefined {
		return this.#spawnedDesiredEntities.get(guid);
	}

	getInstalledPresentation(
		guid: number,
	): DynamicEntityPresentationRecord | undefined {
		return this.#spawnedPresentations.get(guid);
	}

	getDesiredChildren(guid: number): ReadonlySet<number> | undefined {
		return this.#spawnedDesiredChildren.get(guid);
	}

	isParticleRootSuppressed(root: SceneNodeId): boolean {
		return this.#suppressedParticleRoots.has(root);
	}

	getLocalModelOwnerForNode(
		nodeId: SceneNodeId,
	): LocalSceneModelOwnerId | null {
		const root = this.#dynamics.modelRootOf(nodeId);
		return root === null
			? null
			: (this.#localModelNodeOwners.get(root) ?? null);
	}

	isEntityFrontendEvicted(guid: number): boolean {
		return this.#isDynamicEntityFrontendEvicted(guid);
	}

	advancePlacements(nowMs: number): void {
		const finishPlacement = this.#context
			.getPresentationProfiler()
			?.beginWork("placementAdvance");
		try {
			this.#dynamicPlacements.advance(nowMs);
		} finally {
			finishPlacement?.();
		}
	}

	resetUnavailableRealizations(): void {
		for (const record of this.#spawnedDesiredEntities.values()) {
			if (record.realization.kind === "unavailable")
				record.realization = { kind: "idle" };
		}
	}

	/**
	 * Replace accepted authority synchronously, then converge its eligible presentations.
	 *
	 * Callers may rely on every record entering desired authority before this call returns its
	 * realization promise. The promise names visual completion, not authority acceptance.
	 */
	async replaceDynamicEntitySnapshot(
		entities: readonly DynamicEntityView[],
	): Promise<DynamicEntityRealizationResults> {
		if (this.#context.isDestroyed())
			throw new Error(
				"Cannot replace the dynamic entity snapshot after runtime shutdown.",
			);
		if (
			!this.#presentationAssets.setupVisuals.available &&
			entities.length > 0
		) {
			throw new Error("This runtime has no setup visual source capability.");
		}
		const requested = new Map<number, DynamicEntityView>();
		for (const entity of entities) {
			const guid = entity.identity.guid;
			if (requested.has(guid))
				throw new Error(
					`Dynamic entity snapshot repeats GUID ${formatDynamicGuid(guid)}.`,
				);
			requested.set(guid, entity);
		}
		for (const guid of this.#context.behavior.pendingCueGuids())
			this.#context.behavior.retainPendingDynamicEntityCues(
				guid,
				requested.get(guid)?.generation,
			);
		const stale = new Set(
			[...this.#spawnedDesiredEntities.keys()].filter(
				(guid) => !requested.has(guid),
			),
		);
		for (const guid of stale) {
			const desired = this.#spawnedDesiredEntities.get(guid);
			if (desired !== undefined)
				this.removeDynamicEntity(guid, desired.entity.generation);
		}
		for (const entity of requested.values())
			this.#acceptDesiredDynamicEntity(entity);
		return this.reevaluateDynamicEntityEligibility();
	}

	/**
	 * Accept one mirror-approved level synchronously, then realize its visual asynchronously.
	 *
	 * Callers may dispatch later accepted ticks after invocation without awaiting visual completion.
	 */
	async upsertDynamicEntity(
		entity: DynamicEntityView,
	): Promise<DynamicEntityRealizationDisposition> {
		if (this.#context.isDestroyed())
			throw new Error("Cannot upsert a dynamic entity after runtime shutdown.");
		if (!this.#presentationAssets.setupVisuals.available)
			throw new Error("This runtime has no setup visual source capability.");
		const record = this.#acceptDesiredDynamicEntity(entity);
		await this.#realizeAcceptedDynamicEntity(record);
		return this.#dynamicEntityDisposition(record);
	}

	/** Replace a local appearance level without changing the authority mirror or object generation. */
	async setDynamicPresentationOverride(
		level: DynamicPresentationOverride | null,
	): Promise<void> {
		if (this.#context.isDestroyed())
			throw new Error("Cannot override presentation after runtime shutdown.");
		if (JSON.stringify(level) === JSON.stringify(this.#presentationOverride)) {
			const desired =
				level === null
					? undefined
					: this.#spawnedDesiredEntities.get(level.guid);
			if (
				desired === undefined ||
				this.#dynamicEntityDisposition(desired) === "installed"
			)
				return;
		}
		const previous = this.#presentationOverride;
		this.#presentationOverride = level;
		const guids = new Set([previous?.guid, level?.guid]);
		for (const guid of guids) {
			if (guid === undefined) continue;
			const desired = this.#spawnedDesiredEntities.get(guid);
			if (desired === undefined) continue;
			const record = this.#acceptDesiredDynamicEntity(desired.authoritative);
			await this.#realizeAcceptedDynamicEntity(record);
		}
	}

	/** Failure for an entity whose generation has no usable body. */
	dynamicEntityBodyFailure(guid: number): Error | null {
		const record = this.#spawnedDesiredEntities.get(guid);
		return record?.realization.kind === "unavailable" &&
			this.#dynamicEntityDisposition(record) === "unavailable"
			? record.realization.error
			: null;
	}

	/** Retire one exact accepted generation while preserving newer desired authority. */
	removeDynamicEntity(guid: number, generation: number): void {
		if (this.#context.isDestroyed())
			throw new Error("Cannot remove a dynamic entity after runtime shutdown.");
		this.#context.behavior.removeEntityCuesForGeneration(guid, generation);
		const desired = this.#spawnedDesiredEntities.get(guid);
		if (desired?.entity.generation !== generation) return;
		this.#context.deleteNameplateDecoration(guid);
		this.#retireDynamicPresentationTree(guid);
		this.#forgetDesiredDynamicEntity(guid, "release-visual");
		for (const childGuid of this.#spawnedDesiredChildren.get(guid) ?? []) {
			const child = this.#spawnedDesiredEntities.get(childGuid);
			if (child !== undefined)
				this.#deferDynamicEntity(child, {
					kind: "parent",
					missingSlotSetup: null,
				});
		}
	}

	/** Revisit desired authority only at an explicit scene-readiness boundary. */
	async reevaluateDynamicEntityEligibility(): Promise<DynamicEntityRealizationResults> {
		if (this.#context.isDestroyed())
			throw new Error(
				"Cannot reevaluate dynamic entity eligibility after runtime shutdown.",
			);
		const records = [...this.#spawnedDesiredEntities.values()];
		const worldRoots = records.filter(
			(record) => record.entity.placement.kind === "world",
		);
		const outcomes = await Promise.allSettled(
			worldRoots.map((record) => this.#realizeAcceptedDynamicEntity(record)),
		);
		for (const record of records) {
			if (
				record.entity.placement.kind === "attached" &&
				this.#dynamicEntityDisposition(record) === "deferred"
			) {
				await this.#realizeAcceptedDynamicEntity(record);
			}
		}
		const failures = outcomes.flatMap((outcome) =>
			outcome.status === "rejected" ? [outcome.reason] : [],
		);
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) {
			throw new AggregateError(
				failures,
				`${failures.length} dynamic entities failed presentation realization.`,
			);
		}
		return new Map(
			records.map((record) => {
				const entity = record.entity;
				return [
					entity.identity.guid,
					this.#dynamicEntityDisposition(record),
				] as const;
			}),
		);
	}

	/** Accept tick state immediately; only changed visual requests start asynchronous realization. */
	applyDynamicEntityTick(
		batch: DynamicEntityTickBatch,
		receivedAtMs: number,
	): void {
		if (this.#context.isDestroyed())
			throw new Error(
				"Cannot apply a dynamic entity tick after runtime shutdown.",
			);
		for (const advance of batch.advances) {
			const entity = advance.entity;
			const guid = entity.identity.guid;
			const previous = this.#spawnedDesiredEntities.get(guid);
			if (previous?.entity.generation !== entity.generation) continue;
			const desired = this.#acceptDynamicTickEntity(entity, previous);
			const installed = this.#spawnedPresentations.get(guid);
			if (installed?.generation !== entity.generation) continue;
			this.#applySpawnedPresentationState(installed, entity);
			this.#dynamics.updatePlacementPath(
				installed.nodeId,
				advance,
				batch.durationMs,
				receivedAtMs,
			);
			if (advance.kind !== "integrated")
				this.#context.behavior.reanchorDynamicParticles(guid);
			installed.placementIdentity = desired.placementIdentity;
		}
		for (const entity of batch.updates) {
			const guid = entity.identity.guid;
			const previous = this.#spawnedDesiredEntities.get(guid);
			if (previous?.entity.generation !== entity.generation) continue;
			if (!sameDynamicPath(previous.placementIdentity, entity.placement)) {
				throw new Error(
					`Dynamic entity ${formatDynamicGuid(guid)} received a path-changing tick update without an advance.`,
				);
			}
			const membershipChanged = !sameDynamicPlacement(
				previous.placementIdentity,
				entity.placement,
			);
			const desired = this.#acceptDynamicTickEntity(entity, previous);
			const installed = this.#spawnedPresentations.get(guid);
			if (installed?.generation !== entity.generation) continue;
			if (membershipChanged && entity.placement.kind === "world") {
				this.#dynamics.refreshPlacementMembership(
					installed.nodeId,
					entity.placement,
				);
			}
			this.#applySpawnedPresentationState(installed, entity);
			installed.placementIdentity = desired.placementIdentity;
		}
	}

	/**
	 * Resolve one spawned entity's live root origin, for a follower that must not lag it.
	 *
	 * Returns the scene graph's own resolution rather than the last host pose, so a follower sees
	 * the same interpolated position the entity is drawn at. `null` for an entity that is not
	 * currently presented, which is an ordinary state during realization rather than an error.
	 */
	dynamicEntityOrigin(
		guid: number,
	): import("../scene").ResolvedSceneOrigin | null {
		const installed = this.#spawnedPresentations.get(guid);
		if (!installed) return null;
		return this.#context.scene.getResolvedOrigin(installed.nodeId) ?? null;
	}

	/**
	 * Where one spawned entity is being drawn right now.
	 *
	 * Read from the scene rather than from a feed snapshot, because the scene is what presentation
	 * rate actually updates: ordinary integrated advances move entities every host tick without
	 * republishing any view, so anything that follows a moving entity — a map anchor, a blip — must
	 * ask here or it will hold a pose from the last discontinuous correction.
	 *
	 * Null once an entity is no longer realized.
	 */
	spawnedEntityPlacement(guid: number): ScenePlacement | null {
		const nodeId = this.#spawnedPresentations.get(guid)?.nodeId;
		if (nodeId === undefined) return null;
		// Only a root carries residency, and every spawned entity is realized as one.
		return this.#context.scene.getRootPlacement(nodeId) ?? null;
	}

	/** Borrow raw posed boxes independently of camera culling and pointer sphere policy. */
	visitRealizedEntitySelectionBounds(
		visit: (entity: DynamicEntityView, bounds: EntitySelectionBounds) => void,
	): void {
		for (const [guid, installed] of this.#spawnedPresentations) {
			const desired = this.#spawnedDesiredEntities.get(guid);
			if (
				desired === undefined ||
				desired.authoritative.placement.kind !== "world" ||
				!this.#isDynamicScopeReady(desired.entity)
			)
				continue;
			const disposition = dynamicBodyDisposition(desired, installed);
			if (!hasUsableDynamicBody(disposition)) continue;
			this.#dynamics.withSelectionGeometry(installed.nodeId, (geometry) => {
				if (geometry.parts.length > 0) visit(desired.authoritative, geometry);
			});
		}
	}

	/** Borrow one realized entity's current posed CPU geometry for an exact interaction query. */
	withSpawnedEntitySelectionGeometry<T>(
		guid: number,
		visit: (geometry: EntitySelectionGeometry) => T,
	): T | null {
		const nodeId = this.#spawnedPresentations.get(guid)?.nodeId;
		return nodeId === undefined
			? null
			: this.#dynamics.withSelectionGeometry(nodeId, (geometry) =>
					this.#context.usesSelectionSphereProxy(nodeId)
						? visit({
								kind: "sphere-proxy",
								landblockId: geometry.landblockId,
								sourceToLandblock: geometry.sourceToLandblock,
								sphere: selectionSphereFromBounds(geometry.localBounds),
							})
						: visit({ kind: "triangles", ...geometry }),
				);
	}

	/**
	 * Every realized spawned entity paired with where it is being drawn right now.
	 *
	 * The identity half comes from the runtime's own desired-entity record rather than from any
	 * inspector snapshot, so nothing that draws entities depends on a diagnostics path.
	 */
	*listPresentedSpawnedEntities(): Generator<{
		readonly sidewaysSpan: SetupSidewaysSpan | null;
		readonly view: DynamicEntityView;
		readonly placement: ScenePlacement;
	}> {
		for (const [guid, record] of this.#spawnedDesiredEntities) {
			const placement = this.spawnedEntityPlacement(guid);
			if (placement) {
				const nodeId = this.#spawnedPresentations.get(guid)?.nodeId;
				yield {
					placement,
					view: record.entity,
					sidewaysSpan:
						nodeId === undefined
							? null
							: this.#dynamics.setupSidewaysSpan(nodeId),
				};
			}
		}
	}

	/** Admit one presentation-only body/equipment lifetime into the existing world scene. */
	createLocalSceneModel(
		placement: SceneSpatialPlacement,
	): LocalSceneModelHandle {
		if (this.#context.isDestroyed())
			throw new Error("Cannot create a local model after runtime shutdown.");
		const owner = localSceneModelOwnerId(this.#nextLocalModelSerial++);
		let installed: {
			readonly input: LocalSceneModelSource;
			readonly presentation: LocalModelPresentation;
			readonly models: readonly PreparedDynamicEntity[];
		} | null = null;
		const setPlacement = (next: SceneSpatialPlacement) => {
			const body = installed?.models[0];
			if (body !== undefined) this.#dynamics.updatePlacement(body.nodeId, next);
		};
		const setVisible = (visible: boolean) => {
			if (installed === null) return;
			for (const [index, model] of installed.models.entries()) {
				const source = installed.presentation.sources[index];
				if (source === undefined)
					throw new Error("Installed local model has no presentation source.");
				if (visible) this.#suppressedParticleRoots.delete(model.nodeId);
				else this.#suppressedParticleRoots.add(model.nodeId);
				this.#dynamics.updatePresentationState(model.nodeId, {
					...source.initialPresentationState,
					// Local scene visibility suppresses the whole presentation, including emitters.
					hidden: !visible,
				});
			}
		};
		const handle = new LocalSceneModelHandle(
			{
				prepare: async (input, initialPlacement) => {
					const presentation = await prepareLocalModelPresentation(
						this.#presentationAssets.setupVisuals,
						owner,
						input,
						initialPlacement,
					);
					const prepareFull = () =>
						this.#prepareDynamicOwner(
							owner,
							presentation.sources,
							"browser",
							presentation.attachments,
						);
					type CompositionInstallation = Pick<
						Awaited<ReturnType<typeof prepareFull>>,
						"prepared" | "commit" | "release"
					>;
					let activation: CompositionInstallation | null = null;
					try {
						const previous = installed;
						if (
							previous !== null &&
							canReplaceLocalModelAppearance(
								previous.input,
								input,
								previous.presentation,
								presentation,
							)
						) {
							const oldBody = previous.models[0];
							const nextBody = presentation.sources[0];
							if (oldBody === undefined)
								throw new Error("Local composition requires a prepared body.");
							const replacement = await this.#dynamics.stageVisualReplacement(
								owner,
								oldBody.nodeId,
								nextBody.source,
							);
							if (replacement.kind === "staged")
								activation = {
									prepared: [
										{
											...oldBody,
											source: nextBody.source,
											animation: replacement.animation,
										},
										...previous.models.slice(1),
									],
									commit: () => {
										if (installed !== previous)
											throw new Error(
												"Cannot publish an appearance for a withdrawn local composition.",
											);
										replacement.commit();
									},
									release: () => replacement.release(),
								};
						}
						activation ??= await prepareFull();
						const prepared = activation;
						const body = prepared.prepared[0];
						if (body === undefined || body.animation.kind !== "sequence")
							throw new Error(
								"Local model body requires explicit resolved playback.",
							);
						// Frame the body independently of held equipment, including for fill-light focus.
						const fit = body.animation.fit;
						let transferred = false;
						return {
							fit,
							commit: (latest: SceneSpatialPlacement, visible: boolean) => {
								const previous = installed;
								prepared.commit();
								installed = {
									input,
									presentation,
									models: prepared.prepared,
								};
								transferred = true;
								completePresentationOperations([
									() => setPlacement(latest),
									() => setVisible(visible),
									() => previous?.presentation.release(),
								]);
							},
							release: () => {
								if (!transferred)
									completePresentationOperations([
										() => prepared.release(),
										() => presentation.release(),
									]);
							},
						};
					} catch (cause) {
						completePresentationOperations([
							() => activation?.release(),
							() => presentation.release(),
							() => {
								throw cause;
							},
						]);
						throw cause;
					}
				},
				setPlacement,
				setVisible,
				withdraw: () => {
					const previous = installed;
					installed = null;
					completePresentationOperations([
						() => this.#retireDynamicOwner(owner),
						() => previous?.presentation.release(),
					]);
				},
			},
			placement,
			() => this.#localSceneModels.delete(handle),
		);
		this.#localSceneModels.add(handle);
		return handle;
	}

	withdrawOutOfScopeDynamicEntities(): void {
		this.#withdrawOutOfScopeDynamicEntities();
	}

	wakeDeferredDynamicResidencies(
		residencyKey: string,
		match: "exact" | "prefix",
	): void {
		this.#wakeDeferredDynamicResidencies(residencyKey, match);
	}

	prepareStaticAuthoredDynamics(
		ownerId: OwnerId | EnvCellBehaviorOwnerId,
		layer: LandblockLayerKind,
		landblockId: LandblockOwnerId,
		sources: readonly AuthoredDynamicSource[],
	): Promise<StaticLayerCompanionPublication> {
		return this.#prepareStaticAuthoredDynamics(
			ownerId,
			layer,
			landblockId,
			sources,
		);
	}

	retireDynamicOwner(ownerId: DynamicOwnerId): void {
		this.#retireDynamicOwner(ownerId);
	}

	collectSyncDemandRevocations(): readonly (() => void)[] {
		const spawned = [...this.#spawnedDesiredEntities.keys()];
		return [
			...spawned.map((guid) => () => this.#retireDynamicPresentationTree(guid)),
			...spawned.map(
				(guid) => () =>
					this.#forgetDesiredDynamicEntity(guid, "release-visual"),
			),
		];
	}

	clearVisualKeys(): void {
		this.#spawnedVisualKeys.clear();
	}

	assertNoRetainedSetupVisuals(): void {
		if (this.#retainedSetupVisuals.size !== 0)
			throw new Error(
				`Runtime shutdown retained ${this.#retainedSetupVisuals.size} setup visual users.`,
			);
	}

	destroyVisualTemplates(): Promise<void> {
		return this.#objectVisualTemplates.destroy();
	}

	destroyDynamics(): Promise<void> {
		return this.#dynamics.destroy();
	}

	async destroyLocalModels(
		onRejected: (reason: unknown) => void,
	): Promise<void> {
		const retired = await Promise.allSettled(
			[...this.#localSceneModels].map((handle) => handle.destroy()),
		);
		this.#localSceneModels.clear();
		for (const result of retired)
			if (result.status === "rejected") onRejected(result.reason);
	}

	/** Keep attachment draw suppression separate from the child's authoritative Hidden state. */
	#attachmentVisibility(entity: DynamicEntityView) {
		if (entity.placement.kind !== "attached")
			return { entity, suppressParticles: false };
		let noDraw = entity.physics.noDraw;
		let suppressParticles = false;
		let current = entity;
		const visited = new Set<number>([entity.identity.guid]);
		while (current.placement.kind === "attached") {
			const parentGuid = current.placement.parent;
			if (visited.has(parentGuid))
				throw new Error("Dynamic equipment attachment contains a cycle.");
			visited.add(parentGuid);
			const parent = this.#spawnedDesiredEntities.get(parentGuid)?.entity;
			if (parent === undefined) break;
			// Retail behavior is to suppress attached meshes while their parent is Hidden.
			// Use NoDraw here: copying Hidden would invent child materialization cues.
			noDraw ||= parent.physics.hidden;
			if (
				parentGuid === this.#bareBodySubject?.guid &&
				parent.generation === this.#bareBodySubject.generation
			) {
				noDraw = true;
				suppressParticles = true;
			}
			current = parent;
		}
		return {
			/** Effective mesh visibility; the desired entity itself remains authoritative. */
			entity:
				noDraw === entity.physics.noDraw
					? entity
					: { ...entity, physics: { ...entity.physics, noDraw } },
			/** Preview equipment also suppresses emitters; retail parent Hidden only sets NoDraw. */
			suppressParticles,
		};
	}

	/** Parent-only visibility updates must reach every installed attachment before the next frame. */
	#refreshAttachmentVisibility(parentGuid: number): void {
		const pending = [parentGuid];
		const visited = new Set<number>();
		for (const parent of pending) {
			if (visited.has(parent))
				throw new Error("Dynamic equipment attachment contains a cycle.");
			visited.add(parent);
			for (const childGuid of this.#spawnedDesiredChildren.get(parent) ?? []) {
				const desired = this.#spawnedDesiredEntities.get(childGuid);
				const installed = this.#spawnedPresentations.get(childGuid);
				if (desired !== undefined && installed !== undefined)
					this.#applySpawnedPresentationState(installed, desired.entity);
				pending.push(childGuid);
			}
		}
	}

	/** Publish body and attachment visibility in the same synchronous commit turn. */
	#commitBareBodyVisibility(record: DesiredDynamicEntityRecord): void {
		const subject =
			record.override?.body === null || record.override === null
				? null
				: {
						guid: record.entity.identity.guid,
						generation: record.entity.generation,
					};
		if (
			subject === null &&
			this.#bareBodySubject?.guid !== record.entity.identity.guid
		)
			return;
		this.#bareBodySubject = subject;
		for (const [guid, desired] of this.#spawnedDesiredEntities) {
			if (desired.entity.placement.kind !== "attached") continue;
			const installed = this.#spawnedPresentations.get(guid);
			if (installed !== undefined)
				this.#applySpawnedPresentationState(installed, desired.entity);
		}
	}

	/** An asynchronous receipt can only describe the desired level that requested it. */
	#dynamicEntityDisposition(
		record: DesiredDynamicEntityRecord,
	): DynamicEntityRealizationDisposition {
		const guid = record.entity.identity.guid;
		if (this.#spawnedDesiredEntities.get(guid) !== record) return "deferred";
		return dynamicBodyDisposition(record, this.#spawnedPresentations.get(guid));
	}

	/** Realize one accepted level when its current residency or parent is available. */
	async #realizeAcceptedDynamicEntity(
		record: DesiredDynamicEntityRecord,
	): Promise<void> {
		if (
			this.#spawnedDesiredEntities.get(record.entity.identity.guid) !== record
		)
			return;
		const entity = record.entity;
		if (
			entity.placement.kind === "world" &&
			!this.#isDynamicScopeReady(entity)
		) {
			this.#deferDynamicEntity(record, {
				kind: "residency",
				residencyKey: dynamicResidencyKey(entity),
			});
			this.#retireDynamicPresentationTree(entity.identity.guid);
			return;
		}
		if (this.#deferIfDynamicParentUnavailable(record)) return;
		this.#clearDynamicEntityDeferral(record);
		const installed = this.#spawnedPresentations.get(entity.identity.guid);
		const disposition = dynamicBodyDisposition(record, installed);
		if (installed !== undefined && hasUsableDynamicBody(disposition)) {
			this.#applyDynamicEntityState(installed, record);
			await this.#realizeDesiredDynamicChildren(entity.identity.guid);
			return;
		}
		if (record.realization.kind === "unavailable") return;
		if (record.realization.kind === "preparing") {
			await record.realization.completion;
			return;
		}
		const guid = entity.identity.guid;
		const visual = this.#retainSpawnedVisual(guid, entity);
		const continuation = this.#realizeDynamicEntity(record, visual)
			.catch((cause: unknown) => {
				if (!this.#isDynamicRealizationEligible(record)) return null;
				const error = dynamicEntityPresentationFailure(entity, cause);
				if (isContentFailure(cause)) {
					this.#retireDynamicPresentationTree(guid);
					this.#context.reportContentFailure(error);
				} else if (cause instanceof VisualTemplateStagingError) {
					// Staging rolled back. A previous appearance still owns its scene node.
					console.warn(formatError(error), error);
					const retained = this.#spawnedPresentations.get(guid);
					if (retained !== undefined)
						this.#applyDynamicEntityState(retained, record);
				} else {
					throw error;
				}
				record.realization = { kind: "unavailable", error };
				return null;
			})
			.finally(() => {
				if (
					record.realization.kind === "preparing" &&
					record.realization.completion === continuation
				)
					record.realization = { kind: "idle" };
			});
		record.realization = { kind: "preparing", completion: continuation };
		this.#context.trackRealizationContinuation(continuation);
		await continuation;
		await this.#realizeDesiredDynamicChildren(guid);
	}

	/** Realize only descendants whose desired attachment names this installed parent. */
	async #realizeDesiredDynamicChildren(parentGuid: number): Promise<void> {
		for (const childGuid of this.#spawnedDesiredChildren.get(parentGuid) ??
			[]) {
			const child = this.#spawnedDesiredEntities.get(childGuid);
			if (child === undefined) continue;
			await this.#realizeAcceptedDynamicEntity(child);
		}
	}

	/** Accept one entity level and update its attachment dependency index atomically. */
	#acceptDesiredDynamicEntity(
		entity: DynamicEntityView,
	): DesiredDynamicEntityRecord {
		const authoritative = entity;
		const guid = entity.identity.guid;
		const level = this.#presentationOverride;
		const override =
			level?.guid === guid && level.generation === entity.generation
				? level
				: null;
		if (override?.body !== undefined && override.body !== null)
			entity = {
				...entity,
				presentation: {
					...entity.presentation,
					content: {
						...entity.presentation.content,
						setupDid: override.body.setupDid,
					},
					appearance: override.body.appearance,
				},
			};
		const previous = this.#spawnedDesiredEntities.get(guid);
		const hiddenChanged =
			previous?.entity.physics.hidden !== entity.physics.hidden;
		const sameVisual =
			previous !== undefined &&
			sameDynamicVisual(previous.visualIdentity, entity.presentation) &&
			(previous.override?.particles?.key ?? null) ===
				(override?.particles?.key ?? null) &&
			((previous.override?.body ?? null) !== null) ===
				((override?.body ?? null) !== null);
		// This key also names retained visual resources; build it only when its typed inputs change.
		const visualKey = sameVisual
			? previous.visualKey
			: JSON.stringify([
					setupVisualKey(
						entity.presentation.content.setupDid,
						entity.presentation.appearance,
					),
					entity.presentation.placementFrame,
					override?.particles?.key ?? null,
					(override?.body ?? null) !== null,
				]);
		const placementIdentity =
			previous !== undefined &&
			sameDynamicPlacement(previous.placementIdentity, entity.placement)
				? previous.placementIdentity
				: snapshotDynamicPlacement(entity.placement);
		if (
			previous !== undefined &&
			previous.entity.generation > entity.generation
		) {
			throw new Error(
				`Dynamic entity ${formatDynamicGuid(guid)} regressed from generation ${previous.entity.generation} to ${entity.generation}.`,
			);
		}
		const sameGeneration = previous?.entity.generation === entity.generation;
		this.#context.behavior.retainPendingDynamicEntityCues(
			guid,
			entity.generation,
		);
		const attachmentTopologyChanged =
			previous !== undefined &&
			!sameDynamicPlacement(previous.placementIdentity, placementIdentity) &&
			(previous.entity.placement.kind === "attached" ||
				entity.placement.kind === "attached");
		if (
			previous !== undefined &&
			sameGeneration &&
			previous.visualKey === visualKey &&
			!attachmentTopologyChanged
		) {
			previous.authoritative = authoritative;
			previous.entity = entity;
			previous.placementIdentity = placementIdentity;
			this.#mapEntityRevision += 1;
			this.#context.behavior.reconcileIntrinsicHiddenCue(previous);
			if (hiddenChanged) this.#refreshAttachmentVisibility(guid);
			return previous;
		}
		if (previous !== undefined) {
			if (!sameGeneration || attachmentTopologyChanged)
				this.#retireDynamicPresentationTree(guid);
			this.#forgetDesiredDynamicEntity(
				guid,
				previous.visualKey === visualKey ? "retain-visual" : "release-visual",
			);
		}
		const retainsInstalledCues =
			sameGeneration && this.#spawnedPresentations.has(guid);
		// Superseded cold visuals have no playback owner to retain. Detach their preparation
		// tail and seed the replacement from its current Hidden level.
		if (!retainsInstalledCues) this.#context.behavior.deleteCueInsertion(guid);
		const record: DesiredDynamicEntityRecord = {
			cueHidden:
				retainsInstalledCues && previous !== undefined
					? previous.cueHidden
					: false,
			authoritative,
			override,
			deferral: null,
			entity,
			placementIdentity,
			realization: { kind: "idle" },
			scriptTableId: undefined,
			visualKey,
			visualIdentity:
				sameVisual && previous !== undefined
					? previous.visualIdentity
					: snapshotDynamicVisual(entity.presentation),
		};
		this.#spawnedDesiredEntities.set(guid, record);
		this.#mapEntityRevision += 1;
		if (entity.placement.kind === "attached") {
			let children = this.#spawnedDesiredChildren.get(entity.placement.parent);
			if (children === undefined) {
				children = new Set();
				this.#spawnedDesiredChildren.set(entity.placement.parent, children);
			}
			children.add(guid);
		}
		this.#context.behavior.reconcileIntrinsicHiddenCue(record);
		if (hiddenChanged) this.#refreshAttachmentVisibility(guid);
		return record;
	}

	/** Remove one desired level and each index entry it owns. */
	#forgetDesiredDynamicEntity(
		guid: number,
		visualDisposition: "release-visual" | "retain-visual",
	): void {
		const record = this.#spawnedDesiredEntities.get(guid);
		if (record === undefined) return;
		this.#clearDynamicEntityDeferral(record);
		if (record.placementIdentity.kind === "attached") {
			const parentGuid = record.placementIdentity.parent;
			const children = this.#spawnedDesiredChildren.get(parentGuid);
			children?.delete(guid);
			if (children?.size === 0) this.#spawnedDesiredChildren.delete(parentGuid);
		}
		this.#spawnedDesiredEntities.delete(guid);
		this.#mapEntityRevision += 1;
		if (visualDisposition === "release-visual") {
			const visualKey = this.#spawnedVisualKeys.get(guid);
			if (visualKey !== undefined) this.#releaseSpawnedVisual(guid, visualKey);
		}
	}

	/** Replace one desired record's missing prerequisite and its reverse index entry. */
	#deferDynamicEntity(
		record: DesiredDynamicEntityRecord,
		deferral: DynamicEntityDeferral,
	): void {
		this.#clearDynamicEntityDeferral(record);
		record.deferral = deferral;
		// Parent readiness already traverses the desired attachment index.
		if (deferral.kind === "parent") return;
		let guids = this.#spawnedDeferredResidencies.get(deferral.residencyKey);
		if (guids === undefined) {
			guids = new Set();
			this.#spawnedDeferredResidencies.set(deferral.residencyKey, guids);
		}
		guids.add(record.entity.identity.guid);
	}

	/** Clear one desired record's reverse dependency entry. */
	#clearDynamicEntityDeferral(record: DesiredDynamicEntityRecord): void {
		const deferral = record.deferral;
		if (deferral?.kind === "residency") {
			const guids = this.#spawnedDeferredResidencies.get(deferral.residencyKey);
			guids?.delete(record.entity.identity.guid);
			if (guids?.size === 0)
				this.#spawnedDeferredResidencies.delete(deferral.residencyKey);
		}
		record.deferral = null;
	}

	/** A world root can install once its authoritative resident scope is available. */
	#isDynamicScopeReady(entity: DynamicEntityView): boolean {
		if (entity.placement.kind !== "world") return false;
		// Plural membership may include physically reached scopes that are not part of current scene
		// interest. The scene graph indexes those facts without requiring their topology; only the
		// pose's resident scope must exist so placement and camera resolution have an authority.
		const placement = dynamicEntityPlacement(entity);
		if (!this.#context.isScopeReadyInInterest(placement)) return false;
		if (placement.envCellId === null)
			return this.#context.hasInstalledTerrainSource(placement.landblockId);
		return this.#context.scene.hasEnvCellScope({
			envCellId: placement.envCellId,
			landblockId: placement.landblockId,
		});
	}

	/** Share desired-level reconciliation with upserts without making ordinary pose ticks async. */
	#acceptDynamicTickEntity(
		entity: DynamicEntityView,
		previous: DesiredDynamicEntityRecord,
	): DesiredDynamicEntityRecord {
		const record = this.#acceptDesiredDynamicEntity(entity);
		if (record !== previous) {
			const continuation = this.#realizeAcceptedDynamicEntity(record).catch(
				(cause: unknown) => {
					if (this.#spawnedDesiredEntities.get(entity.identity.guid) === record)
						this.#context.pushPresentationFailure(cause);
				},
			);
			this.#context.trackRealizationContinuation(continuation);
		}
		return record;
	}

	/** Revalidate asynchronous publication against current authority and residency/parent lifetime. */
	#isDynamicRealizationEligible(record: DesiredDynamicEntityRecord): boolean {
		const entity = record.entity;
		if (
			this.#spawnedDesiredEntities.get(entity.identity.guid) !== record ||
			this.#isDynamicEntityFrontendEvicted(entity.identity.guid)
		)
			return false;
		return !this.#deferIfDynamicParentUnavailable(record);
	}

	/** Check the installed setup both before loading the child and after asynchronous preparation. */
	#deferIfDynamicParentUnavailable(
		record: DesiredDynamicEntityRecord,
	): boolean {
		const { identity, placement } = record.entity;
		if (placement.kind === "world") return false;
		const parent = this.#spawnedPresentations.get(placement.parent);
		let missingSlotSetup: DatAssetId | null = null;
		if (
			parent !== undefined &&
			parent.generation ===
				this.#spawnedDesiredEntities.get(placement.parent)?.entity.generation
		) {
			// Retail behavior is to decline attachment when the setup lacks the requested slot.
			missingSlotSetup = this.#dynamics.setupMissingHoldingLocation(
				parent.nodeId,
				placement.parentLocation,
			);
			if (missingSlotSetup === null) return false;
		}
		if (
			record.deferral?.kind !== "parent" ||
			record.deferral.missingSlotSetup !== missingSlotSetup
		) {
			this.#deferDynamicEntity(record, {
				kind: "parent",
				missingSlotSetup,
			});
			this.#retireDynamicPresentationTree(identity.guid);
			if (missingSlotSetup !== null)
				console.warn(
					`Deferred attachment of ${formatDynamicGuid(identity.guid)} to ${formatDynamicGuid(placement.parent)}: setup ${missingSlotSetup} has no holding location ${placement.parentLocation}.`,
				);
		}
		return true;
	}

	async #realizeDynamicEntity(
		record: DesiredDynamicEntityRecord,
		visual: Promise<DecodedStaticPresentation>,
	): Promise<DynamicEntityPresentationRecord | null> {
		let entity = record.entity;
		const guid = entity.identity.guid;
		const resolved = await visual;
		if (!this.#isDynamicRealizationEligible(record)) return null;
		entity = record.entity;
		const stagingPlacement = this.#spawnedStagingPlacement(entity);
		if (stagingPlacement === null) return null;
		const ownerId = dynamicEntityOwnerId(guid);
		let source = adaptDynamicEntityPresentation(
			this.#attachmentVisibility(entity).entity,
			resolved,
			stagingPlacement,
		);
		const particleLevel = record.override?.particles ?? null;
		const particleKey = particleLevel?.key ?? null;
		if (particleLevel !== null)
			source = {
				...source,
				source: {
					...source.source,
					behavior: resolveObjectBehavior({
						...source.source.behavior,
						physicsScriptId:
							particleLevel.script === null
								? null
								: datAssetId(particleLevel.script),
					}),
				},
			};
		record.scriptTableId = source.source.behavior.physicsScriptTableId;
		this.#context.behavior.drainDynamicEntityCues(guid);
		const live = this.#spawnedPresentations.get(guid);
		if (live?.generation === entity.generation) {
			const particleChanged = live.particleKey !== particleKey;
			const rootId = source.source.behavior.physicsScriptId;
			const effect =
				particleChanged && rootId !== null
					? await this.#context.behavior.prepareDirectDynamicScript(rootId)
					: null;
			let transferred = false;
			try {
				if (!this.#isDynamicRealizationEligible(record)) return null;
				const replacement = await this.#dynamics.stageVisualReplacement(
					ownerId,
					live.nodeId,
					source.source,
				);
				if (replacement.kind === "staged") {
					try {
						if (
							!this.#isDynamicRealizationEligible(record) ||
							this.#spawnedPresentations.get(guid) !== live
						)
							return null;
						replacement.commit();
						if (particleChanged) {
							// Drain already-due time-zero defaults before clearing, so an unadvanced default
							// cannot resurrect the old crown/flame on the next frame.
							this.#context.behavior.worldOwnedPhysicsScriptSystem.advance(
								this.#context.clock(),
							);
							this.#context.behavior.releaseDynamicOverrideEffect(live.ownerId);
							this.#context.behavior.particles.destroy(
								{
									targetId: behaviorTargetId(live.nodeId),
									generation: live.behaviorGeneration,
								},
								0,
							);
							if (effect !== null) {
								this.#context.behavior.physicsScriptSystem.install(
									live.ownerId,
									{
										targetId: behaviorTargetId(live.nodeId),
										generation: live.behaviorGeneration,
									},
									effect.closure,
									this.#context.clock(),
								);
								this.#context.behavior.setDynamicOverrideEffect(
									live.ownerId,
									effect,
								);
								transferred = true;
							}
							live.particleKey = particleKey;
						}
						this.#commitBareBodyVisibility(record);
						live.visualKey = record.visualKey;
						live.bodyLayout = resolveHumanoidBodyLayout(
							resolved.presentation.parts.length,
							resolved.partParents,
						);
						this.#applyDynamicEntityState(live, record);
					} finally {
						replacement.release();
					}
					return live;
				}
			} finally {
				if (effect !== null && !transferred) releaseCueAssets(effect);
			}
		}
		const activation = await this.#prepareDynamicOwner(
			ownerId,
			[source],
			"world",
			() => [],
		);
		if (!this.#isDynamicRealizationEligible(record)) {
			activation.release();
			return null;
		}
		const [nodeId] = activation.nodeIds;
		if (nodeId === undefined || activation.nodeIds.length !== 1) {
			activation.release();
			throw new Error(
				`Dynamic entity ${formatDynamicGuid(guid)} prepared ${activation.nodeIds.length} scene roots.`,
			);
		}
		// An incompatible skeleton replaces its owner atomically; retire only its attached
		// descendants here, since retiring the parent would invalidate the prepared activation.
		for (const childGuid of this.#spawnedDesiredChildren.get(guid) ?? [])
			this.#retireDynamicPresentationTree(childGuid);
		activation.commit();
		if (live !== undefined) {
			// A new skeleton has a new playback lifetime. Old preparation tails must not delay it,
			// and a currently Hidden level must seed the new owner's intrinsic effect again.
			this.#context.behavior.deleteCueInsertion(guid);
			record.cueHidden = false;
		}
		const [preparedEntity] = activation.prepared;
		if (preparedEntity === undefined)
			throw new Error("Committed dynamic entity has no prepared source.");
		const installed: DynamicEntityPresentationRecord = {
			bodyLayout: resolveHumanoidBodyLayout(
				resolved.presentation.parts.length,
				resolved.partParents,
			),
			behaviorGeneration: activation.generation,
			particleKey,
			generation: entity.generation,
			nodeId,
			ownerId,
			placementIdentity: record.placementIdentity,
			motionState: null,
			objectScale: entity.presentation.objectScale,
			// Installation already seeded this state before behavior replay. Mark it current so the
			// convergence pass cannot erase part-local replay results.
			presentationStateIdentity: { ...entity.physics },
			visualKey: record.visualKey,
		};
		this.#spawnedPresentations.set(guid, installed);
		this.#mapEntityRevision += 1;
		this.#commitBareBodyVisibility(record);
		this.#context.behavior.drainDynamicEntityCues(guid);
		if (entity.placement.kind === "attached") {
			const parent = this.#spawnedPresentations.get(entity.placement.parent);
			if (!parent) {
				throw new Error(
					`Attached dynamic entity ${formatDynamicGuid(guid)} lost parent ${formatDynamicGuid(entity.placement.parent)} during synchronous activation.`,
				);
			}
			try {
				this.#dynamics.attachEntity(
					nodeId,
					parent.nodeId,
					entity.placement.parentLocation,
					placementKey(entity.placement.placement),
				);
			} catch (cause) {
				this.#retireDynamicOwner(ownerId);
				this.#spawnedPresentations.delete(guid);
				this.#mapEntityRevision += 1;
				throw cause;
			}
		}
		const latestDesired = this.#spawnedDesiredEntities.get(guid);
		if (latestDesired !== record) {
			throw new Error(
				`Dynamic entity ${formatDynamicGuid(guid)} changed generation during synchronous activation commit.`,
			);
		}
		this.#applyDynamicEntityState(installed, latestDesired);
		return installed;
	}

	/** Apply everything one view says about an installed presentation, placement included. */
	#applyDynamicEntityState(
		installed: DynamicEntityPresentationRecord,
		record: DesiredDynamicEntityRecord,
	): void {
		const entity = record.entity;
		if (
			entity.placement.kind === "world" &&
			!sameDynamicPlacement(
				installed.placementIdentity,
				record.placementIdentity,
			)
		) {
			this.#dynamics.updatePlacement(
				installed.nodeId,
				dynamicEntityPlacement(entity),
			);
			// Snapshot/upsert placement has no traversed path; it is a new baseline.
			this.#context.behavior.reanchorDynamicParticles(entity.identity.guid);
			installed.placementIdentity = record.placementIdentity;
		}
		this.#applySpawnedPresentationState(installed, entity);
	}

	/** Resolve the temporary world placement needed only while an attached visual is staged. */
	#spawnedStagingPlacement(
		entity: DynamicEntityView,
	): SceneSpatialPlacement | null {
		if (entity.placement.kind === "world")
			return dynamicEntityPlacement(entity);
		const parent = this.#spawnedPresentations.get(entity.placement.parent);
		if (!parent) return null;
		return this.#dynamics.resolvedRootPlacement(parent.nodeId);
	}

	/**
	 * Apply what one view says a presentation should look like and be playing.
	 *
	 * Both are levels the view restates every time it arrives, and every path that applies a view
	 * to an installed presentation goes through here. Keeping them together is what stops a path
	 * from carrying visibility forward while leaving playback on whatever it happened to catch.
	 */
	#applySpawnedPresentationState(
		installed: DynamicEntityPresentationRecord,
		entity: DynamicEntityView,
	): void {
		const visibility = this.#attachmentVisibility(entity);
		if (visibility.suppressParticles)
			this.#suppressedParticleRoots.add(installed.nodeId);
		else this.#suppressedParticleRoots.delete(installed.nodeId);
		entity = visibility.entity;
		if (installed.objectScale !== entity.presentation.objectScale) {
			this.#dynamics.updateRootScale(
				installed.nodeId,
				entity.presentation.objectScale,
			);
			installed.objectScale = entity.presentation.objectScale;
		}
		const identity = entity.physics;
		if (
			!sameDynamicPresentationState(
				installed.presentationStateIdentity,
				identity,
			)
		) {
			this.#dynamics.updatePresentationState(installed.nodeId, {
				cloaked: entity.physics.cloaked,
				hidden: entity.physics.hidden,
				lighting: entity.physics.lighting,
				noDraw: entity.physics.noDraw,
				translucency: entity.physics.translucency,
			});
			installed.presentationStateIdentity = { ...identity };
		}
		const desired = this.#spawnedDesiredEntities.get(entity.identity.guid);
		if (
			desired?.entity.generation === entity.generation &&
			desired.scriptTableId !== undefined
		)
			this.#context.behavior.reconcileIntrinsicHiddenCue(desired);
		this.#dynamics.updateNameplateContent(installed.nodeId, {
			...entity.display,
			...(this.#context.getNameplateDecoration(entity.identity.guid) ?? {
				indicators: [],
				strikeThrough: false,
			}),
		});
		this.#context.behavior.applyDynamicEntityMotion(
			installed,
			entity.motion,
			entity.presentation.entityClass,
			entity.placement,
		);
	}

	#retainSpawnedVisual(
		guid: number,
		entity: DynamicEntityView,
	): Promise<DecodedStaticPresentation> {
		const visualKey = setupVisualKey(
			entity.presentation.content.setupDid,
			entity.presentation.appearance,
		);
		const previousKey = this.#spawnedVisualKeys.get(guid);
		if (previousKey !== undefined && previousKey !== visualKey) {
			this.#releaseSpawnedVisual(guid, previousKey);
		}
		this.#spawnedVisualKeys.set(guid, visualKey);
		return this.#retainSetupVisual(
			`dynamic-entity:${guid}`,
			visualKey,
			entity.presentation.content.setupDid,
			entity.presentation.appearance,
		);
	}

	#retainSetupVisual(
		user: string,
		visualKey: string,
		setupDid: number,
		appearance: SetupVisualAppearance,
	): Promise<DecodedStaticPresentation> {
		const retained = this.#retainedSetupVisuals.get(user);
		if (retained !== undefined) {
			if (retained.visualKey !== visualKey)
				throw new Error(
					`Setup visual user ${user} already retains ${retained.visualKey}.`,
				);
			return retained.completion.then((handle) => handle.asset);
		}
		const completion = this.#presentationAssets.setupVisuals.acquire(
			setupDid,
			appearance,
		);
		const next = { completion, visualKey };
		this.#retainedSetupVisuals.set(user, next);
		return completion
			.then((handle) => handle.asset)
			.catch((cause: unknown) => {
				if (this.#retainedSetupVisuals.get(user) === next)
					this.#retainedSetupVisuals.delete(user);
				throw cause;
			});
	}

	#releaseSpawnedVisual(guid: number, visualKey: string): void {
		this.#releaseSetupVisual(`dynamic-entity:${guid}`, visualKey);
		if (this.#spawnedVisualKeys.get(guid) === visualKey)
			this.#spawnedVisualKeys.delete(guid);
	}

	#releaseSetupVisual(user: string, visualKey: string): void {
		const retained = this.#retainedSetupVisuals.get(user);
		if (retained === undefined) return;
		if (retained.visualKey !== visualKey)
			throw new Error(
				`Setup visual user ${user} retains ${retained.visualKey}, not ${visualKey}.`,
			);
		this.#retainedSetupVisuals.delete(user);
		void retained.completion.then(
			(handle) => handle.release(),
			// Acquisition failure already releases its provisional repository reference and
			// remains observable by the caller awaiting the same completion.
			() => undefined,
		);
	}

	/** Retire an unrealizable scene node without confusing deferred authority with deletion. */
	#retireDeferredDynamicEntity(guid: number): void {
		this.#context.behavior.deleteCueInsertion(guid);
		const installed = this.#spawnedPresentations.get(guid);
		if (installed === undefined) return;
		const desired = this.#spawnedDesiredEntities.get(guid);
		if (desired !== undefined) desired.cueHidden = false;
		this.#retireDynamicOwner(installed.ownerId);
		this.#spawnedPresentations.delete(guid);
		this.#mapEntityRevision += 1;
	}

	/** Retire one installed presentation subtree while preserving every desired child level. */
	#retireDynamicPresentationTree(guid: number): void {
		for (const childGuid of this.#spawnedDesiredChildren.get(guid) ?? [])
			this.#retireDynamicPresentationTree(childGuid);
		this.#retireDeferredDynamicEntity(guid);
	}

	/** Retire only desired world roots made ineligible by an explicit interest replacement. */
	#withdrawOutOfScopeDynamicEntities(): void {
		for (const record of this.#spawnedDesiredEntities.values()) {
			const entity = record.entity;
			if (
				entity.placement.kind !== "world" ||
				this.#isDynamicScopeReady(entity)
			)
				continue;
			this.#deferDynamicEntity(record, {
				kind: "residency",
				residencyKey: dynamicResidencyKey(entity),
			});
			this.#retireDynamicPresentationTree(entity.identity.guid);
		}
	}

	/** Follow attachment ownership to the world root whose scope controls presentation residency. */
	#isDynamicEntityFrontendEvicted(guid: number): boolean {
		const visited = new Set<number>();
		let record = this.#spawnedDesiredEntities.get(guid);
		while (record !== undefined) {
			const currentGuid = record.entity.identity.guid;
			if (visited.has(currentGuid))
				throw new Error(
					`Dynamic entity attachment cycle reached ${formatDynamicGuid(currentGuid)} while resolving entity presentation residency.`,
				);
			visited.add(currentGuid);
			if (record.entity.placement.kind === "world")
				return !this.#isDynamicScopeReady(record.entity);
			record = this.#spawnedDesiredEntities.get(record.entity.placement.parent);
		}
		return false;
	}

	/** Stage every visual and behavior dependency before one dynamic owner can publish. */
	async #prepareDynamicOwner(
		ownerId: DynamicOwnerId,
		sources: readonly PlacedDynamicPresentationSource[],
		objectStateAuthority: "browser" | "world",
		resolveAttachments: (
			nodeIds: readonly SceneNodeId[],
		) => readonly DynamicModelAttachment[],
	) {
		if (this.#context.isDestroyed())
			throw new Error("Cannot prepare dynamics after runtime shutdown.");
		const installation = this.#dynamics.replaceOwner(ownerId, sources);
		const outcome = await installation.ready;
		if (outcome === "superseded")
			throw new Error(`Dynamic owner ${ownerId} preparation was superseded.`);
		const prepared = installation.getPreparedEntities();
		if (isLocalSceneModelOwnerId(ownerId)) {
			for (const { nodeId } of prepared)
				this.#localModelNodeOwners.set(nodeId, ownerId);
		}
		const releaseOwnership = () => {
			for (const { nodeId } of prepared)
				this.#localModelNodeOwners.delete(nodeId);
		};
		let animationStage: ReturnType<
			BehaviorCueAndEffectsCoordinator["animation"]["stageOwner"]
		>;
		try {
			animationStage = this.#context.behavior.animation.stageOwner(
				ownerId,
				prepared.flatMap<AnimationInstallation>(
					({ animation, initialPartToObjectTransforms, nodeId, source }) => {
						const base = {
							initialPartToObjectTransforms,
							target: {
								generation: installation.generation,
								targetId: behaviorTargetId(nodeId),
							},
						};
						if (animation.kind === "sequence")
							return [
								{
									...base,
									kind: "sequence",
									clips: animation.clips,
									firstCyclicClip: animation.firstCyclicClip,
								},
							];
						if (animation.kind === "activatable")
							return [
								{
									...base,
									kind: "default-animation",
									animation: animation.animation,
									residentIdentity: source.identity,
								},
							];
						return [];
					},
				),
			);
		} catch (cause) {
			releaseOwnership();
			installation.release();
			throw cause;
		}
		const scriptSystem =
			objectStateAuthority === "world"
				? this.#context.behavior.worldOwnedPhysicsScriptSystem
				: this.#context.behavior.physicsScriptSystem;
		let scriptStage: ReturnType<
			BehaviorCueAndEffectsCoordinator["worldOwnedPhysicsScriptSystem"]["stageOwner"]
		> | null = null;
		try {
			await this.#context.behavior.stageParticleMeshes(
				prepared.flatMap((entity) => entity.emitters),
			);
			scriptStage = scriptSystem.stageOwner(
				ownerId,
				prepared.flatMap(
					({ nodeId, scriptClosure, animationScriptClosures }) => {
						const defaultRoot =
							scriptClosure !== null &&
							this.#context.behavior.scriptMeshesReady(scriptClosure)
								? scriptClosure
								: null;
						const roots = [
							defaultRoot,
							...animationScriptClosures.filter((graph) =>
								this.#context.behavior.scriptMeshesReady(graph),
							),
						].filter((graph) => graph !== null);
						const [first, ...additionalClosures] = roots;
						return first === undefined
							? []
							: [
									{
										closure: first,
										additionalClosures,
										activation:
											defaultRoot === null
												? ("on-command" as const)
												: ("immediate" as const),
										target: {
											generation: installation.generation,
											targetId: behaviorTargetId(nodeId),
										},
										timeSeconds: this.#context.clock(),
									},
								];
					},
				),
			);
			installation.prepareCommit(
				animationStage.samples,
				resolveAttachments(installation.nodeIds),
			);
		} catch (cause) {
			animationStage.release();
			scriptStage?.release();
			releaseOwnership();
			installation.release();
			throw cause;
		}
		if (scriptStage === null)
			throw new Error("Dynamic script staging completed without a stage.");
		const committedScriptStage = scriptStage;
		const nextTargets = new Set(prepared.map(({ nodeId }) => nodeId));
		let state: "prepared" | "committed" | "released" = "prepared";
		return {
			prepared,
			nodeIds: installation.nodeIds,
			generation: installation.generation,
			commit: () => {
				if (state !== "prepared")
					throw new Error(`Cannot commit dynamic owner in state ${state}.`);
				const previousTargets = this.#dynamicPresentationNodes.get(ownerId);
				// No script or animation can advance between these synchronous commits. Publishing
				// the entity last makes the complete replacement observable as one runtime action.
				animationStage.commit();
				committedScriptStage.commit();
				installation.commit();
				this.#context.behavior.releaseDynamicCueAssets(ownerId);
				if (objectStateAuthority === "world")
					this.#context.behavior.releaseDynamicOverrideEffect(ownerId);
				for (const nodeId of previousTargets ?? []) {
					this.#suppressedParticleRoots.delete(nodeId);
					const targetId = behaviorTargetId(nodeId);
					this.#localModelNodeOwners.delete(nodeId);
					this.#context.behavior.particles.destroy(
						{ generation: 0, targetId },
						0,
					);
					this.#context.deleteTargetSoundTable(targetId);
				}
				for (const entity of prepared) {
					if (entity.soundTable !== null)
						this.#context.setTargetSoundTable(
							behaviorTargetId(entity.nodeId),
							entity.soundTable,
						);
				}
				this.#dynamicPresentationNodes.set(ownerId, nextTargets);
				state = "committed";
			},
			release: () => {
				if (state !== "prepared") return;
				animationStage.release();
				committedScriptStage.release();
				releaseOwnership();
				installation.release();
				state = "released";
			},
		};
	}

	async #prepareStaticAuthoredDynamics(
		ownerId: OwnerId | EnvCellBehaviorOwnerId,
		layer: LandblockLayerKind,
		landblockId: LandblockOwnerId,
		sources: readonly AuthoredDynamicSource[],
	): Promise<StaticLayerCompanionPublication> {
		if (this.#context.isDestroyed())
			throw new Error(
				"Cannot prepare authored dynamics after runtime shutdown.",
			);
		for (const source of sources) {
			if (source.placement.landblockId !== landblockId) {
				throw new Error(
					`Authored dynamic placement belongs to ${source.placement.landblockId}, expected ${landblockId}.`,
				);
			}
		}
		const activation = await this.#prepareDynamicOwner(
			ownerId,
			sources.map(adaptAuthoredDynamicPresentation),
			"browser",
			() => [],
		);
		const diagnostics = activation.prepared.map(
			({ animation, source }): AuthoredDynamicResidentDiagnostic => ({
				blockingHooks:
					animation.kind === "retain-static-presentation"
						? animation.blockingHooks.map((hook) => ({
								animationId: animation.animation.id,
								authoredOrder: hook.authoredOrder,
								command: animationHookCommand(hook),
								frameIndex: hook.frameIndex,
							}))
						: [],
				defaultAnimationId: source.behavior.animationId,
				landblockId,
				layer,
				presentationMode:
					animation.kind === "activatable"
						? "animated"
						: "static-visual-fallback",
				residentId: source.identity,
				setupSourceId: source.setupId,
			}),
		);
		return {
			commit: () => {
				activation.commit();
				this.#context.setAuthoredDynamicResidents(ownerId, diagnostics);
			},
			release: () => {
				activation.release();
			},
		};
	}

	/** Retire every presentation and behavior resource for one exact dynamic owner immediately. */
	#retireDynamicOwner(ownerId: DynamicOwnerId): void {
		const roots = this.#dynamicPresentationNodes.get(ownerId) ?? [];
		this.#dynamicPresentationNodes.delete(ownerId);
		for (const [nodeId, owner] of this.#localModelNodeOwners) {
			if (owner === ownerId) this.#localModelNodeOwners.delete(nodeId);
		}
		const steps: (() => void)[] = [];
		for (const nodeId of roots) {
			this.#suppressedParticleRoots.delete(nodeId);
			const targetId = behaviorTargetId(nodeId);
			this.#context.deleteTargetSoundTable(targetId);
			steps.push(() =>
				this.#context.behavior.particles.destroy(
					{ generation: 0, targetId },
					0,
				),
			);
		}
		completePresentationOperations([
			...steps,
			() => this.#context.behavior.releaseDynamicCueAssets(ownerId),
			() => this.#context.behavior.releaseDynamicOverrideEffect(ownerId),
			() => this.#context.behavior.animation.removeOwner(ownerId),
			() => this.#context.behavior.physicsScriptSystem.removeOwner(ownerId),
			() =>
				this.#context.behavior.worldOwnedPhysicsScriptSystem.removeOwner(
					ownerId,
				),
			() => this.#dynamics.removeOwner(ownerId),
		]);
	}

	/** Wake only desired roots indexed under one newly published static residency fact. */
	#wakeDeferredDynamicResidencies(
		residencyKey: string,
		match: "exact" | "prefix",
	): void {
		const records: DesiredDynamicEntityRecord[] = [];
		for (const [key, guids] of this.#spawnedDeferredResidencies) {
			if (
				(match === "exact" && key !== residencyKey) ||
				(match === "prefix" && !key.startsWith(residencyKey))
			)
				continue;
			for (const guid of guids) {
				const record = this.#spawnedDesiredEntities.get(guid);
				if (record !== undefined) records.push(record);
			}
		}
		if (records.length === 0) return;
		const continuation = Promise.all(
			records.map((record) => this.#realizeAcceptedDynamicEntity(record)),
		).then(() => undefined);
		const guarded = continuation.catch((error: unknown) => {
			this.#context.pushPresentationFailure(error);
		});
		this.#context.trackRealizationContinuation(guarded);
	}
}

/** Compare the immutable setup substitutions without serializing every authoritative tick. */
function sameDynamicVisual(
	a: DynamicEntityView["presentation"],
	b: DynamicEntityView["presentation"],
): boolean {
	if (
		a.content.setupDid !== b.content.setupDid ||
		a.placementFrame !== b.placementFrame ||
		a.appearance.paletteDid !== b.appearance.paletteDid
	)
		return false;
	const aa = a.appearance;
	const bb = b.appearance;
	if (
		aa.subPalettes.length !== bb.subPalettes.length ||
		aa.textureChanges.length !== bb.textureChanges.length ||
		aa.partChanges.length !== bb.partChanges.length
	)
		return false;
	for (let index = 0; index < aa.subPalettes.length; index += 1) {
		const left = aa.subPalettes[index];
		const right = bb.subPalettes[index];
		if (
			left.paletteDid !== right.paletteDid ||
			left.offset !== right.offset ||
			left.colorCount !== right.colorCount
		)
			return false;
	}
	for (let index = 0; index < aa.textureChanges.length; index += 1) {
		const left = aa.textureChanges[index];
		const right = bb.textureChanges[index];
		if (
			left.partIndex !== right.partIndex ||
			left.oldTextureDid !== right.oldTextureDid ||
			left.newTextureDid !== right.newTextureDid
		)
			return false;
	}
	for (let index = 0; index < aa.partChanges.length; index += 1) {
		const left = aa.partChanges[index];
		const right = bb.partChanges[index];
		if (
			left.partIndex !== right.partIndex ||
			left.gfxObjDid !== right.gfxObjDid
		)
			return false;
	}
	return true;
}

/** Retain a stable visual identity without copying frame-rate pose or physics fields. */
function snapshotDynamicVisual(
	presentation: DynamicEntityView["presentation"],
): DynamicEntityView["presentation"] {
	const appearance = presentation.appearance;
	return {
		...presentation,
		content: { ...presentation.content },
		appearance: {
			paletteDid: appearance.paletteDid,
			subPalettes: appearance.subPalettes.map((part) => ({ ...part })),
			textureChanges: appearance.textureChanges.map((part) => ({ ...part })),
			partChanges: appearance.partChanges.map((part) => ({ ...part })),
		},
	};
}

/** World pose changes require travel; membership can refresh while a body is stationary. */
function sameDynamicPath(
	left: DynamicEntityView["placement"],
	right: DynamicEntityView["placement"],
): boolean {
	if (left.kind !== right.kind) return false;
	if (left.kind === "attached")
		return (
			right.kind === "attached" &&
			left.parent === right.parent &&
			left.parentLocation === right.parentLocation &&
			left.placement === right.placement
		);
	if (right.kind !== "world") return false;
	const a = left.pose;
	const b = right.pose;
	return (
		a.landblockId === b.landblockId &&
		a.coords.x === b.coords.x &&
		a.coords.y === b.coords.y &&
		a.coords.z === b.coords.z &&
		a.rotation.w === b.rotation.w &&
		a.rotation.x === b.rotation.x &&
		a.rotation.y === b.rotation.y &&
		a.rotation.z === b.rotation.z
	);
}

/** Contact and simulation mode do not change scene placement or path ownership. */
function sameDynamicPlacement(
	left: DynamicEntityView["placement"],
	right: DynamicEntityView["placement"],
): boolean {
	if (!sameDynamicPath(left, right)) return false;
	if (left.kind === "attached") return true;
	if (right.kind !== "world") return false;
	const a = left.spatialMembership;
	const b = right.spatialMembership;
	if (
		a.reachesOutdoors !== b.reachesOutdoors ||
		a.reachedEnvCellIds.length !== b.reachedEnvCellIds.length
	)
		return false;
	for (let index = 0; index < a.reachedEnvCellIds.length; index += 1)
		if (a.reachedEnvCellIds[index] !== b.reachedEnvCellIds[index]) return false;
	return true;
}

/** Retain only the placement shape used by path and membership comparisons. */
function snapshotDynamicPlacement(
	placement: DynamicEntityView["placement"],
): DynamicEntityView["placement"] {
	if (placement.kind === "attached") return { ...placement };
	return {
		...placement,
		pose: {
			...placement.pose,
			coords: { ...placement.pose.coords },
			rotation: { ...placement.pose.rotation },
		},
		spatialMembership: {
			...placement.spatialMembership,
			reachedEnvCellIds: [...placement.spatialMembership.reachedEnvCellIds],
		},
	};
}

/** Only fields consumed by dynamic presentation contribute to this level. */
function sameDynamicPresentationState(
	left: DynamicEntityView["physics"],
	right: DynamicEntityView["physics"],
): boolean {
	return (
		left.cloaked === right.cloaked &&
		left.hidden === right.hidden &&
		left.lighting === right.lighting &&
		left.noDraw === right.noDraw &&
		left.translucency === right.translucency
	);
}

/** Resident scope that can wake one deferred world-root entity. */
function dynamicResidencyKey(entity: DynamicEntityView): string {
	if (entity.placement.kind !== "world") {
		throw new Error(
			`Attached dynamic entity ${formatDynamicGuid(entity.identity.guid)} has no residency key.`,
		);
	}
	const cellId = entity.placement.pose.landblockId >>> 0;
	const landblockId = datAssetId((cellId & 0xffff_0000) | 0xffff);
	return (cellId & 0xffff) >= 0x0100
		? `${landblockId}:env-cell:${datAssetId(cellId)}`
		: `${landblockId}:outdoor`;
}

function formatDynamicGuid(guid: number): string {
	return `0x${(guid >>> 0).toString(16).padStart(8, "0")}`;
}

function dynamicEntityPresentationFailure(
	entity: DynamicEntityView,
	cause: unknown,
): Error {
	const subject = `Dynamic entity ${formatDynamicGuid(entity.identity.guid)} generation ${entity.generation}`;
	const reason = cause instanceof Error ? cause.message : String(cause);
	return new Error(`${subject} presentation refused: ${reason}`, { cause });
}

/** Resolve the requested appearance against the body that actually owns this incarnation. */
function dynamicBodyDisposition(
	record: DesiredDynamicEntityRecord,
	installed: DynamicEntityPresentationRecord | undefined,
): DynamicEntityRealizationDisposition {
	const sameGeneration = installed?.generation === record.entity.generation;
	if (sameGeneration && installed.visualKey === record.visualKey)
		return "installed";
	if (record.realization.kind !== "unavailable") return "deferred";
	return sameGeneration ? "retained" : "unavailable";
}
