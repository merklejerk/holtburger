import type {
	PortalApertureFrameDiagnostics,
	PortalApertureGeometryResourcePlan,
	PortalProjectionFrameBaseEntryPlan,
	PortalProjectionFrameDiagnostics,
	PortalProjectionFrameGraphPlan,
	PortalProjectionFrameMaskEdgePlan,
	PortalProjectionFrameOutdoorCrossingPlan,
	PortalProjectionFrameRenderEntryPlan,
	PortalFrameNodeResources,
	PortalFrameSceneSource,
	PortalFrameWorkPlan,
} from "../renderer/types";
import type { StaticPortalProjectionRecord } from "../static/contracts";
import { PortalApertureFrameResourceBuilder } from "./portal-aperture-frame-resources";
import type { EnvCellResourceMembership } from "./env-cell-resource-membership";

export interface PortalProjectionFramePlanInput {
	readonly landblockId: number;
	readonly envCellResourceMembership: readonly EnvCellResourceMembership[];
	readonly maxRenderEntries: number;
	readonly maxDepth: number;
	readonly maxMaskEdges: number;
	readonly projection: StaticPortalProjectionRecord;
}

interface PortalFrameIndexes {
	readonly membershipByLandblock: ReadonlyMap<
		number,
		ReadonlyMap<number, EnvCellResourceMembership>
	>;
}

export function createPortalProjectionFramePlan(
	input: PortalProjectionFramePlanInput,
): PortalFrameWorkPlan | null {
	if (input.projection.landblockId !== input.landblockId) {
		throw new Error(
			`Portal projection landblock ${formatHex32(input.projection.landblockId)} does not match frame-plan landblock ${formatHex32(input.landblockId)}.`,
		);
	}
	if (input.projection.renderLayers.length === 0) {
		return null;
	}

	const indexes = createPortalFrameIndexes({
		envCellResourceMembership: input.envCellResourceMembership,
	});
	const baseEntry = createPortalProjectionFrameBaseEntry({
		indexes,
		landblockId: input.landblockId,
		projection: input.projection,
	});
	if (baseEntry === null) {
		return null;
	}
	const edgeById = new Map(
		input.projection.edges.map((edge) => [edge.edgeId, edge]),
	);
	const renderLayerByEnvCellId = new Map(
		input.projection.renderLayerByEnvCellId.map((entry) => [
			entry.envCellId,
			entry.renderLayer,
		]),
	);
	const incomingEdgeIdsByEnvCellId = new Map(
		input.projection.incomingEdges.map((entry) => [
			entry.targetEnvCellId,
			entry.edgeIds,
		]),
	);
	const apertureBuilder = new PortalApertureFrameResourceBuilder();
	const renderEntries: PortalProjectionFrameRenderEntryPlan[] = [];
	const renderLayers: {
		renderLayer: number;
		renderEntryIds: number[];
	}[] = [];
	let renderEntriesSkippedByLayerCap = 0;
	let renderEntriesSkippedByMaxRenderEntries = 0;
	let missingResourceMembershipCount = 0;

	for (const layer of input.projection.renderLayers) {
		if (layer.renderLayer > input.maxDepth) {
			renderEntriesSkippedByLayerCap += layer.envCellIds.length;
			continue;
		}
		if (
			input.projection.root.kind === "env-cell-root" &&
			layer.renderLayer === 0
		) {
			continue;
		}
		const renderEntryIds: number[] = [];
		for (const envCellId of layer.envCellIds) {
			if (
				input.projection.root.kind === "env-cell-root" &&
				envCellId === input.projection.root.envCellId
			) {
				continue;
			}
			if (renderEntries.length >= input.maxRenderEntries) {
				renderEntriesSkippedByMaxRenderEntries += 1;
				continue;
			}
			const scene = {
				envCellId,
				kind: "env-cell-direct",
				landblockId: input.landblockId,
			} as const;
			const resources = createNodeResources(scene, indexes);
			if (resources.resourceState !== "ready") {
				missingResourceMembershipCount += 1;
			}
			const renderEntry: PortalProjectionFrameRenderEntryPlan = {
				debugStackLabel: createPortalProjectionRenderEntryLabel({
					envCellId,
					landblockId: input.landblockId,
					renderLayer: layer.renderLayer,
				}),
				envCellId,
				incomingMaskEdgeIds: [],
				landblockId: input.landblockId,
				renderEntryId: renderEntries.length,
				renderLayer: layer.renderLayer,
				resources,
			};
			renderEntries.push(renderEntry);
			renderEntryIds.push(renderEntry.renderEntryId);
		}
		if (renderEntryIds.length > 0) {
			renderLayers.push({
				renderEntryIds,
				renderLayer: layer.renderLayer,
			});
		}
	}

	if (
		renderEntries.length === 0 &&
		input.projection.root.kind === "outdoor-root"
	) {
		return null;
	}

	const maskEdges: PortalProjectionFrameMaskEdgePlan[] = [];
	let maskEdgesSkippedByLayerCap = 0;
	let maskEdgesSkippedByMaxMaskEdges = 0;
	for (const renderEntry of renderEntries) {
		const incomingEdgeIds =
			incomingEdgeIdsByEnvCellId.get(renderEntry.envCellId) ?? [];
		const mutableIncomingMaskEdgeIds: number[] = [];
		for (const projectionEdgeId of incomingEdgeIds) {
			const projectionEdge = edgeById.get(projectionEdgeId);
			if (!projectionEdge) {
				throw new Error(
					`Portal projection incoming edge ${projectionEdgeId} is missing from edge table.`,
				);
			}
			const sourceRenderLayer =
				projectionEdge.sourceEnvCellId === null
					? 0
					: renderLayerByEnvCellId.get(projectionEdge.sourceEnvCellId);
			if (
				sourceRenderLayer !== undefined &&
				sourceRenderLayer > input.maxDepth
			) {
				maskEdgesSkippedByLayerCap += 1;
				continue;
			}
			if (maskEdges.length >= input.maxMaskEdges) {
				maskEdgesSkippedByMaxMaskEdges += 1;
				continue;
			}
			const apertureRangeId = apertureBuilder.addEdgeResource({
				apertureRangeId: projectionEdge.apertureRangeId,
				apertureSourceId: projectionEdge.apertureSourceId,
				duplicateKeyParts: [
					renderEntry.renderEntryId,
					projectionEdge.sourceEnvCellId ?? "outdoor",
					projectionEdge.targetEnvCellId,
				],
				linkId: projectionEdge.linkId,
				sourceKind: projectionEdge.sourceKind,
			});
			if (!apertureRangeId) {
				continue;
			}
			const edgeId = maskEdges.length;
			maskEdges.push({
				apertureRangeId,
				apertureSourceId: projectionEdge.apertureSourceId,
				edgeId,
				linkId: projectionEdge.linkId,
				renderEntryId: renderEntry.renderEntryId,
				renderLayer: renderEntry.renderLayer,
				sourceEnvCellId: projectionEdge.sourceEnvCellId,
				sourceKind: projectionEdge.sourceKind,
				targetEnvCellId: projectionEdge.targetEnvCellId,
			});
			mutableIncomingMaskEdgeIds.push(edgeId);
		}
		replacePortalProjectionRenderEntry(
			renderEntries,
			renderEntry.renderEntryId,
			{
				...renderEntry,
				incomingMaskEdgeIds: mutableIncomingMaskEdgeIds,
			},
		);
	}

	const selectedEnvCellIds = new Set<number>(
		renderEntries.map((entry) => entry.envCellId),
	);
	if (input.projection.root.kind === "env-cell-root") {
		selectedEnvCellIds.add(input.projection.root.envCellId);
	}
	const outdoorCrossingResult = createPortalProjectionOutdoorCrossings({
		apertureBuilder,
		maxDepth: input.maxDepth,
		projection: input.projection,
		renderLayerByEnvCellId,
		selectedEnvCellIds,
	});

	const aperturePlan = apertureBuilder.build({
		transitionRootCandidateCount:
			input.projection.diagnostics.transitionRootCandidateCount,
		transitionRootCount:
			input.projection.diagnostics.acceptedTransitionRootCount,
		transitionRootsRejectedNotSeenOutside: 0,
		transitionRootsRejectedUnknownSeenOutside: 0,
	});
	const graph: PortalProjectionFrameGraphPlan = {
		apertureResources: aperturePlan.resources,
		baseEntry,
		diagnostics: aperturePlan.diagnostics,
		maskEdges,
		outdoorCrossings: outdoorCrossingResult.outdoorCrossings,
		projectionDiagnostics: {
			componentCount: input.projection.diagnostics.componentCount,
			componentInternalEdgeCount:
				input.projection.diagnostics.componentInternalEdgeCount,
			cyclicComponentCount: input.projection.diagnostics.cyclicComponentCount,
			maskEdgesSkippedByLayerCap,
			maskEdgesSkippedByMaxMaskEdges,
			maxProjectionRenderLayer: input.projection.diagnostics.maxRenderLayer,
			maxSelectedRenderLayer: Math.max(
				0,
				...renderLayers.map((layer) => layer.renderLayer),
			),
			missingResourceMembershipCount,
			outdoorCrossingCount:
				outdoorCrossingResult.outdoorCrossings.length,
			outdoorCrossingsSkippedByLayerCap:
				outdoorCrossingResult.outdoorCrossingsSkippedByLayerCap,
			outdoorCrossingsSkippedByUnselectedTarget:
				outdoorCrossingResult.outdoorCrossingsSkippedByUnselectedTarget,
			projectedEnvCellCount: input.projection.nodes.length,
			renderEntriesSkippedByLayerCap,
			renderEntriesSkippedByMaxRenderEntries,
			renderEntryCount: renderEntries.length,
		},
		renderEntries,
		renderLayers,
	};

	return {
		kind: "direct-env-cell",
		layeredGraph: graph,
		mode: "portal-projection",
	};
}

export function combineOutdoorPortalProjectionFramePlans(
	plans: readonly PortalFrameWorkPlan[],
): PortalFrameWorkPlan | null {
	const directPlans = plans.filter(
		(
			plan,
		): plan is Extract<
			PortalFrameWorkPlan,
			{ readonly kind: "direct-env-cell"; readonly mode: "portal-projection" }
		> =>
			plan.kind === "direct-env-cell" &&
			plan.mode === "portal-projection" &&
			plan.layeredGraph.baseEntry.scene.kind === "outdoor-target",
	);
	if (directPlans.length === 0) {
		return null;
	}
	if (directPlans.length === 1) {
		return directPlans[0];
	}

	const firstPlan = directPlans[0];
	if (!firstPlan) {
		return null;
	}

	const renderEntries: PortalProjectionFrameRenderEntryPlan[] = [];
	const maskEdges: PortalProjectionFrameMaskEdgePlan[] = [];
	const apertureResources: PortalApertureGeometryResourcePlan[] = [];
	const renderEntryIdsByLayer = new Map<number, number[]>();
	let renderEntryOffset = 0;
	let maskEdgeOffset = 0;

	for (const plan of directPlans) {
		const graph = plan.layeredGraph;
		for (const entry of graph.renderEntries) {
			renderEntries.push({
				...entry,
				incomingMaskEdgeIds: entry.incomingMaskEdgeIds.map(
					(edgeId) => edgeId + maskEdgeOffset,
				),
				renderEntryId: entry.renderEntryId + renderEntryOffset,
			});
		}
		for (const edge of graph.maskEdges) {
			maskEdges.push({
				...edge,
				edgeId: edge.edgeId + maskEdgeOffset,
				renderEntryId: edge.renderEntryId + renderEntryOffset,
			});
		}
		for (const layer of graph.renderLayers) {
			const renderEntryIds =
				renderEntryIdsByLayer.get(layer.renderLayer) ?? [];
			renderEntryIds.push(
				...layer.renderEntryIds.map(
					(renderEntryId) => renderEntryId + renderEntryOffset,
				),
			);
			renderEntryIdsByLayer.set(layer.renderLayer, renderEntryIds);
		}
		apertureResources.push(...graph.apertureResources);
		renderEntryOffset += graph.renderEntries.length;
		maskEdgeOffset += graph.maskEdges.length;
	}

	const renderLayers = [...renderEntryIdsByLayer]
		.sort(([leftLayer], [rightLayer]) => leftLayer - rightLayer)
		.map(([renderLayer, renderEntryIds]) => ({
			renderEntryIds,
			renderLayer,
		}));
	const graph: PortalProjectionFrameGraphPlan = {
		apertureResources,
		baseEntry: firstPlan.layeredGraph.baseEntry,
		diagnostics: combinePortalApertureFrameDiagnostics(
			directPlans.map((plan) => plan.layeredGraph.diagnostics),
		),
		maskEdges,
		outdoorCrossings: [],
		projectionDiagnostics: combinePortalProjectionFrameDiagnostics(
			directPlans.map((plan) => plan.layeredGraph.projectionDiagnostics),
			renderEntries.length,
			renderLayers,
		),
		renderEntries,
		renderLayers,
	};

	return {
		kind: "direct-env-cell",
		layeredGraph: graph,
		mode: "portal-projection",
	};
}

function createPortalProjectionOutdoorCrossings(options: {
	readonly apertureBuilder: PortalApertureFrameResourceBuilder;
	readonly maxDepth: number;
	readonly projection: StaticPortalProjectionRecord;
	readonly renderLayerByEnvCellId: ReadonlyMap<number, number>;
	readonly selectedEnvCellIds: ReadonlySet<number>;
}): {
	readonly outdoorCrossings: PortalProjectionFrameOutdoorCrossingPlan[];
	readonly outdoorCrossingsSkippedByLayerCap: number;
	readonly outdoorCrossingsSkippedByUnselectedTarget: number;
} {
	if (options.projection.root.kind !== "env-cell-root") {
		return {
			outdoorCrossings: [],
			outdoorCrossingsSkippedByLayerCap: 0,
			outdoorCrossingsSkippedByUnselectedTarget: 0,
		};
	}
	const outdoorCrossings: PortalProjectionFrameOutdoorCrossingPlan[] = [];
	let outdoorCrossingsSkippedByLayerCap = 0;
	let outdoorCrossingsSkippedByUnselectedTarget = 0;
	for (const crossing of options.projection.outdoorSceneCrossings) {
		const targetLayer =
			crossing.targetEnvCellId === options.projection.root.envCellId
				? 0
				: options.renderLayerByEnvCellId.get(crossing.targetEnvCellId);
		if (targetLayer === undefined) {
			outdoorCrossingsSkippedByUnselectedTarget += 1;
			continue;
		}
		if (targetLayer > options.maxDepth) {
			outdoorCrossingsSkippedByLayerCap += 1;
			continue;
		}
		if (!options.selectedEnvCellIds.has(crossing.targetEnvCellId)) {
			outdoorCrossingsSkippedByUnselectedTarget += 1;
			continue;
		}
		const apertureRangeId = options.apertureBuilder.addEdgeResource({
			apertureRangeId: crossing.apertureRangeId,
			apertureSourceId: crossing.apertureSourceId,
			duplicateKeyParts: ["outdoor-crossing", crossing.crossingId],
			linkId: crossing.linkId,
			sourceKind: "building-transition",
		});
		if (!apertureRangeId) {
			continue;
		}
		outdoorCrossings.push({
			apertureRangeId,
			apertureSourceId: crossing.apertureSourceId,
			crossingId: outdoorCrossings.length,
			linkId: crossing.linkId,
			outdoorLandblockId: crossing.outdoorLandblockId,
			targetEnvCellId: crossing.targetEnvCellId,
		});
	}
	return {
		outdoorCrossings,
		outdoorCrossingsSkippedByLayerCap,
		outdoorCrossingsSkippedByUnselectedTarget,
	};
}

function combinePortalApertureFrameDiagnostics(
	diagnostics: readonly PortalApertureFrameDiagnostics[],
): PortalApertureFrameDiagnostics {
	return diagnostics.reduce(
		(total, current) => ({
			buildingTransitionEdges:
				total.buildingTransitionEdges + current.buildingTransitionEdges,
			dedupedGeometryResources:
				total.dedupedGeometryResources + current.dedupedGeometryResources,
			duplicateMaskEdges:
				total.duplicateMaskEdges + current.duplicateMaskEdges,
			envCellPortalEdges:
				total.envCellPortalEdges + current.envCellPortalEdges,
			selectedMaskEdges:
				total.selectedMaskEdges + current.selectedMaskEdges,
			transitionRootCandidateCount:
				total.transitionRootCandidateCount +
				current.transitionRootCandidateCount,
			transitionRootCount:
				total.transitionRootCount + current.transitionRootCount,
			transitionRootsRejectedNotSeenOutside:
				total.transitionRootsRejectedNotSeenOutside +
				current.transitionRootsRejectedNotSeenOutside,
			transitionRootsRejectedUnknownSeenOutside:
				total.transitionRootsRejectedUnknownSeenOutside +
				current.transitionRootsRejectedUnknownSeenOutside,
		}),
		{
			buildingTransitionEdges: 0,
			dedupedGeometryResources: 0,
			duplicateMaskEdges: 0,
			envCellPortalEdges: 0,
			selectedMaskEdges: 0,
			transitionRootCandidateCount: 0,
			transitionRootCount: 0,
			transitionRootsRejectedNotSeenOutside: 0,
			transitionRootsRejectedUnknownSeenOutside: 0,
		},
	);
}

function combinePortalProjectionFrameDiagnostics(
	diagnostics: readonly PortalProjectionFrameDiagnostics[],
	renderEntryCount: number,
	renderLayers: readonly { readonly renderLayer: number }[],
): PortalProjectionFrameDiagnostics {
	const maxSelectedRenderLayer = Math.max(
		0,
		...renderLayers.map((layer) => layer.renderLayer),
	);
	return diagnostics.reduce(
		(total, current) => ({
			componentCount: total.componentCount + current.componentCount,
			componentInternalEdgeCount:
				total.componentInternalEdgeCount +
				current.componentInternalEdgeCount,
			cyclicComponentCount:
				total.cyclicComponentCount + current.cyclicComponentCount,
			maskEdgesSkippedByLayerCap:
				total.maskEdgesSkippedByLayerCap +
				current.maskEdgesSkippedByLayerCap,
			maskEdgesSkippedByMaxMaskEdges:
				total.maskEdgesSkippedByMaxMaskEdges +
				current.maskEdgesSkippedByMaxMaskEdges,
			maxProjectionRenderLayer: Math.max(
				total.maxProjectionRenderLayer,
				current.maxProjectionRenderLayer,
			),
			maxSelectedRenderLayer,
			missingResourceMembershipCount:
				total.missingResourceMembershipCount +
				current.missingResourceMembershipCount,
			outdoorCrossingCount:
				total.outdoorCrossingCount + current.outdoorCrossingCount,
			outdoorCrossingsSkippedByLayerCap:
				total.outdoorCrossingsSkippedByLayerCap +
				current.outdoorCrossingsSkippedByLayerCap,
			outdoorCrossingsSkippedByUnselectedTarget:
				total.outdoorCrossingsSkippedByUnselectedTarget +
				current.outdoorCrossingsSkippedByUnselectedTarget,
			projectedEnvCellCount:
				total.projectedEnvCellCount + current.projectedEnvCellCount,
			renderEntriesSkippedByLayerCap:
				total.renderEntriesSkippedByLayerCap +
				current.renderEntriesSkippedByLayerCap,
			renderEntriesSkippedByMaxRenderEntries:
				total.renderEntriesSkippedByMaxRenderEntries +
				current.renderEntriesSkippedByMaxRenderEntries,
			renderEntryCount,
		}),
		{
			componentCount: 0,
			componentInternalEdgeCount: 0,
			cyclicComponentCount: 0,
			maskEdgesSkippedByLayerCap: 0,
			maskEdgesSkippedByMaxMaskEdges: 0,
			maxProjectionRenderLayer: 0,
			maxSelectedRenderLayer,
			missingResourceMembershipCount: 0,
			outdoorCrossingCount: 0,
			outdoorCrossingsSkippedByLayerCap: 0,
			outdoorCrossingsSkippedByUnselectedTarget: 0,
			projectedEnvCellCount: 0,
			renderEntriesSkippedByLayerCap: 0,
			renderEntriesSkippedByMaxRenderEntries: 0,
			renderEntryCount,
		},
	);
}

function createPortalProjectionFrameBaseEntry(options: {
	readonly indexes: PortalFrameIndexes;
	readonly landblockId: number;
	readonly projection: StaticPortalProjectionRecord;
}): PortalProjectionFrameBaseEntryPlan | null {
	switch (options.projection.root.kind) {
		case "outdoor-root":
			return {
				debugStackLabel: createOutdoorRootPortalStackLabel(options.landblockId),
				scene: {
					kind: "outdoor-target",
					landblockId: options.landblockId,
				},
			};
		case "env-cell-root": {
			const scene = {
				envCellId: options.projection.root.envCellId,
				kind: "env-cell-direct",
				landblockId: options.landblockId,
			} as const;
			return {
				debugStackLabel: createPortalProjectionRenderEntryLabel({
					envCellId: scene.envCellId,
					landblockId: scene.landblockId,
					renderLayer: 0,
				}),
				resources: createNodeResources(scene, options.indexes),
				scene,
			};
		}
	}
}

function createPortalFrameIndexes(input: {
	readonly envCellResourceMembership: readonly EnvCellResourceMembership[];
}): PortalFrameIndexes {
	const membershipByLandblock = new Map<
		number,
		Map<number, EnvCellResourceMembership>
	>();
	for (const membership of input.envCellResourceMembership) {
		getOrCreateNestedMap(membershipByLandblock, membership.landblockId).set(
			membership.envCellId,
			membership,
		);
	}

	return {
		membershipByLandblock,
	};
}

function getOrCreateNestedMap<TKey, TNestedKey, TValue>(
	map: Map<TKey, Map<TNestedKey, TValue>>,
	key: TKey,
): Map<TNestedKey, TValue> {
	let nested = map.get(key);
	if (!nested) {
		nested = new Map<TNestedKey, TValue>();
		map.set(key, nested);
	}
	return nested;
}

function createNodeResources(
	scene: PortalFrameSceneSource,
	indexes: PortalFrameIndexes,
): PortalFrameNodeResources {
	if (scene.kind === "outdoor-target") {
		return {
			envCellStaticObjectDrawUnitIds: [],
			resourceState: "not-applicable",
			structuredInteriorDrawUnitIds: [],
		};
	}
	const membership =
		indexes.membershipByLandblock
			.get(scene.landblockId)
			?.get(scene.envCellId) ?? null;
	const structuredInteriorDrawUnitIds =
		membership?.structuredInteriorDrawUnitIds ?? [];
	const envCellStaticObjectDrawUnitIds =
		membership?.envCellStaticObjectDrawUnitIds ?? [];
	const hasDrawResources =
		structuredInteriorDrawUnitIds.length > 0 ||
		envCellStaticObjectDrawUnitIds.length > 0;
	return {
		envCellStaticObjectDrawUnitIds,
		resourceState: hasDrawResources ? "ready" : "missing-resources",
		structuredInteriorDrawUnitIds,
	};
}

function formatHex32(value: number): string {
	return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}

function createOutdoorRootPortalStackLabel(landblockId: number): string {
	return `outdoor-root:${formatHex32(landblockId)}`;
}

function createPortalProjectionRenderEntryLabel(options: {
	readonly envCellId: number;
	readonly landblockId: number;
	readonly renderLayer: number;
}): string {
	return `${createOutdoorRootPortalStackLabel(options.landblockId)}/layer:${options.renderLayer}/cell:${formatHex32(options.envCellId)}`;
}

function replacePortalProjectionRenderEntry(
	entries: PortalProjectionFrameRenderEntryPlan[],
	renderEntryId: number,
	entry: PortalProjectionFrameRenderEntryPlan,
): void {
	if (entries[renderEntryId]?.renderEntryId !== renderEntryId) {
		throw new Error(
			`Portal projection render entry ${renderEntryId} is missing or out of order.`,
		);
	}
	entries[renderEntryId] = entry;
}
