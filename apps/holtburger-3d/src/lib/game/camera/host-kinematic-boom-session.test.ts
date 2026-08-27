import { describe, expect, it } from "vitest";

import {
	decodeHostKinematicBoomTick,
	type HostKinematicBoomIdentity,
} from "../motion/host-kinematic-boom-path";
import {
	HostKinematicBoomSession,
	type HostKinematicBoomTransport,
} from "./host-kinematic-boom-session";
import { createProjectionClearanceRevision } from "./projection-clearance";

const TARGET = {
	possessionGeneration: 3,
	guid: 0xf0000001,
	entityGeneration: 2,
} as const;
const IDENTITY = { ...TARGET, boomGeneration: 4 } as const;
const DISTANCE = { initial: 4.5, minimum: 1.2, maximum: 8 } as const;
const PROJECTION = createProjectionClearanceRevision(
	1,
	{ fov: 75, near: 0.5 },
	{ height: 720, width: 1_280 },
);
const CLEARANCE = {
	projectionRevision: PROJECTION.revision,
	radius: PROJECTION.clearanceRadius,
} as const;

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
		if (
			command === "set_kinematic_boom_intent" ||
			command === "set_kinematic_boom_clearance"
		)
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
	clearance: {
		readonly projectionRevision: number;
		readonly radius: number;
	} = CLEARANCE,
) {
	return decodeHostKinematicBoomTick(
		{
			kind: "advanced",
			...identity,
			sequence,
			targetSphereRole: "primary",
			clearance,
			desiredReach: 4.5,
			renderedReach: 3.75,
			path: {
				initial: pathPoint(initialX),
				legs: [{ endFraction: 1, end: pathPoint(endX) }],
			},
			diagnostics: {
				collisionProof: { status: "covered" },
				controlLegs: 1,
				clearanceSweeps: 1,
				transitSubsteps: 1,
				contactPasses: 0,
			},
		},
		32,
	);
}

function held(identity: HostKinematicBoomIdentity = IDENTITY) {
	return decodeHostKinematicBoomTick(
		{
			kind: "held",
			...identity,
			sequence: 1,
			targetSphereRole: "primary",
			clearance: CLEARANCE,
			desiredReach: 4.5,
			renderedReach: 3.75,
			path: {
				initial: pathPoint(12, 0xda550177),
				legs: [{ endFraction: 1, end: pathPoint(12, 0xda550177) }],
			},
			reason: "clearance-sweep",
			diagnostics: {
				collisionProof: { status: "covered" },
				controlLegs: 1,
				clearanceSweeps: 0,
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
			clearance: CLEARANCE,
			desiredReach: 4.5,
			renderedReach: 0,
			path: {
				initial: pathPoint(x, 0xda550178),
				legs: [{ endFraction: 1, end: pathPoint(x, 0xda550178) }],
			},
			reason: "placement-recovery",
			diagnostics: {
				collisionProof: { status: "covered" },
				controlLegs: 2,
				clearanceSweeps: 4,
				transitSubsteps: 2,
				contactPasses: 2,
			},
		},
		32,
	);
}

describe("HostKinematicBoomSession", () => {
	it("registers the complete distance policy with the host", async () => {
		const transport = new RecordingTransport();
		const session = new HostKinematicBoomSession(transport);

		await session.start(TARGET, DISTANCE, [0, 1, 0], PROJECTION);

		expect(transport.calls[0]).toEqual({
			command: "start_kinematic_boom",
			args: {
				request: {
					...TARGET,
					initialReach: 4.5,
					minimumReach: 1.2,
					maximumReach: 8,
					inputSequence: 0,
					viewDirection: [0, 1, 0],
					cumulativeZoomDisplacement: 0,
					projectionRevision: PROJECTION.revision,
					clearanceRadius: PROJECTION.clearanceRadius,
				},
			},
		});
	});

	it("retains a first path received before registration and samples from the shared receipt", async () => {
		const registration = deferred<HostKinematicBoomIdentity>();
		const transport = new RecordingTransport();
		transport.startResponse = registration.promise;
		const session = new HostKinematicBoomSession(transport);
		const started = session.start(TARGET, DISTANCE, [0, 1, 0], PROJECTION);

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
		const started = session.start(TARGET, DISTANCE, [0, 1, 0], PROJECTION);

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
		await session.start(TARGET, DISTANCE, [0, 1, 0], PROJECTION);
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

	it("activates a larger projection only when its matching path reaches playback", async () => {
		const session = new HostKinematicBoomSession(new RecordingTransport());
		await session.start(TARGET, DISTANCE, [0, 1, 0], PROJECTION);
		session.receive(advance(1, 10, 11), 32, 100);
		const wider = createProjectionClearanceRevision(
			2,
			{ fov: 100, near: 0.5 },
			PROJECTION.extent,
		);
		await session.setClearance(wider);
		session.receive(
			advance(2, 11, 12, IDENTITY, {
				projectionRevision: wider.revision,
				radius: wider.clearanceRadius,
			}),
			32,
			110,
		);

		expect(session.acknowledgedProjection(110)?.revision).toBe(1);
		expect(session.acknowledgedProjection(132)?.revision).toBe(2);
	});

	it("flushes interpolation history and snaps to an explicit host reseed", async () => {
		const session = new HostKinematicBoomSession(new RecordingTransport());
		await session.start(TARGET, DISTANCE, [0, 1, 0], PROJECTION);
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
			placementOutcome: { kind: "reseeded", reason: "placement-recovery" },
		});

		session.receive(advance(4, 50, 51), 32, 103);
		expect(session.status()).toMatchObject({
			kind: "active",
			sequence: 4,
			placementOutcome: null,
		});
	});

	it("ignores stale identities, recovers after a held path, and stops exactly", async () => {
		const transport = new RecordingTransport();
		const session = new HostKinematicBoomSession(transport);
		await session.start(TARGET, DISTANCE, [0, 1, 0], PROJECTION);
		const stale = { ...IDENTITY, boomGeneration: 3 };
		session.receive(advance(1, 100, 101, stale), 32, 0);
		expect(session.presentation(0)).toBeNull();

		session.receive(held(), 32, 10);
		const heldPresentation = session.presentation(10);
		expect(session.presentation(1_000)).toEqual(heldPresentation);
		expect(session.status()).toMatchObject({
			kind: "active",
			placementOutcome: { kind: "held", reason: "clearance-sweep" },
		});

		session.receive(advance(2, 12, 13), 32, 11);
		expect(session.presentation(58)?.placement.position.x).toBeGreaterThan(
			heldPresentation!.placement.position.x,
		);
		expect(session.status()).toMatchObject({
			kind: "active",
			sequence: 2,
			placementOutcome: null,
		});

		await session.stop();
		expect(transport.calls.at(-1)).toEqual({
			command: "stop_kinematic_boom",
			args: { request: IDENTITY },
		});
		expect(session.status()).toEqual({ kind: "stopped" });
	});
});
