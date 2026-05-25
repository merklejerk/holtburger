import type { PreparedAssetRecord } from "../assets/types";
import { formatHex32 } from "../landblocks";
import {
	describeMaterialAppearanceSignature,
	type MaterialAppearanceContext,
} from "./material-appearance";
import { describeMaterialVariantSignature } from "./material-variants";

export function formatMaterialAssetId(surfaceId: number): string {
	return `material/${formatHex32(surfaceId)}`;
}

export function describeMaterialCacheKey(options: {
	appearance: MaterialAppearanceContext;
	materialAssetId: string;
	materialVariantSignature?: string | null;
	preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>;
}): string {
	return [
		describeMaterialAppearanceSignature(options.appearance),
		options.materialAssetId,
		describeMaterialVariantSignature(options.materialVariantSignature),
		describeMaterialPreparedStateSignature(
			options.materialAssetId,
			options.preparedByAssetId,
		),
	].join("|");
}

export function describeMaterialPreparedStateSignature(
	materialAssetId: string,
	preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>,
): string {
	const recipeAsset = preparedByAssetId[materialAssetId];
	if (recipeAsset?.payload.kind !== "material-recipe") {
		return describePreparedAssetSignature(materialAssetId, recipeAsset);
	}

	const dependencyAssetIds = [
		...recipeAsset.payload.dependencies.renderTextureAssetIds,
		...recipeAsset.payload.dependencies.renderSurfaceAssetIds,
		...recipeAsset.payload.dependencies.paletteAssetIds,
	];
	return [
		describePreparedAssetSignature(materialAssetId, recipeAsset),
		...dependencyAssetIds
			.sort()
			.map((assetId) =>
				describePreparedAssetSignature(assetId, preparedByAssetId[assetId]),
			),
	].join(";");
}

function describePreparedAssetSignature(
	assetId: string,
	asset: PreparedAssetRecord | undefined,
): string {
	if (!asset) {
		return `${assetId}:missing`;
	}

	const baseSignature = `${assetId}:${asset.payload.kind}:${asset.preparedAt}:${asset.payload.provenance.errorCode ?? "ok"}`;
	if (asset.payload.kind === "render-surface") {
		return [
			baseSignature,
			asset.payload.formatRaw,
			asset.payload.width,
			asset.payload.height,
			asset.payload.sourceByteLength,
			asset.payload.defaultPaletteId ?? "no-palette",
		].join(":");
	}
	if (asset.payload.kind === "palette") {
		return [
			baseSignature,
			asset.payload.paletteId,
			asset.payload.colorCount,
		].join(":");
	}
	if (asset.payload.kind === "material-recipe") {
		return [
			baseSignature,
			asset.payload.surfaceType,
			asset.payload.source.kind,
		].join(":");
	}
	return baseSignature;
}

export function describePaletteResourceKey(
	assetId: string,
	asset: PreparedAssetRecord,
): string {
	if (asset.payload.kind !== "palette") {
		return describePreparedAssetSignature(assetId, asset);
	}
	return [
		describePreparedAssetSignature(assetId, asset),
		asset.payload.paletteId,
		asset.payload.colorCount,
	].join(":");
}
