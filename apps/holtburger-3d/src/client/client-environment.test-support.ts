import type { ActiveRegionSource } from "../lib/assets/active-region-source";

/** Asset-independent calendar for adapter, presentation, and browser integration probes. */
export const ENVIRONMENT_FIXTURE_DAY_SECONDS = 100;

/** Two authored-style groups with distinct lighting and time-varying celestial orientation. */
export function clientEnvironmentFixture(): ActiveRegionSource {
	return {
		provenance: {
			sourceRecordId: "0x13000000",
			number: 0,
			version: 3,
			name: "fixture",
			partsMask: 16,
		},
		landHeightTable: new Float32Array(256),
		data: {
			land: {
				numBlockLength: 0,
				numBlockWidth: 0,
				squareLength: 0,
				landblockLength: 0,
				verticesPerCell: 0,
				maxObjectHeight: 0,
				roadWidth: 0,
			},
			calendar: {
				zeroTimeOfYear: 0,
				zeroYear: 0,
				dayLength: ENVIRONMENT_FIXTURE_DAY_SECONDS,
				daysPerYear: 360,
				yearSpec: "P.Y.",
				timesOfDay: [],
				daysOfTheWeek: [],
				seasons: [],
			},
			sound: null,
			scenes: null,
			terrain: null,
			misc: null,
			sky: {
				tickSize: 0.8,
				lightTickSize: 15,
				dayGroups: ["Sunny", "Rainy"].map((dayName, index) => ({
					dayName,
					chanceOfOccur: 1,
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
					skyTimes: [
						{
							begin: 0,
							directionalBrightness: 1,
							directionalHeading: 0,
							directionalPitch: 45,
							directionalColor: 0xffffff,
							ambientBrightness: 0.3 + index * 0.2,
							ambientColor: 0xffffff,
							minWorldFog: 0,
							maxWorldFog: 0,
							worldFogColor: 0,
							worldFog: 0,
							skyObjectReplacements: [],
						},
					],
				})),
			},
		},
	};
}
