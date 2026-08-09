import {
	allocatePortalViewLabels,
	executePortalViewLabels,
	planPortalOwnershipWithinBudget,
	type PortalBudgetedOwnershipPlan,
	type PortalCompositingBudget,
	type PortalDepthLabelOperation,
} from "./portal-ownership-executor";
import {
	portalModelFootprintCardinality,
	portalModelFootprintHas,
	type PortalModelFragment,
	type PortalModelScene,
	type PortalModelViewId,
} from "./portal-model";
import {
	createPortalPotentialViewPlan,
	type PortalPotentialViewPlan,
} from "./portal-potential-view-plan";
import type {
	PortalReferenceFragment,
	PortalReferenceFrame,
	PortalReferencePixelResult,
} from "./portal-reference-compositor";
import {
	composePortalDeferredFromEnvelopes,
	createPortalScopeVisibilityEnvelopes,
	type PortalScopeVisibilityEnvelope,
} from "./portal-visibility-envelope";

/** End-to-end symbolic result for the shared-target view-ownership architecture. */
export interface PortalViewLabelCompositorFrame {
	readonly envelopes: readonly PortalScopeVisibilityEnvelope[];
	readonly labelsByViewId: ReadonlyMap<PortalModelViewId, number>;
	readonly operations: readonly PortalDepthLabelOperation[];
	readonly pixels: readonly PortalReferencePixelResult[];
	readonly views: PortalReferenceFrame["views"];
}

export interface PortalSelectedCompositorFrame {
	/** Single selected semantic family; caching is an orthogonal execution-cost rewrite. */
	readonly family: "bounded-view-stencil";
	/** Mechanical result for the retained whole-frontier plan. */
	readonly frame: PortalViewLabelCompositorFrame;
	/** Completed capacity decision consumed by the mechanical executor. */
	readonly ownershipPlan: PortalBudgetedOwnershipPlan;
	/** Final opaque and deferred composition at the selected quality frontier. */
	readonly pixels: readonly PortalReferencePixelResult[];
}

/**
 * Resolve opaque ownership, derive admitted scope envelopes from those exact transitions, then
 * submit every deferred fragment once against the completed opaque depth.
 */
export function executePortalViewLabelCompositor(
	scene: PortalModelScene,
): PortalViewLabelCompositorFrame {
	const plan = createPortalPotentialViewPlan(scene);
	const labelsByViewId = allocatePortalViewLabels(plan);
	return executePortalViewLabelCompositorPlan(scene, plan, labelsByViewId);
}

/** Execute the deepest whole path-depth frontier that satisfies every explicit work budget. */
export function executeSelectedPortalCompositor(
	scene: PortalModelScene,
	input: { readonly budget: PortalCompositingBudget },
): PortalSelectedCompositorFrame {
	const plan = createPortalPotentialViewPlan(scene);
	const ownershipPlan = planPortalOwnershipWithinBudget(plan, input.budget);
	const frame = executePortalViewLabelCompositorPlan(
		scene,
		ownershipPlan.plan,
		ownershipPlan.labelsByViewId,
	);
	return Object.freeze({
		family: "bounded-view-stencil",
		frame,
		ownershipPlan,
		pixels: frame.pixels,
	});
}

function executePortalViewLabelCompositorPlan(
	scene: PortalModelScene,
	plan: PortalPotentialViewPlan,
	labelsByViewId: ReadonlyMap<PortalModelViewId, number>,
): PortalViewLabelCompositorFrame {
	const opaque = executePortalViewLabels(scene, { labelsByViewId, plan });
	const fragmentById = new Map<string, PortalModelFragment>();
	for (const domain of scene.domains) {
		for (const fragment of domain.fragments)
			fragmentById.set(fragment.id, fragment);
	}
	const opaquePixels: PortalReferencePixelResult[] = opaque.pixels.map(
		(result) => {
			const fragment =
				result.opaqueFragmentId === null
					? null
					: fragmentById.get(result.opaqueFragmentId);
			if (result.opaqueFragmentId !== null && !fragment) {
				throw new Error(
					`Portal view-label result references missing fragment ${result.opaqueFragmentId}.`,
				);
			}
			const owner = opaque.views.find(
				(view) =>
					labelsByViewId.get(view.id) === result.label &&
					portalModelFootprintHas(view.coverage, result.pixel),
			);
			if (!owner)
				throw new Error(
					`Portal view-label result has no admitted owner for label ${result.label} at pixel ${result.pixel}.`,
				);
			const observed: PortalReferenceFragment | null = fragment
				? Object.freeze({
						depth: fragment.depth,
						fragmentId: fragment.id,
						paths: Object.freeze([
							Object.freeze({
								crossingIds: Object.freeze([...owner.crossingIds]),
							}),
						]),
					})
				: null;
			return Object.freeze({
				additive: Object.freeze([]),
				alphaBlended: Object.freeze([]),
				opaque: observed,
				pixel: result.pixel,
			});
		},
	);
	const opaqueFrame: PortalReferenceFrame = Object.freeze({
		diagnostics: Object.freeze({
			maximumPathLength: opaque.views.reduce(
				(maximum, view) => Math.max(maximum, view.crossingIds.length),
				0,
			),
			raySegmentCount: opaque.views.reduce(
				(total, view) => total + portalModelFootprintCardinality(view.coverage),
				0,
			),
			viewCount: opaque.views.length,
		}),
		pixels: Object.freeze(opaquePixels),
		views: opaque.views,
	});
	const envelopes = createPortalScopeVisibilityEnvelopes(scene, opaqueFrame);
	return Object.freeze({
		envelopes,
		labelsByViewId,
		operations: opaque.operations,
		pixels: composePortalDeferredFromEnvelopes(scene, opaqueFrame, envelopes),
		views: opaque.views,
	});
}
