import { prepareStaticObjectGeometry } from "../commit/static-object-geometry-worker";
import { assembleStaticObjectArtifact } from "../commit/static-object-artifact";
import { collectStaticObjectTextureDependencies } from "../commit/static-object-texture-inputs";
import type { StaticObjectGeometryWorker } from "../commit/static-object-geometry-worker-client";
import type { StaticObjectLayerArtifact } from "../commit/artifacts";
import type { EnvCellMaterializationPlan } from "../commit/env-cell-materialization";
import type { CommitPipeline, LandblockLayerCommit } from "../commit/types";
import { OutdoorLightIndex } from "../environment/outdoor-light-index";
import type { TerrainFogCoverage } from "../environment/terrain-fog";
import type { EnvCellId, LandblockOwnerId } from "../game-types";
import type { GeometryManager } from "../geometry/geometry-manager";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import { MapGeometryStore } from "../map/map-geometry-store";
import { AABB3, Mat4, Vec3 } from "../math/types";
import type { OutdoorLightLookup } from "../renderer/renderer";
import type { ActiveRegionStaticDetailBinding } from "../resolution/active-region-static-detail";
import type { AuthoredDynamicSource } from "../resolution/landblock-layer";
import type {
	ResolvedOutdoorStaticLayerSource,
	ResolvedStaticObjectLayerSource,
} from "../resolution/landblock-layer";
import {
	STATIC_DETAIL_ROLES,
	type StaticDetailRole,
} from "../resolution/static-detail-role";
import { SceneGraph, type ScenePlacement } from "../scene";
import { EnvCellSystem } from "../systems/env-cell-system";
import { StaticObjectSystem } from "../systems/static-object-system";
import { OceanBackdrop } from "../terrain/ocean-backdrop";
import type { TerrainGenerator } from "../terrain/terrain-generator";
import type { TerrainSurfaceSample } from "../terrain/terrain-surface";
import {
	TerrainSystem,
	type InstalledTerrain,
} from "../terrain/terrain-system";
import type { ResidentTextureAtlas } from "../textures/atlas/resident-texture-atlas";
import { mergeAssetTextureFacts } from "../textures/texture-facts";
import type { TextureManager } from "../textures/texture-manager";
import type { TexturePreparer } from "../textures/texture-preparer";
import {
	TexturePurpose,
	type AssetTextureFact,
	type AssetTextureKey,
} from "../textures/types";
import type { ClosedWorkerPoolDiagnostics } from "../workers/closed-worker";
import { EnvCellBehaviors } from "./env-cell-behaviors";
import {
	EnvCellGeometryPreparer,
	type EnvCellRealizationArtifact,
} from "./env-cell-realization";
import {
	envCellRevisionToResourceOwnerId,
	landblockLayerToOwnerId,
	parseLandblockLayerOwnerId,
	staticRevisionToInstallNamespace,
	staticRevisionToResourceOwnerId,
	terrainSourceToOwnerId,
	type ActiveRegionResourceOwnerId,
	type DynamicOwnerId,
	type EnvCellBehaviorOwnerId,
	type OwnerId,
	type ResourceOwnerId,
	type TerrainResourceOwnerId,
	activeRegionResourceToOwnerId,
} from "./owner-ids";
import {
	RenderSceneInterestController,
	type SceneInterestMembership,
} from "./render-scene-interest-controller";
import type {
	EnvCellLayerRuntimeDiagnostics,
	StaticObjectLayerRuntimeDiagnostics,
} from "./runtime-telemetry-lifecycle";
import type {
	SceneActivationReceipt,
	SceneActivationRequest,
	SceneActivationStatus,
	SceneAvailabilityEvent,
	SceneAvailabilityListener,
	SceneInterestReceipt,
	SceneInterestRevision,
} from "./scene-availability";
import {
	isOutdoorStaticLayer,
	LandblockLayerKind,
	type OutdoorStaticLayerKind,
	type SceneInterestMap,
	type SceneInterestRequest,
	type StaticLayerKind,
} from "./scene-interest";
import { SceneInterestCommitCoordinator } from "./scene-interest-commit-coordinator";
import type { ResolvedSceneInterestTarget } from "./scene-target";
import {
	StaticLayerRealizer,
	type StaticLayerCompanionPublication,
	type StaticLayerGeometryPreparer,
} from "./static-layer-realizer";

/** Conservative fixed terrain root bound including retail transition lowering. */
const TERRAIN_ROOT_BOUNDS: AABB3 = new AABB3(
	new Vec3(0, -510, -OUTDOOR_LANDBLOCK_WORLD_SIZE),
	new Vec3(OUTDOOR_LANDBLOCK_WORLD_SIZE, 510, 0),
);

const EMPTY_STATIC_OBJECT_GEOMETRY_DIAGNOSTICS = {
	bakedRangeCount: 0,
	bakedGeometryBytes: 0,
	geometryWorkerDurationMs: 0,
	instancedGeometryBytes: 0,
	sourceMaterialSlotCount: 0,
	sourcePartCount: 0,
	sourceRangeCount: 0,
	sourceResidentCount: 0,
	transparentTemplateBytes: 0,
	transparentTemplateCohortCount: 0,
	transparentTemplateInstanceCount: 0,
};

/** One completed static artifact retained with the currently relevant interest revision. */
interface PendingCommitArtifact {
	readonly artifact: LandblockLayerCommit;
	readonly revision: SceneInterestRevision;
}

export interface StaticSceneStreamingContext {
	readonly scene: SceneGraph;
	readonly geometry: GeometryManager<ResourceOwnerId>;
	readonly textures: TextureManager<ResourceOwnerId>;
	readonly residentAtlas: ResidentTextureAtlas<ResourceOwnerId>;
	readonly texturePreparer: TexturePreparer;
	readonly commitPipeline: CommitPipeline;
	readonly terrainGenerator: TerrainGenerator;
	readonly staticGeometryPreparer: StaticLayerGeometryPreparer<
		ResolvedStaticObjectLayerSource,
		StaticObjectLayerArtifact | null,
		OwnerId
	>;
	readonly isDestroyed: () => boolean;
	readonly trackPresentationWork: (work: Promise<void>) => void;
	readonly trackRealizationContinuation: (
		continuation: Promise<unknown>,
	) => void;
	readonly recordStaticLayerPublication: () => void;
	readonly recordTextureFactCollection: (durationMs: number) => void;
	readonly setStaticObjectLayerDiagnostics: (
		ownerId: OwnerId,
		diagnostics: StaticObjectLayerRuntimeDiagnostics,
	) => void;
	readonly hasStaticObjectLayerDiagnostics: (ownerId: OwnerId) => boolean;
	readonly setEnvCellLayerDiagnostics: (
		ownerId: OwnerId,
		diagnostics: EnvCellLayerRuntimeDiagnostics,
	) => void;
	readonly hasEnvCellLayerDiagnostics: (ownerId: OwnerId) => boolean;
	readonly clearLayerDiagnostics: (ownerId: OwnerId) => void;
	readonly deleteAuthoredDynamicResidents: (
		ownerId: OwnerId | EnvCellBehaviorOwnerId,
	) => void;
	readonly withdrawOutOfScopeDynamicEntities: () => void;
	readonly wakeDeferredDynamicResidencies: (
		residencyKey: string,
		match: "exact" | "prefix",
	) => void;
	readonly prepareStaticAuthoredDynamics: (
		ownerId: OwnerId | EnvCellBehaviorOwnerId,
		layer: LandblockLayerKind,
		landblockId: LandblockOwnerId,
		sources: readonly AuthoredDynamicSource[],
	) => Promise<StaticLayerCompanionPublication>;
	readonly retireDynamicOwner: (ownerId: DynamicOwnerId) => void;
	readonly invalidateResolvedResources: (
		reason: "atlas-publication" | "region-static-detail",
	) => void;
}

/**
 * Owns static scene/asset streaming, layer realization, terrain/ocean/env-cell/map
 * installation, regional static details, and scene activation & availability.
 */
export class StaticSceneStreamingCoordinator {
	readonly #context: StaticSceneStreamingContext;
	/** Immutable-object nodes, components, and resource publication. */
	readonly #staticObjects: StaticObjectSystem<OwnerId, ResourceOwnerId>;
	/** Landblock-scoped authored outdoor lights, rebuilt only when layer residency changes. */
	readonly #outdoorLights: OutdoorLightLookup & OutdoorLightIndex =
		new OutdoorLightIndex();
	/** Source-to-static publication sequencing for independent outdoor static layers. */
	readonly #staticLayerRealizer: StaticLayerRealizer<
		ResolvedOutdoorStaticLayerSource,
		StaticObjectLayerArtifact | null,
		OwnerId
	>;
	/** Env-cell scopes, crossings, shell nodes, and portal contributions. */
	readonly #envCells: EnvCellSystem<OwnerId, ResourceOwnerId>;
	readonly #envCellRealizer: StaticLayerRealizer<
		EnvCellMaterializationPlan,
		EnvCellRealizationArtifact,
		OwnerId
	>;
	/** Dynamic terrain sources, generation state, and realized terrain resources. */
	readonly #terrain: TerrainSystem<ResourceOwnerId, TerrainResourceOwnerId>;
	/** Runtime-owned terrain-generation worker terminated during runtime shutdown. */
	readonly #terrainGenerator: TerrainGenerator;
	/** Visual-only ocean shares the runtime lifetime without entering authored terrain state. */
	readonly #oceanBackdrop: OceanBackdrop;
	/**
	 * Derived overhead-map geometry, installed and evicted with the layers it comes from.
	 *
	 * Held beside the scene rather than in it: the map is a second consumer of the same records,
	 * and its geometry must never acquire scene-node lifetime.
	 */
	readonly #mapGeometry = new MapGeometryStore();
	/** Active-region owner of the complete device-backed static-detail role set. */
	#activeRegionStaticDetailOwner: ActiveRegionResourceOwnerId | null = null;
	/** Read-only regional detail selections consumed by renderer-owned object programs. */
	readonly #activeRegionStaticDetails = new Map<
		StaticDetailRole,
		{ readonly key: AssetTextureKey; readonly tiling: number }
	>();
	/** Asynchronous scene-interest receipt coordination, separate from runtime mutation authority. */
	readonly #sceneInterestCoordinator: SceneInterestCommitCoordinator;
	/** Synchronous render-interest policy, target context, and fog state. */
	readonly #renderSceneInterest = new RenderSceneInterestController();
	/** Completed asynchronous commits awaiting the next synchronous runtime tick. */
	readonly #commitArtifacts: PendingCommitArtifact[] = [];
	/** One source-neutral replacement barrier layered over the ordinary interest coordinator. */
	#sceneActivation: SceneActivationReceipt | null = null;
	/** Exact layer failures retained until the owning interest revision is withdrawn. */
	readonly #sceneLayerFailures = new Map<
		string,
		{ readonly revision: SceneInterestRevision; readonly diagnostic: string }
	>();
	/** Frontend listeners informed when placement facts become available or fail. */
	readonly #sceneAvailabilityListeners = new Set<SceneAvailabilityListener>();
	/** Published EnvCell layers, reconciled even on cell crossings within one landblock. */
	readonly #cellBehaviors = new Map<
		LandblockOwnerId,
		EnvCellBehaviors<AuthoredDynamicSource[]>
	>();

	constructor(context: StaticSceneStreamingContext) {
		this.#context = context;
		this.#terrainGenerator = context.terrainGenerator;
		this.#staticObjects = new StaticObjectSystem<OwnerId, ResourceOwnerId>(
			context.scene,
			context.geometry,
			staticRevisionToResourceOwnerId,
		);
		const staticLayerCurrentness = {
			isCurrent: (
				owner: OwnerId,
				layer: StaticLayerKind,
				revision: SceneInterestRevision,
			): boolean => {
				const parsed = parseLandblockLayerOwnerId(owner);
				if (parsed.layer !== layer) {
					throw new Error(
						`Static realization owner ${owner} does not match layer ${layer}.`,
					);
				}
				return this.#sceneInterestCoordinator.ownsDispatch(
					{ id: parsed.landblockId, layer },
					revision,
				);
			},
		};
		this.#staticLayerRealizer = new StaticLayerRealizer<
			ResolvedOutdoorStaticLayerSource,
			StaticObjectLayerArtifact | null,
			OwnerId
		>({
			atlas: context.residentAtlas,
			currentness: staticLayerCurrentness,
			failureReporter: {
				reportAtlasFailure: ({ cause, layer, owner, revision }) =>
					console.error({
						cause,
						kind: "static-layer-atlas-failed",
						layer,
						owner,
						revision,
					}),
			},
			geometry: context.staticGeometryPreparer,
			publisher: {
				evict: async (owner, revision) => {
					this.#staticObjects.evict(owner, revision);
					const parsed = parseOutdoorLayerOwner(owner);
					this.#outdoorLights.evict(parsed.landblockId, parsed.layer, revision);
				},
				removeExact: async (owner, revision) => {
					this.#staticObjects.removeExact(owner, revision);
					const parsed = parseOutdoorLayerOwner(owner);
					this.#outdoorLights.removeExact(
						parsed.landblockId,
						parsed.layer,
						revision,
					);
				},
				replace: async ({ geometry, layer, owner, revision }) => {
					if (!isOutdoorStaticLayer(layer)) {
						throw new Error(`Outdoor static publisher received ${layer}.`);
					}
					context.recordStaticLayerPublication();
					this.#staticObjects.replaceObjects(owner, revision, geometry, layer);
					// Only the Objects layer emits, but every outdoor layer publishes here: an
					// empty set is how a withdrawn layer clears its own entry.
					this.#outdoorLights.install(
						parseOutdoorLayerOwner(owner).landblockId,
						layer,
						revision,
						geometry?.staticLights ?? [],
					);
				},
			},
		});
		this.#envCells = new EnvCellSystem(
			context.scene,
			context.geometry,
			envCellRevisionToResourceOwnerId,
		);
		this.#envCellRealizer = new StaticLayerRealizer<
			EnvCellMaterializationPlan,
			EnvCellRealizationArtifact,
			OwnerId
		>({
			atlas: context.residentAtlas,
			currentness: staticLayerCurrentness,
			failureReporter: {
				reportAtlasFailure: ({ cause, layer, owner, revision }) =>
					console.error({
						cause,
						kind: "env-cell-atlas-failed",
						layer,
						owner,
						revision,
					}),
			},
			geometry: new EnvCellGeometryPreparer(context.staticGeometryPreparer),
			publisher: {
				evict: async (owner, revision) => {
					this.#envCells.evict(owner, revision);
					this.#staticObjects.evict(owner, revision);
				},
				removeExact: async (owner, revision) => {
					this.#envCells.removeExact(owner, revision);
					this.#staticObjects.removeExact(owner, revision);
				},
				replace: async ({ geometry, owner, revision }) => {
					const rollbackEnvironment = this.#envCells.replace(
						owner,
						revision,
						geometry.environment,
					);
					try {
						this.#staticObjects.replaceObjects(
							owner,
							revision,
							geometry.residents,
							"env-cell-static-residents",
						);
					} catch (cause) {
						rollbackEnvironment();
						throw cause;
					}
				},
			},
		});
		this.#terrain = new TerrainSystem<ResourceOwnerId, TerrainResourceOwnerId>(
			context.scene,
			context.terrainGenerator,
			context.geometry,
			context.textures,
			terrainSourceToOwnerId,
		);
		this.#oceanBackdrop = new OceanBackdrop(context.geometry, context.textures);
		this.#sceneInterestCoordinator = new SceneInterestCommitCoordinator(
			context.commitPipeline,
			{
				evict: ({ layer, revision }) =>
					this.#evictStaticLayer(layer.id, layer.layer, revision),
				failed: ({ error, layer, revision }) =>
					this.#publishSceneAvailability({
						kind: "scene-content-failed",
						layer: layer.layer,
						message: error instanceof Error ? error.message : String(error),
						residency: { envCellId: null, landblockId: layer.id },
						revision,
					}),
				prepared: ({ artifact, revision }) =>
					this.#commitArtifacts.push({ artifact, revision }),
				unavailable: ({ layer, revision }) =>
					this.#publishSceneAvailability({
						kind: "scene-content-unavailable",
						layer: layer.layer,
						residency: { envCellId: null, landblockId: layer.id },
						revision,
					}),
			},
		);
	}

	get staticObjects(): StaticObjectSystem<OwnerId, ResourceOwnerId> {
		return this.#staticObjects;
	}

	get outdoorLights(): OutdoorLightLookup & OutdoorLightIndex {
		return this.#outdoorLights;
	}

	get envCells(): EnvCellSystem<OwnerId, ResourceOwnerId> {
		return this.#envCells;
	}

	get terrain(): TerrainSystem<ResourceOwnerId, TerrainResourceOwnerId> {
		return this.#terrain;
	}

	get oceanBackdrop(): OceanBackdrop {
		return this.#oceanBackdrop;
	}

	get mapGeometry(): MapGeometryStore {
		return this.#mapGeometry;
	}

	get terrainInstallationRevision(): number {
		return this.#terrain.installationRevision;
	}

	getDetailBinding(
		role: StaticDetailRole,
	): { readonly key: AssetTextureKey; readonly tiling: number } | null {
		return this.#activeRegionStaticDetails.get(role) ?? null;
	}

	containsInterest(placement: ScenePlacement): boolean {
		return this.#renderSceneInterest.contains(placement) === true;
	}

	hasInstalledTerrainSource(landblockId: LandblockOwnerId): boolean {
		return this.#terrain.hasInstalledSource(landblockId);
	}

	resolvedSceneTarget(): ResolvedSceneInterestTarget | null {
		return this.#renderSceneInterest.resolvedTarget();
	}

	/**
	 * Replace the current scene with one generation-scoped destination installation.
	 *
	 * This deliberately layers over the existing interest coordinator: static preparation, worker
	 * ownership, eviction, and dynamic realization remain the same machinery used by continuous
	 * streaming. The receipt returned here is a different contract from `SceneInterestReceipt` —
	 * it names the exact products that must become resident before a transition may reveal them.
	 */
	async activateScene(
		request: SceneActivationRequest,
	): Promise<SceneActivationReceipt> {
		if (!Number.isInteger(request.generation) || request.generation < 0) {
			throw new Error(
				"Scene activation generation must be a non-negative integer.",
			);
		}
		if (this.#context.isDestroyed())
			throw new Error("Cannot activate a scene after runtime shutdown.");
		const transition = this.#renderSceneInterest.replace(request.target);
		this.#oceanBackdrop.setInterest(request.target);
		this.#context.withdrawOutOfScopeDynamicEntities();
		const interest = this.#applySceneInterest(transition.effectiveInterest);
		const receipt: SceneActivationReceipt = {
			generation: request.generation,
			revision: interest.revision,
			requiredLayers: transition.nominalInterest,
		};
		this.#sceneActivation = receipt;
		return receipt;
	}

	/** Poll exact installation products without exposing scene-private maps or resource leases. */
	sceneActivationStatus(
		receipt: SceneActivationReceipt,
	): SceneActivationStatus {
		if (this.#sceneActivation !== receipt) {
			return {
				kind: "failed",
				receipt,
				diagnostic: "Scene activation was superseded by a newer destination.",
			};
		}
		for (const [landblockId, layers] of receipt.requiredLayers) {
			for (const layer of layers) {
				const failure = this.#sceneLayerFailures.get(
					sceneLayerKey(landblockId, layer),
				);
				if (failure?.revision === receipt.revision) {
					return {
						kind: "failed",
						receipt,
						diagnostic: failure.diagnostic,
					};
				}
				if (!this.#isSceneLayerInstalled(landblockId, layer)) {
					return { kind: "pending", receipt };
				}
			}
		}
		return { kind: "ready", receipt };
	}

	/** Release the replacement barrier after the mode-specific handoff has completed. */
	completeSceneActivation(generation: number): void {
		if (this.#sceneActivation?.generation !== generation) return;
		this.#sceneActivation = null;
	}

	/** Current scene membership shared with app-local encounter consumers. */
	sceneInterestMembership(): SceneInterestMembership {
		return this.#renderSceneInterest;
	}

	/** Replace profile-resolved static content demand without moving the camera. */
	updateSceneInterest(request: SceneInterestRequest): SceneInterestReceipt {
		const transition = this.#renderSceneInterest.follow(request);
		this.#oceanBackdrop.setInterest(request);
		this.#context.withdrawOutOfScopeDynamicEntities();
		return this.#applySceneInterest(transition.effectiveInterest);
	}

	/** Evict every requested static layer without moving the camera. */
	clearSceneInterest(): SceneInterestReceipt {
		const transition = this.#renderSceneInterest.clear();
		this.#oceanBackdrop.setInterest(null);
		this.#sceneActivation = null;
		this.#context.withdrawOutOfScopeDynamicEntities();
		return this.#applySceneInterest(transition.effectiveInterest);
	}

	/** Snapshot the current replacement demand and resolved target for diagnostics and harnesses. */
	sceneInterestState(): {
		readonly interest: SceneInterestMap;
		readonly resolvedTarget: ResolvedSceneInterestTarget | null;
	} {
		return this.#renderSceneInterest.snapshot();
	}

	/** Snapshot current outdoor fog coverage without exposing mutable runtime state. */
	terrainFogCoverage(): TerrainFogCoverage | null {
		return this.#renderSceneInterest.fogCoverage();
	}

	/** Subscribe to source/topology availability without exposing runtime-owned resources. */
	subscribeSceneAvailability(listener: SceneAvailabilityListener): () => void {
		this.#sceneAvailabilityListeners.add(listener);
		return () => this.#sceneAvailabilityListeners.delete(listener);
	}

	/** Dedicated terrain-worker queue and transfer facts for streaming diagnostics. */
	getTerrainWorkerDiagnostics(): ClosedWorkerPoolDiagnostics {
		return this.#terrainGenerator.getDiagnostics();
	}

	/** Promote the complete prepared regional static-detail set into device ownership once. */
	installActiveRegionStaticDetails(
		binding: ActiveRegionStaticDetailBinding,
	): void {
		const owner = activeRegionResourceToOwnerId(binding.activeRegionKey);
		try {
			for (const role of STATIC_DETAIL_ROLES) {
				const detail = binding.roles[role];
				this.#context.textures.installAssetTexture(owner, {
					height: detail.surface.height,
					key: detail.key,
					pixels: detail.surface.pixels,
					purpose: TexturePurpose.ObjectDetail,
					sourceAssetId: detail.sourceAssetId,
					width: detail.surface.width,
				});
			}
		} catch (cause) {
			if (owner !== this.#activeRegionStaticDetailOwner) {
				this.#context.textures.dropOwner(owner);
			}
			throw cause;
		}
		const previousOwner = this.#activeRegionStaticDetailOwner;
		this.#activeRegionStaticDetailOwner = owner;
		this.#activeRegionStaticDetails.clear();
		// Compiled object draws embed the detail binding these roles select.
		this.#context.invalidateResolvedResources("region-static-detail");
		for (const role of STATIC_DETAIL_ROLES) {
			const detail = binding.roles[role];
			this.#activeRegionStaticDetails.set(role, {
				key: detail.key,
				tiling: detail.tiling,
			});
		}
		if (previousOwner !== null && previousOwner !== owner) {
			this.#context.textures.dropOwner(previousOwner);
		}
	}

	/** Sample canonical outdoor terrain as soon as its source commits, before GPU realization. */
	queryOutdoorTerrainSurface(point: Vec3): TerrainSurfaceSample | null {
		return this.#terrain.querySurfaceAtWorldPoint(point);
	}

	listInstalledTerrain(): Iterable<InstalledTerrain> {
		return this.#terrain.listInstalledTerrain();
	}

	terrainColorPalette(): Float32Array | null {
		return this.#terrain.terrainColorPalette();
	}

	drainCommitArtifacts(): void {
		this.#drainCommitArtifacts();
	}

	removeAllCellBehaviors(): void {
		for (const landblock of this.#cellBehaviors.keys())
			this.#removeCellBehaviors(landblock);
	}

	clearStaticDetails(): void {
		this.#activeRegionStaticDetails.clear();
		this.#activeRegionStaticDetailOwner = null;
	}

	destroyTerrainWorker(): void {
		this.#terrainGenerator.destroy();
	}

	destroyTerrain(): void {
		this.#terrain.destroy();
	}

	destroyOcean(): void {
		this.#oceanBackdrop.destroy();
	}

	destroyEnvCells(): void {
		this.#envCells.destroy();
	}

	destroyEnvCellLayers(): Promise<void> {
		return this.#envCellRealizer.destroy();
	}

	destroyStaticLayers(): Promise<void> {
		return this.#staticLayerRealizer.destroy();
	}

	clearCommitArtifacts(): void {
		this.#commitArtifacts.length = 0;
	}

	destroySceneInterest(): void {
		this.#sceneInterestCoordinator.destroy();
	}

	/** Check one exact static layer's published product, never a source or request revision. */
	#isSceneLayerInstalled(
		landblockId: LandblockOwnerId,
		layer: LandblockLayerKind,
	): boolean {
		if (layer === LandblockLayerKind.Terrain)
			return this.#terrain.hasResidentDrawUnit(landblockId);
		if (layer === LandblockLayerKind.EnvCells)
			return this.#context.hasEnvCellLayerDiagnostics(
				landblockLayerToOwnerId(landblockId, layer),
			);
		return this.#context.hasStaticObjectLayerDiagnostics(
			landblockLayerToOwnerId(landblockId, layer),
		);
	}

	#applySceneInterest(interest: SceneInterestMap): SceneInterestReceipt {
		const receipt = this.#sceneInterestCoordinator.reconcile(interest);
		for (const landblock of this.#cellBehaviors.keys())
			this.#syncCellBehaviors(landblock);
		return receipt;
	}

	#drainCommitArtifacts(): void {
		while (this.#commitArtifacts.length > 0) {
			const pending = this.#commitArtifacts.shift();
			if (!pending) continue;
			const { artifact, revision } = pending;
			if (
				!this.#sceneInterestCoordinator.ownsDispatch(
					{ id: artifact.landblockId, layer: artifact.layer },
					revision,
				)
			) {
				continue;
			}
			this.#commitLandblockLayer(artifact, revision);
		}
	}

	#commitLandblockLayer(
		artifact: LandblockLayerCommit,
		revision: SceneInterestRevision,
	): void {
		this.#sceneLayerFailures.delete(
			sceneLayerKey(artifact.landblockId, artifact.layer),
		);
		const ownerId = landblockLayerToOwnerId(
			artifact.landblockId,
			artifact.layer,
		);
		if (artifact.layer === LandblockLayerKind.Terrain) {
			this.#installTerrainLayer(artifact);
			this.#publishSceneAvailability({
				kind: "outdoor-terrain-source-available",
				landblockId: artifact.landblockId,
				revision,
			});
			return;
		}
		if (artifact.layer === LandblockLayerKind.EnvCells) {
			this.#realizeEnvCellLayer(ownerId, artifact, revision);
			return;
		}
		if (isOutdoorStaticLayer(artifact.layer)) {
			this.#realizeOutdoorStaticLayer(ownerId, artifact, revision);
			return;
		}
		throw new Error(`Layer ${artifact.layer} has no publication contract.`);
	}

	#installTerrainLayer(
		artifact: Extract<
			LandblockLayerCommit,
			{
				layer: LandblockLayerKind.Terrain;
			}
		>,
	): void {
		this.#oceanBackdrop.setPresentation(artifact.commit.presentation);
		this.#terrain.install(terrainSourceToOwnerId(artifact.landblockId), {
			localBounds: TERRAIN_ROOT_BOUNDS,
			placement: createLandblockPlacement(artifact.landblockId),
			source: {
				generation: artifact.commit.generation,
				landblockId: artifact.landblockId,
				presentation: artifact.commit.presentation,
			},
		});
	}

	#realizeOutdoorStaticLayer(
		ownerId: OwnerId,
		artifact: Extract<
			LandblockLayerCommit,
			{ readonly layer: OutdoorStaticLayerKind }
		>,
		revision: SceneInterestRevision,
	): void {
		const factCollectionStartedAt = performance.now();
		const textureRequirements = collectStaticObjectTextureDependencies(
			artifact.commit.source,
		);
		this.#context.recordTextureFactCollection(
			performance.now() - factCollectionStartedAt,
		);
		this.#context.trackRealizationContinuation(
			this.#staticLayerRealizer
				.realize({
					layer: artifact.layer,
					owner: ownerId,
					prepareCompanion: () =>
						this.#context.prepareStaticAuthoredDynamics(
							ownerId,
							artifact.layer,
							artifact.landblockId,
							artifact.commit.source.dynamicSources,
						),
					revision,
					source: artifact.commit.source,
					textureRequirements,
				})
				.then(async (result) => {
					if (result.kind !== "published") return;
					if (artifact.commit.source.kind === LandblockLayerKind.Buildings) {
						this.#mapGeometry.installBuildings(artifact.commit.source);
					}
					this.#context.setStaticObjectLayerDiagnostics(ownerId, {
						...(result.geometry?.geometryDiagnostics ??
							EMPTY_STATIC_OBJECT_GEOMETRY_DIAGNOSTICS),
						cullingGroup: artifact.layer,
						expectedResidentCount:
							artifact.commit.source.staticResidents.length +
							artifact.commit.source.dynamicSources.length,
						layer: artifact.layer,
						landblockId: artifact.landblockId,
						materializedStaticResidentCount:
							artifact.commit.source.staticResidents.length,
						promotedDynamicResidentCount:
							artifact.commit.source.dynamicSources.length,
						resolvedStaticResidentCount:
							artifact.commit.source.staticResidents.length,
						runtimeDynamicResidentCount:
							artifact.commit.source.dynamicSources.length,
						sceneNodeCount: result.geometry?.objects.length ?? 0,
						staticArtifactInstalled: result.geometry !== null,
					});
				})
				.catch((error) => {
					if (
						!this.#sceneInterestCoordinator.ownsDispatch(
							{ id: artifact.landblockId, layer: artifact.layer },
							revision,
						)
					)
						return;
					console.error(error);
					this.#publishSceneAvailability({
						kind: "scene-content-failed",
						layer: artifact.layer,
						message: error instanceof Error ? error.message : String(error),
						residency: { envCellId: null, landblockId: artifact.landblockId },
						revision,
					});
				}),
		);
	}

	#syncCellBehaviors(landblock: LandblockOwnerId): void {
		const layer = this.#cellBehaviors.get(landblock);
		if (!layer) return;
		const target = this.#renderSceneInterest.resolvedTarget();
		const focus =
			target?.kind === "dungeon" && target.requested.kind === "env-cell"
				? target.requested.envCellId
				: null;
		const visible =
			focus === null
				? undefined
				: this.#context.scene.getPotentiallyVisibleEnvCellIds(focus);
		// The interest coordinator evicts departed layers synchronously before this reconciliation.
		this.#context.trackPresentationWork(
			layer.reconcile(
				(cell) =>
					focus === null || cell === focus || visible?.has(cell) === true,
			),
		);
	}

	#removeCellBehaviors(landblock: LandblockOwnerId): void {
		const layer = this.#cellBehaviors.get(landblock);
		if (!layer) return;
		this.#cellBehaviors.delete(landblock);
		this.#context.trackPresentationWork(layer.reconcile(() => false));
	}

	#installCellBehaviors({
		landblockId,
		dynamicSources,
	}: EnvCellMaterializationPlan): void {
		const sources = new Map<EnvCellId, AuthoredDynamicSource[]>();
		for (const source of dynamicSources) {
			const cell = source.placement.envCellId;
			if (cell === null)
				throw new Error("Interior authored object lacks an EnvCell placement.");
			const group = sources.get(cell);
			if (group) group.push(source);
			else sources.set(cell, [source]);
		}
		this.#removeCellBehaviors(landblockId);
		const groups = new EnvCellBehaviors(
			sources,
			(cell, group) => {
				return this.#context.prepareStaticAuthoredDynamics(
					`env-cell-behavior:${cell}`,
					LandblockLayerKind.EnvCells,
					landblockId,
					group,
				);
			},
			(cell) => {
				const owner = `env-cell-behavior:${cell}` as const;
				this.#context.deleteAuthoredDynamicResidents(owner);
				this.#context.retireDynamicOwner(owner);
			},
		);
		this.#cellBehaviors.set(landblockId, groups);
		this.#syncCellBehaviors(landblockId);
	}

	#realizeEnvCellLayer(
		ownerId: OwnerId,
		artifact: Extract<
			LandblockLayerCommit,
			{
				layer: LandblockLayerKind.EnvCells;
			}
		>,
		revision: SceneInterestRevision,
	): void {
		const plan = artifact.commit.plan;
		if (plan.landblockId !== artifact.landblockId) {
			throw new Error(
				`EnvCell plan belongs to ${plan.landblockId}, expected ${artifact.landblockId}.`,
			);
		}
		const textureRequirements = mergeAssetTextureFacts(
			[
				...plan.shellTextureRequirements,
				...plan.residentJobs.flatMap((job) => job.textureRequirements),
			],
			"EnvCell layer",
		);
		this.#context.trackRealizationContinuation(
			this.#envCellRealizer
				.realize({
					layer: LandblockLayerKind.EnvCells,
					owner: ownerId,
					revision,
					source: plan,
					textureRequirements,
				})
				.then(async (result) => {
					if (result.kind !== "published") return;
					if (
						this.#context.isDestroyed() ||
						!this.#sceneInterestCoordinator.ownsDispatch(
							{ id: artifact.landblockId, layer: artifact.layer },
							revision,
						)
					)
						return;
					this.#installCellBehaviors(plan);
					this.#mapGeometry.installInterior({
						apertures: plan.apertures,
						crossings: plan.crossings,
						landblockId: artifact.landblockId,
						shells: plan.shells,
					});
					this.#context.setEnvCellLayerDiagnostics(ownerId, {
						...plan.diagnostics,
						...result.geometry.residentGeometryDiagnostics,
						indoorDepthContinuousCrossingCount: plan.crossings.filter(
							(crossing) =>
								crossing.spatialRelationship.kind === "indoor-depth-continuous",
						).length,
						indoorTopologyBoundaryCrossingCount: plan.crossings.filter(
							(crossing) =>
								crossing.spatialRelationship.kind ===
								"indoor-topology-boundary",
						).length,
						exteriorTransitionCrossingCount: plan.crossings.filter(
							(crossing) =>
								crossing.spatialRelationship.kind === "exterior-transition",
						).length,
						landblockId: artifact.landblockId,
						potentiallyVisibleReferenceCount: plan.scopes.reduce(
							(count, scope) => count + scope.potentiallyVisibleEnvCellIds.size,
							0,
						),
						sceneResidentNodeCount:
							result.geometry.residents?.objects.length ?? 0,
						sceneShellNodeCount: result.geometry.environment.cellShells.length,
						visibilityIslandCount: new Set(
							result.geometry.environment.scopes.map(
								(scope) => scope.visibilityIslandId,
							),
						).size,
					});
					this.#publishSceneAvailability({
						kind: "env-cell-topology-available",
						landblockId: artifact.landblockId,
						revision,
					});
				})
				.catch((error) => {
					if (
						!this.#sceneInterestCoordinator.ownsDispatch(
							{
								id: artifact.landblockId,
								layer: LandblockLayerKind.EnvCells,
							},
							revision,
						)
					) {
						return;
					}
					console.error(error);
					this.#publishSceneAvailability({
						kind: "scene-content-failed",
						layer: artifact.layer,
						message: error instanceof Error ? error.message : String(error),
						residency: {
							envCellId: null,
							landblockId: artifact.landblockId,
						},
						revision,
					});
				}),
		);
	}

	#evictStaticLayer(
		landblockId: LandblockOwnerId,
		layer: LandblockLayerKind,
		revision: SceneInterestRevision,
	): void {
		const ownerId = landblockLayerToOwnerId(landblockId, layer);
		if (isOutdoorStaticLayer(layer)) {
			this.#context.trackPresentationWork(
				this.#staticLayerRealizer.evict(ownerId, revision),
			);
		} else if (layer === LandblockLayerKind.EnvCells) {
			this.#context.trackPresentationWork(
				this.#envCellRealizer.evict(ownerId, revision),
			);
		} else {
			this.#staticObjects.evict(ownerId, revision);
		}
		if (layer === LandblockLayerKind.Buildings) {
			this.#mapGeometry.evictBuildings(landblockId);
		} else if (layer === LandblockLayerKind.EnvCells) {
			this.#removeCellBehaviors(landblockId);
			this.#mapGeometry.evictInterior(landblockId);
		}
		this.#context.clearLayerDiagnostics(ownerId);
		this.#sceneLayerFailures.delete(sceneLayerKey(landblockId, layer));
		this.#context.retireDynamicOwner(ownerId);
		this.#envCells.removeOwner(ownerId);
		if (layer === LandblockLayerKind.Terrain) {
			this.#terrain.removeOwner(terrainSourceToOwnerId(landblockId));
		}
		this.#context.textures.dropOwner(ownerId);
	}

	#publishSceneAvailability(event: SceneAvailabilityEvent): void {
		if (event.kind === "scene-content-failed") {
			this.#sceneLayerFailures.set(
				sceneLayerKey(event.residency.landblockId, event.layer),
				{
					diagnostic: event.message,
					revision: event.revision,
				},
			);
		} else if (event.kind === "scene-content-unavailable") {
			this.#sceneLayerFailures.set(
				sceneLayerKey(event.residency.landblockId, event.layer),
				{
					diagnostic: `No source content is available for ${event.layer} at ${event.residency.landblockId}.`,
					revision: event.revision,
				},
			);
		}
		if (event.kind === "outdoor-terrain-source-available") {
			this.#context.wakeDeferredDynamicResidencies(
				`${event.landblockId}:outdoor`,
				"exact",
			);
		} else if (event.kind === "env-cell-topology-available") {
			this.#context.wakeDeferredDynamicResidencies(
				`${event.landblockId}:env-cell:`,
				"prefix",
			);
		}
		for (const listener of this.#sceneAvailabilityListeners) listener(event);
	}
}

/** Closed static geometry adapter shared by outdoor and EnvCell resident realization. */
export class RuntimeStaticObjectGeometryPreparer implements StaticLayerGeometryPreparer<
	ResolvedStaticObjectLayerSource,
	StaticObjectLayerArtifact | null,
	OwnerId
> {
	readonly #worker: StaticObjectGeometryWorker;

	constructor(worker: StaticObjectGeometryWorker) {
		this.#worker = worker;
	}

	async prepare(options: {
		readonly layer: StaticLayerKind;
		readonly partition?: string;
		readonly owner: OwnerId;
		readonly revision: SceneInterestRevision;
		readonly source: ResolvedStaticObjectLayerSource;
		readonly textureRequirements: readonly AssetTextureFact[];
	}): Promise<StaticObjectLayerArtifact | null> {
		const geometry = await this.#worker.prepare({
			layer: options.layer,
			resourceNamespace: staticRevisionToInstallNamespace(
				options.owner,
				options.revision,
				options.partition,
			),
			source: options.source,
		});
		return assembleStaticObjectArtifact({
			geometry,
			resourceNamespace: staticRevisionToInstallNamespace(
				options.owner,
				options.revision,
				options.partition,
			),
			source: options.source,
			textureRequirements: options.textureRequirements,
		});
	}

	destroy(): void {
		this.#worker.destroy();
	}
}

/** Non-browser adapter retaining the same source-to-artifact contract without workers. */
export class InlineStaticObjectGeometryPreparer extends RuntimeStaticObjectGeometryPreparer {
	constructor() {
		super({
			prepare: (job) => Promise.resolve(prepareStaticObjectGeometry(job)),
			destroy: () => undefined,
		} as StaticObjectGeometryWorker);
	}
}

function sceneLayerKey(
	landblockId: LandblockOwnerId,
	layer: LandblockLayerKind,
): string {
	return `${landblockId}:${layer}`;
}

/** Parse an outdoor static publisher owner, failing loudly if a non-outdoor layer reached it. */
function parseOutdoorLayerOwner(owner: OwnerId): {
	readonly landblockId: LandblockOwnerId;
	readonly layer: OutdoorStaticLayerKind;
} {
	const parsed = parseLandblockLayerOwnerId(owner);
	if (!isOutdoorStaticLayer(parsed.layer)) {
		throw new Error(`Outdoor static publisher received ${parsed.layer}.`);
	}
	return { landblockId: parsed.landblockId, layer: parsed.layer };
}

function createLandblockPlacement(
	landblockId: LandblockOwnerId,
): ScenePlacement {
	return {
		envCellId: null,
		landblockId,
		localTransform: Mat4.identity(),
	};
}
