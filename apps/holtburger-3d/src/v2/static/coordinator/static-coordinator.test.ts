import { describe, expect, it } from "vitest";
import {
	DeferredStaticBaker,
	DeferredStaticResolver,
} from "../fake-workers";
import type {
	StaticCoordinatorCommitDelta,
	StaticDemand,
	StaticDrawUnit,
} from "../contracts";
import { StaticCoordinator } from "./static-coordinator";

describe("V2 static coordinator", () => {
	it("rejects stale resolver results after a newer demand revision supersedes them", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});

		const [firstWork] = coordinator.requestStaticDemand(
			createSingleTerrainDemand(0xda55ffff),
		);
		const [secondWork] = coordinator.requestStaticDemand(
			createSingleTerrainDemand(0xda56ffff),
		);
		const firstResolverRequest = resolver.pendingRequests[0];
		const secondResolverRequest = resolver.pendingRequests[1];

		expect(firstWork.job).toEqual(firstResolverRequest?.job);
		resolver.complete(firstResolverRequest?.requestId ?? "");
		await flushPromises();

		expect(coordinator.createSnapshot()).toMatchObject({
			committed: 0,
			staleResolverResults: 1,
		});
		expect(baker.pendingInputs).toHaveLength(0);

		resolver.complete(secondResolverRequest?.requestId ?? "");
		await flushPromises();
		baker.complete(secondWork.workId);
		await flushPromises();

		expect(coordinator.createSnapshot()).toMatchObject({
			committed: 1,
			committedDrawUnits: 1,
			staleResolverResults: 1,
		});
	});

	it("rejects stale bake results after a newer demand revision supersedes them", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});

		const [firstWork] = coordinator.requestStaticDemand(
			createSingleTerrainDemand(0xda55ffff),
		);
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();

		expect(baker.pendingInputs).toHaveLength(1);

		coordinator.requestStaticDemand(createSingleTerrainDemand(0xda56ffff));
		baker.complete(firstWork.workId);
		await flushPromises();

		expect(coordinator.createSnapshot()).toMatchObject({
			committed: 0,
			staleBakeResults: 1,
		});
	});

	it("tracks revisions on pending work without asset lease concepts", () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});

		coordinator.requestStaticDemand(createSingleTerrainDemand(0xda55ffff));

		expect(coordinator.createSnapshot().activeWork).toEqual([
			{
				domain: "outdoor-terrain",
				failureMessage: null,
				revision: 1,
				scopeKey: "landblock:da55ffff",
				status: "resolving",
				workId: "1:landblock:da55ffff:outdoor-terrain",
			},
		]);
		expect(JSON.stringify(coordinator.createSnapshot())).not.toContain("lease");
	});

	it("emits committed draw-unit deltas and eviction deltas", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});
		const deltas: StaticCoordinatorCommitDelta[] = [];
		coordinator.subscribeCommits((delta) => deltas.push(delta));

		const [work] = coordinator.requestStaticDemand(
			createSingleTerrainDemand(0xda55ffff),
		);
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		baker.complete(work.workId, {
			drawUnits: [createPlaceholderDrawUnit("terrain-a")],
		});
		await flushPromises();

		expect(deltas).toEqual([
			{
				addedDrawUnits: [createPlaceholderDrawUnit("terrain-a")],
				removedDrawUnitIds: [],
				revision: 1,
				staticBatchId: "static-batch:1:outdoor-terrain:landblock:da55ffff:1",
				textureUses: [],
			},
		]);
		expect(coordinator.createSnapshot().committedDrawUnits).toBe(1);

		coordinator.requestStaticDemand({
			location: null,
			lod: {
				buildings: -1,
				detail: -1,
				terrain: -1,
				topology: -1,
			},
		});

		expect(deltas.at(-1)).toEqual({
			addedDrawUnits: [],
			removedDrawUnitIds: ["terrain-a"],
			revision: 2,
			staticBatchId: "static-batch:2:evict",
			textureUses: [],
		});
		expect(coordinator.createSnapshot().committedDrawUnits).toBe(0);
	});

	it("groups same-domain resolved payloads into one static bake batch", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: {
				maxPayloadsPerBatch: 8,
				maxWaitMs: 0,
			},
			resolver,
		});

		const work = coordinator.requestStaticDemand({
			location: {
				kind: "outdoor-landblock",
				landblockId: 0xda55ffff,
			},
			lod: {
				buildings: -1,
				detail: -1,
				terrain: 1,
				topology: -1,
			},
		});
		const terrainWork = work.filter(
			(item) => item.job.domain === "outdoor-terrain",
		);

		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		resolver.complete(resolver.pendingRequests[1]?.requestId ?? "");
		await flushPromises();

		expect(baker.pendingInputs).toHaveLength(1);
		expect(baker.pendingInputs[0]).toMatchObject({
			domain: "outdoor-terrain",
			revision: 1,
			staticBatchId: "static-batch:1:outdoor-terrain:landblock:da55ffff:2",
		});
		expect(
			baker.pendingInputs[0]?.items.map((item) => item.work.workId),
		).toEqual(terrainWork.slice(0, 2).map((item) => item.workId));

		baker.complete(baker.pendingInputs[0]?.staticBatchId ?? "");
		await flushPromises();

		expect(coordinator.createSnapshot()).toMatchObject({
			committed: 2,
			committedDrawUnits: 2,
		});
	});
});

function createSingleTerrainDemand(landblockId: number): StaticDemand {
	return {
		location: {
			kind: "outdoor-landblock",
			landblockId,
		},
		lod: {
			buildings: -1,
			detail: -1,
			terrain: 0,
			topology: -1,
		},
	};
}

async function flushPromises(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

function createPlaceholderDrawUnit(drawUnitId: string): StaticDrawUnit {
	return {
		drawUnitId,
		kind: "placeholder",
	};
}
