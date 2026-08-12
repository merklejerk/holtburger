import { describe, expect, it } from "vitest";
import { sceneVec3 } from "../lib/assets/ac-frame";
import { Vec3 } from "../lib/game/math/types";
import type { HostPhysicalCameraSegment } from "../lib/game/motion/host-physical-camera-path";
import type { PhysicalCameraPlacement } from "../lib/game/motion/host-physical-camera-path";
import {
	PhysicalCameraSession,
	type PhysicalCameraTransport,
} from "./physical-camera-session";

function segment(
	overrides: Partial<HostPhysicalCameraSegment> = {},
): HostPhysicalCameraSegment {
	return {
		session: 7,
		sequence: 0,
		mode: "physical-fly",
		residency: {
			envCellId: null,
			landblockId: "0xda55ffff",
		},
		origin: [96, 96, 20],
		velocity: [0, 0, 0],
		horizonMs: 1000 / 30,
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

function harness() {
	const calls: { command: string; args?: Record<string, unknown> }[] = [];
	let handler: ((segment: HostPhysicalCameraSegment) => void) | null = null;
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
		deliver: (next: HostPhysicalCameraSegment) => handler?.(next),
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
	it("listens before registration and evaluates the first da55 segment", async () => {
		const test = harness();
		const session = new PhysicalCameraSession(test.transport);
		await session.start(placement(), [0, 1, 0], "physical-fly");
		expect(test.calls[0]?.command).toBe("start_physical_camera");
		expect(test.calls[0]?.args?.registration).toEqual({
			mode: "physical-fly",
			residency: { envCellId: null, landblockId: "0xda55ffff" },
			scenePosition: [0xda * 192 + 96, 20, -(0x55 * 192 + 96)],
			viewDirection: [0, 1, 0],
		});

		test.deliver(segment({ velocity: [3, 0, 0] }));
		test.advance(1000 / 30);
		expect(session.placement()?.position.x).toBeCloseTo(0xda * 192 + 96.1);
	});

	it("ignores old sessions and out-of-order segments", async () => {
		const test = harness();
		const session = new PhysicalCameraSession(test.transport);
		await session.start(placement(), [0, 1, 0], "physical-fly");
		test.deliver(segment({ session: 6, origin: [1, 1, 1] }));
		test.deliver(segment({ sequence: 4, origin: [4, 4, 4] }));
		test.deliver(segment({ sequence: 2, origin: [2, 2, 2] }));
		expect(session.placement()?.position.x).toBe(0xda * 192 + 4);
	});

	it("counts sequence gaps as dropped even if an old segment arrives later", async () => {
		const test = harness();
		const session = new PhysicalCameraSession(test.transport);
		await session.start(placement(), [0, 1, 0], "physical-fly");
		test.deliver(segment({ sequence: 0 }));
		test.deliver(segment({ sequence: 3 }));
		test.deliver(segment({ sequence: 2 }));
		expect(session.status().droppedSegments).toBe(2);
	});

	it("surfaces the exact missing collision owner", async () => {
		const test = harness();
		const session = new PhysicalCameraSession(test.transport);
		await session.start(placement(), [0, 1, 0], "grounded-walk");
		expect(test.calls[0]?.args).toEqual({
			registration: expect.objectContaining({ mode: "grounded-walk" }),
		});
		test.deliver(
			segment({
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
