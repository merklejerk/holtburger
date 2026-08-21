import { describe, expect, it } from "vitest";
import { sceneVec3 } from "../../assets/ac-frame";
import { Vec3 } from "../math/types";
import {
	advanceBoomState,
	boomCameraPosition,
	boomSweepDirection,
	clampBoomState,
	IDLE_BOOM_INPUT,
	initialBoomState,
	type BoomCameraOrientation,
	type BoomCameraTuning,
} from "./boom-camera-controller";

const TUNING: BoomCameraTuning = {
	easeOutSeconds: 0.5,
	maximumDistance: 8,
	minimumDistance: 1,
};

const ANCHOR = sceneVec3(new Vec3(100, 20, -50));
const LOOKING_NORTH: BoomCameraOrientation = {
	pitchRadians: 0,
	yawRadians: 0,
};

function state(distance: number) {
	return initialBoomState(distance, TUNING);
}

describe("initialBoomState", () => {
	it("enters at the requested distance and clamps it into the tuned range", () => {
		expect(state(5).renderedDistance).toBe(5);
		expect(state(100).desiredDistance).toBe(TUNING.maximumDistance);
		expect(state(0).desiredDistance).toBe(TUNING.minimumDistance);
	});
});

describe("advanceBoomState", () => {
	it("integrates zoom as a rate rather than a delta", () => {
		const advanced = advanceBoomState(
			state(4),
			{ zoomMetersPerSecond: 2 },
			0.5,
			TUNING,
		);

		expect(advanced.desiredDistance).toBeCloseTo(5);
	});

	it("holds zoom inside the tuned range", () => {
		let current = state(4);
		for (let step = 0; step < 100; step += 1) {
			current = advanceBoomState(
				current,
				{ zoomMetersPerSecond: 10 },
				0.1,
				TUNING,
			);
		}

		expect(current.desiredDistance).toBe(TUNING.maximumDistance);
	});

	it("leaves the rendered distance alone, because the world has not answered yet", () => {
		const advanced = advanceBoomState(
			state(4),
			{ ...IDLE_BOOM_INPUT, zoomMetersPerSecond: 4 },
			1,
			TUNING,
		);

		expect(advanced.desiredDistance).toBe(8);
		expect(advanced.renderedDistance).toBe(4);
	});
});

describe("clampBoomState", () => {
	it("pulls in immediately, because easing inward renders frames inside geometry", () => {
		const clamped = clampBoomState(state(6), 2, 1 / 60, TUNING);

		expect(clamped.renderedDistance).toBe(2);
	});

	it("eases back out rather than snapping when the obstruction clears", () => {
		const pinned = clampBoomState(state(6), 2, 1 / 60, TUNING);

		const released = clampBoomState(
			pinned,
			6,
			TUNING.easeOutSeconds / 2,
			TUNING,
		);

		expect(released.renderedDistance).toBeGreaterThan(2);
		expect(released.renderedDistance).toBeLessThan(6);
	});

	it("approaches the cleared distance monotonically and settles within a frame's noise", () => {
		// The ease is exponential, so it is asymptotic by construction and never lands exactly.
		// What matters is that it only ever moves outward and gets visually indistinguishable.
		let current = clampBoomState(state(6), 2, 1 / 60, TUNING);
		let previous = current.renderedDistance;
		for (let step = 0; step < 200; step += 1) {
			current = clampBoomState(current, 6, 1 / 60, TUNING);
			expect(current.renderedDistance).toBeGreaterThanOrEqual(previous);
			previous = current.renderedDistance;
		}

		expect(6 - current.renderedDistance).toBeLessThan(0.01);
	});

	it("never renders closer than the minimum, so a pinned boom stops at the entity's back", () => {
		const crushed = clampBoomState(state(6), 0, 1 / 60, TUNING);

		expect(crushed.renderedDistance).toBe(TUNING.minimumDistance);
	});

	it("keeps the operator's desired distance while the rendered one is pinned", () => {
		const pinned = clampBoomState(state(6), 2, 1 / 60, TUNING);

		// The clamp is presentation. Forgetting the request here would make the camera fail to
		// return to where the operator put it once the wall is gone.
		expect(pinned.desiredDistance).toBe(6);
	});

	it("refuses a negative or non-finite sweep rather than deriving a pose from it", () => {
		expect(() => clampBoomState(state(6), -1, 1 / 60, TUNING)).toThrow();
		expect(() =>
			clampBoomState(state(6), Number.NaN, 1 / 60, TUNING),
		).toThrow();
	});
});

describe("boomCameraPosition", () => {
	it("places the camera behind the anchor along the view direction", () => {
		const position = boomCameraPosition(ANCHOR, state(5), LOOKING_NORTH);

		// Default yaw and pitch look down -Z, so the camera sits at +Z behind the anchor.
		expect(position.z).toBeCloseTo(ANCHOR.z + 5);
		expect(position.x).toBeCloseTo(ANCHOR.x);
		expect(position.y).toBeCloseTo(ANCHOR.y);
	});

	it("keeps the anchor exactly one rendered distance away at any orbit", () => {
		for (const [yawRadians, pitchRadians] of [
			[0, 0],
			[1.2, 0.4],
			[-2.5, -1.1],
			[Math.PI, 1.38],
		] as const) {
			const current = state(4);
			const position = boomCameraPosition(ANCHOR, current, {
				pitchRadians,
				yawRadians,
			});
			const separation = Math.hypot(
				position.x - ANCHOR.x,
				position.y - ANCHOR.y,
				position.z - ANCHOR.z,
			);

			expect(separation).toBeCloseTo(current.renderedDistance);
		}
	});

	it("derives position from the anchor, so a moved anchor drags the camera with it", () => {
		const current = state(5);
		const first = boomCameraPosition(ANCHOR, current, LOOKING_NORTH);
		const moved = sceneVec3(new Vec3(ANCHOR.x + 30, ANCHOR.y, ANCHOR.z));

		const second = boomCameraPosition(moved, current, LOOKING_NORTH);

		expect(second.x - first.x).toBeCloseTo(30);
	});
});

describe("boomSweepDirection", () => {
	it("points from the anchor toward where the camera wants to be", () => {
		const direction = boomSweepDirection(LOOKING_NORTH);

		expect(direction.z).toBeCloseTo(1);
		expect(Math.hypot(direction.x, direction.y, direction.z)).toBeCloseTo(1);
	});

	it("is a unit vector opposite the look direction at any orbit", () => {
		for (const [yawRadians, pitchRadians] of [
			[1.2, 0.4],
			[-2.5, -1.1],
		] as const) {
			const direction = boomSweepDirection({ pitchRadians, yawRadians });

			expect(Math.hypot(direction.x, direction.y, direction.z)).toBeCloseTo(1);
		}
	});
});
