import { describe, expect, it } from "vitest";

import { PresentationTeardownStack } from "./presentation-teardown";

describe("PresentationTeardownStack", () => {
	it("releases every operation in reverse order and aggregates failures", async () => {
		const order: string[] = [];
		const stack = new PresentationTeardownStack();
		stack.add("first", () => {
			order.push("first");
		});
		stack.add("second", async () => {
			order.push("second");
			throw new Error("second failed");
		});
		stack.add("third", () => {
			order.push("third");
			throw new Error("third failed");
		});

		const completion = stack.close();
		await expect(completion).rejects.toMatchObject({
			message: "Presentation teardown failed for: third, second.",
		});
		expect(order).toEqual(["third", "second", "first"]);
		expect(stack.close()).toBe(completion);
		await expect(stack.close()).rejects.toBeInstanceOf(AggregateError);
		expect(order).toEqual(["third", "second", "first"]);
	});
});
