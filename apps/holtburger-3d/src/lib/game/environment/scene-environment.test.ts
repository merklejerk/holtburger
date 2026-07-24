import { describe, expect, it } from "vitest";
import type { ActiveRegionSource } from "../../assets/active-region-source";
import { resolveSceneEnvironment } from "./scene-environment";

describe("resolveSceneEnvironment", () => {
	it("uses cyclic keyframes and interpolates fog only when both endpoints enable it", () => {
		const environment = resolveSceneEnvironment(activeRegion(), {
			dayIndex: 0,
			timeOfDay: 0.75,
			dayGroupOverride: 0,
		});
		expect(environment.distanceFog).toMatchObject({ near: 15, far: 150 });
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
});

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
				skyHeight: 1,
				roadWidth: 1,
			},
			calendar: {
				zeroTimeOfYear: 0,
				zeroYear: 0,
				dayLength: 1,
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
				tickSize: 1,
				lightTickSize: 1,
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
