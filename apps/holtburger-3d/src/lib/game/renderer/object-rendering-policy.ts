import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";
import type { ObjectMaterialOrdering } from "../resolution/object-material-planner";
import type { RetailGeometryVisibility } from "../resolution/presentation";
import { retainsRetailGeometry } from "./retail-geometry-visibility";
import type { DynamicAppearance } from "../systems/dynamic-appearance";
import type { ActiveDynamicPart } from "../systems/components";

/** Frame-current admission shared by source-range metrics, nameplates, and analytic grounding. */
export interface DynamicRangeAdmission {
	/** Distinct authored source cohorts retained even when physical materials split their ranges. */
	readonly sourceRangeGroupCount: number;
	/** At least one authored opaque range survives opacity and retail visibility policy. */
	readonly hasMaterialFreeShadowGeometry: boolean;
}

/** Explicit admission for unavailable, preparing, or hidden publications. */
export const EMPTY_DYNAMIC_RANGE_ADMISSION: DynamicRangeAdmission = {
	sourceRangeGroupCount: 0,
	hasMaterialFreeShadowGeometry: false,
};

/** Static authored cohorts for one part; only current part opacity remains frame-dependent. */
export interface DynamicPartRangeGroups {
	/** Dense pose selector shared by all cohorts summarized here. */
	readonly partSelector: number;
	/** Counts and opaque geometry available under ordinary retail visibility. */
	readonly normallyVisible: DynamicRangeGroupSummary;
	/** The corresponding facts when debug policy includes retail-hidden geometry. */
	readonly includingRetailHidden: DynamicRangeGroupSummary;
}

/** Appearance-owned facts, independent of pose, placement, texture bindings and camera. */
interface DynamicRangeGroupSummary {
	/** Distinct source cohorts, regardless of physical material splits. */
	readonly sourceRangeGroupCount: number;
	/** At least one authored opaque range exists; cutouts cannot cast material-free shadows. */
	readonly hasOpaqueGeometry: boolean;
}

/** Compile immutable source grouping once when the appearance is retained, before frame work. */
export function compileDynamicPartRangeGroups(
	appearance: DynamicAppearance,
): readonly DynamicPartRangeGroups[] {
	const cohorts = new Map<
		DynamicAppearance["ranges"][number]["transparentSort"],
		number
	>();
	const parts = new Map<
		number,
		{
			groups: Set<DynamicAppearance["ranges"][number]["transparentSort"]>;
			normallyVisibleGroups: Set<
				DynamicAppearance["ranges"][number]["transparentSort"]
			>;
			hasOpaqueGeometry: boolean;
			hasNormallyVisibleOpaqueGeometry: boolean;
		}
	>();
	for (const range of appearance.ranges) {
		const previousPart = cohorts.get(range.transparentSort);
		if (previousPart !== undefined && previousPart !== range.partSelector)
			throw new Error("Dynamic source cohort spans multiple parts.");
		cohorts.set(range.transparentSort, range.partSelector);
		let part = parts.get(range.partSelector);
		if (part === undefined) {
			part = {
				groups: new Set(),
				normallyVisibleGroups: new Set(),
				hasOpaqueGeometry: false,
				hasNormallyVisibleOpaqueGeometry: false,
			};
			parts.set(range.partSelector, part);
		}
		part.groups.add(range.transparentSort);
		const normallyVisible = retainsRetailGeometry(
			range.retailVisibility,
			false,
		);
		if (normallyVisible) part.normallyVisibleGroups.add(range.transparentSort);
		if (range.ordering === "opaque") {
			part.hasOpaqueGeometry = true;
			if (normallyVisible) part.hasNormallyVisibleOpaqueGeometry = true;
		}
	}
	return Array.from(parts, ([partSelector, part]) => ({
		partSelector,
		normallyVisible: {
			sourceRangeGroupCount: part.normallyVisibleGroups.size,
			hasOpaqueGeometry: part.hasNormallyVisibleOpaqueGeometry,
		},
		includingRetailHidden: {
			sourceRangeGroupCount: part.groups.size,
			hasOpaqueGeometry: part.hasOpaqueGeometry,
		},
	}));
}

/** Material-free depth cannot evaluate cutouts; partial opaque fades retain their shadow geometry. */
export function retainsDynamicShadowRange(
	ordering: ObjectMaterialOrdering,
	opacity: number,
	visibility: RetailGeometryVisibility,
	showRetailHiddenGeometry: boolean,
): boolean {
	return (
		ordering === "opaque" &&
		opacity !== 0 &&
		retainsRetailGeometry(visibility, showRetailHiddenGeometry)
	);
}

/** Read current opacity once per contributing part, including validation after an eligible part. */
export function summarizeDynamicRangeAdmission(
	rangeGroupsByPart: readonly DynamicPartRangeGroups[],
	parts: readonly Pick<ActiveDynamicPart, "frameInstance">[],
	showRetailHiddenGeometry: boolean,
): DynamicRangeAdmission {
	let sourceRangeGroupCount = 0;
	let hasMaterialFreeShadowGeometry = false;
	for (const groups of rangeGroupsByPart) {
		const part = parts[groups.partSelector];
		if (part === undefined)
			throw new Error("Dynamic appearance references a missing part.");
		if (part.frameInstance.color.a === 0) continue;
		const summary = showRetailHiddenGeometry
			? groups.includingRetailHidden
			: groups.normallyVisible;
		sourceRangeGroupCount += summary.sourceRangeGroupCount;
		hasMaterialFreeShadowGeometry ||= summary.hasOpaqueGeometry;
	}
	return { sourceRangeGroupCount, hasMaterialFreeShadowGeometry };
}

/** Dynamic color-pass eligibility; view selection and sort order belong to each renderer. */
export function dynamicObjectPhase(
	ordering: ObjectMaterialOrdering,
	opacity: number,
	visibility: RetailGeometryVisibility,
	showRetailHiddenGeometry: boolean,
): "skip" | "opaque" | "transparent" | "additive" {
	if (
		opacity === 0 ||
		!retainsRetailGeometry(visibility, showRetailHiddenGeometry)
	)
		return "skip";
	// Partial fades move opaque surfaces to ordered alpha; alpha-test keeps depth writing.
	if (ordering === "opaque") return opacity === 1 ? "opaque" : "transparent";
	return ordering === "alpha-test" ? "opaque" : ordering;
}

/** Squared radius inside which transparent geometry receives exact camera-depth ordering. */
const TRANSPARENT_NEAR_DISTANCE_SQUARED =
	SHARED_FRONTEND_TUNING.rendering.transparentObjects.nearDistance ** 2;

/** Current-frame distance and stable identity; camera depth is derived only for near objects. */
export interface TransparentObjectSortFacts {
	/** Squared radial camera distance, used only to select the bounded near policy. */
	readonly distanceSquared: number;
	/** Stable physical identity used to break equal-depth ties deterministically. */
	readonly stableId: string;
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

/** Shader-consumed surface facts shared by uniform draws and dynamic material tables. */
export interface PreparedObjectSurface<TTexture, TSampler> {
	/** Resolved physical bindings and source color/opacity, independent from polygon state. */
	readonly material: PreparedObjectMaterial<TTexture, TSampler>;
	/** Fragment alpha rejection threshold; zero disables rejection. */
	readonly alphaTest: number;
	/** Authored emissive contribution, preserving the existing object shader semantics. */
	readonly luminosity: number;
	/** Indexed texture clip-map rejection, independent from direct-color alpha rejection. */
	readonly palettedClipMap: boolean;
	/** Geometry-authored wrapping within the selected atlas rectangle. */
	readonly wrapRepeat: boolean;
}

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
 * Every field is constant for its draw unit's lifetime, which is what lets one compiled value be
 * shared by every frame that submits the draw. The anchor-relative landblock offset must also
 * agree before two draws share a run, but it is a per-frame fact and so is compared by the caller
 * alongside this value rather than stored in it.
 *
 * Ordering class and render-domain scope remain caller-owned partitions. Instance records and
 * diagnostic provenance remain payload, not compatibility axes.
 */
export interface PreparedStaticObjectDrawCompatibility<
	TGeometry,
	TTexture,
	TSampler,
> extends PreparedObjectSurface<TTexture, TSampler> {
	readonly cullFace: "back" | "front";
	readonly detail: PreparedObjectDetail<TTexture, TSampler> | null;
	readonly geometry: TGeometry;
	readonly indexCount: number;
	readonly indexStart: number;
}

/** Compare only facts consumed as constants by one current generated-static instanced draw. */
export function areStaticObjectDrawsCompatible<TGeometry, TTexture, TSampler>(
	left: PreparedStaticObjectDrawCompatibility<TGeometry, TTexture, TSampler>,
	right: PreparedStaticObjectDrawCompatibility<TGeometry, TTexture, TSampler>,
): boolean {
	if (left === right) return true;
	return (
		left.geometry === right.geometry &&
		left.indexStart === right.indexStart &&
		left.indexCount === right.indexCount &&
		staticObjectDrawStateEquals(left, right)
	);
}

/**
 * Compare the device state two draws bind, ignoring which geometry range they read.
 *
 * Separate from `areStaticObjectDrawsCompatible` because the two questions differ: instance-run
 * coalescing needs draws that share a range and can therefore be submitted as one instanced call,
 * while a merge census asks which draws would bind identical state if their geometry were
 * re-partitioned into a shared buffer.
 */
export function staticObjectDrawStateEquals<TGeometry, TTexture, TSampler>(
	left: PreparedStaticObjectDrawCompatibility<TGeometry, TTexture, TSampler>,
	right: PreparedStaticObjectDrawCompatibility<TGeometry, TTexture, TSampler>,
): boolean {
	if (left === right) return true;
	return (
		left.cullFace === right.cullFace &&
		left.wrapRepeat === right.wrapRepeat &&
		left.palettedClipMap === right.palettedClipMap &&
		left.alphaTest === right.alphaTest &&
		left.luminosity === right.luminosity &&
		preparedObjectMaterialEquals(left.material, right.material) &&
		preparedObjectDetailEquals(left.detail, right.detail)
	);
}

/** Compare draw constants when per-surface values are read from material-table rows. */
export function staticObjectTableStateEquals<TGeometry, TTexture, TSampler>(
	left: PreparedStaticObjectDrawCompatibility<TGeometry, TTexture, TSampler>,
	right: PreparedStaticObjectDrawCompatibility<TGeometry, TTexture, TSampler>,
): boolean {
	if (
		left.geometry !== right.geometry ||
		left.cullFace !== right.cullFace ||
		!preparedObjectDetailEquals(left.detail, right.detail)
	)
		return false;
	const a = left.material,
		b = right.material;
	if (a.kind === "solid-color" || b.kind === "solid-color")
		return a.kind === b.kind;
	if (!preparedObjectTextureBindingEquals(a.base, b.base)) return false;
	if (a.kind === "direct-color" || b.kind === "direct-color")
		return a.kind === b.kind;
	return preparedObjectTextureBindingEquals(a.palette, b.palette);
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

/** One near object paired with the sort facts needed until its view's phases are complete. */
interface NearTransparentObject<T> {
	/** Camera-space depth derived once for this view, used for back-to-front ordering. */
	readonly cameraDepth: number;
	/** Borrowed prepared submission returned after ordering. */
	readonly object: T;
	/** Producer-owned identity copied from the validated facts for deterministic depth ties. */
	readonly stableId: string;
}

function compareStableIds(left: string, right: string): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

function validateTransparentObjectSortFacts(
	facts: TransparentObjectSortFacts,
): void {
	if (!Number.isFinite(facts.distanceSquared) || facts.distanceSquared < 0) {
		throw new Error(
			"Transparent object camera distance must be finite and non-negative.",
		);
	}
	if (facts.stableId.length === 0) {
		throw new Error("Transparent object stable identity must not be empty.");
	}
}

/**
 * Partition prepared objects directly into their depth-writing and deferred phases.
 *
 * Only near transparency carries depth-sort records; far objects enter first-seen cohort groups
 * immediately. Results own their arrays and borrow the prepared objects, so assembling another
 * portal view cannot overwrite a deferred phase from the previous view.
 */
export function createObjectSubmissionPhases<
	T extends ObjectSubmissionOrderingInput,
>(
	objects: readonly T[],
	transparentSortFacts: (object: T) => TransparentObjectSortFacts,
	transparentBatchKey: (object: T) => string | null,
	transparentCameraDepth: (object: T) => number,
): ObjectSubmissionPhases<T> {
	const opaque: T[] = [];
	const additive: T[] = [];
	const near: NearTransparentObject<T>[] = [];
	const farGroups: T[][] = [];
	const farGroupByKey = new Map<string, T[]>();
	for (const object of objects) {
		switch (object.ordering) {
			case "opaque":
			case "alpha-test":
				opaque.push(object);
				break;
			case "additive":
				additive.push(object);
				break;
			case "transparent": {
				const facts = transparentSortFacts(object);
				validateTransparentObjectSortFacts(facts);
				if (facts.distanceSquared <= TRANSPARENT_NEAR_DISTANCE_SQUARED) {
					const cameraDepth = transparentCameraDepth(object);
					if (!Number.isFinite(cameraDepth)) {
						throw new Error("Transparent object camera depth must be finite.");
					}
					near.push({ cameraDepth, object, stableId: facts.stableId });
					break;
				}
				const key = transparentBatchKey(object);
				// Unbatchable objects keep their own position among first-seen cohorts.
				if (key === null) {
					farGroups.push([object]);
					break;
				}
				let group = farGroupByKey.get(key);
				if (!group) {
					group = [];
					farGroupByKey.set(key, group);
					farGroups.push(group);
				}
				group.push(object);
				break;
			}
		}
	}
	near.sort(
		(left, right) =>
			right.cameraDepth - left.cameraDepth ||
			compareStableIds(left.stableId, right.stableId),
	);
	const far: T[] = [];
	for (const group of farGroups) {
		for (const object of group) far.push(object);
	}
	return {
		additive,
		opaque,
		transparent: { far, near: near.map(({ object }) => object) },
	};
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
export function formGroupedObjectInstanceRuns<T, TBatchKey>(
	ordered: readonly T[],
	isFrameInstance: (value: T) => boolean,
	batchKey: (value: T) => TBatchKey,
	isCompatible: (left: T, right: T) => boolean,
): readonly ObjectFrameSubmission<T>[] {
	type MutableRun = { kind: "frame-instance-run"; values: [T, ...T[]] };
	const submissions: Array<
		{ readonly kind: "single"; readonly value: T } | MutableRun
	> = [];
	const runsByBatchKey = new Map<TBatchKey, MutableRun[]>();
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
