import { describe, expect, it } from "vitest";
import { resolveSkyState, SKY_BRIGHTNESS_SCALE } from "./sky-state";

/**
 * The shipped region's first day group ("Sunny"), transcribed from a census of `dats/assets.hba`.
 * Its authored values drive these tests so the resolver is checked against real content rather
 * than invented shapes: replacements at object indices 0, 1, and 4 of a seven-object list, a sun
 * with a bounded window, an always-visible Setup-family object, and a scrolling cloud layer.
 */
const SUNNY = {
	chanceOfOccur: 0,
	dayName: "Sunny",
	skyObjects: [
		skyObject({ gfx: "0x010015EE" }),
		skyObject({ gfx: "0x010015EF" }),
		skyObject({
			gfx: "0x01001F67",
			beginTime: 0.04,
			endTime: 0.21,
			beginAngle: -20,
			endAngle: 190,
		}),
		skyObject({
			gfx: "0x01001F6A",
			beginTime: 0,
			endTime: 0.23,
			beginAngle: -20,
			endAngle: 190,
		}),
		skyObject({
			gfx: "0x01004C36",
			properties: 2,
			textureVelocityX: -0.013,
			textureVelocityY: 0.013,
		}),
		skyObject({
			gfx: "0x01001348",
			beginTime: 0.16,
			endTime: 0.94,
			beginAngle: -23,
			endAngle: 203,
		}),
		skyObject({ gfx: "0x02000714", pes: "0x330007DB" }),
	],
	skyTimes: [
		skyTime(0, [
			replace(0, { rotate: 270, transparent: -1, brightness: 11 }),
			replace(1, { transparent: 0, brightness: 0 }),
			replace(4, { transparent: 100, brightness: 15 }),
		]),
		skyTime(0.16, [
			replace(0, { rotate: 270, transparent: -1, brightness: 11 }),
			replace(1, { transparent: 0, brightness: 0 }),
			replace(4, { transparent: 0, brightness: 22 }),
		]),
		skyTime(0.21, [
			replace(0, { rotate: 270, transparent: -1, brightness: 66 }),
			replace(1, { transparent: 70, brightness: 0 }),
			replace(4, { transparent: 0, brightness: 65 }),
		]),
	],
};

describe("resolveSkyState", () => {
	it("drops objects outside their authored window and keeps begin==end objects always", () => {
		const early = ids(0.03);
		expect(early).not.toContain("0x01001F67");
		expect(early).toContain("0x01001F6A");
		expect(early).toContain("0x02000714");

		const midMorning = ids(0.1);
		expect(midMorning).toContain("0x01001F67");

		const late = ids(0.3);
		expect(late).not.toContain("0x01001F67");
		expect(late).not.toContain("0x01001F6A");
		expect(late).toContain("0x02000714");
	});

	it("excludes an object exactly on its window boundary, as retail's strict comparison does", () => {
		expect(ids(0.04)).not.toContain("0x01001F67");
		expect(ids(0.21)).not.toContain("0x01001F67");
	});

	it("interpolates the authored angle into a pitch about AC's north axis", () => {
		// The sun's window runs 0..0.23 across -20..190 degrees, so its midpoint is 85 degrees.
		const sun = objectAt(0.115, "0x01001F6A");
		const half = degreesToRadians(85) / 2;
		expectQuaternion(sun.orientation, [Math.cos(half), 0, -Math.sin(half), 0]);
	});

	it("leaves an always-visible object at its authored begin angle", () => {
		expectQuaternion(objectAt(0.5, "0x02000714").orientation, [1, 0, 0, 0]);
	});

	it("applies a rotate replacement as a yaw about AC's up axis", () => {
		const half = degreesToRadians(270) / 2;
		expectQuaternion(objectAt(0.05, "0x010015EE").orientation, [
			Math.cos(half),
			0,
			0,
			-Math.sin(half),
		]);
	});

	/** Replacements are keyed by their authored index, not by their position in the list. */
	it("targets the object named by objectIndex rather than the replacement's list position", () => {
		// The third replacement names index 4, so the cloud layer is lit: at 0.05 it sits 0.3125 of
		// the way from the keyframe at 0 (brightness 15) to the one at 0.16 (brightness 22).
		expect(objectAt(0.05, "0x01004C36").material.diffuse).toBeCloseTo(
			17.1875 * SKY_BRIGHTNESS_SCALE,
		);
		expect(objectAt(0.05, "0x01001F6A").material.diffuse).toBeNull();
	});

	it("scales authored brightness out of its 0-100 range and interpolates between keyframes", () => {
		const atKeyframe = objectAt(0.16, "0x01004C36").material;
		expect(atKeyframe.luminosity).toBeCloseTo(22 * SKY_BRIGHTNESS_SCALE);
		expect(atKeyframe.diffuse).toBeCloseTo(22 * SKY_BRIGHTNESS_SCALE);

		// Midway between the 0.16 and 0.21 keyframes, brightness sits midway between 22 and 65.
		const midway = objectAt(0.185, "0x01004C36").material;
		expect(midway.luminosity).toBeCloseTo(43.5 * SKY_BRIGHTNESS_SCALE);
	});

	it("leaves a channel unset when either keyframe declines to author it", () => {
		// The sky object at index 0 authors transparent = -1 throughout, and index 1 authors a
		// brightness of zero, which retail's strictly-positive test rejects.
		expect(objectAt(0.05, "0x010015EE").material.translucency).toBeNull();
		expect(objectAt(0.05, "0x010015EF").material.luminosity).toBeNull();
		// Transparent is authored at zero, so its `>= 0` test accepts it.
		expect(objectAt(0.05, "0x010015EF").material.translucency).toBe(0);
	});

	it("leaves every channel unset when the following keyframe omits the object", () => {
		const group = {
			...SUNNY,
			skyTimes: [
				skyTime(0, [replace(0, { brightness: 50, transparent: 50 })]),
				skyTime(0.5, []),
			],
		};
		const material = resolveSkyState(group, 0, 0.25).objects[0]?.material;
		expect(material).toEqual({
			luminosity: null,
			diffuse: null,
			translucency: null,
		});
	});

	it("carries the physics-script id and raw properties through unconsumed", () => {
		const scripted = objectAt(0.5, "0x02000714");
		expect(scripted.particleEffectId).toBe("0x330007DB");
		expect(scripted.properties).toBe(0);
		expect(objectAt(0.5, "0x01004C36").properties).toBe(2);
	});

	it("marks weather objects non-celestial while still resolving them", () => {
		const group = {
			...SUNNY,
			skyObjects: [skyObject({ gfx: "0x01004C42", properties: 13 })],
			skyTimes: [skyTime(0, []), skyTime(0.5, [])],
		};
		const resolved = resolveSkyState(group, 3, 0.25).objects;
		expect(resolved).toHaveLength(1);
		expect(resolved[0]?.isCelestial).toBe(false);
		expect(objectAt(0.5, "0x01004C36").isCelestial).toBe(true);
	});

	/** A gfx replacement applies unconditionally, so it can revive an out-of-window object. */
	it("restores an object whose window has closed when a replacement names a gfx id", () => {
		const group = {
			...SUNNY,
			skyTimes: [
				skyTime(0, [replace(2, { gfx: "0x01001F99" })]),
				skyTime(0.5, []),
			],
		};
		expect(
			resolveSkyState(group, 0, 0.3).objects.map((o) => o.gfxObjectId),
		).toContain("0x01001F99");
	});

	it("carries the authored texture velocity through unchanged", () => {
		expect(objectAt(0.5, "0x01004C36").textureVelocity).toEqual([
			-0.013, 0.013,
		]);
		expect(objectAt(0.5, "0x02000714").textureVelocity).toEqual([0, 0]);
	});

	it("fails loudly when a replacement names an object the day group does not author", () => {
		const group = {
			...SUNNY,
			skyTimes: [
				skyTime(0, [replace(99, { brightness: 10 })]),
				skyTime(0.5, []),
			],
		};
		expect(() => resolveSkyState(group, 0, 0.25)).toThrow("object index 99");
	});

	it("reports the selected day group alongside the resolved objects", () => {
		const state = resolveSkyState(SUNNY, 7, 0.5);
		expect(state.dayGroupIndex).toBe(7);
		expect(state.dayGroupName).toBe("Sunny");
	});
});

function ids(dayFraction: number): string[] {
	return resolveSkyState(SUNNY, 0, dayFraction).objects.map(
		(object) => object.gfxObjectId,
	);
}

function objectAt(dayFraction: number, gfxObjectId: string) {
	const object = resolveSkyState(SUNNY, 0, dayFraction).objects.find(
		(candidate) => candidate.gfxObjectId === gfxObjectId,
	);
	if (object === undefined) {
		throw new Error(`${gfxObjectId} is not visible at ${dayFraction}.`);
	}
	return object;
}

function expectQuaternion(
	actual: readonly [number, number, number, number],
	expected: readonly [number, number, number, number],
): void {
	for (const [index, component] of expected.entries()) {
		expect(actual[index]).toBeCloseTo(component);
	}
}

function degreesToRadians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

function skyObject(overrides: {
	readonly gfx: string;
	readonly pes?: string;
	readonly properties?: number;
	readonly beginTime?: number;
	readonly endTime?: number;
	readonly beginAngle?: number;
	readonly endAngle?: number;
	readonly textureVelocityX?: number;
	readonly textureVelocityY?: number;
}) {
	return {
		beginTime: overrides.beginTime ?? 0,
		endTime: overrides.endTime ?? 0,
		beginAngle: overrides.beginAngle ?? 0,
		endAngle: overrides.endAngle ?? 0,
		textureVelocityX: overrides.textureVelocityX ?? 0,
		textureVelocityY: overrides.textureVelocityY ?? 0,
		defaultGfxObjectId: overrides.gfx,
		defaultParticleEffectId: overrides.pes ?? "0x00000000",
		properties: overrides.properties ?? 0,
	};
}

/** One sky keyframe carrying only the fields the sky resolver reads. */
function skyTime(
	begin: number,
	skyObjectReplacements: readonly ReturnType<typeof replace>[],
) {
	return {
		begin,
		directionalBrightness: 0,
		directionalHeading: 0,
		directionalPitch: 0,
		directionalColor: 0,
		ambientBrightness: 0,
		ambientColor: 0,
		minWorldFog: 0,
		maxWorldFog: 0,
		worldFogColor: 0,
		worldFog: 0,
		skyObjectReplacements: [...skyObjectReplacements],
	};
}

/** Authored replacements set luminosity and max_bright together, so one `brightness` covers both. */
function replace(
	objectIndex: number,
	overrides: {
		readonly gfx?: string;
		readonly rotate?: number;
		readonly transparent?: number;
		readonly brightness?: number;
	},
) {
	return {
		objectIndex,
		gfxObjectId: overrides.gfx ?? "0x00000000",
		rotate: overrides.rotate ?? 0,
		transparent: overrides.transparent ?? -1,
		luminosity: overrides.brightness ?? 0,
		maxBrightness: overrides.brightness ?? 0,
	};
}
