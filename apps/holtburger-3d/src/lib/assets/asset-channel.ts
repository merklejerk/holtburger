import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
	AssetPriority,
	RuntimeBatchDto,
} from "../host/contracts";
import {
	browserLocationToLandblockId,
	type BrowserLocationSelection,
} from "../../app/browser-mode";
import {
	buildOutdoorCoverageLandblockIds,
	formatHex32,
	formatLandblockStaticsAssetId,
	formatTerrainAssetId,
	normalizeOutdoorLandblockId,
} from "../landblocks";
import { lookupAsset } from "../host/tauri";
import {
	derivePreparedAssetDependencyStatus,
	getPreparedAssetDependencies,
	type PreparedAssetDependencyStatus,
	type PreparedAssetRecord,
} from "./types";
import type {
	AssetWorkerRequestMessage,
	AssetWorkerResponseMessage,
} from "../../workers/asset-worker";

export interface AssetWorkerLike {
	onmessage: ((event: MessageEvent<AssetWorkerResponseMessage>) => void) | null;
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

export interface AssetGraphPreparationResult {
	rootAsset: PreparedAssetRecord;
	preparedAssets: PreparedAssetRecord[];
	preparedByAssetId: Record<string, PreparedAssetRecord>;
	dependencyStatus: PreparedAssetDependencyStatus;
}

export interface OutdoorCoverageOptions {
	landblockRadius: number;
}

const DEFAULT_OUTDOOR_COVERAGE_OPTIONS: OutdoorCoverageOptions = {
	landblockRadius: 1,
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
				const pending = this.pendingRequests.get(
					message.asset.request.requestId,
				);
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

	async prepareAssetGraph(
		rootRequest: AssetLookupRequestDto,
		preparedByAssetId: Record<string, PreparedAssetRecord> = {},
	): Promise<AssetGraphPreparationResult> {
		const preparedAssets: PreparedAssetRecord[] = [];
		const nextRequests: AssetLookupRequestDto[] = [rootRequest];
		const scheduledAssetIds = new Set<string>([
			rootRequest.assetId,
			...Object.keys(preparedByAssetId),
		]);
		let rootAsset: PreparedAssetRecord | null =
			preparedByAssetId[rootRequest.assetId] ?? null;
		if (rootAsset) {
			this.enqueueMissingDependencyRequests(
				rootRequest,
				rootAsset,
				preparedByAssetId,
				scheduledAssetIds,
				nextRequests,
			);
		}

		while (nextRequests.length > 0) {
			const request = nextRequests.shift();
			if (!request || preparedByAssetId[request.assetId]) {
				continue;
			}

			const asset = await this.prepareAsset(request);
			preparedAssets.push(asset);
			preparedByAssetId[asset.request.assetId] = asset;
			if (asset.request.assetId === rootRequest.assetId) {
				rootAsset = asset;
			}

			this.enqueueMissingDependencyRequests(
				rootRequest,
				asset,
				preparedByAssetId,
				scheduledAssetIds,
				nextRequests,
			);
		}

		if (!rootAsset) {
			throw new Error(`Root asset ${rootRequest.assetId} was not prepared.`);
		}

		return {
			rootAsset,
			preparedAssets,
			preparedByAssetId,
			dependencyStatus: derivePreparedAssetDependencyStatus(
				rootAsset,
				preparedByAssetId,
			),
		};
	}

	private enqueueMissingDependencyRequests(
		rootRequest: AssetLookupRequestDto,
		asset: PreparedAssetRecord,
		preparedByAssetId: Record<string, PreparedAssetRecord>,
		scheduledAssetIds: Set<string>,
		nextRequests: AssetLookupRequestDto[],
	): void {
		for (const dependency of getPreparedAssetDependencies(asset)) {
			if (
				scheduledAssetIds.has(dependency.assetId) ||
				preparedByAssetId[dependency.assetId]
			) {
				continue;
			}

			scheduledAssetIds.add(dependency.assetId);
			nextRequests.push({
				requestId: `${rootRequest.requestId}-dependency-${dependency.assetId}`,
				assetId: dependency.assetId,
				priority: rootRequest.priority,
			});
		}
	}

	dispose(): void {
		this.worker.terminate();
		const error = new Error(
			"Asset channel was disposed before preparation completed.",
		);
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

	const landblockId = deriveTerrainFocusLandblockId(
		runtimeBatch,
		browserDestination,
	);
	const assetId = formatTerrainAssetId(landblockId);
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
	options: OutdoorCoverageOptions = DEFAULT_OUTDOOR_COVERAGE_OPTIONS,
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

	return [
		...createTerrainCoverageRequests(
			runtimeBatch,
			browserDestination,
			priority,
			preparedByAssetId,
			pendingAssetIds,
			options,
		),
		...createLandblockStaticsCoverageRequests(
			runtimeBatch,
			browserDestination,
			priority,
			preparedByAssetId,
			pendingAssetIds,
			options,
		),
		...createStaticRenderableAssetRequests(
			runtimeBatch,
			browserDestination,
			priority,
			preparedByAssetId,
			pendingAssetIds,
			options,
		),
	];
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
	options: OutdoorCoverageOptions = DEFAULT_OUTDOOR_COVERAGE_OPTIONS,
): AssetLookupRequestDto[] {
	if (!runtimeBatch || runtimeBatch.residency.indoors) {
		return [];
	}

	const focusLandblockId = deriveTerrainFocusLandblockId(
		runtimeBatch,
		browserDestination,
	);
	const requestScope = browserDestination ? "destination" : "runtime";
	const coverageAssetIds = buildOutdoorCoverageAssetIds(
		focusLandblockId,
		priority,
		options.landblockRadius,
	);
	const pendingAssetIdSet = new Set(pendingAssetIds);

	return coverageAssetIds
		.filter(
			(assetId) =>
				!preparedByAssetId[assetId] && !pendingAssetIdSet.has(assetId),
		)
		.map((assetId) => ({
			requestId: `${priority}-${runtimeBatch.tick}-${requestScope}-${assetId}`,
			assetId,
			priority,
		}));
}

export function createLandblockStaticsCoverageRequests(
	runtimeBatch: RuntimeBatchDto | null,
	browserDestination: BrowserLocationSelection | null,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[] = [],
	options: OutdoorCoverageOptions = DEFAULT_OUTDOOR_COVERAGE_OPTIONS,
): AssetLookupRequestDto[] {
	if (!runtimeBatch || runtimeBatch.residency.indoors) {
		return [];
	}

	const focusLandblockId = deriveTerrainFocusLandblockId(
		runtimeBatch,
		browserDestination,
	);
	const requestScope = browserDestination ? "destination" : "runtime";
	const coverageAssetIds = buildPrioritizedOutdoorCoverageLandblockIds(
		focusLandblockId,
		priority,
		options.landblockRadius,
	).map(formatLandblockStaticsAssetId);
	const pendingAssetIdSet = new Set(pendingAssetIds);

	return coverageAssetIds
		.filter(
			(assetId) =>
				!preparedByAssetId[assetId] && !pendingAssetIdSet.has(assetId),
		)
		.map((assetId) => ({
			requestId: `${priority}-${runtimeBatch.tick}-${requestScope}-${assetId}`,
			assetId,
			priority,
		}));
}

export function createStaticRenderableAssetRequests(
	runtimeBatch: RuntimeBatchDto | null,
	browserDestination: BrowserLocationSelection | null,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[] = [],
	options: OutdoorCoverageOptions = DEFAULT_OUTDOOR_COVERAGE_OPTIONS,
): AssetLookupRequestDto[] {
	if (!runtimeBatch || runtimeBatch.residency.indoors) {
		return [];
	}

	const activeLandblockIds = new Set(
		buildOutdoorCoverageLandblockIds(
			deriveTerrainFocusLandblockId(runtimeBatch, browserDestination),
			options.landblockRadius,
		),
	);
	const pendingAssetIdSet = new Set(pendingAssetIds);
	const sourceAssetIds = Object.values(preparedByAssetId).flatMap((asset) => {
		if (
			asset.payload.kind !== "landblock-statics" ||
			!activeLandblockIds.has(asset.payload.landblockId)
		) {
			return [];
		}

		return [
			...asset.payload.sceneryInstances.map(
				(instance) => instance.sourceAssetId,
			),
			...asset.payload.buildingInstances.map(
				(instance) => instance.sourceAssetId,
			),
		];
	});

	return [...new Set(sourceAssetIds)]
		.sort()
		.filter(
			(assetId) =>
				isStaticRenderableAssetId(assetId) &&
				!preparedByAssetId[assetId] &&
				!pendingAssetIdSet.has(assetId),
		)
		.map((assetId) => ({
			requestId: `${priority}-${runtimeBatch.tick}-static-renderable-${assetId}`,
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
		: normalizeOutdoorLandblockId(runtimeBatch.residency.focusLandblockId);
}

function buildOutdoorCoverageAssetIds(
	focusLandblockId: number,
	priority: AssetPriority,
	landblockRadius: number,
): string[] {
	return buildPrioritizedOutdoorCoverageLandblockIds(
		focusLandblockId,
		priority,
		landblockRadius,
	).map(formatTerrainAssetId);
}

function buildPrioritizedOutdoorCoverageLandblockIds(
	focusLandblockId: number,
	priority: AssetPriority,
	landblockRadius: number,
): number[] {
	if (priority === "bootstrap") {
		return [focusLandblockId];
	}

	return buildOutdoorCoverageLandblockIds(focusLandblockId, landblockRadius);
}

function isStaticRenderableAssetId(assetId: string): boolean {
	return (
		/^gfx-obj\/[0-9a-fA-F]{8}$/.test(assetId) ||
		/^setup-model\/[0-9a-fA-F]{8}$/.test(assetId)
	);
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
		cellStructureId === null
			? null
			: formatCellStructureAssetId(cellStructureId),
	].filter((assetId): assetId is string => assetId !== null);
	const pendingAssetIdSet = new Set(pendingAssetIds);

	return [...new Set(assetIds)]
		.filter(
			(assetId) =>
				!preparedByAssetId[assetId] && !pendingAssetIdSet.has(assetId),
		)
		.map((assetId) => ({
			requestId: `${priority}-${runtimeBatch.tick}-runtime-${assetId}`,
			assetId,
			priority,
		}));
}

function formatIndoorEnvCellAssetId(envCellId: number): string {
	return `indoor-env-cell/${formatHex32(envCellId)}`;
}

function formatEnvironmentAssetId(environmentId: number): string {
	return `environment/${formatHex32(environmentId)}`;
}

function formatCellStructureAssetId(cellStructureId: number): string {
	return `cell-structure/${cellStructureId.toString(16).padStart(4, "0")}`;
}

function createAssetWorker(): AssetWorkerLike {
	return new Worker(new URL("../../workers/asset-worker.ts", import.meta.url), {
		type: "module",
	}) as unknown as AssetWorkerLike;
}
