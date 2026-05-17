import type { StaticRenderablePart } from "./static-renderables";

export const WORLD_RENDER_LAYER = {
	exterior: 0,
	portalMask: 1,
	portalInterior: 2,
	diagnosticInterior: 3,
	debugOverlay: 4,
} as const;

export type WorldRenderLayer =
	(typeof WORLD_RENDER_LAYER)[keyof typeof WORLD_RENDER_LAYER];

export type WorldRenderPassKind =
	| "exterior-opaque"
	| "portal-stencil-mask"
	| "portal-composited-interior"
	| "diagnostic-interior"
	| "debug-overlay";

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

export function staticRenderableLayerForKind(
	kind: StaticRenderablePart["kind"],
): WorldRenderLayer {
	return kind === "indoor-static"
		? WORLD_RENDER_LAYER.diagnosticInterior
		: WORLD_RENDER_LAYER.exterior;
}
