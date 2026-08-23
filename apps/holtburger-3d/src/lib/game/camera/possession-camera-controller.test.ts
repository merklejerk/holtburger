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
			orbit: {
				maximumPitchRadians: 1,
				pitchRadiansPerPixel: 0.02,
				yawRadiansPerPixel: 0.01,
			},
			transport,
		});
		await controller.start(TARGET, DISTANCE, PROJECTION);

		expect(transport.calls[0].args?.request).toMatchObject({
			...TARGET,
			projectionRevision: 1,
			clearanceRadius: PROJECTION.clearanceRadius,
			viewDirection: [0, -1, 0],
		});

		controller.orbit(10, -20);
		controller.zoom(0.5);
		controller.zoom(-0.2);
		await controller.synchronize(PROJECTION);

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
			orbit: {
				maximumPitchRadians: 1,
				pitchRadiansPerPixel: 0.02,
				yawRadiansPerPixel: 0.01,
			},
			transport,
		});
		await controller.start(TARGET, DISTANCE, PROJECTION);
		await controller.synchronize(PROJECTION);
		const next = createProjectionClearanceRevision(
			2,
			{ fov: 90, near: 0.1 },
			PROJECTION.extent,
		);
		await controller.synchronize(next);

		expect(
			transport.calls.filter(
				({ command }) => command === "set_kinematic_boom_clearance",
			),
		).toHaveLength(1);
	});
});
