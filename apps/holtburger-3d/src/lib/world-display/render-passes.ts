import {
	WORLD_RENDER_DOMAIN,
	type StaticRenderableRenderDomain,
} from "./render-domains";

export const WORLD_RENDER_LAYER = {
	exterior: 0,
	portalMask: 1,
	portalDepthReset: 2,
	portalInterior: 3,
	diagnosticInterior: 4,
	debugOverlay: 5,
} as const;

export type WorldRenderLayer =
	(typeof WORLD_RENDER_LAYER)[keyof typeof WORLD_RENDER_LAYER];

export type WorldRenderPassKind =
	| "exterior-opaque"
	| "portal-stencil-mask"
	| "portal-depth-reset"
	| "portal-composited-interior"
	| "diagnostic-interior"
	| "debug-overlay";

export type TransitionPortalGraphDirection =
	| "outdoor-to-indoor"
	| "indoor-to-outdoor";

export type TransitionPortalGraphScene = "exterior" | "interior";

export type WorldRenderGraphNodeKind =
	| "exterior-base"
	| "interior-base"
	| "transition-aperture-mask"
	| "aperture-depth-reset"
	| "opposite-scene-portal-composite"
	| "diagnostic-interior"
	| "debug-overlay";

export interface WorldRenderGraphNode {
	kind: WorldRenderGraphNodeKind;
	layer: WorldRenderLayer;
	clearBeforePass: {
		color: boolean;
		depth: boolean;
		stencil: boolean;
	};
	transition?: {
		direction: TransitionPortalGraphDirection;
		recursionDepth: number;
		stencilRef: number;
		compositeScene: TransitionPortalGraphScene;
	};
}

export interface WorldRenderPass {
	kind: WorldRenderPassKind;
	layer: WorldRenderLayer;
	clearBeforePass: {
		color: boolean;
		depth: boolean;
		stencil: boolean;
	};
}

export function deriveWorldRenderPasses(options: {
	hasPortalViewGroups: boolean;
	showDiagnosticInterior: boolean;
	showDebugOverlays: boolean;
}): WorldRenderPass[] {
	const passes: WorldRenderPass[] = [
		{
			kind: "exterior-opaque",
			layer: WORLD_RENDER_LAYER.exterior,
			clearBeforePass: {
				color: true,
				depth: true,
				stencil: true,
			},
		},
	];
	if (options.hasPortalViewGroups) {
		passes.push(
			{
				kind: "portal-stencil-mask",
				layer: WORLD_RENDER_LAYER.portalMask,
				clearBeforePass: {
					color: false,
					depth: false,
					stencil: true,
				},
			},
			{
				kind: "portal-depth-reset",
				layer: WORLD_RENDER_LAYER.portalDepthReset,
				clearBeforePass: {
					color: false,
					depth: false,
					stencil: false,
				},
			},
			{
				kind: "portal-composited-interior",
				layer: WORLD_RENDER_LAYER.portalInterior,
				clearBeforePass: {
					color: false,
					depth: false,
					stencil: false,
				},
			},
		);
	}
	if (options.showDiagnosticInterior) {
		passes.push({
			kind: "diagnostic-interior",
			layer: WORLD_RENDER_LAYER.diagnosticInterior,
			clearBeforePass: {
				color: false,
				depth: false,
				stencil: false,
			},
		});
	}
	if (options.showDebugOverlays) {
		passes.push({
			kind: "debug-overlay",
			layer: WORLD_RENDER_LAYER.debugOverlay,
			clearBeforePass: {
				color: false,
				depth: false,
				stencil: false,
			},
		});
	}
	return passes;
}

export function deriveFreeCameraWorldRenderGraph(options: {
	hasOutdoorToIndoorTransitions: boolean;
	hasIndoorToOutdoorTransitions: boolean;
	showDiagnosticInterior: boolean;
	showDebugOverlays: boolean;
}): WorldRenderGraphNode[] {
	const nodes: WorldRenderGraphNode[] = [
		{
			kind: "exterior-base",
			layer: WORLD_RENDER_LAYER.exterior,
			clearBeforePass: {
				color: true,
				depth: true,
				stencil: true,
			},
		},
	];

	if (options.hasOutdoorToIndoorTransitions) {
		nodes.push(
			...deriveTransitionPortalGraphNodes({
				direction: "outdoor-to-indoor",
				recursionDepth: 1,
				stencilRef: TRANSITION_PORTAL_STENCIL_REFS.outdoorToIndoorDepth1,
				compositeScene: "interior",
			}),
		);
	}

	if (options.showDiagnosticInterior) {
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

	if (options.hasIndoorToOutdoorTransitions) {
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

export const TRANSITION_PORTAL_STENCIL_REFS = {
	outdoorToIndoorDepth1: 1,
	indoorToOutdoorDepth1: 2,
} as const;

export function deriveTransitionPortalGraphNodes(options: {
	direction: TransitionPortalGraphDirection;
	recursionDepth: number;
	stencilRef: number;
	compositeScene: TransitionPortalGraphScene;
}): WorldRenderGraphNode[] {
	const transition = {
		direction: options.direction,
		recursionDepth: options.recursionDepth,
		stencilRef: options.stencilRef,
		compositeScene: options.compositeScene,
	};
	return [
		{
			kind: "transition-aperture-mask",
			layer: WORLD_RENDER_LAYER.portalMask,
			clearBeforePass: {
				color: false,
				depth: false,
				stencil: true,
			},
			transition,
		},
		{
			kind: "aperture-depth-reset",
			layer: WORLD_RENDER_LAYER.portalDepthReset,
			clearBeforePass: {
				color: false,
				depth: false,
				stencil: false,
			},
			transition,
		},
		{
			kind: "opposite-scene-portal-composite",
			layer:
				options.compositeScene === "interior"
					? WORLD_RENDER_LAYER.portalInterior
					: WORLD_RENDER_LAYER.exterior,
			clearBeforePass: {
				color: false,
				depth: false,
				stencil: false,
			},
			transition,
		},
	];
}

export function staticRenderableLayerForDomain(
	renderDomain: StaticRenderableRenderDomain,
): WorldRenderLayer {
	return renderDomain === WORLD_RENDER_DOMAIN.interiorStatic
		? WORLD_RENDER_LAYER.diagnosticInterior
		: WORLD_RENDER_LAYER.exterior;
}
