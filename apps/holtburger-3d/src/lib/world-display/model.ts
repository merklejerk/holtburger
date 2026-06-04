import type { BrowserLocationSelection } from "../../app/browser-mode";
import {
	browserDestinationToInteriorCellId,
	browserLocationToLandblockId,
} from "../../app/browser-mode";
import {
	buildOutdoorCoverageLandblocks,
	formatHex32,
	formatLandblockLabel,
	formatLandblockOutdoorAssetId,
} from "../landblocks";
import type {
	AssetChannelState,
	PreparedLandblockOutdoorPayload,
} from "../assets/types";
import { describePreparedAssetPayload } from "../assets/types";

export interface NormalizedViewportPoint {
	normalizedX: number;
	normalizedY: number;
}

interface WorldDisplayDebugEntity {
	entityId: number;
	label: string;
	locationLabel: string;
	isLocalPlayer: boolean;
	isSelected: boolean;
	screenXPercent: number;
	screenYPercent: number;
}

interface WorldDisplaySceneChunk {
	landblockId: number;
	label: string;
	role: "focus" | "neighbor";
	offsetX: number;
	offsetY: number;
	reason: string;
}

interface BrowserWorldDisplaySceneContext {
	kind: "outdoor-landblock-ring" | "indoor-env-cell-closure";
	statusText: string;
	focusAnchorLabel: string;
	destinationText: string;
	coverageText: string;
	gapText: string | null;
	chunks: WorldDisplaySceneChunk[];
	staticRenderableInstanceCount: number;
	staticRenderableBuildingCount: number;
	staticRenderableSourceAssetIds: string[];
}

interface WorldDisplayTerrainContract {
	requestKey: string | null;
	sourceAssetKind: "cell-landblock";
	decodeOwner: "rust-host-adapter";
	renderOwner: "frontend-world-display";
	loadAnchor: string;
	geometryAnchor: string;
	indoorBranchText: string;
	statusText: string;
}

export interface BrowserWorldDisplayModel {
	headline: string;
	destinationFocusLabel: string;
	destinationLabel: string;
	renderCacheText: string;
	inputText: string;
	assetText: string;
	sceneContext: BrowserWorldDisplaySceneContext;
	terrainContract: WorldDisplayTerrainContract;
	entities: WorldDisplayDebugEntity[];
}

interface BrowserWorldDisplayModelInput {
	assetState: AssetChannelState;
	browserDestination: BrowserLocationSelection | null;
	terrainLodRadius: number;
	buildingLodRadius: number;
	detailLodRadius: number;
}

export function deriveBrowserWorldDisplayModel({
	assetState,
	browserDestination,
	terrainLodRadius,
	buildingLodRadius,
	detailLodRadius,
}: BrowserWorldDisplayModelInput): BrowserWorldDisplayModel {
	if (!browserDestination) {
		return {
			headline: "Browser scene viewer is waiting for a destination.",
			destinationFocusLabel: "No browser destination selected yet.",
			destinationLabel: "No browser destination selected yet.",
			renderCacheText:
				"Browser asset cache is ready for destination-driven coverage.",
			inputText: "Viewport input is owned by browser-mode camera controls.",
			assetText: describeAssetState(assetState),
			sceneContext: createPendingSceneContext(browserDestination),
			terrainContract: createTerrainContract(null),
			entities: [],
		};
	}

	const sceneContext = deriveSceneContext(
		assetState,
		browserDestination,
		terrainLodRadius,
		buildingLodRadius,
		detailLodRadius,
	);

	return {
		headline: "Browser destination is driving scene coverage.",
		destinationFocusLabel: browserDestination.label,
		destinationLabel: browserDestination.label,
		renderCacheText:
			"Scene coverage is selected from browser destination and frontend cache state.",
		inputText: "Viewport input is driving browser camera controls locally.",
		assetText: describeAssetState(assetState),
		sceneContext,
		terrainContract: createTerrainContract(sceneContext),
		entities: [],
	};
}

function createPendingSceneContext(
	browserDestination: BrowserLocationSelection | null,
): BrowserWorldDisplaySceneContext {
	return {
		kind: "outdoor-landblock-ring",
		statusText:
			"Local outdoor scene context will lock in once the browser has a destination.",
		focusAnchorLabel: "No focus landblock yet.",
		destinationText: browserDestination
			? `Browser destination focus is staged for ${browserDestination.label}.`
			: "No browser destination focus is staged yet.",
		coverageText:
			"Browser chunk selection is app-local and destination-driven.",
		gapText: null,
		chunks: [],
		staticRenderableInstanceCount: 0,
		staticRenderableBuildingCount: 0,
		staticRenderableSourceAssetIds: [],
	};
}

function deriveSceneContext(
	assetState: AssetChannelState,
	browserDestination: BrowserLocationSelection,
	terrainLodRadius: number,
	buildingLodRadius: number,
	detailLodRadius: number,
): BrowserWorldDisplaySceneContext {
	const browserFocusEnvCellId =
		browserDestinationToInteriorCellId(browserDestination);
	if (browserFocusEnvCellId !== null) {
		return deriveIndoorSceneContext(
			browserFocusEnvCellId,
			browserDestination.label,
			assetState,
		);
	}

	const focusLandblockId = browserLocationToLandblockId(browserDestination);
	const focusLandblockLabel = formatLandblockLabel(focusLandblockId);
	const destinationText = `Browser destination focus is ${browserDestination.label}, and outdoor LoD anchors to selected landblock ${focusLandblockLabel}.`;

	const chunks = buildOutdoorTerrainTiles(
		focusLandblockId,
		terrainLodRadius,
	).map((chunk) => ({
		...chunk,
		reason:
			chunk.role === "focus"
				? "ACViewer loads the center outdoor landblock as the anchor for the local world view."
				: "Browser mode expands frontend-owned terrain LoD around the focus block.",
	}));
	const buildingLandblockIds = new Set(
		buildOutdoorCoverageLandblocks(focusLandblockId, buildingLodRadius).map(
			(landblock) => landblock.landblockId,
		),
	);
	const detailLandblockIds = new Set(
		buildOutdoorCoverageLandblocks(focusLandblockId, detailLodRadius).map(
			(landblock) => landblock.landblockId,
		),
	);
	const preparedOutdoorLandblocks = Object.values(assetState.preparedByAssetId)
		.map((asset) => asset.payload)
		.filter(
			(payload): payload is PreparedLandblockOutdoorPayload =>
				payload.kind === "landblock-outdoor" &&
				(buildingLandblockIds.has(payload.landblockId) ||
					detailLandblockIds.has(payload.landblockId)),
		);
	const staticInstanceCount = preparedOutdoorLandblocks.reduce(
		(total, payload) =>
			total +
			payload.statics.filter(
				(member) =>
					member.kind !== "building" &&
					detailLandblockIds.has(payload.landblockId),
			).length,
		0,
	);
	const staticBuildingCount = preparedOutdoorLandblocks.reduce(
		(total, payload) =>
			total +
			payload.statics.filter(
				(member) =>
					member.kind === "building" &&
					buildingLandblockIds.has(payload.landblockId),
			).length,
		0,
	);
	const staticRenderableSourceAssetIds = preparedOutdoorLandblocks.flatMap(
		(payload) =>
			payload.statics
				.filter((member) =>
					member.kind === "building"
						? buildingLandblockIds.has(payload.landblockId)
						: detailLandblockIds.has(payload.landblockId),
				)
				.map((member) => member.sourceAssetId),
	);

	return {
		kind: "outdoor-landblock-ring",
		statusText:
			"Browser mode is using explicit outdoor LoD sets for terrain, buildings, and smaller detail objects.",
		focusAnchorLabel: focusLandblockLabel,
		destinationText,
		coverageText: `Outdoor LoD selects ${chunks.length} terrain tile${chunks.length === 1 ? "" : "s"}, ${staticBuildingCount} building${staticBuildingCount === 1 ? "" : "s"} inside distance ${buildingLodRadius}, and ${staticInstanceCount} detail object${staticInstanceCount === 1 ? "" : "s"} inside distance ${detailLodRadius} around ${focusLandblockLabel}.`,
		gapText:
			"Outdoor coverage is selected from destination-owned terrain, building, and detail radii.",
		chunks,
		staticRenderableInstanceCount: staticInstanceCount,
		staticRenderableBuildingCount: staticBuildingCount,
		staticRenderableSourceAssetIds: [
			...new Set(staticRenderableSourceAssetIds),
		].sort(),
	};
}

function deriveIndoorSceneContext(
	focusEnvCellId: number | null,
	destinationLabel: string | null,
	assetState: AssetChannelState,
): BrowserWorldDisplaySceneContext {
	const focusEnvCellLabel = focusEnvCellId
		? formatEnvCellLabel(focusEnvCellId)
		: "Unknown env cell";
	const preparedIndoorCellCount = Object.values(
		assetState.preparedByAssetId,
	).reduce(
		(total, asset) => (asset.payload.kind === "env-cell" ? total + 1 : total),
		0,
	);
	return {
		kind: "indoor-env-cell-closure",
		statusText:
			"Browser dungeon scene context is explicit: WorldDisplay renders direct env-cell assets selected by topology and tracks the current env-cell focus separately from outdoor terrain.",
		focusAnchorLabel: focusEnvCellLabel,
		destinationText: destinationLabel
			? `Browser destination focus is ${destinationLabel}.`
			: `Browser dungeon focus is ${focusEnvCellLabel}.`,
		coverageText: `Dungeon focus ${focusEnvCellLabel} is backed by ${preparedIndoorCellCount} prepared env-cell asset${preparedIndoorCellCount === 1 ? "" : "s"}. Browser dungeons load topology membership and direct env-cell render assets.`,
		gapText: null,
		chunks: [],
		staticRenderableInstanceCount: 0,
		staticRenderableBuildingCount: 0,
		staticRenderableSourceAssetIds: [],
	};
}

function createTerrainContract(
	sceneContext: BrowserWorldDisplaySceneContext | null,
): WorldDisplayTerrainContract {
	const focusChunk =
		sceneContext?.chunks.find((chunk) => chunk.role === "focus") ?? null;
	const requestKey = focusChunk
		? formatLandblockOutdoorAssetId(focusChunk.landblockId)
		: null;

	return {
		requestKey,
		sourceAssetKind: "cell-landblock",
		decodeOwner: "rust-host-adapter",
		renderOwner: "frontend-world-display",
		loadAnchor:
			"ACViewer.WorldViewer.LoadLandblock + ACE.DatLoader.CellLandblock",
		geometryAnchor: "ACViewer.Render.R_Landblock + TerrainBatchDraw.AddTerrain",
		indoorBranchText:
			"Outdoor terrain comes from landblock outdoor assets; dungeon env cells stay on a direct env-cell rendering track.",
		statusText: requestKey
			? `${requestKey} is ready: Rust decodes CellLandblock data into an app-local payload, and WorldDisplay owns final mesh and GPU hydration.`
			: "The terrain contract shape is in place, but it still needs a focus outdoor landblock before the first request key can be selected.",
	};
}

function buildOutdoorTerrainTiles(
	focusLandblockId: number,
	terrainLodRadius: number,
): WorldDisplaySceneChunk[] {
	return buildOutdoorCoverageLandblocks(focusLandblockId, terrainLodRadius).map(
		(landblock) => ({
			landblockId: landblock.landblockId,
			label: formatLandblockLabel(landblock.landblockId),
			role:
				landblock.offsetX === 0 && landblock.offsetY === 0
					? "focus"
					: "neighbor",
			offsetX: landblock.offsetX,
			offsetY: landblock.offsetY,
			reason: "",
		}),
	);
}

function formatEnvCellLabel(envCellId: number): string {
	return `0x${formatHex32(envCellId)}`;
}

function describeAssetState(assetState: AssetChannelState): string {
	if (assetState.status === "error") {
		return assetState.errorMessage ?? "Asset preparation failed.";
	}

	if (assetState.status === "pending") {
		return `Asset worker is preparing ${assetState.activeRequest?.assetId ?? "the next request"} on the ${assetState.channel} channel.`;
	}

	if (assetState.preparedAsset) {
		return `Prepared ${assetState.preparedAsset.request.assetId} as ${describePreparedAssetPayload(assetState.preparedAsset.payload)} for ${assetState.preparedAsset.payload.residencyKind}. Channel: ${assetState.channel}.`;
	}

	return "Asset worker ingress is waiting for the next demand-driven asset response.";
}

export function normalizeViewportPoint(
	offsetX: number,
	offsetY: number,
	width: number,
	height: number,
): NormalizedViewportPoint {
	return {
		normalizedX: clamp(offsetX / Math.max(width, 1), 0, 1),
		normalizedY: clamp(offsetY / Math.max(height, 1), 0, 1),
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
