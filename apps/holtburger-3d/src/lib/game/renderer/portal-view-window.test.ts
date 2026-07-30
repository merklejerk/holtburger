import { describe, expect, it } from "vitest";
import type { LandblockCoordinates } from "../landblocks";
import { createPerspectiveMat4, multiplyMat4 } from "../math/matrices";
import { Mat4, Vec2, Vec3 } from "../math/types";
import type { PlanarAperture } from "../scene/planar-aperture";
import {
	admitPortalViewWindow,
	clipPortalWindowThroughAperture,
	clipPortalWindowThroughNearClipAperture,
	createFullPortalViewWindow,
	createPortalViewWindow,
	portalViewWindowBounds,
	portalViewWindowContainsPoint,
	type PortalApertureProjectionInput,
	type PreparedPortalProjection,
} from "./portal-view-window";

const ORIGIN: LandblockCoordinates = { x: 0, y: 0 };
const IDENTITY_PROJECTION: PreparedPortalProjection = {
	anchorCoordinates: ORIGIN,
	clipFromAnchor: Mat4.identity(),
};

describe("portal view windows", () => {
	it("normalizes duplicate and collinear vertices into deterministic convex fragments", () => {
		const window = createPortalViewWindow([
			[
				new Vec2(1, 1),
				new Vec2(-1, 1),
				new Vec2(-1, 0),
				new Vec2(-1, -1),
				new Vec2(1, -1),
				new Vec2(1, -1),
			],
		]);

		expect(window?.fragments).toHaveLength(1);
		expect(window?.fragments[0]?.vertices).toEqual([
			new Vec2(-1, -1),
			new Vec2(1, -1),
			new Vec2(1, 1),
			new Vec2(-1, 1),
		]);
	});

	it("rejects inherited geometry outside normalized device space", () => {
		expect(() =>
			createPortalViewWindow([
				[new Vec2(-1.1, -1), new Vec2(1, -1), new Vec2(0, 1)],
			]),
		).toThrow("outside normalized device space");
	});

	it("admits only visibility not provably covered by a retained convex fragment", () => {
		const coverage = requiredWindow([rectangle(-0.8, -0.8, 0.2, 0.8)]);
		const contained = admitPortalViewWindow(
			coverage,
			requiredWindow([rectangle(-0.6, -0.5, 0, 0.5)]),
		);
		expect(contained.delta).toBeNull();

		const containing = admitPortalViewWindow(
			coverage,
			requiredWindow([rectangle(-0.9, -0.9, 0.4, 0.9)]),
		);
		expect(containing.delta?.fragments).toHaveLength(1);
		expect(containing.coverage.fragments).toHaveLength(1);

		const partial = admitPortalViewWindow(
			coverage,
			requiredWindow([rectangle(0, -0.5, 0.6, 0.5)]),
		);
		expect(partial.delta?.fragments).toHaveLength(1);
		expect(partial.coverage.fragments).toHaveLength(2);
	});

	it("clips nested source windows monotonically through the same aperture", () => {
		const apertureInput = aperture([
			[-0.75, -0.75, 0],
			[0.75, -0.75, 0],
			[0.75, 0.75, 0],
			[-0.75, 0.75, 0],
		]);
		const superset = requiredWindow([rectangle(-0.8, -0.8, 0.8, 0.8)]);
		const subset = requiredWindow([rectangle(-0.4, -0.4, 0.4, 0.4)]);
		const supersetResult = clipPortalWindowThroughAperture(
			IDENTITY_PROJECTION,
			superset,
			apertureInput,
		);
		const subsetResult = clipPortalWindowThroughAperture(
			IDENTITY_PROJECTION,
			subset,
			apertureInput,
		);
		expect(supersetResult.kind).toBe("visible");
		expect(subsetResult.kind).toBe("visible");
		if (supersetResult.kind !== "visible" || subsetResult.kind !== "visible") {
			return;
		}

		expect(
			admitPortalViewWindow(supersetResult.window, subsetResult.window).delta,
		).toBeNull();
	});

	it("projects an authored triangle without assuming a quad", () => {
		const result = clipPortalWindowThroughAperture(
			IDENTITY_PROJECTION,
			createFullPortalViewWindow(),
			aperture([
				[-0.5, -0.5, 0],
				[0.5, -0.5, 0],
				[0, 0.5, 0],
			]),
		);

		expect(result.kind).toBe("visible");
		if (result.kind !== "visible") return;
		expect(result.window.fragments).toHaveLength(1);
		expect(result.window.fragments[0]?.vertices).toEqual([
			new Vec2(-0.5, -0.5),
			new Vec2(0.5, -0.5),
			new Vec2(0, 0.5),
		]);
		expect(result.diagnostics).toMatchObject({
			inputTriangleCount: 1,
			outputFragmentCount: 1,
			outputVertexCount: 3,
		});
	});

	it("clips in homogeneous space before perspective division", () => {
		const projection = perspectiveProjection();
		const result = clipPortalWindowThroughAperture(
			projection,
			createFullPortalViewWindow(),
			aperture([
				[-0.5, -0.5, -2],
				[0.5, -0.5, -2],
				[0, 0.5, -0.5],
			]),
		);

		expect(result.kind).toBe("visible");
		if (result.kind !== "visible") return;
		const bounds = portalViewWindowBounds(result.window);
		expect(bounds.min.x).toBeGreaterThanOrEqual(-1);
		expect(bounds.max.x).toBeLessThanOrEqual(1);
		expect(bounds.min.y).toBeGreaterThanOrEqual(-1);
		expect(bounds.max.y).toBeLessThanOrEqual(1);
		expect(result.window.fragments[0]?.vertices.length).toBe(4);
	});

	it("projects near-clipped apertures as rays while preserving the parent window gate", () => {
		const projection = perspectiveProjection();
		const nearClipped = aperture([
			[-0.2, -0.2, -0.5],
			[0.2, -0.2, -0.5],
			[0, 0.2, -0.5],
		]);
		expect(
			clipPortalWindowThroughAperture(
				projection,
				createFullPortalViewWindow(),
				nearClipped,
			).kind,
		).toBe("empty");

		const visible = clipPortalWindowThroughNearClipAperture(
			projection,
			createFullPortalViewWindow(),
			nearClipped,
		);
		expect(visible.kind).toBe("visible");
		if (visible.kind !== "visible") return;
		const bounds = portalViewWindowBounds(visible.window);
		expect(bounds.min.x).toBeCloseTo(-0.4);
		expect(bounds.min.y).toBeCloseTo(-0.4);
		expect(bounds.max.x).toBeCloseTo(0.4);
		expect(bounds.max.y).toBeCloseTo(0.4);

		const disjointParent = requiredWindow([rectangle(0.6, 0.6, 0.9, 0.9)]);
		expect(
			clipPortalWindowThroughNearClipAperture(
				projection,
				disjointParent,
				nearClipped,
			).kind,
		).toBe("empty");
	});

	it("rejects triangles wholly behind the eye", () => {
		const result = clipPortalWindowThroughAperture(
			perspectiveProjection(),
			createFullPortalViewWindow(),
			aperture([
				[-0.5, -0.5, 1],
				[0.5, -0.5, 1],
				[0, 0.5, 1],
			]),
		);

		expect(result.kind).toBe("empty");
		expect(result.diagnostics.homogeneousRejectedTriangleCount).toBe(1);
		expect(result.diagnostics.outputVertexCount).toBe(0);
	});

	it("clips partially off-screen triangles to finite NDC polygons", () => {
		const result = clipPortalWindowThroughAperture(
			IDENTITY_PROJECTION,
			createFullPortalViewWindow(),
			aperture([
				[-2, -0.5, 0],
				[2, -0.5, 0],
				[0, 2, 0],
			]),
		);

		expect(result.kind).toBe("visible");
		if (result.kind !== "visible") return;
		for (const fragment of result.window.fragments) {
			for (const vertex of fragment.vertices) {
				expect(Number.isFinite(vertex.x)).toBe(true);
				expect(Number.isFinite(vertex.y)).toBe(true);
				expect(vertex.x).toBeGreaterThanOrEqual(-1);
				expect(vertex.x).toBeLessThanOrEqual(1);
				expect(vertex.y).toBeGreaterThanOrEqual(-1);
				expect(vertex.y).toBeLessThanOrEqual(1);
			}
		}
	});

	it("rejects an edge-on aperture after projection", () => {
		const result = clipPortalWindowThroughAperture(
			perspectiveProjection(),
			createFullPortalViewWindow(),
			aperture([
				[0, -1, -2],
				[0, 1, -2],
				[0, 0, -3],
			]),
		);

		expect(result.kind).toBe("empty");
	});

	it("preserves concave aperture triangulation without filling the missing region", () => {
		const result = clipPortalWindowThroughAperture(
			IDENTITY_PROJECTION,
			createFullPortalViewWindow(),
			aperture(
				[
					[-0.8, -0.8, 0],
					[0.8, -0.8, 0],
					[0.8, -0.2, 0],
					[-0.2, -0.2, 0],
					[-0.2, 0.8, 0],
					[-0.8, 0.8, 0],
				],
				[0, 1, 3, 1, 2, 3, 0, 3, 5, 3, 4, 5],
			),
		);

		expect(result.kind).toBe("visible");
		if (result.kind !== "visible") return;
		expect(result.window.fragments).toHaveLength(2);
		expect(
			portalViewWindowContainsPoint(result.window, new Vec2(0.5, -0.5)),
		).toBe(true);
		expect(
			portalViewWindowContainsPoint(result.window, new Vec2(-0.5, 0.5)),
		).toBe(true);
		expect(
			portalViewWindowContainsPoint(result.window, new Vec2(0.5, 0.5)),
		).toBe(false);
	});

	it("applies the aperture landblock offset in the prepared anchor frame", () => {
		const result = clipPortalWindowThroughAperture(
			IDENTITY_PROJECTION,
			createFullPortalViewWindow(),
			{
				...aperture([
					[-0.5, -0.5, 0],
					[0.5, -0.5, 0],
					[0, 0.5, 0],
				]),
				landblockCoordinates: { x: 1, y: 0 },
			},
		);

		expect(result.kind).toBe("empty");
	});

	it("uses a conservative bounds broad phase before exact intersection", () => {
		const inherited = createPortalViewWindow([
			[new Vec2(-0.9, -0.9), new Vec2(-0.6, -0.9), new Vec2(-0.75, -0.6)],
		]);
		if (!inherited) throw new Error("Expected inherited fixture window.");
		const result = clipPortalWindowThroughAperture(
			IDENTITY_PROJECTION,
			inherited,
			aperture([
				[0.6, 0.6, 0],
				[0.9, 0.6, 0],
				[0.75, 0.9, 0],
			]),
		);

		expect(result.kind).toBe("empty");
		expect(result.diagnostics.broadPhaseRejectedPairCount).toBe(1);
		expect(
			referenceTrianglesIntersect(inherited.fragments[0]!.vertices, [
				new Vec2(0.6, 0.6),
				new Vec2(0.9, 0.6),
				new Vec2(0.75, 0.9),
			]),
		).toBe(false);
	});

	it("agrees with an independent exact triangle oracle", () => {
		const random = seededRandom(0x5eed);
		for (let fixture = 0; fixture < 128; fixture += 1) {
			const inheritedTriangle = randomTriangle(random);
			const apertureTriangle = randomTriangle(random);
			const inherited = createPortalViewWindow([inheritedTriangle]);
			if (!inherited) throw new Error("Random triangle normalized empty.");
			const result = clipPortalWindowThroughAperture(
				IDENTITY_PROJECTION,
				inherited,
				aperture(
					apertureTriangle.map((point) => [point.x, point.y, 0] as const),
				),
			);
			const expected = referenceTrianglesIntersect(
				inheritedTriangle,
				apertureTriangle,
			);

			expect(result.kind === "visible", `fixture ${fixture}`).toBe(expected);
			if (result.diagnostics.broadPhaseRejectedPairCount > 0) {
				expect(expected, `broad-phase fixture ${fixture}`).toBe(false);
			}
		}
	});

	it("rejects non-finite projection facts before producing output", () => {
		const invalid = Mat4.identity();
		invalid.m11 = Number.NaN;

		expect(() =>
			clipPortalWindowThroughAperture(
				{ anchorCoordinates: ORIGIN, clipFromAnchor: invalid },
				createFullPortalViewWindow(),
				aperture([
					[-0.5, -0.5, 0],
					[0.5, -0.5, 0],
					[0, 0.5, 0],
				]),
			),
		).toThrow("matrix must be finite");
	});
});

function perspectiveProjection(): PreparedPortalProjection {
	return {
		anchorCoordinates: ORIGIN,
		clipFromAnchor: multiplyMat4(
			createPerspectiveMat4(90, 1, 1, 10),
			Mat4.identity(),
		),
	};
}

function requiredWindow(
	fragments: readonly (readonly Vec2[])[],
): NonNullable<ReturnType<typeof createPortalViewWindow>> {
	const window = createPortalViewWindow(fragments);
	if (!window) throw new Error("Expected non-empty portal-window fixture.");
	return window;
}

function rectangle(
	minX: number,
	minY: number,
	maxX: number,
	maxY: number,
): readonly Vec2[] {
	return [
		new Vec2(minX, minY),
		new Vec2(maxX, minY),
		new Vec2(maxX, maxY),
		new Vec2(minX, maxY),
	];
}

function aperture(
	vertices: readonly (readonly [number, number, number])[],
	indices: readonly number[] = [0, 1, 2],
): PortalApertureProjectionInput {
	return {
		aperture: planarAperture(vertices, indices),
		landblockCoordinates: ORIGIN,
	};
}

function planarAperture(
	vertices: readonly (readonly [number, number, number])[],
	indices: readonly number[],
): PlanarAperture {
	if (vertices.length < 3) throw new Error("Fixture requires three vertices.");
	const first = new Vec3(...vertices[indices[0]!]!);
	const second = new Vec3(...vertices[indices[1]!]!);
	const third = new Vec3(...vertices[indices[2]!]!);
	const edgeA = new Vec3(
		second.x - first.x,
		second.y - first.y,
		second.z - first.z,
	);
	const edgeB = new Vec3(
		third.x - first.x,
		third.y - first.y,
		third.z - first.z,
	);
	const normal = new Vec3(
		edgeA.y * edgeB.z - edgeA.z * edgeB.y,
		edgeA.z * edgeB.x - edgeA.x * edgeB.z,
		edgeA.x * edgeB.y - edgeA.y * edgeB.x,
	);
	const length = Math.hypot(normal.x, normal.y, normal.z);
	if (length === 0) {
		// Edge-on projection fixtures remain valid planar geometry in three dimensions.
		normal.x = 1;
		normal.y = 0;
		normal.z = 0;
	} else {
		normal.x /= length;
		normal.y /= length;
		normal.z /= length;
	}
	return {
		indices: Uint32Array.from(indices),
		plane: {
			d: -(normal.x * first.x + normal.y * first.y + normal.z * first.z),
			normal,
		},
		vertices: Float32Array.from(vertices.flat()),
	};
}

function randomTriangle(random: () => number): readonly Vec2[] {
	for (;;) {
		const triangle = [
			new Vec2(random() * 1.8 - 0.9, random() * 1.8 - 0.9),
			new Vec2(random() * 1.8 - 0.9, random() * 1.8 - 0.9),
			new Vec2(random() * 1.8 - 0.9, random() * 1.8 - 0.9),
		];
		if (Math.abs(signedArea(triangle)) > 0.05) return triangle;
	}
}

function referenceTrianglesIntersect(
	left: readonly Vec2[],
	right: readonly Vec2[],
): boolean {
	if (left.some((point) => referencePointInTriangle(point, right))) return true;
	if (right.some((point) => referencePointInTriangle(point, left))) return true;
	for (let leftIndex = 0; leftIndex < 3; leftIndex += 1) {
		for (let rightIndex = 0; rightIndex < 3; rightIndex += 1) {
			if (
				referenceSegmentsIntersect(
					left[leftIndex]!,
					left[(leftIndex + 1) % 3]!,
					right[rightIndex]!,
					right[(rightIndex + 1) % 3]!,
				)
			) {
				return true;
			}
		}
	}
	return false;
}

function referencePointInTriangle(
	point: Vec2,
	triangle: readonly Vec2[],
): boolean {
	const denominator =
		(triangle[1]!.y - triangle[2]!.y) * (triangle[0]!.x - triangle[2]!.x) +
		(triangle[2]!.x - triangle[1]!.x) * (triangle[0]!.y - triangle[2]!.y);
	const first =
		((triangle[1]!.y - triangle[2]!.y) * (point.x - triangle[2]!.x) +
			(triangle[2]!.x - triangle[1]!.x) * (point.y - triangle[2]!.y)) /
		denominator;
	const second =
		((triangle[2]!.y - triangle[0]!.y) * (point.x - triangle[2]!.x) +
			(triangle[0]!.x - triangle[2]!.x) * (point.y - triangle[2]!.y)) /
		denominator;
	const third = 1 - first - second;
	return first >= 0 && second >= 0 && third >= 0;
}

function referenceSegmentsIntersect(
	leftStart: Vec2,
	leftEnd: Vec2,
	rightStart: Vec2,
	rightEnd: Vec2,
): boolean {
	const leftA = orientation(leftStart, leftEnd, rightStart);
	const leftB = orientation(leftStart, leftEnd, rightEnd);
	const rightA = orientation(rightStart, rightEnd, leftStart);
	const rightB = orientation(rightStart, rightEnd, leftEnd);
	return leftA * leftB < 0 && rightA * rightB < 0;
}

function orientation(start: Vec2, end: Vec2, point: Vec2): number {
	return (
		(end.x - start.x) * (point.y - start.y) -
		(end.y - start.y) * (point.x - start.x)
	);
}

function signedArea(vertices: readonly Vec2[]): number {
	return (
		(vertices[0]!.x * (vertices[1]!.y - vertices[2]!.y) +
			vertices[1]!.x * (vertices[2]!.y - vertices[0]!.y) +
			vertices[2]!.x * (vertices[0]!.y - vertices[1]!.y)) /
		2
	);
}

function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		return state / 0x1_0000_0000;
	};
}
