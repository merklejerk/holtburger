import { describe, expect, it } from "vitest";
import type {
	RuntimeHost,
	RuntimeHostSnapshot,
} from "../host/runtime-contracts";
import type { HostAssetKey, PreparedAsset } from "./contracts";
import { HostBackedAssetService } from "./asset-service";

describe("host-backed asset service lifecycle", () => {
	it("dedupes in-flight preparation and only leases committed assets", async () => {
		const key: HostAssetKey = { id: "da55ffff", kind: "landblock-outdoor" };
		let resolveLookup: (asset: PreparedAsset) => void = () => {
			throw new Error("lookup promise was not initialized");
		};
		const lookup = new Promise<PreparedAsset>((resolve) => {
			resolveLookup = resolve;
		});
		const host = new FakeRuntimeHost(() => lookup);
		const service = new HostBackedAssetService({ host });

		const first = service.requestPreparedAsset(key);
		const second = service.requestPreparedAsset(key);

		expect(host.lookupCount).toBe(1);
		expect(service.createSnapshot()).toEqual({
			committed: [],
			pending: [
				{
					key,
					revision: 1,
					waiterCount: 2,
				},
			],
		});
		expect(() => service.acquirePreparedAssetLease(key)).toThrow(
			"Cannot lease prepared asset before it is committed",
		);

		resolveLookup(createPreparedAsset(key, 99));

		await expect(first).resolves.toMatchObject({ key, revision: 1 });
		await expect(second).resolves.toMatchObject({ key, revision: 1 });

		const lease = service.acquirePreparedAssetLease(key);
		expect(service.createSnapshot().committed).toEqual([
			{
				key,
				leaseCount: 1,
				revision: 1,
				sourceAssetId: "landblock/da55ffff/outdoor",
				warmRetainedUntilMs: null,
			},
		]);

		lease.release();
		expect(service.createSnapshot().committed[0]?.leaseCount).toBe(0);
	});

	it("warm-retains unleased committed assets before pruning", async () => {
		const nowMs = 1_000;
		const key: HostAssetKey = { id: "04000001", kind: "palette" };
		const service = new HostBackedAssetService({
			host: new FakeRuntimeHost((requestedKey, revision) =>
				Promise.resolve(createPreparedAsset(requestedKey, revision)),
			),
			nowMs: () => nowMs,
			warmRetentionMs: 50,
		});

		await service.requestPreparedAsset(key);
		expect(service.createSnapshot().committed[0]?.warmRetainedUntilMs).toBe(
			1050,
		);

		const lease = service.acquirePreparedAssetLease(key);
		expect(
			service.createSnapshot().committed[0]?.warmRetainedUntilMs,
		).toBeNull();
		lease.release();
		expect(service.createSnapshot().committed[0]?.warmRetainedUntilMs).toBe(
			1050,
		);

		expect(service.pruneExpiredWarmAssets(1049)).toBe(0);
		expect(service.createSnapshot().committed).toHaveLength(1);

		expect(service.pruneExpiredWarmAssets(1050)).toBe(1);
		expect(service.createSnapshot().committed).toEqual([]);
	});

	it("drops failed requests and retries with a new revision", async () => {
		const key: HostAssetKey = { id: "06000001", kind: "render-surface" };
		let shouldFail = true;
		const service = new HostBackedAssetService({
			host: new FakeRuntimeHost((requestedKey, revision) => {
				if (shouldFail) {
					return Promise.reject(new Error("host said nope"));
				}

				return Promise.resolve(createPreparedAsset(requestedKey, revision));
			}),
		});

		await expect(service.requestPreparedAsset(key)).rejects.toThrow(
			"host said nope",
		);
		expect(service.createSnapshot().pending).toEqual([]);
		expect(service.createSnapshot().committed).toEqual([]);

		shouldFail = false;
		await service.requestPreparedAsset(key);
		expect(service.createSnapshot().committed[0]?.revision).toBe(2);
	});
});

class FakeRuntimeHost implements RuntimeHost {
	lookupCount = 0;

	constructor(
		private readonly lookup: (
			key: HostAssetKey,
			revision: number,
		) => Promise<PreparedAsset>,
	) {}

	lookupAsset(key: HostAssetKey, revision: number): Promise<PreparedAsset> {
		this.lookupCount += 1;
		return this.lookup(key, revision);
	}

	createSnapshot(): RuntimeHostSnapshot {
		return {
			failure: null,
			isAvailable: true,
		};
	}
}

function createPreparedAsset(
	key: HostAssetKey,
	revision: number,
): PreparedAsset {
	return {
		key,
		payload: { ok: true },
		preparedAt: "2026-06-10T00:00:00.000Z",
		revision,
		sourceAssetId:
			key.kind === "landblock-outdoor"
				? `landblock/${key.id}/outdoor`
				: `${key.kind}/${key.id}`,
	};
}
