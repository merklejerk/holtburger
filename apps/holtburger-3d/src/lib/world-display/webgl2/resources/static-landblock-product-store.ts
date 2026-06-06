import {
	createStaticLandblockProductKeyFromResult,
	formatStaticLandblockProductKey,
	getDetailedLandblockRenderArtifacts,
	getLandblockTerrainRenderArtifact,
	getStaticObjectBundleArtifacts,
	type LandblockRenderProductWorkerResult,
	type StaticLandblockProductKey,
} from "../../landblock-render-product";
import type { RenderChunkTransform } from "../../render-anchor";
import type { TextureFilteringMode } from "../../texture-pages/texture-sampling-policy";

export interface Webgl2StaticLandblockProductStore {
	readonly productsByKey: ReadonlyMap<string, Webgl2StaticLandblockProductResource>;
	commitProduct(
		result: LandblockRenderProductWorkerResult,
		resources?: Webgl2StaticLandblockProductFamilyResources,
	): Webgl2StaticLandblockProductResource;
	evictProduct(key: StaticLandblockProductKey): void;
	clearProducts(): void;
	updatePlacement(transforms: readonly RenderChunkTransform[]): void;
	updateSamplerPolicy(policy: TextureFilteringMode): void;
	productCount(): number;
	ownedResourceCount(): number;
}

interface Webgl2StaticLandblockProductFamilyResources {
	readonly ownedResources?: readonly Webgl2StaticLandblockProductOwnedResource[];
}

interface Webgl2StaticLandblockProductOwnedResource {
	readonly key: string;
	dispose(): void;
	updatePlacement?(transforms: readonly RenderChunkTransform[]): void;
	updateSamplerPolicy?(policy: TextureFilteringMode): void;
}

interface Webgl2StaticLandblockProductResource {
	readonly key: string;
	readonly productKey: StaticLandblockProductKey;
	readonly signature: string;
	readonly ownedResources: readonly Webgl2StaticLandblockProductOwnedResource[];
	dispose(): void;
	updatePlacement(transforms: readonly RenderChunkTransform[]): void;
	updateSamplerPolicy(policy: TextureFilteringMode): void;
}

export function createWebgl2StaticLandblockProductStore(): Webgl2StaticLandblockProductStore {
	const productsByKey = new Map<string, Webgl2StaticLandblockProductResource>();

	return {
		productsByKey,
		commitProduct(result, resources = {}) {
			const productKey = createStaticLandblockProductKeyFromResult(result);
			const key = formatStaticLandblockProductKey(productKey);
			const signature = describeStaticLandblockProductResourceSignature(result);
			const previous = productsByKey.get(key);
			if (previous && previous.signature === signature) {
				return previous;
			}
			previous?.dispose();
			const product = createProductResource({
				key,
				productKey,
				signature,
				resources,
			});
			productsByKey.set(key, product);
			return product;
		},
		evictProduct(key) {
			const productKey = formatStaticLandblockProductKey(key);
			const product = productsByKey.get(productKey);
			if (!product) {
				return;
			}
			product.dispose();
			productsByKey.delete(productKey);
		},
		clearProducts() {
			for (const product of productsByKey.values()) {
				product.dispose();
			}
			productsByKey.clear();
		},
		updatePlacement(transforms) {
			for (const product of productsByKey.values()) {
				product.updatePlacement(transforms);
			}
		},
		updateSamplerPolicy(policy) {
			for (const product of productsByKey.values()) {
				product.updateSamplerPolicy(policy);
			}
		},
		productCount() {
			return productsByKey.size;
		},
		ownedResourceCount() {
			let count = 0;
			for (const product of productsByKey.values()) {
				count += product.ownedResources.length;
			}
			return count;
		},
	};
}

function createProductResource({
	key,
	productKey,
	signature,
	resources,
}: {
	key: string;
	productKey: StaticLandblockProductKey;
	signature: string;
	resources: Webgl2StaticLandblockProductFamilyResources;
}): Webgl2StaticLandblockProductResource {
	const ownedResources = [...(resources.ownedResources ?? [])];
	return {
		key,
		productKey,
		signature,
		ownedResources,
		dispose() {
			for (const resource of ownedResources) {
				resource.dispose();
			}
		},
		updatePlacement(transforms) {
			for (const resource of ownedResources) {
				resource.updatePlacement?.(transforms);
			}
		},
		updateSamplerPolicy(policy) {
			for (const resource of ownedResources) {
				resource.updateSamplerPolicy?.(policy);
			}
		},
	};
}

function describeStaticLandblockProductResourceSignature(
	result: LandblockRenderProductWorkerResult,
): string {
	const terrain = getLandblockTerrainRenderArtifact(result);
	const detailed = getDetailedLandblockRenderArtifacts(result);
	return [
		result.landblockId,
		result.product,
		result.buildPolicyRevision,
		result.texturePagePolicyRevision,
		terrain?.artifactRevision ?? "terrain:none",
		...getStaticObjectBundleArtifacts(result).map((bundle) =>
			["static", bundle.key, bundle.sourceRevision].join(":"),
		),
		detailed
			? [
					"detailed",
					detailed.key,
					detailed.selectedEnvCellIds.join(","),
					detailed.structuredInteriorCells.length,
					detailed.structuredInteriorTexturePages
						.map((page) => page.key)
						.join(","),
				].join(":")
			: "detailed:none",
	].join("|");
}
