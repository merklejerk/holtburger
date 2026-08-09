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

/** Sentinel stored in integer queues when no committed arena window exists. */
export const NO_PORTAL_ARENA_WINDOW = 0xffff_ffff;
/** Full WebGL homogeneous clip volume: left, right, bottom, top, near, and far. */
export const PORTAL_HOMOGENEOUS_CLIP_PLANE_COUNT = 6;
/** Four corners in the initial full-screen NDC window. */
export const PORTAL_ROOT_WINDOW_VERTEX_COUNT = 4;

/** Fixed backing-store dimensions selected at a topology/capacity event. */
export interface PortalWindowArenaCapacity {
	/** Largest authored aperture vertex table classified against the near-clip volume. */
	readonly maximumApertureVertexCount: number;
	/** Committed fragments retained across every live coverage/delta window. */
	readonly maximumFragmentCount: number;
	/** Temporary fragments retained by each of the two operation builders. */
	readonly maximumTemporaryFragmentCount: number;
	/** Committed NDC vertices retained across every live window. */
	readonly maximumVertexCount: number;
	/** Temporary NDC vertices retained independently by each operation builder. */
	readonly maximumTemporaryVertexCount: number;
	/** Largest intermediate convex polygon accepted by homogeneous or NDC clipping. */
	readonly maximumVerticesPerFragment: number;
	/** Root plus every delta and replacement coverage window committed in one frame. */
	readonly maximumWindowCount: number;
}

/** Arena exhaustion is handled only at the culler's complete-frontier transaction boundary. */
export class PortalWindowArenaCapacityExceeded extends Error {
	/** Capacity dimension whose fixed backing store could not accept the operation. */
	constructor(readonly dimension: keyof PortalWindowArenaCapacity) {
		super(`Portal window arena exhausted ${dimension}.`);
	}
}

function capacityExceeded(
	dimension: keyof PortalWindowArenaCapacity,
): PortalWindowArenaCapacityExceeded {
	// Capacity rejection is exceptional; a fresh error preserves the actual failing stack.
	return new PortalWindowArenaCapacityExceeded(dimension);
}

/** Allocation-free view over one committed arena window. */
export interface PortalArenaWindowReader {
	fragmentCount(window: number): number;
	fragmentVertexCount(window: number, fragment: number): number;
	vertexX(window: number, fragment: number, vertex: number): number;
	vertexY(window: number, fragment: number, vertex: number): number;
}

/** High-water and backing-store facts updated without producing frame records. */
export interface PortalWindowArenaTrace {
	readonly capacityBytes: number;
	readonly fragmentHighWaterCount: number;
	readonly temporaryFragmentHighWaterCount: number;
	readonly temporaryVertexHighWaterCount: number;
	readonly vertexHighWaterCount: number;
	readonly windowHighWaterCount: number;
}

interface MutablePortalWindowArenaTrace {
	capacityBytes: number;
	fragmentHighWaterCount: number;
	temporaryFragmentHighWaterCount: number;
	temporaryVertexHighWaterCount: number;
	vertexHighWaterCount: number;
	windowHighWaterCount: number;
}

/**
 * Append-only normalized window storage plus reusable output-to-target projection builders.
 *
 * Handles are valid only until `reset` or a rollback crossing their commit point. Callers retain
 * integers, never arrays or fragment objects.
 */
export class PortalWindowArena implements PortalArenaWindowReader {
	readonly #builderA: PolygonBuilder;
	readonly #builderB: PolygonBuilder;
	readonly #apertureX: Float64Array;
	readonly #apertureY: Float64Array;
	readonly #apertureZ: Float64Array;
	readonly #boundsScratch: Float64Array;
	readonly #capacity: PortalWindowArenaCapacity;
	readonly #clipAw: Float64Array;
	readonly #clipAx: Float64Array;
	readonly #clipAy: Float64Array;
	readonly #clipAz: Float64Array;
	readonly #clipBw: Float64Array;
	readonly #clipBx: Float64Array;
	readonly #clipBy: Float64Array;
	readonly #clipBz: Float64Array;
	readonly #fragmentFirstVertex: Uint32Array;
	readonly #fragmentVertexCount: Uint32Array;
	readonly #ndcAx: Float64Array;
	readonly #ndcAy: Float64Array;
	readonly #ndcBx: Float64Array;
	readonly #ndcBy: Float64Array;
	readonly #trace: MutablePortalWindowArenaTrace;
	readonly #vertexX: Float64Array;
	readonly #vertexY: Float64Array;
	readonly #windowFirstFragment: Uint32Array;
	readonly #windowFragmentCount: Uint32Array;
	#admittedCoverage = NO_PORTAL_ARENA_WINDOW;
	#admittedDelta = NO_PORTAL_ARENA_WINDOW;
	#fragmentCount = 0;
	#vertexCount = 0;
	#windowCount = 0;

	constructor(capacity: PortalWindowArenaCapacity) {
		validateCapacity(capacity);
		this.#capacity = capacity;
		this.#apertureX = new Float64Array(capacity.maximumApertureVertexCount);
		this.#apertureY = new Float64Array(capacity.maximumApertureVertexCount);
		this.#apertureZ = new Float64Array(capacity.maximumApertureVertexCount);
		this.#windowFirstFragment = new Uint32Array(capacity.maximumWindowCount);
		this.#windowFragmentCount = new Uint32Array(capacity.maximumWindowCount);
		this.#fragmentFirstVertex = new Uint32Array(capacity.maximumFragmentCount);
		this.#fragmentVertexCount = new Uint32Array(capacity.maximumFragmentCount);
		this.#vertexX = new Float64Array(capacity.maximumVertexCount);
		this.#vertexY = new Float64Array(capacity.maximumVertexCount);
		this.#builderA = new PolygonBuilder(capacity);
		this.#builderB = new PolygonBuilder(capacity);
		this.#boundsScratch = new Float64Array(8);
		this.#clipAw = new Float64Array(capacity.maximumVerticesPerFragment);
		this.#clipAx = new Float64Array(capacity.maximumVerticesPerFragment);
		this.#clipAy = new Float64Array(capacity.maximumVerticesPerFragment);
		this.#clipAz = new Float64Array(capacity.maximumVerticesPerFragment);
		this.#clipBw = new Float64Array(capacity.maximumVerticesPerFragment);
		this.#clipBx = new Float64Array(capacity.maximumVerticesPerFragment);
		this.#clipBy = new Float64Array(capacity.maximumVerticesPerFragment);
		this.#clipBz = new Float64Array(capacity.maximumVerticesPerFragment);
		this.#ndcAx = new Float64Array(capacity.maximumVerticesPerFragment);
		this.#ndcAy = new Float64Array(capacity.maximumVerticesPerFragment);
		this.#ndcBx = new Float64Array(capacity.maximumVerticesPerFragment);
		this.#ndcBy = new Float64Array(capacity.maximumVerticesPerFragment);
		this.#trace = {
			capacityBytes:
				typedArrayBytes([
					this.#apertureX,
					this.#apertureY,
					this.#apertureZ,
					this.#boundsScratch,
					this.#windowFirstFragment,
					this.#windowFragmentCount,
					this.#fragmentFirstVertex,
					this.#fragmentVertexCount,
					this.#vertexX,
					this.#vertexY,
					this.#clipAw,
					this.#clipAx,
					this.#clipAy,
					this.#clipAz,
					this.#clipBw,
					this.#clipBx,
					this.#clipBy,
					this.#clipBz,
					this.#ndcAx,
					this.#ndcAy,
					this.#ndcBx,
					this.#ndcBy,
				]) +
				this.#builderA.capacityBytes +
				this.#builderB.capacityBytes,
			fragmentHighWaterCount: 0,
			temporaryFragmentHighWaterCount: 0,
			temporaryVertexHighWaterCount: 0,
			vertexHighWaterCount: 0,
			windowHighWaterCount: 0,
		};
	}

	get admittedCoverage(): number {
		return this.#admittedCoverage;
	}

	get admittedDelta(): number {
		return this.#admittedDelta;
	}

	get trace(): PortalWindowArenaTrace {
		return this.#trace;
	}

	/** Current append tail; sufficient to restore every subordinate tail deterministically. */
	checkpoint(): number {
		return this.#windowCount;
	}

	/** Reset logical lengths while retaining every backing store. */
	reset(): number {
		this.#windowCount = 0;
		this.#fragmentCount = 0;
		this.#vertexCount = 0;
		this.#admittedCoverage = NO_PORTAL_ARENA_WINDOW;
		this.#admittedDelta = NO_PORTAL_ARENA_WINDOW;
		this.#builderA.reset();
		this.#builderB.reset();
		this.#trace.fragmentHighWaterCount = 0;
		this.#trace.temporaryFragmentHighWaterCount = 0;
		this.#trace.temporaryVertexHighWaterCount = 0;
		this.#trace.vertexHighWaterCount = 0;
		this.#trace.windowHighWaterCount = 0;
		this.#builderA.addRawPolygon(
			FULL_WINDOW_X,
			FULL_WINDOW_Y,
			FULL_WINDOW_X.length,
			null,
		);
		this.#builderA.finish(null, this.#ndcAx, this.#ndcAy);
		return this.#commit(this.#builderA);
	}

	/** Restore the append tail after a declined frontier. */
	rollback(windowCount: number): void {
		if (
			!Number.isInteger(windowCount) ||
			windowCount < 0 ||
			windowCount > this.#windowCount
		) {
			throw new Error(`Portal window rollback ${windowCount} is unavailable.`);
		}
		this.#windowCount = windowCount;
		if (windowCount === 0) {
			this.#fragmentCount = 0;
			this.#vertexCount = 0;
			return;
		}
		const lastWindow = windowCount - 1;
		this.#fragmentCount =
			this.#windowFirstFragment[lastWindow]! +
			this.#windowFragmentCount[lastWindow]!;
		if (this.#fragmentCount === 0) {
			this.#vertexCount = 0;
			return;
		}
		const lastFragment = this.#fragmentCount - 1;
		this.#vertexCount =
			this.#fragmentFirstVertex[lastFragment]! +
			this.#fragmentVertexCount[lastFragment]!;
	}

	/** Classify one prepared authored aperture without camera-time point or polygon objects. */
	apertureIntersectsNearClip(
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

	/**
	 * Project, intersect, footprint-test, and admit one aperture without materializing a window.
	 */
	projectAndAdmit(
		inherited: number,
		coverage: number,
		projection: PreparedPortalProjection,
		aperture: PreparedPortalApertureProjectionInput,
		nearClipRays: boolean,
		minimumNdcArea: number,
		meter: PortalWindowPrimitiveMeter | null,
	): boolean {
		this.#requireWindow(inherited);
		if (coverage !== NO_PORTAL_ARENA_WINDOW) this.#requireWindow(coverage);
		this.#admittedCoverage = NO_PORTAL_ARENA_WINDOW;
		this.#admittedDelta = NO_PORTAL_ARENA_WINDOW;
		this.#builderA.reset();
		this.#builderB.reset();
		this.#projectAperture(projection, aperture, nearClipRays, meter);
		if (this.#builderA.fragmentCount === 0) return false;
		this.#intersectWindow(inherited, this.#builderA, this.#builderB, meter);
		if (this.#builderB.fragmentCount === 0) return false;
		if (this.#builderB.ndcArea() < minimumNdcArea) return false;
		if (coverage === NO_PORTAL_ARENA_WINDOW) {
			const candidate = this.#commit(this.#builderB);
			this.#admittedCoverage = candidate;
			this.#admittedDelta = candidate;
			return true;
		}
		this.#builderA.reset();
		for (
			let fragment = 0;
			fragment < this.#builderB.fragmentCount;
			fragment += 1
		) {
			if (
				!this.#arenaWindowContainsBuilderFragment(
					coverage,
					this.#builderB,
					fragment,
				)
			) {
				this.#builderA.copyFragmentFromBuilder(this.#builderB, fragment, meter);
			}
		}
		this.#builderA.finish(meter, this.#ndcAx, this.#ndcAy);
		if (this.#builderA.fragmentCount === 0) return false;
		this.#builderB.reset();
		const coverageFirst = this.#windowFirstFragment[coverage]!;
		const coverageCount = this.#windowFragmentCount[coverage]!;
		for (let ordinal = 0; ordinal < coverageCount; ordinal += 1) {
			const fragment = coverageFirst + ordinal;
			if (!this.#builderA.containsArenaFragment(this, fragment)) {
				this.#builderB.copyFragmentFromArena(this, fragment, meter);
			}
		}
		for (
			let fragment = 0;
			fragment < this.#builderA.fragmentCount;
			fragment += 1
		) {
			this.#builderB.copyFragmentFromBuilder(this.#builderA, fragment, meter);
		}
		this.#builderB.finish(meter, this.#ndcAx, this.#ndcAy);
		this.#admittedDelta = this.#commit(this.#builderA);
		this.#admittedCoverage = this.#commit(this.#builderB);
		return true;
	}

	fragmentCount(window: number): number {
		this.#requireWindow(window);
		return this.#windowFragmentCount[window]!;
	}

	fragmentVertexCount(window: number, fragment: number): number {
		const fragmentId = this.#fragmentId(window, fragment);
		return this.#fragmentVertexCount[fragmentId]!;
	}

	vertexX(window: number, fragment: number, vertex: number): number {
		return this.#vertex(window, fragment, vertex, this.#vertexX);
	}

	vertexY(window: number, fragment: number, vertex: number): number {
		return this.#vertex(window, fragment, vertex, this.#vertexY);
	}

	/** Builder-only access using an already validated absolute fragment id. */
	fragmentFirstVertex(fragment: number): number {
		return this.#fragmentFirstVertex[fragment]!;
	}

	/** Builder-only access using an already validated absolute fragment id. */
	absoluteFragmentVertexCount(fragment: number): number {
		return this.#fragmentVertexCount[fragment]!;
	}

	/** Builder-only access using an already validated absolute vertex id. */
	absoluteVertexX(vertex: number): number {
		return this.#vertexX[vertex]!;
	}

	/** Builder-only access using an already validated absolute vertex id. */
	absoluteVertexY(vertex: number): number {
		return this.#vertexY[vertex]!;
	}

	#arenaWindowContainsBuilderFragment(
		window: number,
		candidate: PolygonBuilder,
		candidateFragment: number,
	): boolean {
		const first = this.#windowFirstFragment[window]!;
		const count = this.#windowFragmentCount[window]!;
		for (let ordinal = 0; ordinal < count; ordinal += 1) {
			if (
				candidate.builderFragmentContainedByArenaFragment(
					candidateFragment,
					this,
					first + ordinal,
				)
			) {
				return true;
			}
		}
		return false;
	}

	#commit(builder: PolygonBuilder): number {
		if (builder.fragmentCount === 0)
			throw new Error("Cannot commit an empty portal window.");
		if (this.#windowCount >= this.#capacity.maximumWindowCount) {
			throw capacityExceeded("maximumWindowCount");
		}
		if (
			this.#fragmentCount + builder.fragmentCount >
			this.#capacity.maximumFragmentCount
		) {
			throw capacityExceeded("maximumFragmentCount");
		}
		if (
			this.#vertexCount + builder.liveVertexCount >
			this.#capacity.maximumVertexCount
		) {
			throw capacityExceeded("maximumVertexCount");
		}
		const window = this.#windowCount;
		this.#windowFirstFragment[window] = this.#fragmentCount;
		this.#windowFragmentCount[window] = builder.fragmentCount;
		for (let fragment = 0; fragment < builder.fragmentCount; fragment += 1) {
			const count = builder.fragmentVertexCount(fragment);
			this.#fragmentFirstVertex[this.#fragmentCount] = this.#vertexCount;
			this.#fragmentVertexCount[this.#fragmentCount] = count;
			for (let vertex = 0; vertex < count; vertex += 1) {
				this.#vertexX[this.#vertexCount] = builder.vertexX(fragment, vertex);
				this.#vertexY[this.#vertexCount] = builder.vertexY(fragment, vertex);
				this.#vertexCount += 1;
			}
			this.#fragmentCount += 1;
		}
		this.#windowCount += 1;
		this.#recordHighWater();
		return window;
	}

	#fragmentId(window: number, fragment: number): number {
		this.#requireWindow(window);
		const count = this.#windowFragmentCount[window]!;
		if (!Number.isInteger(fragment) || fragment < 0 || fragment >= count) {
			throw new Error(
				`Portal window ${window} fragment ${fragment} is unavailable.`,
			);
		}
		return this.#windowFirstFragment[window]! + fragment;
	}

	#intersectWindow(
		window: number,
		clip: PolygonBuilder,
		output: PolygonBuilder,
		meter: PortalWindowPrimitiveMeter | null,
	): void {
		output.reset();
		const first = this.#windowFirstFragment[window]!;
		const count = this.#windowFragmentCount[window]!;
		for (let ordinal = 0; ordinal < count; ordinal += 1) {
			const subjectFragment = first + ordinal;
			const subjectCount = this.#fragmentVertexCount[subjectFragment]!;
			const subjectFirst = this.#fragmentFirstVertex[subjectFragment]!;
			arenaBounds(this, subjectFragment, this.#boundsScratch, 0, meter);
			for (
				let clipFragment = 0;
				clipFragment < clip.fragmentCount;
				clipFragment += 1
			) {
				charge(meter, "exactIntersectionPairCount", 1);
				clip.writeBounds(clipFragment, this.#boundsScratch, 4, meter);
				if (boundsDisjoint(this.#boundsScratch, 0, 4)) continue;
				ensureFragmentCapacity(
					subjectCount,
					this.#capacity.maximumVerticesPerFragment,
				);
				for (let vertex = 0; vertex < subjectCount; vertex += 1) {
					this.#ndcAx[vertex] = this.#vertexX[subjectFirst + vertex]!;
					this.#ndcAy[vertex] = this.#vertexY[subjectFirst + vertex]!;
				}
				charge(meter, "createdNdcVertexCount", subjectCount);
				charge(meter, "createdPolygonCount", 1);
				let activeX = this.#ndcAx;
				let activeY = this.#ndcAy;
				let scratchX = this.#ndcBx;
				let scratchY = this.#ndcBy;
				let activeCount = subjectCount;
				const clipCount = clip.fragmentVertexCount(clipFragment);
				for (let edge = 0; edge < clipCount && activeCount >= 3; edge += 1) {
					activeCount = clipNdcPolygon(
						activeX,
						activeY,
						activeCount,
						clip.vertexX(clipFragment, edge),
						clip.vertexY(clipFragment, edge),
						clip.vertexX(clipFragment, (edge + 1) % clipCount),
						clip.vertexY(clipFragment, (edge + 1) % clipCount),
						scratchX,
						scratchY,
						meter,
					);
					const previousX = activeX;
					const previousY = activeY;
					activeX = scratchX;
					activeY = scratchY;
					scratchX = previousX;
					scratchY = previousY;
				}
				if (activeCount < 3) continue;
				output.addRawPolygon(activeX, activeY, activeCount, meter);
			}
		}
		output.finish(meter, this.#ndcAx, this.#ndcAy);
	}

	#projectAperture(
		projection: PreparedPortalProjection,
		input: PreparedPortalApertureProjectionInput,
		nearClipRays: boolean,
		meter: PortalWindowPrimitiveMeter | null,
	): void {
		this.#builderA.reset();
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
			for (let vertex = 0; vertex < count; vertex += 1) {
				this.#ndcAx[vertex] = activeX[vertex]! / activeW[vertex]!;
				this.#ndcAy[vertex] = activeY[vertex]! / activeW[vertex]!;
			}
			charge(meter, "createdNdcVertexCount", count);
			charge(meter, "createdPolygonCount", 1);
			this.#builderA.addRawPolygon(this.#ndcAx, this.#ndcAy, count, meter);
		}
		this.#builderA.finish(meter, this.#ndcAx, this.#ndcAy);
		this.#recordTemporaryHighWater();
	}

	#recordHighWater(): void {
		this.#trace.fragmentHighWaterCount = Math.max(
			this.#trace.fragmentHighWaterCount,
			this.#fragmentCount,
		);
		this.#trace.vertexHighWaterCount = Math.max(
			this.#trace.vertexHighWaterCount,
			this.#vertexCount,
		);
		this.#trace.windowHighWaterCount = Math.max(
			this.#trace.windowHighWaterCount,
			this.#windowCount,
		);
		this.#recordTemporaryHighWater();
	}

	#recordTemporaryHighWater(): void {
		this.#trace.temporaryFragmentHighWaterCount = Math.max(
			this.#trace.temporaryFragmentHighWaterCount,
			this.#builderA.fragmentHighWaterCount,
			this.#builderB.fragmentHighWaterCount,
		);
		this.#trace.temporaryVertexHighWaterCount = Math.max(
			this.#trace.temporaryVertexHighWaterCount,
			this.#builderA.vertexHighWaterCount,
			this.#builderB.vertexHighWaterCount,
		);
	}

	#requireWindow(window: number): void {
		if (
			!Number.isInteger(window) ||
			window < 0 ||
			window >= this.#windowCount
		) {
			throw new Error(`Portal arena window ${window} is unavailable.`);
		}
	}

	#vertex(
		window: number,
		fragment: number,
		vertex: number,
		values: Float64Array,
	): number {
		const fragmentId = this.#fragmentId(window, fragment);
		const count = this.#fragmentVertexCount[fragmentId]!;
		if (!Number.isInteger(vertex) || vertex < 0 || vertex >= count) {
			throw new Error(
				`Portal fragment ${fragmentId} vertex ${vertex} is unavailable.`,
			);
		}
		return values[this.#fragmentFirstVertex[fragmentId]! + vertex]!;
	}
}

class PolygonBuilder {
	readonly #capacity: PortalWindowArenaCapacity;
	readonly #copyX: Float64Array;
	readonly #copyY: Float64Array;
	readonly #fragmentFirstVertex: Uint32Array;
	readonly #fragmentVertexCount: Uint32Array;
	readonly #normalizeX: Float64Array;
	readonly #normalizeY: Float64Array;
	readonly #vertexX: Float64Array;
	readonly #vertexY: Float64Array;
	fragmentCount = 0;
	fragmentHighWaterCount = 0;
	vertexCount = 0;
	vertexHighWaterCount = 0;

	constructor(capacity: PortalWindowArenaCapacity) {
		this.#capacity = capacity;
		this.#copyX = new Float64Array(capacity.maximumVerticesPerFragment);
		this.#copyY = new Float64Array(capacity.maximumVerticesPerFragment);
		this.#fragmentFirstVertex = new Uint32Array(
			capacity.maximumTemporaryFragmentCount,
		);
		this.#fragmentVertexCount = new Uint32Array(
			capacity.maximumTemporaryFragmentCount,
		);
		this.#normalizeX = new Float64Array(capacity.maximumVerticesPerFragment);
		this.#normalizeY = new Float64Array(capacity.maximumVerticesPerFragment);
		this.#vertexX = new Float64Array(capacity.maximumTemporaryVertexCount);
		this.#vertexY = new Float64Array(capacity.maximumTemporaryVertexCount);
	}

	get capacityBytes(): number {
		return typedArrayBytes([
			this.#copyX,
			this.#copyY,
			this.#fragmentFirstVertex,
			this.#fragmentVertexCount,
			this.#normalizeX,
			this.#normalizeY,
			this.#vertexX,
			this.#vertexY,
		]);
	}

	get liveVertexCount(): number {
		let count = 0;
		for (let fragment = 0; fragment < this.fragmentCount; fragment += 1) {
			count += this.#fragmentVertexCount[fragment]!;
		}
		return count;
	}

	reset(): void {
		this.fragmentCount = 0;
		this.vertexCount = 0;
	}

	addRawPolygon(
		x: Float64Array,
		y: Float64Array,
		count: number,
		meter: PortalWindowPrimitiveMeter | null,
	): void {
		const normalizedCount = normalizePolygon(
			x,
			y,
			count,
			this.#normalizeX,
			this.#normalizeY,
			meter,
		);
		if (normalizedCount < 3) return;
		for (let fragment = 0; fragment < this.fragmentCount; fragment += 1) {
			if (this.#identityEqualsRaw(fragment, x, y, normalizedCount, meter))
				return;
		}
		this.#appendRaw(x, y, normalizedCount);
	}

	copyFragmentFromBuilder(
		source: PolygonBuilder,
		fragment: number,
		meter: PortalWindowPrimitiveMeter | null,
	): void {
		const count = source.fragmentVertexCount(fragment);
		ensureFragmentCapacity(count, this.#capacity.maximumVerticesPerFragment);
		for (let vertex = 0; vertex < count; vertex += 1) {
			this.#copyX[vertex] = source.vertexX(fragment, vertex);
			this.#copyY[vertex] = source.vertexY(fragment, vertex);
		}
		this.addRawPolygon(this.#copyX, this.#copyY, count, meter);
	}

	copyFragmentFromArena(
		source: PortalWindowArena,
		fragment: number,
		meter: PortalWindowPrimitiveMeter | null,
	): void {
		const count = source.absoluteFragmentVertexCount(fragment);
		ensureFragmentCapacity(count, this.#capacity.maximumVerticesPerFragment);
		const first = source.fragmentFirstVertex(fragment);
		for (let vertex = 0; vertex < count; vertex += 1) {
			this.#copyX[vertex] = source.absoluteVertexX(first + vertex);
			this.#copyY[vertex] = source.absoluteVertexY(first + vertex);
		}
		this.addRawPolygon(this.#copyX, this.#copyY, count, meter);
	}

	finish(
		meter: PortalWindowPrimitiveMeter | null,
		scratchX: Float64Array,
		scratchY: Float64Array,
	): void {
		for (let left = 0; left < this.fragmentCount; left += 1) {
			for (let right = left + 1; right < this.fragmentCount; ) {
				const mergedCount = this.#merge(left, right, scratchX, scratchY, meter);
				if (mergedCount === 0) {
					right += 1;
					continue;
				}
				this.#replace(left, scratchX, scratchY, mergedCount);
				this.#remove(right);
				right = left + 1;
			}
		}
		for (let index = 1; index < this.fragmentCount; index += 1) {
			let cursor = index;
			while (cursor > 0) {
				charge(meter, "fragmentSortComparisonCount", 1);
				if (this.#compareIdentity(cursor - 1, cursor, meter) <= 0) break;
				this.#swap(cursor - 1, cursor);
				cursor -= 1;
			}
		}
	}

	fragmentVertexCount(fragment: number): number {
		return this.#fragmentVertexCount[fragment]!;
	}

	vertexX(fragment: number, vertex: number): number {
		return this.#vertexX[this.#fragmentFirstVertex[fragment]! + vertex]!;
	}

	vertexY(fragment: number, vertex: number): number {
		return this.#vertexY[this.#fragmentFirstVertex[fragment]! + vertex]!;
	}

	ndcArea(): number {
		let area = 0;
		for (let fragment = 0; fragment < this.fragmentCount; fragment += 1) {
			area += Math.abs(this.#signedArea(fragment, null));
		}
		return area;
	}

	writeBounds(
		fragment: number,
		target: Float64Array,
		offset: number,
		meter: PortalWindowPrimitiveMeter | null,
	): void {
		const count = this.fragmentVertexCount(fragment);
		charge(meter, "polygonBoundsVertexVisitCount", 1);
		let minX = this.vertexX(fragment, 0);
		let minY = this.vertexY(fragment, 0);
		let maxX = minX;
		let maxY = minY;
		for (let vertex = 1; vertex < count; vertex += 1) {
			charge(meter, "polygonBoundsVertexVisitCount", 1);
			const x = this.vertexX(fragment, vertex);
			const y = this.vertexY(fragment, vertex);
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}
		target[offset] = minX;
		target[offset + 1] = minY;
		target[offset + 2] = maxX;
		target[offset + 3] = maxY;
	}

	containsArenaFragment(arena: PortalWindowArena, candidate: number): boolean {
		for (let fragment = 0; fragment < this.fragmentCount; fragment += 1) {
			const containerCount = this.fragmentVertexCount(fragment);
			const candidateCount = arena.absoluteFragmentVertexCount(candidate);
			const candidateFirst = arena.fragmentFirstVertex(candidate);
			let contained = true;
			for (let vertex = 0; vertex < candidateCount && contained; vertex += 1) {
				contained = pointInBuilderFragment(
					this,
					fragment,
					containerCount,
					arena.absoluteVertexX(candidateFirst + vertex),
					arena.absoluteVertexY(candidateFirst + vertex),
				);
			}
			if (contained) return true;
		}
		return false;
	}

	builderFragmentContainedByArenaFragment(
		candidate: number,
		arena: PortalWindowArena,
		container: number,
	): boolean {
		const candidateCount = this.fragmentVertexCount(candidate);
		const containerCount = arena.absoluteFragmentVertexCount(container);
		const containerFirst = arena.fragmentFirstVertex(container);
		for (let vertex = 0; vertex < candidateCount; vertex += 1) {
			const x = this.vertexX(candidate, vertex);
			const y = this.vertexY(candidate, vertex);
			for (let edge = 0; edge < containerCount; edge += 1) {
				const next = (edge + 1) % containerCount;
				if (
					edgeDistance(
						arena.absoluteVertexX(containerFirst + edge),
						arena.absoluteVertexY(containerFirst + edge),
						arena.absoluteVertexX(containerFirst + next),
						arena.absoluteVertexY(containerFirst + next),
						x,
						y,
					) < -PORTAL_WINDOW_NDC_EPSILON
				) {
					return false;
				}
			}
		}
		return true;
	}

	#appendRaw(x: Float64Array, y: Float64Array, count: number): void {
		if (this.fragmentCount >= this.#capacity.maximumTemporaryFragmentCount) {
			throw capacityExceeded("maximumTemporaryFragmentCount");
		}
		if (this.vertexCount + count > this.#capacity.maximumTemporaryVertexCount) {
			throw capacityExceeded("maximumTemporaryVertexCount");
		}
		this.#fragmentFirstVertex[this.fragmentCount] = this.vertexCount;
		this.#fragmentVertexCount[this.fragmentCount] = count;
		for (let vertex = 0; vertex < count; vertex += 1) {
			this.#vertexX[this.vertexCount] = x[vertex]!;
			this.#vertexY[this.vertexCount] = y[vertex]!;
			this.vertexCount += 1;
		}
		this.fragmentCount += 1;
		this.fragmentHighWaterCount = Math.max(
			this.fragmentHighWaterCount,
			this.fragmentCount,
		);
		this.vertexHighWaterCount = Math.max(
			this.vertexHighWaterCount,
			this.vertexCount,
		);
	}

	#compareIdentity(
		left: number,
		right: number,
		meter: PortalWindowPrimitiveMeter | null,
	): number {
		const leftCount = this.fragmentVertexCount(left);
		const rightCount = this.fragmentVertexCount(right);
		charge(meter, "polygonIdentityVertexVisitCount", leftCount + rightCount);
		const count = Math.min(leftCount, rightCount);
		for (let vertex = 0; vertex < count; vertex += 1) {
			const x =
				quantize(this.vertexX(left, vertex)) -
				quantize(this.vertexX(right, vertex));
			if (x !== 0) return x;
			const y =
				quantize(this.vertexY(left, vertex)) -
				quantize(this.vertexY(right, vertex));
			if (y !== 0) return y;
		}
		return leftCount - rightCount;
	}

	#identityEqualsRaw(
		fragment: number,
		x: Float64Array,
		y: Float64Array,
		count: number,
		meter: PortalWindowPrimitiveMeter | null,
	): boolean {
		const existingCount = this.fragmentVertexCount(fragment);
		charge(meter, "polygonIdentityVertexVisitCount", existingCount);
		if (existingCount !== count) return false;
		for (let vertex = 0; vertex < count; vertex += 1) {
			if (
				quantize(this.vertexX(fragment, vertex)) !== quantize(x[vertex]!) ||
				quantize(this.vertexY(fragment, vertex)) !== quantize(y[vertex]!)
			) {
				return false;
			}
		}
		return true;
	}

	#merge(
		left: number,
		right: number,
		x: Float64Array,
		y: Float64Array,
		meter: PortalWindowPrimitiveMeter | null,
	): number {
		const leftCount = this.fragmentVertexCount(left);
		const rightCount = this.fragmentVertexCount(right);
		for (let leftEdge = 0; leftEdge < leftCount; leftEdge += 1) {
			for (let rightEdge = 0; rightEdge < rightCount; rightEdge += 1) {
				charge(meter, "mergeEdgePairTestCount", 1);
				if (
					!approximatelyEqual(
						this.vertexX(left, leftEdge),
						this.vertexY(left, leftEdge),
						this.vertexX(right, (rightEdge + 1) % rightCount),
						this.vertexY(right, (rightEdge + 1) % rightCount),
					) ||
					!approximatelyEqual(
						this.vertexX(left, (leftEdge + 1) % leftCount),
						this.vertexY(left, (leftEdge + 1) % leftCount),
						this.vertexX(right, rightEdge),
						this.vertexY(right, rightEdge),
					)
				) {
					continue;
				}
				let count = 0;
				count = this.#appendPath(
					left,
					(leftEdge + 1) % leftCount,
					leftEdge,
					x,
					y,
					count,
					meter,
				);
				count = this.#appendPath(
					right,
					(rightEdge + 2) % rightCount,
					(rightEdge + rightCount - 1) % rightCount,
					x,
					y,
					count,
					meter,
				);
				for (let vertex = 0; vertex < count; vertex += 1) {
					charge(meter, "mergeConvexityVertexTestCount", 1);
					if (
						edgeDistance(
							x[vertex]!,
							y[vertex]!,
							x[(vertex + 1) % count]!,
							y[(vertex + 1) % count]!,
							x[(vertex + 2) % count]!,
							y[(vertex + 2) % count]!,
						) < -PORTAL_WINDOW_NDC_EPSILON
					) {
						return 0;
					}
				}
				return normalizePolygon(
					x,
					y,
					count,
					this.#normalizeX,
					this.#normalizeY,
					meter,
				);
			}
		}
		return 0;
	}

	#appendPath(
		fragment: number,
		start: number,
		end: number,
		x: Float64Array,
		y: Float64Array,
		count: number,
		meter: PortalWindowPrimitiveMeter | null,
	): number {
		const vertexCount = this.fragmentVertexCount(fragment);
		for (let vertex = start; ; vertex = (vertex + 1) % vertexCount) {
			if (count >= x.length) {
				throw capacityExceeded("maximumVerticesPerFragment");
			}
			charge(meter, "mergeBoundaryVertexVisitCount", 1);
			x[count] = this.vertexX(fragment, vertex);
			y[count] = this.vertexY(fragment, vertex);
			count += 1;
			if (vertex === end) return count;
		}
	}

	#remove(fragment: number): void {
		for (let index = fragment; index + 1 < this.fragmentCount; index += 1) {
			this.#fragmentFirstVertex[index] = this.#fragmentFirstVertex[index + 1]!;
			this.#fragmentVertexCount[index] = this.#fragmentVertexCount[index + 1]!;
		}
		this.fragmentCount -= 1;
	}

	#replace(
		fragment: number,
		x: Float64Array,
		y: Float64Array,
		count: number,
	): void {
		if (this.vertexCount + count > this.#capacity.maximumTemporaryVertexCount) {
			throw capacityExceeded("maximumTemporaryVertexCount");
		}
		this.#fragmentFirstVertex[fragment] = this.vertexCount;
		this.#fragmentVertexCount[fragment] = count;
		for (let vertex = 0; vertex < count; vertex += 1) {
			this.#vertexX[this.vertexCount] = x[vertex]!;
			this.#vertexY[this.vertexCount] = y[vertex]!;
			this.vertexCount += 1;
		}
		this.vertexHighWaterCount = Math.max(
			this.vertexHighWaterCount,
			this.vertexCount,
		);
	}

	#signedArea(
		fragment: number,
		meter: PortalWindowPrimitiveMeter | null,
	): number {
		const count = this.fragmentVertexCount(fragment);
		let twiceArea = 0;
		for (let vertex = 0; vertex < count; vertex += 1) {
			charge(meter, "normalizationVertexVisitCount", 1);
			const next = (vertex + 1) % count;
			twiceArea +=
				this.vertexX(fragment, vertex) * this.vertexY(fragment, next) -
				this.vertexY(fragment, vertex) * this.vertexX(fragment, next);
		}
		return twiceArea / 2;
	}

	#swap(left: number, right: number): void {
		const first = this.#fragmentFirstVertex[left]!;
		const count = this.#fragmentVertexCount[left]!;
		this.#fragmentFirstVertex[left] = this.#fragmentFirstVertex[right]!;
		this.#fragmentVertexCount[left] = this.#fragmentVertexCount[right]!;
		this.#fragmentFirstVertex[right] = first;
		this.#fragmentVertexCount[right] = count;
	}
}

const FULL_WINDOW_X = new Float64Array([-1, 1, 1, -1]);
const FULL_WINDOW_Y = new Float64Array([-1, -1, 1, 1]);

function normalizePolygon(
	x: Float64Array,
	y: Float64Array,
	inputCount: number,
	scratchX: Float64Array,
	scratchY: Float64Array,
	meter: PortalWindowPrimitiveMeter | null,
): number {
	if (inputCount < 3) return 0;
	ensureFragmentCapacity(inputCount, scratchX.length);
	let count = 0;
	for (let vertex = 0; vertex < inputCount; vertex += 1) {
		charge(meter, "normalizationVertexVisitCount", 1);
		const currentX = x[vertex]!;
		const currentY = y[vertex]!;
		if (!Number.isFinite(currentX) || !Number.isFinite(currentY)) {
			throw new Error("Portal-window polygon contains a non-finite vertex.");
		}
		if (
			currentX < -1 - PORTAL_WINDOW_NDC_EPSILON ||
			currentX > 1 + PORTAL_WINDOW_NDC_EPSILON ||
			currentY < -1 - PORTAL_WINDOW_NDC_EPSILON ||
			currentY > 1 + PORTAL_WINDOW_NDC_EPSILON
		) {
			throw new Error(
				"Portal-window polygon lies outside normalized device space.",
			);
		}
		if (
			count === 0 ||
			!approximatelyEqual(
				scratchX[count - 1]!,
				scratchY[count - 1]!,
				currentX,
				currentY,
			)
		) {
			scratchX[count] = currentX;
			scratchY[count] = currentY;
			count += 1;
		}
	}
	if (
		count > 1 &&
		approximatelyEqual(
			scratchX[0]!,
			scratchY[0]!,
			scratchX[count - 1]!,
			scratchY[count - 1]!,
		)
	) {
		count -= 1;
	}
	let changed = true;
	while (changed && count >= 3) {
		changed = false;
		for (let vertex = 0; vertex < count; vertex += 1) {
			charge(meter, "normalizationVertexVisitCount", 1);
			const previous = (vertex + count - 1) % count;
			const next = (vertex + 1) % count;
			const cross = edgeDistance(
				scratchX[previous]!,
				scratchY[previous]!,
				scratchX[vertex]!,
				scratchY[vertex]!,
				scratchX[next]!,
				scratchY[next]!,
			);
			const forwardDot =
				(scratchX[vertex]! - scratchX[previous]!) *
					(scratchX[next]! - scratchX[vertex]!) +
				(scratchY[vertex]! - scratchY[previous]!) *
					(scratchY[next]! - scratchY[vertex]!);
			if (
				Math.abs(cross) <= PORTAL_WINDOW_NDC_EPSILON &&
				forwardDot >= -PORTAL_WINDOW_NDC_EPSILON
			) {
				for (let shift = vertex; shift + 1 < count; shift += 1) {
					scratchX[shift] = scratchX[shift + 1]!;
					scratchY[shift] = scratchY[shift + 1]!;
				}
				count -= 1;
				changed = true;
				break;
			}
		}
	}
	if (count < 3) return 0;
	let twiceArea = 0;
	for (let vertex = 0; vertex < count; vertex += 1) {
		charge(meter, "normalizationVertexVisitCount", 1);
		const next = (vertex + 1) % count;
		twiceArea +=
			scratchX[vertex]! * scratchY[next]! - scratchY[vertex]! * scratchX[next]!;
	}
	if (
		!Number.isFinite(twiceArea) ||
		Math.abs(twiceArea / 2) <=
			PORTAL_WINDOW_NDC_EPSILON * PORTAL_WINDOW_NDC_EPSILON
	) {
		return 0;
	}
	if (twiceArea < 0) reversePolygon(scratchX, scratchY, count);
	for (let vertex = 0; vertex < count; vertex += 1) {
		charge(meter, "normalizationVertexVisitCount", 1);
		if (
			edgeDistance(
				scratchX[vertex]!,
				scratchY[vertex]!,
				scratchX[(vertex + 1) % count]!,
				scratchY[(vertex + 1) % count]!,
				scratchX[(vertex + 2) % count]!,
				scratchY[(vertex + 2) % count]!,
			) < -PORTAL_WINDOW_NDC_EPSILON
		) {
			throw new Error("Portal-window fragment must be convex.");
		}
	}
	let first = 0;
	for (let vertex = 1; vertex < count; vertex += 1) {
		charge(meter, "normalizationVertexVisitCount", 1);
		if (
			scratchX[vertex]! < scratchX[first]! ||
			(scratchX[vertex] === scratchX[first] &&
				scratchY[vertex]! < scratchY[first]!)
		) {
			first = vertex;
		}
	}
	for (let vertex = 0; vertex < count; vertex += 1) {
		x[vertex] = scratchX[(first + vertex) % count]!;
		y[vertex] = scratchY[(first + vertex) % count]!;
	}
	return count;
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

function clipNdcPolygon(
	x: Float64Array,
	y: Float64Array,
	count: number,
	edgeStartX: number,
	edgeStartY: number,
	edgeEndX: number,
	edgeEndY: number,
	outputX: Float64Array,
	outputY: Float64Array,
	meter: PortalWindowPrimitiveMeter | null,
): number {
	charge(meter, "createdPolygonCount", 1);
	let outputCount = 0;
	let previous = count - 1;
	charge(meter, "ndcClipVertexEdgeTestCount", 1);
	let previousDistance = edgeDistance(
		edgeStartX,
		edgeStartY,
		edgeEndX,
		edgeEndY,
		x[previous]!,
		y[previous]!,
	);
	let previousInside = previousDistance >= -PORTAL_WINDOW_NDC_EPSILON;
	for (let current = 0; current < count; current += 1) {
		charge(meter, "ndcClipVertexEdgeTestCount", 1);
		const currentDistance = edgeDistance(
			edgeStartX,
			edgeStartY,
			edgeEndX,
			edgeEndY,
			x[current]!,
			y[current]!,
		);
		const currentInside = currentDistance >= -PORTAL_WINDOW_NDC_EPSILON;
		if (currentInside !== previousInside) {
			const denominator = previousDistance - currentDistance;
			if (Math.abs(denominator) > Number.EPSILON) {
				ensureOutputVertex(outputCount, outputX.length);
				const fraction = Math.min(
					1,
					Math.max(0, previousDistance / denominator),
				);
				outputX[outputCount] =
					x[previous]! + (x[current]! - x[previous]!) * fraction;
				outputY[outputCount] =
					y[previous]! + (y[current]! - y[previous]!) * fraction;
				outputCount += 1;
				charge(meter, "createdNdcVertexCount", 1);
			}
		}
		if (currentInside) {
			ensureOutputVertex(outputCount, outputX.length);
			outputX[outputCount] = x[current]!;
			outputY[outputCount] = y[current]!;
			outputCount += 1;
		}
		previous = current;
		previousDistance = currentDistance;
		previousInside = currentInside;
	}
	return outputCount;
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

function arenaBounds(
	arena: PortalWindowArena,
	fragment: number,
	target: Float64Array,
	offset: number,
	meter: PortalWindowPrimitiveMeter | null,
): void {
	const first = arena.fragmentFirstVertex(fragment);
	const count = arena.absoluteFragmentVertexCount(fragment);
	charge(meter, "polygonBoundsVertexVisitCount", 1);
	let minX = arena.absoluteVertexX(first);
	let minY = arena.absoluteVertexY(first);
	let maxX = minX;
	let maxY = minY;
	for (let vertex = 1; vertex < count; vertex += 1) {
		charge(meter, "polygonBoundsVertexVisitCount", 1);
		const x = arena.absoluteVertexX(first + vertex);
		const y = arena.absoluteVertexY(first + vertex);
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	}
	target[offset] = minX;
	target[offset + 1] = minY;
	target[offset + 2] = maxX;
	target[offset + 3] = maxY;
}

function boundsDisjoint(
	bounds: Float64Array,
	left: number,
	right: number,
): boolean {
	return (
		bounds[left + 2]! < bounds[right]! - PORTAL_WINDOW_NDC_EPSILON ||
		bounds[right + 2]! < bounds[left]! - PORTAL_WINDOW_NDC_EPSILON ||
		bounds[left + 3]! < bounds[right + 1]! - PORTAL_WINDOW_NDC_EPSILON ||
		bounds[right + 3]! < bounds[left + 1]! - PORTAL_WINDOW_NDC_EPSILON
	);
}

function pointInBuilderFragment(
	builder: PolygonBuilder,
	fragment: number,
	count: number,
	x: number,
	y: number,
): boolean {
	for (let edge = 0; edge < count; edge += 1) {
		const next = (edge + 1) % count;
		if (
			edgeDistance(
				builder.vertexX(fragment, edge),
				builder.vertexY(fragment, edge),
				builder.vertexX(fragment, next),
				builder.vertexY(fragment, next),
				x,
				y,
			) < -PORTAL_WINDOW_NDC_EPSILON
		) {
			return false;
		}
	}
	return true;
}

function edgeDistance(
	startX: number,
	startY: number,
	endX: number,
	endY: number,
	pointX: number,
	pointY: number,
): number {
	return (
		(endX - startX) * (pointY - startY) - (endY - startY) * (pointX - startX)
	);
}

function approximatelyEqual(
	leftX: number,
	leftY: number,
	rightX: number,
	rightY: number,
): boolean {
	return (
		Math.abs(leftX - rightX) <= PORTAL_WINDOW_NDC_EPSILON &&
		Math.abs(leftY - rightY) <= PORTAL_WINDOW_NDC_EPSILON
	);
}

function reversePolygon(x: Float64Array, y: Float64Array, count: number): void {
	for (let left = 0, right = count - 1; left < right; left += 1, right -= 1) {
		const swapX = x[left]!;
		const swapY = y[left]!;
		x[left] = x[right]!;
		y[left] = y[right]!;
		x[right] = swapX;
		y[right] = swapY;
	}
}

function quantize(value: number): number {
	const rounded = Math.round(value / PORTAL_WINDOW_NDC_EPSILON);
	return Object.is(rounded, -0) ? 0 : rounded;
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

function typedArrayBytes(values: readonly ArrayBufferView[]): number {
	let bytes = 0;
	for (const value of values) bytes += value.byteLength;
	return bytes;
}

function validateCapacity(capacity: PortalWindowArenaCapacity): void {
	for (const [name, value, minimum] of [
		["maximumApertureVertexCount", capacity.maximumApertureVertexCount, 3],
		["maximumFragmentCount", capacity.maximumFragmentCount, 1],
		[
			"maximumTemporaryFragmentCount",
			capacity.maximumTemporaryFragmentCount,
			1,
		],
		["maximumVertexCount", capacity.maximumVertexCount, 4],
		["maximumTemporaryVertexCount", capacity.maximumTemporaryVertexCount, 4],
		["maximumVerticesPerFragment", capacity.maximumVerticesPerFragment, 4],
		["maximumWindowCount", capacity.maximumWindowCount, 1],
	] as const) {
		if (!Number.isSafeInteger(value) || value < minimum) {
			throw new Error(
				`Portal window arena ${name} must be an integer at least ${minimum}.`,
			);
		}
	}
}
