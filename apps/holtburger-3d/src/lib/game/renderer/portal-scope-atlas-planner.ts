import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import type { Mat4 } from "../math/types";
import { PORTAL_QUERY_EPSILON } from "../scene/planar-aperture";
import type { ScenePortalCrossing, SceneTopologyView } from "../scene";
import {
	PORTAL_ARRIVAL_METADATA_PLANE_FLOAT_COUNT,
	PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT,
	writeOrientedPortalArrivalPlane,
} from "./portal-arrival-metadata";
import { PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS } from "./portal-envelope-sampling-glsl";
import {
	PortalScopeWindowCuller,
	type PortalScopeWindowCullerCapacity,
	type PortalScopeWindowCullInput,
	type PortalScopeWindowFrameView,
} from "./portal-scope-window-culler";
import { PORTAL_WINDOW_NDC_EPSILON } from "./portal-view-window";

const MAXIMUM_UINT32 = 0xffff_ffff;
/** Conservative 1-pixel rasterization pad covering 0.5-pixel center + fixed-point subpixel snap. */
const CROSSING_SCREEN_PAD_PIXELS = 1;
const FLOAT32_UNIT_ROUNDING = 2 ** -23;
/** Minimum entry-plane margin retained at near-origin coordinates (`0.5 * PORTAL_QUERY_EPSILON`). */
const MINIMUM_ENTRY_PLANE_MARGIN = PORTAL_QUERY_EPSILON * 0.5;
/** Conservative float32 rounding + perspective-barycentric ULP budget on `dot(n, v) + d`. */
const ENTRY_PLANE_ULP_BUDGET = 64;
/** Conservative float32 homogeneous clip-coordinate ULP budget. */
const HOMOGENEOUS_CLIP_ULP_BUDGET = 32;
/** Conservative float64 rounding budget for homogeneous clip-edge interpolation. */
const FLOAT64_CLIP_INTERPOLATION_SLACK = 4_096 * Number.EPSILON;
/** Minimum positive homogeneous w lower bound required before interval perspective division. */
const MINIMUM_WELL_CONDITIONED_HOMOGENEOUS_W = 1e-6;
/** One triangle (3 vertices) clipped against <= 6 frustum planes produces <= 9 vertices. */
const CLIP_POLYGON_SCRATCH_CAPACITY = 16;
const CANONICAL_HOMOGENEOUS_CLIP_PLANE_COUNT = 6;
const NEAR_RAY_HOMOGENEOUS_CLIP_PLANE_COUNT = 5;
/** Maximum coalesced active-aperture rectangles emitted for one (round, domain) pair. */
const MAXIMUM_COALESCED_RECTS_PER_DOMAIN = 8;
/** Tiny pixel bridge tolerated when merging two nearby aperture boxes saves an instance slot. */
const COALESCING_BRIDGE_AREA_TOLERANCE_PIXELS = 64;
const QUAD_RECORD_SLOT_COUNT = 8;
/** Maximum non-root arrival states representable in one R8UI frontier (`255` states minus root `1`). */
const MAXIMUM_SELECTED_CROSSING_COUNT = PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT - 1;

/** Standard monotonic max-reduction quad (`gl.depthFunc(gl.GREATER)`). */
export const PORTAL_QUAD_MODE_MAX_REDUCE = 0;
/** Round-0 root doorway clamp quad (`gl.depthFunc(gl.ALWAYS)` where `frontier0 != 0`). */
export const PORTAL_QUAD_MODE_ROOT_ROUND0_CLAMP = 1;

/**
 * Exact pigeonhole upper bound on combined reduction and resolve quad instances for `maximumPropagationDepth`.
 *
 * Let `C_max = PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT - 1 = 254` and `K = MAXIMUM_COALESCED_RECTS_PER_DOMAIN = 8`.
 * `#coalesceRects(rawCount)` returns `<= min(rawCount, K)`, and each selected crossing belongs to a
 * single `crossingTargetDomain`:
 * - When `maximumPropagationDepth === 0`, zero reduction quads and `1` root resolve quad are emitted (`1`).
 * - When `maximumPropagationDepth >= 1` (`D` rounds):
 *   - Round `0` root doorway clamp emits `<= min(C_max, K) = K` quads.
 *   - Every non-terminal round `1 .. D - 2` sums `min(raw_d(r - 1), K)` across domains `d`, bounded by
 *     `sum_d raw_d(r - 1) <= C_max`.
 *   - The terminal round `D - 1` collects `round - 1` (when `D >= 2`) plus `round`, bounded by `2 * C_max`
 *     (`C_max` when `D === 1`), giving `<= K + D * C_max` total reduction quads across all rounds.
 *   - Resolve emits `1` root quad plus `<= K` coalesced quads for each of at most `C_max` non-root target
 *     domains (`1 + C_max * K`), yielding `1 + K + D * C_max + C_max * K` (`6,105` at `D = 16`).
 */
export function portalScopeAtlasMaximumQuadCount(
	maximumPropagationDepth: number,
): number {
	if (
		!Number.isSafeInteger(maximumPropagationDepth) ||
		maximumPropagationDepth < 0
	) {
		throw new Error(
			"Portal scope-atlas maximum propagation depth must be a non-negative safe integer.",
		);
	}
	if (maximumPropagationDepth === 0) {
		return 1;
	}
	return (
		1 +
		MAXIMUM_COALESCED_RECTS_PER_DOMAIN +
		maximumPropagationDepth * MAXIMUM_SELECTED_CROSSING_COUNT +
		MAXIMUM_SELECTED_CROSSING_COUNT * MAXIMUM_COALESCED_RECTS_PER_DOMAIN
	);
}

/** Fixed drawing-buffer and scope-atlas resource dimensions for one synchronous plan. */
export interface PortalScopeAtlasResource {
	/** Existing fixed-capacity atlas extent; a camera plan never grows it. */
	readonly atlas: { readonly height: number; readonly width: number };
	/** Camera render extent used to convert conservative NDC windows to integer pixels. */
	readonly drawingBuffer: { readonly height: number; readonly width: number };
	/** Expanded aperture triangle vertices available to one uploaded crossing stream. */
	readonly maximumCrossingTriangleVertexCount: number;
	/** Root plus directed-crossing ids representable by the fixed frontier attachments. */
	readonly maximumArrivalStateCount: number;
}

/** Fixed GPU-command shape derived from one accepted visibility and atlas plan. */
interface PortalScopeAtlasCommandLedger {
	/** Selected crossings expanded once into geometry reused by every propagation command. */
	readonly crossingInstancePreparationCount: number;
	/** One frontier clear for each retained propagation round. */
	readonly frontierClearCommandCount: number;
	/** Crossing instances evaluated across every retained propagation round. */
	readonly maskPropagationInstanceCount: number;
	/** One batched aperture-stream propagation command per retained round. */
	readonly maskPropagationCommandCount: number;
	/** One instanced resolve command when at least one scope tile exists. */
	readonly opaqueCompositeCommandCount: 0 | 1;
	/** Quad instances consumed by the single opaque composite command. */
	readonly opaqueCompositeInstanceCount: number;
	/** Active-aperture quad instances reduced across every retained propagation round. */
	readonly scopeEnvelopeReductionInstanceCount: number;
	/** One instanced scope-envelope reduction command per retained round. */
	readonly scopeEnvelopeReductionCommandCount: number;
	/** Fixed rounds used by the backend, or the shallower accepted cutoff depth. */
	readonly traversalDepth: number;
}

/** Exact allocation and operation counts owned by scope-atlas planning. */
interface PortalScopeAtlasPlanTrace {
	/** Fixed typed scratch allocated with the planner's capacity. */
	readonly arenaCapacityBytes: number;
	/** Camera-time backing-store growth; the atlas planner never grows its arena. */
	readonly arenaGrowthCount: 0;
	/** Fixed atlas pixel capacity supplied by the renderer resource owner. */
	readonly atlasPixelCapacity: number;
	/** Bounding rectangle of every committed tile, including shelf gaps. */
	readonly atlasPackedExtentPixelCount: number;
	/** Whole-frontier retreats caused specifically by atlas packing capacity. */
	readonly atlasCapacityRetreatCount: number;
	/** Whole-frontier retreats caused specifically by arrival-state format capacity. */
	readonly arrivalStateCapacityRetreatCount: number;
	/** Retained crossing aperture vertices copied once into the GPU stream. */
	readonly crossingTriangleVertexCount: number;
	/** Whole-frontier retreats caused specifically by crossing-stream capacity. */
	readonly crossingTriangleVertexCapacityRetreatCount: number;
	/** Whole-frontier retreats caused by any fixed GPU resource capacity. */
	readonly frontierRetreatCount: number;
	/** Packing passes; accepted frames perform one unless atlas capacity forces retreat. */
	readonly packingAttemptCount: number;
	/** Normal-path portal-owned records created by one plan. */
	readonly portalOwnedFrameHeapRecordCreationCount: 0;
	/** Exact comparisons performed by the stable height/width tile merge sort. */
	readonly tileSortComparisonCount: number;
	/** Tile placements attempted across the accepted pass and any declined passes. */
	readonly tilePlacementAttemptCount: number;
	/** Sum of committed conservative tile areas without packing gaps. */
	readonly tilePixelCount: number;
}

interface MutablePortalScopeAtlasCommandLedger extends PortalScopeAtlasCommandLedger {
	crossingInstancePreparationCount: number;
	frontierClearCommandCount: number;
	maskPropagationInstanceCount: number;
	maskPropagationCommandCount: number;
	opaqueCompositeCommandCount: 0 | 1;
	opaqueCompositeInstanceCount: number;
	scopeEnvelopeReductionInstanceCount: number;
	scopeEnvelopeReductionCommandCount: number;
	traversalDepth: number;
}

interface MutablePortalScopeAtlasPlanTrace extends PortalScopeAtlasPlanTrace {
	arenaCapacityBytes: number;
	arenaGrowthCount: 0;
	atlasCapacityRetreatCount: number;
	atlasPixelCapacity: number;
	atlasPackedExtentPixelCount: number;
	arrivalStateCapacityRetreatCount: number;
	crossingTriangleVertexCount: number;
	crossingTriangleVertexCapacityRetreatCount: number;
	frontierRetreatCount: number;
	packingAttemptCount: number;
	portalOwnedFrameHeapRecordCreationCount: 0;
	tileSortComparisonCount: number;
	tilePlacementAttemptCount: number;
	tilePixelCount: number;
}

/** Reused, non-retained scalar view over planner-owned tile storage. */
export interface PortalScopeAtlasFrameView {
	readonly commands: PortalScopeAtlasCommandLedger;
	/** True when the sole root domain has zero active portal rounds and can render without atlas targets. */
	readonly directRootOutput: boolean;
	/** Bounding height of all committed shelf rows in atlas pixels. */
	readonly packedHeight: number;
	/** Bounding width of all committed shelf rows in atlas pixels. */
	readonly packedWidth: number;
	/** Total reduction and resolve quad instances emitted for this frame. */
	readonly quadCount: number;
	/** Instance count in `quad*` consumed by the opaque resolve pass. */
	readonly resolveQuadCount: number;
	/** First instance index in `quad*` consumed by the opaque resolve pass. */
	readonly resolveQuadOffset: number;
	readonly tileCount: number;
	readonly trace: PortalScopeAtlasPlanTrace;
	readonly visibility: PortalScopeWindowFrameView;
	/** Resolve an already-formed renderer run directly to its visibility-island tile. */
	tileOrdinalForRenderScopeKey(renderScopeKey: string): number;
	/** Horizontal clip-space scale routing ordinary camera projection into this tile. */
	tileClipScaleX(ordinal: number): number;
	/** Vertical clip-space scale routing ordinary camera projection into this tile. */
	tileClipScaleY(ordinal: number): number;
	/** Horizontal clip-space offset paired with `tileClipScaleX`. */
	tileClipOffsetX(ordinal: number): number;
	/** Vertical clip-space offset paired with `tileClipScaleY`. */
	tileClipOffsetY(ordinal: number): number;
	/** Integer atlas viewport height for one selected render-domain ordinal. */
	tileHeight(ordinal: number): number;
	/** Integer atlas viewport width for one selected render-domain ordinal. */
	tileWidth(ordinal: number): number;
	/** Integer atlas viewport x origin for one selected render-domain ordinal. */
	tileX(ordinal: number): number;
	/** Integer atlas viewport y origin for one selected render-domain ordinal. */
	tileY(ordinal: number): number;
	/** Drawing-buffer x origin represented by the tile's first texel. */
	tileScreenX(ordinal: number): number;
	/** Drawing-buffer y origin represented by the tile's first texel. */
	tileScreenY(ordinal: number): number;
	/** Drawing-buffer scissor x origin bounding all reachable crossings in `round`. */
	roundFrontierScissorX(round: number): number;
	/** Drawing-buffer scissor y origin bounding all reachable crossings in `round`. */
	roundFrontierScissorY(round: number): number;
	/** Drawing-buffer scissor width bounding all reachable crossings in `round`. */
	roundFrontierScissorWidth(round: number): number;
	/** Drawing-buffer scissor height bounding all reachable crossings in `round`. */
	roundFrontierScissorHeight(round: number): number;
	/** Number of reachable selected crossings scheduled for `round`. */
	roundCrossingCount(round: number): number;
	/** Selected-crossing ordinal scheduled at `index` within `round`. */
	roundCrossingOrdinal(round: number, index: number): number;
	/** First quad instance index reduced on `round`. */
	roundReductionQuadOffset(round: number): number;
	/** Number of quad instances reduced on `round`. */
	roundReductionQuadCount(round: number): number;
	/** Atlas pixel x origin of one emitted reduction or resolve quad instance. */
	quadAtlasX(quadIndex: number): number;
	/** Atlas pixel y origin of one emitted reduction or resolve quad instance. */
	quadAtlasY(quadIndex: number): number;
	/** Drawing-buffer pixel x origin of one emitted reduction or resolve quad instance. */
	quadScreenX(quadIndex: number): number;
	/** Drawing-buffer pixel y origin of one emitted reduction or resolve quad instance. */
	quadScreenY(quadIndex: number): number;
	/** Pixel width of one emitted reduction or resolve quad instance. */
	quadWidth(quadIndex: number): number;
	/** Pixel height of one emitted reduction or resolve quad instance. */
	quadHeight(quadIndex: number): number;
	/** Render-domain ordinal owned by one emitted reduction or resolve quad instance. */
	quadRenderDomain(quadIndex: number): number;
	/** Shader mode (`PORTAL_QUAD_MODE_*`) of one emitted reduction or resolve quad instance. */
	quadMode(quadIndex: number): number;
}

/** Fixed structure-of-arrays storage for domain bounds, placements, transforms, and per-round schedules. */
class PortalScopeAtlasArena {
	readonly activeMaxX: Int32Array;
	readonly activeMaxY: Int32Array;
	readonly activeMinX: Int32Array;
	readonly activeMinY: Int32Array;
	readonly canAdvance: Uint8Array;
	readonly clipAslack = new Float64Array(CLIP_POLYGON_SCRATCH_CAPACITY);
	readonly clipAw = new Float64Array(CLIP_POLYGON_SCRATCH_CAPACITY);
	readonly clipAx = new Float64Array(CLIP_POLYGON_SCRATCH_CAPACITY);
	readonly clipAy = new Float64Array(CLIP_POLYGON_SCRATCH_CAPACITY);
	readonly clipAz = new Float64Array(CLIP_POLYGON_SCRATCH_CAPACITY);
	readonly clipBslack = new Float64Array(CLIP_POLYGON_SCRATCH_CAPACITY);
	readonly clipBw = new Float64Array(CLIP_POLYGON_SCRATCH_CAPACITY);
	readonly clipBx = new Float64Array(CLIP_POLYGON_SCRATCH_CAPACITY);
	readonly clipBy = new Float64Array(CLIP_POLYGON_SCRATCH_CAPACITY);
	readonly clipBz = new Float64Array(CLIP_POLYGON_SCRATCH_CAPACITY);
	readonly clipOffsetX: Float32Array;
	readonly clipOffsetY: Float32Array;
	readonly clipScaleX: Float32Array;
	readonly clipScaleY: Float32Array;
	readonly coalesceMaxX: Int32Array;
	readonly coalesceMaxY: Int32Array;
	readonly coalesceMinX: Int32Array;
	readonly coalesceMinY: Int32Array;
	readonly crossingBaseMaxX: Int32Array;
	readonly crossingBaseMaxY: Int32Array;
	readonly crossingBaseMinX: Int32Array;
	readonly crossingBaseMinY: Int32Array;
	readonly crossingCapacity: number;
	readonly crossingJunctionGroup: Uint32Array;
	readonly crossingPlanes: Float32Array;
	readonly crossingReciprocalState: Uint32Array;
	readonly crossingSourceDomain: Uint32Array;
	readonly crossingTargetDomain: Uint32Array;
	readonly height: Uint32Array;
	readonly minimumX: Uint32Array;
	readonly minimumY: Uint32Array;
	readonly quads: Uint32Array;
	readonly roundCapacity: number;
	readonly roundCrossingCounts: Uint32Array;
	readonly roundCrossingOffsets: Uint32Array;
	readonly roundCrossingOrdinals: Uint32Array;
	readonly roundFrontierScissorHeight: Uint32Array;
	readonly roundFrontierScissorWidth: Uint32Array;
	readonly roundFrontierScissorX: Uint32Array;
	readonly roundFrontierScissorY: Uint32Array;
	readonly roundReductionQuadCounts: Uint32Array;
	readonly roundReductionQuadOffsets: Uint32Array;
	readonly sortOrdinals: Uint32Array;
	readonly sortScratch: Uint32Array;
	readonly typedCapacityBytes: number;
	readonly width: Uint32Array;
	readonly x: Uint32Array;
	readonly y: Uint32Array;

	constructor(tileCapacity: number, maximumPropagationDepth: number) {
		const crossingCapacity = PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT;
		const roundCapacity = Math.max(1, maximumPropagationDepth);
		const activeSlotCount = roundCapacity * crossingCapacity;
		const coalesceCapacity = Math.max(
			crossingCapacity * 2,
			roundCapacity * MAXIMUM_COALESCED_RECTS_PER_DOMAIN,
		);
		const quadCapacity = portalScopeAtlasMaximumQuadCount(
			maximumPropagationDepth,
		);
		this.crossingCapacity = crossingCapacity;
		this.roundCapacity = roundCapacity;
		this.clipOffsetX = new Float32Array(tileCapacity);
		this.clipOffsetY = new Float32Array(tileCapacity);
		this.clipScaleX = new Float32Array(tileCapacity);
		this.clipScaleY = new Float32Array(tileCapacity);
		this.height = new Uint32Array(tileCapacity);
		this.minimumX = new Uint32Array(tileCapacity);
		this.minimumY = new Uint32Array(tileCapacity);
		this.sortOrdinals = new Uint32Array(tileCapacity);
		this.sortScratch = new Uint32Array(tileCapacity);
		this.width = new Uint32Array(tileCapacity);
		this.x = new Uint32Array(tileCapacity);
		this.y = new Uint32Array(tileCapacity);
		this.crossingBaseMinX = new Int32Array(crossingCapacity);
		this.crossingBaseMinY = new Int32Array(crossingCapacity);
		this.crossingBaseMaxX = new Int32Array(crossingCapacity);
		this.crossingBaseMaxY = new Int32Array(crossingCapacity);
		this.crossingSourceDomain = new Uint32Array(crossingCapacity);
		this.crossingTargetDomain = new Uint32Array(crossingCapacity);
		this.crossingReciprocalState = new Uint32Array(crossingCapacity);
		this.crossingJunctionGroup = new Uint32Array(crossingCapacity);
		this.crossingPlanes = new Float32Array(
			crossingCapacity * PORTAL_ARRIVAL_METADATA_PLANE_FLOAT_COUNT,
		);
		this.canAdvance = new Uint8Array(crossingCapacity * crossingCapacity);
		this.activeMinX = new Int32Array(activeSlotCount);
		this.activeMinY = new Int32Array(activeSlotCount);
		this.activeMaxX = new Int32Array(activeSlotCount);
		this.activeMaxY = new Int32Array(activeSlotCount);
		this.roundCrossingOffsets = new Uint32Array(roundCapacity);
		this.roundCrossingCounts = new Uint32Array(roundCapacity);
		this.roundCrossingOrdinals = new Uint32Array(activeSlotCount);
		this.roundFrontierScissorX = new Uint32Array(roundCapacity);
		this.roundFrontierScissorY = new Uint32Array(roundCapacity);
		this.roundFrontierScissorWidth = new Uint32Array(roundCapacity);
		this.roundFrontierScissorHeight = new Uint32Array(roundCapacity);
		this.roundReductionQuadOffsets = new Uint32Array(roundCapacity);
		this.roundReductionQuadCounts = new Uint32Array(roundCapacity);
		this.coalesceMinX = new Int32Array(coalesceCapacity);
		this.coalesceMinY = new Int32Array(coalesceCapacity);
		this.coalesceMaxX = new Int32Array(coalesceCapacity);
		this.coalesceMaxY = new Int32Array(coalesceCapacity);
		this.quads = new Uint32Array(quadCapacity * QUAD_RECORD_SLOT_COUNT);
		this.typedCapacityBytes =
			this.clipOffsetX.byteLength +
			this.clipOffsetY.byteLength +
			this.clipScaleX.byteLength +
			this.clipScaleY.byteLength +
			this.height.byteLength +
			this.minimumX.byteLength +
			this.minimumY.byteLength +
			this.sortOrdinals.byteLength +
			this.sortScratch.byteLength +
			this.width.byteLength +
			this.x.byteLength +
			this.y.byteLength +
			this.clipAx.byteLength +
			this.clipAy.byteLength +
			this.clipAz.byteLength +
			this.clipAw.byteLength +
			this.clipAslack.byteLength +
			this.clipBx.byteLength +
			this.clipBy.byteLength +
			this.clipBz.byteLength +
			this.clipBw.byteLength +
			this.clipBslack.byteLength +
			this.crossingBaseMinX.byteLength +
			this.crossingBaseMinY.byteLength +
			this.crossingBaseMaxX.byteLength +
			this.crossingBaseMaxY.byteLength +
			this.crossingSourceDomain.byteLength +
			this.crossingTargetDomain.byteLength +
			this.crossingReciprocalState.byteLength +
			this.crossingJunctionGroup.byteLength +
			this.crossingPlanes.byteLength +
			this.canAdvance.byteLength +
			this.activeMinX.byteLength +
			this.activeMinY.byteLength +
			this.activeMaxX.byteLength +
			this.activeMaxY.byteLength +
			this.roundCrossingOffsets.byteLength +
			this.roundCrossingCounts.byteLength +
			this.roundCrossingOrdinals.byteLength +
			this.roundFrontierScissorX.byteLength +
			this.roundFrontierScissorY.byteLength +
			this.roundFrontierScissorWidth.byteLength +
			this.roundFrontierScissorHeight.byteLength +
			this.roundReductionQuadOffsets.byteLength +
			this.roundReductionQuadCounts.byteLength +
			this.coalesceMinX.byteLength +
			this.coalesceMinY.byteLength +
			this.coalesceMaxX.byteLength +
			this.coalesceMaxY.byteLength +
			this.quads.byteLength;
	}
}

class MutablePortalScopeAtlasFrameView implements PortalScopeAtlasFrameView {
	/** Current culler frame, absent only before the planner's first synchronous plan. */
	#visibility: PortalScopeWindowFrameView | null = null;
	readonly commands: MutablePortalScopeAtlasCommandLedger = {
		crossingInstancePreparationCount: 0,
		frontierClearCommandCount: 0,
		maskPropagationInstanceCount: 0,
		maskPropagationCommandCount: 0,
		opaqueCompositeCommandCount: 0,
		opaqueCompositeInstanceCount: 0,
		scopeEnvelopeReductionInstanceCount: 0,
		scopeEnvelopeReductionCommandCount: 0,
		traversalDepth: 0,
	};
	directRootOutput = false;
	packedHeight = 0;
	packedWidth = 0;
	quadCount = 0;
	resolveQuadCount = 0;
	resolveQuadOffset = 0;
	tileCount = 0;
	readonly trace: MutablePortalScopeAtlasPlanTrace = {
		arenaCapacityBytes: 0,
		arenaGrowthCount: 0,
		atlasCapacityRetreatCount: 0,
		atlasPackedExtentPixelCount: 0,
		atlasPixelCapacity: 0,
		arrivalStateCapacityRetreatCount: 0,
		crossingTriangleVertexCount: 0,
		crossingTriangleVertexCapacityRetreatCount: 0,
		frontierRetreatCount: 0,
		packingAttemptCount: 0,
		portalOwnedFrameHeapRecordCreationCount: 0,
		tilePixelCount: 0,
		tilePlacementAttemptCount: 0,
		tileSortComparisonCount: 0,
	};
	constructor(readonly arena: PortalScopeAtlasArena) {}

	get visibility(): PortalScopeWindowFrameView {
		if (!this.#visibility) {
			throw new Error(
				"Portal scope-atlas frame is unavailable before its first plan.",
			);
		}
		return this.#visibility;
	}

	setVisibility(visibility: PortalScopeWindowFrameView): void {
		this.#visibility = visibility;
	}

	tileOrdinalForRenderScopeKey(renderScopeKey: string): number {
		const ordinal = this.visibility.selectedRenderDomainOrdinal(renderScopeKey);
		if (ordinal === null) {
			throw new Error(
				`Portal renderer scope key ${renderScopeKey} has no selected atlas tile.`,
			);
		}
		return ordinal;
	}

	tileClipOffsetX(ordinal: number): number {
		return this.arena.clipOffsetX[this.#tileOrdinal(ordinal)]!;
	}

	tileClipOffsetY(ordinal: number): number {
		return this.arena.clipOffsetY[this.#tileOrdinal(ordinal)]!;
	}

	tileClipScaleX(ordinal: number): number {
		return this.arena.clipScaleX[this.#tileOrdinal(ordinal)]!;
	}

	tileClipScaleY(ordinal: number): number {
		return this.arena.clipScaleY[this.#tileOrdinal(ordinal)]!;
	}

	tileHeight(ordinal: number): number {
		return this.arena.height[this.#tileOrdinal(ordinal)]!;
	}

	tileWidth(ordinal: number): number {
		return this.arena.width[this.#tileOrdinal(ordinal)]!;
	}

	tileX(ordinal: number): number {
		return this.arena.x[this.#tileOrdinal(ordinal)]!;
	}

	tileY(ordinal: number): number {
		return this.arena.y[this.#tileOrdinal(ordinal)]!;
	}

	tileScreenX(ordinal: number): number {
		return this.arena.minimumX[this.#tileOrdinal(ordinal)]!;
	}

	tileScreenY(ordinal: number): number {
		return this.arena.minimumY[this.#tileOrdinal(ordinal)]!;
	}

	roundFrontierScissorX(round: number): number {
		return this.arena.roundFrontierScissorX[this.#roundOrdinal(round)]!;
	}

	roundFrontierScissorY(round: number): number {
		return this.arena.roundFrontierScissorY[this.#roundOrdinal(round)]!;
	}

	roundFrontierScissorWidth(round: number): number {
		return this.arena.roundFrontierScissorWidth[this.#roundOrdinal(round)]!;
	}

	roundFrontierScissorHeight(round: number): number {
		return this.arena.roundFrontierScissorHeight[this.#roundOrdinal(round)]!;
	}

	roundCrossingCount(round: number): number {
		return this.arena.roundCrossingCounts[this.#roundOrdinal(round)]!;
	}

	roundCrossingOrdinal(round: number, index: number): number {
		const validRound = this.#roundOrdinal(round);
		const count = this.arena.roundCrossingCounts[validRound]!;
		if (!Number.isInteger(index) || index < 0 || index >= count) {
			throw new Error(
				`Portal scope-atlas round ${round} crossing index ${index} is unavailable.`,
			);
		}
		return this.arena.roundCrossingOrdinals[
			this.arena.roundCrossingOffsets[validRound]! + index
		]!;
	}

	roundReductionQuadOffset(round: number): number {
		return this.arena.roundReductionQuadOffsets[this.#roundOrdinal(round)]!;
	}

	roundReductionQuadCount(round: number): number {
		return this.arena.roundReductionQuadCounts[this.#roundOrdinal(round)]!;
	}

	quadAtlasX(quadIndex: number): number {
		return this.arena.quads[this.#quadSlot(quadIndex)]!;
	}

	quadAtlasY(quadIndex: number): number {
		return this.arena.quads[this.#quadSlot(quadIndex) + 1]!;
	}

	quadScreenX(quadIndex: number): number {
		return this.arena.quads[this.#quadSlot(quadIndex) + 2]!;
	}

	quadScreenY(quadIndex: number): number {
		return this.arena.quads[this.#quadSlot(quadIndex) + 3]!;
	}

	quadWidth(quadIndex: number): number {
		return this.arena.quads[this.#quadSlot(quadIndex) + 4]!;
	}

	quadHeight(quadIndex: number): number {
		return this.arena.quads[this.#quadSlot(quadIndex) + 5]!;
	}

	quadRenderDomain(quadIndex: number): number {
		return this.arena.quads[this.#quadSlot(quadIndex) + 6]!;
	}

	quadMode(quadIndex: number): number {
		return this.arena.quads[this.#quadSlot(quadIndex) + 7]!;
	}

	#quadSlot(quadIndex: number): number {
		if (
			!Number.isInteger(quadIndex) ||
			quadIndex < 0 ||
			quadIndex >= this.quadCount
		) {
			throw new Error(
				`Portal scope-atlas quad instance ${quadIndex} is unavailable.`,
			);
		}
		return quadIndex * QUAD_RECORD_SLOT_COUNT;
	}

	#roundOrdinal(round: number): number {
		if (
			!Number.isInteger(round) ||
			round < 0 ||
			round >= this.commands.traversalDepth
		) {
			throw new Error(`Portal scope-atlas round ${round} is unavailable.`);
		}
		return round;
	}

	#tileOrdinal(ordinal: number): number {
		if (
			!Number.isInteger(ordinal) ||
			ordinal < 0 ||
			ordinal >= this.tileCount
		) {
			throw new Error(
				`Portal scope-atlas tile ordinal ${ordinal} is unavailable.`,
			);
		}
		return ordinal;
	}
}

/**
 * Synchronous visibility and scope-atlas planner with fixed camera-time storage.
 *
 * Packing uses stable next-fit decreasing-height shelves. This intentionally favors a small,
 * auditable O(S log S) accepted path over a fragmentation-prone free-rectangle object graph.
 */
export class PortalScopeAtlasPlanner {
	readonly #arena: PortalScopeAtlasArena;
	readonly #culler: PortalScopeWindowCuller;
	readonly #frame: MutablePortalScopeAtlasFrameView;
	readonly #maximumPathDepth: number;
	readonly #maximumTileCount: number;

	constructor(
		capacity: PortalScopeWindowCullerCapacity,
		maximumPropagationDepth: number,
	) {
		if (
			!Number.isSafeInteger(maximumPropagationDepth) ||
			maximumPropagationDepth < 0
		)
			throw new Error(
				"Portal GPU propagation depth must be a nonnegative safe integer.",
			);
		this.#culler = new PortalScopeWindowCuller(capacity);
		this.#maximumPathDepth = maximumPropagationDepth;
		this.#maximumTileCount = capacity.maximumWorkItemCount;
		this.#arena = new PortalScopeAtlasArena(
			capacity.maximumWorkItemCount,
			maximumPropagationDepth,
		);
		this.#frame = new MutablePortalScopeAtlasFrameView(this.#arena);
		this.#frame.trace.arenaCapacityBytes = this.#arena.typedCapacityBytes;
	}

	plan(
		topology: SceneTopologyView,
		input: PortalScopeWindowCullInput,
		resource: PortalScopeAtlasResource,
	): PortalScopeAtlasFrameView {
		validateResource(resource, input, this.#maximumTileCount);
		const visibility = this.#culler.cull(topology, input);
		this.#beginFrame(visibility, resource);
		const arrivalStateLimit = Math.min(
			resource.maximumArrivalStateCount,
			PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT,
		);
		while (visibility.selectedCrossingCount + 1 > arrivalStateLimit) {
			if (!this.#culler.declineDeepestCompletedFrontier(visibility)) {
				throw new Error(
					"Portal scope atlas cannot retain its root arrival state.",
				);
			}
			this.#frame.trace.arrivalStateCapacityRetreatCount += 1;
			this.#frame.trace.frontierRetreatCount += 1;
		}
		let crossingTriangleVertexCount =
			this.#countCrossingTriangleVertices(visibility);
		while (
			crossingTriangleVertexCount > resource.maximumCrossingTriangleVertexCount
		) {
			if (!this.#culler.declineDeepestCompletedFrontier(visibility)) {
				throw new Error(
					"Portal scope atlas cannot retain one crossing triangle.",
				);
			}
			this.#frame.trace.crossingTriangleVertexCapacityRetreatCount += 1;
			this.#frame.trace.frontierRetreatCount += 1;
			crossingTriangleVertexCount =
				this.#countCrossingTriangleVertices(visibility);
		}
		while (true) {
			this.#frame.trace.packingAttemptCount += 1;
			this.#deriveTileBounds(visibility, resource);
			const sortedOrdinals = this.#sortTileOrdinals(
				visibility.selectedRenderDomainCount,
			);
			if (
				this.#packTiles(
					sortedOrdinals,
					visibility.selectedRenderDomainCount,
					resource,
				)
			) {
				break;
			}
			if (!this.#culler.declineDeepestCompletedFrontier(visibility)) {
				throw new Error(
					"Portal scope atlas cannot retain the root drawing-buffer tile.",
				);
			}
			this.#frame.trace.atlasCapacityRetreatCount += 1;
			this.#frame.trace.frontierRetreatCount += 1;
			crossingTriangleVertexCount =
				this.#countCrossingTriangleVertices(visibility);
		}
		this.#frame.trace.crossingTriangleVertexCount = crossingTriangleVertexCount;
		this.#frame.tileCount = visibility.selectedRenderDomainCount;
		this.#buildExecutionSchedule(visibility, input, resource);
		return this.#frame;
	}

	#beginFrame(
		visibility: PortalScopeWindowFrameView,
		resource: PortalScopeAtlasResource,
	): void {
		this.#frame.setVisibility(visibility);
		this.#frame.directRootOutput = false;
		this.#frame.packedHeight = 0;
		this.#frame.packedWidth = 0;
		this.#frame.quadCount = 0;
		this.#frame.resolveQuadCount = 0;
		this.#frame.resolveQuadOffset = 0;
		this.#frame.tileCount = 0;
		this.#frame.trace.atlasPixelCapacity =
			resource.atlas.width * resource.atlas.height;
		this.#frame.trace.atlasPackedExtentPixelCount = 0;
		this.#frame.trace.atlasCapacityRetreatCount = 0;
		this.#frame.trace.arrivalStateCapacityRetreatCount = 0;
		this.#frame.trace.crossingTriangleVertexCount = 0;
		this.#frame.trace.crossingTriangleVertexCapacityRetreatCount = 0;
		this.#frame.trace.frontierRetreatCount = 0;
		this.#frame.trace.packingAttemptCount = 0;
		this.#frame.trace.tilePixelCount = 0;
		this.#frame.trace.tilePlacementAttemptCount = 0;
		this.#frame.trace.tileSortComparisonCount = 0;
	}

	#countCrossingTriangleVertices(
		visibility: PortalScopeWindowFrameView,
	): number {
		let count = 0;
		for (
			let ordinal = 0;
			ordinal < visibility.selectedCrossingCount;
			ordinal += 1
		) {
			const crossing = visibility.selectedCrossing(ordinal);
			const apertureCount = crossing.visibilityAperture.indices.length;
			if (apertureCount === 0 || apertureCount % 3 !== 0) {
				throw new Error(
					`Portal crossing ${crossing.id} has an invalid triangle stream.`,
				);
			}
			count += apertureCount;
		}
		return count;
	}

	#deriveTileBounds(
		visibility: PortalScopeWindowFrameView,
		resource: PortalScopeAtlasResource,
	): void {
		const drawingWidth = resource.drawingBuffer.width;
		const drawingHeight = resource.drawingBuffer.height;
		for (
			let ordinal = 0;
			ordinal < visibility.selectedRenderDomainCount;
			ordinal += 1
		) {
			this.#arena.minimumX[ordinal] = drawingWidth;
			this.#arena.minimumY[ordinal] = drawingHeight;
			this.#arena.width[ordinal] = 0;
			this.#arena.height[ordinal] = 0;
			this.#arena.sortOrdinals[ordinal] = ordinal;
		}
		for (
			let scopeOrdinal = 0;
			scopeOrdinal < visibility.selectedScopeCount;
			scopeOrdinal += 1
		) {
			const minimumNdcX = visibility.selectedMinimumNdcX(scopeOrdinal);
			const minimumNdcY = visibility.selectedMinimumNdcY(scopeOrdinal);
			const maximumNdcX = visibility.selectedMaximumNdcX(scopeOrdinal);
			const maximumNdcY = visibility.selectedMaximumNdcY(scopeOrdinal);
			const minimumX = clampPixel(
				Math.floor(((minimumNdcX + 1) * drawingWidth) / 2),
				drawingWidth,
			);
			const minimumY = clampPixel(
				Math.floor(((minimumNdcY + 1) * drawingHeight) / 2),
				drawingHeight,
			);
			const maximumX = clampPixel(
				Math.ceil(((maximumNdcX + 1) * drawingWidth) / 2),
				drawingWidth,
			);
			const maximumY = clampPixel(
				Math.ceil(((maximumNdcY + 1) * drawingHeight) / 2),
				drawingHeight,
			);
			const renderDomainOrdinal =
				visibility.selectedScopeRenderDomainOrdinal(scopeOrdinal);
			const previousMinimumX = this.#arena.minimumX[renderDomainOrdinal]!;
			const previousMinimumY = this.#arena.minimumY[renderDomainOrdinal]!;
			const previousWidth = this.#arena.width[renderDomainOrdinal]!;
			const previousHeight = this.#arena.height[renderDomainOrdinal]!;
			if (previousWidth === 0 || previousHeight === 0) {
				this.#arena.minimumX[renderDomainOrdinal] = minimumX;
				this.#arena.minimumY[renderDomainOrdinal] = minimumY;
				this.#arena.width[renderDomainOrdinal] = Math.max(
					1,
					maximumX - minimumX,
				);
				this.#arena.height[renderDomainOrdinal] = Math.max(
					1,
					maximumY - minimumY,
				);
				continue;
			}
			const previousMaximumX = previousMinimumX + previousWidth;
			const previousMaximumY = previousMinimumY + previousHeight;
			const domainMinimumX = Math.min(previousMinimumX, minimumX);
			const domainMinimumY = Math.min(previousMinimumY, minimumY);
			this.#arena.minimumX[renderDomainOrdinal] = domainMinimumX;
			this.#arena.minimumY[renderDomainOrdinal] = domainMinimumY;
			this.#arena.width[renderDomainOrdinal] =
				Math.max(previousMaximumX, maximumX) - domainMinimumX;
			this.#arena.height[renderDomainOrdinal] =
				Math.max(previousMaximumY, maximumY) - domainMinimumY;
		}
		for (
			let ordinal = 0;
			ordinal < visibility.selectedRenderDomainCount;
			ordinal += 1
		) {
			if (
				this.#arena.width[ordinal] === 0 ||
				this.#arena.height[ordinal] === 0
			) {
				throw new Error(
					`Portal render domain ${ordinal} has no selected window.`,
				);
			}
		}
	}

	#sortTileOrdinals(count: number): Uint32Array {
		let source = this.#arena.sortOrdinals;
		let target = this.#arena.sortScratch;
		for (let runWidth = 1; runWidth < count; runWidth *= 2) {
			for (let start = 0; start < count; start += runWidth * 2) {
				const middle = Math.min(start + runWidth, count);
				const end = Math.min(start + runWidth * 2, count);
				let left = start;
				let right = middle;
				for (let output = start; output < end; output += 1) {
					if (left >= middle) {
						target[output] = source[right]!;
						right += 1;
					} else if (right >= end) {
						target[output] = source[left]!;
						left += 1;
					} else {
						this.#frame.trace.tileSortComparisonCount += 1;
						if (this.#tilePrecedes(source[left]!, source[right]!)) {
							target[output] = source[left]!;
							left += 1;
						} else {
							target[output] = source[right]!;
							right += 1;
						}
					}
				}
			}
			const previousSource = source;
			source = target;
			target = previousSource;
		}
		return source;
	}

	#tilePrecedes(left: number, right: number): boolean {
		const heightDifference =
			this.#arena.height[left]! - this.#arena.height[right]!;
		if (heightDifference !== 0) return heightDifference > 0;
		const widthDifference =
			this.#arena.width[left]! - this.#arena.width[right]!;
		if (widthDifference !== 0) return widthDifference > 0;
		return left < right;
	}

	#packTiles(
		sortedOrdinals: Uint32Array,
		count: number,
		resource: PortalScopeAtlasResource,
	): boolean {
		let cursorX = 0;
		let cursorY = 0;
		let shelfHeight = 0;
		let usedWidth = 0;
		let tilePixelCount = 0;
		for (let index = 0; index < count; index += 1) {
			const ordinal = sortedOrdinals[index]!;
			const width = this.#arena.width[ordinal]!;
			const height = this.#arena.height[ordinal]!;
			this.#frame.trace.tilePlacementAttemptCount += 1;
			if (width > resource.atlas.width || height > resource.atlas.height) {
				return false;
			}
			if (cursorX > 0 && cursorX + width > resource.atlas.width) {
				cursorX = 0;
				cursorY += shelfHeight;
				shelfHeight = 0;
			}
			if (cursorY + height > resource.atlas.height) return false;
			this.#arena.x[ordinal] = cursorX;
			this.#arena.y[ordinal] = cursorY;
			this.#writeClipTransform(ordinal, resource);
			cursorX += width;
			shelfHeight = Math.max(shelfHeight, height);
			usedWidth = Math.max(usedWidth, cursorX);
			tilePixelCount += width * height;
		}
		const packedHeight = cursorY + shelfHeight;
		this.#frame.packedWidth = usedWidth;
		this.#frame.packedHeight = packedHeight;
		this.#frame.trace.atlasPackedExtentPixelCount = usedWidth * packedHeight;
		this.#frame.trace.tilePixelCount = tilePixelCount;
		return true;
	}

	#writeClipTransform(
		ordinal: number,
		resource: PortalScopeAtlasResource,
	): void {
		const tileWidth = this.#arena.width[ordinal]!;
		const tileHeight = this.#arena.height[ordinal]!;
		const drawingWidth = resource.drawingBuffer.width;
		const drawingHeight = resource.drawingBuffer.height;
		this.#arena.clipScaleX[ordinal] = drawingWidth / tileWidth;
		this.#arena.clipScaleY[ordinal] = drawingHeight / tileHeight;
		// WebGL NDC and viewport coordinates are both bottom-origin, so x and y share this transform.
		this.#arena.clipOffsetX[ordinal] =
			(drawingWidth - 2 * this.#arena.minimumX[ordinal]!) / tileWidth - 1;
		this.#arena.clipOffsetY[ordinal] =
			(drawingHeight - 2 * this.#arena.minimumY[ordinal]!) / tileHeight - 1;
	}

	#buildExecutionSchedule(
		visibility: PortalScopeWindowFrameView,
		input: PortalScopeWindowCullInput,
		resource: PortalScopeAtlasResource,
	): void {
		const retainedDepthLimit =
			visibility.status === "complete"
				? this.#maximumPathDepth
				: Math.min(this.#maximumPathDepth, visibility.completedDepth);
		// Per-pixel entry depth must strictly increase along a path, so no directed crossing can
		// recur and crossing count is a universal propagation bound without a convergence readback
		// or topology walk. The one exemption — an equal-depth advance across a scene-proven
		// coincident junction — preserves this up to the scene's numerical overlap tolerance:
		// preparation bounds overlapping same-domain exits at two per interior point, and reciprocal
		// suppression removes one. A same-depth walk takes at most one junction step before depth
		// strictly increases again outside that contact tolerance.
		const depthCap = Math.min(
			retainedDepthLimit,
			visibility.selectedCrossingCount,
		);
		const crossingCount = visibility.selectedCrossingCount;
		this.#frame.commands.crossingInstancePreparationCount = crossingCount;
		if (depthCap > 0) {
			this.#prepareCrossingScheduleInputs(visibility, input, resource);
		}
		const effectiveTraversalDepth =
			depthCap > 0
				? this.#computeActiveCrossingRounds(crossingCount, depthCap)
				: 0;
		if (effectiveTraversalDepth === 0) {
			this.#frame.directRootOutput = this.#frame.tileCount === 1;
			this.#frame.resolveQuadOffset = 0;
			if (this.#frame.tileCount > 0) {
				const minX = this.#arena.minimumX[0]!;
				const minY = this.#arena.minimumY[0]!;
				this.#emitQuad(
					0,
					minX,
					minY,
					minX + this.#arena.width[0]!,
					minY + this.#arena.height[0]!,
					PORTAL_QUAD_MODE_MAX_REDUCE,
				);
			}
			this.#frame.resolveQuadCount = this.#frame.quadCount;
			this.#frame.commands.frontierClearCommandCount = 0;
			this.#frame.commands.maskPropagationCommandCount = 0;
			this.#frame.commands.maskPropagationInstanceCount = 0;
			this.#frame.commands.opaqueCompositeCommandCount =
				this.#frame.tileCount === 0 ? 0 : 1;
			this.#frame.commands.opaqueCompositeInstanceCount =
				this.#frame.resolveQuadCount;
			this.#frame.commands.scopeEnvelopeReductionCommandCount = 0;
			this.#frame.commands.scopeEnvelopeReductionInstanceCount = 0;
			this.#frame.commands.traversalDepth = 0;
			return;
		}

		let propagationInstanceCount = 0;
		for (let round = 0; round < effectiveTraversalDepth; round += 1) {
			propagationInstanceCount += this.#arena.roundCrossingCounts[round]!;
			this.#emitRoundReductionQuads(
				round,
				effectiveTraversalDepth,
				crossingCount,
			);
		}
		const reductionQuadCount = this.#frame.quadCount;
		this.#frame.resolveQuadOffset = reductionQuadCount;
		this.#emitResolveQuads(reductionQuadCount);
		this.#frame.resolveQuadCount = this.#frame.quadCount - reductionQuadCount;

		this.#frame.commands.frontierClearCommandCount = effectiveTraversalDepth;
		this.#frame.commands.maskPropagationCommandCount = effectiveTraversalDepth;
		this.#frame.commands.maskPropagationInstanceCount =
			propagationInstanceCount;
		this.#frame.commands.opaqueCompositeCommandCount = 1;
		this.#frame.commands.opaqueCompositeInstanceCount =
			this.#frame.resolveQuadCount;
		this.#frame.commands.scopeEnvelopeReductionCommandCount =
			effectiveTraversalDepth;
		this.#frame.commands.scopeEnvelopeReductionInstanceCount =
			reductionQuadCount;
		this.#frame.commands.traversalDepth = effectiveTraversalDepth;
	}

	#prepareCrossingScheduleInputs(
		visibility: PortalScopeWindowFrameView,
		input: PortalScopeWindowCullInput,
		resource: PortalScopeAtlasResource,
	): void {
		const crossingCount = visibility.selectedCrossingCount;
		const drawingWidth = resource.drawingBuffer.width;
		const drawingHeight = resource.drawingBuffer.height;
		const anchorX = input.anchorCoordinates.x;
		const anchorY = input.anchorCoordinates.y;
		for (let ordinal = 0; ordinal < crossingCount; ordinal += 1) {
			const crossing = visibility.selectedCrossing(ordinal);
			const sourceDomain =
				visibility.selectedCrossingSourceRenderDomainOrdinal(ordinal);
			const targetDomain =
				visibility.selectedCrossingTargetRenderDomainOrdinal(ordinal);
			this.#arena.crossingSourceDomain[ordinal] = sourceDomain;
			this.#arena.crossingTargetDomain[ordinal] = targetDomain;
			this.#arena.crossingReciprocalState[ordinal] =
				visibility.selectedCrossingReciprocalArrivalStateId(ordinal);
			this.#arena.crossingJunctionGroup[ordinal] =
				crossing.junctionGroupId === null ? 0 : crossing.junctionGroupId;

			writeOrientedPortalArrivalPlane(
				this.#arena.crossingPlanes,
				ordinal * PORTAL_ARRIVAL_METADATA_PLANE_FLOAT_COUNT,
				crossing.sourceAperture.plane,
				crossing.acceptedSide,
				landblockAnchorOffsetX(
					visibility.selectedCrossingSourceLandblockX(ordinal),
					anchorX,
				),
				landblockAnchorOffsetZ(
					visibility.selectedCrossingSourceLandblockY(ordinal),
					anchorY,
				),
			);

			const tileMinX = this.#arena.minimumX[sourceDomain]!;
			const tileMinY = this.#arena.minimumY[sourceDomain]!;
			this.#writeConservativeCrossingScreenBounds(
				crossing,
				ordinal,
				visibility.selectedCrossingNearPlaneStraddle(ordinal),
				landblockAnchorOffsetX(
					visibility.selectedCrossingVisibilityLandblockX(ordinal),
					anchorX,
				),
				landblockAnchorOffsetZ(
					visibility.selectedCrossingVisibilityLandblockY(ordinal),
					anchorY,
				),
				input.clipFromAnchor,
				tileMinX,
				tileMinY,
				tileMinX + this.#arena.width[sourceDomain]!,
				tileMinY + this.#arena.height[sourceDomain]!,
				drawingWidth,
				drawingHeight,
			);
		}
		this.#populateCrossingAdvanceMatrix(visibility, anchorX, anchorY);
	}

	#populateCrossingAdvanceMatrix(
		visibility: PortalScopeWindowFrameView,
		anchorX: number,
		anchorY: number,
	): void {
		const crossingCount = visibility.selectedCrossingCount;
		const stride = this.#arena.crossingCapacity;
		for (let candidate = 0; candidate < crossingCount; candidate += 1) {
			const candidateSourceDomain =
				this.#arena.crossingSourceDomain[candidate]!;
			const candidateArrivalState = candidate + 2;
			const candidateJunction = this.#arena.crossingJunctionGroup[candidate]!;
			const candidateEmpty =
				this.#arena.crossingBaseMinX[candidate]! >=
				this.#arena.crossingBaseMaxX[candidate]!;
			const vertices =
				visibility.selectedCrossing(candidate).visibilityAperture.vertices;
			const offsetX = landblockAnchorOffsetX(
				visibility.selectedCrossingVisibilityLandblockX(candidate),
				anchorX,
			);
			const offsetZ = landblockAnchorOffsetZ(
				visibility.selectedCrossingVisibilityLandblockY(candidate),
				anchorY,
			);
			let maxAbsVx = 0;
			let maxAbsVy = 0;
			let maxAbsVz = 0;
			if (!candidateEmpty) {
				for (let slot = 0; slot + 2 < vertices.length; slot += 3) {
					maxAbsVx = Math.max(
						maxAbsVx,
						Math.abs(Math.fround(vertices[slot]! + offsetX)),
					);
					maxAbsVy = Math.max(
						maxAbsVy,
						Math.abs(Math.fround(vertices[slot + 1]!)),
					);
					maxAbsVz = Math.max(
						maxAbsVz,
						Math.abs(Math.fround(vertices[slot + 2]! + offsetZ)),
					);
				}
			}
			for (let predecessor = 0; predecessor < crossingCount; predecessor += 1) {
				const pairIndex = predecessor * stride + candidate;
				if (
					candidateEmpty ||
					this.#arena.crossingTargetDomain[predecessor]! !==
						candidateSourceDomain ||
					this.#arena.crossingBaseMinX[predecessor]! >=
						this.#arena.crossingBaseMaxX[predecessor]! ||
					this.#arena.crossingReciprocalState[predecessor]! ===
						candidateArrivalState
				) {
					this.#arena.canAdvance[pairIndex] = 0;
					continue;
				}
				if (
					candidateJunction !== 0 &&
					candidateJunction === this.#arena.crossingJunctionGroup[predecessor]!
				) {
					this.#arena.canAdvance[pairIndex] = 1;
					continue;
				}
				this.#arena.canAdvance[pairIndex] = this.#canAdvanceAcrossEntryPlane(
					predecessor,
					vertices,
					offsetX,
					offsetZ,
					maxAbsVx,
					maxAbsVy,
					maxAbsVz,
				)
					? 1
					: 0;
			}
		}
	}

	#canAdvanceAcrossEntryPlane(
		predecessor: number,
		vertices: Float32Array,
		offsetX: number,
		offsetZ: number,
		maxAbsVx: number,
		maxAbsVy: number,
		maxAbsVz: number,
	): boolean {
		const planeOffset = predecessor * PORTAL_ARRIVAL_METADATA_PLANE_FLOAT_COUNT;
		const nx = this.#arena.crossingPlanes[planeOffset]!;
		const ny = this.#arena.crossingPlanes[planeOffset + 1]!;
		const nz = this.#arena.crossingPlanes[planeOffset + 2]!;
		const d = this.#arena.crossingPlanes[planeOffset + 3]!;
		// Bound both float32 perspective-correct interpolation of `vAnchorPosition` and the GPU's
		// `dot(entryPlane.xyz, vAnchorPosition) + entryPlane.w` rounding across any anchor-relative
		// coordinate magnitude: any fragment admitted by `> PORTAL_QUERY_EPSILON` on GPU has at
		// least one triangle vertex exceeding `PORTAL_QUERY_EPSILON - planeErrorSlack`.
		const maxDotMagnitude =
			Math.abs(nx) * maxAbsVx +
			Math.abs(ny) * maxAbsVy +
			Math.abs(nz) * maxAbsVz +
			Math.abs(d);
		const planeErrorSlack = Math.max(
			MINIMUM_ENTRY_PLANE_MARGIN,
			ENTRY_PLANE_ULP_BUDGET * FLOAT32_UNIT_ROUNDING * maxDotMagnitude,
		);
		const conservativeThreshold = PORTAL_QUERY_EPSILON - planeErrorSlack;
		for (let slot = 0; slot + 2 < vertices.length; slot += 3) {
			const vx = Math.fround(vertices[slot]! + offsetX);
			const vy = Math.fround(vertices[slot + 1]!);
			const vz = Math.fround(vertices[slot + 2]! + offsetZ);
			if (nx * vx + ny * vy + nz * vz + d > conservativeThreshold) {
				return true;
			}
		}
		return false;
	}

	#setCrossingBaseBounds(
		ordinal: number,
		minX: number,
		minY: number,
		maxX: number,
		maxY: number,
	): void {
		this.#arena.crossingBaseMinX[ordinal] = minX;
		this.#arena.crossingBaseMinY[ordinal] = minY;
		this.#arena.crossingBaseMaxX[ordinal] = maxX;
		this.#arena.crossingBaseMaxY[ordinal] = maxY;
	}

	/**
	 * Compute conservative integer screen bounds `[minX, minY, maxX, maxY]` for one selected crossing,
	 * reproducing `PROPAGATION_VERTEX_SHADER` (`nearClipRays` override and `allow-equal-depth` entry-plane
	 * depth bias) with relaxed homogeneous frustum clipping and interval perspective division so no
	 * GPU-admitted fragment can fall outside the resulting rectangle.
	 */
	#writeConservativeCrossingScreenBounds(
		crossing: ScenePortalCrossing,
		ordinal: number,
		nearClipRays: boolean,
		offsetX: number,
		offsetZ: number,
		clipMatrix: Mat4,
		tileMinX: number,
		tileMinY: number,
		tileMaxX: number,
		tileMaxY: number,
		drawingWidth: number,
		drawingHeight: number,
	): void {
		if (tileMinX >= tileMaxX || tileMinY >= tileMaxY) {
			this.#setCrossingBaseBounds(ordinal, 0, 0, 0, 0);
			return;
		}
		const m11 = Math.fround(clipMatrix.m11);
		const m12 = Math.fround(clipMatrix.m12);
		const m13 = Math.fround(clipMatrix.m13);
		const m14 = Math.fround(clipMatrix.m14);
		const m21 = Math.fround(clipMatrix.m21);
		const m22 = Math.fround(clipMatrix.m22);
		const m23 = Math.fround(clipMatrix.m23);
		const m24 = Math.fround(clipMatrix.m24);
		const m31 = Math.fround(clipMatrix.m31);
		const m32 = Math.fround(clipMatrix.m32);
		const m33 = Math.fround(clipMatrix.m33);
		const m34 = Math.fround(clipMatrix.m34);
		const m41 = Math.fround(clipMatrix.m41);
		const m42 = Math.fround(clipMatrix.m42);
		const m43 = Math.fround(clipMatrix.m43);
		const m44 = Math.fround(clipMatrix.m44);
		const col1Mag =
			Math.abs(m11) + Math.abs(m12) + Math.abs(m13) + Math.abs(m14);
		const col2Mag =
			Math.abs(m21) + Math.abs(m22) + Math.abs(m23) + Math.abs(m24);
		const col3Mag =
			Math.abs(m31) + Math.abs(m32) + Math.abs(m33) + Math.abs(m34);
		const col4Mag =
			Math.abs(m41) + Math.abs(m42) + Math.abs(m43) + Math.abs(m44);
		const allowEqualBias =
			!nearClipRays && crossing.maskDepthPolicy === "allow-equal-depth";
		const planeOffset = ordinal * PORTAL_ARRIVAL_METADATA_PLANE_FLOAT_COUNT;
		const biasX = allowEqualBias
			? Math.fround(
					this.#arena.crossingPlanes[planeOffset]! * PORTAL_QUERY_EPSILON,
				)
			: 0;
		const biasY = allowEqualBias
			? Math.fround(
					this.#arena.crossingPlanes[planeOffset + 1]! * PORTAL_QUERY_EPSILON,
				)
			: 0;
		const biasZ = allowEqualBias
			? Math.fround(
					this.#arena.crossingPlanes[planeOffset + 2]! * PORTAL_QUERY_EPSILON,
				)
			: 0;

		const vertices = crossing.visibilityAperture.vertices;
		const indices = crossing.visibilityAperture.indices;
		const planeCount = nearClipRays
			? NEAR_RAY_HOMOGENEOUS_CLIP_PLANE_COUNT
			: CANONICAL_HOMOGENEOUS_CLIP_PLANE_COUNT;
		let minNdcX = Infinity;
		let minNdcY = Infinity;
		let maxNdcX = -Infinity;
		let maxNdcY = -Infinity;
		let anyAdmitted = false;

		for (let cursor = 0; cursor + 2 < indices.length; cursor += 3) {
			for (let corner = 0; corner < 3; corner += 1) {
				const sourceSlot = indices[cursor + corner]! * 3;
				const ax = Math.fround(vertices[sourceSlot]! + offsetX);
				const ay = Math.fround(vertices[sourceSlot + 1]!);
				const az = Math.fround(vertices[sourceSlot + 2]! + offsetZ);
				const cx = m11 * ax + m21 * ay + m31 * az + m41;
				const cy = m12 * ax + m22 * ay + m32 * az + m42;
				let cz = m13 * ax + m23 * ay + m33 * az + m43;
				const cw = m14 * ax + m24 * ay + m34 * az + m44;
				const vecMag =
					col1Mag * Math.abs(ax) +
					col2Mag * Math.abs(ay) +
					col3Mag * Math.abs(az) +
					col4Mag;
				let slack =
					HOMOGENEOUS_CLIP_ULP_BUDGET * FLOAT32_UNIT_ROUNDING * (vecMag + 1);
				if (nearClipRays) {
					cz = Math.fround(PORTAL_WINDOW_NDC_EPSILON);
				} else if (allowEqualBias) {
					const bx = Math.fround(ax + biasX);
					const by = Math.fround(ay + biasY);
					const bz = Math.fround(az + biasZ);
					const biasedZ = m13 * bx + m23 * by + m33 * bz + m43;
					const biasedW = m14 * bx + m24 * by + m34 * bz + m44;
					const biasedMag =
						(Math.abs(m13) + Math.abs(m14)) * Math.abs(bx) +
						(Math.abs(m23) + Math.abs(m24)) * Math.abs(by) +
						(Math.abs(m33) + Math.abs(m34)) * Math.abs(bz) +
						Math.abs(m43) +
						Math.abs(m44);
					const biasedWSlack =
						HOMOGENEOUS_CLIP_ULP_BUDGET *
						FLOAT32_UNIT_ROUNDING *
						(biasedMag + 1);
					if (
						!Number.isFinite(biasedW) ||
						Math.abs(biasedW) <=
							Math.max(MINIMUM_WELL_CONDITIONED_HOMOGENEOUS_W, 4 * biasedWSlack)
					) {
						this.#setCrossingBaseBounds(
							ordinal,
							tileMinX,
							tileMinY,
							tileMaxX,
							tileMaxY,
						);
						return;
					}
					cz = (biasedZ * cw) / biasedW;
					const czSlack =
						HOMOGENEOUS_CLIP_ULP_BUDGET *
						FLOAT32_UNIT_ROUNDING *
						((biasedMag * Math.abs(cw) + Math.abs(biasedZ) * vecMag) /
							Math.abs(biasedW) +
							(Math.abs(cz) * biasedMag) / Math.abs(biasedW) +
							Math.abs(cz) +
							1);
					slack = Math.max(slack, czSlack);
				}
				if (
					!Number.isFinite(cx) ||
					!Number.isFinite(cy) ||
					!Number.isFinite(cz) ||
					!Number.isFinite(cw) ||
					!Number.isFinite(slack)
				) {
					this.#setCrossingBaseBounds(
						ordinal,
						tileMinX,
						tileMinY,
						tileMaxX,
						tileMaxY,
					);
					return;
				}
				this.#arena.clipAx[corner] = cx;
				this.#arena.clipAy[corner] = cy;
				this.#arena.clipAz[corner] = cz;
				this.#arena.clipAw[corner] = cw;
				this.#arena.clipAslack[corner] = slack;
			}

			let activeX = this.#arena.clipAx;
			let activeY = this.#arena.clipAy;
			let activeZ = this.#arena.clipAz;
			let activeW = this.#arena.clipAw;
			let activeSlack = this.#arena.clipAslack;
			let scratchX = this.#arena.clipBx;
			let scratchY = this.#arena.clipBy;
			let scratchZ = this.#arena.clipBz;
			let scratchW = this.#arena.clipBw;
			let scratchSlack = this.#arena.clipBslack;
			let count = 3;
			for (let plane = 0; plane < planeCount && count >= 3; plane += 1) {
				count = clipRelaxedHomogeneousPolygon(
					activeX,
					activeY,
					activeZ,
					activeW,
					activeSlack,
					count,
					plane,
					nearClipRays,
					scratchX,
					scratchY,
					scratchZ,
					scratchW,
					scratchSlack,
				);
				const prevX = activeX;
				const prevY = activeY;
				const prevZ = activeZ;
				const prevW = activeW;
				const prevSlack = activeSlack;
				activeX = scratchX;
				activeY = scratchY;
				activeZ = scratchZ;
				activeW = scratchW;
				activeSlack = scratchSlack;
				scratchX = prevX;
				scratchY = prevY;
				scratchZ = prevZ;
				scratchW = prevW;
				scratchSlack = prevSlack;
			}
			if (count < 3) continue;
			for (let vertex = 0; vertex < count; vertex += 1) {
				const s = activeSlack[vertex]!;
				const wLower = activeW[vertex]! - s;
				if (
					!Number.isFinite(wLower) ||
					wLower <= MINIMUM_WELL_CONDITIONED_HOMOGENEOUS_W
				) {
					this.#setCrossingBaseBounds(
						ordinal,
						tileMinX,
						tileMinY,
						tileMaxX,
						tileMaxY,
					);
					return;
				}
				const wUpper = activeW[vertex]! + s;
				const xMin = activeX[vertex]! - s;
				const xMax = activeX[vertex]! + s;
				const yMin = activeY[vertex]! - s;
				const yMax = activeY[vertex]! + s;
				const ndcXLow = xMin >= 0 ? xMin / wUpper : xMin / wLower;
				const ndcXHigh = xMax >= 0 ? xMax / wLower : xMax / wUpper;
				const ndcYLow = yMin >= 0 ? yMin / wUpper : yMin / wLower;
				const ndcYHigh = yMax >= 0 ? yMax / wLower : yMax / wUpper;
				minNdcX = Math.min(minNdcX, ndcXLow);
				maxNdcX = Math.max(maxNdcX, ndcXHigh);
				minNdcY = Math.min(minNdcY, ndcYLow);
				maxNdcY = Math.max(maxNdcY, ndcYHigh);
				anyAdmitted = true;
			}
		}

		if (
			!anyAdmitted ||
			!Number.isFinite(minNdcX) ||
			!Number.isFinite(minNdcY) ||
			!Number.isFinite(maxNdcX) ||
			!Number.isFinite(maxNdcY)
		) {
			this.#setCrossingBaseBounds(ordinal, 0, 0, 0, 0);
			return;
		}
		const minX = Math.max(
			tileMinX,
			Math.floor(((minNdcX + 1) * drawingWidth) / 2) -
				CROSSING_SCREEN_PAD_PIXELS,
		);
		const minY = Math.max(
			tileMinY,
			Math.floor(((minNdcY + 1) * drawingHeight) / 2) -
				CROSSING_SCREEN_PAD_PIXELS,
		);
		const maxX = Math.min(
			tileMaxX,
			Math.ceil(((maxNdcX + 1) * drawingWidth) / 2) +
				CROSSING_SCREEN_PAD_PIXELS,
		);
		const maxY = Math.min(
			tileMaxY,
			Math.ceil(((maxNdcY + 1) * drawingHeight) / 2) +
				CROSSING_SCREEN_PAD_PIXELS,
		);
		if (minX >= maxX || minY >= maxY) {
			this.#setCrossingBaseBounds(ordinal, 0, 0, 0, 0);
			return;
		}
		this.#setCrossingBaseBounds(ordinal, minX, minY, maxX, maxY);
	}

	/**
	 * Propagate per-round active crossing rectangles and derive monotonically nested frontier scissors.
	 *
	 * Frontier validity invariant (`S_0 >= S_1 >= ... >= S_{D-1}`):
	 * - Let `U_r = union_c activeRect[r][c]`. For every `r >= 1` and crossing `c`,
	 *   `activeRect[r][c] = bbox_{p : CanAdvance(p -> c)} (activeRect[r - 1][p] intersect baseRect[c])`,
	 *   which is contained in `bbox_p activeRect[r - 1][p] = bbox(U_{r - 1})`.
	 * - Define `S_0 = bbox(U_0)` and `S_r = bbox(U_r union U_{r - 1})` for `r >= 1`. Because
	 *   `U_r <= bbox(U_{r - 1}) <= S_{r - 1}` and `U_{r - 1} <= S_{r - 1}`, axis-aligned bounding-box
	 *   monotonicity establishes `S_r <= S_{r - 1}` for every `r >= 1`.
	 * - On round `r`, `frontier[(r + 1) % 2]` (plus `frontierDepth`) is scissored-cleared across `S_r`,
	 *   while `frontier[r % 2]` was cleared across `S_{r - 1} >= S_r` on round `r - 1` (not read when `r = 0`).
	 * - Propagation on round `r` draws under scissor `S_r` (`<= S_{r - 1}`), and reduction on round `r`
	 *   coalesces axis-aligned subsets of `U_0` (for `r = 0`), `U_{r - 1}` (non-terminal `r > 0`), or
	 *   `U_{r - 1} union U_r` (terminal `r = D - 1`). Because the axis-aligned bounding box of any subset
	 *   of `S_r` remains inside the convex rectangle `S_r <= S_{r - 1}`, every texel read from either
	 *   ping-pong attachment or `frontierDepth` was freshly cleared or written in the current or
	 *   immediately preceding round—never reading stale data from round `r - 2`, prior frames, shrinking
	 *   coverage, camera motion, or alternating view parities.
	 */
	#computeActiveCrossingRounds(
		crossingCount: number,
		depthCap: number,
	): number {
		const stride = this.#arena.crossingCapacity;
		let ordinalCursor = 0;
		for (let round = 0; round < depthCap; round += 1) {
			const roundOffset = round * stride;
			const previousOffset = (round - 1) * stride;
			const roundOrdinalStart = ordinalCursor;
			let scissorMinX = MAXIMUM_UINT32;
			let scissorMinY = MAXIMUM_UINT32;
			let scissorMaxX = 0;
			let scissorMaxY = 0;
			for (let candidate = 0; candidate < crossingCount; candidate += 1) {
				const baseMinX = this.#arena.crossingBaseMinX[candidate]!;
				const baseMinY = this.#arena.crossingBaseMinY[candidate]!;
				const baseMaxX = this.#arena.crossingBaseMaxX[candidate]!;
				const baseMaxY = this.#arena.crossingBaseMaxY[candidate]!;
				let activeMinX = 0;
				let activeMinY = 0;
				let activeMaxX = 0;
				let activeMaxY = 0;
				if (baseMinX < baseMaxX && baseMinY < baseMaxY) {
					if (round === 0) {
						if (this.#arena.crossingSourceDomain[candidate]! === 0) {
							activeMinX = baseMinX;
							activeMinY = baseMinY;
							activeMaxX = baseMaxX;
							activeMaxY = baseMaxY;
						}
					} else {
						let unionMinX = baseMaxX;
						let unionMinY = baseMaxY;
						let unionMaxX = baseMinX;
						let unionMaxY = baseMinY;
						for (
							let predecessor = 0;
							predecessor < crossingCount;
							predecessor += 1
						) {
							if (
								this.#arena.canAdvance[predecessor * stride + candidate]! === 0
							) {
								continue;
							}
							const prevSlot = previousOffset + predecessor;
							const prevMinX = this.#arena.activeMinX[prevSlot]!;
							const prevMaxX = this.#arena.activeMaxX[prevSlot]!;
							if (prevMinX >= prevMaxX) continue;
							const prevMinY = this.#arena.activeMinY[prevSlot]!;
							const prevMaxY = this.#arena.activeMaxY[prevSlot]!;
							const left = Math.max(prevMinX, baseMinX);
							const bottom = Math.max(prevMinY, baseMinY);
							const right = Math.min(prevMaxX, baseMaxX);
							const top = Math.min(prevMaxY, baseMaxY);
							if (left >= right || bottom >= top) continue;
							unionMinX = Math.min(unionMinX, left);
							unionMinY = Math.min(unionMinY, bottom);
							unionMaxX = Math.max(unionMaxX, right);
							unionMaxY = Math.max(unionMaxY, top);
						}
						if (unionMinX < unionMaxX && unionMinY < unionMaxY) {
							activeMinX = unionMinX;
							activeMinY = unionMinY;
							activeMaxX = unionMaxX;
							activeMaxY = unionMaxY;
						}
					}
				}
				const slot = roundOffset + candidate;
				this.#arena.activeMinX[slot] = activeMinX;
				this.#arena.activeMinY[slot] = activeMinY;
				this.#arena.activeMaxX[slot] = activeMaxX;
				this.#arena.activeMaxY[slot] = activeMaxY;
				if (activeMinX < activeMaxX) {
					this.#arena.roundCrossingOrdinals[ordinalCursor] = candidate;
					ordinalCursor += 1;
					scissorMinX = Math.min(scissorMinX, activeMinX);
					scissorMinY = Math.min(scissorMinY, activeMinY);
					scissorMaxX = Math.max(scissorMaxX, activeMaxX);
					scissorMaxY = Math.max(scissorMaxY, activeMaxY);
				}
			}
			const activeCount = ordinalCursor - roundOrdinalStart;
			if (activeCount === 0) {
				return round;
			}
			if (round > 0) {
				// Reduction in `round` samples `next` (`frontier[round % 2]`) across every predecessor
				// rectangle `activeRect[round - 1][p]`, so the frontier clear must cover predecessors too.
				for (
					let predecessor = 0;
					predecessor < crossingCount;
					predecessor += 1
				) {
					const prevSlot = previousOffset + predecessor;
					const prevMinX = this.#arena.activeMinX[prevSlot]!;
					const prevMaxX = this.#arena.activeMaxX[prevSlot]!;
					if (prevMinX >= prevMaxX) continue;
					scissorMinX = Math.min(scissorMinX, prevMinX);
					scissorMinY = Math.min(
						scissorMinY,
						this.#arena.activeMinY[prevSlot]!,
					);
					scissorMaxX = Math.max(scissorMaxX, prevMaxX);
					scissorMaxY = Math.max(
						scissorMaxY,
						this.#arena.activeMaxY[prevSlot]!,
					);
				}
			}
			this.#arena.roundCrossingOffsets[round] = roundOrdinalStart;
			this.#arena.roundCrossingCounts[round] = activeCount;
			this.#arena.roundFrontierScissorX[round] = scissorMinX;
			this.#arena.roundFrontierScissorY[round] = scissorMinY;
			this.#arena.roundFrontierScissorWidth[round] = scissorMaxX - scissorMinX;
			this.#arena.roundFrontierScissorHeight[round] = scissorMaxY - scissorMinY;
		}
		return depthCap;
	}

	#emitRoundReductionQuads(
		round: number,
		effectiveTraversalDepth: number,
		crossingCount: number,
	): void {
		const stride = this.#arena.crossingCapacity;
		const roundQuadStart = this.#frame.quadCount;
		const isTerminalRound = round + 1 === effectiveTraversalDepth;
		if (round === 0) {
			let rawRootCount = 0;
			const activeCount = this.#arena.roundCrossingCounts[0]!;
			const activeStart = this.#arena.roundCrossingOffsets[0]!;
			for (let index = 0; index < activeCount; index += 1) {
				const crossing =
					this.#arena.roundCrossingOrdinals[activeStart + index]!;
				this.#arena.coalesceMinX[rawRootCount] =
					this.#arena.activeMinX[crossing]!;
				this.#arena.coalesceMinY[rawRootCount] =
					this.#arena.activeMinY[crossing]!;
				this.#arena.coalesceMaxX[rawRootCount] =
					this.#arena.activeMaxX[crossing]!;
				this.#arena.coalesceMaxY[rawRootCount] =
					this.#arena.activeMaxY[crossing]!;
				rawRootCount += 1;
			}
			const coalescedRootCount = this.#coalesceRects(rawRootCount);
			for (let rectIndex = 0; rectIndex < coalescedRootCount; rectIndex += 1) {
				this.#emitQuad(
					0,
					this.#arena.coalesceMinX[rectIndex]!,
					this.#arena.coalesceMinY[rectIndex]!,
					this.#arena.coalesceMaxX[rectIndex]!,
					this.#arena.coalesceMaxY[rectIndex]!,
					PORTAL_QUAD_MODE_ROOT_ROUND0_CLAMP,
				);
			}
		}

		const firstStandardDomain = round === 0 ? 1 : 0;
		if (round > 0 || isTerminalRound) {
			for (
				let domain = firstStandardDomain;
				domain < this.#frame.tileCount;
				domain += 1
			) {
				let rawCount = 0;
				if (round > 0) {
					rawCount = this.#collectDomainActiveRects(
						domain,
						(round - 1) * stride,
						crossingCount,
						rawCount,
					);
				}
				if (isTerminalRound) {
					rawCount = this.#collectDomainActiveRects(
						domain,
						round * stride,
						crossingCount,
						rawCount,
					);
				}
				const coalescedCount = this.#coalesceRects(rawCount);
				for (let rectIndex = 0; rectIndex < coalescedCount; rectIndex += 1) {
					this.#emitQuad(
						domain,
						this.#arena.coalesceMinX[rectIndex]!,
						this.#arena.coalesceMinY[rectIndex]!,
						this.#arena.coalesceMaxX[rectIndex]!,
						this.#arena.coalesceMaxY[rectIndex]!,
						PORTAL_QUAD_MODE_MAX_REDUCE,
					);
				}
			}
		}
		this.#arena.roundReductionQuadOffsets[round] = roundQuadStart;
		this.#arena.roundReductionQuadCounts[round] =
			this.#frame.quadCount - roundQuadStart;
	}

	#collectDomainActiveRects(
		domain: number,
		roundOffset: number,
		crossingCount: number,
		initialCount: number,
	): number {
		const tileMinX = this.#arena.minimumX[domain]!;
		const tileMinY = this.#arena.minimumY[domain]!;
		const tileMaxX = tileMinX + this.#arena.width[domain]!;
		const tileMaxY = tileMinY + this.#arena.height[domain]!;
		let rawCount = initialCount;
		for (let ordinal = 0; ordinal < crossingCount; ordinal += 1) {
			if (this.#arena.crossingTargetDomain[ordinal]! !== domain) {
				continue;
			}
			const slot = roundOffset + ordinal;
			const minX = Math.max(tileMinX, this.#arena.activeMinX[slot]!);
			const minY = Math.max(tileMinY, this.#arena.activeMinY[slot]!);
			const maxX = Math.min(tileMaxX, this.#arena.activeMaxX[slot]!);
			const maxY = Math.min(tileMaxY, this.#arena.activeMaxY[slot]!);
			if (minX >= maxX || minY >= maxY) continue;
			this.#arena.coalesceMinX[rawCount] = minX;
			this.#arena.coalesceMinY[rawCount] = minY;
			this.#arena.coalesceMaxX[rawCount] = maxX;
			this.#arena.coalesceMaxY[rawCount] = maxY;
			rawCount += 1;
		}
		return rawCount;
	}

	#emitResolveQuads(reductionQuadCount: number): void {
		const rootMinX = this.#arena.minimumX[0]!;
		const rootMinY = this.#arena.minimumY[0]!;
		this.#emitQuad(
			0,
			rootMinX,
			rootMinY,
			rootMinX + this.#arena.width[0]!,
			rootMinY + this.#arena.height[0]!,
			PORTAL_QUAD_MODE_MAX_REDUCE,
		);
		for (let domain = 1; domain < this.#frame.tileCount; domain += 1) {
			const tileMinX = this.#arena.minimumX[domain]!;
			const tileMinY = this.#arena.minimumY[domain]!;
			const tileMaxX = tileMinX + this.#arena.width[domain]!;
			const tileMaxY = tileMinY + this.#arena.height[domain]!;
			let rawCount = 0;
			for (let quadIndex = 0; quadIndex < reductionQuadCount; quadIndex += 1) {
				const slot = quadIndex * QUAD_RECORD_SLOT_COUNT;
				if (this.#arena.quads[slot + 6]! !== domain) continue;
				const screenX = this.#arena.quads[slot + 2]!;
				const screenY = this.#arena.quads[slot + 3]!;
				const width = this.#arena.quads[slot + 4]!;
				const height = this.#arena.quads[slot + 5]!;
				this.#arena.coalesceMinX[rawCount] = Math.max(
					tileMinX,
					screenX - PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS,
				);
				this.#arena.coalesceMinY[rawCount] = Math.max(
					tileMinY,
					screenY - PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS,
				);
				this.#arena.coalesceMaxX[rawCount] = Math.min(
					tileMaxX,
					screenX + width + PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS,
				);
				this.#arena.coalesceMaxY[rawCount] = Math.min(
					tileMaxY,
					screenY + height + PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS,
				);
				rawCount += 1;
			}
			const coalescedCount = this.#coalesceRects(rawCount);
			for (let rectIndex = 0; rectIndex < coalescedCount; rectIndex += 1) {
				this.#emitQuad(
					domain,
					this.#arena.coalesceMinX[rectIndex]!,
					this.#arena.coalesceMinY[rectIndex]!,
					this.#arena.coalesceMaxX[rectIndex]!,
					this.#arena.coalesceMaxY[rectIndex]!,
					PORTAL_QUAD_MODE_MAX_REDUCE,
				);
			}
		}
	}

	#coalesceRects(initialCount: number): number {
		let count = initialCount;
		let merged = count > 1;
		while (merged) {
			merged = false;
			for (let left = 0; left < count && !merged; left += 1) {
				const leftMinX = this.#arena.coalesceMinX[left]!;
				const leftMinY = this.#arena.coalesceMinY[left]!;
				const leftMaxX = this.#arena.coalesceMaxX[left]!;
				const leftMaxY = this.#arena.coalesceMaxY[left]!;
				const leftArea = (leftMaxX - leftMinX) * (leftMaxY - leftMinY);
				for (let right = left + 1; right < count; right += 1) {
					const rightMinX = this.#arena.coalesceMinX[right]!;
					const rightMinY = this.#arena.coalesceMinY[right]!;
					const rightMaxX = this.#arena.coalesceMaxX[right]!;
					const rightMaxY = this.#arena.coalesceMaxY[right]!;
					const rightArea = (rightMaxX - rightMinX) * (rightMaxY - rightMinY);
					const unionArea =
						(Math.max(leftMaxX, rightMaxX) - Math.min(leftMinX, rightMinX)) *
						(Math.max(leftMaxY, rightMaxY) - Math.min(leftMinY, rightMinY));
					if (
						unionArea <=
						leftArea + rightArea + COALESCING_BRIDGE_AREA_TOLERANCE_PIXELS
					) {
						count = this.#mergeCoalescePair(left, right, count);
						merged = true;
						break;
					}
				}
			}
		}
		while (count > MAXIMUM_COALESCED_RECTS_PER_DOMAIN) {
			let bestLeft = 0;
			let bestRight = 1;
			let bestDeadArea = Infinity;
			for (let left = 0; left < count; left += 1) {
				const leftMinX = this.#arena.coalesceMinX[left]!;
				const leftMinY = this.#arena.coalesceMinY[left]!;
				const leftMaxX = this.#arena.coalesceMaxX[left]!;
				const leftMaxY = this.#arena.coalesceMaxY[left]!;
				const leftArea = (leftMaxX - leftMinX) * (leftMaxY - leftMinY);
				for (let right = left + 1; right < count; right += 1) {
					const rightMinX = this.#arena.coalesceMinX[right]!;
					const rightMinY = this.#arena.coalesceMinY[right]!;
					const rightMaxX = this.#arena.coalesceMaxX[right]!;
					const rightMaxY = this.#arena.coalesceMaxY[right]!;
					const rightArea = (rightMaxX - rightMinX) * (rightMaxY - rightMinY);
					const unionArea =
						(Math.max(leftMaxX, rightMaxX) - Math.min(leftMinX, rightMinX)) *
						(Math.max(leftMaxY, rightMaxY) - Math.min(leftMinY, rightMinY));
					const deadArea = unionArea - leftArea - rightArea;
					if (deadArea < bestDeadArea) {
						bestDeadArea = deadArea;
						bestLeft = left;
						bestRight = right;
					}
				}
			}
			count = this.#mergeCoalescePair(bestLeft, bestRight, count);
		}
		return count;
	}

	#mergeCoalescePair(left: number, right: number, count: number): number {
		this.#arena.coalesceMinX[left] = Math.min(
			this.#arena.coalesceMinX[left]!,
			this.#arena.coalesceMinX[right]!,
		);
		this.#arena.coalesceMinY[left] = Math.min(
			this.#arena.coalesceMinY[left]!,
			this.#arena.coalesceMinY[right]!,
		);
		this.#arena.coalesceMaxX[left] = Math.max(
			this.#arena.coalesceMaxX[left]!,
			this.#arena.coalesceMaxX[right]!,
		);
		this.#arena.coalesceMaxY[left] = Math.max(
			this.#arena.coalesceMaxY[left]!,
			this.#arena.coalesceMaxY[right]!,
		);
		const nextCount = count - 1;
		this.#arena.coalesceMinX[right] = this.#arena.coalesceMinX[nextCount]!;
		this.#arena.coalesceMinY[right] = this.#arena.coalesceMinY[nextCount]!;
		this.#arena.coalesceMaxX[right] = this.#arena.coalesceMaxX[nextCount]!;
		this.#arena.coalesceMaxY[right] = this.#arena.coalesceMaxY[nextCount]!;
		return nextCount;
	}

	#emitQuad(
		domain: number,
		minScreenX: number,
		minScreenY: number,
		maxScreenX: number,
		maxScreenY: number,
		mode: number,
	): void {
		const slot = this.#frame.quadCount * QUAD_RECORD_SLOT_COUNT;
		if (slot + QUAD_RECORD_SLOT_COUNT > this.#arena.quads.length) {
			throw new Error("Portal scope-atlas quad arena exhausted.");
		}
		const tileMinScreenX = this.#arena.minimumX[domain]!;
		const tileMinScreenY = this.#arena.minimumY[domain]!;
		this.#arena.quads[slot] =
			this.#arena.x[domain]! + (minScreenX - tileMinScreenX);
		this.#arena.quads[slot + 1] =
			this.#arena.y[domain]! + (minScreenY - tileMinScreenY);
		this.#arena.quads[slot + 2] = minScreenX;
		this.#arena.quads[slot + 3] = minScreenY;
		this.#arena.quads[slot + 4] = maxScreenX - minScreenX;
		this.#arena.quads[slot + 5] = maxScreenY - minScreenY;
		this.#arena.quads[slot + 6] = domain;
		this.#arena.quads[slot + 7] = mode;
		this.#frame.quadCount += 1;
	}
}

function clampPixel(value: number, limit: number): number {
	return Math.min(limit, Math.max(0, value));
}

function landblockAnchorOffsetX(landblockX: number, anchorX: number): number {
	return (landblockX - anchorX) * OUTDOOR_LANDBLOCK_WORLD_SIZE;
}

function landblockAnchorOffsetZ(landblockY: number, anchorY: number): number {
	return -(landblockY - anchorY) * OUTDOOR_LANDBLOCK_WORLD_SIZE;
}

function clipRelaxedHomogeneousPolygon(
	x: Float64Array,
	y: Float64Array,
	z: Float64Array,
	w: Float64Array,
	slack: Float64Array,
	count: number,
	plane: number,
	nearClipRays: boolean,
	outputX: Float64Array,
	outputY: Float64Array,
	outputZ: Float64Array,
	outputW: Float64Array,
	outputSlack: Float64Array,
): number {
	let outputCount = 0;
	let previous = count - 1;
	let previousDistance = relaxedHomogeneousClipDistance(
		x[previous]!,
		y[previous]!,
		z[previous]!,
		w[previous]!,
		slack[previous]!,
		plane,
		nearClipRays,
	);
	let previousInside = previousDistance >= 0;
	for (let current = 0; current < count; current += 1) {
		const currentDistance = relaxedHomogeneousClipDistance(
			x[current]!,
			y[current]!,
			z[current]!,
			w[current]!,
			slack[current]!,
			plane,
			nearClipRays,
		);
		const currentInside = currentDistance >= 0;
		if (currentInside !== previousInside) {
			const denominator = previousDistance - currentDistance;
			if (denominator !== 0) {
				const fraction = previousDistance / denominator;
				const ix = x[previous]! + (x[current]! - x[previous]!) * fraction;
				const iy = y[previous]! + (y[current]! - y[previous]!) * fraction;
				const iz = z[previous]! + (z[current]! - z[previous]!) * fraction;
				const iw = w[previous]! + (w[current]! - w[previous]!) * fraction;
				const islack =
					slack[previous]! +
					(slack[current]! - slack[previous]!) * fraction +
					FLOAT64_CLIP_INTERPOLATION_SLACK *
						(Math.abs(ix) + Math.abs(iy) + Math.abs(iz) + Math.abs(iw) + 1);
				outputX[outputCount] = ix;
				outputY[outputCount] = iy;
				outputZ[outputCount] = iz;
				outputW[outputCount] = iw;
				outputSlack[outputCount] = islack;
				outputCount += 1;
			}
		}
		if (currentInside) {
			outputX[outputCount] = x[current]!;
			outputY[outputCount] = y[current]!;
			outputZ[outputCount] = z[current]!;
			outputW[outputCount] = w[current]!;
			outputSlack[outputCount] = slack[current]!;
			outputCount += 1;
		}
		previous = current;
		previousDistance = currentDistance;
		previousInside = currentInside;
	}
	return outputCount;
}

function relaxedHomogeneousClipDistance(
	x: number,
	y: number,
	z: number,
	w: number,
	slack: number,
	plane: number,
	nearClipRays: boolean,
): number {
	const halfSpaceSlack = 2 * slack;
	if (nearClipRays) {
		if (plane === 0) return w - PORTAL_WINDOW_NDC_EPSILON + halfSpaceSlack;
		plane -= 1;
	}
	switch (plane) {
		case 0:
			return x + w + halfSpaceSlack;
		case 1:
			return w - x + halfSpaceSlack;
		case 2:
			return y + w + halfSpaceSlack;
		case 3:
			return w - y + halfSpaceSlack;
		case 4:
			return z + w + halfSpaceSlack;
		case 5:
			return w - z + halfSpaceSlack;
		default:
			throw new Error(`Portal homogeneous clip plane ${plane} is unavailable.`);
	}
}

function validateResource(
	resource: PortalScopeAtlasResource,
	input: PortalScopeWindowCullInput,
	maximumTileCount: number,
): void {
	for (const [name, value] of [
		["atlas width", resource.atlas.width],
		["atlas height", resource.atlas.height],
		["drawing-buffer width", resource.drawingBuffer.width],
		["drawing-buffer height", resource.drawingBuffer.height],
		[
			"maximum crossing triangle-vertex count",
			resource.maximumCrossingTriangleVertexCount,
		],
		["maximum arrival-state count", resource.maximumArrivalStateCount],
	] as const) {
		if (!Number.isSafeInteger(value) || value <= 0 || value > MAXIMUM_UINT32) {
			throw new Error(`Portal scope-atlas ${name} must fit a positive Uint32.`);
		}
	}
	if (
		resource.drawingBuffer.width !==
			input.portalFootprint.drawingBuffer.width ||
		resource.drawingBuffer.height !== input.portalFootprint.drawingBuffer.height
	) {
		throw new Error(
			"Portal scope-atlas and culler drawing-buffer extents differ.",
		);
	}
	if (
		resource.atlas.width < resource.drawingBuffer.width ||
		resource.atlas.height < resource.drawingBuffer.height
	) {
		throw new Error(
			"Portal scope-atlas extent must retain the full drawing-buffer root tile.",
		);
	}
	const atlasPixelCapacity = resource.atlas.width * resource.atlas.height;
	const drawingBufferPixelCount =
		resource.drawingBuffer.width * resource.drawingBuffer.height;
	if (!Number.isSafeInteger(atlasPixelCapacity)) {
		throw new Error(
			"Portal scope-atlas pixel capacity exceeds safe integer storage.",
		);
	}
	if (!Number.isSafeInteger(drawingBufferPixelCount * maximumTileCount)) {
		throw new Error(
			"Portal scope-atlas tile-area trace exceeds safe integer storage.",
		);
	}
}
