import { describe, expect, it } from "vitest";
import type { ActiveRegionSource } from "../../assets/active-region-source";
import {
	MINIMUM_AMBIENT_LEVEL,
	resolveSceneEnvironment,
	UNAUTHORED_LIGHTING,
	UNAUTHORED_SCENE_LIGHTING,
} from "./scene-environment";

/**
 * A day long enough, and ticks short enough, that tick quantization is invisible to the
 * interpolation these tests exercise. The cadence itself is covered separately.
 */
const TEST_DAY_LENGTH_SECONDS = 1_000;
const TEST_TICK_SECONDS = 1e-6;

describe("resolveSceneEnvironment", () => {
	it("uses cyclic keyframes and interpolates fog only when both endpoints enable it", () => {
		const environment = resolveSceneEnvironment(activeRegion(), {
			dayIndex: 0,
			timeOfDay: 0.75,
			dayGroupOverride: 0,
		});
		expect(environment.distanceFog?.near).toBeCloseTo(15);
		expect(environment.distanceFog?.far).toBeCloseTo(150);
		expect(environment.distanceFog?.color.red).toBeCloseTo(0.5);
	});

	it("does not reinterpret authored chanceOfOccur as fog or selection policy", () => {
		const source = activeRegion(false);
		expect(
			resolveSceneEnvironment(source, {
				dayIndex: 0,
				timeOfDay: 0.75,
				dayGroupOverride: 0,
			}).distanceFog,
		).toBeNull();
	});

	/**
	 * The shipped region authors a 0.8 s sky tick against a 15 s light tick, so the sky must resolve
	 * on its own cadence rather than inheriting the lighting quantization.
	 */
	it("samples the sky on its own tick while lighting holds at the coarser one", () => {
		const source = activeRegion();
		const region = {
			...source,
			data: {
				...source.data,
				sky: {
					tickSize: 125,
					lightTickSize: 500,
					dayGroups: [
						{
							chanceOfOccur: 0,
							dayName: "Clear",
							// One object sweeping the whole day, so any change in the sampled fraction
							// shows up as a changed orientation.
							skyObjects: [
								{
									beginTime: 0,
									endTime: 1,
									beginAngle: 0,
									endAngle: 360,
									textureVelocityX: 0,
									textureVelocityY: 0,
									defaultGfxObjectId: "0x01000001",
									defaultParticleEffectId: "0x00000000",
									properties: 0,
								},
							],
							skyTimes: [skyTime(0, 10, 100, 0x000000)],
						},
					],
				},
			},
		};
		const sampled = [0.3, 0.4].map(
			(timeOfDay) =>
				resolveSceneEnvironment(region, {
					dayIndex: 0,
					timeOfDay,
					dayGroupOverride: 0,
				}).sky,
		);
		// Both fractions quantize to the same 500 s lighting sample but to different 125 s sky ones.
		expect(sampled[0]?.objects[0]?.orientation).not.toEqual(
			sampled[1]?.objects[0]?.orientation,
		);
	});

	it("resolves no sky at all for a region that authors none", () => {
		const source = activeRegion();
		expect(
			resolveSceneEnvironment(
				{ ...source, data: { ...source.data, sky: null } },
				{ dayIndex: 0, timeOfDay: 0.5, dayGroupOverride: null },
			).sky,
		).toBeNull();
	});
});

describe("resolveSceneEnvironment lighting", () => {
	/** Sun length carries authored brightness, so a lit region must not normalize it away. */
	it("folds directional brightness into the sun vector length", () => {
		const lighting = lightingAt(0, [
			lit({ begin: 0, directionalBrightness: 0.8, directionalPitch: 90 }),
		]);
		expect(Math.hypot(...sunAxes(lighting))).toBeCloseTo(0.8);
	});

	/** AC authors Z-up with +Y north; render space is Y-up with -Z north. */
	it("maps a due-north sun onto the render -Z axis", () => {
		const lighting = lightingAt(0, [
			lit({
				begin: 0,
				directionalBrightness: 1,
				directionalHeading: 0,
				directionalPitch: 0,
			}),
		]);
		expect(lighting.sunVector.x).toBeCloseTo(0);
		expect(lighting.sunVector.y).toBeCloseTo(0);
		expect(lighting.sunVector.z).toBeCloseTo(-1);
	});

	/** A 90-degree heading is due east, and pitch lifts the sun along render +Y. */
	it("maps heading and pitch onto render east and up", () => {
		const lighting = lightingAt(0, [
			lit({
				begin: 0,
				directionalBrightness: 1,
				directionalHeading: 90,
				directionalPitch: 90,
			}),
		]);
		expect(lighting.sunVector.y).toBeCloseTo(1);
		const horizontal = lightingAt(0, [
			lit({ begin: 0, directionalBrightness: 1, directionalHeading: 90 }),
		]);
		expect(horizontal.sunVector.x).toBeCloseTo(1);
	});

	it("interpolates sun and ambient between bracketing keyframes", () => {
		const lighting = lightingAt(0.5, [
			lit({ begin: 0, directionalBrightness: 0, ambientBrightness: 0.4 }),
			lit({
				begin: 1 - 1e-6,
				directionalBrightness: 1,
				ambientBrightness: 0.8,
			}),
		]);
		expect(lighting.ambientLevel).toBeGreaterThan(0.4);
		expect(lighting.ambientLevel).toBeLessThan(0.8);
		expect(Math.hypot(...sunAxes(lighting))).toBeGreaterThan(0);
	});

	it("floors authored night ambient at the retail minimum", () => {
		const lighting = lightingAt(0, [
			lit({ begin: 0, ambientBrightness: MINIMUM_AMBIENT_LEVEL / 4 }),
		]);
		expect(lighting.ambientLevel).toBe(MINIMUM_AMBIENT_LEVEL);
	});

	it("wraps the final keyframe back to the first across midnight", () => {
		const before = lightingAt(0.9, [
			lit({ begin: 0, ambientBrightness: 1 }),
			lit({ begin: 0.8, ambientBrightness: 0.5 }),
		]);
		expect(before.ambientLevel).toBeGreaterThan(0.5);
		expect(before.ambientLevel).toBeLessThan(1);
	});

	it("falls back to retail unauthored lighting when a region has no sky", () => {
		const source = activeRegion();
		const environment = resolveSceneEnvironment(
			{ ...source, data: { ...source.data, sky: null } },
			{ dayIndex: 0, timeOfDay: 0.5, dayGroupOverride: null },
		);
		expect(environment.lighting).toEqual(UNAUTHORED_SCENE_LIGHTING);
		expect(environment.lighting.ambientLevel).toBe(
			UNAUTHORED_LIGHTING.ambientLevel,
		);
	});
});

function sunAxes(lighting: {
	readonly sunVector: { x: number; y: number; z: number };
}): [number, number, number] {
	return [lighting.sunVector.x, lighting.sunVector.y, lighting.sunVector.z];
}

/** Resolve lighting for one synthetic day group at the given day fraction. */
function lightingAt(
	timeOfDay: number,
	skyTimes: readonly ReturnType<typeof lit>[],
) {
	const source = activeRegion();
	return resolveSceneEnvironment(
		{
			...source,
			data: {
				...source.data,
				sky: {
					tickSize: TEST_TICK_SECONDS,
					lightTickSize: TEST_TICK_SECONDS,
					dayGroups: [
						{
							chanceOfOccur: 0,
							dayName: "Test",
							skyObjects: [],
							skyTimes: [...skyTimes],
						},
					],
				},
			},
		},
		{ dayIndex: 0, timeOfDay, dayGroupOverride: 0 },
	).lighting;
}

/** One lighting-focused sky keyframe; fog fields stay inert. */
function lit(overrides: {
	readonly begin: number;
	readonly directionalBrightness?: number;
	readonly directionalHeading?: number;
	readonly directionalPitch?: number;
	readonly ambientBrightness?: number;
}) {
	return {
		begin: overrides.begin,
		directionalBrightness: overrides.directionalBrightness ?? 0,
		directionalHeading: overrides.directionalHeading ?? 0,
		directionalPitch: overrides.directionalPitch ?? 0,
		directionalColor: 0xffffff,
		ambientBrightness: overrides.ambientBrightness ?? 1,
		ambientColor: 0xffffff,
		minWorldFog: 0,
		maxWorldFog: 0,
		worldFogColor: 0,
		worldFog: 0,
		skyObjectReplacements: [],
	};
}

function activeRegion(enableSecondFog = true): ActiveRegionSource {
	return {
		provenance: {
			sourceRecordId: "0x13000000",
			number: 1,
			version: 3,
			name: "test",
			partsMask: 0x10,
		},
		landHeightTable: new Float32Array(256),
		data: {
			land: {
				numBlockLength: 1,
				numBlockWidth: 1,
				squareLength: 24,
				landblockLength: 192,
				verticesPerCell: 8,
				maxObjectHeight: 1,
				roadWidth: 1,
			},
			calendar: {
				zeroTimeOfYear: 0,
				zeroYear: 0,
				dayLength: TEST_DAY_LENGTH_SECONDS,
				daysPerYear: 365,
				yearSpec: "year",
				timesOfDay: [],
				daysOfTheWeek: [],
				seasons: [],
			},
			terrain: null,
			sound: null,
			scenes: null,
			misc: null,
			sky: {
				tickSize: TEST_TICK_SECONDS,
				lightTickSize: TEST_TICK_SECONDS,
				dayGroups: [
					{
						chanceOfOccur: 0,
						dayName: "Clear",
						skyObjects: [],
						skyTimes: [
							skyTime(0, 10, 100, 0x000000),
							skyTime(0.5, 20, 200, 0x0000ff, enableSecondFog ? 1 : 0),
						],
					},
				],
			},
		},
	};
}

function skyTime(
	begin: number,
	minWorldFog: number,
	maxWorldFog: number,
	worldFogColor: number,
	worldFog = 1,
) {
	return {
		begin,
		directionalBrightness: 0,
		directionalHeading: 0,
		directionalPitch: 0,
		directionalColor: 0,
		ambientBrightness: 0,
		ambientColor: 0,
		minWorldFog,
		maxWorldFog,
		worldFogColor,
		worldFog,
		skyObjectReplacements: [],
	};
}
