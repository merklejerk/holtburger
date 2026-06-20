import type {
	PortalApertureVertex,
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
	PortalTraversalVisibleCell,
	StaticSceneCameraResidency,
} from "./static-scene-query";
import {
	type PortalApertureFrameResourcePlan,
	PortalApertureFrameResourceBuilder,
} from "./portal-aperture-frame-resources";
import { createOutdoorLandblockRootTranslation } from "./static-placement";

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

export function createDirectEnvCellFramePlan(
	input: DirectEnvCellFramePlanInput,
): PortalFrameWorkPlan | null {
	if (input.currentCameraResidency.kind !== "env-cell") {
		return null;
	}
	if (input.traversalPlan.portalViewGroups.length === 0) {
		return null;
	}

	const membershipsByKey = new Map(
		input.rendererEnvCellResourceMembership.map((membership) => [
			createEnvCellKey(membership.landblockId, membership.envCellId),
			membership,
		]),
	);
	const aperturePlan = createPortalAperturePlan({
		portalInteriorRecords: input.portalInteriorRecords,
		renderAnchorLandblockId: input.renderAnchorLandblockId,
		traversalPlan: input.traversalPlan,
	});

	return {
		baseScene: {
			envCellId: input.currentCameraResidency.envCellId,
			kind: "env-cell-direct",
			landblockId: input.currentCameraResidency.landblockId,
		},
		directEnvCellDraws: input.traversalPlan.portalViewGroups.map((viewGroup) =>
			createDirectEnvCellDrawRequest(viewGroup, membershipsByKey),
		),
		kind: "direct-env-cell",
		mode: "portal-traversal",
		portalApertureDiagnostics: aperturePlan.diagnostics,
		portalApertureGeometryResources: aperturePlan.resources,
		portalApertureMaskPasses: aperturePlan.maskPasses,
		transitionSceneCrossings: [],
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

	const transitionRoots = createOutdoorTransitionRootGroups(renderableBatches);
	if (transitionRoots.length === 0) {
		return null;
	}

	const membershipsByKey = new Map(
		input.rendererEnvCellResourceMembership.map((membership) => [
			createEnvCellKey(membership.landblockId, membership.envCellId),
			membership,
		]),
	);
	const directEnvCellDraws: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["directEnvCellDraws"][number][] = [];
	const apertureBuilder = new PortalApertureFrameResourceBuilder();
	const transitionSceneCrossings: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["transitionSceneCrossings"][number][] = [];
	const outdoorRootPortalStackId = createOutdoorRootPortalStackId(
		input.landblockId,
	);
	const emittedPortalStackIds = new Set<string>();

	for (const root of transitionRoots) {
		const transitionRootPortalStackId = createOutdoorTransitionPortalStackId({
			envCellId: root.envCellId,
			landblockId: input.landblockId,
		});
		directEnvCellDraws.push(
			createDirectEnvCellDrawRequest(
				{
					envCellId: root.envCellId,
					landblockId: input.landblockId,
					portalStackId: transitionRootPortalStackId,
					traversalDepth: 1,
				},
				membershipsByKey,
			),
		);
		emittedPortalStackIds.add(transitionRootPortalStackId);

		for (const range of root.ranges) {
			const vertices = triangulateTransitionApertureRange(
				range.batch,
				range.range,
				createOutdoorLandblockRootTranslation(
					input.landblockId,
					input.renderAnchorLandblockId,
				),
			);
			if (vertices.length === 0) {
				continue;
			}
			apertureBuilder.addMaskPass({
				apertureSourceId: createBuildingTransitionApertureSourceId({
					apertureBatchId: range.batch.apertureBatchId,
					portalId: range.range.portalId,
				}),
				cullMode: "none",
				linkId: createOutdoorTransitionLinkId({
					apertureBatchId: range.batch.apertureBatchId,
					envCellId: root.envCellId,
					portalId: range.range.portalId,
				}),
				parentStencilRef: null,
				portalStackId: transitionRootPortalStackId,
				source: {
					kind: "outdoor-target",
					landblockId: input.landblockId,
				},
				sourceKind: "building-transition",
				sourcePortalStackId: outdoorRootPortalStackId,
				stencilRef: 1,
				target: {
					envCellId: root.envCellId,
					kind: "env-cell-direct",
					landblockId: input.landblockId,
				},
				traversalDepth: 1,
				vertices,
			});
			transitionSceneCrossings.push({
				apertureBatchId: range.batch.apertureBatchId,
				aperturePortalId: range.range.portalId,
				from: { kind: "outdoor", landblockId: input.landblockId },
				landblockId: input.landblockId,
				linkedEnvCellIds: [root.envCellId],
				to: {
					envCellId: root.envCellId,
					kind: "env-cell",
					landblockId: input.landblockId,
				},
			});
		}

		const traversalPlan = input.traversalPlansByStartEnvCellId.get(
			root.envCellId,
		);
		if (!traversalPlan) {
			continue;
		}
		appendTransitionRootTraversal({
			directEnvCellDraws,
			emittedPortalStackIds,
			apertureBuilder,
			membershipsByKey,
			portalInteriorRecords: input.portalInteriorRecords,
			renderAnchorLandblockId: input.renderAnchorLandblockId,
			transitionRootPortalStackId,
			traversalPlan,
		});
	}

	const aperturePlan = apertureBuilder.build({
		transitionRootCount: transitionRoots.length,
	});
	if (aperturePlan.maskPasses.length === 0) {
		return null;
	}

	return {
		baseScene: {
			kind: "outdoor-target",
			landblockId: input.landblockId,
		},
		directEnvCellDraws,
		kind: "direct-env-cell",
		mode: "portal-traversal",
		portalApertureDiagnostics: aperturePlan.diagnostics,
		portalApertureGeometryResources: aperturePlan.resources,
		portalApertureMaskPasses: aperturePlan.maskPasses,
		transitionSceneCrossings,
	};
}

function createDirectEnvCellDrawRequest(
	cell: Pick<
		PortalTraversalVisibleCell,
		"envCellId" | "landblockId" | "portalStackId" | "traversalDepth"
	>,
	membershipsByKey: ReadonlyMap<string, RendererEnvCellResourceMembership>,
): Extract<
	PortalFrameWorkPlan,
	{ readonly kind: "direct-env-cell" }
>["directEnvCellDraws"][number] {
	const membership =
		membershipsByKey.get(createEnvCellKey(cell.landblockId, cell.envCellId)) ??
		null;
	const structuredInteriorDrawUnitIds =
		membership?.structuredInteriorDrawUnitIds ?? [];
	const envCellStaticObjectDrawUnitIds =
		membership?.envCellStaticObjectDrawUnitIds ?? [];
	const hasDrawResources =
		structuredInteriorDrawUnitIds.length > 0 ||
		envCellStaticObjectDrawUnitIds.length > 0;
	return {
		envCellId: cell.envCellId,
		envCellStaticObjectDrawUnitIds,
		landblockId: cell.landblockId,
		portalStackId: cell.portalStackId,
		resourceState: hasDrawResources ? "ready" : "missing-resources",
		structuredInteriorDrawUnitIds,
		traversalDepth: cell.traversalDepth,
	};
}

function createEnvCellKey(landblockId: number, envCellId: number): string {
	return `${landblockId >>> 0}:${envCellId >>> 0}`;
}

function createRootPortalStackId(startEnvCellId: number): string {
	return `root:${formatHex32(startEnvCellId)}`;
}

function createOutdoorRootPortalStackId(landblockId: number): string {
	return `outdoor-root:${formatHex32(landblockId)}`;
}

function createOutdoorTransitionPortalStackId(options: {
	readonly envCellId: number;
	readonly landblockId: number;
}): string {
	return `${createOutdoorRootPortalStackId(options.landblockId)}/transition:${formatHex32(options.envCellId)}`;
}

function createOutdoorTransitionChildPortalStackId(options: {
	readonly sourceRootEnvCellId: number;
	readonly transitionRootPortalStackId: string;
	readonly traversalPortalStackId: string;
}): string {
	const rootPrefix = createRootPortalStackId(options.sourceRootEnvCellId);
	if (options.traversalPortalStackId === rootPrefix) {
		return options.transitionRootPortalStackId;
	}
	if (!options.traversalPortalStackId.startsWith(`${rootPrefix}/`)) {
		throw new Error(
			`Traversal portal stack ${options.traversalPortalStackId} does not start at ${rootPrefix}.`,
		);
	}
	return `${options.transitionRootPortalStackId}/${options.traversalPortalStackId.slice(rootPrefix.length + 1)}`;
}

function formatHex32(value: number): string {
	return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}

function createPortalAperturePlan(options: {
	readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly renderAnchorLandblockId: number | null;
	readonly traversalPlan: PortalTraversalPlan;
}): PortalApertureFrameResourcePlan {
	const apertureBuilder = new PortalApertureFrameResourceBuilder();
	const envCellsByKey = createPortalEnvCellsByKey(
		options.portalInteriorRecords,
	);
	const viewGroupsByPortalStackId = new Map(
		options.traversalPlan.portalViewGroups.map((viewGroup) => [
			viewGroup.portalStackId,
			viewGroup,
		]),
	);
	const maskablePortalStackIds = new Set<string>([
		createRootPortalStackId(options.traversalPlan.startEnvCellId),
	]);
	for (const viewGroup of options.traversalPlan.portalViewGroups) {
		if (viewGroup.parentPortalStackId === null) {
			continue;
		}
		if (!maskablePortalStackIds.has(viewGroup.parentPortalStackId)) {
			continue;
		}
		const parentViewGroup = viewGroupsByPortalStackId.get(
			viewGroup.parentPortalStackId,
		);
		if (!parentViewGroup) {
			continue;
		}
		const parentStencilRef =
			parentViewGroup.traversalDepth === 0
				? null
				: parentViewGroup.traversalDepth;
		if (viewGroup.traversalDepth > 254) {
			throw new Error("Direct env-cell portal plan exceeded 254 stencil refs.");
		}
		let emittedMaskPass = false;
		for (const edge of viewGroup.apertureEdges) {
			const sourceEnvCell = envCellsByKey.get(
				createEnvCellKey(viewGroup.landblockId, edge.sourceEnvCellId),
			);
			const aperture = sourceEnvCell?.portalApertures.find(
				(candidate) => candidate.portalId === edge.sourcePortalId,
			);
			if (!sourceEnvCell || !aperture) {
				continue;
			}
			const vertices = triangulateEnvCellPortalAperture(
				aperture.points,
				buildAcPlacementMatrix(sourceEnvCell.localPlacement, AC_UNIT_SCALE),
				createOutdoorLandblockRootTranslation(
					viewGroup.landblockId,
					options.renderAnchorLandblockId,
				),
			);
			if (vertices.length === 0) {
				continue;
			}
			emittedMaskPass =
				apertureBuilder.addMaskPass({
					apertureSourceId: createEnvCellPortalApertureSourceId({
						envCellId: edge.sourceEnvCellId,
						landblockId: viewGroup.landblockId,
						portalId: edge.sourcePortalId,
					}),
					cullMode: "none",
					linkId: edge.linkId,
					parentStencilRef: parentStencilRef ?? null,
					portalStackId: viewGroup.portalStackId,
					source: {
						envCellId: edge.sourceEnvCellId,
						kind: "env-cell-direct",
						landblockId: viewGroup.landblockId,
					},
					sourceKind: "env-cell-portal",
					sourcePortalStackId: viewGroup.parentPortalStackId,
					stencilRef: viewGroup.traversalDepth,
					target: {
						envCellId: viewGroup.envCellId,
						kind: "env-cell-direct",
						landblockId: viewGroup.landblockId,
					},
					traversalDepth: viewGroup.traversalDepth,
					vertices,
				}) || emittedMaskPass;
		}
		if (emittedMaskPass) {
			maskablePortalStackIds.add(viewGroup.portalStackId);
		}
	}

	return apertureBuilder.build({ transitionRootCount: 0 });
}

function appendTransitionRootTraversal(options: {
	readonly apertureBuilder: PortalApertureFrameResourceBuilder;
	readonly directEnvCellDraws: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["directEnvCellDraws"][number][];
	readonly emittedPortalStackIds: Set<string>;
	readonly membershipsByKey: ReadonlyMap<
		string,
		RendererEnvCellResourceMembership
	>;
	readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly renderAnchorLandblockId: number | null;
	readonly transitionRootPortalStackId: string;
	readonly traversalPlan: PortalTraversalPlan;
}): void {
	const envCellAperturePlan = createPortalAperturePlan({
		portalInteriorRecords: options.portalInteriorRecords,
		renderAnchorLandblockId: options.renderAnchorLandblockId,
		traversalPlan: options.traversalPlan,
	});
	for (const viewGroup of options.traversalPlan.portalViewGroups) {
		const portalStackId = createOutdoorTransitionChildPortalStackId({
			sourceRootEnvCellId: options.traversalPlan.startEnvCellId,
			transitionRootPortalStackId: options.transitionRootPortalStackId,
			traversalPortalStackId: viewGroup.portalStackId,
		});
		if (options.emittedPortalStackIds.has(portalStackId)) {
			continue;
		}
		options.directEnvCellDraws.push(
			createDirectEnvCellDrawRequest(
				{
					envCellId: viewGroup.envCellId,
					landblockId: viewGroup.landblockId,
					portalStackId,
					traversalDepth: viewGroup.traversalDepth + 1,
				},
				options.membershipsByKey,
			),
		);
		options.emittedPortalStackIds.add(portalStackId);
	}

	for (const pass of envCellAperturePlan.maskPasses) {
		const resource = envCellAperturePlan.resources.find(
			(candidate) => candidate.resourceId === pass.apertureResourceId,
		);
		if (!resource) {
			continue;
		}
		options.apertureBuilder.addMaskPass({
			apertureSourceId: pass.apertureSourceId,
			cullMode: pass.cullMode,
			linkId: pass.linkId,
			parentStencilRef:
				pass.parentStencilRef === null ? 1 : pass.parentStencilRef + 1,
			portalStackId: createOutdoorTransitionChildPortalStackId({
				sourceRootEnvCellId: options.traversalPlan.startEnvCellId,
				transitionRootPortalStackId: options.transitionRootPortalStackId,
				traversalPortalStackId: pass.portalStackId,
			}),
			source: pass.source,
			sourceKind: pass.sourceKind,
			sourcePortalStackId: createOutdoorTransitionChildPortalStackId({
				sourceRootEnvCellId: options.traversalPlan.startEnvCellId,
				transitionRootPortalStackId: options.transitionRootPortalStackId,
				traversalPortalStackId: pass.sourcePortalStackId,
			}),
			stencilRef: pass.stencilRef + 1,
			target: pass.target,
			traversalDepth: pass.traversalDepth + 1,
			vertices: resource.vertices,
		});
	}
}

function createPortalEnvCellsByKey(
	records: readonly StaticPortalInteriorRecord[],
): ReadonlyMap<string, StaticPortalInteriorRecord["envCells"][number]> {
	const envCellsByKey = new Map<
		string,
		StaticPortalInteriorRecord["envCells"][number]
	>();
	for (const record of records) {
		for (const envCell of record.envCells) {
			envCellsByKey.set(
				createEnvCellKey(record.landblockId, envCell.envCellId),
				envCell,
			);
		}
	}
	return envCellsByKey;
}

function triangulateEnvCellPortalAperture(
	points: StaticPortalInteriorRecord["envCells"][number]["portalApertures"][number]["points"],
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
	point: StaticPortalInteriorRecord["envCells"][number]["portalApertures"][number]["points"][number],
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
}): string {
	return [
		"building-transition",
		options.apertureBatchId,
		options.portalId,
	].join(":");
}

function createEnvCellPortalApertureSourceId(options: {
	readonly envCellId: number;
	readonly landblockId: number;
	readonly portalId: string;
}): string {
	return [
		"env-cell-portal",
		formatHex32(options.landblockId),
		formatHex32(options.envCellId),
		options.portalId,
	].join(":");
}
