import { describe, expect, it } from "vitest";
import {
	type PortalTransitionPresentationPlan,
	validatePortalTransitionPresentationPlan,
} from "./portal-transition-presentation";

describe("validatePortalTransitionPresentationPlan", () => {
	it.each<PortalTransitionPresentationPlan>([
		{ kind: "origin-to-tunnel", generation: 0, progress: 0 },
		{ kind: "tunnel-only", generation: 1 },
		{ kind: "tunnel-to-destination", generation: 2, progress: 1 },
		{ kind: "destination-only-awaiting-handoff", generation: 3 },
	])("accepts $kind", (plan) => {
		expect(() => validatePortalTransitionPresentationPlan(plan)).not.toThrow();
	});

	it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
		"rejects generation %s",
		(generation) => {
			expect(() =>
				validatePortalTransitionPresentationPlan({
					kind: "tunnel-only",
					generation,
				}),
			).toThrow("non-negative safe integer");
		},
	);

	it.each([Number.NaN, Number.POSITIVE_INFINITY])(
		"rejects non-finite progress %s",
		(progress) => {
			expect(() =>
				validatePortalTransitionPresentationPlan({
					kind: "origin-to-tunnel",
					generation: 1,
					progress,
				}),
			).toThrow("must be finite");
		},
	);

	it.each([-0.01, 1.01])("rejects out-of-range progress %s", (progress) => {
		expect(() =>
			validatePortalTransitionPresentationPlan({
				kind: "tunnel-to-destination",
				generation: 1,
				progress,
			}),
		).toThrow("within [0, 1]");
	});
});
