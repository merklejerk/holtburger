import type {
	PortalFrameEdgePlan,
	PortalFrameGraphPlan,
	PortalFrameNodeId,
	PortalFrameNodePlan,
	PortalFrameNodeResources,
	PortalFrameSceneSource,
	PortalFrameWorkPlan,
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
import {
	createBuildingTransitionApertureRangeId,
	createBuildingTransitionApertureSourceId,
	createEnvCellPortalApertureRangeId,
	createEnvCellPortalApertureSourceId,
} from "../static/portal-aperture-resources";
import type { EnvCellResourceMembership } from "./env-cell-resource-membership";

type PortalAperture =
	StaticPortalInteriorRecord["envCells"][number]["portalApertures"][number];

export interface DirectEnvCellFramePlanInput {
	readonly currentCameraResidency: StaticSceneCameraResidency;
	readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly renderAnchorLandblockId: number | null;
	readonly envCellResourceMembership: readonly EnvCellResourceMembership[];
	readonly traversalPlan: PortalTraversalPlan;
}

export interface OutdoorTransitionPortalFramePlanInput {
	readonly landblockId: number;
	readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly renderAnchorLandblockId: number | null;
	readonly envCellResourceMembership: readonly EnvCellResourceMembership[];
	readonly transitionApertureBatches: readonly TransitionApertureBatch[];
	readonly traversalPlansByStartEnvCellId: ReadonlyMap<
		number,
		PortalTraversalPlan
	>;
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
	const outdoorScene: PortalFrameSceneSource = {
		kind: "outdoor-target",
		landblockId: input.landblockId,
	};
	const graphPlan = createDirectPortalFramePlan({
		baseNode: {
			debugStackLabel: createOutdoorRootPortalStackLabel(input.landblockId),
			scene: outdoorScene,
			traversalDepth: 0,
		},
		diagnostics: {
			transitionRootCandidateCount: transitionRootCandidates.length,
			transitionRootCount: transitionRoots.length,
			transitionRootsRejectedNotSeenOutside:
				transitionRootSelection.rejectedNotSeenOutside,
			transitionRootsRejectedUnknownSeenOutside:
				transitionRootSelection.rejectedUnknownSeenOutside,
		},
		envCellResourceMembership: input.envCellResourceMembership,
		portalInteriorRecords: input.portalInteriorRecords,
		traversalSources: transitionRoots.map((root): DirectPortalTraversalSource => {
			const transitionRootLabel = createOutdoorTransitionPortalStackLabel({
				envCellId: root.envCellId,
				landblockId: input.landblockId,
			});
			return {
				allowedEnvCellIds: outdoorVisibleEnvCellIds,
				createDebugStackLabel: (traversalStackLabel) =>
					createOutdoorTransitionChildDebugStackLabel({
						sourceRootEnvCellId: root.envCellId,
						transitionRootLabel,
						traversalStackLabel,
					}),
				parentlessViewGroupMode: "root-node",
				root: {
					entryEdges: root.ranges.map((range) =>
						createOutdoorTransitionEdgeCandidate(root.envCellId, range),
					),
					kind: "child-node",
					node: {
						debugStackLabel: transitionRootLabel,
						scene: {
							envCellId: root.envCellId,
							kind: "env-cell-direct",
							landblockId: input.landblockId,
						},
						traversalDepth: 1,
					},
				},
				traversalDepthOffset: 1,
				traversalPlan: input.traversalPlansByStartEnvCellId.get(root.envCellId) ?? {
					diagnostics: [],
					landblockId: input.landblockId,
					maxCells: 0,
					maxDepth: 0,
					maxPortalViews: 0,
					portalViewGroups: [],
					sceneCrossings: [],
					startEnvCellId: root.envCellId,
					visibleCells: [],
				},
			};
		}),
	});
	if (!graphPlan) {
		return null;
	}
	const graph = graphPlan.graph;
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

function createDirectPortalFramePlan(
	input: DirectPortalGraphBuildInput,
): Extract<PortalFrameWorkPlan, { readonly kind: "direct-env-cell" }> | null {
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
	readonly root: Extract<DirectPortalTraversalRoot, { readonly kind: "child-node" }>;
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

function createOutdoorTransitionEdgeCandidate(
	envCellId: number,
	range: OutdoorTransitionRangeRef,
): DirectPortalEdgeCandidate {
	return {
		apertureSourceId: createBuildingTransitionApertureSourceId({
			apertureBatchId: range.batch.apertureBatchId,
			portalId: range.range.portalId,
			rangeFirstIndex: range.range.firstIndex,
			rangeIndexCount: range.range.indexCount,
		}),
		apertureResourceId: createBuildingTransitionApertureRangeId({
			apertureBatchId: range.batch.apertureBatchId,
			portalId: range.range.portalId,
			rangeFirstIndex: range.range.firstIndex,
			rangeIndexCount: range.range.indexCount,
		}),
		duplicateKeyParts: [
			range.batch.apertureBatchId,
			range.range.portalId,
			range.range.firstIndex,
			range.range.indexCount,
		],
		linkId: createOutdoorTransitionLinkId({
			apertureBatchId: range.batch.apertureBatchId,
			envCellId,
			portalId: range.range.portalId,
		}),
		sourceKind: "building-transition",
	};
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
