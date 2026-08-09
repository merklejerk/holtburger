import {
	createPortalModelFootprint,
	portalModelFootprintCardinality,
	portalModelFootprintHas,
	portalModelFootprintsOverlap,
	portalModelPixel,
	validatePortalModelScene,
	type PortalModelCrossingId,
	type PortalModelFragment,
	type PortalModelFragmentId,
	type PortalModelPixel,
	type PortalModelScene,
	type PortalModelScopeId,
	type PortalModelViewId,
} from "./portal-model";
import {
	createPortalPotentialViewPlan,
	type PortalPotentialViewPlan,
	type PortalPotentialView,
} from "./portal-potential-view-plan";

export interface PortalDepthLabelInput {
	/** One unique arbitrary stencil value per active path depth, including root depth zero. */
	readonly labelsByPathDepth: readonly number[];
}

export interface PortalViewLabelInput {
	/** Completed potential-view plan selected before ownership execution. */
	readonly plan: PortalPotentialViewPlan;
	/** Transient exact ownership labels allocated for this potential-view plan. */
	readonly labelsByViewId: ReadonlyMap<PortalModelViewId, number>;
}

/** Complete quality/work budget applied only at whole portal-depth frontiers. */
export interface PortalCompositingBudget {
	/** Maximum conflict colors available to the retained views, capped by uint8 stencil. */
	readonly maximumOwnershipLabelCount: number;
	/** Deepest portal ancestry that may be retained. Root is depth zero. */
	readonly maximumPathDepth: number;
	/** Maximum cumulative potential views admitted through a complete frontier. */
	readonly maximumPotentialViewCount: number;
}

type PortalFrontierTruncation =
	| {
			readonly firstOmittedPathDepth: number;
			readonly kind: "maximum-ownership-label-count";
			readonly requiredOwnershipLabelCount: number;
	  }
	| {
			readonly firstOmittedPathDepth: number;
			readonly kind: "maximum-path-depth";
	  }
	| {
			readonly firstOmittedPathDepth: number;
			readonly kind: "maximum-potential-view-count";
			readonly requiredPotentialViewCount: number;
	  };

/** Complete ownership plan after retaining the deepest whole frontier inside budget. */
export interface PortalBudgetedOwnershipPlan {
	/** Conflict coloring for exactly the retained potential views. */
	readonly labelsByViewId: ReadonlyMap<PortalModelViewId, number>;
	/** Deepest complete potential-view prefix admitted by every budget clause. */
	readonly plan: PortalPotentialViewPlan;
	/** Ownership colors consumed by the retained plan, including the root color. */
	readonly requiredOwnershipLabelCount: number;
	/** First rejected frontier and its deciding budget, or null when the full plan fits. */
	readonly truncation: PortalFrontierTruncation | null;
}

type PortalViewLabelAllocationResult =
	| {
			readonly kind: "overflow";
			readonly requiredLabelCount: number;
	  }
	| {
			readonly kind: "planned";
			readonly labelsByViewId: ReadonlyMap<PortalModelViewId, number>;
			readonly requiredLabelCount: number;
	  };

export type PortalDepthLabelOperation =
	| {
			readonly fragmentId: PortalModelFragmentId;
			readonly kind: "draw-opaque";
			readonly label: number;
			readonly pixel: PortalModelPixel;
	  }
	| {
			readonly crossingId: PortalModelCrossingId;
			readonly fromLabel: number;
			readonly kind: "reject-mask-depth" | "reject-mask-parent";
			readonly pixel: PortalModelPixel;
			readonly toLabel: number;
	  }
	| {
			readonly crossingId: PortalModelCrossingId;
			readonly fromLabel: number;
			readonly kind: "transition-and-reset";
			readonly pixel: PortalModelPixel;
			readonly toLabel: number;
	  };

interface PortalDepthLabelPixelResult {
	readonly label: number;
	readonly opaqueFragmentId: PortalModelFragmentId | null;
	readonly pixel: PortalModelPixel;
}

/** Complete finite opaque result from the path-depth stencil state machine. */
export interface PortalDepthLabelFrame {
	readonly operations: readonly PortalDepthLabelOperation[];
	readonly pixels: readonly PortalDepthLabelPixelResult[];
	/** Potential views narrowed to the pixels admitted by exact ownership transitions. */
	readonly views: readonly PortalPotentialView[];
}

interface OpaqueState {
	fragment: PortalModelFragment | null;
	label: number;
}

/**
 * Execute conservative potential views with labels assigned by active path depth, not portal or
 * domain identity. Parent equality and portal-plane depth are both mandatory before reset.
 */
export function executePortalDepthLabels(
	scene: PortalModelScene,
	input: PortalDepthLabelInput,
): PortalDepthLabelFrame {
	validatePortalModelScene(scene);
	const plan = createPortalPotentialViewPlan(scene);
	validateLabels(input.labelsByPathDepth, plan.maximumPathLength);
	return executePortalLabels(
		scene,
		plan,
		(view) => input.labelsByPathDepth[view.crossingIds.length]!,
	);
}

/**
 * Execute opaque portal ownership with one transient exact label per potential path view. Labels
 * are frame-local allocator output, not stable portal, scope, or domain identities.
 */
export function executePortalViewLabels(
	scene: PortalModelScene,
	input: PortalViewLabelInput,
): PortalDepthLabelFrame {
	validatePortalModelScene(scene);
	validateViewLabels(input.labelsByViewId, input.plan);
	return executePortalLabels(scene, input.plan, (view) => {
		const label = input.labelsByViewId.get(view.id);
		if (label === undefined)
			throw new Error(`Portal view ${view.id} has no ownership label.`);
		return label;
	});
}

/** Retain the largest complete path-depth prefix satisfying every compositing budget clause. */
export function planPortalOwnershipWithinBudget(
	plan: PortalPotentialViewPlan,
	budget: PortalCompositingBudget,
): PortalBudgetedOwnershipPlan {
	validateCompositingBudget(budget);
	let retainedPlan = potentialPlanThroughDepth(plan, 0);
	let retainedAllocation = requiredPlannedAllocation(
		preflightPortalViewLabels(retainedPlan, {
			maximumLabelCount: budget.maximumOwnershipLabelCount,
		}),
	);
	let truncation: PortalFrontierTruncation | null = null;
	for (let pathDepth = 1; pathDepth <= plan.maximumPathLength; pathDepth += 1) {
		if (pathDepth > budget.maximumPathDepth) {
			truncation = Object.freeze({
				firstOmittedPathDepth: pathDepth,
				kind: "maximum-path-depth",
			});
			break;
		}
		const candidate = potentialPlanThroughDepth(plan, pathDepth);
		if (candidate.views.length > budget.maximumPotentialViewCount) {
			truncation = Object.freeze({
				firstOmittedPathDepth: pathDepth,
				kind: "maximum-potential-view-count",
				requiredPotentialViewCount: candidate.views.length,
			});
			break;
		}
		const allocation = preflightPortalViewLabels(candidate, {
			maximumLabelCount: budget.maximumOwnershipLabelCount,
		});
		if (allocation.kind === "overflow") {
			truncation = Object.freeze({
				firstOmittedPathDepth: pathDepth,
				kind: "maximum-ownership-label-count",
				requiredOwnershipLabelCount: allocation.requiredLabelCount,
			});
			break;
		}
		retainedPlan = candidate;
		retainedAllocation = allocation;
	}
	return Object.freeze({
		labelsByViewId: retainedAllocation.labelsByViewId,
		plan: retainedPlan,
		requiredOwnershipLabelCount: retainedAllocation.requiredLabelCount,
		truncation,
	});
}

/**
 * Greedily reuse uint8 ownership labels across spatially disjoint views. Descendant coverage is a
 * subset of its parent, so footprint non-overlap is also sufficient to prevent cross-parent leaks.
 */
export function allocatePortalViewLabels(
	plan: PortalPotentialViewPlan,
): ReadonlyMap<PortalModelViewId, number> {
	const result = preflightPortalViewLabels(plan, { maximumLabelCount: 0x100 });
	if (result.kind === "overflow") {
		throw new Error(
			`Portal view-label execution requires ${result.requiredLabelCount} overlapping ownership labels; uint8 supports 256.`,
		);
	}
	return result.labelsByViewId;
}

/** Color a potential-view conflict graph and report capacity before any executor state changes. */
function preflightPortalViewLabels(
	plan: PortalPotentialViewPlan,
	input: { readonly maximumLabelCount: number },
): PortalViewLabelAllocationResult {
	if (
		!Number.isInteger(input.maximumLabelCount) ||
		input.maximumLabelCount <= 0
	) {
		throw new Error(
			"Portal ownership label capacity must be a positive integer.",
		);
	}
	const labels = new Map<PortalModelViewId, number>();
	let requiredLabelCount = 0;
	for (const view of plan.views) {
		const unavailable = new Set<number>();
		for (const previous of plan.views) {
			if (previous.id === view.id) break;
			if (!portalModelFootprintsOverlap(previous.coverage, view.coverage))
				continue;
			const previousLabel = labels.get(previous.id);
			if (previousLabel === undefined) {
				throw new Error(
					`Portal view-label allocator visited ${view.id} before ${previous.id}.`,
				);
			}
			unavailable.add(previousLabel);
		}
		let label = 0;
		while (unavailable.has(label)) label += 1;
		labels.set(view.id, label);
		requiredLabelCount = Math.max(requiredLabelCount, label + 1);
	}
	return requiredLabelCount > input.maximumLabelCount
		? Object.freeze({ kind: "overflow", requiredLabelCount })
		: Object.freeze({
				kind: "planned",
				labelsByViewId: labels,
				requiredLabelCount,
			});
}

function potentialPlanThroughDepth(
	plan: PortalPotentialViewPlan,
	maximumPathDepth: number,
): PortalPotentialViewPlan {
	const views = plan.views.filter(
		(view) => view.crossingIds.length <= maximumPathDepth,
	);
	return Object.freeze({
		maximumPathLength: views.reduce(
			(maximum, view) => Math.max(maximum, view.crossingIds.length),
			0,
		),
		raySegmentCount: views.reduce(
			(total, view) => total + portalModelFootprintCardinality(view.coverage),
			0,
		),
		views: Object.freeze(views),
	});
}

function requiredPlannedAllocation(
	allocation: PortalViewLabelAllocationResult,
): Extract<PortalViewLabelAllocationResult, { readonly kind: "planned" }> {
	if (allocation.kind === "overflow") {
		throw new Error(
			"Portal root view exceeds a validated ownership-label budget.",
		);
	}
	return allocation;
}

function validateCompositingBudget(budget: PortalCompositingBudget): void {
	if (
		!Number.isInteger(budget.maximumOwnershipLabelCount) ||
		budget.maximumOwnershipLabelCount <= 0 ||
		budget.maximumOwnershipLabelCount > 0x100
	) {
		throw new Error(
			"Portal ownership-label budget must be an integer from 1 through 256.",
		);
	}
	if (
		!Number.isInteger(budget.maximumPathDepth) ||
		budget.maximumPathDepth < 0
	) {
		throw new Error("Portal path-depth budget must be a non-negative integer.");
	}
	if (
		!Number.isInteger(budget.maximumPotentialViewCount) ||
		budget.maximumPotentialViewCount <= 0
	) {
		throw new Error("Portal potential-view budget must be a positive integer.");
	}
}

function executePortalLabels(
	scene: PortalModelScene,
	plan: PortalPotentialViewPlan,
	labelForView: (view: PortalPotentialView) => number,
): PortalDepthLabelFrame {
	const fragmentsByScopePixel = indexOpaqueFragments(scene);
	const operations: PortalDepthLabelOperation[] = [];
	const pixels: PortalDepthLabelPixelResult[] = [];
	const admittedByViewId = new Map(
		plan.views.map((view) => [
			view.id,
			{
				covered: Array<boolean>(scene.pixelCount).fill(false),
				entryDepthByPixel: Array<PortalModelFragment["depth"] | null>(
					scene.pixelCount,
				).fill(null),
			},
		]),
	);
	for (let pixelValue = 0; pixelValue < scene.pixelCount; pixelValue += 1) {
		const pixel = portalModelPixel(pixelValue, scene.pixelCount);
		const views = plan.views
			.filter((view) => portalModelFootprintHas(view.coverage, pixel))
			.sort((left, right) => compareViewsAtPixel(left, right, pixel));
		const root = views.find((view) => view.crossingIds.length === 0);
		if (!root)
			throw new Error(`Portal depth-label plan has no root at pixel ${pixel}.`);
		admitView(admittedByViewId, root, pixel, null);
		const state: OpaqueState = {
			fragment: nearestOpaque(fragmentsByScopePixel, root.scopeId, pixel),
			label: labelForView(root),
		};
		if (state.fragment) {
			operations.push({
				fragmentId: state.fragment.id,
				kind: "draw-opaque",
				label: state.label,
				pixel,
			});
		}
		for (const view of views) {
			const pathDepth = view.crossingIds.length;
			if (pathDepth === 0) continue;
			const crossingId = view.crossingIds[pathDepth - 1]!;
			if (view.parentViewId === null)
				throw new Error(`Non-root portal view ${view.id} has no parent.`);
			const parentView = plan.views.find(
				(candidate) => candidate.id === view.parentViewId,
			);
			if (!parentView)
				throw new Error(
					`Portal view ${view.id} references missing parent ${view.parentViewId}.`,
				);
			const fromLabel = labelForView(parentView);
			const toLabel = labelForView(view);
			if (state.label !== fromLabel) {
				operations.push({
					crossingId,
					fromLabel,
					kind: "reject-mask-parent",
					pixel,
					toLabel,
				});
				continue;
			}
			const portalDepth = view.entryDepthByPixel[pixel];
			if (portalDepth === null) {
				throw new Error(
					`Portal depth-label view ${view.id} has no entry depth at pixel ${pixel}.`,
				);
			}
			if (state.fragment && state.fragment.depth < portalDepth) {
				operations.push({
					crossingId,
					fromLabel,
					kind: "reject-mask-depth",
					pixel,
					toLabel,
				});
				continue;
			}
			state.label = toLabel;
			state.fragment = null;
			admitView(admittedByViewId, view, pixel, portalDepth);
			operations.push({
				crossingId,
				fromLabel,
				kind: "transition-and-reset",
				pixel,
				toLabel,
			});
			state.fragment = nearestOpaque(
				fragmentsByScopePixel,
				view.scopeId,
				pixel,
			);
			if (state.fragment) {
				operations.push({
					fragmentId: state.fragment.id,
					kind: "draw-opaque",
					label: state.label,
					pixel,
				});
			}
		}
		pixels.push(
			Object.freeze({
				label: state.label,
				opaqueFragmentId: state.fragment?.id ?? null,
				pixel,
			}),
		);
	}
	return Object.freeze({
		operations: Object.freeze(operations),
		pixels: Object.freeze(pixels),
		views: Object.freeze(
			plan.views.flatMap((view) => {
				const admitted = admittedByViewId.get(view.id);
				if (!admitted)
					throw new Error(`Portal view ${view.id} has no admission state.`);
				const coveredPixels = admitted.covered.flatMap((covered, pixel) =>
					covered ? [pixel] : [],
				);
				if (coveredPixels.length === 0) return [];
				return [
					Object.freeze({
						...view,
						coverage: createPortalModelFootprint(
							scene.pixelCount,
							coveredPixels,
						),
						entryDepthByPixel: Object.freeze([...admitted.entryDepthByPixel]),
					}),
				];
			}),
		),
	});
}

function admitView(
	admittedByViewId: Map<
		PortalModelViewId,
		{
			readonly covered: boolean[];
			readonly entryDepthByPixel: (PortalModelFragment["depth"] | null)[];
		}
	>,
	view: PortalPotentialView,
	pixel: PortalModelPixel,
	entryDepth: PortalModelFragment["depth"] | null,
): void {
	const admitted = admittedByViewId.get(view.id);
	if (!admitted)
		throw new Error(`Portal view ${view.id} has no admission state.`);
	admitted.covered[pixel] = true;
	admitted.entryDepthByPixel[pixel] = entryDepth;
}

function validateViewLabels(
	labels: ReadonlyMap<PortalModelViewId, number>,
	plan: PortalPotentialViewPlan,
): void {
	if (labels.size !== plan.views.length) {
		throw new Error(
			`Portal view-label execution requires exactly ${plan.views.length} labels; received ${labels.size}.`,
		);
	}
	const values = plan.views.map((view) => {
		const label = labels.get(view.id);
		if (label === undefined)
			throw new Error(`Portal view ${view.id} has no ownership label.`);
		return label;
	});
	if (
		values.some(
			(label) => !Number.isInteger(label) || label < 0 || label > 0xff,
		)
	) {
		throw new Error("Portal view labels must be uint8 integers.");
	}
	for (let leftIndex = 0; leftIndex < plan.views.length; leftIndex += 1) {
		const left = plan.views[leftIndex]!;
		for (
			let rightIndex = leftIndex + 1;
			rightIndex < plan.views.length;
			rightIndex += 1
		) {
			const right = plan.views[rightIndex]!;
			if (
				labels.get(left.id) === labels.get(right.id) &&
				portalModelFootprintsOverlap(left.coverage, right.coverage)
			) {
				throw new Error(
					`Overlapping portal views ${left.id} and ${right.id} share ownership label ${labels.get(left.id)}.`,
				);
			}
		}
	}
}

function compareViewsAtPixel(
	left: PortalPotentialView,
	right: PortalPotentialView,
	pixel: PortalModelPixel,
): number {
	const pathDepthDifference =
		left.crossingIds.length - right.crossingIds.length;
	if (pathDepthDifference !== 0) return pathDepthDifference;
	const leftDepth = left.entryDepthByPixel[pixel] ?? Number.NEGATIVE_INFINITY;
	const rightDepth = right.entryDepthByPixel[pixel] ?? Number.NEGATIVE_INFINITY;
	return leftDepth - rightDepth || left.id.localeCompare(right.id);
}

function nearestOpaque(
	fragmentsByScopePixel: ReadonlyMap<
		PortalModelScopeId,
		ReadonlyMap<PortalModelPixel, readonly PortalModelFragment[]>
	>,
	scopeId: PortalModelScopeId,
	pixel: PortalModelPixel,
): PortalModelFragment | null {
	return (
		fragmentsByScopePixel
			.get(scopeId)
			?.get(pixel)
			?.filter(isPassingOpaque)
			.reduce<PortalModelFragment | null>(
				(nearest, fragment) =>
					nearest === null || fragment.depth < nearest.depth
						? fragment
						: nearest,
				null,
			) ?? null
	);
}

function indexOpaqueFragments(
	scene: PortalModelScene,
): ReadonlyMap<
	PortalModelScopeId,
	ReadonlyMap<PortalModelPixel, readonly PortalModelFragment[]>
> {
	const mutable = new Map<
		PortalModelScopeId,
		Map<PortalModelPixel, PortalModelFragment[]>
	>();
	for (const domain of scene.domains) {
		for (const fragment of domain.fragments) {
			if (!isPassingOpaque(fragment)) continue;
			let byPixel = mutable.get(fragment.scopeId);
			if (!byPixel) {
				byPixel = new Map();
				mutable.set(fragment.scopeId, byPixel);
			}
			const fragments = byPixel.get(fragment.pixel) ?? [];
			fragments.push(fragment);
			byPixel.set(fragment.pixel, fragments);
		}
	}
	return mutable;
}

function isPassingOpaque(fragment: PortalModelFragment): boolean {
	return (
		fragment.kind === "opaque" ||
		(fragment.kind === "alpha-test" && fragment.passes)
	);
}

function validateLabels(
	labels: readonly number[],
	maximumPathLength: number,
): void {
	if (labels.length <= maximumPathLength) {
		throw new Error(
			`Portal depth-label execution requires ${maximumPathLength + 1} labels; received ${labels.length}.`,
		);
	}
	const used = labels.slice(0, maximumPathLength + 1);
	if (
		used.some((label) => !Number.isInteger(label) || label < 0 || label > 0xff)
	) {
		throw new Error("Portal depth labels must be uint8 integers.");
	}
	if (new Set(used).size !== used.length) {
		throw new Error("Portal depth labels must be unique across active depths.");
	}
}
