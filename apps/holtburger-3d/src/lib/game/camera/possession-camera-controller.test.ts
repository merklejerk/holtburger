import { describe, expect, it } from "vitest";
import { createProjectionClearanceRevision } from "./projection-clearance";
import { PossessionCameraController } from "./possession-camera-controller";
import type { HostKinematicBoomTransport } from "./host-kinematic-boom-session";

const TARGET = {
	possessionGeneration: 3,
	guid: 0xf0000001,
	entityGeneration: 2,
} as const;
const IDENTITY = { ...TARGET, boomGeneration: 4 } as const;
const DISTANCE = { initial: 4.5, minimum: 1.2, maximum: 8 } as const;
const ORBIT = {
	maximumPitchRadians: 1,
	pitchRadiansPerPixel: 0.02,
	yawRadiansPerPixel: 0.01,
} as const;
const PROJECTION = createProjectionClearanceRevision(
	1,
	{ fov: 75, near: 0.1 },
	{ height: 720, width: 1_280 },
);

class RecordingTransport implements HostKinematicBoomTransport {
	readonly calls: Array<{
		readonly command: string;
		readonly args: Record<string, unknown> | undefined;
	}> = [];

	async invoke(
		command: string,
		args?: Record<string, unknown>,
	): Promise<unknown> {
		this.calls.push({ command, args });
		if (command === "start_kinematic_boom") return IDENTITY;
		if (
			command === "set_kinematic_boom_intent" ||
			command === "set_kinematic_boom_clearance"
		) {
			return "accepted";
		}
		if (command === "stop_kinematic_boom") return true;
		throw new Error(`Unexpected command ${command}.`);
	}
}

describe("PossessionCameraController", () => {
	it("owns desired orbit and accumulated zoom behind an injected host transport", async () => {
		const transport = new RecordingTransport();
		const controller = new PossessionCameraController({
			initialLook: { pitchRadians: 0, yawRadians: 0 },
			orbit: ORBIT,
			recenter: { delayMs: 1_000, durationMs: 200 },
			transport,
		});
		await controller.start(TARGET, DISTANCE, PROJECTION);

		expect(transport.calls[0].args?.request).toMatchObject({
			...TARGET,
			projectionRevision: 1,
			clearanceRadius: PROJECTION.clearanceRadius,
			viewDirection: [0, -1, 0],
		});

		controller.orbit(10, -20, 0);
		controller.zoom(0.5);
		controller.zoom(-0.2);
		await controller.synchronize(PROJECTION, 0, 0);

		const intent = transport.calls.find(
			({ command }) => command === "set_kinematic_boom_intent",
		);
		expect(intent?.args?.request).toMatchObject({
			...IDENTITY,
			cumulativeZoomDisplacement: 0.3,
		});
		expect(controller.desiredLook()).toEqual({
			pitchRadians: -0.4,
			yawRadians: -0.1,
		});
	});

	it("coalesces identical projection revisions and sends only a newer revision", async () => {
		const transport = new RecordingTransport();
		const controller = new PossessionCameraController({
			initialLook: { pitchRadians: 0, yawRadians: 0 },
			orbit: ORBIT,
			recenter: { delayMs: 1_000, durationMs: 200 },
			transport,
		});
		await controller.start(TARGET, DISTANCE, PROJECTION);
		await controller.synchronize(PROJECTION, 0, 0);
		const next = createProjectionClearanceRevision(
			2,
			{ fov: 90, near: 0.1 },
			PROJECTION.extent,
		);
		await controller.synchronize(next, 0, 0);

		expect(
			transport.calls.filter(
				({ command }) => command === "set_kinematic_boom_clearance",
			),
		).toHaveLength(1);
	});

	it("advances rear-follow before IPC and queues no work for an unchanged frame", async () => {
		const transport = new RecordingTransport();
		const controller = new PossessionCameraController({
			initialLook: { pitchRadians: 0, yawRadians: 0 },
			orbit: ORBIT,
			recenter: { delayMs: 0, durationMs: 0 },
			transport,
		});
		await controller.start(TARGET, DISTANCE, PROJECTION);
		controller.followRear(0);
		controller.advance(0, Math.PI / 2);
		expect(controller.desiredLook().yawRadians).toBeCloseTo(Math.PI / 2);
		const submit = controller.queueSynchronization(PROJECTION);
		if (submit === null) throw new Error("Expected changed camera input.");
		expect(controller.queueSynchronization(PROJECTION)).toBeNull();
		const callsBeforeSubmission = transport.calls.length;
		await submit();
		expect(transport.calls.length).toBeGreaterThan(callsBeforeSubmission);

		controller.advance(1, Math.PI);
		expect(controller.queueSynchronization(PROJECTION)).not.toBeNull();
	});

	it.each([false, true])(
		"retires deferred camera input on replacement (stop first: %s)",
		async (stopFirst) => {
			const transport = new RecordingTransport();
			const controller = new PossessionCameraController({
				initialLook: { pitchRadians: 0, yawRadians: 0 },
				orbit: ORBIT,
				recenter: { delayMs: 0, durationMs: 0 },
				transport,
			});
			await controller.start(TARGET, DISTANCE, PROJECTION);
			controller.zoom(1);
			const stale = controller.queueSynchronization(PROJECTION);
			if (stale === null) throw new Error("Expected queued zoom.");
			if (stopFirst) await controller.stop();
			await controller.start(TARGET, DISTANCE, PROJECTION);
			const count = transport.calls.length;
			await stale();
			expect(transport.calls).toHaveLength(count);
			controller.zoom(0.5);
			await controller.synchronize(PROJECTION, 0, 0);
			expect(transport.calls.at(-1)?.args?.request).toMatchObject({
				cumulativeZoomDisplacement: 0.5,
			});
		},
	);

	it("rearms rear-facing recentering for continuous translation and preserves pitch", async () => {
		const transport = new RecordingTransport();
		const controller = new PossessionCameraController({
			initialLook: { pitchRadians: -0.4, yawRadians: 0.2 },
			orbit: ORBIT,
			recenter: { delayMs: 1_000, durationMs: 200 },
			transport,
		});
		await controller.start(TARGET, DISTANCE, PROJECTION);

		controller.setTranslationIntent(true, 0);
		await controller.synchronize(PROJECTION, 999, Math.PI / 2);
		expect(controller.desiredLook()).toMatchObject({
			pitchRadians: -0.4,
			yawRadians: 0.2,
		});

		await controller.synchronize(PROJECTION, 1_000, Math.PI / 2);
		await controller.synchronize(PROJECTION, 1_100, Math.PI / 2);
		const midway = controller.desiredLook();
		expect(midway.pitchRadians).toBe(-0.4);
		expect(midway.yawRadians).toBeGreaterThan(0.2);
		expect(midway.yawRadians).toBeLessThan(Math.PI / 2);

		await controller.synchronize(PROJECTION, 1_200, Math.PI / 2);
		expect(controller.desiredLook()).toEqual({
			pitchRadians: -0.4,
			yawRadians: Math.PI / 2,
		});

		// The rear pin survives movement release and follows subsequent entity turns.
		controller.setTranslationIntent(false, 1_201);
		await controller.synchronize(PROJECTION, 1_202, 0.8);
		expect(controller.desiredLook().pitchRadians).toBe(-0.4);
		expect(controller.desiredLook().yawRadians).toBeCloseTo(0.8);
	});

	it.each([0, 1_100, 1_200])(
		"holds orbit through recentering at %s ms and rearms only on release",
		async (heldAt) => {
			const controller = new PossessionCameraController({
				initialLook: { pitchRadians: -0.4, yawRadians: 0.2 },
				orbit: ORBIT,
				recenter: { delayMs: 1_000, durationMs: 200 },
				transport: new RecordingTransport(),
			});
			await controller.start(TARGET, DISTANCE, PROJECTION);
			controller.setTranslationIntent(true, 0);
			await controller.synchronize(PROJECTION, heldAt, 1);
			controller.setOrbitHeld(true, heldAt);
			const heldLook = controller.desiredLook();
			await controller.synchronize(PROJECTION, heldAt + 5_000, 2);
			expect(controller.desiredLook()).toEqual(heldLook);
			controller.setOrbitHeld(false, heldAt + 5_000);
			await controller.synchronize(PROJECTION, heldAt + 5_999, 2);
			expect(controller.desiredLook()).toEqual(heldLook);
			await controller.synchronize(PROJECTION, heldAt + 6_200, 2);
			expect(controller.desiredLook()).toEqual({ ...heldLook, yawRadians: 2 });
		},
	);

	it("does not arm movement recentering during orbit or after movement ends during the hold", async () => {
		const controller = new PossessionCameraController({
			initialLook: { pitchRadians: 0, yawRadians: 0.4 },
			orbit: ORBIT,
			recenter: { delayMs: 100, durationMs: 0 },
			transport: new RecordingTransport(),
		});
		await controller.start(TARGET, DISTANCE, PROJECTION);
		controller.setOrbitHeld(true, 0);
		controller.setTranslationIntent(true, 1);
		controller.orbit(10, 0, 2);
		await controller.synchronize(PROJECTION, 1_000, 2);
		expect(controller.desiredLook().yawRadians).toBeCloseTo(0.3);
		controller.setTranslationIntent(false, 1_001);
		controller.setOrbitHeld(false, 1_002);
		await controller.synchronize(PROJECTION, 2_000, 2);
		expect(controller.desiredLook().yawRadians).toBeCloseTo(0.3);
	});

	it("cancels an armed recenter when continuous movement ends early", async () => {
		const transport = new RecordingTransport();
		const controller = new PossessionCameraController({
			initialLook: { pitchRadians: 0, yawRadians: 0.4 },
			orbit: ORBIT,
			recenter: { delayMs: 1_000, durationMs: 0 },
			transport,
		});
		await controller.start(TARGET, DISTANCE, PROJECTION);

		controller.setTranslationIntent(true, 0);
		controller.setTranslationIntent(false, 999);
		await controller.synchronize(PROJECTION, 1_000, Math.PI / 2);
		expect(controller.desiredLook().yawRadians).toBeCloseTo(0.4);
	});

	it("treats backward and lateral intent as movement and lets orbit restart the dwell", async () => {
		const transport = new RecordingTransport();
		const controller = new PossessionCameraController({
			initialLook: { pitchRadians: 0, yawRadians: 0 },
			orbit: ORBIT,
			recenter: { delayMs: 1_000, durationMs: 0 },
			transport,
		});
		await controller.start(TARGET, DISTANCE, PROJECTION);

		controller.setTranslationIntent(true, 0);
		controller.orbit(10, 0, 500);
		await controller.synchronize(PROJECTION, 1_499, Math.PI);
		expect(controller.desiredLook().yawRadians).toBeCloseTo(-0.1);
		await controller.synchronize(PROJECTION, 1_500, Math.PI);
		expect(controller.desiredLook().yawRadians).toBeCloseTo(Math.PI);

		// A turn while still pinned tracks the new rear direction.
		await controller.synchronize(PROJECTION, 1_550, Math.PI / 2);
		expect(controller.desiredLook().yawRadians).toBeCloseTo(Math.PI / 2);

		// Orbit is the explicit release gesture; movement can then arm a new dwell.
		controller.setTranslationIntent(false, 1_551);
		controller.orbit(10, 0, 1_600);
		expect(controller.desiredLook().yawRadians).toBeCloseTo(Math.PI / 2 - 0.1);
		controller.setTranslationIntent(true, 1_601);
		await controller.synchronize(PROJECTION, 2_600, Math.PI / 2);
		expect(controller.desiredLook().yawRadians).toBeCloseTo(Math.PI / 2 - 0.1);
		await controller.synchronize(PROJECTION, 2_601, Math.PI / 2);
		expect(controller.desiredLook().yawRadians).toBeCloseTo(Math.PI / 2);
	});

	it("enters the persistent pin even when already facing the rear", async () => {
		const transport = new RecordingTransport();
		const controller = new PossessionCameraController({
			initialLook: { pitchRadians: -0.2, yawRadians: 0 },
			orbit: ORBIT,
			recenter: { delayMs: 100, durationMs: 0 },
			transport,
		});
		await controller.start(TARGET, DISTANCE, PROJECTION);

		controller.setTranslationIntent(true, 0);
		await controller.synchronize(PROJECTION, 100, 0);
		await controller.synchronize(PROJECTION, 101, 0.6);
		expect(controller.desiredLook().pitchRadians).toBe(-0.2);
		expect(controller.desiredLook().yawRadians).toBeCloseTo(0.6);
	});

	it("takes the shortest route across the yaw seam", async () => {
		const transport = new RecordingTransport();
		const controller = new PossessionCameraController({
			initialLook: { pitchRadians: 0, yawRadians: Math.PI - 0.1 },
			orbit: ORBIT,
			recenter: { delayMs: 0, durationMs: 100 },
			transport,
		});
		await controller.start(TARGET, DISTANCE, PROJECTION);
		controller.setTranslationIntent(true, 0);
		await controller.synchronize(PROJECTION, 50, -Math.PI + 0.1);
		expect(controller.desiredLook().yawRadians).toBeGreaterThan(Math.PI - 0.1);
		await controller.synchronize(PROJECTION, 100, -Math.PI + 0.1);
		expect(controller.desiredLook().yawRadians).toBeCloseTo(-Math.PI + 0.1);
	});
});

it("enters sticky rear-follow without translation and releases it on free orbit", async () => {
	const recenter = { delayMs: 1000, durationMs: 200 };
	const controller = new PossessionCameraController({
		initialLook: { pitchRadians: -0.4, yawRadians: 0 },
		orbit: ORBIT,
		recenter,
		transport: new RecordingTransport(),
	});
	await controller.start(TARGET, DISTANCE, PROJECTION);
	controller.followRear(0);
	await controller.synchronize(PROJECTION, recenter.durationMs / 2, 1);
	expect(controller.desiredLook().yawRadians).toBeCloseTo(0.5);
	await controller.synchronize(PROJECTION, recenter.durationMs, 1);
	await controller.synchronize(PROJECTION, recenter.durationMs + 1, 1.5);
	expect(controller.desiredLook()).toEqual({
		pitchRadians: -0.4,
		yawRadians: 1.5,
	});
	controller.orbit(10, 0, recenter.durationMs + 2);
	const free = controller.desiredLook();
	await controller.synchronize(PROJECTION, recenter.durationMs + 3, 2);
	expect(controller.desiredLook()).toEqual(free);
});

it("adjusts pitch during rear-follow entry and while pinned without changing yaw ownership", async () => {
	const recenter = { delayMs: 1000, durationMs: 200 };
	const controller = new PossessionCameraController({
		initialLook: { pitchRadians: 0, yawRadians: 0 },
		orbit: ORBIT,
		recenter,
		transport: new RecordingTransport(),
	});
	await controller.start(TARGET, DISTANCE, PROJECTION);
	controller.followRear(0);
	await controller.synchronize(PROJECTION, recenter.durationMs / 2, 1);
	controller.pitch(5);
	expect(controller.desiredLook()).toEqual({
		pitchRadians: 5 * ORBIT.pitchRadiansPerPixel,
		yawRadians: 0.5,
	});
	await controller.synchronize(PROJECTION, recenter.durationMs, 1);
	expect(controller.desiredLook().yawRadians).toBe(1);
	controller.pitch(
		(2 * ORBIT.maximumPitchRadians) / ORBIT.pitchRadiansPerPixel,
	);
	await controller.synchronize(PROJECTION, recenter.durationMs + 1, 1.5);
	expect(controller.desiredLook()).toEqual({
		pitchRadians: ORBIT.maximumPitchRadians,
		yawRadians: 1.5,
	});
	controller.pitch(
		(-3 * ORBIT.maximumPitchRadians) / ORBIT.pitchRadiansPerPixel,
	);
	await controller.synchronize(PROJECTION, recenter.durationMs + 2, 2);
	expect(controller.desiredLook()).toEqual({
		pitchRadians: -ORBIT.maximumPitchRadians,
		yawRadians: 2,
	});
});

describe("PossessionCameraController idle orbit", () => {
	const IDLE_ORBIT_DELAY_MS = 5_000;
	const IDLE_ORBIT = {
		angularSpeedRadiansPerSecond: 0.4,
		easeInDurationMs: 2_000,
		returnDurationMs: 400,
	} as const;

	it("waits through the dwell, eases in smoothly without changing pitch, and reaches steady angular speed", async () => {
		const controller = new PossessionCameraController({
			initialLook: { pitchRadians: -0.35, yawRadians: 0.25 },
			orbit: ORBIT,
			recenter: { delayMs: 1_000, durationMs: 200 },
			idleOrbit: IDLE_ORBIT,
			idleOrbitDelayMs: IDLE_ORBIT_DELAY_MS,
			transport: new RecordingTransport(),
		});
		await controller.start(TARGET, DISTANCE, PROJECTION);

		// First frame arms the countdown; before deadline no yaw change or IPC occurs.
		await controller.synchronize(PROJECTION, 1_000, 0);
		await controller.synchronize(PROJECTION, 5_999, 0);
		expect(controller.desiredLook()).toEqual({
			pitchRadians: -0.35,
			yawRadians: 0.25,
		});

		// Crossing deadline enters orbiting at rest (no jump, even after a large clock gap).
		await controller.synchronize(PROJECTION, 20_000, 0);
		expect(controller.desiredLook()).toEqual({
			pitchRadians: -0.35,
			yawRadians: 0.25,
		});

		// Midpoint of ease-in (u = 0.5): integral u^3 - 0.5*u^4 = 0.09375, delta = 0.4 * 2 * 0.09375 = 0.075.
		await controller.synchronize(PROJECTION, 21_000, 0);
		expect(controller.desiredLook().pitchRadians).toBe(-0.35);
		expect(controller.desiredLook().yawRadians).toBeCloseTo(0.25 + 0.075, 6);

		// End of ease-in (t = 2s): delta = 0.5 * speed * rampSeconds = 0.4.
		await controller.synchronize(PROJECTION, 22_000, 0);
		expect(controller.desiredLook().yawRadians).toBeCloseTo(0.25 + 0.4, 6);

		// Steady state (+1s after ramp): advances by exactly angularSpeedRadiansPerSecond.
		await controller.synchronize(PROJECTION, 23_000, 0);
		expect(controller.desiredLook().yawRadians).toBeCloseTo(0.25 + 0.8, 6);
	});

	it("cancels idle orbit in place on manual orbit drag, hold, zoom, and immediate disable", async () => {
		const makeOrbiting = async () => {
			const controller = new PossessionCameraController({
				initialLook: { pitchRadians: -0.2, yawRadians: 0 },
				orbit: ORBIT,
				recenter: { delayMs: 1_000, durationMs: 200 },
				idleOrbit: IDLE_ORBIT,
				idleOrbitDelayMs: IDLE_ORBIT_DELAY_MS,
				transport: new RecordingTransport(),
			});
			await controller.start(TARGET, DISTANCE, PROJECTION);
			await controller.synchronize(PROJECTION, 0, 0);
			await controller.synchronize(PROJECTION, 5_000, 0);
			await controller.synchronize(PROJECTION, 8_000, 0);
			return controller;
		};

		// Manual orbit drag cancels in place and applies the drag from the orbited yaw.
		const drag = await makeOrbiting();
		const orbitedYaw = drag.desiredLook().yawRadians;
		expect(orbitedYaw).toBeGreaterThan(0.5);
		drag.setOrbitHeld(true, 8_000);
		drag.orbit(10, 0, 8_010);
		drag.setOrbitHeld(false, 8_020);
		await drag.synchronize(PROJECTION, 8_500, 0);
		expect(drag.desiredLook().yawRadians).toBeCloseTo(
			orbitedYaw - 10 * ORBIT.yawRadiansPerPixel,
			6,
		);

		// Non-zero zoom cancels in place; zero zoom is a no-op.
		const zoomed = await makeOrbiting();
		zoomed.zoom(0);
		await zoomed.synchronize(PROJECTION, 8_500, 0);
		const afterZeroZoom = zoomed.desiredLook().yawRadians;
		expect(afterZeroZoom).toBeGreaterThan(orbitedYaw);
		zoomed.zoom(0.5);
		await zoomed.synchronize(PROJECTION, 9_000, 0);
		expect(zoomed.desiredLook().yawRadians).toBeCloseTo(afterZeroZoom, 6);

		// Immediate disable (e.g. prefers-reduced-motion) stops in place without returning.
		const reduced = await makeOrbiting();
		reduced.setIdleOrbitDelayMs(0, 8_000, { immediate: true });
		await reduced.synchronize(PROJECTION, 8_500, 0);
		expect(reduced.desiredLook().yawRadians).toBeCloseTo(orbitedYaw, 6);
	});

	it("smoothly returns to the pre-idle free angle on world activity and survives sustained blocking", async () => {
		const controller = new PossessionCameraController({
			initialLook: { pitchRadians: -0.2, yawRadians: 0.3 },
			orbit: ORBIT,
			recenter: { delayMs: 1_000, durationMs: 200 },
			idleOrbit: IDLE_ORBIT,
			idleOrbitDelayMs: IDLE_ORBIT_DELAY_MS,
			transport: new RecordingTransport(),
		});
		await controller.start(TARGET, DISTANCE, PROJECTION);
		await controller.synchronize(PROJECTION, 0, 0);
		await controller.synchronize(PROJECTION, 5_000, 0);
		await controller.synchronize(PROJECTION, 8_000, 0);
		const orbitedYaw = controller.desiredLook().yawRadians;
		expect(orbitedYaw).toBeGreaterThan(0.3);

		// Sustained combat / world blocking wakes into returning and must not abort the sweep.
		await controller.synchronize(PROJECTION, 8_000, 0, { idleBlocked: true });
		await controller.synchronize(PROJECTION, 8_200, 0, { idleBlocked: true });
		const midway = controller.desiredLook().yawRadians;
		expect(midway).toBeCloseTo((orbitedYaw + 0.3) / 2, 6);

		await controller.synchronize(PROJECTION, 8_400, 0, { idleBlocked: true });
		expect(controller.desiredLook().yawRadians).toBeCloseTo(0.3, 6);

		// Remains inactive while still blocked; re-arms only after unblocked.
		await controller.synchronize(PROJECTION, 20_000, 0, { idleBlocked: true });
		expect(controller.desiredLook().yawRadians).toBeCloseTo(0.3, 6);
	});

	it("smoothly returns to live facing and restores sticky rear-pin when idle began while pinned", async () => {
		const controller = new PossessionCameraController({
			initialLook: { pitchRadians: -0.2, yawRadians: 0 },
			orbit: ORBIT,
			recenter: { delayMs: 1_000, durationMs: 200 },
			idleOrbit: IDLE_ORBIT,
			idleOrbitDelayMs: IDLE_ORBIT_DELAY_MS,
			transport: new RecordingTransport(),
		});
		await controller.start(TARGET, DISTANCE, PROJECTION);

		// Pin camera behind the character facing yaw = 0.5.
		controller.followRear(0);
		await controller.synchronize(PROJECTION, 200, 0.5);
		expect(controller.desiredLook().yawRadians).toBeCloseTo(0.5, 6);

		// Dwell and enter idle orbit.
		await controller.synchronize(PROJECTION, 5_200, 0.5);
		await controller.synchronize(PROJECTION, 8_200, 0.5);
		const orbitedYaw = controller.desiredLook().yawRadians;
		expect(orbitedYaw).toBeGreaterThan(0.5);

		// Wake with movement while the character turns to yaw = 0.9.
		controller.setTranslationIntent(true, 8_200);
		await controller.synchronize(PROJECTION, 8_400, 0.9);
		const midway = controller.desiredLook().yawRadians;
		expect(midway).toBeGreaterThan(0.9);
		expect(midway).toBeLessThan(orbitedYaw);

		// Completion restores sticky rear-pin, tracking further turns after movement stops.
		await controller.synchronize(PROJECTION, 8_600, 0.9);
		expect(controller.desiredLook().yawRadians).toBeCloseTo(0.9, 6);
		controller.setTranslationIntent(false, 8_601);
		await controller.synchronize(PROJECTION, 8_650, 1.1);
		expect(controller.desiredLook().yawRadians).toBeCloseTo(1.1, 6);
	});

	it("transitions smoothly on followRear during idle orbit even if previously pinned", async () => {
		const controller = new PossessionCameraController({
			initialLook: { pitchRadians: 0, yawRadians: 0 },
			orbit: ORBIT,
			recenter: { delayMs: 1_000, durationMs: 200 },
			idleOrbit: IDLE_ORBIT,
			idleOrbitDelayMs: IDLE_ORBIT_DELAY_MS,
			transport: new RecordingTransport(),
		});
		await controller.start(TARGET, DISTANCE, PROJECTION);
		controller.followRear(0);
		await controller.synchronize(PROJECTION, 200, 0);
		await controller.synchronize(PROJECTION, 5_200, 0);
		await controller.synchronize(PROJECTION, 8_200, 0);
		const orbitedYaw = controller.desiredLook().yawRadians;
		expect(orbitedYaw).toBeGreaterThan(0.5);

		controller.followRear(8_200);
		await controller.synchronize(PROJECTION, 8_300, 0);
		expect(controller.desiredLook().yawRadians).toBeCloseTo(orbitedYaw / 2, 6);
		await controller.synchronize(PROJECTION, 8_400, 0);
		expect(controller.desiredLook().yawRadians).toBeCloseTo(0, 6);
	});

	it("hands off from a free idle return to movement recenter when translation outlives recenter delay", async () => {
		const controller = new PossessionCameraController({
			initialLook: { pitchRadians: 0, yawRadians: 0.4 },
			orbit: ORBIT,
			recenter: { delayMs: 200, durationMs: 200 },
			idleOrbit: { ...IDLE_ORBIT, returnDurationMs: 1_000 },
			idleOrbitDelayMs: IDLE_ORBIT_DELAY_MS,
			transport: new RecordingTransport(),
		});
		await controller.start(TARGET, DISTANCE, PROJECTION);
		await controller.synchronize(PROJECTION, 0, -1.0);
		await controller.synchronize(PROJECTION, 5_000, -1.0);
		await controller.synchronize(PROJECTION, 8_000, -1.0);

		controller.setTranslationIntent(true, 8_000);
		// Before recenter delay, returning moves toward pre-idle yaw (0.4).
		await controller.synchronize(PROJECTION, 8_100, -1.0);
		expect(controller.desiredLook().yawRadians).toBeGreaterThan(0.4);
		// Once recenter fires at 8_200 and completes at 8_400, camera pins to facing (-1.0).
		await controller.synchronize(PROJECTION, 8_400, -1.0);
		expect(controller.desiredLook().yawRadians).toBeCloseTo(-1.0, 6);
	});

	it("eases back when timeout is set to zero, re-arms on live delay edits, and respects noteWorldActivity", async () => {
		const controller = new PossessionCameraController({
			initialLook: { pitchRadians: 0, yawRadians: 0 },
			orbit: ORBIT,
			recenter: { delayMs: 1_000, durationMs: 200 },
			idleOrbit: IDLE_ORBIT,
			idleOrbitDelayMs: IDLE_ORBIT_DELAY_MS,
			transport: new RecordingTransport(),
		});
		await controller.start(TARGET, DISTANCE, PROJECTION);
		await controller.synchronize(PROJECTION, 0, 0);
		// World activity during dwell resets the deadline.
		controller.noteWorldActivity(4_000);
		await controller.synchronize(PROJECTION, 5_000, 0);
		await controller.synchronize(PROJECTION, 9_999, 0);
		expect(controller.desiredLook().yawRadians).toBe(0);

		// Raising timeout while armed replaces the pending deadline cleanly.
		controller.setIdleOrbitDelayMs(10_000, 9_999);
		await controller.synchronize(PROJECTION, 10_000, 0);
		await controller.synchronize(PROJECTION, 19_999, 0);
		expect(controller.desiredLook().yawRadians).toBe(0);

		// Reaching the new deadline orbits; setting timeout to 0 eases smoothly back to 0.
		await controller.synchronize(PROJECTION, 20_000, 0);
		await controller.synchronize(PROJECTION, 23_000, 0);
		expect(controller.desiredLook().yawRadians).toBeGreaterThan(0.5);
		controller.setIdleOrbitDelayMs(0, 23_000);
		await controller.synchronize(PROJECTION, 23_200, 0);
		expect(controller.desiredLook().yawRadians).toBeGreaterThan(0.2);
		await controller.synchronize(PROJECTION, 23_400, 0);
		expect(controller.desiredLook().yawRadians).toBeCloseTo(0, 6);

		// Zero timeout stays disabled indefinitely.
		await controller.synchronize(PROJECTION, 60_000, 0);
		expect(controller.desiredLook().yawRadians).toBeCloseTo(0, 6);
	});

	it("rejects invalid idle orbit policies and negative delays", () => {
		expect(
			() =>
				new PossessionCameraController({
					initialLook: { pitchRadians: 0, yawRadians: 0 },
					orbit: ORBIT,
					recenter: { delayMs: 0, durationMs: 0 },
					idleOrbit: { ...IDLE_ORBIT, angularSpeedRadiansPerSecond: 0 },
					idleOrbitDelayMs: IDLE_ORBIT_DELAY_MS,
					transport: new RecordingTransport(),
				}),
		).toThrow();
		expect(
			() =>
				new PossessionCameraController({
					initialLook: { pitchRadians: 0, yawRadians: 0 },
					orbit: ORBIT,
					recenter: { delayMs: 0, durationMs: 0 },
					idleOrbit: IDLE_ORBIT,
					idleOrbitDelayMs: -1,
					transport: new RecordingTransport(),
				}),
		).toThrow();
	});
});
