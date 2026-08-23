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
