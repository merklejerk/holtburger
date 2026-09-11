import {
	ItemIconRepository,
	type ItemIconServices,
} from "./item-icon-repository";
import { encode } from "@msgpack/msgpack";
import { describe, expect, it, vi } from "vitest";
import {
	decodeItemIcons,
	prepareItemIcons,
	MAX_ICON_FRAME_BYTES,
	MAX_ICON_BATCH,
	type ItemIconRequest,
} from "./item-icon-source";

// Synthetic transparent 32x32 PNG; no runtime game assets are required.
const png = Uint8Array.from(
	atob(
		"iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAGklEQVR4nO3BAQEAAACCIP+vbkhAAQAAAO8GECAAARlDNO4AAAAASUVORK5CYII=",
	),
	(c) => c.charCodeAt(0),
);
const request: ItemIconRequest = {
	key: "first",
	spec: {
		kind: "item",
		base: 0x06000001,
		itemType: 4,
		overlay: null,
		underlay: null,
		uiEffects: 0,
	},
};
const ready = { key: request.key, kind: "ready", image: png };
const issue = {
	layer: "overlay",
	code: "missing-asset",
	assetId: 0x06000002,
	detail: "Missing declared overlay",
};

describe("item icon host source", () => {
	it("round-trips ready, degraded and failed entries while preserving diagnostics", async () => {
		const results = [
			ready,
			{ ...ready, key: "second", kind: "degraded", issues: [issue] },
			{ key: "third", kind: "failed", issues: [issue] },
		];
		const requests = results.map(({ key }) => ({ ...request, key }));
		const invoke = vi.fn().mockResolvedValue(encode(results));
		expect(await prepareItemIcons({ invoke }, requests)).toEqual(results);
		expect(invoke).toHaveBeenCalledWith("prepare_item_icons", {
			request: { icons: requests },
		});
	});
	it.each([
		[ready, ready],
		[{ ...ready, key: "unexpected" }],
		[],
		[{ key: "first", kind: "failed", issues: [] }],
		[{ ...ready, image: new Uint8Array([1, 2, 3]) }],
	])("rejects malformed or incomplete batches", (...results) => {
		expect(() => decodeItemIcons(encode(results), [request])).toThrow();
	});
	it("rejects a batch omitting a requested key", () => {
		expect(() =>
			decodeItemIcons(encode([ready]), [
				request,
				{ ...request, key: "second" },
			]),
		).toThrow("omitted");
	});
	it("rejects oversized transport and propagates command rejection", async () => {
		expect(() =>
			decodeItemIcons(new Uint8Array(MAX_ICON_FRAME_BYTES + 1), [request]),
		).toThrow("byte limit");
		const error = new Error("host unavailable");
		await expect(
			prepareItemIcons({ invoke: vi.fn().mockRejectedValue(error) }, [request]),
		).rejects.toBe(error);
	});
});

describe("host failures through retained icon ownership", () => {
	it.each([
		"rejection",
		"nonbinary",
		"decode",
		"duplicate",
		"missing",
		"unexpected",
	] as const)(
		"settles %s failures and continues the next batch without retrying retained failures",
		async (fault) => {
			let calls = 0;
			const services: ItemIconServices = {
				prepare: (requests) =>
					prepareItemIcons(
						{
							invoke: async () => {
								calls++;
								const results = requests.map(({ key }) => ({ ...ready, key }));
								if (calls !== 1) return encode(results);
								switch (fault) {
									case "rejection":
										throw new Error("Injected host rejection");
									case "nonbinary":
										return "invalid response";
									case "decode":
										return new Uint8Array([0xc1]);
									case "duplicate":
										return encode(results.map(() => results[0]));
									case "missing":
										return encode(results.slice(1));
									case "unexpected":
										return encode(
											results.map((result) => ({
												...result,
												key: "unexpected",
											})),
										);
								}
							},
						},
						requests,
					),
				createImage: vi.fn(async () => "blob:surviving-batch"),
				revokeImage: vi.fn(),
				report: vi.fn(),
			};
			const repository = new ItemIconRepository(services);
			const owner = repository.createOwner("persistent");
			const specs = Array.from({ length: MAX_ICON_BATCH + 1 }, (_, index) => ({
				kind: "item" as const,
				base: index + 1,
				itemType: 4,
				overlay: null,
				underlay: null,
				uiEffects: 0,
			}));
			const keys = specs.map((spec) => repository.retain(owner, spec));
			await vi.waitFor(() => {
				expect(keys.map((key) => repository.read(key).kind)).toEqual([
					...Array.from({ length: MAX_ICON_BATCH }, () => "failed"),
					"ready",
				]);
			});
			specs.forEach((spec) => repository.retain(owner, spec));
			await Promise.resolve();
			expect(calls).toBe(2);
			expect(services.createImage).toHaveBeenCalledTimes(1);
			expect(services.report).toHaveBeenCalledTimes(MAX_ICON_BATCH);
			repository.dispose();
			expect(services.revokeImage).toHaveBeenCalledExactlyOnceWith(
				"blob:surviving-batch",
			);
		},
	);
});
