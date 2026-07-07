import type {
	PortalBaseOverlapEnvCellPlan,
	PortalBaseOverlapPlan,
	PortalBaseOverlapReason,
	PortalProjectionFrameBaseEntryPlan,
	PortalProjectionFrameGraphPlan,
	PortalProjectionFrameMaskEdgePlan,
	PortalProjectionFrameOutdoorCrossingPlan,
	PortalProjectionFrameRenderEntryPlan,
	PortalFrameNodeResources,
	PortalFrameSceneSource,
	PortalFrameWorkPlan,
} from "../renderer/types";
import type { StaticPortalProjectionRecord } from "../static/contracts";
import { PortalApertureFrameResourceBuilder } from "./portal-aperture-frame-resources";
import type { EnvCellResourceMembership } from "./env-cell-resource-membership";

export interface PortalProjectionFramePlanInput {
	readonly landblockId: number;
	readonly envCellResourceMembership: readonly EnvCellResourceMembership[];
	readonly maxRenderEntries: number;
	readonly maxDepth: number;
	readonly maxMaskEdges: number;
	readonly portalOverlap?: PortalProjectionFrameOverlapInput;
	readonly projection: StaticPortalProjectionRecord;
}

interface PortalProjectionFrameOverlapInput {
	readonly baseOverlapEnvCellIds: readonly number[];
	readonly boundaries: readonly PortalProjectionFrameOverlapBoundaryInput[];
	readonly missingResourceEnvCellIds: readonly number[];
	readonly requiresExteriorSeed: boolean;
	readonly signature: string;
}

interface PortalProjectionFrameOverlapBoundaryInput {
	readonly apertureRangeId: string;
	readonly sourceKind: "env-cell-portal" | "building-transition";
	readonly targetEnvCellId: number;
}

interface PortalFrameIndexes {
	readonly membershipByLandblock: ReadonlyMap<
		number,
		ReadonlyMap<number, EnvCellResourceMembership>
	>;
}

export function createPortalProjectionFramePlan(
	input: PortalProjectionFramePlanInput,
): PortalFrameWorkPlan | null {
	if (input.projection.landblockId !== input.landblockId) {
		throw new Error(
			`Portal projection landblock ${formatHex32(input.projection.landblockId)} does not match frame-plan landblock ${formatHex32(input.landblockId)}.`,
		);
	}
	if (input.projection.renderLayers.length === 0) {
		return null;
	}

	const indexes = createPortalFrameIndexes({
		envCellResourceMembership: input.envCellResourceMembership,
	});
	const baseEntry = createPortalProjectionFrameBaseEntry({
		indexes,
		landblockId: input.landblockId,
		projection: input.projection,
	});
	if (baseEntry === null) {
		return null;
	}
	const edgeById = new Map(
		input.projection.edges.map((edge) => [edge.edgeId, edge]),
	);
	const renderLayerByEnvCellId = new Map(
		input.projection.renderLayerByEnvCellId.map((entry) => [
			entry.envCellId,
			entry.renderLayer,
		]),
	);
	const incomingEdgeIdsByEnvCellId = new Map(
		input.projection.incomingEdges.map((entry) => [
			entry.targetEnvCellId,
			entry.edgeIds,
		]),
	);
	const apertureBuilder = new PortalApertureFrameResourceBuilder();
	const renderEntries: PortalProjectionFrameRenderEntryPlan[] = [];
	const renderLayers: {
		renderLayer: number;
		renderEntryIds: number[];
	}[] = [];
	let renderEntriesSkippedByLayerCap = 0;
	let renderEntriesSkippedByMaxRenderEntries = 0;
	let missingResourceMembershipCount = 0;

	for (const layer of input.projection.renderLayers) {
		if (layer.renderLayer > input.maxDepth) {
			renderEntriesSkippedByLayerCap += layer.envCellIds.length;
			continue;
		}
		if (
			input.projection.root.kind === "env-cell-root" &&
			layer.renderLayer === 0
		) {
			continue;
		}
		const renderEntryIds: number[] = [];
		for (const envCellId of layer.envCellIds) {
			if (
				input.projection.root.kind === "env-cell-root" &&
				envCellId === input.projection.root.envCellId
			) {
				continue;
			}
			if (renderEntries.length >= input.maxRenderEntries) {
				renderEntriesSkippedByMaxRenderEntries += 1;
				continue;
			}
			const scene = {
				envCellId,
				kind: "env-cell-direct",
				landblockId: input.landblockId,
			} as const;
			const resources = createNodeResources(scene, indexes);
			if (resources.resourceState !== "ready") {
				missingResourceMembershipCount += 1;
			}
			const renderEntry: PortalProjectionFrameRenderEntryPlan = {
				debugStackLabel: createPortalProjectionRenderEntryLabel({
					envCellId,
					landblockId: input.landblockId,
					renderLayer: layer.renderLayer,
				}),
				envCellId,
				incomingMaskEdgeIds: [],
				landblockId: input.landblockId,
				renderEntryId: renderEntries.length,
				renderLayer: layer.renderLayer,
				resources,
			};
			renderEntries.push(renderEntry);
			renderEntryIds.push(renderEntry.renderEntryId);
		}
		if (renderEntryIds.length > 0) {
			renderLayers.push({
				renderEntryIds,
				renderLayer: layer.renderLayer,
			});
		}
	}

	if (
		renderEntries.length === 0 &&
		input.projection.root.kind === "outdoor-root"
	) {
		return null;
	}

	const maskEdges: PortalProjectionFrameMaskEdgePlan[] = [];
	let maskEdgesSkippedByLayerCap = 0;
	let maskEdgesSkippedByMaxMaskEdges = 0;
	for (const renderEntry of renderEntries) {
		const incomingEdgeIds =
			incomingEdgeIdsByEnvCellId.get(renderEntry.envCellId) ?? [];
		const mutableIncomingMaskEdgeIds: number[] = [];
		for (const projectionEdgeId of incomingEdgeIds) {
			const projectionEdge = edgeById.get(projectionEdgeId);
			if (!projectionEdge) {
				throw new Error(
					`Portal projection incoming edge ${projectionEdgeId} is missing from edge table.`,
				);
			}
			const sourceRenderLayer =
				projectionEdge.sourceEnvCellId === null
					? 0
					: renderLayerByEnvCellId.get(projectionEdge.sourceEnvCellId);
			if (
				sourceRenderLayer !== undefined &&
				sourceRenderLayer > input.maxDepth
			) {
				maskEdgesSkippedByLayerCap += 1;
				continue;
			}
			if (maskEdges.length >= input.maxMaskEdges) {
				maskEdgesSkippedByMaxMaskEdges += 1;
				continue;
			}
			const apertureRangeId = apertureBuilder.addEdgeResource({
				apertureRangeId: projectionEdge.apertureRangeId,
				apertureSourceId: projectionEdge.apertureSourceId,
				duplicateKeyParts: [
					renderEntry.renderEntryId,
					projectionEdge.sourceEnvCellId ?? "outdoor",
					projectionEdge.targetEnvCellId,
				],
				linkId: projectionEdge.linkId,
				sourceKind: projectionEdge.sourceKind,
			});
			if (!apertureRangeId) {
				continue;
			}
			const edgeId = maskEdges.length;
			maskEdges.push({
				apertureRangeId,
				apertureSourceId: projectionEdge.apertureSourceId,
				edgeId,
				linkId: projectionEdge.linkId,
				renderEntryId: renderEntry.renderEntryId,
				renderLayer: renderEntry.renderLayer,
				sourceEnvCellId: projectionEdge.sourceEnvCellId,
				sourceKind: projectionEdge.sourceKind,
				targetEnvCellId: projectionEdge.targetEnvCellId,
			});
			mutableIncomingMaskEdgeIds.push(edgeId);
		}
		replacePortalProjectionRenderEntry(
			renderEntries,
			renderEntry.renderEntryId,
			{
				...renderEntry,
				incomingMaskEdgeIds: mutableIncomingMaskEdgeIds,
			},
		);
	}

	const selectedEnvCellIds = new Set<number>(
		renderEntries.map((entry) => entry.envCellId),
	);
	if (input.projection.root.kind === "env-cell-root") {
		selectedEnvCellIds.add(input.projection.root.envCellId);
	}
	const outdoorCrossingResult = createPortalProjectionOutdoorCrossings({
		apertureBuilder,
		maxDepth: input.maxDepth,
		projection: input.projection,
		renderLayerByEnvCellId,
		selectedEnvCellIds,
	});

	const aperturePlan = apertureBuilder.build({
		transitionRootCandidateCount:
			input.projection.diagnostics.transitionRootCandidateCount,
		transitionRootCount:
			input.projection.diagnostics.acceptedTransitionRootCount,
		transitionRootsRejectedNotSeenOutside: 0,
		transitionRootsRejectedUnknownSeenOutside: 0,
	});
	const graph: PortalProjectionFrameGraphPlan = {
		apertureResources: aperturePlan.resources,
		baseEntry,
		diagnostics: aperturePlan.diagnostics,
		maskEdges,
		outdoorCrossings: outdoorCrossingResult.outdoorCrossings,
		projectionDiagnostics: {
			componentCount: input.projection.diagnostics.componentCount,
			componentInternalEdgeCount:
				input.projection.diagnostics.componentInternalEdgeCount,
			cyclicComponentCount: input.projection.diagnostics.cyclicComponentCount,
			maskEdgesSkippedByLayerCap,
			maskEdgesSkippedByMaxMaskEdges,
			maxProjectionRenderLayer: input.projection.diagnostics.maxRenderLayer,
			maxSelectedRenderLayer: Math.max(
				0,
				...renderLayers.map((layer) => layer.renderLayer),
			),
			missingResourceMembershipCount,
			outdoorCrossingCount: outdoorCrossingResult.outdoorCrossings.length,
			outdoorCrossingsSkippedByLayerCap:
				outdoorCrossingResult.outdoorCrossingsSkippedByLayerCap,
			outdoorCrossingsSkippedByUnselectedTarget:
				outdoorCrossingResult.outdoorCrossingsSkippedByUnselectedTarget,
			projectedEnvCellCount: input.projection.nodes.length,
			renderEntriesSkippedByLayerCap,
			renderEntriesSkippedByMaxRenderEntries,
			renderEntryCount: renderEntries.length,
		},
		renderEntries,
		renderLayers,
	};

	const baseOverlap = createPortalBaseOverlapPlan({
		indexes,
		landblockId: input.landblockId,
		portalOverlap: input.portalOverlap ?? null,
	});

	return {
		baseOverlap,
		kind: "direct-env-cell",
		layeredGraph: graph,
		mode: "portal-projection",
	};
}

function createPortalBaseOverlapPlan(options: {
	readonly indexes: PortalFrameIndexes;
	readonly landblockId: number;
	readonly portalOverlap: PortalProjectionFrameOverlapInput | null;
}): PortalBaseOverlapPlan {
	if (!options.portalOverlap || options.portalOverlap.signature === "none") {
		return createEmptyPortalBaseOverlapPlan();
	}
	const missingResourceEnvCellIds = new Set(
		options.portalOverlap.missingResourceEnvCellIds,
	);
	const boundariesByTargetEnvCellId = new Map<
		number,
		PortalProjectionFrameOverlapBoundaryInput[]
	>();
	for (const boundary of options.portalOverlap.boundaries) {
		const boundaries = boundariesByTargetEnvCellId.get(
			boundary.targetEnvCellId,
		);
		if (boundaries) {
			boundaries.push(boundary);
			continue;
		}
		boundariesByTargetEnvCellId.set(boundary.targetEnvCellId, [boundary]);
	}
	const envCells = [...new Set(options.portalOverlap.baseOverlapEnvCellIds)]
		.sort(compareNumbers)
		.map((envCellId): PortalBaseOverlapEnvCellPlan => {
			const scene = {
				envCellId,
				kind: "env-cell-direct",
				landblockId: options.landblockId,
			} as const;
			const resources = createNodeResources(scene, options.indexes);
			const reasons = (boundariesByTargetEnvCellId.get(envCellId) ?? [])
				.map(
					(boundary): PortalBaseOverlapReason => ({
						apertureRangeId: boundary.apertureRangeId,
						kind: boundary.sourceKind,
					}),
				)
				.sort(comparePortalBaseOverlapReasons);
			return {
				envCellId,
				landblockId: options.landblockId,
				reasons,
				resources,
			};
		});
	return {
		diagnostics: {
			envCellCount: envCells.length,
			missingResourceEnvCellCount: missingResourceEnvCellIds.size,
		},
		envCells,
		overlapSignature: options.portalOverlap.signature,
		requiresExteriorSeed: options.portalOverlap.requiresExteriorSeed,
	};
}

function createEmptyPortalBaseOverlapPlan(): PortalBaseOverlapPlan {
	return {
		diagnostics: {
			envCellCount: 0,
			missingResourceEnvCellCount: 0,
		},
		envCells: [],
		overlapSignature: "none",
		requiresExteriorSeed: false,
	};
}

function comparePortalBaseOverlapReasons(
	left: PortalBaseOverlapReason,
	right: PortalBaseOverlapReason,
): number {
	return (
		left.kind.localeCompare(right.kind) ||
		left.apertureRangeId.localeCompare(right.apertureRangeId)
	);
}

function compareNumbers(left: number, right: number): number {
	return left - right;
}

function createPortalProjectionOutdoorCrossings(options: {
	readonly apertureBuilder: PortalApertureFrameResourceBuilder;
	readonly maxDepth: number;
	readonly projection: StaticPortalProjectionRecord;
	readonly renderLayerByEnvCellId: ReadonlyMap<number, number>;
	readonly selectedEnvCellIds: ReadonlySet<number>;
}): {
	readonly outdoorCrossings: PortalProjectionFrameOutdoorCrossingPlan[];
	readonly outdoorCrossingsSkippedByLayerCap: number;
	readonly outdoorCrossingsSkippedByUnselectedTarget: number;
} {
	const outdoorCrossings: PortalProjectionFrameOutdoorCrossingPlan[] = [];
	let outdoorCrossingsSkippedByLayerCap = 0;
	let outdoorCrossingsSkippedByUnselectedTarget = 0;
	for (const crossing of options.projection.outdoorSceneCrossings) {
		const targetLayer =
			options.projection.root.kind === "env-cell-root" &&
			crossing.targetEnvCellId === options.projection.root.envCellId
				? 0
				: options.renderLayerByEnvCellId.get(crossing.targetEnvCellId);
		if (targetLayer === undefined) {
			outdoorCrossingsSkippedByUnselectedTarget += 1;
			continue;
		}
		if (targetLayer > options.maxDepth) {
			outdoorCrossingsSkippedByLayerCap += 1;
			continue;
		}
		if (!options.selectedEnvCellIds.has(crossing.targetEnvCellId)) {
			outdoorCrossingsSkippedByUnselectedTarget += 1;
			continue;
		}
		const apertureRangeId = options.apertureBuilder.addEdgeResource({
			apertureRangeId: crossing.apertureRangeId,
			apertureSourceId: crossing.apertureSourceId,
			duplicateKeyParts: ["outdoor-crossing", crossing.crossingId],
			linkId: crossing.linkId,
			sourceKind: "building-transition",
		});
		if (!apertureRangeId) {
			continue;
		}
		outdoorCrossings.push({
			apertureRangeId,
			apertureSourceId: crossing.apertureSourceId,
			crossingId: outdoorCrossings.length,
			linkId: crossing.linkId,
			outdoorLandblockId: crossing.outdoorLandblockId,
			targetEnvCellId: crossing.targetEnvCellId,
		});
	}
	return {
		outdoorCrossings,
		outdoorCrossingsSkippedByLayerCap,
		outdoorCrossingsSkippedByUnselectedTarget,
	};
}

function createPortalProjectionFrameBaseEntry(options: {
	readonly indexes: PortalFrameIndexes;
	readonly landblockId: number;
	readonly projection: StaticPortalProjectionRecord;
}): PortalProjectionFrameBaseEntryPlan | null {
	switch (options.projection.root.kind) {
		case "outdoor-root":
			return {
				debugStackLabel: createOutdoorRootPortalStackLabel(options.landblockId),
				scene: {
					kind: "outdoor-target",
					landblockId: options.landblockId,
				},
			};
		case "env-cell-root": {
			const scene = {
				envCellId: options.projection.root.envCellId,
				kind: "env-cell-direct",
				landblockId: options.landblockId,
			} as const;
			return {
				debugStackLabel: createPortalProjectionRenderEntryLabel({
					envCellId: scene.envCellId,
					landblockId: scene.landblockId,
					renderLayer: 0,
				}),
				resources: createNodeResources(scene, options.indexes),
				scene,
			};
		}
	}
}

function createPortalFrameIndexes(input: {
	readonly envCellResourceMembership: readonly EnvCellResourceMembership[];
}): PortalFrameIndexes {
	const membershipByLandblock = new Map<
		number,
		Map<number, EnvCellResourceMembership>
	>();
	for (const membership of input.envCellResourceMembership) {
		getOrCreateNestedMap(membershipByLandblock, membership.landblockId).set(
			membership.envCellId,
			membership,
		);
	}

	return {
		membershipByLandblock,
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

function formatHex32(value: number): string {
	return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}

function createOutdoorRootPortalStackLabel(landblockId: number): string {
	return `outdoor-root:${formatHex32(landblockId)}`;
}

function createPortalProjectionRenderEntryLabel(options: {
	readonly envCellId: number;
	readonly landblockId: number;
	readonly renderLayer: number;
}): string {
	return `${createOutdoorRootPortalStackLabel(options.landblockId)}/layer:${options.renderLayer}/cell:${formatHex32(options.envCellId)}`;
}

function replacePortalProjectionRenderEntry(
	entries: PortalProjectionFrameRenderEntryPlan[],
	renderEntryId: number,
	entry: PortalProjectionFrameRenderEntryPlan,
): void {
	if (entries[renderEntryId]?.renderEntryId !== renderEntryId) {
		throw new Error(
			`Portal projection render entry ${renderEntryId} is missing or out of order.`,
		);
	}
	entries[renderEntryId] = entry;
}
