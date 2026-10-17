/** Temporary coordinates in a common nearby aperture plane. */
export type PlanePoint = readonly [number, number];

/** Non-overlapping triangles describing an aperture, including concave or disconnected regions. */
export interface PlaneTriangleMesh {
	/** Projected vertices shared by the indexed triangles. */
	readonly vertices: readonly PlanePoint[];
	/** Complete triangle triplets, with indices into vertices. */
	readonly indices: Uint32Array;
}

/** Three indexed points; winding may be either orientation. */
type Triangle = readonly [PlanePoint, PlanePoint, PlanePoint];

/** Sum pairwise intersections of two triangulated apertures without rebuilding boundary rings. */
export function triangleMeshOverlapArea(
	left: PlaneTriangleMesh,
	right: PlaneTriangleMesh,
): number {
	const leftTriangles = readTriangles(left);
	const rightTriangles = readTriangles(right);
	let area = 0;
	for (const a of leftTriangles) {
		for (const b of rightTriangles) area += triangleOverlapArea(a, b);
	}
	return area;
}

function readTriangles(mesh: PlaneTriangleMesh): readonly Triangle[] {
	if (mesh.indices.length % 3 !== 0)
		throw new Error(
			"Projected aperture indices must contain complete triangles.",
		);
	const triangles: Triangle[] = [];
	for (let offset = 0; offset < mesh.indices.length; offset += 3) {
		const [a, b, c] = Array.from(
			mesh.indices.subarray(offset, offset + 3),
			(index) => mesh.vertices[index],
		);
		if (a === undefined || b === undefined || c === undefined)
			throw new Error(
				"Projected aperture triangle index exceeds its vertices.",
			);
		triangles.push([a, b, c]);
	}
	return triangles;
}

function triangleOverlapArea(subject: Triangle, boundary: Triangle): number {
	const orientation = signedArea(boundary);
	if (orientation === 0) return 0;
	const [a, b, c] =
		orientation < 0
			? ([boundary[2], boundary[1], boundary[0]] as const)
			: boundary;
	let polygon: readonly PlanePoint[] = subject;
	for (const [start, end] of [
		[a, b],
		[b, c],
		[c, a],
	] as const) {
		polygon = clipToEdge(polygon, start, end);
		if (polygon.length < 3) return 0;
	}
	return Math.abs(signedArea(polygon));
}

function clipToEdge(
	polygon: readonly PlanePoint[],
	start: PlanePoint,
	end: PlanePoint,
): readonly PlanePoint[] {
	let previous = polygon.at(-1);
	if (previous === undefined) return [];
	let previousDistance = edgeDistance(start, end, previous);
	const output: PlanePoint[] = [];
	for (const current of polygon) {
		const currentDistance = edgeDistance(start, end, current);
		const currentInside = currentDistance >= 0;
		const previousInside = previousDistance >= 0;
		if (currentInside !== previousInside) {
			const fraction = previousDistance / (previousDistance - currentDistance);
			output.push([
				previous[0] + (current[0] - previous[0]) * fraction,
				previous[1] + (current[1] - previous[1]) * fraction,
			]);
		}
		if (currentInside) output.push(current);
		previous = current;
		previousDistance = currentDistance;
	}
	return output;
}

function edgeDistance(a: PlanePoint, b: PlanePoint, point: PlanePoint): number {
	return (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]);
}

function signedArea(polygon: readonly PlanePoint[]): number {
	const [origin] = polygon;
	if (origin === undefined) return 0;
	let previous = origin;
	let twiceArea = 0;
	// Nearby triangle differences avoid cancellation between absolute-coordinate products.
	for (const current of polygon) {
		twiceArea += edgeDistance(origin, previous, current);
		previous = current;
	}
	return twiceArea / 2;
}
