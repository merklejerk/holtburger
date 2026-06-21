import type {
	LandblockPortalLinkFacts,
	StaticPortalProjectionAdjacency,
	StaticPortalProjectionComponent,
	StaticPortalProjectionComponentEdge,
	StaticPortalProjectionDiagnostics,
	StaticPortalProjectionEdge,
	StaticPortalProjectionIncomingEdges,
	StaticPortalProjectionRecord,
	StaticPortalProjectionRenderLayer,
	StaticPortalProjectionRoot,
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
	-readonly [Key in keyof StaticPortalProjectionDiagnostics]: StaticPortalProjectionDiagnostics[Key];
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

export function createStaticPortalProjection(options: {
	readonly landblockId: number;
	readonly portalGraphs: readonly StaticPortalGraphRecord[];
	readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly root: StaticPortalProjectionRoot;
	readonly transitionApertureBatches: readonly TransitionApertureBatch[];
}): StaticPortalProjectionRecord | null {
	const landblockId = options.landblockId >>> 0;
	if (options.root.landblockId !== landblockId) {
		throw new Error(
			`Portal projection root landblock ${options.root.landblockId >>> 0} does not match projection landblock ${landblockId}.`,
		);
	}
	const rootNodeId = options.root.rootNodeId;
	const outsideVisibleEnvCellIds = createOutsideVisibleEnvCellIds(
		options.portalInteriorRecords,
		landblockId,
	);
	const knownEnvCellIds = createKnownEnvCellIds(
		options.portalInteriorRecords,
		landblockId,
	);
	const envCellPortalApertures = createEnvCellPortalApertureLookup(
		options.portalInteriorRecords,
		landblockId,
	);
	const diagnostics = createProjectionDiagnostics({
		outsideVisibleEnvCellCount: outsideVisibleEnvCellIds.size,
	});
	const projected = createProjectionNodesAndEdges({
		diagnostics,
		envCellPortalApertures,
		knownEnvCellIds,
		landblockId,
		outsideVisibleEnvCellIds,
		portalGraphs: options.portalGraphs,
		root: options.root,
		rootNodeId,
		transitionApertureBatches: options.transitionApertureBatches,
	});
	if (projected === null) {
		return null;
	}
	const { edges, nodes, retainRootLayer } = projected;

	const sortedEdges = edges.sort(compareProjectionEdges);
	const adjacency = createProjectionAdjacency(sortedEdges);
	const incomingEdges = createProjectionIncomingEdges(sortedEdges);
	const components = createProjectionComponents(nodes, sortedEdges);
	const rootComponentId = createProjectionRootComponentId(
		options.root,
		components,
	);
	if (rootComponentId === null) {
		return null;
	}
	const componentEdges = createProjectionComponentEdges(
		sortedEdges,
		components,
		rootComponentId,
	);
	const componentLayers = createProjectionComponentLayers(
		componentEdges,
		rootComponentId,
		retainRootLayer,
	);
	const componentsWithLayers = createProjectionComponentsWithRenderLayers({
		componentLayers,
		components,
		root: options.root,
	});
	const renderLayerByEnvCellId = createProjectionRenderLayerByEnvCellId({
		componentLayers,
		components,
		componentEdges,
		edges: sortedEdges,
		root: options.root,
		rootComponentId,
	});
	const renderLayers = createProjectionRenderLayers({
		components,
		renderLayerByEnvCellId,
	});

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

	return edges.length > 0 || retainRootLayer
		? {
				adjacency,
				componentEdges,
				components: componentsWithLayers,
				diagnostics,
				edges: sortedEdges,
				incomingEdges,
				kind: "portal-projection",
				landblockId,
				nodes,
				renderLayerByEnvCellId,
				renderLayers,
				root: options.root,
				rootNodeId,
				sourceRevisionKey: createStaticPortalProjectionSourceKey({
					landblockId,
					portalGraphs: options.portalGraphs,
					portalInteriorRecords: options.portalInteriorRecords,
					root: options.root,
					transitionApertureBatches: options.transitionApertureBatches,
				}),
			}
		: null;
}

export function createOutdoorPortalProjectionRoot(
	landblockId: number,
): StaticPortalProjectionRoot {
	const normalizedLandblockId = landblockId >>> 0;
	return {
		kind: "outdoor-root",
		landblockId: normalizedLandblockId,
		rootNodeId: createOutdoorPortalGraphNodeId(normalizedLandblockId),
	};
}

export function createEnvCellPortalProjectionRoot(options: {
	readonly envCellId: number;
	readonly landblockId: number;
}): StaticPortalProjectionRoot {
	const envCellId = options.envCellId >>> 0;
	const landblockId = options.landblockId >>> 0;
	return {
		envCellId,
		kind: "env-cell-root",
		landblockId,
		rootNodeId: createEnvCellPortalGraphNodeId(envCellId),
	};
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

function createKnownEnvCellIds(
	records: readonly StaticPortalInteriorRecord[],
	landblockId: number,
): ReadonlySet<number> {
	const envCellIds = new Set<number>();
	for (const record of records) {
		if (record.landblockId !== landblockId) {
			continue;
		}
		for (const envCell of record.envCells) {
			envCellIds.add(envCell.envCellId >>> 0);
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

function createProjectionNodesAndEdges(options: {
	readonly diagnostics: MutableProjectionDiagnostics;
	readonly envCellPortalApertures: ReadonlyMap<
		number,
		ReadonlyMap<string, PortalAperture>
	>;
	readonly knownEnvCellIds: ReadonlySet<number>;
	readonly landblockId: number;
	readonly outsideVisibleEnvCellIds: ReadonlySet<number>;
	readonly portalGraphs: readonly StaticPortalGraphRecord[];
	readonly root: StaticPortalProjectionRoot;
	readonly rootNodeId: string;
	readonly transitionApertureBatches: readonly TransitionApertureBatch[];
}): {
	readonly edges: StaticPortalProjectionEdge[];
	readonly nodes: readonly {
		readonly envCellId: number;
		readonly nodeId: string;
	}[];
	readonly retainRootLayer: boolean;
} | null {
	const root = options.root;
	switch (root.kind) {
		case "outdoor-root":
			return createOutdoorProjectionNodesAndEdges(options);
		case "env-cell-root":
			return createEnvCellProjectionNodesAndEdges({ ...options, root });
	}
}

function createOutdoorProjectionNodesAndEdges(options: {
	readonly diagnostics: MutableProjectionDiagnostics;
	readonly envCellPortalApertures: ReadonlyMap<
		number,
		ReadonlyMap<string, PortalAperture>
	>;
	readonly landblockId: number;
	readonly outsideVisibleEnvCellIds: ReadonlySet<number>;
	readonly portalGraphs: readonly StaticPortalGraphRecord[];
	readonly rootNodeId: string;
	readonly transitionApertureBatches: readonly TransitionApertureBatch[];
}): {
	readonly edges: StaticPortalProjectionEdge[];
	readonly nodes: readonly {
		readonly envCellId: number;
		readonly nodeId: string;
	}[];
	readonly retainRootLayer: false;
} {
	const nodes = createProjectionNodes(options.outsideVisibleEnvCellIds);
	const edges: StaticPortalProjectionEdge[] = [];
	for (const batch of options.transitionApertureBatches) {
		if (batch.landblockId !== options.landblockId) {
			continue;
		}
		for (const range of batch.ranges) {
			options.diagnostics.transitionRootCandidateCount += 1;
			const targetEnvCellId = createBuildingTransitionTargetEnvCellId(
				batch,
				range,
			);
			if (!options.outsideVisibleEnvCellIds.has(targetEnvCellId)) {
				continue;
			}
			options.diagnostics.acceptedTransitionRootCount += 1;
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
				sourceNodeId: options.rootNodeId,
				targetEnvCellId,
				targetNodeId: createEnvCellPortalGraphNodeId(targetEnvCellId),
			});
		}
	}
	edges.push(
		...createRetainedEnvCellProjectionEdges({
			diagnostics: options.diagnostics,
			envCellPortalApertures: options.envCellPortalApertures,
			includeEnvCellId: (envCellId) =>
				options.outsideVisibleEnvCellIds.has(envCellId),
			landblockId: options.landblockId,
			portalGraphs: options.portalGraphs,
		}),
	);
	return { edges, nodes, retainRootLayer: false };
}

function createEnvCellProjectionNodesAndEdges(options: {
	readonly diagnostics: MutableProjectionDiagnostics;
	readonly envCellPortalApertures: ReadonlyMap<
		number,
		ReadonlyMap<string, PortalAperture>
	>;
	readonly knownEnvCellIds: ReadonlySet<number>;
	readonly landblockId: number;
	readonly portalGraphs: readonly StaticPortalGraphRecord[];
	readonly root: Extract<
		StaticPortalProjectionRoot,
		{ readonly kind: "env-cell-root" }
	>;
}): {
	readonly edges: StaticPortalProjectionEdge[];
	readonly nodes: readonly {
		readonly envCellId: number;
		readonly nodeId: string;
	}[];
	readonly retainRootLayer: true;
} | null {
	const startEnvCellId = options.root.envCellId >>> 0;
	if (!options.knownEnvCellIds.has(startEnvCellId)) {
		return null;
	}
	const retainedEdges = createRetainedEnvCellProjectionEdges({
		diagnostics: options.diagnostics,
		envCellPortalApertures: options.envCellPortalApertures,
		includeEnvCellId: (envCellId) => options.knownEnvCellIds.has(envCellId),
		landblockId: options.landblockId,
		portalGraphs: options.portalGraphs,
	});
	const reachableEnvCellIds = createReachableEnvCellIds({
		edges: retainedEdges,
		startEnvCellId,
	});
	const edges = retainedEdges.filter(
		(edge) =>
			edge.sourceEnvCellId !== null &&
			reachableEnvCellIds.has(edge.sourceEnvCellId) &&
			reachableEnvCellIds.has(edge.targetEnvCellId),
	);
	return {
		edges,
		nodes: createProjectionNodes(reachableEnvCellIds),
		retainRootLayer: true,
	};
}

function createRetainedEnvCellProjectionEdges(options: {
	readonly diagnostics: MutableProjectionDiagnostics;
	readonly envCellPortalApertures: ReadonlyMap<
		number,
		ReadonlyMap<string, PortalAperture>
	>;
	readonly includeEnvCellId: (envCellId: number) => boolean;
	readonly landblockId: number;
	readonly portalGraphs: readonly StaticPortalGraphRecord[];
}): StaticPortalProjectionEdge[] {
	const edges: StaticPortalProjectionEdge[] = [];
	for (const graph of options.portalGraphs) {
		if (graph.landblockId !== options.landblockId) {
			continue;
		}
		for (const edge of graph.edges) {
			if (edge.sceneCrossing?.kind !== "env-cell-to-env-cell") {
				continue;
			}
			const sourceEnvCellId = edge.sceneCrossing.sourceEnvCellId >>> 0;
			const targetEnvCellId = edge.sceneCrossing.targetEnvCellId >>> 0;
			if (!options.includeEnvCellId(sourceEnvCellId)) {
				options.diagnostics.envCellPortalEdgesRejectedSourceNotOutsideVisible += 1;
				continue;
			}
			if (!options.includeEnvCellId(targetEnvCellId)) {
				options.diagnostics.envCellPortalEdgesRejectedTargetNotOutsideVisible += 1;
				continue;
			}
			const aperture = options.envCellPortalApertures.get(sourceEnvCellId)?.get(
				createEnvCellPortalApertureLookupKey({
					portalId:
						edge.provenance.kind === "env-cell-portal"
							? edge.provenance.sourcePortalId
							: "",
					sourceIndex: edge.sourceIndex,
				}),
			);
			if (!aperture || edge.provenance.kind !== "env-cell-portal") {
				options.diagnostics.envCellPortalEdgesRejectedMissingAperture += 1;
				continue;
			}
			options.diagnostics.envCellPortalEdgesRetained += 1;
			edges.push({
				apertureResourceId: createEnvCellPortalApertureRangeId({
					envCellId: sourceEnvCellId,
					landblockId: options.landblockId,
					polygonId: aperture.polygonId,
					portalId: edge.provenance.sourcePortalId,
					sourceIndex: aperture.sourceIndex,
				}),
				apertureSourceId: createEnvCellPortalApertureSourceId({
					envCellId: sourceEnvCellId,
					landblockId: options.landblockId,
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
	return edges;
}

function createReachableEnvCellIds(options: {
	readonly edges: readonly StaticPortalProjectionEdge[];
	readonly startEnvCellId: number;
}): ReadonlySet<number> {
	const outgoingBySource = new Map<number, number[]>();
	for (const edge of options.edges) {
		if (edge.sourceEnvCellId === null) {
			continue;
		}
		const outgoing = outgoingBySource.get(edge.sourceEnvCellId) ?? [];
		outgoing.push(edge.targetEnvCellId);
		outgoingBySource.set(edge.sourceEnvCellId, outgoing);
	}

	const reachableEnvCellIds = new Set<number>([options.startEnvCellId]);
	const queue = [options.startEnvCellId];
	while (queue.length > 0) {
		const sourceEnvCellId = queue.shift();
		if (sourceEnvCellId === undefined) {
			continue;
		}
		for (const targetEnvCellId of outgoingBySource.get(sourceEnvCellId) ?? []) {
			if (reachableEnvCellIds.has(targetEnvCellId)) {
				continue;
			}
			reachableEnvCellIds.add(targetEnvCellId);
			queue.push(targetEnvCellId);
		}
	}
	return reachableEnvCellIds;
}

function createProjectionNodes(
	envCellIds: ReadonlySet<number>,
): readonly { readonly envCellId: number; readonly nodeId: string }[] {
	return [...envCellIds].sort(compareNumbers).map((envCellId) => ({
		envCellId,
		nodeId: createEnvCellPortalGraphNodeId(envCellId),
	}));
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
	edges: readonly StaticPortalProjectionEdge[],
): readonly StaticPortalProjectionAdjacency[] {
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
	edges: readonly StaticPortalProjectionEdge[],
): readonly StaticPortalProjectionIncomingEdges[] {
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
	edges: readonly StaticPortalProjectionEdge[],
): readonly StaticPortalProjectionComponent[] {
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
	const components: StaticPortalProjectionComponent[] = [];

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
	edges: readonly StaticPortalProjectionEdge[],
	components: readonly StaticPortalProjectionComponent[],
	rootComponentId: string,
): readonly StaticPortalProjectionComponentEdge[] {
	const componentIdByEnvCellId = createComponentIdByEnvCellId(components);
	const edgeIdsByComponentEdge = new Map<string, string[]>();
	for (const edge of edges) {
		const sourceComponentId =
			edge.sourceEnvCellId === null
				? rootComponentId
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
	componentEdges: readonly StaticPortalProjectionComponentEdge[],
	rootComponentId: string,
	retainRootLayer: boolean,
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

	const layers = new Map<string, number>([[rootComponentId, 0]]);
	const queue = [rootComponentId];
	while (queue.length > 0) {
		const sourceComponentId = queue.shift();
		if (!sourceComponentId) {
			continue;
		}
		const sourceLayer = layers.get(sourceComponentId) ?? 0;
		for (const targetComponentId of outgoingBySource.get(sourceComponentId) ??
			[]) {
			const targetLayer = sourceLayer + 1;
			if ((layers.get(targetComponentId) ?? -1) >= targetLayer) {
				continue;
			}
			layers.set(targetComponentId, targetLayer);
			queue.push(targetComponentId);
		}
	}
	if (!retainRootLayer) {
		layers.delete(rootComponentId);
	}
	return layers;
}

function createProjectionComponentsWithRenderLayers(options: {
	readonly componentLayers: ReadonlyMap<string, number>;
	readonly components: readonly StaticPortalProjectionComponent[];
	readonly root: StaticPortalProjectionRoot;
}): readonly StaticPortalProjectionComponent[] {
	return options.components.map((component) => ({
		...component,
		renderLayer:
			options.root.kind === "outdoor-root"
				? (options.componentLayers.get(component.componentId) ?? null)
				: null,
	}));
}

function createProjectionRenderLayerByEnvCellId(options: {
	readonly componentEdges: readonly StaticPortalProjectionComponentEdge[];
	readonly componentLayers: ReadonlyMap<string, number>;
	readonly components: readonly StaticPortalProjectionComponent[];
	readonly edges: readonly StaticPortalProjectionEdge[];
	readonly root: StaticPortalProjectionRoot;
	readonly rootComponentId: string;
}): readonly { readonly envCellId: number; readonly renderLayer: number }[] {
	if (options.root.kind === "outdoor-root") {
		return options.components
			.flatMap((component) =>
				options.componentLayers.get(component.componentId) === undefined
					? []
					: component.envCellIds.map((envCellId) => ({
							envCellId,
							renderLayer:
								options.componentLayers.get(component.componentId) ?? 0,
						})),
			)
			.sort(compareProjectionEnvCellLayers);
	}
	return createEnvCellRootRenderLayerByEnvCellId({
		componentEdges: options.componentEdges,
		componentLayers: options.componentLayers,
		components: options.components,
		edges: options.edges,
		root: options.root,
		rootComponentId: options.rootComponentId,
	});
}

function createEnvCellRootRenderLayerByEnvCellId(options: {
	readonly componentEdges: readonly StaticPortalProjectionComponentEdge[];
	readonly componentLayers: ReadonlyMap<string, number>;
	readonly components: readonly StaticPortalProjectionComponent[];
	readonly edges: readonly StaticPortalProjectionEdge[];
	readonly root: Extract<
		StaticPortalProjectionRoot,
		{ readonly kind: "env-cell-root" }
	>;
	readonly rootComponentId: string;
}): readonly { readonly envCellId: number; readonly renderLayer: number }[] {
	const componentIdByEnvCellId = createComponentIdByEnvCellId(
		options.components,
	);
	const rootEnvCellId = options.root.envCellId >>> 0;
	const renderLayerByEnvCellId = new Map<number, number>([[rootEnvCellId, 0]]);
	const rootComponent = options.components.find(
		(component) => component.componentId === options.rootComponentId,
	);
	if (!rootComponent) {
		return [];
	}

	const rootComponentEnvCellIds = new Set(rootComponent.envCellIds);
	const rootInternalEdges = options.edges.filter(
		(edge) =>
			edge.sourceEnvCellId !== null &&
			rootComponentEnvCellIds.has(edge.sourceEnvCellId) &&
			rootComponentEnvCellIds.has(edge.targetEnvCellId),
	);
	relaxEnvCellRootInternalLayers({
		edges: rootInternalEdges,
		renderLayerByEnvCellId,
		rootEnvCellId,
	});
	for (const envCellId of rootComponent.envCellIds) {
		if (envCellId !== rootEnvCellId && !renderLayerByEnvCellId.has(envCellId)) {
			renderLayerByEnvCellId.set(envCellId, 1);
		}
	}

	const layerByComponentId = new Map<string, number>([
		[options.rootComponentId, 0],
	]);
	for (const [envCellId, renderLayer] of renderLayerByEnvCellId) {
		const componentId = componentIdByEnvCellId.get(envCellId);
		if (componentId === options.rootComponentId) {
			layerByComponentId.set(
				options.rootComponentId,
				Math.max(
					layerByComponentId.get(options.rootComponentId) ?? 0,
					renderLayer,
				),
			);
		}
	}

	const componentOrder = [...options.componentLayers.entries()]
		.sort(
			(left, right) => left[1] - right[1] || left[0].localeCompare(right[0]),
		)
		.map(([componentId]) => componentId);
	for (const componentId of componentOrder) {
		if (componentId === options.rootComponentId) {
			continue;
		}
		const incomingEdges = options.componentEdges.filter(
			(edge) =>
				edge.targetComponentId === componentId &&
				edge.sourceComponentId !== edge.targetComponentId,
		);
		let renderLayer = layerByComponentId.get(componentId);
		for (const edge of incomingEdges) {
			const sourceRenderLayer =
				edge.sourceComponentId === options.rootComponentId
					? maxEnvCellRenderLayerForComponent({
							componentId: edge.sourceComponentId,
							componentIdByEnvCellId,
							renderLayerByEnvCellId,
						})
					: layerByComponentId.get(edge.sourceComponentId);
			if (sourceRenderLayer === undefined) {
				continue;
			}
			renderLayer = Math.max(renderLayer ?? -1, sourceRenderLayer + 1);
		}
		if (renderLayer === undefined) {
			continue;
		}
		layerByComponentId.set(componentId, renderLayer);
		for (const component of options.components) {
			if (component.componentId !== componentId) {
				continue;
			}
			for (const envCellId of component.envCellIds) {
				if (envCellId !== rootEnvCellId) {
					renderLayerByEnvCellId.set(envCellId, Math.max(renderLayer, 1));
				}
			}
		}
	}

	return [...renderLayerByEnvCellId.entries()]
		.map(([envCellId, renderLayer]) => ({ envCellId, renderLayer }))
		.sort(compareProjectionEnvCellLayers);
}

function relaxEnvCellRootInternalLayers(options: {
	readonly edges: readonly StaticPortalProjectionEdge[];
	readonly renderLayerByEnvCellId: Map<number, number>;
	readonly rootEnvCellId: number;
}): void {
	let changed = true;
	while (changed) {
		changed = false;
		for (const edge of options.edges) {
			if (edge.sourceEnvCellId === null) {
				continue;
			}
			if (edge.targetEnvCellId === options.rootEnvCellId) {
				continue;
			}
			const sourceLayer = options.renderLayerByEnvCellId.get(
				edge.sourceEnvCellId,
			);
			if (sourceLayer === undefined) {
				continue;
			}
			const existingTargetLayer = options.renderLayerByEnvCellId.get(
				edge.targetEnvCellId,
			);
			if (
				existingTargetLayer !== undefined &&
				existingTargetLayer <= sourceLayer
			) {
				continue;
			}
			const targetLayer = sourceLayer + 1;
			if ((existingTargetLayer ?? -1) >= targetLayer) {
				continue;
			}
			options.renderLayerByEnvCellId.set(edge.targetEnvCellId, targetLayer);
			changed = true;
		}
	}
}

function maxEnvCellRenderLayerForComponent(options: {
	readonly componentId: string;
	readonly componentIdByEnvCellId: ReadonlyMap<number, string>;
	readonly renderLayerByEnvCellId: ReadonlyMap<number, number>;
}): number | undefined {
	let maxRenderLayer: number | undefined;
	for (const [envCellId, renderLayer] of options.renderLayerByEnvCellId) {
		if (options.componentIdByEnvCellId.get(envCellId) !== options.componentId) {
			continue;
		}
		maxRenderLayer = Math.max(maxRenderLayer ?? -1, renderLayer);
	}
	return maxRenderLayer;
}

function createProjectionRenderLayers(options: {
	readonly components: readonly StaticPortalProjectionComponent[];
	readonly renderLayerByEnvCellId: readonly {
		readonly envCellId: number;
		readonly renderLayer: number;
	}[];
}): readonly StaticPortalProjectionRenderLayer[] {
	const componentIdByEnvCellId = createComponentIdByEnvCellId(
		options.components,
	);
	const componentsByLayer = new Map<
		number,
		{ componentIds: Set<string>; envCellIds: number[] }
	>();
	for (const envCellLayer of options.renderLayerByEnvCellId) {
		const layer = componentsByLayer.get(envCellLayer.renderLayer) ?? {
			componentIds: new Set<string>(),
			envCellIds: [],
		};
		const componentId = componentIdByEnvCellId.get(envCellLayer.envCellId);
		if (componentId) {
			layer.componentIds.add(componentId);
		}
		layer.envCellIds.push(envCellLayer.envCellId);
		componentsByLayer.set(envCellLayer.renderLayer, layer);
	}
	return [...componentsByLayer.entries()]
		.sort(([left], [right]) => left - right)
		.map(([renderLayer, layer]) => ({
			componentIds: [...layer.componentIds].sort(),
			envCellIds: layer.envCellIds.sort(compareNumbers),
			renderLayer,
		}));
}

function compareProjectionEnvCellLayers(
	left: { readonly envCellId: number },
	right: { readonly envCellId: number },
): number {
	return left.envCellId - right.envCellId;
}

function createProjectionComponentId(envCellIds: readonly number[]): string {
	return `component:${envCellIds.map((envCellId) => envCellId >>> 0).join(",")}`;
}

function createProjectionRootComponentId(
	root: StaticPortalProjectionRoot,
	components: readonly StaticPortalProjectionComponent[],
): string | null {
	switch (root.kind) {
		case "outdoor-root":
			return "component:outdoor";
		case "env-cell-root":
			return findComponentIdForEnvCell(components, root.envCellId);
	}
}

function createComponentIdByEnvCellId(
	components: readonly StaticPortalProjectionComponent[],
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
	components: readonly StaticPortalProjectionComponent[],
	envCellId: number,
): string | null {
	for (const component of components) {
		if (component.envCellIds.includes(envCellId)) {
			return component.componentId;
		}
	}
	return null;
}

export function createStaticPortalProjectionSourceKey(options: {
	readonly landblockId: number;
	readonly portalGraphs: readonly StaticPortalGraphRecord[];
	readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly root: StaticPortalProjectionRoot;
	readonly transitionApertureBatches: readonly TransitionApertureBatch[];
}): string {
	const rootParts = [
		"root",
		options.root.kind,
		options.root.landblockId >>> 0,
		options.root.rootNodeId,
		options.root.kind === "env-cell-root"
			? options.root.envCellId >>> 0
			: "none",
	].join(":");
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
				["env-cell", envCell.envCellId, envCell.seenOutside ?? "unknown"].join(
					":",
				),
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
	const transitionParts =
		options.root.kind === "outdoor-root"
			? options.transitionApertureBatches
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
					.sort()
			: [];
	return [
		rootParts,
		`landblock:${options.landblockId >>> 0}`,
		...graphParts,
		...interiorParts,
		...transitionParts,
	].join("|");
}

function compareProjectionEdges(
	left: StaticPortalProjectionEdge,
	right: StaticPortalProjectionEdge,
): number {
	return left.edgeId.localeCompare(right.edgeId);
}

function compareNumbers(left: number, right: number): number {
	return left - right;
}
