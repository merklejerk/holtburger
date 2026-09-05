import type { SceneNodeId } from "../scene";
import type { ActiveDynamicPart } from "../systems/components";
import type { PreparedDynamicAppearance } from "./webgl2-dynamic-appearances";
import { retainsRetailGeometry } from "./retail-geometry-visibility";

/** Physical range ordinal supplies batch state and start; the count may span adjacent ranges. */
interface DynamicOpaqueSpan {
	/** First retained range in the appearance's physical index order. */
	rangeIndex: number;
	/** Contiguous eligible index elements sharing the first range's physical batch. */
	indexCount: number;
}

/** Frame cache with reusable scalar spans; pooled entries retain no scene or GPU resources. */
export class DynamicOpaqueRanges {
	/** One result per selected root, shared by all prepared views in this frame. */
	readonly #prepared = new Map<
		SceneNodeId,
		readonly Readonly<DynamicOpaqueSpan>[]
	>();
	/** High-water scalar storage, selected by queried root ordinal. */
	readonly #storage: {
		ranges: DynamicOpaqueSpan[];
		pool: DynamicOpaqueSpan[];
	}[] = [];

	/** Expire all borrowed results after every view has finished consuming them. */
	beginFrame(): void {
		this.#prepared.clear();
		for (const storage of this.#storage) storage.ranges.length = 0;
	}

	/** All calls use the same committed appearance, coherent pose, and frame-global visibility. */
	prepare(
		nodeId: SceneNodeId,
		plan: Extract<PreparedDynamicAppearance, { kind: "drawable" }>["plan"],
		parts: readonly Pick<ActiveDynamicPart, "frameInstance">[],
		showRetailHiddenGeometry: boolean,
	): readonly Readonly<DynamicOpaqueSpan>[] {
		const previous = this.#prepared.get(nodeId);
		if (previous !== undefined) return previous;
		let storage = this.#storage[this.#prepared.size];
		if (storage === undefined) {
			storage = { ranges: [], pool: [] };
			this.#storage.push(storage);
		}
		const { ranges, pool } = storage;
		let previousBatch: (typeof plan.batches)[number] | null = null;
		let end = -1;
		for (const [rangeIndex, range] of plan.physicalRanges.entries()) {
			const part = parts[range.source.partSelector];
			if (part === undefined)
				throw new Error(
					`Dynamic color range references missing part ${range.source.partSelector}.`,
				);
			const opacity = part.frameInstance.color.a;
			// Match existing routing: only opaque material becomes transparent under a partial fade.
			if (
				opacity === 0 ||
				!(
					range.source.ordering === "alpha-test" ||
					(range.source.ordering === "opaque" && opacity === 1)
				) ||
				!retainsRetailGeometry(
					range.source.retailVisibility,
					showRetailHiddenGeometry,
				)
			)
				continue;
			const last = ranges.at(-1);
			if (
				last !== undefined &&
				previousBatch === range.batch &&
				end === range.indexStart
			) {
				last.indexCount += range.source.indexCount;
			} else {
				let span = pool[ranges.length];
				if (span === undefined) {
					span = { rangeIndex, indexCount: range.source.indexCount };
					pool.push(span);
				} else {
					span.rangeIndex = rangeIndex;
					span.indexCount = range.source.indexCount;
				}
				ranges.push(span);
			}
			previousBatch = range.batch;
			end = range.indexStart + range.source.indexCount;
		}
		this.#prepared.set(nodeId, ranges);
		return ranges;
	}
}
