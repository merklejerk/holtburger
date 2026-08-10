import { FRONTEND_TUNING } from "../../frontend-tuning";

/** Squared near-policy boundary used before assigning the bounded physical-depth bands. */
const TRANSPARENT_NEAR_DISTANCE_SQUARED =
	FRONTEND_TUNING.rendering.transparentObjects.nearDistance ** 2;

/** One transparent range paired with its current-frame camera distance. */
export interface TransparentObjectRange<T> {
	/** Precomputed squared camera distance; avoids per-comparison coordinate work and allocations. */
	readonly distanceSquared: number;
	readonly range: T;
}

/** Far batchable and coarsely depth-ordered near transparent phases for one view. */
export interface OrderedTransparentObjectRanges<T> {
	/** Candidates outside the near-policy radius, grouped by stable batching cohort. */
	readonly far: readonly TransparentObjectRange<T>[];
	/** Candidates inside the near-policy radius, ordered by coarse back-to-front bands. */
	readonly near: readonly TransparentObjectRange<T>[];
	/** Exact structural work performed by the bounded production ordering policy. */
	readonly trace: TransparentObjectOrderingTrace;
}

/** Primitive CPU work performed while ordering one transparent population. */
export interface TransparentObjectOrderingTrace {
	/** Stable cohort-key evaluations; exactly one per physical candidate. */
	readonly batchKeyEvaluationCount: number;
	/** Far/near classifications; exactly one per physical candidate. */
	readonly depthBandClassificationCount: number;
	/** Fixed bounded-band slots visited when emitting the near phase. */
	readonly depthBucketVisitCount: number;
	/** Square roots needed only for candidates inside the near-policy radius. */
	readonly nearSquareRootCount: number;
}

/** Renderer-resolved ordering class consumed by the frame submission partition. */
export interface ObjectSubmissionOrderingInput {
	readonly ordering: "additive" | "alpha-test" | "opaque" | "transparent";
}

/**
 * One prepared object population partitioned into its depth-writing and deferred phases.
 *
 * The arrays contain the original prepared values. Visibility remains an outer submission
 * predicate and is deliberately absent from material/run compatibility.
 */
export interface ObjectSubmissionPhases<T> {
	/** Additive work submitted after ordered alpha under the final opaque depth buffer. */
	readonly additive: readonly T[];
	/** Opaque and passing-alpha-test candidates that participate in depth resolution. */
	readonly opaque: readonly T[];
	/** Far batchable and near camera-ordered alpha phases. */
	readonly transparent: {
		readonly far: readonly T[];
		readonly near: readonly T[];
	};
}

/** One phase-ordered transparent submission after adjacent frame cohorts are identified. */
export type ObjectFrameSubmission<T> =
	| { readonly kind: "single"; readonly value: T }
	| {
			readonly kind: "frame-instance-run";
			readonly values: readonly [T, ...T[]];
	  };

/** Renderer-private blend state derived from retail `D3DPolyRender::SetSurface` facts. */
export interface ObjectBlendPolicy {
	readonly source: "one" | "src-alpha" | "one-minus-src-alpha";
	readonly destination: "one" | "src-alpha" | "one-minus-src-alpha";
}

/** Four-component uniform value already compiled for object submission. */
type PreparedObjectVector4 = readonly [number, number, number, number];

/** Physical texture and sampler selected for one object texture unit. */
export interface PreparedObjectTextureBinding<TTexture, TSampler> {
	readonly sampler: TSampler;
	readonly texture: TTexture;
}

/** Atlas placement consumed beside one physical object texture binding. */
export interface PreparedObjectAtlasBinding<
	TTexture,
	TSampler,
> extends PreparedObjectTextureBinding<TTexture, TSampler> {
	readonly rect: PreparedObjectVector4;
}

/** Draw-constant material uniforms already compiled for object submission. */
export type PreparedObjectMaterial<TTexture, TSampler> =
	| {
			readonly color: PreparedObjectVector4;
			readonly kind: "solid-color";
	  }
	| {
			readonly base: PreparedObjectAtlasBinding<TTexture, TSampler>;
			readonly color: PreparedObjectVector4;
			readonly kind: "direct-color";
	  }
	| {
			readonly base: PreparedObjectAtlasBinding<TTexture, TSampler>;
			readonly color: PreparedObjectVector4;
			readonly kind: "index8" | "index16";
			readonly palette: PreparedObjectAtlasBinding<TTexture, TSampler>;
	  };

/** Optional detail state whose values are constant for one object draw. */
interface PreparedObjectDetail<
	TTexture,
	TSampler,
> extends PreparedObjectTextureBinding<TTexture, TSampler> {
	readonly rect: PreparedObjectVector4;
	readonly tiling: number;
}

/**
 * Exact facts that must agree before generated static instances can share one draw.
 *
 * Ordering class and render-domain scope remain caller-owned partitions. Instance records and
 * diagnostic provenance remain payload, not compatibility axes.
 */
export interface PreparedStaticObjectDrawCompatibility<
	TGeometry,
	TTexture,
	TSampler,
> {
	readonly alphaTest: number;
	readonly cullFace: "back" | "front";
	readonly detail: PreparedObjectDetail<TTexture, TSampler> | null;
	readonly geometry: TGeometry;
	readonly indexCount: number;
	readonly indexStart: number;
	readonly landblockOffset: readonly [number, number, number];
	readonly luminosity: number;
	readonly material: PreparedObjectMaterial<TTexture, TSampler>;
	readonly palettedClipMap: boolean;
	readonly wrapRepeat: boolean;
}

/** Compare only facts consumed as constants by one current generated-static instanced draw. */
export function areStaticObjectDrawsCompatible<TGeometry, TTexture, TSampler>(
	left: PreparedStaticObjectDrawCompatibility<TGeometry, TTexture, TSampler>,
	right: PreparedStaticObjectDrawCompatibility<TGeometry, TTexture, TSampler>,
): boolean {
	return (
		left.geometry === right.geometry &&
		left.indexStart === right.indexStart &&
		left.indexCount === right.indexCount &&
		left.cullFace === right.cullFace &&
		vector3Equals(left.landblockOffset, right.landblockOffset) &&
		left.wrapRepeat === right.wrapRepeat &&
		left.palettedClipMap === right.palettedClipMap &&
		left.alphaTest === right.alphaTest &&
		left.luminosity === right.luminosity &&
		preparedObjectMaterialEquals(left.material, right.material) &&
		preparedObjectDetailEquals(left.detail, right.detail)
	);
}

const SURFACE_CLIP_MAP = 0x4;
const SURFACE_TRANSLUCENT = 0x10;
const SURFACE_ALPHA = 0x100;
const SURFACE_INVERSE_ALPHA = 0x200;
const SURFACE_ADDITIVE = 0x10000;

/**
 * Compile transparent and additive source flags without leaking WebGL constants upstream.
 *
 * Reproduces retail's blend selection (`D3DPolyRender`, acclient.c:434096-434160), including its
 * final override: a `SURFACE_TRANSLUCENT` surface falls back to ordinary alpha blending, discarding
 * an additive destination, whenever the clip-map path has run or no blend was selected at all
 * (`skipChk || !v9 || singlePassDetailing`). Without that override an additive-plus-clip-map
 * surface blends additively and saturates — which is what turned the authored overcast cloud sheet
 * (`0x01004C35`, flags `0x10114`) into a white-out instead of a grey overcast.
 */
export function objectBlendPolicy(rawSurfaceFlags: number): ObjectBlendPolicy {
	// Retail's translucent override runs last and discards whatever blend the earlier stages chose,
	// so it returns before them rather than qualifying `additive`.
	if (
		(rawSurfaceFlags & SURFACE_TRANSLUCENT) !== 0 &&
		(rawSurfaceFlags & SURFACE_CLIP_MAP) !== 0
	) {
		return { destination: "one-minus-src-alpha", source: "src-alpha" };
	}
	const additive = (rawSurfaceFlags & SURFACE_ADDITIVE) !== 0;
	const alpha = (rawSurfaceFlags & SURFACE_ALPHA) !== 0;
	const inverseAlpha = (rawSurfaceFlags & SURFACE_INVERSE_ALPHA) !== 0;
	if (alpha) {
		return additive
			? { destination: "one", source: "src-alpha" }
			: { destination: "one-minus-src-alpha", source: "src-alpha" };
	}
	if (inverseAlpha) {
		return additive
			? { destination: "one", source: "one-minus-src-alpha" }
			: { destination: "src-alpha", source: "one-minus-src-alpha" };
	}
	return additive
		? { destination: "one", source: "one" }
		: { destination: "one-minus-src-alpha", source: "src-alpha" };
}

/** Retail sources encode translucency as either a unit float or a legacy byte-scale value. */
export function sourceOpacity(translucency: number): number {
	const normalized =
		translucency > 1 ? 1 - Math.min(translucency, 255) / 255 : 1 - translucency;
	return Math.max(0, Math.min(1, normalized));
}

/** Partition transparency into bounded depth bands and stable owner-provided batching cohorts. */
export function orderTransparentObjectRanges<T>(
	ranges: readonly TransparentObjectRange<T>[],
	batchKey: (range: T) => string | null,
): OrderedTransparentObjectRanges<T> {
	const far: TransparentObjectRange<T>[] = [];
	const nearBuckets = Array.from(
		{ length: FRONTEND_TUNING.rendering.transparentObjects.depthBucketCount },
		() => [] as TransparentObjectRange<T>[],
	);
	let nearSquareRootCount = 0;
	for (const range of ranges) {
		if (range.distanceSquared > TRANSPARENT_NEAR_DISTANCE_SQUARED) {
			far.push(range);
			continue;
		}
		nearSquareRootCount += 1;
		const bucket = Math.min(
			FRONTEND_TUNING.rendering.transparentObjects.depthBucketCount - 1,
			Math.floor(
				(Math.sqrt(range.distanceSquared) /
					FRONTEND_TUNING.rendering.transparentObjects.nearDistance) *
					FRONTEND_TUNING.rendering.transparentObjects.depthBucketCount,
			),
		);
		const bucketRanges = nearBuckets[bucket];
		if (!bucketRanges) {
			throw new Error(
				`Transparent range produced invalid depth bucket ${bucket}.`,
			);
		}
		bucketRanges.push(range);
	}
	const near: TransparentObjectRange<T>[] = [];
	for (let index = nearBuckets.length - 1; index >= 0; index -= 1) {
		const bucketRanges = nearBuckets[index];
		if (!bucketRanges) {
			throw new Error(`Transparent depth bucket ${index} is missing.`);
		}
		for (const range of groupTransparentRanges(bucketRanges, batchKey)) {
			near.push(range);
		}
	}
	return {
		far: groupTransparentRanges(far, batchKey),
		near,
		trace: {
			batchKeyEvaluationCount: ranges.length,
			depthBandClassificationCount: ranges.length,
			depthBucketVisitCount: nearBuckets.length,
			nearSquareRootCount,
		},
	};
}

/**
 * Partition one already-prepared physical object population without rediscovering material facts.
 *
 * Every input is inspected once. Only transparent values pay for camera-distance evaluation and
 * the existing bounded far/near ordering policy. Callers may then route the opaque array into the
 * scope atlas and defer the other arrays without preparing the source objects again.
 */
export function createObjectSubmissionPhases<
	T extends ObjectSubmissionOrderingInput,
>(
	objects: readonly T[],
	transparentDistanceSquared: (object: T) => number,
	transparentBatchKey: (object: T) => string | null,
): ObjectSubmissionPhases<T> {
	const opaque: T[] = [];
	const transparent: TransparentObjectRange<T>[] = [];
	const additive: T[] = [];
	for (const object of objects) {
		switch (object.ordering) {
			case "opaque":
			case "alpha-test":
				opaque.push(object);
				break;
			case "transparent": {
				const distanceSquared = transparentDistanceSquared(object);
				if (!Number.isFinite(distanceSquared) || distanceSquared < 0) {
					throw new Error(
						"Transparent object camera distance must be finite and non-negative.",
					);
				}
				transparent.push({ distanceSquared, range: object });
				break;
			}
			case "additive":
				additive.push(object);
				break;
		}
	}
	const ordered = orderTransparentObjectRanges(
		transparent,
		transparentBatchKey,
	);
	return {
		additive,
		opaque,
		transparent: {
			far: ordered.far.map(({ range }) => range),
			near: ordered.near.map(({ range }) => range),
		},
	};
}

/** Group repeated cohorts in first-seen order; null keys remain singleton submissions. */
function groupTransparentRanges<T>(
	ranges: readonly TransparentObjectRange<T>[],
	batchKey: (range: T) => string | null,
): readonly TransparentObjectRange<T>[] {
	const groups: TransparentObjectRange<T>[][] = [];
	const groupByKey = new Map<string, TransparentObjectRange<T>[]>();
	for (const range of ranges) {
		const key = batchKey(range.range);
		if (key === null) {
			groups.push([range]);
			continue;
		}
		let group = groupByKey.get(key);
		if (!group) {
			group = [];
			groupByKey.set(key, group);
			groups.push(group);
		}
		group.push(range);
	}
	const ordered: TransparentObjectRange<T>[] = [];
	for (const group of groups) {
		for (const range of group) ordered.push(range);
	}
	return ordered;
}

/**
 * Form frame-instance runs only after phase ordering, leaving every non-frame value as a barrier.
 */
export function formAdjacentObjectInstanceRuns<T>(
	ordered: readonly T[],
	isFrameInstance: (value: T) => boolean,
	isCompatible: (left: T, right: T) => boolean,
): readonly ObjectFrameSubmission<T>[] {
	// Runs are built once and exposed readonly. Appending in place avoids repeatedly copying a
	// growing compatible run, which turns generated-scenery compaction quadratic.
	const submissions: Array<
		| { readonly kind: "single"; readonly value: T }
		| { readonly kind: "frame-instance-run"; readonly values: [T, ...T[]] }
	> = [];
	for (const value of ordered) {
		if (!isFrameInstance(value)) {
			submissions.push({ kind: "single", value });
			continue;
		}
		const previous = submissions.at(-1);
		if (
			previous?.kind === "frame-instance-run" &&
			isCompatible(previous.values[previous.values.length - 1], value)
		) {
			previous.values.push(value);
			continue;
		}
		submissions.push({ kind: "frame-instance-run", values: [value] });
	}
	return submissions;
}

/**
 * Group compatible opaque frame instances by an owner-provided semantic cohort in first-seen
 * order. Exact compatibility remains authoritative when a cohort key is stale or collides.
 */
export function formGroupedObjectInstanceRuns<T>(
	ordered: readonly T[],
	isFrameInstance: (value: T) => boolean,
	batchKey: (value: T) => string,
	isCompatible: (left: T, right: T) => boolean,
): readonly ObjectFrameSubmission<T>[] {
	type MutableRun = { kind: "frame-instance-run"; values: [T, ...T[]] };
	const submissions: Array<
		{ readonly kind: "single"; readonly value: T } | MutableRun
	> = [];
	const runsByBatchKey = new Map<string, MutableRun[]>();
	for (const value of ordered) {
		if (!isFrameInstance(value)) {
			submissions.push({ kind: "single", value });
			continue;
		}
		const key = batchKey(value);
		let runs = runsByBatchKey.get(key);
		if (!runs) {
			runs = [];
			runsByBatchKey.set(key, runs);
		}
		const compatible = runs.find((run) => isCompatible(run.values[0], value));
		if (compatible) {
			compatible.values.push(value);
			continue;
		}
		const created: MutableRun = { kind: "frame-instance-run", values: [value] };
		runs.push(created);
		submissions.push(created);
	}
	return submissions;
}

function preparedObjectMaterialEquals<TTexture, TSampler>(
	left: PreparedObjectMaterial<TTexture, TSampler>,
	right: PreparedObjectMaterial<TTexture, TSampler>,
): boolean {
	if (left.kind !== right.kind || !vector4Equals(left.color, right.color)) {
		return false;
	}
	if (left.kind === "solid-color" || right.kind === "solid-color") {
		return left.kind === right.kind;
	}
	if (!preparedObjectAtlasBindingEquals(left.base, right.base)) return false;
	if (left.kind === "direct-color" || right.kind === "direct-color") {
		return left.kind === right.kind;
	}
	return preparedObjectAtlasBindingEquals(left.palette, right.palette);
}

function preparedObjectDetailEquals<TTexture, TSampler>(
	left: PreparedObjectDetail<TTexture, TSampler> | null,
	right: PreparedObjectDetail<TTexture, TSampler> | null,
): boolean {
	if (left === null || right === null) return left === right;
	return (
		preparedObjectTextureBindingEquals(left, right) &&
		vector4Equals(left.rect, right.rect) &&
		left.tiling === right.tiling
	);
}

function preparedObjectAtlasBindingEquals<TTexture, TSampler>(
	left: PreparedObjectAtlasBinding<TTexture, TSampler>,
	right: PreparedObjectAtlasBinding<TTexture, TSampler>,
): boolean {
	return (
		preparedObjectTextureBindingEquals(left, right) &&
		vector4Equals(left.rect, right.rect)
	);
}

function preparedObjectTextureBindingEquals<TTexture, TSampler>(
	left: PreparedObjectTextureBinding<TTexture, TSampler>,
	right: PreparedObjectTextureBinding<TTexture, TSampler>,
): boolean {
	return left.texture === right.texture && left.sampler === right.sampler;
}

function vector3Equals(
	left: readonly [number, number, number],
	right: readonly [number, number, number],
): boolean {
	return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
}

function vector4Equals(
	left: PreparedObjectVector4,
	right: PreparedObjectVector4,
): boolean {
	return (
		left[0] === right[0] &&
		left[1] === right[1] &&
		left[2] === right[2] &&
		left[3] === right[3]
	);
}
