import { describe, expect, it } from "vitest";
import { sceneVec3 } from "../lib/assets/ac-frame";
import { Vec3 } from "../lib/game/math/types";
import type { HostPhysicalCameraPath } from "../lib/game/motion/host-physical-camera-path";
import type { PhysicalCameraPlacement } from "../lib/game/motion/host-physical-camera-path";
import {
	PhysicalCameraSession,
	type HostPhysicalCameraFailure,
	type PhysicalCameraTransport,
} from "./physical-camera-session";

function path(
	overrides: Partial<HostPhysicalCameraPath> = {},
): HostPhysicalCameraPath {
	return {
		session: 7,
		sequence: 0,
		mode: "physical-fly",
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
		grounded: false,
		constraintCount: 0,
		substeps: 1,
		contactPasses: 1,
		solveDurationMs: 0.1,
		characterEventOutcomes: [],
		...overrides,
	};
}

function movingPath(
	sequence: number,
	startX: number,
	endX: number,
): HostPhysicalCameraPath {
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
	let motionHandler: ((path: HostPhysicalCameraPath) => void) | null = null;
	let failureHandler: ((failure: HostPhysicalCameraFailure) => void) | null =
		null;
	let now = 0;
	const transport: PhysicalCameraTransport = {
		invoke: async (command, args) => {
			calls.push({ command, args });
			if (command === "start_physical_camera") {
				const kind = (args?.registration as { control: { kind: string } })
					.control.kind;
				return {
					jumpChargeDurationMs: kind === "grounded-character" ? 1_000 : null,
					session: 7,
				};
			}
			return command === "queue_grounded_camera_event" ? "queued" : undefined;
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
		deliver: (next: HostPhysicalCameraPath) => motionHandler?.(next),
		fail: (failure: HostPhysicalCameraFailure) => failureHandler?.(failure),
		advance: (milliseconds: number) => (now += milliseconds),
	};
}

function placement(
	position: readonly [number, number, number] = [
		0xda * 192 + 96,
		20,
		-(0x55 * 192 + 96),
	],
): PhysicalCameraPlacement {
	return {
		position: sceneVec3(new Vec3(...position)),
		residency: { envCellId: null, landblockId: "0xda55ffff" },
	};
}

describe("PhysicalCameraSession", () => {
	it("listens before registration and evaluates the first da55 path", async () => {
		const test = harness();
		const session = new PhysicalCameraSession(test.transport);
		await session.start(placement(), [0, 1, 0], "physical-fly");
		expect(test.calls[0]?.command).toBe("start_physical_camera");
		expect(test.calls[0]?.args?.registration).toEqual({
			body: {
				collisionExclusions: ["entirely-water-barrier"],
				responsePolicy: {
					alignPath: false,
					friction: 0.95,
					restitution: { elasticity: 0, kind: "elastic" },
					surfaceMotion: "stable",
				},
				response: {
					config: {
						maximumContactPasses: 8,
						maximumSubstepDistance: 0.25,
						maximumSubsteps: 32,
						separationEpsilon: 0.000_5,
					},
					kind: "free-sphere",
				},
				spheres: [{ center: [0, 0, 0], radius: 0.25 }],
			},
			control: {
				kind: "physical-fly",
				speedEnvelope: {
					kind: "linear-ramp",
					accelerationSeconds: 2,
					initialSpeedMultiplier: 0.125,
				},
			},
			residency: { envCellId: null, landblockId: "0xda55ffff" },
			scenePosition: [0xda * 192 + 96, 20, -(0x55 * 192 + 96)],
			viewDirection: [0, 1, 0],
		});

		test.deliver(movingPath(0, 96, 96.1));
		test.advance(1000 / 30);
		expect(session.placement()?.position.x).toBeCloseTo(0xda * 192 + 96.1);
	});

	it("ignores old sessions and out-of-order paths", async () => {
		const test = harness();
		const session = new PhysicalCameraSession(test.transport);
		await session.start(placement(), [0, 1, 0], "physical-fly");
		test.deliver(path({ session: 6 }));
		test.deliver(movingPath(4, 4, 5));
		test.deliver(movingPath(2, 2, 3));
		expect(session.placement()?.position.x).toBe(0xda * 192 + 4);
	});

	it("surfaces only terminal failures for the current session", async () => {
		const test = harness();
		const session = new PhysicalCameraSession(test.transport);
		await session.start(placement(), [0, 1, 0], "physical-fly");

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
		const session = new PhysicalCameraSession(test.transport);
		await session.start(placement(), [0, 1, 0], "physical-fly");
		test.deliver(movingPath(0, 96, 97));
		test.advance(10);
		test.deliver(movingPath(3, 50, 51));
		test.deliver(movingPath(2, 2, 3));
		expect(session.status().droppedPaths).toBe(2);
		expect(session.placement()?.position.x).toBe(0xda * 192 + 50);
	});

	it("plays one pending successor without resetting the session timeline", async () => {
		const test = harness();
		const session = new PhysicalCameraSession(test.transport);
		await session.start(placement(), [0, 1, 0], "physical-fly");
		test.deliver(movingPath(0, 96, 97));
		test.advance(20);
		test.deliver(movingPath(1, 97, 98));
		test.advance(20);
		expect(session.placement()?.position.x).toBeCloseTo(0xda * 192 + 97.2);
	});

	it("holds the exact endpoint when the host stream is late", async () => {
		const test = harness();
		const session = new PhysicalCameraSession(test.transport);
		await session.start(placement(), [0, 1, 0], "physical-fly");
		test.deliver(movingPath(0, 96, 97));
		test.advance(1_000);
		expect(session.placement()?.position.x).toBe(0xda * 192 + 97);
	});

	it("plays a late successor for a full tick from its explicit initial point", async () => {
		const test = harness();
		const session = new PhysicalCameraSession(test.transport);
		await session.start(placement(), [0, 1, 0], "physical-fly");
		test.deliver(movingPath(0, 96, 97));
		test.advance(1_000);
		test.deliver(movingPath(1, 97, 98));
		expect(session.placement()?.position.x).toBe(0xda * 192 + 97);
		test.advance(1000 / 60);
		expect(session.placement()?.position.x).toBeCloseTo(0xda * 192 + 97.5);
	});

	it("collapses stale playback when a third path arrives while rendering is suspended", async () => {
		const test = harness();
		const session = new PhysicalCameraSession(test.transport);
		await session.start(placement(), [0, 1, 0], "physical-fly");
		test.deliver(movingPath(0, 96, 97));
		test.deliver(movingPath(1, 97, 98));
		test.deliver(movingPath(2, 98, 99));
		expect(session.placement()?.position.x).toBe(0xda * 192 + 98);
	});

	it("discards two expired buffered ticks when callbacks resume after suspension", async () => {
		const test = harness();
		const session = new PhysicalCameraSession(test.transport);
		await session.start(placement(), [0, 1, 0], "physical-fly");
		test.deliver(movingPath(0, 96, 97));
		test.deliver(movingPath(1, 97, 98));
		test.advance(1_000);
		test.deliver(movingPath(2, 98, 99));
		expect(session.placement()?.position.x).toBe(0xda * 192 + 98);
	});

	it("surfaces a missing collision owner without changing solve status", async () => {
		const test = harness();
		const session = new PhysicalCameraSession(test.transport);
		await session.start(placement(), [0, 1, 0], "grounded-walk");
		expect(test.calls[0]?.args).toEqual({
			registration: expect.objectContaining({
				control: expect.objectContaining({ kind: "grounded-character" }),
			}),
		});
		expect(
			(test.calls[0]?.args?.registration as { control: object }).control,
		).not.toHaveProperty("speedEnvelope");
		test.deliver(
			path({
				mode: "grounded-walk",
				sceneResidency: {
					state: "missing-owner",
					landblockId: "0xdb55ffff",
				},
			}),
		);
		expect(session.status()).toMatchObject({
			mode: "grounded-walk",
			tick: "solved",
			sceneResidency: {
				state: "missing-owner",
				landblockId: "0xdb55ffff",
			},
		});
	});

	it("registers grounded walk with retail's floor-normal threshold", async () => {
		const test = harness();
		const session = new PhysicalCameraSession(test.transport);
		await session.start(placement(), [0, 1, 0], "grounded-walk");
		expect(test.calls[0]?.args?.registration).toMatchObject({
			control: {
				capabilities: {
					baseRunForwardSpeed: 4,
					baseWalkForwardSpeed: 3.12,
					fullChargeJumpHeight: 8.425,
					runRateScalar: 3,
				},
				kind: "grounded-character",
			},
			body: {
				collisionExclusions: [],
				responsePolicy: {
					alignPath: false,
					friction: 0.95,
					restitution: { elasticity: 0.05, kind: "elastic" },
					surfaceMotion: "stable",
				},
				response: {
					kind: "grounded",
					config: {
						walkableNormalZ: Math.fround(Math.cos(3437.746770784939)),
					},
				},
			},
		});
	});

	it("separates coalescible grounded drive from ordered lifecycle edges", async () => {
		const test = harness();
		const session = new PhysicalCameraSession(test.transport);
		await session.start(placement(), [0, 1, 0], "grounded-walk");
		expect(session.groundedJumpChargeDurationMs()).toBe(1_000);
		const drive = {
			gait: "run" as const,
			lateral: "left" as const,
			longitudinal: "forward" as const,
			turn: null,
		};
		await session.setGroundedDrive(drive, [0, 1, 0]);
		await session.setGroundedDrive(drive, [0, 1, 0]);
		await session.setGroundedDrive(drive, [1, 0, 0]);
		await session.queueGroundedEvent(
			{
				drive,
				extent: 0.5,
				kind: "release-jump",
				sequence: 4,
			},
			[0, 0, -1],
		);

		expect(
			test.calls
				.filter(({ command }) => command === "set_grounded_camera_drive")
				.map(({ args }) => args?.intent),
		).toEqual([
			{ drive, revision: 0, session: 7, viewDirection: [0, 1, 0] },
			{ drive, revision: 1, session: 7, viewDirection: [1, 0, 0] },
		]);
		expect(
			test.calls.find(
				({ command }) => command === "queue_grounded_camera_event",
			)?.args?.request,
		).toEqual({
			drive,
			extent: 0.5,
			kind: "release-jump",
			revision: 2,
			sequence: 4,
			session: 7,
			viewDirection: [0, 0, -1],
		});
	});

	it("delivers each fixed-tick character outcome to presentation once", async () => {
		const test = harness();
		const session = new PhysicalCameraSession(test.transport);
		await session.start(placement(), [0, 1, 0], "grounded-walk");
		test.deliver(
			path({
				characterEventOutcomes: [
					{ kind: "charge-accepted", sequence: 0 },
					{ kind: "rejected", reason: "airborne", sequence: 1 },
				],
				mode: "grounded-walk",
			}),
		);

		expect(session.takeCharacterEventOutcomes()).toEqual([
			{ kind: "charge-accepted", sequence: 0 },
			{ kind: "rejected", reason: "airborne", sequence: 1 },
		]);
		expect(session.takeCharacterEventOutcomes()).toEqual([]);
	});

	it("does not expose the physical-fly world-velocity bypass to grounded sessions", async () => {
		const test = harness();
		const session = new PhysicalCameraSession(test.transport);
		await session.start(placement(), [0, 1, 0], "grounded-walk");

		await expect(session.setIntent([1, 0, 0], [0, 1, 0])).rejects.toThrow(
			"only for physical fly",
		);
	});

	it("sequences distinct intents and suppresses duplicates", async () => {
		const test = harness();
		const session = new PhysicalCameraSession(test.transport);
		await session.start(placement(), [0, 1, 0], "physical-fly");
		await session.setIntent([1, 2, 3], [0, 1, 0]);
		await session.setIntent([1, 2, 3], [0, 1, 0]);
		await session.setIntent([1, 2, 3], [1, 0, 0]);
		await session.setIntent([3, 2, 1], [1, 0, 0]);
		const intents = test.calls.filter(
			({ command }) => command === "set_physical_fly_camera_intent",
		);
		expect(intents).toHaveLength(3);
		expect(intents.map(({ args }) => args?.intent)).toEqual([
			{
				movementEpoch: 1,
				session: 7,
				sequence: 0,
				viewDirection: [0, 1, 0],
				worldDisplacementTotal: [0, 0, 0],
				worldVelocity: [1, 2, 3],
			},
			{
				movementEpoch: 1,
				session: 7,
				sequence: 1,
				viewDirection: [1, 0, 0],
				worldDisplacementTotal: [0, 0, 0],
				worldVelocity: [1, 2, 3],
			},
			{
				movementEpoch: 1,
				session: 7,
				sequence: 2,
				viewDirection: [1, 0, 0],
				worldDisplacementTotal: [0, 0, 0],
				worldVelocity: [3, 2, 1],
			},
		]);
	});

	it("carries cumulative wheel displacement across later input replacements", async () => {
		const test = harness();
		const session = new PhysicalCameraSession(test.transport);
		await session.start(placement(), [0, 1, 0], "physical-fly");
		await session.addDisplacement([0, 0, 2], [0, 0, 0], [0, 1, 0]);
		await session.addDisplacement([0, 0, -0.5], [0, 0, 0], [0, 1, 0]);
		await session.setIntent([1, 0, 0], [0, 1, 0]);

		const totals = test.calls
			.filter(({ command }) => command === "set_physical_fly_camera_intent")
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
		const session = new PhysicalCameraSession(test.transport);
		await session.start(placement(), [0, 1, 0], "physical-fly");
		await session.setIntent([1, 0, 0], [0, 1, 0]);
		await session.setIntent([0, 0, 0], [0, 1, 0]);
		await session.setIntent([-1, 0, 0], [0, 1, 0]);

		const epochs = test.calls
			.filter(({ command }) => command === "set_physical_fly_camera_intent")
			.map(
				({ args }) => (args?.intent as { movementEpoch: number }).movementEpoch,
			);
		expect(epochs).toEqual([1, 1, 2]);
	});

	it("stops only its registered generation", async () => {
		const test = harness();
		const session = new PhysicalCameraSession(test.transport);
		await session.start(placement(), [0, 1, 0], "physical-fly");
		await session.stop();
		expect(test.calls.at(-1)).toEqual({
			command: "stop_physical_camera",
			args: { session: 7 },
		});
		expect(session.running).toBe(false);
	});
});
