import { describe, expect, it } from "vitest";

import type { DesiredLandblockRenderPreset } from "./landblock-render-preset";
import { StaticLandblockRenderArtifactStore } from "./static-landblock-render-artifact-store";

describe("static landblock render artifact store", () => {
	it("commits only latest desired preset results", () => {
		const store = new StaticLandblockRenderArtifactStore();
		const oldDesired = createDesired("request:old");
		const newDesired = createDesired("request:new");

		store.syncDesiredPresets([oldDesired]);
		expect(store.markInFlight(oldDesired)).toBe(true);
		store.syncDesiredPresets([newDesired]);
		expect(store.markInFlight(newDesired)).toBe(true);

		expect(store.commitResult(createResult("request:old"))).toBe(false);
		expect(store.commitResult(createResult("request:new"))).toBe(true);

		const snapshot = store.snapshot();
		expect(snapshot.residentCount).toBe(1);
		expect(snapshot.staleResultCount).toBe(1);
		expect(snapshot.committedResultCount).toBe(1);
		expect(snapshot.artifacts[0]?.requestId).toBe("request:new");
	});

	it("evicts resident artifacts outside the desired target set", () => {
		const store = new StaticLandblockRenderArtifactStore();
		const desired = createDesired("request:one");

		store.syncDesiredPresets([desired]);
		store.markInFlight(desired);
		expect(store.commitResult(createResult("request:one"))).toBe(true);
		store.syncDesiredPresets([]);

		const snapshot = store.snapshot();
		expect(snapshot.residentCount).toBe(0);
		expect(snapshot.desiredCount).toBe(0);
		expect(snapshot.evictedResultCount).toBe(1);
	});
});

function createDesired(requestId: string): DesiredLandblockRenderPreset {
	return {
		landblockId: 0xda55ffff,
		preset: "outdoor",
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
		type: "landblock-render-preset-built" as const,
		jobId: `job:${requestId}`,
		landblockId: 0xda55ffff,
		preset: "outdoor" as const,
		requestId,
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "texture-pages:v1",
		terrainArtifact: null,
		staticBundleLayers: [],
		diagnostics: {
			status: "ready" as const,
			messages: [],
		},
	};
}
