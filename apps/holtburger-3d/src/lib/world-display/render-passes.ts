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

export type TransitionPortalGraphDirection =
	| "outdoor-to-indoor"
	| "indoor-to-outdoor";

export type TransitionPortalGraphScene = "exterior" | "interior";

type WorldRenderGraphNodeKind =
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
		parentStencilRef: number | null;
		compositeScene: TransitionPortalGraphScene;
	};
}

export function transitionPortalStencilRefForDepth(
	recursionDepth: number,
): number {
	if (!Number.isInteger(recursionDepth) || recursionDepth < 1) {
		throw new Error(
			`Transition portal stencil depth must be a positive integer, got ${recursionDepth}.`,
		);
	}
	return recursionDepth;
}

export function deriveTransitionPortalGraphNodes(options: {
	direction: TransitionPortalGraphDirection;
	recursionDepth: number;
	stencilRef: number;
	parentStencilRef: number | null;
	compositeScene: TransitionPortalGraphScene;
}): WorldRenderGraphNode[] {
	const transition = {
		direction: options.direction,
		recursionDepth: options.recursionDepth,
		stencilRef: options.stencilRef,
		parentStencilRef: options.parentStencilRef,
		compositeScene: options.compositeScene,
	};
	return [
		{
			kind: "transition-aperture-mask",
			layer: WORLD_RENDER_LAYER.portalMask,
			clearBeforePass: {
				color: false,
				depth: false,
				stencil: false,
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
