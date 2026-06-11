import type {
	TerrainMaterialFallbackReason,
	TerrainMaterialLayerEntry,
	TerrainMaterialLayerPlan,
	TerrainGeometryStaticDrawUnit,
} from "../../contracts";

export type TerrainMaterialFamilyClassification = Pick<
	TerrainGeometryStaticDrawUnit,
	| "materialBucketKey"
	| "materialFamily"
	| "primaryTextureUseId"
	| "terrainFallbackReasons"
	| "textureUseIds"
>;

export interface TerrainMaterialFamilyClassifierOptions {
	readonly domain: TerrainGeometryStaticDrawUnit["domain"];
	readonly placementRevisionAssumption: number;
	readonly plan: TerrainMaterialLayerPlan | null;
}

export function classifyTerrainMaterialFamily({
	domain,
	placementRevisionAssumption,
	plan,
}: TerrainMaterialFamilyClassifierOptions): TerrainMaterialFamilyClassification {
	if (!plan || plan.layerEntries.length === 0) {
		return createDebugFlatClassification({
			domain,
			reasons: plan?.fallbackReasons ?? [],
		});
	}

	const unsupportedReason = findUnsupportedBindingReason(plan);
	if (unsupportedReason) {
		return createDebugFlatClassification({
			domain,
			reasons: [...plan.fallbackReasons, unsupportedReason],
		});
	}

	const primaryTextureUseId = plan.layerEntries[0]?.base.textureUseId;
	if (!primaryTextureUseId) {
		return createDebugFlatClassification({
			domain,
			reasons: [
				...plan.fallbackReasons,
				createUnsupportedBindingReason(
					"Terrain material family requires a prepared base texture binding.",
					plan.layerEntries[0] ?? null,
				),
			],
		});
	}

	return {
		materialBucketKey: [
			"shader:terrain-single-base-color",
			`domain:${domain}`,
			"sampler:color-repeat-filterable",
			`placement:${placementRevisionAssumption}`,
			`texture:${primaryTextureUseId}`,
		].join("|"),
		materialFamily: "terrain-single-base-color",
		primaryTextureUseId,
		terrainFallbackReasons: [],
		textureUseIds: [primaryTextureUseId],
	};
}

function findUnsupportedBindingReason(
	plan: TerrainMaterialLayerPlan,
): TerrainMaterialFallbackReason | null {
	if (plan.fallbackReasons.length > 0) {
		return createUnsupportedBindingReason(
			"Terrain material plan has fallback reasons and cannot be bound by the current terrain material family.",
			plan.layerEntries[0] ?? null,
		);
	}
	if (plan.drawSlices.length > 1) {
		return createUnsupportedBindingReason(
			"Terrain material plan requires multiple draw slices.",
			plan.layerEntries[0] ?? null,
		);
	}
	if (plan.detailRoles.length > 0) {
		return createUnsupportedBindingReason(
			"Terrain detail bindings require the Phase 10B4 terrain material shader.",
			plan.layerEntries[0] ?? null,
		);
	}

	const baseTextureUseIds = new Set<string>();
	for (const entry of plan.layerEntries) {
		if (
			entry.overlays.length > 0 ||
			entry.roads.length > 0 ||
			entry.base.textureUseId === null ||
			entry.base.wrap !== "repeat" ||
			entry.base.tiling !== 1
		) {
			return createUnsupportedBindingReason(
				"Terrain material entry requires overlay, road, missing, clamped, or tiled binding support.",
				entry,
			);
		}
		baseTextureUseIds.add(entry.base.textureUseId);
	}

	if (baseTextureUseIds.size !== 1) {
		return createUnsupportedBindingReason(
			"Terrain material plan uses multiple base textures in one draw unit.",
			plan.layerEntries[0] ?? null,
		);
	}

	return null;
}

function createDebugFlatClassification({
	domain,
	reasons,
}: {
	readonly domain: TerrainGeometryStaticDrawUnit["domain"];
	readonly reasons: readonly TerrainMaterialFallbackReason[];
}): TerrainMaterialFamilyClassification {
	return {
		materialBucketKey: [
			"shader:terrain-debug-flat",
			`domain:${domain}`,
			"sampler:none",
			"placement:none",
		].join("|"),
		materialFamily: "terrain-debug-flat",
		primaryTextureUseId: null,
		terrainFallbackReasons: reasons,
		textureUseIds: [],
	};
}

function createUnsupportedBindingReason(
	message: string,
	entry: TerrainMaterialLayerEntry | null,
): TerrainMaterialFallbackReason {
	return {
		code: "unsupported-material-binding",
		message,
		pcode: entry?.pcode ?? null,
		texture: entry?.base.texture ?? null,
	};
}
