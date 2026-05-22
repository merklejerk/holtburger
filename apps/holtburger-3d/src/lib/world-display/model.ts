import type { BrowserLocationSelection } from "../../app/browser-mode";
import {
	browserDestinationToInteriorCellId,
	browserLocationToLandblockId,
} from "../../app/browser-mode";
import {
	buildOutdoorCoverageLandblocks,
	formatHex32,
	formatLandblockLabel,
	formatLandblockPackAssetId,
} from "../landblocks";
import type {
	AssetChannelState,
	PreparedAssetRecord,
	PreparedLandblockPackPayload,
	PreparedTerrainMesh,
} from "../assets/types";
import { describePreparedAssetPayload } from "../assets/types";
import type {
	CameraHintAckDto,
	CameraHintDto,
	RayPickRequestDto,
	RayPickResponseDto,
} from "../host/contracts";

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

interface WorldDisplaySceneContext {
	kind: "outdoor-landblock-ring" | "indoor-visible-cell-set";
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

interface WorldDisplayTerrainPolygon {
	key: string;
	points: string;
	fill: string;
	stroke: string;
}

export interface WorldDisplayTerrainViewport {
	ready: boolean;
	landblockLabel: string | null;
	statusText: string;
	viewBox: string;
	polygons: WorldDisplayTerrainPolygon[];
}

export interface WorldDisplayModel {
	headline: string;
	focusLocationLabel: string;
	destinationLabel: string;
	renderCacheText: string;
	inputText: string;
	assetText: string;
	sceneContext: WorldDisplaySceneContext;
	terrainContract: WorldDisplayTerrainContract;
	entities: WorldDisplayDebugEntity[];
}

interface WorldDisplayModelInput {
	assetState: AssetChannelState;
	browserDestination: BrowserLocationSelection | null;
	terrainLodRadius: number;
	buildingLodRadius: number;
	detailLodRadius: number;
	cameraAck: CameraHintAckDto | null;
	rayPickResponse: RayPickResponseDto | null;
	pendingCameraHint: boolean;
}

const DEFAULT_VIEWPORT_POINT: NormalizedViewportPoint = {
	normalizedX: 0.5,
	normalizedY: 0.5,
};

const MIN_CAMERA_HINT_INTERVAL_MS = 250;

export function deriveWorldDisplayModel({
	assetState,
	browserDestination,
	terrainLodRadius,
	buildingLodRadius,
	detailLodRadius,
	cameraAck,
	rayPickResponse,
	pendingCameraHint,
}: WorldDisplayModelInput): WorldDisplayModel {
	if (!browserDestination) {
		return {
			headline: "Browser scene viewer is waiting for a destination.",
			focusLocationLabel: "No browser destination selected yet.",
			destinationLabel: "No browser destination selected yet.",
			renderCacheText:
				"Browser asset cache is ready for destination-driven coverage.",
			inputText: "Camera hints and picks use browser-owned camera state only.",
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
		headline: "Browser destination is driving the shared world shell.",
		focusLocationLabel: browserDestination.label,
		destinationLabel: browserDestination.label,
		renderCacheText:
			"Scene coverage is selected from browser destination and frontend cache state.",
		inputText: pendingCameraHint
			? "Camera hints are being throttled through the browser diagnostics channel."
			: (describeRayPickResponse(rayPickResponse) ??
				describeCameraHintAck(cameraAck) ??
				"Viewport input is ready to send browser camera hints."),
		assetText: describeAssetState(assetState),
		sceneContext,
		terrainContract: createTerrainContract(sceneContext),
		entities: [],
	};
}

function createPendingSceneContext(
	browserDestination: BrowserLocationSelection | null,
): WorldDisplaySceneContext {
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
): WorldDisplaySceneContext {
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
	const preparedLandblockPacks = Object.values(assetState.preparedByAssetId)
		.map((asset) => asset.payload)
		.filter(
			(payload): payload is PreparedLandblockPackPayload =>
				payload.kind === "landblock-pack" &&
				(buildingLandblockIds.has(payload.landblockId) ||
					detailLandblockIds.has(payload.landblockId)),
		);
	const staticInstanceCount = preparedLandblockPacks.reduce(
		(total, payload) =>
			total +
			payload.prepared.outdoorStaticInstances.filter(
				(instance) =>
					instance.kind !== "building" &&
					detailLandblockIds.has(instance.owningLandblockId),
			).length,
		0,
	);
	const staticBuildingCount = preparedLandblockPacks.reduce(
		(total, payload) =>
			total +
			payload.prepared.outdoorStaticInstances.filter(
				(instance) =>
					instance.kind === "building" &&
					buildingLandblockIds.has(instance.owningLandblockId),
			).length,
		0,
	);
	const staticRenderableSourceAssetIds = preparedLandblockPacks.flatMap(
		(payload) =>
			payload.prepared.outdoorStaticInstances
				.filter((instance) =>
					instance.kind === "building"
						? buildingLandblockIds.has(instance.owningLandblockId)
						: detailLandblockIds.has(instance.owningLandblockId),
				)
				.map((instance) => instance.sourceAssetId),
	);

	return {
		kind: "outdoor-landblock-ring",
		statusText:
			"Browser mode is using explicit outdoor LoD sets for terrain, buildings, and smaller detail objects.",
		focusAnchorLabel: focusLandblockLabel,
		destinationText,
		coverageText: `Outdoor LoD selects ${chunks.length} terrain tile${chunks.length === 1 ? "" : "s"}, ${staticBuildingCount} building${staticBuildingCount === 1 ? "" : "s"} inside distance ${buildingLodRadius}, and ${staticInstanceCount} detail object${staticInstanceCount === 1 ? "" : "s"} inside distance ${detailLodRadius} around ${focusLandblockLabel}.`,
		gapText:
			"Phase 9 now proves one real outdoor terrain payload on the asset channel, but indoor visible-cell expansion and broader outdoor coverage are still pending.",
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
): WorldDisplaySceneContext {
	const focusEnvCellLabel = focusEnvCellId
		? formatEnvCellLabel(focusEnvCellId)
		: "Unknown env cell";
	const preparedIndoorCellCount = Object.values(
		assetState.preparedByAssetId,
	).reduce(
		(total, asset) =>
			asset.payload.kind === "landblock-pack"
				? total + asset.payload.prepared.interiorCells.length
				: total,
		0,
	);
	return {
		kind: "indoor-visible-cell-set",
		statusText:
			"Indoor scene context is explicit: WorldDisplay tracks env-cell and visible-cell membership separately from outdoor landblock terrain.",
		focusAnchorLabel: focusEnvCellLabel,
		destinationText: destinationLabel
			? `Manual destination focus is ${destinationLabel}.`
			: `Indoor focus is ${focusEnvCellLabel}.`,
		coverageText: `Indoor focus ${focusEnvCellLabel} is backed by ${preparedIndoorCellCount} pack-prepared cell${preparedIndoorCellCount === 1 ? "" : "s"}. Browser dungeons load from the owning landblock pack instead of runtime visible-cell state.`,
		gapText: null,
		chunks: [],
		staticRenderableInstanceCount: 0,
		staticRenderableBuildingCount: 0,
		staticRenderableSourceAssetIds: [],
	};
}

function createTerrainContract(
	sceneContext: WorldDisplaySceneContext | null,
): WorldDisplayTerrainContract {
	const focusChunk =
		sceneContext?.chunks.find((chunk) => chunk.role === "focus") ?? null;
	const requestKey = focusChunk
		? formatLandblockPackAssetId(focusChunk.landblockId)
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
			"Outdoor terrain should come from normalized landblock loads first; indoor env cells stay on a separate visible-cell expansion track.",
		statusText: requestKey
			? `Phase 9 now exercises ${requestKey} end to end: Rust decodes CellLandblock terrain data into an app-local payload, and WorldDisplay keeps final mesh and GPU hydration on the frontend.`
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

export function deriveTerrainViewport(
	preparedAsset: PreparedAssetRecord | null,
): WorldDisplayTerrainViewport {
	const terrainMesh = preparedAsset
		? getTerrainMeshFromPreparedAsset(preparedAsset)
		: null;
	if (!terrainMesh) {
		return {
			ready: false,
			landblockLabel: null,
			statusText: preparedAsset
				? `Most recent asset ${preparedAsset.request.assetId} does not carry a terrain mesh yet.`
				: "Waiting for the first outdoor terrain asset to be prepared.",
			viewBox: "0 0 360 240",
			polygons: [],
		};
	}

	return buildTerrainViewport(terrainMesh);
}

function getTerrainMeshFromPreparedAsset(
	asset: PreparedAssetRecord,
): PreparedTerrainMesh | null {
	if (asset.payload.kind === "landblock-pack") {
		return asset.payload.prepared.terrainMesh;
	}

	if (asset.payload.kind === "landblock-summary") {
		return asset.payload.prepared.terrainMesh;
	}

	return null;
}

function buildTerrainViewport(
	terrainMesh: PreparedTerrainMesh,
): WorldDisplayTerrainViewport {
	const projectedVertices = terrainMesh.vertices.map(projectTerrainVertex);
	const bounds = projectedVertices.reduce(
		(accumulator, vertex) => ({
			minX: Math.min(accumulator.minX, vertex.x),
			maxX: Math.max(accumulator.maxX, vertex.x),
			minY: Math.min(accumulator.minY, vertex.y),
			maxY: Math.max(accumulator.maxY, vertex.y),
		}),
		{
			minX: Number.POSITIVE_INFINITY,
			maxX: Number.NEGATIVE_INFINITY,
			minY: Number.POSITIVE_INFINITY,
			maxY: Number.NEGATIVE_INFINITY,
		},
	);
	const padding = 20;
	const width = bounds.maxX - bounds.minX + padding * 2;
	const height = bounds.maxY - bounds.minY + padding * 2;
	const heightSpan = Math.max(terrainMesh.maxHeight - terrainMesh.minHeight, 1);

	const polygons = terrainMesh.triangles.map((triangle, index) => {
		const vertices = [triangle.a, triangle.b, triangle.c].map((vertexIndex) => {
			const vertex = projectedVertices[vertexIndex];
			return `${(vertex.x - bounds.minX + padding).toFixed(2)},${(vertex.y - bounds.minY + padding).toFixed(2)}`;
		});
		const heightRatio =
			(triangle.averageHeight - terrainMesh.minHeight) / heightSpan;
		const hue = 86 + (triangle.terrainType % 6) * 14;
		const lightness = 28 + heightRatio * 26;

		return {
			key: `${terrainMesh.landblockId}-${index}`,
			points: vertices.join(" "),
			fill: `hsl(${hue} 34% ${lightness}%)`,
			stroke: `hsl(${hue} 28% ${Math.max(lightness - 10, 18)}%)`,
		};
	});

	return {
		ready: true,
		landblockLabel: formatLandblockLabel(terrainMesh.landblockId),
		statusText: `Prepared landblock ${formatLandblockLabel(terrainMesh.landblockId)} with ${terrainMesh.triangles.length} terrain triangles and a height range of ${terrainMesh.minHeight.toFixed(1)}-${terrainMesh.maxHeight.toFixed(1)}.`,
		viewBox: `0 0 ${width.toFixed(2)} ${height.toFixed(2)}`,
		polygons,
	};
}

export function describeCameraHintAck(
	cameraAck: CameraHintAckDto | null,
): string | null {
	if (!cameraAck) {
		return null;
	}

	return cameraAck.accepted
		? `Accepted camera hint #${cameraAck.sequence}.`
		: `Rejected camera hint #${cameraAck.sequence}.`;
}

export function describeRayPickResponse(
	rayPickResponse: RayPickResponseDto | null,
): string | null {
	if (!rayPickResponse) {
		return null;
	}

	if (rayPickResponse.resolved && rayPickResponse.hit) {
		return `Resolved the authority-sensitive debug pick against ${rayPickResponse.hit.label} at ${rayPickResponse.hit.locationLabel}.`;
	}

	return "No authoritative debug entity intersected the current pick ray.";
}

function projectTerrainVertex(vertex: { x: number; y: number; z: number }) {
	return {
		x: (vertex.x - vertex.y) * 0.92,
		y: (vertex.x + vertex.y) * 0.46 - vertex.z * 1.25,
	};
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

export function shouldSendThrottledCameraHint(
	lastSentAt: number | null,
	now: number,
	minIntervalMs = MIN_CAMERA_HINT_INTERVAL_MS,
): boolean {
	return lastSentAt === null || now - lastSentAt >= minIntervalMs;
}

export function buildCameraHint(
	browserDestination: BrowserLocationSelection | null,
	viewportPoint: NormalizedViewportPoint = DEFAULT_VIEWPORT_POINT,
): CameraHintDto | null {
	const anchorPosition = { x: 96, y: 96, z: 24 };
	const yaw = (viewportPoint.normalizedX - 0.5) * 1.4;
	const pitch = (0.5 - viewportPoint.normalizedY) * 0.65;

	return {
		source: "world-display",
		position: anchorPosition,
		forward: normalizeVec3({
			x: Math.cos(yaw),
			y: Math.sin(yaw),
			z: pitch,
		}),
		viewportNormalizedX: viewportPoint.normalizedX,
		viewportNormalizedY: viewportPoint.normalizedY,
		destinationLabel: browserDestination?.label ?? null,
	};
}

export function buildRayPickRequest(
	cameraHint: CameraHintDto,
	requestId: string,
): RayPickRequestDto {
	return {
		requestId,
		origin: cameraHint.position,
		direction: cameraHint.forward,
		screenXNormalized: cameraHint.viewportNormalizedX,
		screenYNormalized: cameraHint.viewportNormalizedY,
		destinationLabel: cameraHint.destinationLabel,
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function normalizeVec3(vector: { x: number; y: number; z: number }) {
	const length = Math.hypot(vector.x, vector.y, vector.z);

	if (length === 0) {
		return { x: 0, y: 1, z: 0 };
	}

	return {
		x: vector.x / length,
		y: vector.y / length,
		z: vector.z / length,
	};
}
