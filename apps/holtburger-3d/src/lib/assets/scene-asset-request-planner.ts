import type { AssetLookupRequestDto, AssetPriority } from "../host/contracts";
import { isStaticRenderableAssetId } from "./asset-hydration-policy";
import {
	browserLocationToLandblockId,
	type BrowserLocationSelection,
} from "../../app/browser-mode";
import {
	formatHex32,
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
	type MaterialTexturePreparationPolicy,
} from "./material-texture-preparation-policy";
import {
	createSceneResourceInterest,
	type SceneResourceInterest,
	type SceneResourceLocation,
} from "../scene-runtime/scene-resource-interest";
import {
	collectEnvCellMaterialAssetIds,
	collectEnvCellRenderableSourceAssetIds,
} from "./structured-asset-dependencies";
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
	materialTexturePreparationPolicy?: MaterialTexturePreparationPolicy;
}

export interface SceneCoverageRequestInput {
	requestRevision: number;
	sceneInterest: SceneResourceInterest;
	preparedByAssetId: Record<string, PreparedAssetRecord>;
	pendingAssetIds?: string[];
	materialTexturePreparationPolicy?: MaterialTexturePreparationPolicy;
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

export function createBrowserSceneCoverageRequests(
	input: BrowserSceneRequestInput,
	priority: AssetPriority,
): AssetLookupRequestDto[] {
	return createSceneCoverageRequests(
		{
			requestRevision: input.requestRevision,
			sceneInterest: createSceneResourceInterestFromBrowserDestination({
				browserDestination: input.browserDestination,
				options: input.options,
			}),
			preparedByAssetId: input.preparedByAssetId,
			pendingAssetIds: input.pendingAssetIds,
			materialTexturePreparationPolicy:
				input.options?.materialTexturePreparationPolicy,
		},
		priority,
	);
}

export function createSceneCoverageRequests(
	input: SceneCoverageRequestInput,
	priority: AssetPriority,
): AssetLookupRequestDto[] {
	const {
		requestRevision,
		sceneInterest,
		preparedByAssetId,
		pendingAssetIds = [],
		materialTexturePreparationPolicy =
			DEFAULT_OUTDOOR_SCENE_REQUEST_OPTIONS.materialTexturePreparationPolicy,
	} = input;
	const sceneLocation = sceneInterest.location;
	const options = createOutdoorSceneRequestOptionsFromInterest(
		sceneInterest,
		materialTexturePreparationPolicy,
	);
	if (!sceneLocation) {
		return [];
	}

	if (sceneLocation.kind === "interior-cell") {
		return [
			...createLandblockTopologyCoverageRequests(
				requestRevision,
				sceneLocation,
				priority,
				preparedByAssetId,
				pendingAssetIds,
				[sceneLocation.landblockId],
			),
			...createStaticRenderableAssetRequests(
				requestRevision,
				sceneLocation,
				priority,
				preparedByAssetId,
				pendingAssetIds,
				options,
			),
			...createVisiblePreparedTextureRequests(
				requestRevision,
				sceneLocation,
				priority,
				preparedByAssetId,
				pendingAssetIds,
				options,
			),
		];
	}

	const interest = deriveOutdoorInterestForSceneLocation(sceneLocation, options);

	return [
		...createOutdoorCoverageRequestsForInterest(
			requestRevision,
			sceneLocation,
			priority,
			preparedByAssetId,
			pendingAssetIds,
			interest,
		),
		...createStaticRenderableAssetRequests(
			requestRevision,
			sceneLocation,
			priority,
			preparedByAssetId,
			pendingAssetIds,
			options,
			interest,
		),
		...createVisiblePreparedTextureRequests(
			requestRevision,
			sceneLocation,
			priority,
			preparedByAssetId,
			pendingAssetIds,
			options,
			interest,
		),
	];
}

export function deriveBrowserSceneCoverageAssetIds(
	browserDestination: BrowserLocationSelection | null,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	options: OutdoorSceneRequestOptions = DEFAULT_OUTDOOR_SCENE_REQUEST_OPTIONS,
): string[] {
	return deriveSceneCoverageAssetIds(
		createSceneResourceInterestFromBrowserDestination({
			browserDestination,
			options,
		}),
		preparedByAssetId,
		options.materialTexturePreparationPolicy,
	);
}

export function deriveSceneCoverageAssetIds(
	sceneInterest: SceneResourceInterest,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	materialTexturePreparationPolicy?: MaterialTexturePreparationPolicy,
): string[] {
	const sceneLocation = sceneInterest.location;
	const options = createOutdoorSceneRequestOptionsFromInterest(
		sceneInterest,
		materialTexturePreparationPolicy,
	);
	if (!sceneLocation) {
		return [];
	}

	if (sceneLocation.kind === "interior-cell") {
		return [
			...new Set([
				formatLandblockTopologyAssetId(sceneLocation.landblockId),
				...collectVisiblePreparedTextureAssetIds({
					sceneLocation,
					preparedByAssetId,
					options,
					interest: null,
				}),
			]),
		].sort();
	}

	const interest = deriveOutdoorInterestForSceneLocation(sceneLocation, options);
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
				sceneLocation,
				preparedByAssetId,
				options,
				interest,
			}),
		]),
	].sort();
}

export function deriveVisibleMaterialAssetIdsForSceneInterest(input: {
	sceneInterest: SceneResourceInterest;
	preparedByAssetId: Record<string, PreparedAssetRecord>;
	pendingAssetIds?: string[];
	materialTexturePreparationPolicy?: MaterialTexturePreparationPolicy;
}): string[] {
	const { preparedByAssetId, pendingAssetIds = [] } = input;
	const materialAssetIds = deriveAllVisibleMaterialAssetIdsForSceneInterest(input);
	const pendingAssetIdSet = new Set(pendingAssetIds);
	return materialAssetIds.filter(
		(assetId) => !preparedByAssetId[assetId] && !pendingAssetIdSet.has(assetId),
	);
}

export function deriveVisibleMaterialAssetIdsForBrowserDestination(input: {
	browserDestination: BrowserLocationSelection | null;
	preparedByAssetId: Record<string, PreparedAssetRecord>;
	pendingAssetIds?: string[];
	options?: OutdoorSceneRequestOptions;
}): string[] {
	return deriveVisibleMaterialAssetIdsForSceneInterest({
		sceneInterest: createSceneResourceInterestFromBrowserDestination({
			browserDestination: input.browserDestination,
			options: input.options,
		}),
		preparedByAssetId: input.preparedByAssetId,
		pendingAssetIds: input.pendingAssetIds,
		materialTexturePreparationPolicy:
			input.options?.materialTexturePreparationPolicy,
	});
}

export function deriveAllVisibleMaterialAssetIdsForSceneInterest(input: {
	sceneInterest: SceneResourceInterest;
	preparedByAssetId: Record<string, PreparedAssetRecord>;
	materialTexturePreparationPolicy?: MaterialTexturePreparationPolicy;
}): string[] {
	const {
		sceneInterest,
		preparedByAssetId,
	} = input;
	const sceneLocation = sceneInterest.location;
	const options = createOutdoorSceneRequestOptionsFromInterest(
		sceneInterest,
		input.materialTexturePreparationPolicy,
	);
	if (!sceneLocation) {
		return [];
	}

	return sceneLocation.kind === "interior-cell"
		? collectIndoorVisibleMaterialAssetIds(sceneLocation, preparedByAssetId)
		: collectOutdoorVisibleMaterialAssetIds(
				sceneLocation,
				preparedByAssetId,
				options,
			);
}

export function deriveAllVisibleMaterialAssetIdsForBrowserDestination(input: {
	browserDestination: BrowserLocationSelection | null;
	preparedByAssetId: Record<string, PreparedAssetRecord>;
	options?: OutdoorSceneRequestOptions;
}): string[] {
	return deriveAllVisibleMaterialAssetIdsForSceneInterest({
		sceneInterest: createSceneResourceInterestFromBrowserDestination({
			browserDestination: input.browserDestination,
			options: input.options,
		}),
		preparedByAssetId: input.preparedByAssetId,
		materialTexturePreparationPolicy:
			input.options?.materialTexturePreparationPolicy,
	});
}

function createOutdoorCoverageRequestsForInterest(
	requestRevision: number,
	sceneLocation: SceneResourceLocation,
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
			sceneLocation,
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
			sceneLocation,
			priority,
			preparedByAssetId,
			pendingAssetIds,
			outdoorLandblockIds,
		),
		...createOutdoorRegionRenderProfileRequests(
			requestRevision,
			sceneLocation,
			priority,
			preparedByAssetId,
			pendingAssetIds,
			outdoorLandblockIds,
		),
		...(priority === "bootstrap"
			? []
			: createLandblockTopologyCoverageRequests(
					requestRevision,
					sceneLocation,
					priority,
					preparedByAssetId,
					pendingAssetIds,
					interest.envCellLandblockIds,
				)),
	];
}

function createLandblockOutdoorCoverageRequests(
	requestRevision: number,
	sceneLocation: SceneResourceLocation,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
	landblockIds: readonly number[],
): AssetLookupRequestDto[] {
	return createUnpreparedRequests(
		[...new Set(landblockIds.map(formatLandblockOutdoorAssetId))],
		requestRevision,
		priority,
		`${describeRequiredSceneLocationIdentity(sceneLocation)}-outdoor`,
		preparedByAssetId,
		pendingAssetIds,
	);
}

function createTerrainMaterialRequests(
	requestRevision: number,
	sceneLocation: SceneResourceLocation,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
	landblockIds: readonly number[],
): AssetLookupRequestDto[] {
	return createUnpreparedRequests(
		collectTerrainMaterialAssetIds(preparedByAssetId, landblockIds),
		requestRevision,
		priority,
		`${describeRequiredSceneLocationIdentity(sceneLocation)}-terrain-material`,
		preparedByAssetId,
		pendingAssetIds,
	);
}

function createOutdoorRegionRenderProfileRequests(
	requestRevision: number,
	sceneLocation: SceneResourceLocation,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
	landblockIds: readonly number[],
): AssetLookupRequestDto[] {
	return createUnpreparedRequests(
		collectOutdoorRegionRenderProfileAssetIds(preparedByAssetId, landblockIds),
		requestRevision,
		priority,
		`${describeRequiredSceneLocationIdentity(sceneLocation)}-region-render-profile`,
		preparedByAssetId,
		pendingAssetIds,
	);
}

function createLandblockTopologyCoverageRequests(
	requestRevision: number,
	sceneLocation: SceneResourceLocation,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
	landblockIds: readonly number[],
): AssetLookupRequestDto[] {
	return createUnpreparedRequests(
		[...new Set(landblockIds.map(formatLandblockTopologyAssetId))],
		requestRevision,
		priority,
		`${describeRequiredSceneLocationIdentity(sceneLocation)}-topology`,
		preparedByAssetId,
		pendingAssetIds,
	);
}

function createVisiblePreparedTextureRequests(
	requestRevision: number,
	sceneLocation: SceneResourceLocation,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
	options: OutdoorSceneRequestOptions,
	interest: NormalizedOutdoorSceneInterest | null = null,
): AssetLookupRequestDto[] {
	return createUnpreparedRequests(
		collectVisiblePreparedTextureAssetIds({
			sceneLocation,
			preparedByAssetId,
			options,
			interest,
		}),
		requestRevision,
		priority,
		`${describeRequiredSceneLocationIdentity(sceneLocation)}-prepared-texture`,
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
	sceneLocation: SceneResourceLocation | null,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[] = [],
	options: OutdoorSceneRequestOptions = DEFAULT_OUTDOOR_SCENE_REQUEST_OPTIONS,
	interest: NormalizedOutdoorSceneInterest | null = null,
): AssetLookupRequestDto[] {
	if (!sceneLocation) {
		return [];
	}

	if (sceneLocation.kind === "interior-cell") {
		return createIndoorStaticRenderableAssetRequests(
			requestRevision,
			sceneLocation,
			priority,
			preparedByAssetId,
			pendingAssetIds,
		);
	}

	const outdoorInterest =
		interest ??
		deriveOutdoorInterestForSceneLocation(sceneLocation, options);
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
		`${describeRequiredSceneLocationIdentity(sceneLocation)}-env-cell`,
		preparedByAssetId,
		pendingAssetIds,
	);
	const envCellProfileRequests = createEnvCellRegionRenderProfileRequests(
		requestRevision,
		sceneLocation,
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
	const envCellStaticSourceAssetIds = collectEnvCellStaticSourceAssetIds(
		preparedByAssetId,
		linkedInteriorCoverage.envCellIds.map(formatEnvCellAssetId),
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
		`${describeRequiredSceneLocationIdentity(sceneLocation)}-static-material`,
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
				requestId: `${priority}-${requestRevision}-${describeRequiredSceneLocationIdentity(
					sceneLocation,
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
	sceneLocation: SceneResourceLocation,
	priority: AssetPriority,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[],
): AssetLookupRequestDto[] {
	if (sceneLocation.kind !== "interior-cell") {
		return [];
	}
	const activeEnvCellIds = deriveStructuredInteriorCoverage(
		deriveBrowserFocusedStructuredInteriorMembershipPolicy(
			sceneLocation.envCellId,
		),
		preparedByAssetId,
	).envCellIds;
	const pendingAssetIdSet = new Set(pendingAssetIds);
	const envCellAssetRequests = createUnpreparedRequests(
		activeEnvCellIds.map(formatEnvCellAssetId),
		requestRevision,
		priority,
		`${describeRequiredSceneLocationIdentity(sceneLocation)}-env-cell`,
		preparedByAssetId,
		pendingAssetIds,
	);
	const envCellProfileRequests = createEnvCellRegionRenderProfileRequests(
		requestRevision,
		sceneLocation,
		priority,
		preparedByAssetId,
		pendingAssetIds,
		activeEnvCellIds,
		"indoor-region-render-profile",
	);
	const envCellStaticSourceAssetIds = collectEnvCellStaticSourceAssetIds(
		preparedByAssetId,
		activeEnvCellIds.map(formatEnvCellAssetId),
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
		`${describeRequiredSceneLocationIdentity(sceneLocation)}-indoor-static-material`,
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
				requestId: `${priority}-${requestRevision}-${describeRequiredSceneLocationIdentity(
					sceneLocation,
				)}-indoor-static-renderable-${assetId}`,
				assetId,
				priority,
			})),
		...materialRequests,
	];
}

function collectIndoorVisibleMaterialAssetIds(
	sceneLocation: SceneResourceLocation,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
): string[] {
	if (sceneLocation.kind !== "interior-cell") {
		return [];
	}
	const activeEnvCellIds = deriveStructuredInteriorCoverage(
		deriveBrowserFocusedStructuredInteriorMembershipPolicy(
			sceneLocation.envCellId,
		),
		preparedByAssetId,
	).envCellIds;
	const envCellStaticSourceAssetIds = collectEnvCellStaticSourceAssetIds(
		preparedByAssetId,
		activeEnvCellIds.map(formatEnvCellAssetId),
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
	sceneLocation: SceneResourceLocation,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	options: OutdoorSceneRequestOptions,
): string[] {
	const outdoorInterest = deriveOutdoorInterestForSceneLocation(
		sceneLocation,
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
	const envCellStaticSourceAssetIds = collectEnvCellStaticSourceAssetIds(
		preparedByAssetId,
		linkedInteriorCoverage.envCellIds.map(formatEnvCellAssetId),
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
	sceneLocation: SceneResourceLocation;
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
			const policy =
				options.options.materialTexturePreparationPolicy ??
				DEFAULT_MATERIAL_TEXTURE_PREPARATION_POLICY;
			return [
				...policy({
					renderSurface: asset.payload,
					usage: "raw",
				}),
				...policy({
					renderSurface: asset.payload,
					usage: "detail",
				}),
			];
		}),
	);
}

function collectVisibleRenderSurfaceAssetIds(options: {
	sceneLocation: SceneResourceLocation;
	preparedByAssetId: Record<string, PreparedAssetRecord>;
	options: OutdoorSceneRequestOptions;
	interest: NormalizedOutdoorSceneInterest | null;
}): string[] {
	const materialAssetIds = options.sceneLocation.kind === "interior-cell"
		? collectIndoorVisibleMaterialAssetIds(
				options.sceneLocation,
				options.preparedByAssetId,
			)
		: collectOutdoorVisibleMaterialAssetIds(
				options.sceneLocation,
				options.preparedByAssetId,
				options.options,
			);
	const tableAssetIds = options.sceneLocation.kind === "interior-cell"
		? collectIndoorVisibleRegionRenderProfileAssetIds(
				options.sceneLocation,
				options.preparedByAssetId,
			)
		: collectOutdoorVisibleRenderResourceTableAssetIds(
				options.sceneLocation,
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
	sceneLocation: SceneResourceLocation,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
): string[] {
	if (sceneLocation.kind !== "interior-cell") {
		return [];
	}
	const activeEnvCellIds = deriveStructuredInteriorCoverage(
		deriveBrowserFocusedStructuredInteriorMembershipPolicy(
			sceneLocation.envCellId,
		),
		preparedByAssetId,
	).envCellIds;
	return collectEnvCellRegionRenderProfileAssetIds(
		preparedByAssetId,
		activeEnvCellIds,
	);
}

function collectOutdoorVisibleRenderResourceTableAssetIds(
	sceneLocation: SceneResourceLocation,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	options: OutdoorSceneRequestOptions,
	interest: NormalizedOutdoorSceneInterest | null,
): string[] {
	const outdoorInterest =
		interest ??
		deriveOutdoorInterestForSceneLocation(sceneLocation, options);
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
	const directRenderSurfaceAssetIds = assetIds.flatMap((assetId) => {
			const payload = preparedByAssetId[assetId]?.payload;
			if (
				payload?.kind !== "material-recipe" &&
				payload?.kind !== "terrain-material" &&
				payload?.kind !== "region-render-profile"
			) {
				return [];
			}
			return payload.dependencies.renderSurfaceAssetIds;
		});
	const surfaceTextureAssetIds = assetIds.flatMap((assetId) => {
		const payload = preparedByAssetId[assetId]?.payload;
		if (
			payload?.kind !== "material-recipe" &&
			payload?.kind !== "terrain-material" &&
			payload?.kind !== "region-render-profile"
		) {
			return [];
		}
		return payload.dependencies.surfaceTextureAssetIds;
	});
	const surfaceTextureRenderSurfaceAssetIds = surfaceTextureAssetIds.flatMap(
		(assetId) => {
			const payload = preparedByAssetId[assetId]?.payload;
			return payload?.kind === "surface-texture"
				? payload.dependencies.renderSurfaceAssetIds
				: [];
		},
	);
	return uniqueSortedAssetIds([
		...directRenderSurfaceAssetIds,
		...surfaceTextureRenderSurfaceAssetIds,
	]);
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
		...collectEnvCellMaterialDependencyAssetIds(
			preparedByAssetId,
			[...envCellIds].map(formatEnvCellAssetId),
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
	sceneLocation: SceneResourceLocation,
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
		`${describeRequiredSceneLocationIdentity(sceneLocation)}-${label}`,
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

function collectEnvCellStaticSourceAssetIds(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	assetIds: readonly string[],
): string[] {
	return uniqueSortedAssetIds(
		assetIds.flatMap((assetId) => {
			const payload = preparedByAssetId[assetId]?.payload;
			return payload?.kind === "env-cell"
				? collectEnvCellRenderableSourceAssetIds(payload)
				: [];
		}),
	);
}

function collectEnvCellMaterialDependencyAssetIds(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	assetIds: readonly string[],
): string[] {
	return uniqueSortedAssetIds(
		assetIds.flatMap((assetId) => {
			const payload = preparedByAssetId[assetId]?.payload;
			return payload?.kind === "env-cell"
				? collectEnvCellMaterialAssetIds(payload)
				: [];
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

function createSceneResourceInterestFromBrowserDestination(input: {
	browserDestination: BrowserLocationSelection | null;
	options?: OutdoorSceneRequestOptions;
}): SceneResourceInterest {
	const options = input.options ?? DEFAULT_OUTDOOR_SCENE_REQUEST_OPTIONS;
	return createSceneResourceInterest({
		location: createSceneResourceLocationFromBrowserDestination(
			input.browserDestination,
		),
		lod: {
			terrain: options.terrainRadius,
			buildings: options.buildingRadius,
			detail: options.detailRadius,
			envCells: options.envCellRadius ?? options.detailRadius,
		},
	});
}

function createSceneResourceLocationFromBrowserDestination(
	browserDestination: BrowserLocationSelection | null,
): SceneResourceLocation | null {
	if (!browserDestination) {
		return null;
	}
	if (browserDestination.kind === "interior-cell") {
		return {
			kind: "interior-cell",
			envCellId: browserDestination.envCellId,
			landblockId: normalizeOutdoorLandblockId(browserDestination.landblockId),
		};
	}
	return {
		kind: "outdoor-landblock",
		landblockId: browserLocationToLandblockId(browserDestination),
	};
}

function createOutdoorSceneRequestOptionsFromInterest(
	sceneInterest: SceneResourceInterest,
	materialTexturePreparationPolicy?: MaterialTexturePreparationPolicy,
): OutdoorSceneRequestOptions {
	return {
		terrainRadius: sceneInterest.lod.terrain,
		buildingRadius: sceneInterest.lod.buildings,
		detailRadius: sceneInterest.lod.detail,
		envCellRadius: sceneInterest.lod.envCells,
		materialTexturePreparationPolicy,
	};
}

function deriveOutdoorInterestForSceneLocation(
	sceneLocation: SceneResourceLocation,
	options: OutdoorSceneRequestOptions,
): NormalizedOutdoorSceneInterest {
	const focusLandblockId = deriveSceneFocusLandblockId(sceneLocation);
	const requestedInterest: OutdoorSceneInterest = {
		focusLandblockId,
		terrainRadius: options.terrainRadius,
		buildingRadius: options.buildingRadius,
		detailRadius: options.detailRadius,
		envCellRadius: options.envCellRadius ?? options.detailRadius,
	};

	return deriveOutdoorSceneInterest(requestedInterest);
}

function deriveSceneFocusLandblockId(sceneLocation: SceneResourceLocation): number {
	return normalizeOutdoorLandblockId(sceneLocation.landblockId);
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

function describeRequiredSceneLocationIdentity(
	sceneLocation: SceneResourceLocation,
): string {
	return describeSceneLocationIdentity(sceneLocation);
}

function describeSceneLocationIdentity(sceneLocation: SceneResourceLocation): string {
	if (sceneLocation.kind === "interior-cell") {
		return `interior-cell-${formatHex32(
			sceneLocation.envCellId,
		)}-landblock-${formatHex32(
			normalizeOutdoorLandblockId(sceneLocation.landblockId),
		)}`;
	}
	return `outdoor-landblock-${formatHex32(sceneLocation.landblockId)}`;
}

function isStaticRenderableOrSetupAppearanceAssetId(assetId: string): boolean {
	return isStaticRenderableAssetId(assetId);
}
