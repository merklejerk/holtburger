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
import { createBuildingTransitionTargetEnvCellId } from "./portal-aperture-resources";

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
