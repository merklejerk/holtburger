import {
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
	type LandblockCoordinates,
} from "../landblocks";
import { mat4ToFloat32Array } from "../math/matrices";
import type { Mat4 } from "../math/types";
import type { ScenePortalCrossing } from "../scene";
import {
	PORTAL_ARRIVAL_METADATA_FLAGS_OFFSET_BYTES,
	PORTAL_ARRIVAL_METADATA_HAS_ENTRY_PLANE,
	PORTAL_ARRIVAL_METADATA_JUNCTION_OFFSET_BYTES,
	PORTAL_ARRIVAL_METADATA_RECORD_BYTES,
	PORTAL_ARRIVAL_METADATA_RECIPROCAL_OFFSET_BYTES,
	PORTAL_ARRIVAL_METADATA_SCOPE_OFFSET_BYTES,
	PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT,
	writeOrientedPortalArrivalPlane,
} from "./portal-arrival-metadata";
import {
	PORTAL_PROPAGATION_ARRIVAL_METADATA_OFFSET_BYTES,
	PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
	PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES,
	portalPropagationMetadataUsedByteLength,
} from "./portal-propagation-metadata";
import { PORTAL_RENDER_CAPACITY_POLICY } from "./portal-render-capacity-policy";
import {
	portalScopeAtlasMaximumQuadCount,
	type PortalScopeAtlasFrameView,
} from "./portal-scope-atlas-planner";
import {
	PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES,
	writePortalScopeTileMetadata,
} from "./portal-scope-tile-metadata";

/** Interleaved float/integer slots in one expanded crossing-triangle vertex. */
export const PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES = 24;
export const PORTAL_CROSSING_TRIANGLE_POSITION_OFFSET_BYTES = 0;
export const PORTAL_CROSSING_TRIANGLE_OUTPUT_ARRIVAL_OFFSET_BYTES = 12;
export const PORTAL_CROSSING_TRIANGLE_SOURCE_SCOPE_OFFSET_BYTES = 16;
export const PORTAL_CROSSING_TRIANGLE_POLICY_OFFSET_BYTES = 20;

/** Integer shader encoding for an aperture allowed to tie its source surface depth. */
export const PORTAL_CROSSING_DEPTH_POLICY_ALLOW_EQUAL = 0;
/** Integer shader encoding for an aperture required to be strictly nearer than source depth. */
export const PORTAL_CROSSING_DEPTH_POLICY_REJECT_EQUAL = 1;
/** Packed policy bit selecting eye-ray clipping and unconditional source-depth admission. */
export const PORTAL_CROSSING_NEAR_CLIP_RAY_FLAG = 2;

/** Byte stride of one packed instanced reduction/resolve quad (`2 x uvec4` as `8 x uint16`). */
export const PORTAL_QUAD_INSTANCE_STRIDE_BYTES = 16;
export const PORTAL_QUAD_ORIGIN_OFFSET_BYTES = 0;
export const PORTAL_QUAD_EXTENT_OFFSET_BYTES = 8;
/** Fixed GPU staging capacity for combined per-round reduction and resolve quad instances. */
export const PORTAL_MAXIMUM_QUAD_INSTANCE_COUNT =
	portalScopeAtlasMaximumQuadCount(
		PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth,
	);

const MAXIMUM_UINT16 = 0xffff;
const UINT32_BYTES = Uint32Array.BYTES_PER_ELEMENT;
const RECORD_SLOT_COUNT =
	PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES / UINT32_BYTES;
const QUAD_UINT16_SLOT_COUNT =
	PORTAL_QUAD_INSTANCE_STRIDE_BYTES / Uint16Array.BYTES_PER_ELEMENT;
const ROOT_ARRIVAL_STATE_ID = 1;
const FIRST_CROSSING_ARRIVAL_STATE_ID = ROOT_ARRIVAL_STATE_ID + 1;

/** Allocation and input-read facts for one prepared crossing stream. */
interface PortalCrossingTriangleStreamTrace {
	/** Fixed triangle, index, quad, and propagation-metadata storage allocated at construction. */
	readonly arenaCapacityBytes: number;
	/** Fixed combined camera/arrival/scope UBO staging storage allocated at construction. */
	readonly propagationMetadataCapacityBytes: number;
	/** Fixed per-round triangle index staging storage allocated at construction. */
	readonly indexCapacityBytes: number;
	/** Fixed instanced reduction/resolve quad staging storage allocated at construction. */
	readonly quadCapacityBytes: number;
	/** Root plus selected crossing records populated by this preparation. */
	readonly arrivalMetadataStateWriteCount: number;
	/** Selected render-domain tile records populated by this preparation. */
	readonly renderDomainMetadataStateWriteCount: number;
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
	renderDomainMetadataStateWriteCount: number;
	vertexHighWaterCount: number;
}

/** Reused, non-retained view over arena-owned interleaved triangle records. */
export interface PortalCrossingTriangleStreamView {
	/** Complete fixed-capacity byte view; uploads use `usedByteLength` without slicing it. */
	readonly bytes: Uint8Array;
	readonly usedByteLength: number;
	readonly vertexCount: number;
}

/** Reused non-retained view over the fixed camera/arrival/scope propagation block. */
export interface PortalPropagationMetadataStreamView {
	/** Complete fixed-capacity uniform block backing; uploads transfer `usedPropagationMetadataByteLength`. */
	readonly propagationMetadataBytes: Uint8Array;
	readonly arrivalMetadataStateCount: number;
	readonly renderDomainMetadataStateCount: number;
	readonly usedPropagationMetadataByteLength: number;
}

/** Reused non-retained view over per-round index slices, frontier scissors, and quad instances. */
export interface PortalPropagationExecutionScheduleView {
	/** Packed Uint16 triangle vertex indices ordered into contiguous per-round slices. */
	readonly indexBytes: Uint8Array;
	readonly indexCount: number;
	readonly usedIndexByteLength: number;
	/** Packed Uint16 quad instances (`aQuadOrigin` + `aQuadExtent`) for reduction and resolve. */
	readonly quadBytes: Uint8Array;
	readonly quadCount: number;
	readonly usedQuadByteLength: number;
	readonly resolveQuadOffset: number;
	readonly resolveQuadCount: number;
	roundIndexOffset(round: number): number;
	roundIndexCount(round: number): number;
	roundFrontierScissorX(round: number): number;
	roundFrontierScissorY(round: number): number;
	roundFrontierScissorWidth(round: number): number;
	roundFrontierScissorHeight(round: number): number;
	roundReductionQuadOffset(round: number): number;
	roundReductionQuadCount(round: number): number;
}

/** Reused composite view whose geometry, camera, routes, and GPU schedule come from one frame. */
export interface PortalPropagationStreamView
	extends
		PortalCrossingTriangleStreamView,
		PortalPropagationMetadataStreamView,
		PortalPropagationExecutionScheduleView {
	readonly trace: PortalCrossingTriangleStreamTrace;
}

/**
 * Expand retained indexed apertures, arrival routes, and active-aperture GPU schedules into fixed streams.
 *
 * Arrival ids follow the culler's stable selected-crossing order: zero is uncovered, one is the
 * root, and crossing ordinal zero begins at two. All views expire at the next `prepare`.
 */
export class PortalPropagationStreamArena implements PortalPropagationStreamView {
	readonly bytes: Uint8Array;
	readonly indexBytes: Uint8Array;
	readonly propagationMetadataBytes: Uint8Array;
	readonly quadBytes: Uint8Array;
	readonly trace: MutablePortalCrossingTriangleStreamTrace;
	readonly #crossingVertexLengths = new Uint32Array(
		PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT,
	);
	readonly #crossingVertexStarts = new Uint32Array(
		PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT,
	);
	readonly #floatSlots: Float32Array;
	readonly #indexUint16Slots: Uint16Array;
	readonly #maximumPropagationDepth: number;
	readonly #maximumQuadInstanceCount: number;
	readonly #maximumTriangleVertexCount: number;
	readonly #metadataFloatSlots: Float32Array;
	readonly #metadataUintSlots: Uint32Array;
	readonly #quadUint16Slots: Uint16Array;
	readonly #roundFrontierScissorHeight: Uint32Array;
	readonly #roundFrontierScissorWidth: Uint32Array;
	readonly #roundFrontierScissorX: Uint32Array;
	readonly #roundFrontierScissorY: Uint32Array;
	readonly #roundIndexCounts: Uint32Array;
	readonly #roundIndexOffsets: Uint32Array;
	readonly #roundReductionQuadCounts: Uint32Array;
	readonly #roundReductionQuadOffsets: Uint32Array;
	readonly #uintSlots: Uint32Array;
	arrivalMetadataStateCount = 0;
	indexCount = 0;
	quadCount = 0;
	renderDomainMetadataStateCount = 0;
	resolveQuadCount = 0;
	resolveQuadOffset = 0;
	usedByteLength = 0;
	usedIndexByteLength = 0;
	usedPropagationMetadataByteLength = 0;
	usedQuadByteLength = 0;
	vertexCount = 0;
	#traversalDepth = 0;

	constructor(
		maximumTriangleVertexCount: number,
		maximumPropagationDepth: number,
	) {
		if (
			!Number.isSafeInteger(maximumTriangleVertexCount) ||
			maximumTriangleVertexCount < 3 ||
			maximumTriangleVertexCount > MAXIMUM_UINT16 + 1
		) {
			throw new Error(
				"Portal crossing stream capacity must contain at least one triangle within Uint16 index range.",
			);
		}
		if (
			!Number.isSafeInteger(maximumPropagationDepth) ||
			maximumPropagationDepth < 0
		) {
			throw new Error(
				"Portal crossing stream propagation depth must be a nonnegative safe integer.",
			);
		}
		const roundCapacity = Math.max(1, maximumPropagationDepth);
		const maximumQuadInstanceCount = Math.max(
			PORTAL_MAXIMUM_QUAD_INSTANCE_COUNT,
			portalScopeAtlasMaximumQuadCount(maximumPropagationDepth),
		);
		const arena = new ArrayBuffer(
			maximumTriangleVertexCount * PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
		);
		const metadataArena = new ArrayBuffer(
			PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
		);
		const indexArena = new ArrayBuffer(
			roundCapacity *
				maximumTriangleVertexCount *
				Uint16Array.BYTES_PER_ELEMENT,
		);
		const quadArena = new ArrayBuffer(
			maximumQuadInstanceCount * PORTAL_QUAD_INSTANCE_STRIDE_BYTES,
		);
		this.bytes = new Uint8Array(arena);
		this.indexBytes = new Uint8Array(indexArena);
		this.propagationMetadataBytes = new Uint8Array(metadataArena);
		this.quadBytes = new Uint8Array(quadArena);
		this.#metadataFloatSlots = new Float32Array(metadataArena);
		this.#metadataUintSlots = new Uint32Array(metadataArena);
		this.#floatSlots = new Float32Array(arena);
		this.#indexUint16Slots = new Uint16Array(indexArena);
		this.#quadUint16Slots = new Uint16Array(quadArena);
		this.#maximumPropagationDepth = maximumPropagationDepth;
		this.#maximumQuadInstanceCount = maximumQuadInstanceCount;
		this.#maximumTriangleVertexCount = maximumTriangleVertexCount;
		this.#uintSlots = new Uint32Array(arena);
		this.#roundIndexOffsets = new Uint32Array(roundCapacity);
		this.#roundIndexCounts = new Uint32Array(roundCapacity);
		this.#roundFrontierScissorX = new Uint32Array(roundCapacity);
		this.#roundFrontierScissorY = new Uint32Array(roundCapacity);
		this.#roundFrontierScissorWidth = new Uint32Array(roundCapacity);
		this.#roundFrontierScissorHeight = new Uint32Array(roundCapacity);
		this.#roundReductionQuadOffsets = new Uint32Array(roundCapacity);
		this.#roundReductionQuadCounts = new Uint32Array(roundCapacity);
		const scheduleScratchBytes =
			this.#crossingVertexStarts.byteLength +
			this.#crossingVertexLengths.byteLength +
			this.#roundIndexOffsets.byteLength +
			this.#roundIndexCounts.byteLength +
			this.#roundFrontierScissorX.byteLength +
			this.#roundFrontierScissorY.byteLength +
			this.#roundFrontierScissorWidth.byteLength +
			this.#roundFrontierScissorHeight.byteLength +
			this.#roundReductionQuadOffsets.byteLength +
			this.#roundReductionQuadCounts.byteLength;
		this.trace = {
			arenaCapacityBytes:
				arena.byteLength +
				metadataArena.byteLength +
				indexArena.byteLength +
				quadArena.byteLength +
				scheduleScratchBytes,
			arenaGrowthCount: 0,
			arrivalMetadataStateWriteCount: 0,
			arrivalPlaneScalarWriteCount: 0,
			crossingInputCount: 0,
			indexCapacityBytes: indexArena.byteLength,
			portalOwnedFrameHeapRecordCreationCount: 0,
			positionScalarReadCount: 0,
			propagationMetadataCapacityBytes: metadataArena.byteLength,
			quadCapacityBytes: quadArena.byteLength,
			reciprocalArrivalStateReadCount: 0,
			renderDomainMetadataStateWriteCount: 0,
			triangleIndexReadCount: 0,
			triangleCapacityBytes: arena.byteLength,
			vertexHighWaterCount: 0,
		};
	}

	roundIndexOffset(round: number): number {
		return this.#roundIndexOffsets[this.#requireRound(round)]!;
	}

	roundIndexCount(round: number): number {
		return this.#roundIndexCounts[this.#requireRound(round)]!;
	}

	roundFrontierScissorX(round: number): number {
		return this.#roundFrontierScissorX[this.#requireRound(round)]!;
	}

	roundFrontierScissorY(round: number): number {
		return this.#roundFrontierScissorY[this.#requireRound(round)]!;
	}

	roundFrontierScissorWidth(round: number): number {
		return this.#roundFrontierScissorWidth[this.#requireRound(round)]!;
	}

	roundFrontierScissorHeight(round: number): number {
		return this.#roundFrontierScissorHeight[this.#requireRound(round)]!;
	}

	roundReductionQuadOffset(round: number): number {
		return this.#roundReductionQuadOffsets[this.#requireRound(round)]!;
	}

	roundReductionQuadCount(round: number): number {
		return this.#roundReductionQuadCounts[this.#requireRound(round)]!;
	}

	prepare(
		frame: PortalScopeAtlasFrameView,
		anchorCoordinates: LandblockCoordinates,
		clipFromAnchor: Mat4,
	): PortalPropagationStreamView {
		const traversalDepth = frame.commands.traversalDepth;
		const plannedVertexCount =
			traversalDepth === 0 ? 0 : frame.trace.crossingTriangleVertexCount;
		if (plannedVertexCount > this.#maximumTriangleVertexCount) {
			throw new Error(
				`Portal crossing stream plan ${plannedVertexCount} exceeds arena capacity ${this.#maximumTriangleVertexCount}.`,
			);
		}
		if (traversalDepth > this.#maximumPropagationDepth) {
			throw new Error(
				`Portal crossing stream traversal depth ${traversalDepth} exceeds arena capacity ${this.#maximumPropagationDepth}.`,
			);
		}
		if (frame.quadCount > this.#maximumQuadInstanceCount) {
			throw new Error(
				`Portal quad stream count ${frame.quadCount} exceeds arena capacity ${this.#maximumQuadInstanceCount}.`,
			);
		}
		this.vertexCount = 0;
		this.indexCount = 0;
		this.quadCount = 0;
		this.arrivalMetadataStateCount = 0;
		this.renderDomainMetadataStateCount = 0;
		this.usedByteLength = 0;
		this.usedIndexByteLength = 0;
		this.usedPropagationMetadataByteLength = 0;
		this.usedQuadByteLength = 0;
		this.resolveQuadOffset = 0;
		this.resolveQuadCount = 0;
		this.#traversalDepth = 0;
		this.trace.arrivalMetadataStateWriteCount = 0;
		this.trace.arrivalPlaneScalarWriteCount = 0;
		this.trace.crossingInputCount = 0;
		this.trace.positionScalarReadCount = 0;
		this.trace.reciprocalArrivalStateReadCount = 0;
		this.trace.renderDomainMetadataStateWriteCount = 0;
		this.trace.triangleIndexReadCount = 0;
		this.trace.vertexHighWaterCount = 0;
		mat4ToFloat32Array(clipFromAnchor, this.#metadataFloatSlots);

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
		const renderDomainMetadataUintOffset =
			PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES /
			Uint32Array.BYTES_PER_ELEMENT;
		const renderDomainMetadataRecordSlots =
			PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES / Uint32Array.BYTES_PER_ELEMENT;
		for (
			let renderDomainOrdinal = 0;
			renderDomainOrdinal < frame.tileCount;
			renderDomainOrdinal += 1
		) {
			writePortalScopeTileMetadata(
				this.#metadataUintSlots,
				renderDomainMetadataUintOffset +
					renderDomainOrdinal * renderDomainMetadataRecordSlots,
				frame.tileX(renderDomainOrdinal),
				frame.tileY(renderDomainOrdinal),
				frame.tileScreenX(renderDomainOrdinal),
				frame.tileScreenY(renderDomainOrdinal),
				frame.tileWidth(renderDomainOrdinal),
				frame.tileHeight(renderDomainOrdinal),
				frame.directRootOutput && renderDomainOrdinal === 0,
			);
		}
		this.renderDomainMetadataStateCount = frame.tileCount;
		// The culler always selects the root first, so its destination domain ordinal is zero.
		this.#writeArrivalRoute(0, 0, 0, 0, 0);
		this.arrivalMetadataStateCount = 1;
		if (traversalDepth > 0) {
			for (
				let crossingOrdinal = 0;
				crossingOrdinal < visibility.selectedCrossingCount;
				crossingOrdinal += 1
			) {
				const crossing = visibility.selectedCrossing(crossingOrdinal);
				const aperture = crossing.visibilityAperture;
				const outputArrivalStateId =
					FIRST_CROSSING_ARRIVAL_STATE_ID + crossingOrdinal;
				const sourceRenderDomainOrdinal =
					visibility.selectedCrossingSourceRenderDomainOrdinal(crossingOrdinal);
				const targetRenderDomainOrdinal =
					visibility.selectedCrossingTargetRenderDomainOrdinal(crossingOrdinal);
				const reciprocalArrivalStateId =
					visibility.selectedCrossingReciprocalArrivalStateId(crossingOrdinal);
				const packedPolicy =
					encodeDepthPolicy(crossing.maskDepthPolicy) |
					(visibility.selectedCrossingNearPlaneStraddle(crossingOrdinal)
						? PORTAL_CROSSING_NEAR_CLIP_RAY_FLAG
						: 0);
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
					(PORTAL_PROPAGATION_ARRIVAL_METADATA_OFFSET_BYTES +
						arrivalRecordOrdinal * PORTAL_ARRIVAL_METADATA_RECORD_BYTES) /
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
					targetRenderDomainOrdinal,
					reciprocalArrivalStateId,
					PORTAL_ARRIVAL_METADATA_HAS_ENTRY_PLANE,
					// Null means "no junction"; zero is its GPU sentinel.
					crossing.junctionGroupId === null ? 0 : crossing.junctionGroupId,
				);
				this.arrivalMetadataStateCount += 1;
				const crossingVertexStart = this.vertexCount;
				for (let cursor = 0; cursor < aperture.indices.length; cursor += 1) {
					const sourceVertex = aperture.indices[cursor]!;
					const sourceSlot = sourceVertex * 3;
					if (sourceSlot + 2 >= aperture.vertices.length) {
						throw new Error(
							`Portal crossing ${crossing.id} triangle index ${sourceVertex} exceeds its vertex buffer.`,
						);
					}
					const outputSlot = this.vertexCount * RECORD_SLOT_COUNT;
					this.#floatSlots[outputSlot] =
						aperture.vertices[sourceSlot]! + offsetX;
					this.#floatSlots[outputSlot + 1] = aperture.vertices[sourceSlot + 1]!;
					this.#floatSlots[outputSlot + 2] =
						aperture.vertices[sourceSlot + 2]! + offsetZ;
					this.#uintSlots[outputSlot + 3] = outputArrivalStateId;
					this.#uintSlots[outputSlot + 4] = sourceRenderDomainOrdinal;
					this.#uintSlots[outputSlot + 5] = packedPolicy;
					this.vertexCount += 1;
				}
				this.#crossingVertexStarts[crossingOrdinal] = crossingVertexStart;
				this.#crossingVertexLengths[crossingOrdinal] = aperture.indices.length;
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
		}
		this.#writeExecutionSchedule(frame, traversalDepth);
		this.usedByteLength =
			this.vertexCount * PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES;
		this.usedIndexByteLength = this.indexCount * Uint16Array.BYTES_PER_ELEMENT;
		this.usedPropagationMetadataByteLength =
			portalPropagationMetadataUsedByteLength(
				this.renderDomainMetadataStateCount,
			);
		this.usedQuadByteLength =
			this.quadCount * PORTAL_QUAD_INSTANCE_STRIDE_BYTES;
		this.trace.arrivalMetadataStateWriteCount = this.arrivalMetadataStateCount;
		this.trace.renderDomainMetadataStateWriteCount =
			this.renderDomainMetadataStateCount;
		this.trace.vertexHighWaterCount = this.vertexCount;
		return this;
	}

	#writeExecutionSchedule(
		frame: PortalScopeAtlasFrameView,
		traversalDepth: number,
	): void {
		this.#traversalDepth = traversalDepth;
		this.resolveQuadOffset = frame.resolveQuadOffset;
		this.resolveQuadCount = frame.resolveQuadCount;

		let indexCursor = 0;
		for (let round = 0; round < traversalDepth; round += 1) {
			const roundStart = indexCursor;
			const crossingCount = frame.roundCrossingCount(round);
			for (let item = 0; item < crossingCount; item += 1) {
				const crossingOrdinal = frame.roundCrossingOrdinal(round, item);
				const vertexStart = this.#crossingVertexStarts[crossingOrdinal]!;
				const vertexLength = this.#crossingVertexLengths[crossingOrdinal]!;
				if (indexCursor + vertexLength > this.#indexUint16Slots.length) {
					throw new Error("Portal crossing index stream exceeded capacity.");
				}
				for (let offset = 0; offset < vertexLength; offset += 1) {
					this.#indexUint16Slots[indexCursor] = vertexStart + offset;
					indexCursor += 1;
				}
			}
			this.#roundIndexOffsets[round] = roundStart;
			this.#roundIndexCounts[round] = indexCursor - roundStart;
			this.#roundFrontierScissorX[round] = frame.roundFrontierScissorX(round);
			this.#roundFrontierScissorY[round] = frame.roundFrontierScissorY(round);
			this.#roundFrontierScissorWidth[round] =
				frame.roundFrontierScissorWidth(round);
			this.#roundFrontierScissorHeight[round] =
				frame.roundFrontierScissorHeight(round);
			this.#roundReductionQuadOffsets[round] =
				frame.roundReductionQuadOffset(round);
			this.#roundReductionQuadCounts[round] =
				frame.roundReductionQuadCount(round);
		}
		this.indexCount = indexCursor;

		for (let quadIndex = 0; quadIndex < frame.quadCount; quadIndex += 1) {
			const slot = quadIndex * QUAD_UINT16_SLOT_COUNT;
			const atlasX = requireUint16(frame.quadAtlasX(quadIndex), "quad atlas x");
			const atlasY = requireUint16(frame.quadAtlasY(quadIndex), "quad atlas y");
			const screenX = requireUint16(
				frame.quadScreenX(quadIndex),
				"quad screen x",
			);
			const screenY = requireUint16(
				frame.quadScreenY(quadIndex),
				"quad screen y",
			);
			const width = requireUint16(frame.quadWidth(quadIndex), "quad width");
			const height = requireUint16(frame.quadHeight(quadIndex), "quad height");
			const domain = requireUint16(
				frame.quadRenderDomain(quadIndex),
				"quad render domain",
			);
			const mode = requireUint16(frame.quadMode(quadIndex), "quad mode");
			this.#quadUint16Slots[slot] = atlasX;
			this.#quadUint16Slots[slot + 1] = atlasY;
			this.#quadUint16Slots[slot + 2] = screenX;
			this.#quadUint16Slots[slot + 3] = screenY;
			this.#quadUint16Slots[slot + 4] = width;
			this.#quadUint16Slots[slot + 5] = height;
			this.#quadUint16Slots[slot + 6] = domain;
			this.#quadUint16Slots[slot + 7] = mode;
		}
		this.quadCount = frame.quadCount;
	}

	#requireRound(round: number): number {
		if (
			!Number.isInteger(round) ||
			round < 0 ||
			round >= this.#traversalDepth
		) {
			throw new Error(
				`Portal propagation stream round ${round} is unavailable.`,
			);
		}
		return round;
	}

	#writeArrivalRoute(
		recordOrdinal: number,
		renderDomainOrdinal: number,
		reciprocalArrivalStateId: number,
		flags: number,
		junctionGroup: number,
	): void {
		const byteOffset =
			PORTAL_PROPAGATION_ARRIVAL_METADATA_OFFSET_BYTES +
			recordOrdinal * PORTAL_ARRIVAL_METADATA_RECORD_BYTES;
		this.#metadataUintSlots[
			(byteOffset + PORTAL_ARRIVAL_METADATA_SCOPE_OFFSET_BYTES) /
				Uint32Array.BYTES_PER_ELEMENT
		] = renderDomainOrdinal;
		this.#metadataUintSlots[
			(byteOffset + PORTAL_ARRIVAL_METADATA_RECIPROCAL_OFFSET_BYTES) /
				Uint32Array.BYTES_PER_ELEMENT
		] = reciprocalArrivalStateId;
		this.#metadataUintSlots[
			(byteOffset + PORTAL_ARRIVAL_METADATA_FLAGS_OFFSET_BYTES) /
				Uint32Array.BYTES_PER_ELEMENT
		] = flags;
		// The metadata arena is reused across frames; an unconditional write is a correctness
		// requirement, not tidiness. Stale equal ordinals would satisfy the shader's same-junction
		// test and admit an equal-depth advance the convergence bound assumes cannot happen.
		this.#metadataUintSlots[
			(byteOffset + PORTAL_ARRIVAL_METADATA_JUNCTION_OFFSET_BYTES) /
				Uint32Array.BYTES_PER_ELEMENT
		] = junctionGroup;
	}
}

function encodeDepthPolicy(
	policy: ScenePortalCrossing["maskDepthPolicy"],
): number {
	switch (policy) {
		case "allow-equal-depth":
			return PORTAL_CROSSING_DEPTH_POLICY_ALLOW_EQUAL;
		case "reject-equal-depth":
			return PORTAL_CROSSING_DEPTH_POLICY_REJECT_EQUAL;
	}
}

function requireUint16(value: number, name: string): number {
	if (!Number.isInteger(value) || value < 0 || value > MAXIMUM_UINT16) {
		throw new Error(
			`Portal propagation stream ${name} ${value} exceeds Uint16 attribute storage.`,
		);
	}
	return value;
}
