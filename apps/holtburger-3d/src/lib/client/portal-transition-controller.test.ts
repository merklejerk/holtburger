import { describe, expect, it } from "vitest";

import { PortalTransitionController } from "./portal-transition-controller";

const POLICY = {
	enterDurationMs: 100,
	exitDurationMs: 100,
} as const;

describe("PortalTransitionController", () => {
	it("produces one complete plan per advance and reveals only from presentation proof", () => {
		const controller = new PortalTransitionController(POLICY);
		controller.begin(4, { kind: "capture-last-world" });

		expect(advance(controller, 0).plan).toMatchObject({
			kind: "origin-to-tunnel",
			generation: 4,
			progress: 0,
		});
		expect(advance(controller, 100, true).plan).toEqual({
			kind: "tunnel-only",
			generation: 4,
		});
		expect(advance(controller, 10_000, false).plan.kind).toBe("tunnel-only");
		expect(
			controller.acknowledgePresented({ kind: "tunnel-only", generation: 4 }),
		).toBeNull();

		expect(advance(controller, 10_001, false)).toMatchObject({
			audio: "exit",
			plan: { kind: "tunnel-to-destination", progress: 0 },
		});
		expect(advance(controller, 10_101, true).plan).toEqual({
			kind: "destination-only-awaiting-handoff",
			generation: 4,
		});
		expect(
			controller.acknowledgePresented({
				kind: "destination-only-awaiting-handoff",
				generation: 4,
			}),
		).toEqual({ generation: 4 });
		expect(
			controller.acknowledgePresented({
				kind: "destination-only-awaiting-handoff",
				generation: 4,
			}),
		).toBeNull();
	});

	it("starts directly in portal space when no origin scene exists", () => {
		const controller = new PortalTransitionController(POLICY);
		controller.begin(6, { kind: "absent" });

		expect(advance(controller, 0).plan).toEqual({
			kind: "tunnel-only",
			generation: 6,
		});
	});

	it("suppresses capture when a live portal generation is superseded", () => {
		const controller = new PortalTransitionController(POLICY);
		controller.begin(1, { kind: "capture-last-world" });
		expect(advance(controller, 0).plan.kind).toBe("origin-to-tunnel");

		controller.begin(2, { kind: "capture-last-world" });
		expect(advance(controller, 1).plan).toEqual({
			kind: "tunnel-only",
			generation: 2,
		});
	});

	it("ignores stale and wrong-barrier presentation receipts", () => {
		const controller = new PortalTransitionController(POLICY);
		controller.begin(3, { kind: "absent" });
		advance(controller, 0, true);

		expect(
			controller.acknowledgePresented({ kind: "tunnel-only", generation: 2 }),
		).toBeNull();
		expect(
			controller.acknowledgePresented({
				kind: "destination-only-awaiting-handoff",
				generation: 3,
			}),
		).toBeNull();
		expect(advance(controller, 1, true).plan.kind).toBe("tunnel-only");
	});

	it("supports zero-duration visual edges without collapsing barrier frames", () => {
		const controller = new PortalTransitionController({
			...POLICY,
			enterDurationMs: 0,
			exitDurationMs: 0,
		});
		controller.begin(7, { kind: "capture-last-world" });

		expect(advance(controller, 0, true).plan.kind).toBe("tunnel-only");
		controller.acknowledgePresented({ kind: "tunnel-only", generation: 7 });
		expect(advance(controller, 1, true)).toMatchObject({
			audio: "exit",
			plan: { kind: "tunnel-to-destination", progress: 1 },
		});
		expect(advance(controller, 2, true).plan.kind).toBe(
			"destination-only-awaiting-handoff",
		);
	});

	it("emits the exit sound edge exactly once", () => {
		const controller = new PortalTransitionController(POLICY);
		controller.begin(9, { kind: "absent" });
		advance(controller, 0, true);
		controller.acknowledgePresented({ kind: "tunnel-only", generation: 9 });

		expect(advance(controller, 1, true).audio).toBe("exit");
		expect(advance(controller, 2, true).audio).toBeUndefined();
	});

	it("rejects invalid generations, policy, and clocks", () => {
		expect(
			() => new PortalTransitionController({ ...POLICY, enterDurationMs: -1 }),
		).toThrow();
		expect(
			() =>
				new PortalTransitionController({
					...POLICY,
					enterDurationMs: Number.NaN,
				}),
		).toThrow();
		expect(
			() => new PortalTransitionController({ ...POLICY, exitDurationMs: -1 }),
		).toThrow();
		expect(
			() =>
				new PortalTransitionController({
					...POLICY,
					exitDurationMs: Number.NaN,
				}),
		).toThrow();
		const controller = new PortalTransitionController(POLICY);
		expect(() => controller.begin(-1, { kind: "absent" })).toThrow();
		expect(() => controller.begin(1.5, { kind: "absent" })).toThrow();
		controller.begin(1, { kind: "absent" });
		expect(() => advance(controller, Number.POSITIVE_INFINITY)).toThrow();
	});
});

function advance(
	controller: PortalTransitionController,
	nowMs: number,
	destinationReady = false,
) {
	return controller.advance({ nowMs, destinationReady });
}
