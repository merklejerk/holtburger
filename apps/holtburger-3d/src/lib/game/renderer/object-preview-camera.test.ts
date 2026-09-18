import { describe, expect, it } from "vitest";
import { rotateRenderVector } from "../math/camera-orientation";
import { transformPoint3 } from "../math/matrices";
import { AABB3, Vec3 } from "../math/types";
import {
	OBJECT_PREVIEW_VERTICAL_FOV_DEGREES,
	resolveObjectPreviewViewTransform,
} from "./object-preview-camera";
import type { RenderExtent } from "./render-extent";
import type { ObjectPreviewFit } from "../preview/object-preview-fit";

const BOUNDS = new AABB3(new Vec3(-1, 0, -2), new Vec3(3, 6, 2));

describe("object preview yaw camera", () => {
	it("looks at the authored front from render -Z at yaw zero", () => {
		const view = resolveObjectPreviewViewTransform(fit(BOUNDS), 0, {
			height: 300,
			width: 400,
		});
		expect(view.cameraPosition.x).toBeCloseTo(0);
		expect(view.cameraPosition.y).toBeGreaterThan(0);
		expect(view.cameraPosition.z).toBeLessThan(0);
		const forward = rotateRenderVector(new Vec3(0, 0, -1), view.cameraRotation);
		expect(forward.z).toBeGreaterThan(0);
	});

	it("centers the authored envelope without rotating its up axis", () => {
		const view = resolveObjectPreviewViewTransform(fit(BOUNDS), 0.7, {
			height: 300,
			width: 400,
		});
		const center = transformPoint3(view.objectRoot, new Vec3(1, 3, 0));
		expect(center.x).toBeCloseTo(0);
		expect(center.y).toBeCloseTo(0);
		expect(center.z).toBeCloseTo(0);
		expect(view.objectRoot.m12).toBe(0);
		expect(view.objectRoot.m21).toBe(0);
		expect(view.objectRoot.m22).toBe(1);
	});

	it("keeps camera right horizontal at every yaw", () => {
		const view = resolveObjectPreviewViewTransform(fit(BOUNDS), 1.1, {
			height: 300,
			width: 400,
		});
		const right = rotateRenderVector(new Vec3(1, 0, 0), view.cameraRotation);
		expect(right.y).toBeCloseTo(0);
	});

	it.each([
		{ extent: { height: 180, width: 520 }, yaw: 0.2 },
		{ extent: { height: 520, width: 180 }, yaw: 1.1 },
		{ extent: { height: 256, width: 256 }, yaw: 2.4 },
	])(
		"fits every model corner inside $extent at yaw $yaw",
		({ extent, yaw }) => {
			expectModelFits(BOUNDS, yaw, extent);
		},
	);

	it("moves back when a resized panel narrows the horizontal projection", () => {
		const wide = resolveObjectPreviewViewTransform(fit(BOUNDS), Math.PI / 2, {
			height: 240,
			width: 640,
		});
		const narrow = resolveObjectPreviewViewTransform(fit(BOUNDS), Math.PI / 2, {
			height: 240,
			width: 160,
		});
		expect(length(narrow.cameraPosition)).toBeGreaterThan(
			length(wide.cameraPosition),
		);
	});
});

function expectModelFits(
	bounds: AABB3,
	yawRadians: number,
	extent: RenderExtent,
): void {
	const view = resolveObjectPreviewViewTransform(
		fit(bounds),
		yawRadians,
		extent,
	);
	const right = rotateRenderVector(new Vec3(1, 0, 0), view.cameraRotation);
	const up = rotateRenderVector(new Vec3(0, 1, 0), view.cameraRotation);
	const forward = rotateRenderVector(new Vec3(0, 0, -1), view.cameraRotation);
	const verticalTangent = Math.tan(
		(OBJECT_PREVIEW_VERTICAL_FOV_DEGREES * Math.PI) / 360,
	);
	const horizontalTangent = verticalTangent * (extent.width / extent.height);
	for (const x of [bounds.min.x, bounds.max.x])
		for (const y of [bounds.min.y, bounds.max.y])
			for (const z of [bounds.min.z, bounds.max.z]) {
				const world = transformPoint3(view.objectRoot, new Vec3(x, y, z));
				const cameraToPoint = new Vec3(
					world.x - view.cameraPosition.x,
					world.y - view.cameraPosition.y,
					world.z - view.cameraPosition.z,
				);
				const depth = dot(cameraToPoint, forward);
				expect(depth).toBeGreaterThan(0);
				expect(Math.abs(dot(cameraToPoint, right)) / depth).toBeLessThan(
					horizontalTangent,
				);
				expect(Math.abs(dot(cameraToPoint, up)) / depth).toBeLessThan(
					verticalTangent,
				);
			}
}

function fit(bounds: AABB3): ObjectPreviewFit {
	const supportPoints: number[] = [];
	for (const x of [bounds.min.x, bounds.max.x])
		for (const y of [bounds.min.y, bounds.max.y])
			for (const z of [bounds.min.z, bounds.max.z]) supportPoints.push(x, y, z);
	return {
		center: new Vec3(
			(bounds.min.x + bounds.max.x) / 2,
			(bounds.min.y + bounds.max.y) / 2,
			(bounds.min.z + bounds.max.z) / 2,
		),
		supportPoints: new Float32Array(supportPoints),
	};
}

function dot(left: Vec3, right: Vec3): number {
	return left.x * right.x + left.y * right.y + left.z * right.z;
}

function length(vector: Vec3): number {
	return Math.hypot(vector.x, vector.y, vector.z);
}
