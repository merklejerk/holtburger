import { describe, expect, it } from "vitest";

import {
	decodeHostKinematicBoomTick,
	type HostKinematicBoomIdentity,
} from "../lib/game/motion/host-kinematic-boom-path";
import {
	HostKinematicBoomSession,
	type HostKinematicBoomTransport,
} from "./host-kinematic-boom-session";

const TARGET = {
	possessionGeneration: 3,
	guid: 0xf0000001,
	entityGeneration: 2,
} as const;
const IDENTITY = { ...TARGET, boomGeneration: 4 } as const;

class RecordingTransport implements HostKinematicBoomTransport {
	readonly calls: Array<{
		command: string;
		args: Record<string, unknown> | undefined;
	}> = [];
	startResponse: Promise<HostKinematicBoomIdentity> = Promise.resolve(IDENTITY);
	intentResponses: Array<Promise<unknown> | unknown> = [];
	nextBoomGeneration = 4;

	async invoke(
		command: string,
		args?: Record<string, unknown>,
	): Promise<unknown> {
		this.calls.push({ command, args });
		if (command === "start_kinematic_boom") return this.startResponse;
		if (command === "set_kinematic_boom_intent")
			return this.intentResponses.shift() ?? "ignored-stale";
		if (command === "stop_kinematic_boom") return true;
		throw new Error(`Unexpected command ${command}.`);
	}
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((accept) => (resolve = accept));
	return { promise, resolve };
}

const worldPoint = (x: number, landblockId = 0xda55ffff) => ({
	landblockId,
	coords: { x, y: 20, z: 3 },
});

const pathPoint = (
	cameraX: number,
	landblockId = 0xda55ffff,
	pivotX = cameraX + 100,
) => ({
	position: worldPoint(cameraX, landblockId),
	visualPivot: worldPoint(pivotX),
});

function advance(
	sequence: number,
	initialX = 10,
	endX = 14,
	identity: HostKinematicBoomIdentity = IDENTITY,
) {
	return decodeHostKinematicBoomTick(
		{
			kind: "advanced",
			...identity,
			sequence,
			targetSphereRole: "primary",
			effectiveCameraRadius: 0.25,
			desiredReach: 4.5,
			renderedReach: 3.75,
			path: {
				initial: pathPoint(initialX),
				legs: [{ endFraction: 1, end: pathPoint(endX) }],
			},
			diagnostics: {
				controlLegs: 1,
				radialCasts: 1,
				transitSubsteps: 1,
				contactPasses: 0,
			},
		},
		32,
	);
}

function failure(identity: HostKinematicBoomIdentity = IDENTITY) {
	return decodeHostKinematicBoomTick(
		{
			kind: "failed",
			...identity,
			sequence: 1,
			failure: "control-leg-budget",
			held: pathPoint(12, 0xda550177),
			diagnostics: {
				controlLegs: 1,
				radialCasts: 0,
				transitSubsteps: 0,
				contactPasses: 0,
			},
		},
		32,
	);
}

function reseed(sequence: number, x: number) {
	return decodeHostKinematicBoomTick(
		{
			kind: "reseeded",
			...IDENTITY,
			sequence,
			targetSphereRole: "primary",
			effectiveCameraRadius: 0.25,
			desiredReach: 4.5,
			renderedReach: 0,
			path: {
				initial: pathPoint(x, 0xda550178),
				legs: [{ endFraction: 1, end: pathPoint(x, 0xda550178) }],
			},
			reason: "placement-recovery",
			diagnostics: {
				controlLegs: 2,
				radialCasts: 4,
				transitSubsteps: 2,
				contactPasses: 2,
			},
		},
		32,
	);
}

describe("HostKinematicBoomSession", () => {
	it("retains a first path received before registration and samples from the shared receipt", async () => {
		const registration = deferred<HostKinematicBoomIdentity>();
		const transport = new RecordingTransport();
		transport.startResponse = registration.promise;
		const session = new HostKinematicBoomSession(transport);
		const started = session.start(TARGET, 4.5, [0, 1, 0]);

		session.receive(advance(1), 32, 100);
		registration.resolve(IDENTITY);
		await started;

		expect(session.status().kind).toBe("active");
		expect(session.presentation(116)?.placement.position.x).toBeCloseTo(
			session.presentation(100)!.placement.position.x + 2,
		);
		expect(session.presentation(116)?.visualPivot.x).toBeCloseTo(
			session.presentation(100)!.visualPivot.x + 2,
		);
	});

	it("sends changed semantic intent with cumulative zoom exactly once", async () => {
		const registration = deferred<HostKinematicBoomIdentity>();
		const transport = new RecordingTransport();
		transport.startResponse = registration.promise;
		const session = new HostKinematicBoomSession(transport);
		const started = session.start(TARGET, 4.5, [0, 1, 0]);

		await session.setIntent([0, 1, 0], 0.75);
		registration.resolve(IDENTITY);
		await started;
		await session.setIntent([0, 1, 0], 0);
		await session.setIntent([1, 0, 0], -0.25);

		const intents = transport.calls.filter(
			({ command }) => command === "set_kinematic_boom_intent",
		);
		expect(intents).toHaveLength(2);
		expect(intents.map(({ args }) => args?.request)).toEqual([
			{
				...IDENTITY,
				inputSequence: 1,
				viewDirection: [0, 1, 0],
				cumulativeZoomDisplacement: 0.75,
			},
			{
				...IDENTITY,
				inputSequence: 2,
				viewDirection: [1, 0, 0],
				cumulativeZoomDisplacement: 0.5,
			},
		]);
	});

	it("bounds fixed playback to current and successor and restarts from newest explicit input", async () => {
		const session = new HostKinematicBoomSession(new RecordingTransport());
		await session.start(TARGET, 4.5, [0, 1, 0]);
		session.receive(advance(1, 10, 11), 32, 100);
		const firstX = session.presentation(100)!.placement.position.x;
		session.receive(advance(2, 11, 12), 32, 101);
		session.receive(advance(3, 20, 21), 32, 102);

		expect(session.presentation(102)?.placement.position.x).toBeCloseTo(
			firstX + 10,
		);
		expect(session.status()).toMatchObject({
			kind: "active",
			sequence: 3,
			droppedPaths: 1,
		});
	});

	it("flushes interpolation history and snaps to an explicit host reseed", async () => {
		const session = new HostKinematicBoomSession(new RecordingTransport());
		await session.start(TARGET, 4.5, [0, 1, 0]);
		session.receive(advance(1, 10, 11), 32, 100);
		session.receive(advance(2, 11, 12), 32, 101);
		session.receive(reseed(3, 50), 32, 102);

		expect(session.presentation(102)?.placement.position.x).toBeCloseTo(
			50 + 0xda * 192,
		);
		expect(session.status()).toMatchObject({
			kind: "active",
			sequence: 3,
			renderedReach: 0,
			reseedReason: "placement-recovery",
		});

		session.receive(advance(4, 50, 51), 32, 103);
		expect(session.status()).toMatchObject({
			kind: "active",
			sequence: 4,
			reseedReason: null,
		});
	});

	it("ignores stale identities, holds one terminal safe pose, and stops exactly", async () => {
		const transport = new RecordingTransport();
		const session = new HostKinematicBoomSession(transport);
		await session.start(TARGET, 4.5, [0, 1, 0]);
		const stale = { ...IDENTITY, boomGeneration: 3 };
		session.receive(advance(1, 100, 101, stale), 32, 0);
		expect(session.presentation(0)).toBeNull();

		session.receive(failure(), 32, 10);
		const held = session.presentation(10);
		session.receive(advance(1, 30, 31), 32, 11);
		expect(session.presentation(1_000)).toEqual(held);
		expect(session.status()).toMatchObject({
			kind: "failed",
			failure: "control-leg-budget",
		});

		await session.stop();
		expect(transport.calls.at(-1)).toEqual({
			command: "stop_kinematic_boom",
			args: { request: IDENTITY },
		});
		expect(session.status()).toEqual({ kind: "stopped" });
	});
});
