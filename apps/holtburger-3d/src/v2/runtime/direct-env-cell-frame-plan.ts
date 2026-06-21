import type {
	PortalFrameEdgePlan,
	PortalFrameGraphPlan,
	OutdoorProjectionPortalFrameGraphPlan,
	OutdoorProjectionPortalFrameMaskEdgePlan,
	OutdoorProjectionPortalFrameRenderEntryPlan,
	PortalFrameNodeId,
	PortalFrameNodePlan,
	PortalFrameNodeResources,
	PortalFrameSceneSource,
	PortalFrameWorkPlan,
} from "../renderer/types";
import type {
	StaticOutdoorPortalProjectionRecord,
	StaticPortalInteriorRecord,
} from "../static/contracts";
import {
	AC_UNIT_SCALE,
	buildAcPlacementMatrix,
} from "../static/bake/ac-placement-transform";
import type {
	PortalTraversalPlan,
	StaticSceneCameraResidency,
} from "./static-scene-query";
import { PortalApertureFrameResourceBuilder } from "./portal-aperture-frame-resources";
import {
	createEnvCellPortalApertureRangeId,
	createEnvCellPortalApertureSourceId,
} from "../static/portal-aperture-resources";
import type { EnvCellResourceMembership } from "./env-cell-resource-membership";

type PortalAperture =
	StaticPortalInteriorRecord["envCells"][number]["portalApertures"][number];

type DirectEnvCellTraversalPortalFrameWorkPlan = Extract<
	PortalFrameWorkPlan,
	{ readonly kind: "direct-env-cell" }
> & {
	readonly graph: PortalFrameGraphPlan;
	readonly mode: "portal-traversal";
};

export interface DirectEnvCellFramePlanInput {
	readonly currentCameraResidency: StaticSceneCameraResidency;
	readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly renderAnchorLandblockId: number | null;
	readonly envCellResourceMembership: readonly EnvCellResourceMembership[];
	readonly traversalPlan: PortalTraversalPlan;
}

export interface OutdoorProjectionPortalFramePlanInput {
	readonly landblockId: number;
	readonly envCellResourceMembership: readonly EnvCellResourceMembership[];
	readonly maxCells: number;
	readonly maxDepth: number;
	readonly maxPortalViews: number;
	readonly projection: StaticOutdoorPortalProjectionRecord;
}

interface PortalFrameIndexes {
	readonly membershipByLandblock: ReadonlyMap<
		number,
		ReadonlyMap<number, EnvCellResourceMembership>
	>;
	readonly portalEnvCellsByLandblock: ReadonlyMap<
		number,
		ReadonlyMap<number, PortalFrameEnvCellLookup>
	>;
}

interface PortalFrameEnvCellLookup {
	readonly envCell: StaticPortalInteriorRecord["envCells"][number];
	readonly aperturesByPortalId: ReadonlyMap<string, PortalAperture>;
	readonly placementMatrix: Float32Array;
}

interface MutablePortalFrameNodePlan {
	readonly nodeId: number;
	readonly parentNodeId: PortalFrameNodeId | null;
	readonly scene: PortalFrameSceneSource;
	readonly traversalDepth: number;
	readonly incomingEdgeIds: number[];
	readonly resources: PortalFrameNodeResources;
	readonly debugStackLabel: string;
}

interface DirectPortalGraphBuildInput {
	readonly baseNode: DirectPortalNodeInput;
	readonly diagnostics: DirectPortalGraphDiagnosticsInput;
	readonly envCellResourceMembership: readonly EnvCellResourceMembership[];
	readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly traversalSources: readonly DirectPortalTraversalSource[];
}

interface DirectPortalGraphDiagnosticsInput {
	readonly transitionRootCandidateCount: number;
	readonly transitionRootCount: number;
	readonly transitionRootsRejectedNotSeenOutside: number;
	readonly transitionRootsRejectedUnknownSeenOutside: number;
}

interface DirectPortalNodeInput {
	readonly debugStackLabel: string;
	readonly scene: PortalFrameSceneSource;
	readonly traversalDepth: number;
}

interface DirectPortalTraversalSource {
	readonly allowedEnvCellIds: ReadonlySet<number> | null;
	readonly createDebugStackLabel: (traversalStackLabel: string) => string;
	readonly parentlessViewGroupMode: "root-node" | "standalone-node";
	readonly root: DirectPortalTraversalRoot;
	readonly traversalDepthOffset: number;
	readonly traversalPlan: PortalTraversalPlan;
}

type DirectPortalTraversalRoot =
	| {
			readonly kind: "base-node";
	  }
	| {
			readonly kind: "child-node";
			readonly entryEdges: readonly DirectPortalEdgeCandidate[];
			readonly node: DirectPortalNodeInput;
	  };

interface DirectPortalEdgeCandidate {
	readonly apertureResourceId: string;
	readonly apertureSourceId: string;
	readonly duplicateKeyParts: readonly (number | string)[];
	readonly linkId: string;
	readonly sourceKind: PortalFrameEdgePlan["sourceKind"];
}

class PortalFrameGraphBuilder {
	readonly #apertureBuilder = new PortalApertureFrameResourceBuilder();
	readonly #edges: PortalFrameEdgePlan[] = [];
	readonly #nodes: MutablePortalFrameNodePlan[] = [];

	addNode(input: {
		readonly debugStackLabel: string;
		readonly parentNodeId: PortalFrameNodeId | null;
		readonly resources: PortalFrameNodeResources;
		readonly scene: PortalFrameSceneSource;
		readonly traversalDepth: number;
	}): PortalFrameNodeId {
		const nodeId = this.#nodes.length;
		this.#nodes.push({
			debugStackLabel: input.debugStackLabel,
			incomingEdgeIds: [],
			nodeId,
			parentNodeId: input.parentNodeId,
			resources: input.resources,
			scene: input.scene,
			traversalDepth: input.traversalDepth,
		});
		return nodeId;
	}

	addEdge(input: {
		readonly apertureResourceId: string;
		readonly apertureSourceId: string;
		readonly childNodeId: PortalFrameNodeId;
		readonly duplicateKeyParts: readonly (number | string)[];
		readonly linkId: string;
		readonly parentNodeId: PortalFrameNodeId;
		readonly sourceKind: PortalFrameEdgePlan["sourceKind"];
	}): PortalFrameEdgePlan | null {
		const apertureResourceId = this.#apertureBuilder.addEdgeResource({
			apertureResourceId: input.apertureResourceId,
			apertureSourceId: input.apertureSourceId,
			duplicateKeyParts: [
				input.parentNodeId,
				input.childNodeId,
				...input.duplicateKeyParts,
			],
			linkId: input.linkId,
			sourceKind: input.sourceKind,
		});
		if (!apertureResourceId) {
			return null;
		}
		const edge: PortalFrameEdgePlan = {
			apertureResourceId,
			apertureSourceId: input.apertureSourceId,
			childNodeId: input.childNodeId,
			edgeId: this.#edges.length,
			linkId: input.linkId,
			parentNodeId: input.parentNodeId,
			sourceKind: input.sourceKind,
		};
		this.#edges.push(edge);
		this.#nodes[input.childNodeId]?.incomingEdgeIds.push(edge.edgeId);
		return edge;
	}

	build(options: {
		readonly baseNodeId: PortalFrameNodeId;
		readonly transitionRootCandidateCount: number;
		readonly transitionRootCount: number;
		readonly transitionRootsRejectedNotSeenOutside: number;
		readonly transitionRootsRejectedUnknownSeenOutside: number;
	}): PortalFrameGraphPlan {
		const aperturePlan = this.#apertureBuilder.build({
			transitionRootCandidateCount: options.transitionRootCandidateCount,
			transitionRootCount: options.transitionRootCount,
			transitionRootsRejectedNotSeenOutside:
				options.transitionRootsRejectedNotSeenOutside,
			transitionRootsRejectedUnknownSeenOutside:
				options.transitionRootsRejectedUnknownSeenOutside,
		});
		return {
			apertureResources: aperturePlan.resources,
			baseNodeId: options.baseNodeId,
			diagnostics: aperturePlan.diagnostics,
			edges: this.#edges,
			nodes: this.#nodes.map(
				(node): PortalFrameNodePlan => ({
					...node,
					incomingEdgeIds: [...node.incomingEdgeIds],
				}),
			),
		};
	}
}

export function createDirectEnvCellFramePlan(
	input: DirectEnvCellFramePlanInput,
): PortalFrameWorkPlan | null {
	if (input.currentCameraResidency.kind !== "env-cell") {
		return null;
	}
	if (input.traversalPlan.portalViewGroups.length === 0) {
		return null;
	}

	const baseViewGroup = input.traversalPlan.portalViewGroups.find(
		(viewGroup) => viewGroup.parentPortalStackId === null,
	);
	if (!baseViewGroup) {
		return null;
	}

	return createDirectPortalFramePlan({
		baseNode: {
			debugStackLabel: baseViewGroup.portalStackId,
			scene: {
				envCellId: baseViewGroup.envCellId,
				kind: "env-cell-direct",
				landblockId: baseViewGroup.landblockId,
			},
			traversalDepth: baseViewGroup.traversalDepth,
		},
		diagnostics: {
			transitionRootCandidateCount: 0,
			transitionRootCount: 0,
			transitionRootsRejectedNotSeenOutside: 0,
			transitionRootsRejectedUnknownSeenOutside: 0,
		},
		envCellResourceMembership: input.envCellResourceMembership,
		portalInteriorRecords: input.portalInteriorRecords,
		traversalSources: [
			{
				allowedEnvCellIds: null,
				createDebugStackLabel: (traversalStackLabel) => traversalStackLabel,
				parentlessViewGroupMode: "standalone-node",
				root: { kind: "base-node" },
				traversalDepthOffset: 0,
				traversalPlan: input.traversalPlan,
			},
		],
	});
}

export function createOutdoorProjectionPortalFramePlan(
	input: OutdoorProjectionPortalFramePlanInput,
): PortalFrameWorkPlan | null {
	if (input.projection.landblockId !== input.landblockId) {
		throw new Error(
			`Outdoor projection landblock ${formatHex32(input.projection.landblockId)} does not match frame-plan landblock ${formatHex32(input.landblockId)}.`,
		);
	}
	if (
		input.projection.renderLayers.length === 0 ||
		input.projection.edges.length === 0
	) {
		return null;
	}

	const indexes = createPortalFrameIndexes({
		envCellResourceMembership: input.envCellResourceMembership,
		portalInteriorRecords: [],
	});
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
	const renderEntries: OutdoorProjectionPortalFrameRenderEntryPlan[] = [];
	const renderLayers: {
		renderLayer: number;
		renderEntryIds: number[];
	}[] = [];
	let renderEntriesSkippedByLayerCap = 0;
	let renderEntriesSkippedByMaxCells = 0;
	let missingResourceMembershipCount = 0;

	for (const layer of input.projection.renderLayers) {
		if (layer.renderLayer > input.maxDepth) {
			renderEntriesSkippedByLayerCap += layer.envCellIds.length;
			continue;
		}
		const renderEntryIds: number[] = [];
		for (const envCellId of layer.envCellIds) {
			if (renderEntries.length >= input.maxCells) {
				renderEntriesSkippedByMaxCells += 1;
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
			const renderEntry: OutdoorProjectionPortalFrameRenderEntryPlan = {
				debugStackLabel: createOutdoorProjectionRenderEntryLabel({
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

	if (renderEntries.length === 0) {
		return null;
	}

	const maskEdges: OutdoorProjectionPortalFrameMaskEdgePlan[] = [];
	let maskEdgesSkippedByLayerCap = 0;
	let maskEdgesSkippedByMaxPortalViews = 0;
	for (const renderEntry of renderEntries) {
		const incomingEdgeIds =
			incomingEdgeIdsByEnvCellId.get(renderEntry.envCellId) ?? [];
		const mutableIncomingMaskEdgeIds: number[] = [];
		for (const projectionEdgeId of incomingEdgeIds) {
			const projectionEdge = edgeById.get(projectionEdgeId);
			if (!projectionEdge) {
				throw new Error(
					`Outdoor projection incoming edge ${projectionEdgeId} is missing from edge table.`,
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
			if (maskEdges.length >= input.maxPortalViews) {
				maskEdgesSkippedByMaxPortalViews += 1;
				continue;
			}
			const apertureResourceId = apertureBuilder.addEdgeResource({
				apertureResourceId: projectionEdge.apertureResourceId,
				apertureSourceId: projectionEdge.apertureSourceId,
				duplicateKeyParts: [
					renderEntry.renderEntryId,
					projectionEdge.sourceEnvCellId ?? "outdoor",
					projectionEdge.targetEnvCellId,
				],
				linkId: projectionEdge.linkId,
				sourceKind: projectionEdge.sourceKind,
			});
			if (!apertureResourceId) {
				continue;
			}
			const edgeId = maskEdges.length;
			maskEdges.push({
				apertureResourceId,
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
		replaceOutdoorProjectionRenderEntry(
			renderEntries,
			renderEntry.renderEntryId,
			{
				...renderEntry,
				incomingMaskEdgeIds: mutableIncomingMaskEdgeIds,
			},
		);
	}

	const aperturePlan = apertureBuilder.build({
		transitionRootCandidateCount:
			input.projection.diagnostics.transitionRootCandidateCount,
		transitionRootCount:
			input.projection.diagnostics.acceptedTransitionRootCount,
		transitionRootsRejectedNotSeenOutside: 0,
		transitionRootsRejectedUnknownSeenOutside: 0,
	});
	const graph: OutdoorProjectionPortalFrameGraphPlan = {
		apertureResources: aperturePlan.resources,
		baseEntry: {
			debugStackLabel: createOutdoorRootPortalStackLabel(input.landblockId),
			scene: {
				kind: "outdoor-target",
				landblockId: input.landblockId,
			},
		},
		diagnostics: aperturePlan.diagnostics,
		maskEdges,
		projectionDiagnostics: {
			componentCount: input.projection.diagnostics.componentCount,
			componentInternalEdgeCount:
				input.projection.diagnostics.componentInternalEdgeCount,
			cyclicComponentCount: input.projection.diagnostics.cyclicComponentCount,
			maskEdgesSkippedByLayerCap,
			maskEdgesSkippedByMaxPortalViews,
			maxProjectionRenderLayer: input.projection.diagnostics.maxRenderLayer,
			maxSelectedRenderLayer: Math.max(
				0,
				...renderLayers.map((layer) => layer.renderLayer),
			),
			missingResourceMembershipCount,
			projectedEnvCellCount: input.projection.nodes.length,
			renderEntriesSkippedByLayerCap,
			renderEntriesSkippedByMaxCells,
			renderEntryCount: renderEntries.length,
		},
		renderEntries,
		renderLayers,
	};

	return {
		kind: "direct-env-cell",
		layeredGraph: graph,
		mode: "outdoor-projection",
	};
}

function createDirectPortalFramePlan(
	input: DirectPortalGraphBuildInput,
): DirectEnvCellTraversalPortalFrameWorkPlan | null {
	const indexes = createPortalFrameIndexes(input);
	const graphBuilder = new PortalFrameGraphBuilder();
	const baseNodeId = graphBuilder.addNode({
		debugStackLabel: input.baseNode.debugStackLabel,
		parentNodeId: null,
		resources: createNodeResources(input.baseNode.scene, indexes),
		scene: input.baseNode.scene,
		traversalDepth: input.baseNode.traversalDepth,
	});

	for (const source of input.traversalSources) {
		appendDirectPortalTraversalSource({
			baseNodeId,
			graphBuilder,
			indexes,
			source,
		});
	}

	return {
		graph: graphBuilder.build({
			baseNodeId,
			transitionRootCandidateCount:
				input.diagnostics.transitionRootCandidateCount,
			transitionRootCount: input.diagnostics.transitionRootCount,
			transitionRootsRejectedNotSeenOutside:
				input.diagnostics.transitionRootsRejectedNotSeenOutside,
			transitionRootsRejectedUnknownSeenOutside:
				input.diagnostics.transitionRootsRejectedUnknownSeenOutside,
		}),
		kind: "direct-env-cell",
		mode: "portal-traversal",
	};
}

function createPortalFrameIndexes(input: {
	readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
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

	const portalEnvCellsByLandblock = new Map<
		number,
		Map<number, PortalFrameEnvCellLookup>
	>();
	for (const record of input.portalInteriorRecords) {
		const envCellsById = getOrCreateNestedMap(
			portalEnvCellsByLandblock,
			record.landblockId,
		);
		for (const envCell of record.envCells) {
			const aperturesByPortalId = new Map<string, PortalAperture>();
			for (const aperture of envCell.portalApertures) {
				aperturesByPortalId.set(aperture.portalId, aperture);
			}
			envCellsById.set(envCell.envCellId, {
				aperturesByPortalId,
				envCell,
				placementMatrix: buildAcPlacementMatrix(
					envCell.localPlacement,
					AC_UNIT_SCALE,
				),
			});
		}
	}

	return {
		membershipByLandblock,
		portalEnvCellsByLandblock,
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

function appendDirectPortalTraversalSource(options: {
	readonly baseNodeId: PortalFrameNodeId;
	readonly graphBuilder: PortalFrameGraphBuilder;
	readonly indexes: PortalFrameIndexes;
	readonly source: DirectPortalTraversalSource;
}): void {
	const rootNodeId =
		options.source.root.kind === "base-node"
			? options.baseNodeId
			: createChildTraversalRootNode({
					baseNodeId: options.baseNodeId,
					graphBuilder: options.graphBuilder,
					indexes: options.indexes,
					root: options.source.root,
				});
	const nodeIdByTraversalStack = new Map<string, PortalFrameNodeId>([
		[
			createRootPortalStackLabel(options.source.traversalPlan.startEnvCellId),
			rootNodeId,
		],
	]);

	for (const viewGroup of options.source.traversalPlan.portalViewGroups) {
		if (
			options.source.allowedEnvCellIds &&
			!options.source.allowedEnvCellIds.has(viewGroup.envCellId >>> 0)
		) {
			continue;
		}
		if (viewGroup.parentPortalStackId === null) {
			if (options.source.parentlessViewGroupMode === "root-node") {
				nodeIdByTraversalStack.set(viewGroup.portalStackId, rootNodeId);
				continue;
			}
			if (nodeIdByTraversalStack.has(viewGroup.portalStackId)) {
				continue;
			}
			const scene: PortalFrameSceneSource = {
				envCellId: viewGroup.envCellId,
				kind: "env-cell-direct",
				landblockId: viewGroup.landblockId,
			};
			const nodeId = options.graphBuilder.addNode({
				debugStackLabel: options.source.createDebugStackLabel(
					viewGroup.portalStackId,
				),
				parentNodeId: null,
				resources: createNodeResources(scene, options.indexes),
				scene,
				traversalDepth:
					viewGroup.traversalDepth + options.source.traversalDepthOffset,
			});
			nodeIdByTraversalStack.set(viewGroup.portalStackId, nodeId);
			continue;
		}
		const parentNodeId =
			nodeIdByTraversalStack.get(viewGroup.parentPortalStackId) ?? null;
		if (parentNodeId === null) {
			continue;
		}
		const scene: PortalFrameSceneSource = {
			envCellId: viewGroup.envCellId,
			kind: "env-cell-direct",
			landblockId: viewGroup.landblockId,
		};
		const nodeId = options.graphBuilder.addNode({
			debugStackLabel: options.source.createDebugStackLabel(
				viewGroup.portalStackId,
			),
			parentNodeId,
			resources: createNodeResources(scene, options.indexes),
			scene,
			traversalDepth:
				viewGroup.traversalDepth + options.source.traversalDepthOffset,
		});
		nodeIdByTraversalStack.set(viewGroup.portalStackId, nodeId);
		addPortalEdgeCandidates({
			candidates: createEnvCellPortalEdgeCandidates({
				indexes: options.indexes,
				viewGroup,
			}),
			childNodeId: nodeId,
			graphBuilder: options.graphBuilder,
			parentNodeId,
		});
	}
}

function createChildTraversalRootNode(options: {
	readonly baseNodeId: PortalFrameNodeId;
	readonly graphBuilder: PortalFrameGraphBuilder;
	readonly indexes: PortalFrameIndexes;
	readonly root: Extract<
		DirectPortalTraversalRoot,
		{ readonly kind: "child-node" }
	>;
}): PortalFrameNodeId {
	const nodeId = options.graphBuilder.addNode({
		debugStackLabel: options.root.node.debugStackLabel,
		parentNodeId: options.baseNodeId,
		resources: createNodeResources(options.root.node.scene, options.indexes),
		scene: options.root.node.scene,
		traversalDepth: options.root.node.traversalDepth,
	});
	addPortalEdgeCandidates({
		candidates: options.root.entryEdges,
		childNodeId: nodeId,
		graphBuilder: options.graphBuilder,
		parentNodeId: options.baseNodeId,
	});
	return nodeId;
}

function addPortalEdgeCandidates(options: {
	readonly candidates: readonly DirectPortalEdgeCandidate[];
	readonly childNodeId: PortalFrameNodeId;
	readonly graphBuilder: PortalFrameGraphBuilder;
	readonly parentNodeId: PortalFrameNodeId;
}): void {
	for (const candidate of options.candidates) {
		options.graphBuilder.addEdge({
			...candidate,
			childNodeId: options.childNodeId,
			parentNodeId: options.parentNodeId,
		});
	}
}

function createEnvCellPortalEdgeCandidates(options: {
	readonly indexes: PortalFrameIndexes;
	readonly viewGroup: PortalTraversalPlan["portalViewGroups"][number];
}): readonly DirectPortalEdgeCandidate[] {
	const candidates: DirectPortalEdgeCandidate[] = [];
	for (const edge of options.viewGroup.apertureEdges) {
		const sourceEnvCell = options.indexes.portalEnvCellsByLandblock
			.get(options.viewGroup.landblockId)
			?.get(edge.sourceEnvCellId);
		const aperture = sourceEnvCell?.aperturesByPortalId.get(
			edge.sourcePortalId,
		);
		if (!sourceEnvCell || !aperture || aperture.points.length < 3) {
			continue;
		}
		candidates.push({
			apertureResourceId: createEnvCellPortalApertureRangeId({
				envCellId: edge.sourceEnvCellId,
				landblockId: options.viewGroup.landblockId,
				polygonId: aperture.polygonId,
				portalId: edge.sourcePortalId,
				sourceIndex: aperture.sourceIndex,
			}),
			apertureSourceId: createEnvCellPortalApertureSourceId({
				envCellId: edge.sourceEnvCellId,
				landblockId: options.viewGroup.landblockId,
				polygonId: aperture.polygonId,
				portalId: edge.sourcePortalId,
				sourceIndex: aperture.sourceIndex,
			}),
			duplicateKeyParts: [
				edge.sourceEnvCellId,
				edge.targetEnvCellId,
				edge.sourcePortalId,
				edge.targetPortalId,
			],
			linkId: edge.linkId,
			sourceKind: "env-cell-portal",
		});
	}
	return candidates;
}

function formatHex32(value: number): string {
	return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}

function createRootPortalStackLabel(startEnvCellId: number): string {
	return `root:${formatHex32(startEnvCellId)}`;
}

function createOutdoorRootPortalStackLabel(landblockId: number): string {
	return `outdoor-root:${formatHex32(landblockId)}`;
}

function createOutdoorProjectionRenderEntryLabel(options: {
	readonly envCellId: number;
	readonly landblockId: number;
	readonly renderLayer: number;
}): string {
	return `${createOutdoorRootPortalStackLabel(options.landblockId)}/layer:${options.renderLayer}/cell:${formatHex32(options.envCellId)}`;
}

function replaceOutdoorProjectionRenderEntry(
	entries: OutdoorProjectionPortalFrameRenderEntryPlan[],
	renderEntryId: number,
	entry: OutdoorProjectionPortalFrameRenderEntryPlan,
): void {
	if (entries[renderEntryId]?.renderEntryId !== renderEntryId) {
		throw new Error(
			`Outdoor projection render entry ${renderEntryId} is missing or out of order.`,
		);
	}
	entries[renderEntryId] = entry;
}
