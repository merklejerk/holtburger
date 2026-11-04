import { describe, expect, it } from "vitest";
import {
	triangleMeshOverlapArea,
	type PlanePoint,
	type PlaneTriangleMesh,
} from "./triangle-mesh-overlap";

function rectangle(
	left: number,
	bottom: number,
	right: number,
	top: number,
): PlaneTriangleMesh {
	return {
		vertices: [
			[left, bottom],
			[right, bottom],
			[right, top],
			[left, top],
		],
		indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
	};
}

/** Join disjoint pieces without inventing a boundary ring between them. */
function combine(pieces: readonly PlaneTriangleMesh[]): PlaneTriangleMesh {
	const vertices: PlanePoint[] = [];
	const indices: number[] = [];
	for (const piece of pieces) {
		const offset = vertices.length;
		vertices.push(...piece.vertices);
		indices.push(...Array.from(piece.indices, (index) => index + offset));
	}
	return { vertices, indices: new Uint32Array(indices) };
}

function expectArea(
	left: PlaneTriangleMesh,
	right: PlaneTriangleMesh,
	area: number,
): void {
	expect(triangleMeshOverlapArea(left, right)).toBeCloseTo(area, 12);
	expect(triangleMeshOverlapArea(right, left)).toBeCloseTo(area, 12);
}

describe("projected triangle mesh overlap", () => {
	const square = rectangle(0, 0, 2, 2);

	it("measures identical, contained, and partially overlapping regions", () => {
		expectArea(square, square, 4);
		expectArea(square, rectangle(0.5, 0.5, 1.5, 1.5), 1);
		expectArea(square, rectangle(1, 1, 3, 3), 1);
	});

	it("leaves touching edges and disjoint regions empty", () => {
		expectArea(square, rectangle(2, 0, 4, 2), 0);
		expectArea(square, rectangle(3, 0, 4, 2), 0);
	});

	it("accepts opposite triangle winding", () => {
		expectArea(
			square,
			{ ...square, indices: new Uint32Array([2, 1, 0, 3, 2, 0]) },
			4,
		);
	});

	it("preserves concave geometry and its missing region", () => {
		const opening: PlaneTriangleMesh = {
			vertices: [
				[0, 0],
				[4, 0],
				[4, 1],
				[1, 1],
				[1, 4],
				[0, 4],
			],
			indices: new Uint32Array([0, 1, 3, 1, 2, 3, 0, 3, 5, 3, 4, 5]),
		};
		expectArea(opening, rectangle(0, 0, 4, 4), 7);
		expectArea(opening, rectangle(2, 2, 3, 3), 0);
	});

	it("sums disconnected intersection pieces", () => {
		const opening = combine([
			rectangle(0, 0, 1, 4),
			rectangle(1, 0, 3, 1),
			rectangle(3, 0, 4, 4),
		]);
		expectArea(opening, rectangle(-1, 2, 5, 3), 2);
	});

	it("preserves holes in a triangulated aperture", () => {
		const opening = combine([
			rectangle(0, 0, 4, 1),
			rectangle(0, 3, 4, 4),
			rectangle(0, 1, 1, 3),
			rectangle(3, 1, 4, 3),
		]);
		expectArea(opening, rectangle(0, 0, 4, 4), 12);
		expectArea(opening, rectangle(1.25, 1.25, 2.75, 2.75), 0);
	});

	it("gives degenerate projected triangles zero area", () => {
		expectArea(
			square,
			{ vertices: [[0, 0]], indices: new Uint32Array([0, 0, 0]) },
			0,
		);
	});

	it("rejects incomplete triangles", () => {
		expect(() =>
			triangleMeshOverlapArea(square, {
				...square,
				indices: new Uint32Array([0, 1]),
			}),
		).toThrow("Projected aperture indices must contain complete triangles.");
	});

	it("rejects missing indexed vertices", () => {
		expect(() =>
			triangleMeshOverlapArea(square, {
				...square,
				indices: new Uint32Array([0, 1, square.vertices.length]),
			}),
		).toThrow("Projected aperture triangle index exceeds its vertices.");
	});
});
