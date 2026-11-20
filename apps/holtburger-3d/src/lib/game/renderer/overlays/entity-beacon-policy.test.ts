import { describe, expect, it } from "vitest";

import { SHARED_FRAME_SETTINGS } from "../../../frontend-frame-settings";
import { AABB3, Mat4, Vec3 } from "../../math/types";
import {
	resolveEntityBeaconGeometry,
	validateEntityBeaconSettings,
} from "./entity-beacon-policy";

const VALID_SETTINGS = {
	...SHARED_FRAME_SETTINGS.entityBeacons,
	color: { red: 0.43, green: 0.94, blue: 1, alpha: 0.95 },
	sparkleColor: { red: 0.78, green: 0.98, blue: 1, alpha: 0.38 },
};

describe("entity beacon policy", () => {
	it("accepts shared frame defaults and rejects invalid dimensions or colors", () => {
		expect(() =>
			validateEntityBeaconSettings(SHARED_FRAME_SETTINGS.entityBeacons),
		).not.toThrow();
		expect(() => validateEntityBeaconSettings(VALID_SETTINGS)).not.toThrow();
		expect(() =>
			validateEntityBeaconSettings({
				...VALID_SETTINGS,
				outdoorHeightMeters: 0,
			}),
		).toThrow(/outdoorHeightMeters/);
		expect(() =>
			validateEntityBeaconSettings({
				...VALID_SETTINGS,
				indoorHeightMeters: -1,
			}),
		).toThrow(/indoorHeightMeters/);
		expect(() =>
			validateEntityBeaconSettings({
				...VALID_SETTINGS,
				entityHeadClearanceMeters: -0.5,
			}),
		).toThrow(/entityHeadClearanceMeters/);
		expect(() =>
			validateEntityBeaconSettings({
				...VALID_SETTINGS,
				radiusScale: 0,
			}),
		).toThrow(/radiusScale/);
		expect(() =>
			validateEntityBeaconSettings({
				...VALID_SETTINGS,
				minimumRadiusMeters: 0,
			}),
		).toThrow(/minimumRadiusMeters/);
		expect(() =>
			validateEntityBeaconSettings({
				...VALID_SETTINGS,
				minimumRadiusCssPixels: 0,
			}),
		).toThrow(/minimumRadiusCssPixels/);
		expect(() =>
			validateEntityBeaconSettings({
				...VALID_SETTINGS,
				baseLiftMeters: -0.01,
			}),
		).toThrow(/baseLiftMeters/);
		expect(() =>
			validateEntityBeaconSettings({
				...VALID_SETTINGS,
				shimmerCyclesPerSecond: -0.1,
			}),
		).toThrow(/shimmerCyclesPerSecond/);
		expect(() =>
			validateEntityBeaconSettings({
				...VALID_SETTINGS,
				color: { red: 1.5, green: 0, blue: 0, alpha: 1 },
			}),
		).toThrow(/Entity beacon/);
		expect(() =>
			validateEntityBeaconSettings({
				...VALID_SETTINGS,
				sparkleColor: { red: 0, green: -0.1, blue: 0, alpha: 1 },
			}),
		).toThrow(/Entity beacon sparkle/);
	});

	it("anchors at rigid-bounds min.y plus base lift, floors small-item radius, and limits height by scope", () => {
		const smallItemBounds = new AABB3(
			new Vec3(-0.15, 0.1, -0.15),
			new Vec3(0.15, 0.4, 0.15),
		);
		const localToLandblock = Mat4.identity();
		localToLandblock.m41 = 4;
		localToLandblock.m42 = 2;
		localToLandblock.m43 = -6;
		const landblockOffset = new Vec3(10, 0, 20);
		const camera = new Vec3(0, 2, 0);

		const outdoor = resolveEntityBeaconGeometry(
			smallItemBounds,
			localToLandblock,
			landblockOffset,
			camera,
			false,
			VALID_SETTINGS,
		);
		expect(outdoor.base.x).toBeCloseTo(14, 5);
		expect(outdoor.base.y).toBeCloseTo(2.1 + VALID_SETTINGS.baseLiftMeters, 5);
		expect(outdoor.base.z).toBeCloseTo(14, 5);
		expect(outdoor.height).toBe(VALID_SETTINGS.outdoorHeightMeters);
		expect(outdoor.radius).toBe(VALID_SETTINGS.minimumRadiusMeters);

		const indoor = resolveEntityBeaconGeometry(
			smallItemBounds,
			localToLandblock,
			landblockOffset,
			camera,
			true,
			VALID_SETTINGS,
		);
		expect(indoor.height).toBe(VALID_SETTINGS.indoorHeightMeters);
		expect(indoor.radius).toBe(VALID_SETTINGS.minimumRadiusMeters);
	});

	it("fits cylinder radius and height to large creatures", () => {
		const bossHalfWidth = 1.6;
		const bossHeight = VALID_SETTINGS.indoorHeightMeters + 2;
		const bossBounds = new AABB3(
			new Vec3(-bossHalfWidth, 0, -1.0),
			new Vec3(bossHalfWidth, bossHeight, 1.0),
		);
		const resolved = resolveEntityBeaconGeometry(
			bossBounds,
			Mat4.identity(),
			Vec3.zero(),
			Vec3.zero(),
			true,
			VALID_SETTINGS,
		);
		expect(resolved.radius).toBeCloseTo(
			bossHalfWidth * VALID_SETTINGS.radiusScale,
			5,
		);
		expect(resolved.height).toBeCloseTo(
			bossHeight + VALID_SETTINGS.entityHeadClearanceMeters,
			5,
		);
	});
});
