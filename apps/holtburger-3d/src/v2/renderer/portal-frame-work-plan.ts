import type {
	PortalApertureFrameDiagnostics,
	PortalApertureGeometryResourcePlan,
	PortalBaseOverlapEnvCellPlan,
	PortalBaseOverlapPlan,
	PortalBaseOverlapReason,
	PortalProjectionFrameGraphPlan,
	PortalProjectionFrameLayerPlan,
	PortalProjectionFrameMaskEdgePlan,
	PortalProjectionFrameOutdoorCrossingPlan,
	PortalProjectionFrameRenderEntryPlan,
	PortalFrameExteriorCompositePlan,
	PortalFrameNodeResources,
	PortalFrameSceneSource,
	PortalFrameWorkPlan,
	RenderPassPlan,
} from "./types";

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
	return portalProjectionFrameGraphPlansEqual(
		left.layeredGraph,
		right.layeredGraph,
	) && portalBaseOverlapPlansEqual(left.baseOverlap, right.baseOverlap) &&
		portalFrameExteriorCompositePlansEqual(
			left.exteriorComposite ?? null,
			right.exteriorComposite ?? null,
		);
}

function portalBaseOverlapPlansEqual(
	left: PortalBaseOverlapPlan,
	right: PortalBaseOverlapPlan,
): boolean {
	return (
		left.overlapSignature === right.overlapSignature &&
		left.requiresExteriorSeed === right.requiresExteriorSeed &&
		left.diagnostics.envCellCount === right.diagnostics.envCellCount &&
		left.diagnostics.missingResourceEnvCellCount ===
			right.diagnostics.missingResourceEnvCellCount &&
		arraysEqual(
			left.envCells,
			right.envCells,
			portalBaseOverlapEnvCellPlansEqual,
		)
	);
}

function portalBaseOverlapEnvCellPlansEqual(
	left: PortalBaseOverlapEnvCellPlan,
	right: PortalBaseOverlapEnvCellPlan,
): boolean {
	return (
		left.envCellId === right.envCellId &&
		left.landblockId === right.landblockId &&
		portalFrameNodeResourcesEqual(left.resources, right.resources) &&
		arraysEqual(left.reasons, right.reasons, portalBaseOverlapReasonsEqual)
	);
}

function portalBaseOverlapReasonsEqual(
	left: PortalBaseOverlapReason,
	right: PortalBaseOverlapReason,
): boolean {
	return (
		left.kind === right.kind &&
		left.apertureRangeId === right.apertureRangeId
	);
}

function portalFrameExteriorCompositePlansEqual(
	left: PortalFrameExteriorCompositePlan | null,
	right: PortalFrameExteriorCompositePlan | null,
): boolean {
	if (left === null || right === null) {
		return left === right;
	}
	return (
		left.maxDepth === right.maxDepth &&
		arraysEqual(
			left.graphs,
			right.graphs,
			portalProjectionFrameGraphPlansEqual,
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

function portalProjectionFrameGraphPlansEqual(
	left: PortalProjectionFrameGraphPlan,
	right: PortalProjectionFrameGraphPlan,
): boolean {
	return (
		left.baseEntry.debugStackLabel === right.baseEntry.debugStackLabel &&
		portalFrameSceneSourceEquals(left.baseEntry.scene, right.baseEntry.scene) &&
		portalProjectionFrameBaseEntriesEqual(left.baseEntry, right.baseEntry) &&
		arraysEqual(
			left.renderEntries,
			right.renderEntries,
			portalProjectionFrameRenderEntryPlansEqual,
		) &&
		arraysEqual(
			left.renderLayers,
			right.renderLayers,
			portalProjectionFrameLayerPlansEqual,
		) &&
		arraysEqual(
			left.maskEdges,
			right.maskEdges,
			portalProjectionFrameMaskEdgePlansEqual,
		) &&
		arraysEqual(
			left.outdoorCrossings,
			right.outdoorCrossings,
			portalProjectionFrameOutdoorCrossingPlansEqual,
		) &&
		portalApertureGeometryResourcesEqual(
			left.apertureResources,
			right.apertureResources,
		) &&
		portalApertureFrameDiagnosticsEqual(left.diagnostics, right.diagnostics) &&
		left.projectionDiagnostics.componentCount ===
			right.projectionDiagnostics.componentCount &&
		left.projectionDiagnostics.cyclicComponentCount ===
			right.projectionDiagnostics.cyclicComponentCount &&
		left.projectionDiagnostics.componentInternalEdgeCount ===
			right.projectionDiagnostics.componentInternalEdgeCount &&
		left.projectionDiagnostics.maxProjectionRenderLayer ===
			right.projectionDiagnostics.maxProjectionRenderLayer &&
		left.projectionDiagnostics.maxSelectedRenderLayer ===
			right.projectionDiagnostics.maxSelectedRenderLayer &&
		left.projectionDiagnostics.projectedEnvCellCount ===
			right.projectionDiagnostics.projectedEnvCellCount &&
		left.projectionDiagnostics.renderEntryCount ===
			right.projectionDiagnostics.renderEntryCount &&
		left.projectionDiagnostics.renderEntriesSkippedByLayerCap ===
			right.projectionDiagnostics.renderEntriesSkippedByLayerCap &&
		left.projectionDiagnostics.renderEntriesSkippedByMaxRenderEntries ===
			right.projectionDiagnostics.renderEntriesSkippedByMaxRenderEntries &&
		left.projectionDiagnostics.maskEdgesSkippedByLayerCap ===
			right.projectionDiagnostics.maskEdgesSkippedByLayerCap &&
		left.projectionDiagnostics.maskEdgesSkippedByMaxMaskEdges ===
			right.projectionDiagnostics.maskEdgesSkippedByMaxMaskEdges &&
		left.projectionDiagnostics.missingResourceMembershipCount ===
			right.projectionDiagnostics.missingResourceMembershipCount &&
		left.projectionDiagnostics.outdoorCrossingCount ===
			right.projectionDiagnostics.outdoorCrossingCount &&
		left.projectionDiagnostics.outdoorCrossingsSkippedByLayerCap ===
			right.projectionDiagnostics.outdoorCrossingsSkippedByLayerCap &&
		left.projectionDiagnostics.outdoorCrossingsSkippedByUnselectedTarget ===
			right.projectionDiagnostics.outdoorCrossingsSkippedByUnselectedTarget
	);
}

function portalProjectionFrameBaseEntriesEqual(
	left: PortalProjectionFrameGraphPlan["baseEntry"],
	right: PortalProjectionFrameGraphPlan["baseEntry"],
): boolean {
	if ("resources" in left || "resources" in right) {
		return (
			"resources" in left &&
			"resources" in right &&
			portalFrameNodeResourcesEqual(left.resources, right.resources)
		);
	}
	return true;
}

function portalProjectionFrameRenderEntryPlansEqual(
	left: PortalProjectionFrameRenderEntryPlan,
	right: PortalProjectionFrameRenderEntryPlan,
): boolean {
	return (
		left.renderEntryId === right.renderEntryId &&
		left.envCellId === right.envCellId &&
		left.landblockId === right.landblockId &&
		left.renderLayer === right.renderLayer &&
		numberArraysEqual(left.incomingMaskEdgeIds, right.incomingMaskEdgeIds) &&
		left.debugStackLabel === right.debugStackLabel &&
		portalFrameNodeResourcesEqual(left.resources, right.resources)
	);
}

function portalProjectionFrameLayerPlansEqual(
	left: PortalProjectionFrameLayerPlan,
	right: PortalProjectionFrameLayerPlan,
): boolean {
	return (
		left.renderLayer === right.renderLayer &&
		numberArraysEqual(left.renderEntryIds, right.renderEntryIds)
	);
}

function portalProjectionFrameMaskEdgePlansEqual(
	left: PortalProjectionFrameMaskEdgePlan,
	right: PortalProjectionFrameMaskEdgePlan,
): boolean {
	return (
		left.edgeId === right.edgeId &&
		left.renderEntryId === right.renderEntryId &&
		left.renderLayer === right.renderLayer &&
		left.apertureRangeId === right.apertureRangeId &&
		left.apertureSourceId === right.apertureSourceId &&
		left.linkId === right.linkId &&
		left.sourceKind === right.sourceKind &&
		left.sourceEnvCellId === right.sourceEnvCellId &&
		left.targetEnvCellId === right.targetEnvCellId
	);
}

function portalProjectionFrameOutdoorCrossingPlansEqual(
	left: PortalProjectionFrameOutdoorCrossingPlan,
	right: PortalProjectionFrameOutdoorCrossingPlan,
): boolean {
	return (
		left.crossingId === right.crossingId &&
		left.targetEnvCellId === right.targetEnvCellId &&
		left.outdoorLandblockId === right.outdoorLandblockId &&
		left.apertureRangeId === right.apertureRangeId &&
		left.apertureSourceId === right.apertureSourceId &&
		left.linkId === right.linkId
	);
}

function portalFrameNodeResourcesEqual(
	left: PortalFrameNodeResources,
	right: PortalFrameNodeResources,
): boolean {
	return (
		left.resourceState === right.resourceState &&
		stringArraysEqual(
			left.structuredInteriorDrawUnitIds,
			right.structuredInteriorDrawUnitIds,
		) &&
		stringArraysEqual(
			left.envCellStaticObjectDrawUnitIds,
			right.envCellStaticObjectDrawUnitIds,
		)
	);
}

function portalApertureGeometryResourcesEqual(
	left: readonly PortalApertureGeometryResourcePlan[],
	right: readonly PortalApertureGeometryResourcePlan[],
): boolean {
	return arraysEqual(left, right, (leftResource, rightResource) => {
		return (
			leftResource.resourceId === rightResource.resourceId &&
			stringArraysEqual(leftResource.sourceKinds, rightResource.sourceKinds)
		);
	});
}

function portalApertureFrameDiagnosticsEqual(
	left: PortalApertureFrameDiagnostics,
	right: PortalApertureFrameDiagnostics,
): boolean {
	return (
		left.buildingTransitionEdges === right.buildingTransitionEdges &&
		left.dedupedGeometryResources === right.dedupedGeometryResources &&
		left.duplicateMaskEdges === right.duplicateMaskEdges &&
		left.envCellPortalEdges === right.envCellPortalEdges &&
		left.selectedMaskEdges === right.selectedMaskEdges &&
		left.transitionRootCandidateCount === right.transitionRootCandidateCount &&
		left.transitionRootCount === right.transitionRootCount &&
		left.transitionRootsRejectedNotSeenOutside ===
			right.transitionRootsRejectedNotSeenOutside &&
		left.transitionRootsRejectedUnknownSeenOutside ===
			right.transitionRootsRejectedUnknownSeenOutside
	);
}

function portalFrameSceneSourceEquals(
	left: PortalFrameSceneSource,
	right: PortalFrameSceneSource,
): boolean {
	if (left.kind !== right.kind || left.landblockId !== right.landblockId) {
		return false;
	}
	if (left.kind !== "env-cell-direct" || right.kind !== "env-cell-direct") {
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
