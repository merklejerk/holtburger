import type {
	TerrainMaterialFallbackReason,
	TerrainMaterialLayerEntry,
	TerrainMaterialLayerPlan,
	TerrainMaterialTextureRoleBinding,
	TerrainGeometryStaticDrawUnit,
} from "../../contracts";

const MAX_LAYER_ENTRIES = 8;
const MAX_OVERLAYS_PER_LAYER = 3;
const MAX_ROADS_PER_LAYER = 2;

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
	readonly staticBatchId: string;
	readonly plan: TerrainMaterialLayerPlan | null;
}

export function classifyTerrainMaterialFamily({
	domain,
	staticBatchId,
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

	if (requiresLayeredMaterial(plan)) {
		return {
			materialBucketKey: [
				"shader:terrain-layered",
				`domain:${domain}`,
				"sampler:color-mask-detail",
				`batch:${staticBatchId}`,
				`signature:${plan.signature}`,
			].join("|"),
			materialFamily: "terrain-layered",
			primaryTextureUseId,
			terrainFallbackReasons: [],
			textureUseIds: collectTerrainLayeredTextureUseIds(plan),
		};
	}

	return {
		materialBucketKey: [
			"shader:terrain-single-base-color",
			`domain:${domain}`,
			"sampler:color-repeat-filterable",
			`batch:${staticBatchId}`,
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
	if (plan.layerEntries.length > MAX_LAYER_ENTRIES) {
		return createUnsupportedBindingReason(
			`Terrain material draw slice requires ${plan.layerEntries.length} layer entries; shader limit is ${MAX_LAYER_ENTRIES}.`,
			plan.layerEntries[0] ?? null,
		);
	}
	if (plan.detailRoles.length > 1) {
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
		if (entry.overlays.length > MAX_OVERLAYS_PER_LAYER) {
			return createUnsupportedBindingReason(
				`Terrain material entry requires ${entry.overlays.length} overlays; shader limit is ${MAX_OVERLAYS_PER_LAYER}.`,
				entry,
			);
		}
		if (entry.roads.length > MAX_ROADS_PER_LAYER) {
			return createUnsupportedBindingReason(
				`Terrain material entry requires ${entry.roads.length} road masks; shader limit is ${MAX_ROADS_PER_LAYER}.`,
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
			if (
				binding.wrap === "clamp" &&
				binding.role !== "terrain-alpha" &&
				binding.role !== "road-alpha"
			) {
				return createUnsupportedBindingReason(
					"Terrain material family only supports clamped sampling for alpha masks.",
					entry,
				);
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

function collectTerrainLayeredTextureUseIds(
	plan: TerrainMaterialLayerPlan,
): readonly string[] {
	const textureUseIds = new Set<string>();
	for (const entry of plan.layerEntries) {
		for (const binding of collectLayerEntryTextureBindings(entry)) {
			if (binding.textureUseId) {
				textureUseIds.add(binding.textureUseId);
			}
		}
	}
	for (const detailRole of plan.detailRoles) {
		if (detailRole.texture.textureUseId) {
			textureUseIds.add(detailRole.texture.textureUseId);
		}
	}

	return [...textureUseIds];
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
	if (binding.textureUseId) {
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
