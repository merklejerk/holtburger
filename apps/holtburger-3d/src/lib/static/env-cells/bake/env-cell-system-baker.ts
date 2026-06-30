import type {
	LandblockEnvCellStaticFacts,
	EnvCellSystemStaticScopePayload,
	ScheduledStaticWork,
	StaticAuthoredDynamicSeedRecord,
	StaticBakeBatchInput,
	StaticBakeBatchItem,
	StaticBakeBatchResult,
	StaticBakeTextureUse,
	StaticBaker,
	StaticDrawUnit,
	EnvCellCellStructureGeometryAttachment,
	StaticMaterialCoverageReport,
	StaticMaterialTableEntry,
	StaticObjectSourceAssetFacts,
	StaticPortalApertureResource,
	StaticPortalGraphRecord,
	StaticPortalInteriorRecord,
	StaticSourceMappingRecord,
	StaticSpatialRecord,
	StructuredInteriorGeometryStaticDrawUnit,
	StaticVisibilityRecord,
	StaticLayerPeerRecordOwner,
} from "../../contracts";
import { uniqueSortedStaticTextureUseOwners } from "../../contracts";
import { createLayerPeerRecordOwnerForStaticWork } from "../../layer-owners";
import { createEnvCellPortalApertureResource } from "../../portal-aperture-resources";
import { createEnvCellStaticPortalGraph } from "../../portal-graphs";
import {
	AC_UNIT_SCALE,
	buildAcPlacementMatrix,
	writeTexCoord,
	writeTransformedPosition,
} from "../../../math/ac-placement-transform";
import {
	createStaticMaterialEntryKey,
	createStaticMaterialTableEntry,
	createStaticMaterialTextureRoleSchemaKey,
	createStaticMaterialTextureUses,
} from "../../bake/static-material-adapter";
import { sliceStaticMaterialBatchCandidates } from "../../bake/static-material-batch-slicer";
import {
	createEnvCellCellStructureGeometryIdentity,
	describeEnvCellCellStructureGeometryIdentity,
} from "./env-cell-system-geometry-attachments";
import { bakeStaticObjectBatch } from "../../objects/bake/static-object-batch-baker";
import {
	createStructuredInteriorTextureUseId,
	createStructuredInteriorMaterialCoverageReport,
	getStructuredInteriorMaterialEntries,
	planStructuredInteriorCellMaterials,
	resolveStructuredInteriorPlanTextureWrapMode,
	resolveStructuredInteriorMaterialSurfaceId,
	type StructuredInteriorCellMaterialPlan,
} from "./structured-interior-material-planner";
import type { StaticMaterialPlan } from "../../objects/bake/static-object-material-planner";
import {
	isCurrentlyStageableStaticObjectDataUse,
	isRenderableStaticMaterialPlan,
} from "../../objects/bake/static-object-renderability";

const MAX_STRUCTURED_INTERIOR_MATERIAL_ENTRIES_PER_DRAW = 8;

interface StructuredInteriorTriangleCandidate {
	readonly batchKey: string;
	readonly materialEntryKey: string;
	readonly materialPlan: StaticMaterialPlan;
	readonly sourceTriangleId: string;
	readonly surfaceId: number;
	readonly triangle: EnvCellCellStructureGeometryAttachment["triangles"][number];
	readonly triangleIndex: number;
}

export class EnvCellSystemBaker implements StaticBaker {
	async bake(input: StaticBakeBatchInput): Promise<StaticBakeBatchResult> {
		return bakeEnvCellSystem(input);
	}
}

export function bakeEnvCellSystem(
	input: StaticBakeBatchInput,
): StaticBakeBatchResult {
	if (input.domain !== "env-cell-system") {
		throw new Error(
			`Landblock env-cell baker only supports landblock env-cell batches. Received ${input.domain}.`,
		);
	}

	validateGeometryAttachments(input);

	const itemResults = input.items.map((item) =>
		bakeLandblockEnvCellItem(input, item),
	);
	const staticObjectResult = bakeStaticObjectBatch(input);
	const drawUnits = [
		...itemResults.flatMap((result) => result.drawUnits),
		...staticObjectResult.drawUnits,
	];
	return {
		atlasRegistryUpdates: [],
		buildRevision: Math.max(
			...input.items.map((item) => item.payload.sourceRevision),
			0,
		),
		domain: input.domain,
		drawUnits,
		staticObjectBakeDiagnostics: staticObjectResult.staticObjectBakeDiagnostics,
		staticObjectRenderInstances: staticObjectResult.staticObjectRenderInstances,
		staticObjectVisualResources: staticObjectResult.staticObjectVisualResources,
		materialCoverage: [
			...itemResults.map((result) => result.materialCoverage),
			...staticObjectResult.materialCoverage.filter(
				(coverage) => coverage.materialCount > 0 || coverage.partitionCount > 0,
			),
		],
		portalApertureResources: itemResults.flatMap((result) =>
			result.portalApertureResource ? [result.portalApertureResource] : [],
		).concat(staticObjectResult.portalApertureResources),
		revision: input.revision,
		staticAuthoredDynamicSeeds: itemResults.flatMap(
			(result) => result.staticAuthoredDynamicSeeds,
		),
		staticBatchId: input.staticBatchId,
		staticPortalGraphs: itemResults
			.flatMap((result) => result.staticPortalGraphs)
			.concat(staticObjectResult.staticPortalGraphs),
		staticPortalInteriorRecords: itemResults.flatMap(
			(result) => result.staticPortalInteriorRecords,
		),
		staticSourceMappings: itemResults.flatMap(
			(result) => result.staticSourceMappings,
		),
		staticSpatialRecords: itemResults
			.flatMap((result) => result.staticSpatialRecords)
			.concat(staticObjectResult.staticSpatialRecords),
		staticVisibilityRecords: itemResults.flatMap(
			(result) => result.staticVisibilityRecords,
		),
		textureUses: mergeTextureUses([
			...itemResults.flatMap((result) => result.textureUses),
			...staticObjectResult.textureUses,
		]),
		works: input.items.map((item) => item.work),
	};
}

function validateGeometryAttachments(input: StaticBakeBatchInput): void {
	for (const item of input.items) {
		if (item.payload.scope.kind !== "env-cell-system") {
			continue;
		}

		for (const envCell of item.payload.scope.envCells) {
			if (envCell.renderGeometry.triangleCount === 0) {
				continue;
			}

			const identity = createEnvCellCellStructureGeometryIdentity({ envCell });
			const identityKey =
				describeEnvCellCellStructureGeometryIdentity(identity);
			const attachment = input.attachments.envCellCellStructureGeometry.find(
				(candidate) =>
					describeEnvCellCellStructureGeometryIdentity(candidate.identity) ===
					identityKey,
			);
			if (!attachment) {
				throw new Error(
					`Missing env-cell cell-structure geometry attachment ${identityKey}.`,
				);
			}

			if (
				attachment.sourceId !== envCell.renderGeometry.sourceId ||
				attachment.vertexCount !== envCell.renderGeometry.vertexCount ||
				attachment.triangleCount !== envCell.renderGeometry.triangleCount
			) {
				throw new Error(
					`Stale env-cell cell-structure geometry attachment ${identityKey}; source/count metadata does not match resolver facts.`,
				);
			}
		}
	}
}

function bakeLandblockEnvCellItem(
	input: StaticBakeBatchInput,
	item: StaticBakeBatchItem,
): {
	readonly drawUnits: readonly StaticDrawUnit[];
	readonly materialCoverage: StaticMaterialCoverageReport;
	readonly portalApertureResource: StaticPortalApertureResource | null;
	readonly staticAuthoredDynamicSeeds: readonly StaticAuthoredDynamicSeedRecord[];
	readonly staticPortalGraphs: readonly StaticPortalGraphRecord[];
	readonly staticPortalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly staticSourceMappings: readonly StaticSourceMappingRecord[];
	readonly staticSpatialRecords: readonly StaticSpatialRecord[];
	readonly staticVisibilityRecords: readonly StaticVisibilityRecord[];
	readonly textureUses: readonly StaticBakeTextureUse[];
} {
	if (
		item.work.job.domain !== "env-cell-system" ||
		item.payload.scope.kind !== "env-cell-system"
	) {
		throw new Error(
			`Landblock env-cell baker only supports landblock env-cell payloads. Received ${item.work.job.domain}/${item.payload.scope.kind}.`,
		);
	}

	const owner = createLayerPeerRecordOwner(item.work);
	const payload = item.payload.scope;
	const materialPlansByEnvCellId = createStructuredInteriorMaterialPlans(
		payload,
		item.work,
	);
	warnAboutStructuredInteriorMaterialOmissions({
		materialPlansByEnvCellId,
		payload,
		work: item.work,
	});
	const drawUnits = createStructuredInteriorDrawUnits(
		input,
		item.work,
		payload,
		materialPlansByEnvCellId,
	);
	const portalInteriorRecord = createPortalInteriorRecord(owner, payload);
	const portalApertureResource =
		createEnvCellPortalApertureResource(portalInteriorRecord);

	return {
		drawUnits,
		materialCoverage: createStructuredInteriorMaterialCoverageReport({
			materialPlansByEnvCellId,
			payload,
		}),
		portalApertureResource,
		staticAuthoredDynamicSeeds: createAuthoredDynamicSeedRecords(
			owner,
			payload,
		),
		staticPortalGraphs: [
			createEnvCellStaticPortalGraph(owner, portalInteriorRecord),
		],
		staticPortalInteriorRecords: [portalInteriorRecord],
		staticSourceMappings: createSourceMappingRecords(owner, payload),
		staticSpatialRecords: createSpatialRecords(owner, payload),
		staticVisibilityRecords: [createVisibilityRecord(owner, payload)],
		textureUses: createStructuredInteriorTextureUses({
			drawUnits,
			materialPlansByEnvCellId,
			staticBatchId: input.staticBatchId,
			work: item.work,
		}),
	};
}

function createStructuredInteriorDrawUnits(
	input: StaticBakeBatchInput,
	work: ScheduledStaticWork,
	payload: EnvCellSystemStaticScopePayload,
	materialPlansByEnvCellId: ReadonlyMap<
		number,
		StructuredInteriorCellMaterialPlan
	>,
): readonly StructuredInteriorGeometryStaticDrawUnit[] {
	const geometrySurfaceOmissions: StructuredInteriorGeometrySurfaceOmission[] =
		[];
	const drawUnits = payload.envCells.flatMap((envCell) => {
		if (envCell.renderGeometry.triangleCount === 0) {
			return [];
		}

		const materialPlan =
			materialPlansByEnvCellId.get(envCell.identity.envCellId) ?? null;
		if (!materialPlan) {
			return [];
		}

		const attachment = requireGeometryAttachment(input, envCell);
		const candidates = createStructuredInteriorTriangleCandidates({
			attachment,
			envCell,
			geometrySurfaceOmissions,
			materialPlan,
		});
		const slices = sliceStaticMaterialBatchCandidates({
			candidates,
			maxMaterialEntriesPerSlice:
				MAX_STRUCTURED_INTERIOR_MATERIAL_ENTRIES_PER_DRAW,
		});

		return slices.map((slice) =>
			createStructuredInteriorDrawUnit({
				attachment,
				envCell,
				landblockId: payload.landblock.landblockId,
				materialPlan,
				slice,
				work,
			}),
		);
	});
	warnAboutStructuredInteriorGeometrySurfaceOmissions({
		omissions: geometrySurfaceOmissions,
		payload,
		work,
	});
	return drawUnits;
}

function createStructuredInteriorDrawUnit(options: {
	readonly attachment: EnvCellCellStructureGeometryAttachment;
	readonly envCell: LandblockEnvCellStaticFacts;
	readonly landblockId: number;
	readonly materialPlan: StructuredInteriorCellMaterialPlan;
	readonly slice: {
		readonly sliceId: string;
		readonly candidates: readonly StructuredInteriorTriangleCandidate[];
	};
	readonly work: ScheduledStaticWork;
}): StructuredInteriorGeometryStaticDrawUnit {
	const materialEntries = createStructuredInteriorMaterialTableEntries({
		candidates: options.slice.candidates,
		work: options.work,
	});
	const materialSlotByEntryKey = createMaterialSlotByEntryKey(
		options.slice.candidates,
	);
	const geometry = bakeCellStructureGeometry(
		options.envCell,
		options.attachment,
		options.slice.candidates,
		materialSlotByEntryKey,
	);
	const materialIds = uniqueSortedNumbers(
		options.slice.candidates.map(
			(candidate) => candidate.materialPlan.material.materialId,
		),
	);
	const firstMaterialEntry = materialEntries[0];
	const firstMaterialPlan = options.slice.candidates[0]?.materialPlan ?? null;
	if (!firstMaterialEntry || !firstMaterialPlan) {
		throw new Error(
			`Structured interior ${formatHex32(options.envCell.identity.envCellId)} has no materialized material entries.`,
		);
	}

	return {
		cellStructure: options.envCell.cellStructure,
		coordinateSpace: "landblock-render-local",
		domain: "env-cell-system",
		drawUnitId: createStructuredInteriorDrawUnitId(
			options.work,
			options.envCell,
			options.slice.sliceId,
		),
		envCellId: options.envCell.identity.envCellId,
		environment: options.envCell.environment,
		indexType: geometry.indices instanceof Uint16Array ? "uint16" : "uint32",
		indices: geometry.indices,
		kind: "structured-interior-geometry",
		landblockId: options.landblockId,
		localPlacement: options.envCell.localPlacement,
		materialBucketKey: createStructuredInteriorMaterialBucketKey(
			options.slice.candidates,
		),
		materialEntries,
		materialFamily:
			resolveRenderableStructuredInteriorFamily(firstMaterialPlan),
		materialIds,
		materialPass: firstMaterialPlan.pass,
		materialPlan: createStructuredInteriorSliceMaterialEntries(
			options.materialPlan,
			options.slice.candidates,
		),
		materialSlotIndices: geometry.materialSlotIndices,
		memberId: options.envCell.memberId,
		positions: geometry.positions,
		renderState: firstMaterialEntry.renderState,
		sourceTriangleIds: geometry.sourceTriangleIds,
		surfaceIds: uniqueSortedNumbers(
			options.slice.candidates.map((candidate) => candidate.surfaceId),
		),
		texCoords: geometry.texCoords,
		textureUseIds: uniqueSortedStrings(
			materialEntries.flatMap((entry) =>
				[
					entry.primaryTextureUseId,
					entry.indexTextureUseId,
					entry.paletteTextureUseId,
					entry.detailTextureUseId,
				].filter(
					(textureUseId): textureUseId is string => textureUseId !== null,
				),
			),
		),
		triangleCount: geometry.triangleCount,
		vertexCount: geometry.vertexCount,
	};
}

function createStructuredInteriorMaterialPlans(
	payload: EnvCellSystemStaticScopePayload,
	work: ScheduledStaticWork,
): ReadonlyMap<number, StructuredInteriorCellMaterialPlan> {
	return new Map(
		payload.envCells.map((envCell) => [
			envCell.identity.envCellId,
			planStructuredInteriorCellMaterials({ envCell, payload, work }),
		]),
	);
}

interface StructuredInteriorMaterialOmissionWarningGroup {
	readonly cellStructureId: string;
	readonly envCellId: string;
	readonly materialIds: readonly string[];
	readonly memberId: string;
	readonly messages: readonly string[];
	readonly outcome: string;
	readonly reasonCode: string;
	readonly surfaceIds: readonly string[];
	readonly surfaceCount: number;
	readonly triangleCount: number;
}

interface StructuredInteriorGeometrySurfaceOmission {
	readonly cellStructureId: string;
	readonly envCellId: string;
	readonly geometrySurfaceId: number;
	readonly memberId: string;
	readonly triangleCount: number;
}

function warnAboutStructuredInteriorMaterialOmissions(options: {
	readonly materialPlansByEnvCellId: ReadonlyMap<
		number,
		StructuredInteriorCellMaterialPlan
	>;
	readonly payload: EnvCellSystemStaticScopePayload;
	readonly work: ScheduledStaticWork;
}): void {
	const groups = createStructuredInteriorMaterialOmissionWarningGroups(options);
	if (groups.length === 0) {
		return;
	}

	console.warn(
		"browser omitted/deferred structured-interior material surfaces; affected cell-structure triangles were not baked.",
		{
			domain: options.work.job.domain,
			groups,
			landblockId: formatHex32(options.payload.landblock.landblockId),
			staticWorkId: options.work.staticWorkId,
		},
	);
}

function warnAboutStructuredInteriorGeometrySurfaceOmissions(options: {
	readonly omissions: readonly StructuredInteriorGeometrySurfaceOmission[];
	readonly payload: EnvCellSystemStaticScopePayload;
	readonly work: ScheduledStaticWork;
}): void {
	if (options.omissions.length === 0) {
		return;
	}

	console.warn(
		"browser omitted structured-interior triangles whose geometry surface slot could not be resolved through the env-cell surface table.",
		{
			domain: options.work.job.domain,
			groups: createStructuredInteriorGeometrySurfaceOmissionWarningGroups(
				options.omissions,
			),
			landblockId: formatHex32(options.payload.landblock.landblockId),
			staticWorkId: options.work.staticWorkId,
		},
	);
}

function createStructuredInteriorGeometrySurfaceOmissionWarningGroups(
	omissions: readonly StructuredInteriorGeometrySurfaceOmission[],
): readonly StructuredInteriorGeometrySurfaceOmission[] {
	const groups = new Map<string, StructuredInteriorGeometrySurfaceOmission>();
	for (const omission of omissions) {
		const key = [
			omission.envCellId,
			omission.cellStructureId,
			omission.geometrySurfaceId,
		].join("|");
		const existing = groups.get(key);
		if (existing) {
			groups.set(key, {
				...existing,
				triangleCount: existing.triangleCount + omission.triangleCount,
			});
			continue;
		}
		groups.set(key, omission);
	}
	return [...groups.values()].sort(
		(left, right) =>
			left.envCellId.localeCompare(right.envCellId) ||
			left.cellStructureId.localeCompare(right.cellStructureId) ||
			left.geometrySurfaceId - right.geometrySurfaceId,
	);
}

function createStructuredInteriorMaterialOmissionWarningGroups(options: {
	readonly materialPlansByEnvCellId: ReadonlyMap<
		number,
		StructuredInteriorCellMaterialPlan
	>;
	readonly payload: EnvCellSystemStaticScopePayload;
}): readonly StructuredInteriorMaterialOmissionWarningGroup[] {
	const groups = new Map<
		string,
		{
			readonly cellStructureId: number;
			readonly envCellId: number;
			readonly materialIds: Set<number>;
			readonly memberId: string;
			readonly messages: Set<string>;
			readonly outcome: string;
			readonly reasonCode: string;
			readonly surfaceIds: Set<number>;
			triangleCount: number;
		}
	>();

	for (const envCell of options.payload.envCells) {
		const plan =
			options.materialPlansByEnvCellId.get(envCell.identity.envCellId) ?? null;
		if (!plan) {
			continue;
		}

		for (const entry of plan.entries) {
			if (entry.outcome === "rendered") {
				continue;
			}

			const diagnostics =
				entry.diagnostics.length > 0
					? entry.diagnostics
					: [
							{
								code: "unrendered-without-diagnostic",
								message:
									"Structured-interior surface was not renderable, but no material diagnostic was recorded.",
							},
						];
			const triangleCount = countStructuredInteriorSurfaceTriangles(
				envCell,
				entry.surfaceId,
			);
			if (triangleCount === 0) {
				continue;
			}
			for (const diagnostic of diagnostics) {
				const key = [
					envCell.identity.envCellId,
					envCell.cellStructure.cellStructureId,
					entry.outcome,
					diagnostic.code,
				].join("|");
				const group = groups.get(key) ?? {
					cellStructureId: envCell.cellStructure.cellStructureId,
					envCellId: envCell.identity.envCellId,
					materialIds: new Set<number>(),
					memberId: envCell.memberId,
					messages: new Set<string>(),
					outcome: entry.outcome,
					reasonCode: diagnostic.code,
					surfaceIds: new Set<number>(),
					triangleCount: 0,
				};
				group.materialIds.add(entry.material.materialId);
				group.messages.add(diagnostic.message);
				group.surfaceIds.add(entry.surfaceId);
				group.triangleCount += triangleCount;
				groups.set(key, group);
			}
		}
	}

	return [...groups.values()]
		.sort(
			(left, right) =>
				left.envCellId - right.envCellId ||
				left.cellStructureId - right.cellStructureId ||
				left.outcome.localeCompare(right.outcome) ||
				left.reasonCode.localeCompare(right.reasonCode),
		)
		.map((group) => ({
			cellStructureId: formatHex32(group.cellStructureId),
			envCellId: formatHex32(group.envCellId),
			materialIds: uniqueSortedNumbers([...group.materialIds]).map(formatHex32),
			memberId: group.memberId,
			messages: uniqueSortedStrings([...group.messages]),
			outcome: group.outcome,
			reasonCode: group.reasonCode,
			surfaceCount: group.surfaceIds.size,
			surfaceIds: uniqueSortedNumbers([...group.surfaceIds]).map(formatHex32),
			triangleCount: group.triangleCount,
		}));
}

function countStructuredInteriorSurfaceTriangles(
	envCell: LandblockEnvCellStaticFacts,
	surfaceId: number,
): number {
	return envCell.renderGeometry.triangles.filter(
		(triangle) =>
			triangle.surfaceId !== null &&
			resolveStructuredInteriorMaterialSurfaceId(
				envCell,
				triangle.surfaceId,
			) === surfaceId,
	).length;
}

function createStructuredInteriorMaterialTableEntries(options: {
	readonly candidates: readonly StructuredInteriorTriangleCandidate[];
	readonly work: ScheduledStaticWork;
}): readonly StaticMaterialTableEntry[] {
	return [
		...options.candidates
			.reduce((entries, candidate) => {
				const existing = entries.get(candidate.materialEntryKey);
				if (existing) {
					existing.materialIds.add(candidate.materialPlan.material.materialId);
					return entries;
				}
				entries.set(candidate.materialEntryKey, {
					materialIds: new Set([candidate.materialPlan.material.materialId]),
					plan: candidate.materialPlan,
				});
				return entries;
			}, new Map<string, { readonly plan: StaticMaterialPlan; readonly materialIds: Set<number> }>())
			.entries(),
	]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(
			([, entry], slot): StaticMaterialTableEntry =>
				createStaticMaterialTableEntry({
					createTextureUseId: (dataUse, wrapMode) =>
						createStructuredInteriorTextureUseId({
							dataUse,
							work: options.work,
							wrapMode,
						}),
					materialIds: uniqueSortedNumbers([...entry.materialIds]),
					plan: entry.plan,
					slot,
					textureWrapMode: resolveStructuredInteriorPlanTextureWrapMode(
						entry.plan,
					),
				}),
		);
}

function createStructuredInteriorTriangleCandidates(options: {
	readonly attachment: EnvCellCellStructureGeometryAttachment;
	readonly envCell: LandblockEnvCellStaticFacts;
	readonly geometrySurfaceOmissions: StructuredInteriorGeometrySurfaceOmission[];
	readonly materialPlan: StructuredInteriorCellMaterialPlan;
}): readonly StructuredInteriorTriangleCandidate[] {
	return options.attachment.triangles
		.map(
			(triangle, triangleIndex): StructuredInteriorTriangleCandidate | null => {
				if (triangle.surfaceId === null) {
					return null;
				}
				const materialSurfaceId = resolveStructuredInteriorMaterialSurfaceId(
					options.envCell,
					triangle.surfaceId,
				);
				if (materialSurfaceId === null) {
					options.geometrySurfaceOmissions.push({
						cellStructureId: formatHex32(
							options.envCell.cellStructure.cellStructureId,
						),
						envCellId: formatHex32(options.envCell.identity.envCellId),
						geometrySurfaceId: triangle.surfaceId,
						memberId: options.envCell.memberId,
						triangleCount: 1,
					});
					return null;
				}
				const plan =
					options.materialPlan.materialPlansBySurfaceId.get(materialSurfaceId);
				if (!plan || !isRenderableStaticMaterialPlan(plan)) {
					return null;
				}
				const materialEntryKey = createStaticMaterialEntryKey({
					plan,
					textureWrapMode: resolveStructuredInteriorPlanTextureWrapMode(plan),
				});
				return {
					batchKey: createStructuredInteriorBatchKey({
						materialEntryKey,
						plan,
					}),
					materialEntryKey,
					materialPlan: plan,
					sourceTriangleId: createSourceTriangleId(triangle),
					surfaceId: materialSurfaceId,
					triangle,
					triangleIndex,
				};
			},
		)
		.filter(
			(candidate): candidate is StructuredInteriorTriangleCandidate =>
				candidate !== null,
		)
		.sort(compareStructuredInteriorTriangleCandidates);
}

function resolveRenderableStructuredInteriorFamily(
	plan: StaticMaterialPlan,
): StructuredInteriorGeometryStaticDrawUnit["materialFamily"] {
	if (
		plan.family === "flat-color" ||
		plan.family === "indexed-paletted" ||
		plan.family === "texture-rgba"
	) {
		return plan.family;
	}

	throw new Error(
		`Structured interior material ${plan.material.materialId.toString(16)} has unrenderable family ${plan.family}.`,
	);
}

function createStructuredInteriorMaterialBucketKey(
	candidates: readonly StructuredInteriorTriangleCandidate[],
): string {
	return uniqueSortedStrings(
		candidates.map((candidate) => candidate.materialPlan.materialBucketKey),
	).join("|");
}

function createMaterialSlotByEntryKey(
	candidates: readonly StructuredInteriorTriangleCandidate[],
): ReadonlyMap<string, number> {
	return new Map(
		uniqueSortedStrings(
			candidates.map((candidate) => candidate.materialEntryKey),
		).map((materialEntryKey, slot) => [materialEntryKey, slot]),
	);
}

function createStructuredInteriorSliceMaterialEntries(
	materialPlan: StructuredInteriorCellMaterialPlan,
	candidates: readonly StructuredInteriorTriangleCandidate[],
): ReturnType<typeof getStructuredInteriorMaterialEntries> {
	const surfaceIds = new Set(
		candidates.map((candidate) => candidate.surfaceId),
	);
	return getStructuredInteriorMaterialEntries(materialPlan).filter((entry) =>
		surfaceIds.has(entry.surfaceId),
	);
}

function createStructuredInteriorBatchKey(options: {
	readonly materialEntryKey: string;
	readonly plan: StaticMaterialPlan;
}): string {
	return [
		`family:${options.plan.family}`,
		`coverage:${options.plan.renderCoverage}`,
		`pass:${options.plan.pass}`,
		`alpha:${options.plan.alphaPolicy.mode}`,
		`blend:${options.plan.blend.mode}`,
		`schema:${createStaticMaterialTextureRoleSchemaKey(
			options.plan.textureRoles,
		)}`,
	].join("|");
}

function compareStructuredInteriorTriangleCandidates(
	left: StructuredInteriorTriangleCandidate,
	right: StructuredInteriorTriangleCandidate,
): number {
	return (
		left.batchKey.localeCompare(right.batchKey) ||
		left.surfaceId - right.surfaceId ||
		left.triangle.polygonId - right.triangle.polygonId ||
		left.triangle.firstVertex - right.triangle.firstVertex ||
		left.materialEntryKey.localeCompare(right.materialEntryKey)
	);
}

function createStructuredInteriorTextureUses(options: {
	readonly drawUnits: readonly StructuredInteriorGeometryStaticDrawUnit[];
	readonly materialPlansByEnvCellId: ReadonlyMap<
		number,
		StructuredInteriorCellMaterialPlan
	>;
	readonly staticBatchId: string;
	readonly work: ScheduledStaticWork;
}): readonly StaticBakeTextureUse[] {
	return createStaticMaterialTextureUses({
		createTextureUseId: (dataUse, wrapMode) =>
			createStructuredInteriorTextureUseId({
				dataUse,
				work: options.work,
				wrapMode,
			}),
		domain: "env-cell-system",
		isStageableDataUse: isCurrentlyStageableStaticObjectDataUse,
		staticBatchId: options.staticBatchId,
		textureUseSpecs: options.drawUnits.flatMap((drawUnit) => {
			const materialPlan = options.materialPlansByEnvCellId.get(
				drawUnit.envCellId,
			);
			if (!materialPlan) {
				return [];
			}
			const drawUnitTextureUseIds = new Set(drawUnit.textureUseIds);
			return [...materialPlan.materialPlansBySurfaceId.values()].flatMap(
				(plan) => {
					const textureWrapMode =
						resolveStructuredInteriorPlanTextureWrapMode(plan);
					const textureDataUses = plan.textureRoles
						.map((role) => role.dataUse)
						.filter((dataUse) =>
							drawUnitTextureUseIds.has(
								createStructuredInteriorTextureUseId({
									dataUse,
									work: options.work,
									wrapMode: textureWrapMode,
								}),
							),
						);
					if (textureDataUses.length === 0) {
						return [];
					}
					return [
						{
							owners: [{ drawUnitId: drawUnit.drawUnitId, kind: "draw-unit" }],
							textureDataUses,
							textureWrapMode,
						},
					];
				},
			);
		}),
	});
}

function bakeCellStructureGeometry(
	envCell: LandblockEnvCellStaticFacts,
	attachment: EnvCellCellStructureGeometryAttachment,
	candidates: readonly StructuredInteriorTriangleCandidate[],
	materialSlotByEntryKey: ReadonlyMap<string, number>,
): {
	readonly positions: Float32Array;
	readonly texCoords: Float32Array;
	readonly materialSlotIndices: Float32Array;
	readonly indices: Uint16Array | Uint32Array;
	readonly sourceTriangleIds: readonly string[];
	readonly triangleCount: number;
	readonly vertexCount: number;
} {
	if (
		attachment.triangleCount > 0 &&
		attachment.triangles.length !== attachment.triangleCount
	) {
		throw new Error(
			`Env-cell cell-structure geometry ${describeEnvCellCellStructureGeometryIdentity(
				attachment.identity,
			)} expected ${attachment.triangleCount} triangle metadata records, got ${attachment.triangles.length}.`,
		);
	}

	const matrix = buildAcPlacementMatrix(envCell.localPlacement, AC_UNIT_SCALE);
	const vertexCount = candidates.length * 3;
	const positions = new Float32Array(vertexCount * 3);
	const texCoords = new Float32Array(vertexCount * 2);
	const materialSlotIndices = new Float32Array(vertexCount);
	const indices = createIndexArray(vertexCount, candidates.length * 3);
	const sourceTriangleIds: string[] = [];

	for (const [candidateIndex, candidate] of candidates.entries()) {
		const firstSourceVertex = candidate.triangle.firstVertex;
		if (firstSourceVertex + 2 >= attachment.vertexCount) {
			throw new Error(
				`Env-cell cell-structure geometry ${describeEnvCellCellStructureGeometryIdentity(
					attachment.identity,
				)} triangle ${candidate.triangleIndex} references vertex ${firstSourceVertex + 2}, but attachment has ${attachment.vertexCount} vertices.`,
			);
		}
		const firstTargetVertex = candidateIndex * 3;
		const materialSlot = materialSlotByEntryKey.get(candidate.materialEntryKey);
		if (materialSlot === undefined) {
			throw new Error(
				`Structured interior material entry ${candidate.materialEntryKey} was not assigned a material slot.`,
			);
		}

		for (let triangleVertex = 0; triangleVertex < 3; triangleVertex += 1) {
			const sourceVertexIndex = firstSourceVertex + triangleVertex;
			const targetVertexIndex = firstTargetVertex + triangleVertex;
			writeTransformedPosition({
				matrix,
				positions,
				source: attachment.positions,
				sourceVertexIndex,
				targetVertexIndex,
			});
			writeTexCoord({
				source: attachment.uvs,
				sourceVertexIndex,
				target: texCoords,
				targetVertexIndex,
			});
			materialSlotIndices[targetVertexIndex] = materialSlot;
			indices[targetVertexIndex] = targetVertexIndex;
		}
		sourceTriangleIds.push(candidate.sourceTriangleId);
	}

	return {
		indices,
		materialSlotIndices,
		positions,
		sourceTriangleIds,
		texCoords,
		triangleCount: candidates.length,
		vertexCount,
	};
}

function createIndexArray(
	vertexCount: number,
	indexCount: number,
): Uint16Array | Uint32Array {
	return vertexCount <= 0xffff
		? new Uint16Array(indexCount)
		: new Uint32Array(indexCount);
}

function createSourceTriangleId(
	triangle: EnvCellCellStructureGeometryAttachment["triangles"][number],
): string {
	return [
		`polygon:${triangle.polygonId}`,
		`surface:${triangle.surfaceId ?? "none"}`,
		`first:${triangle.firstVertex}`,
		`variant:${triangle.materialVariantSignature ?? "none"}`,
	].join("|");
}

function requireGeometryAttachment(
	input: StaticBakeBatchInput,
	envCell: LandblockEnvCellStaticFacts,
): EnvCellCellStructureGeometryAttachment {
	const identity = createEnvCellCellStructureGeometryIdentity({ envCell });
	const identityKey = describeEnvCellCellStructureGeometryIdentity(identity);
	const attachment = input.attachments.envCellCellStructureGeometry.find(
		(candidate) =>
			describeEnvCellCellStructureGeometryIdentity(candidate.identity) ===
			identityKey,
	);
	if (!attachment) {
		throw new Error(
			`Missing env-cell cell-structure geometry attachment ${identityKey}.`,
		);
	}

	return attachment;
}

function createStructuredInteriorDrawUnitId(
	work: ScheduledStaticWork,
	envCell: LandblockEnvCellStaticFacts,
	sliceId: string,
): string {
	return [
		work.staticWorkId,
		"structured-interior",
		formatHex32(envCell.identity.envCellId),
		formatHex32(envCell.cellStructure.cellStructureId),
		sliceId.replaceAll("/", ":"),
	].join(":");
}

function uniqueSortedNumbers(values: readonly number[]): readonly number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}

function uniqueSortedStrings(values: readonly string[]): readonly string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function mergeTextureUses(
	textureUses: readonly StaticBakeTextureUse[],
): readonly StaticBakeTextureUse[] {
	const merged = new Map<string, StaticBakeTextureUse>();
	for (const textureUse of textureUses) {
		const existing = merged.get(textureUse.textureUseId);
		if (existing) {
			merged.set(textureUse.textureUseId, {
				...existing,
				owners: uniqueSortedStaticTextureUseOwners([
					...existing.owners,
					...textureUse.owners,
				]),
			});
			continue;
		}
		merged.set(textureUse.textureUseId, textureUse);
	}
	return [...merged.values()].sort((left, right) =>
		left.textureUseId.localeCompare(right.textureUseId),
	);
}

function createSpatialRecords(
	owner: StaticLayerPeerRecordOwner,
	payload: EnvCellSystemStaticScopePayload,
): readonly StaticSpatialRecord[] {
	return payload.envCells.map((envCell) => ({
		cellBsp: envCell.cellBsp,
		cellStructure: envCell.cellStructure,
		envCellId: envCell.identity.envCellId,
		environment: envCell.environment,
		kind: "env-cell-spatial",
		landblockId: payload.landblock.landblockId,
		localPlacement: envCell.localPlacement,
		memberId: envCell.memberId,
		owner,
		renderBounds: envCell.renderGeometry.bounds,
		residencyBvh: payload.residencySpatial.envCellSystemBvh,
		residencyBvhItemCount:
			payload.residencySpatial.envCellSystemBvhItemCount,
		residencyBvhNodeCount:
			payload.residencySpatial.envCellSystemBvhNodeCount,
	}));
}

function createVisibilityRecord(
	owner: StaticLayerPeerRecordOwner,
	payload: EnvCellSystemStaticScopePayload,
): StaticVisibilityRecord {
	return {
		acceptedEnvCellIds: payload.acceptedEnvCellIds,
		diagnostics: payload.visibilityDiagnostics,
		kind: "env-cell-visibility",
		landblockId: payload.landblock.landblockId,
		owner,
		visibleLinks: payload.envCells.flatMap((envCell) =>
			envCell.visibleEnvCellIds.map((targetEnvCellId) => ({
				sourceEnvCellId: envCell.identity.envCellId,
				targetEnvCellId,
			})),
		),
	};
}

function createPortalInteriorRecord(
	owner: StaticLayerPeerRecordOwner,
	payload: EnvCellSystemStaticScopePayload,
): StaticPortalInteriorRecord {
	return {
		envCells: payload.envCells.map((envCell) => ({
			envCellId: envCell.identity.envCellId,
			localPlacement: envCell.localPlacement,
			portalApertures: envCell.portalApertures,
			portals: envCell.portals,
			seenOutside: envCell.seenOutside,
		})),
		kind: "env-cell-portal-interior",
		landblockId: payload.landblock.landblockId,
		owner,
		portalLinks: payload.portalLinks,
	};
}

function createSourceMappingRecords(
	owner: StaticLayerPeerRecordOwner,
	payload: EnvCellSystemStaticScopePayload,
): readonly StaticSourceMappingRecord[] {
	return payload.envCells.map((envCell) => ({
		cellStructure: envCell.cellStructure,
		envCellId: envCell.identity.envCellId,
		environment: envCell.environment,
		kind: "env-cell-source",
		landblockId: payload.landblock.landblockId,
		memberId: envCell.memberId,
		owner,
		surfaces: envCell.surfaces,
	}));
}

function createAuthoredDynamicSeedRecords(
	owner: StaticLayerPeerRecordOwner,
	payload: EnvCellSystemStaticScopePayload,
): readonly StaticAuthoredDynamicSeedRecord[] {
	const sourceByKey = new Map(
		payload.sourceAssets.map((source) => [
			createSourceKey(source.identity),
			source,
		]),
	);
	return payload.envCells.flatMap((envCell) =>
		envCell.staticObjectSeeds.flatMap((seed) =>
			createAuthoredDynamicSeedRecordsForSeed(
				owner,
				payload,
				envCell,
				seed,
				sourceByKey,
			),
		),
	);
}

function createAuthoredDynamicSeedRecordsForSeed(
	owner: StaticLayerPeerRecordOwner,
	payload: EnvCellSystemStaticScopePayload,
	envCell: LandblockEnvCellStaticFacts,
	seed: LandblockEnvCellStaticFacts["staticObjectSeeds"][number],
	sourceByKey: ReadonlyMap<string, StaticObjectSourceAssetFacts>,
): readonly StaticAuthoredDynamicSeedRecord[] {
	const staticSeedRecord: StaticAuthoredDynamicSeedRecord = {
		envCellId: envCell.identity.envCellId,
		kind: "env-cell-static-object-seed",
		landblockId: payload.landblock.landblockId,
		owner,
		seed,
	};
	const dynamicSeedRecord = createEnvCellStaticObjectDynamicSeedRecord({
		envCell,
		owner,
		payload,
		seed,
		sourceByKey,
	});

	return dynamicSeedRecord ? [dynamicSeedRecord] : [staticSeedRecord];
}

function createEnvCellStaticObjectDynamicSeedRecord(options: {
	readonly envCell: LandblockEnvCellStaticFacts;
	readonly owner: StaticLayerPeerRecordOwner;
	readonly payload: EnvCellSystemStaticScopePayload;
	readonly seed: LandblockEnvCellStaticFacts["staticObjectSeeds"][number];
	readonly sourceByKey: ReadonlyMap<string, StaticObjectSourceAssetFacts>;
}): StaticAuthoredDynamicSeedRecord | null {
	const source = options.sourceByKey.get(createSourceKey(options.seed.source));
	if (
		!source ||
		source.sourceAssetKind !== "setup-model" ||
		source.defaultAnimation === null
	) {
		return null;
	}

	return {
		kind: "env-cell-static-object-dynamic-seed",
		owner: options.owner,
		seed: {
			classificationReason: "setup-default-animation",
			defaultAnimationId: source.defaultAnimation,
			envCellId: options.envCell.identity.envCellId,
			landblockId: options.payload.landblock.landblockId,
			localPlacement: options.seed.localPlacement,
			object: options.seed.identity,
			setupModelId: source.identity.sourceDid,
			source: options.seed.source,
			sourceAssetId: source.debug.sourceAssetId,
			sourceResidence: options.payload.landblock,
			sourceScale: options.seed.sourceScale ?? { x: 1, y: 1, z: 1 },
		},
	};
}

function createLayerPeerRecordOwner(
	work: ScheduledStaticWork,
): StaticLayerPeerRecordOwner {
	return createLayerPeerRecordOwnerForStaticWork(work);
}

function createSourceKey(
	source: StaticObjectSourceAssetFacts["identity"],
): string {
	return [
		source.kind,
		source.sourceAssetKind,
		formatHex32(source.sourceDid),
	].join(":");
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
