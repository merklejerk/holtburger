import type {
	TerrainMaterialFallbackReason,
	TerrainMaterialLayerEntry,
	TerrainMaterialLayerPlan,
	TerrainMaterialTextureRoleBinding,
	TerrainGeometryStaticDrawUnit,
} from "../../contracts";
import type { TextureBindingId } from "../../../textures/identity";

const MAX_TERRAIN_LAYER_ENTRIES_PER_DRAW = 8;
const MAX_TERRAIN_OVERLAYS_PER_LAYER = 3;
const MAX_TERRAIN_ROADS_PER_LAYER = 2;
export const MAX_TERRAIN_COLOR_PAGES_PER_DRAW = 4;
export const MAX_TERRAIN_MASK_PAGES_PER_DRAW = 4;
export const MAX_TERRAIN_DETAIL_PAGES_PER_DRAW = 1;

export type TerrainMaterialFamilyClassification = Pick<
	TerrainGeometryStaticDrawUnit,
	| "materialBucketKey"
	| "materialFamily"
	| "primaryTextureBindingId"
	| "terrainFallbackReasons"
	| "textureBindingIds"
>;

export interface TerrainMaterialFamilyClassifierOptions {
	readonly domain: TerrainGeometryStaticDrawUnit["domain"];
	readonly plan: TerrainMaterialLayerPlan | null;
}

export function classifyTerrainMaterialFamily({
	domain,
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

	const primaryTextureBindingId = plan.layerEntries[0]?.base.textureBindingId;
	if (!primaryTextureBindingId) {
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

	if (requiresLayeredMaterial(plan)) {
		const textureBindingIds = collectTerrainLayeredTextureBindingIds(plan);
		return {
			materialBucketKey: [
				"shader:terrain-layered",
				`domain:${domain}`,
				"sampler:color-mask-detail",
				`textures:${textureBindingIds.join(",")}`,
				`signature:${plan.signature}`,
			].join("|"),
			materialFamily: "terrain-layered",
			primaryTextureBindingId,
			terrainFallbackReasons: [],
			textureBindingIds,
		};
	}

	return {
		materialBucketKey: [
			"shader:terrain-single-base-color",
			`domain:${domain}`,
			"sampler:color-repeat-filterable",
			`texture:${primaryTextureBindingId}`,
		].join("|"),
		materialFamily: "terrain-single-base-color",
		primaryTextureBindingId,
		terrainFallbackReasons: [],
		textureBindingIds: [primaryTextureBindingId],
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
	if (plan.layerEntries.length > MAX_TERRAIN_LAYER_ENTRIES_PER_DRAW) {
		return createUnsupportedBindingReason(
			`Terrain material draw slice requires ${plan.layerEntries.length} layer entries; shader limit is ${MAX_TERRAIN_LAYER_ENTRIES_PER_DRAW}.`,
			plan.layerEntries[0] ?? null,
		);
	}
	if (plan.detailRoles.length > MAX_TERRAIN_DETAIL_PAGES_PER_DRAW) {
		return createUnsupportedBindingReason(
			"Terrain material family supports at most one landscape detail binding.",
			plan.layerEntries[0] ?? null,
		);
	}
	for (const detailRole of plan.detailRoles) {
		const missingReason = findMissingTextureUseReason(
			detailRole.texture,
			"Terrain detail material binding requires a prepared texture use.",
			null,
		);
		if (missingReason) {
			return missingReason;
		}
	}

	for (const entry of plan.layerEntries) {
		if (entry.overlays.length > MAX_TERRAIN_OVERLAYS_PER_LAYER) {
			return createUnsupportedBindingReason(
				`Terrain material entry requires ${entry.overlays.length} overlays; shader limit is ${MAX_TERRAIN_OVERLAYS_PER_LAYER}.`,
				entry,
			);
		}
		if (entry.roads.length > MAX_TERRAIN_ROADS_PER_LAYER) {
			return createUnsupportedBindingReason(
				`Terrain material entry requires ${entry.roads.length} road masks; shader limit is ${MAX_TERRAIN_ROADS_PER_LAYER}.`,
				entry,
			);
		}
		for (const binding of collectLayerEntryTextureBindings(entry)) {
			const missingReason = findMissingTextureUseReason(
				binding,
				"Terrain material binding requires a prepared texture use.",
				entry,
			);
			if (missingReason) {
				return missingReason;
			}
		}
	}

	return null;
}

function requiresLayeredMaterial(plan: TerrainMaterialLayerPlan): boolean {
	if (plan.detailRoles.length > 0 || plan.layerEntries.length > 1) {
		return true;
	}
	const onlyEntry = plan.layerEntries[0];
	return (
		(onlyEntry?.overlays.length ?? 0) > 0 ||
		(onlyEntry?.roads.length ?? 0) > 0 ||
		onlyEntry?.base.tiling !== 1
	);
}

function collectTerrainLayeredTextureBindingIds(
	plan: TerrainMaterialLayerPlan,
): readonly TextureBindingId[] {
	const textureBindingIds = new Set<TextureBindingId>();
	for (const entry of plan.layerEntries) {
		for (const binding of collectLayerEntryTextureBindings(entry)) {
			if (binding.textureBindingId) {
				textureBindingIds.add(binding.textureBindingId);
			}
		}
	}
	for (const detailRole of plan.detailRoles) {
		if (detailRole.texture.textureBindingId) {
			textureBindingIds.add(detailRole.texture.textureBindingId);
		}
	}

	return [...textureBindingIds];
}

function collectLayerEntryTextureBindings(
	entry: TerrainMaterialLayerEntry,
): readonly TerrainMaterialTextureRoleBinding[] {
	return [
		entry.base,
		...entry.overlays.flatMap((overlay) => [overlay.terrain, overlay.alpha]),
		...entry.roads.flatMap((road) => [road.road, road.alpha]),
	];
}

function findMissingTextureUseReason(
	binding: TerrainMaterialTextureRoleBinding,
	message: string,
	entry: TerrainMaterialLayerEntry | null,
): TerrainMaterialFallbackReason | null {
	if (binding.textureBindingId) {
		return null;
	}

	return {
		code: "unsupported-material-binding",
		message,
		pcode: entry?.pcode ?? null,
		texture: binding.texture,
	};
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
		primaryTextureBindingId: null,
		terrainFallbackReasons: reasons,
		textureBindingIds: [],
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
