import type { BrowserLocationSelection } from "../../app/browser-mode";
import type { AppModeId } from "../../app/modes";
import { browserLocationToLandblockId } from "../../app/browser-mode";
import type {
	AssetChannelState,
	PreparedAssetRecord,
	PreparedTerrainMesh,
} from "../assets/types";
import {
	describePreparedAssetPayload,
	isPreparedTerrainLandblock,
} from "../assets/types";
import type {
	CameraHintAckDto,
	CameraHintDto,
	FrontendStateFeedDto,
	RayPickRequestDto,
	RayPickResponseDto,
	RuntimeBatchDto,
} from "../host/contracts";

export interface NormalizedViewportPoint {
	normalizedX: number;
	normalizedY: number;
}

export interface WorldDisplayDebugEntity {
	entityId: number;
	label: string;
	locationLabel: string;
	isLocalPlayer: boolean;
	isSelected: boolean;
	screenXPercent: number;
	screenYPercent: number;
}

export interface WorldDisplaySceneChunk {
	landblockId: number;
	label: string;
	role: "focus" | "neighbor";
	offsetX: number;
	offsetY: number;
	reason: string;
}

export interface WorldDisplaySceneContext {
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

export interface WorldDisplayTerrainContract {
	requestKey: string | null;
	sourceAssetKind: "cell-landblock";
	decodeOwner: "rust-host-adapter";
	renderOwner: "frontend-world-display";
	loadAnchor: string;
	geometryAnchor: string;
	indoorBranchText: string;
	statusText: string;
}

export interface WorldDisplayTerrainPolygon {
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
	activeModeLabel: string;
	hostStatus: string;
	runtimeBatch: RuntimeBatchDto | null;
	viewModelFeed: FrontendStateFeedDto | null;
	assetState: AssetChannelState;
	browserDestination: BrowserLocationSelection | null;
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
	activeModeLabel,
	hostStatus,
	runtimeBatch,
	viewModelFeed,
	assetState,
	browserDestination,
	cameraAck,
	rayPickResponse,
	pendingCameraHint,
}: WorldDisplayModelInput): WorldDisplayModel {
	if (!runtimeBatch) {
		return {
			headline: `${activeModeLabel} is waiting for a runtime-backed world shell.`,
			focusLocationLabel: "No runtime residency available yet.",
			destinationLabel:
				browserDestination?.label ?? "No manual destination selected yet.",
			renderCacheText: hostStatus,
			inputText:
				"Camera hints and authority-sensitive picks activate once runtime data arrives.",
			assetText: describeAssetState(assetState),
			sceneContext: createPendingSceneContext(browserDestination),
			terrainContract: createTerrainContract(null),
			entities: [],
		};
	}

	void viewModelFeed;
	const destinationLabel =
		browserDestination?.label ?? runtimeBatch.residency.focusLocationLabel;
	const sceneContext = deriveSceneContext(
		runtimeBatch,
		browserDestination,
		assetState,
	);

	return {
		headline: browserDestination
			? "Manual destination focus is now driving the shared world shell."
			: "The shared world shell is anchored to live runtime residency.",
		focusLocationLabel:
			browserDestination?.label ?? runtimeBatch.residency.focusLocationLabel,
		destinationLabel,
		renderCacheText: `Runtime tick ${runtimeBatch.tick} with terrain coverage selected from authoritative residency instead of fixture entities.`,
		inputText: pendingCameraHint
			? "Camera hints are being throttled through the app-local runtime channel."
			: (describeRayPickResponse(rayPickResponse) ??
				describeCameraHintAck(cameraAck) ??
				"Viewport input is ready to send camera hints. Picks stay dormant until real world entities exist."),
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
			"Local outdoor scene context will lock in once authoritative runtime residency arrives.",
		focusAnchorLabel: "No focus landblock yet.",
		destinationText: browserDestination
			? `Manual destination focus is staged for ${browserDestination.label}, but chunk selection still waits on authoritative residency.`
			: "No manual destination focus is staged yet.",
		coverageText:
			"Phase 7 keeps chunk selection app-local and outdoor-first; indoor visible-cell expansion remains deferred.",
		gapText:
			"The app still needs an authoritative coordinate-to-landblock query before manual destinations can choose terrain chunks directly.",
		chunks: [],
		staticRenderableInstanceCount: 0,
		staticRenderableBuildingCount: 0,
		staticRenderableSourceAssetIds: [],
	};
}

function deriveSceneContext(
	runtimeBatch: RuntimeBatchDto,
	browserDestination: BrowserLocationSelection | null,
	assetState: AssetChannelState,
): WorldDisplaySceneContext {
	const focusLandblockId = browserDestination
		? browserLocationToLandblockId(browserDestination)
		: normalizeLandblockId(runtimeBatch.residency.focusLandblockId);
	const focusLandblockLabel = formatLandblockLabel(focusLandblockId);
	const destinationText = browserDestination
		? `Manual destination focus is ${browserDestination.label}, and local terrain coverage now anchors to the selected landblock ${focusLandblockLabel}.`
		: `No manual destination override is active, so local terrain coverage follows authoritative runtime landblock ${focusLandblockLabel}.`;

	if (runtimeBatch.residency.indoors) {
		const focusEnvCellLabel = runtimeBatch.residency.focusEnvCellId
			? formatEnvCellLabel(runtimeBatch.residency.focusEnvCellId)
			: "Unknown env cell";
		const visibleCount = runtimeBatch.residency.visibleCellIds.length;
		const preparedIndoorAssets = Object.keys(
			assetState.preparedByAssetId,
		).filter(
			(assetId) =>
				assetId.startsWith("indoor-env-cell/") ||
				assetId.startsWith("environment/") ||
				assetId.startsWith("cell-structure/"),
		);
		const seenOutsideText =
			runtimeBatch.residency.seenOutside === null
				? "SeenOutside is not available yet."
				: runtimeBatch.residency.seenOutside
					? "SeenOutside is set, so outdoor relevance may still matter."
					: "SeenOutside is clear, so indoor visible-cell relevance stays local to env cells.";

		return {
			kind: "indoor-visible-cell-set",
			statusText:
				"Indoor scene context is now explicit: WorldDisplay tracks env-cell and visible-cell membership separately from outdoor landblock terrain.",
			focusAnchorLabel: focusEnvCellLabel,
			destinationText,
			coverageText: `Indoor focus ${focusEnvCellLabel} currently exposes ${visibleCount} visible cell${visibleCount === 1 ? "" : "s"}, ${preparedIndoorAssets.length} prepared indoor asset${preparedIndoorAssets.length === 1 ? "" : "s"}, and ${seenOutsideText}`,
			gapText: null,
			chunks: [],
			staticRenderableInstanceCount: 0,
			staticRenderableBuildingCount: 0,
			staticRenderableSourceAssetIds: [],
		};
	}

	const chunks = buildOutdoorChunkRing(focusLandblockId).map((chunk) => ({
		...chunk,
		reason:
			chunk.role === "focus"
				? "ACViewer loads the center outdoor landblock as the anchor for the local world view."
				: "ACViewer's outdoor load path expands a radius-1 landblock ring around the outdoor focus block.",
	}));

	return {
		kind: "outdoor-landblock-ring",
		statusText:
			"Phase 7 gives WorldDisplay an honest outdoor scene context: one focus landblock plus its immediate neighbor ring, matching the first outdoor browsing assumption used by ACViewer.",
		focusAnchorLabel: focusLandblockLabel,
		destinationText,
		coverageText: `Outdoor coverage currently selects ${chunks.length} landblocks, ${runtimeBatch.outdoorSceneryInstances.length} static object${runtimeBatch.outdoorSceneryInstances.length === 1 ? "" : "s"}, and ${runtimeBatch.outdoorBuildingInstances.length} building${runtimeBatch.outdoorBuildingInstances.length === 1 ? "" : "s"} in a radius-1 ring around ${focusLandblockLabel}.`,
		gapText:
			"Phase 9 now proves one real outdoor terrain payload on the asset channel, but indoor visible-cell expansion and broader outdoor coverage are still pending.",
		chunks,
		staticRenderableInstanceCount: runtimeBatch.outdoorSceneryInstances.length,
		staticRenderableBuildingCount: runtimeBatch.outdoorBuildingInstances.length,
		staticRenderableSourceAssetIds: [
			...new Set([
				...runtimeBatch.outdoorSceneryInstances.map(
					(instance) => instance.sourceAssetId,
				),
				...runtimeBatch.outdoorBuildingInstances.map(
					(instance) => instance.sourceAssetId,
				),
			]),
		].sort(),
	};
}

function createTerrainContract(
	sceneContext: WorldDisplaySceneContext | null,
): WorldDisplayTerrainContract {
	const focusChunk =
		sceneContext?.chunks.find((chunk) => chunk.role === "focus") ?? null;
	const requestKey = focusChunk
		? `terrain/${focusChunk.landblockId.toString(16).padStart(8, "0")}`
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

function buildOutdoorChunkRing(
	focusLandblockId: number,
): WorldDisplaySceneChunk[] {
	const centerX = (focusLandblockId >>> 24) & 0xff;
	const centerY = (focusLandblockId >>> 16) & 0xff;
	const chunks: WorldDisplaySceneChunk[] = [];

	for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
		for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
			const nextX = centerX + offsetX;
			const nextY = centerY + offsetY;

			if (nextX < 0 || nextX > 0xfe || nextY < 0 || nextY > 0xfe) {
				continue;
			}

			const landblockId =
				((nextX & 0xff) << 24) | ((nextY & 0xff) << 16) | 0xffff;
			chunks.push({
				landblockId,
				label: formatLandblockLabel(landblockId),
				role: offsetX === 0 && offsetY === 0 ? "focus" : "neighbor",
				offsetX,
				offsetY,
				reason: "",
			});
		}
	}

	return chunks;
}

function normalizeLandblockId(rawLandblockId: number): number {
	return (rawLandblockId & 0xffff0000) | 0xffff;
}

function formatLandblockLabel(landblockId: number): string {
	return `0x${landblockId.toString(16).padStart(8, "0")}`;
}

function formatEnvCellLabel(envCellId: number): string {
	return `0x${envCellId.toString(16).padStart(8, "0")}`;
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
	if (!preparedAsset || !isPreparedTerrainLandblock(preparedAsset)) {
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

	return buildTerrainViewport(preparedAsset.payload.terrainMesh);
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
	activeMode: AppModeId,
	runtimeBatch: RuntimeBatchDto | null,
	browserDestination: BrowserLocationSelection | null,
	viewportPoint: NormalizedViewportPoint = DEFAULT_VIEWPORT_POINT,
): CameraHintDto | null {
	if (!runtimeBatch) {
		return null;
	}

	const focusEntity =
		runtimeBatch.entities.find((entity) => entity.isLocalPlayer) ??
		runtimeBatch.entities[0] ??
		null;
	const anchorPosition = focusEntity?.position ?? { x: 96, y: 96, z: 24 };
	const anchorHeading = focusEntity?.headingRadians ?? 0;

	const yaw = anchorHeading + (viewportPoint.normalizedX - 0.5) * 1.4;
	const pitch = (0.5 - viewportPoint.normalizedY) * 0.65;

	return {
		mode: activeMode,
		source: "world-display",
		position: anchorPosition,
		forward: normalizeVec3({
			x: Math.cos(yaw),
			y: Math.sin(yaw),
			z: pitch,
		}),
		viewportNormalizedX: viewportPoint.normalizedX,
		viewportNormalizedY: viewportPoint.normalizedY,
		destinationLabel:
			browserDestination?.label ?? runtimeBatch.residency.focusLocationLabel,
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
