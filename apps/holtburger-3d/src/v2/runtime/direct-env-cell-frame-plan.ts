import type {
	PortalApertureVertex,
	PortalFrameEdgePlan,
	PortalFrameGraphPlan,
	PortalFrameNodeId,
	PortalFrameNodePlan,
	PortalFrameNodeResources,
	PortalFrameSceneSource,
	PortalFrameWorkPlan,
	RendererEnvCellResourceMembership,
} from "../renderer/types";
import type {
	StaticPortalInteriorRecord,
	TransitionApertureBatch,
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
import { createOutdoorLandblockRootTranslation } from "./static-placement";

type PortalAperture =
	StaticPortalInteriorRecord["envCells"][number]["portalApertures"][number];

export interface DirectEnvCellFramePlanInput {
	readonly currentCameraResidency: StaticSceneCameraResidency;
	readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly renderAnchorLandblockId: number | null;
	readonly rendererEnvCellResourceMembership: readonly RendererEnvCellResourceMembership[];
	readonly traversalPlan: PortalTraversalPlan;
}

export interface OutdoorTransitionPortalFramePlanInput {
	readonly landblockId: number;
	readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly renderAnchorLandblockId: number | null;
	readonly rendererEnvCellResourceMembership: readonly RendererEnvCellResourceMembership[];
	readonly transitionApertureBatches: readonly TransitionApertureBatch[];
	readonly traversalPlansByStartEnvCellId: ReadonlyMap<
		number,
		PortalTraversalPlan
	>;
}

interface PortalFrameIndexes {
	readonly membershipByLandblock: ReadonlyMap<
		number,
		ReadonlyMap<number, RendererEnvCellResourceMembership>
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
		readonly vertices: readonly PortalApertureVertex[];
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
			vertices: input.vertices,
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
			nodes: this.#nodes.map((node): PortalFrameNodePlan => ({
				...node,
				incomingEdgeIds: [...node.incomingEdgeIds],
			})),
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

	const indexes = createPortalFrameIndexes(input);
	const graphBuilder = new PortalFrameGraphBuilder();
	const nodeIdByTraversalStack = new Map<string, PortalFrameNodeId>();
	let baseNodeId: PortalFrameNodeId | null = null;

	for (const viewGroup of input.traversalPlan.portalViewGroups) {
		const parentNodeId =
			viewGroup.parentPortalStackId === null
				? null
				: (nodeIdByTraversalStack.get(viewGroup.parentPortalStackId) ?? null);
		if (viewGroup.parentPortalStackId !== null && parentNodeId === null) {
			continue;
		}
		const scene: PortalFrameSceneSource = {
			envCellId: viewGroup.envCellId,
			kind: "env-cell-direct",
			landblockId: viewGroup.landblockId,
		};
		const nodeId = graphBuilder.addNode({
			debugStackLabel: viewGroup.portalStackId,
			parentNodeId,
			resources: createNodeResources(scene, indexes),
			scene,
			traversalDepth: viewGroup.traversalDepth,
		});
		nodeIdByTraversalStack.set(viewGroup.portalStackId, nodeId);
		if (viewGroup.parentPortalStackId === null && baseNodeId === null) {
			baseNodeId = nodeId;
		}
		if (parentNodeId !== null) {
			addEnvCellPortalEdges({
				graphBuilder,
				indexes,
				parentNodeId,
				renderAnchorLandblockId: input.renderAnchorLandblockId,
				targetNodeId: nodeId,
				viewGroup,
			});
		}
	}

	if (baseNodeId === null) {
		return null;
	}

	return {
		graph: graphBuilder.build({
			baseNodeId,
			transitionRootCandidateCount: 0,
			transitionRootCount: 0,
			transitionRootsRejectedNotSeenOutside: 0,
			transitionRootsRejectedUnknownSeenOutside: 0,
		}),
		kind: "direct-env-cell",
		mode: "portal-traversal",
	};
}

export function createOutdoorTransitionPortalFramePlan(
	input: OutdoorTransitionPortalFramePlanInput,
): PortalFrameWorkPlan | null {
	const renderableBatches = input.transitionApertureBatches.filter(
		(batch) =>
			batch.landblockId === input.landblockId &&
			batch.frontFace === "indoor-visible" &&
			batch.indices.length > 0 &&
			batch.ranges.length > 0,
	);
	if (renderableBatches.length === 0) {
		return null;
	}

	const transitionRootCandidates =
		createOutdoorTransitionRootGroups(renderableBatches);
	if (transitionRootCandidates.length === 0) {
		return null;
	}
	const indexes = createPortalFrameIndexes(input);
	const outdoorVisibleEnvCellIds = createOutdoorVisibleEnvCellIds(
		input.portalInteriorRecords,
		input.landblockId,
	);
	const seenOutsideByEnvCellId = createOutdoorEnvCellSeenOutsideById(
		input.portalInteriorRecords,
		input.landblockId,
	);
	const transitionRootSelection = selectOutdoorVisibleTransitionRoots({
		outdoorVisibleEnvCellIds,
		seenOutsideByEnvCellId,
		transitionRootCandidates,
	});
	const transitionRoots = transitionRootSelection.acceptedRoots;
	const graphBuilder = new PortalFrameGraphBuilder();
	const outdoorScene: PortalFrameSceneSource = {
		kind: "outdoor-target",
		landblockId: input.landblockId,
	};
	const baseNodeId = graphBuilder.addNode({
		debugStackLabel: createOutdoorRootPortalStackLabel(input.landblockId),
		parentNodeId: null,
		resources: createNodeResources(outdoorScene, indexes),
		scene: outdoorScene,
		traversalDepth: 0,
	});

	for (const root of transitionRoots) {
		const transitionRootLabel = createOutdoorTransitionPortalStackLabel({
			envCellId: root.envCellId,
			landblockId: input.landblockId,
		});
		const rootScene: PortalFrameSceneSource = {
			envCellId: root.envCellId,
			kind: "env-cell-direct",
			landblockId: input.landblockId,
		};
		const rootNodeId = graphBuilder.addNode({
			debugStackLabel: transitionRootLabel,
			parentNodeId: baseNodeId,
			resources: createNodeResources(rootScene, indexes),
			scene: rootScene,
			traversalDepth: 1,
		});

		for (const range of root.ranges) {
			const vertices = triangulateTransitionApertureRange(
				range.batch,
				range.range,
				createOutdoorLandblockRootTranslation(
					input.landblockId,
					input.renderAnchorLandblockId,
				),
			);
			graphBuilder.addEdge({
				apertureSourceId: createBuildingTransitionApertureSourceId({
					apertureBatchId: range.batch.apertureBatchId,
					portalId: range.range.portalId,
					rangeFirstIndex: range.range.firstIndex,
					rangeIndexCount: range.range.indexCount,
				}),
				apertureResourceId: createBuildingTransitionApertureResourceId({
					apertureBatchId: range.batch.apertureBatchId,
					portalId: range.range.portalId,
					rangeFirstIndex: range.range.firstIndex,
					rangeIndexCount: range.range.indexCount,
				}),
				childNodeId: rootNodeId,
				duplicateKeyParts: [
					range.batch.apertureBatchId,
					range.range.portalId,
					range.range.firstIndex,
					range.range.indexCount,
				],
				linkId: createOutdoorTransitionLinkId({
					apertureBatchId: range.batch.apertureBatchId,
					envCellId: root.envCellId,
					portalId: range.range.portalId,
				}),
				parentNodeId: baseNodeId,
				sourceKind: "building-transition",
				vertices,
			});
		}

		const traversalPlan = input.traversalPlansByStartEnvCellId.get(
			root.envCellId,
		);
		if (!traversalPlan) {
			continue;
		}
		appendTransitionRootTraversal({
			graphBuilder,
			indexes,
			outdoorVisibleEnvCellIds,
			renderAnchorLandblockId: input.renderAnchorLandblockId,
			rootNodeId,
			transitionRootLabel,
			traversalPlan,
		});
	}

	const graph = graphBuilder.build({
		baseNodeId,
		transitionRootCandidateCount: transitionRootCandidates.length,
		transitionRootCount: transitionRoots.length,
		transitionRootsRejectedNotSeenOutside:
			transitionRootSelection.rejectedNotSeenOutside,
		transitionRootsRejectedUnknownSeenOutside:
			transitionRootSelection.rejectedUnknownSeenOutside,
	});
	if (
		graph.edges.length === 0 &&
		transitionRootSelection.rejectedNotSeenOutside === 0 &&
		transitionRootSelection.rejectedUnknownSeenOutside === 0
	) {
		return null;
	}

	return {
		graph,
		kind: "direct-env-cell",
		mode: "portal-traversal",
	};
}

export function createOutdoorVisibleEnvCellIds(
	portalInteriorRecords: readonly StaticPortalInteriorRecord[],
	landblockId: number,
): ReadonlySet<number> {
	const envCellIds = new Set<number>();
	for (const [envCellId, seenOutside] of createOutdoorEnvCellSeenOutsideById(
		portalInteriorRecords,
		landblockId,
	)) {
		if (seenOutside === true) {
			envCellIds.add(envCellId);
		}
	}
	return envCellIds;
}

function createPortalFrameIndexes(input: {
	readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly rendererEnvCellResourceMembership: readonly RendererEnvCellResourceMembership[];
}): PortalFrameIndexes {
	const membershipByLandblock = new Map<
		number,
		Map<number, RendererEnvCellResourceMembership>
	>();
	for (const membership of input.rendererEnvCellResourceMembership) {
		getOrCreateNestedMap(
			membershipByLandblock,
			membership.landblockId,
		).set(membership.envCellId, membership);
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

function addEnvCellPortalEdges(options: {
	readonly graphBuilder: PortalFrameGraphBuilder;
	readonly indexes: PortalFrameIndexes;
	readonly parentNodeId: PortalFrameNodeId;
	readonly renderAnchorLandblockId: number | null;
	readonly targetNodeId: PortalFrameNodeId;
	readonly viewGroup: PortalTraversalPlan["portalViewGroups"][number];
}): void {
	for (const edge of options.viewGroup.apertureEdges) {
		const sourceEnvCell = options.indexes.portalEnvCellsByLandblock
			.get(options.viewGroup.landblockId)
			?.get(edge.sourceEnvCellId);
		const aperture = sourceEnvCell?.aperturesByPortalId.get(
			edge.sourcePortalId,
		);
		if (!sourceEnvCell || !aperture) {
			continue;
		}
		const vertices = triangulateEnvCellPortalAperture(
			aperture.points,
			sourceEnvCell.placementMatrix,
			createOutdoorLandblockRootTranslation(
				options.viewGroup.landblockId,
				options.renderAnchorLandblockId,
			),
		);
		options.graphBuilder.addEdge({
			apertureResourceId: createEnvCellPortalApertureResourceId({
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
			childNodeId: options.targetNodeId,
			duplicateKeyParts: [
				edge.sourceEnvCellId,
				edge.targetEnvCellId,
				edge.sourcePortalId,
				edge.targetPortalId,
			],
			linkId: edge.linkId,
			parentNodeId: options.parentNodeId,
			sourceKind: "env-cell-portal",
			vertices,
		});
	}
}

function appendTransitionRootTraversal(options: {
	readonly graphBuilder: PortalFrameGraphBuilder;
	readonly indexes: PortalFrameIndexes;
	readonly outdoorVisibleEnvCellIds: ReadonlySet<number>;
	readonly renderAnchorLandblockId: number | null;
	readonly rootNodeId: PortalFrameNodeId;
	readonly transitionRootLabel: string;
	readonly traversalPlan: PortalTraversalPlan;
}): void {
	const nodeIdByTraversalStack = new Map<string, PortalFrameNodeId>([
		[createRootPortalStackLabel(options.traversalPlan.startEnvCellId), options.rootNodeId],
	]);

	for (const viewGroup of options.traversalPlan.portalViewGroups) {
		if (!options.outdoorVisibleEnvCellIds.has(viewGroup.envCellId >>> 0)) {
			continue;
		}
		if (viewGroup.parentPortalStackId === null) {
			nodeIdByTraversalStack.set(viewGroup.portalStackId, options.rootNodeId);
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
			debugStackLabel: createOutdoorTransitionChildDebugStackLabel({
				sourceRootEnvCellId: options.traversalPlan.startEnvCellId,
				transitionRootLabel: options.transitionRootLabel,
				traversalStackLabel: viewGroup.portalStackId,
			}),
			parentNodeId,
			resources: createNodeResources(scene, options.indexes),
			scene,
			traversalDepth: viewGroup.traversalDepth + 1,
		});
		nodeIdByTraversalStack.set(viewGroup.portalStackId, nodeId);
		addEnvCellPortalEdges({
			graphBuilder: options.graphBuilder,
			indexes: options.indexes,
			parentNodeId,
			renderAnchorLandblockId: options.renderAnchorLandblockId,
			targetNodeId: nodeId,
			viewGroup,
		});
	}
}

function createOutdoorEnvCellSeenOutsideById(
	portalInteriorRecords: readonly StaticPortalInteriorRecord[],
	landblockId: number,
): ReadonlyMap<number, boolean | null> {
	const seenOutsideByEnvCellId = new Map<number, boolean | null>();
	for (const record of portalInteriorRecords) {
		if (record.landblockId !== landblockId) {
			continue;
		}
		for (const envCell of record.envCells) {
			const envCellId = envCell.envCellId >>> 0;
			const existing = seenOutsideByEnvCellId.get(envCellId);
			if (existing === true) {
				continue;
			}
			if (envCell.seenOutside === true || existing === undefined) {
				seenOutsideByEnvCellId.set(envCellId, envCell.seenOutside);
				continue;
			}
			if (envCell.seenOutside === false && existing === null) {
				seenOutsideByEnvCellId.set(envCellId, false);
			}
		}
	}
	return seenOutsideByEnvCellId;
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

function createOutdoorTransitionPortalStackLabel(options: {
	readonly envCellId: number;
	readonly landblockId: number;
}): string {
	return `${createOutdoorRootPortalStackLabel(options.landblockId)}/transition:${formatHex32(options.envCellId)}`;
}

function createOutdoorTransitionChildDebugStackLabel(options: {
	readonly sourceRootEnvCellId: number;
	readonly transitionRootLabel: string;
	readonly traversalStackLabel: string;
}): string {
	const rootPrefix = createRootPortalStackLabel(options.sourceRootEnvCellId);
	if (options.traversalStackLabel === rootPrefix) {
		return options.transitionRootLabel;
	}
	if (!options.traversalStackLabel.startsWith(`${rootPrefix}/`)) {
		throw new Error(
			`Traversal portal stack ${options.traversalStackLabel} does not start at ${rootPrefix}.`,
		);
	}
	return `${options.transitionRootLabel}/${options.traversalStackLabel.slice(rootPrefix.length + 1)}`;
}

function triangulateEnvCellPortalAperture(
	points: PortalAperture["points"],
	matrix: Float32Array,
	translation: readonly [number, number, number],
): readonly PortalApertureVertex[] {
	if (points.length < 3) {
		return [];
	}
	const vertices: PortalApertureVertex[] = [];
	for (let index = 1; index < points.length - 1; index += 1) {
		vertices.push(
			transformEnvCellPortalPoint(points[0], matrix, translation),
			transformEnvCellPortalPoint(points[index], matrix, translation),
			transformEnvCellPortalPoint(points[index + 1], matrix, translation),
		);
	}
	return vertices;
}

function triangulateTransitionApertureRange(
	batch: TransitionApertureBatch,
	range: TransitionApertureBatch["ranges"][number],
	translation: readonly [number, number, number],
): readonly PortalApertureVertex[] {
	const vertices: PortalApertureVertex[] = [];
	for (let indexOffset = 0; indexOffset < range.indexCount; indexOffset += 1) {
		const vertexIndex = batch.indices[range.firstIndex + indexOffset];
		const vertex =
			vertexIndex === undefined ? null : batch.vertices[vertexIndex];
		if (!vertex) {
			throw new Error(
				`Transition aperture range ${range.portalId} references missing vertex ${vertexIndex}.`,
			);
		}
		vertices.push([
			vertex.x + translation[0],
			vertex.y + translation[1],
			vertex.z + translation[2],
		]);
	}
	return vertices;
}

function transformEnvCellPortalPoint(
	point: PortalAperture["points"][number],
	matrix: Float32Array,
	translation: readonly [number, number, number],
): PortalApertureVertex {
	return [
		matrix[0] * point.x +
			matrix[4] * point.y +
			matrix[8] * point.z +
			matrix[12] +
			translation[0],
		matrix[1] * point.x +
			matrix[5] * point.y +
			matrix[9] * point.z +
			matrix[13] +
			translation[1],
		matrix[2] * point.x +
			matrix[6] * point.y +
			matrix[10] * point.z +
			matrix[14] +
			translation[2],
	];
}

interface OutdoorTransitionRootGroup {
	readonly envCellId: number;
	readonly ranges: readonly OutdoorTransitionRangeRef[];
}

interface OutdoorTransitionRootSelection {
	readonly acceptedRoots: readonly OutdoorTransitionRootGroup[];
	readonly rejectedNotSeenOutside: number;
	readonly rejectedUnknownSeenOutside: number;
}

interface OutdoorTransitionRangeRef {
	readonly batch: TransitionApertureBatch;
	readonly range: TransitionApertureBatch["ranges"][number];
}

function createOutdoorTransitionRootGroups(
	batches: readonly TransitionApertureBatch[],
): readonly OutdoorTransitionRootGroup[] {
	const rangesByEnvCellId = new Map<number, OutdoorTransitionRangeRef[]>();
	for (const batch of batches) {
		for (const range of batch.ranges) {
			for (const linkedEnvCellId of range.source.linkedEnvCellIds) {
				const envCellId = linkedEnvCellId >>> 0;
				const ranges = rangesByEnvCellId.get(envCellId) ?? [];
				ranges.push({ batch, range });
				rangesByEnvCellId.set(envCellId, ranges);
			}
		}
	}
	return [...rangesByEnvCellId.entries()]
		.sort(([leftEnvCellId], [rightEnvCellId]) => leftEnvCellId - rightEnvCellId)
		.map(([envCellId, ranges]) => ({
			envCellId,
			ranges: [...ranges].sort(compareOutdoorTransitionRangeRefs),
		}));
}

function selectOutdoorVisibleTransitionRoots(options: {
	readonly outdoorVisibleEnvCellIds: ReadonlySet<number>;
	readonly seenOutsideByEnvCellId: ReadonlyMap<number, boolean | null>;
	readonly transitionRootCandidates: readonly OutdoorTransitionRootGroup[];
}): OutdoorTransitionRootSelection {
	const acceptedRoots: OutdoorTransitionRootGroup[] = [];
	let rejectedNotSeenOutside = 0;
	let rejectedUnknownSeenOutside = 0;

	for (const root of options.transitionRootCandidates) {
		if (options.outdoorVisibleEnvCellIds.has(root.envCellId)) {
			acceptedRoots.push(root);
			continue;
		}
		if (options.seenOutsideByEnvCellId.get(root.envCellId) === false) {
			rejectedNotSeenOutside += 1;
		} else {
			rejectedUnknownSeenOutside += 1;
		}
	}

	return {
		acceptedRoots,
		rejectedNotSeenOutside,
		rejectedUnknownSeenOutside,
	};
}

function compareOutdoorTransitionRangeRefs(
	left: OutdoorTransitionRangeRef,
	right: OutdoorTransitionRangeRef,
): number {
	return (
		left.batch.apertureBatchId.localeCompare(right.batch.apertureBatchId) ||
		left.range.firstIndex - right.range.firstIndex ||
		left.range.portalId.localeCompare(right.range.portalId)
	);
}

function createOutdoorTransitionLinkId(options: {
	readonly apertureBatchId: string;
	readonly envCellId: number;
	readonly portalId: string;
}): string {
	return [
		"transition",
		options.apertureBatchId,
		options.portalId,
		formatHex32(options.envCellId),
	].join(":");
}

function createBuildingTransitionApertureSourceId(options: {
	readonly apertureBatchId: string;
	readonly portalId: string;
	readonly rangeFirstIndex: number;
	readonly rangeIndexCount: number;
}): string {
	return [
		"building-transition",
		options.apertureBatchId,
		options.portalId,
		options.rangeFirstIndex,
		options.rangeIndexCount,
	].join(":");
}

function createBuildingTransitionApertureResourceId(options: {
	readonly apertureBatchId: string;
	readonly portalId: string;
	readonly rangeFirstIndex: number;
	readonly rangeIndexCount: number;
}): string {
	return [
		"portal-aperture",
		"building-transition",
		options.apertureBatchId,
		options.portalId,
		options.rangeFirstIndex,
		options.rangeIndexCount,
	].join(":");
}

function createEnvCellPortalApertureSourceId(options: {
	readonly envCellId: number;
	readonly landblockId: number;
	readonly polygonId: number | null;
	readonly portalId: string;
	readonly sourceIndex: number;
}): string {
	return [
		"env-cell-portal",
		formatHex32(options.landblockId),
		formatHex32(options.envCellId),
		options.portalId,
		options.sourceIndex,
		options.polygonId ?? "none",
	].join(":");
}

function createEnvCellPortalApertureResourceId(options: {
	readonly envCellId: number;
	readonly landblockId: number;
	readonly polygonId: number | null;
	readonly portalId: string;
	readonly sourceIndex: number;
}): string {
	return [
		"portal-aperture",
		"env-cell-portal",
		formatHex32(options.landblockId),
		formatHex32(options.envCellId),
		options.portalId,
		options.sourceIndex,
		options.polygonId ?? "none",
	].join(":");
}
