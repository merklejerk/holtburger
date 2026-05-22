import type { AssetLookupRequestDto, AssetPriority } from "../host/contracts";
import {
	browserDestinationToInteriorCellId,
	browserLocationToLandblockId,
	isIndoorBrowserDestination,
	type BrowserLocationSelection,
} from "../../app/browser-mode";
import {
	formatLandblockPackAssetId,
	formatLandblockSummaryAssetId,
	normalizeOutdoorLandblockId,
} from "../landblocks";
import type { PreparedAssetRecord, PreparedLandblockStaticMesh } from "./types";
import {
	deriveBrowserFocusedStructuredInteriorMembershipPolicy,
	deriveStructuredInteriorCoverage,
} from "./structured-interior-coverage";
import {
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

export interface BrowserSceneRequestInput {
	requestRevision: number;
	browserDestination: BrowserLocationSelection | null;
	preparedByAssetId: Record<string, PreparedAssetRecord>;
	pendingAssetIds?: string[];
	options?: OutdoorSceneRequestOptions;
}

const DEFAULT_OUTDOOR_SCENE_REQUEST_OPTIONS: OutdoorSceneRequestOptions = {
	terrainRadius: 2,
	buildingRadius: 1,
	detailRadius: 1,
	envCellRadius: 1,
};

export function createFocusedAssetRequest(
	browserDestination: BrowserLocationSelection | null,
	priority: AssetPriority,
	requestRevision = 0,
): AssetLookupRequestDto | null {
	if (!browserDestination || isIndoorBrowserDestination(browserDestination)) {
		return null;
	}

	const landblockId = browserLocationToLandblockId(browserDestination);
	const assetId = formatLandblockPackAssetId(landblockId);

	return {
		requestId: `${priority}-${requestRevision}-destination-${assetId}`,
		assetId,
		priority,
	};
}

export function createSceneCoverageRequests(
	input: BrowserSceneRequestInput,
	priority: AssetPriority,
): AssetLookupRequestDto[] {
	const {
		requestRevision,
		browserDestination,
		preparedByAssetId,
		pendingAssetIds = [],
		options = DEFAULT_OUTDOOR_SCENE_REQUEST_OPTIONS,
	} = input;
	if (!browserDestination) {
		return [];
	}

	if (isIndoorBrowserDestination(browserDestination)) {
		return [
			...createLandblockPackCoverageRequests(
				requestRevision,
				browserDestination,
				priority,
				preparedByAssetId,
				pendingAssetIds,
				[normalizeOutdoorLandblockId(browserDestination.envCellId)],
			),
			...createStaticRenderableAssetRequests(
				requestRevision,
				browserDestination,
				priority,
				preparedByAssetId,
				pendingAssetIds,
				options,
			),
		];
	}

	const interest = deriveOutdoorInterestForBrowserDestination(
		browserDestination,
		options,
	);

	return [
		...createLandblockPackCoverageRequestsForInterest(
			requestRevision,
			browserDestination,
			priority,
			preparedByAssetId,
			pendingAssetIds,
			interest,
		),
		...createStaticRenderableAssetRequests(
			requestRevision,
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
	browserDestination: BrowserLocationSelection | null,
	_preparedByAssetId: Record<string, PreparedAssetRecord>,
	options: OutdoorSceneRequestOptions = DEFAULT_OUTDOOR_SCENE_REQUEST_OPTIONS,
): string[] {
	if (!browserDestination) {
		return [];
	}

	if (isIndoorBrowserDestination(browserDestination)) {
		return [formatLandblockPackAssetId(browserDestination.envCellId)];
	}

	const interest = deriveOutdoorInterestForBrowserDestination(
		browserDestination,
		options,
	);
	return [
		...new Set([
			...deriveFullLandblockPackCoverageLandblockIds(interest).map(
				formatLandblockPackAssetId,
			),
			...deriveLandblockSummaryCoverageLandblockIds(interest).map(
				formatLandblockSummaryAssetId,
			),
		]),
	].sort();
}

export function createOutdoorLandblockPackCoverageRequest(
	browserDestination: BrowserLocationSelection | null,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetId: string | null,
	requestRevision = 0,
): AssetLookupRequestDto | null {
	const requests = createOutdoorLandblockPackCoverageRequests(
		browserDestination,
		priority,
		preparedByAssetId,
		pendingAssetId ? [pendingAssetId] : [],
		DEFAULT_OUTDOOR_SCENE_REQUEST_OPTIONS,
		requestRevision,
	);

	return requests[0] ?? null;
}

export function createOutdoorLandblockPackCoverageRequests(
	browserDestination: BrowserLocationSelection | null,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[] = [],
	options: OutdoorSceneRequestOptions = DEFAULT_OUTDOOR_SCENE_REQUEST_OPTIONS,
	requestRevision = 0,
): AssetLookupRequestDto[] {
	if (!browserDestination || isIndoorBrowserDestination(browserDestination)) {
		return [];
	}

	return createLandblockPackCoverageRequestsForInterest(
		requestRevision,
		browserDestination,
		priority,
		preparedByAssetId,
		pendingAssetIds,
		deriveOutdoorInterestForBrowserDestination(browserDestination, options),
	);
}

function createLandblockPackCoverageRequestsForInterest(
	requestRevision: number,
	browserDestination: BrowserLocationSelection | null,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
	interest: NormalizedOutdoorSceneInterest,
): AssetLookupRequestDto[] {
	const fullPackLandblockIds =
		deriveFullLandblockPackCoverageLandblockIds(interest);
	const summaryLandblockIds =
		deriveLandblockSummaryCoverageLandblockIds(interest);
	return [
		...createLandblockPackCoverageRequests(
			requestRevision,
			browserDestination,
			priority,
			preparedByAssetId,
			pendingAssetIds,
			prioritizeOutdoorLandblockIds(
				priority,
				interest.focusLandblockId,
				fullPackLandblockIds,
			),
		),
		...(priority === "bootstrap"
			? []
			: createLandblockSummaryCoverageRequests(
					requestRevision,
					browserDestination,
					priority,
					preparedByAssetId,
					pendingAssetIds,
					summaryLandblockIds,
				)),
	];
}

function createLandblockPackCoverageRequests(
	requestRevision: number,
	browserDestination: BrowserLocationSelection | null,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
	landblockIds: readonly number[],
): AssetLookupRequestDto[] {
	const requestScope = browserDestination ? "destination" : "runtime";
	return createUnpreparedRequests(
		[...new Set(landblockIds.map(formatLandblockPackAssetId))],
		requestRevision,
		priority,
		requestScope,
		preparedByAssetId,
		pendingAssetIds,
	);
}

function createLandblockSummaryCoverageRequests(
	requestRevision: number,
	browserDestination: BrowserLocationSelection | null,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
	landblockIds: readonly number[],
): AssetLookupRequestDto[] {
	const requestScope = browserDestination
		? "destination-summary"
		: "runtime-summary";
	const preparedOrPendingPackIds = new Set([
		...Object.keys(preparedByAssetId),
		...pendingAssetIds,
	]);
	const summaryAssetIds = [...new Set(landblockIds)]
		.filter(
			(landblockId) =>
				!preparedOrPendingPackIds.has(formatLandblockPackAssetId(landblockId)),
		)
		.map(formatLandblockSummaryAssetId);
	return createUnpreparedRequests(
		summaryAssetIds,
		requestRevision,
		priority,
		requestScope,
		preparedByAssetId,
		pendingAssetIds,
	);
}

function deriveFullLandblockPackCoverageLandblockIds(
	interest: NormalizedOutdoorSceneInterest,
): number[] {
	return unionOutdoorSceneLandblockIds(
		[interest.focusLandblockId],
		unionOutdoorSceneLandblockIds(
			interest.detailLandblockIds,
			interest.envCellLandblockIds,
		),
	);
}

function deriveLandblockSummaryCoverageLandblockIds(
	interest: NormalizedOutdoorSceneInterest,
): number[] {
	const fullPackIds = new Set(
		deriveFullLandblockPackCoverageLandblockIds(interest),
	);
	return unionOutdoorSceneLandblockIds(
		interest.terrainLandblockIds,
		interest.buildingLandblockIds,
	)
		.filter((landblockId) => !fullPackIds.has(landblockId))
		.sort((left, right) => left - right);
}

export function createStaticRenderableAssetRequests(
	requestRevision: number,
	browserDestination: BrowserLocationSelection | null,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[] = [],
	options: OutdoorSceneRequestOptions = DEFAULT_OUTDOOR_SCENE_REQUEST_OPTIONS,
	interest: NormalizedOutdoorSceneInterest | null = null,
): AssetLookupRequestDto[] {
	if (!browserDestination) {
		return [];
	}

	if (isIndoorBrowserDestination(browserDestination)) {
		return createIndoorStaticRenderableAssetRequests(
			requestRevision,
			browserDestination,
			priority,
			preparedByAssetId,
			pendingAssetIds,
		);
	}

	const outdoorInterest =
		interest ??
		deriveOutdoorInterestForBrowserDestination(browserDestination, options);
	const buildingLandblockIds = new Set(outdoorInterest.buildingLandblockIds);
	const detailLandblockIds = new Set(outdoorInterest.detailLandblockIds);
	const envCellLandblockIds = new Set(outdoorInterest.envCellLandblockIds);
	const linkedInteriorCellIds = derivePackInteriorEnvCellIdsForLandblocks(
		preparedByAssetId,
		envCellLandblockIds,
	);
	const linkedInteriorCoverage = deriveStructuredInteriorCoverage(
		{
			kind: "landblock-closure",
			seedEnvCellIds: [...linkedInteriorCellIds],
		},
		preparedByAssetId,
	);
	const pendingAssetIdSet = new Set(pendingAssetIds);
	const packGfxAssetIds = collectSelectedPackStaticGfxAssetIds(
		preparedByAssetId,
		{
			buildingLandblockIds,
			detailLandblockIds,
			envCellIds: new Set(linkedInteriorCoverage.envCellIds),
		},
	);
	const summaryBuildingSourceAssetIds =
		collectSelectedSummaryBuildingSourceAssetIds(preparedByAssetId, {
			buildingLandblockIds,
		});

	return [...new Set([...packGfxAssetIds, ...summaryBuildingSourceAssetIds])]
		.sort()
		.filter(
			(assetId) =>
				isStaticRenderableAssetId(assetId) &&
				!preparedByAssetId[assetId] &&
				!pendingAssetIdSet.has(assetId),
		)
		.map((assetId) => ({
			requestId: `${priority}-${requestRevision}-static-renderable-${assetId}`,
			assetId,
			priority,
		}));
}

export function derivePackInteriorEnvCellIdsForLandblocks(
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
		}
	}

	return linkedEnvCellIds;
}

export function deriveTerrainFocusLandblockId(
	browserDestination: BrowserLocationSelection,
): number {
	return browserLocationToLandblockId(browserDestination);
}

function createIndoorStaticRenderableAssetRequests(
	requestRevision: number,
	browserDestination: BrowserLocationSelection | null,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
): AssetLookupRequestDto[] {
	const browserFocusEnvCellId =
		browserDestinationToInteriorCellId(browserDestination);
	if (browserFocusEnvCellId === null) {
		return [];
	}
	const activeEnvCellIds = deriveStructuredInteriorCoverage(
		deriveBrowserFocusedStructuredInteriorMembershipPolicy(
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

	return [...new Set(packGfxAssetIds)]
		.sort()
		.filter(
			(assetId) =>
				isStaticRenderableAssetId(assetId) &&
				!preparedByAssetId[assetId] &&
				!pendingAssetIdSet.has(assetId),
		)
		.map((assetId) => ({
			requestId: `${priority}-${requestRevision}-indoor-static-renderable-${assetId}`,
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

function collectSelectedSummaryBuildingSourceAssetIds(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	selection: {
		buildingLandblockIds: ReadonlySet<number>;
	},
): string[] {
	const preparedPackLandblockIds =
		collectPreparedLandblockPackIds(preparedByAssetId);
	return Object.values(preparedByAssetId)
		.flatMap((asset) =>
			asset.payload.kind === "landblock-summary"
				? asset.payload.sourceFacts.buildings
				: [],
		)
		.filter((building) => {
			const landblockId = normalizeOutdoorLandblockId(
				building.owningLandblockId,
			);
			return (
				selection.buildingLandblockIds.has(landblockId) &&
				!preparedPackLandblockIds.has(landblockId) &&
				isStaticRenderableAssetId(building.sourceAssetId ?? "")
			);
		})
		.map((building) => building.sourceAssetId)
		.filter((assetId): assetId is string => assetId !== null);
}

function collectPreparedLandblockPackIds(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
): Set<number> {
	const landblockIds = new Set<number>();
	for (const asset of Object.values(preparedByAssetId)) {
		if (asset.payload.kind === "landblock-pack") {
			landblockIds.add(normalizeOutdoorLandblockId(asset.payload.landblockId));
		}
	}
	return landblockIds;
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

function deriveOutdoorInterestForBrowserDestination(
	browserDestination: BrowserLocationSelection,
	options: OutdoorSceneRequestOptions,
): NormalizedOutdoorSceneInterest {
	const focusLandblockId = deriveTerrainFocusLandblockId(browserDestination);
	const requestedInterest: OutdoorSceneInterest = {
		focusLandblockId,
		terrainRadius: options.terrainRadius,
		buildingRadius: options.buildingRadius,
		detailRadius: options.detailRadius,
		envCellRadius: options.envCellRadius ?? options.detailRadius,
	};

	return deriveOutdoorSceneInterest(requestedInterest);
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
	requestRevision: number,
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
			requestId: `${priority}-${requestRevision}-${requestScope}-${assetId}`,
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
