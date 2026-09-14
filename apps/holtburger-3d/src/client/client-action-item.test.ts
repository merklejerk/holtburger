import { expect, it } from "vitest";
import { entityFacts } from "./client-entity-mirror.test-support";
import { bindingAction } from "./client-action-item";

it("uses equipment precedence and accepts only supported owned item actions", () => {
	const item = entityFacts(7, { ownedByPlayer: true });
	if (item.description.kind !== "known")
		throw new Error("Expected known fixture");
	expect(bindingAction(item)).toEqual({
		kind: "direct",
		item: 7,
		replacement: null,
	});
	expect(
		bindingAction({
			...item,
			description: { ...item.description, useCapability: "targeted" },
		}),
	).toEqual({ kind: "targeted", item: 7, replacement: null });
	expect(
		bindingAction({
			...item,
			description: {
				...item.description,
				equipLocations: 1,
				consumable: null,
				useCapability: "targeted",
			},
		}),
	).toEqual({ kind: "equipment", item: 7, replacement: null });
	expect(
		bindingAction({
			...item,
			description: { ...item.description, useCapability: "unsupported" },
		}),
	).toBeNull();
	expect(bindingAction({ ...item, ownedByPlayer: false })).toBeNull();
	expect(
		bindingAction({ ...item, description: { kind: "pending" } }),
	).toBeNull();
	expect(bindingAction(undefined)).toBeNull();
});
