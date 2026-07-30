import { describe, expect, it } from "vitest";
import type { PortalCrossingId } from "../scene";
import type { PortalRenderWorkPlan } from "./portal-render-graph";
import { createFullPortalViewWindow } from "./portal-view-window";
import type { ResolvedPortalMask } from "./webgl2-portal-mask";
import {
	executePortalGraph,
	type PortalExecutionSubstrate,
} from "./webgl2-portal-executor";
import type { WebGL2SceneDomainTarget } from "./webgl2-portal-substrate";

const EXTENT = { height: 8, width: 8 } as const;
const IDENTITY = new Float32Array([
	1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);
const ROOT = "portal-render-node:root" as const;
const LEFT = "portal-render-node:left" as const;
const RIGHT = "portal-render-node:right" as const;
const TARGET = "portal-render-node:target" as const;
const OUTDOOR = "portal-render-node:outdoor" as const;
const SUFFIX = "portal-render-node:suffix" as const;
const SIBLING = "portal-render-node:sibling" as const;

type MaskedExteriorComponent = Extract<
	NonNullable<PortalRenderWorkPlan["exteriorComponent"]>,
	{ readonly kind: "masked" }
>;

describe("portal graph execution", () => {
	it("renders an outdoor root directly without masks, initialization, or copies", () => {
		const substrate = new RecordingSubstrate();

		const diagnostics = executePortalGraph(substrate, {
			clearColor: [0, 0, 0, 1],
			destination: null,
			extent: EXTENT,
			plan: outdoorRootPlan(),
			renderExterior: () => substrate.calls.push("render:exterior"),
			renderIndoorNodes: () => {
				throw new Error("Outdoor root must not submit indoor work.");
			},
			resolveVisibilityAperture: () => {
				throw new Error("Outdoor root must not resolve masks.");
			},
		});

		expect(substrate.calls).toEqual([
			"resize",
			"clear",
			"begin-target",
			"render:exterior",
			"present",
			"restore",
		]);
		expect(diagnostics).toMatchObject({
			exteriorRenderCount: 1,
			maskDrawCount: 0,
			submittedRenderNodeCount: 1,
		});
	});

	it("executes graph layers directly and submits each unique node once", () => {
		const substrate = new RecordingSubstrate();
		const rendered: string[][] = [];

		const diagnostics = executePortalGraph(substrate, {
			clearColor: [0, 0, 0, 1],
			destination: null,
			extent: EXTENT,
			plan: internalPlan(),
			renderExterior: () => undefined,
			renderIndoorNodes: (_target, nodeIds) => {
				rendered.push([...nodeIds]);
				substrate.calls.push(`render:${nodeIds.join(",")}`);
			},
			resolveVisibilityAperture: resolvedMask,
		});

		expect(substrate.calls).toEqual([
			"resize",
			"clear",
			"begin-target",
			`render:${ROOT}`,
			"mask:1",
			"mask:1",
			"reset:1",
			"begin-masked:1",
			`render:${LEFT},${RIGHT}`,
			"mask:2",
			"mask:2",
			"reset:2",
			"begin-masked:2",
			`render:${TARGET}`,
			"present",
			"restore",
		]);
		expect(rendered.flat()).toEqual([ROOT, LEFT, RIGHT, TARGET]);
		expect(diagnostics).toEqual({
			admittedVisibilityStateCount: 5,
			exteriorRenderCount: 0,
			maskDrawCount: 4,
			maskEdgeCount: 5,
			nearPlaneSeedCount: 0,
			rejectedFacingCrossingCount: 2,
			sameDomainBoundaryCrossingCount: 0,
			renderLayerCount: 3,
			renderNodeCount: 4,
			selectedScopeCount: 4,
			submittedRenderLayerCount: 3,
			submittedRenderNodeCount: 4,
		});
	});

	it("renders a near-plane target through its retained screen-space mask", () => {
		const substrate = new RecordingSubstrate();
		const rendered: string[][] = [];

		const diagnostics = executePortalGraph(substrate, {
			clearColor: [0, 0, 0, 1],
			destination: null,
			extent: EXTENT,
			plan: rootSeedPlan(),
			renderExterior: () => undefined,
			renderIndoorNodes: (_target, nodeIds) => {
				rendered.push([...nodeIds]);
				substrate.calls.push(`render:${nodeIds.join(",")}`);
			},
			resolveVisibilityAperture: () => {
				throw new Error(
					"Straddle execution must not resolve a world aperture.",
				);
			},
		});

		expect(substrate.calls).toEqual([
			"resize",
			"clear",
			"begin-target",
			`render:${ROOT}`,
			"window-mask:1",
			"reset:1",
			"begin-masked:1",
			`render:${LEFT}`,
			"present",
			"restore",
		]);
		expect(rendered).toEqual([[ROOT], [LEFT]]);
		expect(diagnostics).toMatchObject({
			maskDrawCount: 1,
			maskEdgeCount: 1,
			nearPlaneSeedCount: 1,
			renderLayerCount: 2,
			submittedRenderNodeCount: 2,
		});
	});

	it("does not execute an admitted back edge into the already-rendered root", () => {
		const substrate = new RecordingSubstrate();

		const diagnostics = executePortalGraph(substrate, {
			clearColor: [0, 0, 0, 1],
			destination: null,
			extent: EXTENT,
			plan: internalPlan(),
			renderExterior: () => undefined,
			renderIndoorNodes: () => undefined,
			resolveVisibilityAperture: resolvedMask,
		});

		expect(diagnostics.maskEdgeCount).toBe(5);
		expect(diagnostics.maskDrawCount).toBe(4);
		expect(substrate.calls).not.toContain("mask:0");
	});

	it("rejects inconsistent exterior operations before resolving masks or allocating targets", () => {
		const substrate = new RecordingSubstrate();
		let resolutionCount = 0;
		const plan = internalPlan();
		const exteriorPlan = {
			...plan,
			exteriorTransitions: [
				{
					crossingId: "portal-crossing:root-left",
					exteriorLandblockId: "0x0001ffff",
					sourceNodeId: ROOT,
					targetNodeId: LEFT,
				},
			],
		} as PortalRenderWorkPlan;

		expect(() =>
			executePortalGraph(substrate, {
				clearColor: [0, 0, 0, 1],
				destination: null,
				extent: EXTENT,
				plan: exteriorPlan,
				renderExterior: () => undefined,
				renderIndoorNodes: () => undefined,
				resolveVisibilityAperture: () => {
					resolutionCount += 1;
					return resolvedMask();
				},
			}),
		).toThrow("names an indoor edge");
		expect(resolutionCount).toBe(0);
		expect(substrate.calls).toEqual([]);
	});

	it.each([
		{
			createBasePlan: hybridPlan,
			label: "duplicate",
			mutate: (exterior: MaskedExteriorComponent) => {
				if (!exterior.suffix) throw new Error("Fixture suffix is missing.");
				return {
					...exterior,
					suffix: {
						...exterior.suffix,
						stencilTransition: {
							from: 2,
							kind: "promote-if-equal" as const,
							to: 2,
						},
					},
				};
			},
		},
		{
			createBasePlan: hybridPlan,
			label: "zero",
			mutate: (exterior: MaskedExteriorComponent) => ({
				...exterior,
				entryStencilValue: 0,
			}),
		},
		{
			createBasePlan: hybridPlan,
			label: "out-of-range",
			mutate: (exterior: MaskedExteriorComponent) => ({
				...exterior,
				entryStencilValue: 256,
			}),
		},
		{
			createBasePlan: indoorRootExteriorBranchPlan,
			label: "ceremonial",
			mutate: (exterior: MaskedExteriorComponent) => ({
				...exterior,
				suffix: {
					indoorNodeIds: [],
					maskEdgeIds: [],
					stencilTransition: {
						from: 1,
						kind: "promote-if-equal" as const,
						to: 2,
					},
				},
			}),
		},
	])(
		"rejects $label exterior stencil state before target allocation",
		({ createBasePlan, mutate }) => {
			const substrate = new RecordingSubstrate();
			const base = createBasePlan();
			const exterior = base.exteriorComponent;
			if (exterior?.kind !== "masked") {
				throw new Error("Fixture requires a masked exterior operation.");
			}
			const plan = {
				...base,
				exteriorComponent: mutate(exterior),
			};

			expect(() =>
				executePortalGraph(substrate, {
					clearColor: [0, 0, 0, 1],
					destination: null,
					extent: EXTENT,
					plan,
					renderExterior: () => undefined,
					renderIndoorNodes: () => undefined,
					resolveVisibilityAperture: resolvedMask,
				}),
			).toThrow(/stencil|suffix/);
			expect(substrate.calls).toEqual([]);
		},
	);

	it("renders an exterior suffix without leaking into a same-layer sibling", () => {
		const substrate = new RecordingSubstrate();
		const rendered: string[][] = [];

		const diagnostics = executePortalGraph(substrate, {
			clearColor: [0, 0, 0, 1],
			destination: null,
			extent: EXTENT,
			plan: hybridPlan(),
			renderExterior: () => substrate.calls.push("render:exterior"),
			renderIndoorNodes: (_target, nodeIds) => {
				rendered.push([...nodeIds]);
				substrate.calls.push(`render:${nodeIds.join(",")}`);
			},
			resolveVisibilityAperture: resolvedMask,
		});

		expect(substrate.calls).toEqual([
			"resize",
			"clear",
			"begin-target",
			`render:${ROOT}`,
			"mask:2",
			"mask:1",
			"initialize:2",
			"begin-masked:2",
			"render:exterior",
			"mask:2->3",
			"reset:3",
			"begin-masked:3",
			`render:${SUFFIX}`,
			"reset:1",
			"begin-masked:1",
			`render:${SIBLING}`,
			"present",
			"restore",
		]);
		expect(rendered).toEqual([[ROOT], [SUFFIX], [SIBLING]]);
		expect(diagnostics).toMatchObject({
			exteriorRenderCount: 1,
			maskDrawCount: 3,
			maskEdgeCount: 4,
			renderLayerCount: 2,
			renderNodeCount: 4,
			submittedRenderLayerCount: 2,
			submittedRenderNodeCount: 4,
		});
	});

	it("keeps outdoor portal traversal behind a masked indoor-root straddle", () => {
		const substrate = new RecordingSubstrate();

		const diagnostics = executePortalGraph(substrate, {
			clearColor: [0, 0, 0, 1],
			destination: null,
			extent: EXTENT,
			plan: indoorRootExteriorBranchPlan(),
			renderExterior: () => substrate.calls.push("render:exterior"),
			renderIndoorNodes: (_target, nodeIds) =>
				substrate.calls.push(`render:${nodeIds.join(",")}`),
			resolveVisibilityAperture: resolvedMask,
		});

		expect(substrate.calls).toEqual([
			"resize",
			"clear",
			"begin-target",
			`render:${ROOT}`,
			"window-mask:1",
			"initialize:1",
			"begin-masked:1",
			"render:exterior",
			"mask:2",
			"reset:2",
			"begin-masked:2",
			`render:${SIBLING}`,
			"present",
			"restore",
		]);
		expect(diagnostics).toMatchObject({
			maskDrawCount: 2,
			nearPlaneSeedCount: 1,
			submittedRenderNodeCount: 3,
		});
	});

	it("rejects an invalid effective aperture before target allocation", () => {
		const substrate = new RecordingSubstrate();

		expect(() =>
			executePortalGraph(substrate, {
				clearColor: [0, 0, 0, 1],
				destination: null,
				extent: EXTENT,
				plan: internalPlan(),
				renderExterior: () => undefined,
				renderIndoorNodes: () => undefined,
				resolveVisibilityAperture: () => ({
					...resolvedMask(),
					clipFromLocal: new Float32Array(15),
				}),
			}),
		).toThrow("resolved an invalid clip transform");
		expect(substrate.calls).toEqual([]);
	});

	it("restores ordinary destination state when a contribution draw fails", () => {
		const substrate = new RecordingSubstrate();

		expect(() =>
			executePortalGraph(substrate, {
				clearColor: [0, 0, 0, 1],
				destination: null,
				extent: EXTENT,
				plan: internalPlan(),
				renderExterior: () => undefined,
				renderIndoorNodes: () => {
					throw new Error("fixture contribution failed");
				},
				resolveVisibilityAperture: resolvedMask,
			}),
		).toThrow("fixture contribution failed");
		expect(substrate.calls.at(-1)).toBe("restore");
	});

	it.each([
		{ failurePrefix: "mask:", plan: internalPlan() },
		{ failurePrefix: "reset:", plan: internalPlan() },
		{
			failurePrefix: "initialize:",
			plan: indoorRootExteriorBranchPlan(),
		},
	])(
		"restores ordinary destination state when $failurePrefix execution fails",
		({ failurePrefix, plan }) => {
			const substrate = new RecordingSubstrate(failurePrefix);

			expect(() =>
				executePortalGraph(substrate, {
					clearColor: [0, 0, 0, 1],
					destination: null,
					extent: EXTENT,
					plan,
					renderExterior: () => undefined,
					renderIndoorNodes: () => undefined,
					resolveVisibilityAperture: resolvedMask,
				}),
			).toThrow(`fixture ${failurePrefix} failure`);
			expect(substrate.calls.at(-1)).toBe("restore");
		},
	);
});

class RecordingSubstrate implements PortalExecutionSubstrate {
	readonly calls: string[] = [];
	readonly target = {} as WebGL2SceneDomainTarget;

	constructor(private readonly failurePrefix: string | null = null) {}

	beginTargetPass(): void {
		this.#record("begin-target");
	}

	beginMaskedPass(_target: WebGL2SceneDomainTarget, renderLayer: number): void {
		this.#record(`begin-masked:${renderLayer}`);
	}

	clearTarget(): void {
		this.#record("clear");
	}

	initializeMaskedScene(
		_target: WebGL2SceneDomainTarget,
		renderLayer: number,
	): void {
		this.#record(`initialize:${renderLayer}`);
	}

	present(): void {
		this.#record("present");
	}

	resetMaskedDepth(
		_target: WebGL2SceneDomainTarget,
		renderLayer: number,
	): void {
		this.#record(`reset:${renderLayer}`);
	}

	resize(): WebGL2SceneDomainTarget {
		this.#record("resize");
		return this.target;
	}

	restoreOrdinaryPass(): void {
		this.#record("restore");
	}

	writeLayerMask(
		...args: Parameters<PortalExecutionSubstrate["writeLayerMask"]>
	): void {
		const policy = args[5];
		this.#record(
			`mask:${policy.kind === "replace" ? policy.value : `${policy.from}->${policy.to}`}`,
		);
	}

	writeLayerWindowMask(
		...args: Parameters<PortalExecutionSubstrate["writeLayerWindowMask"]>
	): void {
		const policy = args[2];
		this.#record(
			`window-mask:${policy.kind === "replace" ? policy.value : `${policy.from}->${policy.to}`}`,
		);
	}

	#record(call: string): void {
		this.calls.push(call);
		if (this.failurePrefix && call.startsWith(this.failurePrefix)) {
			throw new Error(`fixture ${this.failurePrefix} failure`);
		}
	}
}

function resolvedMask(): ResolvedPortalMask {
	return {
		clipFromLocal: IDENTITY,
		geometry: {
			indexCount: 6,
		} as ResolvedPortalMask["geometry"],
		indexCount: 6,
		indexStart: 0,
	};
}

function outdoorRootPlan(): PortalRenderWorkPlan {
	const base = internalPlan();
	return {
		...base,
		capacity: {
			maximumAvailableStencilValue: 255,
			maximumRenderLayer: 0,
			requiredMaximumStencilValue: 0,
		},
		diagnostics: {
			...base.diagnostics,
			componentCount: 1,
			cyclicComponentCount: 0,
			retainedMaskEdgeCount: 0,
			retainedRenderNodeCount: 1,
		},
		exteriorComponent: {
			componentNodeIds: [OUTDOOR],
			entryMaskEdgeIds: [],
			kind: "unmasked",
			outdoorNodeId: OUTDOOR,
			renderLayer: 0,
			returnMaskEdgeIds: [],
			rootContained: true,
			suffix: null,
		},
		exteriorTransitions: [],
		maskEdges: [],
		nodes: [portalNode(OUTDOOR, "outdoor", 0, [])],
		renderLayers: [
			{
				incomingMaskEdgeIds: [],
				renderLayer: 0,
				renderNodeIds: [OUTDOOR],
			},
		],
		rootNodeId: OUTDOOR,
		selectedScopes: [],
	};
}

function hybridPlan(): PortalRenderWorkPlan {
	const base = internalPlan();
	const enterOutside = hybridEdge("enter-outside", ROOT, OUTDOOR, true);
	const outsideSuffix = hybridEdge("outside-suffix", OUTDOOR, SUFFIX, true);
	const rootSibling = hybridEdge("root-sibling", ROOT, SIBLING, false);
	const suffixOutside = hybridEdge("suffix-outside", SUFFIX, OUTDOOR, true);
	const maskEdges = [enterOutside, outsideSuffix, rootSibling, suffixOutside];
	return {
		...base,
		capacity: {
			maximumAvailableStencilValue: 255,
			maximumRenderLayer: 1,
			requiredMaximumStencilValue: 3,
		},
		diagnostics: {
			...base.diagnostics,
			componentCount: 3,
			cyclicComponentCount: 1,
			retainedMaskEdgeCount: maskEdges.length,
			retainedRenderNodeCount: 4,
		},
		exteriorComponent: {
			componentNodeIds: [OUTDOOR, SUFFIX],
			entryStencilValue: 2,
			entryMaskEdgeIds: [enterOutside.crossingId],
			kind: "masked",
			outdoorNodeId: OUTDOOR,
			renderLayer: 1,
			returnMaskEdgeIds: [suffixOutside.crossingId],
			rootContained: false,
			suffix: {
				indoorNodeIds: [SUFFIX],
				maskEdgeIds: [outsideSuffix.crossingId],
				stencilTransition: { from: 2, kind: "promote-if-equal", to: 3 },
			},
		},
		exteriorTransitions: [enterOutside, outsideSuffix, suffixOutside].map(
			(edge) => ({
				crossingId: edge.crossingId,
				exteriorLandblockId: "0x0001ffff",
				sourceNodeId: edge.sourceNodeId,
				targetNodeId: edge.targetNodeId,
			}),
		),
		maskEdges,
		nodes: [
			portalNode(ROOT, "indoor-visibility-island", 0, []),
			portalNode(OUTDOOR, "outdoor", 1, [
				enterOutside.crossingId,
				suffixOutside.crossingId,
			]),
			portalNode(SIBLING, "indoor-visibility-island", 1, [
				rootSibling.crossingId,
			]),
			portalNode(SUFFIX, "indoor-visibility-island", 1, [
				outsideSuffix.crossingId,
			]),
		],
		renderLayers: [
			{
				incomingMaskEdgeIds: [],
				renderLayer: 0,
				renderNodeIds: [ROOT],
			},
			{
				incomingMaskEdgeIds: maskEdges.map((edge) => edge.crossingId),
				renderLayer: 1,
				renderNodeIds: [OUTDOOR, SIBLING, SUFFIX],
			},
		],
		rootNodeId: ROOT,
		selectedScopes: [],
	};
}

function indoorRootExteriorBranchPlan(): PortalRenderWorkPlan {
	const base = internalPlan();
	const seed = hybridEdge(
		"root-outside-seed",
		ROOT,
		OUTDOOR,
		true,
		createFullPortalViewWindow(),
	);
	const outsideSibling = hybridEdge("outside-sibling", OUTDOOR, SIBLING, true);
	return {
		...base,
		capacity: {
			maximumAvailableStencilValue: 255,
			maximumRenderLayer: 2,
			requiredMaximumStencilValue: 2,
		},
		diagnostics: {
			...base.diagnostics,
			componentCount: 2,
			cyclicComponentCount: 1,
			nearPlaneSeedCount: 1,
			retainedMaskEdgeCount: 2,
			retainedRenderNodeCount: 3,
		},
		exteriorComponent: {
			componentNodeIds: [OUTDOOR, ROOT],
			entryMaskEdgeIds: [],
			entryStencilValue: 1,
			kind: "masked",
			outdoorNodeId: OUTDOOR,
			renderLayer: 1,
			returnMaskEdgeIds: [seed.crossingId],
			rootContained: true,
			suffix: null,
		},
		exteriorTransitions: [seed, outsideSibling].map((edge) => ({
			crossingId: edge.crossingId,
			exteriorLandblockId: "0x0001ffff",
			sourceNodeId: edge.sourceNodeId,
			targetNodeId: edge.targetNodeId,
		})),
		maskEdges: [seed, outsideSibling],
		nodes: [
			portalNode(ROOT, "indoor-visibility-island", 0, []),
			portalNode(OUTDOOR, "outdoor", 1, [seed.crossingId]),
			portalNode(SIBLING, "indoor-visibility-island", 2, [
				outsideSibling.crossingId,
			]),
		],
		renderLayers: [
			{
				incomingMaskEdgeIds: [],
				renderLayer: 0,
				renderNodeIds: [ROOT],
			},
			{
				incomingMaskEdgeIds: [seed.crossingId],
				renderLayer: 1,
				renderNodeIds: [OUTDOOR],
			},
			{
				incomingMaskEdgeIds: [outsideSibling.crossingId],
				renderLayer: 2,
				renderNodeIds: [SIBLING],
			},
		],
		rootNodeId: ROOT,
		selectedScopes: [],
	};
}

function hybridEdge(
	id: string,
	sourceNodeId: PortalRenderWorkPlan["nodes"][number]["id"],
	targetNodeId: PortalRenderWorkPlan["nodes"][number]["id"],
	exterior: boolean,
	nearClipWindow: ReturnType<typeof createFullPortalViewWindow> | null = null,
): PortalRenderWorkPlan["maskEdges"][number] {
	return {
		crossingId: `portal-crossing:${id}`,
		maskSource: nearClipWindow
			? { kind: "near-clip-window", window: nearClipWindow }
			: {
					kind: "world-aperture",
					visibilityApertureId: `portal-aperture:${id}`,
				},
		sourceNodeId,
		spatialRelationship: exterior
			? {
					exteriorLandblockId: "0x0001ffff",
					kind: "exterior-transition",
				}
			: { kind: "indoor-topology-boundary", reason: "fixture" },
		targetNodeId,
	};
}

function portalNode(
	id: PortalRenderWorkPlan["nodes"][number]["id"],
	kind: PortalRenderWorkPlan["nodes"][number]["kind"],
	renderLayer: number,
	incomingMaskEdgeIds: readonly PortalCrossingId[],
): PortalRenderWorkPlan["nodes"][number] {
	return { id, incomingMaskEdgeIds, kind, renderLayer, scopes: [] };
}

function internalPlan(): PortalRenderWorkPlan {
	const scope = (id: string) =>
		({
			envCellId: id,
			kind: "env-cell",
			landblockId: "0x0001ffff",
		}) as const;
	const edge = (
		id: string,
		sourceNodeId: typeof ROOT | typeof LEFT | typeof RIGHT | typeof TARGET,
		targetNodeId: typeof ROOT | typeof LEFT | typeof RIGHT | typeof TARGET,
	) => ({
		crossingId: `portal-crossing:${id}` as PortalCrossingId,
		maskSource: {
			kind: "world-aperture" as const,
			visibilityApertureId: `portal-aperture:${id}` as const,
		},
		sourceNodeId,
		spatialRelationship: {
			kind: "indoor-topology-boundary" as const,
			reason: "fixture",
		},
		targetNodeId,
	});
	const rootLeft = edge("root-left", ROOT, LEFT);
	const rootRight = edge("root-right", ROOT, RIGHT);
	const leftTarget = edge("left-target", LEFT, TARGET);
	const rightTarget = edge("right-target", RIGHT, TARGET);
	const targetRoot = edge("target-root", TARGET, ROOT);
	return {
		capacity: {
			maximumAvailableStencilValue: 255,
			maximumRenderLayer: 2,
			requiredMaximumStencilValue: 2,
		},
		diagnostics: {
			admittedWindowStateCount: 5,
			attemptedCrossingCount: 7,
			componentCount: 1,
			cyclicComponentCount: 1,
			duplicateOrSubsumedWindowStateCount: 1,
			emptyWindowCount: 0,
			maximumRetainedFragmentsPerNode: 2,
			nearPlaneSeedCount: 0,
			projection: {
				broadPhaseRejectedPairCount: 0,
				createdClipVertexCount: 0,
				createdNdcVertexCount: 0,
				createdPolygonCount: 0,
				emptyExactIntersectionCount: 0,
				exactIntersectionPairCount: 0,
				homogeneousClippedPolygonCount: 0,
				homogeneousRejectedTriangleCount: 0,
				inputTriangleCount: 0,
				outputFragmentCount: 0,
				outputVertexCount: 0,
			},
			rejectedFacingCrossingCount: 2,
			sameDomainBoundaryCrossingCount: 0,
			retainedMaskEdgeCount: 5,
			retainedRenderNodeCount: 4,
			workItemCount: 12,
		},
		exteriorComponent: null,
		exteriorTransitions: [],
		maskEdges: [leftTarget, rightTarget, rootLeft, rootRight, targetRoot],
		nodes: [
			{
				id: LEFT,
				incomingMaskEdgeIds: [rootLeft.crossingId],
				kind: "indoor-visibility-island",
				renderLayer: 1,
				scopes: [scope("left")],
			},
			{
				id: RIGHT,
				incomingMaskEdgeIds: [rootRight.crossingId],
				kind: "indoor-visibility-island",
				renderLayer: 1,
				scopes: [scope("right")],
			},
			{
				id: ROOT,
				incomingMaskEdgeIds: [targetRoot.crossingId],
				kind: "indoor-visibility-island",
				renderLayer: 0,
				scopes: [scope("root")],
			},
			{
				id: TARGET,
				incomingMaskEdgeIds: [leftTarget.crossingId, rightTarget.crossingId],
				kind: "indoor-visibility-island",
				renderLayer: 2,
				scopes: [scope("target")],
			},
		],
		renderLayers: [
			{
				incomingMaskEdgeIds: [],
				renderLayer: 0,
				renderNodeIds: [ROOT],
			},
			{
				incomingMaskEdgeIds: [rootLeft.crossingId, rootRight.crossingId],
				renderLayer: 1,
				renderNodeIds: [LEFT, RIGHT],
			},
			{
				incomingMaskEdgeIds: [leftTarget.crossingId, rightTarget.crossingId],
				renderLayer: 2,
				renderNodeIds: [TARGET],
			},
		],
		rootNodeId: ROOT,
		selectedScopes: [
			scope("left"),
			scope("right"),
			scope("root"),
			scope("target"),
		],
		topologyRevision: 1,
	};
}

function rootSeedPlan(): PortalRenderWorkPlan {
	const base = internalPlan();
	const seedEdge = {
		...base.maskEdges[0]!,
		maskSource: {
			kind: "near-clip-window" as const,
			window: createFullPortalViewWindow(),
		},
		sourceNodeId: ROOT,
		targetNodeId: LEFT,
	};
	const nodes = [
		portalNode(ROOT, "indoor-visibility-island", 0, []),
		portalNode(LEFT, "indoor-visibility-island", 1, [seedEdge.crossingId]),
	];
	return {
		...base,
		capacity: {
			maximumAvailableStencilValue: 255,
			maximumRenderLayer: 1,
			requiredMaximumStencilValue: 1,
		},
		diagnostics: {
			...base.diagnostics,
			admittedWindowStateCount: 2,
			attemptedCrossingCount: 1,
			componentCount: 2,
			cyclicComponentCount: 0,
			maximumRetainedFragmentsPerNode: 1,
			nearPlaneSeedCount: 1,
			rejectedFacingCrossingCount: 0,
			retainedMaskEdgeCount: 1,
			retainedRenderNodeCount: 2,
			workItemCount: 2,
		},
		maskEdges: [seedEdge],
		nodes,
		renderLayers: [
			{
				incomingMaskEdgeIds: [],
				renderLayer: 0,
				renderNodeIds: [ROOT],
			},
			{
				incomingMaskEdgeIds: [seedEdge.crossingId],
				renderLayer: 1,
				renderNodeIds: [LEFT],
			},
		],
		selectedScopes: nodes.flatMap((node) => node.scopes),
	};
}
