import { describe, expect, it } from "vitest";

import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
} from "../host/contracts";
import type { AssetPreparationGateway } from "./asset-channel";
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

		expect(gateway.prepareAssetIds).toEqual([
			"synthetic/root",
			"synthetic/leaf-a",
			"synthetic/leaf-b",
		]);
		expect(gateway.prepareBatches).toEqual([
			["synthetic/root"],
			["synthetic/leaf-a", "synthetic/leaf-b"],
		]);
		expect(
			result.preparedAssets.map((asset) => asset.request.assetId).sort(),
		).toEqual(["synthetic/leaf-a", "synthetic/leaf-b", "synthetic/root"]);
		expect(result.dependencyStatus).toMatchObject({
			status: "ready",
			dependencyAssetIds: ["synthetic/leaf-a", "synthetic/leaf-b"],
		});
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
			gateway.prepareAssetIds.filter(
				(assetId) => assetId === "synthetic/shared",
			),
		).toHaveLength(1);
	});

	it("fails hard when preparation fails", async () => {
		const gateway = new FakeGraphGateway({});
		gateway.failPrepareAssetIds.add("synthetic/root");
		const scheduler = new AssetGraphScheduler(gateway);

		await expect(
			scheduler.prepareAssetGraph({
				requestId: "root",
				assetId: "synthetic/root",
				priority: "streaming",
			}),
		).rejects.toThrow("prepare failed for synthetic/root");
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
	readonly prepareBatches: string[][] = [];
	readonly prepareAssetIds: string[] = [];
	readonly failPrepareAssetIds = new Set<string>();

	constructor(
		private readonly dependenciesByAssetId: Record<string, string[]>,
	) {}

	async prepareAssets(
		requests: readonly AssetLookupRequestDto[],
	): Promise<PreparedAssetRecord[]> {
		this.prepareBatches.push(requests.map((request) => request.assetId));
		return Promise.all(requests.map((request) => this.prepareOne(request)));
	}

	private async prepareOne(
		request: AssetLookupRequestDto,
	): Promise<PreparedAssetRecord> {
		this.prepareAssetIds.push(request.assetId);
		if (this.failPrepareAssetIds.has(request.assetId)) {
			throw new Error(`prepare failed for ${request.assetId}`);
		}
		return createPreparedAsset(
			request,
			createResponse(
				request,
				this.dependenciesByAssetId[request.assetId] ?? [],
			),
		);
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
			kind: "setup-model",
			residencyKind: "unknown",
			sourceAssetKind: "setup-model",
			setupModelId: 0x02000001,
			flags: null,
			parts: [],
			holdingLocations: [],
			connectionPoints: [],
			placementSets: [],
			collisionWitness: { cylSphereCount: 0, sphereCount: 0 },
			height: null,
			radius: null,
			stepUp: null,
			stepDown: null,
			sortingSphere: null,
			selectionSphere: null,
			lights: [],
			defaultAnimation: null,
			defaultScript: null,
			defaultMotionTable: null,
			defaultSoundTable: null,
			defaultScriptTable: null,
			dependencies: {
				gfxObjAssetIds: dependencyAssetIds,
			},
			provenance: {
				source: "unknown",
				sourceAssetKind: "setup-model",
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
		"dependencies" in response.payload &&
		typeof response.payload.dependencies === "object" &&
		response.payload.dependencies !== null &&
		"gfxObjAssetIds" in response.payload.dependencies &&
		Array.isArray(response.payload.dependencies.gfxObjAssetIds)
			? response.payload.dependencies.gfxObjAssetIds.filter(
					(assetId): assetId is string => typeof assetId === "string",
				)
			: [];
	const sortedDependencyAssetIds = [...dependencyAssetIds].sort();

	return {
		request,
		response,
		preparedAt: "2026-01-01T00:00:00.000Z",
		payload: {
			kind: "setup-model",
			residencyKind: "unknown",
			sourceAssetKind: "setup-model",
			setupModelId: 0x02000001,
			flags: null,
			parts: [],
			holdingLocations: [],
			connectionPoints: [],
			placementSets: [],
			collisionWitness: { cylSphereCount: 0, sphereCount: 0 },
			height: null,
			radius: null,
			stepUp: null,
			stepDown: null,
			sortingSphere: null,
			selectionSphere: null,
			lights: [],
			defaultAnimation: null,
			defaultScript: null,
			defaultMotionTable: null,
			defaultSoundTable: null,
			defaultScriptTable: null,
			dependencies: {
				gfxObjAssetIds: sortedDependencyAssetIds,
			},
			provenance: {
				source: "unknown",
				sourceAssetKind: "setup-model",
				errorCode: null,
				detail: "synthetic graph test",
			},
		},
	};
}
