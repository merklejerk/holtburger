import { describe, expect, it } from "vitest";
import { settleWithConcurrency } from "./scene-asset-streaming-controller";

describe("scene asset streaming controller", () => {
	it("limits concurrent request work", async () => {
		let activeCount = 0;
		let maxActiveCount = 0;
		const results = await settleWithConcurrency(
			[1, 2, 3, 4, 5],
			2,
			async () => {
				activeCount += 1;
				maxActiveCount = Math.max(maxActiveCount, activeCount);
				await Promise.resolve();
				activeCount -= 1;
			},
		);

		expect(results.every((result) => result.status === "fulfilled")).toBe(true);
		expect(maxActiveCount).toBe(2);
	});

	it("returns rejected results without stopping queued work", async () => {
		const handledItems: number[] = [];
		const results = await settleWithConcurrency([1, 2, 3], 1, async (item) => {
			handledItems.push(item);
			if (item === 2) {
				throw new Error("test failure");
			}
		});

		expect(handledItems).toEqual([1, 2, 3]);
		expect(results.map((result) => result.status)).toEqual([
			"fulfilled",
			"rejected",
			"fulfilled",
		]);
	});

});
