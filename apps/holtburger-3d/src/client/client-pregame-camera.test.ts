import { sceneVec3 } from "../lib/assets/ac-frame";
import { describe, expect, it } from "vitest";
import { createCameraRotationRadians } from "../lib/game/math/camera-orientation";
import {
	createPerspectiveMat4,
	createRotationMat4,
	createViewMat4,
	multiplyMat4,
	transformPoint3,
} from "../lib/game/math/matrices";
import { Quat, Vec3 } from "../lib/game/math/types";
import {
	resolvePregameCamera,
	type PregameCameraRequest,
} from "./client-pregame-camera";

/** Independent renderer depth range for projection oracles; camera fitting owns no clipping policy. */
const TEST_DEPTH = { near: 0.1, far: 100 };

function request(): PregameCameraRequest {
	const center = new Vec3(4, 1, -3);
	const points = [];
	for (const x of [-0.6, 0.6])
		for (const y of [-1, 1])
			for (const z of [-0.5, 0.5])
				points.push(center.x + x, center.y + y, center.z + z);
	return {
		fit: { center, supportPoints: new Float32Array(points) },
		framing: { kind: "body" },
		offset: { heightOffsetFraction: 0, distanceOffsetFraction: 0 },
		subject: { position: sceneVec3(Vec3.zero()), yawOffsetRadians: 0 },
		canvas: { width: 1440, height: 900 },
		rectangle: { left: 850, top: 200, width: 420, height: 500 },
		rotation: createCameraRotationRadians(0.4, -0.15),
		projection: {
			fovDegrees: 60,
			aspectRatio: 1.6,
		},
		margin: 12,
	};
}

/** Independent model placement used by projection and facing oracles. */
function subjectPlacement(input: PregameCameraRequest, heading: number) {
	const placement = createRotationMat4(
		new Quat(Math.cos(heading / 2), 0, Math.sin(heading / 2), 0),
	);
	placement.m41 = input.subject.position.x;
	placement.m42 = input.subject.position.y;
	placement.m43 = input.subject.position.z;
	return placement;
}

describe("pregame full-canvas camera framing", () => {
	it.each([
		{ heightOffsetFraction: Number.NaN, distanceOffsetFraction: 0 },
		{
			heightOffsetFraction: 0,
			distanceOffsetFraction: Number.POSITIVE_INFINITY,
		},
	])("rejects nonfinite camera preferences: %j", (offset) => {
		expect(() => resolvePregameCamera({ ...request(), offset })).toThrow(
			"Pregame camera offsets must be finite.",
		);
	});

	it("raises the eye independently of extra retreat", () => {
		const input = {
			...request(),
			rotation: new Quat(1, 0, 0, 0),
			rectangle: { left: 0, top: 0, width: 1440, height: 900 },
		};
		const baseline = resolvePregameCamera(input);
		const raised = resolvePregameCamera({
			...input,
			offset: { heightOffsetFraction: 0.3, distanceOffsetFraction: 0 },
		});
		const distant = resolvePregameCamera({
			...input,
			offset: { heightOffsetFraction: 0.3, distanceOffsetFraction: 0.4 },
		});
		if (
			baseline.kind !== "ready" ||
			raised.kind !== "ready" ||
			distant.kind !== "ready"
		)
			throw new Error("Expected feasible cameras");
		expect(raised.position.y - baseline.position.y).toBeCloseTo(0.6);
		expect(distant.position.y).toBeCloseTo(raised.position.y);
		expect(distant.position.z - raised.position.z).toBeCloseTo(
			raised.position.z * 0.4,
		);
	});

	it.each(["body", "face"] as const)(
		"scales vertical preferences with the %s focus height",
		(kind) => {
			for (const scale of [0.5, 1, 2]) {
				const base = request();
				const input: PregameCameraRequest = {
					...base,
					fit: {
						center: new Vec3(
							base.fit.center.x * scale,
							base.fit.center.y * scale,
							base.fit.center.z * scale,
						),
						supportPoints: base.fit.supportPoints.map((value) => value * scale),
					},
					framing:
						kind === "body"
							? { kind }
							: {
									kind,
									center: new Vec3(0, 1.6 * scale, 0),
									height: 0.5 * scale,
								},
					rotation: Quat.identity(),
					rectangle: {
						left: 0,
						top: 0,
						width: base.canvas.width,
						height: base.canvas.height,
					},
				};
				const baseline = resolvePregameCamera(input);
				if (baseline.kind !== "ready")
					throw new Error("Expected a baseline fit.");
				for (const fraction of [-0.2, 0.2]) {
					const shifted = resolvePregameCamera({
						...input,
						offset: {
							heightOffsetFraction: fraction,
							distanceOffsetFraction: 0,
						},
					});
					if (shifted.kind !== "ready")
						throw new Error("Expected a shifted fit.");
					expect(shifted.position.y - baseline.position.y).toBeCloseTo(
						fraction * (kind === "body" ? 2 : 0.5) * scale,
					);
				}
			}
		},
	);

	it.each([0.5, 1, 2])(
		"scales signed distance offsets with the fitted distance at model scale %s",
		(scale) => {
			const base = request();
			const input: PregameCameraRequest = {
				...base,
				fit: {
					center: new Vec3(
						base.fit.center.x * scale,
						base.fit.center.y * scale,
						base.fit.center.z * scale,
					),
					supportPoints: base.fit.supportPoints.map((value) => value * scale),
				},
			};
			const baseline = resolvePregameCamera(input);
			if (baseline.kind !== "ready")
				throw new Error("Expected a baseline fit.");
			const focus = new Vec3(
				input.subject.position.x,
				input.subject.position.y + input.fit.center.y,
				input.subject.position.z,
			);
			for (const fraction of [-0.95, -0.5, -0.15, 0.25, 1000]) {
				const shifted = resolvePregameCamera({
					...input,
					offset: { heightOffsetFraction: 0, distanceOffsetFraction: fraction },
				});
				if (shifted.kind !== "ready") throw new Error("Expected a zoomed fit.");
				for (const axis of ["x", "y", "z"] as const)
					expect(shifted.position[axis] - focus[axis]).toBeCloseTo(
						(baseline.position[axis] - focus[axis]) * (1 + fraction),
					);
			}
		},
	);

	it.each(["body", "face"] as const)(
		"keeps extreme %s zoom in front of the focus",
		(kind) => {
			const input: PregameCameraRequest = {
				...request(),
				framing:
					kind === "body"
						? { kind }
						: { kind, center: new Vec3(0.1, 1.6, -0.2), height: 0.5 },
				offset: { heightOffsetFraction: 0, distanceOffsetFraction: -1 },
			};
			const nearest = resolvePregameCamera(input);
			const excessive = resolvePregameCamera({
				...input,
				offset: { ...input.offset, distanceOffsetFraction: -3 },
			});
			expect(excessive).toEqual(nearest);
			if (nearest.kind !== "ready")
				throw new Error("Expected a positive camera distance.");
			const focus = new Vec3(
				input.subject.position.x,
				input.subject.position.y +
					(input.framing.kind === "body"
						? input.fit.center.y
						: input.framing.center.y),
				input.subject.position.z,
			);
			const depth = -transformPoint3(
				createViewMat4(nearest.position, nearest.rotation),
				focus,
			).z;
			expect(depth).toBeGreaterThan(0);
		},
	);

	it.each([
		{
			rectangle: { left: 850, top: 200, width: 420, height: 500 },
			aspectRatio: 1.6,
		},
		{
			rectangle: { left: 390, top: 170, width: 430, height: 580 },
			aspectRatio: 1.6,
		},
		{
			rectangle: { left: 100, top: 100, width: 190, height: 650 },
			aspectRatio: 1.6,
		},
		{
			rectangle: { left: 1200, top: 200, width: 500, height: 500 },
			aspectRatio: 1.6,
		},
		{
			rectangle: { left: 850, top: 200, width: 420, height: 500 },
			aspectRatio: 913 / 582,
		},
	])(
		"projects support with the actual drawing-buffer aspect: %j",
		({ rectangle, aspectRatio }) => {
			const base = request();
			const input = {
				...base,
				offset: { heightOffsetFraction: 0.3, distanceOffsetFraction: 0.4 },
				rectangle,
				projection: { ...base.projection, aspectRatio },
			};
			const outcome = resolvePregameCamera(input);
			expect(outcome.kind).toBe("ready");
			if (outcome.kind !== "ready")
				throw new Error("Expected a feasible camera");
			const { projection, canvas, fit, margin } = input;
			const focus = new Vec3(
				input.subject.position.x,
				input.subject.position.y + fit.center.y,
				input.subject.position.z,
			);
			const dx = outcome.position.x - focus.x;
			const dz = outcome.position.z - focus.z;
			const length = Math.hypot(dx, dz);
			expect(-Math.sin(outcome.headingRadians)).toBeCloseTo(dx / length, 8);
			expect(-Math.cos(outcome.headingRadians)).toBeCloseTo(dz / length, 8);

			const matrix = multiplyMat4(
				createPerspectiveMat4(
					projection.fovDegrees,
					projection.aspectRatio,
					TEST_DEPTH.near,
					TEST_DEPTH.far,
				),
				multiplyMat4(
					createViewMat4(outcome.position, outcome.rotation),
					subjectPlacement(input, outcome.headingRadians),
				),
			);
			for (let i = 0; i < fit.supportPoints.length; i += 3) {
				const [px, py, pz] = fit.supportPoints.slice(i, i + 3);
				if (px === undefined || py === undefined || pz === undefined)
					throw new Error("Incomplete test support");
				const point = transformPoint3(matrix, new Vec3(px, py, pz));
				const x = ((point.x + 1) * canvas.width) / 2;
				const y = ((1 - point.y) * canvas.height) / 2;
				expect(x).toBeGreaterThanOrEqual(
					Math.max(0, rectangle.left) + margin - 0.001,
				);
				expect(x).toBeLessThanOrEqual(
					Math.min(canvas.width, rectangle.left + rectangle.width) -
						margin +
						0.001,
				);
				expect(y).toBeGreaterThanOrEqual(rectangle.top + margin - 0.001);
				expect(y).toBeLessThanOrEqual(
					rectangle.top + rectangle.height - margin + 0.001,
				);
				expect(point.z).toBeGreaterThanOrEqual(-1);
				expect(point.z).toBeLessThanOrEqual(1);
			}
		},
	);

	it.each([0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2])(
		"fits source-local geometry after scene translation and yaw offset %s",
		(yawOffsetRadians) => {
			const input = {
				...request(),
				subject: { position: sceneVec3(new Vec3(10, -2, 7)), yawOffsetRadians },
			};
			const camera = resolvePregameCamera(input);
			if (camera.kind !== "ready")
				throw new Error("Expected translated/rotated support to fit.");
			const projection = multiplyMat4(
				createPerspectiveMat4(
					input.projection.fovDegrees,
					input.projection.aspectRatio,
					TEST_DEPTH.near,
					TEST_DEPTH.far,
				),
				createViewMat4(camera.position, camera.rotation),
			);
			const placement = subjectPlacement(input, camera.headingRadians);
			const matrix = multiplyMat4(projection, placement);
			for (let index = 0; index < input.fit.supportPoints.length; index += 3) {
				const [x, y, z] = input.fit.supportPoints.slice(index, index + 3);
				if (x === undefined || y === undefined || z === undefined)
					throw new Error("Incomplete fixture support.");
				const point = transformPoint3(matrix, new Vec3(x, y, z));
				const pixelX = ((point.x + 1) * input.canvas.width) / 2;
				const pixelY = ((1 - point.y) * input.canvas.height) / 2;
				expect(pixelX).toBeGreaterThanOrEqual(
					input.rectangle.left + input.margin - 0.001,
				);
				expect(pixelX).toBeLessThanOrEqual(
					input.rectangle.left + input.rectangle.width - input.margin + 0.001,
				);
				expect(pixelY).toBeGreaterThanOrEqual(
					input.rectangle.top + input.margin - 0.001,
				);
				expect(pixelY).toBeLessThanOrEqual(
					input.rectangle.top + input.rectangle.height - input.margin + 0.001,
				);
			}
		},
	);

	it.each(["body", "face"] as const)(
		"keeps the camera fixed throughout a %s turn",
		(kind) => {
			const base = request();
			const input: PregameCameraRequest = {
				...base,
				offset: { heightOffsetFraction: 0.2, distanceOffsetFraction: -0.5 },
				framing:
					kind === "body"
						? { kind }
						: { kind, center: new Vec3(0.15, 1.7, -0.2), height: 0.5 },
			};
			const initial = resolvePregameCamera(input);
			if (initial.kind !== "ready")
				throw new Error("Expected a fitted camera.");
			for (let step = 0; step <= 72; step++) {
				const next = resolvePregameCamera({
					...input,
					subject: {
						...input.subject,
						yawOffsetRadians: (step * Math.PI) / 36,
					},
				});
				if (next.kind !== "ready") throw new Error("Expected a fitted turn.");
				expect(next.position).toEqual(initial.position);
				expect(next.rotation).toEqual(initial.rotation);
			}
		},
	);

	it("handles hidden and undersized surfaces", () => {
		const input = request();
		expect(resolvePregameCamera(input).kind).toBe("ready");
		expect(
			resolvePregameCamera({
				...input,
				rectangle: { ...input.rectangle, width: 0 },
			}),
		).toEqual({ kind: "suspended" });
		expect(
			resolvePregameCamera({
				...input,
				rectangle: { ...input.rectangle, left: input.canvas.width },
			}),
		).toEqual({ kind: "suspended" });
		expect(
			resolvePregameCamera({
				...input,
				rectangle: { ...input.rectangle, width: input.margin },
			}),
		).toEqual({ kind: "limited" });
	});
});
