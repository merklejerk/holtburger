import { describe, expect, it } from "vitest";

import {
	completePresentationOperations,
	PresentationTeardownStack,
} from "./presentation-teardown";

describe("completePresentationOperations", () => {
	it("preserves an individual failure while completing later operations", () => {
		const failure = new Error("release failed");
		const completed: string[] = [];
		expect(() =>
			completePresentationOperations([
				() => {
					throw failure;
				},
				() => {
					completed.push("later");
				},
			]),
		).toThrow(failure);
		expect(completed).toEqual(["later"]);
	});

	it("retains every failure in operation order", () => {
		const failures = [new Error("first failed"), new Error("second failed")];
		expect(() =>
			completePresentationOperations(
				failures.map((failure) => () => {
					throw failure;
				}),
			),
		).toThrow(expect.objectContaining({ errors: failures }));
	});

	it("preserves a caller's context for a single failure", () => {
		const failure = new Error("child release failed");
		const message = "Model group retirement failed.";
		expect(() =>
			completePresentationOperations(
				[
					() => {
						throw failure;
					},
				],
				message,
			),
		).toThrow(expect.objectContaining({ message, errors: [failure] }));
	});
});

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
