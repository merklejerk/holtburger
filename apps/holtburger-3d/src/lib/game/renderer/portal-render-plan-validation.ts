import type { PortalCrossingId } from "../scene";
import type { PortalRenderWorkPlan } from "./portal-render-graph";
import { portalViewWindowBounds } from "./portal-view-window";

type PortalRenderNodeId = PortalRenderWorkPlan["nodes"][number]["id"];
type PortalRenderNode = PortalRenderWorkPlan["nodes"][number];
type PortalMaskEdge = PortalRenderWorkPlan["maskEdges"][number];
type PortalRenderLayer = PortalRenderWorkPlan["renderLayers"][number];
type PortalExteriorComponent = NonNullable<
	PortalRenderWorkPlan["exteriorComponent"]
>;

/** Indexed, structurally validated view of one completed planner contract. */
export interface ValidatedPortalRenderWorkPlan {
	readonly edgeById: ReadonlyMap<PortalCrossingId, PortalMaskEdge>;
	readonly exterior: PortalExteriorComponent | null;
	readonly layerByNumber: ReadonlyMap<number, PortalRenderLayer>;
	readonly nodeById: ReadonlyMap<PortalRenderNodeId, PortalRenderNode>;
	readonly plan: PortalRenderWorkPlan;
}

/** Validate planner-owned graph, layer, transition, and exterior-component invariants. */
export function validatePortalRenderWorkPlan(
	plan: PortalRenderWorkPlan,
): ValidatedPortalRenderWorkPlan {
	if (
		plan.capacity.requiredMaximumStencilValue >
		plan.capacity.maximumAvailableStencilValue
	) {
		throw new Error("Portal execution received a failed mask preflight.");
	}
	const nodeById = new Map(plan.nodes.map((node) => [node.id, node]));
	if (nodeById.size !== plan.nodes.length) {
		throw new Error("Portal plan repeats a render-node ID.");
	}
	const root = nodeById.get(plan.rootNodeId);
	if (!root || root.renderLayer !== 0) {
		throw new Error("Portal plan has no layer-zero root node.");
	}
	const edgeById = new Map(
		plan.maskEdges.map((edge) => [edge.crossingId, edge]),
	);
	if (edgeById.size !== plan.maskEdges.length) {
		throw new Error("Portal plan repeats a mask-edge ID.");
	}
	for (const edge of edgeById.values()) {
		if (!nodeById.has(edge.sourceNodeId) || !nodeById.has(edge.targetNodeId)) {
			throw new Error(
				`Portal mask edge ${edge.crossingId} references a missing render node.`,
			);
		}
	}

	const scheduledNodeIds = new Set<PortalRenderNodeId>();
	const layerByNumber = new Map<number, PortalRenderLayer>();
	let previousRenderLayer = -1;
	for (const layer of plan.renderLayers) {
		if (
			!Number.isInteger(layer.renderLayer) ||
			layer.renderLayer <= previousRenderLayer ||
			layer.renderLayer > plan.capacity.requiredMaximumStencilValue
		) {
			throw new Error(
				`Portal render layer ${layer.renderLayer} violates the completed graph order.`,
			);
		}
		previousRenderLayer = layer.renderLayer;
		layerByNumber.set(layer.renderLayer, layer);
		const layerNodeIds = new Set<PortalRenderNodeId>();
		for (const nodeId of layer.renderNodeIds) {
			const node = nodeById.get(nodeId);
			if (!node || node.renderLayer !== layer.renderLayer) {
				throw new Error(
					`Portal layer ${layer.renderLayer} references an incompatible render node ${nodeId}.`,
				);
			}
			if (!layerNodeIds.add(nodeId) || !scheduledNodeIds.add(nodeId)) {
				throw new Error(`Portal render node ${nodeId} is scheduled twice.`);
			}
		}
		if (layerNodeIds.size === 0) {
			throw new Error(`Portal layer ${layer.renderLayer} is empty.`);
		}
		if (
			(layer.renderLayer === 0 &&
				(layerNodeIds.size !== 1 || !layerNodeIds.has(plan.rootNodeId))) ||
			(layer.renderLayer !== 0 && layerNodeIds.has(plan.rootNodeId))
		) {
			throw new Error("Portal root must be the sole layer-zero render node.");
		}
		const layerMaskEdgeIds = new Set<PortalCrossingId>();
		for (const crossingId of layer.incomingMaskEdgeIds) {
			const edge = edgeById.get(crossingId);
			if (!edge || !layerNodeIds.has(edge.targetNodeId)) {
				throw new Error(
					`Portal layer ${layer.renderLayer} references incompatible mask edge ${crossingId}.`,
				);
			}
			if (!layerMaskEdgeIds.add(crossingId)) {
				throw new Error(`Portal mask edge ${crossingId} is scheduled twice.`);
			}
		}
		if (
			(layer.renderLayer === 0 && layerMaskEdgeIds.size !== 0) ||
			(layer.renderLayer !== 0 && layerMaskEdgeIds.size === 0)
		) {
			throw new Error(
				`Portal layer ${layer.renderLayer} has an invalid incoming mask union.`,
			);
		}
	}
	if (scheduledNodeIds.size !== nodeById.size) {
		throw new Error("Portal plan does not schedule every render node once.");
	}
	if (
		Math.max(...plan.nodes.map((node) => node.renderLayer)) !==
		plan.capacity.maximumRenderLayer
	) {
		throw new Error("Portal plan render layers disagree with mask preflight.");
	}

	validateExteriorTransitions(plan, edgeById);
	const exterior = validateExteriorComponent(
		plan,
		nodeById,
		edgeById,
		layerByNumber,
	);
	const exteriorStencilValues =
		exterior?.kind === "masked"
			? [
					exterior.entryStencilValue,
					...(exterior.suffix ? [exterior.suffix.stencilTransition.to] : []),
				]
			: [];
	const expectedRequiredStencilValue = Math.max(
		plan.capacity.maximumRenderLayer,
		...exteriorStencilValues,
	);
	if (
		plan.capacity.requiredMaximumStencilValue !== expectedRequiredStencilValue
	) {
		throw new Error(
			"Portal plan stencil capacity disagrees with execution labels.",
		);
	}
	for (const edge of edgeById.values()) {
		if (edge.maskSource.kind === "near-clip-window") {
			// This is executable mask geometry, not diagnostic metadata. Normalization
			// rejects non-finite, degenerate, or out-of-clip-space fragments here.
			portalViewWindowBounds(edge.maskSource.window);
		}
	}
	return { edgeById, exterior, layerByNumber, nodeById, plan };
}

function validateExteriorComponent(
	plan: PortalRenderWorkPlan,
	nodeById: ReadonlyMap<PortalRenderNodeId, PortalRenderNode>,
	edgeById: ReadonlyMap<PortalCrossingId, PortalMaskEdge>,
	layerByNumber: ReadonlyMap<number, PortalRenderLayer>,
): PortalExteriorComponent | null {
	const outdoorNodes = plan.nodes.filter((node) => node.kind === "outdoor");
	const operation = plan.exteriorComponent;
	if (outdoorNodes.length === 0) {
		if (operation || plan.exteriorTransitions.length > 0) {
			throw new Error("Portal plan has exterior work without an outdoor node.");
		}
		return null;
	}
	if (outdoorNodes.length !== 1 || !operation) {
		throw new Error("Portal plan must describe its unique outdoor component.");
	}
	const outdoor = outdoorNodes[0]!;
	if (
		operation.outdoorNodeId !== outdoor.id ||
		operation.renderLayer !== outdoor.renderLayer
	) {
		throw new Error(
			"Portal exterior operation disagrees with its outdoor node.",
		);
	}
	const componentMembers = new Set(operation.componentNodeIds);
	if (
		componentMembers.size !== operation.componentNodeIds.length ||
		!componentMembers.has(outdoor.id)
	) {
		throw new Error(
			"Portal exterior operation has invalid component membership.",
		);
	}
	const expectedIndoorNodeIds = operation.componentNodeIds.filter(
		(nodeId) => nodeId !== outdoor.id,
	);
	for (const nodeId of expectedIndoorNodeIds) {
		if (nodeById.get(nodeId)?.kind !== "indoor-visibility-island") {
			throw new Error(
				`Portal exterior component member ${nodeId} is not indoor.`,
			);
		}
	}
	if (operation.rootContained !== componentMembers.has(plan.rootNodeId)) {
		throw new Error("Portal exterior operation has incorrect root membership.");
	}
	const entryMaskEdgeIds: PortalCrossingId[] = [];
	const internalIndoorMaskEdgeIds: PortalCrossingId[] = [];
	const returnMaskEdgeIds: PortalCrossingId[] = [];
	for (const edge of edgeById.values()) {
		const sourceIsMember = componentMembers.has(edge.sourceNodeId);
		const targetIsMember = componentMembers.has(edge.targetNodeId);
		if (!sourceIsMember && targetIsMember) {
			entryMaskEdgeIds.push(edge.crossingId);
		} else if (sourceIsMember && targetIsMember) {
			if (edge.targetNodeId === outdoor.id) {
				returnMaskEdgeIds.push(edge.crossingId);
			} else {
				internalIndoorMaskEdgeIds.push(edge.crossingId);
			}
		}
	}
	requireSameIds(operation.entryMaskEdgeIds, entryMaskEdgeIds, "entry masks");
	requireSameIds(
		operation.returnMaskEdgeIds,
		returnMaskEdgeIds,
		"return masks",
	);
	const layer = layerByNumber.get(operation.renderLayer);
	if (!layer) throw new Error("Portal exterior operation has no render layer.");
	const mainExteriorMemberIds = operation.rootContained
		? new Set<PortalRenderNodeId>([outdoor.id])
		: componentMembers;
	const sharesLayer = layer.renderNodeIds.some(
		(nodeId) => !mainExteriorMemberIds.has(nodeId),
	);
	const expectedStencilValue = sharesLayer
		? plan.capacity.maximumRenderLayer + 1
		: operation.renderLayer;
	const expectSuffix =
		!operation.rootContained && expectedIndoorNodeIds.length > 0;
	const expectedEntryStencilValue = expectSuffix
		? plan.capacity.maximumRenderLayer + 1
		: expectedStencilValue;
	if (operation.renderLayer === 0) {
		if (operation.kind !== "unmasked" || operation.suffix !== null) {
			throw new Error(
				"Portal unmasked exterior root has ceremonially unused stencil state.",
			);
		}
		return operation;
	}
	if (operation.kind !== "masked") {
		throw new Error(
			"Portal masked exterior operation has no entry stencil label.",
		);
	}
	if (
		!Number.isInteger(operation.entryStencilValue) ||
		operation.entryStencilValue <= 0 ||
		operation.entryStencilValue > plan.capacity.maximumAvailableStencilValue ||
		operation.entryStencilValue !== expectedEntryStencilValue
	) {
		throw new Error(
			"Portal exterior operation has an incorrect entry stencil label.",
		);
	}
	if (expectSuffix !== (operation.suffix !== null)) {
		throw new Error(
			"Portal exterior operation disagrees with its deferred indoor suffix.",
		);
	}
	const { suffix } = operation;
	if (!suffix) return operation;
	requireSameIds(
		suffix.indoorNodeIds,
		expectedIndoorNodeIds,
		"suffix indoor nodes",
	);
	requireSameIds(suffix.maskEdgeIds, internalIndoorMaskEdgeIds, "suffix masks");
	const { from, to } = suffix.stencilTransition;
	if (
		suffix.stencilTransition.kind !== "promote-if-equal" ||
		!Number.isInteger(from) ||
		!Number.isInteger(to) ||
		from !== operation.entryStencilValue ||
		to !== from + 1 ||
		to > plan.capacity.maximumAvailableStencilValue
	) {
		throw new Error(
			"Portal exterior operation has an incorrect suffix stencil transition.",
		);
	}
	return operation;
}

function validateExteriorTransitions(
	plan: PortalRenderWorkPlan,
	edgeById: ReadonlyMap<PortalCrossingId, PortalMaskEdge>,
): void {
	const transitionById = new Map(
		plan.exteriorTransitions.map((transition) => [
			transition.crossingId,
			transition,
		]),
	);
	if (transitionById.size !== plan.exteriorTransitions.length) {
		throw new Error("Portal plan repeats an exterior transition.");
	}
	for (const edge of edgeById.values()) {
		const transition = transitionById.get(edge.crossingId);
		if (edge.spatialRelationship.kind !== "exterior-transition") {
			if (transition) {
				throw new Error(
					`Portal transition ${edge.crossingId} names an indoor edge.`,
				);
			}
			continue;
		}
		if (
			!transition ||
			transition.sourceNodeId !== edge.sourceNodeId ||
			transition.targetNodeId !== edge.targetNodeId ||
			transition.exteriorLandblockId !==
				edge.spatialRelationship.exteriorLandblockId
		) {
			throw new Error(
				`Portal exterior transition ${edge.crossingId} disagrees with its mask edge.`,
			);
		}
	}
	if (
		plan.exteriorTransitions.some(
			(transition) => !edgeById.has(transition.crossingId),
		)
	) {
		throw new Error("Portal exterior transition has no mask edge.");
	}
}

function requireSameIds(
	actual: readonly string[],
	expected: readonly string[],
	label: string,
): void {
	const sortedActual = [...actual].sort();
	const sortedExpected = [...expected].sort();
	if (
		sortedActual.length !== sortedExpected.length ||
		sortedActual.some((value, index) => value !== sortedExpected[index])
	) {
		throw new Error(`Portal exterior operation has incorrect ${label}.`);
	}
}
