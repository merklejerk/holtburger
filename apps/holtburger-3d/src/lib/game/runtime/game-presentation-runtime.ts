import type { DistantAnimationSamplingPolicy } from "../../frontend-tuning-contract";
import type { RuntimeLight } from "../environment/runtime-lights";
import type { CombatEffectsTuning } from "../systems/combat-effects-system";
import type {
	CombatEffectOutcome,
	CombatEffectsAppearance,
} from "../systems/combat-effects-system";
import type { SetupSidewaysSpan } from "../resolution/presentation";
import type { SkySourcePresentations } from "../../assets/decode-sky-record";
import type { CommitPipeline } from "../commit/types";
import type { StaticObjectLayerArtifact } from "../commit/artifacts";
import { GeometryManager } from "../geometry/geometry-manager";
import type { BakedDrawMergeCensus } from "../renderer/baked-draw-merge-census";
import {
	type FrameSettings,
	type Renderer,
	type RendererFrameDiagnosticsSnapshot,
	type WorldIndicatorInput,
} from "../renderer/renderer";
import type { EntityOverlayFrame } from "../renderer/entity-overlay-policy";
import type { RenderExtent } from "../renderer/render-extent";
import type { RenderWorld } from "../renderer/render-world";
import type { RendererResourceManager } from "../renderer/resource-manager";
import type { ClosedWorkerPoolDiagnostics } from "../workers/closed-worker";
import type { ClosedWorkerPort } from "../workers/closed-worker";
import {
	SceneGraph,
	type ScenePlacement,
	type ScenePointResidencyCandidates,
	type SceneResidency,
	type SceneSpatialPlacement,
	type ResolvedSceneOrigin,
} from "../scene";
import type { TerrainGenerator } from "../terrain/terrain-generator";
import { WorkerTerrainGenerator } from "../terrain/terrain-worker-client";
import type { PresentationAssetService } from "./presentation-asset-service";
import type { MapGeometryStore } from "../map/map-geometry-store";
import type { AABB3, Vec3 } from "../math/types";
import type { InstalledTerrain } from "../terrain/terrain-system";
import type { TerrainSurfaceSample } from "../terrain/terrain-surface";
import type { LocalSceneModelHandle } from "./local-scene-model";
import type { EntitySelectionGeometry } from "../selection/entity-selection-intersection";
import type { EntitySelectionBounds } from "../selection/entity-selection-bounds";
import type { PhysicsScriptTableSource } from "../../assets/physics-script-table-source";
import type { ParticleMeshSource } from "../../assets/particle-mesh-source";
import type { SoundTableSource } from "../../assets/sound-table-source";
import type {
	PortalTransitionAssets,
	PortalTransitionAudio,
} from "../../client/portal-transition-assets";
import type {
	PortalTransitionPresentationPlan,
	PortalTransitionPresentationReceipt,
} from "../../client/portal-transition-presentation";
import type { AmbientRegionFacts } from "../systems/ambient-region";
import type { UniformRoll } from "../systems/particle-system";
import type { AudioDevice, AudioSettings } from "../systems/audio-system";
import {
	TextureManager,
	type TexturePageId,
} from "../textures/texture-manager";
import { ResidentTextureAtlas } from "../textures/atlas/resident-texture-atlas";
import type { Texture2DResourceKey } from "../renderer/resource-manager";
import type { TexturePreparer } from "../textures/texture-preparer";
import { AtlasLayoutWorkerPool } from "../textures/atlas/layout-worker";
import { AtlasPageBuildWorkerPool } from "../textures/atlas/page-build-worker";
import { StaticObjectGeometryWorker } from "../commit/static-object-geometry-worker-client";
import type { StaticLayerGeometryPreparer } from "./static-layer-realizer";
import type { OwnerId, ResourceOwnerId } from "./owner-ids";
import type { ActiveRegionStaticDetailBinding } from "../resolution/active-region-static-detail";
import type { ResolvedStaticObjectLayerSource } from "../resolution/landblock-layer";
import type {
	DynamicEntityRealizationDisposition,
	DynamicEntityRealizationResults,
} from "./dynamic-entity-presentation";
import type { DynamicPresentationOverride } from "./dynamic-presentation-override";
import type {
	DynamicEntityTickBatch,
	DynamicEntityView,
} from "./dynamic-entity-feed";
import type { NameplateContent } from "../systems/dynamic-presentation-source";
import type { SceneInterestMap, SceneInterestRequest } from "./scene-interest";
import type { SceneInterestMembership } from "./render-scene-interest-controller";
import type { ResolvedSceneInterestTarget } from "./scene-target";
import type { AudioListenerPlacement, PrimaryCameraView } from "./types";
import type { PresentationProfile } from "./presentation-profiler";
import type {
	SceneActivationReceipt,
	SceneActivationRequest,
	SceneActivationStatus,
	SceneAvailabilityListener,
	SceneInterestReceipt,
} from "./scene-availability";
import type { ResolvedSceneEnvironment } from "../environment/scene-environment";
import type { TerrainFogCoverage } from "../environment/terrain-fog";
import type {
	SummonFlickerTuning,
	SummonLeashTuning,
	SummonVisualLevel,
} from "./summon-presentation";
import {
	BehaviorCueAndEffectsCoordinator,
	RETAIL_HIDDEN_PHYSICS_SCRIPT_CUE,
	RETAIL_UNHIDE_PHYSICS_SCRIPT_CUE,
	type DynamicEntityScriptCue,
	type DynamicEntitySoundCue,
} from "./runtime-behavior-effects";
import {
	FramePresentationCoordinator,
	type DynamicEntityPresentationFrame,
	type DynamicEntityPresentationState,
	type PortalTransitionRuntimeDiagnostics,
} from "./runtime-frame-presentation";
import { SpatialAudioAndAmbientCoordinator } from "./runtime-spatial-audio";
import { SpawnedEntityLifecycleCoordinator } from "./runtime-spawned-entities";
import {
	InlineStaticObjectGeometryPreparer,
	RuntimeStaticObjectGeometryPreparer,
	StaticSceneStreamingCoordinator,
} from "./runtime-static-streaming";
import {
	RuntimeTelemetryAndLifecycle,
	type AuthoredDynamicResidentDiagnostic,
	type StaticObjectLayerRuntimeDiagnostics,
	type StaticObjectRuntimeDiagnostics,
} from "./runtime-telemetry-lifecycle";

export {
	RETAIL_HIDDEN_PHYSICS_SCRIPT_CUE,
	RETAIL_UNHIDE_PHYSICS_SCRIPT_CUE,
	type AuthoredDynamicResidentDiagnostic,
	type DynamicEntityPresentationFrame,
	type DynamicEntityPresentationState,
	type DynamicEntityScriptCue,
	type DynamicEntitySoundCue,
	type PortalTransitionRuntimeDiagnostics,
	type StaticObjectLayerRuntimeDiagnostics,
	type StaticObjectRuntimeDiagnostics,
};

/** Runtime-owned collaborators that tests may replace with focused fakes. */
export interface GamePresentationRuntimeDependencies {
	readonly physicsScriptTableSource: PhysicsScriptTableSource;
	readonly audioDevice: AudioDevice;
	readonly soundTableSource: SoundTableSource;
	readonly particleMeshSource: ParticleMeshSource;
	/** Borrowed CPU preparation; composition destroys it after all presentations retire. */
	readonly presentationAssets: PresentationAssetService;
	readonly terrainGenerator: TerrainGenerator;
	readonly staticGeometryPreparer: StaticLayerGeometryPreparer<
		ResolvedStaticObjectLayerSource,
		StaticObjectLayerArtifact | null,
		OwnerId
	>;
	/** Mode-owned initial display policy; shared runtime behavior never chooses a frontend look. */
	readonly frameSettings: FrameSettings;
	/**
	 * Uniform [0, 1) source for authored randomness, defaulting to `Math.random`.
	 *
	 * Injectable so a diagnostic harness can make particle emission reproducible. Without a seed,
	 * two runs of the same build differ enough that screenshots cannot resolve a rendering change.
	 */
	readonly roll?: UniformRoll;
}

/** Browser worker constructors replaceable by Node integration tests without inline algorithms. */
export interface GamePresentationRuntimeWorkerFactories {
	readonly createTerrainWorker: () => ClosedWorkerPort;
}

/** Device boundary used by runtime to construct its private renderer facade. */
export interface GamePresentationRuntimeRenderDevice {
	readonly resources: RendererResourceManager;
	buildRenderer(world: RenderWorld): Promise<Renderer>;
}

/** Bridges source commits, scene topology, runtime residency, and frontend frame state. */
export class GamePresentationRuntime {
	/** Canonical scene topology, residency, transforms, and spatial-query membership. */
	readonly #scene = new SceneGraph();
	/** Logical geometry bindings and shared owner retention. */
	readonly #geometry: GeometryManager<ResourceOwnerId>;
	/** Shared source preparer consumed by both generic textures and resident atlas. */
	readonly #texturePreparer: TexturePreparer;
	/** Packed object-atlas authority injected into the generic texture facade. */
	readonly #residentAtlas: ResidentTextureAtlas<ResourceOwnerId>;
	/** Logical texture preparation, device bindings, and shared owner retention. */
	readonly #textures: TextureManager<ResourceOwnerId>;
	/** Narrow CPU preparation lifetime, borrowed from composition or owned by standalone builds. */
	readonly #presentationAssets: PresentationAssetService;
	readonly #telemetry: RuntimeTelemetryAndLifecycle;
	readonly #audio: SpatialAudioAndAmbientCoordinator;
	readonly #behaviorEffects: BehaviorCueAndEffectsCoordinator;
	readonly #spawnedEntities: SpawnedEntityLifecycleCoordinator;
	readonly #staticStreaming: StaticSceneStreamingCoordinator;
	readonly #framePresentation: FramePresentationCoordinator;

	protected constructor(
		renderResources: RendererResourceManager,
		commitPipeline: CommitPipeline,
		dependencies: GamePresentationRuntimeDependencies,
	) {
		this.#presentationAssets = dependencies.presentationAssets;
		this.#texturePreparer = this.#presentationAssets.texturePreparer;
		this.#geometry = new GeometryManager<ResourceOwnerId>(renderResources);
		this.#residentAtlas = new ResidentTextureAtlas<ResourceOwnerId>(
			this.#texturePreparer,
			typeof Worker === "undefined"
				? null
				: {
						layoutPlanner: new AtlasLayoutWorkerPool({
							createWorker: () =>
								new Worker(
									new URL(
										"../textures/atlas/layout-worker.entry.ts",
										import.meta.url,
									),
									{ type: "module" },
								) as unknown as ClosedWorkerPort,
							workerCount: 1,
						}),
						pageBuilder: new AtlasPageBuildWorkerPool({
							createWorker: () =>
								new Worker(
									new URL(
										"../textures/atlas/page-build-worker.entry.ts",
										import.meta.url,
									),
									{ type: "module" },
								) as unknown as ClosedWorkerPort,
							workerCount: 2,
						}),
						renderResources,
						// Changed retained resources or placements invalidate compiled bindings.
						// The renderer may not exist yet during early
						// content load; it holds nothing to invalidate until it does.
						onRetainedBindingsChanged: () =>
							this.#framePresentation.invalidateResolvedResources(
								"atlas-publication",
							),
					},
		);
		this.#textures = new TextureManager<ResourceOwnerId>(
			renderResources,
			this.#texturePreparer,
			this.#residentAtlas,
		);
		this.#telemetry = new RuntimeTelemetryAndLifecycle();
		this.#audio = new SpatialAudioAndAmbientCoordinator({
			audioDevice: dependencies.audioDevice,
			soundTableSource: dependencies.soundTableSource,
			roll: dependencies.roll,
			clock: () => this.#framePresentation.lastFrameTimeSeconds,
			isDestroyed: () => this.#telemetry.destroyed,
			onContentFailure: (error) => this.#telemetry.reportContentFailure(error),
			onPresentationFailure: (cause) =>
				this.#telemetry.pushPresentationFailure(cause),
			originOf: (target) => this.#behaviorEffects.originOf(target),
			hasSkyTarget: (targetId) => this.#behaviorEffects.hasSkyTarget(targetId),
			localModelOwnerForNode: (nodeId) =>
				this.#spawnedEntities.getLocalModelOwnerForNode(nodeId),
			resolvedSceneTarget: () => this.#staticStreaming.resolvedSceneTarget(),
			getTerrainInstallationRevision: () =>
				this.#staticStreaming.terrainInstallationRevision,
			listInstalledTerrain: () => this.#staticStreaming.listInstalledTerrain(),
			getEnvCellSeenOutside: (envCellId) =>
				this.#scene.getEnvCellSeenOutside(envCellId),
		});
		this.#behaviorEffects = new BehaviorCueAndEffectsCoordinator({
			scene: this.#scene,
			presentationAssets: this.#presentationAssets,
			physicsScriptTableSource: dependencies.physicsScriptTableSource,
			particleMeshSource: dependencies.particleMeshSource,
			roll: dependencies.roll,
			clock: () => this.#framePresentation.lastFrameTimeSeconds,
			isDestroyed: () => this.#telemetry.destroyed,
			reportContentFailure: (error) =>
				this.#telemetry.reportContentFailure(error),
			pushPresentationFailure: (cause) =>
				this.#telemetry.pushPresentationFailure(cause),
			trackRealizationContinuation: (continuation) =>
				this.#telemetry.trackRealizationContinuation(continuation),
			createBehaviorAudioCommands: () =>
				this.#audio.createBehaviorAudioCommands(),
			playSoundTableKey: (target, soundType, packet) =>
				this.#audio.playSoundTableKey(target, soundType, packet),
			isAudioListenerEnabled: () => this.#audio.listenerEnabled,
			installParticleMeshes: async (batch) => {
				await this.#framePresentation.renderer?.particles?.install(
					batch,
					this.#texturePreparer,
				);
			},
			getCameraPosition: () => this.#framePresentation.cameraPosition,
			getProtectedEntityGuids: () =>
				this.#framePresentation.protectedEntityGuids,
			getDynamics: () => this.#spawnedEntities.dynamics,
			isParticleRootSuppressed: (root) =>
				this.#spawnedEntities.isParticleRootSuppressed(root),
			getDesiredEntity: (guid) => this.#spawnedEntities.getDesiredEntity(guid),
			getInstalledPresentation: (guid) =>
				this.#spawnedEntities.getInstalledPresentation(guid),
			getDesiredChildren: (guid) =>
				this.#spawnedEntities.getDesiredChildren(guid),
			getRendererCombatEffects: () =>
				this.#framePresentation.renderer?.combatEffects,
		});
		this.#spawnedEntities = new SpawnedEntityLifecycleCoordinator({
			scene: this.#scene,
			geometry: this.#geometry,
			residentAtlas: this.#residentAtlas,
			presentationAssets: this.#presentationAssets,
			soundTables: this.#audio.soundTables,
			behavior: this.#behaviorEffects,
			clock: () => this.#framePresentation.lastFrameTimeSeconds,
			isDestroyed: () => this.#telemetry.destroyed,
			getPresentationProfiler: () => this.#telemetry.presentationProfiler,
			reportContentFailure: (error) =>
				this.#telemetry.reportContentFailure(error),
			pushPresentationFailure: (cause) =>
				this.#telemetry.pushPresentationFailure(cause),
			trackRealizationContinuation: (continuation) =>
				this.#telemetry.trackRealizationContinuation(continuation),
			setAuthoredDynamicResidents: (ownerId, diagnostics) =>
				this.#telemetry.setAuthoredDynamicResidents(ownerId, diagnostics),
			setTargetSoundTable: (targetId, soundTable) =>
				this.#audio.setTargetSoundTable(targetId, soundTable),
			deleteTargetSoundTable: (targetId) =>
				this.#audio.deleteTargetSoundTable(targetId),
			retainDynamicAppearance: (layout, appearance) => {
				const renderer = this.#framePresentation.renderer;
				if (renderer === null)
					throw new Error(
						"Cannot prepare a dynamic appearance before renderer initialization.",
					);
				return renderer.retainDynamicAppearance(layout, appearance);
			},
			isScopeReadyInInterest: (placement) =>
				this.#staticStreaming.containsInterest(placement),
			hasInstalledTerrainSource: (landblockId) =>
				this.#staticStreaming.hasInstalledTerrainSource(landblockId),
			getNameplateDecoration: (guid) =>
				this.#framePresentation.getNameplateDecoration(guid),
			deleteNameplateDecoration: (guid) =>
				this.#framePresentation.deleteNameplateDecoration(guid),
			usesSelectionSphereProxy: (nodeId) =>
				this.#framePresentation.usesSelectionSphereProxy(nodeId),
		});
		this.#staticStreaming = new StaticSceneStreamingCoordinator({
			scene: this.#scene,
			geometry: this.#geometry,
			textures: this.#textures,
			residentAtlas: this.#residentAtlas,
			texturePreparer: this.#texturePreparer,
			commitPipeline,
			terrainGenerator: dependencies.terrainGenerator,
			staticGeometryPreparer: dependencies.staticGeometryPreparer,
			isDestroyed: () => this.#telemetry.destroyed,
			trackPresentationWork: (work) =>
				this.#telemetry.trackPresentationWork(work),
			trackRealizationContinuation: (continuation) =>
				this.#telemetry.trackRealizationContinuation(continuation),
			recordStaticLayerPublication: () =>
				this.#telemetry.recordStaticLayerPublication(),
			recordTextureFactCollection: (durationMs) =>
				this.#telemetry.recordTextureFactCollection(durationMs),
			setStaticObjectLayerDiagnostics: (ownerId, diagnostics) =>
				this.#telemetry.setStaticObjectLayerDiagnostics(ownerId, diagnostics),
			hasStaticObjectLayerDiagnostics: (ownerId) =>
				this.#telemetry.hasStaticObjectLayerDiagnostics(ownerId),
			setEnvCellLayerDiagnostics: (ownerId, diagnostics) =>
				this.#telemetry.setEnvCellLayerDiagnostics(ownerId, diagnostics),
			hasEnvCellLayerDiagnostics: (ownerId) =>
				this.#telemetry.hasEnvCellLayerDiagnostics(ownerId),
			clearLayerDiagnostics: (ownerId) =>
				this.#telemetry.clearLayerDiagnostics(ownerId),
			deleteAuthoredDynamicResidents: (ownerId) =>
				this.#telemetry.deleteAuthoredDynamicResidents(ownerId),
			withdrawOutOfScopeDynamicEntities: () =>
				this.#spawnedEntities.withdrawOutOfScopeDynamicEntities(),
			wakeDeferredDynamicResidencies: (residencyKey, match) =>
				this.#spawnedEntities.wakeDeferredDynamicResidencies(
					residencyKey,
					match,
				),
			prepareStaticAuthoredDynamics: (ownerId, layer, landblockId, sources) =>
				this.#spawnedEntities.prepareStaticAuthoredDynamics(
					ownerId,
					layer,
					landblockId,
					sources,
				),
			retireDynamicOwner: (ownerId) =>
				this.#spawnedEntities.retireDynamicOwner(ownerId),
			invalidateResolvedResources: (reason) =>
				this.#framePresentation.invalidateResolvedResources(reason),
		});
		this.#framePresentation = new FramePresentationCoordinator({
			scene: this.#scene,
			geometry: this.#geometry,
			textures: this.#textures,
			texturePreparer: this.#texturePreparer,
			frameSettings: dependencies.frameSettings,
			oceanBackdrop: this.#staticStreaming.oceanBackdrop,
			dynamics: this.#spawnedEntities.dynamics,
			envCells: this.#staticStreaming.envCells,
			staticObjects: this.#staticStreaming.staticObjects,
			terrain: this.#staticStreaming.terrain,
			outdoorLights: this.#staticStreaming.outdoorLights,
			getDetailBinding: (role) => this.#staticStreaming.getDetailBinding(role),
			objectVisualTemplates: this.#spawnedEntities.objectVisualTemplates,
			particles: this.#behaviorEffects.particles,
			isDestroyed: () => this.#telemetry.destroyed,
			triggerListenerLockedSound: (soundId, volume, probability) =>
				this.#audio.triggerListenerLocked(soundId, volume, probability),
			getDesiredEntity: (guid) => this.#spawnedEntities.getDesiredEntity(guid),
			getInstalledPresentation: (guid) =>
				this.#spawnedEntities.getInstalledPresentation(guid),
			getDesiredChildren: (guid) =>
				this.#spawnedEntities.getDesiredChildren(guid),
			isEntityFrontendEvicted: (guid) =>
				this.#spawnedEntities.isEntityFrontendEvicted(guid),
			getSpawnedEntityPlacement: (guid) =>
				this.#spawnedEntities.spawnedEntityPlacement(guid),
		});
	}

	/** Construct production runtime workers and inject them into runtime-owned systems. */
	static async build(
		device: GamePresentationRuntimeRenderDevice,
		commitPipeline: CommitPipeline,
		presentationAssets: PresentationAssetService,
		physicsScriptTableSource: PhysicsScriptTableSource,
		audioDevice: AudioDevice,
		soundTableSource: SoundTableSource,
		particleMeshSource: ParticleMeshSource,
		frameSettings: FrameSettings,
		roll?: UniformRoll,
		workerFactories?: GamePresentationRuntimeWorkerFactories,
	): Promise<GamePresentationRuntime> {
		const terrainGenerator = await (workerFactories === undefined
			? WorkerTerrainGenerator.build()
			: new WorkerTerrainGenerator({
					createWorker: workerFactories.createTerrainWorker,
				}));
		const runtime = new GamePresentationRuntime(
			device.resources,
			commitPipeline,
			{
				audioDevice,
				physicsScriptTableSource,
				particleMeshSource,
				frameSettings,
				presentationAssets,
				roll,
				soundTableSource,
				staticGeometryPreparer:
					typeof Worker === "undefined"
						? new InlineStaticObjectGeometryPreparer()
						: new RuntimeStaticObjectGeometryPreparer(
								StaticObjectGeometryWorker.build(),
							),
				terrainGenerator,
			},
		);
		try {
			runtime.#framePresentation.setRenderer(
				await device.buildRenderer(runtime.#framePresentation.renderWorld),
			);
		} catch (cause) {
			// Construction has not published the runtime to composition yet; retire its
			// workers/residency here while leaving borrowed CPU assets with their owner.
			try {
				await runtime.destroy();
			} catch (releaseCause) {
				throw new AggregateError(
					[cause, releaseCause],
					"Runtime renderer construction and rollback failed.",
					{ cause: releaseCause },
				);
			}
			throw cause;
		}
		return runtime;
	}

	/** Construct runtime from explicit ports for focused integration tests. */
	static buildForTesting(
		renderResources: RendererResourceManager,
		commitPipeline: CommitPipeline,
		dependencies: GamePresentationRuntimeDependencies,
	): GamePresentationRuntime {
		return new GamePresentationRuntime(
			renderResources,
			commitPipeline,
			dependencies,
		);
	}

	replaceDynamicEntitySnapshot(
		entities: readonly DynamicEntityView[],
	): Promise<DynamicEntityRealizationResults> {
		return this.#spawnedEntities.replaceDynamicEntitySnapshot(entities);
	}

	upsertDynamicEntity(
		entity: DynamicEntityView,
	): Promise<DynamicEntityRealizationDisposition> {
		return this.#spawnedEntities.upsertDynamicEntity(entity);
	}

	setDynamicPresentationOverride(
		level: DynamicPresentationOverride | null,
	): Promise<void> {
		return this.#spawnedEntities.setDynamicPresentationOverride(level);
	}

	dynamicEntityBodyFailure(guid: number): Error | null {
		return this.#spawnedEntities.dynamicEntityBodyFailure(guid);
	}

	removeDynamicEntity(guid: number, generation: number): void {
		this.#spawnedEntities.removeDynamicEntity(guid, generation);
	}

	setSummonVisuals(
		levels: readonly SummonVisualLevel[],
		tuning: {
			readonly leash: SummonLeashTuning;
			readonly flicker: SummonFlickerTuning;
		},
	): void {
		this.#framePresentation.setSummonVisuals(levels, tuning);
	}

	setDynamicEntityNameplateDecoration(
		guid: number,
		decoration: Pick<
			NameplateContent,
			"indicators" | "strikeThrough" | "nameColor"
		>,
	): void {
		this.#framePresentation.setDynamicEntityNameplateDecoration(
			guid,
			decoration,
		);
	}

	setEntityOverlayFrame(frame: EntityOverlayFrame): void {
		this.#framePresentation.setEntityOverlayFrame(frame);
	}

	playDynamicEntityScriptCue(cue: DynamicEntityScriptCue): void {
		this.#behaviorEffects.playDynamicEntityScriptCue(cue);
	}

	playDynamicEntitySoundCue(
		cue: DynamicEntitySoundCue,
		receivedAtMs: number,
	): void {
		this.#behaviorEffects.playDynamicEntitySoundCue(cue, receivedAtMs);
	}

	clearDynamicEntityCues(): void {
		this.#behaviorEffects.clearDynamicEntityCues();
	}

	reevaluateDynamicEntityEligibility(): Promise<DynamicEntityRealizationResults> {
		return this.#spawnedEntities.reevaluateDynamicEntityEligibility();
	}

	activateScene(
		request: SceneActivationRequest,
	): Promise<SceneActivationReceipt> {
		return this.#staticStreaming.activateScene(request);
	}

	sceneActivationStatus(
		receipt: SceneActivationReceipt,
	): SceneActivationStatus {
		return this.#staticStreaming.sceneActivationStatus(receipt);
	}

	completeSceneActivation(generation: number): void {
		this.#staticStreaming.completeSceneActivation(generation);
	}

	sceneInterestMembership(): SceneInterestMembership {
		return this.#staticStreaming.sceneInterestMembership();
	}

	applyDynamicEntityTick(
		batch: DynamicEntityTickBatch,
		receivedAtMs: number,
	): void {
		this.#spawnedEntities.applyDynamicEntityTick(batch, receivedAtMs);
	}

	updateSceneInterest(request: SceneInterestRequest): SceneInterestReceipt {
		return this.#staticStreaming.updateSceneInterest(request);
	}

	clearSceneInterest(): SceneInterestReceipt {
		return this.#staticStreaming.clearSceneInterest();
	}

	sceneInterestState(): {
		readonly interest: SceneInterestMap;
		readonly resolvedTarget: ResolvedSceneInterestTarget | null;
	} {
		return this.#staticStreaming.sceneInterestState();
	}

	terrainFogCoverage(): TerrainFogCoverage | null {
		return this.#staticStreaming.terrainFogCoverage();
	}

	subscribeSceneAvailability(listener: SceneAvailabilityListener): () => void {
		return this.#staticStreaming.subscribeSceneAvailability(listener);
	}

	reportContentFailure(error: Error): void {
		this.#telemetry.reportContentFailure(error);
	}

	subscribeContentFailures(listener: (error: Error) => void): () => void {
		return this.#telemetry.subscribeContentFailures(listener, [
			this.#spawnedEntities.animationAssets,
			this.#behaviorEffects.physicsScripts,
			this.#behaviorEffects.particleEmitters,
			this.#behaviorEffects.physicsScriptTables,
			this.#audio.soundTables,
		]);
	}

	retryContentFailures(): void {
		this.#presentationAssets.retryFailed();
		this.#audio.retryFailed();
		this.#behaviorEffects.retryFailed();
		this.#telemetry.clearContentFailures();
		this.#spawnedEntities.resetUnavailableRealizations();
		this.#framePresentation.resetUnavailablePortalAssets();
	}

	setAudioListener(placement: AudioListenerPlacement | null): void {
		this.#audio.setAudioListener(placement);
	}

	installAmbientRegion(facts: AmbientRegionFacts): Promise<void> {
		return this.#audio.installAmbientRegion(facts);
	}

	setAudioSettings(settings: AudioSettings): void {
		this.#audio.setAudioSettings(settings);
	}

	resolveViewportExtent(cssWidth: number, cssHeight: number): RenderExtent {
		return this.#framePresentation.resolveViewportExtent(cssWidth, cssHeight);
	}

	setPresentationLights(lights: readonly RuntimeLight[]): void {
		this.#framePresentation.setPresentationLights(lights);
	}

	setPrimaryView(view: PrimaryCameraView): void {
		this.#framePresentation.setPrimaryView(view);
	}

	setWorldIndicator(indicator: WorldIndicatorInput | null): void {
		this.#framePresentation.setWorldIndicator(indicator);
	}

	setSceneEnvironment(environment: ResolvedSceneEnvironment): void {
		this.#framePresentation.setSceneEnvironment(environment);
	}

	installSky(source: SkySourcePresentations): Promise<void> {
		return this.#framePresentation.installSky(source);
	}

	setFrameSettings(settings: FrameSettings): void {
		this.#framePresentation.setFrameSettings(settings);
	}

	setPortalTransition(
		transition: PortalTransitionPresentationPlan | undefined,
	): void {
		this.#framePresentation.setPortalTransition(transition);
	}

	playPortalTransitionSound(kind: "enter" | "exit"): void {
		this.#framePresentation.playPortalTransitionSound(kind);
	}

	updatePortalTransitionAudio(audio: PortalTransitionAudio): void {
		this.#framePresentation.updatePortalTransitionAudio(audio);
	}

	installPortalTransitionAssets(
		assets: PortalTransitionAssets | null,
	): Promise<void> {
		return this.#framePresentation.installPortalTransitionAssets(assets);
	}

	setViewerEntity(guid: number | null): void {
		this.#framePresentation.setViewerEntity(guid);
	}

	setSelectedEntityGuid(guid: number | null): void {
		this.#framePresentation.setSelectedEntityGuid(guid);
	}

	setHoveredEntityGuid(guid: number | null): void {
		this.#framePresentation.setHoveredEntityGuid(guid);
	}

	dynamicEntityPresentationState(guid: number): DynamicEntityPresentationState {
		return this.#framePresentation.dynamicEntityPresentationState(guid);
	}

	setOffscreenAnimationSampleIntervalSeconds(intervalSeconds: number): void {
		this.#behaviorEffects.setOffscreenAnimationSampleIntervalSeconds(
			intervalSeconds,
		);
	}

	setDistantAnimationSampling(
		policy: DistantAnimationSamplingPolicy | null,
	): void {
		this.#behaviorEffects.setDistantAnimationSampling(policy);
	}

	getRendererFrameDiagnostics(): RendererFrameDiagnosticsSnapshot | null {
		return this.#framePresentation.getRendererFrameDiagnostics();
	}

	getTerrainWorkerDiagnostics(): ClosedWorkerPoolDiagnostics {
		return this.#staticStreaming.getTerrainWorkerDiagnostics();
	}

	setFrameProfilingEnabled(enabled: boolean): void {
		this.#telemetry.setFrameProfilingEnabled(
			enabled,
			this.#framePresentation.renderer,
		);
	}

	resetFrameProfile(): void {
		this.#telemetry.resetFrameProfile(this.#framePresentation.renderer);
	}

	captureBakedDrawMergeCensus(): Promise<BakedDrawMergeCensus> {
		return this.#framePresentation.captureBakedDrawMergeCensus();
	}

	getAuthoredDynamicResidentDiagnostics(): readonly AuthoredDynamicResidentDiagnostic[] {
		return this.#telemetry.getAuthoredDynamicResidentDiagnostics();
	}

	getAuthoredDynamicRuntimeDiagnostics() {
		const behaviorDiagnostics = this.#behaviorEffects.getDiagnostics();
		const audioDiagnostics = this.#audio.getDiagnostics();
		return {
			animation: behaviorDiagnostics.animation,
			audio: audioDiagnostics.audio,
			serverSound: behaviorDiagnostics.serverSound,
			ambient: audioDiagnostics.ambient,
			ambientBakes: audioDiagnostics.ambientBakes,
			dynamics: this.#spawnedEntities.dynamics.getDiagnostics(),
			behavior: behaviorDiagnostics.behavior,
			worldOwnedBehavior: behaviorDiagnostics.worldOwnedBehavior,
			particles: behaviorDiagnostics.particles,
			physicsScripts: behaviorDiagnostics.physicsScripts,
			worldOwnedPhysicsScripts: behaviorDiagnostics.worldOwnedPhysicsScripts,
			skyScripts: behaviorDiagnostics.skyScripts,
			effects: behaviorDiagnostics.effects,
			presentationCadence: behaviorDiagnostics.presentationCadence,
			residents: this.getAuthoredDynamicResidentDiagnostics(),
		};
	}

	getPortalTransitionDiagnostics(): PortalTransitionRuntimeDiagnostics {
		return this.#framePresentation.getPortalTransitionDiagnostics();
	}

	getStaticObjectRuntimeDiagnostics(): StaticObjectRuntimeDiagnostics {
		return this.#telemetry.getStaticObjectRuntimeDiagnostics({
			staticObjects: this.#staticStreaming.staticObjects,
			geometry: this.#geometry,
			outdoorLights: this.#staticStreaming.outdoorLights,
			textures: this.#textures,
		});
	}

	getTextureAtlasPageResource(pageId: TexturePageId): Texture2DResourceKey {
		return this.#textures.getAtlasPageResource(pageId);
	}

	installActiveRegionStaticDetails(
		binding: ActiveRegionStaticDetailBinding,
	): void {
		this.#staticStreaming.installActiveRegionStaticDetails(binding);
	}

	dynamicEntityOrigin(guid: number): ResolvedSceneOrigin | null {
		return this.#spawnedEntities.dynamicEntityOrigin(guid);
	}

	queryWorldPointResidencyCandidates(
		point: Vec3,
	): ScenePointResidencyCandidates | null {
		return this.#scene.queryWorldPointResidencyCandidates(point);
	}

	queryEnvCellPointContainment(
		residency: SceneResidency,
		point: Vec3,
	): boolean | null {
		return residency.envCellId === null
			? null
			: this.#scene.queryEnvCellPointContainment(residency.envCellId, point);
	}

	hasEnvCellTopology(landblockId: SceneResidency["landblockId"]): boolean {
		return this.#scene.hasEnvCellTopology(landblockId);
	}

	hasEnvCellScope(residency: SceneResidency): boolean {
		return this.#scene.hasEnvCellScope(residency);
	}

	queryOutdoorTerrainSurface(point: Vec3): TerrainSurfaceSample | null {
		return this.#staticStreaming.queryOutdoorTerrainSurface(point);
	}

	get terrainInstallationRevision(): number {
		return this.#staticStreaming.terrainInstallationRevision;
	}

	listInstalledTerrain(): Iterable<InstalledTerrain> {
		return this.#staticStreaming.listInstalledTerrain();
	}

	terrainColorPalette(): Float32Array | null {
		return this.#staticStreaming.terrainColorPalette();
	}

	spawnedEntityPlacement(guid: number): ScenePlacement | null {
		return this.#spawnedEntities.spawnedEntityPlacement(guid);
	}

	acceptCombatOutcome(
		outcome: CombatEffectOutcome,
		target: number | null,
		tuning: CombatEffectsTuning,
		nowMs: number,
	): void {
		this.#behaviorEffects.acceptCombatOutcome(outcome, target, tuning, nowMs);
	}

	setCombatEffectsAppearance(appearance: CombatEffectsAppearance): void {
		this.#behaviorEffects.setCombatEffectsAppearance(appearance);
	}

	refreshCombatEffectsFontAtlas(): void {
		this.#behaviorEffects.refreshCombatEffectsFontAtlas();
	}

	clearCombatEffects(): void {
		this.#behaviorEffects.clearCombatEffects();
	}

	advanceCombatEffects(nowMs: number): void {
		this.#behaviorEffects.advanceCombatEffects(nowMs);
	}

	visitRealizedEntitySelectionBounds(
		visit: (entity: DynamicEntityView, bounds: EntitySelectionBounds) => void,
	): void {
		this.#spawnedEntities.visitRealizedEntitySelectionBounds(visit);
	}

	withSpawnedEntitySelectionGeometry<T>(
		guid: number,
		visit: (geometry: EntitySelectionGeometry) => T,
	): T | null {
		return this.#spawnedEntities.withSpawnedEntitySelectionGeometry(
			guid,
			visit,
		);
	}

	listPresentedSpawnedEntities(): Generator<{
		readonly sidewaysSpan: SetupSidewaysSpan | null;
		readonly view: DynamicEntityView;
		readonly placement: ScenePlacement;
	}> {
		return this.#spawnedEntities.listPresentedSpawnedEntities();
	}

	get dynamicEntityPlacementRevision(): number {
		return this.#spawnedEntities.dynamicEntityPlacementRevision;
	}

	get mapEntityRevision(): number {
		return this.#spawnedEntities.mapEntityRevision;
	}

	get mapGeometry(): MapGeometryStore {
		return this.#staticStreaming.mapGeometry;
	}

	queryEnvCellBounds(residency: SceneResidency): AABB3 | null {
		return residency.envCellId === null
			? null
			: this.#scene.queryEnvCellBounds(residency.envCellId);
	}

	createLocalSceneModel(
		placement: SceneSpatialPlacement,
	): LocalSceneModelHandle {
		return this.#spawnedEntities.createLocalSceneModel(placement);
	}

	tick(nowMs: number): void {
		if (this.#telemetry.destroyed) return;
		this.pollPortalTransitionLoading();
		this.#spawnedEntities.advancePlacements(nowMs);
	}

	/** Commit loading work while portal space is the only presented scene. */
	pollPortalTransitionLoading(): void {
		if (this.#telemetry.destroyed) return;
		const finishCommit =
			this.#telemetry.presentationProfiler?.beginWork("contentCommit");
		try {
			this.#staticStreaming.drainCommitArtifacts();
		} finally {
			finishCommit?.();
		}
		this.#telemetry.throwPendingPresentationFailures();
	}

	/** Advance ordered runtime state and draw one frontend-scheduled frame. */
	frame(timeSeconds: number): void {
		if (this.#telemetry.destroyed)
			throw new Error("Game runtime has been destroyed.");
		this.tick(timeSeconds * 1_000);
		this.render(timeSeconds);
	}

	/** Draw the current runtime state after a frontend-owned tick measurement. */
	renderPortalTransition(
		timeSeconds: number,
		extent: RenderExtent,
	): PortalTransitionPresentationReceipt | null {
		return this.#framePresentation.renderPortalTransition(timeSeconds, extent);
	}

	clearPresentation(): void {
		this.#framePresentation.clearPresentation();
	}

	/** Draw the current runtime state after a frontend-owned tick measurement. */
	render(timeSeconds: number): PortalTransitionPresentationReceipt | null {
		if (this.#telemetry.destroyed)
			throw new Error("Game runtime has been destroyed.");
		const renderer = this.#framePresentation.requireRenderer();
		const extent = this.#framePresentation.requirePrimaryViewExtent();
		this.#framePresentation.setLastFrameTimeSeconds(timeSeconds);
		const portalTransition =
			this.#framePresentation.advancePortalTransition(timeSeconds);
		// Retail runs script hooks before this frame's animation hooks for static objects
		// (`animate_static_object`), and statics are this population.
		const frameProfile = this.#telemetry.presentationProfiler;
		frameProfile?.beginFrame();
		this.#behaviorEffects.advanceEffectsAndParticles(
			timeSeconds,
			this.#framePresentation.environment.sky,
			this.#framePresentation.frameSettings.weatherEnabled,
		);
		frameProfile?.mark("effects");
		if (this.#audio.listenerEnabled) {
			this.#audio.advanceFrameAudio(timeSeconds);
		}
		frameProfile?.mark("audio");
		this.#behaviorEffects.advanceAndPublishAnimation(
			timeSeconds,
			this.#spawnedEntities.dynamics,
		);
		frameProfile?.mark("animation");
		this.#behaviorEffects.submitParticles(renderer);
		const feedback = this.#framePresentation.drawSceneFrame(
			renderer,
			extent,
			timeSeconds,
			portalTransition,
			this.#staticStreaming.terrainFogCoverage(),
		);
		frameProfile?.mark("render");
		const loadingReceipt = this.#framePresentation.presentOpaquePortalLoading();
		this.#behaviorEffects.completeAnimationFrame(feedback, timeSeconds);
		frameProfile?.finishFrame();
		return loadingReceipt ?? feedback.portalTransitionReceipt;
	}

	getPresentationProfile(): PresentationProfile | null {
		return this.#telemetry.getPresentationProfile();
	}

	destroy(): Promise<void> {
		return this.#telemetry.destroy({
			removeAllCellBehaviors: () =>
				this.#staticStreaming.removeAllCellBehaviors(),
			collectSpawnedDemandRevocations: () =>
				this.#spawnedEntities.collectSyncDemandRevocations(),
			clearTransientStateSync: () => {
				this.#spawnedEntities.clearVisualKeys();
				this.#framePresentation.clearSyncPresentationState();
				this.#behaviorEffects.clearPendingCues();
			},
			destroyGeometry: () => this.#geometry.destroy(),
			clearStaticDetails: () => this.#staticStreaming.clearStaticDetails(),
			assertNoRetainedSetupVisuals: () =>
				this.#spawnedEntities.assertNoRetainedSetupVisuals(),
			destroyTextures: () => this.#textures.destroy(),
			destroyResidentAtlas: () => this.#residentAtlas.destroy(),
			destroyTerrainWorker: () => this.#staticStreaming.destroyTerrainWorker(),
			destroyTerrain: () => this.#staticStreaming.destroyTerrain(),
			destroyOcean: () => this.#staticStreaming.destroyOcean(),
			destroyEnvCells: () => this.#staticStreaming.destroyEnvCells(),
			clearTargetSoundTables: () => this.#audio.clearTargetSoundTables(),
			destroyParticleMeshes: () =>
				this.#behaviorEffects.destroyParticleMeshes(),
			destroyPhysicsScriptTables: () =>
				this.#behaviorEffects.destroyPhysicsScriptTables(),
			destroySoundTables: () => this.#audio.destroySoundTables(),
			clearAmbientState: () => this.#audio.clearAmbientState(),
			releaseAmbientHandles: () => this.#audio.releaseAmbientHandles(),
			destroyVisualTemplates: () =>
				this.#spawnedEntities.destroyVisualTemplates(),
			destroyDynamicEntities: () => this.#spawnedEntities.destroyDynamics(),
			destroyAudio: () => this.#audio.destroyAudio(),
			destroyWorldPhysicsScripts: () =>
				this.#behaviorEffects.destroyWorldPhysicsScripts(),
			destroyPhysicsScripts: () =>
				this.#behaviorEffects.destroyPhysicsScripts(),
			destroyAnimation: () => this.#behaviorEffects.destroyAnimation(),
			clearAnimationSelection: () =>
				this.#behaviorEffects.clearAnimationSelection(),
			clearPortalState: () => this.#framePresentation.clearPortalState(),
			destroyRenderer: () => this.#framePresentation.destroyRenderer(),
			disposeCombatEffects: () => this.#behaviorEffects.disposeCombatEffects(),
			destroySkyScripts: () => this.#behaviorEffects.destroySkyScripts(),
			destroyEnvCellLayers: () => this.#staticStreaming.destroyEnvCellLayers(),
			destroyStaticLayers: () => this.#staticStreaming.destroyStaticLayers(),
			clearCommitArtifacts: () => this.#staticStreaming.clearCommitArtifacts(),
			destroySceneInterest: () => this.#staticStreaming.destroySceneInterest(),
			destroyLocalModels: (onRejected) =>
				this.#spawnedEntities.destroyLocalModels(onRejected),
		});
	}
}
