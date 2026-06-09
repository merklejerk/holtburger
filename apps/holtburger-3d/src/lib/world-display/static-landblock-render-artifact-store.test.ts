import { describe, expect, it } from "vitest";

import type { DesiredLandblockRenderProduct } from "./landblock-render-product";
import { StaticLandblockRenderArtifactStore } from "./static-landblock-render-artifact-store";

describe("static landblock render artifact store", () => {
	it("commits only latest desired product results", () => {
		const store = new StaticLandblockRenderArtifactStore();
		const oldDesired = createDesired("request:old");
		const newDesired = createDesired("request:new");

		store.syncDesiredProducts([oldDesired]);
		expect(store.markInFlight(oldDesired)).toBe(true);
		store.syncDesiredProducts([newDesired]);
		expect(store.markInFlight(newDesired)).toBe(true);

		expect(store.commitResult(createResult("request:old"))).toBe(false);
		expect(store.commitResult(createResult("request:new"))).toBe(true);

		const productSet = store.productSet();
		expect(productSet.residentCount).toBe(1);
		expect(productSet.staleResultCount).toBe(1);
		expect(productSet.committedResultCount).toBe(1);
		expect(productSet.artifacts[0]?.requestId).toBe("request:new");
	});

	it("evicts resident artifacts outside the desired target set", () => {
		const store = new StaticLandblockRenderArtifactStore();
		const desired = createDesired("request:one");

		store.syncDesiredProducts([desired]);
		store.markInFlight(desired);
		expect(store.commitResult(createResult("request:one"))).toBe(true);
		store.syncDesiredProducts([]);

		const productSet = store.productSet();
		expect(productSet.residentCount).toBe(0);
		expect(productSet.desiredCount).toBe(0);
		expect(productSet.evictedResultCount).toBe(1);
	});
});

function createDesired(requestId: string): DesiredLandblockRenderProduct {
	return {
		landblockId: 0xda55ffff,
		product: "outdoor-terrain",
		priority: "resident-now",
		requestId,
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "texture-pages:v1",
		buildPolicy: {
			atlasLayout: {
				maxTextureSize: 64,
				maxTextureCount: 4,
				gutterPixels: 0,
			},
			terrainMaxLayerEntries: 8,
		},
	};
}

function createResult(requestId: string) {
	return {
		type: "landblock-render-product-built" as const,
		jobId: `job:${requestId}`,
		landblockId: 0xda55ffff,
		product: "outdoor-terrain" as const,
		requestId,
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "texture-pages:v1",
		artifacts: [],
		diagnostics: {
			status: "ready" as const,
			messages: [],
		},
	};
}
