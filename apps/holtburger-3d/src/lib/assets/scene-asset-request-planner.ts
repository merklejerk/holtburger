import type { AssetLookupRequestDto, AssetPriority } from "../host/contracts";
import {
	browserLocationToLandblockId,
	describeBrowserDestinationIdentity,
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
		return [formatLandblockPackAssetId(browserDestination.landblockId)];
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

export function deriveVisibleMaterialAssetIdsForBrowserDestination(input: {
	browserDestination: BrowserLocationSelection | null;
	preparedByAssetId: Record<string, PreparedAssetRecord>;
	pendingAssetIds?: string[];
	options?: OutdoorSceneRequestOptions;
}): string[] {
	const {
		browserDestination,
		preparedByAssetId,
		pendingAssetIds = [],
		options = DEFAULT_OUTDOOR_SCENE_REQUEST_OPTIONS,
	} = input;
	if (!browserDestination) {
		return [];
	}

	const materialAssetIds = isIndoorBrowserDestination(browserDestination)
		? collectIndoorVisibleMaterialAssetIds(
				browserDestination,
				preparedByAssetId,
			)
		: collectOutdoorVisibleMaterialAssetIds(
				browserDestination,
				preparedByAssetId,
				options,
			);
	const pendingAssetIdSet = new Set(pendingAssetIds);
	return materialAssetIds.filter(
		(assetId) => !preparedByAssetId[assetId] && !pendingAssetIdSet.has(assetId),
	);
}

function createLandblockPackCoverageRequestsForInterest(
	requestRevision: number,
	browserDestination: BrowserLocationSelection,
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
	browserDestination: BrowserLocationSelection,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
	landblockIds: readonly number[],
): AssetLookupRequestDto[] {
	return createUnpreparedRequests(
		[...new Set(landblockIds.map(formatLandblockPackAssetId))],
		requestRevision,
		priority,
		`${describeRequiredBrowserDestinationIdentity(browserDestination)}-pack`,
		preparedByAssetId,
		pendingAssetIds,
	);
}

function createLandblockSummaryCoverageRequests(
	requestRevision: number,
	browserDestination: BrowserLocationSelection,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
	landblockIds: readonly number[],
): AssetLookupRequestDto[] {
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
		`${describeRequiredBrowserDestinationIdentity(browserDestination)}-summary`,
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

function createStaticRenderableAssetRequests(
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
	const setupModelPartGfxAssetIds = collectPreparedSetupModelPartGfxAssetIds(
		preparedByAssetId,
		summaryBuildingSourceAssetIds,
	);
	const materialAssetIds = collectStaticRenderableMaterialAssetIds(
		preparedByAssetId,
		[...packGfxAssetIds, ...setupModelPartGfxAssetIds],
		new Set(linkedInteriorCoverage.envCellIds),
	);

	const geometryAssetIds = [
		...new Set([
			...packGfxAssetIds,
			...summaryBuildingSourceAssetIds,
			...setupModelPartGfxAssetIds,
		]),
	].sort();
	const materialRequests = createUnpreparedRequests(
		materialAssetIds,
		requestRevision,
		priority,
		`${describeRequiredBrowserDestinationIdentity(browserDestination)}-static-material`,
		preparedByAssetId,
		pendingAssetIds,
	);

	return [
		...geometryAssetIds
			.filter(
				(assetId) =>
					isStaticRenderableAssetId(assetId) &&
					!preparedByAssetId[assetId] &&
					!pendingAssetIdSet.has(assetId),
			)
			.map((assetId) => ({
				requestId: `${priority}-${requestRevision}-${describeRequiredBrowserDestinationIdentity(
					browserDestination,
				)}-static-renderable-${assetId}`,
				assetId,
				priority,
			})),
		...materialRequests,
	];
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
	browserDestination: BrowserLocationSelection,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
): AssetLookupRequestDto[] {
	if (!isIndoorBrowserDestination(browserDestination)) {
		return [];
	}
	const activeEnvCellIds = deriveStructuredInteriorCoverage(
		deriveBrowserFocusedStructuredInteriorMembershipPolicy(
			browserDestination.envCellId,
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
	const setupModelPartGfxAssetIds = collectPreparedSetupModelPartGfxAssetIds(
		preparedByAssetId,
		packGfxAssetIds,
	);
	const materialAssetIds = collectStaticRenderableMaterialAssetIds(
		preparedByAssetId,
		[...packGfxAssetIds, ...setupModelPartGfxAssetIds],
		new Set(activeEnvCellIds),
	);

	const geometryAssetIds = [
		...new Set([...packGfxAssetIds, ...setupModelPartGfxAssetIds]),
	].sort();
	const materialRequests = createUnpreparedRequests(
		materialAssetIds,
		requestRevision,
		priority,
		`${describeRequiredBrowserDestinationIdentity(browserDestination)}-indoor-static-material`,
		preparedByAssetId,
		pendingAssetIds,
	);

	return [
		...geometryAssetIds
			.filter(
				(assetId) =>
					isStaticRenderableAssetId(assetId) &&
					!preparedByAssetId[assetId] &&
					!pendingAssetIdSet.has(assetId),
			)
			.map((assetId) => ({
				requestId: `${priority}-${requestRevision}-${describeRequiredBrowserDestinationIdentity(
					browserDestination,
				)}-indoor-static-renderable-${assetId}`,
				assetId,
				priority,
			})),
		...materialRequests,
	];
}

function collectIndoorVisibleMaterialAssetIds(
	browserDestination: BrowserLocationSelection,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
): string[] {
	if (!isIndoorBrowserDestination(browserDestination)) {
		return [];
	}
	const activeEnvCellIds = deriveStructuredInteriorCoverage(
		deriveBrowserFocusedStructuredInteriorMembershipPolicy(
			browserDestination.envCellId,
		),
		preparedByAssetId,
	).envCellIds;
	const packGfxAssetIds = collectSelectedPackStaticGfxAssetIds(
		preparedByAssetId,
		{
			buildingLandblockIds: new Set(),
			detailLandblockIds: new Set(),
			envCellIds: new Set(activeEnvCellIds),
		},
	);
	const setupModelPartGfxAssetIds = collectPreparedSetupModelPartGfxAssetIds(
		preparedByAssetId,
		packGfxAssetIds,
	);
	return collectStaticRenderableMaterialAssetIds(
		preparedByAssetId,
		[...packGfxAssetIds, ...setupModelPartGfxAssetIds],
		new Set(activeEnvCellIds),
	);
}

function collectOutdoorVisibleMaterialAssetIds(
	browserDestination: BrowserLocationSelection,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	options: OutdoorSceneRequestOptions,
): string[] {
	const outdoorInterest = deriveOutdoorInterestForBrowserDestination(
		browserDestination,
		options,
	);
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
	const setupModelPartGfxAssetIds = collectPreparedSetupModelPartGfxAssetIds(
		preparedByAssetId,
		summaryBuildingSourceAssetIds,
	);
	return collectStaticRenderableMaterialAssetIds(
		preparedByAssetId,
		[...packGfxAssetIds, ...setupModelPartGfxAssetIds],
		new Set(linkedInteriorCoverage.envCellIds),
	);
}

function collectStaticRenderableMaterialAssetIds(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	gfxAssetIds: readonly string[],
	envCellIds: ReadonlySet<number>,
): string[] {
	return uniqueSortedAssetIds([
		...collectPreparedGfxObjMaterialAssetIds(preparedByAssetId, gfxAssetIds),
		...collectPreparedEnvCellMaterialAssetIds(preparedByAssetId, envCellIds),
	]);
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

function collectPreparedSetupModelPartGfxAssetIds(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	sourceAssetIds: readonly string[],
): string[] {
	const gfxAssetIds: string[] = [];
	for (const sourceAssetId of sourceAssetIds) {
		const sourceAsset = preparedByAssetId[sourceAssetId];
		if (sourceAsset?.payload.kind !== "setup-model") {
			continue;
		}

		for (const part of sourceAsset.payload.parts) {
			gfxAssetIds.push(part.gfxObjAssetId);
		}
	}
	return gfxAssetIds;
}

function collectPreparedGfxObjMaterialAssetIds(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	gfxAssetIds: readonly string[],
): string[] {
	return [
		...new Set(
			gfxAssetIds.flatMap((gfxAssetId) => {
				const asset = preparedByAssetId[gfxAssetId];
				if (asset?.payload.kind !== "gfx-obj") {
					return [];
				}
				const dependencyAssetIds = asset.payload.dependencies?.materialAssetIds;
				if (dependencyAssetIds && dependencyAssetIds.length > 0) {
					return dependencyAssetIds;
				}
				return asset.payload.surfaceIds.map(formatMaterialAssetId);
			}),
		),
	].sort();
}

function collectPreparedEnvCellMaterialAssetIds(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	envCellIds: ReadonlySet<number>,
): string[] {
	return uniqueSortedAssetIds(
		Object.values(preparedByAssetId).flatMap((asset) => {
			if (
				asset.payload.kind !== "env-cell" ||
				!envCellIds.has(asset.payload.envCellId)
			) {
				return [];
			}
			return asset.payload.surfaces.map((surface) => surface.materialAssetId);
		}),
	);
}

function formatMaterialAssetId(surfaceId: number): string {
	return `material/${surfaceId.toString(16).padStart(8, "0")}`;
}

function uniqueSortedAssetIds(assetIds: readonly string[]): string[] {
	return [...new Set(assetIds)].sort();
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

function describeRequiredBrowserDestinationIdentity(
	browserDestination: BrowserLocationSelection,
): string {
	const identity = describeBrowserDestinationIdentity(browserDestination);
	if (!identity) {
		throw new Error("Scene asset requests require a browser destination.");
	}
	return identity;
}

function isStaticRenderableAssetId(assetId: string): boolean {
	return (
		/^gfx-obj\/[0-9a-fA-F]{8}$/.test(assetId) ||
		/^setup-model\/[0-9a-fA-F]{8}$/.test(assetId)
	);
}
