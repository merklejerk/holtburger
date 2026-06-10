import { describe, expect, it } from "vitest";
import {
	DeferredStaticBakerClient,
	DeferredStaticResolverClient,
} from "../fake-workers";
import type { StaticDemand } from "../contracts";
import { StaticCoordinator } from "./static-coordinator";

describe("V2 static coordinator", () => {
	it("rejects stale resolver results after a newer demand revision supersedes them", async () => {
		const resolver = new DeferredStaticResolverClient();
		const baker = new DeferredStaticBakerClient();
		const coordinator = new StaticCoordinator({ baker, resolver });

		const [firstRequest] = coordinator.requestStaticDemand(
			createSingleTerrainDemand(0xda55ffff),
		);
		const [secondRequest] = coordinator.requestStaticDemand(
			createSingleTerrainDemand(0xda56ffff),
		);

		resolver.complete(firstRequest.requestId);
		await flushPromises();

		expect(coordinator.createSnapshot()).toMatchObject({
			committed: 0,
			staleResolverResults: 1,
		});
		expect(baker.pendingInputs).toHaveLength(0);

		resolver.complete(secondRequest.requestId);
		await flushPromises();
		baker.complete(secondRequest.requestId);
		await flushPromises();

		expect(coordinator.createSnapshot()).toMatchObject({
			committed: 1,
			committedDrawUnits: 1,
			staleResolverResults: 1,
		});
	});

	it("rejects stale bake results after a newer demand revision supersedes them", async () => {
		const resolver = new DeferredStaticResolverClient();
		const baker = new DeferredStaticBakerClient();
		const coordinator = new StaticCoordinator({ baker, resolver });

		const [firstRequest] = coordinator.requestStaticDemand(
			createSingleTerrainDemand(0xda55ffff),
		);
		resolver.complete(firstRequest.requestId);
		await flushPromises();

		expect(baker.pendingInputs).toHaveLength(1);

		coordinator.requestStaticDemand(createSingleTerrainDemand(0xda56ffff));
		baker.complete(firstRequest.requestId);
		await flushPromises();

		expect(coordinator.createSnapshot()).toMatchObject({
			committed: 0,
			staleBakeResults: 1,
		});
	});

	it("tracks revisions on pending work without asset lease concepts", () => {
		const resolver = new DeferredStaticResolverClient();
		const baker = new DeferredStaticBakerClient();
		const coordinator = new StaticCoordinator({ baker, resolver });

		coordinator.requestStaticDemand(createSingleTerrainDemand(0xda55ffff));

		expect(coordinator.createSnapshot().activeRequests).toEqual([
			{
				domain: "terrain",
				requestId: "1:landblock:da55ffff:terrain",
				revision: 1,
				scopeKey: "landblock:da55ffff",
				status: "resolving",
			},
		]);
		expect(JSON.stringify(coordinator.createSnapshot())).not.toContain("lease");
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
			envCells: -1,
			terrain: 0,
		},
		policyRevision: 1,
	};
}

async function flushPromises(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}
