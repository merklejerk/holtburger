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
	formatLandblockPackAssetId,
	normalizeOutdoorLandblockId,
} from "../landblocks";
import type { PreparedAssetRecord, PreparedLandblockStaticMesh } from "./types";
import {
	deriveBrowserFocusedStructuredInteriorMembershipPolicy,
	deriveStructuredInteriorCoverage,
	formatIndoorEnvCellAssetId,
	isPreparedIndoorEnvCellAsset,
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
	envCellRadius?: number;
}

const DEFAULT_OUTDOOR_SCENE_REQUEST_OPTIONS: OutdoorSceneRequestOptions = {
	terrainRadius: 1,
	buildingRadius: 1,
	detailRadius: 1,
	envCellRadius: 1,
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
	const assetId = formatLandblockPackAssetId(landblockId);
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

	if (isIndoorBrowserDestination(browserDestination)) {
		return [
			...createLandblockPackCoverageRequests(
				runtimeBatch,
				browserDestination,
				priority,
				preparedByAssetId,
				pendingAssetIds,
				[normalizeOutdoorLandblockId(browserDestination.envCellId)],
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
			...createLandblockPackCoverageRequests(
				runtimeBatch,
				browserDestination,
				priority,
				preparedByAssetId,
				pendingAssetIds,
				deriveRuntimeIndoorLandblockPackIds(runtimeBatch),
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
		...createLandblockPackCoverageRequestsForInterest(
			runtimeBatch,
			browserDestination,
			priority,
			preparedByAssetId,
			pendingAssetIds,
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

export function deriveSceneCoverageAssetIds(
	runtimeBatch: RuntimeBatchDto | null,
	browserDestination: BrowserLocationSelection | null,
	_preparedByAssetId: Record<string, PreparedAssetRecord>,
	options: OutdoorSceneRequestOptions = DEFAULT_OUTDOOR_SCENE_REQUEST_OPTIONS,
): string[] {
	if (!runtimeBatch) {
		return [];
	}

	if (isIndoorBrowserDestination(browserDestination)) {
		return [formatLandblockPackAssetId(browserDestination.envCellId)];
	}

	if (runtimeBatch.residency.indoors) {
		return deriveRuntimeIndoorLandblockPackIds(runtimeBatch)
			.map(formatLandblockPackAssetId)
			.sort();
	}

	const interest = deriveOutdoorInterestForRuntime(
		runtimeBatch,
		browserDestination,
		options,
	);
	return [
		...new Set([
			...deriveLandblockPackCoverageLandblockIds(interest).map(
				formatLandblockPackAssetId,
			),
		]),
	].sort();
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

	return createLandblockPackCoverageRequestsForInterest(
		runtimeBatch,
		browserDestination,
		priority,
		preparedByAssetId,
		pendingAssetIds,
		deriveOutdoorInterestForRuntime(runtimeBatch, browserDestination, options),
	);
}

function createLandblockPackCoverageRequestsForInterest(
	runtimeBatch: RuntimeBatchDto,
	browserDestination: BrowserLocationSelection | null,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
	interest: NormalizedOutdoorSceneInterest,
): AssetLookupRequestDto[] {
	return createLandblockPackCoverageRequests(
		runtimeBatch,
		browserDestination,
		priority,
		preparedByAssetId,
		pendingAssetIds,
		prioritizeOutdoorLandblockIds(
			priority,
			interest.focusLandblockId,
			deriveLandblockPackCoverageLandblockIds(interest),
		),
	);
}

function createLandblockPackCoverageRequests(
	runtimeBatch: RuntimeBatchDto,
	browserDestination: BrowserLocationSelection | null,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
	landblockIds: readonly number[],
): AssetLookupRequestDto[] {
	const requestScope = browserDestination ? "destination" : "runtime";
	return createUnpreparedRequests(
		[...new Set(landblockIds.map(formatLandblockPackAssetId))],
		runtimeBatch,
		priority,
		requestScope,
		preparedByAssetId,
		pendingAssetIds,
	);
}

function deriveLandblockPackCoverageLandblockIds(
	interest: NormalizedOutdoorSceneInterest,
): number[] {
	return unionOutdoorSceneLandblockIds(
		unionOutdoorSceneLandblockIds(
			interest.terrainLandblockIds,
			interest.buildingLandblockIds,
		),
		unionOutdoorSceneLandblockIds(
			interest.detailLandblockIds,
			interest.envCellLandblockIds,
		),
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

	const outdoorInterest =
		interest ??
		deriveOutdoorInterestForRuntime(runtimeBatch, browserDestination, options);
	const buildingLandblockIds = new Set(outdoorInterest.buildingLandblockIds);
	const detailLandblockIds = new Set(outdoorInterest.detailLandblockIds);
	const envCellLandblockIds = new Set(outdoorInterest.envCellLandblockIds);
	const linkedIndoorEnvCellIds = deriveOutdoorInteriorSeedEnvCellIds(
		preparedByAssetId,
		envCellLandblockIds,
	);
	const linkedInteriorCoverage = deriveStructuredInteriorCoverage(
		{
			kind: "landblock-closure",
			seedEnvCellIds: [...linkedIndoorEnvCellIds],
		},
		preparedByAssetId,
	);
	const pendingAssetIdSet = new Set(pendingAssetIds);
	const legacyOutdoorSourceAssetIds = Object.values(preparedByAssetId).flatMap(
		(asset) => {
			if (asset.payload.kind !== "outdoor-static-scene") {
				return [];
			}

			const landblockId = normalizeOutdoorLandblockId(
				asset.payload.landblockId,
			);
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
		},
	);
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
	const packGfxAssetIds = collectSelectedPackStaticGfxAssetIds(
		preparedByAssetId,
		{
			buildingLandblockIds,
			detailLandblockIds,
			envCellIds: new Set(linkedInteriorCoverage.envCellIds),
		},
	);

	return [
		...new Set([
			...legacyOutdoorSourceAssetIds,
			...linkedIndoorSourceAssetIds,
			...packGfxAssetIds,
		]),
	]
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

export function deriveOutdoorInteriorSeedEnvCellIds(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	activeLandblockIds: ReadonlySet<number>,
): Set<number> {
	const linkedEnvCellIds = new Set<number>();
	for (const asset of Object.values(preparedByAssetId)) {
		if (asset.payload.kind === "landblock-pack") {
			if (
				!activeLandblockIds.has(
					normalizeOutdoorLandblockId(asset.payload.landblockId),
				)
			) {
				continue;
			}

			for (const cell of asset.payload.prepared.interiorCells) {
				linkedEnvCellIds.add(cell.envCellId);
			}
			continue;
		}

		if (asset.payload.kind === "outdoor-static-scene") {
			if (
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
					for (const cellId of portal.stabList) {
						if (isEnvCellId(cellId)) {
							linkedEnvCellIds.add(cellId);
						}
					}
				}
			}
			continue;
		}

		if (
			isPreparedIndoorEnvCellAsset(asset) &&
			activeLandblockIds.has(
				normalizeOutdoorLandblockId(asset.payload.envCellId),
			)
		) {
			linkedEnvCellIds.add(asset.payload.envCellId);
			for (const envCellId of asset.payload.landblockEnvCellIds) {
				if (
					isEnvCellId(envCellId) &&
					activeLandblockIds.has(normalizeOutdoorLandblockId(envCellId))
				) {
					linkedEnvCellIds.add(envCellId);
				}
			}
		}
	}

	return linkedEnvCellIds;
}

function isEnvCellId(cellId: number): boolean {
	return (cellId & 0xffff) !== 0xffff;
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
): AssetLookupRequestDto[] {
	const browserFocusEnvCellId =
		browserDestinationToIndoorEnvCellId(browserDestination);
	const activeEnvCellIds = deriveStructuredInteriorCoverage(
		browserFocusEnvCellId === null
			? createRuntimeStructuredInteriorMembershipPolicy(runtimeBatch)
			: deriveBrowserFocusedStructuredInteriorMembershipPolicy(
					browserFocusEnvCellId,
				),
		preparedByAssetId,
	).envCellIds;
	const pendingAssetIdSet = new Set(pendingAssetIds);
	const packGfxAssetIds = collectSelectedPackStaticGfxAssetIds(
		preparedByAssetId,
		{
			buildingLandblockIds: new Set(),
			detailLandblockIds: new Set(),
			envCellIds: new Set(activeEnvCellIds),
		},
	);
	const sourceAssetIds = activeEnvCellIds.flatMap((envCellId) => {
		const asset = preparedByAssetId[formatIndoorEnvCellAssetId(envCellId)];
		return isPreparedIndoorEnvCellAsset(asset)
			? asset.payload.staticObjects.map(
					(staticObject) => staticObject.sourceAssetId,
				)
			: [];
	});

	return [...new Set([...sourceAssetIds, ...packGfxAssetIds])]
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

function collectSelectedPackStaticGfxAssetIds(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	selection: {
		buildingLandblockIds: ReadonlySet<number>;
		detailLandblockIds: ReadonlySet<number>;
		envCellIds: ReadonlySet<number>;
	},
): string[] {
	return Object.values(preparedByAssetId)
		.flatMap((asset) =>
			asset.payload.kind === "landblock-pack"
				? asset.payload.prepared.staticMeshes
				: [],
		)
		.filter((mesh) => isPackStaticMeshSelected(mesh, selection))
		.map((mesh) => mesh.gfxObjAssetId);
}

function isPackStaticMeshSelected(
	mesh: PreparedLandblockStaticMesh,
	selection: {
		buildingLandblockIds: ReadonlySet<number>;
		detailLandblockIds: ReadonlySet<number>;
		envCellIds: ReadonlySet<number>;
	},
): boolean {
	if (mesh.kind === "indoor-static") {
		return (
			mesh.owningEnvCellId !== null &&
			selection.envCellIds.has(mesh.owningEnvCellId)
		);
	}

	const landblockId = normalizeOutdoorLandblockId(mesh.owningLandblockId);
	return mesh.kind === "building"
		? selection.buildingLandblockIds.has(landblockId)
		: selection.detailLandblockIds.has(landblockId);
}

function createRuntimeStructuredInteriorMembershipPolicy(
	runtimeBatch: RuntimeBatchDto,
): StructuredInteriorMembershipPolicy {
	const focusEnvCellId = runtimeBatch.residency.focusEnvCellId;
	return {
		kind: "landblock-closure",
		seedEnvCellIds:
			focusEnvCellId === null
				? []
				: [focusEnvCellId, ...runtimeBatch.residency.visibleCellIds],
	};
}

function deriveRuntimeIndoorLandblockPackIds(
	runtimeBatch: RuntimeBatchDto,
): number[] {
	return [
		...new Set(
			[
				runtimeBatch.residency.focusEnvCellId ??
					runtimeBatch.residency.focusLandblockId,
				...runtimeBatch.residency.visibleCellIds,
			].map(normalizeOutdoorLandblockId),
		),
	].sort((left, right) => left - right);
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
		envCellRadius: options.envCellRadius ?? options.detailRadius,
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
