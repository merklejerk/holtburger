import type { TexturePixelSource } from "../../assets/texture-pixel-source";
import { log, LogLevel } from "../../logs";
import {
	CommitBundleSourceKind,
	type CommitBundle,
	type CommitPipeline,
	type DynamicEntityCommit,
} from "../commit/types";
import type { StaticObjectLayerDiagnostics } from "../commit/artifacts";
import { INVALID_ID, type LandblockId } from "../game-types";
import { GeometryManager } from "../geometry/geometry-manager";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import { AABB3, Mat4, Quat, Vec3 } from "../math/types";
import {
	DEFAULT_FRAME_SETTINGS,
	type FrameSettings,
	type FrameSelectionMetrics,
	type Renderer,
} from "../renderer/renderer";
import { RenderWorld } from "../renderer/render-world";
import type { RendererResourceManager } from "../renderer/resource-manager";
import { SceneGraph, type ScenePlacement, type SceneResidency } from "../scene";
import {
	InlineTerrainGenerator,
	type TerrainGenerator,
} from "../terrain/terrain-generator";
import { TerrainSystem } from "../terrain/terrain-system";
import { StaticObjectSystem } from "../systems/static-object-system";
import {
	DynamicEntitySystem,
	InlineDynamicVisualPreparer,
} from "../systems/dynamic-entity-system";
import { EnvCellSystem } from "../systems/env-cell-system";
import { AnimationSystem } from "../systems/animation-system";
import { InstanceStreamManager } from "../systems/instance-stream-manager";
import {
	TextureManager,
	type TextureAtlasPageDiagnostics,
	type TexturePageId,
} from "../textures/texture-manager";
import type { Texture2DResourceKey } from "../renderer/resource-manager";
import { TexturePurpose } from "../textures/types";
import {
	WorkerTexturePreparer,
	type TexturePreparer,
} from "../textures/texture-preparer";
import {
	activeRegionResourceToOwnerId,
	type ActiveRegionResourceOwnerId,
	landblockLayerToOwnerId,
	type ResourceOwnerId,
	spawnedEntityToOwnerId,
	terrainSourceToOwnerId,
	type TerrainResourceOwnerId,
	type OwnerId,
} from "./owner-ids";
import type { ActiveRegionObjectDetailBinding } from "../resolution/active-region-object-detail";
import {
	computeSceneInterest,
	LandblockLayerKind,
	type SceneInterestMap,
	type SceneInterestRequest,
	validateLoDConfigOrThrow,
} from "./scene-interest";
import type { Camera } from "./types";
import type {
	SceneAvailabilityEvent,
	SceneAvailabilityListener,
	SceneInterestReceipt,
	SceneInterestRevision,
} from "./scene-availability";
import { SceneInterestCommitCoordinator } from "./scene-interest-commit-coordinator";
import type { TerrainSurfaceSample } from "../terrain/terrain-surface";
import type { ResolvedSceneEnvironment } from "../environment/scene-environment";
import {
	resolveTerrainCoverageFog,
	type TerrainFogCoverage,
} from "../environment/terrain-fog";

const DEFAULT_CAMERA: Camera = {
	near: 0.5,
	far: 800,
	fov: 90,
	placement: {
		envCellId: null,
		landblockId: INVALID_ID,
		position: Vec3.zero(),
		rotation: Quat.identity(),
	},
};
const DEFAULT_ENVIRONMENT: ResolvedSceneEnvironment = {
	backgroundColor: { red: 0.15, green: 0.05, blue: 0.05, alpha: 1 },
	distanceFog: null,
	sky: null,
	lighting: null,
};

/** Conservative fixed terrain root bound including retail transition lowering. */
const TERRAIN_ROOT_BOUNDS: AABB3 = new AABB3(
	new Vec3(0, -510, -OUTDOOR_LANDBLOCK_WORLD_SIZE),
	new Vec3(OUTDOOR_LANDBLOCK_WORLD_SIZE, 510, 0),
);

/** Runtime-owned collaborators that tests may replace with focused fakes. */
export interface GameRuntimeDependencies {
	readonly terrainGenerator: TerrainGenerator;
	readonly texturePreparer: TexturePreparer;
}

/** Device boundary used by runtime to construct its private renderer facade. */
export interface GameRuntimeRenderDevice {
	readonly resources: RendererResourceManager;
	buildRenderer(world: RenderWorld): Promise<Renderer>;
}

/** One completed static artifact retained with the currently relevant interest revision. */
interface PendingCommitArtifact {
	readonly artifact: CommitBundle;
	readonly revision: SceneInterestRevision;
}

/** One complete promoted resident retained for diagnostics until static-authored dynamics activate. */
export interface DeferredStaticDynamicDiagnostic {
	readonly layer: LandblockLayerKind;
	readonly landblockId: LandblockId;
	readonly residentId: string;
	readonly setupSourceId: string;
	readonly defaultAnimationId: string | null;
	readonly reason: "setup-default-animation";
}

/** One installed building layer's source-to-runtime diagnostic snapshot. */
export interface BuildingLayerRuntimeDiagnostics extends StaticObjectLayerDiagnostics {
	readonly landblockId: LandblockId;
	/** Promoted residents held at the explicit runtime deferral seam. */
	readonly runtimeDeferredResidentCount: number;
	/** Whether this source emitted a static artifact rather than only promoted residents. */
	readonly staticArtifactInstalled: boolean;
}

/** Aggregate building-layer resource and arbitration facts for app-local diagnostics. */
export interface BuildingRuntimeDiagnostics {
	readonly layers: readonly BuildingLayerRuntimeDiagnostics[];
	readonly geometryResourceCount: number;
	readonly staticObjectOwnerCount: number;
	readonly staticObjectNodeCount: number;
	readonly texture: ReturnType<
		TextureManager<ResourceOwnerId>["getDiagnostics"]
	>;
	/** Active packed atlas pages, exposed as resource-free Explorer diagnostics. */
	readonly textureAtlasPages: readonly TextureAtlasPageDiagnostics[];
}

/** Bridges source commits, scene topology, runtime residency, and frontend frame state. */
export class GameRuntime {
	/** Canonical scene topology, residency, transforms, and spatial-query membership. */
	readonly #scene = new SceneGraph();
	/** Logical geometry bindings and shared owner retention. */
	readonly #geometry: GeometryManager<ResourceOwnerId>;
	/** Logical texture preparation, device bindings, and shared owner retention. */
	readonly #textures: TextureManager<ResourceOwnerId>;
	/** Immutable-object nodes, components, and resource publication. */
	readonly #staticObjects: StaticObjectSystem<ResourceOwnerId>;
	readonly #instances: InstanceStreamManager<ResourceOwnerId>;
	/** Dynamic roots, articulated part nodes, and presentation preparation. */
	readonly #dynamics: DynamicEntitySystem<ResourceOwnerId>;
	/** Env-cell scopes, crossings, shell nodes, and portal contributions. */
	readonly #envCells: EnvCellSystem<ResourceOwnerId>;
	/** Rigid-part pose updates sequenced before visibility and drawing. */
	readonly #animation: AnimationSystem<ResourceOwnerId>;
	/** Static-authored dynamics deliberately deferred without creating runtime resources. */
	readonly #deferredStaticDynamics = new Map<
		OwnerId,
		DeferredStaticDynamicDiagnostic[]
	>();
	/** Source-to-runtime building snapshots removed with their layer owner. */
	readonly #buildingLayerDiagnostics = new Map<
		OwnerId,
		BuildingLayerRuntimeDiagnostics
	>();
	/** Active-region owner of the one device-backed building-detail texture. */
	#activeRegionDetailOwner: ActiveRegionResourceOwnerId | null = null;
	/** Read-only regional detail selection consumed by renderer-owned object programs. */
	#activeRegionDetail: {
		readonly key: ActiveRegionObjectDetailBinding["key"];
		readonly tiling: number;
	} | null = null;
	/** Dynamic terrain sources, generation state, and realized terrain resources. */
	readonly #terrain: TerrainSystem<ResourceOwnerId, TerrainResourceOwnerId>;
	/** Read-only renderer gateway over this runtime's scene and resource systems. */
	readonly #renderWorld: RenderWorld;
	/** Renderer constructed with this runtime's private read-only world facade. */
	#renderer: Renderer | null = null;
	/** Runtime-owned terrain-generation worker terminated during runtime shutdown. */
	readonly #terrainGenerator: TerrainGenerator;
	/** Asynchronous scene-interest receipt coordination, separate from runtime mutation authority. */
	readonly #sceneInterestCoordinator: SceneInterestCommitCoordinator;
	/** Completed asynchronous commits awaiting the next synchronous runtime tick. */
	readonly #commitArtifacts: PendingCommitArtifact[] = [];
	/** Frontend listeners informed when placement facts become available or fail. */
	readonly #sceneAvailabilityListeners = new Set<SceneAvailabilityListener>();
	/** Current primary-view input used for visibility and rendering. */
	#camera: Camera = DEFAULT_CAMERA;
	/** Frontend-owned static regional presentation state for every render frame. */
	#environment: ResolvedSceneEnvironment = DEFAULT_ENVIRONMENT;
	/** Frontend-selected dynamic display choices forwarded unchanged to each frame. */
	#frameSettings: FrameSettings = DEFAULT_FRAME_SETTINGS;
	/** Terrain interest constraining the frontend's effective distance-fog range. */
	#terrainFogCoverage: TerrainFogCoverage | null = null;
	/** Prevents new work and late async publication after runtime shutdown begins. */
	#destroyed = false;

	protected constructor(
		renderResources: RendererResourceManager,
		commitPipeline: CommitPipeline,
		dependencies: GameRuntimeDependencies,
	) {
		this.#terrainGenerator = dependencies.terrainGenerator;
		this.#geometry = new GeometryManager<ResourceOwnerId>(renderResources);
		this.#textures = new TextureManager<ResourceOwnerId>(
			renderResources,
			dependencies.texturePreparer,
		);
		this.#instances = new InstanceStreamManager(renderResources);
		this.#staticObjects = new StaticObjectSystem(
			this.#scene,
			this.#geometry,
			this.#textures,
			this.#instances,
		);
		this.#dynamics = new DynamicEntitySystem(
			this.#scene,
			this.#geometry,
			new InlineDynamicVisualPreparer(),
		);
		this.#envCells = new EnvCellSystem(this.#scene);
		this.#animation = new AnimationSystem(this.#dynamics);
		this.#terrain = new TerrainSystem<ResourceOwnerId, TerrainResourceOwnerId>(
			this.#scene,
			dependencies.terrainGenerator,
			this.#geometry,
			this.#textures,
			terrainSourceToOwnerId,
		);
		this.#renderWorld = new RenderWorld({
			dynamics: this.#dynamics,
			envCells: this.#envCells,
			geometry: this.#geometry,
			instances: this.#instances,
			objectDetail: {
				getBinding: () => this.#activeRegionDetail,
			},
			scene: this.#scene,
			staticObjects: this.#staticObjects,
			terrain: this.#terrain,
			textures: this.#textures,
		});
		this.#sceneInterestCoordinator = new SceneInterestCommitCoordinator(
			commitPipeline,
			{
				evict: ({ id, layer }) => this.#evictStaticLayer(id, layer),
				failed: ({ error, layer, revision }) =>
					this.#publishSceneAvailability({
						kind: "scene-content-failed",
						message: error instanceof Error ? error.message : String(error),
						residency: { envCellId: null, landblockId: layer.id },
						revision,
					}),
				prepared: ({ artifact, revision }) =>
					this.#commitArtifacts.push({ artifact, revision }),
				unavailable: ({ layer, revision }) =>
					this.#publishSceneAvailability({
						kind: "scene-content-failed",
						message: `No ${layer.layer} content is available for ${layer.id}.`,
						residency: { envCellId: null, landblockId: layer.id },
						revision,
					}),
			},
		);
	}

	/** Construct production runtime workers and inject them into runtime-owned systems. */
	static async build(
		device: GameRuntimeRenderDevice,
		commitPipeline: CommitPipeline,
		texturePixelSource: TexturePixelSource,
	): Promise<GameRuntime> {
		const [terrainGenerator, texturePreparer] = await Promise.all([
			InlineTerrainGenerator.build(),
			WorkerTexturePreparer.build(texturePixelSource),
		]);
		const runtime = new GameRuntime(device.resources, commitPipeline, {
			terrainGenerator,
			texturePreparer,
		});
		runtime.#renderer = await device.buildRenderer(runtime.#renderWorld);
		return runtime;
	}

	/** Construct runtime from explicit ports for focused integration tests. */
	static buildForTesting(
		renderResources: RendererResourceManager,
		commitPipeline: CommitPipeline,
		dependencies: GameRuntimeDependencies,
	): GameRuntime {
		return new GameRuntime(renderResources, commitPipeline, dependencies);
	}

	/** Replace frontend-owned static content interest without moving the camera. */
	updateSceneInterest(request: SceneInterestRequest): SceneInterestReceipt {
		validateLoDConfigOrThrow(request.lod);
		this.#terrainFogCoverage = {
			terrainRadius: request.lod.terrainRadius,
		};
		return this.#applySceneInterest(
			computeSceneInterest(request.anchorLandblockId, request.lod),
		);
	}

	/** Evict every frontend-requested static layer without moving the camera. */
	clearSceneInterest(): SceneInterestReceipt {
		this.#terrainFogCoverage = null;
		return this.#applySceneInterest(new Map());
	}

	/** Subscribe to source/topology availability without exposing runtime-owned resources. */
	subscribeSceneAvailability(listener: SceneAvailabilityListener): () => void {
		this.#sceneAvailabilityListeners.add(listener);
		return () => this.#sceneAvailabilityListeners.delete(listener);
	}

	/** Replace the authoritative primary camera without changing scene interest. */
	setPrimaryCamera(camera: Camera): void {
		const { position, rotation } = camera.placement;
		if (
			![position.x, position.y, position.z].every(Number.isFinite) ||
			![rotation.w, rotation.x, rotation.y, rotation.z].every(Number.isFinite)
		) {
			throw new Error("Primary camera placement must be finite.");
		}
		const anchorChanged =
			this.#camera.placement.landblockId !== camera.placement.landblockId;
		this.#camera = {
			far: camera.far,
			fov: camera.fov,
			near: camera.near,
			placement: {
				envCellId: camera.placement.envCellId,
				landblockId: camera.placement.landblockId,
				position: new Vec3(position.x, position.y, position.z),
				rotation: new Quat(rotation.w, rotation.x, rotation.y, rotation.z),
			},
		};
		if (anchorChanged) {
			this.#terrain.updateSceneBoundsForAnchor(camera.placement.landblockId);
		}
	}

	/** Replace the frontend-resolved environment without changing scene residency or interest. */
	setSceneEnvironment(environment: ResolvedSceneEnvironment): void {
		this.#environment = environment;
	}

	/** Replace frontend-selected dynamic display choices without altering world data. */
	setFrameSettings(settings: FrameSettings): void {
		this.#frameSettings = settings;
	}

	/** Return the renderer's latest cold frame-selection snapshot, when available. */
	getFrameSelectionMetrics(): FrameSelectionMetrics | null {
		return this.#renderer?.getFrameSelectionMetrics?.() ?? null;
	}

	/** Snapshot structured diagnostics for static-authored residents deferred pending dynamic activation. */
	getDeferredStaticDynamicDiagnostics(): readonly DeferredStaticDynamicDiagnostic[] {
		return [...this.#deferredStaticDynamics.values()].flat();
	}

	/** Snapshot app-local building lifecycle, resource, and atlas-arbitration diagnostics. */
	getBuildingRuntimeDiagnostics(): BuildingRuntimeDiagnostics {
		const staticObjects = this.#staticObjects.getDiagnostics();
		return {
			geometryResourceCount: this.#geometry.getResourceCount(),
			layers: [...this.#buildingLayerDiagnostics.values()].sort((left, right) =>
				left.landblockId.localeCompare(right.landblockId),
			),
			staticObjectNodeCount: staticObjects.nodeCount,
			staticObjectOwnerCount: staticObjects.ownerCount,
			texture: this.#textures.getDiagnostics(),
			textureAtlasPages: this.#textures.getAtlasPageDiagnostics(),
		};
	}

	/** Resolve one active atlas page's opaque resource for an explicit Explorer readback. */
	getTextureAtlasPageResource(pageId: TexturePageId): Texture2DResourceKey {
		return this.#textures.getAtlasPageResource(pageId);
	}

	/** Promote the already prepared regional building-detail binding into device ownership once. */
	installActiveRegionObjectDetail(
		binding: ActiveRegionObjectDetailBinding,
	): void {
		const owner = activeRegionResourceToOwnerId(binding.activeRegionKey);
		if (
			this.#activeRegionDetailOwner !== null &&
			this.#activeRegionDetailOwner !== owner
		) {
			this.#textures.dropOwner(this.#activeRegionDetailOwner);
		}
		this.#activeRegionDetailOwner = owner;
		this.#textures.installAssetTexture(owner, {
			height: binding.surface.height,
			key: binding.key,
			pixels: binding.surface.pixels,
			purpose: TexturePurpose.ObjectDetail,
			sourceAssetId: binding.sourceAssetId,
			width: binding.surface.width,
		});
		this.#activeRegionDetail = { key: binding.key, tiling: binding.tiling };
	}

	/** Resolve one canonical scene-space point against resident scene scopes. */
	queryWorldPointResidency(point: Vec3): SceneResidency | null {
		return this.#scene.queryWorldPointResidency(point);
	}

	/** Sample canonical outdoor terrain as soon as its source commits, before GPU realization. */
	queryOutdoorTerrainSurface(point: Vec3): TerrainSurfaceSample | null {
		return this.#terrain.querySurfaceAtWorldPoint(point);
	}

	/** Return installed environment-cell bounds for frontend-owned interior placement policy. */
	queryEnvCellBounds(residency: SceneResidency): AABB3 | null {
		return residency.envCellId === null
			? null
			: this.#scene.queryEnvCellBounds(residency.envCellId);
	}

	tick(): void {
		if (this.#destroyed) return;
		this.#drainCommitArtifacts();
		this.#animation.update();
	}

	/** Advance ordered runtime state and draw one frontend-scheduled frame. */
	frame(timeSeconds: number): void {
		if (this.#destroyed) throw new Error("Game runtime has been destroyed.");
		this.tick();
		this.render(timeSeconds);
	}

	/** Draw the current runtime state after a frontend-owned tick measurement. */
	render(timeSeconds: number): void {
		if (this.#destroyed) throw new Error("Game runtime has been destroyed.");
		const renderer = this.#renderer;
		if (!renderer) throw new Error("Game runtime has no renderer device.");
		const anchorLandblockId = this.#camera.placement.landblockId;
		renderer.drawFrame({
			anchorLandblockId,
			environment: {
				...this.#environment,
				distanceFog: resolveTerrainCoverageFog(
					this.#environment.distanceFog,
					this.#terrainFogCoverage,
				),
			},
			frameSettings: this.#frameSettings,
			timeSeconds,
			views: [{ camera: this.#camera }],
		});
	}

	updateDynamicEntityPlacement(
		entityId: string,
		placement: ScenePlacement,
	): boolean {
		void entityId;
		void placement;
		// Dynamic entity ownership is intentionally not materialized yet.
		return false;
	}

	async destroy(): Promise<void> {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#sceneInterestCoordinator.destroy();
		this.#commitArtifacts.length = 0;
		await this.#renderer?.destroy();
		this.#renderer = null;
		await this.#dynamics.destroy();
		this.#envCells.destroy();
		await this.#terrain.destroy();
		await this.#terrainGenerator.destroy();

		await this.#textures.destroy();
		this.#activeRegionDetail = null;
		this.#geometry.destroy();
		this.#instances.destroy();
	}

	#applySceneInterest(interest: SceneInterestMap): SceneInterestReceipt {
		return this.#sceneInterestCoordinator.reconcile(interest);
	}

	#drainCommitArtifacts(): void {
		while (this.#commitArtifacts.length > 0) {
			const pending = this.#commitArtifacts.shift();
			if (!pending) continue;
			const { artifact, revision } = pending;
			if (
				artifact.kind === CommitBundleSourceKind.LandblockLayer &&
				!this.#sceneInterestCoordinator.ownsDispatch(
					{ id: artifact.landblockId, layer: artifact.layer },
					revision,
				)
			) {
				continue;
			}
			if (artifact.kind === CommitBundleSourceKind.LandblockLayer) {
				this.#commitLandblockLayer(artifact, revision);
			} else {
				this.#commitSpawnedEntity(artifact);
			}
		}
	}

	#commitLandblockLayer(
		artifact: Extract<
			CommitBundle,
			{ kind: CommitBundleSourceKind.LandblockLayer }
		>,
		revision: SceneInterestRevision,
	): void {
		const ownerId = landblockLayerToOwnerId(
			artifact.landblockId,
			artifact.layer,
		);
		if (artifact.layer === LandblockLayerKind.Terrain) {
			this.#installTerrainLayer(ownerId, artifact);
			this.#publishSceneAvailability({
				kind: "outdoor-terrain-source-available",
				landblockId: artifact.landblockId,
				revision,
			});
			return;
		}
		if (artifact.layer === LandblockLayerKind.EnvCells) {
			this.#envCells.install(ownerId, artifact.commit.environment);
			for (const { scope } of artifact.commit.environment.scopes) {
				this.#publishSceneAvailability({
					kind: "env-cell-topology-available",
					residency: {
						envCellId: scope.envCellId,
						landblockId: scope.landblockId,
					},
					revision,
				});
			}
		}
		if (artifact.commit.staticObjects !== null) {
			this.#staticObjects.installObjects(
				ownerId,
				artifact.commit.staticObjects,
				artifact.layer,
			);
		}
		for (const dynamic of artifact.dynamicEntities) {
			this.#deferStaticAuthoredDynamic(
				ownerId,
				artifact.layer,
				artifact.landblockId,
				dynamic,
			);
		}
		if (
			artifact.layer === LandblockLayerKind.Buildings &&
			artifact.commit.diagnostics !== undefined
		) {
			this.#buildingLayerDiagnostics.set(ownerId, {
				...artifact.commit.diagnostics,
				landblockId: artifact.landblockId,
				runtimeDeferredResidentCount: artifact.dynamicEntities.length,
				staticArtifactInstalled: artifact.commit.staticObjects !== null,
			});
		}
	}

	#installTerrainLayer(
		ownerId: OwnerId,
		artifact: Extract<
			CommitBundle,
			{
				kind: CommitBundleSourceKind.LandblockLayer;
				layer: LandblockLayerKind.Terrain;
			}
		>,
	): void {
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

	#commitSpawnedEntity(
		artifact: Extract<CommitBundle, { kind: CommitBundleSourceKind.Spawned }>,
	): void {
		const ownerId = spawnedEntityToOwnerId(artifact.id);
		this.#installDynamic(
			ownerId,
			artifact.commit.placement.landblockId,
			artifact.commit,
		);
	}

	#installDynamic(
		ownerId: OwnerId,
		landblockId: LandblockId,
		dynamic: DynamicEntityCommit,
	): void {
		if (dynamic.placement.landblockId !== landblockId) {
			throw new Error(
				`Dynamic placement belongs to ${dynamic.placement.landblockId}, expected ${landblockId}.`,
			);
		}
		const nodeId = this.#dynamics.install(ownerId, dynamic);
		const pose = this.#dynamics.getPose(nodeId);
		if (!pose)
			throw new Error(`Installed dynamic ${nodeId} has no initial pose.`);
		this.#animation.install(ownerId, nodeId, pose);
	}

	#deferStaticAuthoredDynamic(
		ownerId: OwnerId,
		layer: LandblockLayerKind,
		landblockId: LandblockId,
		dynamic: DynamicEntityCommit,
	): void {
		if (dynamic.placement.landblockId !== landblockId) {
			throw new Error(
				`Deferred dynamic placement belongs to ${dynamic.placement.landblockId}, expected ${landblockId}.`,
			);
		}
		const diagnostic: DeferredStaticDynamicDiagnostic = {
			defaultAnimationId: dynamic.presentation.effects.animationId,
			landblockId,
			layer,
			reason: "setup-default-animation",
			residentId: dynamic.id,
			setupSourceId: dynamic.presentation.sourceAssetId,
		};
		const diagnostics = this.#deferredStaticDynamics.get(ownerId) ?? [];
		diagnostics.push(diagnostic);
		this.#deferredStaticDynamics.set(ownerId, diagnostics);
		log(
			{ kind: "static-authored-dynamic-deferred", ...diagnostic },
			LogLevel.Info,
		);
		// Future activation replaces this body with #installDynamic(ownerId, landblockId, dynamic).
	}

	#evictStaticLayer(landblockId: LandblockId, layer: LandblockLayerKind): void {
		const ownerId = landblockLayerToOwnerId(landblockId, layer);
		this.#staticObjects.removeOwner(ownerId);
		this.#deferredStaticDynamics.delete(ownerId);
		this.#buildingLayerDiagnostics.delete(ownerId);
		this.#animation.removeOwner(ownerId);
		this.#dynamics.removeOwner(ownerId);
		this.#envCells.removeOwner(ownerId);
		if (layer === LandblockLayerKind.Terrain) {
			this.#terrain.removeOwner(terrainSourceToOwnerId(landblockId));
		}
		this.#textures.dropOwner(ownerId);
		this.#geometry.dropOwner(ownerId);
	}

	#publishSceneAvailability(event: SceneAvailabilityEvent): void {
		for (const listener of this.#sceneAvailabilityListeners) listener(event);
	}
}

function createLandblockPlacement(landblockId: LandblockId): ScenePlacement {
	return {
		envCellId: null,
		landblockId,
		localTransform: Mat4.identity(),
	};
}
