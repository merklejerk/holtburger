import type { BrowserLocationSelection } from "../../app/browser-mode";
import {
	indexedTextureFormat,
	scanMaxPaletteIndex,
	selectIndexedPalette,
	type IndexedTextureFormat,
} from "../world-display/indexed-material-data";
import type { PreparedAssetResolver } from "./prepared-asset-store";
import type {
	AssetChannelState,
	PreparedAssetRecord,
	PreparedMaterialRecipePayload,
} from "./types";
import {
	deriveAllVisibleMaterialAssetIdsForBrowserDestination,
	deriveVisibleMaterialAssetIdsForBrowserDestination,
	type OutdoorSceneRequestOptions,
} from "./scene-asset-request-planner";

interface MaterialDiagnosticInput {
	assetPresentationState: AssetChannelState;
	preparedAssetResolver: PreparedAssetResolver;
	browserDestination: BrowserLocationSelection | null;
	options: OutdoorSceneRequestOptions;
}

interface MissingMaterialDependencySummary {
	surfaceTextureAssetIds: string[];
	renderSurfaceAssetIds: string[];
	paletteAssetIds: string[];
}

interface IndexedMaterialDiagnosticSummary {
	indexedRecipeCount: number;
	indexedSurfaceFormatCounts: Record<IndexedTextureFormat, number>;
	paletteSelectionCounts: {
		materialRecipe: number;
		renderSurfaceDefault: number;
		missing: number;
	};
	preparedPaletteCount: number;
	missingPaletteAssetIds: string[];
	emptyPaletteAssetIds: string[];
	indexRangeErrorAssetIds: string[];
}

const MATERIAL_PIPELINE_ASSET_PREFIXES = [
	"material/",
	"surface-texture/",
	"render-surface/",
	"palette/",
	"terrain-material/",
];
const SAMPLE_LIMIT = 4;

export function describeMaterialAssetDiagnostics({
	assetPresentationState,
	preparedAssetResolver,
	browserDestination,
	options,
}: MaterialDiagnosticInput): string {
	const pendingAssetIds = derivePendingMaterialPipelineAssetIds(
		assetPresentationState,
		preparedAssetResolver,
	);
	const visibleMaterialAssetIds =
		deriveAllVisibleMaterialAssetIdsForBrowserDestination({
			browserDestination,
			preparedAssets: preparedAssetResolver,
			options,
		});
	const missingVisibleMaterialAssetIds =
		deriveVisibleMaterialAssetIdsForBrowserDestination({
			browserDestination,
			preparedAssets: preparedAssetResolver,
			pendingAssetIds,
			options,
		});
	const preparedAssets = [...preparedAssetResolver.values()];
	const materialRecipes = preparedAssets
		.map((asset) =>
			asset.payload.kind === "material-recipe" ? asset.payload : null,
		)
		.filter(
			(recipe): recipe is PreparedMaterialRecipePayload => recipe !== null,
		);
	const textureRecipeCount = materialRecipes.filter(
		(recipe) => recipe.source.kind === "texture",
	).length;
	const solidRecipeCount = materialRecipes.length - textureRecipeCount;
	const failedRecipeCount = materialRecipes.filter(
		(recipe) => recipe.provenance.errorCode !== null,
	).length;
	const missingDependencies = summarizeMissingMaterialDependencies(
		materialRecipes,
		preparedAssetResolver,
	);
	const indexedSummary = summarizeIndexedMaterialDiagnostics(
		materialRecipes,
		preparedAssetResolver,
		browserDestination === null ? null : visibleMaterialAssetIds,
	);

	return [
		`recipes ${materialRecipes.length} (${textureRecipeCount} texture, ${solidRecipeCount} solid${failedRecipeCount === 0 ? "" : `, ${failedRecipeCount} failed`})`,
		`render resources ${countPreparedKind(preparedAssets, "surface-texture")} surface textures, ${countPreparedKind(preparedAssets, "render-surface")} surfaces, ${countPreparedKind(preparedAssets, "palette")} palettes`,
		formatIndexedMaterialSummary(indexedSummary),
		`terrain tables ${countPreparedKind(preparedAssets, "terrain-material")}`,
		`missing visible recipes ${missingVisibleMaterialAssetIds.length}${formatSample(missingVisibleMaterialAssetIds)}`,
		`missing deps surface texture ${missingDependencies.surfaceTextureAssetIds.length}${formatSample(missingDependencies.surfaceTextureAssetIds)}, surface ${missingDependencies.renderSurfaceAssetIds.length}${formatSample(missingDependencies.renderSurfaceAssetIds)}, palette ${missingDependencies.paletteAssetIds.length}${formatSample(missingDependencies.paletteAssetIds)}`,
		`pending ${pendingAssetIds.length}${formatSample(pendingAssetIds)}`,
	].join("; ");
}

function summarizeMissingMaterialDependencies(
	recipes: readonly PreparedMaterialRecipePayload[],
	preparedAssetResolver: PreparedAssetResolver,
): MissingMaterialDependencySummary {
	const surfaceTextureAssetIds = new Set<string>();
	const renderSurfaceAssetIds = new Set<string>();
	const paletteAssetIds = new Set<string>();

	for (const recipe of recipes) {
		for (const assetId of recipe.dependencies.surfaceTextureAssetIds) {
			if (preparedAssetResolver.get(assetId)?.payload.kind !== "surface-texture") {
				surfaceTextureAssetIds.add(assetId);
			}
		}
		for (const assetId of recipe.dependencies.renderSurfaceAssetIds) {
			if (preparedAssetResolver.get(assetId)?.payload.kind !== "render-surface") {
				renderSurfaceAssetIds.add(assetId);
			}
		}
		for (const assetId of recipe.dependencies.paletteAssetIds) {
			if (preparedAssetResolver.get(assetId)?.payload.kind !== "palette") {
				paletteAssetIds.add(assetId);
			}
		}
	}

	return {
		surfaceTextureAssetIds: [...surfaceTextureAssetIds].sort(),
		renderSurfaceAssetIds: [...renderSurfaceAssetIds].sort(),
		paletteAssetIds: [...paletteAssetIds].sort(),
	};
}

function summarizeIndexedMaterialDiagnostics(
	recipes: readonly PreparedMaterialRecipePayload[],
	preparedAssetResolver: PreparedAssetResolver,
	visibleMaterialAssetIds: readonly string[] | null,
): IndexedMaterialDiagnosticSummary {
	const visibleMaterialAssetIdSet =
		visibleMaterialAssetIds === null ? null : new Set(visibleMaterialAssetIds);
	const indexedMaterialAssetIds = new Set<string>();
	const indexedSurfaceAssetIdsByFormat: Record<
		IndexedTextureFormat,
		Set<string>
	> = {
		p8: new Set<string>(),
		index16: new Set<string>(),
	};
	const preparedPaletteAssetIds = new Set<string>();
	const missingPaletteAssetIds = new Set<string>();
	const emptyPaletteAssetIds = new Set<string>();
	const indexRangeErrorAssetIds = new Set<string>();
	const paletteSelectionCounts = {
		materialRecipe: 0,
		renderSurfaceDefault: 0,
		missing: 0,
	};

	for (const recipe of recipes) {
		const materialAssetId = formatMaterialAssetId(recipe.surfaceId);
		if (
			visibleMaterialAssetIdSet !== null &&
			!visibleMaterialAssetIdSet.has(materialAssetId)
		) {
			continue;
		}
			for (const renderSurfaceAssetId of textureCandidateRenderSurfaceAssetIds(
				recipe,
			)) {
				const renderSurfaceAsset = preparedAssetResolver.get(
					renderSurfaceAssetId,
				);
			if (renderSurfaceAsset?.payload.kind !== "render-surface") {
				continue;
			}
			const renderSurface = renderSurfaceAsset.payload;
			const format = indexedTextureFormat(renderSurface.formatRaw);
			if (!format) {
				continue;
			}

			indexedMaterialAssetIds.add(materialAssetId);
			indexedSurfaceAssetIdsByFormat[format].add(renderSurfaceAssetId);

			const paletteSelection = selectIndexedPalette({ recipe, renderSurface });
			if (!paletteSelection) {
				paletteSelectionCounts.missing += 1;
				continue;
			}
			if (paletteSelection.source === "material-recipe") {
				paletteSelectionCounts.materialRecipe += 1;
			} else {
				paletteSelectionCounts.renderSurfaceDefault += 1;
			}

				const paletteAsset = preparedAssetResolver.get(
					paletteSelection.paletteAssetId,
				);
			if (paletteAsset?.payload.kind !== "palette") {
				missingPaletteAssetIds.add(paletteSelection.paletteAssetId);
				continue;
			}
			if (paletteAsset.payload.colorCount === 0) {
				emptyPaletteAssetIds.add(paletteSelection.paletteAssetId);
				continue;
			}
			preparedPaletteAssetIds.add(paletteSelection.paletteAssetId);

			if (
				scanMaxPaletteIndex(renderSurface.sourceBytes, format) >=
				paletteAsset.payload.colorCount
			) {
				indexRangeErrorAssetIds.add(renderSurfaceAssetId);
			}
		}
	}

	return {
		indexedRecipeCount: indexedMaterialAssetIds.size,
		indexedSurfaceFormatCounts: {
			p8: indexedSurfaceAssetIdsByFormat.p8.size,
			index16: indexedSurfaceAssetIdsByFormat.index16.size,
		},
		paletteSelectionCounts,
		preparedPaletteCount: preparedPaletteAssetIds.size,
		missingPaletteAssetIds: [...missingPaletteAssetIds].sort(),
		emptyPaletteAssetIds: [...emptyPaletteAssetIds].sort(),
		indexRangeErrorAssetIds: [...indexRangeErrorAssetIds].sort(),
	};
}

function formatIndexedMaterialSummary(
	summary: IndexedMaterialDiagnosticSummary,
): string {
	return [
		`indexed recipes ${summary.indexedRecipeCount}`,
		`surfaces P8 ${summary.indexedSurfaceFormatCounts.p8}, Index16 ${summary.indexedSurfaceFormatCounts.index16}`,
		`palettes prepared ${summary.preparedPaletteCount}, recipe ${summary.paletteSelectionCounts.materialRecipe}, default ${summary.paletteSelectionCounts.renderSurfaceDefault}, missing ${summary.paletteSelectionCounts.missing}${formatSample(summary.missingPaletteAssetIds)}`,
		`empty ${summary.emptyPaletteAssetIds.length}${formatSample(summary.emptyPaletteAssetIds)}`,
		`range errors ${summary.indexRangeErrorAssetIds.length}${formatSample(summary.indexRangeErrorAssetIds)}`,
	].join("; ");
}

function textureCandidateRenderSurfaceAssetIds(
	recipe: PreparedMaterialRecipePayload,
): string[] {
	if (recipe.source.kind === "texture") {
		return recipe.source.selectedRenderSurfaceId === null
			? []
			: [formatRenderSurfaceAssetId(recipe.source.selectedRenderSurfaceId)];
	}
	return recipe.dependencies.renderSurfaceAssetIds;
}

function formatMaterialAssetId(surfaceId: number): string {
	return `material/${formatHex32(surfaceId)}`;
}

function formatRenderSurfaceAssetId(renderSurfaceId: number): string {
	return `render-surface/${formatHex32(renderSurfaceId)}`;
}

function formatHex32(value: number): string {
	return value.toString(16).padStart(8, "0");
}

function derivePendingMaterialPipelineAssetIds(
	assetState: AssetChannelState,
	preparedAssetResolver: PreparedAssetResolver,
): string[] {
	const pendingAssetIds = new Set<string>();
	if (assetState.activeRequest) {
		pendingAssetIds.add(assetState.activeRequest.assetId);
	}
	for (const entry of assetState.history) {
		if (entry.status === "requested") {
			pendingAssetIds.add(entry.assetId);
		}
	}

	return [...pendingAssetIds]
		.filter(
			(assetId) =>
				isMaterialPipelineAssetId(assetId) &&
				!preparedAssetResolver.has(assetId),
		)
		.sort();
}

function isMaterialPipelineAssetId(assetId: string): boolean {
	return MATERIAL_PIPELINE_ASSET_PREFIXES.some((prefix) =>
		assetId.startsWith(prefix),
	);
}

function countPreparedKind(
	assets: readonly PreparedAssetRecord[],
	kind: PreparedAssetRecord["payload"]["kind"],
): number {
	return assets.filter((asset) => asset.payload.kind === kind).length;
}

function formatSample(assetIds: readonly string[]): string {
	if (assetIds.length === 0) {
		return "";
	}

	return ` (${assetIds.slice(0, SAMPLE_LIMIT).join(", ")})`;
}
