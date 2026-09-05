import type { DynamicAppearance } from "../systems/dynamic-appearance";
import {
	objectBlendPolicy,
	type ObjectBlendPolicy,
	type PreparedObjectMaterial,
	type PreparedObjectSurface,
} from "./object-rendering-policy";

/** Physical state shared by one contiguous dynamic index batch. */
interface DynamicIndexBatch<TTexture, TSampler> {
	/** Material exemplar supplies only encoding and physical texture/sampler bindings. */
	readonly material: PreparedObjectMaterial<TTexture, TSampler>;
	/** Source phase, before frame-current part opacity routing. */
	readonly ordering: DynamicAppearance["ranges"][number]["ordering"];
	/** Effective raster face rejection; stippling provenance remains on individual ranges. */
	readonly cullFace: "back" | "front";
	/** Authored visibility partitions remain selectable without rewriting the index buffer. */
	readonly retailVisibility: DynamicAppearance["ranges"][number]["retailVisibility"];
	/** Already-resolved blend factors also used when part effects require ordered residue. */
	readonly blendPolicy: ObjectBlendPolicy;
	/** Offset/count in index elements, not bytes. */
	readonly indexStart: number;
	readonly indexCount: number;
}

/** One appearance's physical index organization; vertex geometry remains layout-owned. */
interface DynamicIndexPlan<TTexture, TSampler> {
	/** Every source range copied once into its selected batch; no opaque/residue duplication. */
	readonly indices: Uint32Array;
	/** Contiguous ordinary draws for compatible opaque/alpha-test ranges and ordered residue. */
	readonly batches: readonly DynamicIndexBatch<TTexture, TSampler>[];
	/** Original appearance-range order with remapped offsets for transparent sorting and fades. */
	readonly ranges: readonly {
		/** Original logical range, including part/material selectors and polygon provenance. */
		readonly source: DynamicAppearance["ranges"][number];
		/** Owning physical batch, shared rather than re-derived for each range. */
		readonly batch: DynamicIndexBatch<TTexture, TSampler>;
		/** New first index inside the appearance's buffer. */
		readonly indexStart: number;
	}[];
	/** The same range records in physical index order for material-free depth and mask coalescing. */
	readonly physicalRanges: DynamicIndexPlan<TTexture, TSampler>["ranges"];
}

/** Cold physical batching: table-varying colors/rectangles/wrap do not split ordinary draws. */
export function compileDynamicIndexBatches<TTexture, TSampler>(
	sourceIndices: Uint16Array | Uint32Array,
	appearance: DynamicAppearance,
	surfaces: readonly PreparedObjectSurface<TTexture, TSampler>[],
): DynamicIndexPlan<TTexture, TSampler> {
	const blendPolicies = appearance.materials.map((material) =>
		objectBlendPolicy(material.source.rawSurfaceFlags),
	);
	const groups: {
		state: Omit<
			DynamicIndexBatch<TTexture, TSampler>,
			"indexStart" | "indexCount"
		>;
		ranges: { source: DynamicAppearance["ranges"][number]; ordinal: number }[];
	}[] = [];
	for (const [ordinal, range] of appearance.ranges.entries()) {
		const surface = surfaces[range.materialSelector];
		const blendPolicy = blendPolicies[range.materialSelector];
		if (surface === undefined || blendPolicy === undefined)
			throw new Error(
				`Dynamic range references missing material selector ${range.materialSelector}.`,
			);
		const state = {
			material: surface.material,
			ordering: range.ordering,
			cullFace: range.polygon.cullFace,
			retailVisibility: range.retailVisibility,
			blendPolicy,
		};
		// Ordered surfaces never join non-adjacent source ranges. Frame-time ordering retains
		// each range's identity even when an opaque batch later develops a partial part fade.
		let group =
			range.ordering === "opaque" || range.ordering === "alpha-test"
				? groups.find(
						({ state: previous }) =>
							previous.ordering === state.ordering &&
							previous.cullFace === state.cullFace &&
							previous.retailVisibility === state.retailVisibility &&
							previous.blendPolicy.source === state.blendPolicy.source &&
							previous.blendPolicy.destination ===
								state.blendPolicy.destination &&
							samePhysicalMaterial(previous.material, state.material),
					)
				: undefined;
		if (group === undefined) {
			group = { state, ranges: [] };
			groups.push(group);
		}
		group.ranges.push({ source: range, ordinal });
	}
	const count = appearance.ranges.reduce(
		(sum, range) => sum + range.indexCount,
		0,
	);
	const indices = new Uint32Array(count);
	const batches: DynamicIndexBatch<TTexture, TSampler>[] = [];
	const remapped: {
		ordinal: number;
		range: DynamicIndexPlan<TTexture, TSampler>["ranges"][number];
	}[] = [];
	let offset = 0;
	for (const group of groups) {
		const batch = {
			...group.state,
			indexStart: offset,
			indexCount: group.ranges.reduce(
				(sum, range) => sum + range.source.indexCount,
				0,
			),
		};
		batches.push(batch);
		for (const { source, ordinal } of group.ranges) {
			if (
				source.indexStart < 0 ||
				source.indexStart + source.indexCount > sourceIndices.length
			)
				throw new Error(
					`Dynamic range ${ordinal} exceeds its source index buffer.`,
				);
			indices.set(
				sourceIndices.subarray(
					source.indexStart,
					source.indexStart + source.indexCount,
				),
				offset,
			);
			remapped.push({ ordinal, range: { source, batch, indexStart: offset } });
			offset += source.indexCount;
		}
	}
	return {
		indices,
		batches,
		physicalRanges: remapped.map(({ range }) => range),
		ranges: remapped
			.sort((left, right) => left.ordinal - right.ordinal)
			.map(({ range }) => range),
	};
}

/** Compare only actual bind state; all other surface differences are table-selected. */
function samePhysicalMaterial<TTexture, TSampler>(
	left: PreparedObjectMaterial<TTexture, TSampler>,
	right: PreparedObjectMaterial<TTexture, TSampler>,
): boolean {
	if (left.kind !== right.kind) return false;
	if (left.kind === "solid-color" || right.kind === "solid-color") return true;
	if (
		left.base.texture !== right.base.texture ||
		left.base.sampler !== right.base.sampler
	)
		return false;
	if (left.kind === "direct-color" || right.kind === "direct-color")
		return true;
	return (
		left.palette.texture === right.palette.texture &&
		left.palette.sampler === right.palette.sampler
	);
}
