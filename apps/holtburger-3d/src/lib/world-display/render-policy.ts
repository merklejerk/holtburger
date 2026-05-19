import {
	TRANSITION_PORTAL_STENCIL_REFS,
	WORLD_RENDER_LAYER,
	deriveTransitionPortalGraphNodes,
	type TransitionPortalGraphDirection,
	type WorldRenderGraphNode,
} from "./render-passes";
import type { CameraViewResidencyContext } from "./world-residency-index";

export type WorldRenderBaseScene = "exterior" | "interior";

export interface WorldRenderPolicyOptions {
	minPortalScreenAreaPx: number;
	enableUnknownResidencyDiagnosticFallback: boolean;
}

export interface WorldRenderPolicy {
	label: "residency-aware";
	baseScene: WorldRenderBaseScene;
	showDiagnosticInterior: boolean;
	initialTransitionDirections: readonly TransitionPortalGraphDirection[];
	portalCandidates: TransitionPortalCandidatePolicy;
}

export interface VisibleTransitionBatches {
	hasOutdoorToIndoorTransitions: boolean;
	hasIndoorToOutdoorTransitions: boolean;
}

export interface TransitionPortalCandidatePolicy {
	minScreenAreaPx: number;
}

export interface WorldRenderGraphSummary {
	policyLabel: WorldRenderPolicy["label"];
	baseScene: WorldRenderBaseScene;
	transitionApertureMaskPassCount: number;
	apertureDepthResetPassCount: number;
	interiorCompositePassCount: number;
	exteriorCompositePassCount: number;
	diagnosticInteriorPassCount: number;
	debugOverlayPassCount: number;
}

export const DEFAULT_WORLD_RENDER_POLICY_OPTIONS: WorldRenderPolicyOptions = {
	minPortalScreenAreaPx: 16,
	enableUnknownResidencyDiagnosticFallback: true,
};

export function deriveWorldRenderPolicy(
	context: CameraViewResidencyContext,
	options: WorldRenderPolicyOptions = DEFAULT_WORLD_RENDER_POLICY_OPTIONS,
): WorldRenderPolicy {
	switch (context.kind) {
		case "env-cell":
			return createWorldRenderPolicy({
				baseScene: "interior",
				showDiagnosticInterior: false,
				initialTransitionDirections: [
					directionForTransitionDepth("interior", 1),
				],
				options,
			});
		case "outdoor-landblock":
			return createWorldRenderPolicy({
				baseScene: "exterior",
				showDiagnosticInterior: false,
				initialTransitionDirections: [
					directionForTransitionDepth("exterior", 1),
				],
				options,
			});
		case "unknown":
			return createWorldRenderPolicy({
				baseScene: "exterior",
				showDiagnosticInterior:
					options.enableUnknownResidencyDiagnosticFallback,
				initialTransitionDirections:
					options.enableUnknownResidencyDiagnosticFallback
						? ["outdoor-to-indoor", "indoor-to-outdoor"]
						: [directionForTransitionDepth("exterior", 1)],
				options,
			});
	}
}

export function directionForTransitionDepth(
	baseScene: WorldRenderBaseScene,
	recursionDepth: number,
): TransitionPortalGraphDirection {
	if (!Number.isInteger(recursionDepth) || recursionDepth < 1) {
		throw new Error(
			`Transition recursion depth must be a positive integer, got ${recursionDepth}.`,
		);
	}
	const oddDepth = recursionDepth % 2 === 1;
	if (baseScene === "exterior") {
		return oddDepth ? "outdoor-to-indoor" : "indoor-to-outdoor";
	}
	return oddDepth ? "indoor-to-outdoor" : "outdoor-to-indoor";
}

export function deriveWorldRenderGraphForPolicy(options: {
	policy: WorldRenderPolicy;
	visibleTransitions: VisibleTransitionBatches;
	showDebugOverlays: boolean;
}): WorldRenderGraphNode[] {
	const nodes: WorldRenderGraphNode[] = [
		{
			kind:
				options.policy.baseScene === "interior"
					? "interior-base"
					: "exterior-base",
			layer:
				options.policy.baseScene === "interior"
					? WORLD_RENDER_LAYER.diagnosticInterior
					: WORLD_RENDER_LAYER.exterior,
			clearBeforePass: {
				color: true,
				depth: true,
				stencil: true,
			},
		},
	];

	if (
		shouldRenderTransitionDirection(
			options.policy,
			options.visibleTransitions,
			"outdoor-to-indoor",
		)
	) {
		nodes.push(
			...deriveTransitionPortalGraphNodes({
				direction: "outdoor-to-indoor",
				recursionDepth: 1,
				stencilRef: TRANSITION_PORTAL_STENCIL_REFS.outdoorToIndoorDepth1,
				compositeScene: "interior",
			}),
		);
	}

	if (options.policy.showDiagnosticInterior) {
		nodes.push({
			kind: "diagnostic-interior",
			layer: WORLD_RENDER_LAYER.diagnosticInterior,
			clearBeforePass: {
				color: false,
				depth: false,
				stencil: false,
			},
		});
	}

	if (
		shouldRenderTransitionDirection(
			options.policy,
			options.visibleTransitions,
			"indoor-to-outdoor",
		)
	) {
		nodes.push(
			...deriveTransitionPortalGraphNodes({
				direction: "indoor-to-outdoor",
				recursionDepth: 1,
				stencilRef: TRANSITION_PORTAL_STENCIL_REFS.indoorToOutdoorDepth1,
				compositeScene: "exterior",
			}),
		);
	}

	if (options.showDebugOverlays) {
		nodes.push({
			kind: "debug-overlay",
			layer: WORLD_RENDER_LAYER.debugOverlay,
			clearBeforePass: {
				color: false,
				depth: false,
				stencil: false,
			},
		});
	}

	return nodes;
}

export function summarizeWorldRenderGraph(options: {
	policy: WorldRenderPolicy;
	graph: readonly WorldRenderGraphNode[];
}): WorldRenderGraphSummary {
	let transitionApertureMaskPassCount = 0;
	let apertureDepthResetPassCount = 0;
	let interiorCompositePassCount = 0;
	let exteriorCompositePassCount = 0;
	let diagnosticInteriorPassCount = 0;
	let debugOverlayPassCount = 0;

	for (const node of options.graph) {
		switch (node.kind) {
			case "transition-aperture-mask":
				transitionApertureMaskPassCount += 1;
				break;
			case "aperture-depth-reset":
				apertureDepthResetPassCount += 1;
				break;
			case "opposite-scene-portal-composite":
				if (node.transition?.compositeScene === "interior") {
					interiorCompositePassCount += 1;
				} else if (node.transition?.compositeScene === "exterior") {
					exteriorCompositePassCount += 1;
				}
				break;
			case "diagnostic-interior":
				diagnosticInteriorPassCount += 1;
				break;
			case "debug-overlay":
				debugOverlayPassCount += 1;
				break;
			case "exterior-base":
			case "interior-base":
				break;
		}
	}

	return {
		policyLabel: options.policy.label,
		baseScene: options.policy.baseScene,
		transitionApertureMaskPassCount,
		apertureDepthResetPassCount,
		interiorCompositePassCount,
		exteriorCompositePassCount,
		diagnosticInteriorPassCount,
		debugOverlayPassCount,
	};
}

function createWorldRenderPolicy(options: {
	baseScene: WorldRenderBaseScene;
	showDiagnosticInterior: boolean;
	initialTransitionDirections: readonly TransitionPortalGraphDirection[];
	options: WorldRenderPolicyOptions;
}): WorldRenderPolicy {
	return {
		label: "residency-aware",
		baseScene: options.baseScene,
		showDiagnosticInterior: options.showDiagnosticInterior,
		initialTransitionDirections: options.initialTransitionDirections,
		portalCandidates: {
			minScreenAreaPx: options.options.minPortalScreenAreaPx,
		},
	};
}

function shouldRenderTransitionDirection(
	policy: WorldRenderPolicy,
	visibleTransitions: VisibleTransitionBatches,
	direction: TransitionPortalGraphDirection,
): boolean {
	if (!policy.initialTransitionDirections.includes(direction)) {
		return false;
	}
	return direction === "outdoor-to-indoor"
		? visibleTransitions.hasOutdoorToIndoorTransitions
		: visibleTransitions.hasIndoorToOutdoorTransitions;
}
