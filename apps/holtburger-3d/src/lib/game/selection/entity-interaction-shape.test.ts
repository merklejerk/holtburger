import { describe, expect, it } from "vitest";
import { AABB3, Vec3 } from "../math/types";
import {
	classifySelectionGeometryMorphology,
	selectionSphereFromBounds,
	usesSelectionSphereProxy,
} from "./entity-interaction-shape";

describe("entity interaction shape policy", () => {
	it("classifies only dimensionally degenerate rigid bounds as planar", () => {
		expect(
			classifySelectionGeometryMorphology(
				new AABB3(new Vec3(-2, -1, 0), new Vec3(2, 1, 0)),
			),
		).toBe("planar-carrier");
		expect(
			classifySelectionGeometryMorphology(
				new AABB3(new Vec3(-2, -1, 0), new Vec3(2, 1, 0.001)),
			),
		).toBe("volumetric");
	});

	it("requires both planar morphology and a live emitter owner", () => {
		expect(usesSelectionSphereProxy("planar-carrier", true)).toBe(true);
		expect(usesSelectionSphereProxy("planar-carrier", false)).toBe(false);
		expect(usesSelectionSphereProxy("volumetric", true)).toBe(false);
	});

	it("uses the longest bounds edge as the sphere diameter", () => {
		expect(
			selectionSphereFromBounds(
				new AABB3(new Vec3(-4, -1, 2), new Vec3(6, 3, 2)),
			),
		).toEqual({ center: new Vec3(1, 1, 2), radius: 5 });
	});
});
