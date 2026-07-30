import type { PortalCrossingId } from "../scene";
import type { PortalRenderWorkPlan } from "./portal-render-graph";
import { portalViewWindowBounds } from "./portal-view-window";

type PortalRenderNodeId = PortalRenderWorkPlan["nodes"][number]["id"];
type PortalRenderNode = PortalRenderWorkPlan["nodes"][number];
type PortalMaskEdge = PortalRenderWorkPlan["maskEdges"][number];
type PortalRenderLayer = PortalRenderWorkPlan["renderLayers"][number];
type PortalRenderContribution = PortalRenderLayer["contributions"][number];
type PortalExteriorContribution = Extract<
	PortalRenderContribution,
	{ readonly kind: "exterior" }
>;

/** Indexed, structurally validated view of one completed planner contract. */
export interface ValidatedPortalRenderWorkPlan {
	readonly edgeById: ReadonlyMap<PortalCrossingId, PortalMaskEdge>;
	readonly exterior: PortalExteriorContribution | null;
	readonly layerByNumber: ReadonlyMap<number, PortalRenderLayer>;
	readonly nodeById: ReadonlyMap<PortalRenderNodeId, PortalRenderNode>;
	readonly plan: PortalRenderWorkPlan;
}

/** Validate planner-owned graph, contribution, transition, and exterior-component invariants. */
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
		if (edge.maskSource.kind === "near-clip-window") {
			portalViewWindowBounds(edge.maskSource.window);
		}
	}

	const ordinaryNodeIds = new Set<PortalRenderNodeId>();
	const usedMaskEdgeIds = new Set<PortalCrossingId>();
	const layerByNumber = new Map<number, PortalRenderLayer>();
	let exterior: PortalExteriorContribution | null = null;
	let previousRenderLayer = -1;
	for (const layer of plan.renderLayers) {
		if (
			!Number.isInteger(layer.renderLayer) ||
			layer.renderLayer <= previousRenderLayer ||
			layer.renderLayer > plan.capacity.maximumRenderLayer
		) {
			throw new Error(
				`Portal render layer ${layer.renderLayer} violates the completed graph order.`,
			);
		}
		if (layer.contributions.length === 0) {
			throw new Error(`Portal render layer ${layer.renderLayer} is empty.`);
		}
		previousRenderLayer = layer.renderLayer;
		layerByNumber.set(layer.renderLayer, layer);
		const stencilValues = new Set<number>();
		for (const contribution of layer.contributions) {
			if ("renderLayer" in contribution) {
				if (contribution.renderLayer !== layer.renderLayer) {
					throw new Error(
						`Portal exterior contribution disagrees with layer ${layer.renderLayer}.`,
					);
				}
			}
			validateContributionMasks(
				contribution.maskEdgeIds,
				contribution.kind === "indoor"
					? new Set(contribution.renderNodeIds)
					: new Set(contribution.componentNodeIds),
				layer.renderLayer,
				edgeById,
				usedMaskEdgeIds,
			);
			if (
				!Number.isInteger(contribution.stencilValue) ||
				contribution.stencilValue < 0 ||
				contribution.stencilValue >
					plan.capacity.maximumAvailableStencilValue ||
				(layer.renderLayer === 0) !== (contribution.stencilValue === 0)
			) {
				throw new Error(
					`Portal layer ${layer.renderLayer} contribution has an invalid stencil value.`,
				);
			}
			if (
				layer.renderLayer !== 0 &&
				!stencilValues.add(contribution.stencilValue)
			) {
				throw new Error(
					`Portal layer ${layer.renderLayer} contribution labels are not isolated.`,
				);
			}
			if (contribution.kind === "exterior") {
				if (exterior) {
					throw new Error("Portal plan schedules exterior more than once.");
				}
				exterior = contribution;
				continue;
			}
			if (
				contribution.renderNodeIds.length === 0 ||
				new Set(contribution.renderNodeIds).size !==
					contribution.renderNodeIds.length
			) {
				throw new Error(
					`Portal layer ${layer.renderLayer} has invalid indoor membership.`,
				);
			}
			for (const nodeId of contribution.renderNodeIds) {
				const node = nodeById.get(nodeId);
				if (
					!node ||
					node.kind !== "indoor-visibility-island" ||
					node.renderLayer !== layer.renderLayer
				) {
					throw new Error(
						`Portal layer ${layer.renderLayer} references incompatible indoor node ${nodeId}.`,
					);
				}
				if (!ordinaryNodeIds.add(nodeId)) {
					throw new Error(
						`Portal render node ${nodeId} has repeated ordinary submissions.`,
					);
				}
			}
		}
	}
	const layerZero = layerByNumber.get(0);
	if (!layerZero || layerZero.contributions.length !== 1) {
		throw new Error("Portal root must be the sole layer-zero contribution.");
	}
	const rootContribution = layerZero.contributions[0]!;
	if (
		(rootContribution.kind === "indoor" &&
			(rootContribution.renderNodeIds.length !== 1 ||
				rootContribution.renderNodeIds[0] !== plan.rootNodeId)) ||
		(rootContribution.kind === "exterior" &&
			rootContribution.outdoorNodeId !== plan.rootNodeId)
	) {
		throw new Error("Portal layer-zero contribution does not own the root.");
	}

	validateExteriorTransitions(plan, edgeById);
	validateExteriorContribution(
		plan,
		exterior,
		nodeById,
		edgeById,
		layerByNumber,
		ordinaryNodeIds,
		usedMaskEdgeIds,
	);
	validateNodeSubmissionCoverage(plan, exterior, ordinaryNodeIds);
	validateMaskConsumption(edgeById, nodeById, usedMaskEdgeIds);
	const stencilValues = plan.renderLayers.flatMap((layer) =>
		layer.contributions.flatMap((contribution) => [
			contribution.stencilValue,
			...(contribution.kind === "exterior" && contribution.suffix
				? [contribution.suffix.stencilTransition.to]
				: []),
		]),
	);
	const expectedRequiredStencilValue = Math.max(
		plan.capacity.maximumRenderLayer,
		...stencilValues,
	);
	if (
		plan.capacity.requiredMaximumStencilValue !== expectedRequiredStencilValue
	) {
		throw new Error(
			"Portal plan stencil capacity disagrees with execution labels.",
		);
	}
	if (
		Math.max(...plan.nodes.map((node) => node.renderLayer)) !==
		plan.capacity.maximumRenderLayer
	) {
		throw new Error("Portal plan render layers disagree with mask preflight.");
	}
	return { edgeById, exterior, layerByNumber, nodeById, plan };
}

function validateContributionMasks(
	maskEdgeIds: readonly PortalCrossingId[],
	targetNodeIds: ReadonlySet<PortalRenderNodeId>,
	renderLayer: number,
	edgeById: ReadonlyMap<PortalCrossingId, PortalMaskEdge>,
	usedMaskEdgeIds: Set<PortalCrossingId>,
): void {
	if (
		new Set(maskEdgeIds).size !== maskEdgeIds.length ||
		(renderLayer === 0) !== (maskEdgeIds.length === 0)
	) {
		throw new Error(
			`Portal layer ${renderLayer} contribution has an invalid mask union.`,
		);
	}
	for (const crossingId of maskEdgeIds) {
		const edge = edgeById.get(crossingId);
		if (!edge || !targetNodeIds.has(edge.targetNodeId)) {
			throw new Error(
				`Portal layer ${renderLayer} references incompatible mask edge ${crossingId}.`,
			);
		}
		if (!usedMaskEdgeIds.add(crossingId)) {
			throw new Error(`Portal mask edge ${crossingId} is consumed twice.`);
		}
	}
}

function validateExteriorContribution(
	plan: PortalRenderWorkPlan,
	exterior: PortalExteriorContribution | null,
	nodeById: ReadonlyMap<PortalRenderNodeId, PortalRenderNode>,
	edgeById: ReadonlyMap<PortalCrossingId, PortalMaskEdge>,
	layerByNumber: ReadonlyMap<number, PortalRenderLayer>,
	ordinaryNodeIds: ReadonlySet<PortalRenderNodeId>,
	usedMaskEdgeIds: Set<PortalCrossingId>,
): void {
	const outdoorNodes = plan.nodes.filter((node) => node.kind === "outdoor");
	if (outdoorNodes.length === 0) {
		if (exterior || plan.exteriorTransitions.length > 0) {
			throw new Error("Portal plan has exterior work without an outdoor node.");
		}
		return;
	}
	if (outdoorNodes.length !== 1 || !exterior) {
		throw new Error("Portal plan must schedule its unique outdoor node.");
	}
	const outdoor = outdoorNodes[0]!;
	if (
		exterior.outdoorNodeId !== outdoor.id ||
		exterior.renderLayer !== outdoor.renderLayer
	) {
		throw new Error(
			"Portal exterior contribution disagrees with its outdoor node.",
		);
	}
	const componentMembers = new Set(exterior.componentNodeIds);
	if (
		componentMembers.size !== exterior.componentNodeIds.length ||
		!componentMembers.has(outdoor.id)
	) {
		throw new Error(
			"Portal exterior contribution has invalid component membership.",
		);
	}
	const expectedIndoorNodeIds = exterior.componentNodeIds.filter(
		(nodeId) => nodeId !== outdoor.id,
	);
	for (const nodeId of expectedIndoorNodeIds) {
		if (nodeById.get(nodeId)?.kind !== "indoor-visibility-island") {
			throw new Error(
				`Portal exterior component member ${nodeId} is not indoor.`,
			);
		}
	}
	if (exterior.rootContained !== componentMembers.has(plan.rootNodeId)) {
		throw new Error(
			"Portal exterior contribution has incorrect root membership.",
		);
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
	requireSameIds(exterior.entryMaskEdgeIds, entryMaskEdgeIds, "entry masks");
	requireSameIds(exterior.returnMaskEdgeIds, returnMaskEdgeIds, "return masks");
	const outdoorIsRoot = exterior.outdoorNodeId === plan.rootNodeId;
	requireSameIds(
		exterior.maskEdgeIds,
		outdoorIsRoot
			? []
			: exterior.rootContained
				? returnMaskEdgeIds
				: entryMaskEdgeIds,
		"execution masks",
	);
	const expectSuffix = expectedIndoorNodeIds.length > 0 && !outdoorIsRoot;
	if (expectSuffix !== (exterior.suffix !== null)) {
		throw new Error(
			"Portal exterior contribution disagrees with its indoor suffix.",
		);
	}
	if (exterior.renderLayer === 0) {
		if (
			exterior.stencilValue !== 0 ||
			exterior.maskEdgeIds.length !== 0 ||
			exterior.suffix
		) {
			throw new Error("Portal outdoor root has ceremonial masked state.");
		}
		return;
	}
	const layer = layerByNumber.get(exterior.renderLayer);
	if (!layer)
		throw new Error("Portal exterior contribution has no render layer.");
	const sharesLayer = layer.contributions.length > 1;
	const expectedStencilValue =
		expectSuffix || sharesLayer
			? plan.capacity.maximumRenderLayer + 1
			: exterior.renderLayer;
	if (exterior.stencilValue !== expectedStencilValue) {
		throw new Error(
			"Portal exterior contribution has an incorrect stencil label.",
		);
	}
	if (!exterior.suffix) return;
	requireSameIds(
		exterior.suffix.maskEdgeIds,
		internalIndoorMaskEdgeIds,
		"suffix masks",
	);
	for (const crossingId of exterior.suffix.maskEdgeIds) {
		if (!usedMaskEdgeIds.add(crossingId)) {
			throw new Error(`Portal suffix mask ${crossingId} is consumed twice.`);
		}
	}
	const submittedSuffixNodeIds = new Set<PortalRenderNodeId>();
	for (const submission of exterior.suffix.submissions) {
		if (
			submission.renderNodeIds.length === 0 ||
			new Set(submission.renderNodeIds).size !== submission.renderNodeIds.length
		) {
			throw new Error(
				"Portal exterior suffix has invalid submission membership.",
			);
		}
		for (const nodeId of submission.renderNodeIds) {
			if (!submittedSuffixNodeIds.add(nodeId)) {
				throw new Error(`Portal suffix node ${nodeId} is submitted twice.`);
			}
			const ordinary = ordinaryNodeIds.has(nodeId);
			if (
				(submission.kind === "additional" && !ordinary) ||
				(submission.kind === "deferred" && ordinary)
			) {
				throw new Error(
					`Portal suffix ${submission.kind} node ${nodeId} disagrees with ordinary scheduling.`,
				);
			}
			const node = nodeById.get(nodeId);
			if (
				!node ||
				(submission.kind === "additional"
					? node.renderLayer >= exterior.renderLayer
					: node.renderLayer < exterior.renderLayer)
			) {
				throw new Error(
					`Portal suffix ${submission.kind} node ${nodeId} has an incompatible graph layer.`,
				);
			}
		}
	}
	requireSameIds(
		[...submittedSuffixNodeIds],
		expectedIndoorNodeIds,
		"suffix indoor nodes",
	);
	const { from, to } = exterior.suffix.stencilTransition;
	if (
		exterior.suffix.stencilTransition.kind !== "promote-if-equal" ||
		from !== exterior.stencilValue ||
		to !== from + 1 ||
		to > plan.capacity.maximumAvailableStencilValue
	) {
		throw new Error(
			"Portal exterior contribution has an incorrect suffix stencil transition.",
		);
	}
}

function validateNodeSubmissionCoverage(
	plan: PortalRenderWorkPlan,
	exterior: PortalExteriorContribution | null,
	ordinaryNodeIds: ReadonlySet<PortalRenderNodeId>,
): void {
	const suffixNodeIds = new Set(
		exterior?.suffix?.submissions.flatMap(
			(submission) => submission.renderNodeIds,
		) ?? [],
	);
	for (const node of plan.nodes) {
		if (node.kind === "outdoor") continue;
		if (!ordinaryNodeIds.has(node.id) && !suffixNodeIds.has(node.id)) {
			throw new Error(`Portal render node ${node.id} is never submitted.`);
		}
	}
}

function validateMaskConsumption(
	edgeById: ReadonlyMap<PortalCrossingId, PortalMaskEdge>,
	nodeById: ReadonlyMap<PortalRenderNodeId, PortalRenderNode>,
	usedMaskEdgeIds: ReadonlySet<PortalCrossingId>,
): void {
	for (const edge of edgeById.values()) {
		if (usedMaskEdgeIds.has(edge.crossingId)) continue;
		const source = nodeById.get(edge.sourceNodeId)!;
		const target = nodeById.get(edge.targetNodeId)!;
		if (target.renderLayer > source.renderLayer) {
			throw new Error(
				`Portal forward mask edge ${edge.crossingId} has no execution consumer.`,
			);
		}
	}
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
		throw new Error(`Portal exterior contribution has incorrect ${label}.`);
	}
}
