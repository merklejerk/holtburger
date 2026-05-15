import type {
	AssetLookupRequestDto,
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
	formatOutdoorStaticSceneAssetId,
	formatTerrainAssetId,
	normalizeOutdoorLandblockId,
} from "../landblocks";
import type { PreparedAssetRecord } from "./types";
import {
	createDefaultStructuredInteriorCoverageOptions,
	deriveStructuredInteriorCoverage,
	formatEnvironmentAssetId,
	formatIndoorEnvCellAssetId,
	isPreparedIndoorEnvCellAsset,
	type StructuredInteriorCoverageOptions,
	type StructuredInteriorMembershipPolicy,
} from "./structured-interior-coverage";
import {
	createDefaultOutdoorSceneInterest,
	deriveOutdoorSceneInterest,
	unionOutdoorSceneLandblockIds,
	type NormalizedOutdoorSceneInterest,
	type OutdoorSceneInterest,
} from "../world-display/outdoor-scene-interest";

export interface OutdoorSceneRequestOptions {
	terrainRadius: number;
	buildingRadius: number;
	detailRadius: number;
	structuredInterior?: StructuredInteriorCoverageOptions;
}

const DEFAULT_OUTDOOR_SCENE_REQUEST_OPTIONS: OutdoorSceneRequestOptions = {
	terrainRadius: 1,
	buildingRadius: 1,
	detailRadius: 1,
	structuredInterior: createDefaultStructuredInteriorCoverageOptions(),
};

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
	options: OutdoorSceneRequestOptions = DEFAULT_OUTDOOR_SCENE_REQUEST_OPTIONS,
): AssetLookupRequestDto[] {
	if (!runtimeBatch) {
		return [];
	}
	const structuredInteriorCoverageOptions =
		resolveStructuredInteriorCoverageOptions(options);

	if (isIndoorBrowserDestination(browserDestination)) {
		return [
			...createStructuredInteriorCoverageRequests(
				runtimeBatch,
				priority,
				preparedByAssetId,
				pendingAssetIds,
				structuredInteriorCoverageOptions,
				{
					kind: "visible-cell-closure",
					seedEnvCellIds: [browserDestination.envCellId],
				},
				"destination",
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
			...createStructuredInteriorCoverageRequests(
				runtimeBatch,
				priority,
				preparedByAssetId,
				pendingAssetIds,
				structuredInteriorCoverageOptions,
				createRuntimeStructuredInteriorMembershipPolicy(runtimeBatch),
				"runtime",
				runtimeBatch.residency.environmentId === null
					? []
					: [runtimeBatch.residency.environmentId],
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

	const interest = deriveOutdoorInterestForRuntime(
		runtimeBatch,
		browserDestination,
		options,
	);

	return [
		...createTerrainCoverageRequestsForInterest(
			runtimeBatch,
			browserDestination,
			priority,
			preparedByAssetId,
			pendingAssetIds,
			interest,
		),
		...createOutdoorStaticSceneCoverageRequestsForInterest(
			runtimeBatch,
			browserDestination,
			priority,
			preparedByAssetId,
			pendingAssetIds,
			interest,
		),
		...createOutdoorLinkedInteriorCoverageRequests(
			runtimeBatch,
			browserDestination,
			priority,
			preparedByAssetId,
			pendingAssetIds,
			options,
			interest,
		),
		...createStaticRenderableAssetRequests(
			runtimeBatch,
			browserDestination,
			priority,
			preparedByAssetId,
			pendingAssetIds,
			options,
			interest,
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
	options: OutdoorSceneRequestOptions = DEFAULT_OUTDOOR_SCENE_REQUEST_OPTIONS,
): AssetLookupRequestDto[] {
	if (
		!runtimeBatch ||
		runtimeBatch.residency.indoors ||
		isIndoorBrowserDestination(browserDestination)
	) {
		return [];
	}

	return createTerrainCoverageRequestsForInterest(
		runtimeBatch,
		browserDestination,
		priority,
		preparedByAssetId,
		pendingAssetIds,
		deriveOutdoorInterestForRuntime(runtimeBatch, browserDestination, options),
	);
}

function createTerrainCoverageRequestsForInterest(
	runtimeBatch: RuntimeBatchDto,
	browserDestination: BrowserLocationSelection | null,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
	interest: NormalizedOutdoorSceneInterest,
): AssetLookupRequestDto[] {
	const requestScope = browserDestination ? "destination" : "runtime";
	const coverageAssetIds = prioritizeOutdoorLandblockIds(
		priority,
		interest.focusLandblockId,
		interest.terrainLandblockIds,
	).map(formatTerrainAssetId);
	return createUnpreparedRequests(
		coverageAssetIds,
		runtimeBatch,
		priority,
		requestScope,
		preparedByAssetId,
		pendingAssetIds,
	);
}

function createOutdoorStaticSceneCoverageRequestsForInterest(
	runtimeBatch: RuntimeBatchDto,
	browserDestination: BrowserLocationSelection | null,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
	interest: NormalizedOutdoorSceneInterest,
): AssetLookupRequestDto[] {
	const requestScope = browserDestination ? "destination" : "runtime";
	const staticFactLandblockIds = unionOutdoorSceneLandblockIds(
		interest.buildingLandblockIds,
		interest.detailLandblockIds,
	);
	const coverageAssetIds = prioritizeOutdoorLandblockIds(
		priority,
		interest.focusLandblockId,
		staticFactLandblockIds,
	).map(formatOutdoorStaticSceneAssetId);
	return createUnpreparedRequests(
		coverageAssetIds,
		runtimeBatch,
		priority,
		requestScope,
		preparedByAssetId,
		pendingAssetIds,
	);
}

export function createStaticRenderableAssetRequests(
	runtimeBatch: RuntimeBatchDto | null,
	browserDestination: BrowserLocationSelection | null,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[] = [],
	options: OutdoorSceneRequestOptions = DEFAULT_OUTDOOR_SCENE_REQUEST_OPTIONS,
	interest: NormalizedOutdoorSceneInterest | null = null,
): AssetLookupRequestDto[] {
	if (!runtimeBatch) {
		return [];
	}
	const structuredInteriorCoverageOptions =
		resolveStructuredInteriorCoverageOptions(options);

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
			structuredInteriorCoverageOptions,
		);
	}

	const outdoorInterest =
		interest ??
		deriveOutdoorInterestForRuntime(runtimeBatch, browserDestination, options);
	const buildingLandblockIds = new Set(outdoorInterest.buildingLandblockIds);
	const detailLandblockIds = new Set(outdoorInterest.detailLandblockIds);
	const linkedIndoorEnvCellIds = deriveOutdoorLinkedInteriorEnvCellIds(
		preparedByAssetId,
		detailLandblockIds,
	);
	const linkedInteriorCoverage = deriveStructuredInteriorCoverage(
		{
			kind: "visible-cell-closure",
			seedEnvCellIds: [...linkedIndoorEnvCellIds],
		},
		preparedByAssetId,
		structuredInteriorCoverageOptions,
	);
	const pendingAssetIdSet = new Set(pendingAssetIds);
	const sourceAssetIds = Object.values(preparedByAssetId).flatMap((asset) => {
		if (asset.payload.kind !== "outdoor-static-scene") {
			return [];
		}

		const landblockId = normalizeOutdoorLandblockId(asset.payload.landblockId);
		return [
			...(detailLandblockIds.has(landblockId)
				? asset.payload.sceneryInstances.map(
						(instance) => instance.sourceAssetId,
					)
				: []),
			...(buildingLandblockIds.has(landblockId)
				? asset.payload.buildingInstances.map(
						(instance) => instance.sourceAssetId,
					)
				: []),
			...(detailLandblockIds.has(landblockId)
				? asset.payload.generatedSceneryInstances.map(
						(instance) => instance.sourceAssetId,
					)
				: []),
		];
	});
	const linkedIndoorSourceAssetIds = linkedInteriorCoverage.envCellIds.flatMap(
		(envCellId) => {
			const asset = preparedByAssetId[formatIndoorEnvCellAssetId(envCellId)];
			return isPreparedIndoorEnvCellAsset(asset)
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
	options: OutdoorSceneRequestOptions,
	interest: NormalizedOutdoorSceneInterest,
): AssetLookupRequestDto[] {
	const linkedEnvCellIds = deriveOutdoorLinkedInteriorEnvCellIds(
		preparedByAssetId,
		new Set(interest.detailLandblockIds),
	);
	return createStructuredInteriorCoverageRequests(
		runtimeBatch,
		priority,
		preparedByAssetId,
		pendingAssetIds,
		resolveStructuredInteriorCoverageOptions(options),
		{
			kind: "visible-cell-closure",
			seedEnvCellIds: [...linkedEnvCellIds],
		},
		"outdoor-linked-interior",
	);
}

export function deriveOutdoorLinkedInteriorEnvCellIds(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	activeLandblockIds: ReadonlySet<number>,
): Set<number> {
	const linkedEnvCellIds = new Set<number>();
	for (const asset of Object.values(preparedByAssetId)) {
		if (
			asset.payload.kind !== "outdoor-static-scene" ||
			!activeLandblockIds.has(
				normalizeOutdoorLandblockId(asset.payload.landblockId),
			)
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

export function deriveTerrainFocusLandblockId(
	runtimeBatch: RuntimeBatchDto,
	browserDestination: BrowserLocationSelection | null,
): number {
	return browserDestination
		? browserLocationToLandblockId(browserDestination)
		: normalizeOutdoorLandblockId(runtimeBatch.residency.focusLandblockId);
}

function createIndoorStaticRenderableAssetRequests(
	runtimeBatch: RuntimeBatchDto,
	browserDestination: BrowserLocationSelection | null,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
	coverageOptions: StructuredInteriorCoverageOptions,
): AssetLookupRequestDto[] {
	const browserFocusEnvCellId =
		browserDestinationToIndoorEnvCellId(browserDestination);
	const activeEnvCellIds = deriveStructuredInteriorCoverage(
		browserFocusEnvCellId === null
			? createRuntimeStructuredInteriorMembershipPolicy(runtimeBatch)
			: {
					kind: "visible-cell-closure",
					seedEnvCellIds: [browserFocusEnvCellId],
				},
		preparedByAssetId,
		coverageOptions,
	).envCellIds;
	const pendingAssetIdSet = new Set(pendingAssetIds);
	const sourceAssetIds = activeEnvCellIds.flatMap((envCellId) => {
		const asset = preparedByAssetId[formatIndoorEnvCellAssetId(envCellId)];
		return isPreparedIndoorEnvCellAsset(asset)
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

function createRuntimeStructuredInteriorMembershipPolicy(
	runtimeBatch: RuntimeBatchDto,
): StructuredInteriorMembershipPolicy {
	const focusEnvCellId = runtimeBatch.residency.focusEnvCellId;
	return {
		kind: "direct",
		envCellIds:
			focusEnvCellId === null
				? []
				: [focusEnvCellId, ...runtimeBatch.residency.visibleCellIds],
	};
}

function createStructuredInteriorCoverageRequests(
	runtimeBatch: RuntimeBatchDto,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
	coverageOptions: StructuredInteriorCoverageOptions,
	membershipPolicy: StructuredInteriorMembershipPolicy,
	requestScope: string,
	extraEnvironmentIds: number[] = [],
): AssetLookupRequestDto[] {
	const coverage = deriveStructuredInteriorCoverage(
		membershipPolicy,
		preparedByAssetId,
		coverageOptions,
	);
	if (coverage.envCellIds.length === 0) {
		return [];
	}

	const envCellAssetIds = coverage.envCellIds.map(formatIndoorEnvCellAssetId);
	const preparedEnvironmentAssetIds = envCellAssetIds.flatMap((assetId) => {
		const asset = preparedByAssetId[assetId];
		return isPreparedIndoorEnvCellAsset(asset) &&
			asset.payload.environmentId !== null
			? [formatEnvironmentAssetId(asset.payload.environmentId)]
			: [];
	});
	const extraEnvironmentAssetIds = extraEnvironmentIds.map(
		formatEnvironmentAssetId,
	);

	return createUnpreparedRequests(
		[
			...new Set([
				...envCellAssetIds,
				...preparedEnvironmentAssetIds,
				...extraEnvironmentAssetIds,
			]),
		],
		runtimeBatch,
		priority,
		requestScope,
		preparedByAssetId,
		pendingAssetIds,
	);
}

function deriveOutdoorInterestForRuntime(
	runtimeBatch: RuntimeBatchDto,
	browserDestination: BrowserLocationSelection | null,
	options: OutdoorSceneRequestOptions,
): NormalizedOutdoorSceneInterest {
	const focusLandblockId = deriveTerrainFocusLandblockId(
		runtimeBatch,
		browserDestination,
	);
	const requestedInterest: OutdoorSceneInterest = {
		focusLandblockId,
		terrainRadius: options.terrainRadius,
		buildingRadius: options.buildingRadius,
		detailRadius: options.detailRadius,
	};

	return browserDestination || !runtimeBatch.residency.indoors
		? deriveOutdoorSceneInterest(requestedInterest)
		: createDefaultOutdoorSceneInterest(focusLandblockId);
}

function prioritizeOutdoorLandblockIds(
	priority: AssetPriority,
	focusLandblockId: number,
	landblockIds: readonly number[],
): number[] {
	return priority === "bootstrap" ? [focusLandblockId] : [...landblockIds];
}

function createUnpreparedRequests(
	assetIds: string[],
	runtimeBatch: RuntimeBatchDto,
	priority: AssetPriority,
	requestScope: string,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
): AssetLookupRequestDto[] {
	const pendingAssetIdSet = new Set(pendingAssetIds);
	return assetIds
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

function isStaticRenderableAssetId(assetId: string): boolean {
	return (
		/^gfx-obj\/[0-9a-fA-F]{8}$/.test(assetId) ||
		/^setup-model\/[0-9a-fA-F]{8}$/.test(assetId)
	);
}

function resolveStructuredInteriorCoverageOptions(
	options: OutdoorSceneRequestOptions,
): StructuredInteriorCoverageOptions {
	return (
		options.structuredInterior ??
		createDefaultStructuredInteriorCoverageOptions()
	);
}
