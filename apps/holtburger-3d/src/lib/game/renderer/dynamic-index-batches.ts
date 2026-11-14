import type { DynamicAppearance } from "../systems/dynamic-appearance";
import {
	objectBlendPolicy,
	type ObjectBlendPolicy,
	type PreparedObjectMaterial,
	type PreparedObjectTextureBinding,
	type PreparedObjectSurface,
} from "./object-rendering-policy";

/** Physical state shared by one contiguous dynamic index batch. */
interface DynamicIndexBatch<TTexture, TSampler> {
	/** Promoted bindings used by every table-selected material in this physical span. */
	readonly textures: {
		readonly base: PreparedObjectTextureBinding<TTexture, TSampler> | null;
		readonly palette: PreparedObjectTextureBinding<TTexture, TSampler> | null;
	};
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
	/** Contiguous ordinary draws for compatible opaque/additive ranges and ordered residue. */
	readonly batches: readonly DynamicIndexBatch<TTexture, TSampler>[];
	/** Original appearance-range order with remapped offsets for transparent sorting and fades. */
	readonly ranges: readonly {
		/** Original logical range, including part/material selectors and polygon provenance. */
		readonly source: DynamicAppearance["ranges"][number];
		/** Resolved source material, retained for diagnostics independent of physical batching. */
		readonly material: PreparedObjectMaterial<TTexture, TSampler>;
		/** Owning physical batch, shared rather than re-derived for each range. */
		readonly batch: DynamicIndexBatch<TTexture, TSampler>;
		/** New first index inside the appearance's buffer. */
		readonly indexStart: number;
		/** Stable ordinal in physicalRanges, including ranges excluded from a color phase. */
		readonly physicalOrdinal: number;
	}[];
	/** The same range records in physical index order for material-free depth and mask coalescing. */
	readonly physicalRanges: DynamicIndexPlan<TTexture, TSampler>["ranges"];
	/** Cold source-phase partitions; current opacity and retail visibility remain frame decisions. */
	readonly colorRanges: {
		readonly opaque: DynamicIndexPlan<TTexture, TSampler>["ranges"];
		readonly additive: DynamicIndexPlan<TTexture, TSampler>["ranges"];
	};
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
		/** Non-commutative additive ranges separate reorderable additive segments. */
		additiveSegment: number;
		state: Omit<
			DynamicIndexBatch<TTexture, TSampler>,
			"indexStart" | "indexCount"
		>;
		ranges: {
			source: DynamicAppearance["ranges"][number];
			material: PreparedObjectMaterial<TTexture, TSampler>;
			ordinal: number;
		}[];
	}[] = [];
	let additiveSegment = 0;
	for (const [ordinal, range] of appearance.ranges.entries()) {
		const surface = surfaces[range.materialSelector];
		const blendPolicy = blendPolicies[range.materialSelector];
		if (surface === undefined || blendPolicy === undefined)
			throw new Error(
				`Dynamic range references missing material selector ${range.materialSelector}.`,
			);
		const state = {
			textures: physicalTextures(surface.material),
			ordering: range.ordering,
			cullFace: range.polygon.cullFace,
			retailVisibility: range.retailVisibility,
			blendPolicy,
		};
		// Source-only factors with destination ONE commute while depth writes are disabled.
		// Retail flag overrides can put alpha blending in the additive phase: never move an
		// additive batch across such a range. Transparent ranges retain their source identities.
		const additive = range.ordering === "additive";
		const reorderableAdditive = additive && blendPolicy.destination === "one";
		if (additive && !reorderableAdditive) additiveSegment += 1;
		let group =
			range.ordering === "opaque" ||
			range.ordering === "alpha-test" ||
			reorderableAdditive
				? groups.find(
						({ state: previous, additiveSegment: segment }) =>
							(!additive || segment === additiveSegment) &&
							(previous.ordering === state.ordering ||
								(previous.ordering !== "additive" &&
									state.ordering !== "additive")) &&
							previous.cullFace === state.cullFace &&
							previous.retailVisibility === state.retailVisibility &&
							previous.blendPolicy.source === state.blendPolicy.source &&
							previous.blendPolicy.destination ===
								state.blendPolicy.destination &&
							compatiblePhysicalTextures(previous.textures, state.textures),
					)
				: undefined;
		if (group === undefined) {
			group = { state, ranges: [], additiveSegment };
			groups.push(group);
		} else {
			// Solid and direct-color table entries leave unused texture units unconstrained.
			group.state = {
				...group.state,
				textures: {
					base: group.state.textures.base ?? state.textures.base,
					palette: group.state.textures.palette ?? state.textures.palette,
				},
			};
		}
		group.ranges.push({ source: range, material: surface.material, ordinal });
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
		// Shadow depth accepts opaque ranges only; keep them adjacent inside a merged
		// opaque/alpha-test span so it can submit one contiguous index range.
		if (group.state.ordering !== "additive")
			group.ranges.sort(
				(left, right) =>
					Number(left.source.ordering === "alpha-test") -
					Number(right.source.ordering === "alpha-test"),
			);
		const batch = {
			...group.state,
			indexStart: offset,
			indexCount: group.ranges.reduce(
				(sum, range) => sum + range.source.indexCount,
				0,
			),
		};
		batches.push(batch);
		for (const { source, material, ordinal } of group.ranges) {
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
			remapped.push({
				ordinal,
				range: {
					source,
					material,
					batch,
					indexStart: offset,
					physicalOrdinal: remapped.length,
				},
			});
			offset += source.indexCount;
		}
	}
	const physicalRanges = remapped.map(({ range }) => range);
	const opaque: (typeof physicalRanges)[number][] = [];
	const additive: (typeof physicalRanges)[number][] = [];
	for (const range of physicalRanges) {
		if (
			range.source.ordering === "opaque" ||
			range.source.ordering === "alpha-test"
		)
			opaque.push(range);
		else if (range.source.ordering === "additive") additive.push(range);
	}
	return {
		indices,
		batches,
		physicalRanges,
		colorRanges: { opaque, additive },
		ranges: remapped
			.sort((left, right) => left.ordinal - right.ordinal)
			.map(({ range }) => range),
	};
}

/** Compare only actual bind state; all other surface differences are table-selected. */
function physicalTextures<TTexture, TSampler>(
	material: PreparedObjectMaterial<TTexture, TSampler>,
): DynamicIndexBatch<TTexture, TSampler>["textures"] {
	return {
		base: material.kind === "solid-color" ? null : material.base,
		palette:
			material.kind === "index8" || material.kind === "index16"
				? material.palette
				: null,
	};
}

function compatiblePhysicalTextures<TTexture, TSampler>(
	left: DynamicIndexBatch<TTexture, TSampler>["textures"],
	right: DynamicIndexBatch<TTexture, TSampler>["textures"],
): boolean {
	return (
		compatibleBinding(left.base, right.base) &&
		compatibleBinding(left.palette, right.palette)
	);
}

function compatibleBinding<TTexture, TSampler>(
	left: PreparedObjectTextureBinding<TTexture, TSampler> | null,
	right: PreparedObjectTextureBinding<TTexture, TSampler> | null,
): boolean {
	return (
		left === null ||
		right === null ||
		(left.texture === right.texture && left.sampler === right.sampler)
	);
}
