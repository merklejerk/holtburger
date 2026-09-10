import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import type { PlanarAperturePlane } from "../scene/planar-aperture";
import {
	NEAR_CLIP_CONTACT_EPSILON,
	type CameraNearClipPrimitiveKind,
	type CameraNearClipPrimitiveMeter,
	type CameraNearClipVolume,
} from "./portal-near-plane";
import {
	PORTAL_WINDOW_NDC_EPSILON,
	type PortalWindowPrimitiveKind,
	type PortalWindowPrimitiveMeter,
	type PreparedPortalApertureProjectionInput,
	type PreparedPortalProjection,
} from "./portal-view-window";

/** Sentinel for absent rectangle handles in fixed traversal storage. */
export const NO_PORTAL_ARENA_WINDOW = 0xffff_ffff;
/** Full homogeneous frustum; near-ray projection substitutes an eye-side plane. */
export const PORTAL_HOMOGENEOUS_CLIP_PLANE_COUNT = 6;

/** Fixed topology-event storage; route depth no longer grows polygon scratch requirements. */
export interface PortalWindowArenaCapacity {
	/** Maximum authored/reciprocal aperture vertices. */
	readonly maximumApertureVertexCount: number;
	/** One convex aperture loop plus homogeneous clipping planes. */
	readonly maximumVerticesPerFragment: number;
	/** Root plus append-only coverage versions, bounded by the work queue. */
	readonly maximumWindowCount: number;
}

/** Actual executed work, including constant-time rectangle and cache operations. */
export interface PortalTraversalMeter {
	consume(
		kind:
			| PortalWindowPrimitiveKind
			| CameraNearClipPrimitiveKind
			| "rectangleIntersectionCount"
			| "rectangleCoverageTestCount"
			| "rectangleUnionCount"
			| "rectangleWriteCount"
			| "apertureCacheLookupCount"
			| "apertureCacheWriteCount",
		count: number,
	): void;
}

/** A declined frontier can safely restore rectangle handles after any capacity cutoff. */
export class PortalWindowArenaCapacityExceeded extends Error {
	constructor(readonly dimension: keyof PortalWindowArenaCapacity) {
		super(`Portal window arena exhausted ${dimension}.`);
	}
}
function capacityExceeded(
	dimension: keyof PortalWindowArenaCapacity,
): PortalWindowArenaCapacityExceeded {
	return new PortalWindowArenaCapacityExceeded(dimension);
}

/** Allocation-free rectangular propagation with per-view, per-crossing geometry reuse. */
export class PortalWindowArena {
	readonly #capacity: PortalWindowArenaCapacity;
	readonly #rectangles: Float64Array;
	readonly #nearStates: Uint8Array;
	readonly #projectionStates: Uint8Array;
	readonly #projectedBounds: Float64Array;
	readonly #bounds = new Float64Array(4);
	readonly #apertureX: Float64Array;
	readonly #apertureY: Float64Array;
	readonly #apertureZ: Float64Array;
	readonly #clipAx: Float64Array;
	readonly #clipAy: Float64Array;
	readonly #clipAz: Float64Array;
	readonly #clipAw: Float64Array;
	readonly #clipBx: Float64Array;
	readonly #clipBy: Float64Array;
	readonly #clipBz: Float64Array;
	readonly #clipBw: Float64Array;
	#windowCount = 0;
	#admittedCoverage = NO_PORTAL_ARENA_WINDOW;
	/** Topology storage and frame work counters, sampled by the culler. */
	readonly trace: {
		capacityBytes: number;
		projectionCacheCapacityBytes: number;
		projectionCacheHitCount: number;
		nearClipCacheHitCount: number;
		projectedApertureCount: number;
		windowHighWaterCount: number;
	};

	constructor(capacity: PortalWindowArenaCapacity, crossingCount: number) {
		for (const [dimension, value] of Object.entries(capacity))
			if (!Number.isSafeInteger(value) || value < 1)
				throw new Error(`Invalid portal rectangle capacity ${dimension}.`);
		if (!Number.isSafeInteger(crossingCount) || crossingCount < 0)
			throw new Error("Invalid portal crossing cache size.");
		this.#capacity = capacity;
		this.#rectangles = new Float64Array(capacity.maximumWindowCount * 4);
		this.#nearStates = new Uint8Array(crossingCount);
		this.#projectionStates = new Uint8Array(crossingCount * 2);
		this.#projectedBounds = new Float64Array(crossingCount * 8);
		this.#apertureX = new Float64Array(capacity.maximumApertureVertexCount);
		this.#apertureY = new Float64Array(capacity.maximumApertureVertexCount);
		this.#apertureZ = new Float64Array(capacity.maximumApertureVertexCount);
		this.#clipAx = new Float64Array(capacity.maximumVerticesPerFragment);
		this.#clipAy = new Float64Array(capacity.maximumVerticesPerFragment);
		this.#clipAz = new Float64Array(capacity.maximumVerticesPerFragment);
		this.#clipAw = new Float64Array(capacity.maximumVerticesPerFragment);
		this.#clipBx = new Float64Array(capacity.maximumVerticesPerFragment);
		this.#clipBy = new Float64Array(capacity.maximumVerticesPerFragment);
		this.#clipBz = new Float64Array(capacity.maximumVerticesPerFragment);
		this.#clipBw = new Float64Array(capacity.maximumVerticesPerFragment);
		const projectionCacheCapacityBytes =
			this.#nearStates.byteLength +
			this.#projectionStates.byteLength +
			this.#projectedBounds.byteLength;
		this.trace = {
			capacityBytes:
				projectionCacheCapacityBytes +
				this.#rectangles.byteLength +
				this.#bounds.byteLength +
				(3 * capacity.maximumApertureVertexCount +
					8 * capacity.maximumVerticesPerFragment) *
					Float64Array.BYTES_PER_ELEMENT,
			projectionCacheCapacityBytes,
			projectionCacheHitCount: 0,
			nearClipCacheHitCount: 0,
			projectedApertureCount: 0,
			windowHighWaterCount: 0,
		};
	}

	/** Propagate the entire enlarged rectangle, including gaps introduced by enclosing unions. */
	get admittedCoverage(): number {
		return this.#admittedCoverage;
	}
	checkpoint(): number {
		return this.#windowCount;
	}
	reset(): number {
		this.#windowCount = 1;
		this.#rectangles[0] = this.#rectangles[1] = -1;
		this.#rectangles[2] = this.#rectangles[3] = 1;
		this.#nearStates.fill(0);
		this.#projectionStates.fill(0);
		this.#admittedCoverage = NO_PORTAL_ARENA_WINDOW;
		this.trace.projectionCacheHitCount = 0;
		this.trace.nearClipCacheHitCount = 0;
		this.trace.projectedApertureCount = 0;
		this.trace.windowHighWaterCount = 1;
		return 0;
	}
	rollback(checkpoint: number): void {
		if (
			!Number.isInteger(checkpoint) ||
			checkpoint < 1 ||
			checkpoint > this.#windowCount
		)
			throw new Error("Invalid portal rectangle checkpoint.");
		this.#windowCount = checkpoint;
		this.#admittedCoverage = NO_PORTAL_ARENA_WINDOW;
	}
	apertureIntersectsNearClip(
		volume: CameraNearClipVolume,
		aperture: PreparedPortalApertureProjectionInput,
		projection: PreparedPortalProjection,
		meter: PortalTraversalMeter,
		crossingId: number,
	): boolean {
		this.#requireCrossing(crossingId);
		meter.consume("apertureCacheLookupCount", 1);
		const state = this.#nearStates[crossingId]!;
		if (state !== 0) {
			this.trace.nearClipCacheHitCount += 1;
			return state === 2;
		}
		const result = this.#classifyNearClip(volume, aperture, projection, meter);
		meter.consume("apertureCacheWriteCount", 1);
		this.#nearStates[crossingId] = result ? 2 : 1;
		return result;
	}
	projectAndAdmit(
		inherited: number,
		coverage: number,
		projection: PreparedPortalProjection,
		aperture: PreparedPortalApertureProjectionInput,
		nearClipRays: boolean,
		crossingId: number,
		minimumNdcArea: number,
		meter: PortalTraversalMeter,
	): boolean {
		this.#requireWindow(inherited);
		this.#requireCrossing(crossingId);
		if (coverage !== NO_PORTAL_ARENA_WINDOW) this.#requireWindow(coverage);
		this.#admittedCoverage = NO_PORTAL_ARENA_WINDOW;
		const slot = crossingId * 2 + (nearClipRays ? 1 : 0);
		const offset = slot * 4;
		meter.consume("apertureCacheLookupCount", 1);
		if (this.#projectionStates[slot] === 0) {
			this.#projectAperture(projection, aperture, nearClipRays, meter);
			meter.consume("apertureCacheWriteCount", 5);
			this.#projectedBounds.set(this.#bounds, offset);
			this.#projectionStates[slot] = 1;
			this.trace.projectedApertureCount += 1;
		} else this.trace.projectionCacheHitCount += 1;
		meter.consume("rectangleIntersectionCount", 4);
		const parent = inherited * 4;
		let left = Math.max(
			this.#rectangles[parent]!,
			this.#projectedBounds[offset]!,
		);
		let bottom = Math.max(
			this.#rectangles[parent + 1]!,
			this.#projectedBounds[offset + 1]!,
		);
		let right = Math.min(
			this.#rectangles[parent + 2]!,
			this.#projectedBounds[offset + 2]!,
		);
		let top = Math.min(
			this.#rectangles[parent + 3]!,
			this.#projectedBounds[offset + 3]!,
		);
		if (
			left >= right ||
			bottom >= top ||
			(right - left) * (top - bottom) < minimumNdcArea
		)
			return false;
		if (coverage !== NO_PORTAL_ARENA_WINDOW) {
			const previous = coverage * 4;
			meter.consume("rectangleCoverageTestCount", 4);
			if (
				left >= this.#rectangles[previous]! &&
				bottom >= this.#rectangles[previous + 1]! &&
				right <= this.#rectangles[previous + 2]! &&
				top <= this.#rectangles[previous + 3]!
			)
				return false;
			meter.consume("rectangleUnionCount", 4);
			left = Math.min(left, this.#rectangles[previous]!);
			bottom = Math.min(bottom, this.#rectangles[previous + 1]!);
			right = Math.max(right, this.#rectangles[previous + 2]!);
			top = Math.max(top, this.#rectangles[previous + 3]!);
		}
		if (this.#windowCount >= this.#capacity.maximumWindowCount)
			throw capacityExceeded("maximumWindowCount");
		meter.consume("rectangleWriteCount", 4);
		const target = this.#windowCount * 4;
		this.#rectangles[target] = left;
		this.#rectangles[target + 1] = bottom;
		this.#rectangles[target + 2] = right;
		this.#rectangles[target + 3] = top;
		this.#admittedCoverage = this.#windowCount++;
		this.trace.windowHighWaterCount = Math.max(
			this.trace.windowHighWaterCount,
			this.#windowCount,
		);
		return true;
	}
	/** Read the stored rectangle bound without constructing a frame record. */
	minimumNdcX(window: number): number {
		this.#requireWindow(window);
		return this.#rectangles[window * 4 + 0]!;
	}
	/** Read the stored rectangle bound without constructing a frame record. */
	minimumNdcY(window: number): number {
		this.#requireWindow(window);
		return this.#rectangles[window * 4 + 1]!;
	}
	/** Read the stored rectangle bound without constructing a frame record. */
	maximumNdcX(window: number): number {
		this.#requireWindow(window);
		return this.#rectangles[window * 4 + 2]!;
	}
	/** Read the stored rectangle bound without constructing a frame record. */
	maximumNdcY(window: number): number {
		this.#requireWindow(window);
		return this.#rectangles[window * 4 + 3]!;
	}
	#requireWindow(window: number): void {
		if (!Number.isInteger(window) || window < 0 || window >= this.#windowCount)
			throw new Error(`Unavailable portal rectangle ${window}.`);
	}
	#requireCrossing(crossing: number): void {
		if (
			!Number.isInteger(crossing) ||
			crossing < 0 ||
			crossing >= this.#nearStates.length
		)
			throw new Error(`Unavailable portal aperture cache ${crossing}.`);
	}
	#classifyNearClip(
		volume: CameraNearClipVolume,
		aperture: PreparedPortalApertureProjectionInput,
		projection: PreparedPortalProjection,
		meter: CameraNearClipPrimitiveMeter | null,
	): boolean {
		const vertexCount = aperture.aperture.vertices.length / 3;
		if (vertexCount > this.#capacity.maximumApertureVertexCount) {
			throw capacityExceeded("maximumApertureVertexCount");
		}
		const offsetX =
			(aperture.landblockCoordinates.x - projection.anchorCoordinates.x) *
			OUTDOOR_LANDBLOCK_WORLD_SIZE;
		const offsetZ =
			-(aperture.landblockCoordinates.y - projection.anchorCoordinates.y) *
			OUTDOOR_LANDBLOCK_WORLD_SIZE;
		for (let vertex = 0; vertex < vertexCount; vertex += 1) {
			const source = vertex * 3;
			chargeNear(meter, "apertureVertexReadCount", 1);
			chargeNear(meter, "createdVertexCount", 1);
			this.#apertureX[vertex] = aperture.aperture.vertices[source]! + offsetX;
			this.#apertureY[vertex] = aperture.aperture.vertices[source + 1]!;
			this.#apertureZ[vertex] =
				aperture.aperture.vertices[source + 2]! + offsetZ;
		}
		const indices = aperture.aperture.indices;
		for (let index = 0; index < indices.length; index += 3) {
			chargeNear(meter, "triangleTestCount", 1);
			chargeNear(meter, "createdPolygonCount", 1);
			for (let vertex = 0; vertex < 3; vertex += 1) {
				const source = indices[index + vertex]!;
				this.#clipAx[vertex] = this.#apertureX[source]!;
				this.#clipAy[vertex] = this.#apertureY[source]!;
				this.#clipAz[vertex] = this.#apertureZ[source]!;
			}
			let activeX = this.#clipAx;
			let activeY = this.#clipAy;
			let activeZ = this.#clipAz;
			let scratchX = this.#clipBx;
			let scratchY = this.#clipBy;
			let scratchZ = this.#clipBz;
			let count = 3;
			for (
				let planeIndex = 0;
				planeIndex < volume.clippingPlanes.length;
				planeIndex += 1
			) {
				const plane = volume.clippingPlanes[planeIndex]!;
				count = clipSpatialPolygon(
					activeX,
					activeY,
					activeZ,
					count,
					plane,
					scratchX,
					scratchY,
					scratchZ,
					meter,
				);
				const previousX = activeX;
				const previousY = activeY;
				const previousZ = activeZ;
				activeX = scratchX;
				activeY = scratchY;
				activeZ = scratchZ;
				scratchX = previousX;
				scratchY = previousY;
				scratchZ = previousZ;
				if (count === 0) break;
			}
			if (count > 0) return true;
		}
		return false;
	}
	#projectAperture(
		projection: PreparedPortalProjection,
		input: PreparedPortalApertureProjectionInput,
		nearClipRays: boolean,
		meter: PortalWindowPrimitiveMeter | null,
	): void {
		this.#bounds.fill(Infinity, 0, 2);
		this.#bounds.fill(-Infinity, 2);
		const offsetX =
			(input.landblockCoordinates.x - projection.anchorCoordinates.x) *
			OUTDOOR_LANDBLOCK_WORLD_SIZE;
		const offsetZ =
			-(input.landblockCoordinates.y - projection.anchorCoordinates.y) *
			OUTDOOR_LANDBLOCK_WORLD_SIZE;
		const matrix = projection.clipFromAnchor;
		for (
			let loopIndex = 0;
			loopIndex < input.convexVertexLoops.length;
			loopIndex += 1
		) {
			const loop = input.convexVertexLoops[loopIndex]!;
			ensureFragmentCapacity(
				loop.length,
				this.#capacity.maximumVerticesPerFragment,
			);
			let count = loop.length;
			for (let ordinal = 0; ordinal < loop.length; ordinal += 1) {
				const source = loop[ordinal]! * 3;
				const x = input.aperture.vertices[source]! + offsetX;
				const y = input.aperture.vertices[source + 1]!;
				const z = input.aperture.vertices[source + 2]! + offsetZ;
				charge(meter, "apertureVertexTransformCount", 1);
				charge(meter, "createdClipVertexCount", 1);
				this.#clipAx[ordinal] =
					matrix.m11 * x + matrix.m21 * y + matrix.m31 * z + matrix.m41;
				this.#clipAy[ordinal] =
					matrix.m12 * x + matrix.m22 * y + matrix.m32 * z + matrix.m42;
				this.#clipAz[ordinal] =
					matrix.m13 * x + matrix.m23 * y + matrix.m33 * z + matrix.m43;
				this.#clipAw[ordinal] =
					matrix.m14 * x + matrix.m24 * y + matrix.m34 * z + matrix.m44;
			}
			let activeX = this.#clipAx;
			let activeY = this.#clipAy;
			let activeZ = this.#clipAz;
			let activeW = this.#clipAw;
			let scratchX = this.#clipBx;
			let scratchY = this.#clipBy;
			let scratchZ = this.#clipBz;
			let scratchW = this.#clipBw;
			const planeCount = nearClipRays
				? PORTAL_HOMOGENEOUS_CLIP_PLANE_COUNT - 1
				: PORTAL_HOMOGENEOUS_CLIP_PLANE_COUNT;
			for (let plane = 0; plane < planeCount && count >= 3; plane += 1) {
				count = clipHomogeneousPolygon(
					activeX,
					activeY,
					activeZ,
					activeW,
					count,
					plane,
					nearClipRays,
					scratchX,
					scratchY,
					scratchZ,
					scratchW,
					meter,
				);
				const previousX = activeX;
				const previousY = activeY;
				const previousZ = activeZ;
				const previousW = activeW;
				activeX = scratchX;
				activeY = scratchY;
				activeZ = scratchZ;
				activeW = scratchW;
				scratchX = previousX;
				scratchY = previousY;
				scratchZ = previousZ;
				scratchW = previousW;
			}
			if (count < 3) continue;
			let finite = true;
			for (let vertex = 0; vertex < count; vertex += 1) {
				charge(meter, "homogeneousFiniteVertexTestCount", 1);
				if (
					activeW[vertex]! <= Number.EPSILON ||
					!Number.isFinite(activeW[vertex]) ||
					!Number.isFinite(activeX[vertex]) ||
					!Number.isFinite(activeY[vertex]) ||
					!Number.isFinite(activeZ[vertex])
				) {
					finite = false;
					break;
				}
			}
			if (!finite) continue;
			charge(meter, "polygonBoundsVertexVisitCount", count);
			for (let vertex = 0; vertex < count; vertex += 1) {
				const x = activeX[vertex]! / activeW[vertex]!;
				const y = activeY[vertex]! / activeW[vertex]!;
				this.#bounds[0] = Math.min(this.#bounds[0]!, x);
				this.#bounds[1] = Math.min(this.#bounds[1]!, y);
				this.#bounds[2] = Math.max(this.#bounds[2]!, x);
				this.#bounds[3] = Math.max(this.#bounds[3]!, y);
			}
		}
	}
}
function clipHomogeneousPolygon(
	x: Float64Array,
	y: Float64Array,
	z: Float64Array,
	w: Float64Array,
	count: number,
	plane: number,
	nearClipRays: boolean,
	outputX: Float64Array,
	outputY: Float64Array,
	outputZ: Float64Array,
	outputW: Float64Array,
	meter: PortalWindowPrimitiveMeter | null,
): number {
	charge(meter, "createdPolygonCount", 1);
	let outputCount = 0;
	let previous = count - 1;
	charge(meter, "homogeneousClipVertexVisitCount", 1);
	let previousDistance = clipDistance(
		x[previous]!,
		y[previous]!,
		z[previous]!,
		w[previous]!,
		plane,
		nearClipRays,
	);
	let previousInside = previousDistance >= 0;
	for (let current = 0; current < count; current += 1) {
		charge(meter, "homogeneousClipVertexVisitCount", 1);
		const currentDistance = clipDistance(
			x[current]!,
			y[current]!,
			z[current]!,
			w[current]!,
			plane,
			nearClipRays,
		);
		const currentInside = currentDistance >= 0;
		if (currentInside !== previousInside) {
			const denominator = previousDistance - currentDistance;
			if (denominator !== 0) {
				ensureOutputVertex(outputCount, outputX.length);
				const fraction = previousDistance / denominator;
				outputX[outputCount] =
					x[previous]! + (x[current]! - x[previous]!) * fraction;
				outputY[outputCount] =
					y[previous]! + (y[current]! - y[previous]!) * fraction;
				outputZ[outputCount] =
					z[previous]! + (z[current]! - z[previous]!) * fraction;
				outputW[outputCount] =
					w[previous]! + (w[current]! - w[previous]!) * fraction;
				outputCount += 1;
				charge(meter, "createdClipVertexCount", 1);
			}
		}
		if (currentInside) {
			ensureOutputVertex(outputCount, outputX.length);
			outputX[outputCount] = x[current]!;
			outputY[outputCount] = y[current]!;
			outputZ[outputCount] = z[current]!;
			outputW[outputCount] = w[current]!;
			outputCount += 1;
		}
		previous = current;
		previousDistance = currentDistance;
		previousInside = currentInside;
	}
	return outputCount;
}

function clipSpatialPolygon(
	x: Float64Array,
	y: Float64Array,
	z: Float64Array,
	count: number,
	plane: PlanarAperturePlane,
	outputX: Float64Array,
	outputY: Float64Array,
	outputZ: Float64Array,
	meter: CameraNearClipPrimitiveMeter | null,
): number {
	chargeNear(meter, "createdPolygonCount", 1);
	let outputCount = 0;
	let previous = count - 1;
	chargeNear(meter, "vertexPlaneTestCount", 1);
	let previousDistance = spatialPlaneDistance(
		plane,
		x[previous]!,
		y[previous]!,
		z[previous]!,
	);
	for (let current = 0; current < count; current += 1) {
		chargeNear(meter, "vertexPlaneTestCount", 1);
		const currentDistance = spatialPlaneDistance(
			plane,
			x[current]!,
			y[current]!,
			z[current]!,
		);
		const previousInside = previousDistance <= NEAR_CLIP_CONTACT_EPSILON;
		const currentInside = currentDistance <= NEAR_CLIP_CONTACT_EPSILON;
		if (previousInside !== currentInside) {
			ensureOutputVertex(outputCount, outputX.length);
			const fraction =
				(previousDistance - NEAR_CLIP_CONTACT_EPSILON) /
				(previousDistance - currentDistance);
			outputX[outputCount] =
				x[previous]! + (x[current]! - x[previous]!) * fraction;
			outputY[outputCount] =
				y[previous]! + (y[current]! - y[previous]!) * fraction;
			outputZ[outputCount] =
				z[previous]! + (z[current]! - z[previous]!) * fraction;
			outputCount += 1;
			chargeNear(meter, "createdVertexCount", 1);
		}
		if (currentInside) {
			ensureOutputVertex(outputCount, outputX.length);
			outputX[outputCount] = x[current]!;
			outputY[outputCount] = y[current]!;
			outputZ[outputCount] = z[current]!;
			outputCount += 1;
		}
		previous = current;
		previousDistance = currentDistance;
	}
	return outputCount;
}

function spatialPlaneDistance(
	plane: PlanarAperturePlane,
	x: number,
	y: number,
	z: number,
): number {
	return plane.normal.x * x + plane.normal.y * y + plane.normal.z * z + plane.d;
}

function clipDistance(
	x: number,
	y: number,
	z: number,
	w: number,
	plane: number,
	nearClipRays: boolean,
): number {
	if (nearClipRays) {
		if (plane === 0) return w - PORTAL_WINDOW_NDC_EPSILON;
		plane -= 1;
	}
	switch (plane) {
		case 0:
			return x + w;
		case 1:
			return w - x;
		case 2:
			return y + w;
		case 3:
			return w - y;
		case 4:
			return z + w;
		case 5:
			return w - z;
		default:
			throw new Error(`Portal homogeneous clip plane ${plane} is unavailable.`);
	}
}
function ensureFragmentCapacity(count: number, capacity: number): void {
	if (count > capacity) {
		throw capacityExceeded("maximumVerticesPerFragment");
	}
}

function ensureOutputVertex(index: number, capacity: number): void {
	if (index >= capacity) {
		throw capacityExceeded("maximumVerticesPerFragment");
	}
}

function charge(
	meter: PortalWindowPrimitiveMeter | null,
	kind: PortalWindowPrimitiveKind,
	count: number,
): void {
	if (count <= 0) return;
	meter?.consume(kind, count);
}

function chargeNear(
	meter: CameraNearClipPrimitiveMeter | null,
	kind: CameraNearClipPrimitiveKind,
	count: number,
): void {
	if (count <= 0) return;
	meter?.consume(kind, count);
}
