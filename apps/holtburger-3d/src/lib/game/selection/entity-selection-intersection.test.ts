import { describe, expect, it } from "vitest";
import { createLandblockWorldOrigin } from "../landblocks";
import { AABB3, Mat4, Vec3 } from "../math/types";
import type { DynamicEntitySelectionGeometry } from "../systems/dynamic-entity-system";
import {
	indexedRayTriangleDistance,
	inverseTransformRay,
	refineEntitySelectionCandidates,
	type EntitySelectionGeometry,
	type EntitySelectionGeometrySource,
} from "./entity-selection-intersection";

describe("exact entity selection", () => {
	it("refines current transforms across landblock frames and orders exact ties by GUID", () => {
		const targetLandblock = "0x0101ffff" as const;
		const origin = createLandblockWorldOrigin(targetLandblock);
		const source = selectionSource(
			new Map([
				[9, geometry(targetLandblock, translated(3, 0, 0))],
				[4, geometry(targetLandblock, translated(3, 0, 0))],
			]),
		);
		const result = refineEntitySelectionCandidates(
			source,
			{
				direction: new Vec3(0, 0, -1),
				start: new Vec3(origin.x + 3.25, origin.y + 0.25, origin.z + 10),
			},
			[9, 4],
			20,
		);

		expect(result).toMatchObject({
			distance: 10,
			selectedGuid: 4,
		});
	});

	it("rejects coarse misses and triangles behind the static limit", () => {
		const landblock = "0x0100ffff" as const;
		const origin = createLandblockWorldOrigin(landblock);
		const source = selectionSource(
			new Map([
				[1, geometry(landblock, translated(5, 0, 5))],
				[2, geometry(landblock, translated(0, 0, 0))],
			]),
		);
		const ray = {
			direction: new Vec3(0, 0, -1),
			start: new Vec3(origin.x + 0.25, origin.y + 0.25, origin.z + 10),
		};

		expect(
			refineEntitySelectionCandidates(source, ray, [1, 2], 11).selectedGuid,
		).toBe(2);
		expect(
			refineEntitySelectionCandidates(source, ray, [1, 2], 9).selectedGuid,
		).toBeNull();
	});

	it("preserves authored culling under a mirrored part transform", () => {
		const ray = {
			direction: new Vec3(0, 0, -1),
			start: new Vec3(-0.25, 0.25, 2),
		};
		const mirrored = Mat4.identity();
		mirrored.m11 = -1;
		const localRay = requireInverse(mirrored, ray);
		const positions = trianglePositions();
		const indices = new Uint16Array([0, 1, 2]);

		expect(
			indexedRayTriangleDistance(localRay, positions, indices, 0, "back"),
		).toBeNull();
		expect(
			indexedRayTriangleDistance(localRay, positions, indices, 0, "front"),
		).toBe(2);
	});

	it("intersects a sphere proxy from either side without triangle culling", () => {
		const landblock = "0x0000ffff" as const;
		const origin = createLandblockWorldOrigin(landblock);
		const sphere: EntitySelectionGeometry = {
			kind: "sphere-proxy",
			landblockId: landblock,
			sourceToLandblock: translated(0, 0, 5),
			sphere: { center: new Vec3(0, 0, 0), radius: 2 },
		};
		const source = selectionSource(new Map([[7, sphere]]));

		expect(
			refineEntitySelectionCandidates(
				source,
				{
					direction: new Vec3(0, 0, 1),
					start: new Vec3(origin.x, origin.y, origin.z),
				},
				[7],
				10,
			),
		).toMatchObject({
			distance: 3,
			selectedGuid: 7,
		});
	});
});

function requireInverse(
	transform: Mat4,
	ray: { start: Vec3; direction: Vec3 },
) {
	// Kept local so a failed invert makes the fixture fail loudly rather than changing its premise.
	const transformed = inverseTransformRay(transform, ray);
	if (transformed === null)
		throw new Error("Fixture transform was unexpectedly singular.");
	return transformed;
}

function selectionSource(
	geometries: ReadonlyMap<number, EntitySelectionGeometry>,
): EntitySelectionGeometrySource {
	return {
		withSpawnedEntitySelectionGeometry: (guid, visit) => {
			const value = geometries.get(guid);
			return value === undefined ? null : visit(value);
		},
	};
}

function geometry(
	landblockId: DynamicEntitySelectionGeometry["landblockId"],
	sourceToLandblock: Mat4,
): EntitySelectionGeometry {
	return {
		kind: "triangles",
		landblockId,
		localBounds: new AABB3(new Vec3(0, 0, 0), new Vec3(1, 1, 0)),
		parts: [
			{
				geometry: {
					bakedLight: null,
					indices: new Uint16Array([0, 1, 2]),
					kind: "object",
					normals: new Float32Array(9),
					positions: trianglePositions(),
					textureCoordinates: new Float32Array(6),
				},
				localBounds: new AABB3(new Vec3(0, 0, 0), new Vec3(1, 1, 0)),
				ranges: [{ cullFace: "back", indexCount: 3, indexStart: 0 }],
				sourceToLandblock,
			},
		],
		sourceToLandblock,
	};
}

function trianglePositions(): Float32Array {
	return new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
}

function translated(x: number, y: number, z: number): Mat4 {
	const matrix = Mat4.identity();
	matrix.m41 = x;
	matrix.m42 = y;
	matrix.m43 = z;
	return matrix;
}
