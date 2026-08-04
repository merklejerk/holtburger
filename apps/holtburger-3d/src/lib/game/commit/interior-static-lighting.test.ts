import { describe, expect, it } from "vitest";
import { Mat4, Vec3 } from "../math/types";
import {
	bakeStaticLight,
	placeObjectLights,
	type PlacedStaticLight,
	STATIC_LIGHT_RANGE_SCALE,
} from "./interior-static-lighting";

/** One vertex at the origin whose normal faces +Y, so a light above it lights it fully. */
const SINGLE_VERTEX = {
	positions: Float32Array.from([0, 0, 0]),
	normals: Float32Array.from([0, 1, 0]),
};

function light(overrides: Partial<PlacedStaticLight> = {}): PlacedStaticLight {
	return {
		position: { x: 0, y: 1, z: 0 },
		color: { red: 1, green: 1, blue: 1 },
		intensity: 100,
		falloff: 4,
		...overrides,
	};
}

describe("bakeStaticLight", () => {
	it("produces no attribute when a landblock authors no lights", () => {
		expect(
			bakeStaticLight(
				SINGLE_VERTEX.positions,
				SINGLE_VERTEX.normals,
				Mat4.identity(),
				[],
			),
		).toBeNull();
	});

	it("produces no attribute when every light is out of range", () => {
		const falloff = 2;
		const beyondRange = falloff * STATIC_LIGHT_RANGE_SCALE + 1;
		expect(
			bakeStaticLight(
				SINGLE_VERTEX.positions,
				SINGLE_VERTEX.normals,
				Mat4.identity(),
				[light({ falloff, position: { x: 0, y: beyondRange, z: 0 } })],
			),
		).toBeNull();
	});

	it("clamps each channel to the light's own color", () => {
		const baked = bakeStaticLight(
			SINGLE_VERTEX.positions,
			SINGLE_VERTEX.normals,
			Mat4.identity(),
			[light({ color: { red: 1, green: 0.5, blue: 0 }, intensity: 100 })],
		);
		expect(baked).not.toBeNull();
		// Authored intensity is 20..100, far above unity, so the per-channel clamp is what
		// bounds the result — never the intensity itself.
		expect(baked![0]).toBeCloseTo(1);
		expect(baked![1]).toBeCloseTo(0.5);
		expect(baked![2]).toBe(0);
	});

	it("falls off toward the authored range boundary", () => {
		const near = bakeStaticLight(
			SINGLE_VERTEX.positions,
			SINGLE_VERTEX.normals,
			Mat4.identity(),
			[light({ falloff: 10, intensity: 1, position: { x: 0, y: 2, z: 0 } })],
		);
		const far = bakeStaticLight(
			SINGLE_VERTEX.positions,
			SINGLE_VERTEX.normals,
			Mat4.identity(),
			[light({ falloff: 10, intensity: 1, position: { x: 0, y: 10, z: 0 } })],
		);
		expect(near![0]).toBeGreaterThan(far![0]!);
	});

	/** Retail's wrap term uses the unnormalized delta, so a zero normal still receives light. */
	it("still lights a zero normal, matching retail's half-Lambert wrap", () => {
		const baked = bakeStaticLight(
			SINGLE_VERTEX.positions,
			Float32Array.from([0, 0, 0]),
			Mat4.identity(),
			[light({ intensity: 1 })],
		);
		expect(baked).not.toBeNull();
		expect(baked![0]).toBeGreaterThan(0);
	});

	it("lights a surface facing away from the light less than one facing it", () => {
		const facing = bakeStaticLight(
			SINGLE_VERTEX.positions,
			Float32Array.from([0, 1, 0]),
			Mat4.identity(),
			[light({ intensity: 1 })],
		);
		const away = bakeStaticLight(
			SINGLE_VERTEX.positions,
			Float32Array.from([0, -1, 0]),
			Mat4.identity(),
			[light({ intensity: 1 })],
		);
		expect(facing![0]).toBeGreaterThan(away?.[0] ?? 0);
	});

	it("bakes in landblock space so a cell's own transform is honored", () => {
		// The vertex sits at landblock (0, 5, 0) once the cell transform applies, which is
		// where the light is; without the transform it would be out of range.
		const cellToLandblock = Mat4.identity();
		cellToLandblock.m42 = 5;
		const baked = bakeStaticLight(
			SINGLE_VERTEX.positions,
			SINGLE_VERTEX.normals,
			cellToLandblock,
			[light({ falloff: 1, position: { x: 0, y: 5.5, z: 0 } })],
		);
		expect(baked).not.toBeNull();
		expect(baked![0]).toBeGreaterThan(0);
	});
});

describe("placeObjectLights", () => {
	it("composes authored offsets with the object's landblock placement", () => {
		const placement = Mat4.identity();
		placement.m41 = 10;
		placement.m43 = -3;
		const placed: PlacedStaticLight[] = [];
		placeObjectLights(
			[
				{
					offset: new Vec3(0, 2, 0),
					color: { red: 1, green: 1, blue: 1 },
					intensity: 50,
					falloff: 3,
				},
			],
			placement,
			placed,
		);
		expect(placed).toHaveLength(1);
		expect(placed[0]!.position).toMatchObject({ x: 10, y: 2, z: -3 });
		expect(placed[0]!.intensity).toBe(50);
	});
});
