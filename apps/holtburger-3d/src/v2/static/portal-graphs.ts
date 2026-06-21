import type {
	LandblockPortalLinkFacts,
	StaticOutdoorPortalProjectionAdjacency,
	StaticOutdoorPortalProjectionComponent,
	StaticOutdoorPortalProjectionComponentEdge,
	StaticOutdoorPortalProjectionDiagnostics,
	StaticOutdoorPortalProjectionEdge,
	StaticOutdoorPortalProjectionIncomingEdges,
	StaticOutdoorPortalProjectionRecord,
	StaticOutdoorPortalProjectionRenderLayer,
	StaticPortalGraphEdge,
	StaticPortalGraphNode,
	StaticPortalGraphRecord,
	StaticPortalGraphScene,
	StaticPortalInteriorRecord,
	StaticWorkPeerRecordOwner,
	TransitionApertureBatch,
} from "./contracts";
import {
	createBuildingTransitionApertureRangeId,
	createBuildingTransitionApertureSourceId,
	createBuildingTransitionTargetEnvCellId,
	createEnvCellPortalApertureRangeId,
	createEnvCellPortalApertureSourceId,
} from "./portal-aperture-resources";

type PortalAperture =
	StaticPortalInteriorRecord["envCells"][number]["portalApertures"][number];
type MutableProjectionDiagnostics = {
	-readonly [Key in keyof StaticOutdoorPortalProjectionDiagnostics]: StaticOutdoorPortalProjectionDiagnostics[Key];
};

const OUTDOOR_ROOT_NODE_ID_PREFIX = "outdoor";

export function createEnvCellStaticPortalGraph(
	owner: StaticWorkPeerRecordOwner,
	record: StaticPortalInteriorRecord,
): StaticPortalGraphRecord {
	const nodesById = new Map<string, StaticPortalGraphNode>();
	for (const envCell of record.envCells) {
		const node = createPortalGraphNode({
			envCellId: envCell.envCellId,
			kind: "env-cell",
		});
		nodesById.set(node.nodeId, node);
	}

	const edges = record.portalLinks
		.map((link) => createEnvCellPortalGraphEdge(link, nodesById))
		.filter((edge): edge is StaticPortalGraphEdge => edge !== null)
		.sort(comparePortalGraphEdges);

	return {
		edges,
		kind: "static-portal-graph",
		landblockId: record.landblockId,
		nodes: [...nodesById.values()].sort(comparePortalGraphNodes),
		owner,
	};
}

export function createTransitionStaticPortalGraph(
	owner: StaticWorkPeerRecordOwner,
	batch: TransitionApertureBatch,
): StaticPortalGraphRecord {
	const nodesById = new Map<string, StaticPortalGraphNode>();
	const outdoorNode = createPortalGraphNode({
		kind: "outdoor",
		landblockId: batch.landblockId,
	});
	nodesById.set(outdoorNode.nodeId, outdoorNode);

	const edges: StaticPortalGraphEdge[] = [];
	for (const range of batch.ranges) {
		const envCellId = createBuildingTransitionTargetEnvCellId(batch, range);
		const envCellNode = createPortalGraphNode({
			envCellId,
			kind: "env-cell",
		});
		nodesById.set(envCellNode.nodeId, envCellNode);
		edges.push({
			direction: "directed",
			edgeId: [
				"building-transition",
				batch.apertureBatchId,
				range.portalId,
				envCellId,
			].join(":"),
			flags: 0,
			linkId: [
				"transition",
				batch.apertureBatchId,
				range.portalId,
				envCellId,
			].join(":"),
			polygonId: range.source.polyId,
			provenance: {
				apertureBatchId: batch.apertureBatchId,
				buildingInstanceId: range.source.buildingInstanceId,
				buildingPortalId: range.source.buildingPortalId,
				kind: "building-transition",
				portalId: range.portalId,
				targetEnvCellId: envCellId,
			},
			sceneCrossing: {
				envCellId,
				kind: "outdoor-to-env-cell",
				outdoorLandblockId: batch.landblockId,
			},
			sourceIndex: range.source.buildingPortalSourceIndex,
			sourceNodeId: outdoorNode.nodeId,
			targetNodeId: envCellNode.nodeId,
		});
	}

	return {
		edges: edges.sort(comparePortalGraphEdges),
		kind: "static-portal-graph",
		landblockId: batch.landblockId,
		nodes: [...nodesById.values()].sort(comparePortalGraphNodes),
		owner,
	};
}

export function createStaticOutdoorPortalProjection(options: {
	readonly landblockId: number;
	readonly portalGraphs: readonly StaticPortalGraphRecord[];
	readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly transitionApertureBatches: readonly TransitionApertureBatch[];
}): StaticOutdoorPortalProjectionRecord | null {
	const landblockId = options.landblockId >>> 0;
	const rootNodeId = createOutdoorPortalGraphNodeId(landblockId);
	const outsideVisibleEnvCellIds = createOutsideVisibleEnvCellIds(
		options.portalInteriorRecords,
		landblockId,
	);
	const envCellPortalApertures = createEnvCellPortalApertureLookup(
		options.portalInteriorRecords,
		landblockId,
	);
	const nodes = [...outsideVisibleEnvCellIds]
		.sort(compareNumbers)
		.map((envCellId) => ({
			envCellId,
			nodeId: createEnvCellPortalGraphNodeId(envCellId),
		}));
	const edges: StaticOutdoorPortalProjectionEdge[] = [];
	const diagnostics = createProjectionDiagnostics({
		outsideVisibleEnvCellCount: outsideVisibleEnvCellIds.size,
	});

	for (const batch of options.transitionApertureBatches) {
		if (batch.landblockId !== landblockId) {
			continue;
		}
		for (const range of batch.ranges) {
			diagnostics.transitionRootCandidateCount += 1;
			const targetEnvCellId = createBuildingTransitionTargetEnvCellId(
				batch,
				range,
			);
			if (!outsideVisibleEnvCellIds.has(targetEnvCellId)) {
				continue;
			}
			diagnostics.acceptedTransitionRootCount += 1;
			edges.push({
				apertureResourceId: createBuildingTransitionApertureRangeId({
					apertureBatchId: batch.apertureBatchId,
					portalId: range.portalId,
					rangeFirstIndex: range.firstIndex,
					rangeIndexCount: range.indexCount,
				}),
				apertureSourceId: createBuildingTransitionApertureSourceId({
					apertureBatchId: batch.apertureBatchId,
					portalId: range.portalId,
					rangeFirstIndex: range.firstIndex,
					rangeIndexCount: range.indexCount,
				}),
				edgeId: createProjectionBuildingTransitionEdgeId({
					apertureBatchId: batch.apertureBatchId,
					portalId: range.portalId,
					rangeFirstIndex: range.firstIndex,
					rangeIndexCount: range.indexCount,
					targetEnvCellId,
				}),
				linkId: createProjectionBuildingTransitionLinkId({
					apertureBatchId: batch.apertureBatchId,
					portalId: range.portalId,
					targetEnvCellId,
				}),
				provenance: {
					apertureBatchId: batch.apertureBatchId,
					buildingInstanceId: range.source.buildingInstanceId,
					buildingPortalId: range.source.buildingPortalId,
					kind: "building-transition",
					portalId: range.portalId,
					targetEnvCellId,
				},
				sourceEnvCellId: null,
				sourceKind: "building-transition",
				sourceNodeId: rootNodeId,
				targetEnvCellId,
				targetNodeId: createEnvCellPortalGraphNodeId(targetEnvCellId),
			});
		}
	}

	for (const graph of options.portalGraphs) {
		if (graph.landblockId !== landblockId) {
			continue;
		}
		for (const edge of graph.edges) {
			if (edge.sceneCrossing?.kind !== "env-cell-to-env-cell") {
				continue;
			}
			const sourceEnvCellId = edge.sceneCrossing.sourceEnvCellId >>> 0;
			const targetEnvCellId = edge.sceneCrossing.targetEnvCellId >>> 0;
			if (!outsideVisibleEnvCellIds.has(sourceEnvCellId)) {
				diagnostics.envCellPortalEdgesRejectedSourceNotOutsideVisible += 1;
				continue;
			}
			if (!outsideVisibleEnvCellIds.has(targetEnvCellId)) {
				diagnostics.envCellPortalEdgesRejectedTargetNotOutsideVisible += 1;
				continue;
			}
			const aperture = envCellPortalApertures
				.get(sourceEnvCellId)
				?.get(createEnvCellPortalApertureLookupKey({
					portalId:
						edge.provenance.kind === "env-cell-portal"
							? edge.provenance.sourcePortalId
							: "",
					sourceIndex: edge.sourceIndex,
				}));
			if (!aperture || edge.provenance.kind !== "env-cell-portal") {
				diagnostics.envCellPortalEdgesRejectedMissingAperture += 1;
				continue;
			}
			diagnostics.envCellPortalEdgesRetained += 1;
			edges.push({
				apertureResourceId: createEnvCellPortalApertureRangeId({
					envCellId: sourceEnvCellId,
					landblockId,
					polygonId: aperture.polygonId,
					portalId: edge.provenance.sourcePortalId,
					sourceIndex: aperture.sourceIndex,
				}),
				apertureSourceId: createEnvCellPortalApertureSourceId({
					envCellId: sourceEnvCellId,
					landblockId,
					polygonId: aperture.polygonId,
					portalId: edge.provenance.sourcePortalId,
					sourceIndex: aperture.sourceIndex,
				}),
				edgeId: `env-cell-portal:${edge.edgeId}`,
				linkId: edge.linkId,
				provenance: {
					kind: "env-cell-portal",
					polygonId: edge.polygonId,
					sourceEnvCellId,
					sourceIndex: edge.sourceIndex,
					sourcePortalId: edge.provenance.sourcePortalId,
					targetEnvCellId,
					targetPortalId:
						edge.provenance.target.kind === "env-cell"
							? edge.provenance.target.portalId
							: "",
				},
				sourceEnvCellId,
				sourceKind: "env-cell-portal",
				sourceNodeId: createEnvCellPortalGraphNodeId(sourceEnvCellId),
				targetEnvCellId,
				targetNodeId: createEnvCellPortalGraphNodeId(targetEnvCellId),
			});
		}
	}

	const sortedEdges = edges.sort(compareProjectionEdges);
	const adjacency = createProjectionAdjacency(sortedEdges);
	const incomingEdges = createProjectionIncomingEdges(sortedEdges);
	const components = createProjectionComponents(nodes, sortedEdges);
	const componentEdges = createProjectionComponentEdges(sortedEdges, components);
	const componentLayers = createProjectionComponentLayers(componentEdges);
	const componentsWithLayers = components.map((component) => ({
		...component,
		renderLayer: componentLayers.get(component.componentId) ?? null,
	}));
	const renderLayers = createProjectionRenderLayers(componentsWithLayers);
	const renderLayerByEnvCellId = componentsWithLayers
		.flatMap((component) =>
			component.renderLayer === null
				? []
				: component.envCellIds.map((envCellId) => ({
						envCellId,
						renderLayer: component.renderLayer ?? 0,
					})),
		)
		.sort((left, right) => left.envCellId - right.envCellId);

	diagnostics.componentCount = componentsWithLayers.length;
	diagnostics.cyclicComponentCount = componentsWithLayers.filter(
		(component) => component.cyclic,
	).length;
	diagnostics.maxRenderLayer = renderLayers.at(-1)?.renderLayer ?? 0;
	diagnostics.componentInternalEdgeCount = sortedEdges.filter((edge) => {
		if (edge.sourceEnvCellId === null) {
			return false;
		}
		return (
			findComponentIdForEnvCell(componentsWithLayers, edge.sourceEnvCellId) ===
			findComponentIdForEnvCell(componentsWithLayers, edge.targetEnvCellId)
		);
	}).length;

	return sortedEdges.length > 0
		? {
				adjacency,
				componentEdges,
				components: componentsWithLayers,
				diagnostics,
				edges: sortedEdges,
				incomingEdges,
				kind: "outdoor-portal-projection",
				landblockId,
				nodes,
				renderLayerByEnvCellId,
				renderLayers,
				rootNodeId,
				sourceRevisionKey: createStaticOutdoorPortalProjectionSourceKey({
					landblockId,
					portalGraphs: options.portalGraphs,
					portalInteriorRecords: options.portalInteriorRecords,
					transitionApertureBatches: options.transitionApertureBatches,
				}),
			}
		: null;
}

function createEnvCellPortalGraphEdge(
	link: LandblockPortalLinkFacts,
	nodesById: Map<string, StaticPortalGraphNode>,
): StaticPortalGraphEdge | null {
	if (link.source.kind !== "env-cell") {
		return null;
	}

	const sourceNode = createPortalGraphNode({
		envCellId: link.source.envCellId,
		kind: "env-cell",
	});
	const targetNode = createPortalGraphNodeFromEndpoint(link.target);
	nodesById.set(sourceNode.nodeId, sourceNode);
	nodesById.set(targetNode.nodeId, targetNode);

	return {
		direction: "directed",
		edgeId: ["env-cell-portal", link.linkId, link.sourceIndex].join(":"),
		flags: link.flags,
		linkId: link.linkId,
		polygonId: link.polygonId,
		provenance: {
			kind: "env-cell-portal",
			sourceEnvCellId: link.source.envCellId,
			sourcePortalId: link.source.portalId,
			target: link.target,
		},
		sceneCrossing: createEnvCellPortalSceneCrossing(link),
		sourceIndex: link.sourceIndex,
		sourceNodeId: sourceNode.nodeId,
		targetNodeId: targetNode.nodeId,
	};
}

function createPortalGraphNodeFromEndpoint(
	endpoint: LandblockPortalLinkFacts["target"],
): StaticPortalGraphNode {
	switch (endpoint.kind) {
		case "env-cell":
			return createPortalGraphNode({
				envCellId: endpoint.envCellId,
				kind: "env-cell",
			});
		case "landblock-building":
			return createPortalGraphNode({
				buildingInstanceId: endpoint.instanceId,
				kind: "landblock-building",
			});
		case "outside":
			return createPortalGraphNode({
				kind: "outdoor",
				landblockId: endpoint.landblockId,
			});
	}
}

function createEnvCellPortalSceneCrossing(
	link: LandblockPortalLinkFacts,
): StaticPortalGraphEdge["sceneCrossing"] {
	if (link.source.kind !== "env-cell") {
		return null;
	}
	switch (link.target.kind) {
		case "env-cell":
			return {
				kind: "env-cell-to-env-cell",
				sourceEnvCellId: link.source.envCellId,
				targetEnvCellId: link.target.envCellId,
			};
		case "landblock-building":
			return {
				buildingInstanceId: link.target.instanceId,
				kind: "env-cell-to-landblock-building",
				sourceEnvCellId: link.source.envCellId,
			};
		case "outside":
			return {
				kind: "env-cell-to-outdoor",
				outdoorLandblockId: link.target.landblockId,
				sourceEnvCellId: link.source.envCellId,
			};
	}
}

function createPortalGraphNode(
	scene: StaticPortalGraphScene,
): StaticPortalGraphNode {
	switch (scene.kind) {
		case "env-cell":
			return {
				nodeId: createEnvCellPortalGraphNodeId(scene.envCellId),
				scene,
			};
		case "landblock-building":
			return {
				nodeId: `building:${scene.buildingInstanceId}`,
				scene,
			};
		case "outdoor":
			return {
				nodeId: createOutdoorPortalGraphNodeId(scene.landblockId),
				scene,
			};
	}
}

function createEnvCellPortalGraphNodeId(envCellId: number): string {
	return `env-cell:${envCellId >>> 0}`;
}

function createOutdoorPortalGraphNodeId(landblockId: number): string {
	return `${OUTDOOR_ROOT_NODE_ID_PREFIX}:${landblockId >>> 0}`;
}

function comparePortalGraphNodes(
	left: StaticPortalGraphNode,
	right: StaticPortalGraphNode,
): number {
	return left.nodeId.localeCompare(right.nodeId);
}

function comparePortalGraphEdges(
	left: StaticPortalGraphEdge,
	right: StaticPortalGraphEdge,
): number {
	return left.edgeId.localeCompare(right.edgeId);
}

function createOutsideVisibleEnvCellIds(
	records: readonly StaticPortalInteriorRecord[],
	landblockId: number,
): ReadonlySet<number> {
	const envCellIds = new Set<number>();
	for (const record of records) {
		if (record.landblockId !== landblockId) {
			continue;
		}
		for (const envCell of record.envCells) {
			if (envCell.seenOutside === true) {
				envCellIds.add(envCell.envCellId >>> 0);
			}
		}
	}
	return envCellIds;
}

function createEnvCellPortalApertureLookup(
	records: readonly StaticPortalInteriorRecord[],
	landblockId: number,
): ReadonlyMap<number, ReadonlyMap<string, PortalAperture>> {
	const lookup = new Map<number, Map<string, PortalAperture>>();
	for (const record of records) {
		if (record.landblockId !== landblockId) {
			continue;
		}
		for (const envCell of record.envCells) {
			const apertures = lookup.get(envCell.envCellId) ?? new Map();
			for (const aperture of envCell.portalApertures) {
				apertures.set(
					createEnvCellPortalApertureLookupKey({
						portalId: aperture.portalId,
						sourceIndex: aperture.sourceIndex,
					}),
					aperture,
				);
			}
			lookup.set(envCell.envCellId >>> 0, apertures);
		}
	}
	return lookup;
}

function createEnvCellPortalApertureLookupKey(options: {
	readonly portalId: string;
	readonly sourceIndex: number;
}): string {
	return `${options.portalId}:${options.sourceIndex}`;
}

function createProjectionDiagnostics(options: {
	readonly outsideVisibleEnvCellCount: number;
}): MutableProjectionDiagnostics {
	return {
		acceptedTransitionRootCount: 0,
		componentCount: 0,
		componentInternalEdgeCount: 0,
		cyclicComponentCount: 0,
		envCellPortalEdgesRejectedMissingAperture: 0,
		envCellPortalEdgesRejectedSourceNotOutsideVisible: 0,
		envCellPortalEdgesRejectedTargetNotOutsideVisible: 0,
		envCellPortalEdgesRetained: 0,
		maxRenderLayer: 0,
		outsideVisibleEnvCellCount: options.outsideVisibleEnvCellCount,
		transitionRootCandidateCount: 0,
	};
}

function createProjectionBuildingTransitionEdgeId(options: {
	readonly apertureBatchId: string;
	readonly portalId: string;
	readonly rangeFirstIndex: number;
	readonly rangeIndexCount: number;
	readonly targetEnvCellId: number;
}): string {
	return [
		"building-transition",
		options.apertureBatchId,
		options.portalId,
		options.rangeFirstIndex,
		options.rangeIndexCount,
		options.targetEnvCellId >>> 0,
	].join(":");
}

function createProjectionBuildingTransitionLinkId(options: {
	readonly apertureBatchId: string;
	readonly portalId: string;
	readonly targetEnvCellId: number;
}): string {
	return [
		"transition",
		options.apertureBatchId,
		options.portalId,
		options.targetEnvCellId >>> 0,
	].join(":");
}

function createProjectionAdjacency(
	edges: readonly StaticOutdoorPortalProjectionEdge[],
): readonly StaticOutdoorPortalProjectionAdjacency[] {
	const edgeIdsBySource = new Map<string, string[]>();
	for (const edge of edges) {
		const edgeIds = edgeIdsBySource.get(edge.sourceNodeId) ?? [];
		edgeIds.push(edge.edgeId);
		edgeIdsBySource.set(edge.sourceNodeId, edgeIds);
	}
	return [...edgeIdsBySource.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([sourceNodeId, edgeIds]) => ({
			edgeIds: edgeIds.sort(),
			sourceNodeId,
		}));
}

function createProjectionIncomingEdges(
	edges: readonly StaticOutdoorPortalProjectionEdge[],
): readonly StaticOutdoorPortalProjectionIncomingEdges[] {
	const edgeIdsByTarget = new Map<number, string[]>();
	for (const edge of edges) {
		const edgeIds = edgeIdsByTarget.get(edge.targetEnvCellId) ?? [];
		edgeIds.push(edge.edgeId);
		edgeIdsByTarget.set(edge.targetEnvCellId, edgeIds);
	}
	return [...edgeIdsByTarget.entries()]
		.sort(([left], [right]) => left - right)
		.map(([targetEnvCellId, edgeIds]) => ({
			edgeIds: edgeIds.sort(),
			targetEnvCellId,
		}));
}

function createProjectionComponents(
	nodes: readonly { readonly envCellId: number }[],
	edges: readonly StaticOutdoorPortalProjectionEdge[],
): readonly StaticOutdoorPortalProjectionComponent[] {
	const envCellIds = nodes.map((node) => node.envCellId).sort(compareNumbers);
	const outgoingBySource = new Map<number, number[]>();
	for (const edge of edges) {
		if (edge.sourceEnvCellId === null) {
			continue;
		}
		const outgoing = outgoingBySource.get(edge.sourceEnvCellId) ?? [];
		outgoing.push(edge.targetEnvCellId);
		outgoingBySource.set(edge.sourceEnvCellId, outgoing);
	}
	for (const outgoing of outgoingBySource.values()) {
		outgoing.sort(compareNumbers);
	}

	let index = 0;
	const stack: number[] = [];
	const indexByEnvCellId = new Map<number, number>();
	const lowLinkByEnvCellId = new Map<number, number>();
	const onStack = new Set<number>();
	const components: StaticOutdoorPortalProjectionComponent[] = [];

	const strongConnect = (envCellId: number): void => {
		indexByEnvCellId.set(envCellId, index);
		lowLinkByEnvCellId.set(envCellId, index);
		index += 1;
		stack.push(envCellId);
		onStack.add(envCellId);

		for (const targetEnvCellId of outgoingBySource.get(envCellId) ?? []) {
			if (!indexByEnvCellId.has(targetEnvCellId)) {
				strongConnect(targetEnvCellId);
				lowLinkByEnvCellId.set(
					envCellId,
					Math.min(
						lowLinkByEnvCellId.get(envCellId) ?? 0,
						lowLinkByEnvCellId.get(targetEnvCellId) ?? 0,
					),
				);
				continue;
			}
			if (onStack.has(targetEnvCellId)) {
				lowLinkByEnvCellId.set(
					envCellId,
					Math.min(
						lowLinkByEnvCellId.get(envCellId) ?? 0,
						indexByEnvCellId.get(targetEnvCellId) ?? 0,
					),
				);
			}
		}

		if (lowLinkByEnvCellId.get(envCellId) !== indexByEnvCellId.get(envCellId)) {
			return;
		}

		const componentEnvCellIds: number[] = [];
		while (stack.length > 0) {
			const componentEnvCellId = stack.pop();
			if (componentEnvCellId === undefined) {
				break;
			}
			onStack.delete(componentEnvCellId);
			componentEnvCellIds.push(componentEnvCellId);
			if (componentEnvCellId === envCellId) {
				break;
			}
		}
		componentEnvCellIds.sort(compareNumbers);
		components.push({
			componentId: createProjectionComponentId(componentEnvCellIds),
			cyclic:
				componentEnvCellIds.length > 1 ||
				(outgoingBySource.get(componentEnvCellIds[0] ?? -1) ?? []).includes(
					componentEnvCellIds[0] ?? -1,
				),
			envCellIds: componentEnvCellIds,
			renderLayer: null,
		});
	};

	for (const envCellId of envCellIds) {
		if (!indexByEnvCellId.has(envCellId)) {
			strongConnect(envCellId);
		}
	}

	return components.sort((left, right) =>
		left.componentId.localeCompare(right.componentId),
	);
}

function createProjectionComponentEdges(
	edges: readonly StaticOutdoorPortalProjectionEdge[],
	components: readonly StaticOutdoorPortalProjectionComponent[],
): readonly StaticOutdoorPortalProjectionComponentEdge[] {
	const componentIdByEnvCellId = createComponentIdByEnvCellId(components);
	const edgeIdsByComponentEdge = new Map<string, string[]>();
	for (const edge of edges) {
		const sourceComponentId =
			edge.sourceEnvCellId === null
				? createOutdoorComponentId()
				: componentIdByEnvCellId.get(edge.sourceEnvCellId);
		const targetComponentId = componentIdByEnvCellId.get(edge.targetEnvCellId);
		if (!sourceComponentId || !targetComponentId) {
			continue;
		}
		const key = `${sourceComponentId}->${targetComponentId}`;
		const edgeIds = edgeIdsByComponentEdge.get(key) ?? [];
		edgeIds.push(edge.edgeId);
		edgeIdsByComponentEdge.set(key, edgeIds);
	}
	return [...edgeIdsByComponentEdge.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, edgeIds]) => {
			const [sourceComponentId, targetComponentId] = key.split("->");
			if (!sourceComponentId || !targetComponentId) {
				throw new Error(`Invalid projection component edge key ${key}.`);
			}
			return {
				edgeIds: edgeIds.sort(),
				sourceComponentId,
				targetComponentId,
			};
		});
}

function createProjectionComponentLayers(
	componentEdges: readonly StaticOutdoorPortalProjectionComponentEdge[],
): ReadonlyMap<string, number> {
	const outgoingBySource = new Map<string, string[]>();
	for (const edge of componentEdges) {
		if (edge.sourceComponentId === edge.targetComponentId) {
			continue;
		}
		const outgoing = outgoingBySource.get(edge.sourceComponentId) ?? [];
		outgoing.push(edge.targetComponentId);
		outgoingBySource.set(edge.sourceComponentId, outgoing);
	}
	for (const outgoing of outgoingBySource.values()) {
		outgoing.sort();
	}

	const layers = new Map<string, number>([[createOutdoorComponentId(), 0]]);
	const queue = [createOutdoorComponentId()];
	while (queue.length > 0) {
		const sourceComponentId = queue.shift();
		if (!sourceComponentId) {
			continue;
		}
		const sourceLayer = layers.get(sourceComponentId) ?? 0;
		for (const targetComponentId of outgoingBySource.get(sourceComponentId) ?? []) {
			const targetLayer = sourceLayer + 1;
			if ((layers.get(targetComponentId) ?? -1) >= targetLayer) {
				continue;
			}
			layers.set(targetComponentId, targetLayer);
			queue.push(targetComponentId);
		}
	}
	layers.delete(createOutdoorComponentId());
	return layers;
}

function createProjectionRenderLayers(
	components: readonly StaticOutdoorPortalProjectionComponent[],
): readonly StaticOutdoorPortalProjectionRenderLayer[] {
	const componentsByLayer = new Map<
		number,
		{ componentIds: string[]; envCellIds: number[] }
	>();
	for (const component of components) {
		if (component.renderLayer === null) {
			continue;
		}
		const layer = componentsByLayer.get(component.renderLayer) ?? {
			componentIds: [],
			envCellIds: [],
		};
		layer.componentIds.push(component.componentId);
		layer.envCellIds.push(...component.envCellIds);
		componentsByLayer.set(component.renderLayer, layer);
	}
	return [...componentsByLayer.entries()]
		.sort(([left], [right]) => left - right)
		.map(([renderLayer, layer]) => ({
			componentIds: layer.componentIds.sort(),
			envCellIds: layer.envCellIds.sort(compareNumbers),
			renderLayer,
		}));
}

function createProjectionComponentId(envCellIds: readonly number[]): string {
	return `component:${envCellIds.map((envCellId) => envCellId >>> 0).join(",")}`;
}

function createOutdoorComponentId(): string {
	return "component:outdoor";
}

function createComponentIdByEnvCellId(
	components: readonly StaticOutdoorPortalProjectionComponent[],
): ReadonlyMap<number, string> {
	const componentIdByEnvCellId = new Map<number, string>();
	for (const component of components) {
		for (const envCellId of component.envCellIds) {
			componentIdByEnvCellId.set(envCellId, component.componentId);
		}
	}
	return componentIdByEnvCellId;
}

function findComponentIdForEnvCell(
	components: readonly StaticOutdoorPortalProjectionComponent[],
	envCellId: number,
): string | null {
	for (const component of components) {
		if (component.envCellIds.includes(envCellId)) {
			return component.componentId;
		}
	}
	return null;
}

export function createStaticOutdoorPortalProjectionSourceKey(options: {
	readonly landblockId: number;
	readonly portalGraphs: readonly StaticPortalGraphRecord[];
	readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly transitionApertureBatches: readonly TransitionApertureBatch[];
}): string {
	const graphParts = options.portalGraphs
		.filter((graph) => graph.landblockId === options.landblockId)
		.flatMap((graph) =>
			graph.edges.map((edge) =>
				[
					"graph-edge",
					edge.edgeId,
					edge.sourceNodeId,
					edge.targetNodeId,
					edge.linkId,
					edge.sourceIndex,
					edge.polygonId ?? "none",
					edge.provenance.kind === "env-cell-portal"
						? edge.provenance.sourcePortalId
						: edge.provenance.portalId,
					edge.provenance.kind === "env-cell-portal" &&
						edge.provenance.target.kind === "env-cell"
						? edge.provenance.target.portalId
						: "none",
				].join(":"),
			),
		)
		.sort();
	const interiorParts = options.portalInteriorRecords
		.filter((record) => record.landblockId === options.landblockId)
		.flatMap((record) =>
			record.envCells.flatMap((envCell) => [
				[
					"env-cell",
					envCell.envCellId,
					envCell.seenOutside ?? "unknown",
				].join(":"),
				...envCell.portalApertures.map((aperture) =>
					[
						"aperture",
						envCell.envCellId,
						aperture.portalId,
						aperture.sourceIndex,
						aperture.polygonId ?? "none",
						aperture.points.length,
					].join(":"),
				),
			]),
		)
		.sort();
	const transitionParts = options.transitionApertureBatches
		.filter((batch) => batch.landblockId === options.landblockId)
		.flatMap((batch) =>
			batch.ranges.map((range) =>
				[
					"transition",
					batch.apertureBatchId,
					range.portalId,
					range.firstIndex,
					range.indexCount,
					createBuildingTransitionTargetEnvCellId(batch, range),
				].join(":"),
			),
		)
		.sort();
	return [
		`landblock:${options.landblockId >>> 0}`,
		...graphParts,
		...interiorParts,
		...transitionParts,
	].join("|");
}

function compareProjectionEdges(
	left: StaticOutdoorPortalProjectionEdge,
	right: StaticOutdoorPortalProjectionEdge,
): number {
	return left.edgeId.localeCompare(right.edgeId);
}

function compareNumbers(left: number, right: number): number {
	return left - right;
}
