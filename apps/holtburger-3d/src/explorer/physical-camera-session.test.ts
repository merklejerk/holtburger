import { describe, expect, it } from "vitest";
import { sceneVec3 } from "../lib/assets/ac-frame";
import { Vec3 } from "../lib/game/math/types";
import type { HostPhysicalCameraPath } from "../lib/game/motion/host-physical-camera-path";
import type { PhysicalCameraPlacement } from "../lib/game/motion/host-physical-camera-path";
import {
	PhysicalCameraSession,
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
		grounded: false,
		constraintCount: 0,
		missingLandblocks: [],
		outsideWorld: false,
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
	let handler: ((path: HostPhysicalCameraPath) => void) | null = null;
	let now = 0;
	const transport: PhysicalCameraTransport = {
		invoke: async (command, args) => {
			calls.push({ command, args });
			return command === "start_physical_camera" ? 7 : undefined;
		},
		listen: async (_event, next) => {
			handler = next;
			return () => (handler = null);
		},
		now: () => now,
	};
	return {
		calls,
		transport,
		deliver: (next: HostPhysicalCameraPath) => handler?.(next),
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
			mode: "physical-fly",
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

	it("surfaces the exact missing collision owner", async () => {
		const test = harness();
		const session = new PhysicalCameraSession(test.transport);
		await session.start(placement(), [0, 1, 0], "grounded-walk");
		expect(test.calls[0]?.args).toEqual({
			registration: expect.objectContaining({ mode: "grounded-walk" }),
		});
		test.deliver(
			path({
				mode: "grounded-walk",
				status: "missing-coverage",
				missingLandblocks: ["0xdb55ffff"],
			}),
		);
		expect(session.status()).toMatchObject({
			mode: "grounded-walk",
			tick: "missing-coverage",
			missingLandblocks: ["0xdb55ffff"],
			outsideWorld: false,
		});
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
			({ command }) => command === "set_physical_camera_intent",
		);
		expect(intents).toHaveLength(3);
		expect(intents.map(({ args }) => args?.intent)).toEqual([
			{
				session: 7,
				sequence: 0,
				viewDirection: [0, 1, 0],
				worldVelocity: [1, 2, 3],
			},
			{
				session: 7,
				sequence: 1,
				viewDirection: [1, 0, 0],
				worldVelocity: [1, 2, 3],
			},
			{
				session: 7,
				sequence: 2,
				viewDirection: [1, 0, 0],
				worldVelocity: [3, 2, 1],
			},
		]);
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
