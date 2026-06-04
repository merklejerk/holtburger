import { describe, expect, it } from "vitest";

import { parseBrowserLocationInput } from "../../app/browser-mode";
import type {
	DesiredLandblockRenderPreset,
	LandblockRenderPresetWorkerResult,
} from "./landblock-render-preset";
import { StaticLandblockRenderArtifactCoordinator } from "./static-landblock-render-artifact-coordinator";

describe("static landblock render artifact coordinator", () => {
	it("submits desired presets through the worker client and commits completed artifacts", async () => {
		const client = new MockLandblockPresetClient();
		const snapshots: number[] = [];
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();
		const coordinator = new StaticLandblockRenderArtifactCoordinator({
			client,
			onStoreChanged: (snapshot) => snapshots.push(snapshot.residentCount),
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
			preset: "outdoor",
			buildPolicyRevision: "static-landblock-render:v1",
			texturePagePolicyRevision: "static-landblock-texture-pages:v1",
		});
		client.resolveNext(createResult(client.requests[0]!));
		await Promise.resolve();

		expect(coordinator.getSnapshot()).toMatchObject({
			desiredCount: 1,
			residentCount: 1,
			committedResultCount: 1,
		});
		expect(snapshots).toEqual([1]);
		coordinator.dispose();
	});

	it("reuses request identity for unchanged interest instead of resubmitting resident artifacts", async () => {
		const client = new MockLandblockPresetClient();
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
});

class MockLandblockPresetClient {
	readonly requests: DesiredLandblockRenderPreset[] = [];
	private readonly pending: Array<{
		resolve: (result: LandblockRenderPresetWorkerResult) => void;
		reject: (error: Error) => void;
	}> = [];
	disposed = false;

	requestPreset(
		desired: DesiredLandblockRenderPreset,
	): Promise<LandblockRenderPresetWorkerResult> {
		this.requests.push(desired);
		return new Promise((resolve, reject) => {
			this.pending.push({ resolve, reject });
		});
	}

	resolveNext(result: LandblockRenderPresetWorkerResult): void {
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
	desired: DesiredLandblockRenderPreset,
): LandblockRenderPresetWorkerResult {
	return {
		type: "landblock-render-preset-built",
		jobId: `job:${desired.requestId}`,
		landblockId: desired.landblockId,
		preset: desired.preset,
		requestId: desired.requestId,
		buildPolicyRevision: desired.buildPolicyRevision,
		texturePagePolicyRevision: desired.texturePagePolicyRevision,
		terrainArtifact: null,
		staticBundleLayers: [],
		diagnostics: {
			status: "ready",
			messages: [],
		},
	};
}
