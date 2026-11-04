import type { Mat4 } from "../math/types";
import { mat4ToFloat32Array } from "../math/matrices";
import type { PreparedStaticObjectDrawCompatibility } from "./object-rendering-policy";
import {
	staticObjectDrawStateEquals,
	staticObjectTableStateEquals,
} from "./object-rendering-policy";

/** Components in the `localToLandblock` transform each baked draw uploads. */
const MAT4_COMPONENTS = 16;

/**
 * How far baked object draws could collapse if their geometry were re-partitioned.
 *
 * Every count is a draw-call ceiling: the number of `drawElements` calls that would remain if all
 * draws binding identical device state inside the named scope were merged into one range. The
 * scopes nest, so `sceneWide <= withinLandblock <= withinBuffer <= drawCount`, and the gaps between
 * them are what a merge at each granularity would actually buy.
 *
 * "One range" is load-bearing and makes these ceilings optimistic: it assumes the merged geometry is
 * contiguous in one buffer. Holding contiguity across residency units requires relocating evicted
 * neighbours' data, so a client that streams content cannot reach these figures without giving up
 * per-unit eviction. Compare the scopes against each other, which share the assumption; do not read
 * an absolute reduction as reachable.
 */
export interface BakedDrawMergeCensus {
	/** Baked static draws observed, matching `submittedBakedStaticObjectDrawCount`. */
	readonly drawCount: number;
	/**
	 * Maximal runs of consecutive state-equal draws in the order they were actually submitted.
	 *
	 * The only figure here that costs nothing architectural to move: reordering submissions is a
	 * per-frame decision that touches no buffer and no residency lifetime. Read it against
	 * `mergedSceneWide`, which is the run count a perfect sort would reach, since both count state
	 * transitions over the same population. Their difference is what sorting alone could remove.
	 */
	readonly stateRunsInDrawOrder: number;
	/** Distinct GL geometry buffers read; the merge unit the bake already produces. */
	readonly geometryBufferCount: number;
	/** Distinct landblocks contributing draws. */
	readonly landblockCount: number;
	/**
	 * Ceiling inside one geometry buffer.
	 *
	 * A control, not a proposal: the geometry worker already groups contributions by material
	 * binding before emitting ranges, so a figure below `drawCount` means that grouping is leaving
	 * mergeable ranges behind and the defect is in the bake rather than in its partitioning.
	 */
	readonly mergedWithinBuffer: number;
	/** Ceiling inside one landblock, across the layer buffers it owns. */
	readonly mergedWithinLandblock: number;
	/** Ceiling across every visible landblock, which additionally requires folding the offset. */
	readonly mergedSceneWide: number;
	/**
	 * Scene-wide ceiling if a merged range had to keep one shared `localToLandblock`.
	 *
	 * The distance from `mergedSceneWide` is the part of the win that exists only if the transform
	 * is baked into the vertices, which is the expensive half of the change.
	 */
	readonly mergedSceneWideSharedTransform: number;
}

/** One draw retained verbatim so every ceiling is computed from a single traversal's evidence. */
interface RecordedDraw {
	/** Table-backed draws retain their geometry-owned table as an additional binding boundary. */
	readonly materialSource: "uniform" | "table";
	readonly compatibility: PreparedStaticObjectDrawCompatibility<
		unknown,
		unknown,
		unknown
	>;
	readonly geometry: unknown;
	readonly landblockId: string;
	readonly transform: Float32Array;
}

/**
 * Collect one frame of baked draws and report the merge ceilings they imply.
 *
 * Deliberately retains every draw rather than accumulating counters: the ceilings are grouping
 * questions that cannot be answered incrementally, and one census spans a single frame.
 */
export class BakedDrawMergeCensusCollector {
	readonly #draws: RecordedDraw[] = [];

	/** Record one baked static draw. Instanced and dynamic draws do not belong to this question. */
	record(
		landblockId: string,
		localToLandblock: Mat4,
		compatibility: PreparedStaticObjectDrawCompatibility<
			unknown,
			unknown,
			unknown
		>,
		materialSource: "uniform" | "table" = "uniform",
	): void {
		this.#draws.push({
			materialSource,
			compatibility,
			geometry: compatibility.geometry,
			landblockId,
			// Compared as float32 because that is the precision the uniform upload actually carries.
			transform: mat4ToFloat32Array(localToLandblock),
		});
	}

	summarize(): BakedDrawMergeCensus {
		const draws = this.#draws;
		return {
			drawCount: draws.length,
			stateRunsInDrawOrder: countStateRunsInDrawOrder(draws),
			geometryBufferCount: new Set(draws.map((draw) => draw.geometry)).size,
			landblockCount: new Set(draws.map((draw) => draw.landblockId)).size,
			mergedSceneWide: countMergedRanges(draws, () => null, false),
			mergedSceneWideSharedTransform: countMergedRanges(
				draws,
				() => null,
				true,
			),
			mergedWithinBuffer: countMergedRanges(
				draws,
				(draw) => draw.geometry,
				false,
			),
			mergedWithinLandblock: countMergedRanges(
				draws,
				(draw) => draw.landblockId,
				false,
			),
		};
	}
}

/** Table rows belong to geometry; cross-geometry merges would also require table remapping. */
function drawStateEquals(left: RecordedDraw, right: RecordedDraw): boolean {
	return (
		left.materialSource === right.materialSource &&
		(left.materialSource === "table"
			? staticObjectTableStateEquals
			: staticObjectDrawStateEquals)(left.compatibility, right.compatibility)
	);
}

/**
 * Count maximal runs of state-equal draws in submission order.
 * Only the immediately preceding draw is compared, matching device-state cache behavior.
 */
function countStateRunsInDrawOrder(draws: readonly RecordedDraw[]): number {
	let runs = 0;
	let previous: RecordedDraw | undefined;
	for (const draw of draws) {
		if (previous === undefined || !drawStateEquals(previous, draw)) {
			runs += 1;
		}
		previous = draw;
	}
	return runs;
}

/**
 * Count the ranges that survive merging every state-equal draw inside each scope.
 *
 * Buckets are compared linearly against one representative rather than keyed by a derived string:
 * the equality that decides a merge already exists in the rendering policy, and re-encoding it as a
 * key would let the census and the renderer disagree about what "same state" means.
 */
function countMergedRanges(
	draws: readonly RecordedDraw[],
	scopeOf: (draw: RecordedDraw) => unknown,
	requireSharedTransform: boolean,
): number {
	const scopes = new Map<unknown, RecordedDraw[][]>();
	for (const draw of draws) {
		const scope = scopeOf(draw);
		let buckets = scopes.get(scope);
		if (buckets === undefined) {
			buckets = [];
			scopes.set(scope, buckets);
		}
		const bucket = buckets.find(
			([representative]) =>
				representative !== undefined &&
				drawStateEquals(representative, draw) &&
				(!requireSharedTransform ||
					transformEquals(representative.transform, draw.transform)),
		);
		if (bucket) bucket.push(draw);
		else buckets.push([draw]);
	}
	let total = 0;
	for (const buckets of scopes.values()) total += buckets.length;
	return total;
}

function transformEquals(left: Float32Array, right: Float32Array): boolean {
	for (let index = 0; index < MAT4_COMPONENTS; index += 1) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}
