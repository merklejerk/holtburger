import type { PortalCrossingId } from "../scene";
import type { PortalRenderWorkPlan } from "./portal-render-graph";
import { validatePortalRenderWorkPlan } from "./portal-render-plan-validation";
import type { PortalViewWindow } from "./portal-view-window";
import {
	validateResolvedPortalMask,
	type ResolvedPortalMask,
} from "./webgl2-portal-mask";
import type {
	PortalMaskStencilPolicy,
	PortalRenderExtent,
	WebGL2SceneDomainTarget,
} from "./webgl2-portal-substrate";

type PortalRenderNodeId = PortalRenderWorkPlan["nodes"][number]["id"];
type VisibilityApertureId = Extract<
	PortalRenderWorkPlan["maskEdges"][number]["maskSource"],
	{ readonly kind: "world-aperture" }
>["visibilityApertureId"];

/** Fixed-function surface consumed by the stateless portal graph executor. */
export interface PortalExecutionSubstrate {
	/** Establish an ordinary unmasked pass on an owned target. */
	beginTargetPass(target: WebGL2SceneDomainTarget): void;
	/** Establish ordinary drawing constrained by one completed layer label. */
	beginMaskedPass(target: WebGL2SceneDomainTarget, renderLayer: number): void;
	/** Clear all attachments before the root contribution. */
	clearTarget(
		target: WebGL2SceneDomainTarget,
		color: readonly [number, number, number, number],
		depth: number,
		stencil: number,
	): void;
	/** Replace clear color and depth inside one completed stencil label. */
	initializeMaskedScene(
		target: WebGL2SceneDomainTarget,
		renderLayer: number,
		color: readonly [number, number, number, number],
		depth: number,
	): void;
	/** Present completed color to the active view destination. */
	present(
		source: WebGL2SceneDomainTarget,
		destination: WebGLFramebuffer | null,
		destinationExtent: PortalRenderExtent,
	): void;
	/** Replace depth once inside one completed render-layer union. */
	resetMaskedDepth(
		target: WebGL2SceneDomainTarget,
		renderLayer: number,
		depth: number,
	): void;
	/** Allocate or reuse the single synchronous scene-domain target. */
	resize(extent: PortalRenderExtent): WebGL2SceneDomainTarget;
	/** Restore the ordinary destination state after offscreen execution. */
	restoreOrdinaryPass(
		framebuffer: WebGLFramebuffer | null,
		extent: PortalRenderExtent,
	): void;
	/** Add one graph-selected effective aperture to a render-layer union. */
	writeLayerMask(
		target: WebGL2SceneDomainTarget,
		geometry: ResolvedPortalMask["geometry"],
		indexStart: number,
		indexCount: number,
		clipFromLocal: Float32Array,
		stencilPolicy: PortalMaskStencilPolicy,
		depthCompare: "always" | "less-or-equal",
	): void;
	/** Add one exact screen-space straddle footprint to a render-layer union. */
	writeLayerWindowMask(
		target: WebGL2SceneDomainTarget,
		window: PortalViewWindow,
		stencilPolicy: PortalMaskStencilPolicy,
	): void;
}

/** Complete portal execution inputs for one independent frame view. */
export interface PortalExecutionInput {
	/** Background used where no reached indoor domain contributes. */
	readonly clearColor: readonly [number, number, number, number];
	/** Active view destination; `null` names the default framebuffer. */
	readonly destination: WebGLFramebuffer | null;
	/** Active destination extent, which is also the required offscreen extent. */
	readonly extent: PortalRenderExtent;
	/** Authoritative final planner graph; the executor derives no topology or schedule. */
	readonly plan: PortalRenderWorkPlan;
	/** Resolve one graph-selected effective aperture to its existing GPU draw range. */
	readonly resolveVisibilityAperture: (
		apertureId: VisibilityApertureId,
		crossingId: PortalCrossingId,
	) => ResolvedPortalMask;
	/** Render the exterior scene domain once for this independent view. */
	readonly renderExterior: (target: WebGL2SceneDomainTarget) => void;
	/** Invoke the established indoor contribution path for the named unique nodes. */
	readonly renderIndoorNodes: (
		target: WebGL2SceneDomainTarget,
		renderNodeIds: readonly PortalRenderNodeId[],
	) => void;
}

/** Consumed planner and GPU facts retained for portal-frame diagnostics. */
export interface PortalFrameDiagnostics {
	readonly admittedVisibilityStateCount: number;
	readonly exteriorContributionCount: number;
	readonly exteriorRenderCount: number;
	readonly maskDrawCount: number;
	readonly maskEdgeCount: number;
	readonly nearPlaneSeedCount: number;
	readonly rejectedFacingCrossingCount: number;
	readonly sameDomainBoundaryCrossingCount: number;
	readonly renderLayerCount: number;
	readonly renderNodeCount: number;
	readonly selectedScopeCount: number;
	readonly submittedRenderLayerCount: number;
	readonly submittedRenderNodeCount: number;
}

interface PreparedPortalApertureMask {
	readonly crossingId: PortalCrossingId;
	readonly kind: "aperture";
	readonly mask: ResolvedPortalMask;
}

interface PreparedPortalWindowMask {
	readonly crossingId: PortalCrossingId;
	readonly kind: "window";
	readonly window: PortalViewWindow;
}

type PreparedPortalMask = PreparedPortalApertureMask | PreparedPortalWindowMask;

interface PreparedPortalContribution {
	readonly kind: "exterior" | "indoor";
	readonly masks: readonly PreparedPortalMask[];
	readonly renderNodeIds: readonly PortalRenderNodeId[];
	readonly stencilValue: number;
}

interface PreparedPortalLayer {
	readonly contributions: readonly PreparedPortalContribution[];
	readonly renderLayer: number;
}

interface PreparedExteriorSuffix {
	readonly entryStencilValue: number;
	readonly indoorNodeIds: readonly PortalRenderNodeId[];
	readonly masks: readonly PreparedPortalMask[];
	readonly stencilValue: number;
}

interface PreparedPortalExecution {
	readonly exteriorSuffix: PreparedExteriorSuffix | null;
	readonly layers: readonly PreparedPortalLayer[];
	readonly plan: PortalRenderWorkPlan;
}

/**
 * Execute the final portal graph without creating another route or draw schedule.
 *
 * All graph and aperture failures are discovered before target allocation. The planner-authored
 * exterior component is consumed directly; WebGL never reconstructs topology or contribution
 * ownership.
 */
export function executePortalGraph(
	substrate: PortalExecutionSubstrate,
	input: PortalExecutionInput,
): PortalFrameDiagnostics {
	const prepared = preparePortalExecution(input);
	const target = substrate.resize(input.extent);
	let submittedRenderLayerCount = 0;
	let submittedRenderNodeCount = 0;
	let maskDrawCount = 0;
	let exteriorContributionCount = 0;
	let exteriorRenderCount = 0;
	try {
		substrate.clearTarget(target, input.clearColor, 1, 0);
		for (const layer of prepared.layers) {
			if (layer.renderLayer !== 0) {
				for (const contribution of layer.contributions) {
					maskDrawCount += writeMaskUnion(
						substrate,
						target,
						contribution.masks,
						{ kind: "replace", value: contribution.stencilValue },
					);
				}
			}
			for (const contribution of layer.contributions) {
				if (layer.renderLayer === 0) {
					substrate.beginTargetPass(target);
				} else if (contribution.kind === "exterior") {
					substrate.initializeMaskedScene(
						target,
						contribution.stencilValue,
						input.clearColor,
						1,
					);
					substrate.beginMaskedPass(target, contribution.stencilValue);
				} else {
					substrate.resetMaskedDepth(target, contribution.stencilValue, 1);
					substrate.beginMaskedPass(target, contribution.stencilValue);
				}
				if (contribution.kind === "exterior") {
					input.renderExterior(target);
					exteriorContributionCount += 1;
					exteriorRenderCount += 1;
					submittedRenderNodeCount += 1;
					const suffix = prepared.exteriorSuffix;
					if (suffix) {
						maskDrawCount += writeMaskUnion(substrate, target, suffix.masks, {
							expectedValue: suffix.entryStencilValue,
							kind: "increment-if-equal",
						});
						substrate.resetMaskedDepth(target, suffix.stencilValue, 1);
						substrate.beginMaskedPass(target, suffix.stencilValue);
						input.renderIndoorNodes(target, suffix.indoorNodeIds);
						submittedRenderNodeCount += suffix.indoorNodeIds.length;
					}
				} else {
					input.renderIndoorNodes(target, contribution.renderNodeIds);
					submittedRenderNodeCount += contribution.renderNodeIds.length;
				}
			}
			submittedRenderLayerCount += 1;
		}
		substrate.present(target, input.destination, input.extent);
	} finally {
		substrate.restoreOrdinaryPass(input.destination, input.extent);
	}
	return {
		admittedVisibilityStateCount:
			prepared.plan.diagnostics.admittedWindowStateCount,
		exteriorContributionCount,
		exteriorRenderCount,
		maskDrawCount,
		maskEdgeCount: prepared.plan.maskEdges.length,
		nearPlaneSeedCount: prepared.plan.maskEdges.filter(
			(edge) => edge.maskSource.kind === "near-clip-window",
		).length,
		rejectedFacingCrossingCount:
			prepared.plan.diagnostics.rejectedFacingCrossingCount,
		sameDomainBoundaryCrossingCount:
			prepared.plan.diagnostics.sameDomainBoundaryCrossingCount,
		renderLayerCount: prepared.layers.length,
		renderNodeCount: prepared.plan.nodes.length,
		selectedScopeCount: prepared.plan.selectedScopes.length,
		submittedRenderLayerCount,
		submittedRenderNodeCount,
	};
}

function writeMaskUnion(
	substrate: PortalExecutionSubstrate,
	target: WebGL2SceneDomainTarget,
	masks: readonly PreparedPortalMask[],
	stencilPolicy: PortalMaskStencilPolicy,
): number {
	for (const prepared of masks) {
		if (prepared.kind === "window") {
			substrate.writeLayerWindowMask(target, prepared.window, stencilPolicy);
		} else {
			const { mask } = prepared;
			substrate.writeLayerMask(
				target,
				mask.geometry,
				mask.indexStart,
				mask.indexCount,
				mask.clipFromLocal,
				stencilPolicy,
				"less-or-equal",
			);
		}
	}
	return masks.length;
}

function preparePortalExecution(
	input: PortalExecutionInput,
): PreparedPortalExecution {
	const { plan } = input;
	const { edgeById, exterior, nodeById } = validatePortalRenderWorkPlan(plan);
	const maskByEdgeId = new Map<PortalCrossingId, PreparedPortalMask>();
	for (const edge of edgeById.values()) {
		if (edge.maskSource.kind === "near-clip-window") {
			maskByEdgeId.set(edge.crossingId, {
				crossingId: edge.crossingId,
				kind: "window",
				window: edge.maskSource.window,
			});
			continue;
		}
		const mask = input.resolveVisibilityAperture(
			edge.maskSource.visibilityApertureId,
			edge.crossingId,
		);
		validateResolvedPortalMask(mask, edge.crossingId);
		maskByEdgeId.set(edge.crossingId, {
			crossingId: edge.crossingId,
			kind: "aperture",
			mask,
		});
	}
	if (exterior) {
		requirePreparedMasks(maskByEdgeId, [
			...exterior.entryMaskEdgeIds,
			...exterior.internalIndoorMaskEdgeIds,
			...exterior.returnMaskEdgeIds,
		]);
	}
	const componentMembers = new Set(exterior?.componentNodeIds ?? []);
	const layers = plan.renderLayers.map((layer): PreparedPortalLayer => {
		const contributions: PreparedPortalContribution[] = [];
		const indoorNodeIds = layer.renderNodeIds.filter((nodeId) => {
			const node = nodeById.get(nodeId)!;
			return (
				node.kind === "indoor-visibility-island" &&
				(exterior?.rootContained !== false || !componentMembers.has(nodeId))
			);
		});
		if (
			exterior &&
			(exterior.rootContained
				? layer.renderNodeIds.includes(exterior.outdoorNodeId)
				: layer.renderLayer === exterior.renderLayer)
		) {
			const exteriorMaskEdgeIds = exterior.rootContained
				? layer.incomingMaskEdgeIds.filter(
						(crossingId) =>
							edgeById.get(crossingId)!.targetNodeId === exterior.outdoorNodeId,
					)
				: exterior.entryMaskEdgeIds;
			contributions.push({
				kind: "exterior",
				masks: requirePreparedMasks(maskByEdgeId, exteriorMaskEdgeIds),
				renderNodeIds: [exterior.outdoorNodeId],
				stencilValue: exterior.stencilLabels?.entry ?? exterior.renderLayer,
			});
		}
		if (indoorNodeIds.length > 0) {
			const members = new Set(indoorNodeIds);
			contributions.push({
				kind: "indoor",
				masks: requirePreparedMasks(maskByEdgeId, [
					...layer.incomingMaskEdgeIds.filter((crossingId) =>
						members.has(edgeById.get(crossingId)!.targetNodeId),
					),
				]),
				renderNodeIds: indoorNodeIds,
				stencilValue: layer.renderLayer,
			});
		}
		if (contributions.length === 0) {
			throw new Error(
				`Portal layer ${layer.renderLayer} has no executable contribution.`,
			);
		}
		for (const contribution of contributions) {
			if (
				(layer.renderLayer === 0 && contribution.masks.length !== 0) ||
				(layer.renderLayer !== 0 && contribution.masks.length === 0)
			) {
				throw new Error(
					`Portal layer ${layer.renderLayer} contribution has an invalid mask union.`,
				);
			}
		}
		const labels = contributions.map((entry) => entry.stencilValue);
		if (layer.renderLayer !== 0 && new Set(labels).size !== labels.length) {
			throw new Error(
				`Portal layer ${layer.renderLayer} contribution labels are not isolated.`,
			);
		}
		return { contributions, renderLayer: layer.renderLayer };
	});
	return {
		exteriorSuffix:
			exterior && !exterior.rootContained && exterior.indoorNodeIds.length > 0
				? {
						entryStencilValue: exterior.stencilLabels!.entry,
						indoorNodeIds: exterior.indoorNodeIds,
						masks: requirePreparedMasks(
							maskByEdgeId,
							exterior.internalIndoorMaskEdgeIds,
						),
						stencilValue: exterior.stencilLabels!.suffix!,
					}
				: null,
		layers,
		plan,
	};
}

function requirePreparedMasks(
	maskByEdgeId: ReadonlyMap<PortalCrossingId, PreparedPortalMask>,
	crossingIds: readonly PortalCrossingId[],
): readonly PreparedPortalMask[] {
	return crossingIds.map((crossingId) => {
		const prepared = maskByEdgeId.get(crossingId);
		if (!prepared) {
			throw new Error(`Portal mask edge ${crossingId} was not prepared.`);
		}
		return prepared;
	});
}
