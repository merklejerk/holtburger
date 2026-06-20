import type {
	LandblockPortalLinkFacts,
	StaticPortalGraphEdge,
	StaticPortalGraphNode,
	StaticPortalGraphRecord,
	StaticPortalGraphScene,
	StaticPortalInteriorRecord,
	StaticWorkPeerRecordOwner,
	TransitionApertureBatch,
} from "./contracts";

export function createEnvCellStaticPortalGraph(
	owner: StaticWorkPeerRecordOwner,
	record: StaticPortalInteriorRecord,
): StaticPortalGraphRecord {
	const nodes = record.envCells
		.map((envCell): StaticPortalGraphNode => ({
			nodeId: createEnvCellPortalGraphNodeId(envCell.envCellId),
			scene: {
				envCellId: envCell.envCellId,
				kind: "env-cell",
			},
		}))
		.sort(comparePortalGraphNodes);
	const edges = record.portalLinks
		.map((link) => createEnvCellPortalGraphEdge(link))
		.filter((edge): edge is StaticPortalGraphEdge => edge !== null)
		.sort(comparePortalGraphEdges);

	return {
		edges,
		kind: "static-portal-graph",
		landblockId: record.landblockId,
		nodes,
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
		for (const linkedEnvCellId of range.source.linkedEnvCellIds) {
			const envCellId = linkedEnvCellId >>> 0;
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
					linkedEnvCellId: envCellId,
					portalId: range.portalId,
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
	}

	return {
		edges: edges.sort(comparePortalGraphEdges),
		kind: "static-portal-graph",
		landblockId: batch.landblockId,
		nodes: [...nodesById.values()].sort(comparePortalGraphNodes),
		owner,
	};
}

function createEnvCellPortalGraphEdge(
	link: LandblockPortalLinkFacts,
): StaticPortalGraphEdge | null {
	if (link.source.kind !== "env-cell" || link.target.kind !== "env-cell") {
		return null;
	}

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
			targetEnvCellId: link.target.envCellId,
			targetPortalId: link.target.portalId,
		},
		sceneCrossing: {
			kind: "env-cell-to-env-cell",
			sourceEnvCellId: link.source.envCellId,
			targetEnvCellId: link.target.envCellId,
		},
		sourceIndex: link.sourceIndex,
		sourceNodeId: createEnvCellPortalGraphNodeId(link.source.envCellId),
		targetNodeId: createEnvCellPortalGraphNodeId(link.target.envCellId),
	};
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
				nodeId: `outdoor:${scene.landblockId >>> 0}`,
				scene,
			};
	}
}

function createEnvCellPortalGraphNodeId(envCellId: number): string {
	return `env-cell:${envCellId >>> 0}`;
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
