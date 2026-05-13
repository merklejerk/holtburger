import { describe, expect, it } from "vitest";

import {
	buildCameraHintFromSceneCameraFrame,
	buildDebugOrbitCameraFrame,
	createDebugOrbitCameraState,
	fitDebugOrbitCameraToBounds,
	orbitDebugCamera,
	panDebugCamera,
	zoomDebugCamera,
} from "./camera";
import { normalizeViewportPoint } from "./model";
import type { RuntimeBatchDto } from "../host/contracts";

function createRuntimeBatch(): RuntimeBatchDto {
	return {
		tick: 1,
		entities: [],
		residency: {
			focusEntityId: null,
			focusLandblockId: 0x0102ffff,
			focusCellId: 0x01020001,
			focusEnvCellId: null,
			visibleCellIds: [],
			seenOutside: null,
			environmentId: null,
			cellStructureId: null,
			focusLocationLabel: "100.40S, 101.55W, 1.0Z",
			indoors: false,
			trackedBodyCount: 0,
		},
	};
}

describe("world display camera helpers", () => {
	it("fits an orbit camera to scene bounds without claiming manual control", () => {
		const state = fitDebugOrbitCameraToBounds(
			createDebugOrbitCameraState(),
			{
				center: { x: 96, y: 18, z: -96 },
				size: { x: 576, y: 72, z: 576 },
				minimumSpan: 180,
			},
			"scene-a",
			{ force: false },
		);
		const frame = buildDebugOrbitCameraFrame(state);

		expect(state.hasManualControl).toBe(false);
		expect(state.target).toEqual({ x: 96, y: 18, z: -96 });
		expect(frame.position.x).not.toBeCloseTo(frame.target.x);
		expect(frame.position.y).toBeGreaterThan(frame.target.y);
	});

	it("preserves manual orbit control across later automatic scene fits", () => {
		const fitted = fitDebugOrbitCameraToBounds(
			createDebugOrbitCameraState(),
			{
				center: { x: 0, y: 0, z: 0 },
				size: { x: 180, y: 24, z: 180 },
				minimumSpan: 180,
			},
			"scene-a",
			{ force: false },
		);
		const manual = orbitDebugCamera(fitted, { x: 12, y: -8 });
		const next = fitDebugOrbitCameraToBounds(
			manual,
			{
				center: { x: 999, y: 999, z: 999 },
				size: { x: 400, y: 80, z: 400 },
				minimumSpan: 180,
			},
			"scene-b",
			{ force: false },
		);

		expect(next).toBe(manual);
	});

	it("preserves manual zoom across later automatic scene fits", () => {
		const fitted = fitDebugOrbitCameraToBounds(
			createDebugOrbitCameraState(),
			{
				center: { x: 0, y: 0, z: 0 },
				size: { x: 180, y: 24, z: 180 },
				minimumSpan: 180,
			},
			"scene-a",
			{ force: false },
		);
		const manual = zoomDebugCamera(fitted, -500);
		const next = fitDebugOrbitCameraToBounds(
			manual,
			{
				center: { x: 0, y: 0, z: 0 },
				size: { x: 180, y: 24, z: 180 },
				minimumSpan: 180,
			},
			"scene-a",
			{ force: false },
		);

		expect(next).toBe(manual);
		expect(next.distance).toBe(manual.distance);
	});

	it("supports explicit refit after manual movement", () => {
		const manual = panDebugCamera(
			zoomDebugCamera(createDebugOrbitCameraState(), -500),
			{ x: 30, y: -20 },
		);
		const refit = fitDebugOrbitCameraToBounds(
			manual,
			{
				center: { x: 32, y: 12, z: -48 },
				size: { x: 250, y: 40, z: 250 },
				minimumSpan: 180,
			},
			"scene-c",
			{ force: true },
		);

		expect(refit.hasManualControl).toBe(false);
		expect(refit.target).toEqual({ x: 32, y: 12, z: -48 });
	});

	it("builds camera hints from the rendered Three.js camera frame in AC coordinates", () => {
		const hint = buildCameraHintFromSceneCameraFrame(
			"client",
			createRuntimeBatch(),
			null,
			{
				position: { x: 10, y: 20, z: -30 },
				target: { x: 10, y: 20, z: -40 },
				up: { x: 0, y: 1, z: 0 },
				aspect: 1,
				fovDegrees: 52,
				near: 0.1,
				far: 5000,
			},
			normalizeViewportPoint(40, 40, 80, 80),
		);

		expect(hint).not.toBeNull();
		expect(hint?.position).toEqual({ x: 10, y: 30, z: 20 });
		expect(hint?.forward).toEqual({ x: 0, y: 1, z: 0 });
		expect(hint?.viewportNormalizedX).toBeCloseTo(0.5);
		expect(hint?.destinationLabel).toBe("100.40S, 101.55W, 1.0Z");
	});

	it("derives off-center pick rays from camera FOV and aspect", () => {
		const hint = buildCameraHintFromSceneCameraFrame(
			"client",
			createRuntimeBatch(),
			null,
			{
				position: { x: 10, y: 20, z: -30 },
				target: { x: 10, y: 20, z: -40 },
				up: { x: 0, y: 1, z: 0 },
				aspect: 2,
				fovDegrees: 52,
				near: 0.1,
				far: 5000,
			},
			normalizeViewportPoint(80, 0, 80, 80),
		);

		expect(hint?.forward.x).toBeGreaterThan(0);
		expect(hint?.forward.y).toBeGreaterThan(0);
		expect(hint?.forward.z).toBeGreaterThan(0);
		expect(
			Math.hypot(
				hint?.forward.x ?? 0,
				hint?.forward.y ?? 0,
				hint?.forward.z ?? 0,
			),
		).toBeCloseTo(1);
	});
});
