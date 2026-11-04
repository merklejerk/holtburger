import { describe, expect, it } from "vitest";
import type { PortalTransitionPresentationPlan } from "../../client/portal-transition-presentation";
import { enrichPortalTransitionFrame } from "./portal-transition-frame";

const TUNNEL = {
	animationFramePosition: 17.25,
	axialRollFramePosition: 113.5,
} as const;

describe("enrichPortalTransitionFrame", () => {
	it.each([
		{
			generation: 7,
			kind: "origin-to-tunnel",
			progress: 0.25,
		},
		{ generation: 7, kind: "tunnel-only" },
		{
			generation: 7,
			kind: "tunnel-to-destination",
			progress: 0.75,
		},
	] satisfies readonly PortalTransitionPresentationPlan[])(
		"preserves the complete $kind plan while attaching both tunnel clocks",
		(plan) => {
			expect(enrichPortalTransitionFrame(plan, TUNNEL)).toEqual({
				...plan,
				tunnel: TUNNEL,
			});
		},
	);

	it("does not invent a tunnel dependency for the neutral destination frame", () => {
		const plan = {
			generation: 7,
			kind: "destination-only-awaiting-handoff",
		} as const;
		expect(enrichPortalTransitionFrame(plan, null)).toBe(plan);
	});

	it.each([
		"origin-to-tunnel",
		"tunnel-only",
		"tunnel-to-destination",
	] as const)("rejects a missing tunnel sample for %s", (kind) => {
		const plan =
			kind === "tunnel-only"
				? ({ generation: 7, kind } as const)
				: kind === "origin-to-tunnel"
					? ({ generation: 7, kind, progress: 0 } as const)
					: ({ generation: 7, kind, progress: 0 } as const);
		expect(() => enrichPortalTransitionFrame(plan, null)).toThrow(
			`${kind} requires an authored tunnel visual sample.`,
		);
	});
});
