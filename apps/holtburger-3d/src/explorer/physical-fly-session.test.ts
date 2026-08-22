import { describe, expect, it } from "vitest";
import { sceneVec3 } from "../lib/assets/ac-frame";
import { Vec3 } from "../lib/game/math/types";
import type { HostPhysicalFlyPath } from "../lib/game/motion/host-physical-fly-path";
import type { HostCameraPlacement } from "../lib/game/motion/host-placed-path";
import {
	PhysicalFlySession,
	type HostPhysicalFlyFailure,
	type PhysicalFlyTransport,
} from "./physical-fly-session";

function path(
	overrides: Partial<HostPhysicalFlyPath> = {},
): HostPhysicalFlyPath {
	return {
		session: 7,
		sequence: 0,
		durationMs: 1000 / 30,
		initial: {
			residency: {
				envCellId: null,
				landblockId: "0xda55ffff",
			},
			origin: [96, 96, 20],
		},
		legs: [
			{
				endFraction: 1,
				end: {
					residency: {
						envCellId: null,
						landblockId: "0xda55ffff",
					},
					origin: [96, 96, 20],
				},
			},
		],
		status: "solved",
		sceneResidency: { state: "resident" },
		groundState: "airborne",
		constraintCount: 0,
		substeps: 1,
		contactPasses: 1,
		solveDurationMs: 0.1,
		...overrides,
	};
}

function movingPath(
	sequence: number,
	startX: number,
	endX: number,
): HostPhysicalFlyPath {
	const residency = { envCellId: null, landblockId: "0xda55ffff" };
	return path({
		sequence,
		initial: { origin: [startX, 96, 20], residency },
		legs: [
			{
				endFraction: 1,
				end: { origin: [endX, 96, 20], residency },
			},
		],
	});
}

function harness() {
	const calls: { command: string; args?: Record<string, unknown> }[] = [];
	let motionHandler: ((path: HostPhysicalFlyPath) => void) | null = null;
	let failureHandler: ((failure: HostPhysicalFlyFailure) => void) | null = null;
	let now = 0;
	const transport: PhysicalFlyTransport = {
		invoke: async (command, args) => {
			calls.push({ command, args });
			if (command === "start_physical_fly") {
				return { session: 7 };
			}
			return undefined;
		},
		listenMotion: async (_event, next) => {
			motionHandler = next;
			return () => (motionHandler = null);
		},
		listenFailure: async (_event, next) => {
			failureHandler = next;
			return () => (failureHandler = null);
		},
		now: () => now,
	};
	return {
		calls,
		transport,
		deliver: (next: HostPhysicalFlyPath) => motionHandler?.(next),
		fail: (failure: HostPhysicalFlyFailure) => failureHandler?.(failure),
		advance: (milliseconds: number) => (now += milliseconds),
	};
}

function placement(
	position: readonly [number, number, number] = [
		0xda * 192 + 96,
		20,
		-(0x55 * 192 + 96),
	],
): HostCameraPlacement {
	return {
		position: sceneVec3(new Vec3(...position)),
		residency: { envCellId: null, landblockId: "0xda55ffff" },
	};
}

describe("PhysicalFlySession", () => {
	it("listens before registration and evaluates the first da55 path", async () => {
		const test = harness();
		const session = new PhysicalFlySession(test.transport);
		await session.start(placement());
		expect(test.calls[0]?.command).toBe("start_physical_fly");
		expect(test.calls[0]?.args?.registration).toEqual({
			speedEnvelope: {
				kind: "linear-ramp",
				accelerationSeconds: 2,
				initialSpeedMultiplier: 0.125,
			},
			residency: { envCellId: null, landblockId: "0xda55ffff" },
			scenePosition: [0xda * 192 + 96, 20, -(0x55 * 192 + 96)],
		});

		test.deliver(movingPath(0, 96, 96.1));
		test.advance(1000 / 30);
		expect(session.placement()?.position.x).toBeCloseTo(0xda * 192 + 96.1);
	});

	it("ignores old sessions and out-of-order paths", async () => {
		const test = harness();
		const session = new PhysicalFlySession(test.transport);
		await session.start(placement());
		test.deliver(path({ session: 6 }));
		test.deliver(movingPath(4, 4, 5));
		test.deliver(movingPath(2, 2, 3));
		expect(session.placement()?.position.x).toBe(0xda * 192 + 4);
	});

	it("surfaces only terminal failures for the current session", async () => {
		const test = harness();
		const session = new PhysicalFlySession(test.transport);
		await session.start(placement());

		test.fail({ message: "obsolete", session: 6 });
		expect(session.takeTerminalError()).toBeNull();
		test.fail({ message: "placement transaction rejected", session: 7 });
		expect(session.takeTerminalError()?.message).toContain(
			"placement transaction rejected",
		);
		expect(session.takeTerminalError()).toBeNull();
	});

	it("counts sequence gaps and resynchronizes from the received initial point", async () => {
		const test = harness();
		const session = new PhysicalFlySession(test.transport);
		await session.start(placement());
		test.deliver(movingPath(0, 96, 97));
		test.advance(10);
		test.deliver(movingPath(3, 50, 51));
		test.deliver(movingPath(2, 2, 3));
		expect(session.status().droppedPaths).toBe(2);
		expect(session.placement()?.position.x).toBe(0xda * 192 + 50);
	});

	it("plays one pending successor without resetting the session timeline", async () => {
		const test = harness();
		const session = new PhysicalFlySession(test.transport);
		await session.start(placement());
		test.deliver(movingPath(0, 96, 97));
		test.advance(20);
		test.deliver(movingPath(1, 97, 98));
		test.advance(20);
		expect(session.placement()?.position.x).toBeCloseTo(0xda * 192 + 97.2);
	});

	it("holds the exact endpoint when the host stream is late", async () => {
		const test = harness();
		const session = new PhysicalFlySession(test.transport);
		await session.start(placement());
		test.deliver(movingPath(0, 96, 97));
		test.advance(1_000);
		expect(session.placement()?.position.x).toBe(0xda * 192 + 97);
	});

	it("plays a late successor for a full tick from its explicit initial point", async () => {
		const test = harness();
		const session = new PhysicalFlySession(test.transport);
		await session.start(placement());
		test.deliver(movingPath(0, 96, 97));
		test.advance(1_000);
		test.deliver(movingPath(1, 97, 98));
		expect(session.placement()?.position.x).toBe(0xda * 192 + 97);
		test.advance(1000 / 60);
		expect(session.placement()?.position.x).toBeCloseTo(0xda * 192 + 97.5);
	});

	it("collapses stale playback when a third path arrives while rendering is suspended", async () => {
		const test = harness();
		const session = new PhysicalFlySession(test.transport);
		await session.start(placement());
		test.deliver(movingPath(0, 96, 97));
		test.deliver(movingPath(1, 97, 98));
		test.deliver(movingPath(2, 98, 99));
		expect(session.placement()?.position.x).toBe(0xda * 192 + 98);
	});

	it("discards two expired buffered ticks when callbacks resume after suspension", async () => {
		const test = harness();
		const session = new PhysicalFlySession(test.transport);
		await session.start(placement());
		test.deliver(movingPath(0, 96, 97));
		test.deliver(movingPath(1, 97, 98));
		test.advance(1_000);
		test.deliver(movingPath(2, 98, 99));
		expect(session.placement()?.position.x).toBe(0xda * 192 + 98);
	});

	it("surfaces a missing collision owner without changing solve status", async () => {
		const test = harness();
		const session = new PhysicalFlySession(test.transport);
		await session.start(placement());
		test.deliver(
			path({
				sceneResidency: {
					state: "missing-owner",
					landblockId: "0xdb55ffff",
				},
			}),
		);
		expect(session.status()).toMatchObject({
			tick: "solved",
			sceneResidency: {
				state: "missing-owner",
				landblockId: "0xdb55ffff",
			},
		});
	});

	it("sequences distinct intents and suppresses duplicates", async () => {
		const test = harness();
		const session = new PhysicalFlySession(test.transport);
		await session.start(placement());
		await session.setIntent([1, 2, 3]);
		await session.setIntent([1, 2, 3]);
		await session.setIntent([1, 2, 3]);
		await session.setIntent([3, 2, 1]);
		const intents = test.calls.filter(
			({ command }) => command === "set_physical_fly_intent",
		);
		expect(intents).toHaveLength(2);
		expect(intents.map(({ args }) => args?.intent)).toEqual([
			{
				movementEpoch: 1,
				session: 7,
				sequence: 0,
				worldDisplacementTotal: [0, 0, 0],
				worldVelocity: [1, 2, 3],
			},
			{
				movementEpoch: 1,
				session: 7,
				sequence: 1,
				worldDisplacementTotal: [0, 0, 0],
				worldVelocity: [3, 2, 1],
			},
		]);
	});

	it("carries cumulative wheel displacement across later input replacements", async () => {
		const test = harness();
		const session = new PhysicalFlySession(test.transport);
		await session.start(placement());
		await session.addDisplacement([0, 0, 2], [0, 0, 0]);
		await session.addDisplacement([0, 0, -0.5], [0, 0, 0]);
		await session.setIntent([1, 0, 0]);

		const totals = test.calls
			.filter(({ command }) => command === "set_physical_fly_intent")
			.map(
				({ args }) =>
					(args?.intent as { worldDisplacementTotal: number[] })
						.worldDisplacementTotal,
			);
		expect(totals).toEqual([
			[0, 0, 2],
			[0, 0, 1.5],
			[0, 0, 1.5],
		]);
	});

	it("starts a new movement epoch after an immediate stop", async () => {
		const test = harness();
		const session = new PhysicalFlySession(test.transport);
		await session.start(placement());
		await session.setIntent([1, 0, 0]);
		await session.setIntent([0, 0, 0]);
		await session.setIntent([-1, 0, 0]);

		const epochs = test.calls
			.filter(({ command }) => command === "set_physical_fly_intent")
			.map(
				({ args }) => (args?.intent as { movementEpoch: number }).movementEpoch,
			);
		expect(epochs).toEqual([1, 1, 2]);
	});

	it("stops only its registered generation", async () => {
		const test = harness();
		const session = new PhysicalFlySession(test.transport);
		await session.start(placement());
		await session.stop();
		expect(test.calls.at(-1)).toEqual({
			command: "stop_physical_fly",
			args: { session: 7 },
		});
		expect(session.running).toBe(false);
	});
});
