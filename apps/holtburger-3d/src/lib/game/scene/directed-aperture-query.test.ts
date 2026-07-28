import { describe, expect, it } from "vitest";
import { Vec3 } from "../math/types";
import {
	findEarliestDirectedApertureHits,
	type DirectedApertureCandidate,
} from "./directed-aperture-query";
import type { PlanarAperture } from "./planar-aperture";

const APERTURE: PlanarAperture = {
	indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
	plane: { d: 0, normal: new Vec3(1, 0, 0) },
	vertices: new Float32Array([0, -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1]),
};

describe("directed aperture selection", () => {
	it("accepts only travel from the authored source side", () => {
		expect(
			findEarliestDirectedApertureHits([
				candidate("forward", "positive", new Vec3(2, 0, 0), new Vec3(-2, 0, 0)),
			]),
		).toMatchObject([{ id: "forward", t: 0.5 }]);
		expect(
			findEarliestDirectedApertureHits([
				candidate("reverse", "positive", new Vec3(-2, 0, 0), new Vec3(2, 0, 0)),
			]),
		).toEqual([]);
	});

	it("rejects plane touches, coplanar travel, and finite-aperture misses", () => {
		expect(
			findEarliestDirectedApertureHits([
				candidate("touch", "positive", new Vec3(2, 0, 0), Vec3.zero()),
				candidate(
					"coplanar",
					"positive",
					new Vec3(0, -1, 0),
					new Vec3(0, 1, 0),
				),
				candidate("miss", "positive", new Vec3(2, 2, 0), new Vec3(-2, 2, 0)),
			]),
		).toEqual([]);
	});

	it("selects the smallest forward parameter", () => {
		const later = translatedAperture(-1);

		expect(
			findEarliestDirectedApertureHits([
				candidate(
					"later",
					"positive",
					new Vec3(2, 0, 0),
					new Vec3(-2, 0, 0),
					later,
				),
				candidate("first", "positive", new Vec3(2, 0, 0), new Vec3(-2, 0, 0)),
			]),
		).toMatchObject([{ id: "first", t: 0.5 }]);
	});

	it("retains deterministic identities for a true boundary tie", () => {
		expect(
			findEarliestDirectedApertureHits([
				candidate("second", "positive", new Vec3(2, 0, 0), new Vec3(-2, 0, 0)),
				candidate("first", "positive", new Vec3(2, 0, 0), new Vec3(-2, 0, 0)),
			]),
		).toMatchObject([
			{ id: "first", t: 0.5 },
			{ id: "second", t: 0.5 },
		]);
	});

	it("supports finite apertures on rotated non-axis-aligned planes", () => {
		const component = Math.SQRT1_2;
		const normal = new Vec3(component, 0, component);
		const tangent = new Vec3(component, 0, -component);
		const rotatedAperture: PlanarAperture = {
			indices: APERTURE.indices,
			plane: { d: 0, normal },
			vertices: new Float32Array([
				tangent.x,
				-1,
				tangent.z,
				tangent.x,
				1,
				tangent.z,
				-tangent.x,
				1,
				-tangent.z,
				-tangent.x,
				-1,
				-tangent.z,
			]),
		};

		expect(
			findEarliestDirectedApertureHits([
				candidate(
					"rotated",
					"positive",
					new Vec3(normal.x * 2, 0, normal.z * 2),
					new Vec3(-normal.x * 2, 0, -normal.z * 2),
					rotatedAperture,
				),
			]),
		).toMatchObject([{ id: "rotated", t: 0.5 }]);
	});
});

function candidate(
	id: string,
	acceptedSide: "positive" | "negative",
	start: Vec3,
	end: Vec3,
	aperture = APERTURE,
): DirectedApertureCandidate<string> {
	return { acceptedSide, aperture, end, id, start, value: id };
}

function translatedAperture(x: number): PlanarAperture {
	return {
		indices: APERTURE.indices,
		plane: { d: -x, normal: APERTURE.plane.normal },
		vertices: new Float32Array(
			Array.from(APERTURE.vertices, (value, index) =>
				index % 3 === 0 ? value + x : value,
			),
		),
	};
}
