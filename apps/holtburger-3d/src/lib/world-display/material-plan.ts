import type { Material } from "three";

import type { PreparedPolygonSetRenderGeometry } from "../assets/types";
import {
	describeMaterialAppearanceSignature,
	type MaterialAppearanceContext,
} from "./material-appearance";
import { describeMaterialVariantSignature } from "./material-variants";
import type { MaterialGeometrySlot } from "./static-renderable-geometry";

export interface ResolvedMaterialSlot {
	slotIndex: number;
	surfaceId: number;
	materialAssetId: string;
	materialVariantSignature?: string | null;
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
						materialVariantSignature: null,
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
			surfaceId: slot.slotIndex,
			materialVariantSignature: slot.materialVariantSignature ?? null,
			materialIndex: index,
		})),
	};
}

export function applyRenderGeometryMaterialVariants(options: {
	slots: readonly ResolvedMaterialSlot[];
	renderGeometry: PreparedPolygonSetRenderGeometry;
}): ResolvedMaterialSlot[] {
	const variantsBySlotIndex = collectMaterialVariantsBySlotIndex(
		options.renderGeometry,
		options.slots.length,
	);
	return options.slots.flatMap((slot): ResolvedMaterialSlot[] => {
		const variants = variantsBySlotIndex.get(slot.slotIndex);
		if (!variants || variants.size === 0) {
			return [{ ...slot, materialVariantSignature: null }];
		}
		return [...variants]
			.sort(compareMaterialVariantSignatures)
			.map((materialVariantSignature) => ({
				...slot,
				materialVariantSignature,
			}));
	});
}

function describeMaterialPlanSignature(
	appearance: MaterialAppearanceContext,
	slots: readonly ResolvedMaterialSlot[],
): string {
	return [
		describeMaterialAppearanceSignature(appearance),
		...slots.map((slot) =>
			[
				slot.slotIndex,
				slot.surfaceId,
				slot.materialAssetId,
				describeMaterialVariantSignature(slot.materialVariantSignature),
			].join(":"),
		),
	].join("|");
}

function dedupeMaterialSlots(
	slots: readonly ResolvedMaterialSlot[],
): ResolvedMaterialSlot[] {
	const slotByKey = new Map<string, ResolvedMaterialSlot>();
	for (const slot of slots) {
		slotByKey.set(describeMaterialSlotDedupeKey(slot), slot);
	}
	return [...slotByKey.values()].sort(
		(left, right) =>
			left.slotIndex - right.slotIndex ||
			describeMaterialVariantSignature(
				left.materialVariantSignature,
			).localeCompare(
				describeMaterialVariantSignature(right.materialVariantSignature),
			),
	);
}

function describeMaterialSlotDedupeKey(slot: ResolvedMaterialSlot): string {
	return [
		slot.slotIndex,
		describeMaterialVariantSignature(slot.materialVariantSignature),
	].join("|");
}

function collectMaterialVariantsBySlotIndex(
	renderGeometry: PreparedPolygonSetRenderGeometry,
	slotCount: number,
): Map<number, Set<string | null>> {
	const variantsBySlotIndex = new Map<number, Set<string | null>>();
	for (const triangle of renderGeometry.triangles) {
		if (triangle.surfaceId === null) {
			continue;
		}
		const slotIndex = triangle.surfaceId;
		if (slotIndex < 0 || slotIndex >= slotCount) {
			continue;
		}
		let variants: Set<string | null> | undefined =
			variantsBySlotIndex.get(slotIndex);
		if (!variants) {
			variants = new Set<string | null>();
			variantsBySlotIndex.set(slotIndex, variants);
		}
		variants.add(triangle.materialVariantSignature ?? null);
	}
	return variantsBySlotIndex;
}

function compareMaterialVariantSignatures(
	left: string | null,
	right: string | null,
): number {
	return (left ?? "").localeCompare(right ?? "");
}
