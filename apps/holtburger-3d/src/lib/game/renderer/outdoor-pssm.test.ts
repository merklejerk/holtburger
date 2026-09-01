import { describe, expect, it } from "vitest";
import { transformPoint3 } from "../math/matrices";
import { Quat, Vec3 } from "../math/types";
import { DEFAULT_ENTITY_SHADOW_SETTINGS } from "./entity-shadow-policy";
import {
	buildOutdoorPssmCascades,
	createPracticalCascadeSplits,
	hasOutdoorShadowLight,
	outdoorShadowCastLength,
	resolveOutdoorShadowProjection,
	terrainLandblockIntersectsShadowDistance,
	type OutdoorPssmCascade,
	type OutdoorPssmCamera,
	writeFrustumSliceCorners,
} from "./outdoor-pssm";

const CAMERA: OutdoorPssmCamera = {
	position: Vec3.zero(),
	rotation: Quat.identity(),
	verticalFovDegrees: 90,
	aspectRatio: 1,
	near: 1,
	far: 200,
};

const SETTINGS = {
	...DEFAULT_ENTITY_SHADOW_SETTINGS.pssm,
	cascadeCount: 2,
	mapResolution: 1_024,
	maximumDistance: 101,
};

const PROJECTION_SETTINGS = {
	...DEFAULT_ENTITY_SHADOW_SETTINGS.projection,
	maximumCasterHeight: 20,
	maximumCastLength: 20,
};

function projection(sunVector: Vec3, settings = PROJECTION_SETTINGS) {
	return resolveOutdoorShadowProjection(sunVector, settings);
}

describe("outdoor PSSM", () => {
	it("keeps only terrain landblocks horizontally reachable by a cascade", () => {
		const anchor = { x: 10, y: 20 };
		expect(
			terrainLandblockIntersectsShadowDistance(
				anchor,
				anchor,
				new Vec3(96, 0, -96),
				1,
			),
		).toBe(true);
		expect(
			terrainLandblockIntersectsShadowDistance(
				{ x: 11, y: 20 },
				anchor,
				new Vec3(96, 0, -96),
				96,
			),
		).toBe(true);
		expect(
			terrainLandblockIntersectsShadowDistance(
				{ x: 12, y: 20 },
				anchor,
				new Vec3(96, 0, -96),
				96,
			),
		).toBe(false);
	});

	it("builds uniform, logarithmic, and interpolated practical splits", () => {
		const uniform = createPracticalCascadeSplits(1, 101, 2, 0);
		expect(uniform).toEqual([1, 51, 101]);

		const logarithmic = createPracticalCascadeSplits(1, 101, 2, 1);
		const mixed = createPracticalCascadeSplits(1, 101, 2, 0.5);
		expect(logarithmic[0]).toBe(1);
		expect(logarithmic[2]).toBe(101);
		for (let index = 1; index < 2; index += 1) {
			expect(logarithmic[index]).toBeCloseTo(Math.pow(101, index / 2));
			expect(mixed[index]).toBeCloseTo(
				(uniform[index]! + logarithmic[index]!) / 2,
			);
		}
	});

	it("reconstructs identity-camera slice corners and reuses caller storage", () => {
		const storage = Array.from({ length: 8 }, () => new Vec3(99, 99, 99));
		const corners = writeFrustumSliceCorners(CAMERA, 1, 10, storage);
		expect(corners).toBe(storage);
		const expected = [
			new Vec3(-1, -1, -1),
			new Vec3(1, -1, -1),
			new Vec3(-1, 1, -1),
			new Vec3(1, 1, -1),
			new Vec3(-10, -10, -10),
			new Vec3(10, -10, -10),
			new Vec3(-10, 10, -10),
			new Vec3(10, 10, -10),
		];
		for (let index = 0; index < corners.length; index += 1) {
			expect(corners[index]!.x).toBeCloseTo(expected[index]!.x);
			expect(corners[index]!.y).toBeCloseTo(expected[index]!.y);
			expect(corners[index]!.z).toBeCloseTo(expected[index]!.z);
		}
	});

	it("covers the exact configured interval with strictly ordered cascades", () => {
		const storage: OutdoorPssmCascade[] = [];
		const cascades = buildOutdoorPssmCascades(
			{
				camera: CAMERA,
				projection: projection(new Vec3(0.4, 0.8, -0.2)),
				settings: SETTINGS,
			},
			storage,
		);
		expect(cascades).toBe(storage);
		expect(cascades).toHaveLength(2);
		expect(cascades[0]!.splitNear).toBe(CAMERA.near);
		expect(cascades[1]!.splitFar).toBe(SETTINGS.maximumDistance);
		for (let index = 0; index < cascades.length; index += 1) {
			const cascade = cascades[index]!;
			expect(cascade.splitFar).toBeGreaterThan(cascade.splitNear);
			if (index > 0) {
				expect(cascade.splitNear).toBe(cascades[index - 1]!.splitFar);
				expect(cascade.coverageNear).toBe(cascades[index - 1]!.transitionStart);
			} else {
				expect(cascade.coverageNear).toBe(cascade.splitNear);
			}
			expect(cascade.transitionStart).toBeGreaterThanOrEqual(cascade.splitNear);
			expect(cascade.transitionStart).toBeLessThanOrEqual(cascade.splitFar);
		}
	});

	it("contains all slice corners and the toward-sun caster extension", () => {
		const [cascade] = buildOutdoorPssmCascades({
			camera: CAMERA,
			projection: projection(new Vec3(0, 1, 0)),
			settings: { ...SETTINGS, cascadeCount: 1 },
		});
		for (const corner of cascade!.sliceCorners) {
			const clip = transformPoint3(cascade!.lightClip, corner);
			expect(Math.abs(clip.x)).toBeLessThanOrEqual(1 + 1e-10);
			expect(Math.abs(clip.y)).toBeLessThanOrEqual(1 + 1e-10);
			expect(Math.abs(clip.z)).toBeLessThanOrEqual(1 + 1e-10);
		}
		const highestCorner = cascade!.sliceCorners.reduce((highest, corner) =>
			corner.y > highest.y ? corner : highest,
		);
		const paddedCaster = highestCorner.add(
			new Vec3(0, PROJECTION_SETTINGS.maximumCasterHeight * 0.5, 0),
		);
		const paddedClip = transformPoint3(cascade!.lightClip, paddedCaster);
		expect(Math.abs(paddedClip.x)).toBeLessThanOrEqual(1);
		expect(Math.abs(paddedClip.y)).toBeLessThanOrEqual(1);
		expect(Math.abs(paddedClip.z)).toBeLessThanOrEqual(1);
	});

	it("clamps only low light elevation while preserving horizontal azimuth", () => {
		const minimumLightElevationDegrees = 30;
		const low = buildOutdoorPssmCascades({
			camera: CAMERA,
			projection: projection(new Vec3(2, 0, -2), {
				...PROJECTION_SETTINGS,
				minimumLightElevationDegrees,
			}),
			settings: { ...SETTINGS, cascadeCount: 1 },
		})[0]!;
		const expectedHorizontal =
			Math.cos((minimumLightElevationDegrees * Math.PI) / 180) / Math.sqrt(2);
		expect(low.lightView.m13).toBeCloseTo(expectedHorizontal);
		expect(low.lightView.m23).toBeCloseTo(0.5);
		expect(low.lightView.m33).toBeCloseTo(-expectedHorizontal);

		const authored = buildOutdoorPssmCascades({
			camera: CAMERA,
			projection: projection(new Vec3(0, 1, 1), {
				...PROJECTION_SETTINGS,
				minimumLightElevationDegrees,
			}),
			settings: { ...SETTINGS, cascadeCount: 1 },
		})[0]!;
		expect(authored.lightView.m23).toBeCloseTo(1 / Math.sqrt(2));
		expect(authored.lightView.m33).toBeCloseTo(1 / Math.sqrt(2));
	});

	it("holds a light matrix through sub-texel translation and steps by one texel", () => {
		const buildAtX = (x: number) =>
			buildOutdoorPssmCascades({
				camera: { ...CAMERA, position: new Vec3(x, 0, 0) },
				projection: projection(new Vec3(0, 1, 0)),
				settings: { ...SETTINGS, cascadeCount: 1 },
			})[0]!;
		const original = buildAtX(0);
		const subTexel = buildAtX(original.texelWorldSize * 0.25);
		const nextTexel = buildAtX(original.texelWorldSize * 0.75);
		expect(subTexel.lightClip).toEqual(original.lightClip);
		expect(
			Math.abs(nextTexel.lightView.m41 - original.lightView.m41),
		).toBeCloseTo(original.texelWorldSize);
	});

	it("rewrites caller-owned cascade, corner, matrix, and frustum storage", () => {
		const storage: OutdoorPssmCascade[] = [];
		buildOutdoorPssmCascades(
			{
				camera: CAMERA,
				projection: projection(new Vec3(0, 1, 0)),
				settings: SETTINGS,
			},
			storage,
		);
		const records = storage.slice();
		const corners = storage.map((cascade) => cascade.sliceCorners.slice());
		const matrices = storage.map((cascade) => cascade.lightClip);
		const frusta = storage.map((cascade) => cascade.lightFrustum);

		buildOutdoorPssmCascades(
			{
				camera: { ...CAMERA, position: new Vec3(0.01, 0, 0) },
				projection: projection(new Vec3(0, 1, 0)),
				settings: SETTINGS,
			},
			storage,
		);
		for (let index = 0; index < storage.length; index += 1) {
			expect(storage[index]).toBe(records[index]);
			expect(storage[index]!.lightClip).toBe(matrices[index]);
			expect(storage[index]!.lightFrustum).toBe(frusta[index]);
			for (let corner = 0; corner < 8; corner += 1) {
				expect(storage[index]!.sliceCorners[corner]).toBe(
					corners[index]![corner],
				);
			}
		}
	});

	it("rejects degenerate frame inputs before producing partial output", () => {
		expect(() => projection(Vec3.zero())).toThrow("non-zero sun vector");
		expect(hasOutdoorShadowLight(Vec3.zero())).toBe(false);
		expect(() => hasOutdoorShadowLight(new Vec3(Number.NaN, 0, 0))).toThrow(
			"finite sun vector",
		);
		expect(() =>
			buildOutdoorPssmCascades({
				camera: { ...CAMERA, aspectRatio: 0 },
				projection: projection(new Vec3(0, 1, 0)),
				settings: SETTINGS,
			}),
		).toThrow("framing must be finite and non-degenerate");
	});

	it("bounds low-angle projection independently by height and cast length", () => {
		const castLimited = projection(new Vec3(1, 0.01, 0), {
			minimumLightElevationDegrees: 0,
			maximumCasterHeight: 16,
			maximumCastLength: 12,
		});
		expect(castLimited.maximumProjectedCastLength).toBeCloseTo(12);
		expect(outdoorShadowCastLength(castLimited, 4)).toBeCloseTo(12);

		const heightLimited = projection(new Vec3(1, 1, 0), {
			minimumLightElevationDegrees: 0,
			maximumCasterHeight: 4,
			maximumCastLength: 100,
		});
		expect(heightLimited.maximumCasterReach).toBeCloseTo(4 * Math.sqrt(2));
		expect(outdoorShadowCastLength(heightLimited, 2)).toBeCloseTo(2);
	});

	it("never shrinks maximum caster reach when either projection cap grows", () => {
		const sun = new Vec3(1, 0.5, -1);
		const baseline = projection(sun, {
			minimumLightElevationDegrees: 0,
			maximumCasterHeight: 4,
			maximumCastLength: 8,
		});
		const taller = projection(sun, {
			minimumLightElevationDegrees: 0,
			maximumCasterHeight: 8,
			maximumCastLength: 8,
		});
		const longer = projection(sun, {
			minimumLightElevationDegrees: 0,
			maximumCasterHeight: 4,
			maximumCastLength: 16,
		});

		expect(taller.maximumCasterReach).toBeGreaterThanOrEqual(
			baseline.maximumCasterReach,
		);
		expect(longer.maximumCasterReach).toBeGreaterThanOrEqual(
			baseline.maximumCasterReach,
		);
	});
});
