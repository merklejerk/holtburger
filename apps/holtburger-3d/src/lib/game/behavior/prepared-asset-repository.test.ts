import { describe, expect, it, vi } from "vitest";
import type { DatAssetId } from "../game-types";
import { PreparedAssetRepository } from "./prepared-asset-repository";

const FIRST: DatAssetId = "0x33000001";
const SECOND: DatAssetId = "0x33000002";

describe("PreparedAssetRepository residency", () => {
	it.each(["session", "referenced"] as const)(
		"separates %s residency from active handles",
		async (retention) => {
			const load = vi.fn(async (id: DatAssetId) => ({ id }));
			const destroySource = vi.fn();
			const repository = new PreparedAssetRepository({
				label: "Fixture",
				retention,
				load,
				prepare: (source) => source,
				destroySource,
			});
			const [first, shared] = await Promise.all([
				repository.acquire(FIRST),
				repository.acquire(FIRST),
			]);
			expect(first.asset).toBe(shared.asset);
			expect(() => repository.destroy()).toThrow("is referenced");
			first.release();
			shared.release();
			expect(repository.getDiagnostics().referenceCount).toBe(0);
			const repeated = await repository.acquire(FIRST);
			expect(load).toHaveBeenCalledTimes(retention === "session" ? 1 : 2);
			repeated.release();
			repository.destroy();
			expect(repository.getDiagnostics().assetCount).toBe(0);
			expect(destroySource).toHaveBeenCalledTimes(1);
			await expect(repository.acquire(FIRST)).rejects.toThrow("destroyed");
		},
	);

	it("settles concurrent partial failures before releasing successful handles", async () => {
		let finish: (value: DatAssetId) => void = () => {
			throw new Error("Not initialized");
		};
		const delayed = new Promise<DatAssetId>((resolve) => {
			finish = resolve;
		});
		const load = vi.fn((id: DatAssetId) =>
			id === FIRST ? Promise.reject(new Error("missing")) : delayed,
		);
		const repository = new PreparedAssetRepository({
			label: "Fixture",
			retention: "session",
			load,
			prepare: (source) => source,
			destroySource() {},
		});
		const batch = repository.acquireAll([FIRST, SECOND, SECOND]);
		const failure = expect(batch).rejects.toThrow("batch acquisition failed");
		expect(load.mock.calls.map(([id]) => id)).toEqual([FIRST, SECOND]);
		finish(SECOND);
		await failure;
		expect(repository.getDiagnostics().referenceCount).toBe(0);
		await expect(repository.acquire(FIRST)).rejects.toThrow("missing");
		expect(load).toHaveBeenCalledTimes(2);
		repository.evictFailed(FIRST);
		await expect(repository.acquire(FIRST)).rejects.toThrow("missing");
		expect(load).toHaveBeenCalledTimes(3);
		repository.destroy();
	});
});
