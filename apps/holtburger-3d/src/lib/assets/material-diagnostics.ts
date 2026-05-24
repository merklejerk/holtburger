import type { BrowserLocationSelection } from "../../app/browser-mode";
import type { PreparedMaterialRecipePayload } from "./types";
import type { AssetChannelState, PreparedAssetRecord } from "./types";
import {
	deriveVisibleMaterialAssetIdsForBrowserDestination,
	type OutdoorSceneRequestOptions,
} from "./scene-asset-request-planner";

interface MaterialDiagnosticInput {
	assetState: AssetChannelState;
	browserDestination: BrowserLocationSelection | null;
	options: OutdoorSceneRequestOptions;
}

interface MissingMaterialDependencySummary {
	renderTextureAssetIds: string[];
	renderSurfaceAssetIds: string[];
	paletteAssetIds: string[];
}

const MATERIAL_PIPELINE_ASSET_PREFIXES = [
	"material/",
	"render-texture/",
	"render-surface/",
	"palette/",
	"terrain-material/",
];
const SAMPLE_LIMIT = 4;

export function describeMaterialAssetDiagnostics({
	assetState,
	browserDestination,
	options,
}: MaterialDiagnosticInput): string {
	const pendingAssetIds = derivePendingMaterialPipelineAssetIds(assetState);
	const missingVisibleMaterialAssetIds =
		deriveVisibleMaterialAssetIdsForBrowserDestination({
			browserDestination,
			preparedByAssetId: assetState.preparedByAssetId,
			pendingAssetIds,
			options,
		});
	const preparedAssets = Object.values(assetState.preparedByAssetId);
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
		assetState.preparedByAssetId,
	);

	return [
		`recipes ${materialRecipes.length} (${textureRecipeCount} texture, ${solidRecipeCount} solid${failedRecipeCount === 0 ? "" : `, ${failedRecipeCount} failed`})`,
		`render resources ${countPreparedKind(preparedAssets, "render-texture")} textures, ${countPreparedKind(preparedAssets, "render-surface")} surfaces, ${countPreparedKind(preparedAssets, "palette")} palettes`,
		`terrain tables ${countPreparedKind(preparedAssets, "terrain-material")}`,
		`missing visible recipes ${missingVisibleMaterialAssetIds.length}${formatSample(missingVisibleMaterialAssetIds)}`,
		`missing deps tex ${missingDependencies.renderTextureAssetIds.length}${formatSample(missingDependencies.renderTextureAssetIds)}, surface ${missingDependencies.renderSurfaceAssetIds.length}${formatSample(missingDependencies.renderSurfaceAssetIds)}, palette ${missingDependencies.paletteAssetIds.length}${formatSample(missingDependencies.paletteAssetIds)}`,
		`pending ${pendingAssetIds.length}${formatSample(pendingAssetIds)}`,
	].join("; ");
}

function summarizeMissingMaterialDependencies(
	recipes: readonly PreparedMaterialRecipePayload[],
	preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>,
): MissingMaterialDependencySummary {
	const renderTextureAssetIds = new Set<string>();
	const renderSurfaceAssetIds = new Set<string>();
	const paletteAssetIds = new Set<string>();

	for (const recipe of recipes) {
		for (const assetId of recipe.dependencies.renderTextureAssetIds) {
			if (preparedByAssetId[assetId]?.payload.kind !== "render-texture") {
				renderTextureAssetIds.add(assetId);
			}
		}
		for (const assetId of recipe.dependencies.renderSurfaceAssetIds) {
			if (preparedByAssetId[assetId]?.payload.kind !== "render-surface") {
				renderSurfaceAssetIds.add(assetId);
			}
		}
		for (const assetId of recipe.dependencies.paletteAssetIds) {
			if (preparedByAssetId[assetId]?.payload.kind !== "palette") {
				paletteAssetIds.add(assetId);
			}
		}
	}

	return {
		renderTextureAssetIds: [...renderTextureAssetIds].sort(),
		renderSurfaceAssetIds: [...renderSurfaceAssetIds].sort(),
		paletteAssetIds: [...paletteAssetIds].sort(),
	};
}

function derivePendingMaterialPipelineAssetIds(
	assetState: AssetChannelState,
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
				assetState.preparedByAssetId[assetId] === undefined,
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
