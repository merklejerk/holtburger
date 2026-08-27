import { describe, expect, it } from "vitest";

import { PortalTransitionController } from "./portal-transition-controller";

describe("PortalTransitionController", () => {
	it("waits without a timeout and reveals once after a pure destination frame", () => {
		const controller = new PortalTransitionController({ exitDurationMs: 100 });
		controller.begin(4, false);

		expect(
			controller.tick({
				nowMs: 0,
				activationReady: false,
				destinationFrameRendered: false,
			}),
		).toMatchObject({
			state: { kind: "waiting", generation: 4, outgoingCaptured: false },
			reveal: null,
		});
		expect(
			controller.tick({
				nowMs: 10_000,
				activationReady: false,
				destinationFrameRendered: false,
			}).state,
		).toMatchObject({ kind: "waiting" });

		expect(
			controller.tick({
				nowMs: 10_001,
				activationReady: true,
				destinationFrameRendered: false,
			}),
		).toMatchObject({ state: { kind: "exiting", progress: 0 }, reveal: null });
		expect(
			controller.tick({
				nowMs: 10_101,
				activationReady: true,
				destinationFrameRendered: false,
			}).state,
		).toMatchObject({ kind: "revealed-awaiting-handoff", generation: 4 });

		expect(
			controller.tick({
				nowMs: 10_102,
				activationReady: true,
				destinationFrameRendered: true,
			}),
		).toEqual({
			state: { kind: "revealed-awaiting-handoff", generation: 4 },
			reveal: { generation: 4 },
		});
		expect(
			controller.tick({
				nowMs: 10_103,
				activationReady: true,
				destinationFrameRendered: true,
			}),
		).toEqual({
			state: { kind: "revealed-awaiting-handoff", generation: 4 },
			reveal: null,
		});
	});

	it("captures an outgoing world only for a fresh transition", () => {
		const controller = new PortalTransitionController({ exitDurationMs: 0 });
		controller.begin(1, true);
		expect(
			controller.tick({
				nowMs: 0,
				activationReady: false,
				destinationFrameRendered: false,
			}).state,
		).toMatchObject({ kind: "waiting", outgoingCaptured: true });

		controller.begin(2, true);
		expect(
			controller.tick({
				nowMs: 1,
				activationReady: false,
				destinationFrameRendered: false,
			}).state,
		).toMatchObject({
			kind: "waiting",
			generation: 2,
			outgoingCaptured: false,
		});
	});

	it("supports a zero-duration exit without skipping the state edge", () => {
		const controller = new PortalTransitionController({ exitDurationMs: 0 });
		controller.begin(7, false);
		expect(
			controller.tick({
				nowMs: 0,
				activationReady: true,
				destinationFrameRendered: false,
			}),
		).toMatchObject({
			audio: "exit",
			state: { kind: "exiting", progress: 1 },
		});
		expect(
			controller.tick({
				nowMs: 1,
				activationReady: true,
				destinationFrameRendered: false,
			}).state,
		).toMatchObject({ kind: "revealed-awaiting-handoff" });
	});

	it("emits the exit sound edge once when activation becomes ready", () => {
		const controller = new PortalTransitionController({ exitDurationMs: 100 });
		controller.begin(9, true);

		const waiting = controller.tick({
			nowMs: 0,
			activationReady: false,
			destinationFrameRendered: false,
		});
		expect(waiting.audio).toBeUndefined();

		const exiting = controller.tick({
			nowMs: 1,
			activationReady: true,
			destinationFrameRendered: false,
		});
		expect(exiting.audio).toBe("exit");

		const stillExiting = controller.tick({
			nowMs: 2,
			activationReady: true,
			destinationFrameRendered: false,
		});
		expect(stillExiting.audio).toBeUndefined();
	});

	it("rejects invalid generations and durations", () => {
		expect(
			() => new PortalTransitionController({ exitDurationMs: -1 }),
		).toThrow();
		expect(
			() => new PortalTransitionController({ exitDurationMs: Number.NaN }),
		).toThrow();
		const controller = new PortalTransitionController();
		expect(() => controller.begin(-1, false)).toThrow();
		expect(() => controller.begin(1.5, false)).toThrow();
		expect(() =>
			controller.tick({
				nowMs: Number.POSITIVE_INFINITY,
				activationReady: false,
				destinationFrameRendered: false,
			}),
		).toThrow();
	});
});
