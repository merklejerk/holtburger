import { describe, expect, it, vi } from "vitest";
import { Vec3 } from "../math/types";
import type { SceneNodeId } from "../scene";
import {
	BehaviorEventRouter,
	type BehaviorCommandProvenance,
	type BehaviorTarget,
} from "./behavior-event-router";
import type { PreparedBehaviorCommand } from "./prepared-behavior-command";

const TARGET: BehaviorTarget = {
	generation: 3,
	nodeId: "node-1" as SceneNodeId,
};

const PROVENANCE: BehaviorCommandProvenance = {
	assetId: "0x33000711",
	authoredOrder: 0,
	authoredPosition: 2,
	producer: "physics-script",
};

function build(isLive = true) {
	const effects = {
		applyScale: vi.fn(),
		applySetOmega: vi.fn(),
		applyTransparentPart: vi.fn(),
	};
	const audio = {
		playSound: vi.fn<
			(...args: never[]) => "played" | "suppressed" | "unprepared"
		>(() => "unprepared"),
	};
	const particles = {
		createEmitter: vi.fn<(...args: never[]) => "created" | "unprepared">(
			() => "unprepared",
		),
	};
	const scheduler = { scheduleActivation: vi.fn() };
	const router = new BehaviorEventRouter(
		{ audio, effects, particles, scheduler, targets: { isLive: () => isLive } },
		4,
	);
	return { audio, effects, particles, router, scheduler };
}

const SET_OMEGA: PreparedBehaviorCommand = {
	kind: "set-omega",
	omega: new Vec3(0, 0, 1),
};

describe("BehaviorEventRouter", () => {
	it("routes a persistent command and labels replay distinctly from live execution", () => {
		const { effects, router } = build();

		expect(router.dispatch(SET_OMEGA, TARGET, PROVENANCE, "live")).toBe(
			"executed",
		);
		expect(
			router.dispatch(SET_OMEGA, TARGET, PROVENANCE, "initial-state"),
		).toBe("folded-initial-state");
		expect(effects.applySetOmega).toHaveBeenCalledTimes(2);
	});

	it("hands a chained activation to the scheduler instead of running it inline", () => {
		const { router, scheduler } = build();

		const outcome = router.dispatch(
			{ kind: "call-pes", pauseSeconds: 1, scriptId: "0x33000863" },
			TARGET,
			PROVENANCE,
			"live",
		);

		expect(outcome).toBe("scheduled");
		expect(scheduler.scheduleActivation).toHaveBeenCalledWith(TARGET, {
			kind: "call-pes",
			pauseSeconds: 1,
			scriptId: "0x33000863",
		});
	});

	it("suppresses ephemeral audio during replay but not during live execution", () => {
		const { router } = build();
		const sound: PreparedBehaviorCommand = {
			kind: "sound-tweaked",
			probability: 1,
			soundId: "0x0a000207",
			volume: 0.3,
		};

		expect(router.dispatch(sound, TARGET, PROVENANCE, "initial-state")).toBe(
			"suppressed-initial-state",
		);
		// Live is only "no-consumer" until Phase 6 lands the audio system.
		expect(router.dispatch(sound, TARGET, PROVENANCE, "live")).toBe(
			"no-consumer",
		);
	});

	it("routes particle creation and folds it when replayed", () => {
		const { particles, router } = build();
		const command: PreparedBehaviorCommand = {
			emitterId: 0,
			emitterInfoId: "0x3200020c",
			kind: "create-particle",
			offsetOrigin: [0, 0, 1],
			partIndex: -1,
		};
		particles.createEmitter.mockReturnValue("created");

		expect(router.dispatch(command, TARGET, PROVENANCE, "live")).toBe(
			"executed",
		);
		expect(router.dispatch(command, TARGET, PROVENANCE, "initial-state")).toBe(
			"folded-initial-state",
		);
		expect(particles.createEmitter).toHaveBeenCalledTimes(2);
	});

	it("records an unstaged emitter as unconsumed rather than as executed", () => {
		const { particles, router } = build();
		particles.createEmitter.mockReturnValue("unprepared");

		expect(
			router.dispatch(
				{
					emitterId: 0,
					emitterInfoId: "0x32009999",
					kind: "create-particle",
					offsetOrigin: [0, 0, 0],
					partIndex: -1,
				},
				TARGET,
				PROVENANCE,
				"live",
			),
		).toBe("no-consumer");
	});

	it("plays a live sound but suppresses a replayed one", () => {
		const { audio, router } = build();
		const sound: PreparedBehaviorCommand = {
			kind: "sound-tweaked",
			probability: 1,
			soundId: "0x0a000207",
			volume: 0.3,
		};
		audio.playSound.mockReturnValue("played");

		expect(router.dispatch(sound, TARGET, PROVENANCE, "live")).toBe("executed");
		expect(router.dispatch(sound, TARGET, PROVENANCE, "initial-state")).toBe(
			"suppressed-initial-state",
		);
		// Replay never reaches the device at all: elapsed audio the viewer never heard.
		expect(audio.playSound).toHaveBeenCalledTimes(1);
	});

	it("counts a deliberately silent sound as executed, not as unconsumed", () => {
		const { audio, router } = build();
		audio.playSound.mockReturnValue("suppressed");

		// Losing a probability roll or falling below the audible floor is correct behavior.
		expect(
			router.dispatch(
				{
					kind: "sound-tweaked",
					probability: 0.1,
					soundId: "0x0a000207",
					volume: 0.3,
				},
				TARGET,
				PROVENANCE,
				"live",
			),
		).toBe("executed");
	});

	it("rejects a stale target without touching any consumer", () => {
		const { effects, router, scheduler } = build(false);

		expect(router.dispatch(SET_OMEGA, TARGET, PROVENANCE, "live")).toBe(
			"rejected-stale-target",
		);
		expect(effects.applySetOmega).not.toHaveBeenCalled();
		expect(scheduler.scheduleActivation).not.toHaveBeenCalled();
	});

	it("records exactly one observation per dispatch, with full provenance", () => {
		const { router } = build();

		router.dispatch(SET_OMEGA, TARGET, PROVENANCE, "live");

		expect(router.getObservations()).toEqual([
			{
				command: "set-omega",
				generation: 3,
				nodeId: "node-1",
				outcome: "executed",
				provenance: PROVENANCE,
			},
		]);
	});

	it("bounds retained observations while keeping cumulative outcome counts", () => {
		const { router } = build();

		for (let index = 0; index < 10; index += 1) {
			router.dispatch(SET_OMEGA, TARGET, PROVENANCE, "live");
		}

		// The ring buffer caps memory; the counts still describe everything that happened.
		expect(router.getObservations()).toHaveLength(4);
		expect(router.getDiagnostics().outcomeCounts).toEqual({ executed: 10 });
	});
});
