import { describe, expect, it } from "vitest";

import { sceneVec3 } from "../lib/assets/ac-frame";
import type { LandblockOwnerId } from "../lib/game/game-types";
import { AABB3, Mat4, Quat, Vec3 } from "../lib/game/math/types";
import type { PrimaryCameraView } from "../lib/game/runtime/types";
import type { ResolvedScenePlacement } from "../lib/game/scene";
import {
	projectClientTargetIndicator,
	type ClientTargetIndicatorGeometryTuning,
} from "./client-target-indicator";

const LAND_BLOCK = "0x0000ffff" as LandblockOwnerId;
const TUNING: ClientTargetIndicatorGeometryTuning = {
	safeInsetCssPixels: 30,
};
const VIEW: PrimaryCameraView = {
	camera: {
		far: 2_000,
		fov: 90,
		near: 0.1,
		placement: {
			envCellId: null,
			landblockId: LAND_BLOCK,
			position: sceneVec3(new Vec3(0, 0, 0)),
			rotation: new Quat(1, 0, 0, 0),
		},
	},
	extent: { height: 800, width: 1_000 },
};

describe("client target indicator", () => {
	it("uses only the silhouette for on-screen rigid bounds at every footprint", () => {
		expect(project(placement(0, 0, -5), bounds(1))).toBeNull();
		expect(project(placement(0, 0, -100), bounds(0.2))).toBeNull();
	});

	it.each([
		["left", -30, 0, 30, 400],
		["right", 30, 0, 970, 400],
		["top", 0, 30, 500, 30],
		["bottom", 0, -30, 500, 770],
		["top-right", 30, 30, 796, 30],
	] as const)(
		"clamps an off-screen %s target to the nearest safe edge",
		(_label, x, y, expectedX, expectedY) => {
			const frame = project(placement(x, y, -10), bounds(0.2));
			if (frame === null) throw new Error("Expected an off-screen marker.");
			expect(frame.x).toBeCloseTo(expectedX);
			expect(frame.y).toBeCloseTo(expectedY);
		},
	);

	it("keeps a behind-camera direction stable without dividing through negative W", () => {
		const rightFront = project(placement(30, 0, -10), bounds(0.2));
		const rightBehind = project(placement(30, 0, 10), bounds(0.2));
		const straightBehind = project(placement(0, 0, 10), bounds(0.2));
		expect(rightFront).toMatchObject({ x: 970 });
		expect(rightBehind).toMatchObject({ x: 970 });
		expect(straightBehind).toMatchObject({
			x: 500,
			y: 770,
		});
	});

	it("uses the resolved child placement rather than a parent or host-root bound", () => {
		const child = project(placement(30, 0, -10), bounds(0.1));
		expect(child).toMatchObject({ x: 970 });
	});

	it("collapses the safe rectangle for a viewport smaller than twice the inset", () => {
		const frame = project(placement(30, 0, -10), bounds(0.1), 40, 20);
		expect(frame).toMatchObject({ x: 30, y: 10 });
	});
});

function project(
	resolvedPlacement: ResolvedScenePlacement,
	localBounds: AABB3,
	cssWidth = 1_000,
	cssHeight = 800,
) {
	return projectClientTargetIndicator({
		bounds: localBounds,
		cssHeight,
		cssWidth,
		placement: resolvedPlacement,
		tuning: TUNING,
		view: VIEW,
	});
}

function placement(x: number, y: number, z: number): ResolvedScenePlacement {
	const localToLandblock = Mat4.identity();
	localToLandblock.m41 = x;
	localToLandblock.m42 = y;
	localToLandblock.m43 = z;
	return {
		envCellId: null,
		landblockId: LAND_BLOCK,
		localToLandblock,
		scope: { kind: "outdoor" },
	};
}

function bounds(radius: number): AABB3 {
	return new AABB3(
		new Vec3(-radius, -radius, -radius),
		new Vec3(radius, radius, radius),
	);
}
