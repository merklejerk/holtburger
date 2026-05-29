import type { AssetLookupRequestDto, AssetPriority } from "../host/contracts";
import { isStaticRenderableAssetId } from "./asset-hydration-policy";
import {
	browserLocationToLandblockId,
	describeBrowserDestinationIdentity,
	isIndoorBrowserDestination,
	type BrowserLocationSelection,
} from "../../app/browser-mode";
import {
	formatEnvCellAssetId,
	formatLandblockOutdoorAssetId,
	formatLandblockTopologyAssetId,
	formatRegionRenderProfileAssetId,
	formatTerrainMaterialAssetId,
	normalizeOutdoorLandblockId,
} from "../landblocks";
import { type PreparedAssetRecord } from "./types";
import {
	DEFAULT_MATERIAL_TEXTURE_PREPARATION_POLICY,
	type LumaMaterialTexturePreparationPolicy,
} from "./luma-material-texture-preparation-policy";
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

type PreparedAssetDependencyKey =
	| "renderableSourceAssetIds"
	| "gfxObjAssetIds"
	| "materialAssetIds";

type PreparedAssetDependencyMap = Partial<
	Record<PreparedAssetDependencyKey, readonly string[]>
>;

interface StaticRenderableDependencyAssetIds {
	geometryAssetIds: string[];
	materialInputAssetIds: string[];
}

export interface OutdoorSceneRequestOptions {
	terrainRadius: number;
	buildingRadius: number;
	detailRadius: number;
	envCellRadius?: number;
	materialTexturePreparationPolicy?: LumaMaterialTexturePreparationPolicy;
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
			...createLandblockTopologyCoverageRequests(
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
			...createVisiblePreparedTextureRequests(
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
		...createOutdoorCoverageRequestsForInterest(
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
		...createVisiblePreparedTextureRequests(
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
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	options: OutdoorSceneRequestOptions = DEFAULT_OUTDOOR_SCENE_REQUEST_OPTIONS,
): string[] {
	if (!browserDestination) {
		return [];
	}

	if (isIndoorBrowserDestination(browserDestination)) {
		return [
			...new Set([
				formatLandblockTopologyAssetId(browserDestination.landblockId),
				...collectVisiblePreparedTextureAssetIds({
					browserDestination,
					preparedByAssetId,
					options,
					interest: null,
				}),
			]),
		].sort();
	}

	const interest = deriveOutdoorInterestForBrowserDestination(
		browserDestination,
		options,
	);
	return [
		...new Set([
			...deriveFocusedOutdoorCoverageLandblockIds(interest).map(
				formatLandblockOutdoorAssetId,
			),
			...deriveFarOutdoorCoverageLandblockIds(interest).map(
				formatLandblockOutdoorAssetId,
			),
			...interest.envCellLandblockIds.map(formatLandblockTopologyAssetId),
			...collectVisiblePreparedTextureAssetIds({
				browserDestination,
				preparedByAssetId,
				options,
				interest,
			}),
		]),
	].sort();
}

export function deriveVisibleMaterialAssetIdsForBrowserDestination(input: {
	browserDestination: BrowserLocationSelection | null;
	preparedByAssetId: Record<string, PreparedAssetRecord>;
	pendingAssetIds?: string[];
	options?: OutdoorSceneRequestOptions;
}): string[] {
	const { preparedByAssetId, pendingAssetIds = [] } = input;
	const materialAssetIds =
		deriveAllVisibleMaterialAssetIdsForBrowserDestination(input);
	const pendingAssetIdSet = new Set(pendingAssetIds);
	return materialAssetIds.filter(
		(assetId) => !preparedByAssetId[assetId] && !pendingAssetIdSet.has(assetId),
	);
}

export function deriveAllVisibleMaterialAssetIdsForBrowserDestination(input: {
	browserDestination: BrowserLocationSelection | null;
	preparedByAssetId: Record<string, PreparedAssetRecord>;
	options?: OutdoorSceneRequestOptions;
}): string[] {
	const {
		browserDestination,
		preparedByAssetId,
		options = DEFAULT_OUTDOOR_SCENE_REQUEST_OPTIONS,
	} = input;
	if (!browserDestination) {
		return [];
	}

	return isIndoorBrowserDestination(browserDestination)
		? collectIndoorVisibleMaterialAssetIds(
				browserDestination,
				preparedByAssetId,
			)
		: collectOutdoorVisibleMaterialAssetIds(
				browserDestination,
				preparedByAssetId,
				options,
			);
}

function createOutdoorCoverageRequestsForInterest(
	requestRevision: number,
	browserDestination: BrowserLocationSelection,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
	interest: NormalizedOutdoorSceneInterest,
): AssetLookupRequestDto[] {
	const outdoorLandblockIds = unionOutdoorSceneLandblockIds(
		deriveFocusedOutdoorCoverageLandblockIds(interest),
		deriveFarOutdoorCoverageLandblockIds(interest),
	);
	return [
		...createLandblockOutdoorCoverageRequests(
			requestRevision,
			browserDestination,
			priority,
			preparedByAssetId,
			pendingAssetIds,
			prioritizeOutdoorLandblockIds(
				priority,
				interest.focusLandblockId,
				outdoorLandblockIds,
			),
		),
		...createTerrainMaterialRequests(
			requestRevision,
			browserDestination,
			priority,
			preparedByAssetId,
			pendingAssetIds,
			outdoorLandblockIds,
		),
		...createOutdoorRegionRenderProfileRequests(
			requestRevision,
			browserDestination,
			priority,
			preparedByAssetId,
			pendingAssetIds,
			outdoorLandblockIds,
		),
		...(priority === "bootstrap"
			? []
			: createLandblockTopologyCoverageRequests(
					requestRevision,
					browserDestination,
					priority,
					preparedByAssetId,
					pendingAssetIds,
					interest.envCellLandblockIds,
				)),
	];
}

function createLandblockOutdoorCoverageRequests(
	requestRevision: number,
	browserDestination: BrowserLocationSelection,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
	landblockIds: readonly number[],
): AssetLookupRequestDto[] {
	return createUnpreparedRequests(
		[...new Set(landblockIds.map(formatLandblockOutdoorAssetId))],
		requestRevision,
		priority,
		`${describeRequiredBrowserDestinationIdentity(browserDestination)}-outdoor`,
		preparedByAssetId,
		pendingAssetIds,
	);
}

function createTerrainMaterialRequests(
	requestRevision: number,
	browserDestination: BrowserLocationSelection,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
	landblockIds: readonly number[],
): AssetLookupRequestDto[] {
	return createUnpreparedRequests(
		collectTerrainMaterialAssetIds(preparedByAssetId, landblockIds),
		requestRevision,
		priority,
		`${describeRequiredBrowserDestinationIdentity(browserDestination)}-terrain-material`,
		preparedByAssetId,
		pendingAssetIds,
	);
}

function createOutdoorRegionRenderProfileRequests(
	requestRevision: number,
	browserDestination: BrowserLocationSelection,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
	landblockIds: readonly number[],
): AssetLookupRequestDto[] {
	return createUnpreparedRequests(
		collectOutdoorRegionRenderProfileAssetIds(preparedByAssetId, landblockIds),
		requestRevision,
		priority,
		`${describeRequiredBrowserDestinationIdentity(browserDestination)}-region-render-profile`,
		preparedByAssetId,
		pendingAssetIds,
	);
}

function createLandblockTopologyCoverageRequests(
	requestRevision: number,
	browserDestination: BrowserLocationSelection,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
	landblockIds: readonly number[],
): AssetLookupRequestDto[] {
	return createUnpreparedRequests(
		[...new Set(landblockIds.map(formatLandblockTopologyAssetId))],
		requestRevision,
		priority,
		`${describeRequiredBrowserDestinationIdentity(browserDestination)}-topology`,
		preparedByAssetId,
		pendingAssetIds,
	);
}

function createVisiblePreparedTextureRequests(
	requestRevision: number,
	browserDestination: BrowserLocationSelection,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
	options: OutdoorSceneRequestOptions,
	interest: NormalizedOutdoorSceneInterest | null = null,
): AssetLookupRequestDto[] {
	return createUnpreparedRequests(
		collectVisiblePreparedTextureAssetIds({
			browserDestination,
			preparedByAssetId,
			options,
			interest,
		}),
		requestRevision,
		priority,
		`${describeRequiredBrowserDestinationIdentity(browserDestination)}-prepared-texture`,
		preparedByAssetId,
		pendingAssetIds,
	);
}

function deriveFocusedOutdoorCoverageLandblockIds(
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

function deriveFarOutdoorCoverageLandblockIds(
	interest: NormalizedOutdoorSceneInterest,
): number[] {
	const focusedOutdoorIds = new Set(
		deriveFocusedOutdoorCoverageLandblockIds(interest),
	);
	return unionOutdoorSceneLandblockIds(
		interest.terrainLandblockIds,
		interest.buildingLandblockIds,
	)
		.filter((landblockId) => !focusedOutdoorIds.has(landblockId))
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
	const linkedInteriorCellIds = deriveTopologyEnvCellIdsForLandblocks(
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
	const envCellAssetRequests = createUnpreparedRequests(
		linkedInteriorCoverage.envCellIds.map(formatEnvCellAssetId),
		requestRevision,
		priority,
		`${describeRequiredBrowserDestinationIdentity(browserDestination)}-env-cell`,
		preparedByAssetId,
		pendingAssetIds,
	);
	const envCellProfileRequests = createEnvCellRegionRenderProfileRequests(
		requestRevision,
		browserDestination,
		priority,
		preparedByAssetId,
		pendingAssetIds,
		linkedInteriorCoverage.envCellIds,
		"env-cell-region-render-profile",
	);
	const outdoorSourceAssetIds = collectSelectedOutdoorSourceAssetIds(
		preparedByAssetId,
		{
			buildingLandblockIds,
			detailLandblockIds,
		},
	);
	const outdoorStaticDependencies = collectStaticRenderableDependencyAssetIds(
		preparedByAssetId,
		outdoorSourceAssetIds,
	);
	const envCellStaticSourceAssetIds = collectPreparedDependencyAssetIds(
		preparedByAssetId,
		linkedInteriorCoverage.envCellIds.map(formatEnvCellAssetId),
		"renderableSourceAssetIds",
	);
	const envCellStaticDependencies = collectStaticRenderableDependencyAssetIds(
		preparedByAssetId,
		envCellStaticSourceAssetIds,
	);
	const materialAssetIds = collectStaticRenderableMaterialAssetIds(
		preparedByAssetId,
		[
			...outdoorStaticDependencies.materialInputAssetIds,
			...envCellStaticDependencies.materialInputAssetIds,
		],
		new Set(linkedInteriorCoverage.envCellIds),
	);

	const geometryAssetIds = [
		...new Set([
			...outdoorStaticDependencies.geometryAssetIds,
			...envCellStaticDependencies.geometryAssetIds,
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
		...envCellAssetRequests,
		...envCellProfileRequests,
		...geometryAssetIds
			.filter(
				(assetId) =>
					isStaticRenderableOrSetupAppearanceAssetId(assetId) &&
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

export function deriveTopologyEnvCellIdsForLandblocks(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	activeLandblockIds: ReadonlySet<number>,
): Set<number> {
	const linkedEnvCellIds = new Set<number>();
	for (const asset of Object.values(preparedByAssetId)) {
		if (asset.payload.kind === "landblock-topology") {
			if (
				!activeLandblockIds.has(
					normalizeOutdoorLandblockId(asset.payload.landblockId),
				)
			) {
				continue;
			}

			for (const cell of asset.payload.envCells) {
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
	const envCellAssetRequests = createUnpreparedRequests(
		activeEnvCellIds.map(formatEnvCellAssetId),
		requestRevision,
		priority,
		`${describeRequiredBrowserDestinationIdentity(browserDestination)}-env-cell`,
		preparedByAssetId,
		pendingAssetIds,
	);
	const envCellProfileRequests = createEnvCellRegionRenderProfileRequests(
		requestRevision,
		browserDestination,
		priority,
		preparedByAssetId,
		pendingAssetIds,
		activeEnvCellIds,
		"indoor-region-render-profile",
	);
	const envCellStaticSourceAssetIds = collectPreparedDependencyAssetIds(
		preparedByAssetId,
		activeEnvCellIds.map(formatEnvCellAssetId),
		"renderableSourceAssetIds",
	);
	const staticDependencies = collectStaticRenderableDependencyAssetIds(
		preparedByAssetId,
		envCellStaticSourceAssetIds,
	);
	const materialAssetIds = collectStaticRenderableMaterialAssetIds(
		preparedByAssetId,
		staticDependencies.materialInputAssetIds,
		new Set(activeEnvCellIds),
	);

	const geometryAssetIds = staticDependencies.geometryAssetIds;
	const materialRequests = createUnpreparedRequests(
		materialAssetIds,
		requestRevision,
		priority,
		`${describeRequiredBrowserDestinationIdentity(browserDestination)}-indoor-static-material`,
		preparedByAssetId,
		pendingAssetIds,
	);

	return [
		...envCellAssetRequests,
		...envCellProfileRequests,
		...geometryAssetIds
			.filter(
				(assetId) =>
					isStaticRenderableOrSetupAppearanceAssetId(assetId) &&
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
	const envCellStaticSourceAssetIds = collectPreparedDependencyAssetIds(
		preparedByAssetId,
		activeEnvCellIds.map(formatEnvCellAssetId),
		"renderableSourceAssetIds",
	);
	const staticDependencies = collectStaticRenderableDependencyAssetIds(
		preparedByAssetId,
		envCellStaticSourceAssetIds,
	);
	return collectStaticRenderableMaterialAssetIds(
		preparedByAssetId,
		staticDependencies.materialInputAssetIds,
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
	const linkedInteriorCellIds = deriveTopologyEnvCellIdsForLandblocks(
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
	const outdoorSourceAssetIds = collectSelectedOutdoorSourceAssetIds(
		preparedByAssetId,
		{
			buildingLandblockIds,
			detailLandblockIds,
		},
	);
	const outdoorStaticDependencies = collectStaticRenderableDependencyAssetIds(
		preparedByAssetId,
		outdoorSourceAssetIds,
	);
	const envCellStaticSourceAssetIds = collectPreparedDependencyAssetIds(
		preparedByAssetId,
		linkedInteriorCoverage.envCellIds.map(formatEnvCellAssetId),
		"renderableSourceAssetIds",
	);
	const envCellStaticDependencies = collectStaticRenderableDependencyAssetIds(
		preparedByAssetId,
		envCellStaticSourceAssetIds,
	);
	return collectStaticRenderableMaterialAssetIds(
		preparedByAssetId,
		[
			...outdoorStaticDependencies.materialInputAssetIds,
			...envCellStaticDependencies.materialInputAssetIds,
		],
		new Set(linkedInteriorCoverage.envCellIds),
	);
}

function collectVisiblePreparedTextureAssetIds(options: {
	browserDestination: BrowserLocationSelection;
	preparedByAssetId: Record<string, PreparedAssetRecord>;
	options: OutdoorSceneRequestOptions;
	interest: NormalizedOutdoorSceneInterest | null;
}): string[] {
	const renderSurfaceAssetIds = collectVisibleRenderSurfaceAssetIds(options);
	return uniqueSortedAssetIds(
		renderSurfaceAssetIds.flatMap((assetId) => {
			const asset = options.preparedByAssetId[assetId];
			if (asset?.payload.kind !== "render-surface") {
				return [];
			}
			return (
				options.options.materialTexturePreparationPolicy ??
				DEFAULT_MATERIAL_TEXTURE_PREPARATION_POLICY
			)({
				renderSurface: asset.payload,
				usage: "raw",
			});
		}),
	);
}

function collectVisibleRenderSurfaceAssetIds(options: {
	browserDestination: BrowserLocationSelection;
	preparedByAssetId: Record<string, PreparedAssetRecord>;
	options: OutdoorSceneRequestOptions;
	interest: NormalizedOutdoorSceneInterest | null;
}): string[] {
	const materialAssetIds = isIndoorBrowserDestination(
		options.browserDestination,
	)
		? collectIndoorVisibleMaterialAssetIds(
				options.browserDestination,
				options.preparedByAssetId,
			)
		: collectOutdoorVisibleMaterialAssetIds(
				options.browserDestination,
				options.preparedByAssetId,
				options.options,
			);
	const tableAssetIds = isIndoorBrowserDestination(options.browserDestination)
		? collectIndoorVisibleRegionRenderProfileAssetIds(
				options.browserDestination,
				options.preparedByAssetId,
			)
		: collectOutdoorVisibleRenderResourceTableAssetIds(
				options.browserDestination,
				options.preparedByAssetId,
				options.options,
				options.interest,
			);
	return uniqueSortedAssetIds(
		collectRenderSurfaceAssetIdsFromAssets(options.preparedByAssetId, [
			...materialAssetIds,
			...tableAssetIds,
		]),
	);
}

function collectIndoorVisibleRegionRenderProfileAssetIds(
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
	return collectEnvCellRegionRenderProfileAssetIds(
		preparedByAssetId,
		activeEnvCellIds,
	);
}

function collectOutdoorVisibleRenderResourceTableAssetIds(
	browserDestination: BrowserLocationSelection,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	options: OutdoorSceneRequestOptions,
	interest: NormalizedOutdoorSceneInterest | null,
): string[] {
	const outdoorInterest =
		interest ??
		deriveOutdoorInterestForBrowserDestination(browserDestination, options);
	const outdoorLandblockIds = unionOutdoorSceneLandblockIds(
		deriveFocusedOutdoorCoverageLandblockIds(outdoorInterest),
		deriveFarOutdoorCoverageLandblockIds(outdoorInterest),
	);
	const envCellIds = [
		...deriveTopologyEnvCellIdsForLandblocks(
			preparedByAssetId,
			new Set(outdoorInterest.envCellLandblockIds),
		),
	];
	return uniqueSortedAssetIds([
		...collectTerrainMaterialAssetIds(preparedByAssetId, outdoorLandblockIds),
		...collectOutdoorRegionRenderProfileAssetIds(
			preparedByAssetId,
			outdoorLandblockIds,
		),
		...collectEnvCellRegionRenderProfileAssetIds(preparedByAssetId, envCellIds),
	]);
}

function collectRenderSurfaceAssetIdsFromAssets(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	assetIds: readonly string[],
): string[] {
	return uniqueSortedAssetIds(
		assetIds.flatMap((assetId) => {
			const payload = preparedByAssetId[assetId]?.payload;
			if (
				payload?.kind !== "material-recipe" &&
				payload?.kind !== "terrain-material" &&
				payload?.kind !== "region-render-profile"
			) {
				return [];
			}
			return payload.dependencies.renderSurfaceAssetIds;
		}),
	);
}

function collectStaticRenderableDependencyAssetIds(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	sourceAssetIds: readonly string[],
): StaticRenderableDependencyAssetIds {
	const setupModelFallbackPartGfxAssetIds =
		collectSetupModelFallbackPartGfxAssetIds(preparedByAssetId, sourceAssetIds);
	const setupAppearanceAssetIds = uniqueSortedAssetIds([
		...collectSetupAppearanceAssetIds(sourceAssetIds),
	]);
	const setupAppearancePartGfxAssetIds = collectSetupAppearancePartGfxAssetIds(
		preparedByAssetId,
		setupAppearanceAssetIds,
	);
	const geometryAssetIds = uniqueSortedAssetIds([
		...sourceAssetIds,
		...setupAppearanceAssetIds,
		...setupModelFallbackPartGfxAssetIds,
		...setupAppearancePartGfxAssetIds,
	]);

	return {
		geometryAssetIds,
		materialInputAssetIds: geometryAssetIds,
	};
}

function collectStaticRenderableMaterialAssetIds(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	assetIds: readonly string[],
	envCellIds: ReadonlySet<number>,
): string[] {
	return uniqueSortedAssetIds([
		...collectPreparedDependencyAssetIds(
			preparedByAssetId,
			assetIds,
			"materialAssetIds",
		),
		...collectPreparedDependencyAssetIds(
			preparedByAssetId,
			[...envCellIds].map(formatEnvCellAssetId),
			"materialAssetIds",
		),
	]);
}

function collectSetupAppearanceAssetIds(assetIds: readonly string[]): string[] {
	return uniqueSortedAssetIds(
		assetIds.flatMap((assetId) => {
			const match = /^setup-model\/([0-9a-fA-F]{8})$/.exec(assetId);
			return match?.[1] ? [`setup-appearance/${match[1].toLowerCase()}`] : [];
		}),
	);
}

function collectSetupAppearancePartGfxAssetIds(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	setupAppearanceAssetIds: readonly string[],
): string[] {
	return uniqueSortedAssetIds(
		setupAppearanceAssetIds.flatMap((assetId) => {
			const payload = preparedByAssetId[assetId]?.payload;
			return payload?.kind === "setup-appearance"
				? payload.parts.map((part) => part.gfxObjAssetId)
				: [];
		}),
	);
}

function collectSetupModelFallbackPartGfxAssetIds(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	sourceAssetIds: readonly string[],
): string[] {
	return uniqueSortedAssetIds(
		sourceAssetIds.flatMap((assetId) => {
			if (!/^setup-model\/[0-9a-fA-F]{8}$/.test(assetId)) {
				return [];
			}
			const setupAppearanceAssetId = collectSetupAppearanceAssetIds([
				assetId,
			])[0];
			if (
				setupAppearanceAssetId &&
				preparedByAssetId[setupAppearanceAssetId]?.payload.kind ===
					"setup-appearance"
			) {
				return [];
			}
			const dependencies = getPreparedAssetDependencies(
				preparedByAssetId[assetId],
			);
			const dependencyAssetIds = dependencies?.gfxObjAssetIds;
			return Array.isArray(dependencyAssetIds) ? dependencyAssetIds : [];
		}),
	);
}

function collectSelectedOutdoorSourceAssetIds(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	selection: {
		buildingLandblockIds: ReadonlySet<number>;
		detailLandblockIds: ReadonlySet<number>;
	},
): string[] {
	return uniqueSortedAssetIds(
		Object.values(preparedByAssetId).flatMap((asset) => {
			if (asset.payload.kind !== "landblock-outdoor") {
				return [];
			}
			const landblockId = normalizeOutdoorLandblockId(
				asset.payload.landblockId,
			);
			return asset.payload.statics
				.filter((member) =>
					member.kind === "building"
						? selection.buildingLandblockIds.has(landblockId)
						: selection.detailLandblockIds.has(landblockId),
				)
				.map((member) => member.sourceAssetId);
		}),
	);
}

function collectTerrainMaterialAssetIds(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	landblockIds: readonly number[],
): string[] {
	const activeLandblockIds = new Set(
		landblockIds.map(normalizeOutdoorLandblockId),
	);
	return uniqueSortedAssetIds(
		Object.values(preparedByAssetId).flatMap((asset) => {
			if (asset.payload.kind !== "landblock-outdoor") {
				return [];
			}
			if (
				!activeLandblockIds.has(
					normalizeOutdoorLandblockId(asset.payload.landblockId),
				)
			) {
				return [];
			}
			return [formatTerrainMaterialAssetId(asset.payload.regionNumber)];
		}),
	);
}

function collectOutdoorRegionRenderProfileAssetIds(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	landblockIds: readonly number[],
): string[] {
	const activeLandblockIds = new Set(
		landblockIds.map(normalizeOutdoorLandblockId),
	);
	return uniqueSortedAssetIds(
		Object.values(preparedByAssetId).flatMap((asset) => {
			if (asset.payload.kind !== "landblock-outdoor") {
				return [];
			}
			if (
				!activeLandblockIds.has(
					normalizeOutdoorLandblockId(asset.payload.landblockId),
				)
			) {
				return [];
			}
			return [formatRegionRenderProfileAssetId(asset.payload.regionNumber)];
		}),
	);
}

function createEnvCellRegionRenderProfileRequests(
	requestRevision: number,
	browserDestination: BrowserLocationSelection,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
	envCellIds: readonly number[],
	label: string,
): AssetLookupRequestDto[] {
	return createUnpreparedRequests(
		collectEnvCellRegionRenderProfileAssetIds(preparedByAssetId, envCellIds),
		requestRevision,
		priority,
		`${describeRequiredBrowserDestinationIdentity(browserDestination)}-${label}`,
		preparedByAssetId,
		pendingAssetIds,
	);
}

function collectEnvCellRegionRenderProfileAssetIds(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	envCellIds: readonly number[],
): string[] {
	const activeEnvCellIds = new Set(envCellIds);
	return uniqueSortedAssetIds(
		Object.values(preparedByAssetId).flatMap((asset) => {
			if (asset.payload.kind !== "env-cell") {
				return [];
			}
			if (!activeEnvCellIds.has(asset.payload.envCellId)) {
				return [];
			}
			return [formatRegionRenderProfileAssetId(asset.payload.regionNumber)];
		}),
	);
}

function collectPreparedDependencyAssetIds(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	assetIds: readonly string[],
	dependencyKey: PreparedAssetDependencyKey,
): string[] {
	return uniqueSortedAssetIds(
		assetIds.flatMap((assetId) => {
			const dependencies = getPreparedAssetDependencies(
				preparedByAssetId[assetId],
			);
			if (!dependencies || !(dependencyKey in dependencies)) {
				return [];
			}
			const dependencyAssetIds = dependencies[dependencyKey];
			return Array.isArray(dependencyAssetIds) ? dependencyAssetIds : [];
		}),
	);
}

function getPreparedAssetDependencies(
	asset: PreparedAssetRecord | undefined,
): PreparedAssetDependencyMap | null {
	const payload = asset?.payload;
	if (!payload || !("dependencies" in payload)) {
		return null;
	}
	return payload.dependencies as PreparedAssetDependencyMap;
}

function uniqueSortedAssetIds(assetIds: readonly string[]): string[] {
	return [...new Set(assetIds)].sort();
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

function isStaticRenderableOrSetupAppearanceAssetId(assetId: string): boolean {
	return isStaticRenderableAssetId(assetId);
}
