import { sceneVec3, type SceneVec3 } from "../../assets/ac-frame";
import type { SkySourcePresentations } from "../../assets/decode-sky-record";
import {
	withPortalTransitionAudio,
	type PortalTransitionAssets,
	type PortalTransitionAudio,
} from "../../client/portal-transition-assets";
import {
	validatePortalTransitionPresentationPlan,
	type PortalTransitionPresentationPlan,
	type PortalTransitionPresentationReceipt,
} from "../../client/portal-transition-presentation";
import { prepareAnimation } from "../animation/animation-asset-repository";
import {
	advancePlayingFrame,
	clipEntryFrame,
	playingClip,
	type PlayingClip,
} from "../animation/animation-playback";
import { behaviorTargetId } from "../behavior/behavior-event-router";
import type { OutdoorLightIndex } from "../environment/outdoor-light-index";
import {
	UNAUTHORED_SCENE_LIGHTING,
	type ResolvedSceneEnvironment,
} from "../environment/scene-environment";
import {
	resolveTerrainCoverageFog,
	type TerrainFogCoverage,
} from "../environment/terrain-fog";
import { resolveViewerLightOrigin } from "../environment/viewer-light";
import type { DatAssetId } from "../game-types";
import type { GeometryManager } from "../geometry/geometry-manager";
import { createLandblockWorldOrigin } from "../landblocks";
import { transformAffineAABB3 } from "../math/matrices";
import { AABB3, Quat, Vec3 } from "../math/types";
import type { BakedDrawMergeCensus } from "../renderer/webgl2/baked-draw-merge-census";
import {
	resolveAmbientEntityOverlay,
	validateEntityOverlaySettings,
	validateHealthBarSettings,
	type EntityOverlayFrame,
	type EntityOverlayLookup,
	type EntityOverlayPresentation,
} from "../renderer/overlays/entity-overlay-policy";
import { validateEntitySelectionOutlineSettings } from "../renderer/overlays/entity-selection-outline-policy";
import {
	resolveNameplateCategory,
	validateNameplateSettings,
} from "../renderer/overlays/nameplate-policy";
import {
	resolveRenderExtent,
	validateRenderExtent,
	type RenderExtent,
} from "../renderer/render-extent";
import { RenderWorld } from "../renderer/render-world";
import type {
	EntitySelectionTarget,
	FrameSettings,
	OutdoorLightLookup,
	PortalTransitionFrame,
	Renderer,
	RendererFrameDiagnosticsSnapshot,
	RendererFrameFeedback,
	WorldIndicatorInput,
} from "../renderer/renderer";
import type { RuntimeLight } from "../environment/runtime-lights";
import {
	SceneGraph,
	type ResolvedScenePlacement,
	type SceneNodeId,
	type ScenePlacement,
} from "../scene";
import {
	selectionSphereFromBounds,
	usesSelectionSphereProxy,
} from "../selection/entity-interaction-shape";
import type {
	DynamicPresentationSource,
	NameplateContent,
} from "../systems/dynamic-presentation-source";
import type { DynamicEntitySystem } from "../systems/dynamic-entity-system";
import {
	objectVisualTemplateKey,
	type ObjectVisualTemplate,
	type ObjectVisualTemplateRepository,
	type ObjectVisualTemplateRepositoryDiagnostics,
} from "../systems/object-visual-template-repository";
import type { EnvCellSystem } from "../systems/env-cell-system";
import type { ParticleSystem } from "../systems/particle-system";
import type { StaticObjectSystem } from "../systems/static-object-system";
import type { OceanBackdrop } from "../terrain/ocean-backdrop";
import type { TerrainSystem } from "../terrain/terrain-system";
import type { AtlasRequirementHandle } from "../textures/atlas/resident-texture-atlas";
import type { TextureManager } from "../textures/texture-manager";
import type { TexturePreparer } from "../textures/texture-preparer";
import type { StaticDetailRole } from "../resolution/static-detail-role";
import type { AssetTextureKey } from "../textures/types";
import { dynamicEntityPresentationIdentity } from "./dynamic-entity-presentation";
import {
	PORTAL_TRANSITION_RESOURCE_OWNER_ID,
	type DynamicOwnerId,
	type DynamicPresentationResourceOwnerId,
	type OwnerId,
	type ResourceOwnerId,
	type TerrainResourceOwnerId,
} from "./owner-ids";
import { enrichPortalTransitionFrame } from "./portal-transition-frame";
import type {
	DesiredDynamicEntityRecord,
	DynamicEntityPresentationRecord,
} from "./runtime-spawned-entities";
import {
	summonOpacityAt,
	validateSummonPresentation,
	type SummonFlickerTuning,
	type SummonLeashInput,
	type SummonLeashTuning,
	type SummonVisualLevel,
} from "./summon-presentation";
import type { Camera, PrimaryCameraView } from "./types";

const DEFAULT_CAMERA: Camera = {
	near: 0.5,
	far: 800,
	fov: 90,
	placement: {
		envCellId: null,
		landblockId: "0xffffffff",
		position: sceneVec3(Vec3.zero()),
		rotation: Quat.identity(),
	},
};

const DEFAULT_ENVIRONMENT: ResolvedSceneEnvironment = {
	backgroundColor: { red: 0.15, green: 0.05, blue: 0.05, alpha: 1 },
	distanceFog: null,
	sky: null,
	lighting: UNAUTHORED_SCENE_LIGHTING,
};

/** Frame-hot realized identity and current rigid bound for entity indicators. */
export interface DynamicEntityPresentationFrame {
	readonly guid: number;
	/** Borrowed until the next dynamic presentation publication. */
	readonly localBounds: AABB3;
	/** Current flattened root placement, including any animated attachment ancestry. */
	readonly placement: ResolvedScenePlacement;
}

/** Why a mirror-retained entity identity can or cannot currently participate in tracking. */
export type DynamicEntityPresentationState =
	| {
			readonly kind: "realized";
			readonly frame: DynamicEntityPresentationFrame;
	  }
	| { readonly kind: "frontend-evicted" }
	| { readonly kind: "temporarily-unrealized" };

/** Runtime-owned authored portal closure and transition-resource diagnostics. */
export interface PortalTransitionRuntimeDiagnostics {
	/** Whether the required setup/animation/sound closure is installed. */
	readonly installed: boolean;
	/** Exact source envelopes, with null reserved for injected sources that cannot report bytes. */
	readonly sourceBytes: PortalTransitionAssets["sourceBytes"] | null;
	/** Direct playback cursor facts, or null before the closure is installed. */
	readonly animation: {
		/** Monotonic generation-local frame clock driving axial roll independently of clip laps. */
		readonly axialRollFramePosition: number;
		readonly frameCount: number;
		readonly framePosition: number;
		readonly framesPerSecond: number;
		/** Inclusive sequence end after retail's playback-window selection. */
		readonly highFrame: number;
		readonly id: DatAssetId;
		/** Inclusive sequence entry selected by retail portal playback. */
		readonly lowFrame: number;
		readonly partCount: number;
	} | null;
	/** Current transition edge and generation, or null while no transition is active. */
	readonly transition: {
		readonly generation: number;
		readonly kind: PortalTransitionPresentationPlan["kind"];
		readonly progress: number | null;
	} | null;
	/** Shared persistent resource totals; transition resources remain in renderer metrics. */
	readonly persistent: {
		/** CPU geometry allocations retained by ready dynamic and transition visual templates. */
		readonly templateGeometryBufferBytes: number;
		readonly geometryResourceBytes: number;
		readonly geometryResourceCount: number;
		readonly textureAtlasPageBytes: number;
		readonly textureAtlasPageCount: number;
		readonly textureSourceBytes: number;
	};
	/** Template preparation state and owner count for the shared visual repository. */
	readonly templates: ObjectVisualTemplateRepositoryDiagnostics;
	/** Number of retained portal closure resources (one template owner and three wave buffers). */
	readonly outstandingHandles: {
		readonly portalTemplateOwner: number;
		readonly portalWaveBuffers: number;
	};
}

export interface FramePresentationContext {
	readonly scene: SceneGraph;
	readonly geometry: GeometryManager<ResourceOwnerId>;
	readonly textures: TextureManager<ResourceOwnerId>;
	readonly texturePreparer: TexturePreparer;
	readonly frameSettings: FrameSettings;
	readonly oceanBackdrop: OceanBackdrop;
	readonly dynamics: DynamicEntitySystem<DynamicOwnerId, ResourceOwnerId>;
	readonly envCells: EnvCellSystem<OwnerId, ResourceOwnerId>;
	readonly staticObjects: StaticObjectSystem<OwnerId, ResourceOwnerId>;
	readonly terrain: TerrainSystem<ResourceOwnerId, TerrainResourceOwnerId>;
	readonly outdoorLights: OutdoorLightLookup & OutdoorLightIndex;
	readonly getDetailBinding: (
		role: StaticDetailRole,
	) => { readonly key: AssetTextureKey; readonly tiling: number } | null;
	readonly objectVisualTemplates: ObjectVisualTemplateRepository<
		DynamicPresentationResourceOwnerId,
		AtlasRequirementHandle<ResourceOwnerId>
	>;
	readonly particles: ParticleSystem;
	readonly isDestroyed: () => boolean;
	readonly triggerListenerLockedSound: (
		soundId: DatAssetId,
		volume?: number,
		probability?: number,
	) => void;
	readonly getDesiredEntity: (
		guid: number,
	) => DesiredDynamicEntityRecord | undefined;
	readonly getInstalledPresentation: (
		guid: number,
	) => DynamicEntityPresentationRecord | undefined;
	readonly getDesiredChildren: (
		guid: number,
	) => ReadonlySet<number> | undefined;
	readonly isEntityFrontendEvicted: (guid: number) => boolean;
	readonly getSpawnedEntityPlacement: (guid: number) => ScenePlacement | null;
}

/**
 * Owns camera/view/frame settings, entity overlays, selection/hover, summons,
 * and portal transition rendering.
 */
export class FramePresentationCoordinator {
	readonly #context: FramePresentationContext;
	/** Read-only renderer gateway over this runtime's scene and resource systems. */
	readonly #renderWorld: RenderWorld;
	/** Renderer constructed with this runtime's private read-only world facade. */
	#renderer: Renderer | null = null;
	/** Latest advanced frame time, so a mid-frame installation anchors to the current clock. */
	#lastFrameTimeSeconds = 0;
	/** Current primary-view input used for visibility and rendering. */
	#camera: Camera = DEFAULT_CAMERA;
	/** Exact drawing extent committed atomically with `#camera`, absent before first view sync. */
	#primaryViewExtent: RenderExtent | null = null;
	/** Frontend-owned static regional presentation state for every render frame. */
	#environment: ResolvedSceneEnvironment = DEFAULT_ENVIRONMENT;
	/** Frontend-selected dynamic display choices forwarded unchanged to each frame. */
	#frameSettings: FrameSettings;
	/** Additional lights borrowed from the active frontend scene driver. */
	#presentationLights: readonly RuntimeLight[] = [];
	/** Atomic frontend-resolved precise-jump marker and optional trajectory. */
	#worldIndicator: WorldIndicatorInput | null = null;
	/**
	 * Spawned entity driven by the viewer, or null while the camera is unbound.
	 *
	 * Held as an identity rather than a pose: the carrier is walking, and the scene is what
	 * presentation rate updates, so viewer-relative presentation resolves from live installed state
	 * every frame instead of from whatever the frontend last sampled.
	 */
	#viewerEntityGuid: number | null = null;
	/** Frontend-selected identity; realization is resolved lazily so streaming does not clear it. */
	#selectedEntityGuid: number | null = null;
	/** Frontend hover identity, resolved against current realization at draw time. */
	#hoveredEntityGuid: number | null = null;
	/** App-owned decoration survives realization; name and level always come from current authority. */
	readonly #spawnedNameplateDecoration = new Map<
		number,
		Pick<NameplateContent, "indicators" | "strikeThrough" | "nameColor">
	>();
	/**
	 * Explicit scene-driver overlay policy. Explorer defaults to ambient; pregame and gameplay
	 * install their own frames on handoff and never fall back between them.
	 */
	#entityOverlayFrame: EntityOverlayFrame = { kind: "ambient" };
	/** Synchronous per-node overlay lookup refreshed immediately before `renderer.drawFrame()`. */
	readonly #resolvedNodeOverlays = new Map<
		SceneNodeId,
		EntityOverlayPresentation
	>();
	readonly #resolvedOverlayLookup: EntityOverlayLookup = {
		presentation: (nodeId) => this.#resolvedNodeOverlays.get(nodeId) ?? null,
	};
	/** Semantic relationship levels are cold; endpoint and opacity preparation is frame-owned. */
	readonly #summonVisuals = new Map<number, SummonVisualLevel>();
	#summonTuning: {
		readonly leash: SummonLeashTuning;
		readonly flicker: SummonFlickerTuning;
	} | null = null;
	readonly #summonLeashes: SummonLeashInput[] = [];
	readonly #summonLeashStorage: {
		-readonly [Key in keyof SummonLeashInput]: SummonLeashInput[Key];
	}[] = [];
	readonly #summonBoundsScratch = AABB3.zero();
	/** Presentation-only transition input consumed by the renderer's final-frame compositor. */
	#portalTransition: PortalTransitionPresentationPlan | undefined;
	/** Installed authored visual or an explicitly selected opaque loading surface. */
	#portalAssets:
		| { readonly kind: "uninitialized" }
		| { readonly kind: "unavailable" }
		| {
				readonly kind: "ready";
				readonly assets: PortalTransitionAssets;
				readonly clip: PlayingClip;
		  } = { kind: "uninitialized" };
	/** Authored 40fps traversal sampled at render cadence for the portal's setup and sound hooks. */
	#portalTransitionFramePosition = 0;
	/** Monotonic roll clock; unlike the authored clip cursor, this never laps at frame 119. */
	#portalTransitionAxialRollFramePosition = 0;
	#portalTransitionAnimationGeneration: number | null = null;
	#portalTransitionLastTimeSeconds: number | null = null;

	constructor(context: FramePresentationContext) {
		validateNameplateSettings(context.frameSettings.nameplates);
		validateEntitySelectionOutlineSettings(
			context.frameSettings.entitySelectionOutline,
		);
		this.#context = context;
		this.#frameSettings = context.frameSettings;
		this.#renderWorld = new RenderWorld({
			oceanBackdrop: context.oceanBackdrop,
			dynamics: context.dynamics,
			envCells: context.envCells,
			geometry: context.geometry,
			staticDetails: {
				getBinding: (role) => context.getDetailBinding(role),
			},
			scene: context.scene,
			staticObjects: context.staticObjects,
			terrain: context.terrain,
			textures: context.textures,
		});
	}

	get renderWorld(): RenderWorld {
		return this.#renderWorld;
	}

	get renderer(): Renderer | null {
		return this.#renderer;
	}

	setRenderer(renderer: Renderer): void {
		this.#renderer = renderer;
	}

	get lastFrameTimeSeconds(): number {
		return this.#lastFrameTimeSeconds;
	}

	setLastFrameTimeSeconds(timeSeconds: number): void {
		this.#lastFrameTimeSeconds = timeSeconds;
	}

	get cameraPosition(): {
		readonly x: number;
		readonly y: number;
		readonly z: number;
	} {
		return this.#camera.placement.position;
	}

	get environment(): ResolvedSceneEnvironment {
		return this.#environment;
	}

	get frameSettings(): FrameSettings {
		return this.#frameSettings;
	}

	get protectedEntityGuids(): {
		readonly viewer: number | null;
		readonly selected: number | null;
		readonly hovered: number | null;
	} {
		return {
			viewer: this.#viewerEntityGuid,
			selected: this.#selectedEntityGuid,
			hovered: this.#hoveredEntityGuid,
		};
	}

	getNameplateDecoration(
		guid: number,
	):
		| Pick<NameplateContent, "indicators" | "strikeThrough" | "nameColor">
		| undefined {
		return this.#spawnedNameplateDecoration.get(guid);
	}

	deleteNameplateDecoration(guid: number): void {
		this.#spawnedNameplateDecoration.delete(guid);
	}

	invalidateResolvedResources(
		reason: "atlas-publication" | "region-static-detail",
	): void {
		this.#renderer?.invalidateResolvedResources?.(reason);
	}

	resetUnavailablePortalAssets(): void {
		if (this.#portalAssets.kind === "unavailable")
			this.#portalAssets = { kind: "uninitialized" };
	}

	usesSelectionSphereProxy(nodeId: SceneNodeId): boolean {
		return this.#usesSelectionSphereProxy(nodeId);
	}

	requireRenderer(): Renderer {
		const renderer = this.#renderer;
		if (!renderer) throw new Error("Game runtime has no renderer device.");
		return renderer;
	}

	requirePrimaryViewExtent(): RenderExtent {
		const extent = this.#primaryViewExtent;
		if (extent === null) {
			throw new Error("Game runtime has no committed primary camera view.");
		}
		return extent;
	}

	/** Replace only app-local relationship/effect policy; authoritative entity state is untouched. */
	setSummonVisuals(
		levels: readonly SummonVisualLevel[],
		tuning: {
			readonly leash: SummonLeashTuning;
			readonly flicker: SummonFlickerTuning;
		},
	): void {
		validateSummonPresentation(levels, tuning.leash, tuning.flicker);
		for (const guid of this.#summonVisuals.keys())
			this.#setSummonOpacity(guid, 1);
		this.#summonVisuals.clear();
		for (const level of levels) this.#summonVisuals.set(level.guid, level);
		this.#summonTuning = tuning;
		this.#summonLeashes.length = 0;
	}

	/** Replace app-owned decoration without copying authoritative name or level facts. */
	setDynamicEntityNameplateDecoration(
		guid: number,
		decoration: Pick<
			NameplateContent,
			"indicators" | "strikeThrough" | "nameColor"
		>,
	): void {
		if (
			decoration.indicators.length === 0 &&
			!decoration.strikeThrough &&
			decoration.nameColor === undefined
		)
			this.#spawnedNameplateDecoration.delete(guid);
		else this.#spawnedNameplateDecoration.set(guid, decoration);
		const installed = this.#context.getInstalledPresentation(guid);
		const desired = this.#context.getDesiredEntity(guid);
		if (installed !== undefined && desired !== undefined)
			this.#context.dynamics.updateNameplateContent(installed.nodeId, {
				...desired.entity.display,
				...decoration,
			});
	}

	/**
	 * Install the active scene driver's entity overlay frame.
	 *
	 * When `frame.kind === "resolved"`, the caller's entity map is borrowed synchronously through
	 * the next `render()` call and must not be mutated during rendering.
	 */
	setEntityOverlayFrame(frame: EntityOverlayFrame): void {
		this.#entityOverlayFrame = frame;
	}

	/** Resolve a candidate viewport before camera policy decides whether it may become active. */
	resolveViewportExtent(cssWidth: number, cssHeight: number): RenderExtent {
		return resolveRenderExtent(
			cssWidth,
			cssHeight,
			this.#frameSettings.quality.renderScale,
		);
	}

	/** Replace mode-owned point lights; the driver clears them before handing the world over. */
	setPresentationLights(lights: readonly RuntimeLight[]): void {
		if (this.#context.isDestroyed())
			throw new Error("Cannot set lights after runtime shutdown.");
		this.#presentationLights = lights;
	}

	/** Replace the authoritative primary camera and its exact drawing extent atomically. */
	setPrimaryView(view: PrimaryCameraView): void {
		const { camera, extent } = view;
		const { position, rotation } = camera.placement;
		if (
			![position.x, position.y, position.z].every(Number.isFinite) ||
			![rotation.w, rotation.x, rotation.y, rotation.z].every(Number.isFinite)
		) {
			throw new Error("Primary camera placement must be finite.");
		}
		validateRenderExtent(extent, "Primary camera view");
		this.#camera = {
			far: camera.far,
			fov: camera.fov,
			near: camera.near,
			placement: {
				envCellId: camera.placement.envCellId,
				landblockId: camera.placement.landblockId,
				position: sceneVec3(new Vec3(position.x, position.y, position.z)),
				rotation: new Quat(rotation.w, rotation.x, rotation.y, rotation.z),
			},
		};
		this.#primaryViewExtent = { ...extent };
	}

	/** Replace the complete presentation-only world indicator without touching scene authority. */
	setWorldIndicator(indicator: WorldIndicatorInput | null): void {
		this.#worldIndicator = indicator;
	}

	/** Replace the frontend-resolved environment without changing scene residency or interest. */
	setSceneEnvironment(environment: ResolvedSceneEnvironment): void {
		this.#environment = environment;
	}

	/**
	 * Make the active region's celestial sky resident.
	 *
	 * Region-scoped like terrain and landblock layers, so the runtime owns it: it already holds the
	 * texture-preparation port and the renderer the sky needs. A backend without a sky capability
	 * simply resolves without one rather than failing the region load.
	 */
	async installSky(source: SkySourcePresentations): Promise<void> {
		await this.#renderer?.sky?.install(source, this.#context.texturePreparer);
	}

	/** Replace frontend-selected dynamic display choices without altering world data. */
	setFrameSettings(settings: FrameSettings): void {
		validateEntityOverlaySettings(settings.entityOverlays);
		validateNameplateSettings(settings.nameplates);
		validateHealthBarSettings(settings.healthBars);
		validateEntitySelectionOutlineSettings(settings.entitySelectionOutline);
		this.#frameSettings = settings;
	}

	/** Update the app-local portal compositor state without touching authority or scene demand. */
	setPortalTransition(
		transition: PortalTransitionPresentationPlan | undefined,
	): void {
		if (transition === undefined) {
			this.#portalTransition = undefined;
			this.#portalTransitionAnimationGeneration = null;
			this.#portalTransitionFramePosition = 0;
			this.#portalTransitionAxialRollFramePosition = 0;
			this.#portalTransitionLastTimeSeconds = null;
			return;
		}
		validatePortalTransitionPresentationPlan(transition);
		this.#portalTransition = transition;
	}

	/** Play one of the validated head-locked sounds authored for the portal transition. */
	playPortalTransitionSound(kind: "enter" | "exit"): void {
		if (this.#portalAssets.kind === "unavailable") return;
		if (this.#portalAssets.kind === "uninitialized")
			throw new Error("Portal transition audio is not installed.");
		const assets = this.#portalAssets.assets;
		const soundId =
			kind === "enter"
				? assets.catalog.enterSoundId
				: assets.catalog.exitSoundId;
		if (assets.waveIds.includes(soundId))
			this.#context.triggerListenerLockedSound(soundId);
	}

	/** Explicit retry replaces only failed audio readiness; the installed tunnel lease stays valid. */
	updatePortalTransitionAudio(audio: PortalTransitionAudio): void {
		if (this.#portalAssets.kind !== "ready")
			throw new Error(
				"Portal audio update requires an installed authored visual.",
			);
		this.#portalAssets = {
			...this.#portalAssets,
			assets: withPortalTransitionAudio(this.#portalAssets.assets, audio),
		};
	}

	/**
	 * Install the validated setup, animation, and audio closure into shared runtime residency.
	 *
	 * The portal is not a dynamic scene entity: it owns one stable template lease and one direct
	 * animation cursor. Sharing the template repository still gives it the exact geometry/atlas
	 * lifetime and rollback guarantees used by ordinary dynamics without inventing a fake behavior
	 * target or scene placement.
	 */
	async installPortalTransitionAssets(
		assets: PortalTransitionAssets | null,
	): Promise<void> {
		if (this.#context.isDestroyed())
			throw new Error(
				"Cannot install portal transition assets after runtime shutdown.",
			);
		if (this.#portalAssets.kind !== "uninitialized")
			throw new Error("Portal transition assets are already installed.");
		if (assets === null) {
			this.#portalAssets = { kind: "unavailable" };
			return;
		}
		const setupId = assets.visual.setupId;
		if (setupId === null)
			throw new Error("Portal transition visual has no setup identity.");
		const animation = prepareAnimation(
			assets.animation,
			assets.catalog.animationId,
			assets.catalog.animationFramesPerSecond,
		);
		const source: DynamicPresentationSource = {
			entityClass: "other",
			nameplate: null,
			behavior: assets.visual.behavior,
			identity: "portal-transition",
			localBounds: assets.visual.localBounds,
			presentation: assets.visual.presentation,
			placementFrame: 0,
			scale: new Vec3(1, 1, 1),
			setupId: setupId as DatAssetId,
		};
		const staged = this.#context.objectVisualTemplates.stageOwner([source]);
		let template: ObjectVisualTemplate;
		try {
			const templates = await staged.completion;
			const prepared = templates.get(objectVisualTemplateKey(source));
			if (!prepared)
				throw new Error(
					`Portal transition template ${objectVisualTemplateKey(source)} was not prepared.`,
				);
			template = prepared;
			staged.commit(PORTAL_TRANSITION_RESOURCE_OWNER_ID);
		} catch (cause) {
			staged.release();
			throw cause;
		}
		try {
			// Portal space remains an ordinary per-part consumer, outside dynamic entity submission.
			// Its owner must retain those buffers explicitly; shared dynamic templates lease only
			// merged vertices and do not implicitly keep the original part GPU resources alive.
			this.#context.geometry.replaceOwner(
				PORTAL_TRANSITION_RESOURCE_OWNER_ID,
				template.parts.map((part) => ({
					key: part.geometry,
					geometry: part.geometryData,
				})),
			);
			this.#renderer?.installPortalTransitionVisual?.({
				animation,
				lowFrame: assets.catalog.animationLowFrame,
				template,
			});
		} catch (cause) {
			this.#context.geometry.dropOwner(PORTAL_TRANSITION_RESOURCE_OWNER_ID);
			this.#context.objectVisualTemplates.dropOwner(
				PORTAL_TRANSITION_RESOURCE_OWNER_ID,
			);
			throw cause;
		}
		this.#portalAssets = {
			kind: "ready",
			assets,
			clip: playingClip(
				animation,
				assets.catalog.animationLowFrame,
				animation.frameCount - 1,
				assets.catalog.animationFramesPerSecond,
				"loop",
			),
		};
	}

	/**
	 * Nominate the spawned entity driven by the viewer; null returns control to the camera.
	 *
	 * Only the frontend knows whether the viewer is driving a body at all, which is the same split
	 * retail has: `SmartBox` nominates, and the renderer places what it is given.
	 */
	setViewerEntity(guid: number | null): void {
		this.#viewerEntityGuid = guid;
	}

	/** Set the cold selected identity without coupling authority or realization lifetime to it. */
	setSelectedEntityGuid(guid: number | null): void {
		this.#selectedEntityGuid = guid;
	}

	/** Hover affects nameplate admission and visibility, never authoritative selection. */
	setHoveredEntityGuid(guid: number | null): void {
		this.#hoveredEntityGuid = guid;
	}

	/** Distinguish explicit scene-interest eviction from recoverable realization gaps. */
	dynamicEntityPresentationState(guid: number): DynamicEntityPresentationState {
		if (this.#context.isEntityFrontendEvicted(guid))
			return { kind: "frontend-evicted" };
		const frame = this.#dynamicEntityFrame(guid);
		return frame === null
			? { kind: "temporarily-unrealized" }
			: { frame, kind: "realized" };
	}

	/** Return one consistent read of the active renderer's optional diagnostics capability. */
	getRendererFrameDiagnostics(): RendererFrameDiagnosticsSnapshot | null {
		return this.#renderer?.frameDiagnostics?.snapshot() ?? null;
	}

	/** Size how far the next frame's baked object draws could merge, for partitioning decisions. */
	captureBakedDrawMergeCensus(): Promise<BakedDrawMergeCensus> {
		const diagnostics = this.#renderer?.frameDiagnostics;
		if (!diagnostics) {
			throw new Error("Renderer does not support a baked draw merge census.");
		}
		return diagnostics.captureBakedDrawMergeCensus();
	}

	/** Snapshot the required portal closure without exposing mutable renderer or repository state. */
	getPortalTransitionDiagnostics(): PortalTransitionRuntimeDiagnostics {
		const assets =
			this.#portalAssets.kind === "ready" ? this.#portalAssets.assets : null;
		const clip =
			this.#portalAssets.kind === "ready" ? this.#portalAssets.clip : null;
		const transition = this.#portalTransition;
		const texture = this.#context.textures.getDiagnostics();
		const templates = this.#context.objectVisualTemplates.getDiagnostics();
		return {
			animation:
				assets === null || clip === null
					? null
					: {
							axialRollFramePosition:
								this.#portalTransitionAxialRollFramePosition,
							frameCount: clip.animation.frameCount,
							framePosition: this.#portalTransitionFramePosition,
							framesPerSecond: clip.framesPerSecond,
							highFrame: clip.highFrame,
							id: clip.animation.id,
							lowFrame: clip.lowFrame,
							partCount: clip.animation.partCount,
						},
			installed: assets !== null,
			outstandingHandles: {
				portalTemplateOwner: assets === null ? 0 : 1,
				portalWaveBuffers: assets?.waveIds.length ?? 0,
			},
			persistent: {
				templateGeometryBufferBytes: templates.retainedGeometryBufferBytes,
				geometryResourceBytes: this.#context.geometry.getResourceBytes(),
				geometryResourceCount: this.#context.geometry.getResourceCount(),
				textureAtlasPageBytes: texture.activeAtlasPageBytes,
				textureAtlasPageCount: texture.activeAtlasPages,
				textureSourceBytes: texture.residentSourceBytes,
			},
			sourceBytes: assets?.sourceBytes ?? null,
			templates,
			transition:
				transition === undefined
					? null
					: {
							generation: transition.generation,
							kind: transition.kind,
							progress:
								transition.kind === "origin-to-tunnel" ||
								transition.kind === "tunnel-to-destination"
									? transition.progress
									: null,
						},
		};
	}

	/** Draw the current runtime state after a frontend-owned tick measurement. */
	renderPortalTransition(
		timeSeconds: number,
		extent: RenderExtent,
	): PortalTransitionPresentationReceipt | null {
		if (this.#context.isDestroyed())
			throw new Error("Game runtime has been destroyed.");
		const renderer = this.requireRenderer();
		const loadingReceipt = this.#presentOpaquePortalLoading();
		if (loadingReceipt !== null) return loadingReceipt;
		const portalTransition = this.#advancePortalTransition(timeSeconds);
		if (portalTransition === undefined) {
			throw new Error("Portal-space-only frame has no active transition.");
		}
		this.#lastFrameTimeSeconds = timeSeconds;
		if (
			portalTransition.kind !== "origin-to-tunnel" &&
			portalTransition.kind !== "tunnel-only"
		) {
			throw new Error(
				`Portal-only rendering cannot present ${portalTransition.kind}.`,
			);
		}
		return renderer.drawPortalTransitionFrame({
			extent,
			frameSettings: this.#frameSettings,
			portalTransition,
		});
	}

	clearPresentation(): void {
		if (this.#context.isDestroyed())
			throw new Error("Game runtime has been destroyed.");
		this.requireRenderer().clearPresentation();
	}

	advancePortalTransition(
		timeSeconds: number,
	): PortalTransitionFrame | undefined {
		return this.#advancePortalTransition(timeSeconds);
	}

	presentOpaquePortalLoading(): PortalTransitionPresentationReceipt | null {
		return this.#presentOpaquePortalLoading();
	}

	drawSceneFrame(
		renderer: Renderer,
		extent: RenderExtent,
		timeSeconds: number,
		portalTransition: PortalTransitionFrame | undefined,
		fogCoverage: TerrainFogCoverage | null,
	): RendererFrameFeedback {
		const anchorLandblockId = this.#camera.placement.landblockId;
		const summonLeashes = this.#prepareSummons(timeSeconds);
		this.#resolveNodeEntityOverlays();
		return renderer.drawFrame({
			anchorLandblockId,
			dynamicLights:
				this.#presentationLights.length === 0
					? this.#context.dynamics.getRuntimeLights()
					: [
							...this.#context.dynamics.getRuntimeLights(),
							...this.#presentationLights,
						],
			environment: {
				...this.#environment,
				distanceFog: resolveTerrainCoverageFog(
					this.#environment.distanceFog,
					fogCoverage,
				),
			},
			extent,
			frameSettings: this.#frameSettings,
			portalTransition,
			outdoorLights: this.#context.outdoorLights,
			selectionTarget: this.#selectedEntityRenderTarget(),
			entityOverlays: this.#resolvedOverlayLookup,
			timeSeconds,
			viewerLightOrigin: resolveViewerLightOrigin(
				this.#viewerEntityGuid === null
					? null
					: this.#context.getSpawnedEntityPlacement(this.#viewerEntityGuid),
				this.#camera.placement.position,
			),
			viewerEntityIdentity: this.#viewerEntityIdentity(),
			views: [
				{
					camera: this.#camera,
					cameraInsideSealedCell: this.#cameraInsideSealedCell(),
				},
			],
			worldIndicator: this.#worldIndicator,
			summonLeashes,
		});
	}

	clearSyncPresentationState(): void {
		this.#spawnedNameplateDecoration.clear();
		this.#resolvedNodeOverlays.clear();
		this.#entityOverlayFrame = { kind: "ambient" };
		this.#presentationLights = [];
	}

	clearPortalState(): void {
		this.#portalAssets = { kind: "uninitialized" };
		this.#portalTransitionAnimationGeneration = null;
		this.#portalTransitionFramePosition = 0;
		this.#portalTransitionAxialRollFramePosition = 0;
		this.#portalTransitionLastTimeSeconds = null;
	}

	destroyRenderer(): Promise<void> | undefined {
		const renderer = this.#renderer;
		this.#renderer = null;
		return renderer?.destroy();
	}

	/** Attachment children share the root's cosmetic opacity while retaining their own effects. */
	#setSummonOpacity(guid: number, opacity: 0 | 1): void {
		const installed = this.#context.getInstalledPresentation(guid);
		if (installed !== undefined)
			this.#context.dynamics.setPresentationOpacity(installed.nodeId, opacity);
		for (const child of this.#context.getDesiredChildren(guid) ?? [])
			this.#setSummonOpacity(child, opacity);
	}

	/** Resolve a body-relative point from the same composed pose used by rendering. */
	#summonEndpoint(guid: number, target: SceneVec3, halfExtents: Vec3): boolean {
		const desired = this.#context.getDesiredEntity(guid)?.entity;
		const installed = this.#context.getInstalledPresentation(guid);
		if (
			desired === undefined ||
			installed === undefined ||
			this.#context.isEntityFrontendEvicted(guid) ||
			desired.physics.noDraw ||
			desired.physics.hidden ||
			desired.physics.cloaked
		)
			return false;
		const bounds = this.#context.dynamics.getPublishedRigidPresentationBounds(
			installed.nodeId,
		);
		const state = this.#context.scene.readResolvedState(installed.nodeId);
		if (bounds === null || state === undefined) return false;
		// Pose bounds exclude particle reach. Transform once into a reusable scene-axis box.
		const posed = transformAffineAABB3(
			state.placement.localToLandblock,
			bounds,
			this.#summonBoundsScratch,
		);
		target.x = (posed.min.x + posed.max.x) / 2;
		target.y = (posed.min.y + posed.max.y) / 2;
		target.z = (posed.min.z + posed.max.z) / 2;
		halfExtents.x = (posed.max.x - posed.min.x) / 2;
		halfExtents.y = (posed.max.y - posed.min.y) / 2;
		halfExtents.z = (posed.max.z - posed.min.z) / 2;
		const origin = createLandblockWorldOrigin(state.placement.landblockId);
		target.x += origin.x;
		target.y += origin.y;
		target.z += origin.z;
		return true;
	}

	/** Reuse endpoint records across frames; each view converts their canonical positions itself. */
	#prepareSummons(timeSeconds: number): readonly SummonLeashInput[] {
		this.#summonLeashes.length = 0;
		const tuning = this.#summonTuning;
		if (tuning === null) return this.#summonLeashes;
		for (const level of this.#summonVisuals.values()) {
			const entity = this.#context.getDesiredEntity(level.guid)?.entity;
			if (entity === undefined || entity.generation !== level.generation)
				continue;
			const opacity = summonOpacityAt(
				timeSeconds,
				level.expiresAtSeconds,
				tuning.flicker,
			);
			this.#setSummonOpacity(level.guid, opacity);
			// The relationship shares the body's phase; faded frames submit neither visual.
			const relationship = level.leash;
			if (opacity === 0 || relationship === null) continue;
			const index = this.#summonLeashes.length;
			let leash = this.#summonLeashStorage[index];
			if (leash === undefined) {
				leash = {
					start: sceneVec3(Vec3.zero()),
					end: sceneVec3(Vec3.zero()),
					startHalfExtents: Vec3.zero(),
					endHalfExtents: Vec3.zero(),
					timeSeconds,
					color: relationship.color,
					tuning: tuning.leash,
				};
				this.#summonLeashStorage.push(leash);
			}
			if (
				!this.#summonEndpoint(
					level.guid,
					leash.start,
					leash.startHalfExtents,
				) ||
				!this.#summonEndpoint(
					relationship.owner,
					leash.end,
					leash.endHalfExtents,
				) ||
				leash.start.distanceSquaredTo(leash.end) >=
					tuning.leash.maximumDistance ** 2
			)
				continue;
			leash.timeSeconds = timeSeconds;
			leash.color = relationship.color;
			leash.tuning = tuning.leash;
			this.#summonLeashes.push(leash);
		}
		return this.#summonLeashes;
	}

	/** Advance the direct portal animation cursor and dispatch only its authored sound hooks. */
	#advancePortalTransition(
		timeSeconds: number,
	): PortalTransitionFrame | undefined {
		const transition = this.#portalTransition;
		if (this.#portalAssets.kind === "unavailable") {
			return transition?.kind === "destination-only-awaiting-handoff"
				? transition
				: undefined;
		}
		const clip =
			this.#portalAssets.kind === "ready" ? this.#portalAssets.clip : null;
		if (
			transition === undefined ||
			transition.kind === "destination-only-awaiting-handoff"
		) {
			this.#portalTransitionAnimationGeneration = null;
			this.#portalTransitionFramePosition = 0;
			this.#portalTransitionAxialRollFramePosition = 0;
			this.#portalTransitionLastTimeSeconds = null;
			return transition;
		}
		if (clip === null) {
			throw new Error(
				"Portal transition plan requires an installed tunnel clip.",
			);
		}
		if (this.#portalTransitionAnimationGeneration !== transition.generation) {
			this.#portalTransitionAnimationGeneration = transition.generation;
			this.#portalTransitionFramePosition = clipEntryFrame(clip);
			this.#portalTransitionAxialRollFramePosition = 0;
			this.#portalTransitionLastTimeSeconds = timeSeconds;
		} else {
			const previous = this.#portalTransitionLastTimeSeconds ?? timeSeconds;
			const elapsedSeconds = Math.max(0, timeSeconds - previous);
			const advanced = advancePlayingFrame(
				clip,
				this.#portalTransitionFramePosition,
				elapsedSeconds,
			);
			this.#portalTransitionFramePosition = advanced.framePosition;
			this.#portalTransitionAxialRollFramePosition +=
				elapsedSeconds * Math.abs(clip.framesPerSecond);
			this.#portalTransitionLastTimeSeconds = timeSeconds;
			this.#dispatchPortalAnimationHooks(advanced.departedFrames);
		}
		return enrichPortalTransitionFrame(transition, {
			// This is deliberately fractional: the renderer samples it at the display cadence rather
			// than rounding to the 40 authored frames-per-second ticks.
			animationFramePosition: this.#portalTransitionFramePosition,
			axialRollFramePosition: this.#portalTransitionAxialRollFramePosition,
		});
	}

	#dispatchPortalAnimationHooks(departedFrames: readonly number[]): void {
		if (this.#portalAssets.kind !== "ready")
			throw new Error("Portal hooks require an installed authored animation.");
		const { assets, clip } = this.#portalAssets;
		const animation = clip.animation;
		for (const frameIndex of departedFrames) {
			for (const hook of animation.hooks) {
				if (
					hook.frameIndex !== frameIndex ||
					(hook.direction !== "both" && hook.direction !== "forward") ||
					hook.kind !== "sound-tweaked" ||
					!assets.waveIds.includes(hook.soundId)
				) {
					continue;
				}
				this.#context.triggerListenerLockedSound(
					hook.soundId,
					hook.volume,
					hook.probability,
				);
			}
		}
	}

	/** Opaque output is a real loading proof, never a fabricated authored-tunnel receipt. */
	#presentOpaquePortalLoading(): PortalTransitionPresentationReceipt | null {
		const transition = this.#portalTransition;
		if (
			this.#portalAssets.kind !== "unavailable" ||
			transition === undefined ||
			transition.kind === "destination-only-awaiting-handoff"
		)
			return null;
		this.clearPresentation();
		return { kind: "opaque-loading", generation: transition.generation };
	}

	#dynamicEntityFrame(guid: number): DynamicEntityPresentationFrame | null {
		const nodeId = this.#context.getInstalledPresentation(guid)?.nodeId ?? null;
		if (nodeId === null) return null;
		const localBounds =
			this.#context.dynamics.getPublishedRigidPresentationBounds(nodeId);
		const placement = this.#context.scene.getResolvedPlacement(nodeId);
		return localBounds === null || placement === undefined
			? null
			: {
					guid,
					localBounds,
					placement,
				};
	}

	/** Resolve one selected root and the same interaction shape policy used by exact picking. */
	#selectedEntityRenderTarget(): EntitySelectionTarget | null {
		if (this.#selectedEntityGuid === null) return null;
		const installed = this.#context.getInstalledPresentation(
			this.#selectedEntityGuid,
		);
		if (
			installed === undefined ||
			this.#context.dynamics.getPresentationOpacity(installed.nodeId) === 0
		)
			return null;
		const frame = this.#dynamicEntityFrame(this.#selectedEntityGuid);
		if (frame === null) return null;
		return {
			nodeId: installed.nodeId,
			shape: this.#usesSelectionSphereProxy(installed.nodeId)
				? {
						kind: "sphere-proxy",
						placement: frame.placement,
						sphere: selectionSphereFromBounds(frame.localBounds),
					}
				: { kind: "rigid" },
		};
	}

	/** Runtime-owned dynamic policy; static morphology and emitter membership are each O(1). */
	#usesSelectionSphereProxy(nodeId: SceneNodeId): boolean {
		const morphology =
			this.#context.dynamics.getSelectionGeometryMorphology(nodeId);
		if (morphology === null)
			throw new Error(`Dynamic entity ${nodeId} has no selection morphology.`);
		return usesSelectionSphereProxy(
			morphology,
			this.#context.particles.hasEmitterOwner(behaviorTargetId(nodeId)),
		);
	}

	/** Resolve the driven entity's installed generation to the renderer's stable identity. */
	#viewerEntityIdentity(): string | null {
		if (this.#viewerEntityGuid === null) return null;
		const desired = this.#context.getDesiredEntity(this.#viewerEntityGuid);
		const installed = this.#context.getInstalledPresentation(
			this.#viewerEntityGuid,
		);
		if (
			desired === undefined ||
			installed === undefined ||
			desired.entity.generation !== installed.generation
		)
			return null;
		return dynamicEntityPresentationIdentity(
			this.#viewerEntityGuid,
			installed.generation,
		);
	}

	#resolveInstalledNodeId(guid: number | null): SceneNodeId | null {
		if (guid === null) return null;
		const desired = this.#context.getDesiredEntity(guid);
		const installed = this.#context.getInstalledPresentation(guid);
		if (
			desired === undefined ||
			installed === undefined ||
			desired.entity.generation !== installed.generation
		)
			return null;
		return installed.nodeId;
	}

	#resolveNodeEntityOverlays(): void {
		this.#resolvedNodeOverlays.clear();
		if (this.#entityOverlayFrame.kind === "resolved") {
			for (const [guid, entry] of this.#entityOverlayFrame.entities) {
				const desired = this.#context.getDesiredEntity(guid);
				const installed = this.#context.getInstalledPresentation(guid);
				if (
					desired === undefined ||
					installed === undefined ||
					desired.entity.generation !== installed.generation ||
					entry.generation !== installed.generation
				)
					continue;
				if (
					entry.presentation.nameplate === null &&
					entry.presentation.healthBar === null
				)
					continue;
				this.#resolvedNodeOverlays.set(installed.nodeId, entry.presentation);
			}
			return;
		}
		const selectedNodeId = this.#resolveInstalledNodeId(
			this.#selectedEntityGuid,
		);
		const hoveredNodeId = this.#resolveInstalledNodeId(this.#hoveredEntityGuid);
		const viewerNodeId = this.#resolveInstalledNodeId(this.#viewerEntityGuid);
		this.#context.dynamics.forEachNameplateNode((nodeId, entityClass) => {
			const presentation = resolveAmbientEntityOverlay({
				hasNameplate: true,
				category: resolveNameplateCategory(
					entityClass,
					nodeId === viewerNodeId,
				),
				isSelected: nodeId === selectedNodeId,
				isHovered: nodeId === hoveredNodeId,
				nameplates: this.#frameSettings.nameplates,
			});
			if (presentation !== null)
				this.#resolvedNodeOverlays.set(nodeId, presentation);
		});
	}

	/**
	 * Resolve whether the camera sits in a cell that cannot see outdoors.
	 *
	 * An uninstalled cell keeps outdoor lighting: absence of scope data is not evidence that a
	 * cell is sealed, and forcing interior ambient on it would darken the world during loading.
	 */
	#cameraInsideSealedCell(): boolean {
		const envCellId = this.#camera.placement.envCellId;
		if (envCellId === null) return false;
		return this.#context.scene.getEnvCellSeenOutside(envCellId) === false;
	}
}
