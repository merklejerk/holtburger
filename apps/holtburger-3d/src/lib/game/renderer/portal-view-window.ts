import {
	createLandblockOffset,
	type LandblockCoordinates,
} from "../landblocks";
import { AABB2, Mat4, Vec2 } from "../math/types";
import {
	type PlanarAperture,
	validatePlanarAperture,
} from "../scene/planar-aperture";

/** Shared normalization tolerance for normalized-device-coordinate portal geometry. */
export const PORTAL_WINDOW_NDC_EPSILON = 0.000_001;

/** One convex NDC polygon retained independently from the aperture's other triangles. */
interface PortalViewWindowFragment {
	readonly vertices: readonly Vec2[];
}

const NORMALIZED_PORTAL_VIEW_WINDOW: unique symbol = Symbol(
	"normalized-portal-view-window",
);

/** An exact, possibly multipart NDC visibility region. */
export interface PortalViewWindow {
	/** Constructor-owned brand preventing callers from bypassing normalization. */
	readonly [NORMALIZED_PORTAL_VIEW_WINDOW]: true;
	readonly fragments: readonly PortalViewWindowFragment[];
}

/**
 * Total normalized-device-coordinate fragment area. Any surviving overlap is counted twice,
 * conservatively retaining rather than incorrectly rejecting that window.
 */
export function portalViewWindowNdcArea(window: PortalViewWindow): number {
	return window.fragments.reduce(
		(total, fragment) => total + Math.abs(polygonSignedArea(fragment.vertices)),
		0,
	);
}

/** Prepared renderer facts shared by frustum extraction and portal projection. */
export interface PreparedPortalProjection {
	/** Landblock origin used by the anchor-relative clip transform. */
	readonly anchorCoordinates: LandblockCoordinates;
	/** Transform from anchor-relative positions into homogeneous clip space. */
	readonly clipFromAnchor: Mat4;
}

/** One authored aperture plus the landblock frame containing its vertices. */
export interface PortalApertureProjectionInput {
	readonly aperture: PlanarAperture;
	readonly landblockCoordinates: LandblockCoordinates;
}

const PREPARED_PORTAL_APERTURE_PROJECTION: unique symbol = Symbol(
	"prepared-portal-aperture-projection",
);

/** Topology-stable aperture facts validated and assembled once per authored resource. */
export interface PreparedPortalApertureProjectionInput extends PortalApertureProjectionInput {
	/** Constructor-owned brand preventing camera planning from accepting raw authored topology. */
	readonly [PREPARED_PORTAL_APERTURE_PROJECTION]: true;
	/** Convex authored loops after deleting triangulation-only seams. */
	readonly convexVertexLoops: readonly (readonly number[])[];
	/** Deterministic topology-revision work needed to produce this preparation. */
	readonly preparationTrace: PortalAperturePreparationTrace;
}

/** Immutable aperture-preparation work, excluded from every per-camera planner bound. */
export interface PortalAperturePreparationTrace {
	readonly convexityVertexTestCount: number;
	readonly mergeEdgePairTestCount: number;
	readonly triangleCount: number;
}

/** Checked operation sink used by planners that must stop inside one pathological projection. */
export interface PortalWindowPrimitiveMeter {
	/** Charge a proved positive number of primitive operations before the associated work occurs. */
	consume(kind: PortalWindowPrimitiveKind, count: number): void;
}

/** Camera-dependent loop/allocation dimensions summed by the atomic projection budget. */
export type PortalWindowPrimitiveKind =
	| "apertureVertexTransformCount"
	| "createdClipVertexCount"
	| "createdNdcVertexCount"
	| "createdPolygonCount"
	| "exactIntersectionPairCount"
	| "fragmentSortComparisonCount"
	| "homogeneousClipVertexVisitCount"
	| "homogeneousFiniteVertexTestCount"
	| "mergeBoundaryVertexVisitCount"
	| "mergeConvexityVertexTestCount"
	| "mergeEdgePairTestCount"
	| "ndcClipVertexEdgeTestCount"
	| "normalizationVertexVisitCount"
	| "polygonBoundsVertexVisitCount"
	| "polygonIdentityVertexVisitCount";

/** Validated per-view projection reused across every aperture traversal in one plan. */
export class PortalWindowProjector {
	readonly #meter: PortalWindowPrimitiveMeter | null;
	readonly #projection: PreparedPortalProjection;

	constructor(
		projection: PreparedPortalProjection,
		meter: PortalWindowPrimitiveMeter | null,
	) {
		validatePreparedPortalProjection(projection);
		this.#meter = meter;
		this.#projection = projection;
	}

	clipThroughAperture(
		inherited: PortalViewWindow,
		aperture: PreparedPortalApertureProjectionInput,
	): PortalWindowProjectionResult {
		return clipPortalWindowThroughProjectedAperture(
			this.#projection,
			inherited,
			aperture,
			HOMOGENEOUS_CLIP_DISTANCES,
			this.#meter,
		);
	}

	clipThroughNearClipAperture(
		inherited: PortalViewWindow,
		aperture: PreparedPortalApertureProjectionInput,
	): PortalWindowProjectionResult {
		return clipPortalWindowThroughProjectedAperture(
			this.#projection,
			inherited,
			aperture,
			NEAR_CLIP_APERTURE_DISTANCES,
			this.#meter,
		);
	}
}

/** Consumed algorithmic cost facts for Gate E and focused geometry tests. */
export interface PortalWindowProjectionDiagnostics {
	readonly apertureVertexTransformCount: number;
	readonly broadPhaseRejectedPairCount: number;
	readonly createdClipVertexCount: number;
	readonly createdNdcVertexCount: number;
	readonly createdPolygonCount: number;
	readonly emptyExactIntersectionCount: number;
	readonly exactIntersectionPairCount: number;
	readonly homogeneousClippedPolygonCount: number;
	readonly homogeneousClipVertexVisitCount: number;
	readonly homogeneousFiniteVertexTestCount: number;
	readonly homogeneousRejectedTriangleCount: number;
	readonly inputTriangleCount: number;
	readonly mergeConvexityVertexTestCount: number;
	readonly mergeBoundaryVertexVisitCount: number;
	readonly mergeEdgePairTestCount: number;
	readonly fragmentSortComparisonCount: number;
	readonly ndcClipVertexEdgeTestCount: number;
	readonly normalizationVertexVisitCount: number;
	readonly outputFragmentCount: number;
	readonly outputVertexCount: number;
	readonly polygonBoundsVertexVisitCount: number;
	readonly polygonIdentityVertexVisitCount: number;
}

/** Allocate a zeroed aggregate for callers that combine multiple projection results. */
export function createEmptyPortalWindowProjectionDiagnostics(): PortalWindowProjectionDiagnostics {
	return finishDiagnostics(createDiagnostics(null), null);
}

/** Sum exactly the camera-time dimensions charged by `PortalWindowPrimitiveMeter`. */
export function portalWindowProjectionPrimitiveCount(
	diagnostics: PortalWindowProjectionDiagnostics,
): number {
	return (
		diagnostics.apertureVertexTransformCount +
		diagnostics.createdClipVertexCount +
		diagnostics.createdNdcVertexCount +
		diagnostics.createdPolygonCount +
		diagnostics.exactIntersectionPairCount +
		diagnostics.fragmentSortComparisonCount +
		diagnostics.homogeneousClipVertexVisitCount +
		diagnostics.homogeneousFiniteVertexTestCount +
		diagnostics.mergeBoundaryVertexVisitCount +
		diagnostics.mergeConvexityVertexTestCount +
		diagnostics.mergeEdgePairTestCount +
		diagnostics.ndcClipVertexEdgeTestCount +
		diagnostics.normalizationVertexVisitCount +
		diagnostics.polygonBoundsVertexVisitCount +
		diagnostics.polygonIdentityVertexVisitCount
	);
}

/** Explicit empty/visible result from one or more sequential aperture intersections. */
export type PortalWindowProjectionResult =
	| {
			readonly diagnostics: PortalWindowProjectionDiagnostics;
			readonly kind: "empty";
	  }
	| {
			readonly diagnostics: PortalWindowProjectionDiagnostics;
			readonly kind: "visible";
			readonly window: PortalViewWindow;
	  };

/** Monotonic exact-window admission without polygon-union approximation. */
export interface PortalViewWindowAdmission {
	/** Maximal retained fragments after admitting the candidate. */
	readonly coverage: PortalViewWindow;
	/** Candidate fragments not already covered, or null when no visibility changed. */
	readonly delta: PortalViewWindow | null;
}

interface ClipVertex {
	readonly w: number;
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

interface MutablePortalWindowProjectionDiagnostics {
	readonly meter: PortalWindowPrimitiveMeter | null;
	apertureVertexTransformCount: number;
	broadPhaseRejectedPairCount: number;
	createdClipVertexCount: number;
	createdNdcVertexCount: number;
	createdPolygonCount: number;
	emptyExactIntersectionCount: number;
	exactIntersectionPairCount: number;
	homogeneousClippedPolygonCount: number;
	homogeneousClipVertexVisitCount: number;
	homogeneousFiniteVertexTestCount: number;
	homogeneousRejectedTriangleCount: number;
	inputTriangleCount: number;
	mergeConvexityVertexTestCount: number;
	mergeBoundaryVertexVisitCount: number;
	mergeEdgePairTestCount: number;
	fragmentSortComparisonCount: number;
	ndcClipVertexEdgeTestCount: number;
	normalizationVertexVisitCount: number;
	polygonBoundsVertexVisitCount: number;
	polygonIdentityVertexVisitCount: number;
}

type HomogeneousClipDistance = (vertex: ClipVertex) => number;

const HOMOGENEOUS_CLIP_DISTANCES: readonly HomogeneousClipDistance[] = [
	(vertex) => vertex.x + vertex.w,
	(vertex) => vertex.w - vertex.x,
	(vertex) => vertex.y + vertex.w,
	(vertex) => vertex.w - vertex.y,
	(vertex) => vertex.z + vertex.w,
	(vertex) => vertex.w - vertex.z,
];
const NEAR_CLIP_APERTURE_DISTANCES: readonly HomogeneousClipDistance[] = [
	(vertex) => vertex.w - PORTAL_WINDOW_NDC_EPSILON,
	...HOMOGENEOUS_CLIP_DISTANCES.slice(0, 4),
];
const PREPARED_APERTURES = new WeakMap<
	PlanarAperture,
	PreparedPortalApertureProjectionInput
>();

/** Build the full normalized-device-coordinate root view. */
export function createFullPortalViewWindow(): PortalViewWindow {
	const window = createPortalViewWindow([
		[new Vec2(-1, -1), new Vec2(1, -1), new Vec2(1, 1), new Vec2(-1, 1)],
	]);
	if (!window)
		throw new Error("Full portal view unexpectedly normalized empty.");
	return window;
}

/**
 * Normalize convex fragments without merging adjacent triangles, filling holes, or bridging
 * disjoint pieces.
 */
export function createPortalViewWindow(
	fragments: readonly (readonly Vec2[])[],
): PortalViewWindow | null {
	return createPortalViewWindowWithDiagnostics(fragments, null);
}

function createPortalViewWindowWithDiagnostics(
	fragments: readonly (readonly Vec2[])[],
	diagnostics: MutablePortalWindowProjectionDiagnostics | null,
): PortalViewWindow | null {
	const byIdentity = new Map<string, PortalViewWindowFragment>();
	for (const fragment of fragments) {
		const normalized = normalizeConvexPolygon(fragment, diagnostics);
		if (!normalized) continue;
		const identity = polygonIdentity(normalized, diagnostics);
		if (!byIdentity.has(identity)) {
			byIdentity.set(identity, { vertices: normalized });
		}
	}
	if (byIdentity.size === 0) return null;
	const merged = mergeAdjacentConvexFragments(
		[...byIdentity.values()],
		diagnostics,
	);
	return {
		[NORMALIZED_PORTAL_VIEW_WINDOW]: true,
		fragments: merged.sort((left, right) =>
			comparePolygonOrder(left.vertices, right.vertices, diagnostics),
		),
	};
}

/**
 * Delete triangulation-only seams when two adjacent fragments have an exactly convex union.
 *
 * The merge is topology preserving: fragments must share one complete oppositely directed edge,
 * and the boundary left after deleting that edge must remain convex. Partial overlaps, holes,
 * concave unions, and disconnected components remain separate.
 */
function mergeAdjacentConvexFragments(
	fragments: readonly PortalViewWindowFragment[],
	diagnostics: MutablePortalWindowProjectionDiagnostics | null,
): PortalViewWindowFragment[] {
	const merged = fragments.map((fragment) => ({
		vertices: fragment.vertices,
	}));
	for (let leftIndex = 0; leftIndex < merged.length; leftIndex += 1) {
		for (let rightIndex = leftIndex + 1; rightIndex < merged.length; ) {
			const vertices = mergeAdjacentConvexPolygons(
				merged[leftIndex]!.vertices,
				merged[rightIndex]!.vertices,
				diagnostics,
			);
			if (!vertices) {
				rightIndex += 1;
				continue;
			}
			merged[leftIndex] = { vertices };
			merged.splice(rightIndex, 1);
			rightIndex = leftIndex + 1;
		}
	}
	return merged;
}

function mergeAdjacentConvexPolygons(
	left: readonly Vec2[],
	right: readonly Vec2[],
	diagnostics: MutablePortalWindowProjectionDiagnostics | null,
): readonly Vec2[] | null {
	for (let leftEdge = 0; leftEdge < left.length; leftEdge += 1) {
		const leftStart = left[leftEdge]!;
		const leftEnd = left[(leftEdge + 1) % left.length]!;
		for (let rightEdge = 0; rightEdge < right.length; rightEdge += 1) {
			charge(diagnostics, "mergeEdgePairTestCount", 1);
			if (
				!pointsApproximatelyEqual(
					leftStart,
					right[(rightEdge + 1) % right.length]!,
				) ||
				!pointsApproximatelyEqual(leftEnd, right[rightEdge]!)
			) {
				continue;
			}
			const boundary = [
				...polygonPath(
					left,
					(leftEdge + 1) % left.length,
					leftEdge,
					diagnostics,
				),
				...polygonPath(
					right,
					(rightEdge + 2) % right.length,
					(rightEdge + right.length - 1) % right.length,
					diagnostics,
				),
			];
			if (!polygonIsConvex(boundary, diagnostics)) return null;
			return normalizeConvexPolygon(boundary, diagnostics);
		}
	}
	return null;
}

function polygonPath(
	vertices: readonly Vec2[],
	startIndex: number,
	endIndex: number,
	diagnostics: MutablePortalWindowProjectionDiagnostics | null,
): readonly Vec2[] {
	const path: Vec2[] = [];
	for (let index = startIndex; ; index = (index + 1) % vertices.length) {
		charge(diagnostics, "mergeBoundaryVertexVisitCount", 1);
		path.push(vertices[index]!);
		if (index === endIndex) return path;
	}
}

function polygonIsConvex(
	vertices: readonly Vec2[],
	diagnostics: MutablePortalWindowProjectionDiagnostics | null,
): boolean {
	if (vertices.length < 3) return false;
	for (let index = 0; index < vertices.length; index += 1) {
		charge(diagnostics, "mergeConvexityVertexTestCount", 1);
		if (
			edgeDistance(
				vertices[index]!,
				vertices[(index + 1) % vertices.length]!,
				vertices[(index + 2) % vertices.length]!,
			) < -PORTAL_WINDOW_NDC_EPSILON
		) {
			return false;
		}
	}
	return true;
}

/** Return conservative NDC bounds for one exact multipart window. */
export function portalViewWindowBounds(window: PortalViewWindow): AABB2 {
	const first = window.fragments[0]!.vertices[0]!;
	const bounds = new AABB2(first.clone(), first.clone());
	for (const fragment of window.fragments) {
		for (const vertex of fragment.vertices) {
			bounds.min.x = Math.min(bounds.min.x, vertex.x);
			bounds.min.y = Math.min(bounds.min.y, vertex.y);
			bounds.max.x = Math.max(bounds.max.x, vertex.x);
			bounds.max.y = Math.max(bounds.max.y, vertex.y);
		}
	}
	return bounds;
}

/** Test one NDC point against the exact union of convex window fragments. */
export function portalViewWindowContainsPoint(
	window: PortalViewWindow,
	point: Vec2,
): boolean {
	if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
		throw new Error("Portal-window point must be finite.");
	}
	return window.fragments.some((fragment) =>
		pointInConvexPolygon(fragment.vertices, point),
	);
}

/**
 * Admit only fragments not provably contained by one retained convex fragment.
 *
 * Partial overlap remains explicit. This can conservatively retain redundant coverage, but it
 * cannot bridge disjoint fragments or suppress an unproven region.
 */
export function admitPortalViewWindow(
	coverage: PortalViewWindow | null,
	candidate: PortalViewWindow,
): PortalViewWindowAdmission {
	if (!coverage) {
		return {
			coverage: candidate,
			delta: candidate,
		};
	}
	const novelFragments = candidate.fragments.filter(
		(candidateFragment) =>
			!coverage.fragments.some((coverageFragment) =>
				convexPolygonContainsPolygon(
					coverageFragment.vertices,
					candidateFragment.vertices,
				),
			),
	);
	const delta = createPortalViewWindow(
		novelFragments.map((fragment) => fragment.vertices),
	);
	if (!delta) {
		return { coverage, delta: null };
	}
	const retainedFragments = coverage.fragments.filter(
		(coverageFragment) =>
			!delta.fragments.some((novelFragment) =>
				convexPolygonContainsPolygon(
					novelFragment.vertices,
					coverageFragment.vertices,
				),
			),
	);
	const combined = createPortalViewWindow([
		...retainedFragments.map((fragment) => fragment.vertices),
		...delta.fragments.map((fragment) => fragment.vertices),
	]);
	if (!combined) {
		throw new Error(
			"Portal-window admission unexpectedly removed all coverage.",
		);
	}
	return { coverage: combined, delta };
}

/** Project and intersect one aperture with an inherited exact window. */
export function clipPortalWindowThroughAperture(
	projection: PreparedPortalProjection,
	inherited: PortalViewWindow,
	aperture: PortalApertureProjectionInput,
): PortalWindowProjectionResult {
	return new PortalWindowProjector(projection, null).clipThroughAperture(
		inherited,
		preparePortalApertureProjectionInput(aperture),
	);
}

/**
 * Project an aperture before the near cap and intersect its ray footprint with an inherited window.
 *
 * Straddle admission needs this path because ordinary homogeneous clipping correctly rejects
 * geometry inside the camera's near-clipped volume.
 */
export function clipPortalWindowThroughNearClipAperture(
	projection: PreparedPortalProjection,
	inherited: PortalViewWindow,
	aperture: PortalApertureProjectionInput,
): PortalWindowProjectionResult {
	return new PortalWindowProjector(
		projection,
		null,
	).clipThroughNearClipAperture(
		inherited,
		preparePortalApertureProjectionInput(aperture),
	);
}

/** Validate and merge immutable aperture topology once, independently from camera projection. */
export function preparePortalApertureProjectionInput(
	input: PortalApertureProjectionInput,
): PreparedPortalApertureProjectionInput {
	const cached = PREPARED_APERTURES.get(input.aperture);
	if (cached) {
		if (
			cached.landblockCoordinates.x !== input.landblockCoordinates.x ||
			cached.landblockCoordinates.y !== input.landblockCoordinates.y
		) {
			throw new Error(
				"One authored portal aperture cannot belong to multiple landblocks.",
			);
		}
		return cached;
	}
	validatePlanarAperture(input.aperture);
	validateLandblockCoordinates(input.landblockCoordinates);
	const preparationTrace: MutablePortalAperturePreparationTrace = {
		convexityVertexTestCount: 0,
		mergeEdgePairTestCount: 0,
		triangleCount: input.aperture.indices.length / 3,
	};
	const convexVertexLoops = prepareConvexApertureVertexLoops(
		input.aperture,
		preparationTrace,
	);
	const prepared: PreparedPortalApertureProjectionInput = Object.freeze({
		[PREPARED_PORTAL_APERTURE_PROJECTION]: true as const,
		aperture: input.aperture,
		convexVertexLoops,
		landblockCoordinates: Object.freeze({ ...input.landblockCoordinates }),
		preparationTrace: Object.freeze({ ...preparationTrace }),
	});
	PREPARED_APERTURES.set(input.aperture, prepared);
	return prepared;
}

function clipPortalWindowThroughProjectedAperture(
	projection: PreparedPortalProjection,
	inherited: PortalViewWindow,
	aperture: PreparedPortalApertureProjectionInput,
	clipDistances: readonly HomogeneousClipDistance[],
	meter: PortalWindowPrimitiveMeter | null,
): PortalWindowProjectionResult {
	const diagnostics = createDiagnostics(meter);
	const projected = projectAperture(
		projection,
		aperture,
		diagnostics,
		clipDistances,
	);
	if (!projected) {
		record(diagnostics, "emptyExactIntersectionCount", 1);
		return emptyResult(diagnostics);
	}
	const intersection = intersectWindows(inherited, projected, diagnostics);
	if (!intersection) {
		record(diagnostics, "emptyExactIntersectionCount", 1);
		return emptyResult(diagnostics);
	}
	return {
		diagnostics: finishDiagnostics(diagnostics, intersection),
		kind: "visible",
		window: intersection,
	};
}

function projectAperture(
	projection: PreparedPortalProjection,
	input: PreparedPortalApertureProjectionInput,
	diagnostics: MutablePortalWindowProjectionDiagnostics,
	clipDistances: readonly HomogeneousClipDistance[],
): PortalViewWindow | null {
	const offset = createLandblockOffset(
		input.landblockCoordinates,
		projection.anchorCoordinates,
	);
	const output: Vec2[][] = [];
	record(diagnostics, "inputTriangleCount", input.aperture.indices.length / 3);
	for (const loop of input.convexVertexLoops) {
		let polygon = loop.map((vertexIndex) =>
			transformApertureVertex(
				projection.clipFromAnchor,
				input.aperture.vertices,
				vertexIndex,
				offset.x,
				offset.z,
				diagnostics,
			),
		);
		for (const distance of clipDistances) {
			polygon = clipHomogeneousPolygon(polygon, distance, diagnostics);
			if (polygon.length < 3) break;
		}
		let invalidClipVertex = false;
		for (const vertex of polygon) {
			charge(diagnostics, "homogeneousFiniteVertexTestCount", 1);
			if (
				vertex.w <= Number.EPSILON ||
				!Number.isFinite(vertex.w) ||
				!Number.isFinite(vertex.x) ||
				!Number.isFinite(vertex.y) ||
				!Number.isFinite(vertex.z)
			) {
				invalidClipVertex = true;
				break;
			}
		}
		if (polygon.length < 3 || invalidClipVertex) {
			record(diagnostics, "homogeneousRejectedTriangleCount", 1);
			continue;
		}
		const ndc = polygon.map((vertex) => {
			charge(diagnostics, "createdNdcVertexCount", 1);
			return new Vec2(vertex.x / vertex.w, vertex.y / vertex.w);
		});
		charge(diagnostics, "createdPolygonCount", 1);
		const normalized = normalizeConvexPolygon(ndc, diagnostics);
		if (!normalized) {
			record(diagnostics, "homogeneousRejectedTriangleCount", 1);
			continue;
		}
		record(diagnostics, "homogeneousClippedPolygonCount", 1);
		output.push(normalized);
	}
	return createPortalViewWindowWithDiagnostics(output, diagnostics);
}

interface MutablePortalAperturePreparationTrace {
	convexityVertexTestCount: number;
	mergeEdgePairTestCount: number;
	triangleCount: number;
}

function prepareConvexApertureVertexLoops(
	aperture: PlanarAperture,
	trace: MutablePortalAperturePreparationTrace,
): readonly (readonly number[])[] {
	const loops: number[][] = [];
	for (let index = 0; index < aperture.indices.length; index += 3) {
		loops.push([
			aperture.indices[index]!,
			aperture.indices[index + 1]!,
			aperture.indices[index + 2]!,
		]);
	}
	for (let leftIndex = 0; leftIndex < loops.length; leftIndex += 1) {
		for (let rightIndex = leftIndex + 1; rightIndex < loops.length; ) {
			const merged = mergeAdjacentApertureLoops(
				loops[leftIndex]!,
				loops[rightIndex]!,
				aperture,
				trace,
			);
			if (!merged) {
				rightIndex += 1;
				continue;
			}
			loops[leftIndex] = merged;
			loops.splice(rightIndex, 1);
			rightIndex = leftIndex + 1;
		}
	}
	return Object.freeze(loops.map((loop) => Object.freeze(loop)));
}

function mergeAdjacentApertureLoops(
	left: readonly number[],
	right: readonly number[],
	aperture: PlanarAperture,
	trace: MutablePortalAperturePreparationTrace,
): number[] | null {
	for (let leftEdge = 0; leftEdge < left.length; leftEdge += 1) {
		const leftStart = left[leftEdge]!;
		const leftEnd = left[(leftEdge + 1) % left.length]!;
		for (let rightEdge = 0; rightEdge < right.length; rightEdge += 1) {
			trace.mergeEdgePairTestCount += 1;
			if (
				leftStart !== right[(rightEdge + 1) % right.length] ||
				leftEnd !== right[rightEdge]
			) {
				continue;
			}
			const boundary = [
				...indexLoopPath(left, (leftEdge + 1) % left.length, leftEdge),
				...indexLoopPath(
					right,
					(rightEdge + 2) % right.length,
					(rightEdge + right.length - 1) % right.length,
				),
			];
			return apertureLoopIsConvex(boundary, aperture, trace) ? boundary : null;
		}
	}
	return null;
}

function indexLoopPath(
	vertices: readonly number[],
	startIndex: number,
	endIndex: number,
): number[] {
	const path: number[] = [];
	for (let index = startIndex; ; index = (index + 1) % vertices.length) {
		path.push(vertices[index]!);
		if (index === endIndex) return path;
	}
}

function apertureLoopIsConvex(
	loop: readonly number[],
	aperture: PlanarAperture,
	trace: MutablePortalAperturePreparationTrace,
): boolean {
	let orientation = 0;
	for (let index = 0; index < loop.length; index += 1) {
		trace.convexityVertexTestCount += 1;
		const first = apertureVertex(aperture.vertices, loop[index]!);
		const second = apertureVertex(
			aperture.vertices,
			loop[(index + 1) % loop.length]!,
		);
		const third = apertureVertex(
			aperture.vertices,
			loop[(index + 2) % loop.length]!,
		);
		const firstX = second[0] - first[0];
		const firstY = second[1] - first[1];
		const firstZ = second[2] - first[2];
		const secondX = third[0] - second[0];
		const secondY = third[1] - second[1];
		const secondZ = third[2] - second[2];
		const turn =
			(firstY * secondZ - firstZ * secondY) * aperture.plane.normal.x +
			(firstZ * secondX - firstX * secondZ) * aperture.plane.normal.y +
			(firstX * secondY - firstY * secondX) * aperture.plane.normal.z;
		if (Math.abs(turn) <= Number.EPSILON) continue;
		const turnOrientation = Math.sign(turn);
		if (orientation !== 0 && turnOrientation !== orientation) return false;
		orientation = turnOrientation;
	}
	return orientation !== 0;
}

function apertureVertex(
	vertices: Float32Array,
	index: number,
): readonly [number, number, number] {
	const offset = index * 3;
	return [vertices[offset]!, vertices[offset + 1]!, vertices[offset + 2]!];
}

function transformApertureVertex(
	matrix: Mat4,
	vertices: Float32Array,
	index: number,
	offsetX: number,
	offsetZ: number,
	diagnostics: MutablePortalWindowProjectionDiagnostics,
): ClipVertex {
	charge(diagnostics, "apertureVertexTransformCount", 1);
	const vertexOffset = index * 3;
	const x = vertices[vertexOffset]! + offsetX;
	const y = vertices[vertexOffset + 1]!;
	const z = vertices[vertexOffset + 2]! + offsetZ;
	charge(diagnostics, "createdClipVertexCount", 1);
	return {
		w: matrix.m14 * x + matrix.m24 * y + matrix.m34 * z + matrix.m44,
		x: matrix.m11 * x + matrix.m21 * y + matrix.m31 * z + matrix.m41,
		y: matrix.m12 * x + matrix.m22 * y + matrix.m32 * z + matrix.m42,
		z: matrix.m13 * x + matrix.m23 * y + matrix.m33 * z + matrix.m43,
	};
}

function clipHomogeneousPolygon(
	polygon: readonly ClipVertex[],
	distance: HomogeneousClipDistance,
	diagnostics: MutablePortalWindowProjectionDiagnostics,
): ClipVertex[] {
	if (polygon.length === 0) return [];
	const output: ClipVertex[] = [];
	charge(diagnostics, "createdPolygonCount", 1);
	let previous = polygon.at(-1)!;
	charge(diagnostics, "homogeneousClipVertexVisitCount", 1);
	let previousDistance = distance(previous);
	let previousInside = previousDistance >= 0;
	for (const current of polygon) {
		charge(diagnostics, "homogeneousClipVertexVisitCount", 1);
		const currentDistance = distance(current);
		const currentInside = currentDistance >= 0;
		if (currentInside !== previousInside) {
			const denominator = previousDistance - currentDistance;
			if (denominator !== 0) {
				const t = previousDistance / denominator;
				output.push(interpolateClipVertex(previous, current, t));
				charge(diagnostics, "createdClipVertexCount", 1);
			}
		}
		if (currentInside) output.push(current);
		previous = current;
		previousDistance = currentDistance;
		previousInside = currentInside;
	}
	return output;
}

function interpolateClipVertex(
	start: ClipVertex,
	end: ClipVertex,
	t: number,
): ClipVertex {
	return {
		w: start.w + (end.w - start.w) * t,
		x: start.x + (end.x - start.x) * t,
		y: start.y + (end.y - start.y) * t,
		z: start.z + (end.z - start.z) * t,
	};
}

function intersectWindows(
	left: PortalViewWindow,
	right: PortalViewWindow,
	diagnostics: MutablePortalWindowProjectionDiagnostics,
): PortalViewWindow | null {
	const output: Vec2[][] = [];
	for (const leftFragment of left.fragments) {
		const leftBounds = polygonBounds(leftFragment.vertices, diagnostics);
		for (const rightFragment of right.fragments) {
			charge(diagnostics, "exactIntersectionPairCount", 1);
			const rightBounds = polygonBounds(rightFragment.vertices, diagnostics);
			if (boundsAreDisjoint(leftBounds, rightBounds)) {
				record(diagnostics, "broadPhaseRejectedPairCount", 1);
				continue;
			}
			const intersection = intersectConvexPolygons(
				leftFragment.vertices,
				rightFragment.vertices,
				diagnostics,
			);
			if (intersection) output.push(intersection);
		}
	}
	return createPortalViewWindowWithDiagnostics(output, diagnostics);
}

function intersectConvexPolygons(
	subject: readonly Vec2[],
	clip: readonly Vec2[],
	diagnostics: MutablePortalWindowProjectionDiagnostics,
): Vec2[] | null {
	let output = subject.map((vertex) => vertex.clone());
	charge(diagnostics, "createdNdcVertexCount", output.length);
	charge(diagnostics, "createdPolygonCount", 1);
	for (let index = 0; index < clip.length; index += 1) {
		const edgeStart = clip[index]!;
		const edgeEnd = clip[(index + 1) % clip.length]!;
		output = clipNdcPolygon(output, edgeStart, edgeEnd, diagnostics);
		if (output.length < 3) return null;
	}
	return normalizeConvexPolygon(output, diagnostics);
}

function clipNdcPolygon(
	polygon: readonly Vec2[],
	edgeStart: Vec2,
	edgeEnd: Vec2,
	diagnostics: MutablePortalWindowProjectionDiagnostics,
): Vec2[] {
	if (polygon.length === 0) return [];
	const output: Vec2[] = [];
	charge(diagnostics, "createdPolygonCount", 1);
	let previous = polygon.at(-1)!;
	charge(diagnostics, "ndcClipVertexEdgeTestCount", 1);
	let previousDistance = edgeDistance(edgeStart, edgeEnd, previous);
	let previousInside = previousDistance >= -PORTAL_WINDOW_NDC_EPSILON;
	for (const current of polygon) {
		charge(diagnostics, "ndcClipVertexEdgeTestCount", 1);
		const currentDistance = edgeDistance(edgeStart, edgeEnd, current);
		const currentInside = currentDistance >= -PORTAL_WINDOW_NDC_EPSILON;
		if (currentInside !== previousInside) {
			const denominator = previousDistance - currentDistance;
			if (Math.abs(denominator) > Number.EPSILON) {
				const t = Math.min(1, Math.max(0, previousDistance / denominator));
				output.push(
					new Vec2(
						previous.x + (current.x - previous.x) * t,
						previous.y + (current.y - previous.y) * t,
					),
				);
				charge(diagnostics, "createdNdcVertexCount", 1);
			}
		}
		if (currentInside) output.push(current);
		previous = current;
		previousDistance = currentDistance;
		previousInside = currentInside;
	}
	return output;
}

function normalizeConvexPolygon(
	vertices: readonly Vec2[],
	diagnostics: MutablePortalWindowProjectionDiagnostics | null,
): Vec2[] | null {
	if (vertices.length < 3) return null;
	const deduplicated: Vec2[] = [];
	for (const vertex of vertices) {
		charge(diagnostics, "normalizationVertexVisitCount", 1);
		if (!Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) {
			throw new Error("Portal-window polygon contains a non-finite vertex.");
		}
		if (
			vertex.x < -1 - PORTAL_WINDOW_NDC_EPSILON ||
			vertex.x > 1 + PORTAL_WINDOW_NDC_EPSILON ||
			vertex.y < -1 - PORTAL_WINDOW_NDC_EPSILON ||
			vertex.y > 1 + PORTAL_WINDOW_NDC_EPSILON
		) {
			throw new Error(
				"Portal-window polygon lies outside normalized device space.",
			);
		}
		const copy = vertex.clone();
		const previous = deduplicated.at(-1);
		if (!previous || !pointsApproximatelyEqual(previous, copy)) {
			deduplicated.push(copy);
		}
	}
	if (
		deduplicated.length > 1 &&
		pointsApproximatelyEqual(deduplicated[0]!, deduplicated.at(-1)!)
	) {
		deduplicated.pop();
	}
	let changed = true;
	while (changed && deduplicated.length >= 3) {
		changed = false;
		for (let index = 0; index < deduplicated.length; index += 1) {
			charge(diagnostics, "normalizationVertexVisitCount", 1);
			const previous =
				deduplicated[(index + deduplicated.length - 1) % deduplicated.length]!;
			const current = deduplicated[index]!;
			const next = deduplicated[(index + 1) % deduplicated.length]!;
			const cross = edgeDistance(previous, current, next);
			const forwardDot =
				(current.x - previous.x) * (next.x - current.x) +
				(current.y - previous.y) * (next.y - current.y);
			if (
				Math.abs(cross) <= PORTAL_WINDOW_NDC_EPSILON &&
				forwardDot >= -PORTAL_WINDOW_NDC_EPSILON
			) {
				deduplicated.splice(index, 1);
				changed = true;
				break;
			}
		}
	}
	if (deduplicated.length < 3) return null;
	const signedArea = polygonSignedArea(deduplicated, diagnostics);
	if (
		!Number.isFinite(signedArea) ||
		Math.abs(signedArea) <=
			PORTAL_WINDOW_NDC_EPSILON * PORTAL_WINDOW_NDC_EPSILON
	) {
		return null;
	}
	if (signedArea < 0) deduplicated.reverse();
	for (let index = 0; index < deduplicated.length; index += 1) {
		charge(diagnostics, "normalizationVertexVisitCount", 1);
		const first = deduplicated[index]!;
		const second = deduplicated[(index + 1) % deduplicated.length]!;
		const third = deduplicated[(index + 2) % deduplicated.length]!;
		if (edgeDistance(first, second, third) < -PORTAL_WINDOW_NDC_EPSILON) {
			throw new Error("Portal-window fragment must be convex.");
		}
	}
	let firstIndex = 0;
	for (let index = 1; index < deduplicated.length; index += 1) {
		charge(diagnostics, "normalizationVertexVisitCount", 1);
		const candidate = deduplicated[index]!;
		const first = deduplicated[firstIndex]!;
		if (
			candidate.x < first.x ||
			(candidate.x === first.x && candidate.y < first.y)
		) {
			firstIndex = index;
		}
	}
	return [
		...deduplicated.slice(firstIndex),
		...deduplicated.slice(0, firstIndex),
	];
}

function polygonSignedArea(
	vertices: readonly Vec2[],
	diagnostics: MutablePortalWindowProjectionDiagnostics | null = null,
): number {
	let twiceArea = 0;
	for (let index = 0; index < vertices.length; index += 1) {
		charge(diagnostics, "normalizationVertexVisitCount", 1);
		const current = vertices[index]!;
		const next = vertices[(index + 1) % vertices.length]!;
		twiceArea += current.x * next.y - current.y * next.x;
	}
	return twiceArea / 2;
}

function pointInConvexPolygon(vertices: readonly Vec2[], point: Vec2): boolean {
	for (let index = 0; index < vertices.length; index += 1) {
		if (
			edgeDistance(
				vertices[index]!,
				vertices[(index + 1) % vertices.length]!,
				point,
			) < -PORTAL_WINDOW_NDC_EPSILON
		) {
			return false;
		}
	}
	return true;
}

function convexPolygonContainsPolygon(
	container: readonly Vec2[],
	candidate: readonly Vec2[],
): boolean {
	return candidate.every((vertex) => pointInConvexPolygon(container, vertex));
}

function edgeDistance(start: Vec2, end: Vec2, point: Vec2): number {
	return (
		(end.x - start.x) * (point.y - start.y) -
		(end.y - start.y) * (point.x - start.x)
	);
}

function pointsApproximatelyEqual(left: Vec2, right: Vec2): boolean {
	return (
		Math.abs(left.x - right.x) <= PORTAL_WINDOW_NDC_EPSILON &&
		Math.abs(left.y - right.y) <= PORTAL_WINDOW_NDC_EPSILON
	);
}

function polygonBounds(
	vertices: readonly Vec2[],
	diagnostics: MutablePortalWindowProjectionDiagnostics | null,
): AABB2 {
	const first = vertices[0]!;
	charge(diagnostics, "polygonBoundsVertexVisitCount", 1);
	const bounds = new AABB2(first.clone(), first.clone());
	for (let index = 1; index < vertices.length; index += 1) {
		charge(diagnostics, "polygonBoundsVertexVisitCount", 1);
		const vertex = vertices[index]!;
		bounds.min.x = Math.min(bounds.min.x, vertex.x);
		bounds.min.y = Math.min(bounds.min.y, vertex.y);
		bounds.max.x = Math.max(bounds.max.x, vertex.x);
		bounds.max.y = Math.max(bounds.max.y, vertex.y);
	}
	return bounds;
}

function boundsAreDisjoint(left: AABB2, right: AABB2): boolean {
	return (
		left.max.x < right.min.x - PORTAL_WINDOW_NDC_EPSILON ||
		right.max.x < left.min.x - PORTAL_WINDOW_NDC_EPSILON ||
		left.max.y < right.min.y - PORTAL_WINDOW_NDC_EPSILON ||
		right.max.y < left.min.y - PORTAL_WINDOW_NDC_EPSILON
	);
}

function polygonIdentity(
	vertices: readonly Vec2[],
	diagnostics: MutablePortalWindowProjectionDiagnostics | null,
): string {
	return vertices
		.map((vertex) => {
			charge(diagnostics, "polygonIdentityVertexVisitCount", 1);
			return `${Math.round(vertex.x / PORTAL_WINDOW_NDC_EPSILON)}:${Math.round(
				vertex.y / PORTAL_WINDOW_NDC_EPSILON,
			)}`;
		})
		.join("|");
}

/** Canonical numeric order avoids locale-dependent punctuation collation in proof output. */
function comparePolygonOrder(
	left: readonly Vec2[],
	right: readonly Vec2[],
	diagnostics: MutablePortalWindowProjectionDiagnostics | null,
): number {
	charge(diagnostics, "fragmentSortComparisonCount", 1);
	charge(
		diagnostics,
		"polygonIdentityVertexVisitCount",
		left.length + right.length,
	);
	const count = Math.min(left.length, right.length);
	for (let vertex = 0; vertex < count; vertex += 1) {
		const x =
			Math.round(left[vertex]!.x / PORTAL_WINDOW_NDC_EPSILON) -
			Math.round(right[vertex]!.x / PORTAL_WINDOW_NDC_EPSILON);
		if (x !== 0) return x;
		const y =
			Math.round(left[vertex]!.y / PORTAL_WINDOW_NDC_EPSILON) -
			Math.round(right[vertex]!.y / PORTAL_WINDOW_NDC_EPSILON);
		if (y !== 0) return y;
	}
	return left.length - right.length;
}

/** Reject malformed shared projection facts before traversal starts. */
export function validatePreparedPortalProjection(
	projection: PreparedPortalProjection,
): void {
	validateLandblockCoordinates(projection.anchorCoordinates);
	const matrix = projection.clipFromAnchor;
	if (
		!Number.isFinite(matrix.m11) ||
		!Number.isFinite(matrix.m12) ||
		!Number.isFinite(matrix.m13) ||
		!Number.isFinite(matrix.m14) ||
		!Number.isFinite(matrix.m21) ||
		!Number.isFinite(matrix.m22) ||
		!Number.isFinite(matrix.m23) ||
		!Number.isFinite(matrix.m24) ||
		!Number.isFinite(matrix.m31) ||
		!Number.isFinite(matrix.m32) ||
		!Number.isFinite(matrix.m33) ||
		!Number.isFinite(matrix.m34) ||
		!Number.isFinite(matrix.m41) ||
		!Number.isFinite(matrix.m42) ||
		!Number.isFinite(matrix.m43) ||
		!Number.isFinite(matrix.m44)
	) {
		throw new Error("Portal projection matrix must be finite.");
	}
}

function validateLandblockCoordinates(coordinates: LandblockCoordinates): void {
	if (
		!Number.isInteger(coordinates.x) ||
		!Number.isInteger(coordinates.y) ||
		coordinates.x < 0 ||
		coordinates.x > 0xff ||
		coordinates.y < 0 ||
		coordinates.y > 0xff
	) {
		throw new Error("Portal projection landblock coordinates are invalid.");
	}
}

function createDiagnostics(
	meter: PortalWindowPrimitiveMeter | null,
): MutablePortalWindowProjectionDiagnostics {
	return {
		apertureVertexTransformCount: 0,
		broadPhaseRejectedPairCount: 0,
		createdClipVertexCount: 0,
		createdNdcVertexCount: 0,
		createdPolygonCount: 0,
		emptyExactIntersectionCount: 0,
		exactIntersectionPairCount: 0,
		homogeneousClippedPolygonCount: 0,
		homogeneousClipVertexVisitCount: 0,
		homogeneousFiniteVertexTestCount: 0,
		homogeneousRejectedTriangleCount: 0,
		inputTriangleCount: 0,
		fragmentSortComparisonCount: 0,
		mergeBoundaryVertexVisitCount: 0,
		mergeConvexityVertexTestCount: 0,
		mergeEdgePairTestCount: 0,
		meter,
		ndcClipVertexEdgeTestCount: 0,
		normalizationVertexVisitCount: 0,
		polygonBoundsVertexVisitCount: 0,
		polygonIdentityVertexVisitCount: 0,
	};
}

function charge(
	diagnostics: MutablePortalWindowProjectionDiagnostics | null,
	key: PortalWindowPrimitiveKind,
	count: number,
): void {
	if (!Number.isSafeInteger(count) || count <= 0) {
		throw new Error(
			`Portal projection counter ${key} received invalid count ${count}.`,
		);
	}
	if (!diagnostics) return;
	diagnostics.meter?.consume(key, count);
	diagnostics[key] += count;
}

function record(
	diagnostics: MutablePortalWindowProjectionDiagnostics,
	key: Exclude<keyof MutablePortalWindowProjectionDiagnostics, "meter">,
	count: number,
): void {
	if (!Number.isSafeInteger(count) || count <= 0) {
		throw new Error(
			`Portal projection counter ${key} received invalid count ${count}.`,
		);
	}
	diagnostics[key] += count;
}

function finishDiagnostics(
	diagnostics: MutablePortalWindowProjectionDiagnostics,
	window: PortalViewWindow | null,
): PortalWindowProjectionDiagnostics {
	return {
		apertureVertexTransformCount: diagnostics.apertureVertexTransformCount,
		broadPhaseRejectedPairCount: diagnostics.broadPhaseRejectedPairCount,
		createdClipVertexCount: diagnostics.createdClipVertexCount,
		createdNdcVertexCount: diagnostics.createdNdcVertexCount,
		createdPolygonCount: diagnostics.createdPolygonCount,
		emptyExactIntersectionCount: diagnostics.emptyExactIntersectionCount,
		exactIntersectionPairCount: diagnostics.exactIntersectionPairCount,
		homogeneousClippedPolygonCount: diagnostics.homogeneousClippedPolygonCount,
		homogeneousClipVertexVisitCount:
			diagnostics.homogeneousClipVertexVisitCount,
		homogeneousFiniteVertexTestCount:
			diagnostics.homogeneousFiniteVertexTestCount,
		homogeneousRejectedTriangleCount:
			diagnostics.homogeneousRejectedTriangleCount,
		inputTriangleCount: diagnostics.inputTriangleCount,
		fragmentSortComparisonCount: diagnostics.fragmentSortComparisonCount,
		mergeBoundaryVertexVisitCount: diagnostics.mergeBoundaryVertexVisitCount,
		mergeConvexityVertexTestCount: diagnostics.mergeConvexityVertexTestCount,
		mergeEdgePairTestCount: diagnostics.mergeEdgePairTestCount,
		ndcClipVertexEdgeTestCount: diagnostics.ndcClipVertexEdgeTestCount,
		normalizationVertexVisitCount: diagnostics.normalizationVertexVisitCount,
		outputFragmentCount: window?.fragments.length ?? 0,
		outputVertexCount:
			window?.fragments.reduce(
				(total, fragment) => total + fragment.vertices.length,
				0,
			) ?? 0,
		polygonBoundsVertexVisitCount: diagnostics.polygonBoundsVertexVisitCount,
		polygonIdentityVertexVisitCount:
			diagnostics.polygonIdentityVertexVisitCount,
	};
}

function emptyResult(
	diagnostics: MutablePortalWindowProjectionDiagnostics,
): PortalWindowProjectionResult {
	return {
		diagnostics: finishDiagnostics(diagnostics, null),
		kind: "empty",
	};
}
