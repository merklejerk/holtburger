import {
	createStaticLandblockProductKeyFromResult,
	formatStaticLandblockProductKey,
	type LandblockRenderProductWorkerResult,
	type StaticLandblockProductKey,
} from "./landblock-render-product";
import type { RenderChunkTransform } from "./render-anchor";
import {
	createLinearRenderSpatialIndex,
	type RenderSpatialIndex,
	type RenderSpatialIndexQuery,
} from "./render-spatial-index";
import { deriveLandblockProductSpatialItems } from "./render-spatial-scene";

export interface StaticLandblockProductMetadataStore {
	readonly spatialQuery: RenderSpatialIndexQuery;
	commitProduct(result: LandblockRenderProductWorkerResult): void;
	evictProduct(key: StaticLandblockProductKey): void;
	clearProducts(): void;
	updateRenderChunkTransforms(transforms: readonly RenderChunkTransform[]): void;
	productCount(): number;
	spatialItemCount(): number;
}

interface ResidentProductMetadata {
	productKey: string;
	spatialItemIds: readonly string[];
}

export function createStaticLandblockProductMetadataStore(): StaticLandblockProductMetadataStore {
	const spatialIndex = createLinearRenderSpatialIndex();
	const productsByKey = new Map<string, ResidentProductMetadata>();

	return {
		spatialQuery: spatialIndex,
		commitProduct(result) {
			const productKey = formatStaticLandblockProductKey(
				createStaticLandblockProductKeyFromResult(result),
			);
			evictProductMetadata(productKey, productsByKey, spatialIndex);
			const spatialItems = deriveLandblockProductSpatialItems(result);
			for (const item of spatialItems) {
				spatialIndex.upsertItem(item);
			}
			productsByKey.set(productKey, {
				productKey,
				spatialItemIds: spatialItems.map((item) => item.id),
			});
		},
		evictProduct(key) {
			evictProductMetadata(
				formatStaticLandblockProductKey(key),
				productsByKey,
				spatialIndex,
			);
		},
		clearProducts() {
			for (const productKey of productsByKey.keys()) {
				evictProductMetadata(productKey, productsByKey, spatialIndex);
			}
		},
		updateRenderChunkTransforms(transforms) {
			spatialIndex.replaceChunkTransforms([...transforms]);
		},
		productCount() {
			return productsByKey.size;
		},
		spatialItemCount() {
			return sumProductSpatialItems(productsByKey);
		},
	};
}

function evictProductMetadata(
	productKey: string,
	productsByKey: Map<string, ResidentProductMetadata>,
	spatialIndex: RenderSpatialIndex,
): void {
	const product = productsByKey.get(productKey);
	if (!product) {
		return;
	}
	for (const itemId of product.spatialItemIds) {
		spatialIndex.removeItem(itemId);
	}
	productsByKey.delete(productKey);
}

function sumProductSpatialItems(
	productsByKey: ReadonlyMap<string, ResidentProductMetadata>,
): number {
	let count = 0;
	for (const product of productsByKey.values()) {
		count += product.spatialItemIds.length;
	}
	return count;
}
