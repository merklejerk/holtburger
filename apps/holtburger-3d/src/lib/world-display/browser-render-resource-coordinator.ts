import type {
	BrowserLocationSelection,
	BrowserTextureFilteringMode,
} from "../../app/browser-mode";
import { browserDestinationToInteriorCellId } from "../../app/browser-mode";
import {
	deriveTopologyEnvCellIdsForLandblocks,
	deriveTerrainFocusLandblockId,
} from "../assets/scene-asset-request-planner";
import { deriveStructuredInteriorCoverage } from "../assets/structured-interior-coverage";
import {
	createInitialAssetChannelState,
	type AssetChannelState,
	type PreparedAssetRecord,
	type PreparedSetupAppearancePayload,
} from "../assets/types";
import { formatHex32, formatLandblockOutdoorAssetId } from "../landblocks";
import {
	deriveBrowserWorldDisplayModel,
	type BrowserWorldDisplayModel,
} from "./model";
import type { StaticLandblockRenderArtifactStoreSnapshot } from "./static-landblock-render-artifact-store";
import {
	deriveWorldDebugOverlayModel,
	type WorldDebugOverlayModel,
} from "./debug-overlays";
import { deriveOutdoorSceneInterest } from "./outdoor-scene-interest";
import {
	deriveRenderChunkTransforms,
	type RenderChunkTransform,
} from "./render-anchor";
import type {
	RenderLandblockAnchor,
	RenderChunkPlacement,
} from "./render-chunks";
import {
	createLinearRenderSpatialIndex,
	type RenderSpatialIndexQuery,
	type RenderSpatialMetadata,
} from "./render-spatial-index";
import {
	deriveBrowserStaticRenderablePickDiagnostic,
	type BrowserStaticRenderablePickDiagnostic,
} from "./browser-picker-diagnostics";
import {
	DEBUG_OVERLAY_SPATIAL_OWNER_KEY,
	STATIC_RENDERABLE_SPATIAL_OWNER_KEY,
	STRUCTURED_INTERIOR_SPATIAL_OWNER_KEY,
	TERRAIN_SPATIAL_OWNER_KEY,
	deriveDebugOverlaySpatialItems,
	deriveStaticRenderableSpatialItems,
	deriveStructuredInteriorSpatialItems,
	deriveTerrainSpatialItems,
} from "./render-spatial-scene";
import { deriveWorldRenderSceneContext } from "./render-scene-context";
import {
	createEmptyStaticRenderableSceneModel,
	deriveAppearancePreviewStaticRenderableSceneModel,
	deriveStaticRenderableSceneModel,
	mergeStaticRenderableSceneModels,
	type StaticRenderableSceneModel,
} from "./static-renderables";
import {
	deriveStructuredInteriorSceneModel,
	type StructuredInteriorSceneModel,
} from "./structured-interior-scene";
import {
	deriveTerrainSceneModel,
	deriveTerrainSceneModelFromLandblockArtifacts,
	type TerrainSceneTile,
	type TerrainSceneModel,
} from "./terrain-scene";
import { deriveLandblockRenderChunkPlacement } from "./render-chunks";
import { deriveTransitionPortalCandidates } from "./transition-portal-work-items";
import { WORLD_RENDER_DOMAIN } from "./render-domains";
import type { SceneCameraFrame } from "./camera";
import type { WorldDisplayRenderStyle } from "./renderer-contract";

let lastPreparedOutdoorAssetsNotRenderedSignature: string | null = null;
let lastReportedTerrainMaterialDiagnosticsSignature: string | null = null;
const TERRAIN_MATERIAL_DIAGNOSTIC_LOG_PREFIX =
	"[holtburger-3d][terrain-material]";
const TERRAIN_MATERIAL_DIAGNOSTIC_SAMPLE_LIMIT = 12;

export interface BrowserRenderResourceCoordinatorInput {
	assetState: AssetChannelState;
	browserDestination: BrowserLocationSelection | null;
	terrainLodRadius: number;
	buildingLodRadius: number;
	detailLodRadius: number;
	envCellLodRadius: number;
	transitionPortalMaxDepth: number;
	renderStyle: WorldDisplayRenderStyle;
	textureFilteringMode: BrowserTextureFilteringMode;
	detailTexturesEnabled: boolean;
	showPortalPolygons: boolean;
	showCellIndicators: boolean;
	highlightPortalTargets: boolean;
	diagnosticSelection: RenderSpatialMetadata | null;
	selectedStaticRenderableRenderKey: string | null;
	activeRenderAnchor: RenderLandblockAnchor | null;
	browserCameraFrame: SceneCameraFrame | null;
	runtimeAppearancePreviews: readonly BrowserRuntimeAppearancePreview[];
	staticLandblockRenderArtifacts: StaticLandblockRenderArtifactStoreSnapshot;
}

export interface BrowserRuntimeAppearancePreview {
	id: string;
	spawnCameraFrame: SceneCameraFrame;
	setupAppearance: PreparedSetupAppearancePayload;
}

export interface BrowserRenderResourceSnapshot {
	worldDisplay: BrowserWorldDisplayModel;
	renderSpatialQuery: RenderSpatialIndexQuery;
	activeRenderChunkCount: number;
	sceneStatusText: string;
	sceneContextText: string;
	terrainCacheText: string;
	terrainDataSourceText: string;
	sceneGeometryText: string;
	terrainHeightText: string;
	staticRenderableText: string;
	staticRenderableLayerText: string;
	structuredInteriorText: string;
	cellIndicatorText: string;
	portalDiagnosticsText: string;
	landblockVisibilityText: string;
	cellVisibilityFallbackText: string;
	staticLandblockRenderArtifactText: string;
}

export interface BrowserRenderResourceSurface {
	setAssetState(assetState: AssetChannelState): void;
	setRenderSceneContext(
		context: ReturnType<typeof deriveWorldRenderSceneContext>,
	): void;
	setRenderChunkTransforms(transforms: readonly RenderChunkTransform[]): void;
	setTerrainScene(scene: TerrainSceneModel): void;
	setStaticRenderableScene(scene: StaticRenderableSceneModel): void;
	setStructuredInteriorScene(scene: StructuredInteriorSceneModel): void;
	setTransitionPortalModel(
		model: ReturnType<typeof deriveTransitionPortalCandidates>,
	): void;
	setDebugOverlayScene(scene: WorldDebugOverlayModel): void;
	setRenderSpatialQuery(query: RenderSpatialIndexQuery | null): void;
	setSelectedStaticRenderableRenderKey(renderKey: string | null): void;
	setControlledCameraFrame(frame: SceneCameraFrame | null): void;
	setTransitionPortalMaxDepth(maxDepth: number): void;
	setRenderStyle(renderStyle: WorldDisplayRenderStyle): void;
	setTextureFilteringMode(mode: BrowserTextureFilteringMode): void;
	setDetailTexturesEnabled(enabled: boolean): void;
}

export function createEmptyBrowserRenderResourceSnapshot(): BrowserRenderResourceSnapshot {
	return {
		worldDisplay: deriveBrowserWorldDisplayModel({
			assetState: createInitialAssetChannelState(),
			browserDestination: null,
			terrainLodRadius: 0,
			buildingLodRadius: 0,
			detailLodRadius: 0,
		}),
		renderSpatialQuery: createLinearRenderSpatialIndex(),
		activeRenderChunkCount: 0,
		sceneStatusText:
			"Local outdoor scene context will lock in once the browser has a destination.",
		sceneContextText: "Outdoor",
		terrainCacheText: "Terrain cache is idle.",
		terrainDataSourceText: "No terrain provenance available yet.",
		sceneGeometryText: "No terrain geometry is cached yet.",
		terrainHeightText: "No terrain heights are cached yet.",
		staticRenderableText:
			"No static renderable source facts are active for the current outdoor coverage.",
		staticRenderableLayerText: "Waiting for static renderable data.",
		structuredInteriorText:
			"Structured interior scene is dormant until the browser destination or outdoor links select env cells.",
		cellIndicatorText: "Cell indicators are hidden.",
		portalDiagnosticsText: "Portal polygon overlays are hidden.",
		landblockVisibilityText:
			"Outdoor landblock selection is waiting for focus.",
		cellVisibilityFallbackText:
			"0 loaded env cells; renderer visibility pending.",
		staticLandblockRenderArtifactText:
			"Static landblock render artifacts are idle.",
	};
}

export class BrowserRenderResourceCoordinator {
	private readonly renderSpatialIndex = createLinearRenderSpatialIndex();
	private surface: BrowserRenderResourceSurface | null = null;
	private snapshot = createEmptyBrowserRenderResourceSnapshot();
	private staticPickDiagnosticInput: {
		assetState: AssetChannelState;
		staticRenderableScene: StaticRenderableSceneModel;
		renderChunkTransforms: readonly RenderChunkTransform[];
		detailTexturesEnabled: boolean;
		signature: string;
	} | null = null;
	private staticPickDiagnosticCache: {
		signature: string;
		diagnosticsByRenderKey: Map<
			string,
			BrowserStaticRenderablePickDiagnostic | null
		>;
	} | null = null;
	private appliedSurfaceSignatures: Partial<
		Record<BrowserRenderResourceSurfaceKey, string>
	> = {};

	setSurface(surface: BrowserRenderResourceSurface | null): void {
		this.surface = surface;
		this.appliedSurfaceSignatures = {};
	}

	getSnapshot(): BrowserRenderResourceSnapshot {
		return this.snapshot;
	}

	getStaticRenderablePickDiagnostic(
		renderKey: string,
	): BrowserStaticRenderablePickDiagnostic | null {
		const input = this.staticPickDiagnosticInput;
		if (!input) {
			return null;
		}
		if (this.staticPickDiagnosticCache?.signature !== input.signature) {
			this.staticPickDiagnosticCache = {
				signature: input.signature,
				diagnosticsByRenderKey: new Map(),
			};
		}
		if (!this.staticPickDiagnosticCache.diagnosticsByRenderKey.has(renderKey)) {
			this.staticPickDiagnosticCache.diagnosticsByRenderKey.set(
				renderKey,
				deriveBrowserStaticRenderablePickDiagnostic({ ...input, renderKey }),
			);
		}
		return (
			this.staticPickDiagnosticCache.diagnosticsByRenderKey.get(renderKey) ??
			null
		);
	}

	updateControlledCameraFrame(frame: SceneCameraFrame | null): void {
		this.surface?.setControlledCameraFrame(frame);
	}

	update(
		input: BrowserRenderResourceCoordinatorInput,
	): BrowserRenderResourceSnapshot {
		const outdoorFocusLandblockId =
			input.browserDestination?.kind === "outdoor-location"
				? deriveTerrainFocusLandblockId(input.browserDestination)
				: null;
		const outdoorSceneInterest =
			outdoorFocusLandblockId === null
				? null
				: deriveOutdoorSceneInterest({
						focusLandblockId: outdoorFocusLandblockId,
						terrainRadius: input.terrainLodRadius,
						buildingRadius: input.buildingLodRadius,
						detailRadius: input.detailLodRadius,
						envCellRadius: input.envCellLodRadius,
					});
		const terrainScene = shouldUseStaticLandblockTerrainArtifacts(
			input.staticLandblockRenderArtifacts,
		)
			? deriveTerrainSceneModelFromLandblockArtifacts({
					artifacts: input.staticLandblockRenderArtifacts,
					browserDestination: input.browserDestination,
					terrainLodRadius: input.terrainLodRadius,
					terrainLandblockIds:
						outdoorSceneInterest?.terrainLandblockIds ?? null,
				})
			: deriveTerrainSceneModel(
					input.assetState,
					input.browserDestination,
					input.terrainLodRadius,
					outdoorSceneInterest?.terrainLandblockIds ?? null,
				);
		const linkedOutdoorEnvCellIds =
			outdoorSceneInterest === null
				? []
				: [
						...deriveTopologyEnvCellIdsForLandblocks(
							input.assetState.preparedByAssetId,
							new Set(outdoorSceneInterest.envCellLandblockIds),
						),
					].sort((left, right) => left - right);
		const structuredInteriorCoverage = deriveStructuredInteriorCoverageForInput(
			input,
			linkedOutdoorEnvCellIds,
		);
		const baseStaticRenderableScene = deriveStaticRenderableSceneModel(
			input.assetState,
			input.browserDestination,
			input.detailLodRadius,
			structuredInteriorCoverage,
			outdoorSceneInterest === null
				? null
				: {
						buildingLandblockIds: outdoorSceneInterest.buildingLandblockIds,
						detailLandblockIds: outdoorSceneInterest.detailLandblockIds,
						envCellLandblockIds: outdoorSceneInterest.envCellLandblockIds,
					},
		);
		const appearancePreviewScene = input.runtimeAppearancePreviews.reduce(
			(scene, preview) =>
				mergeStaticRenderableSceneModels(
					scene,
					deriveAppearancePreviewStaticRenderableSceneModel({
						assetState: input.assetState,
						previewInstanceId: preview.id,
						setupAppearance: preview.setupAppearance,
						spawnCameraFrame: preview.spawnCameraFrame,
						anchorLandblockId: input.activeRenderAnchor?.landblockId ?? null,
						renderAsInterior:
							browserDestinationToInteriorCellId(input.browserDestination) !==
							null,
					}),
				),
			createEmptyStaticRenderableSceneModel(),
		);
		const staticRenderableScene = mergeStaticRenderableSceneModels(
			baseStaticRenderableScene,
			appearancePreviewScene,
		);
		const structuredInteriorScene = deriveStructuredInteriorSceneModel(
			input.assetState,
			input.browserDestination,
			outdoorFocusLandblockId === null
				? null
				: {
						envCellIds: linkedOutdoorEnvCellIds,
					},
			structuredInteriorCoverage,
		);
		const selectedDiagnosticPortalId =
			input.diagnosticSelection?.kind === "portal"
				? input.diagnosticSelection.portalId
				: null;
		const selectedDiagnosticEnvCellId =
			input.diagnosticSelection?.kind === "structured-cell"
				? input.diagnosticSelection.envCellId
				: input.diagnosticSelection?.kind === "portal"
					? input.diagnosticSelection.sourceEnvCellId
					: null;
		const debugOverlayScene = deriveWorldDebugOverlayModel(
			structuredInteriorScene,
			{
				showPortalPolygons: input.showPortalPolygons,
				showCellIndicators: input.showCellIndicators,
				highlightPortalTargets: input.highlightPortalTargets,
				selectedPortalId: selectedDiagnosticPortalId,
				selectedEnvCellId: selectedDiagnosticEnvCellId,
			},
		);
		const transitionPortalModel = deriveTransitionPortalCandidates({
			assetState: input.assetState,
			structuredInteriorScene,
			activeLandblockIds: outdoorSceneInterest?.buildingLandblockIds ?? [],
		});
		const activeRenderChunkPlacements = collectActiveRenderChunkPlacements(
			terrainScene,
			structuredInteriorScene,
			debugOverlayScene,
			staticRenderableScene,
		);
		const activeRenderChunkTransforms = deriveRenderChunkTransforms(
			input.activeRenderAnchor,
			activeRenderChunkPlacements,
		);
		const renderSceneContext = deriveWorldRenderSceneContext({
			activeRenderAnchor: input.activeRenderAnchor,
			browserDestination: input.browserDestination,
		});
		const terrainSceneSignature = describeTerrainSceneSignature(terrainScene);
		const staticRenderableSceneSignature =
			describeStaticRenderableSceneSignature(staticRenderableScene);
		const structuredInteriorSceneSignature =
			describeStructuredInteriorSceneSignature(structuredInteriorScene);
		const debugOverlaySceneSignature =
			describeDebugOverlaySceneSignature(debugOverlayScene);
		const renderChunkTransformsSignature =
			describeRenderChunkTransformsSignature(activeRenderChunkTransforms);
		reportPreparedOutdoorAssetsNotRendered({
			input,
			outdoorSceneInterest,
			terrainScene,
			staticRenderableScene,
			structuredInteriorScene,
			activeRenderChunkTransforms,
			renderSceneContext,
		});

		this.renderSpatialIndex.replaceChunkTransforms(activeRenderChunkTransforms);
		this.renderSpatialIndex.replaceOwnerItems(
			TERRAIN_SPATIAL_OWNER_KEY,
			deriveTerrainSpatialItems(terrainScene),
		);
		this.renderSpatialIndex.replaceOwnerItems(
			STRUCTURED_INTERIOR_SPATIAL_OWNER_KEY,
			deriveStructuredInteriorSpatialItems(structuredInteriorScene),
		);
		this.renderSpatialIndex.replaceOwnerItems(
			STATIC_RENDERABLE_SPATIAL_OWNER_KEY,
			deriveStaticRenderableSpatialItems(
				input.assetState,
				staticRenderableScene,
			),
		);
		this.renderSpatialIndex.replaceOwnerItems(
			DEBUG_OVERLAY_SPATIAL_OWNER_KEY,
			deriveDebugOverlaySpatialItems(debugOverlayScene),
		);
		this.staticPickDiagnosticInput = {
			assetState: input.assetState,
			staticRenderableScene,
			renderChunkTransforms: activeRenderChunkTransforms,
			detailTexturesEnabled: input.detailTexturesEnabled,
			signature: [
				describeAssetStateSignature(input.assetState),
				staticRenderableSceneSignature,
				renderChunkTransformsSignature,
				String(input.detailTexturesEnabled),
			].join("|"),
		};
		const surface = this.surface;
		if (surface) {
			reportTerrainMaterialDiagnostics(terrainScene);
			this.applySurfaceResource(
				"asset-state",
				describeAssetStateSignature(input.assetState),
				() => surface.setAssetState(input.assetState),
			);
			this.applySurfaceResource(
				"render-scene-context",
				describeRenderSceneContextSignature(renderSceneContext),
				() => surface.setRenderSceneContext(renderSceneContext),
			);
			this.applySurfaceResource(
				"render-chunk-transforms",
				renderChunkTransformsSignature,
				() => surface.setRenderChunkTransforms(activeRenderChunkTransforms),
			);
			this.applySurfaceResource("terrain-scene", terrainSceneSignature, () =>
				surface.setTerrainScene(terrainScene),
			);
			this.applySurfaceResource(
				"static-renderable-scene",
				staticRenderableSceneSignature,
				() => surface.setStaticRenderableScene(staticRenderableScene),
			);
			this.applySurfaceResource(
				"structured-interior-scene",
				structuredInteriorSceneSignature,
				() => surface.setStructuredInteriorScene(structuredInteriorScene),
			);
			this.applySurfaceResource(
				"transition-portal-model",
				describeTransitionPortalModelSignature(transitionPortalModel),
				() => surface.setTransitionPortalModel(transitionPortalModel),
			);
			this.applySurfaceResource(
				"debug-overlay-scene",
				debugOverlaySceneSignature,
				() => surface.setDebugOverlayScene(debugOverlayScene),
			);
			this.applySurfaceResource(
				"render-spatial-query",
				describeRenderSpatialIndexSignature({
					terrainSceneSignature,
					staticRenderableSceneSignature,
					structuredInteriorSceneSignature,
					debugOverlaySceneSignature,
					renderChunkTransformsSignature,
					assetState: input.assetState,
				}),
				() => surface.setRenderSpatialQuery(this.renderSpatialIndex),
			);
			this.applySurfaceResource(
				"selected-static-renderable",
				input.selectedStaticRenderableRenderKey ?? "none",
				() =>
					surface.setSelectedStaticRenderableRenderKey(
						input.selectedStaticRenderableRenderKey,
					),
			);
			this.applySurfaceResource(
				"controlled-camera-frame",
				describeSceneCameraFrameSignature(input.browserCameraFrame),
				() => surface.setControlledCameraFrame(input.browserCameraFrame),
			);
			this.applySurfaceResource(
				"transition-portal-depth",
				String(input.transitionPortalMaxDepth),
				() =>
					surface.setTransitionPortalMaxDepth(input.transitionPortalMaxDepth),
			);
			this.applySurfaceResource("render-style", input.renderStyle, () =>
				surface.setRenderStyle(input.renderStyle),
			);
			this.applySurfaceResource(
				"texture-filtering-mode",
				input.textureFilteringMode,
				() => surface.setTextureFilteringMode(input.textureFilteringMode),
			);
			this.applySurfaceResource(
				"detail-textures-enabled",
				String(input.detailTexturesEnabled),
				() => surface.setDetailTexturesEnabled(input.detailTexturesEnabled),
			);
		}

		this.snapshot = deriveSnapshot({
			input,
			terrainScene,
			staticRenderableScene,
			structuredInteriorScene,
			debugOverlayScene,
			renderSceneContext,
			outdoorSceneInterest,
			linkedOutdoorEnvCellIds,
			structuredInteriorCoverage,
			activeRenderChunkTransforms,
			renderSpatialQuery: this.renderSpatialIndex,
			staticLandblockRenderArtifacts: input.staticLandblockRenderArtifacts,
		});
		return this.snapshot;
	}

	private applySurfaceResource(
		key: BrowserRenderResourceSurfaceKey,
		signature: string,
		apply: () => void,
	): void {
		if (this.appliedSurfaceSignatures[key] === signature) {
			return;
		}

		apply();
		this.appliedSurfaceSignatures[key] = signature;
	}
}

type BrowserRenderResourceSurfaceKey =
	| "asset-state"
	| "render-scene-context"
	| "render-chunk-transforms"
	| "terrain-scene"
	| "static-renderable-scene"
	| "structured-interior-scene"
	| "transition-portal-model"
	| "debug-overlay-scene"
	| "render-spatial-query"
	| "selected-static-renderable"
	| "controlled-camera-frame"
	| "transition-portal-depth"
	| "render-style"
	| "texture-filtering-mode"
	| "detail-textures-enabled";

function describeAssetStateSignature(state: AssetChannelState): string {
	return [
		state.channel,
		state.status,
		Object.keys(state.preparedByAssetId).sort().join(","),
		Object.keys(state.cacheMetadataByAssetId).sort().join(","),
	].join(";");
}

function describeRenderSceneContextSignature(
	context: ReturnType<typeof deriveWorldRenderSceneContext>,
): string {
	return `${context.kind}:${context.anchorLandblockId ?? "none"}`;
}

function describeRenderChunkTransformsSignature(
	transforms: readonly RenderChunkTransform[],
): string {
	return transforms
		.map(
			(transform) =>
				`${transform.chunkKey}:${transform.chunkLandblockId}:${formatVectorSignature(transform.offset)}`,
		)
		.join("|");
}

function reportTerrainMaterialDiagnostics(scene: TerrainSceneModel): void {
	const nonReadyTiles = scene.tiles.filter(
		(tile) => tile.materialResources.status !== "ready",
	);
	if (nonReadyTiles.length === 0) {
		lastReportedTerrainMaterialDiagnosticsSignature = null;
		return;
	}
	const statusCounts = new Map<string, number>();
	const diagnostics = new Set<string>();
	const missingSurfaceTextureAssetIds = new Set<string>();
	const missingRenderSurfaceAssetIds = new Set<string>();
	const unsupportedRenderSurfaceAssetIds = new Set<string>();
	for (const tile of nonReadyTiles) {
		const resources = tile.materialResources;
		statusCounts.set(
			resources.status,
			(statusCounts.get(resources.status) ?? 0) + 1,
		);
		for (const diagnostic of resources.diagnostics) {
			diagnostics.add(diagnostic);
		}
		for (const assetId of resources.missingSurfaceTextureAssetIds) {
			missingSurfaceTextureAssetIds.add(assetId);
		}
		for (const assetId of resources.missingRenderSurfaceAssetIds) {
			missingRenderSurfaceAssetIds.add(assetId);
		}
		for (const assetId of resources.unsupportedRenderSurfaceAssetIds) {
			unsupportedRenderSurfaceAssetIds.add(assetId);
		}
	}
	const statusCountSummary = describeStatusCounts(statusCounts);
	const blockerSummary = describeTerrainMaterialBlockers({
		diagnostics,
		missingSurfaceTextureAssetIds,
		missingRenderSurfaceAssetIds,
		unsupportedRenderSurfaceAssetIds,
	});
	const signature = [
		...scene.tiles.map(
			(tile) => `${tile.assetId}:${tile.materialResources.signature}`,
		),
	].join("|");
	if (signature === lastReportedTerrainMaterialDiagnosticsSignature) {
		return;
	}
	lastReportedTerrainMaterialDiagnosticsSignature = signature;
	const hasUnsupportedRenderSurfaces =
		statusCounts.has("unsupported-render-surface") ||
		unsupportedRenderSurfaceAssetIds.size > 0;
	if (!hasUnsupportedRenderSurfaces) {
		return;
	}
	console.warn(
		TERRAIN_MATERIAL_DIAGNOSTIC_LOG_PREFIX,
		`${nonReadyTiles.length}/${scene.tiles.length} terrain tile${scene.tiles.length === 1 ? "" : "s"} cannot use terrain blend materials: ${statusCountSummary}; ${blockerSummary}.`,
		{
			statusCounts: Object.fromEntries(statusCounts),
			terrainMaterialAssetIds: uniqueSortedStrings(
				nonReadyTiles.map(
					(tile) => tile.materialResources.terrainMaterialAssetId,
				),
			),
			diagnostics: [...diagnostics].slice(
				0,
				TERRAIN_MATERIAL_DIAGNOSTIC_SAMPLE_LIMIT,
			),
			missingSurfaceTextureAssetIds: [...missingSurfaceTextureAssetIds].slice(
				0,
				TERRAIN_MATERIAL_DIAGNOSTIC_SAMPLE_LIMIT,
			),
			missingRenderSurfaceAssetIds: [...missingRenderSurfaceAssetIds].slice(
				0,
				TERRAIN_MATERIAL_DIAGNOSTIC_SAMPLE_LIMIT,
			),
			unsupportedRenderSurfaceAssetIds: [
				...unsupportedRenderSurfaceAssetIds,
			].slice(0, TERRAIN_MATERIAL_DIAGNOSTIC_SAMPLE_LIMIT),
			sampleTiles: nonReadyTiles.slice(0, 6).map(describeTerrainDiagnosticTile),
		},
	);
}

interface TerrainMaterialBlockerSets {
	diagnostics: ReadonlySet<string>;
	missingSurfaceTextureAssetIds: ReadonlySet<string>;
	missingRenderSurfaceAssetIds: ReadonlySet<string>;
	unsupportedRenderSurfaceAssetIds: ReadonlySet<string>;
}

function describeStatusCounts(
	statusCounts: ReadonlyMap<string, number>,
): string {
	return [...statusCounts.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([status, count]) => `${status}=${count}`)
		.join(", ");
}

function describeTerrainMaterialBlockers(
	blockers: TerrainMaterialBlockerSets,
): string {
	const parts: string[] = [];
	addBlockerSummary(
		parts,
		"missing surface textures",
		blockers.missingSurfaceTextureAssetIds,
	);
	addBlockerSummary(
		parts,
		"missing render surfaces",
		blockers.missingRenderSurfaceAssetIds,
	);
	addBlockerSummary(
		parts,
		"unsupported render surfaces",
		blockers.unsupportedRenderSurfaceAssetIds,
	);
	if (parts.length > 0) {
		return parts.join("; ");
	}
	const diagnosticSamples = [...blockers.diagnostics].slice(
		0,
		TERRAIN_MATERIAL_DIAGNOSTIC_SAMPLE_LIMIT,
	);
	return diagnosticSamples.length > 0
		? diagnosticSamples.join("; ")
		: "no blocker details were reported";
}

function addBlockerSummary(
	parts: string[],
	label: string,
	values: ReadonlySet<string>,
): void {
	if (values.size === 0) {
		return;
	}
	const samples = [...values]
		.sort((left, right) => left.localeCompare(right))
		.slice(0, TERRAIN_MATERIAL_DIAGNOSTIC_SAMPLE_LIMIT);
	const remaining = values.size - samples.length;
	parts.push(
		`${label} ${values.size}: ${samples.join(", ")}${remaining > 0 ? `, +${remaining} more` : ""}`,
	);
}

function describeTerrainDiagnosticTile(tile: TerrainSceneTile): object {
	return {
		assetId: tile.assetId,
		landblockId: `0x${formatHex32(tile.landblockId)}`,
		status: tile.materialResources.status,
		terrainMaterialAssetId: tile.materialResources.terrainMaterialAssetId,
		diagnostics: tile.materialResources.diagnostics,
	};
}

function uniqueSortedStrings(values: readonly string[]): string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function describeTerrainSceneSignature(scene: TerrainSceneModel): string {
	return [
		`focus=${scene.focusLandblockId ?? "none"}`,
		...scene.tiles.map(
			(tile) =>
				`${tile.assetId}:${tile.landblockId}:${deriveLandblockRenderChunkPlacement(tile.landblockId).chunkKey}:${tile.dataSource}:${tile.materialResources.signature}`,
		),
	].join("|");
}

function describeStaticRenderableSceneSignature(
	scene: StaticRenderableSceneModel,
): string {
	return [
		`focus=${scene.focusLandblockId ?? "none"}`,
		`landblocks=${scene.activeLandblockIds.join(",")}`,
		`sources=${scene.sourceInstances.length}`,
		`parts=${scene.parts.length}`,
		`groups=${scene.partsByRenderGroupKey.size}`,
		`missingSources=${scene.missingSourceAssetIds.join(",")}`,
		`missingGfx=${scene.missingGfxAssetIds.join(",")}`,
		`missingSetupAppearances=${scene.missingSetupAppearanceAssetIds.join(",")}`,
	].join(";");
}

function describeStructuredInteriorSceneSignature(
	scene: StructuredInteriorSceneModel,
): string {
	return [
		`focus=${scene.focusEnvCellId ?? "none"}`,
		`active=${scene.activeEnvCellIds.join(",")}`,
		`cells=${scene.cells
			.map(
				(cell) =>
					`${cell.envCellId}:${cell.renderKey}:${cell.renderChunk.chunkKey}:${cell.portalCount}:${cell.staticObjectCount}:${cell.renderGeometry.vertexCount}:${cell.renderGeometry.triangleCount}`,
			)
			.join(",")}`,
		`missingEnv=${scene.missingEnvCellAssetIds.join(",")}`,
	].join(";");
}

function describeTransitionPortalModelSignature(
	model: ReturnType<typeof deriveTransitionPortalCandidates>,
): string {
	return [
		...model.candidates.map(
			(candidate) =>
				`${candidate.id}:${candidate.stencilRef}:${candidate.targetStatus}:${candidate.entryEnvCellId}:${candidate.requestedInteriorEnvCellIds.join(",")}`,
		),
		`diagnostics=${Object.values(model.diagnostics).join(",")}`,
	]
		.sort()
		.join("|");
}

function describeDebugOverlaySceneSignature(
	scene: WorldDebugOverlayModel,
): string {
	return [
		`portals=${scene.showPortalPolygons}`,
		`cells=${scene.showCellIndicators}`,
		`targets=${scene.highlightPortalTargets}`,
		`cellIds=${scene.cells.map((cell) => `${cell.envCellId}:${cell.colorKey}:${cell.isSelected}`).join(",")}`,
		`portalIds=${scene.portals.map((portal) => `${portal.portalId}:${portal.colorKey}:${portal.isSelected}:${portal.targetStatus}`).join(",")}`,
	].join(";");
}

function describeRenderSpatialIndexSignature({
	terrainSceneSignature,
	staticRenderableSceneSignature,
	structuredInteriorSceneSignature,
	debugOverlaySceneSignature,
	renderChunkTransformsSignature,
	assetState,
}: {
	terrainSceneSignature: string;
	staticRenderableSceneSignature: string;
	structuredInteriorSceneSignature: string;
	debugOverlaySceneSignature: string;
	renderChunkTransformsSignature: string;
	assetState: AssetChannelState;
}): string {
	return [
		terrainSceneSignature,
		staticRenderableSceneSignature,
		structuredInteriorSceneSignature,
		debugOverlaySceneSignature,
		renderChunkTransformsSignature,
		Object.keys(assetState.preparedByAssetId)
			.filter((assetId) =>
				/^landblock\/[0-9a-fA-F]{8}\/(?:outdoor|topology)$/.test(assetId),
			)
			.sort()
			.join(","),
	].join(";");
}

function describeSceneCameraFrameSignature(
	frame: SceneCameraFrame | null,
): string {
	if (!frame) {
		return "none";
	}

	return [
		frame.position,
		frame.target,
		frame.up,
		{
			x: frame.fovDegrees,
			y: frame.near,
			z: frame.far,
		},
		{
			x: frame.aspect,
			y: 0,
			z: 0,
		},
	]
		.map(formatVectorSignature)
		.join("|");
}

function formatVectorSignature(vector: {
	x: number;
	y: number;
	z: number;
}): string {
	return `${vector.x.toFixed(5)},${vector.y.toFixed(5)},${vector.z.toFixed(5)}`;
}

function deriveStructuredInteriorCoverageForInput(
	input: BrowserRenderResourceCoordinatorInput,
	linkedOutdoorEnvCellIds: readonly number[],
) {
	const browserFocusEnvCellId = browserDestinationToInteriorCellId(
		input.browserDestination,
	);
	if (browserFocusEnvCellId !== null) {
		return deriveStructuredInteriorCoverage(
			{
				kind: "landblock-closure",
				seedEnvCellIds: [browserFocusEnvCellId],
			},
			input.assetState.preparedByAssetId,
		);
	}

	if (linkedOutdoorEnvCellIds.length > 0) {
		return deriveStructuredInteriorCoverage(
			{
				kind: "landblock-closure",
				seedEnvCellIds: [...linkedOutdoorEnvCellIds],
			},
			input.assetState.preparedByAssetId,
		);
	}

	return null;
}

function collectActiveRenderChunkPlacements(
	terrain: TerrainSceneModel,
	structuredInterior: StructuredInteriorSceneModel,
	debugOverlay: WorldDebugOverlayModel,
	staticRenderables: StaticRenderableSceneModel,
): RenderChunkPlacement[] {
	const chunksByKey = new Map<string, RenderChunkPlacement>();
	for (const chunk of [
		...terrain.tiles.map((tile) =>
			deriveLandblockRenderChunkPlacement(tile.landblockId),
		),
		...structuredInterior.cells.map((cell) => cell.renderChunk),
		...debugOverlay.cells.map((cell) => cell.renderChunk),
		...debugOverlay.portals.map((portal) => portal.renderChunk),
		...staticRenderables.parts.map((part) => part.renderChunk),
	]) {
		chunksByKey.set(chunk.chunkKey, chunk);
	}

	return [...chunksByKey.values()].sort((left, right) =>
		left.chunkKey.localeCompare(right.chunkKey),
	);
}

function reportPreparedOutdoorAssetsNotRendered({
	input,
	outdoorSceneInterest,
	terrainScene,
	staticRenderableScene,
	structuredInteriorScene,
	activeRenderChunkTransforms,
	renderSceneContext,
}: {
	input: BrowserRenderResourceCoordinatorInput;
	outdoorSceneInterest: ReturnType<typeof deriveOutdoorSceneInterest> | null;
	terrainScene: TerrainSceneModel;
	staticRenderableScene: StaticRenderableSceneModel;
	structuredInteriorScene: StructuredInteriorSceneModel;
	activeRenderChunkTransforms: readonly RenderChunkTransform[];
	renderSceneContext: ReturnType<typeof deriveWorldRenderSceneContext>;
}): void {
	if (
		input.browserDestination?.kind !== "outdoor-location" ||
		outdoorSceneInterest === null ||
		terrainScene.tiles.length > 0 ||
		staticRenderableScene.parts.length > 0
	) {
		lastPreparedOutdoorAssetsNotRenderedSignature = null;
		return;
	}

	const expectedOutdoorAssetIds = outdoorSceneInterest.terrainLandblockIds.map(
		formatLandblockOutdoorAssetId,
	);
	const preparedOutdoorAssetIds = expectedOutdoorAssetIds.filter(
		(assetId) => input.assetState.preparedByAssetId[assetId],
	);
	if (preparedOutdoorAssetIds.length === 0) {
		lastPreparedOutdoorAssetsNotRenderedSignature = null;
		return;
	}

	const recentRelevantActivity = input.assetState.history.filter((entry) =>
		expectedOutdoorAssetIds.includes(entry.assetId),
	);
	const signature = JSON.stringify({
		destination: input.browserDestination.label,
		expectedOutdoorAssetIds,
		preparedOutdoorAssetIds,
		recentRelevantActivity,
		activeRequestAssetId: input.assetState.activeRequest?.assetId ?? null,
		errorMessage: input.assetState.errorMessage,
	});

	if (signature === lastPreparedOutdoorAssetsNotRenderedSignature) {
		return;
	}
	lastPreparedOutdoorAssetsNotRenderedSignature = signature;

	console.error(
		"[holtburger-3d][render-starved][prepared-outdoor-not-rendered]",
		{
			message:
				"Outdoor browser destination has prepared outdoor coverage but no terrain tiles or static renderable parts reached the renderer.",
			destination: input.browserDestination,
			sceneContext: renderSceneContext,
			expectedOutdoorAssetIds,
			preparedOutdoorAssetIds,
			missingOutdoorAssetIds: expectedOutdoorAssetIds.filter(
				(assetId) => !input.assetState.preparedByAssetId[assetId],
			),
			preparedAssetCounts: countPreparedAssetsByKind(
				input.assetState.preparedByAssetId,
			),
			recentRelevantActivity,
			recentAssetActivity: input.assetState.history,
			activeRequest: input.assetState.activeRequest,
			assetStatus: input.assetState.status,
			assetErrorMessage: input.assetState.errorMessage,
			cacheDiagnostics: input.assetState.cacheDiagnostics,
			renderInputCounts: {
				terrainTiles: terrainScene.tiles.length,
				staticSourceInstances: staticRenderableScene.sourceInstances.length,
				staticParts: staticRenderableScene.parts.length,
				missingStaticSourceAssetIds:
					staticRenderableScene.missingSourceAssetIds.length,
				missingStaticGfxAssetIds:
					staticRenderableScene.missingGfxAssetIds.length,
				missingStaticSetupAppearanceAssetIds:
					staticRenderableScene.missingSetupAppearanceAssetIds.length,
				structuredInteriorCells: structuredInteriorScene.cells.length,
				activeRenderChunks: activeRenderChunkTransforms.length,
			},
		},
	);
}

function countPreparedAssetsByKind(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const asset of Object.values(preparedByAssetId)) {
		counts[asset.payload.kind] = (counts[asset.payload.kind] ?? 0) + 1;
	}
	return Object.fromEntries(
		Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
	);
}

function shouldUseStaticLandblockTerrainArtifacts(
	snapshot: StaticLandblockRenderArtifactStoreSnapshot,
): boolean {
	return (
		snapshot.desiredCount > 0 ||
		snapshot.inFlightCount > 0 ||
		snapshot.residentCount > 0
	);
}

function deriveSnapshot({
	input,
	terrainScene,
	staticRenderableScene,
	structuredInteriorScene,
	debugOverlayScene,
	renderSceneContext,
	outdoorSceneInterest,
	linkedOutdoorEnvCellIds,
	structuredInteriorCoverage,
	activeRenderChunkTransforms,
	renderSpatialQuery,
	staticLandblockRenderArtifacts,
}: {
	input: BrowserRenderResourceCoordinatorInput;
	terrainScene: TerrainSceneModel;
	staticRenderableScene: StaticRenderableSceneModel;
	structuredInteriorScene: StructuredInteriorSceneModel;
	debugOverlayScene: WorldDebugOverlayModel;
	renderSceneContext: ReturnType<typeof deriveWorldRenderSceneContext>;
	outdoorSceneInterest: ReturnType<typeof deriveOutdoorSceneInterest> | null;
	linkedOutdoorEnvCellIds: readonly number[];
	structuredInteriorCoverage: ReturnType<
		typeof deriveStructuredInteriorCoverage
	> | null;
	activeRenderChunkTransforms: readonly RenderChunkTransform[];
	renderSpatialQuery: RenderSpatialIndexQuery;
	staticLandblockRenderArtifacts: StaticLandblockRenderArtifactStoreSnapshot;
}): BrowserRenderResourceSnapshot {
	const terrainVertexCount = terrainScene.tiles.reduce(
		(total, tile) => total + tile.mesh.vertices.length,
		0,
	);
	const terrainTriangleCount = terrainScene.tiles.reduce(
		(total, tile) => total + tile.mesh.triangles.length,
		0,
	);
	const terrainMinHeight =
		terrainScene.tiles.length === 0
			? null
			: Math.min(...terrainScene.tiles.map((tile) => tile.mesh.minHeight));
	const terrainMaxHeight =
		terrainScene.tiles.length === 0
			? null
			: Math.max(...terrainScene.tiles.map((tile) => tile.mesh.maxHeight));
	const structuredInteriorPackSourceCount = new Set(
		structuredInteriorScene.cells.map((cell) => cell.renderChunk.chunkKey),
	).size;

	return {
		worldDisplay: deriveBrowserWorldDisplayModel({
			assetState: input.assetState,
			browserDestination: input.browserDestination,
			terrainLodRadius: input.terrainLodRadius,
			buildingLodRadius: input.buildingLodRadius,
			detailLodRadius: input.detailLodRadius,
		}),
		renderSpatialQuery,
		activeRenderChunkCount: activeRenderChunkTransforms.length,
		sceneStatusText:
			structuredInteriorScene.cells.length > 0
				? structuredInteriorScene.statusText
				: terrainScene.statusText,
		sceneContextText: `${renderSceneContext.kind === "dungeon" ? "Dungeon" : "Outdoor"}${renderSceneContext.anchorLandblockId === null ? "" : ` anchored at 0x${formatHex32(renderSceneContext.anchorLandblockId)}`}`,
		terrainCacheText: terrainScene.cacheText,
		terrainDataSourceText: terrainScene.dataSourceText,
		sceneGeometryText:
			structuredInteriorScene.cells.length > 0
				? `${structuredInteriorScene.cells.length} env cell${structuredInteriorScene.cells.length === 1 ? "" : "s"} loaded.`
				: terrainScene.tiles.length === 0
					? "No terrain geometry is cached yet."
					: `${terrainScene.tiles.length} tile${terrainScene.tiles.length === 1 ? "" : "s"}, ${terrainVertexCount} vertices, ${terrainTriangleCount} triangles.`,
		terrainHeightText:
			terrainMinHeight === null || terrainMaxHeight === null
				? "No terrain heights are cached yet."
				: `Height range ${terrainMinHeight.toFixed(1)} to ${terrainMaxHeight.toFixed(1)} across cached tiles.`,
		staticRenderableText:
			staticRenderableScene.parts.length === 0
				? describeStaticRenderableIdleState(
						staticRenderableScene,
						input.browserDestination,
					)
				: `${staticRenderableScene.parts.length} static renderable part${staticRenderableScene.parts.length === 1 ? "" : "s"} across ${staticRenderableScene.partsByRenderGroupKey.size} domain-safe chunked instanced group${staticRenderableScene.partsByRenderGroupKey.size === 1 ? "" : "s"}.`,
		staticRenderableLayerText: describeStaticRenderableLayerState(
			staticRenderableScene,
		),
		structuredInteriorText:
			structuredInteriorScene.cells.length > 0
				? linkedOutdoorEnvCellIds.length > 0 &&
					input.browserDestination?.kind !== "interior-cell"
					? `${structuredInteriorScene.cells.length} outdoor-linked env cell${structuredInteriorScene.cells.length === 1 ? "" : "s"} rendered from ${structuredInteriorPackSourceCount} landblock pack${structuredInteriorPackSourceCount === 1 ? "" : "s"}; ${linkedOutdoorEnvCellIds.length} linked, ${structuredInteriorCoverage?.envCellIds.length ?? linkedOutdoorEnvCellIds.length} covered${structuredInteriorCoverage?.truncated ? " (truncated)" : ""}.`
					: `${structuredInteriorScene.cells.length} visible env cell${structuredInteriorScene.cells.length === 1 ? "" : "s"} rendered from ${structuredInteriorPackSourceCount} landblock pack${structuredInteriorPackSourceCount === 1 ? "" : "s"}.`
				: describeStructuredInteriorIdleState(
						input.browserDestination,
						linkedOutdoorEnvCellIds,
						structuredInteriorScene,
					),
		cellIndicatorText: debugOverlayScene.showCellIndicators
			? `${debugOverlayScene.diagnostics.cellCount} cell indicator${debugOverlayScene.diagnostics.cellCount === 1 ? "" : "s"} visible.`
			: "Cell indicators are hidden.",
		portalDiagnosticsText: debugOverlayScene.showPortalPolygons
			? `${debugOverlayScene.diagnostics.portalCount} portal overlay${debugOverlayScene.diagnostics.portalCount === 1 ? "" : "s"}; ${debugOverlayScene.diagnostics.loadedTargetCount}/${debugOverlayScene.diagnostics.knownTargetCount} known target${debugOverlayScene.diagnostics.knownTargetCount === 1 ? "" : "s"} loaded${debugOverlayScene.diagnostics.missingPortalPolygonCount > 0 ? `; ${debugOverlayScene.diagnostics.missingPortalPolygonCount} missing polygon witness${debugOverlayScene.diagnostics.missingPortalPolygonCount === 1 ? "" : "es"}` : ""}.`
			: "Portal polygon overlays are hidden.",
		landblockVisibilityText:
			renderSceneContext.kind === "dungeon"
				? "Dungeon context; outdoor landblock rendering is inactive."
				: !outdoorSceneInterest
					? "Outdoor landblock selection is waiting for focus."
					: `Terrain ${terrainScene.tiles.length}/${outdoorSceneInterest.terrainLandblockIds.length}, buildings ${outdoorSceneInterest.buildingLandblockIds.length}, detail ${outdoorSceneInterest.detailLandblockIds.length}.`,
		cellVisibilityFallbackText: `${structuredInteriorScene.cells.length} loaded env cell${structuredInteriorScene.cells.length === 1 ? "" : "s"}; renderer visibility pending.`,
		staticLandblockRenderArtifactText: describeStaticLandblockRenderArtifacts(
			staticLandblockRenderArtifacts,
		),
	};
}

function describeStaticLandblockRenderArtifacts(
	snapshot: StaticLandblockRenderArtifactStoreSnapshot,
): string {
	return [
		`${snapshot.residentCount}/${snapshot.desiredCount} resident`,
		`${snapshot.inFlightCount} in flight`,
		`${snapshot.committedResultCount} committed`,
		`${snapshot.staleResultCount} stale`,
		`${snapshot.errorCount} errors`,
	].join("; ");
}

function describeStaticRenderableIdleState(
	staticRenderableScene: StaticRenderableSceneModel,
	browserDestination: BrowserLocationSelection | null,
): string {
	if (staticRenderableScene.sourceInstances.length === 0) {
		return browserDestination?.kind === "interior-cell"
			? "No indoor static object source facts are active for the current visible env cells."
			: "No static renderable source facts are active for the current outdoor coverage.";
	}

	if (staticRenderableScene.missingSourceAssetIds.length > 0) {
		return `Waiting for ${staticRenderableScene.missingSourceAssetIds.length} static renderable source asset${staticRenderableScene.missingSourceAssetIds.length === 1 ? "" : "s"}.`;
	}

	if (staticRenderableScene.missingGfxAssetIds.length > 0) {
		return `Waiting for ${staticRenderableScene.missingGfxAssetIds.length} gfx geometry dependenc${staticRenderableScene.missingGfxAssetIds.length === 1 ? "y" : "ies"}.`;
	}

	return "Static renderable source facts are active, but no drawable gfx geometry is ready.";
}

function describeStructuredInteriorIdleState(
	browserDestination: BrowserLocationSelection | null,
	linkedOutdoorEnvCellIds: readonly number[],
	structuredInteriorScene: StructuredInteriorSceneModel,
): string {
	if (
		browserDestination?.kind !== "interior-cell" &&
		linkedOutdoorEnvCellIds.length === 0
	) {
		return "Structured interior rendering is dormant while the browser destination has no linked env cells.";
	}

	if (structuredInteriorScene.missingEnvCellAssetIds.length > 0) {
		return `Waiting for ${structuredInteriorScene.missingEnvCellAssetIds.length} visible interior metadata payload${structuredInteriorScene.missingEnvCellAssetIds.length === 1 ? "" : "s"}.`;
	}

	return "Structured interior source facts are active, but no drawable cell geometry is ready.";
}

function describeStaticRenderableLayerState(
	staticRenderableScene: StaticRenderableSceneModel,
): string {
	const explicitCount = staticRenderableScene.sourceInstances.filter(
		(instance) => instance.kind === "scenery",
	).length;
	const buildingCount = staticRenderableScene.sourceInstances.filter(
		(instance) => instance.kind === "building",
	).length;
	const generatedCount = staticRenderableScene.sourceInstances.filter(
		(instance) => instance.kind === "generated-scenery",
	).length;
	const indoorCount = staticRenderableScene.sourceInstances.filter(
		(instance) => instance.kind === "indoor-static",
	).length;
	const exteriorGroupCount = [
		...staticRenderableScene.partsByRenderGroupKey.values(),
	].filter(
		(parts) => parts[0]?.renderDomain === WORLD_RENDER_DOMAIN.exteriorStatic,
	).length;
	const interiorGroupCount = [
		...staticRenderableScene.partsByRenderGroupKey.values(),
	].filter(
		(parts) => parts[0]?.renderDomain === WORLD_RENDER_DOMAIN.interiorStatic,
	).length;
	return `Explicit ${explicitCount}, buildings ${buildingCount}, generated ${generatedCount}, indoor ${indoorCount}; groups exterior ${exteriorGroupCount}, interior ${interiorGroupCount}.`;
}
