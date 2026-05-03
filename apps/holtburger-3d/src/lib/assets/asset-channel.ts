import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
	AssetPriority,
	RuntimeBatchDto,
} from "../host/contracts";
import { browserLocationToLandblockId, type BrowserLocationSelection } from "../../app/browser-mode";
import { lookupAsset } from "../host/tauri";
import type { PreparedAssetRecord } from "./types";
import type {
	AssetWorkerRequestMessage,
	AssetWorkerResponseMessage,
} from "../../workers/asset-worker";

export interface AssetWorkerLike {
	onmessage:
		| ((event: MessageEvent<AssetWorkerResponseMessage>) => void)
		| null;
	onerror: ((event: Event | ErrorEvent) => void) | null;
	postMessage(message: AssetWorkerRequestMessage): void;
	terminate(): void;
}

type AssetLookupFn = (
	request: AssetLookupRequestDto,
) => Promise<AssetLookupResponseDto>;

type PendingAssetRequest = {
	resolve: (asset: PreparedAssetRecord) => void;
	reject: (error: Error) => void;
};

export class AssetChannelController {
	private readonly worker: AssetWorkerLike;

	private readonly pendingRequests = new Map<string, PendingAssetRequest>();

	constructor(
		private readonly lookupAssetFn: AssetLookupFn = lookupAsset,
		workerFactory: () => AssetWorkerLike = createAssetWorker,
	) {
		this.worker = workerFactory();
		this.worker.onmessage = (event) => {
			const message = event.data;
			if (message.type === "asset-ready") {
				const pending = this.pendingRequests.get(message.asset.request.requestId);
				if (!pending) {
					return;
				}

				this.pendingRequests.delete(message.asset.request.requestId);
				pending.resolve(message.asset);
				return;
			}

			const pending = this.pendingRequests.get(message.requestId);
			if (!pending) {
				return;
			}

			this.pendingRequests.delete(message.requestId);
			pending.reject(new Error(message.message));
		};
		this.worker.onerror = (event) => {
			const errorMessage =
				event instanceof ErrorEvent
					? event.message
					: "Asset worker failed before preparation completed.";
			const error = new Error(errorMessage);
			for (const pending of this.pendingRequests.values()) {
				pending.reject(error);
			}
			this.pendingRequests.clear();
		};
	}

	async prepareAsset(
		request: AssetLookupRequestDto,
	): Promise<PreparedAssetRecord> {
		const response = await this.lookupAssetFn(request);

		return new Promise<PreparedAssetRecord>((resolve, reject) => {
			this.pendingRequests.set(request.requestId, { resolve, reject });
			this.worker.postMessage({
				type: "prepare-asset",
				request,
				response,
			});
		});
	}

	dispose(): void {
		this.worker.terminate();
		const error = new Error("Asset channel was disposed before preparation completed.");
		for (const pending of this.pendingRequests.values()) {
			pending.reject(error);
		}
		this.pendingRequests.clear();
	}
}

export function createFocusedAssetRequest(
	runtimeBatch: RuntimeBatchDto | null,
	browserDestination: BrowserLocationSelection | null,
	priority: AssetPriority,
): AssetLookupRequestDto | null {
	if (!runtimeBatch || runtimeBatch.residency.indoors) {
		return null;
	}

	const landblockId = deriveTerrainFocusLandblockId(runtimeBatch, browserDestination);
	const assetId = `terrain/${landblockId.toString(16).padStart(8, "0")}`;
	const requestScope = browserDestination ? "destination" : "runtime";

	return {
		requestId: `${priority}-${runtimeBatch.tick}-${requestScope}-${assetId}`,
		assetId,
		priority,
	};
}

export function createSceneCoverageRequests(
	runtimeBatch: RuntimeBatchDto | null,
	browserDestination: BrowserLocationSelection | null,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[] = [],
): AssetLookupRequestDto[] {
	if (!runtimeBatch) {
		return [];
	}

	if (runtimeBatch.residency.indoors) {
		return createIndoorCoverageRequests(
			runtimeBatch,
			priority,
			preparedByAssetId,
			pendingAssetIds,
		);
	}

	return createTerrainCoverageRequests(
		runtimeBatch,
		browserDestination,
		priority,
		preparedByAssetId,
		pendingAssetIds,
	);
}

export function createTerrainCoverageRequest(
	runtimeBatch: RuntimeBatchDto | null,
	browserDestination: BrowserLocationSelection | null,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetId: string | null,
): AssetLookupRequestDto | null {
	const requests = createTerrainCoverageRequests(
		runtimeBatch,
		browserDestination,
		priority,
		preparedByAssetId,
		pendingAssetId ? [pendingAssetId] : [],
	);

	return requests[0] ?? null;
}

export function createTerrainCoverageRequests(
	runtimeBatch: RuntimeBatchDto | null,
	browserDestination: BrowserLocationSelection | null,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[] = [],
): AssetLookupRequestDto[] {
	if (!runtimeBatch || runtimeBatch.residency.indoors) {
		return [];
	}

	const focusLandblockId = deriveTerrainFocusLandblockId(runtimeBatch, browserDestination);
	const requestScope = browserDestination ? "destination" : "runtime";
	const coverageAssetIds = buildOutdoorCoverageAssetIds(focusLandblockId, priority);
	const pendingAssetIdSet = new Set(pendingAssetIds);

	return coverageAssetIds
		.filter((assetId) => !preparedByAssetId[assetId] && !pendingAssetIdSet.has(assetId))
		.map((assetId) => ({
			requestId: `${priority}-${runtimeBatch.tick}-${requestScope}-${assetId}`,
			assetId,
			priority,
		}));
}

export function deriveTerrainFocusLandblockId(
	runtimeBatch: RuntimeBatchDto,
	browserDestination: BrowserLocationSelection | null,
): number {
	return browserDestination
		? browserLocationToLandblockId(browserDestination)
		: normalizeLandblockId(runtimeBatch.residency.focusLandblockId);
}

function normalizeLandblockId(rawLandblockId: number): number {
	return (rawLandblockId & 0xffff0000) | 0xffff;
}

function buildOutdoorCoverageAssetIds(
	focusLandblockId: number,
	priority: AssetPriority,
): string[] {
	if (priority === "bootstrap") {
		return [formatTerrainAssetId(focusLandblockId)];
	}

	const centerX = (focusLandblockId >>> 24) & 0xff;
	const centerY = (focusLandblockId >>> 16) & 0xff;
	const candidates: Array<{ assetId: string; distance: number; offsetX: number; offsetY: number }> = [];

	for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
		for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
			const nextX = centerX + offsetX;
			const nextY = centerY + offsetY;

			if (nextX < 0 || nextX > 0xfe || nextY < 0 || nextY > 0xfe) {
				continue;
			}

			const landblockId = ((nextX & 0xff) << 24) | ((nextY & 0xff) << 16) | 0xffff;
			candidates.push({
				assetId: formatTerrainAssetId(landblockId),
				distance: Math.abs(offsetX) + Math.abs(offsetY),
				offsetX,
				offsetY,
			});
		}
	}

	return candidates
		.sort((left, right) => {
			if (left.distance !== right.distance) {
				return left.distance - right.distance;
			}
			if (left.offsetY !== right.offsetY) {
				return left.offsetY - right.offsetY;
			}
			return left.offsetX - right.offsetX;
		})
		.map((candidate) => candidate.assetId);
}

function formatTerrainAssetId(landblockId: number): string {
	return `terrain/${landblockId.toString(16).padStart(8, "0")}`;
}

function createIndoorCoverageRequests(
	runtimeBatch: RuntimeBatchDto,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
): AssetLookupRequestDto[] {
	const { focusEnvCellId, visibleCellIds, environmentId, cellStructureId } =
		runtimeBatch.residency;
	if (focusEnvCellId === null) {
		return [];
	}

	const assetIds = [
		formatIndoorEnvCellAssetId(focusEnvCellId),
		...visibleCellIds.map((cellId) => formatIndoorEnvCellAssetId(cellId)),
		environmentId === null ? null : formatEnvironmentAssetId(environmentId),
		cellStructureId === null ? null : formatCellStructureAssetId(cellStructureId),
	].filter((assetId): assetId is string => assetId !== null);
	const pendingAssetIdSet = new Set(pendingAssetIds);

	return [...new Set(assetIds)]
		.filter((assetId) => !preparedByAssetId[assetId] && !pendingAssetIdSet.has(assetId))
		.map((assetId) => ({
			requestId: `${priority}-${runtimeBatch.tick}-runtime-${assetId}`,
			assetId,
			priority,
		}));
}

function formatIndoorEnvCellAssetId(envCellId: number): string {
	return `indoor-env-cell/${envCellId.toString(16).padStart(8, "0")}`;
}

function formatEnvironmentAssetId(environmentId: number): string {
	return `environment/${environmentId.toString(16).padStart(8, "0")}`;
}

function formatCellStructureAssetId(cellStructureId: number): string {
	return `cell-structure/${cellStructureId.toString(16).padStart(4, "0")}`;
}

function createAssetWorker(): AssetWorkerLike {
	return new Worker(new URL("../../workers/asset-worker.ts", import.meta.url), {
		type: "module",
	}) as unknown as AssetWorkerLike;
}