import { behaviorTargetId } from "../behavior/behavior-event-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DecodedPhysicsScript } from "../../assets/decode-physics-script-record";
import type { PhysicsScriptSource } from "../../assets/physics-script-source";
import { AUTHORED_SCRIPT_FIXTURES } from "../behavior/authored-script-fixtures";
import {
	BehaviorEventRouter,
	type BehaviorObservation,
	type BehaviorTarget,
} from "../behavior/behavior-event-router";
import { PhysicsScriptRepository } from "../behavior/physics-script-repository";
import type { DatAssetId } from "../game-types";
import { PhysicsScriptSystem } from "./physics-script-system";

class FixtureScriptSource implements PhysicsScriptSource {
	async loadPhysicsScript(scriptId: DatAssetId): Promise<DecodedPhysicsScript> {
		const fixture = AUTHORED_SCRIPT_FIXTURES[scriptId.toLowerCase()];
		if (!fixture) throw new Error(`No fixture for ${scriptId}.`);
		return fixture;
	}
	destroy(): void {}
}

const TARGET: BehaviorTarget = {
	generation: 1,
	targetId: behaviorTargetId("node-1"),
};

/** Wire a router whose only stateful consumer is the script system itself. */
function build(options: { roll?: () => number; liveTargets?: boolean } = {}) {
	const repository = new PhysicsScriptRepository(new FixtureScriptSource());
	// The router and the script system are mutually dependent by design: the system produces
	// `CallPES` and is also its only consumer. A holder breaks the construction cycle without
	// making the router mutable or asserting past an unset field.
	const wiring: { system?: PhysicsScriptSystem<"owner"> } = {};
	const router = new BehaviorEventRouter(
		{
			effects: {
				applySetOmega: vi.fn(),
				applyTransparentPart: vi.fn(),
			},
			scale: {
				applyScale: (_target, _values, mode) =>
					mode === "initial-state" ? "folded-initial-state" : "executed",
			},
			scheduler: {
				scheduleActivation: (target, activation) => {
					const system = wiring.system;
					if (!system) throw new Error("Script system is not wired yet.");
					system.scheduleActivation(target, activation);
				},
			},
			audio: {
				playSound: () => "unprepared" as const,
				playSoundTableKey: () => "unprepared" as const,
			},
			particles: {
				createEmitter: () => "unprepared" as const,
				destroy: () => {},
				stop: () => {},
			},
			targets: { isLive: () => options.liveTargets ?? true },
		},
		256,
	);
	const system = new PhysicsScriptSystem<"owner">(
		router,
		options.roll ?? (() => 0.5),
	);
	wiring.system = system;
	return { repository, router, system };
}

function sounds(observations: readonly BehaviorObservation[]) {
	return observations.filter((entry) => entry.command === "sound-tweaked");
}

describe("PhysicsScriptSystem", () => {
	let harness: ReturnType<typeof build>;

	beforeEach(() => {
		harness = build();
	});

	it("dispatches a record exactly once when its authored time is crossed", async () => {
		// 0x33000711: a sound at t=0 and a self-call at t=3.
		const closure = await harness.repository.acquireClosure("0x33000711");
		harness.system.install("owner", TARGET, closure, 100);

		harness.system.advance(100);
		expect(sounds(harness.router.getObservations())).toHaveLength(1);

		// Re-advancing across the same instant must not replay it.
		harness.system.advance(100.5);
		harness.system.advance(101);
		expect(sounds(harness.router.getObservations())).toHaveLength(1);
	});

	it("repeats a self-calling script at its authored length with zero drift", async () => {
		const closure = await harness.repository.acquireClosure("0x33000711");
		harness.system.install("owner", TARGET, closure, 0);

		// Deliberately ragged steps: drift would show up as the sound moving off multiples of 3.
		for (const time of [0, 1.7, 3.3, 5.9, 6.2, 8.8, 9.4]) {
			harness.system.advance(time);
		}

		// Sounds at t=0, 3, 6, 9 — four in total, none lost or doubled by the uneven cadence.
		expect(sounds(harness.router.getObservations())).toHaveLength(4);
	});

	it("defers a nonzero pause by a uniform roll rather than by the pause itself", async () => {
		// 0x33000863 self-calls at t=2 with pause=1.0, so activation lands at 2 + roll*1.
		const rolled = build({ roll: () => 0.75 });
		const closure = await rolled.repository.acquireClosure("0x33000863");
		rolled.system.install("owner", TARGET, closure, 0);

		rolled.system.advance(2);
		// The chained script has not started yet: the roll pushes it to t=2.75.
		expect(sounds(rolled.router.getObservations())).toHaveLength(1);

		rolled.system.advance(2.5);
		expect(sounds(rolled.router.getObservations())).toHaveLength(1);

		rolled.system.advance(2.8);
		expect(sounds(rolled.router.getObservations())).toHaveLength(2);
	});

	it("schedules chained activation instead of recursing synchronously", async () => {
		// 0x33000862 calls 0x33000863 at t=0, which then self-cycles forever.
		const closure = await harness.repository.acquireClosure("0x33000862");
		harness.system.install("owner", TARGET, closure, 0);

		harness.system.advance(0);

		const observations = harness.router.getObservations();
		expect(observations.map((entry) => entry.outcome)).toContain("scheduled");
		// The chained script ran its own t=0 record in the same advance, without unbounded recursion.
		expect(sounds(observations)).toHaveLength(1);
		expect(harness.system.getDiagnostics().activeScriptCount).toBeGreaterThan(
			0,
		);
	});

	it("stays bounded and reports resynchronization on a long stall", async () => {
		const closure = await harness.repository.acquireClosure("0x33000711");
		harness.system.install("owner", TARGET, closure, 0);

		// Ten hours of a three-second loop is far past any budget worth replaying.
		harness.system.advance(36_000);

		const diagnostics = harness.system.getDiagnostics();
		expect(diagnostics.resynchronizedCount).toBe(1);
		// The entity is running again from the current instant rather than stuck or unbounded.
		expect(diagnostics.activeScriptCount).toBe(1);
	});

	it("records a stale-target rejection instead of mutating a replaced node", async () => {
		const stale = build({ liveTargets: false });
		const closure = await stale.repository.acquireClosure("0x33000711");
		stale.system.install("owner", TARGET, closure, 0);

		stale.system.advance(0);

		expect(
			stale.router.getObservations().map((entry) => entry.outcome),
		).toEqual(["rejected-stale-target"]);
	});

	it("stops dispatching for a removed owner and borrows rather than owns its closure", async () => {
		const closure = await harness.repository.acquireClosure("0x33000711");
		harness.system.install("owner", TARGET, closure, 0);
		harness.system.advance(0);

		harness.system.remove("owner", TARGET.targetId);

		const before = harness.router.getObservations().length;
		harness.system.advance(10);
		expect(harness.router.getObservations()).toHaveLength(before);
		// The closure is still held: its acquirer releases it, not this system. Releasing here too
		// would double-release whenever preparation staged a closure that never reached a clock.
		expect(harness.repository.getDiagnostics().referenceCount).toBe(1);
		closure.release();
		expect(harness.repository.getDiagnostics().referenceCount).toBe(0);
	});

	it("serializes roots appended before the next frame behind the existing tail", async () => {
		// The installed root has length zero. The first cue starts immediately and runs for two
		// seconds; the second cue must queue behind it even though neither cue has activated yet.
		const initial = await harness.repository.acquireClosure("0x330003ec");
		const firstCue = await harness.repository.acquireClosure("0x330003d8");
		const secondCue = await harness.repository.acquireClosure("0x33000711");
		harness.system.install("owner", TARGET, initial, 0);
		expect(harness.system.appendRoot("owner", TARGET, firstCue, 0)).toBe(true);
		expect(harness.system.appendRoot("owner", TARGET, secondCue, 0)).toBe(true);

		harness.system.advance(0);
		expect(
			sounds(harness.router.getObservations()).map(
				(observation) => observation.provenance.assetId,
			),
		).toEqual(["0x330003d8"]);

		harness.system.advance(1.99);
		expect(sounds(harness.router.getObservations())).toHaveLength(1);
		harness.system.advance(2);
		expect(
			sounds(harness.router.getObservations()).map(
				(observation) => observation.provenance.assetId,
			),
		).toEqual(["0x330003d8", "0x33000711"]);

		initial.release();
		firstCue.release();
		secondCue.release();
	});

	it("rejects a live root addressed to a stale generation", async () => {
		const initial = await harness.repository.acquireClosure("0x330003ec");
		const cue = await harness.repository.acquireClosure("0x330003d8");
		harness.system.install("owner", TARGET, initial, 0);

		expect(
			harness.system.appendRoot(
				"owner",
				{ ...TARGET, generation: TARGET.generation + 1 },
				cue,
				0,
			),
		).toBe(false);

		initial.release();
		cue.release();
	});

	it("stages a complete owner replacement without exposing or retiring either side early", async () => {
		const closure = await harness.repository.acquireClosure("0x33000711");
		harness.system.install("owner", TARGET, closure, 0);
		const successor = {
			generation: 2,
			targetId: behaviorTargetId("node-2"),
		};
		const stage = harness.system.stageOwner("owner", [
			{ closure, target: successor, timeSeconds: 10 },
		]);
		expect(harness.system.holds(TARGET)).toBe(true);
		expect(harness.system.holds(successor)).toBe(false);

		stage.commit();
		expect(harness.system.holds(TARGET)).toBe(false);
		expect(harness.system.holds(successor)).toBe(true);
		expect(() => stage.commit()).toThrow("state committed");
	});

	it("releases an uncommitted stage without disturbing the active owner", async () => {
		const closure = await harness.repository.acquireClosure("0x33000711");
		harness.system.install("owner", TARGET, closure, 0);
		const stage = harness.system.stageOwner("owner", [
			{
				closure,
				target: { generation: 2, targetId: behaviorTargetId("node-2") },
				timeSeconds: 10,
			},
		]);
		stage.release();
		expect(harness.system.holds(TARGET)).toBe(true);
		expect(() => stage.commit()).toThrow("state released");
	});

	it("refuses a clock that moves backwards rather than inventing an interpretation", async () => {
		const closure = await harness.repository.acquireClosure("0x33000711");
		harness.system.install("owner", TARGET, closure, 0);
		harness.system.advance(5);

		expect(() => harness.system.advance(4)).toThrow("moved backwards");
	});

	it("carries authored provenance on every dispatched command", async () => {
		const closure = await harness.repository.acquireClosure("0x33000711");
		harness.system.install("owner", TARGET, closure, 0);

		harness.system.advance(0);

		expect(harness.router.getObservations()[0]!.provenance).toEqual({
			assetId: "0x33000711",
			authoredOrder: 0,
			authoredPosition: 0,
			producer: "physics-script",
		});
	});
});
