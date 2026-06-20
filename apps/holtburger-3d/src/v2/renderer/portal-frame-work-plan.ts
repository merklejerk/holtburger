import type { PortalFrameWorkPlan, RenderPassPlan } from "./types";

export function createLegacyPortalFrameWorkPlan(options: {
	readonly flatVisionModeEnabled: boolean;
	readonly renderPassPlan: RenderPassPlan;
}): PortalFrameWorkPlan {
	if (options.flatVisionModeEnabled) {
		return {
			kind: "legacy-render-pass",
			mode: "flat-resident-diagnostic",
			renderPassPlan: options.renderPassPlan,
		};
	}
	if (options.renderPassPlan.kind === "portal-scene-domains") {
		return {
			kind: "legacy-render-pass",
			mode: "legacy-scene-domain-composite",
			renderPassPlan: options.renderPassPlan,
		};
	}
	return {
		kind: "legacy-render-pass",
		mode: "single-surface-resident",
		renderPassPlan: options.renderPassPlan,
	};
}

export function portalFrameWorkPlanEquals(
	left: PortalFrameWorkPlan,
	right: PortalFrameWorkPlan,
): boolean {
	if (left.kind !== right.kind || left.mode !== right.mode) {
		return false;
	}
	if (left.kind === "legacy-render-pass") {
		return (
			right.kind === "legacy-render-pass" &&
			renderPassPlanEquals(left.renderPassPlan, right.renderPassPlan)
		);
	}
	if (right.kind === "legacy-render-pass") {
		return false;
	}

	return (
		portalFrameBaseScenePlanEquals(left.baseScene, right.baseScene) &&
		portalDirectEnvCellDrawRequestsEqual(
			left.directEnvCellDraws,
			right.directEnvCellDraws,
		) &&
		portalApertureGeometryResourcesEqual(
			left.portalApertureGeometryResources,
			right.portalApertureGeometryResources,
		) &&
		portalApertureMaskPassesEqual(
			left.portalApertureMaskPasses,
			right.portalApertureMaskPasses,
		) &&
		portalTransitionSceneCrossingsEqual(
			left.transitionSceneCrossings,
			right.transitionSceneCrossings,
		)
	);
}

function renderPassPlanEquals(
	left: RenderPassPlan,
	right: RenderPassPlan,
): boolean {
	if (left.kind !== right.kind) {
		return false;
	}
	if (left.kind === "single-surface-resident") {
		return true;
	}
	if (right.kind === "single-surface-resident") {
		return false;
	}
	if (
		left.transitionDepthPolicy.maxDepth !== right.transitionDepthPolicy.maxDepth
	) {
		return false;
	}

	return portalSceneDomainEquals(left.baseScene, right.baseScene);
}

function portalSceneDomainEquals(
	left: Extract<
		RenderPassPlan,
		{ readonly kind: "portal-scene-domains" }
	>["baseScene"],
	right: Extract<
		RenderPassPlan,
		{ readonly kind: "portal-scene-domains" }
	>["baseScene"],
): boolean {
	if (left.kind !== right.kind || left.landblockId !== right.landblockId) {
		return false;
	}
	if (left.kind !== "interior" || right.kind !== "interior") {
		return true;
	}
	return left.envCellId === right.envCellId;
}

function portalFrameBaseScenePlanEquals(
	left: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["baseScene"],
	right: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["baseScene"],
): boolean {
	if (left.kind !== right.kind || left.landblockId !== right.landblockId) {
		return false;
	}
	if (left.kind !== "env-cell-direct" || right.kind !== "env-cell-direct") {
		return true;
	}
	return left.envCellId === right.envCellId;
}

function portalDirectEnvCellDrawRequestsEqual(
	left: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["directEnvCellDraws"],
	right: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["directEnvCellDraws"],
): boolean {
	return arraysEqual(left, right, (leftDraw, rightDraw) => {
		return (
			leftDraw.landblockId === rightDraw.landblockId &&
			leftDraw.envCellId === rightDraw.envCellId &&
			leftDraw.traversalDepth === rightDraw.traversalDepth &&
			leftDraw.portalStackId === rightDraw.portalStackId &&
			leftDraw.resourceState === rightDraw.resourceState &&
			stringArraysEqual(
				leftDraw.structuredInteriorDrawUnitIds,
				rightDraw.structuredInteriorDrawUnitIds,
			) &&
			stringArraysEqual(
				leftDraw.envCellStaticObjectDrawUnitIds,
				rightDraw.envCellStaticObjectDrawUnitIds,
			)
		);
	});
}

function portalTransitionSceneCrossingsEqual(
	left: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["transitionSceneCrossings"],
	right: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["transitionSceneCrossings"],
): boolean {
	return arraysEqual(left, right, (leftCrossing, rightCrossing) => {
		return (
			leftCrossing.apertureBatchId === rightCrossing.apertureBatchId &&
			leftCrossing.aperturePortalId === rightCrossing.aperturePortalId &&
			leftCrossing.landblockId === rightCrossing.landblockId &&
			portalTransitionSceneEndpointEquals(
				leftCrossing.from,
				rightCrossing.from,
			) &&
			portalTransitionSceneEndpointEquals(leftCrossing.to, rightCrossing.to) &&
			numberArraysEqual(
				leftCrossing.linkedEnvCellIds,
				rightCrossing.linkedEnvCellIds,
			)
		);
	});
}

function portalApertureGeometryResourcesEqual(
	left: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["portalApertureGeometryResources"],
	right: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["portalApertureGeometryResources"],
): boolean {
	return arraysEqual(left, right, (leftResource, rightResource) => {
		return (
			leftResource.resourceId === rightResource.resourceId &&
			arraysEqual(
				leftResource.vertices,
				rightResource.vertices,
				(leftVertex, rightVertex) => numberArraysEqual(leftVertex, rightVertex),
			)
		);
	});
}

function portalApertureMaskPassesEqual(
	left: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["portalApertureMaskPasses"],
	right: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["portalApertureMaskPasses"],
): boolean {
	return arraysEqual(left, right, (leftPass, rightPass) => {
		return (
			leftPass.apertureResourceId === rightPass.apertureResourceId &&
			leftPass.linkId === rightPass.linkId &&
			leftPass.parentStencilRef === rightPass.parentStencilRef &&
			leftPass.portalStackId === rightPass.portalStackId &&
			leftPass.sourcePortalStackId === rightPass.sourcePortalStackId &&
			leftPass.stencilRef === rightPass.stencilRef &&
			leftPass.traversalDepth === rightPass.traversalDepth &&
			portalFrameSceneSourceEquals(leftPass.source, rightPass.source) &&
			portalFrameSceneSourceEquals(leftPass.target, rightPass.target)
		);
	});
}

function portalFrameSceneSourceEquals(
	left: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["portalApertureMaskPasses"][number]["source"],
	right: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["portalApertureMaskPasses"][number]["source"],
): boolean {
	if (left.kind !== right.kind || left.landblockId !== right.landblockId) {
		return false;
	}
	if (left.kind !== "env-cell-direct" || right.kind !== "env-cell-direct") {
		return true;
	}
	return left.envCellId === right.envCellId;
}

function portalTransitionSceneEndpointEquals(
	left: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["transitionSceneCrossings"][number]["from"],
	right: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["transitionSceneCrossings"][number]["from"],
): boolean {
	if (left.kind !== right.kind || left.landblockId !== right.landblockId) {
		return false;
	}
	if (left.kind !== "env-cell" || right.kind !== "env-cell") {
		return true;
	}
	return left.envCellId === right.envCellId;
}

function arraysEqual<T>(
	left: readonly T[],
	right: readonly T[],
	itemEquals: (left: T, right: T) => boolean,
): boolean {
	return (
		left.length === right.length &&
		left.every((leftItem, index) => itemEquals(leftItem, right[index] as T))
	);
}

function stringArraysEqual(
	left: readonly string[],
	right: readonly string[],
): boolean {
	return arraysEqual(
		left,
		right,
		(leftItem, rightItem) => leftItem === rightItem,
	);
}

function numberArraysEqual(
	left: readonly number[],
	right: readonly number[],
): boolean {
	return arraysEqual(
		left,
		right,
		(leftItem, rightItem) => leftItem === rightItem,
	);
}
