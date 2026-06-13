import { describe, expect, it, vi } from "vitest";

import type { LandblockRenderProductWorkerResult } from "../../landblock-render-product";
import { createWebgl2StaticLandblockProductStore } from "./static-landblock-product-store";

describe("webgl2 static landblock product store", () => {
	it("reuses the resident product for request-only recommits", () => {
		const store = createWebgl2StaticLandblockProductStore();
		const resource = createOwnedResource("resource");

		const first = store.commitProduct(createProductResult("request:first"), {
			ownedResources: [resource],
		});
		const second = store.commitProduct(createProductResult("request:second"), {
			ownedResources: [createOwnedResource("unused")],
		});

		expect(second).toBe(first);
		expect(store.productCount()).toBe(1);
		expect(store.ownedResourceCount()).toBe(1);
		expect(resource.dispose).not.toHaveBeenCalled();
	});

	it("replaces resources when product content signature changes", () => {
		const store = createWebgl2StaticLandblockProductStore();
		const firstResource = createOwnedResource("first");
		const secondResource = createOwnedResource("second");

		store.commitProduct(
			createProductResult("request:first", { product: "outdoor-env-cells" }),
			{
				ownedResources: [firstResource],
			},
		);
		store.commitProduct(
			createProductResult("request:second", {
				product: "outdoor-env-cells",
				artifacts: [createDetailedArtifact("detailed:changed")],
			}),
			{ ownedResources: [secondResource] },
		);

		expect(firstResource.dispose).toHaveBeenCalledTimes(1);
		expect(secondResource.dispose).not.toHaveBeenCalled();
		expect(store.productCount()).toBe(1);
		expect(store.ownedResourceCount()).toBe(1);
	});

	it("evicts and clears product resources by product key", () => {
		const store = createWebgl2StaticLandblockProductStore();
		const firstResource = createOwnedResource("first");
		const secondResource = createOwnedResource("second");
		const first = createProductResult("request:first");
		const second = createProductResult("request:second", {
			landblockId: 0xda56ffff,
		});

		store.commitProduct(first, { ownedResources: [firstResource] });
		store.commitProduct(second, { ownedResources: [secondResource] });
		store.evictProduct({
			landblockId: first.landblockId,
			product: first.product,
			buildPolicyRevision: first.buildPolicyRevision,
			texturePagePolicyRevision: first.texturePagePolicyRevision,
		});

		expect(firstResource.dispose).toHaveBeenCalledTimes(1);
		expect(secondResource.dispose).not.toHaveBeenCalled();
		expect(store.productCount()).toBe(1);

		store.clearProducts();

		expect(secondResource.dispose).toHaveBeenCalledTimes(1);
		expect(store.productCount()).toBe(0);
		expect(store.ownedResourceCount()).toBe(0);
	});

	it("forwards placement and sampler policy updates without recommit", () => {
		const store = createWebgl2StaticLandblockProductStore();
		const resource = createOwnedResource("resource");

		store.commitProduct(createProductResult("request:first"), {
			ownedResources: [resource],
		});
		store.updatePlacement([
			{
				chunkKey: "landblock/da55ffff",
				chunkLandblockId: 0xda55ffff,
				offset: { x: 1, y: 2, z: 3 },
			},
		]);
		store.updateSamplerPolicy("nearest");

		expect(resource.updatePlacement).toHaveBeenCalledTimes(1);
		expect(resource.updateSamplerPolicy).toHaveBeenCalledWith("nearest");
		expect(resource.dispose).not.toHaveBeenCalled();
	});
});

function createProductResult(
	requestId: string,
	overrides: Partial<LandblockRenderProductWorkerResult> = {},
): LandblockRenderProductWorkerResult {
	return {
		type: "landblock-render-product-built",
		jobId:
			"landblock-render-product:3663069183:outdoor-terrain:build:v1:texture-pages:v1",
		landblockId: 0xda55ffff,
		product: "outdoor-terrain",
		requestId,
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "texture-pages:v1",
		artifacts: [],
		diagnostics: {
			status: "ready",
			messages: [],
		},
		...overrides,
	};
}

function createOwnedResource(key: string) {
	return {
		key,
		dispose: vi.fn(),
		updatePlacement: vi.fn(),
		updateSamplerPolicy: vi.fn(),
	};
}

function createDetailedArtifact(
	key: string,
): LandblockRenderProductWorkerResult["artifacts"][number] {
	return {
		artifactKind: "detailed-landblock",
		key,
		landblockId: 0xda55ffff,
		product: "outdoor-env-cells",
		requestId: "request:test",
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "texture-pages:v1",
		selectedEnvCellIds: [],
		structuredInteriorMaterialRecords: [],
		structuredInteriorTexturePageRefs: [],
		structuredInteriorTexturePages: [],
		structuredInteriorCells: [],
		cellStructureMetadata: [],
		portalLinks: [],
		portalApertures: [],
		visibility: {
			objectVisibilityRecords: [],
			cellVisibilityRecords: [],
		},
		spatial: {
			envCellResidencyBvh: {
				coordinateSpace: "landblock-topology-residency",
				nodes: [],
				items: [],
			},
			envCellLocalBvhs: [],
		},
	};
}
