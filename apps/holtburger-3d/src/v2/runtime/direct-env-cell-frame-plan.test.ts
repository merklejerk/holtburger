import { describe, expect, it } from "vitest";
import type { StaticPortalProjectionRecord } from "../static/contracts";
import { createPortalProjectionFramePlan } from "./direct-env-cell-frame-plan";

describe("direct env-cell frame plan", () => {
	it("creates one outdoor projection render entry for a shared diamond target with multiple mask edges", () => {
		const plan = createPortalProjectionFramePlan({
			landblockId: 0xda55ffff,
			envCellResourceMembership: [
				createEnvCellMembership(0xda550100, "structured-a"),
				createEnvCellMembership(0xda550101, "structured-b"),
				createEnvCellMembership(0xda550102, "structured-c"),
				createEnvCellMembership(0xda550103, "structured-d"),
			],
			maxRenderEntries: 16,
			maxDepth: 4,
			maxMaskEdges: 16,
			projection: createPortalProjectionRecord({
				edges: [
					createProjectionEdge({
						edgeId: "outdoor-a",
						sourceEnvCellId: null,
						targetEnvCellId: 0xda550100,
					}),
					createProjectionEdge({
						edgeId: "a-b",
						sourceEnvCellId: 0xda550100,
						targetEnvCellId: 0xda550101,
					}),
					createProjectionEdge({
						edgeId: "b-c",
						sourceEnvCellId: 0xda550101,
						targetEnvCellId: 0xda550102,
					}),
					createProjectionEdge({
						edgeId: "b-d",
						sourceEnvCellId: 0xda550101,
						targetEnvCellId: 0xda550103,
					}),
					createProjectionEdge({
						edgeId: "c-d",
						sourceEnvCellId: 0xda550102,
						targetEnvCellId: 0xda550103,
					}),
				],
				layers: [
					{ envCellIds: [0xda550100], renderLayer: 1 },
					{ envCellIds: [0xda550101], renderLayer: 2 },
					{ envCellIds: [0xda550102], renderLayer: 3 },
					{ envCellIds: [0xda550103], renderLayer: 4 },
				],
			}),
		});

		expect(plan?.mode).toBe("portal-projection");
		if (plan?.mode !== "portal-projection") {
			throw new Error("Expected portal projection plan.");
		}
		expect(plan.layeredGraph.renderEntries).toHaveLength(4);
		expect(
			plan.layeredGraph.renderEntries.map((entry) => [
				entry.envCellId,
				entry.renderLayer,
				entry.incomingMaskEdgeIds.length,
			]),
		).toEqual([
			[0xda550100, 1, 1],
			[0xda550101, 2, 1],
			[0xda550102, 3, 1],
			[0xda550103, 4, 2],
		]);
		expect(plan.layeredGraph.renderLayers).toEqual([
			{ renderEntryIds: [0], renderLayer: 1 },
			{ renderEntryIds: [1], renderLayer: 2 },
			{ renderEntryIds: [2], renderLayer: 3 },
			{ renderEntryIds: [3], renderLayer: 4 },
		]);
		expect(plan.layeredGraph.maskEdges).toHaveLength(5);
		expect(plan.layeredGraph.diagnostics).toMatchObject({
			buildingTransitionEdges: 1,
			envCellPortalEdges: 4,
			selectedMaskEdges: 5,
		});
	});

	it("caps outdoor projection render entries by render layer without duplicating alternate paths", () => {
		const plan = createPortalProjectionFramePlan({
			landblockId: 0xda55ffff,
			envCellResourceMembership: [
				createEnvCellMembership(0xda550100, "structured-a"),
				createEnvCellMembership(0xda550101, "structured-b"),
				createEnvCellMembership(0xda550102, "structured-c"),
			],
			maxRenderEntries: 16,
			maxDepth: 2,
			maxMaskEdges: 16,
			projection: createPortalProjectionRecord({
				edges: [
					createProjectionEdge({
						edgeId: "outdoor-a",
						sourceEnvCellId: null,
						targetEnvCellId: 0xda550100,
					}),
					createProjectionEdge({
						edgeId: "a-b",
						sourceEnvCellId: 0xda550100,
						targetEnvCellId: 0xda550101,
					}),
					createProjectionEdge({
						edgeId: "a-c",
						sourceEnvCellId: 0xda550100,
						targetEnvCellId: 0xda550102,
					}),
					createProjectionEdge({
						edgeId: "b-c",
						sourceEnvCellId: 0xda550101,
						targetEnvCellId: 0xda550102,
					}),
				],
				layers: [
					{ envCellIds: [0xda550100], renderLayer: 1 },
					{ envCellIds: [0xda550101], renderLayer: 2 },
					{ envCellIds: [0xda550102], renderLayer: 3 },
				],
			}),
		});

		expect(plan?.mode).toBe("portal-projection");
		if (plan?.mode !== "portal-projection") {
			throw new Error("Expected portal projection plan.");
		}
		expect(
			plan.layeredGraph.renderEntries.map((entry) => entry.envCellId),
		).toEqual([0xda550100, 0xda550101]);
		expect(plan.layeredGraph.projectionDiagnostics).toMatchObject({
			projectedEnvCellCount: 3,
			renderEntriesSkippedByLayerCap: 1,
			renderEntryCount: 2,
		});
	});

	it("creates an env-cell projection base entry for the resident root without masking it", () => {
		const plan = createPortalProjectionFramePlan({
			landblockId: 0xda55ffff,
			envCellResourceMembership: [
				createEnvCellMembership(0xda550100, "structured-root"),
				createEnvCellMembership(0xda550101, "structured-child"),
			],
			maxRenderEntries: 16,
			maxDepth: 2,
			maxMaskEdges: 16,
			projection: createPortalProjectionRecord({
				edges: [
					createProjectionEdge({
						edgeId: "a-b",
						sourceEnvCellId: 0xda550100,
						targetEnvCellId: 0xda550101,
					}),
				],
				layers: [
					{ envCellIds: [0xda550100], renderLayer: 0 },
					{ envCellIds: [0xda550101], renderLayer: 1 },
				],
				root: {
					envCellId: 0xda550100,
					kind: "env-cell-root",
					landblockId: 0xda55ffff,
					rootNodeId: "env-cell:3663003904",
				},
			}),
		});

		expect(plan?.mode).toBe("portal-projection");
		if (plan?.mode !== "portal-projection") {
			throw new Error("Expected portal projection plan.");
		}
		expect(plan.layeredGraph.baseEntry).toMatchObject({
			resources: expect.objectContaining({
				structuredInteriorDrawUnitIds: ["structured-root"],
			}),
			scene: {
				envCellId: 0xda550100,
				kind: "env-cell-direct",
				landblockId: 0xda55ffff,
			},
		});
		expect(plan.layeredGraph.renderEntries).toEqual([
			expect.objectContaining({
				envCellId: 0xda550101,
				incomingMaskEdgeIds: [0],
				renderLayer: 1,
				resources: expect.objectContaining({
					structuredInteriorDrawUnitIds: ["structured-child"],
				}),
			}),
		]);
		expect(plan.layeredGraph.renderEntries).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ envCellId: 0xda550100 }),
			]),
		);
		expect(plan.layeredGraph.renderLayers).toEqual([
			{ renderEntryIds: [0], renderLayer: 1 },
		]);
		expect(plan.layeredGraph.maskEdges).toEqual([
			expect.objectContaining({
				renderEntryId: 0,
				renderLayer: 1,
				sourceEnvCellId: 0xda550100,
				targetEnvCellId: 0xda550101,
			}),
		]);
	});

	it("retains outdoor crossings for env-cell projections through selected target cells", () => {
		const plan = createPortalProjectionFramePlan({
			landblockId: 0xda55ffff,
			envCellResourceMembership: [
				createEnvCellMembership(0xda550100, "structured-root"),
				createEnvCellMembership(0xda550101, "structured-child"),
			],
			maxRenderEntries: 16,
			maxDepth: 2,
			maxMaskEdges: 16,
			projection: createPortalProjectionRecord({
				edges: [
					createProjectionEdge({
						edgeId: "a-b",
						sourceEnvCellId: 0xda550100,
						targetEnvCellId: 0xda550101,
					}),
				],
				layers: [
					{ envCellIds: [0xda550100], renderLayer: 0 },
					{ envCellIds: [0xda550101], renderLayer: 1 },
				],
				outdoorSceneCrossings: [
					createOutdoorSceneCrossing({
						crossingId: "outdoor-crossing:child",
						targetEnvCellId: 0xda550101,
					}),
				],
				root: {
					envCellId: 0xda550100,
					kind: "env-cell-root",
					landblockId: 0xda55ffff,
					rootNodeId: "env-cell:3663003904",
				},
			}),
		});

		expect(plan?.mode).toBe("portal-projection");
		if (plan?.mode !== "portal-projection") {
			throw new Error("Expected portal projection plan.");
		}
		expect(plan.layeredGraph.outdoorCrossings).toEqual([
			{
				apertureRangeId: "building-transition:outdoor-crossing:child:range",
				apertureSourceId:
					"building-transition:outdoor-crossing:child:source",
				crossingId: 0,
				linkId: "outdoor-crossing:child",
				outdoorLandblockId: 0xda55ffff,
				targetEnvCellId: 0xda550101,
			},
		]);
		expect(plan.layeredGraph.projectionDiagnostics).toMatchObject({
			outdoorCrossingCount: 1,
			outdoorCrossingsSkippedByLayerCap: 0,
			outdoorCrossingsSkippedByUnselectedTarget: 0,
		});
		expect(plan.layeredGraph.diagnostics).toMatchObject({
			buildingTransitionEdges: 1,
		});
	});
});

function createEnvCellMembership(
	envCellId: number,
	structuredDrawUnitId: string,
) {
	return {
		envCellId,
		envCellStaticObjectDrawUnitIds: [],
		landblockId: 0xda55ffff,
		sharedEnvCellStaticObjectDrawUnits: 0,
		structuredInteriorDrawUnitIds: [structuredDrawUnitId],
	};
}

function createPortalProjectionRecord(options: {
	readonly edges: readonly StaticPortalProjectionRecord["edges"][number][];
	readonly layers: readonly {
		readonly envCellIds: readonly number[];
		readonly renderLayer: number;
	}[];
	readonly root?: StaticPortalProjectionRecord["root"];
	readonly outdoorSceneCrossings?: readonly StaticPortalProjectionRecord["outdoorSceneCrossings"][number][];
}): StaticPortalProjectionRecord {
	const envCellIds = [
		...new Set(options.layers.flatMap((layer) => layer.envCellIds)),
	];
	return {
		adjacency: envCellIds.map((envCellId) => ({
			edgeIds: options.edges
				.filter((edge) => edge.sourceEnvCellId === envCellId)
				.map((edge) => edge.edgeId),
			sourceNodeId: createProjectionNodeId(envCellId),
		})),
		componentEdges: [],
		components: envCellIds.map((envCellId) => {
			const renderLayer =
				options.layers.find((layer) => layer.envCellIds.includes(envCellId))
					?.renderLayer ?? null;
			return {
				componentId: `component:${formatHex32(envCellId)}`,
				cyclic: false,
				envCellIds: [envCellId],
				renderLayer,
			};
		}),
		diagnostics: {
			acceptedTransitionRootCount: options.edges.filter(
				(edge) => edge.sourceKind === "building-transition",
			).length,
			componentCount: envCellIds.length,
			componentInternalEdgeCount: 0,
			cyclicComponentCount: 0,
			envCellPortalEdgesRejectedMissingAperture: 0,
			envCellPortalEdgesRejectedSourceNotOutsideVisible: 0,
			envCellPortalEdgesRejectedTargetNotOutsideVisible: 0,
			envCellPortalEdgesRetained: options.edges.filter(
				(edge) => edge.sourceKind === "env-cell-portal",
			).length,
			maxRenderLayer: Math.max(
				0,
				...options.layers.map((layer) => layer.renderLayer),
			),
			outboundOutdoorCrossingCandidateCount:
				options.outdoorSceneCrossings?.length ?? 0,
			outboundOutdoorCrossingRetainedCount:
				options.outdoorSceneCrossings?.length ?? 0,
			outboundOutdoorCrossingSkippedUnreachableTarget: 0,
			outsideVisibleEnvCellCount: envCellIds.length,
			transitionRootCandidateCount: options.edges.filter(
				(edge) => edge.sourceKind === "building-transition",
			).length,
		},
		edges: options.edges,
		incomingEdges: envCellIds.map((envCellId) => ({
			edgeIds: options.edges
				.filter((edge) => edge.targetEnvCellId === envCellId)
				.map((edge) => edge.edgeId),
			targetEnvCellId: envCellId,
		})),
		kind: "portal-projection",
		landblockId: 0xda55ffff,
		nodes: envCellIds.map((envCellId) => ({
			envCellId,
			nodeId: createProjectionNodeId(envCellId),
		})),
		outdoorSceneCrossings: options.outdoorSceneCrossings ?? [],
		renderLayerByEnvCellId: options.layers.flatMap((layer) =>
			layer.envCellIds.map((envCellId) => ({
				envCellId,
				renderLayer: layer.renderLayer,
			})),
		),
		renderLayers: options.layers.map((layer) => ({
			componentIds: layer.envCellIds.map(
				(envCellId) => `component:${formatHex32(envCellId)}`,
			),
			envCellIds: layer.envCellIds,
			renderLayer: layer.renderLayer,
		})),
		root: options.root ?? {
			kind: "outdoor-root",
			landblockId: 0xda55ffff,
			rootNodeId: "outdoor-root",
		},
		rootNodeId: options.root?.rootNodeId ?? "outdoor-root",
		sourceRevisionKey: "projection-test-key",
	};
}

function createOutdoorSceneCrossing(options: {
	readonly crossingId: string;
	readonly targetEnvCellId: number;
}): StaticPortalProjectionRecord["outdoorSceneCrossings"][number] {
	return {
		apertureRangeId: `building-transition:${options.crossingId}:range`,
		apertureSourceId: `building-transition:${options.crossingId}:source`,
		crossingId: options.crossingId,
		linkId: options.crossingId,
		outdoorLandblockId: 0xda55ffff,
		provenance: {
			apertureResourceId: "portal-aperture-resource:building-transition:da55ffff",
			buildingInstanceId: "building-0",
			buildingPortalId: "building-portal-0",
			kind: "building-transition",
			portalId: options.crossingId,
			targetEnvCellId: options.targetEnvCellId,
		},
		targetEnvCellId: options.targetEnvCellId,
	};
}

function createProjectionEdge(options: {
	readonly edgeId: string;
	readonly sourceEnvCellId: number | null;
	readonly targetEnvCellId: number;
}): StaticPortalProjectionRecord["edges"][number] {
	const sourceKind =
		options.sourceEnvCellId === null
			? "building-transition"
			: "env-cell-portal";
	return {
		apertureRangeId: `${sourceKind}:${options.edgeId}:range`,
		apertureSourceId: `${sourceKind}:${options.edgeId}:source`,
		edgeId: options.edgeId,
		linkId: options.edgeId,
		provenance:
			sourceKind === "building-transition"
				? {
						apertureResourceId:
							"portal-aperture-resource:building-transition:da55ffff",
						buildingInstanceId: "building-0",
						buildingPortalId: "building-portal-0",
						kind: "building-transition",
						portalId: options.edgeId,
						targetEnvCellId: options.targetEnvCellId,
					}
				: {
						kind: "env-cell-portal",
						polygonId: null,
						sourceEnvCellId: options.sourceEnvCellId,
						sourceIndex: 0,
						sourcePortalId: `${options.edgeId}:source-portal`,
						targetEnvCellId: options.targetEnvCellId,
						targetPortalId: `${options.edgeId}:target-portal`,
					},
		sourceEnvCellId: options.sourceEnvCellId,
		sourceKind,
		sourceNodeId:
			options.sourceEnvCellId === null
				? "outdoor-root"
				: createProjectionNodeId(options.sourceEnvCellId),
		targetEnvCellId: options.targetEnvCellId,
		targetNodeId: createProjectionNodeId(options.targetEnvCellId),
	};
}

function createProjectionNodeId(envCellId: number): string {
	return `env-cell:${formatHex32(envCellId)}`;
}

function formatHex32(value: number): string {
	return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}
