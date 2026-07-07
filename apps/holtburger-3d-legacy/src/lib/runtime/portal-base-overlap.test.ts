import { describe, expect, it } from "vitest";
import type {
	StaticPortalApertureResource,
	StaticPortalProjectionRecord,
} from "../static/contracts";
import { deriveRuntimePortalOverlapResidency } from "./portal-base-overlap";

describe("portal base overlap residency", () => {
	it("accepts an env-cell portal when the camera is inside the aperture slab", () => {
		const overlap = deriveRuntimePortalOverlapResidency({
			aperturePadding: 0,
			envCellResourceMembership: [createEnvCellMembership(0xda550101)],
			frameState: createFrameState([0, 0, 0.1]),
			planeEpsilon: 0.25,
			portalApertureResources: [createPortalApertureResource()],
			projection: createProjectionRecord({
				edges: [
					createProjectionEdge({
						sourceEnvCellId: 0xda550100,
						sourceKind: "env-cell-portal",
						targetEnvCellId: 0xda550101,
					}),
				],
				root: {
					envCellId: 0xda550100,
					kind: "env-cell-root",
					landblockId: 0xda55ffff,
					rootNodeId: "env-cell:root",
				},
			}),
			renderAnchorLandblockId: null,
			residency: {
				envCellId: 0xda550100,
				kind: "env-cell",
				landblockId: 0xda55ffff,
			},
		});

		expect(overlap.kind).toBe("portal-overlap");
		expect(overlap.baseOverlapEnvCellIds).toEqual([0xda550101]);
		expect(overlap.missingResourceEnvCellIds).toEqual([]);
		expect(overlap.requiresExteriorSeed).toBe(false);
		expect(overlap.boundaries).toEqual([
			expect.objectContaining({
				sourceEnvCellId: 0xda550100,
				sourceKind: "env-cell-portal",
				targetEnvCellId: 0xda550101,
			}),
		]);
	});

	it("rejects an env-cell portal when the camera is outside the plane slab", () => {
		const overlap = deriveRuntimePortalOverlapResidency({
			aperturePadding: 0,
			envCellResourceMembership: [createEnvCellMembership(0xda550101)],
			frameState: createFrameState([0, 0, 0.5]),
			planeEpsilon: 0.25,
			portalApertureResources: [createPortalApertureResource()],
			projection: createProjectionRecord({
				edges: [
					createProjectionEdge({
						sourceEnvCellId: 0xda550100,
						sourceKind: "env-cell-portal",
						targetEnvCellId: 0xda550101,
					}),
				],
				root: {
					envCellId: 0xda550100,
					kind: "env-cell-root",
					landblockId: 0xda55ffff,
					rootNodeId: "env-cell:root",
				},
			}),
			renderAnchorLandblockId: null,
			residency: {
				envCellId: 0xda550100,
				kind: "env-cell",
				landblockId: 0xda55ffff,
			},
		});

		expect(overlap.kind).toBe("none");
		expect(overlap.baseOverlapEnvCellIds).toEqual([]);
	});

	it("rejects an env-cell portal when the camera is outside the padded aperture bounds", () => {
		const overlap = deriveRuntimePortalOverlapResidency({
			aperturePadding: 0.1,
			envCellResourceMembership: [createEnvCellMembership(0xda550101)],
			frameState: createFrameState([1.25, 0, 0.1]),
			planeEpsilon: 0.25,
			portalApertureResources: [createPortalApertureResource()],
			projection: createProjectionRecord({
				edges: [
					createProjectionEdge({
						sourceEnvCellId: 0xda550100,
						sourceKind: "env-cell-portal",
						targetEnvCellId: 0xda550101,
					}),
				],
				root: {
					envCellId: 0xda550100,
					kind: "env-cell-root",
					landblockId: 0xda55ffff,
					rootNodeId: "env-cell:root",
				},
			}),
			renderAnchorLandblockId: null,
			residency: {
				envCellId: 0xda550100,
				kind: "env-cell",
				landblockId: 0xda55ffff,
			},
		});

		expect(overlap.kind).toBe("none");
	});

	it("accepts multiple current env-cell portal overlaps with a stable signature", () => {
		const projection = createProjectionRecord({
			edges: [
				createProjectionEdge({
					edgeId: "edge-b",
					sourceEnvCellId: 0xda550100,
					sourceKind: "env-cell-portal",
					targetEnvCellId: 0xda550102,
				}),
				createProjectionEdge({
					edgeId: "edge-a",
					sourceEnvCellId: 0xda550100,
					sourceKind: "env-cell-portal",
					targetEnvCellId: 0xda550101,
				}),
			],
			root: {
				envCellId: 0xda550100,
				kind: "env-cell-root",
				landblockId: 0xda55ffff,
				rootNodeId: "env-cell:root",
			},
		});
		const first = deriveRuntimePortalOverlapResidency({
			aperturePadding: 0,
			envCellResourceMembership: [
				createEnvCellMembership(0xda550101),
				createEnvCellMembership(0xda550102),
			],
			frameState: createFrameState([0, 0, 0.1]),
			planeEpsilon: 0.25,
			portalApertureResources: [createPortalApertureResource()],
			projection,
			renderAnchorLandblockId: null,
			residency: {
				envCellId: 0xda550100,
				kind: "env-cell",
				landblockId: 0xda55ffff,
			},
		});
		const second = deriveRuntimePortalOverlapResidency({
			aperturePadding: 0,
			envCellResourceMembership: [
				createEnvCellMembership(0xda550101),
				createEnvCellMembership(0xda550102),
			],
			frameState: createFrameState([0.1, 0.1, -0.1]),
			planeEpsilon: 0.25,
			portalApertureResources: [createPortalApertureResource()],
			projection,
			renderAnchorLandblockId: null,
			residency: {
				envCellId: 0xda550100,
				kind: "env-cell",
				landblockId: 0xda55ffff,
			},
		});

		expect(first.baseOverlapEnvCellIds).toEqual([0xda550101, 0xda550102]);
		expect(second.signature).toBe(first.signature);
	});

	it("accepts one-hop env-cell overlap through a first-pass neighbor", () => {
		const overlap = deriveRuntimePortalOverlapResidency({
			aperturePadding: 0,
			envCellResourceMembership: [
				createEnvCellMembership(0xda550101),
				createEnvCellMembership(0xda550102),
			],
			frameState: createFrameState([0, 0, 0.1]),
			planeEpsilon: 0.25,
			portalApertureResources: [createPortalApertureResource()],
			projection: createProjectionRecord({
				edges: [
					createProjectionEdge({
						edgeId: "edge-a-b",
						sourceEnvCellId: 0xda550100,
						sourceKind: "env-cell-portal",
						targetEnvCellId: 0xda550101,
					}),
					createProjectionEdge({
						edgeId: "edge-b-c",
						sourceEnvCellId: 0xda550101,
						sourceKind: "env-cell-portal",
						targetEnvCellId: 0xda550102,
					}),
				],
				root: {
					envCellId: 0xda550100,
					kind: "env-cell-root",
					landblockId: 0xda55ffff,
					rootNodeId: "env-cell:root",
				},
			}),
			renderAnchorLandblockId: null,
			residency: {
				envCellId: 0xda550100,
				kind: "env-cell",
				landblockId: 0xda55ffff,
			},
		});

		expect(overlap.kind).toBe("portal-overlap");
		expect(overlap.baseOverlapEnvCellIds).toEqual([0xda550101, 0xda550102]);
		expect(overlap.boundaries.map((boundary) => boundary.boundaryId)).toEqual([
			"edge-a-b",
			"edge-b-c",
		]);
		expect(overlap.diagnostics).toMatchObject({
			oneHopAcceptedBoundaryCount: 1,
			oneHopCandidateCount: 1,
			oneHopSeedEnvCellCount: 1,
			oneHopTraversalCapped: true,
			primaryAcceptedBoundaryCount: 1,
			primaryCandidateCount: 1,
		});
	});

	it("does not traverse beyond one extra env-cell hop", () => {
		const overlap = deriveRuntimePortalOverlapResidency({
			aperturePadding: 0,
			envCellResourceMembership: [
				createEnvCellMembership(0xda550101),
				createEnvCellMembership(0xda550102),
				createEnvCellMembership(0xda550103),
			],
			frameState: createFrameState([0, 0, 0.1]),
			planeEpsilon: 0.25,
			portalApertureResources: [createPortalApertureResource()],
			projection: createProjectionRecord({
				edges: [
					createProjectionEdge({
						edgeId: "edge-a-b",
						sourceEnvCellId: 0xda550100,
						sourceKind: "env-cell-portal",
						targetEnvCellId: 0xda550101,
					}),
					createProjectionEdge({
						edgeId: "edge-b-c",
						sourceEnvCellId: 0xda550101,
						sourceKind: "env-cell-portal",
						targetEnvCellId: 0xda550102,
					}),
					createProjectionEdge({
						edgeId: "edge-c-d",
						sourceEnvCellId: 0xda550102,
						sourceKind: "env-cell-portal",
						targetEnvCellId: 0xda550103,
					}),
				],
				root: {
					envCellId: 0xda550100,
					kind: "env-cell-root",
					landblockId: 0xda55ffff,
					rootNodeId: "env-cell:root",
				},
			}),
			renderAnchorLandblockId: null,
			residency: {
				envCellId: 0xda550100,
				kind: "env-cell",
				landblockId: 0xda55ffff,
			},
		});

		expect(overlap.baseOverlapEnvCellIds).toEqual([0xda550101, 0xda550102]);
		expect(overlap.boundaries.map((boundary) => boundary.boundaryId)).toEqual([
			"edge-a-b",
			"edge-b-c",
		]);
	});

	it("rejects one-hop reverse edges back to the current env cell", () => {
		const overlap = deriveRuntimePortalOverlapResidency({
			aperturePadding: 0,
			envCellResourceMembership: [
				createEnvCellMembership(0xda550101),
				createEnvCellMembership(0xda550102),
			],
			frameState: createFrameState([0, 0, 0.1]),
			planeEpsilon: 0.25,
			portalApertureResources: [createPortalApertureResource()],
			projection: createProjectionRecord({
				edges: [
					createProjectionEdge({
						edgeId: "edge-a-b",
						sourceEnvCellId: 0xda550100,
						sourceKind: "env-cell-portal",
						targetEnvCellId: 0xda550101,
					}),
					createProjectionEdge({
						edgeId: "edge-b-a",
						sourceEnvCellId: 0xda550101,
						sourceKind: "env-cell-portal",
						targetEnvCellId: 0xda550100,
					}),
					createProjectionEdge({
						edgeId: "edge-b-c",
						sourceEnvCellId: 0xda550101,
						sourceKind: "env-cell-portal",
						targetEnvCellId: 0xda550102,
					}),
				],
				root: {
					envCellId: 0xda550100,
					kind: "env-cell-root",
					landblockId: 0xda55ffff,
					rootNodeId: "env-cell:root",
				},
			}),
			renderAnchorLandblockId: null,
			residency: {
				envCellId: 0xda550100,
				kind: "env-cell",
				landblockId: 0xda55ffff,
			},
		});

		expect(overlap.baseOverlapEnvCellIds).toEqual([0xda550101, 0xda550102]);
		expect(overlap.boundaries.map((boundary) => boundary.boundaryId)).toEqual([
			"edge-a-b",
			"edge-b-c",
		]);
		expect(overlap.diagnostics.oneHopCandidateCount).toBe(1);
	});

	it("accepts an outdoor building transition aperture", () => {
		const overlap = deriveRuntimePortalOverlapResidency({
			aperturePadding: 0,
			envCellResourceMembership: [createEnvCellMembership(0xda550101)],
			frameState: createFrameState([0, 0, 0.1]),
			planeEpsilon: 0.25,
			portalApertureResources: [
				createPortalApertureResource({ sourceKind: "building-transition" }),
			],
			projection: createProjectionRecord({
				edges: [
					createProjectionEdge({
						sourceEnvCellId: null,
						sourceKind: "building-transition",
						targetEnvCellId: 0xda550101,
					}),
				],
				root: {
					kind: "outdoor-root",
					landblockId: 0xda55ffff,
					rootNodeId: "outdoor:root",
				},
			}),
			renderAnchorLandblockId: null,
			residency: {
				kind: "outdoor-landblock",
				landblockId: 0xda55ffff,
			},
		});

		expect(overlap.kind).toBe("portal-overlap");
		expect(overlap.baseOverlapEnvCellIds).toEqual([0xda550101]);
		expect(overlap.requiresExteriorSeed).toBe(false);
		expect(overlap.boundaries[0]).toEqual(
			expect.objectContaining({ sourceKind: "building-transition" }),
		);
	});

	it("reports accepted overlap env cells with missing resources", () => {
		const overlap = deriveRuntimePortalOverlapResidency({
			aperturePadding: 0,
			envCellResourceMembership: [],
			frameState: createFrameState([0, 0, 0.1]),
			planeEpsilon: 0.25,
			portalApertureResources: [createPortalApertureResource()],
			projection: createProjectionRecord({
				edges: [
					createProjectionEdge({
						sourceEnvCellId: 0xda550100,
						sourceKind: "env-cell-portal",
						targetEnvCellId: 0xda550101,
					}),
				],
				root: {
					envCellId: 0xda550100,
					kind: "env-cell-root",
					landblockId: 0xda55ffff,
					rootNodeId: "env-cell:root",
				},
			}),
			renderAnchorLandblockId: null,
			residency: {
				envCellId: 0xda550100,
				kind: "env-cell",
				landblockId: 0xda55ffff,
			},
		});

		expect(overlap.kind).toBe("portal-overlap");
		expect(overlap.baseOverlapEnvCellIds).toEqual([0xda550101]);
		expect(overlap.missingResourceEnvCellIds).toEqual([0xda550101]);
	});

	it("accepts an env-cell outdoor crossing and requests exterior seeding", () => {
		const overlap = deriveRuntimePortalOverlapResidency({
			aperturePadding: 0,
			envCellResourceMembership: [createEnvCellMembership(0xda550100)],
			frameState: createFrameState([0, 0, 0.1]),
			planeEpsilon: 0.25,
			portalApertureResources: [
				createPortalApertureResource({ sourceKind: "building-transition" }),
			],
			projection: createProjectionRecord({
				outdoorSceneCrossings: [createOutdoorSceneCrossing()],
				root: {
					envCellId: 0xda550100,
					kind: "env-cell-root",
					landblockId: 0xda55ffff,
					rootNodeId: "env-cell:root",
				},
			}),
			renderAnchorLandblockId: null,
			residency: {
				envCellId: 0xda550100,
				kind: "env-cell",
				landblockId: 0xda55ffff,
			},
		});

		expect(overlap.kind).toBe("portal-overlap");
		expect(overlap.baseOverlapEnvCellIds).toEqual([0xda550100]);
		expect(overlap.requiresExteriorSeed).toBe(true);
	});
});

function createFrameState(position: readonly [number, number, number]) {
	return {
		camera: {
			pitchRadians: 0,
			position,
			yawRadians: 0,
		},
		timeSeconds: 0,
	};
}

function createEnvCellMembership(envCellId: number) {
	return {
		envCellId,
		envCellStaticObjectDrawUnitIds: [],
		landblockId: 0xda55ffff,
		sharedEnvCellStaticObjectDrawUnits: 0,
		structuredInteriorDrawUnitIds: [`structured:${envCellId.toString(16)}`],
	};
}

function createPortalApertureResource(
	options: {
		readonly sourceKind?: "env-cell-portal" | "building-transition";
	} = {},
): StaticPortalApertureResource {
	const sourceKind = options.sourceKind ?? "env-cell-portal";
	return {
		apertureResourceId: `portal-resource:${sourceKind}`,
		coordinateSpace: "landblock-render-local",
		indices: [0, 1, 2, 0, 2, 3],
		kind: "portal-aperture-resource",
		landblockId: 0xda55ffff,
		ranges: [
			{
				firstIndex: 0,
				indexCount: 6,
				rangeId: "range:portal",
				source:
					sourceKind === "env-cell-portal"
						? {
								envCellId: 0xda550100,
								kind: "env-cell-portal",
								landblockId: 0xda55ffff,
								polygonId: null,
								portalId: "portal",
								sourceIndex: 0,
							}
						: {
								buildingInstanceId: "building",
								buildingPortalId: "portal",
								buildingPortalSourceIndex: 0,
								kind: "building-transition",
								landblockId: 0xda55ffff,
								linkedEnvCellIds: [0xda550101],
								otherCellId: 0x0101,
								otherPortalId: 1,
								polyId: 0,
								portalId: "portal",
								portalIndex: 0,
								sourceAssetId: "asset",
								sourceDid: 1,
								targetEnvCellId: 0xda550101,
							},
				sourceId: "source:portal",
				sourceKind,
			},
		],
		sourceDomain:
			sourceKind === "env-cell-portal"
				? "env-cell-system"
				: "outdoor-buildings",
		vertices: [
			{ x: -1, y: -1, z: 0 },
			{ x: 1, y: -1, z: 0 },
			{ x: 1, y: 1, z: 0 },
			{ x: -1, y: 1, z: 0 },
		],
	};
}

function createProjectionRecord(options: {
	readonly edges?: readonly StaticPortalProjectionRecord["edges"][number][];
	readonly outdoorSceneCrossings?: readonly StaticPortalProjectionRecord["outdoorSceneCrossings"][number][];
	readonly root: StaticPortalProjectionRecord["root"];
}): StaticPortalProjectionRecord {
	return {
		adjacency: [],
		componentEdges: [],
		components: [],
		diagnostics: {
			acceptedTransitionRootCount: 0,
			componentCount: 0,
			componentInternalEdgeCount: 0,
			cyclicComponentCount: 0,
			envCellPortalEdgesRejectedMissingAperture: 0,
			envCellPortalEdgesRejectedSourceNotOutsideVisible: 0,
			envCellPortalEdgesRejectedTargetNotOutsideVisible: 0,
			envCellPortalEdgesRetained: options.edges?.length ?? 0,
			maxRenderLayer: 0,
			outboundOutdoorCrossingCandidateCount:
				options.outdoorSceneCrossings?.length ?? 0,
			outboundOutdoorCrossingRetainedCount:
				options.outdoorSceneCrossings?.length ?? 0,
			outboundOutdoorCrossingSkippedUnreachableTarget: 0,
			outsideVisibleEnvCellCount: 0,
			transitionRootCandidateCount: 0,
		},
		edges: options.edges ?? [],
		incomingEdges: [],
		kind: "portal-projection",
		landblockId: 0xda55ffff,
		nodes: [],
		outdoorSceneCrossings: options.outdoorSceneCrossings ?? [],
		renderLayerByEnvCellId: [],
		renderLayers: [],
		root: options.root,
		rootNodeId: options.root.rootNodeId,
		sourceRevisionKey: "projection",
	};
}

function createProjectionEdge(options: {
	readonly edgeId?: string;
	readonly sourceEnvCellId: number | null;
	readonly sourceKind: "env-cell-portal" | "building-transition";
	readonly targetEnvCellId: number;
}): StaticPortalProjectionRecord["edges"][number] {
	return {
		apertureRangeId: "range:portal",
		apertureSourceId: "source:portal",
		edgeId: options.edgeId ?? "edge:portal",
		linkId: `link:${options.edgeId ?? "portal"}`,
		provenance:
			options.sourceKind === "env-cell-portal"
				? {
						kind: "env-cell-portal",
						polygonId: null,
						sourceEnvCellId: options.sourceEnvCellId ?? 0xda550100,
						sourceIndex: 0,
						sourcePortalId: "portal",
						targetEnvCellId: options.targetEnvCellId,
						targetPortalId: "target",
					}
				: {
						apertureResourceId: "portal-resource:building-transition",
						buildingInstanceId: "building",
						buildingPortalId: "portal",
						kind: "building-transition",
						portalId: "portal",
						targetEnvCellId: options.targetEnvCellId,
					},
		sourceEnvCellId: options.sourceEnvCellId,
		sourceKind: options.sourceKind,
		sourceNodeId: options.sourceEnvCellId === null ? "outdoor" : "source",
		targetEnvCellId: options.targetEnvCellId,
		targetNodeId: "target",
	};
}

function createOutdoorSceneCrossing(): StaticPortalProjectionRecord["outdoorSceneCrossings"][number] {
	return {
		apertureRangeId: "range:portal",
		apertureSourceId: "source:portal",
		crossingId: "crossing:portal",
		linkId: "link:crossing",
		outdoorLandblockId: 0xda55ffff,
		provenance: {
			apertureResourceId: "portal-resource:building-transition",
			buildingInstanceId: "building",
			buildingPortalId: "portal",
			kind: "building-transition",
			portalId: "portal",
			targetEnvCellId: 0xda550100,
		},
		targetEnvCellId: 0xda550100,
	};
}
