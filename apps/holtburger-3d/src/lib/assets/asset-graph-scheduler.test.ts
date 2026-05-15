import { describe, expect, it } from "vitest";

import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
} from "../host/contracts";
import type {
	AssetPreparationGateway,
	LookedUpAssetResponse,
} from "./asset-channel";
import {
	AssetGraphScheduler,
	createDependencyRequest,
} from "./asset-graph-scheduler";
import type { PreparedAssetRecord } from "./types";

describe("asset graph scheduler", () => {
	it("prepares a root with no dependencies through the injected gateway", async () => {
		const gateway = new FakeGraphGateway({
			"synthetic/root": [],
		});
		const scheduler = new AssetGraphScheduler(gateway);

		const result = await scheduler.prepareAssetGraph({
			requestId: "root",
			assetId: "synthetic/root",
			priority: "streaming",
		});

		expect(gateway.lookupAssetIds).toEqual(["synthetic/root"]);
		expect(gateway.prepareAssetIds).toEqual(["synthetic/root"]);
		expect(result.rootAsset.request.assetId).toBe("synthetic/root");
		expect(result.preparedAssets.map((asset) => asset.request.assetId)).toEqual(
			["synthetic/root"],
		);
		expect(result.dependencyStatus.status).toBe("ready");
	});

	it("walks dependencies without knowing about Tauri or worker internals", async () => {
		const gateway = new FakeGraphGateway({
			"synthetic/root": ["synthetic/leaf-b", "synthetic/leaf-a"],
			"synthetic/leaf-a": [],
			"synthetic/leaf-b": [],
		});
		const scheduler = new AssetGraphScheduler(gateway);

		const result = await scheduler.prepareAssetGraph({
			requestId: "root",
			assetId: "synthetic/root",
			priority: "bootstrap",
		});

		expect(gateway.lookupAssetIds).toEqual([
			"synthetic/root",
			"synthetic/leaf-b",
			"synthetic/leaf-a",
		]);
		expect(Object.keys(result.preparedByAssetId).sort()).toEqual([
			"synthetic/leaf-a",
			"synthetic/leaf-b",
			"synthetic/root",
		]);
		expect(result.dependencyStatus).toMatchObject({
			status: "ready",
			dependencyAssetIds: ["synthetic/leaf-a", "synthetic/leaf-b"],
		});
	});

	it("starts dependency lookups before root worker preparation completes", async () => {
		const gateway = new FakeGraphGateway({
			"synthetic/root": ["synthetic/leaf-a", "synthetic/leaf-b"],
			"synthetic/leaf-a": [],
			"synthetic/leaf-b": [],
		});
		const releaseRootPreparation = gateway.blockPreparation("synthetic/root");
		const scheduler = new AssetGraphScheduler(gateway);

		const graph = scheduler.prepareAssetGraph({
			requestId: "root",
			assetId: "synthetic/root",
			priority: "streaming",
		});
		await waitForMicrotasks(20);

		expect(gateway.lookupAssetIds).toEqual([
			"synthetic/root",
			"synthetic/leaf-a",
			"synthetic/leaf-b",
		]);

		releaseRootPreparation();
		await graph;
	});

	it("does not let slow worker preparation consume a lookup slot", async () => {
		const gateway = new FakeGraphGateway({
			"synthetic/root": ["synthetic/leaf-a", "synthetic/leaf-b"],
			"synthetic/leaf-a": [],
			"synthetic/leaf-b": [],
		});
		const releaseRootPreparation = gateway.blockPreparation("synthetic/root");
		const scheduler = new AssetGraphScheduler(gateway, {
			lookupConcurrencyLimit: 1,
		});

		const graph = scheduler.prepareAssetGraph({
			requestId: "root",
			assetId: "synthetic/root",
			priority: "streaming",
		});
		await waitForMicrotasks(20);

		expect(gateway.lookupAssetIds).toContain("synthetic/leaf-a");

		releaseRootPreparation();
		await graph;
	});

	it("looks up a shared dependency once inside one graph", async () => {
		const gateway = new FakeGraphGateway({
			"synthetic/root": ["synthetic/shared", "synthetic/shared"],
			"synthetic/shared": [],
		});
		const scheduler = new AssetGraphScheduler(gateway);

		await scheduler.prepareAssetGraph({
			requestId: "root",
			assetId: "synthetic/root",
			priority: "streaming",
		});

		expect(
			gateway.lookupAssetIds.filter(
				(assetId) => assetId === "synthetic/shared",
			),
		).toHaveLength(1);
	});

	it("fails hard when lookup fails", async () => {
		const gateway = new FakeGraphGateway({});
		gateway.failLookupAssetIds.add("synthetic/root");
		const scheduler = new AssetGraphScheduler(gateway);

		await expect(
			scheduler.prepareAssetGraph({
				requestId: "root",
				assetId: "synthetic/root",
				priority: "streaming",
			}),
		).rejects.toThrow("lookup failed for synthetic/root");
	});

	it("creates dependency requests from the root request metadata", () => {
		expect(
			createDependencyRequest(
				{
					requestId: "root-request",
					assetId: "synthetic/root",
					priority: "bootstrap",
				},
				"synthetic/leaf",
			),
		).toEqual({
			requestId: "root-request-dependency-synthetic/leaf",
			assetId: "synthetic/leaf",
			priority: "bootstrap",
		});
	});
});

class FakeGraphGateway implements AssetPreparationGateway {
	readonly lookupAssetIds: string[] = [];
	readonly prepareAssetIds: string[] = [];
	readonly failLookupAssetIds = new Set<string>();
	private readonly preparationGatesByAssetId = new Map<string, Promise<void>>();

	constructor(
		private readonly dependenciesByAssetId: Record<string, string[]>,
	) {}

	async lookupAssetResponse(
		request: AssetLookupRequestDto,
	): Promise<LookedUpAssetResponse> {
		this.lookupAssetIds.push(request.assetId);
		if (this.failLookupAssetIds.has(request.assetId)) {
			throw new Error(`lookup failed for ${request.assetId}`);
		}

		const dependencyAssetIds =
			this.dependenciesByAssetId[request.assetId] ?? [];
		return {
			request,
			response: createResponse(request, dependencyAssetIds),
			dependencyAssetIds,
		};
	}

	async prepareLookedUpAsset(
		lookedUp: LookedUpAssetResponse,
		request: AssetLookupRequestDto,
	): Promise<PreparedAssetRecord> {
		this.prepareAssetIds.push(request.assetId);
		await this.preparationGatesByAssetId.get(request.assetId);
		return createPreparedAsset(request, lookedUp.response);
	}

	blockPreparation(assetId: string): () => void {
		let release = () => {};
		this.preparationGatesByAssetId.set(
			assetId,
			new Promise<void>((resolve) => {
				release = resolve;
			}),
		);
		return release;
	}
}

function createResponse(
	request: AssetLookupRequestDto,
	dependencyAssetIds: string[],
): AssetLookupResponseDto {
	return {
		requestId: request.requestId,
		assetId: request.assetId,
		payloadKind: "json",
		payload: {
			kind: "dependency-manifest",
			residencyKind: "unknown",
			dependencyAssetIds,
			provenance: {
				source: "unknown",
				sourceAssetKind: "dependency-manifest",
				errorCode: null,
				detail: "synthetic graph test",
			},
		},
	};
}

function createPreparedAsset(
	request: AssetLookupRequestDto,
	response: AssetLookupResponseDto,
): PreparedAssetRecord {
	const dependencyAssetIds =
		typeof response.payload === "object" &&
		response.payload !== null &&
		"dependencyAssetIds" in response.payload &&
		Array.isArray(response.payload.dependencyAssetIds)
			? response.payload.dependencyAssetIds.filter(
					(assetId): assetId is string => typeof assetId === "string",
				)
			: [];
	const sortedDependencyAssetIds = [...dependencyAssetIds].sort();

	return {
		request,
		response,
		preparedAt: "2026-01-01T00:00:00.000Z",
		payload: {
			kind: "dependency-manifest",
			residencyKind: "unknown",
			sourceAssetKind: "dependency-manifest",
			dependencyAssetIds: sortedDependencyAssetIds,
			provenance: {
				source: "unknown",
				sourceAssetKind: "dependency-manifest",
				errorCode: null,
				detail: "synthetic graph test",
			},
		},
	};
}

async function waitForMicrotasks(iterations = 4): Promise<void> {
	for (let index = 0; index < iterations; index += 1) {
		await Promise.resolve();
	}
}
