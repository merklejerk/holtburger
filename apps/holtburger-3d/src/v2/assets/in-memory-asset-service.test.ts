import { describe, expect, it } from "vitest";
import type { HostAssetKey, PreparedAsset } from "./contracts";
import { InMemoryAssetService } from "./in-memory-asset-service";

describe("V2 in-memory asset service lifecycle", () => {
	it("uses pending waiters and revisions before prepared assets are committed", async () => {
		const service = new InMemoryAssetService();
		const key: HostAssetKey = { id: "da55ffff", kind: "landblock" };
		let resolveLoad: (asset: PreparedAsset) => void = () => {
			throw new Error("load promise was not initialized");
		};
		const load = new Promise<PreparedAsset>((resolve) => {
			resolveLoad = resolve;
		});

		const first = service.requestPreparedAsset(key, () => load);
		const second = service.requestPreparedAsset(key, () => {
			throw new Error("duplicate request should reuse the pending load");
		});

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

		resolveLoad({
			key,
			payload: { ok: true },
			revision: 99,
		});

		await expect(first).resolves.toEqual({
			key,
			payload: { ok: true },
			revision: 1,
		});
		await expect(second).resolves.toEqual({
			key,
			payload: { ok: true },
			revision: 1,
		});

		const lease = service.acquirePreparedAssetLease(key);
		expect(service.createSnapshot()).toEqual({
			committed: [
				{
					key,
					leaseCount: 1,
					revision: 1,
				},
			],
			pending: [],
		});

		lease.release();
		expect(service.createSnapshot().committed[0]?.leaseCount).toBe(0);
	});
});
