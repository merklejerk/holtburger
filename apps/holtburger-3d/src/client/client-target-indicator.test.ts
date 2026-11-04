import { CLIENT_TUNING } from "./client-tuning";
import { describe, expect, it } from "vitest";

import { sceneVec3 } from "../lib/assets/ac-frame";
import type { LandblockOwnerId } from "../lib/game/game-types";
import { AABB3, Mat4, Quat, Vec3 } from "../lib/game/math/types";
import type { PrimaryCameraView } from "../lib/game/runtime/types";
import type { ResolvedScenePlacement } from "../lib/game/scene";
import { projectClientEntityCenter } from "./client-entity-projection";
import {
	projectClientTargetIndicator,
	projectClientCombatTarget,
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

describe("combat indicator center projection", () => {
	const center = (x: number, y: number, z: number) =>
		projectClientEntityCenter({
			bounds: bounds(1),
			placement: placement(x, y, z),
			cssWidth: 500,
			cssHeight: 400,
			view: VIEW,
		});
	it("maps the bounds center into CSS pixels independently of render extent", () => {
		expect(center(0, 0, -10)).toEqual({ x: 250, y: 200 });
		expect(center(5, 0, -10)?.x).toBeCloseTo(350);
		expect(center(0, 5, -10)?.y).toBeCloseTo(100);
	});
	it.each([
		[0, 0, 10],
		[0, 0, 0],
		[30, 0, -10],
		[0, 30, -10],
		[0, 0, -0.01],
		[0, 0, -3000],
	])("hides clipped center (%s, %s, %s)", (x, y, z) => {
		expect(center(x, y, z)).toBeNull();
	});
	it("uses the local bounds center rather than the entity origin", () => {
		const frame = projectClientEntityCenter({
			bounds: new AABB3(new Vec3(-1, 1, -1), new Vec3(1, 3, 1)),
			placement: placement(0, 0, -10),
			cssWidth: 500,
			cssHeight: 400,
			view: VIEW,
		});
		expect(frame?.y).toBeCloseTo(160);
	});
});

describe("combat target reticle and edge guidance", () => {
	const projectCombat = (x: number, y: number, z: number) =>
		projectClientCombatTarget({
			bounds: bounds(0.2),
			placement: placement(x, y, z),
			cssWidth: 1000,
			cssHeight: 800,
			view: VIEW,
			tuning: CLIENT_TUNING.combatTargetIndicator,
		});
	it("uses a centered reticle while the combat target is onscreen", () => {
		expect(projectCombat(0, 0, -10)).toEqual({
			kind: "reticle",
			x: 500,
			y: 400,
		});
	});
	it("keeps the combat arrow inward of the independent selection arrow", () => {
		const combat = projectCombat(30, 0, -10);
		const selected = project(placement(30, 0, -10), bounds(0.2));
		expect(combat).toMatchObject({
			kind: "edge",
			x: 1000 - CLIENT_TUNING.combatTargetIndicator.safeInsetCssPixels,
			y: 400,
		});
		if (combat === null || selected === null)
			throw new Error("Expected both target arrows.");
		expect(combat.x).toBeLessThan(selected.x);
	});
	it("guides behind-camera targets and switches back to a reticle on return", () => {
		expect(projectCombat(0, 0, 10)?.kind).toBe("edge");
		expect(projectCombat(0, 0, -10)?.kind).toBe("reticle");
	});
	it("has no marker for a collapsed viewport", () => {
		expect(
			projectClientCombatTarget({
				bounds: bounds(1),
				placement: placement(0, 0, -10),
				cssWidth: 0,
				cssHeight: 0,
				view: VIEW,
				tuning: CLIENT_TUNING.combatTargetIndicator,
			}),
		).toBeNull();
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
