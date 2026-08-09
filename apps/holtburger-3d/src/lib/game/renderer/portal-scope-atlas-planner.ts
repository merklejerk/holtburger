import type { SceneTopologyView } from "../scene";
import {
	PortalScopeWindowCuller,
	type PortalScopeWindowCullerCapacity,
	type PortalScopeWindowCullInput,
	type PortalScopeWindowFrameView,
} from "./portal-scope-window-culler";

const MAXIMUM_UINT32 = 0xffff_ffff;

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
	/** Tiles consumed by the single opaque composite command. */
	readonly opaqueCompositeInstanceCount: number;
	/** Scope instances reduced across every retained propagation round. */
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
	/** NDC vertices inspected while deriving bounds across every packing attempt. */
	readonly windowVertexReadCount: number;
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
	windowVertexReadCount: number;
}

/** Reused, non-retained scalar view over planner-owned tile storage. */
export interface PortalScopeAtlasFrameView {
	readonly commands: PortalScopeAtlasCommandLedger;
	readonly tileCount: number;
	readonly trace: PortalScopeAtlasPlanTrace;
	readonly visibility: PortalScopeWindowFrameView;
	/** Resolve an already-formed renderer run directly to its selected-scope tile. */
	tileOrdinalForRenderScopeKey(renderScopeKey: string): number;
	/** Horizontal clip-space scale routing ordinary camera projection into this tile. */
	tileClipScaleX(ordinal: number): number;
	/** Vertical clip-space scale routing ordinary camera projection into this tile. */
	tileClipScaleY(ordinal: number): number;
	/** Horizontal clip-space offset paired with `tileClipScaleX`. */
	tileClipOffsetX(ordinal: number): number;
	/** Vertical clip-space offset paired with `tileClipScaleY`. */
	tileClipOffsetY(ordinal: number): number;
	/** Integer atlas viewport height for one selected-scope ordinal. */
	tileHeight(ordinal: number): number;
	/** Integer atlas viewport width for one selected-scope ordinal. */
	tileWidth(ordinal: number): number;
	/** Integer atlas viewport x origin for one selected-scope ordinal. */
	tileX(ordinal: number): number;
	/** Integer atlas viewport y origin for one selected-scope ordinal. */
	tileY(ordinal: number): number;
}

/** Fixed structure-of-arrays storage for scope bounds, placements, transforms, and sort scratch. */
class PortalScopeAtlasArena {
	readonly clipOffsetX: Float32Array;
	readonly clipOffsetY: Float32Array;
	readonly clipScaleX: Float32Array;
	readonly clipScaleY: Float32Array;
	readonly height: Uint32Array;
	readonly minimumX: Uint32Array;
	readonly minimumY: Uint32Array;
	readonly sortOrdinals: Uint32Array;
	readonly sortScratch: Uint32Array;
	readonly typedCapacityBytes: number;
	readonly width: Uint32Array;
	readonly x: Uint32Array;
	readonly y: Uint32Array;

	constructor(tileCapacity: number) {
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
			this.y.byteLength;
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
		windowVertexReadCount: 0,
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
		const ordinal = this.visibility.selectedScopeOrdinal(renderScopeKey);
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

	constructor(capacity: PortalScopeWindowCullerCapacity) {
		this.#culler = new PortalScopeWindowCuller(capacity);
		this.#maximumPathDepth = capacity.maximumDepth;
		this.#maximumTileCount = capacity.maximumWorkItemCount;
		this.#arena = new PortalScopeAtlasArena(capacity.maximumWorkItemCount);
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
		while (
			visibility.selectedCrossingCount + 1 >
			resource.maximumArrivalStateCount
		) {
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
				visibility.selectedScopeCount,
			);
			if (
				this.#packTiles(sortedOrdinals, visibility.selectedScopeCount, resource)
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
		this.#frame.tileCount = visibility.selectedScopeCount;
		this.#writeCommandLedger(visibility);
		return this.#frame;
	}

	#beginFrame(
		visibility: PortalScopeWindowFrameView,
		resource: PortalScopeAtlasResource,
	): void {
		this.#frame.setVisibility(visibility);
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
		this.#frame.trace.windowVertexReadCount = 0;
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
			ordinal < visibility.selectedScopeCount;
			ordinal += 1
		) {
			let minimumNdcX = Number.POSITIVE_INFINITY;
			let minimumNdcY = Number.POSITIVE_INFINITY;
			let maximumNdcX = Number.NEGATIVE_INFINITY;
			let maximumNdcY = Number.NEGATIVE_INFINITY;
			const fragmentCount = visibility.selectedFragmentCount(ordinal);
			for (let fragment = 0; fragment < fragmentCount; fragment += 1) {
				const vertexCount = visibility.selectedFragmentVertexCount(
					ordinal,
					fragment,
				);
				for (let vertex = 0; vertex < vertexCount; vertex += 1) {
					const x = visibility.selectedVertexX(ordinal, fragment, vertex);
					const y = visibility.selectedVertexY(ordinal, fragment, vertex);
					minimumNdcX = Math.min(minimumNdcX, x);
					minimumNdcY = Math.min(minimumNdcY, y);
					maximumNdcX = Math.max(maximumNdcX, x);
					maximumNdcY = Math.max(maximumNdcY, y);
					this.#frame.trace.windowVertexReadCount += 1;
				}
			}
			if (!Number.isFinite(minimumNdcX) || !Number.isFinite(minimumNdcY)) {
				throw new Error(
					`Portal selected scope ${ordinal} has an empty window.`,
				);
			}
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
			this.#arena.minimumX[ordinal] = minimumX;
			this.#arena.minimumY[ordinal] = minimumY;
			this.#arena.width[ordinal] = Math.max(1, maximumX - minimumX);
			this.#arena.height[ordinal] = Math.max(1, maximumY - minimumY);
			this.#arena.sortOrdinals[ordinal] = ordinal;
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
		this.#frame.trace.atlasPackedExtentPixelCount =
			usedWidth * (cursorY + shelfHeight);
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

	#writeCommandLedger(visibility: PortalScopeWindowFrameView): void {
		const traversalDepth =
			visibility.selectedCrossingCount === 0
				? 0
				: visibility.status === "complete"
					? this.#maximumPathDepth
					: visibility.completedDepth;
		this.#frame.commands.crossingInstancePreparationCount =
			visibility.selectedCrossingCount;
		this.#frame.commands.frontierClearCommandCount = traversalDepth;
		this.#frame.commands.maskPropagationCommandCount = traversalDepth;
		this.#frame.commands.maskPropagationInstanceCount =
			traversalDepth * visibility.selectedCrossingCount;
		this.#frame.commands.opaqueCompositeCommandCount =
			visibility.selectedScopeCount === 0 ? 0 : 1;
		this.#frame.commands.opaqueCompositeInstanceCount =
			visibility.selectedScopeCount;
		this.#frame.commands.scopeEnvelopeReductionCommandCount = traversalDepth;
		this.#frame.commands.scopeEnvelopeReductionInstanceCount =
			traversalDepth * visibility.selectedScopeCount;
		this.#frame.commands.traversalDepth = traversalDepth;
	}
}

function clampPixel(value: number, limit: number): number {
	return Math.min(limit, Math.max(0, value));
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
