import type { Material } from "three";

import {
	describeMaterialAppearanceSignature,
	type MaterialAppearanceContext,
} from "./material-appearance";
import type { MaterialGeometrySlot } from "./static-renderable-geometry";

export interface ResolvedMaterialSlot {
	slotIndex: number;
	surfaceId: number;
	materialAssetId: string;
}

export interface MaterialResourcePlan {
	signature: string;
	materials: Material[];
	geometrySlots: MaterialGeometrySlot[];
}

const FALLBACK_MATERIAL_ASSET_ID = "material/fallback";

export function buildMaterialResourcePlan(options: {
	slots: readonly ResolvedMaterialSlot[];
	appearance: MaterialAppearanceContext;
	fallbackColorKey: string;
	createMaterial: (options: {
		slot: ResolvedMaterialSlot;
		fallbackColorKey: string;
	}) => Material;
}): MaterialResourcePlan {
	const slots =
		options.slots.length > 0
			? dedupeMaterialSlots(options.slots)
			: [
					{
						slotIndex: 0,
						surfaceId: 0,
						materialAssetId: FALLBACK_MATERIAL_ASSET_ID,
					},
				];
	const materials = slots.map((slot) =>
		options.createMaterial({
			slot,
			fallbackColorKey: `${options.fallbackColorKey}:${slot.surfaceId}`,
		}),
	);
	return {
		signature: describeMaterialPlanSignature(options.appearance, slots),
		materials,
		geometrySlots: slots.map((slot, index) => ({
			surfaceId: slot.slotIndex + 1,
			materialIndex: index,
		})),
	};
}

function describeMaterialPlanSignature(
	appearance: MaterialAppearanceContext,
	slots: readonly ResolvedMaterialSlot[],
): string {
	return [
		describeMaterialAppearanceSignature(appearance),
		...slots.map(
			(slot) => `${slot.slotIndex}:${slot.surfaceId}:${slot.materialAssetId}`,
		),
	].join("|");
}

function dedupeMaterialSlots(
	slots: readonly ResolvedMaterialSlot[],
): ResolvedMaterialSlot[] {
	const slotByIndex = new Map<number, ResolvedMaterialSlot>();
	for (const slot of slots) {
		slotByIndex.set(slot.slotIndex, slot);
	}
	return [...slotByIndex.values()].sort(
		(left, right) => left.slotIndex - right.slotIndex,
	);
}
