import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
	AssetPriority,
	RuntimeBatchDto,
} from "../host/contracts";
import {
	browserDestinationToIndoorEnvCellId,
	browserLocationToLandblockId,
	isIndoorBrowserDestination,
	type BrowserLocationSelection,
} from "../../app/browser-mode";
import {
	buildOutdoorCoverageLandblockIds,
	formatHex32,
	formatOutdoorStaticSceneAssetId,
	formatTerrainAssetId,
	normalizeOutdoorLandblockId,
} from "../landblocks";
import { lookupAsset } from "../host/tauri";
import {
	AssetGraphScheduler,
	type AssetGraphPreparationResult,
} from "./asset-graph-scheduler";
import { getAssetResponseDependencies } from "./dependencies";
import type { PreparedAssetRecord } from "./types";
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

interface AssetLoadEntry {
	responseRequestId: string | null;
	responsePromise: Promise<LookedUpAssetResponse> | null;
	responseReject: ((error: Error) => void) | null;
	preparedRequestId: string | null;
	preparedPromise: Promise<PreparedAssetRecord> | null;
}

export interface LookedUpAssetResponse {
	request: AssetLookupRequestDto;
	response: AssetLookupResponseDto;
	dependencyAssetIds: string[];
}

export interface AssetPreparationGateway {
	lookupAssetResponse(
		request: AssetLookupRequestDto,
	): Promise<LookedUpAssetResponse>;
	prepareLookedUpAsset(
		lookedUp: LookedUpAssetResponse,
		request: AssetLookupRequestDto,
	): Promise<PreparedAssetRecord>;
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

	private readonly loadEntriesByAssetId = new Map<string, AssetLoadEntry>();

	private disposed = false;

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
		const lookedUp = await this.lookupAssetResponse(request);
		return this.prepareLookedUpAsset(lookedUp, request);
	}

	async lookupAssetResponse(
		request: AssetLookupRequestDto,
	): Promise<LookedUpAssetResponse> {
		this.throwIfDisposed();

		const entry = this.getOrCreateLoadEntry(request.assetId);
		if (entry.responsePromise) {
			return rebindLookedUpAssetResponse(await entry.responsePromise, request);
		}

		entry.responseRequestId = request.requestId;
		entry.responsePromise = new Promise<LookedUpAssetResponse>(
			(resolve, reject) => {
				entry.responseReject = reject;
				void (async () => {
					try {
						const response = await this.lookupAssetFn(request);
						this.throwIfDisposed();
						const reboundResponse = rebindAssetLookupResponse(
							response,
							request,
						);
						resolve({
							request,
							response: reboundResponse,
							dependencyAssetIds: getAssetResponseDependencies(
								reboundResponse,
							).map((dependency) => dependency.assetId),
						});
					} catch (error) {
						reject(toError(error));
					}
				})();
			},
		);

		try {
			return await entry.responsePromise;
		} catch (error) {
			this.clearResponseLoadEntry(request.assetId, request.requestId);
			throw error;
		} finally {
			queueMicrotask(() => {
				const active = this.loadEntriesByAssetId.get(request.assetId);
				if (
					active?.responseRequestId === request.requestId &&
					!active.preparedPromise
				) {
					this.clearResponseLoadEntry(request.assetId, request.requestId);
				}
			});
		}
	}

	async prepareLookedUpAsset(
		lookedUp: LookedUpAssetResponse,
		request: AssetLookupRequestDto,
	): Promise<PreparedAssetRecord> {
		this.throwIfDisposed();

		const entry = this.getOrCreateLoadEntry(request.assetId);
		if (entry.preparedPromise) {
			return rebindPreparedAssetRequest(await entry.preparedPromise, request);
		}

		entry.preparedRequestId = request.requestId;
		entry.preparedPromise = new Promise<PreparedAssetRecord>(
			(resolve, reject) => {
				this.pendingRequests.set(request.requestId, { resolve, reject });
				try {
					this.worker.postMessage({
						type: "prepare-asset",
						request,
						response: rebindAssetLookupResponse(lookedUp.response, request),
					});
				} catch (error) {
					this.pendingRequests.delete(request.requestId);
					reject(toError(error));
				}
			},
		);

		try {
			return await entry.preparedPromise;
		} finally {
			this.clearPreparedLoadEntry(request.assetId, request.requestId);
		}
	}

	async prepareAssetGraph(
		rootRequest: AssetLookupRequestDto,
		preparedByAssetId: Record<string, PreparedAssetRecord> = {},
	): Promise<AssetGraphPreparationResult> {
		return new AssetGraphScheduler(this).prepareAssetGraph(
			rootRequest,
			preparedByAssetId,
		);
	}

	dispose(): void {
		this.disposed = true;
		this.worker.terminate();
		const error = new Error(
			"Asset channel was disposed before preparation completed.",
		);
		for (const entry of this.loadEntriesByAssetId.values()) {
			entry.responseReject?.(error);
		}
		this.loadEntriesByAssetId.clear();
		for (const pending of this.pendingRequests.values()) {
			pending.reject(error);
		}
		this.pendingRequests.clear();
	}

	private getOrCreateLoadEntry(assetId: string): AssetLoadEntry {
		const existing = this.loadEntriesByAssetId.get(assetId);
		if (existing) {
			return existing;
		}

		const entry: AssetLoadEntry = {
			responseRequestId: null,
			responsePromise: null,
			responseReject: null,
			preparedRequestId: null,
			preparedPromise: null,
		};
		this.loadEntriesByAssetId.set(assetId, entry);
		return entry;
	}

	private clearResponseLoadEntry(assetId: string, requestId: string): void {
		const entry = this.loadEntriesByAssetId.get(assetId);
		if (!entry || entry.responseRequestId !== requestId) {
			return;
		}

		entry.responseRequestId = null;
		entry.responsePromise = null;
		entry.responseReject = null;
		this.deleteLoadEntryIfIdle(assetId, entry);
	}

	private clearPreparedLoadEntry(assetId: string, requestId: string): void {
		const entry = this.loadEntriesByAssetId.get(assetId);
		if (!entry || entry.preparedRequestId !== requestId) {
			return;
		}

		entry.preparedRequestId = null;
		entry.preparedPromise = null;
		entry.responseRequestId = null;
		entry.responsePromise = null;
		entry.responseReject = null;
		this.deleteLoadEntryIfIdle(assetId, entry);
	}

	private deleteLoadEntryIfIdle(assetId: string, entry: AssetLoadEntry): void {
		if (!entry.responsePromise && !entry.preparedPromise) {
			this.loadEntriesByAssetId.delete(assetId);
		}
	}

	private throwIfDisposed(): void {
		if (this.disposed) {
			throw new Error("Asset channel was disposed before work completed.");
		}
	}
}

function rebindPreparedAssetRequest(
	asset: PreparedAssetRecord,
	request: AssetLookupRequestDto,
): PreparedAssetRecord {
	return {
		...asset,
		request,
		response: {
			...asset.response,
			requestId: request.requestId,
			assetId: request.assetId,
		},
	};
}

function rebindLookedUpAssetResponse(
	lookedUp: LookedUpAssetResponse,
	request: AssetLookupRequestDto,
): LookedUpAssetResponse {
	return {
		...lookedUp,
		request,
		response: rebindAssetLookupResponse(lookedUp.response, request),
	};
}

function rebindAssetLookupResponse(
	response: AssetLookupResponseDto,
	request: AssetLookupRequestDto,
): AssetLookupResponseDto {
	return {
		...response,
		requestId: request.requestId,
		assetId: request.assetId,
	};
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

export function createFocusedAssetRequest(
	runtimeBatch: RuntimeBatchDto | null,
	browserDestination: BrowserLocationSelection | null,
	priority: AssetPriority,
): AssetLookupRequestDto | null {
	if (
		!runtimeBatch ||
		runtimeBatch.residency.indoors ||
		isIndoorBrowserDestination(browserDestination)
	) {
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

	if (isIndoorBrowserDestination(browserDestination)) {
		return [
			...createIndoorCoverageRequests(
				runtimeBatch,
				priority,
				preparedByAssetId,
				pendingAssetIds,
				browserDestination.envCellId,
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

	if (runtimeBatch.residency.indoors) {
		return [
			...createIndoorCoverageRequests(
				runtimeBatch,
				priority,
				preparedByAssetId,
				pendingAssetIds,
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

	return [
		...createTerrainCoverageRequests(
			runtimeBatch,
			browserDestination,
			priority,
			preparedByAssetId,
			pendingAssetIds,
			options,
		),
		...createOutdoorStaticSceneCoverageRequests(
			runtimeBatch,
			browserDestination,
			priority,
			preparedByAssetId,
			pendingAssetIds,
			options,
		),
		...createOutdoorLinkedInteriorCoverageRequests(
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
	if (
		!runtimeBatch ||
		runtimeBatch.residency.indoors ||
		isIndoorBrowserDestination(browserDestination)
	) {
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

function createOutdoorStaticSceneCoverageRequests(
	runtimeBatch: RuntimeBatchDto | null,
	browserDestination: BrowserLocationSelection | null,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[] = [],
	options: OutdoorCoverageOptions = DEFAULT_OUTDOOR_COVERAGE_OPTIONS,
): AssetLookupRequestDto[] {
	if (
		!runtimeBatch ||
		runtimeBatch.residency.indoors ||
		isIndoorBrowserDestination(browserDestination)
	) {
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
	).map(formatOutdoorStaticSceneAssetId);
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
	if (!runtimeBatch) {
		return [];
	}

	if (
		runtimeBatch.residency.indoors ||
		isIndoorBrowserDestination(browserDestination)
	) {
		return createIndoorStaticRenderableAssetRequests(
			runtimeBatch,
			browserDestination,
			priority,
			preparedByAssetId,
			pendingAssetIds,
		);
	}

	const activeLandblockIds = new Set(
		buildOutdoorCoverageLandblockIds(
			deriveTerrainFocusLandblockId(runtimeBatch, browserDestination),
			options.landblockRadius,
		),
	);
	const linkedIndoorEnvCellIds = deriveOutdoorLinkedInteriorEnvCellIds(
		preparedByAssetId,
		activeLandblockIds,
	);
	const pendingAssetIdSet = new Set(pendingAssetIds);
	const sourceAssetIds = Object.values(preparedByAssetId).flatMap((asset) => {
		if (
			asset.payload.kind !== "outdoor-static-scene" ||
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
			...asset.payload.generatedSceneryInstances.map(
				(instance) => instance.sourceAssetId,
			),
		];
	});
	const linkedIndoorSourceAssetIds = [...linkedIndoorEnvCellIds].flatMap(
		(envCellId) => {
			const asset =
				preparedByAssetId[`indoor-env-cell/${formatHex32(envCellId)}`];
			return asset?.payload.kind === "indoor-env-cell"
				? asset.payload.staticObjects.map(
						(staticObject) => staticObject.sourceAssetId,
					)
				: [];
		},
	);

	return [...new Set([...sourceAssetIds, ...linkedIndoorSourceAssetIds])]
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

function createOutdoorLinkedInteriorCoverageRequests(
	runtimeBatch: RuntimeBatchDto,
	browserDestination: BrowserLocationSelection | null,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
	options: OutdoorCoverageOptions,
): AssetLookupRequestDto[] {
	const activeLandblockIds = new Set(
		buildOutdoorCoverageLandblockIds(
			deriveTerrainFocusLandblockId(runtimeBatch, browserDestination),
			options.landblockRadius,
		),
	);
	const linkedEnvCellIds = deriveOutdoorLinkedInteriorEnvCellIds(
		preparedByAssetId,
		activeLandblockIds,
	);
	const envCellAssetIds = [...linkedEnvCellIds].map(formatIndoorEnvCellAssetId);
	const environmentAssetIds = envCellAssetIds.flatMap((assetId) => {
		const asset = preparedByAssetId[assetId];
		return asset?.payload.kind === "indoor-env-cell" &&
			asset.payload.environmentId !== null
			? [formatEnvironmentAssetId(asset.payload.environmentId)]
			: [];
	});
	const pendingAssetIdSet = new Set(pendingAssetIds);

	return [...new Set([...envCellAssetIds, ...environmentAssetIds])]
		.sort()
		.filter(
			(assetId) =>
				!preparedByAssetId[assetId] && !pendingAssetIdSet.has(assetId),
		)
		.map((assetId) => ({
			requestId: `${priority}-${runtimeBatch.tick}-outdoor-linked-interior-${assetId}`,
			assetId,
			priority,
		}));
}

export function deriveOutdoorLinkedInteriorEnvCellIds(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	activeLandblockIds: Set<number>,
): Set<number> {
	const linkedEnvCellIds = new Set<number>();
	for (const asset of Object.values(preparedByAssetId)) {
		if (
			asset.payload.kind !== "outdoor-static-scene" ||
			!activeLandblockIds.has(asset.payload.landblockId)
		) {
			continue;
		}

		for (const building of asset.payload.buildingInstances) {
			for (const portal of building.portals) {
				for (const envCellId of portal.linkedEnvCellIds) {
					linkedEnvCellIds.add(envCellId);
				}
			}
		}
	}

	return linkedEnvCellIds;
}

function createIndoorStaticRenderableAssetRequests(
	runtimeBatch: RuntimeBatchDto,
	browserDestination: BrowserLocationSelection | null,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
): AssetLookupRequestDto[] {
	const activeEnvCellIds = deriveActiveIndoorEnvCellIds(
		runtimeBatch,
		browserDestination,
		preparedByAssetId,
	);
	const pendingAssetIdSet = new Set(pendingAssetIds);
	const sourceAssetIds = [...activeEnvCellIds].flatMap((envCellId) => {
		const asset =
			preparedByAssetId[`indoor-env-cell/${formatHex32(envCellId)}`];
		return asset?.payload.kind === "indoor-env-cell"
			? asset.payload.staticObjects.map(
					(staticObject) => staticObject.sourceAssetId,
				)
			: [];
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
			requestId: `${priority}-${runtimeBatch.tick}-indoor-static-renderable-${assetId}`,
			assetId,
			priority,
		}));
}

function deriveActiveIndoorEnvCellIds(
	runtimeBatch: RuntimeBatchDto,
	browserDestination: BrowserLocationSelection | null,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
): Set<number> {
	const browserFocusEnvCellId =
		browserDestinationToIndoorEnvCellId(browserDestination);
	if (browserFocusEnvCellId !== null) {
		const focusAsset =
			preparedByAssetId[
				`indoor-env-cell/${formatHex32(browserFocusEnvCellId)}`
			];
		return new Set([
			browserFocusEnvCellId,
			...(focusAsset?.payload.kind === "indoor-env-cell"
				? focusAsset.payload.visibleCellIds
				: []),
		]);
	}

	const focusEnvCellId = runtimeBatch.residency.focusEnvCellId;
	if (focusEnvCellId === null) {
		return new Set();
	}

	return new Set([focusEnvCellId, ...runtimeBatch.residency.visibleCellIds]);
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
	overrideFocusEnvCellId: number | null = null,
): AssetLookupRequestDto[] {
	const runtimeResidency = runtimeBatch.residency;
	const focusEnvCellId =
		overrideFocusEnvCellId ?? runtimeResidency.focusEnvCellId;
	if (focusEnvCellId === null) {
		return [];
	}

	const focusEnvCellAssetId = formatIndoorEnvCellAssetId(focusEnvCellId);
	const preparedFocusEnvCell = preparedByAssetId[focusEnvCellAssetId];
	const visibleCellIds =
		overrideFocusEnvCellId !== null &&
		preparedFocusEnvCell?.payload.kind === "indoor-env-cell"
			? preparedFocusEnvCell.payload.visibleCellIds
			: runtimeResidency.visibleCellIds;
	const environmentId =
		overrideFocusEnvCellId !== null ? null : runtimeResidency.environmentId;
	const envCellAssetIds = [
		focusEnvCellAssetId,
		...visibleCellIds.map((cellId) => formatIndoorEnvCellAssetId(cellId)),
	];
	const preparedEnvironmentAssetIds = envCellAssetIds.flatMap((assetId) => {
		const asset = preparedByAssetId[assetId];
		return asset?.payload.kind === "indoor-env-cell" &&
			asset.payload.environmentId !== null
			? [formatEnvironmentAssetId(asset.payload.environmentId)]
			: [];
	});
	const assetIds = [
		...envCellAssetIds,
		environmentId === null ? null : formatEnvironmentAssetId(environmentId),
		...preparedEnvironmentAssetIds,
	].filter((assetId): assetId is string => assetId !== null);
	const pendingAssetIdSet = new Set(pendingAssetIds);

	return [...new Set(assetIds)]
		.filter(
			(assetId) =>
				!preparedByAssetId[assetId] && !pendingAssetIdSet.has(assetId),
		)
		.map((assetId) => ({
			requestId: `${priority}-${runtimeBatch.tick}-${overrideFocusEnvCellId === null ? "runtime" : "destination"}-${assetId}`,
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

function createAssetWorker(): AssetWorkerLike {
	return new Worker(new URL("../../workers/asset-worker.ts", import.meta.url), {
		type: "module",
	}) as unknown as AssetWorkerLike;
}
