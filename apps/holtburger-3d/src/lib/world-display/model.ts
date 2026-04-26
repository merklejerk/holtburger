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

export interface WorldDisplayModel {
	headline: string;
	focusLocationLabel: string;
	destinationLabel: string;
	renderCacheSummary: string;
	inputSummary: string;
	assetSummary: string;
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
			entities: [],
		};
	}

	const selectedEntityId = viewModelFeed?.selectedEntityId ?? null;
	const selectedEntityLabel =
		runtimeBatch.entities.find((entity) => entity.entityId === selectedEntityId)
			?.label ?? "none";
	const destinationLabel =
		browserDestination?.label ?? runtimeBatch.residency.focusLocationLabel;

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
		entities: projectDebugEntities(runtimeBatch.entities, selectedEntityId),
	};
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
