import type { CameraViewResidencyContext } from "./world-residency-index";
import {
	TRANSITION_PORTAL_STENCIL_REFS,
	WORLD_RENDER_LAYER,
	deriveTransitionPortalGraphNodes,
	type TransitionPortalGraphDirection,
	type WorldRenderGraphNode,
} from "./render-passes";

export type WorldRenderPolicyMode = "browser-free-camera" | "residency-focused";

export type WorldRenderBaseScene = "exterior" | "interior";

export interface WorldRenderModePolicy {
	mode: WorldRenderPolicyMode;
	baseScene: WorldRenderBaseScene;
	showDiagnosticInterior: boolean;
	allowedTransitionDirections: readonly TransitionPortalGraphDirection[];
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
	policyMode: WorldRenderPolicyMode;
	baseScene: WorldRenderBaseScene;
	transitionApertureMaskPassCount: number;
	apertureDepthResetPassCount: number;
	interiorCompositePassCount: number;
	exteriorCompositePassCount: number;
	diagnosticInteriorPassCount: number;
	debugOverlayPassCount: number;
}

export function deriveBrowserFreeCameraRenderPolicy(): WorldRenderModePolicy {
	return {
		mode: "browser-free-camera",
		baseScene: "exterior",
		showDiagnosticInterior: true,
		allowedTransitionDirections: ["outdoor-to-indoor", "indoor-to-outdoor"],
		portalCandidates: {
			minScreenAreaPx: 16,
		},
	};
}

export function deriveResidencyFocusedRenderPolicy(
	context: CameraViewResidencyContext,
): WorldRenderModePolicy {
	switch (context.kind) {
		case "env-cell":
			return {
				mode: "residency-focused",
				baseScene: "interior",
				showDiagnosticInterior: false,
				allowedTransitionDirections: ["indoor-to-outdoor"],
				portalCandidates: {
					minScreenAreaPx: 16,
				},
			};
		case "outdoor-landblock":
			return {
				mode: "residency-focused",
				baseScene: "exterior",
				showDiagnosticInterior: false,
				allowedTransitionDirections: ["outdoor-to-indoor"],
				portalCandidates: {
					minScreenAreaPx: 16,
				},
			};
		case "unknown":
			return {
				mode: "residency-focused",
				baseScene: "exterior",
				showDiagnosticInterior: true,
				allowedTransitionDirections: ["outdoor-to-indoor", "indoor-to-outdoor"],
				portalCandidates: {
					minScreenAreaPx: 16,
				},
			};
	}
}

export function deriveWorldRenderGraphForPolicy(options: {
	policy: WorldRenderModePolicy;
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
	policy: WorldRenderModePolicy;
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
		policyMode: options.policy.mode,
		baseScene: options.policy.baseScene,
		transitionApertureMaskPassCount,
		apertureDepthResetPassCount,
		interiorCompositePassCount,
		exteriorCompositePassCount,
		diagnosticInteriorPassCount,
		debugOverlayPassCount,
	};
}

function shouldRenderTransitionDirection(
	policy: WorldRenderModePolicy,
	visibleTransitions: VisibleTransitionBatches,
	direction: TransitionPortalGraphDirection,
): boolean {
	if (!policy.allowedTransitionDirections.includes(direction)) {
		return false;
	}
	return direction === "outdoor-to-indoor"
		? visibleTransitions.hasOutdoorToIndoorTransitions
		: visibleTransitions.hasIndoorToOutdoorTransitions;
}
