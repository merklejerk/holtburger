import {
	AmbientLight,
	AlwaysDepth,
	AlwaysStencilFunc,
	Box3,
	BufferAttribute,
	BufferGeometry,
	Color,
	CylinderGeometry,
	DirectionalLight,
	DoubleSide,
	EqualStencilFunc,
	Frustum,
	GLSL3,
	Group,
	IncrementStencilOp,
	InstancedMesh,
	KeepStencilOp,
	LineBasicMaterial,
	LineLoop,
	LineSegments,
	Matrix4,
	type Material,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	Object3D,
	PerspectiveCamera,
	Plane,
	ReplaceStencilOp,
	Scene,
	ShaderMaterial,
	Vector2,
	Vector3,
	WebGLRenderer,
} from "three";

import type { AssetChannelState } from "../assets/types";
import type { NormalizedViewportPoint } from "./model";
import type {
	CellDebugOverlay,
	PortalDebugOverlay,
	WorldDebugOverlayModel,
} from "./debug-overlays";
import type {
	RenderFrustum,
	RenderSpatialIndexQuery,
	RenderSpatialItemKind,
	RenderSpatialPick,
} from "./render-spatial-index";
import {
	debugCellSpatialItemId,
	portalSpatialItemId,
	structuredCellSpatialItemId,
	terrainSpatialItemId,
} from "./render-spatial-ids";
import type { RenderChunkTransform } from "./render-anchor";
import type { RenderChunkKey } from "./render-chunks";
import {
	type StaticRenderablePart,
	type StaticRenderableSceneModel,
	isPreparedGfxObjAsset,
} from "./static-renderables";
import {
	type MaterialTextureCapabilities,
	type MaterialResourceDiagnostic,
	WorldMaterialResourceCache,
	formatMaterialAssetId,
} from "./material-resources";
import {
	buildAcPlacementMatrix,
	buildGfxObjGeometry,
	buildStaticRenderableColor,
	buildStaticRenderablePartMatrix,
	type MaterialGeometrySlot,
} from "./static-renderable-geometry";
import type {
	StructuredInteriorCell,
	StructuredInteriorSceneModel,
} from "./structured-interior-scene";
import {
	createFallbackSceneCameraFrame,
	fitSceneCameraFrameToBounds,
	type SceneBoundsFrame,
	type SceneCameraFrame,
} from "./camera";
import type {
	BrowserCameraResidency,
	BrowserCameraResidencyChangeHandler,
	WorldDisplayRenderStyle,
	WorldRenderCameraFrameChangeHandler,
	WorldRenderDebugMetrics,
	WorldRenderMetrics,
	WorldRenderMetricsChangeHandler,
	WorldRenderPortalMetrics,
} from "./renderer-contract";
import type {
	TransitionPortalCandidate,
	TransitionPortalCandidateModel,
	TransitionPortalWorkItem,
} from "./transition-portal-work-items";
import { createTransitionPortalWorkItem } from "./transition-portal-work-items";
import { buildTerrainGeometry } from "./terrain-geometry";
import type { TerrainSceneModel, TerrainSceneTile } from "./terrain-scene";
import {
	syncRenderChunkRootRecords,
	type RenderChunkRootRecord,
} from "./chunk-root-manager";
import {
	WORLD_RENDER_LAYER,
	staticRenderableLayerForDomain,
	type TransitionPortalGraphScene,
	type WorldRenderGraphNode,
} from "./render-passes";
import {
	deriveWorldRenderGraphForPolicy,
	deriveWorldRenderPolicy,
	summarizeWorldRenderGraph,
	DEFAULT_TRANSITION_PORTAL_MAX_DEPTH,
	clampTransitionPortalMaxDepth,
	type WorldRenderPolicy,
	type TransitionPortalRenderLevel,
} from "./render-policy";
import {
	deriveTransitionPortalDepthBatches,
	transitionPortalDepthBatchKey,
	type TransitionPortalDepthBatchKey,
	type TransitionPortalVisiblePools,
} from "./transition-portal-depth-batches";
import {
	createPortalVisibilityContext,
	evaluatePortalVisibility,
	type PortalVisibilityContext,
	type PortalVisibilityResult,
} from "./portal-visibility";
import {
	createEmptyWorldRenderWorkingModel,
	deriveWorldRenderWorkingModel,
	type WorldRenderWorkingModel,
} from "./world-render-working-model";
import {
	buildWorldResidencyIndex,
	createEmptyWorldResidencyIndex,
	deriveBrowserCameraResidency,
	describeCameraViewResidencyContext,
	type CameraViewResidencyContext,
	type WorldResidencyIndex,
} from "./world-residency-index";
import type { WorldRenderSceneContext } from "./render-scene-context";

export interface WorldDisplayRendererOptions {
	assetState: AssetChannelState;
	terrainScene: TerrainSceneModel;
	staticRenderableScene: StaticRenderableSceneModel;
	structuredInteriorScene: StructuredInteriorSceneModel;
	transitionPortalModel: TransitionPortalCandidateModel;
	debugOverlayScene: WorldDebugOverlayModel;
	renderSceneContext: WorldRenderSceneContext;
	renderChunkTransforms: readonly RenderChunkTransform[];
	renderSpatialQuery: RenderSpatialIndexQuery | null;
	controlledCameraFrame: SceneCameraFrame | null;
	transitionPortalMaxDepth?: number;
	renderStyle?: WorldDisplayRenderStyle;
	onCameraFrameChange?: WorldRenderCameraFrameChangeHandler;
	onRenderMetricsChange?: WorldRenderMetricsChangeHandler;
	onCameraResidencyChange?: BrowserCameraResidencyChangeHandler;
}

export interface WorldDisplayRenderer {
	setAssetState(assetState: AssetChannelState): void;
	setTerrainScene(scene: TerrainSceneModel): void;
	setStaticRenderableScene(scene: StaticRenderableSceneModel): void;
	setStructuredInteriorScene(scene: StructuredInteriorSceneModel): void;
	setTransitionPortalModel(model: TransitionPortalCandidateModel): void;
	setDebugOverlayScene(scene: WorldDebugOverlayModel): void;
	setRenderSceneContext(context: WorldRenderSceneContext): void;
	setRenderChunkTransforms(transforms: readonly RenderChunkTransform[]): void;
	setRenderSpatialQuery(query: RenderSpatialIndexQuery | null): void;
	setControlledCameraFrame(frame: SceneCameraFrame | null): void;
	setTransitionPortalMaxDepth(maxDepth: number): void;
	setRenderStyle(renderStyle: WorldDisplayRenderStyle): void;
	setCameraFrameChangeHandler(
		handler: WorldRenderCameraFrameChangeHandler | undefined,
	): void;
	setRenderMetricsChangeHandler(
		handler: WorldRenderMetricsChangeHandler | undefined,
	): void;
	setCameraResidencyChangeHandler(
		handler: BrowserCameraResidencyChangeHandler | undefined,
	): void;
	pickTerrainLandblockAtViewportPoint(
		viewportPoint: NormalizedViewportPoint,
	): number | null;
	pickAtViewportPoint(
		viewportPoint: NormalizedViewportPoint,
		mask: ReadonlySet<RenderSpatialItemKind>,
		ownerKeys?: ReadonlySet<string>,
	): RenderSpatialPick | null;
	dispose(): void;
}

interface RenderStyleMaterialUserData {
	originalRenderStyleMaterial?: Material | Material[];
	renderStyleDebugColorKey?: string;
}

const PERFORMANCE_REPORT_INTERVAL_MS = 500;
const UNFOCUSED_MAX_RENDER_FPS = 15;
const UNFOCUSED_RENDER_INTERVAL_MS = 1000 / UNFOCUSED_MAX_RENDER_FPS;
const SELECTED_DEBUG_EDGE_RADIUS = 0.12;
const MIN_STATIC_RENDERABLE_INSTANCE_CAPACITY = 8;
const MATERIAL_DIAGNOSTIC_LOG_PREFIX = "[holtburger-3d][material]";
const MATERIAL_DIAGNOSTIC_SAMPLE_LIMIT = 12;

interface CoalescedMaterialDiagnosticBucket {
	category: string;
	count: number;
	messages: Set<string>;
	materialAssetIds: Set<string>;
	preparedKinds: Map<string, number>;
	preparedAssetCounts: Record<string, number> | null;
	preparedMaterialRecipeCount: number | null;
	preparedMaterialAssetIdSamples: string[];
	samples: MaterialResourceDiagnostic[];
}

interface VisibleTransitionPortalWork {
	workItem: TransitionPortalWorkItem;
	direction: TransitionPortalWorkItem["direction"];
	entryEnvCellId: number;
	requestedInteriorEnvCellIds: readonly number[];
	screenAreaPx: number;
	maskMesh: Mesh;
}

interface PortalDepthResetCapability {
	supported: boolean;
	reason: string | null;
}

function detectMaterialTextureCapabilities(
	renderer: WebGLRenderer,
): MaterialTextureCapabilities {
	return {
		supportsS3tc: renderer.extensions.has("WEBGL_compressed_texture_s3tc"),
		supportsS3tcSrgb: renderer.extensions.has(
			"WEBGL_compressed_texture_s3tc_srgb",
		),
	};
}

function createCoalescedMaterialDiagnosticReporter(): (
	diagnostic: MaterialResourceDiagnostic,
) => void {
	const buckets = new Map<string, CoalescedMaterialDiagnosticBucket>();
	let flushHandle: ReturnType<typeof setTimeout> | null = null;

	const flush = (): void => {
		flushHandle = null;
		const pendingBuckets = [...buckets.values()];
		buckets.clear();

		for (const bucket of pendingBuckets) {
			if (bucket.count === 1) {
				const sample = bucket.samples[0];
				if (sample) {
					console.warn(
						MATERIAL_DIAGNOSTIC_LOG_PREFIX,
						sample.message,
						sample.detail,
					);
				}
				continue;
			}

			console.warn(
				MATERIAL_DIAGNOSTIC_LOG_PREFIX,
				`${bucket.count} ${describeMaterialDiagnosticCategory(bucket.category)}. Samples: ${[
					...bucket.materialAssetIds,
				]
					.slice(0, MATERIAL_DIAGNOSTIC_SAMPLE_LIMIT)
					.join(", ")}`,
				{
					category: bucket.category,
					count: bucket.count,
					messages: [...bucket.messages].slice(
						0,
						MATERIAL_DIAGNOSTIC_SAMPLE_LIMIT,
					),
					materialAssetIds: [...bucket.materialAssetIds].slice(
						0,
						MATERIAL_DIAGNOSTIC_SAMPLE_LIMIT,
					),
					preparedKinds: Object.fromEntries(bucket.preparedKinds),
					preparedAssetCounts: bucket.preparedAssetCounts,
					preparedMaterialRecipeCount: bucket.preparedMaterialRecipeCount,
					preparedMaterialAssetIdSamples: bucket.preparedMaterialAssetIdSamples,
					samples: bucket.samples.map((sample) => sample.detail),
				},
			);
		}
	};

	return (diagnostic): void => {
		const category = materialDiagnosticCategory(diagnostic.key);
		const bucket =
			buckets.get(category) ?? createMaterialDiagnosticBucket(category);
		bucket.count += 1;
		bucket.messages.add(diagnostic.message);
		addMaterialDiagnosticDetail(bucket, diagnostic);
		if (bucket.samples.length < MATERIAL_DIAGNOSTIC_SAMPLE_LIMIT) {
			bucket.samples.push(diagnostic);
		}
		buckets.set(category, bucket);

		if (flushHandle === null) {
			flushHandle = setTimeout(flush, 0);
		}
	};
}

function createMaterialDiagnosticBucket(
	category: string,
): CoalescedMaterialDiagnosticBucket {
	return {
		category,
		count: 0,
		messages: new Set(),
		materialAssetIds: new Set(),
		preparedKinds: new Map(),
		preparedAssetCounts: null,
		preparedMaterialRecipeCount: null,
		preparedMaterialAssetIdSamples: [],
		samples: [],
	};
}

function addMaterialDiagnosticDetail(
	bucket: CoalescedMaterialDiagnosticBucket,
	diagnostic: MaterialResourceDiagnostic,
): void {
	const materialAssetId = diagnostic.detail.materialAssetId;
	if (typeof materialAssetId === "string") {
		bucket.materialAssetIds.add(materialAssetId);
	}

	const preparedKind = diagnostic.detail.preparedKind;
	if (typeof preparedKind === "string") {
		bucket.preparedKinds.set(
			preparedKind,
			(bucket.preparedKinds.get(preparedKind) ?? 0) + 1,
		);
	} else if (preparedKind === null) {
		bucket.preparedKinds.set(
			"null",
			(bucket.preparedKinds.get("null") ?? 0) + 1,
		);
	}

	if (isStringNumberRecord(diagnostic.detail.preparedAssetCounts)) {
		bucket.preparedAssetCounts = diagnostic.detail.preparedAssetCounts;
	}
	if (typeof diagnostic.detail.preparedMaterialRecipeCount === "number") {
		bucket.preparedMaterialRecipeCount =
			diagnostic.detail.preparedMaterialRecipeCount;
	}
	if (Array.isArray(diagnostic.detail.preparedMaterialAssetIdSamples)) {
		bucket.preparedMaterialAssetIdSamples =
			diagnostic.detail.preparedMaterialAssetIdSamples.filter(
				(assetId): assetId is string => typeof assetId === "string",
			);
	}
}

function isStringNumberRecord(value: unknown): value is Record<string, number> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value).every((entry) => typeof entry === "number")
	);
}

function materialDiagnosticCategory(key: string): string {
	return key.split(":")[0] ?? key;
}

function describeMaterialDiagnosticCategory(category: string): string {
	switch (category) {
		case "missing-recipe":
			return "materials were requested by geometry before a material recipe was prepared";
		case "failed-recipe":
			return "material recipes failed to resolve";
		case "missing-render-texture":
			return "materials are missing render texture dependencies";
		case "missing-render-surface":
			return "materials are missing render surface dependencies";
		case "unsupported-render-surface":
			return "materials reference unsupported render surface formats";
		case "missing-palette":
			return "materials reference missing palette dependencies";
		case "texture-upload-failed":
			return "materials could not upload selected render surfaces";
		default:
			return "material diagnostics were reported";
	}
}

export function createWorldDisplayRenderer(
	host: HTMLDivElement,
	options: WorldDisplayRendererOptions,
): WorldDisplayRenderer {
	let assetState = options.assetState;
	let terrainScene = options.terrainScene;
	let staticRenderableScene = options.staticRenderableScene;
	let structuredInteriorScene = options.structuredInteriorScene;
	let transitionPortalModel = options.transitionPortalModel;
	let debugOverlayScene = options.debugOverlayScene;
	let renderSceneContext = options.renderSceneContext;
	let renderChunkTransforms = options.renderChunkTransforms;
	let renderSpatialQuery = options.renderSpatialQuery;
	let controlledCameraFrame = options.controlledCameraFrame;
	let transitionPortalMaxDepth = clampTransitionPortalMaxDepth(
		options.transitionPortalMaxDepth ?? DEFAULT_TRANSITION_PORTAL_MAX_DEPTH,
	);
	let renderStyle: WorldDisplayRenderStyle = options.renderStyle ?? "solid";
	const noMaterialOverrideMaterials = new Map<string, MeshStandardMaterial>();
	const wireframeOverrideMaterials = new Map<string, MeshBasicMaterial>();
	let onCameraFrameChange = options.onCameraFrameChange;
	let onRenderMetricsChange = options.onRenderMetricsChange;
	let onCameraResidencyChange = options.onCameraResidencyChange;

	const renderer = new WebGLRenderer({
		antialias: true,
		alpha: true,
		stencil: true,
	});
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.outputColorSpace = "srgb";
	renderer.autoClear = false;
	renderer.info.autoReset = false;
	renderer.setClearColor(new Color("#0e1a24"), 1);
	renderer.domElement.className = "world-display__three-canvas";
	host.append(renderer.domElement);
	const portalDepthResetCapability = detectPortalDepthResetCapability(renderer);
	const portalDepthResetMaterial = createPortalDepthResetMaterial();
	const portalBatchMaskMaterial = createPortalMaskMaterial(0);
	const portalAperturePassScene = new Scene();
	portalAperturePassScene.name = "portal-aperture-pass-scene";
	const portalAperturePassMeshes = new Map<string, Mesh>();

	const scene = new Scene();
	const reportMaterialDiagnostic = createCoalescedMaterialDiagnosticReporter();
	const materialResourceCache = new WorldMaterialResourceCache(
		reportMaterialDiagnostic,
		detectMaterialTextureCapabilities(renderer),
	);

	const camera = new PerspectiveCamera(52, 1, 0.1, 5000);

	const ambientLight = new AmbientLight("#d7e9f9", 1.4);
	const sunLight = new DirectionalLight("#fff1d6", 2.1);
	sunLight.position.set(220, 320, 160);
	enableAllWorldRenderLayers(ambientLight);
	enableAllWorldRenderLayers(sunLight);
	scene.add(ambientLight, sunLight);

	const chunkRootContainer = new Group();
	chunkRootContainer.name = "render-chunk-roots";
	scene.add(chunkRootContainer);

	let activeCameraFrame: SceneCameraFrame | null = null;
	const terrainMeshes = new Map<string, Mesh>();
	const staticGeometryCache = new Map<string, BufferGeometry>();
	const staticRenderableGroupMeshes = new Map<string, InstancedMesh>();
	const staticRenderableGroupPartSignatures = new Map<string, string>();
	const structuredInteriorMeshes = new Map<string, Mesh>();
	const portalMaskMeshes = new Map<string, Mesh>();
	const portalMaskGeometrySignatures = new Map<string, string>();
	let renderWorkingModel: WorldRenderWorkingModel =
		createEmptyWorldRenderWorkingModel();
	let residencyIndex: WorldResidencyIndex = createEmptyWorldResidencyIndex();
	let cameraViewResidency: CameraViewResidencyContext = {
		kind: "unknown",
		landblockId: null,
	};
	let latestCameraResidency: BrowserCameraResidency = {
		kind: "unknown",
		landblockId: null,
		envCellId: null,
		source: "unknown",
	};
	let lastReportedCameraResidencyKey: string | null = null;
	const debugOverlayObjects = new Map<string, Object3D>();
	const chunkRoots = new Map<RenderChunkKey, RenderChunkRootRecord<Group>>();
	let lastReportedMetricsKey: string | null = null;
	let latestPerformanceMetrics: WorldRenderMetrics["performance"] = null;
	let latestPortalMetrics: WorldRenderPortalMetrics = createPortalRenderMetrics(
		transitionPortalModel,
	);
	let latestRenderDebugMetrics: WorldRenderDebugMetrics =
		createRenderDebugMetrics(renderer, {
			renderPassCount: 0,
			renderGraphPolicy: "residency-aware",
			renderGraphBaseScene: "exterior",
			transitionPortalMaxDepth,
			portalRenderWorkItemCount: 0,
			transitionApertureMaskPassCount: 0,
			apertureDepthResetPassCount: 0,
			interiorCompositePassCount: 0,
			exteriorCompositePassCount: 0,
			transitionPortalCandidateCount: 0,
			portalApertureMeshCount: 0,
			cameraViewResidency:
				describeCameraViewResidencyContext(cameraViewResidency),
			residencyCellCount: residencyIndex.cellCount,
			residencyLandblockCount: residencyIndex.landblockCount,
			residencyAabbCandidateCount: 0,
			residencyCellBspMatchCount: 0,
			residencyAabbFallbackCount: 0,
			residencySource: "unknown",
			terrainMeshCount: 0,
			visibleTerrainMeshCount: 0,
			staticGroupMeshCount: 0,
			visibleStaticGroupMeshCount: 0,
			structuredInteriorMeshCount: 0,
			visibleStructuredInteriorMeshCount: 0,
			debugOverlayObjectCount: 0,
			visibleDebugOverlayObjectCount: 0,
		});
	let frameId = 0;
	let lastFrameAt: number | null = null;
	let lastRenderedAt: number | null = null;
	let performanceWindowStartedAt = 0;
	let performanceWindowFrameCount = 0;
	let performanceWindowFrameMs = 0;
	let performanceWindowRenderMs = 0;
	let isReducedFrameRateActive = shouldUseReducedFrameRate();
	let disposed = false;

	const resizeObserver = new ResizeObserver(() => {
		syncRendererSize();
		updateCameraFrame();
	});
	resizeObserver.observe(host);

	window.addEventListener("focus", syncReducedFrameRateState);
	window.addEventListener("blur", syncReducedFrameRateState);
	document.addEventListener("visibilitychange", syncReducedFrameRateState);

	syncRendererSize();
	frameId = window.requestAnimationFrame(renderFrame);

	return {
		setAssetState(nextAssetState) {
			assetState = nextAssetState;
			clearMaterializedSceneMeshes();
			materialResourceCache.dispose();
			syncStaticRenderableMeshes(staticRenderableScene);
			syncStructuredInteriorMeshes(structuredInteriorScene);
		},
		setTerrainScene(nextScene) {
			terrainScene = nextScene;
			syncTerrainMeshes(nextScene);
		},
		setStaticRenderableScene(nextScene) {
			staticRenderableScene = nextScene;
			syncStaticRenderableMeshes(nextScene);
		},
		setStructuredInteriorScene(nextScene) {
			structuredInteriorScene = nextScene;
			syncStructuredInteriorMeshes(nextScene);
		},
		setTransitionPortalModel(nextModel) {
			transitionPortalModel = nextModel;
			syncPortalMaskMeshes(nextModel);
		},
		setDebugOverlayScene(nextScene) {
			debugOverlayScene = nextScene;
			syncDebugOverlayMeshes(nextScene);
		},
		setRenderSceneContext(nextContext) {
			renderSceneContext = nextContext;
			updateResidencyIndex();
		},
		setRenderChunkTransforms(nextTransforms) {
			renderChunkTransforms = nextTransforms;
			syncRenderChunkRoots(nextTransforms);
			updateResidencyIndex();
		},
		setRenderSpatialQuery(nextQuery) {
			renderSpatialQuery = nextQuery;
		},
		setControlledCameraFrame(nextFrame) {
			controlledCameraFrame = nextFrame;
			updateCameraFrame();
		},
		setTransitionPortalMaxDepth(maxDepth) {
			transitionPortalMaxDepth = clampTransitionPortalMaxDepth(maxDepth);
		},
		setRenderStyle(nextRenderStyle) {
			renderStyle = nextRenderStyle;
			syncRenderStyle();
		},
		setCameraFrameChangeHandler(handler) {
			onCameraFrameChange = handler;
		},
		setRenderMetricsChangeHandler(handler) {
			onRenderMetricsChange = handler;
			reportRenderMetrics();
		},
		setCameraResidencyChangeHandler(handler) {
			onCameraResidencyChange = handler;
			lastReportedCameraResidencyKey = null;
			reportCameraResidency();
		},
		pickTerrainLandblockAtViewportPoint(viewportPoint) {
			const pick = this.pickAtViewportPoint(
				viewportPoint,
				new Set(["terrain"]),
			);
			return pick?.item.metadata.kind === "terrain"
				? pick.item.metadata.landblockId
				: null;
		},
		pickAtViewportPoint(viewportPoint, mask, ownerKeys) {
			if (!renderSpatialQuery) {
				return null;
			}
			const ray = buildViewportRay(viewportPoint);
			return renderSpatialQuery.pickRay(ray, mask, ownerKeys);
		},
		dispose,
	};

	function renderFrame(frameAt: number): void {
		frameId = window.requestAnimationFrame(renderFrame);
		if (disposed) {
			return;
		}
		syncSpatialVisibility();
		syncReducedFrameRateState();
		if (
			isReducedFrameRateActive &&
			lastRenderedAt !== null &&
			frameAt - lastRenderedAt < UNFOCUSED_RENDER_INTERVAL_MS
		) {
			return;
		}

		const frameStartedAt = frameAt;
		const renderStartedAt = window.performance.now();
		renderWorldPasses();
		const renderMs = window.performance.now() - renderStartedAt;
		lastRenderedAt = frameStartedAt;
		if (lastFrameAt !== null) {
			const frameMs = frameStartedAt - lastFrameAt;
			performanceWindowFrameCount += 1;
			performanceWindowFrameMs += frameMs;
			performanceWindowRenderMs += renderMs;
			if (
				frameStartedAt - performanceWindowStartedAt >=
				PERFORMANCE_REPORT_INTERVAL_MS
			) {
				const averageFrameMs =
					performanceWindowFrameMs / performanceWindowFrameCount;
				const averageRenderMs =
					performanceWindowRenderMs / performanceWindowFrameCount;
				latestPerformanceMetrics = {
					fps: averageFrameMs > 0 ? 1000 / averageFrameMs : 0,
					frameMs: averageFrameMs,
					renderMs: averageRenderMs,
				};
				performanceWindowStartedAt = frameStartedAt;
				performanceWindowFrameCount = 0;
				performanceWindowFrameMs = 0;
				performanceWindowRenderMs = 0;
				reportRenderMetrics();
			}
		} else {
			performanceWindowStartedAt = frameStartedAt;
		}
		lastFrameAt = frameStartedAt;
	}

	function resetPerformanceWindow(): void {
		lastFrameAt = null;
		lastRenderedAt = null;
		performanceWindowStartedAt = window.performance.now();
		performanceWindowFrameCount = 0;
		performanceWindowFrameMs = 0;
		performanceWindowRenderMs = 0;
	}

	function syncReducedFrameRateState(): void {
		const nextState = shouldUseReducedFrameRate();
		if (nextState === isReducedFrameRateActive) {
			return;
		}

		isReducedFrameRateActive = nextState;
		resetPerformanceWindow();
	}

	function syncRendererSize(): void {
		const width = Math.max(host.clientWidth, 1);
		const height = Math.max(host.clientHeight, 1);
		renderer.setPixelRatio(window.devicePixelRatio);
		renderer.setSize(width, height, false);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
	}

	function syncRenderChunkRoots(
		transforms: readonly RenderChunkTransform[],
	): void {
		syncRenderChunkRootRecords(chunkRoots, transforms, {
			createRoot: createRenderChunkRoot,
			updateRootPosition: updateRenderChunkRootPosition,
			canDisposeRoot: (root) => root.children.length === 0,
			disposeRoot: disposeRenderChunkRoot,
		});
		updateCameraFrame();
		reportRenderMetrics();
	}

	function createRenderChunkRoot(transform: RenderChunkTransform): Group {
		const root = new Group();
		root.name = `render-chunk/${transform.chunkKey}`;
		root.userData.chunkKey = transform.chunkKey;
		root.userData.chunkLandblockId = transform.chunkLandblockId;
		enableAllWorldRenderLayers(root);
		chunkRootContainer.add(root);
		return root;
	}

	function renderWorldPasses(): void {
		latestPortalMetrics = createPortalRenderMetrics(transitionPortalModel);
		const cameraResidencyQuery = residencyIndex.queryDetailed({
			x: camera.position.x,
			y: camera.position.y,
			z: camera.position.z,
		});
		cameraViewResidency = cameraResidencyQuery.context;
		reportCameraResidency(
			deriveBrowserCameraResidency(
				cameraResidencyQuery.context,
				cameraResidencyQuery.diagnostics,
			),
		);
		renderer.info.reset();
		const renderPolicy = deriveActiveRenderPolicy();
		const transitionWorkBatches =
			collectVisibleTransitionPortalWorkBatches(renderPolicy);
		const graph = deriveWorldRenderGraphForPolicy({
			policy: renderPolicy,
			visibleTransitions: {
				hasVisibleTransitionLevel: (level) =>
					hasVisibleTransitionLevel(transitionWorkBatches, level),
			},
			showDebugOverlays: true,
		});
		if (transitionWorkBatches.size > 0) {
			assertPortalDepthResetSupported(portalDepthResetCapability);
		}
		for (const node of graph) {
			renderWorldGraphNode(node, transitionWorkBatches);
		}
		camera.layers.enableAll();
		const graphSummary = summarizeWorldRenderGraph({
			policy: renderPolicy,
			graph,
		});
		latestRenderDebugMetrics = createRenderDebugMetrics(renderer, {
			renderPassCount: graph.length,
			renderGraphPolicy: graphSummary.policyLabel,
			renderGraphBaseScene: graphSummary.baseScene,
			transitionPortalMaxDepth,
			portalRenderWorkItemCount: countTransitionPortalRenderWorkItems(
				transitionWorkBatches,
			),
			transitionApertureMaskPassCount:
				graphSummary.transitionApertureMaskPassCount,
			apertureDepthResetPassCount: graphSummary.apertureDepthResetPassCount,
			interiorCompositePassCount: graphSummary.interiorCompositePassCount,
			exteriorCompositePassCount: graphSummary.exteriorCompositePassCount,
			transitionPortalCandidateCount: transitionPortalModel.candidates.length,
			portalApertureMeshCount: portalMaskMeshes.size,
			cameraViewResidency:
				describeCameraViewResidencyContext(cameraViewResidency),
			residencyCellCount: residencyIndex.cellCount,
			residencyLandblockCount: residencyIndex.landblockCount,
			residencyAabbCandidateCount:
				cameraResidencyQuery.diagnostics.aabbCandidateCount,
			residencyCellBspMatchCount:
				cameraResidencyQuery.diagnostics.cellBspMatchCount,
			residencyAabbFallbackCount:
				cameraResidencyQuery.diagnostics.aabbFallbackCount,
			residencySource: cameraResidencyQuery.diagnostics.source,
			terrainMeshCount: terrainMeshes.size,
			visibleTerrainMeshCount: countVisibleObjects(terrainMeshes.values()),
			staticGroupMeshCount: staticRenderableGroupMeshes.size,
			visibleStaticGroupMeshCount: countVisibleObjects(
				staticRenderableGroupMeshes.values(),
			),
			structuredInteriorMeshCount: structuredInteriorMeshes.size,
			visibleStructuredInteriorMeshCount: countVisibleObjects(
				structuredInteriorMeshes.values(),
			),
			debugOverlayObjectCount: debugOverlayObjects.size,
			visibleDebugOverlayObjectCount: countVisibleObjects(
				debugOverlayObjects.values(),
			),
		});
	}

	function renderWorldGraphNode(
		node: WorldRenderGraphNode,
		transitionWorkBatches: ReadonlyMap<
			TransitionPortalDepthBatchKey,
			readonly VisibleTransitionPortalWork[]
		>,
	): void {
		applyGraphNodeClear(node);
		switch (node.kind) {
			case "transition-aperture-mask":
				renderTransitionApertureMaskNode(node, transitionWorkBatches);
				return;
			case "aperture-depth-reset":
				renderTransitionDepthResetNode(node, transitionWorkBatches);
				return;
			case "opposite-scene-portal-composite":
				renderTransitionCompositeNode(node, transitionWorkBatches);
				return;
			case "exterior-base":
			case "interior-base":
			case "diagnostic-interior":
			case "debug-overlay":
				camera.layers.set(node.layer);
				renderer.render(scene, camera);
				return;
		}
	}

	function applyGraphNodeClear(node: WorldRenderGraphNode): void {
		const { color, depth, stencil } = node.clearBeforePass;
		if (color || depth || stencil) {
			renderer.clear(color, depth, stencil);
		}
	}

	function collectVisibleTransitionPortalWorkBatches(
		renderPolicy: WorldRenderPolicy,
	): Map<TransitionPortalDepthBatchKey, VisibleTransitionPortalWork[]> {
		if (renderPolicy.transitionLevels.length === 0) {
			latestPortalMetrics.visiblePortalWorkItemCount = 0;
			latestPortalMetrics.maskedInteriorCellCount = 0;
			return new Map();
		}

		const visiblePools: TransitionPortalVisiblePools<VisibleTransitionPortalWork> =
			{
				outdoorToIndoor: [],
				indoorToOutdoor: [],
			};
		const visibilityContext = createPortalVisibilityContext({
			camera,
			viewport: new Vector2(
				renderer.domElement.width,
				renderer.domElement.height,
			),
			minScreenAreaRatio: renderPolicy.portalCandidates.minScreenAreaRatio,
		});
		const eligibleDirections = new Set(
			renderPolicy.transitionLevels.map((level) => level.direction),
		);
		for (const candidate of transitionPortalModel.candidates) {
			const visibility = evaluateTransitionPortalVisibility(
				candidate,
				visibilityContext,
			);
			if (!visibility.visible) {
				recordPortalVisibilitySkip(visibility.reason);
				recordPortalScreenAreaBucket(visibility.screenAreaPx);
				continue;
			}
			recordPortalScreenAreaBucket(visibility.screenAreaPx);
			recordVisiblePortalScreenArea(visibility.screenAreaPx);
			const workItem = visibility.workItem;
			if (!workItem) {
				continue;
			}
			if (!eligibleDirections.has(workItem.direction)) {
				continue;
			}
			const maskMesh = portalMaskMeshes.get(workItem.id);
			if (!maskMesh) {
				continue;
			}
			const work: VisibleTransitionPortalWork = {
				workItem,
				direction: workItem.direction,
				entryEnvCellId: workItem.entryEnvCellId,
				requestedInteriorEnvCellIds: workItem.requestedInteriorEnvCellIds,
				screenAreaPx: visibility.screenAreaPx,
				maskMesh,
			};
			if (workItem.direction === "outdoor-to-indoor") {
				visiblePools.outdoorToIndoor.push(work);
			} else {
				visiblePools.indoorToOutdoor.push(work);
			}
		}
		let visibleWorkItemCount = 0;
		for (const pool of [
			visiblePools.outdoorToIndoor,
			visiblePools.indoorToOutdoor,
		]) {
			pool.sort(compareVisibleTransitionPortalWork);
			visibleWorkItemCount += pool.length;
		}
		const { batches, maskedInteriorCellIds } =
			deriveTransitionPortalDepthBatches({
				levels: renderPolicy.transitionLevels,
				baseScene: renderPolicy.baseScene,
				initialEnvCellId:
					cameraViewResidency.kind === "env-cell"
						? cameraViewResidency.envCellId
						: null,
				visiblePools,
			});
		latestPortalMetrics.visiblePortalWorkItemCount = visibleWorkItemCount;
		latestPortalMetrics.maskedInteriorCellCount = maskedInteriorCellIds.size;
		return batches;
	}

	function renderTransitionApertureMaskNode(
		node: WorldRenderGraphNode,
		transitionWorkBatches: ReadonlyMap<
			TransitionPortalDepthBatchKey,
			readonly VisibleTransitionPortalWork[]
		>,
	): void {
		if (!node.transition) {
			return;
		}
		const batch = getGraphNodeTransitionBatch(node, transitionWorkBatches);
		if (!batch) {
			return;
		}

		applyPortalMaskStencilState(portalBatchMaskMaterial, node.transition);
		renderPortalAperturePassScene(batch, portalBatchMaskMaterial);
	}

	function renderTransitionDepthResetNode(
		node: WorldRenderGraphNode,
		transitionWorkBatches: ReadonlyMap<
			TransitionPortalDepthBatchKey,
			readonly VisibleTransitionPortalWork[]
		>,
	): void {
		if (!node.transition) {
			return;
		}
		const batch = getGraphNodeTransitionBatch(node, transitionWorkBatches);
		if (!batch) {
			return;
		}

		portalDepthResetMaterial.stencilRef = node.transition.stencilRef;
		renderPortalAperturePassScene(batch, portalDepthResetMaterial);
	}

	function renderTransitionCompositeNode(
		node: WorldRenderGraphNode,
		transitionWorkBatches: ReadonlyMap<
			TransitionPortalDepthBatchKey,
			readonly VisibleTransitionPortalWork[]
		>,
	): void {
		if (!node.transition) {
			return;
		}
		if (!getGraphNodeTransitionBatch(node, transitionWorkBatches)) {
			return;
		}

		applyPortalCompositeStencil(
			node.transition.compositeScene,
			node.transition.stencilRef,
		);
		try {
			camera.layers.set(node.layer);
			renderer.render(scene, camera);
		} finally {
			clearPortalCompositeStencil(node.transition.compositeScene);
		}
	}

	function getGraphNodeTransitionBatch(
		node: WorldRenderGraphNode,
		transitionWorkBatches: ReadonlyMap<
			TransitionPortalDepthBatchKey,
			readonly VisibleTransitionPortalWork[]
		>,
	): readonly VisibleTransitionPortalWork[] | null {
		if (!node.transition) {
			return null;
		}
		const batch = getTransitionPortalBatch(
			transitionWorkBatches,
			node.transition,
		);
		return batch.length > 0 ? batch : null;
	}

	function hasVisibleTransitionLevel(
		transitionWorkBatches: ReadonlyMap<
			TransitionPortalDepthBatchKey,
			readonly VisibleTransitionPortalWork[]
		>,
		level: TransitionPortalRenderLevel,
	): boolean {
		return getTransitionPortalBatch(transitionWorkBatches, level).length > 0;
	}

	function getTransitionPortalBatch(
		transitionWorkBatches: ReadonlyMap<
			TransitionPortalDepthBatchKey,
			readonly VisibleTransitionPortalWork[]
		>,
		level: Pick<TransitionPortalRenderLevel, "direction" | "recursionDepth">,
	): readonly VisibleTransitionPortalWork[] {
		return (
			transitionWorkBatches.get(transitionPortalDepthBatchKey(level)) ?? []
		);
	}

	function countTransitionPortalRenderWorkItems(
		transitionWorkBatches: ReadonlyMap<
			TransitionPortalDepthBatchKey,
			readonly VisibleTransitionPortalWork[]
		>,
	): number {
		let count = 0;
		for (const batch of transitionWorkBatches.values()) {
			count += batch.length;
		}
		return count;
	}

	function compareVisibleTransitionPortalWork(
		left: VisibleTransitionPortalWork,
		right: VisibleTransitionPortalWork,
	): number {
		return (
			right.screenAreaPx - left.screenAreaPx ||
			left.workItem.id.localeCompare(right.workItem.id)
		);
	}

	function renderPortalAperturePassScene(
		batch: readonly VisibleTransitionPortalWork[],
		material: Material,
	): void {
		syncPortalAperturePassScene(batch, material);
		try {
			camera.layers.enableAll();
			renderer.render(portalAperturePassScene, camera);
		} finally {
			clearPortalAperturePassScene();
		}
	}

	function deriveActiveRenderPolicy(): WorldRenderPolicy {
		return deriveWorldRenderPolicy(cameraViewResidency, {
			sceneContext: renderSceneContext,
			transitionPortalMaxDepth,
		});
	}

	function evaluateTransitionPortalVisibility(
		candidate: TransitionPortalCandidate,
		context: PortalVisibilityContext,
	): PortalVisibilityResult & { workItem?: TransitionPortalWorkItem } {
		const maskMesh = portalMaskMeshes.get(candidate.id);
		if (!maskMesh) {
			return { visible: false, reason: "missing-points", screenAreaPx: 0 };
		}

		maskMesh.updateMatrixWorld(true);
		const worldPoints = candidate.aperture.points.map((point) =>
			new Vector3(point.x, point.y, point.z).applyMatrix4(maskMesh.matrixWorld),
		);
		const worldPlane = transformAperturePlaneToWorld(
			candidate.aperture.plane,
			maskMesh.matrixWorld,
		);
		const workItem = createTransitionPortalWorkItem({
			candidate,
			cameraPosition: {
				x: context.cameraPosition.x,
				y: context.cameraPosition.y,
				z: context.cameraPosition.z,
			},
			worldPlane,
		});
		if (!workItem) {
			return { visible: false, reason: "back-facing", screenAreaPx: 0 };
		}

		const visibility = evaluatePortalVisibility({
			worldPoints: worldPoints.map((point) => ({
				x: point.x,
				y: point.y,
				z: point.z,
			})),
			worldPlane,
			visibleSide: workItem.visibleSide,
			context,
		});
		return { ...visibility, workItem };
	}

	function transformAperturePlaneToWorld(
		plane: TransitionPortalCandidate["aperture"]["plane"],
		matrixWorld: Matrix4,
	): TransitionPortalCandidate["aperture"]["plane"] {
		if (!plane) {
			return null;
		}

		const transformed = new Plane(
			new Vector3(plane.normal.x, plane.normal.y, plane.normal.z),
			-plane.constant,
		).applyMatrix4(matrixWorld);
		return {
			normal: {
				x: transformed.normal.x,
				y: transformed.normal.y,
				z: transformed.normal.z,
			},
			constant: -transformed.constant,
			source: plane.source,
		};
	}

	function recordPortalVisibilitySkip(
		reason: PortalVisibilityResult["reason"],
	): void {
		switch (reason) {
			case "outside-frustum":
				latestPortalMetrics.skippedOutsideFrustumCount += 1;
				return;
			case "back-facing":
				latestPortalMetrics.skippedBackFacingCount += 1;
				return;
			case "too-small":
				latestPortalMetrics.skippedTooSmallCount += 1;
				return;
			case "missing-points":
			case "visible":
				return;
		}
	}

	function recordPortalScreenAreaBucket(screenAreaPx: number): void {
		if (screenAreaPx < 16) {
			latestPortalMetrics.screenAreaBuckets.lt16 += 1;
		} else if (screenAreaPx < 64) {
			latestPortalMetrics.screenAreaBuckets.lt64 += 1;
		} else if (screenAreaPx < 256) {
			latestPortalMetrics.screenAreaBuckets.lt256 += 1;
		} else {
			latestPortalMetrics.screenAreaBuckets.gte256 += 1;
		}
	}

	function recordVisiblePortalScreenArea(screenAreaPx: number): void {
		latestPortalMetrics.minVisibleScreenAreaPx =
			latestPortalMetrics.minVisibleScreenAreaPx === null
				? screenAreaPx
				: Math.min(latestPortalMetrics.minVisibleScreenAreaPx, screenAreaPx);
		latestPortalMetrics.maxVisibleScreenAreaPx =
			latestPortalMetrics.maxVisibleScreenAreaPx === null
				? screenAreaPx
				: Math.max(latestPortalMetrics.maxVisibleScreenAreaPx, screenAreaPx);
	}

	function updateRenderChunkRootPosition(
		root: Group,
		offset: RenderChunkTransform["offset"],
	): void {
		root.position.set(offset.x, offset.y, offset.z);
		root.updateMatrixWorld(true);
	}

	function disposeRenderChunkRoot(root: Group): void {
		if (root.children.length > 0) {
			throw new Error(
				`Cannot dispose non-empty render chunk root ${root.name}. Move or dispose layer objects before removing the chunk.`,
			);
		}
		root.removeFromParent();
	}

	function getRenderChunkRoot(chunkKey: RenderChunkKey): Group {
		const record = chunkRoots.get(chunkKey);
		if (!record) {
			throw new Error(`Missing render chunk root ${chunkKey}.`);
		}
		return record.root;
	}

	function resolveControlledCameraFrame(
		frame: SceneCameraFrame,
	): SceneCameraFrame {
		const aspect = camera.aspect;
		if (frame.aspect === aspect) {
			return frame;
		}
		return { ...frame, aspect };
	}

	function syncTerrainMeshes(sceneModel: TerrainSceneModel): void {
		syncRenderChunkRoots(renderChunkTransforms);

		const activeAssetIds = new Set(
			sceneModel.tiles.map((tile) => tile.assetId),
		);
		for (const [assetId, mesh] of terrainMeshes.entries()) {
			if (activeAssetIds.has(assetId)) {
				continue;
			}

			mesh.removeFromParent();
			disposeMesh(mesh);
			terrainMeshes.delete(assetId);
		}

		for (const tile of sceneModel.tiles) {
			const chunkRoot = getRenderChunkRoot(tile.renderChunk.chunkKey);
			const existing = terrainMeshes.get(tile.assetId);
			if (existing) {
				chunkRoot.attach(existing);
				existing.position.set(
					tile.chunkLocalOffset.x,
					tile.chunkLocalOffset.y,
					tile.chunkLocalOffset.z,
				);
				continue;
			}

			const mesh = createTerrainTileMesh(tile);
			mesh.position.set(
				tile.chunkLocalOffset.x,
				tile.chunkLocalOffset.y,
				tile.chunkLocalOffset.z,
			);
			mesh.userData.landblockId = tile.landblockId;
			mesh.userData.spatialItemId = terrainSpatialItemId(tile.assetId);
			mesh.layers.set(WORLD_RENDER_LAYER.exterior);
			chunkRoot.add(mesh);
			terrainMeshes.set(tile.assetId, mesh);
		}
		syncRenderChunkRoots(renderChunkTransforms);
		updateRenderWorkingModel();
		updateCameraFrame();
	}

	function updateRenderWorkingModel(): void {
		renderWorkingModel = deriveWorldRenderWorkingModel({
			terrainMeshes,
			staticRenderableGroupMeshes,
			structuredInteriorMeshes,
			staticRenderableScene,
			structuredInteriorScene,
		});
	}

	function updateResidencyIndex(): void {
		residencyIndex = buildWorldResidencyIndex({
			cells: structuredInteriorScene.cells,
			renderChunkTransforms,
			sceneContext: renderSceneContext,
		});
	}

	function buildViewportRay(viewportPoint: NormalizedViewportPoint): {
		origin: { x: number; y: number; z: number };
		direction: { x: number; y: number; z: number };
	} {
		const normalizedDevicePoint = new Vector2(
			viewportPoint.normalizedX * 2 - 1,
			-(viewportPoint.normalizedY * 2 - 1),
		);
		const origin = new Vector3();
		camera.getWorldPosition(origin);
		const direction = new Vector3(
			normalizedDevicePoint.x,
			normalizedDevicePoint.y,
			0.5,
		)
			.unproject(camera)
			.sub(origin)
			.normalize();
		return {
			origin: { x: origin.x, y: origin.y, z: origin.z },
			direction: { x: direction.x, y: direction.y, z: direction.z },
		};
	}

	function syncSpatialVisibility(): void {
		if (!renderSpatialQuery) {
			setAllSpatiallyCullableObjectsVisible(true);
			return;
		}

		const visibleItemIds = new Set(
			renderSpatialQuery
				.queryFrustum(
					buildCameraRenderFrustum(),
					new Set(["terrain", "structured-cell", "portal"]),
				)
				.map((item) => item.id),
		);

		for (const [assetId, mesh] of terrainMeshes.entries()) {
			applySpatialVisibility(
				mesh,
				terrainSpatialItemId(assetId),
				visibleItemIds,
			);
		}
		for (const [renderKey, mesh] of structuredInteriorMeshes.entries()) {
			applySpatialVisibility(
				mesh,
				structuredCellSpatialItemId(renderKey),
				visibleItemIds,
			);
		}
		for (const [spatialItemId, object] of debugOverlayObjects.entries()) {
			applySpatialVisibility(object, spatialItemId, visibleItemIds);
		}
	}

	function applySpatialVisibility(
		object: Object3D,
		spatialItemId: string,
		visibleItemIds: ReadonlySet<string>,
	): void {
		object.visible =
			!renderSpatialQuery?.hasItem(spatialItemId) ||
			visibleItemIds.has(spatialItemId);
	}

	function setAllSpatiallyCullableObjectsVisible(visible: boolean): void {
		for (const mesh of terrainMeshes.values()) {
			mesh.visible = visible;
		}
		for (const mesh of structuredInteriorMeshes.values()) {
			mesh.visible = visible;
		}
		for (const object of debugOverlayObjects.values()) {
			object.visible = visible;
		}
	}

	function buildCameraRenderFrustum(): RenderFrustum {
		camera.updateMatrixWorld();
		const projectionScreenMatrix = new Matrix4().multiplyMatrices(
			camera.projectionMatrix,
			camera.matrixWorldInverse,
		);
		const frustum = new Frustum().setFromProjectionMatrix(
			projectionScreenMatrix,
		);
		return {
			planes: frustum.planes.map((plane) => ({
				normal: {
					x: plane.normal.x,
					y: plane.normal.y,
					z: plane.normal.z,
				},
				constant: plane.constant,
			})),
		};
	}

	function updateCameraFrame(): void {
		if (controlledCameraFrame) {
			setActiveCameraFrame(
				resolveControlledCameraFrame(controlledCameraFrame),
				{
					notifyParent: false,
				},
			);
			reportRenderMetrics();
			return;
		}

		if (
			terrainScene.tiles.length === 0 &&
			staticRenderableScene.parts.length === 0 &&
			structuredInteriorScene.cells.length === 0
		) {
			applyInternalCameraFrame(null);
			return;
		}

		const boundsFrame = calculateSceneBoundsFrame();
		if (!boundsFrame) {
			return;
		}
		applyInternalCameraFrame(boundsFrame);
		reportRenderMetrics();
	}

	function applyInternalCameraFrame(
		boundsFrame: SceneBoundsFrame | null,
	): void {
		const aspect = camera.aspect || 1;
		const frame = boundsFrame
			? fitSceneCameraFrameToBounds(boundsFrame, aspect)
			: createFallbackSceneCameraFrame(aspect);
		setActiveCameraFrame(frame, { notifyParent: true });
		reportRenderMetrics();
	}

	function setActiveCameraFrame(
		frame: SceneCameraFrame,
		options: { notifyParent: boolean },
	): void {
		activeCameraFrame = frame;
		applySceneCameraFrame(activeCameraFrame);
		if (options.notifyParent) {
			onCameraFrameChange?.(frame);
		}
	}

	function applySceneCameraFrame(frame: SceneCameraFrame): void {
		camera.fov = frame.fovDegrees;
		camera.aspect = frame.aspect;
		camera.near = frame.near;
		camera.far = frame.far;
		camera.position.set(frame.position.x, frame.position.y, frame.position.z);
		camera.up.set(frame.up.x, frame.up.y, frame.up.z);
		camera.lookAt(frame.target.x, frame.target.y, frame.target.z);
		camera.updateProjectionMatrix();
	}

	function calculateSceneBoundsFrame(): SceneBoundsFrame | null {
		if (
			terrainScene.tiles.length === 0 &&
			staticRenderableScene.parts.length === 0 &&
			structuredInteriorScene.cells.length === 0
		) {
			return null;
		}

		const bounds = new Box3();
		bounds.expandByObject(chunkRootContainer);
		const center = bounds.getCenter(new Vector3());
		const size = bounds.getSize(new Vector3());

		return {
			center: { x: center.x, y: center.y, z: center.z },
			size: { x: size.x, y: size.y, z: size.z },
			minimumSpan: 180,
		};
	}

	function reportRenderMetrics(): void {
		const metrics: WorldRenderMetrics = {
			bounds: calculateSceneBoundsFrame(),
			cameraFrame: activeCameraFrame,
			performance: latestPerformanceMetrics,
			portal: latestPortalMetrics,
			debug: latestRenderDebugMetrics,
			geometry: {
				terrainTileCount: terrainScene.tiles.length,
				terrainVertexCount: terrainVertexCount(),
				terrainTriangleCount: terrainTriangleCount(),
				staticRenderablePartCount: staticRenderableScene.parts.length,
				staticRenderableInstancedGroupCount:
					staticRenderableScene.partsByRenderDomainChunkAndGfxAssetId.size,
				structuredInteriorCellCount: structuredInteriorScene.cells.length,
				structuredInteriorVertexCount: structuredInteriorScene.cells.reduce(
					(total, cell) => total + cell.renderGeometry.vertexCount,
					0,
				),
				structuredInteriorTriangleCount: structuredInteriorScene.cells.reduce(
					(total, cell) => total + cell.renderGeometry.triangleCount,
					0,
				),
			},
		};
		const metricsKey = JSON.stringify(metrics);
		if (metricsKey === lastReportedMetricsKey) {
			return;
		}

		lastReportedMetricsKey = metricsKey;
		onRenderMetricsChange?.(metrics);
	}

	function reportCameraResidency(
		nextResidency: BrowserCameraResidency = latestCameraResidency,
	): void {
		latestCameraResidency = nextResidency;
		const residencyKey = describeBrowserCameraResidencyKey(nextResidency);
		if (residencyKey === lastReportedCameraResidencyKey) {
			return;
		}

		lastReportedCameraResidencyKey = residencyKey;
		onCameraResidencyChange?.(nextResidency);
	}

	function terrainVertexCount(): number {
		return terrainScene.tiles.reduce(
			(total, tile) => total + tile.mesh.vertices.length,
			0,
		);
	}

	function terrainTriangleCount(): number {
		return terrainScene.tiles.reduce(
			(total, tile) => total + tile.mesh.triangles.length,
			0,
		);
	}

	function shouldUseReducedFrameRate(): boolean {
		return document.visibilityState !== "visible" || !document.hasFocus();
	}

	function syncStaticRenderableMeshes(
		sceneModel: StaticRenderableSceneModel,
	): void {
		syncRenderChunkRoots(renderChunkTransforms);

		const partsByGroupKey = sceneModel.partsByRenderDomainChunkAndGfxAssetId;
		const activeStaticGeometryKeys = new Set<string>();

		for (const [groupKey, mesh] of staticRenderableGroupMeshes.entries()) {
			const activeParts = partsByGroupKey.get(groupKey);
			if (
				activeParts &&
				activeParts.length <= staticRenderableMeshCapacity(mesh)
			) {
				continue;
			}

			mesh.removeFromParent();
			disposeMeshMaterial(mesh);
			staticRenderableGroupMeshes.delete(groupKey);
			staticRenderableGroupPartSignatures.delete(groupKey);
		}

		for (const [groupKey, parts] of partsByGroupKey.entries()) {
			const firstPart = parts[0];
			if (!firstPart) {
				continue;
			}
			const gfxAssetId = firstPart.gfxObjAssetId;
			const materialPlan = materialResourceCache.resolveMaterialPlan({
				slots: firstPart.materialSlots,
				appearanceKey: firstPart.materialAppearanceKey,
				preparedByAssetId: assetState.preparedByAssetId,
				fallbackColorKey: firstPart.debugColorKey,
			});
			const geometry = getStaticRenderableGeometry(
				gfxAssetId,
				materialPlan.signature,
				materialPlan.geometrySlots,
			);
			if (!geometry) {
				continue;
			}
			activeStaticGeometryKeys.add(
				formatStaticGeometryCacheKey(gfxAssetId, materialPlan.signature),
			);

			const chunkRoot = getRenderChunkRoot(firstPart.renderChunk.chunkKey);
			let mesh = staticRenderableGroupMeshes.get(groupKey);
			if (!mesh) {
				mesh = createStaticRenderableInstancedMesh(
					groupKey,
					gfxAssetId,
					geometry,
					materialPlan.materials,
					parts.length,
				);
				chunkRoot.add(mesh);
				staticRenderableGroupMeshes.set(groupKey, mesh);
			} else {
				chunkRoot.attach(mesh);
			}

			mesh.layers.set(staticRenderableLayerForDomain(firstPart.renderDomain));
			if (firstPart.kind === "indoor-static") {
				mesh.layers.enable(WORLD_RENDER_LAYER.portalInterior);
			}
			applyRenderStyleToObject(mesh);
			const partsSignature = describeStaticRenderablePartsSignature(parts);
			if (
				staticRenderableGroupPartSignatures.get(groupKey) !== partsSignature
			) {
				updateStaticRenderableInstancedMesh(mesh, parts);
				staticRenderableGroupPartSignatures.set(groupKey, partsSignature);
			} else {
				mesh.count = parts.length;
			}
		}

		for (const [geometryKey, geometry] of staticGeometryCache.entries()) {
			if (activeStaticGeometryKeys.has(geometryKey)) {
				continue;
			}

			geometry.dispose();
			staticGeometryCache.delete(geometryKey);
		}

		syncRenderChunkRoots(renderChunkTransforms);
		updateCameraFrame();
	}

	function syncDebugOverlayMeshes(sceneModel: WorldDebugOverlayModel): void {
		syncRenderChunkRoots(renderChunkTransforms);

		for (const object of debugOverlayObjects.values()) {
			object.removeFromParent();
			disposeObjectTree(object);
		}
		debugOverlayObjects.clear();

		if (sceneModel.showCellIndicators) {
			for (const cell of sceneModel.cells) {
				const overlay = createCellDebugOverlayGroup(cell);
				getRenderChunkRoot(cell.renderChunk.chunkKey).add(overlay);
				debugOverlayObjects.set(
					debugCellSpatialItemId(cell.renderKey),
					overlay,
				);
			}
		}

		if (sceneModel.showPortalPolygons) {
			for (const portal of sceneModel.portals) {
				const overlay = createPortalDebugOverlayLine(portal);
				if (overlay) {
					getRenderChunkRoot(portal.renderChunk.chunkKey).add(overlay);
					debugOverlayObjects.set(
						portalSpatialItemId(portal.portalId),
						overlay,
					);
				}
			}
		}

		syncRenderChunkRoots(renderChunkTransforms);
		updateCameraFrame();
	}

	function syncStructuredInteriorMeshes(
		sceneModel: StructuredInteriorSceneModel,
	): void {
		syncRenderChunkRoots(renderChunkTransforms);

		const activeRenderKeys = new Set(
			sceneModel.cells.map((cell) => cell.renderKey),
		);
		for (const [renderKey, mesh] of structuredInteriorMeshes.entries()) {
			if (activeRenderKeys.has(renderKey)) {
				continue;
			}

			mesh.removeFromParent();
			disposeMesh(mesh);
			structuredInteriorMeshes.delete(renderKey);
		}

		for (const cell of sceneModel.cells) {
			const chunkRoot = getRenderChunkRoot(cell.renderChunk.chunkKey);
			let mesh = structuredInteriorMeshes.get(cell.renderKey);
			if (!mesh) {
				mesh = createStructuredInteriorCellMesh(cell);
				chunkRoot.add(mesh);
				structuredInteriorMeshes.set(cell.renderKey, mesh);
			} else {
				chunkRoot.attach(mesh);
			}

			updateStructuredInteriorCellMesh(mesh, cell);
		}

		syncRenderChunkRoots(renderChunkTransforms);
		updateResidencyIndex();
		updateRenderWorkingModel();
		updateCameraFrame();
	}

	function clearMaterializedSceneMeshes(): void {
		for (const mesh of staticRenderableGroupMeshes.values()) {
			mesh.removeFromParent();
			disposeMeshMaterial(mesh);
		}
		staticRenderableGroupMeshes.clear();
		staticRenderableGroupPartSignatures.clear();
		for (const geometry of staticGeometryCache.values()) {
			geometry.dispose();
		}
		staticGeometryCache.clear();
		for (const mesh of structuredInteriorMeshes.values()) {
			mesh.removeFromParent();
			disposeMesh(mesh);
		}
		structuredInteriorMeshes.clear();
	}

	function syncPortalMaskMeshes(model: TransitionPortalCandidateModel): void {
		syncRenderChunkRoots(renderChunkTransforms);

		const activeGroupIds = new Set(
			model.candidates.map((candidate) => candidate.id),
		);
		for (const [groupId, mesh] of portalMaskMeshes.entries()) {
			if (activeGroupIds.has(groupId)) {
				continue;
			}

			mesh.removeFromParent();
			disposeMesh(mesh);
			portalMaskMeshes.delete(groupId);
			portalMaskGeometrySignatures.delete(groupId);
			const passMesh = portalAperturePassMeshes.get(groupId);
			if (passMesh) {
				passMesh.removeFromParent();
				portalAperturePassMeshes.delete(groupId);
			}
		}

		for (const candidate of model.candidates) {
			const chunkRoot = getRenderChunkRoot(candidate.renderChunk.chunkKey);
			let mesh = portalMaskMeshes.get(candidate.id);
			if (!mesh) {
				mesh = createPortalMaskMesh(candidate);
				chunkRoot.add(mesh);
				portalMaskMeshes.set(candidate.id, mesh);
				portalMaskGeometrySignatures.set(
					candidate.id,
					describePortalMaskGeometrySignature(candidate),
				);
			} else {
				chunkRoot.attach(mesh);
				const geometrySignature =
					describePortalMaskGeometrySignature(candidate);
				if (
					portalMaskGeometrySignatures.get(candidate.id) !== geometrySignature
				) {
					mesh.geometry.dispose();
					mesh.geometry = buildPortalMaskGeometry(candidate.aperture.points);
					portalMaskGeometrySignatures.set(candidate.id, geometrySignature);
				}
				updatePortalMaskMesh(mesh, candidate);
			}
		}

		setPortalMaskVisibility(null);
		syncRenderChunkRoots(renderChunkTransforms);
		updateCameraFrame();
	}

	function createStructuredInteriorCellMesh(
		cell: StructuredInteriorCell,
	): Mesh {
		const materialPlan = materialResourceCache.resolveMaterialPlan({
			slots: cell.surfaceIds.map((surfaceId, slotIndex) => ({
				slotIndex,
				surfaceId,
				materialAssetId: formatMaterialAssetId(surfaceId),
			})),
			appearanceKey: "structured-interior",
			preparedByAssetId: assetState.preparedByAssetId,
			fallbackColorKey: cell.debugColorKey,
		});
		const geometry = buildGfxObjGeometry(
			cell.renderGeometry,
			materialPlan.geometrySlots,
		);
		const mesh = new Mesh(geometry, materialPlan.materials);
		mesh.name = `structured-interior/${cell.renderKey}`;
		mesh.userData.materialOwnedByResourceCache = true;
		mesh.matrixAutoUpdate = false;
		mesh.layers.set(WORLD_RENDER_LAYER.diagnosticInterior);
		mesh.layers.enable(WORLD_RENDER_LAYER.portalInterior);
		mesh.userData.spatialItemId = structuredCellSpatialItemId(cell.renderKey);
		mesh.userData.renderStyleDebugColorKey = cell.debugColorKey;
		applyRenderStyleToObject(mesh);
		return mesh;
	}

	function createPortalMaskMesh(group: TransitionPortalCandidate): Mesh {
		const mesh = new Mesh(
			buildPortalMaskGeometry(group.aperture.points),
			createPortalMaskMaterial(group.stencilRef),
		);
		mesh.name = `portal-mask/${group.id}`;
		mesh.layers.set(WORLD_RENDER_LAYER.portalMask);
		mesh.layers.enable(WORLD_RENDER_LAYER.portalDepthReset);
		mesh.matrixAutoUpdate = false;
		updatePortalMaskMesh(mesh, group);
		return mesh;
	}

	function updatePortalMaskMesh(
		mesh: Mesh,
		group: TransitionPortalCandidate,
	): void {
		mesh.matrix.copy(
			buildAcPlacementMatrix(
				group.aperture.chunkLocalPlacement,
				{ x: 0, y: 0, z: 0 },
				{ x: 1, y: 1, z: 1 },
			),
		);
		const material = mesh.material;
		if (!Array.isArray(material)) {
			material.stencilRef = group.stencilRef;
		}
	}

	function describePortalMaskGeometrySignature(
		group: TransitionPortalCandidate,
	): string {
		return [
			group.aperture.id,
			describePlacementSignature(group.aperture.chunkLocalPlacement),
			group.aperture.points
				.map(
					(point) =>
						`${point.x.toFixed(5)},${point.y.toFixed(5)},${point.z.toFixed(5)}`,
				)
				.join(";"),
		].join("|");
	}

	function buildPortalMaskGeometry(
		points: TransitionPortalCandidate["aperture"]["points"],
	): BufferGeometry {
		const geometry = new BufferGeometry();
		geometry.setAttribute(
			"position",
			new BufferAttribute(
				new Float32Array(
					points.flatMap((point) => [point.x, point.y, point.z]),
				),
				3,
			),
		);
		const indices: number[] = [];
		for (let index = 1; index < points.length - 1; index += 1) {
			indices.push(0, index, index + 1);
		}
		geometry.setIndex(indices);
		geometry.computeVertexNormals();
		return geometry;
	}

	function createPortalMaskMaterial(stencilRef: number): MeshBasicMaterial {
		return new MeshBasicMaterial({
			colorWrite: false,
			// The mask must be depth-tested so nearer exterior statics can occlude
			// the aperture; the following depth-reset pass only touches pixels that
			// survived this visible-aperture test.
			depthTest: true,
			depthWrite: true,
			side: DoubleSide,
			stencilWrite: true,
			stencilRef,
			stencilFunc: AlwaysStencilFunc,
			stencilFail: KeepStencilOp,
			stencilZFail: KeepStencilOp,
			stencilZPass: ReplaceStencilOp,
		});
	}

	function applyPortalMaskStencilState(
		material: MeshBasicMaterial,
		transition: NonNullable<WorldRenderGraphNode["transition"]>,
	): void {
		material.stencilWrite = true;
		if (transition.parentStencilRef === null) {
			material.stencilRef = transition.stencilRef;
			material.stencilFunc = AlwaysStencilFunc;
			material.stencilZPass = ReplaceStencilOp;
			return;
		}

		material.stencilRef = transition.parentStencilRef;
		material.stencilFunc = EqualStencilFunc;
		// WebGL has one stencil reference for both comparison and replacement.
		// Because transition refs are sequential, incrementing the parent value
		// produces the current depth while still requiring the parent aperture.
		material.stencilZPass = IncrementStencilOp;
	}

	function createPortalDepthResetMaterial(): ShaderMaterial {
		return new ShaderMaterial({
			glslVersion: GLSL3,
			vertexShader: `
				void main() {
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				}
			`,
			fragmentShader: `
				out vec4 outputColor;

				void main() {
					gl_FragDepth = 1.0;
					outputColor = vec4(0.0, 0.0, 0.0, 1.0);
				}
			`,
			colorWrite: false,
			depthFunc: AlwaysDepth,
			depthTest: true,
			depthWrite: true,
			side: DoubleSide,
			stencilWrite: true,
			stencilFunc: EqualStencilFunc,
			stencilRef: 0,
			stencilFail: KeepStencilOp,
			stencilZFail: KeepStencilOp,
			stencilZPass: KeepStencilOp,
		});
	}

	function setPortalMaskVisibility(activeGroupId: string | null): void {
		for (const [groupId, mesh] of portalMaskMeshes.entries()) {
			mesh.visible = activeGroupId !== null && groupId === activeGroupId;
		}
	}

	function syncPortalAperturePassScene(
		batch: readonly VisibleTransitionPortalWork[],
		material: Material,
	): void {
		for (const work of batch) {
			const sourceMesh = work.maskMesh;
			const passMesh = getPortalAperturePassMesh(work.workItem.id);
			sourceMesh.updateMatrixWorld(true);
			passMesh.geometry = sourceMesh.geometry;
			passMesh.material = material;
			passMesh.matrix.copy(sourceMesh.matrixWorld);
			passMesh.matrixWorldNeedsUpdate = true;
			if (passMesh.parent !== portalAperturePassScene) {
				portalAperturePassScene.add(passMesh);
			}
		}
	}

	function getPortalAperturePassMesh(workItemId: string): Mesh {
		const existing = portalAperturePassMeshes.get(workItemId);
		if (existing) {
			return existing;
		}

		const mesh = new Mesh();
		mesh.name = `portal-aperture-pass/${workItemId}`;
		mesh.matrixAutoUpdate = false;
		portalAperturePassMeshes.set(workItemId, mesh);
		return mesh;
	}

	function clearPortalAperturePassScene(): void {
		portalAperturePassScene.clear();
	}

	function applyPortalCompositeStencil(
		sceneSet: TransitionPortalGraphScene,
		stencilRef: number,
	): void {
		forEachPortalCompositeMaterial(sceneSet, (material) => {
			material.stencilWrite = true;
			material.stencilRef = stencilRef;
			material.stencilFunc = EqualStencilFunc;
			material.stencilFail = KeepStencilOp;
			material.stencilZFail = KeepStencilOp;
			material.stencilZPass = KeepStencilOp;
		});
	}

	function clearPortalCompositeStencil(
		sceneSet: TransitionPortalGraphScene,
	): void {
		forEachPortalCompositeMaterial(sceneSet, (material) => {
			material.stencilWrite = false;
			material.stencilRef = 0;
			material.stencilFunc = AlwaysStencilFunc;
			material.stencilFail = KeepStencilOp;
			material.stencilZFail = KeepStencilOp;
			material.stencilZPass = KeepStencilOp;
		});
	}

	function forEachPortalCompositeMaterial(
		sceneSet: TransitionPortalGraphScene,
		visit: (material: Material) => void,
	): void {
		if (sceneSet === "interior") {
			for (const mesh of renderWorkingModel.interior.cellShellMeshes) {
				visitMeshMaterials(mesh, visit);
			}
			for (const mesh of renderWorkingModel.interior.staticRenderableMeshes) {
				visitMeshMaterials(mesh, visit);
			}
			return;
		}

		for (const mesh of renderWorkingModel.exterior.terrainMeshes) {
			visitMeshMaterials(mesh, visit);
		}
		for (const mesh of renderWorkingModel.exterior.staticRenderableMeshes) {
			visitMeshMaterials(mesh, visit);
		}
	}

	function visitMeshMaterials(
		mesh: Mesh | InstancedMesh,
		visit: (material: Material) => void,
	): void {
		if (Array.isArray(mesh.material)) {
			for (const material of mesh.material) {
				visit(material);
			}
			return;
		}

		visit(mesh.material);
	}

	function createCellDebugOverlayGroup(cell: CellDebugOverlay): Group {
		const group = new Group();
		group.name = `debug-cell/${cell.renderKey}`;
		group.matrixAutoUpdate = false;
		group.layers.set(WORLD_RENDER_LAYER.debugOverlay);
		group.matrix.copy(
			buildAcPlacementMatrix(
				cell.chunkLocalPlacement,
				{ x: 0, y: 0, z: 0 },
				{
					x: 1,
					y: 1,
					z: 1,
				},
			),
		);

		const color = buildStaticRenderableColor(cell.colorKey);
		const bounds = cell.bounds
			? createBoundsLineSegments(
					cell.bounds,
					cell.isSelected ? new Color("#ffffff") : color,
				)
			: null;
		if (bounds) {
			bounds.name = `debug-cell-bounds/${cell.renderKey}`;
			group.add(bounds);
		}
		if (cell.isSelected && cell.bounds) {
			const selectedBounds = createThickBoundsLineGroup(
				cell.bounds,
				new Color("#ffffff"),
				SELECTED_DEBUG_EDGE_RADIUS,
			);
			selectedBounds.name = `debug-cell-selected-bounds/${cell.renderKey}`;
			group.add(selectedBounds);
		}

		setObjectTreeLayer(group, WORLD_RENDER_LAYER.debugOverlay);
		return group;
	}

	function createPortalDebugOverlayLine(
		portal: PortalDebugOverlay,
	): Object3D | null {
		if (portal.points.length < 3) {
			return null;
		}

		const geometry = new BufferGeometry();
		geometry.setAttribute(
			"position",
			new BufferAttribute(
				new Float32Array(
					portal.points.flatMap((point) => [point.x, point.y, point.z]),
				),
				3,
			),
		);
		const line = new LineLoop(
			geometry,
			new LineBasicMaterial({
				color: buildPortalOverlayColor(portal),
				depthWrite: false,
				transparent: true,
				opacity: 0.95,
			}),
		);
		line.name = `debug-portal/${portal.portalId}`;
		line.layers.set(WORLD_RENDER_LAYER.debugOverlay);
		if (!portal.isSelected) {
			line.matrixAutoUpdate = false;
			line.matrix.copy(
				buildAcPlacementMatrix(
					portal.chunkLocalPlacement,
					{ x: 0, y: 0, z: 0 },
					{
						x: 1,
						y: 1,
						z: 1,
					},
				),
			);
			return line;
		}

		const group = new Group();
		group.name = `debug-portal-selected/${portal.portalId}`;
		group.matrixAutoUpdate = false;
		group.layers.set(WORLD_RENDER_LAYER.debugOverlay);
		group.matrix.copy(
			buildAcPlacementMatrix(
				portal.chunkLocalPlacement,
				{ x: 0, y: 0, z: 0 },
				{
					x: 1,
					y: 1,
					z: 1,
				},
			),
		);
		group.add(line);
		group.add(
			createThickPolylineGroup(
				portal.points,
				true,
				new Color("#ffffff"),
				SELECTED_DEBUG_EDGE_RADIUS,
			),
		);
		setObjectTreeLayer(group, WORLD_RENDER_LAYER.debugOverlay);
		return group;
	}

	function createBoundsLineSegments(
		bounds: NonNullable<CellDebugOverlay["bounds"]>,
		color: Color,
	): LineSegments {
		const { min, max } = bounds;
		const corners = [
			[min.x, min.y, min.z],
			[max.x, min.y, min.z],
			[max.x, max.y, min.z],
			[min.x, max.y, min.z],
			[min.x, min.y, max.z],
			[max.x, min.y, max.z],
			[max.x, max.y, max.z],
			[min.x, max.y, max.z],
		];
		const edgeIndices = [
			0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7,
		];
		const positions = edgeIndices.flatMap((index) => corners[index] ?? []);
		const geometry = new BufferGeometry();
		geometry.setAttribute(
			"position",
			new BufferAttribute(new Float32Array(positions), 3),
		);
		return new LineSegments(
			geometry,
			new LineBasicMaterial({
				color,
				depthTest: false,
				depthWrite: false,
				transparent: true,
				opacity: 0.32,
			}),
		);
	}

	function createThickBoundsLineGroup(
		bounds: NonNullable<CellDebugOverlay["bounds"]>,
		color: Color,
		radius: number,
	): Group {
		const { min, max } = bounds;
		const corners = [
			new Vector3(min.x, min.y, min.z),
			new Vector3(max.x, min.y, min.z),
			new Vector3(max.x, max.y, min.z),
			new Vector3(min.x, max.y, min.z),
			new Vector3(min.x, min.y, max.z),
			new Vector3(max.x, min.y, max.z),
			new Vector3(max.x, max.y, max.z),
			new Vector3(min.x, max.y, max.z),
		];
		const edgeIndices = [
			0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7,
		];
		const group = new Group();
		const material = createSelectedDebugEdgeMaterial(color);
		for (let index = 0; index < edgeIndices.length; index += 2) {
			const start = corners[edgeIndices[index] ?? 0];
			const end = corners[edgeIndices[index + 1] ?? 0];
			if (start && end) {
				group.add(createCylinderSegment(start, end, radius, material));
			}
		}
		return group;
	}

	function createThickPolylineGroup(
		points: PortalDebugOverlay["points"],
		closed: boolean,
		color: Color,
		radius: number,
	): Group {
		const group = new Group();
		const material = createSelectedDebugEdgeMaterial(color);
		const vectors = points.map(
			(point) => new Vector3(point.x, point.y, point.z),
		);
		const segmentCount = closed ? vectors.length : vectors.length - 1;
		for (let index = 0; index < segmentCount; index += 1) {
			const start = vectors[index];
			const end = vectors[(index + 1) % vectors.length];
			if (start && end) {
				group.add(createCylinderSegment(start, end, radius, material));
			}
		}
		return group;
	}

	function createSelectedDebugEdgeMaterial(color: Color): MeshBasicMaterial {
		return new MeshBasicMaterial({
			color,
			depthTest: false,
			depthWrite: false,
			transparent: true,
			opacity: 0.95,
		});
	}

	function createCylinderSegment(
		start: Vector3,
		end: Vector3,
		radius: number,
		material: MeshBasicMaterial,
	): Mesh {
		const direction = new Vector3().subVectors(end, start);
		const length = direction.length();
		const mesh = new Mesh(
			new CylinderGeometry(radius, radius, length, 8),
			material,
		);
		mesh.position.copy(start).add(end).multiplyScalar(0.5);
		if (length > 0) {
			mesh.quaternion.setFromUnitVectors(
				new Vector3(0, 1, 0),
				direction.normalize(),
			);
		}
		return mesh;
	}

	function buildPortalOverlayColor(portal: PortalDebugOverlay): Color {
		if (portal.isSelected) {
			return new Color("#ffffff");
		}
		if (debugOverlayScene.highlightPortalTargets) {
			if (portal.targetStatus === "loaded-visible") {
				return new Color("#61d394");
			}
			if (portal.targetStatus === "known-unloaded") {
				return new Color("#f4d35e");
			}
			if (portal.targetStatus === "outside") {
				return new Color("#7cc7ff");
			}
			if (portal.targetStatus === "missing-polygon") {
				return new Color("#ff6b6b");
			}
			return new Color("#9aa9b2");
		}

		return buildStaticRenderableColor(portal.colorKey);
	}

	function updateStructuredInteriorCellMesh(
		mesh: Mesh,
		cell: StructuredInteriorCell,
	): void {
		mesh.matrix.copy(
			buildAcPlacementMatrix(
				cell.chunkLocalPlacement,
				{ x: 0, y: 0, z: 0 },
				{
					x: 1,
					y: 1,
					z: 1,
				},
			),
		);
		mesh.matrixWorldNeedsUpdate = true;
	}

	function getStaticRenderableGeometry(
		gfxAssetId: string,
		materialSignature: string,
		materialSlots: readonly MaterialGeometrySlot[],
	): BufferGeometry | null {
		const geometryKey = formatStaticGeometryCacheKey(
			gfxAssetId,
			materialSignature,
		);
		const cachedGeometry = staticGeometryCache.get(geometryKey);
		if (cachedGeometry) {
			return cachedGeometry;
		}

		const asset = assetState.preparedByAssetId[gfxAssetId];
		if (
			!isPreparedGfxObjAsset(asset) ||
			asset.payload.renderGeometry.vertexCount === 0
		) {
			return null;
		}

		const geometry = buildGfxObjGeometry(
			asset.payload.renderGeometry,
			materialSlots,
		);
		staticGeometryCache.set(geometryKey, geometry);
		return geometry;
	}

	function formatStaticGeometryCacheKey(
		gfxAssetId: string,
		materialSignature: string,
	): string {
		return `${gfxAssetId}|${materialSignature}`;
	}

	function createStaticRenderableInstancedMesh(
		groupKey: string,
		gfxAssetId: string,
		geometry: BufferGeometry,
		materials: Material[],
		count: number,
	): InstancedMesh {
		const mesh = new InstancedMesh(
			geometry,
			materials,
			nextStaticRenderableInstanceCapacity(count),
		);
		mesh.count = count;
		mesh.name = `static-renderable/${groupKey}`;
		mesh.userData.gfxAssetId = gfxAssetId;
		mesh.userData.materialOwnedByResourceCache = true;
		mesh.userData.renderStyleDebugColorKey = groupKey;
		return mesh;
	}

	function updateStaticRenderableInstancedMesh(
		mesh: InstancedMesh,
		parts: StaticRenderablePart[],
	): void {
		mesh.count = parts.length;
		parts.forEach((part, index) => {
			mesh.setMatrixAt(index, buildStaticRenderablePartMatrix(part));
			mesh.setColorAt(index, buildStaticRenderableColor(part.debugColorKey));
		});
		mesh.instanceMatrix.needsUpdate = true;
		if (mesh.instanceColor) {
			mesh.instanceColor.needsUpdate = true;
		}
		const materialOrMaterials = mesh.material;
		if (Array.isArray(materialOrMaterials)) {
			for (const material of materialOrMaterials) {
				material.needsUpdate = true;
			}
		} else {
			materialOrMaterials.needsUpdate = true;
		}
	}

	function staticRenderableMeshCapacity(mesh: InstancedMesh): number {
		return mesh.instanceMatrix.count;
	}

	function nextStaticRenderableInstanceCapacity(requiredCount: number): number {
		let capacity = MIN_STATIC_RENDERABLE_INSTANCE_CAPACITY;
		while (capacity < requiredCount) {
			capacity *= 2;
		}
		return capacity;
	}

	function describeStaticRenderablePartsSignature(
		parts: readonly StaticRenderablePart[],
	): string {
		return parts.map((part) => part.renderKey).join("|");
	}

	function describePlacementSignature(
		placement: StaticRenderablePart["chunkLocalInstancePlacement"],
	): string {
		return [
			placement.origin.x,
			placement.origin.y,
			placement.origin.z,
			placement.orientation.w,
			placement.orientation.x,
			placement.orientation.y,
			placement.orientation.z,
		]
			.map((value) => value.toFixed(5))
			.join(",");
	}

	function createTerrainTileMesh(tile: TerrainSceneTile): Mesh {
		const geometry = buildTerrainGeometry(tile.mesh);
		const material = new MeshStandardMaterial({
			vertexColors: true,
			flatShading: true,
			metalness: 0.05,
			roughness: 0.94,
		});
		const mesh = new Mesh(geometry, material);
		mesh.name = tile.assetId;
		mesh.userData.renderStyleDebugColorKey = tile.assetId;
		applyRenderStyleToObject(mesh);
		return mesh;
	}

	function syncRenderStyle(): void {
		for (const mesh of terrainMeshes.values()) {
			applyRenderStyleToObject(mesh);
		}
		for (const mesh of staticRenderableGroupMeshes.values()) {
			applyRenderStyleToObject(mesh);
		}
		for (const mesh of structuredInteriorMeshes.values()) {
			applyRenderStyleToObject(mesh);
		}
	}

	function applyRenderStyleToObject(object: Object3D): void {
		object.traverse((child) => {
			if (child instanceof Mesh) {
				applyRenderStyleToMesh(child);
			}
		});
	}

	function applyRenderStyleToMesh(mesh: Mesh): void {
		const originalMaterial = restoreRenderStyleOriginalMaterial(mesh);

		if (renderStyle === "solid") {
			return;
		}

		storeRenderStyleOriginalMaterial(mesh, originalMaterial);
		mesh.material =
			renderStyle === "wireframe"
				? getWireframeOverrideMaterial(mesh)
				: getNoMaterialOverrideMaterial(mesh);
	}

	function getNoMaterialOverrideMaterial(mesh: Mesh): MeshStandardMaterial {
		if (mesh instanceof InstancedMesh) {
			return getInstancedNoMaterialOverrideMaterial(mesh);
		}

		const color = getRenderStyleDebugColor(mesh);
		const colorKey = color.getHexString();
		const existing = noMaterialOverrideMaterials.get(colorKey);
		if (existing) {
			return existing;
		}

		const material = new MeshStandardMaterial({
			color,
			emissive: color,
			emissiveIntensity: 0.16,
			flatShading: true,
			metalness: 0.02,
			roughness: 0.9,
			side: DoubleSide,
		});
		noMaterialOverrideMaterials.set(colorKey, material);
		return material;
	}

	function getInstancedNoMaterialOverrideMaterial(
		mesh: InstancedMesh,
	): MeshStandardMaterial {
		const color = getRenderStyleDebugColor(mesh);
		const colorKey = `instanced:${color.getHexString()}`;
		const existing = noMaterialOverrideMaterials.get(colorKey);
		if (existing) {
			return existing;
		}

		const material = new MeshStandardMaterial({
			color,
			emissive: color,
			emissiveIntensity: 0.2,
			flatShading: true,
			metalness: 0.02,
			roughness: 0.9,
			side: DoubleSide,
			vertexColors: true,
		});
		noMaterialOverrideMaterials.set(colorKey, material);
		return material;
	}

	function getWireframeOverrideMaterial(mesh: Mesh): MeshBasicMaterial {
		const color = getRenderStyleDebugColor(mesh);
		const colorKey = color.getHexString();
		const existing = wireframeOverrideMaterials.get(colorKey);
		if (existing) {
			return existing;
		}

		const material = new MeshBasicMaterial({
			color,
			depthTest: false,
			side: DoubleSide,
			vertexColors: true,
			wireframe: true,
		});
		wireframeOverrideMaterials.set(colorKey, material);
		return material;
	}

	function getRenderStyleDebugColor(mesh: Mesh): Color {
		const userData = mesh.userData as RenderStyleMaterialUserData;
		const colorKey = userData.renderStyleDebugColorKey ?? mesh.name;
		return buildStaticRenderableColor(colorKey);
	}

	function storeRenderStyleOriginalMaterial(
		mesh: Mesh,
		material: Material | Material[],
	): void {
		const userData = mesh.userData as RenderStyleMaterialUserData;
		userData.originalRenderStyleMaterial ??= material;
	}

	function restoreRenderStyleOriginalMaterial(
		mesh: Mesh,
	): Material | Material[] {
		const userData = mesh.userData as RenderStyleMaterialUserData;
		const originalMaterial = userData.originalRenderStyleMaterial;
		if (!originalMaterial) {
			return mesh.material;
		}

		mesh.material = originalMaterial;
		delete userData.originalRenderStyleMaterial;
		return originalMaterial;
	}

	function dispose(): void {
		if (disposed) {
			return;
		}
		disposed = true;
		window.cancelAnimationFrame(frameId);
		window.removeEventListener("focus", syncReducedFrameRateState);
		window.removeEventListener("blur", syncReducedFrameRateState);
		document.removeEventListener("visibilitychange", syncReducedFrameRateState);
		resizeObserver.disconnect();
		for (const mesh of terrainMeshes.values()) {
			disposeMesh(mesh);
		}
		terrainMeshes.clear();
		for (const mesh of staticRenderableGroupMeshes.values()) {
			disposeMeshMaterial(mesh);
		}
		staticRenderableGroupMeshes.clear();
		staticRenderableGroupPartSignatures.clear();
		for (const geometry of staticGeometryCache.values()) {
			geometry.dispose();
		}
		staticGeometryCache.clear();
		for (const mesh of structuredInteriorMeshes.values()) {
			disposeMesh(mesh);
		}
		structuredInteriorMeshes.clear();
		for (const mesh of portalMaskMeshes.values()) {
			disposeMesh(mesh);
		}
		portalMaskMeshes.clear();
		portalMaskGeometrySignatures.clear();
		portalAperturePassScene.clear();
		portalAperturePassMeshes.clear();
		for (const object of debugOverlayObjects.values()) {
			disposeObjectTree(object);
		}
		debugOverlayObjects.clear();
		materialResourceCache.dispose();
		chunkRoots.clear();
		chunkRootContainer.clear();
		disposeMaterialMap(noMaterialOverrideMaterials);
		disposeMaterialMap(wireframeOverrideMaterials);
		portalBatchMaskMaterial.dispose();
		portalDepthResetMaterial.dispose();
		renderer.dispose();
		renderer.domElement.remove();
	}
}

function disposeMesh(mesh: Mesh): void {
	mesh.geometry.dispose();
	disposeMeshMaterial(mesh);
}

function disposeObjectTree(root: Object3D): void {
	root.traverse((object) => {
		const maybeGeometry = (object as { geometry?: unknown }).geometry;
		if (maybeGeometry instanceof BufferGeometry) {
			maybeGeometry.dispose();
		}

		const maybeMaterial = (object as { material?: unknown }).material;
		if (Array.isArray(maybeMaterial)) {
			for (const material of maybeMaterial) {
				disposeMaterial(material);
			}
			return;
		}
		if (maybeMaterial) {
			disposeMaterial(maybeMaterial as Material);
		}
	});
}

function disposeMaterial(material: Material): void {
	material.dispose();
}

function enableAllWorldRenderLayers(object: Object3D): void {
	for (const layer of Object.values(WORLD_RENDER_LAYER)) {
		object.layers.enable(layer);
	}
}

function detectPortalDepthResetCapability(
	renderer: WebGLRenderer,
): PortalDepthResetCapability {
	const gl = renderer.getContext();
	if (!isWebGL2RenderingContext(gl)) {
		return {
			supported: false,
			reason:
				"Outdoor portal aperture depth reset requires WebGL2 gl_FragDepth support.",
		};
	}

	const stencilBits = Number(gl.getParameter(gl.STENCIL_BITS));
	if (stencilBits <= 0) {
		return {
			supported: false,
			reason: "Outdoor portal aperture depth reset requires a stencil buffer.",
		};
	}

	return { supported: true, reason: null };
}

function assertPortalDepthResetSupported(
	capability: PortalDepthResetCapability,
): void {
	if (!capability.supported) {
		throw new Error(
			capability.reason ??
				"Outdoor portal aperture depth reset is unavailable.",
		);
	}
}

function isWebGL2RenderingContext(
	context: WebGLRenderingContext | WebGL2RenderingContext,
): context is WebGL2RenderingContext {
	return (
		typeof WebGL2RenderingContext !== "undefined" &&
		context instanceof WebGL2RenderingContext
	);
}

function setObjectTreeLayer(root: Object3D, layer: number): void {
	root.traverse((object) => object.layers.set(layer));
}

function countVisibleObjects(objects: Iterable<Object3D>): number {
	let count = 0;
	for (const object of objects) {
		if (object.visible) {
			count += 1;
		}
	}
	return count;
}

function describeBrowserCameraResidencyKey(
	residency: BrowserCameraResidency,
): string {
	return [
		residency.kind,
		residency.landblockId ?? "none",
		residency.envCellId ?? "none",
		residency.source,
	].join(":");
}

function createPortalRenderMetrics(
	model: TransitionPortalCandidateModel,
): WorldRenderPortalMetrics {
	return {
		topologyOutdoorPortalCount: model.diagnostics.topologyPortalCount,
		apertureCandidateCount: model.diagnostics.apertureCandidateCount,
		renderWorkItemCandidateCount: model.diagnostics.workItemCandidateCount,
		visiblePortalWorkItemCount: 0,
		maskedInteriorCellCount: 0,
		skippedMissingApertureCount: model.diagnostics.skippedMissingApertureCount,
		skippedMissingPolygonCount: model.diagnostics.skippedMissingPolygonCount,
		skippedOutsideFrustumCount: 0,
		skippedBackFacingCount: 0,
		skippedTooSmallCount: 0,
		screenAreaBuckets: {
			lt16: 0,
			lt64: 0,
			lt256: 0,
			gte256: 0,
		},
		minVisibleScreenAreaPx: null,
		maxVisibleScreenAreaPx: null,
	};
}

function createRenderDebugMetrics(
	renderer: WebGLRenderer,
	options: Omit<
		WorldRenderDebugMetrics,
		| "canvasWidth"
		| "canvasHeight"
		| "pixelRatio"
		| "renderCalls"
		| "renderTriangles"
		| "renderLines"
		| "renderPoints"
	>,
): WorldRenderDebugMetrics {
	return {
		canvasWidth: renderer.domElement.width,
		canvasHeight: renderer.domElement.height,
		pixelRatio: renderer.getPixelRatio(),
		cameraViewResidency: options.cameraViewResidency,
		residencyCellCount: options.residencyCellCount,
		residencyLandblockCount: options.residencyLandblockCount,
		residencyAabbCandidateCount: options.residencyAabbCandidateCount,
		residencyCellBspMatchCount: options.residencyCellBspMatchCount,
		residencyAabbFallbackCount: options.residencyAabbFallbackCount,
		residencySource: options.residencySource,
		renderGraphPolicy: options.renderGraphPolicy,
		renderGraphBaseScene: options.renderGraphBaseScene,
		transitionPortalMaxDepth: options.transitionPortalMaxDepth,
		renderPassCount: options.renderPassCount,
		portalRenderWorkItemCount: options.portalRenderWorkItemCount,
		transitionApertureMaskPassCount: options.transitionApertureMaskPassCount,
		apertureDepthResetPassCount: options.apertureDepthResetPassCount,
		interiorCompositePassCount: options.interiorCompositePassCount,
		exteriorCompositePassCount: options.exteriorCompositePassCount,
		transitionPortalCandidateCount: options.transitionPortalCandidateCount,
		portalApertureMeshCount: options.portalApertureMeshCount,
		terrainMeshCount: options.terrainMeshCount,
		visibleTerrainMeshCount: options.visibleTerrainMeshCount,
		staticGroupMeshCount: options.staticGroupMeshCount,
		visibleStaticGroupMeshCount: options.visibleStaticGroupMeshCount,
		structuredInteriorMeshCount: options.structuredInteriorMeshCount,
		visibleStructuredInteriorMeshCount:
			options.visibleStructuredInteriorMeshCount,
		debugOverlayObjectCount: options.debugOverlayObjectCount,
		visibleDebugOverlayObjectCount: options.visibleDebugOverlayObjectCount,
		renderCalls: renderer.info.render.calls,
		renderTriangles: renderer.info.render.triangles,
		renderLines: renderer.info.render.lines,
		renderPoints: renderer.info.render.points,
	};
}

function disposeMeshMaterial(mesh: Mesh): void {
	restoreRenderStyleOriginalMaterialForDisposal(mesh);
	if (mesh.userData.materialOwnedByResourceCache === true) {
		return;
	}
	const material = mesh.material;
	if (Array.isArray(material)) {
		for (const entry of material) {
			entry.dispose();
		}
		return;
	}

	material.dispose();
}

function restoreRenderStyleOriginalMaterialForDisposal(mesh: Mesh): void {
	const userData = mesh.userData as RenderStyleMaterialUserData;
	if (!userData.originalRenderStyleMaterial) {
		return;
	}

	mesh.material = userData.originalRenderStyleMaterial;
	delete userData.originalRenderStyleMaterial;
}

function disposeMaterialMap(materials: Map<string, Material>): void {
	for (const material of materials.values()) {
		material.dispose();
	}
	materials.clear();
}
