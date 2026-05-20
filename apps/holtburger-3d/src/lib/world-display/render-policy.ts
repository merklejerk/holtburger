import {
	WORLD_RENDER_LAYER,
	deriveTransitionPortalGraphNodes,
	transitionPortalStencilRefForDepth,
	type TransitionPortalGraphDirection,
	type TransitionPortalGraphScene,
	type WorldRenderGraphNode,
} from "./render-passes";
import type { WorldRenderSceneContext } from "./render-scene-context";
import type { CameraViewResidencyContext } from "./world-residency-index";

export type WorldRenderBaseScene = "exterior" | "interior";

export interface WorldRenderPolicyOptions {
	minPortalScreenAreaRatio: number;
	enableUnknownResidencyDiagnosticFallback: boolean;
	transitionPortalMaxDepth: number;
	sceneContext: WorldRenderSceneContext;
}

export interface WorldRenderPolicy {
	label: "residency-aware";
	baseScene: WorldRenderBaseScene;
	showDiagnosticInterior: boolean;
	transitionLevels: readonly TransitionPortalRenderLevel[];
	portalCandidates: TransitionPortalCandidatePolicy;
}

export interface TransitionPortalRenderLevel {
	direction: TransitionPortalGraphDirection;
	recursionDepth: number;
	stencilRef: number;
	parentStencilRef: number | null;
	compositeScene: TransitionPortalGraphScene;
}

export interface VisibleTransitionLevels {
	hasVisibleTransitionLevel(level: TransitionPortalRenderLevel): boolean;
}

export interface TransitionPortalCandidatePolicy {
	minScreenAreaRatio: number;
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

export const MIN_TRANSITION_PORTAL_MAX_DEPTH = 0;
export const DEFAULT_TRANSITION_PORTAL_MAX_DEPTH = 4;
export const MAX_TRANSITION_PORTAL_MAX_DEPTH = 8;
export const DEFAULT_MIN_PORTAL_SCREEN_AREA_RATIO = 0.0002;

export const DEFAULT_WORLD_RENDER_POLICY_OPTIONS: WorldRenderPolicyOptions = {
	minPortalScreenAreaRatio: DEFAULT_MIN_PORTAL_SCREEN_AREA_RATIO,
	enableUnknownResidencyDiagnosticFallback: true,
	transitionPortalMaxDepth: DEFAULT_TRANSITION_PORTAL_MAX_DEPTH,
	sceneContext: { kind: "outdoor", anchorLandblockId: null },
};

export function deriveWorldRenderPolicy(
	context: CameraViewResidencyContext,
	options: Partial<WorldRenderPolicyOptions> = {},
): WorldRenderPolicy {
	const resolvedOptions: WorldRenderPolicyOptions = {
		...DEFAULT_WORLD_RENDER_POLICY_OPTIONS,
		...options,
		transitionPortalMaxDepth: clampTransitionPortalMaxDepth(
			options.transitionPortalMaxDepth ??
				DEFAULT_WORLD_RENDER_POLICY_OPTIONS.transitionPortalMaxDepth,
		),
	};
	if (resolvedOptions.sceneContext.kind === "dungeon") {
		return createWorldRenderPolicy({
			baseScene: "interior",
			showDiagnosticInterior: false,
			options: {
				...resolvedOptions,
				transitionPortalMaxDepth: 0,
			},
		});
	}
	switch (context.kind) {
		case "env-cell":
			return createWorldRenderPolicy({
				baseScene: "interior",
				showDiagnosticInterior: false,
				options: resolvedOptions,
			});
		case "outdoor-landblock":
			return createWorldRenderPolicy({
				baseScene: "exterior",
				showDiagnosticInterior: false,
				options: resolvedOptions,
			});
		case "unknown":
			return createWorldRenderPolicy({
				baseScene: "exterior",
				showDiagnosticInterior:
					resolvedOptions.enableUnknownResidencyDiagnosticFallback,
				options: resolvedOptions,
			});
	}
}

export function clampTransitionPortalMaxDepth(maxDepth: number): number {
	if (!Number.isFinite(maxDepth)) {
		return DEFAULT_TRANSITION_PORTAL_MAX_DEPTH;
	}
	return Math.max(
		MIN_TRANSITION_PORTAL_MAX_DEPTH,
		Math.min(MAX_TRANSITION_PORTAL_MAX_DEPTH, Math.trunc(maxDepth)),
	);
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

export function compositeSceneForTransitionDirection(
	direction: TransitionPortalGraphDirection,
): TransitionPortalGraphScene {
	return direction === "outdoor-to-indoor" ? "interior" : "exterior";
}

export function deriveTransitionPortalRenderLevels(options: {
	baseScene: WorldRenderBaseScene;
	maxDepth: number;
}): TransitionPortalRenderLevel[] {
	const maxDepth = clampTransitionPortalMaxDepth(options.maxDepth);
	const levels: TransitionPortalRenderLevel[] = [];
	for (
		let recursionDepth = 1;
		recursionDepth <= maxDepth;
		recursionDepth += 1
	) {
		const direction = directionForTransitionDepth(
			options.baseScene,
			recursionDepth,
		);
		levels.push({
			direction,
			recursionDepth,
			stencilRef: transitionPortalStencilRefForDepth(recursionDepth),
			parentStencilRef:
				recursionDepth === 1
					? null
					: transitionPortalStencilRefForDepth(recursionDepth - 1),
			compositeScene: compositeSceneForTransitionDirection(direction),
		});
	}
	return levels;
}

export function deriveWorldRenderGraphForPolicy(options: {
	policy: WorldRenderPolicy;
	visibleTransitions: VisibleTransitionLevels;
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

	for (const level of options.policy.transitionLevels) {
		if (!options.visibleTransitions.hasVisibleTransitionLevel(level)) {
			break;
		}
		nodes.push(
			...deriveTransitionPortalGraphNodes({
				direction: level.direction,
				recursionDepth: level.recursionDepth,
				stencilRef: level.stencilRef,
				parentStencilRef: level.parentStencilRef,
				compositeScene: level.compositeScene,
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
	options: WorldRenderPolicyOptions;
}): WorldRenderPolicy {
	return {
		label: "residency-aware",
		baseScene: options.baseScene,
		showDiagnosticInterior: options.showDiagnosticInterior,
		transitionLevels: deriveTransitionPortalRenderLevels({
			baseScene: options.baseScene,
			maxDepth: options.options.transitionPortalMaxDepth,
		}),
		portalCandidates: {
			minScreenAreaRatio: options.options.minPortalScreenAreaRatio,
		},
	};
}
