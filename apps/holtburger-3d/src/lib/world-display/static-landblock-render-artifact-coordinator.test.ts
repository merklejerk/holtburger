import { describe, expect, it } from "vitest";

import { parseBrowserLocationInput } from "../../app/browser-mode";
import type {
	DesiredLandblockRenderProduct,
	LandblockRenderProductWorkerResult,
} from "./landblock-render-product";
import { StaticLandblockRenderArtifactCoordinator } from "./static-landblock-render-artifact-coordinator";

describe("static landblock render artifact coordinator", () => {
	it("submits desired products through the worker client and commits completed artifacts", async () => {
		const client = new MockLandblockProductClient();
		const productSets: number[] = [];
		const committedRequestIds: string[] = [];
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();
		const coordinator = new StaticLandblockRenderArtifactCoordinator({
			client,
			onProductCommitted: (result) => {
				committedRequestIds.push(result.requestId);
			},
			onStoreChanged: (productSet) => productSets.push(productSet.residentCount),
		});

		coordinator.sync({
			browserDestination: destination,
			terrainLodRadius: 0,
			buildingLodRadius: -1,
			detailLodRadius: -1,
			envCellLodRadius: -1,
		});

		expect(client.requests).toHaveLength(1);
		expect(client.requests[0]).toMatchObject({
			landblockId: 0xda55ffff,
			product: "outdoor",
			buildPolicyRevision: "static-landblock-render:v1",
			texturePagePolicyRevision: "static-landblock-texture-pages:v1",
		});
		client.resolveNext(createResult(client.requests[0]!));
		await Promise.resolve();

		expect(coordinator.getProductSet()).toMatchObject({
			desiredCount: 1,
			residentCount: 1,
			committedResultCount: 1,
		});
		expect(committedRequestIds).toEqual([client.requests[0]!.requestId]);
		expect(productSets).toEqual([1]);
		coordinator.dispose();
	});

	it("emits product eviction callbacks when desired targets leave residency", async () => {
		const client = new MockLandblockProductClient();
		const evictedKeys: string[] = [];
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();
		const coordinator = new StaticLandblockRenderArtifactCoordinator({
			client,
			onProductEvicted: (key) => {
				evictedKeys.push(`${key.landblockId}:${key.product}`);
			},
		});

		coordinator.sync({
			browserDestination: destination,
			terrainLodRadius: 0,
			buildingLodRadius: -1,
			detailLodRadius: -1,
			envCellLodRadius: -1,
		});
		client.resolveNext(createResult(client.requests[0]!));
		await Promise.resolve();
		coordinator.sync({
			browserDestination: null,
			terrainLodRadius: 0,
			buildingLodRadius: -1,
			detailLodRadius: -1,
			envCellLodRadius: -1,
		});

		expect(evictedKeys).toEqual(["3663069183:outdoor"]);
		coordinator.dispose();
	});

	it("reuses request identity for unchanged interest instead of resubmitting resident artifacts", async () => {
		const client = new MockLandblockProductClient();
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();
		const coordinator = new StaticLandblockRenderArtifactCoordinator({
			client,
		});
		const input = {
			browserDestination: destination,
			terrainLodRadius: 0,
			buildingLodRadius: -1,
			detailLodRadius: -1,
			envCellLodRadius: -1,
		};

		coordinator.sync(input);
		const firstRequestId = client.requests[0]?.requestId;
		client.resolveNext(createResult(client.requests[0]!));
		await Promise.resolve();
		coordinator.sync(input);

		expect(client.requests).toHaveLength(1);
		expect(firstRequestId).toBe("static-landblock-render:1");
		coordinator.dispose();
	});

	it("submits dungeon env-cell products for indoor destinations", () => {
		const client = new MockLandblockProductClient();
		const destination = parseBrowserLocationInput("da550100", "manual", "dungeon");
		expect(destination).not.toBeNull();
		const coordinator = new StaticLandblockRenderArtifactCoordinator({
			client,
		});

		coordinator.sync({
			browserDestination: destination,
			terrainLodRadius: 0,
			buildingLodRadius: 0,
			detailLodRadius: 0,
			envCellLodRadius: 0,
		});

		expect(client.requests).toHaveLength(1);
		expect(client.requests[0]).toMatchObject({
			landblockId: 0xda55ffff,
			product: "dungeon-env-cells",
			priority: "resident-now",
			buildPolicyRevision: "static-landblock-render:v1",
			texturePagePolicyRevision: "static-landblock-texture-pages:v1",
		});
		coordinator.dispose();
	});

	it("can temporarily filter desired products before worker submission", () => {
		const client = new MockLandblockProductClient();
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();
		const coordinator = new StaticLandblockRenderArtifactCoordinator({
			client,
			renderRegressionDiagnostics: {
				enabled: false,
				productFilter: new Set(["outdoor-env-cells"]),
				uploadFilter: null,
			},
		});

		coordinator.sync({
			browserDestination: destination,
			terrainLodRadius: 0,
			buildingLodRadius: 0,
			detailLodRadius: 0,
			envCellLodRadius: 0,
		});

		expect(client.requests).toHaveLength(1);
		expect(client.requests[0]).toMatchObject({
			landblockId: 0xda55ffff,
			product: "outdoor-env-cells",
		});
		coordinator.dispose();
	});
});

class MockLandblockProductClient {
	readonly requests: DesiredLandblockRenderProduct[] = [];
	private readonly pending: Array<{
		resolve: (result: LandblockRenderProductWorkerResult) => void;
		reject: (error: Error) => void;
	}> = [];
	disposed = false;

	requestProduct(
		desired: DesiredLandblockRenderProduct,
	): Promise<LandblockRenderProductWorkerResult> {
		this.requests.push(desired);
		return new Promise((resolve, reject) => {
			this.pending.push({ resolve, reject });
		});
	}

	resolveNext(result: LandblockRenderProductWorkerResult): void {
		const pending = this.pending.shift();
		if (!pending) {
			throw new Error("No pending worker request.");
		}
		pending.resolve(result);
	}

	dispose(): void {
		this.disposed = true;
		for (const pending of this.pending.splice(0)) {
			pending.reject(new Error("disposed"));
		}
	}
}

function createResult(
	desired: DesiredLandblockRenderProduct,
): LandblockRenderProductWorkerResult {
	return {
		type: "landblock-render-product-built",
		jobId: `job:${desired.requestId}`,
		landblockId: desired.landblockId,
		product: desired.product,
		requestId: desired.requestId,
		buildPolicyRevision: desired.buildPolicyRevision,
		texturePagePolicyRevision: desired.texturePagePolicyRevision,
		artifacts: [],
		diagnostics: {
			status: "ready",
			messages: [],
		},
	};
}
