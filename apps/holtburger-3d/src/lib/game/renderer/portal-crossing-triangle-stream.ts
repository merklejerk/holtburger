import {
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
	type LandblockCoordinates,
} from "../landblocks";
import type { ScenePortalCrossingInput } from "../scene";
import type { PortalScopeAtlasFrameView } from "./portal-scope-atlas-planner";
import { PORTAL_SCOPE_ATLAS_MAXIMUM_ARRIVAL_STATE_COUNT } from "./webgl2-portal-scope-atlas-targets";

/** Interleaved float/integer slots in one expanded crossing-triangle vertex. */
export const PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES = 24;
export const PORTAL_CROSSING_TRIANGLE_POSITION_OFFSET_BYTES = 0;
export const PORTAL_CROSSING_TRIANGLE_OUTPUT_ARRIVAL_OFFSET_BYTES = 12;
export const PORTAL_CROSSING_TRIANGLE_SOURCE_SCOPE_OFFSET_BYTES = 16;
export const PORTAL_CROSSING_TRIANGLE_DEPTH_POLICY_OFFSET_BYTES = 20;

/** Integer shader encoding for an aperture allowed to tie its source surface depth. */
export const PORTAL_CROSSING_DEPTH_POLICY_ALLOW_EQUAL = 0;
/** Integer shader encoding for an aperture required to be strictly nearer than source depth. */
export const PORTAL_CROSSING_DEPTH_POLICY_REJECT_EQUAL = 1;

const UINT32_BYTES = Uint32Array.BYTES_PER_ELEMENT;
const RECORD_SLOT_COUNT =
	PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES / UINT32_BYTES;
const ROOT_ARRIVAL_STATE_ID = 1;
const FIRST_CROSSING_ARRIVAL_STATE_ID = ROOT_ARRIVAL_STATE_ID + 1;

/** Allocation and input-read facts for one prepared crossing stream. */
interface PortalCrossingTriangleStreamTrace {
	/** Fixed typed backing storage allocated at arena construction. */
	readonly arenaCapacityBytes: number;
	/** Camera-time backing-store growth; fixed storage makes this structurally zero. */
	readonly arenaGrowthCount: 0;
	/** Selected crossings inspected exactly once while expanding retained geometry. */
	readonly crossingInputCount: number;
	/** Topology-owned triangle indices read while expanding retained geometry. */
	readonly triangleIndexReadCount: number;
	/** Topology-owned xyz scalar values copied into anchor-relative storage. */
	readonly positionScalarReadCount: number;
	/** Normal-path portal-owned records created by one preparation. */
	readonly portalOwnedFrameHeapRecordCreationCount: 0;
	/** Largest initialized triangle-vertex tail reached by this preparation. */
	readonly vertexHighWaterCount: number;
}

interface MutablePortalCrossingTriangleStreamTrace extends PortalCrossingTriangleStreamTrace {
	crossingInputCount: number;
	triangleIndexReadCount: number;
	positionScalarReadCount: number;
	vertexHighWaterCount: number;
}

/** Reused, non-retained view over arena-owned interleaved triangle records. */
export interface PortalCrossingTriangleStreamView {
	/** Complete fixed-capacity byte view; uploads use `usedByteLength` without slicing it. */
	readonly bytes: Uint8Array;
	readonly trace: PortalCrossingTriangleStreamTrace;
	readonly usedByteLength: number;
	readonly vertexCount: number;
}

/**
 * Expand every retained indexed aperture once into a fixed, GPU-ready triangle stream.
 *
 * Arrival ids follow the culler's stable selected-crossing order: zero is uncovered, one is the
 * root, and crossing ordinal zero begins at two. The stream is invalid after the next `prepare`.
 */
export class PortalCrossingTriangleStreamArena implements PortalCrossingTriangleStreamView {
	readonly bytes: Uint8Array;
	readonly trace: MutablePortalCrossingTriangleStreamTrace;
	readonly #floatSlots: Float32Array;
	readonly #maximumTriangleVertexCount: number;
	readonly #uintSlots: Uint32Array;
	usedByteLength = 0;
	vertexCount = 0;

	constructor(maximumTriangleVertexCount: number) {
		if (
			!Number.isSafeInteger(maximumTriangleVertexCount) ||
			maximumTriangleVertexCount < 3
		) {
			throw new Error(
				"Portal crossing stream capacity must contain at least one triangle.",
			);
		}
		const arena = new ArrayBuffer(
			maximumTriangleVertexCount * PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
		);
		this.bytes = new Uint8Array(arena);
		this.#floatSlots = new Float32Array(arena);
		this.#maximumTriangleVertexCount = maximumTriangleVertexCount;
		this.#uintSlots = new Uint32Array(arena);
		this.trace = {
			arenaCapacityBytes: arena.byteLength,
			arenaGrowthCount: 0,
			crossingInputCount: 0,
			portalOwnedFrameHeapRecordCreationCount: 0,
			positionScalarReadCount: 0,
			triangleIndexReadCount: 0,
			vertexHighWaterCount: 0,
		};
	}

	prepare(
		frame: PortalScopeAtlasFrameView,
		anchorCoordinates: LandblockCoordinates,
	): PortalCrossingTriangleStreamView {
		const plannedVertexCount = frame.trace.crossingTriangleVertexCount;
		if (plannedVertexCount > this.#maximumTriangleVertexCount) {
			throw new Error(
				`Portal crossing stream plan ${plannedVertexCount} exceeds arena capacity ${this.#maximumTriangleVertexCount}.`,
			);
		}
		this.vertexCount = 0;
		this.usedByteLength = 0;
		this.trace.crossingInputCount = 0;
		this.trace.positionScalarReadCount = 0;
		this.trace.triangleIndexReadCount = 0;
		this.trace.vertexHighWaterCount = 0;

		const visibility = frame.visibility;
		for (
			let crossingOrdinal = 0;
			crossingOrdinal < visibility.selectedCrossingCount;
			crossingOrdinal += 1
		) {
			const crossing = visibility.selectedCrossing(crossingOrdinal);
			const aperture = crossing.visibilityAperture;
			const outputArrivalStateId =
				FIRST_CROSSING_ARRIVAL_STATE_ID + crossingOrdinal;
			if (
				outputArrivalStateId > PORTAL_SCOPE_ATLAS_MAXIMUM_ARRIVAL_STATE_COUNT
			) {
				throw new Error(
					`Portal crossing arrival id ${outputArrivalStateId} exceeds the R8UI frontier format.`,
				);
			}
			const sourceScopeOrdinal =
				visibility.selectedCrossingSourceScopeOrdinal(crossingOrdinal);
			const depthPolicy = encodeDepthPolicy(crossing.maskDepthPolicy);
			const offsetX =
				(visibility.selectedCrossingLandblockX(crossingOrdinal) -
					anchorCoordinates.x) *
				OUTDOOR_LANDBLOCK_WORLD_SIZE;
			const offsetZ =
				-(
					visibility.selectedCrossingLandblockY(crossingOrdinal) -
					anchorCoordinates.y
				) * OUTDOOR_LANDBLOCK_WORLD_SIZE;
			for (let cursor = 0; cursor < aperture.indices.length; cursor += 1) {
				const sourceVertex = aperture.indices[cursor]!;
				const sourceSlot = sourceVertex * 3;
				if (sourceSlot + 2 >= aperture.vertices.length) {
					throw new Error(
						`Portal crossing ${crossing.id} triangle index ${sourceVertex} exceeds its vertex buffer.`,
					);
				}
				const outputSlot = this.vertexCount * RECORD_SLOT_COUNT;
				this.#floatSlots[outputSlot] = aperture.vertices[sourceSlot]! + offsetX;
				this.#floatSlots[outputSlot + 1] = aperture.vertices[sourceSlot + 1]!;
				this.#floatSlots[outputSlot + 2] =
					aperture.vertices[sourceSlot + 2]! + offsetZ;
				this.#uintSlots[outputSlot + 3] = outputArrivalStateId;
				this.#uintSlots[outputSlot + 4] = sourceScopeOrdinal;
				this.#uintSlots[outputSlot + 5] = depthPolicy;
				this.vertexCount += 1;
			}
			this.trace.crossingInputCount += 1;
			this.trace.triangleIndexReadCount += aperture.indices.length;
			this.trace.positionScalarReadCount += aperture.indices.length * 3;
		}
		if (this.vertexCount !== plannedVertexCount) {
			throw new Error(
				`Portal crossing stream produced ${this.vertexCount} vertices for a ${plannedVertexCount}-vertex plan.`,
			);
		}
		this.usedByteLength =
			this.vertexCount * PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES;
		this.trace.vertexHighWaterCount = this.vertexCount;
		return this;
	}
}

function encodeDepthPolicy(
	policy: ScenePortalCrossingInput["maskDepthPolicy"],
): number {
	switch (policy) {
		case "allow-equal-depth":
			return PORTAL_CROSSING_DEPTH_POLICY_ALLOW_EQUAL;
		case "reject-equal-depth":
			return PORTAL_CROSSING_DEPTH_POLICY_REJECT_EQUAL;
	}
}
