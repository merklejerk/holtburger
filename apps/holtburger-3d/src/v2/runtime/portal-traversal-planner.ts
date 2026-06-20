import type {
	LandblockPortalLinkFacts,
	PortalEndpointIdentity,
	StaticPortalGraphRecord,
	StaticPortalInteriorRecord,
} from "../static/contracts";

export interface PortalTraversalRequest {
	readonly landblockId: number;
	readonly maxCells: number;
	readonly maxDepth: number;
	readonly maxPortalViews: number;
	readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly startEnvCellId: number;
}

export interface PortalTraversalPlan {
	readonly diagnostics: readonly PortalTraversalDiagnostic[];
	readonly landblockId: number;
	readonly maxCells: number;
	readonly maxDepth: number;
	readonly maxPortalViews: number;
	readonly portalViewGroups: readonly PortalTraversalViewGroup[];
	readonly sceneCrossings: readonly PortalTraversalSceneCrossing[];
	readonly startEnvCellId: number;
	readonly visibleCells: readonly PortalTraversalVisibleCell[];
}

export interface PortalTraversalVisibleCell {
	readonly envCellId: number;
	readonly landblockId: number;
	readonly parentEdge: PortalTraversalEnvCellEdge | null;
	readonly portalStack: readonly PortalTraversalEnvCellEdge[];
	readonly portalStackId: string;
	readonly traversalDepth: number;
}

export interface PortalTraversalViewGroup {
	readonly apertureEdges: readonly PortalTraversalEnvCellEdge[];
	readonly envCellId: number;
	readonly landblockId: number;
	readonly parentPortalStackId: string | null;
	readonly portalStack: readonly PortalTraversalEnvCellEdge[];
	readonly portalStackId: string;
	readonly traversalDepth: number;
}

export interface PortalTraversalEnvCellEdge {
	readonly flags: number;
	readonly linkId: string;
	readonly polygonId: number | null;
	readonly sourceEnvCellId: number;
	readonly sourceIndex: number;
	readonly sourcePortalId: string;
	readonly targetEnvCellId: number;
	readonly targetPortalId: string;
}

export interface PortalTraversalSceneCrossing {
	readonly flags: number;
	readonly linkId: string;
	readonly polygonId: number | null;
	readonly sourceEnvCellId: number;
	readonly sourceIndex: number;
	readonly sourcePortalId: string;
	readonly target: PortalTraversalSceneCrossingTarget;
}

export type PortalTraversalSceneCrossingTarget = Exclude<
	PortalEndpointIdentity,
	{ readonly kind: "env-cell" }
>;

export type PortalTraversalDiagnostic =
	| {
			readonly kind: "missing-start-cell";
			readonly envCellId: number;
			readonly landblockId: number;
	  }
	| {
			readonly kind: "depth-limit";
			readonly edge: PortalTraversalEnvCellEdge;
			readonly maxDepth: number;
			readonly requestedDepth: number;
	  }
	| {
			readonly kind: "cell-cap";
			readonly edge: PortalTraversalEnvCellEdge;
			readonly maxCells: number;
	  }
	| {
			readonly kind: "portal-view-cap";
			readonly edge: PortalTraversalEnvCellEdge;
			readonly maxPortalViews: number;
	  }
	| {
			readonly kind: "already-visible";
			readonly edge: PortalTraversalEnvCellEdge;
			readonly existingTraversalDepth: number;
	  }
	| {
			readonly kind: "missing-target-cell";
			readonly edge: PortalTraversalEnvCellEdge;
	  }
	| {
			readonly kind: "scene-crossing-not-bridged";
			readonly crossing: PortalTraversalSceneCrossing;
	  };

export interface PortalTraversalGraph {
	readonly envCellIds: ReadonlySet<number>;
	readonly outgoingEnvCellEdgesBySource: ReadonlyMap<
		number,
		readonly PortalTraversalEnvCellEdge[]
	>;
	readonly outgoingSceneCrossingsBySource: ReadonlyMap<
		number,
		readonly PortalTraversalSceneCrossing[]
	>;
}

export function createPortalTraversalPlan(
	request: PortalTraversalRequest,
): PortalTraversalPlan {
	const landblockId = request.landblockId >>> 0;
	const graph = createPortalTraversalGraph({
		landblockId,
		portalInteriorRecords: request.portalInteriorRecords,
	});
	return createPortalTraversalPlanFromGraph({
		graph,
		landblockId,
		maxCells: request.maxCells,
		maxDepth: request.maxDepth,
		maxPortalViews: request.maxPortalViews,
		startEnvCellId: request.startEnvCellId,
	});
}

export function createPortalTraversalPlanFromGraph(request: {
	readonly graph: PortalTraversalGraph;
	readonly landblockId: number;
	readonly maxCells: number;
	readonly maxDepth: number;
	readonly maxPortalViews: number;
	readonly startEnvCellId: number;
}): PortalTraversalPlan {
	const maxDepth = normalizeNonNegativeInteger(request.maxDepth, "maxDepth");
	const maxCells = normalizePositiveInteger(request.maxCells, "maxCells");
	const maxPortalViews = normalizePositiveInteger(
		request.maxPortalViews,
		"maxPortalViews",
	);
	const landblockId = request.landblockId >>> 0;
	const startEnvCellId = request.startEnvCellId >>> 0;
	const graph = request.graph;
	const diagnostics: PortalTraversalDiagnostic[] = [];
	const sceneCrossings: PortalTraversalSceneCrossing[] = [];
	if (!graph.envCellIds.has(startEnvCellId)) {
		diagnostics.push({
			envCellId: startEnvCellId,
			kind: "missing-start-cell",
			landblockId,
		});
		return {
			diagnostics,
			landblockId,
			maxCells,
			maxDepth,
			maxPortalViews,
			portalViewGroups: [],
			sceneCrossings,
			startEnvCellId,
			visibleCells: [],
		};
	}

	const rootCell: PortalTraversalVisibleCell = {
		envCellId: startEnvCellId,
		landblockId,
		parentEdge: null,
		portalStack: [],
		portalStackId: createRootPortalStackId(startEnvCellId),
		traversalDepth: 0,
	};
	const rootViewGroup: PortalTraversalViewGroup = {
		apertureEdges: [],
		envCellId: startEnvCellId,
		landblockId,
		parentPortalStackId: null,
		portalStack: [],
		portalStackId: rootCell.portalStackId,
		traversalDepth: 0,
	};
	const visibleCells: PortalTraversalVisibleCell[] = [rootCell];
	const visibleCellsByEnvCellId = new Map<number, PortalTraversalVisibleCell>([
		[startEnvCellId, rootCell],
	]);
	const portalViewGroups: PortalTraversalViewGroup[] = [rootViewGroup];
	const queue: PortalTraversalViewGroup[] = [rootViewGroup];

	for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
		const cell = queue[queueIndex]!;
		for (const crossing of graph.outgoingSceneCrossingsBySource.get(
			cell.envCellId,
		) ?? []) {
			sceneCrossings.push(crossing);
			diagnostics.push({
				crossing,
				kind: "scene-crossing-not-bridged",
			});
		}

		for (const edge of graph.outgoingEnvCellEdgesBySource.get(cell.envCellId) ??
			[]) {
			const requestedDepth = cell.traversalDepth + 1;
			if (requestedDepth > maxDepth) {
				diagnostics.push({
					edge,
					kind: "depth-limit",
					maxDepth,
					requestedDepth,
				});
				continue;
			}
			if (!graph.envCellIds.has(edge.targetEnvCellId)) {
				diagnostics.push({
					edge,
					kind: "missing-target-cell",
				});
				continue;
			}
			const existingPathCell = findPortalStackEnvCellDepth(
				cell,
				edge.targetEnvCellId,
			);
			if (existingPathCell !== null) {
				diagnostics.push({
					edge,
					existingTraversalDepth: existingPathCell,
					kind: "already-visible",
				});
				continue;
			}
			const existingCell = visibleCellsByEnvCellId.get(edge.targetEnvCellId);
			if (!existingCell && visibleCells.length >= maxCells) {
				diagnostics.push({
					edge,
					kind: "cell-cap",
					maxCells,
				});
				continue;
			}
			const portalStack = [...cell.portalStack, edge];
			const portalStackId = createPortalStackId(startEnvCellId, portalStack);
			const existingViewGroup = portalViewGroups.find(
				(viewGroup) =>
					viewGroup.parentPortalStackId === cell.portalStackId &&
					viewGroup.envCellId === edge.targetEnvCellId &&
					viewGroup.traversalDepth === requestedDepth,
			);
			if (existingViewGroup) {
				replacePortalViewGroup(
					portalViewGroups,
					queue,
					existingViewGroup,
					[...existingViewGroup.apertureEdges, edge],
				);
				continue;
			}
			if (portalViewGroups.length >= maxPortalViews) {
				diagnostics.push({
					edge,
					kind: "portal-view-cap",
					maxPortalViews,
				});
				continue;
			}

			const nextViewGroup: PortalTraversalViewGroup = {
				apertureEdges: [edge],
				envCellId: edge.targetEnvCellId,
				landblockId,
				parentPortalStackId: cell.portalStackId,
				portalStack,
				portalStackId,
				traversalDepth: requestedDepth,
			};
			if (!existingCell) {
				const nextCell: PortalTraversalVisibleCell = {
					envCellId: edge.targetEnvCellId,
					landblockId,
					parentEdge: edge,
					portalStack,
					portalStackId,
					traversalDepth: requestedDepth,
				};
				visibleCells.push(nextCell);
				visibleCellsByEnvCellId.set(nextCell.envCellId, nextCell);
			}
			portalViewGroups.push(nextViewGroup);
			queue.push(nextViewGroup);
		}
	}

	return {
		diagnostics,
		landblockId,
		maxCells,
		maxDepth,
		maxPortalViews,
		portalViewGroups,
		sceneCrossings,
		startEnvCellId,
		visibleCells,
	};
}

function findPortalStackEnvCellDepth(
	viewGroup: PortalTraversalViewGroup,
	envCellId: number,
): number | null {
	if (viewGroup.envCellId === envCellId) {
		return viewGroup.traversalDepth;
	}
	const firstEdge = viewGroup.portalStack[0];
	if (firstEdge?.sourceEnvCellId === envCellId) {
		return 0;
	}
	for (const [index, edge] of viewGroup.portalStack.entries()) {
		if (edge.targetEnvCellId === envCellId) {
			return index + 1;
		}
	}
	return null;
}

function replacePortalViewGroup(
	portalViewGroups: PortalTraversalViewGroup[],
	queue: PortalTraversalViewGroup[],
	existingViewGroup: PortalTraversalViewGroup,
	apertureEdges: readonly PortalTraversalEnvCellEdge[],
): void {
	const replacement = { ...existingViewGroup, apertureEdges };
	const groupIndex = portalViewGroups.indexOf(existingViewGroup);
	if (groupIndex >= 0) {
		portalViewGroups[groupIndex] = replacement;
	}
	const queueIndex = queue.indexOf(existingViewGroup);
	if (queueIndex >= 0) {
		queue[queueIndex] = replacement;
	}
}

export function createPortalTraversalGraph(options: {
	readonly landblockId: number;
	readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
}): PortalTraversalGraph {
	const landblockId = options.landblockId >>> 0;
	const envCellIds = new Set<number>();
	const outgoingEnvCellEdgesBySource = new Map<
		number,
		PortalTraversalEnvCellEdge[]
	>();
	const outgoingSceneCrossingsBySource = new Map<
		number,
		PortalTraversalSceneCrossing[]
	>();

	for (const record of options.portalInteriorRecords) {
		if (record.landblockId !== landblockId) {
			continue;
		}
		for (const envCell of record.envCells) {
			envCellIds.add(envCell.envCellId >>> 0);
		}
		for (const link of record.portalLinks) {
			const source = link.source;
			const target = link.target;
			if (source.kind !== "env-cell") {
				continue;
			}
			if (target.kind === "env-cell") {
				appendMapValue(
					outgoingEnvCellEdgesBySource,
					source.envCellId >>> 0,
					createEnvCellEdge(link, source, target),
				);
				continue;
			}
			appendMapValue(
				outgoingSceneCrossingsBySource,
				source.envCellId >>> 0,
				createSceneCrossing(link, source, target),
			);
		}
	}

	return {
		envCellIds,
		outgoingEnvCellEdgesBySource: sortMapValues(
			outgoingEnvCellEdgesBySource,
			compareEnvCellEdges,
		),
		outgoingSceneCrossingsBySource: sortMapValues(
			outgoingSceneCrossingsBySource,
			compareSceneCrossings,
		),
	};
}

export function createPortalTraversalGraphFromStaticPortalGraphs(options: {
	readonly landblockId: number;
	readonly portalGraphs: readonly StaticPortalGraphRecord[];
}): PortalTraversalGraph {
	const landblockId = options.landblockId >>> 0;
	const envCellIds = new Set<number>();
	const outgoingEnvCellEdgesBySource = new Map<
		number,
		PortalTraversalEnvCellEdge[]
	>();
	const outgoingSceneCrossingsBySource = new Map<
		number,
		PortalTraversalSceneCrossing[]
	>();

	for (const graph of options.portalGraphs) {
		if (graph.landblockId !== landblockId) {
			continue;
		}
		const nodesById = new Map(graph.nodes.map((node) => [node.nodeId, node]));
		for (const node of graph.nodes) {
			if (node.scene.kind === "env-cell") {
				envCellIds.add(node.scene.envCellId >>> 0);
			}
		}
		for (const edge of graph.edges) {
			const sourceNode = nodesById.get(edge.sourceNodeId);
			if (
				!sourceNode ||
				sourceNode.scene.kind !== "env-cell" ||
				edge.provenance.kind !== "env-cell-portal"
			) {
				continue;
			}
			const sourceEnvCellId = sourceNode.scene.envCellId >>> 0;
			const target = edge.provenance.target;
			if (target.kind === "env-cell") {
				appendMapValue(outgoingEnvCellEdgesBySource, sourceEnvCellId, {
					flags: edge.flags,
					linkId: edge.linkId,
					polygonId: edge.polygonId,
					sourceEnvCellId,
					sourceIndex: edge.sourceIndex,
					sourcePortalId: edge.provenance.sourcePortalId,
					targetEnvCellId: target.envCellId >>> 0,
					targetPortalId: target.portalId,
				});
				continue;
			}
			appendMapValue(outgoingSceneCrossingsBySource, sourceEnvCellId, {
				flags: edge.flags,
				linkId: edge.linkId,
				polygonId: edge.polygonId,
				sourceEnvCellId,
				sourceIndex: edge.sourceIndex,
				sourcePortalId: edge.provenance.sourcePortalId,
				target,
			});
		}
	}

	return {
		envCellIds,
		outgoingEnvCellEdgesBySource: sortMapValues(
			outgoingEnvCellEdgesBySource,
			compareEnvCellEdges,
		),
		outgoingSceneCrossingsBySource: sortMapValues(
			outgoingSceneCrossingsBySource,
			compareSceneCrossings,
		),
	};
}

function createEnvCellEdge(
	link: LandblockPortalLinkFacts,
	source: Extract<PortalEndpointIdentity, { readonly kind: "env-cell" }>,
	target: Extract<PortalEndpointIdentity, { readonly kind: "env-cell" }>,
): PortalTraversalEnvCellEdge {
	return {
		flags: link.flags,
		linkId: link.linkId,
		polygonId: link.polygonId,
		sourceEnvCellId: source.envCellId >>> 0,
		sourceIndex: link.sourceIndex,
		sourcePortalId: source.portalId,
		targetEnvCellId: target.envCellId >>> 0,
		targetPortalId: target.portalId,
	};
}

function createSceneCrossing(
	link: LandblockPortalLinkFacts,
	source: Extract<PortalEndpointIdentity, { readonly kind: "env-cell" }>,
	target: PortalTraversalSceneCrossingTarget,
): PortalTraversalSceneCrossing {
	return {
		flags: link.flags,
		linkId: link.linkId,
		polygonId: link.polygonId,
		sourceEnvCellId: source.envCellId >>> 0,
		sourceIndex: link.sourceIndex,
		sourcePortalId: source.portalId,
		target,
	};
}

function createRootPortalStackId(startEnvCellId: number): string {
	return `root:${formatHex32(startEnvCellId)}`;
}

function createPortalStackId(
	startEnvCellId: number,
	portalStack: readonly PortalTraversalEnvCellEdge[],
): string {
	return [
		createRootPortalStackId(startEnvCellId),
		...portalStack.map((edge) => edge.linkId),
	].join("/");
}

function normalizeNonNegativeInteger(value: number, name: string): number {
	const normalized = Math.trunc(value);
	if (!Number.isFinite(value) || normalized < 0) {
		throw new Error(`${name} must be a non-negative finite integer.`);
	}
	return normalized;
}

function normalizePositiveInteger(value: number, name: string): number {
	const normalized = Math.trunc(value);
	if (!Number.isFinite(value) || normalized < 1) {
		throw new Error(`${name} must be a positive finite integer.`);
	}
	return normalized;
}

function appendMapValue<TKey, TValue>(
	map: Map<TKey, TValue[]>,
	key: TKey,
	value: TValue,
): void {
	const values = map.get(key) ?? [];
	values.push(value);
	map.set(key, values);
}

function sortMapValues<TKey, TValue>(
	map: ReadonlyMap<TKey, readonly TValue[]>,
	compare: (left: TValue, right: TValue) => number,
): ReadonlyMap<TKey, readonly TValue[]> {
	return new Map(
		[...map.entries()].map(([key, values]) => [key, [...values].sort(compare)]),
	);
}

function compareEnvCellEdges(
	left: PortalTraversalEnvCellEdge,
	right: PortalTraversalEnvCellEdge,
): number {
	return (
		left.sourceIndex - right.sourceIndex ||
		left.linkId.localeCompare(right.linkId) ||
		left.targetEnvCellId - right.targetEnvCellId ||
		left.sourcePortalId.localeCompare(right.sourcePortalId) ||
		left.targetPortalId.localeCompare(right.targetPortalId)
	);
}

function compareSceneCrossings(
	left: PortalTraversalSceneCrossing,
	right: PortalTraversalSceneCrossing,
): number {
	return (
		left.sourceIndex - right.sourceIndex ||
		left.linkId.localeCompare(right.linkId) ||
		left.sourcePortalId.localeCompare(right.sourcePortalId) ||
		describeSceneCrossingTarget(left.target).localeCompare(
			describeSceneCrossingTarget(right.target),
		)
	);
}

function describeSceneCrossingTarget(
	target: PortalTraversalSceneCrossingTarget,
): string {
	if (target.kind === "outside") {
		return `outside:${formatHex32(target.landblockId)}`;
	}
	return `landblock-building:${target.instanceId}:${target.portalId}`;
}

function formatHex32(value: number): string {
	return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}
