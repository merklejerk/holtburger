import type { BrowserLocationSelection } from "../../app/browser-mode";
import type { AppModeId } from "../../app/modes";
import type { AssetChannelState } from "../assets/types";
import type {
	CameraHintAckDto,
	CameraHintDto,
	FrontendStateFeedDto,
	RayPickRequestDto,
	RayPickResponseDto,
	RuntimeBatchDto,
	RuntimeEntitySnapshotDto,
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
	kind: "outdoor-landblock-ring" | "indoor-gap";
	summary: string;
	focusLandblockLabel: string;
	destinationSummary: string;
	coverageSummary: string;
	gapSummary: string | null;
	chunks: WorldDisplaySceneChunk[];
}

export interface WorldDisplayTerrainContract {
	requestKey: string | null;
	sourceAssetKind: "cell-landblock";
	decodeOwner: "rust-host-adapter";
	renderOwner: "frontend-world-display";
	loadAnchor: string;
	geometryAnchor: string;
	indoorBranchSummary: string;
	summary: string;
}

export interface WorldDisplayModel {
	headline: string;
	focusLocationLabel: string;
	destinationLabel: string;
	renderCacheSummary: string;
	inputSummary: string;
	assetSummary: string;
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
				browserDestination?.label ?? "No browser destination selected yet.",
			renderCacheSummary: hostStatus,
			inputSummary:
				"Camera hints and authority-sensitive picks activate once runtime data arrives.",
			assetSummary: deriveAssetSummary(assetState),
			sceneContext: createPendingSceneContext(browserDestination),
			terrainContract: createTerrainContract(null),
			entities: [],
		};
	}

	const selectedEntityId = viewModelFeed?.selectedEntityId ?? null;
	const selectedEntityLabel =
		runtimeBatch.entities.find((entity) => entity.entityId === selectedEntityId)
			?.label ?? "none";
	const destinationLabel =
		browserDestination?.label ?? runtimeBatch.residency.focusLocationLabel;
	const sceneContext = deriveSceneContext(runtimeBatch, browserDestination);

	return {
		headline: browserDestination
			? "Browser destination preview is now driving the shared world shell."
			: "The shared world shell is anchored to live runtime residency.",
		focusLocationLabel: runtimeBatch.residency.focusLocationLabel,
		destinationLabel,
		renderCacheSummary: `Runtime tick ${runtimeBatch.tick} with ${runtimeBatch.entities.length} mirrored entities. Selected entity: ${selectedEntityLabel}.`,
		inputSummary: pendingCameraHint
			? "Camera hints are being throttled through the app-local runtime channel."
			: (rayPickResponse?.summary ??
				cameraAck?.summary ??
				"Viewport input is ready to send camera hints and authoritative debug picks."),
			assetSummary: deriveAssetSummary(assetState),
			sceneContext,
			terrainContract: createTerrainContract(sceneContext),
		entities: projectDebugEntities(runtimeBatch.entities, selectedEntityId),
	};
}

function createPendingSceneContext(
	browserDestination: BrowserLocationSelection | null,
): WorldDisplaySceneContext {
	return {
		kind: "outdoor-landblock-ring",
		summary:
			"Local outdoor scene context will lock in once authoritative runtime residency arrives.",
		focusLandblockLabel: "No focus landblock yet.",
		destinationSummary: browserDestination
			? `Destination preview is staged for ${browserDestination.label}, but chunk selection still waits on authoritative residency.`
			: "No browser destination preview is staged yet.",
		coverageSummary:
			"Phase 7 keeps chunk selection app-local and outdoor-first; indoor visible-cell expansion remains deferred.",
		gapSummary:
			"The app still needs an authoritative coordinate-to-landblock query before manual browser destinations can choose terrain chunks directly.",
		chunks: [],
	};
}

function deriveSceneContext(
	runtimeBatch: RuntimeBatchDto,
	browserDestination: BrowserLocationSelection | null,
): WorldDisplaySceneContext {
	const focusLandblockId = normalizeLandblockId(
		runtimeBatch.residency.focusLandblockId,
	);
	const focusLandblockLabel = formatLandblockLabel(focusLandblockId);
	const destinationSummary = browserDestination
		? `Destination preview is ${browserDestination.label}, but Phase 7 still anchors local terrain coverage to authoritative runtime landblock ${focusLandblockLabel} until a coordinate-to-landblock seam exists.`
		: `No manual destination override is active, so local terrain coverage follows authoritative runtime landblock ${focusLandblockLabel}.`;

	if (runtimeBatch.residency.indoors) {
		return {
			kind: "indoor-gap",
			summary:
				"The local scene contract is now explicit about its outdoor-first limit: indoor env-cell and visible-cell membership are still future work.",
			focusLandblockLabel,
			destinationSummary,
			coverageSummary:
				"No outdoor landblock ring is selected while runtime residency is indoors.",
			gapSummary:
				"Indoor scene membership needs env-cell and visible-cell semantics before terrain or room geometry can be requested honestly.",
			chunks: [],
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
		summary:
			"Phase 7 gives WorldDisplay an honest outdoor scene context: one focus landblock plus its immediate neighbor ring, matching the first outdoor browsing assumption used by ACViewer.",
		focusLandblockLabel,
		destinationSummary,
		coverageSummary: `Outdoor coverage currently selects ${chunks.length} landblocks in a radius-1 ring around ${focusLandblockLabel}.`,
		gapSummary:
			"The app still lacks real terrain payload requests and indoor visible-cell expansion, so this scene context is selection policy only for now.",
		chunks,
	};
}

function createTerrainContract(
	sceneContext: WorldDisplaySceneContext | null,
): WorldDisplayTerrainContract {
	const focusChunk = sceneContext?.chunks.find((chunk) => chunk.role === "focus") ?? null;
	const requestKey = focusChunk
		? `terrain/${focusChunk.landblockId.toString(16).padStart(8, "0")}`
		: null;

	return {
		requestKey,
		sourceAssetKind: "cell-landblock",
		decodeOwner: "rust-host-adapter",
		renderOwner: "frontend-world-display",
		loadAnchor: "ACViewer.WorldViewer.LoadLandblock + ACE.DatLoader.CellLandblock",
		geometryAnchor: "ACViewer.Render.R_Landblock + TerrainBatchDraw.AddTerrain",
		indoorBranchSummary:
			"Outdoor terrain should come from normalized landblock loads first; indoor env cells stay on a separate visible-cell expansion track.",
		summary: requestKey
			? `Phase 7 records the first terrain request contract as ${requestKey}: Rust should decode CellLandblock terrain data into an app-local payload, and WorldDisplay should keep final mesh and GPU hydration on the frontend.`
			: "Phase 7 records the terrain contract shape, but it still needs a focus outdoor landblock before the first request key can be selected.",
	};
}

function buildOutdoorChunkRing(focusLandblockId: number): WorldDisplaySceneChunk[] {
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

			const landblockId = ((nextX & 0xff) << 24) | ((nextY & 0xff) << 16) | 0xffff;
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

function deriveAssetSummary(assetState: AssetChannelState): string {
	if (assetState.status === "error") {
		return assetState.errorMessage ?? "Asset preparation failed.";
	}

	if (assetState.status === "pending") {
		return `Asset worker is preparing ${assetState.activeRequest?.assetId ?? "the next request"} on the ${assetState.channel} channel.`;
	}

	if (assetState.preparedAsset) {
		return `${assetState.preparedAsset.summary} Channel: ${assetState.channel}.`;
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
		runtimeBatch.entities[0];

	if (!focusEntity) {
		return null;
	}

	const yaw =
		focusEntity.headingRadians + (viewportPoint.normalizedX - 0.5) * 1.4;
	const pitch = (0.5 - viewportPoint.normalizedY) * 0.65;

	return {
		mode: activeMode,
		source: "world-display",
		position: focusEntity.position,
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

function projectDebugEntities(
	entities: RuntimeEntitySnapshotDto[],
	selectedEntityId: number | null,
): WorldDisplayDebugEntity[] {
	if (entities.length === 0) {
		return [];
	}

	const xs = entities.map((entity) => entity.position.x);
	const ys = entities.map((entity) => entity.position.y);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	const spanX = Math.max(maxX - minX, 1);
	const spanY = Math.max(maxY - minY, 1);

	return entities.map((entity) => ({
		entityId: entity.entityId,
		label: entity.label,
		locationLabel: entity.locationLabel,
		isLocalPlayer: entity.isLocalPlayer,
		isSelected: entity.entityId === selectedEntityId,
		screenXPercent: 10 + ((entity.position.x - minX) / spanX) * 80,
		screenYPercent: 10 + ((entity.position.y - minY) / spanY) * 80,
	}));
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
