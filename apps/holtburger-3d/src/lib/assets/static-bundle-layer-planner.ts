import {
	browserLocationToLandblockId,
	isIndoorBrowserDestination,
	type BrowserInteriorCellSelection,
	type BrowserLocationSelection,
} from "../../app/browser-mode";
import {
	formatEnvCellAssetId,
	formatLandblockOutdoorAssetId,
	formatLandblockTopologyAssetId,
	formatRegionRenderProfileAssetId,
	normalizeOutdoorLandblockId,
} from "../landblocks";
import { getPreparedAssetDependencies } from "./types";
import {
	deriveOutdoorSceneInterest,
	type NormalizedOutdoorSceneInterest,
	type OutdoorSceneInterest,
} from "../world-display/outdoor-scene-interest";
import {
	formatStaticObjectBundleScopeKey,
	type DesiredStaticBundleLayer,
	type StaticBundleLayerPriority,
	type StaticObjectBundleScope,
} from "../world-display/static-bundle-layer";
import {
	deriveBrowserFocusedStructuredInteriorMembershipPolicy,
	deriveStructuredInteriorCoverageFromLookup,
} from "./structured-interior-coverage";
import type { OutdoorSceneRequestOptions } from "./scene-asset-request-planner";
import { deriveTopologyEnvCellIdsForLandblocksFromAssets } from "./scene-asset-request-planner";
import type { PreparedAssetResolver } from "./prepared-asset-store";

const STATIC_BUNDLE_LAYER_REVISION_PREFIX = "static-bundle-layer:v1";
const DEFAULT_OUTDOOR_SCENE_REQUEST_OPTIONS: OutdoorSceneRequestOptions = {
	terrainRadius: 2,
	buildingRadius: 1,
	detailRadius: 1,
	envCellRadius: 1,
};

export interface StaticBundleLayerPlanningInput {
	browserDestination: BrowserLocationSelection | null;
	preparedAssets: PreparedAssetResolver;
	options?: OutdoorSceneRequestOptions;
}

export function planDesiredStaticBundleLayers(
	input: StaticBundleLayerPlanningInput,
): DesiredStaticBundleLayer[] {
	const { browserDestination, preparedAssets } = input;
	if (!browserDestination) {
		return [];
	}

	if (isIndoorBrowserDestination(browserDestination)) {
		return planIndoorStaticBundleLayers(browserDestination, preparedAssets);
	}

	const interest = deriveOutdoorInterestForBrowserDestination(
		browserDestination,
		input.options ?? DEFAULT_OUTDOOR_SCENE_REQUEST_OPTIONS,
	);
	return planOutdoorStaticBundleLayers(preparedAssets, interest);
}

function planOutdoorStaticBundleLayers(
	preparedAssets: PreparedAssetResolver,
	interest: NormalizedOutdoorSceneInterest,
): DesiredStaticBundleLayer[] {
	const layers: DesiredStaticBundleLayer[] = [];
	for (const landblockId of interest.buildingLandblockIds) {
		layers.push(
			createDesiredLayer({
				scope: {
					kind: "landblock",
					landblockId,
					bundleKind: "outdoor-buildings",
				},
				priority: priorityForLandblock(interest.focusLandblockId, landblockId),
				rootAssetIds: collectOutdoorLayerRootAssetIds(landblockId),
				knownClosureAssetIds: collectOutdoorLayerClosureAssetIds(
					preparedAssets,
					landblockId,
					"outdoor-buildings",
				),
				preparedAssets,
			}),
		);
	}

	for (const landblockId of interest.detailLandblockIds) {
		layers.push(
			createDesiredLayer({
				scope: {
					kind: "landblock",
					landblockId,
					bundleKind: "outdoor-detail",
				},
				priority: priorityForLandblock(interest.focusLandblockId, landblockId),
				rootAssetIds: collectOutdoorLayerRootAssetIds(landblockId),
				knownClosureAssetIds: collectOutdoorLayerClosureAssetIds(
					preparedAssets,
					landblockId,
					"outdoor-detail",
				),
				preparedAssets,
			}),
		);
	}

	const envCellIds = deriveStructuredInteriorCoverageFromLookup(
		{
			kind: "landblock-closure",
			seedEnvCellIds: [
				...deriveTopologyEnvCellIdsForLandblocksFromAssets(
					[...preparedAssets.values()],
					new Set(interest.envCellLandblockIds),
				),
			],
		},
		preparedAssets,
	).envCellIds;
	for (const envCellId of envCellIds) {
		const landblockId = normalizeOutdoorLandblockId(envCellId);
		layers.push(
			createDesiredLayer({
				scope: {
					kind: "env-cell",
					landblockId,
					envCellId,
					bundleKind: "env-cell-static",
				},
				priority: priorityForLandblock(interest.focusLandblockId, landblockId),
				rootAssetIds: collectEnvCellLayerRootAssetIds(landblockId, envCellId),
				knownClosureAssetIds: collectEnvCellLayerClosureAssetIds(
					preparedAssets,
					landblockId,
					envCellId,
				),
				preparedAssets,
			}),
		);
	}

	return layers.sort(compareDesiredStaticBundleLayers);
}

function planIndoorStaticBundleLayers(
	browserDestination: BrowserInteriorCellSelection,
	preparedAssets: PreparedAssetResolver,
): DesiredStaticBundleLayer[] {
	const envCellIds = deriveStructuredInteriorCoverageFromLookup(
		deriveBrowserFocusedStructuredInteriorMembershipPolicy(
			browserDestination.envCellId,
		),
		preparedAssets,
	).envCellIds;
	return envCellIds
		.map((envCellId) =>
			createDesiredLayer({
				scope: {
					kind: "env-cell",
					landblockId: normalizeOutdoorLandblockId(
						browserLocationToLandblockId(browserDestination),
					),
					envCellId,
					bundleKind: "env-cell-static",
				},
				priority: "resident-now",
				rootAssetIds: collectEnvCellLayerRootAssetIds(
					normalizeOutdoorLandblockId(
						browserLocationToLandblockId(browserDestination),
					),
					envCellId,
				),
				knownClosureAssetIds: collectEnvCellLayerClosureAssetIds(
					preparedAssets,
					normalizeOutdoorLandblockId(
						browserLocationToLandblockId(browserDestination),
					),
					envCellId,
				),
				preparedAssets,
			}),
		)
		.sort(compareDesiredStaticBundleLayers);
}

function createDesiredLayer(options: {
	scope: StaticObjectBundleScope;
	priority: StaticBundleLayerPriority;
	rootAssetIds: readonly string[];
	knownClosureAssetIds: readonly string[];
	preparedAssets: PreparedAssetResolver;
}): DesiredStaticBundleLayer {
	const rootAssetIds = uniqueSortedAssetIds(options.rootAssetIds);
	const knownClosureAssetIds = uniqueSortedAssetIds(
		options.knownClosureAssetIds,
	);
	const knownMissingAssetIds = knownClosureAssetIds.filter(
		(assetId) => !options.preparedAssets.has(assetId),
	);
	return {
		scope: options.scope,
		priority: options.priority,
		rootAssetIds,
		sourceRevision: deriveStaticBundleLayerSourceRevision({
			scope: options.scope,
			rootAssetIds,
			preparedAssets: options.preparedAssets,
		}),
		diagnostics: {
			knownClosureAssetIds,
			knownMissingAssetIds,
		},
	};
}

function collectOutdoorLayerRootAssetIds(landblockId: number): string[] {
	return [formatLandblockOutdoorAssetId(landblockId)];
}

function collectEnvCellLayerRootAssetIds(
	landblockId: number,
	envCellId: number,
): string[] {
	return [
		formatLandblockTopologyAssetId(landblockId),
		formatEnvCellAssetId(envCellId),
	];
}

function collectOutdoorLayerClosureAssetIds(
	preparedAssets: PreparedAssetResolver,
	landblockId: number,
	bundleKind: "outdoor-buildings" | "outdoor-detail",
): string[] {
	const outdoorAssetId = formatLandblockOutdoorAssetId(landblockId);
	const outdoorPayload = preparedAssets.get(outdoorAssetId)?.payload;
	if (outdoorPayload?.kind !== "landblock-outdoor") {
		return [outdoorAssetId];
	}

	const selectedSourceAssetIds = outdoorPayload.statics
		.filter((member) =>
			bundleKind === "outdoor-buildings"
				? member.kind === "building"
				: member.kind !== "building",
		)
		.map((member) => member.sourceAssetId);

	return collectTransitiveStaticClosureAssetIds(
		preparedAssets,
		[
			outdoorAssetId,
			formatRegionRenderProfileAssetId(outdoorPayload.regionNumber),
			...selectedSourceAssetIds,
		],
		[outdoorAssetId],
	);
}

function collectEnvCellLayerClosureAssetIds(
	preparedAssets: PreparedAssetResolver,
	landblockId: number,
	envCellId: number,
): string[] {
	const envCellAssetId = formatEnvCellAssetId(envCellId);
	const envCellPayload = preparedAssets.get(envCellAssetId)?.payload;
	const seeds = [
		formatLandblockTopologyAssetId(landblockId),
		envCellAssetId,
		...(envCellPayload?.kind === "env-cell"
			? [formatRegionRenderProfileAssetId(envCellPayload.regionNumber)]
			: []),
	];
	return collectTransitiveStaticClosureAssetIds(preparedAssets, seeds, [
		formatLandblockTopologyAssetId(landblockId),
	]);
}

function collectTransitiveStaticClosureAssetIds(
	preparedAssets: PreparedAssetResolver,
	seedAssetIds: readonly string[],
	nonTransitiveSeedAssetIds: readonly string[] = [],
): string[] {
	const closureAssetIds = new Set(seedAssetIds);
	const nonTransitiveAssetIds = new Set(nonTransitiveSeedAssetIds);
	const queue = [...seedAssetIds];
	for (let index = 0; index < queue.length; index += 1) {
		const assetId = queue[index];
		const asset = preparedAssets.get(assetId);
		if (!asset) {
			continue;
		}
		if (nonTransitiveAssetIds.has(assetId)) {
			continue;
		}

		for (const dependency of getPreparedAssetDependencies(asset)) {
			if (!closureAssetIds.has(dependency.assetId)) {
				closureAssetIds.add(dependency.assetId);
				queue.push(dependency.assetId);
			}
		}

		for (const setupAppearanceAssetId of collectSetupAppearanceAssetIds(
			assetId,
		)) {
			if (!closureAssetIds.has(setupAppearanceAssetId)) {
				closureAssetIds.add(setupAppearanceAssetId);
				queue.push(setupAppearanceAssetId);
			}
		}
	}
	return uniqueSortedAssetIds([...closureAssetIds]);
}

function collectSetupAppearanceAssetIds(assetId: string): string[] {
	const match = /^setup-model\/([0-9a-fA-F]{8})$/.exec(assetId);
	return match?.[1] ? [`setup-appearance/${match[1].toLowerCase()}`] : [];
}

function deriveStaticBundleLayerSourceRevision(options: {
	scope: StaticObjectBundleScope;
	rootAssetIds: readonly string[];
	preparedAssets: PreparedAssetResolver;
}): string {
	const parts = options.rootAssetIds.map((assetId) => {
		const asset = options.preparedAssets.get(assetId);
		return asset
			? `${assetId}@${asset.payload.kind}@${asset.preparedAt}`
			: `${assetId}@missing`;
	});
	return [
		STATIC_BUNDLE_LAYER_REVISION_PREFIX,
		formatStaticObjectBundleScopeKey(options.scope),
		...parts,
	].join("|");
}

function deriveOutdoorInterestForBrowserDestination(
	browserDestination: BrowserLocationSelection,
	options: OutdoorSceneRequestOptions,
): NormalizedOutdoorSceneInterest {
	const focusLandblockId = browserLocationToLandblockId(browserDestination);
	const requestedInterest: OutdoorSceneInterest = {
		focusLandblockId,
		terrainRadius: options.terrainRadius,
		buildingRadius: options.buildingRadius,
		detailRadius: options.detailRadius,
		envCellRadius: options.envCellRadius ?? options.detailRadius,
	};
	return deriveOutdoorSceneInterest(requestedInterest);
}

function priorityForLandblock(
	focusLandblockId: number,
	landblockId: number,
): StaticBundleLayerPriority {
	return normalizeOutdoorLandblockId(focusLandblockId) ===
		normalizeOutdoorLandblockId(landblockId)
		? "resident-now"
		: "prefetch";
}

function compareDesiredStaticBundleLayers(
	left: DesiredStaticBundleLayer,
	right: DesiredStaticBundleLayer,
): number {
	return formatStaticObjectBundleScopeKey(left.scope).localeCompare(
		formatStaticObjectBundleScopeKey(right.scope),
	);
}

function uniqueSortedAssetIds(assetIds: readonly string[]): string[] {
	return [...new Set(assetIds)].sort();
}
