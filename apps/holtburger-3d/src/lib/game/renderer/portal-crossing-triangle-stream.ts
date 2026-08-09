import {
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
	type LandblockCoordinates,
} from "../landblocks";
import type { ScenePortalCrossingInput } from "../scene";
import {
	PORTAL_ARRIVAL_METADATA_FLAGS_OFFSET_BYTES,
	PORTAL_ARRIVAL_METADATA_HAS_ENTRY_PLANE,
	PORTAL_ARRIVAL_METADATA_RECORD_BYTES,
	PORTAL_ARRIVAL_METADATA_RECIPROCAL_OFFSET_BYTES,
	PORTAL_ARRIVAL_METADATA_SCOPE_OFFSET_BYTES,
	PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT,
	writeOrientedPortalArrivalPlane,
} from "./portal-arrival-metadata";
import {
	PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
	PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES,
} from "./portal-propagation-metadata";
import type { PortalScopeAtlasFrameView } from "./portal-scope-atlas-planner";
import {
	PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES,
	writePortalScopeTileMetadata,
} from "./portal-scope-tile-metadata";

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
	/** Fixed triangle plus propagation-metadata storage allocated at arena construction. */
	readonly arenaCapacityBytes: number;
	/** Fixed combined arrival/scope UBO staging storage allocated at arena construction. */
	readonly propagationMetadataCapacityBytes: number;
	/** Root plus selected crossing records populated by this preparation. */
	readonly arrivalMetadataStateWriteCount: number;
	/** Selected scope-tile records populated by this preparation. */
	readonly scopeMetadataStateWriteCount: number;
	/** Camera-time backing-store growth; fixed storage makes this structurally zero. */
	readonly arenaGrowthCount: 0;
	/** Selected crossings inspected exactly once while expanding retained geometry. */
	readonly crossingInputCount: number;
	/** Topology-owned triangle indices read while expanding retained geometry. */
	readonly triangleIndexReadCount: number;
	/** Topology-owned xyz scalar values copied into anchor-relative storage. */
	readonly positionScalarReadCount: number;
	/** Oriented anchor-plane scalars written once per selected crossing. */
	readonly arrivalPlaneScalarWriteCount: number;
	/** Selected reciprocal arrival ids resolved without camera-time string lookup. */
	readonly reciprocalArrivalStateReadCount: number;
	/** Fixed expanded triangle storage allocated at arena construction. */
	readonly triangleCapacityBytes: number;
	/** Normal-path portal-owned records created by one preparation. */
	readonly portalOwnedFrameHeapRecordCreationCount: 0;
	/** Largest initialized triangle-vertex tail reached by this preparation. */
	readonly vertexHighWaterCount: number;
}

interface MutablePortalCrossingTriangleStreamTrace extends PortalCrossingTriangleStreamTrace {
	crossingInputCount: number;
	arrivalMetadataStateWriteCount: number;
	arrivalPlaneScalarWriteCount: number;
	triangleIndexReadCount: number;
	positionScalarReadCount: number;
	reciprocalArrivalStateReadCount: number;
	scopeMetadataStateWriteCount: number;
	vertexHighWaterCount: number;
}

/** Reused, non-retained view over arena-owned interleaved triangle records. */
export interface PortalCrossingTriangleStreamView {
	/** Complete fixed-capacity byte view; uploads use `usedByteLength` without slicing it. */
	readonly bytes: Uint8Array;
	readonly usedByteLength: number;
	readonly vertexCount: number;
}

/** Reused non-retained view over the combined fixed propagation-metadata prefix. */
export interface PortalPropagationMetadataStreamView {
	/** Complete fixed-capacity arrival/scope bytes; upload only the initialized prefix. */
	readonly propagationMetadataBytes: Uint8Array;
	readonly arrivalMetadataStateCount: number;
	readonly scopeMetadataStateCount: number;
	readonly usedPropagationMetadataByteLength: number;
}

/** Reused composite view whose geometry and arrival ids are prepared from the same frame. */
export interface PortalPropagationStreamView
	extends
		PortalCrossingTriangleStreamView,
		PortalPropagationMetadataStreamView {
	readonly trace: PortalCrossingTriangleStreamTrace;
}

/**
 * Expand retained indexed apertures and their arrival routes into fixed, GPU-ready streams.
 *
 * Arrival ids follow the culler's stable selected-crossing order: zero is uncovered, one is the
 * root, and crossing ordinal zero begins at two. Both views expire at the next `prepare`.
 */
export class PortalPropagationStreamArena implements PortalPropagationStreamView {
	readonly bytes: Uint8Array;
	readonly propagationMetadataBytes: Uint8Array;
	readonly trace: MutablePortalCrossingTriangleStreamTrace;
	readonly #floatSlots: Float32Array;
	readonly #maximumTriangleVertexCount: number;
	readonly #metadataFloatSlots: Float32Array;
	readonly #metadataUintSlots: Uint32Array;
	readonly #uintSlots: Uint32Array;
	arrivalMetadataStateCount = 0;
	scopeMetadataStateCount = 0;
	usedByteLength = 0;
	usedPropagationMetadataByteLength = 0;
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
		const metadataArena = new ArrayBuffer(
			PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
		);
		this.bytes = new Uint8Array(arena);
		this.propagationMetadataBytes = new Uint8Array(metadataArena);
		this.#metadataFloatSlots = new Float32Array(metadataArena);
		this.#metadataUintSlots = new Uint32Array(metadataArena);
		this.#floatSlots = new Float32Array(arena);
		this.#maximumTriangleVertexCount = maximumTriangleVertexCount;
		this.#uintSlots = new Uint32Array(arena);
		this.trace = {
			arenaCapacityBytes: arena.byteLength + metadataArena.byteLength,
			arenaGrowthCount: 0,
			arrivalMetadataStateWriteCount: 0,
			arrivalPlaneScalarWriteCount: 0,
			crossingInputCount: 0,
			portalOwnedFrameHeapRecordCreationCount: 0,
			positionScalarReadCount: 0,
			propagationMetadataCapacityBytes: metadataArena.byteLength,
			reciprocalArrivalStateReadCount: 0,
			scopeMetadataStateWriteCount: 0,
			triangleIndexReadCount: 0,
			triangleCapacityBytes: arena.byteLength,
			vertexHighWaterCount: 0,
		};
	}

	prepare(
		frame: PortalScopeAtlasFrameView,
		anchorCoordinates: LandblockCoordinates,
	): PortalPropagationStreamView {
		const plannedVertexCount = frame.trace.crossingTriangleVertexCount;
		if (plannedVertexCount > this.#maximumTriangleVertexCount) {
			throw new Error(
				`Portal crossing stream plan ${plannedVertexCount} exceeds arena capacity ${this.#maximumTriangleVertexCount}.`,
			);
		}
		this.vertexCount = 0;
		this.arrivalMetadataStateCount = 0;
		this.scopeMetadataStateCount = 0;
		this.usedByteLength = 0;
		this.usedPropagationMetadataByteLength = 0;
		this.trace.arrivalMetadataStateWriteCount = 0;
		this.trace.arrivalPlaneScalarWriteCount = 0;
		this.trace.crossingInputCount = 0;
		this.trace.positionScalarReadCount = 0;
		this.trace.reciprocalArrivalStateReadCount = 0;
		this.trace.scopeMetadataStateWriteCount = 0;
		this.trace.triangleIndexReadCount = 0;
		this.trace.vertexHighWaterCount = 0;

		const visibility = frame.visibility;
		if (
			visibility.selectedCrossingCount + 1 >
			PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT
		) {
			throw new Error(
				"Portal propagation arrival states exceed R8UI metadata.",
			);
		}
		if (frame.tileCount > PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT) {
			throw new Error(
				"Portal propagation scope records exceed fixed metadata.",
			);
		}
		const scopeMetadataUintOffset =
			PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES /
			Uint32Array.BYTES_PER_ELEMENT;
		const scopeMetadataRecordSlots =
			PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES / Uint32Array.BYTES_PER_ELEMENT;
		for (
			let scopeOrdinal = 0;
			scopeOrdinal < frame.tileCount;
			scopeOrdinal += 1
		) {
			writePortalScopeTileMetadata(
				this.#metadataUintSlots,
				scopeMetadataUintOffset + scopeOrdinal * scopeMetadataRecordSlots,
				frame.tileX(scopeOrdinal),
				frame.tileY(scopeOrdinal),
				frame.tileScreenX(scopeOrdinal),
				frame.tileScreenY(scopeOrdinal),
				frame.tileWidth(scopeOrdinal),
				frame.tileHeight(scopeOrdinal),
			);
		}
		this.scopeMetadataStateCount = frame.tileCount;
		// The culler always selects the root first, so its destination scope ordinal is zero.
		this.#writeArrivalRoute(0, 0, 0, 0);
		this.arrivalMetadataStateCount = 1;
		for (
			let crossingOrdinal = 0;
			crossingOrdinal < visibility.selectedCrossingCount;
			crossingOrdinal += 1
		) {
			const crossing = visibility.selectedCrossing(crossingOrdinal);
			const aperture = crossing.visibilityAperture;
			const outputArrivalStateId =
				FIRST_CROSSING_ARRIVAL_STATE_ID + crossingOrdinal;
			const sourceScopeOrdinal =
				visibility.selectedCrossingSourceScopeOrdinal(crossingOrdinal);
			const targetScopeOrdinal =
				visibility.selectedCrossingTargetScopeOrdinal(crossingOrdinal);
			const reciprocalArrivalStateId =
				visibility.selectedCrossingReciprocalArrivalStateId(crossingOrdinal);
			const depthPolicy = encodeDepthPolicy(crossing.maskDepthPolicy);
			const offsetX =
				(visibility.selectedCrossingVisibilityLandblockX(crossingOrdinal) -
					anchorCoordinates.x) *
				OUTDOOR_LANDBLOCK_WORLD_SIZE;
			const offsetZ =
				-(
					visibility.selectedCrossingVisibilityLandblockY(crossingOrdinal) -
					anchorCoordinates.y
				) * OUTDOOR_LANDBLOCK_WORLD_SIZE;
			const sourceOffsetX =
				(visibility.selectedCrossingSourceLandblockX(crossingOrdinal) -
					anchorCoordinates.x) *
				OUTDOOR_LANDBLOCK_WORLD_SIZE;
			const sourceOffsetZ =
				-(
					visibility.selectedCrossingSourceLandblockY(crossingOrdinal) -
					anchorCoordinates.y
				) * OUTDOOR_LANDBLOCK_WORLD_SIZE;
			const arrivalRecordOrdinal = crossingOrdinal + 1;
			const arrivalFloatOffset =
				(arrivalRecordOrdinal * PORTAL_ARRIVAL_METADATA_RECORD_BYTES) /
				Float32Array.BYTES_PER_ELEMENT;
			writeOrientedPortalArrivalPlane(
				this.#metadataFloatSlots,
				arrivalFloatOffset,
				crossing.sourceAperture.plane,
				crossing.acceptedSide,
				sourceOffsetX,
				sourceOffsetZ,
			);
			this.#writeArrivalRoute(
				arrivalRecordOrdinal,
				targetScopeOrdinal,
				reciprocalArrivalStateId,
				PORTAL_ARRIVAL_METADATA_HAS_ENTRY_PLANE,
			);
			this.arrivalMetadataStateCount += 1;
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
			this.trace.arrivalPlaneScalarWriteCount += 4;
			this.trace.reciprocalArrivalStateReadCount += 1;
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
		this.usedPropagationMetadataByteLength =
			PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES +
			this.scopeMetadataStateCount * PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES;
		this.trace.arrivalMetadataStateWriteCount = this.arrivalMetadataStateCount;
		this.trace.scopeMetadataStateWriteCount = this.scopeMetadataStateCount;
		this.trace.vertexHighWaterCount = this.vertexCount;
		return this;
	}

	#writeArrivalRoute(
		recordOrdinal: number,
		scopeOrdinal: number,
		reciprocalArrivalStateId: number,
		flags: number,
	): void {
		const byteOffset = recordOrdinal * PORTAL_ARRIVAL_METADATA_RECORD_BYTES;
		this.#metadataUintSlots[
			(byteOffset + PORTAL_ARRIVAL_METADATA_SCOPE_OFFSET_BYTES) /
				Uint32Array.BYTES_PER_ELEMENT
		] = scopeOrdinal;
		this.#metadataUintSlots[
			(byteOffset + PORTAL_ARRIVAL_METADATA_RECIPROCAL_OFFSET_BYTES) /
				Uint32Array.BYTES_PER_ELEMENT
		] = reciprocalArrivalStateId;
		this.#metadataUintSlots[
			(byteOffset + PORTAL_ARRIVAL_METADATA_FLAGS_OFFSET_BYTES) /
				Uint32Array.BYTES_PER_ELEMENT
		] = flags;
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
