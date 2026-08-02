/** Retail-proven radius within which transparent object ranges sort back-to-front every frame. */
export const OBJECT_TRANSPARENT_SORT_DISTANCE = 16;
/** Squared form used by the frame-time sorter; derived to avoid a duplicated threshold literal. */
export const OBJECT_TRANSPARENT_SORT_DISTANCE_SQUARED =
	OBJECT_TRANSPARENT_SORT_DISTANCE * OBJECT_TRANSPARENT_SORT_DISTANCE;

/** One transparent baked range paired with its current-frame camera distance. */
export interface TransparentObjectRange<T> {
	/** Precomputed squared camera distance; avoids per-comparison coordinate work and allocations. */
	readonly distanceSquared: number;
	readonly range: T;
	readonly stableId: string;
}

/** Far batchable and near distance-ordered transparent phases for one view. */
export interface OrderedTransparentObjectRanges<T> {
	/** Candidates outside the near-sort radius, ordered for deterministic draw compatibility. */
	readonly far: readonly TransparentObjectRange<T>[];
	/** Candidates inside the near-sort radius, ordered back-to-front. */
	readonly near: readonly TransparentObjectRange<T>[];
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

/**
 * Order prepared state for reuse and deterministic compaction without implying draw compatibility.
 */
export function comparePreparedObjectDrawState<TGeometry, TTexture, TSampler>(
	left: PreparedStaticObjectDrawCompatibility<TGeometry, TTexture, TSampler>,
	right: PreparedStaticObjectDrawCompatibility<TGeometry, TTexture, TSampler>,
	identityOrder: (identity: TGeometry | TTexture | TSampler) => number,
): number {
	return (
		left.cullFace.localeCompare(right.cullFace) ||
		comparePreparedObjectMaterial(
			left.material,
			right.material,
			identityOrder,
		) ||
		comparePreparedObjectDetail(left.detail, right.detail, identityOrder) ||
		compareBoolean(left.wrapRepeat, right.wrapRepeat) ||
		compareBoolean(left.palettedClipMap, right.palettedClipMap) ||
		left.alphaTest - right.alphaTest ||
		left.luminosity - right.luminosity ||
		identityOrder(left.geometry) - identityOrder(right.geometry) ||
		left.indexStart - right.indexStart ||
		left.indexCount - right.indexCount ||
		compareVector3(left.landblockOffset, right.landblockOffset)
	);
}

const SURFACE_ALPHA = 0x100;
const SURFACE_INVERSE_ALPHA = 0x200;
const SURFACE_ADDITIVE = 0x10000;

/** Compile transparent and additive source flags without leaking WebGL constants upstream. */
export function objectBlendPolicy(rawSurfaceFlags: number): ObjectBlendPolicy {
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

/** Partition one view's transparency and independently order its batchable far and sorted near phases. */
export function orderTransparentObjectRanges<T>(
	ranges: readonly TransparentObjectRange<T>[],
	compareFarForBatching: (left: T, right: T) => number,
): OrderedTransparentObjectRanges<T> {
	const far: TransparentObjectRange<T>[] = [];
	const near: TransparentObjectRange<T>[] = [];
	for (const range of ranges) {
		(range.distanceSquared <= OBJECT_TRANSPARENT_SORT_DISTANCE_SQUARED
			? near
			: far
		).push(range);
	}
	far.sort((left, right) => {
		const batchingOrder = compareFarForBatching(left.range, right.range);
		return batchingOrder !== 0
			? batchingOrder
			: left.stableId.localeCompare(right.stableId);
	});
	near.sort((left, right) => {
		const distanceOrder = right.distanceSquared - left.distanceSquared;
		return distanceOrder !== 0
			? distanceOrder
			: left.stableId.localeCompare(right.stableId);
	});
	return { far, near };
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

function comparePreparedObjectMaterial<TGeometry, TTexture, TSampler>(
	left: PreparedObjectMaterial<TTexture, TSampler>,
	right: PreparedObjectMaterial<TTexture, TSampler>,
	identityOrder: (identity: TGeometry | TTexture | TSampler) => number,
): number {
	const kind = materialKindOrder(left.kind) - materialKindOrder(right.kind);
	if (kind !== 0) return kind;
	const color = compareVector4(left.color, right.color);
	if (color !== 0) return color;
	if (left.kind === "solid-color" || right.kind === "solid-color") return 0;
	const base = comparePreparedObjectAtlasBinding(
		left.base,
		right.base,
		identityOrder,
	);
	if (base !== 0) return base;
	if (left.kind === "direct-color" || right.kind === "direct-color") return 0;
	return comparePreparedObjectAtlasBinding(
		left.palette,
		right.palette,
		identityOrder,
	);
}

function comparePreparedObjectDetail<TGeometry, TTexture, TSampler>(
	left: PreparedObjectDetail<TTexture, TSampler> | null,
	right: PreparedObjectDetail<TTexture, TSampler> | null,
	identityOrder: (identity: TGeometry | TTexture | TSampler) => number,
): number {
	if (left === null || right === null) {
		return left === right ? 0 : left === null ? -1 : 1;
	}
	return (
		comparePreparedObjectTextureBinding(left, right, identityOrder) ||
		compareVector4(left.rect, right.rect) ||
		left.tiling - right.tiling
	);
}

function comparePreparedObjectAtlasBinding<TGeometry, TTexture, TSampler>(
	left: PreparedObjectAtlasBinding<TTexture, TSampler>,
	right: PreparedObjectAtlasBinding<TTexture, TSampler>,
	identityOrder: (identity: TGeometry | TTexture | TSampler) => number,
): number {
	return (
		comparePreparedObjectTextureBinding(left, right, identityOrder) ||
		compareVector4(left.rect, right.rect)
	);
}

function comparePreparedObjectTextureBinding<TGeometry, TTexture, TSampler>(
	left: PreparedObjectTextureBinding<TTexture, TSampler>,
	right: PreparedObjectTextureBinding<TTexture, TSampler>,
	identityOrder: (identity: TGeometry | TTexture | TSampler) => number,
): number {
	return (
		identityOrder(left.texture) - identityOrder(right.texture) ||
		identityOrder(left.sampler) - identityOrder(right.sampler)
	);
}

function materialKindOrder(
	kind: PreparedObjectMaterial<never, never>["kind"],
): number {
	if (kind === "solid-color") return 0;
	if (kind === "direct-color") return 1;
	if (kind === "index8") return 2;
	return 3;
}

function compareBoolean(left: boolean, right: boolean): number {
	return Number(left) - Number(right);
}

function compareVector3(
	left: readonly [number, number, number],
	right: readonly [number, number, number],
): number {
	return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function compareVector4(
	left: PreparedObjectVector4,
	right: PreparedObjectVector4,
): number {
	return (
		left[0] - right[0] ||
		left[1] - right[1] ||
		left[2] - right[2] ||
		left[3] - right[3]
	);
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
