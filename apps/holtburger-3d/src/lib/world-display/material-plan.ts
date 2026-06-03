import type { PreparedPolygonSetRenderGeometry } from "../assets/types";

export interface ResolvedMaterialSlot {
	slotIndex: number;
	surfaceId: number;
	materialAssetId: string;
	materialVariantSignature?: string | null;
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
