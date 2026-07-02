import type {
	LandblockEnvCellStaticFacts,
	EnvCellSystemStaticScopePayload,
	StaticBakeTask,
	EnvCellStaticObjectPlacementRecord,
	StaticBakeJobInput,
	StaticBakeJobPayload,
	StaticBakeJobResult,
	StaticBakeTextureUse,
	StaticBaker,
	StaticDrawUnit,
	EnvCellCellStructureGeometrySidecar,
	StaticMaterialCoverageReport,
	StaticMaterialTableEntry,
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
import type {
	ObjectVisualTextureBindingRequirement,
	ObjectVisualTexturePlacementSnapshot,
	TextureResourceDependencies,
} from "../../../textures/placement";
import { requireObjectVisualTexturePlacementSnapshot } from "../../../textures/placement";
import { createLayerPeerRecordOwnerForStaticBakeTask } from "../../layer-owners";
import {
	AC_UNIT_SCALE,
	buildAcPlacementMatrix,
	writeTexCoord,
	writeTransformedPosition,
} from "../../../math/ac-placement-transform";
import {
	createStaticMaterialColorKey,
	createStaticMaterialEntryKey,
	createStaticMaterialTableEntry,
	createStaticMaterialTextureRoleLayoutKey,
	createStaticMaterialTextureRoleSchemaKey,
	createStaticMaterialTextureUses,
} from "../../bake/static-material-adapter";
import {
	createEnvCellCellStructureGeometryIdentity,
	describeEnvCellCellStructureGeometryIdentity,
} from "./env-cell-system-geometry-resources";
import { bakeStaticObjectJob } from "../../objects/bake/static-object-job-baker";
import { createStaticObjectVisualRecipeInstallPublication } from "../../bake/object-visual-recipe-install-publication";
import { createObjectVisualInstallSet } from "../../../visual/object-visual-install-set";
import {
	createObjectMaterialDrawUnitPartitionKey,
	splitObjectMaterialPartitionByMaterialTableBudget,
} from "../../../visual/object-material-draw-unit-partition";
import {
	createStructuredInteriorTextureBindingRequirement,
	createStructuredInteriorTextureUseId,
	createStructuredInteriorMaterialCoverageReport,
	getStructuredInteriorMaterialEntries,
	planStructuredInteriorCellMaterials,
	resolveStructuredInteriorPlanTextureWrapMode,
	resolveStructuredInteriorMaterialSurfaceId,
	type StructuredInteriorCellMaterialPlan,
} from "./structured-interior-material-planner";
import type { ObjectVisualMaterialPlan } from "../../../visual/object-visual-material-planner";
import type { ObjectVisualGeometryTriangle } from "../../../visual/object-visual-recipe-bundle";
import {
	isCurrentlyStageableStaticObjectDataUse,
	isRenderableObjectVisualMaterialPlan,
} from "../../objects/bake/static-object-renderability";
import { createStructuredInteriorVisualBundleExpansion } from "./structured-interior-visual-bundle-producer";

const MAX_STRUCTURED_INTERIOR_MATERIAL_ENTRIES_PER_DRAW = 8;
const EMPTY_TEXTURE_PLACEMENT_SNAPSHOT: ObjectVisualTexturePlacementSnapshot = {
	itemIdsByTextureUseId: new Map(),
	placementsByItemId: new Map(),
};

interface StructuredInteriorTriangleCandidate {
	readonly batchKey: string;
	readonly materialEntryKey: string;
	readonly materialPlan: ObjectVisualMaterialPlan;
	readonly textureRequirements: readonly ObjectVisualTextureBindingRequirement[];
	readonly sourceTriangleId: string;
	readonly surfaceId: number;
	readonly triangle: ObjectVisualGeometryTriangle;
	readonly triangleIndex: number;
}

interface EnvCellSystemBakeItemResult {
	readonly drawUnits: readonly StaticDrawUnit[];
	readonly materialCoverage: StaticMaterialCoverageReport;
	readonly objectVisualInstallSet: ReturnType<
		typeof createObjectVisualInstallSet
	>;
	readonly portalApertureResources: readonly StaticPortalApertureResource[];
	readonly envCellStaticObjectPlacementRecords: readonly EnvCellStaticObjectPlacementRecord[];
	readonly staticPortalGraphs: readonly StaticPortalGraphRecord[];
	readonly staticPortalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly staticSourceMappings: readonly StaticSourceMappingRecord[];
	readonly staticSpatialRecords: readonly StaticSpatialRecord[];
	readonly staticVisibilityRecords: readonly StaticVisibilityRecord[];
	readonly textureDependencies: readonly TextureResourceDependencies[];
	readonly textureUses: readonly StaticBakeTextureUse[];
}

export class EnvCellSystemBaker implements StaticBaker {
	async bake(input: StaticBakeJobInput): Promise<StaticBakeJobResult> {
		return bakeEnvCellSystem(input);
	}
}

export function bakeEnvCellSystem(
	input: StaticBakeJobInput,
): StaticBakeJobResult {
	if (input.domain !== "env-cell-system") {
		throw new Error(
			`Landblock env-cell baker only supports landblock env-cell jobs. Received ${input.domain}.`,
		);
	}

	validateGeometrySidecars(input);

	const item = { payload: input.payload, task: input.task };
	const itemResult = bakeLandblockEnvCellItem(input, item);
	const staticObjectResult = bakeStaticObjectJob(input);
	const drawUnits = [...staticObjectResult.drawUnits];
	const textureDependencies = [
		...itemResult.textureDependencies,
		...staticObjectResult.textureDependencies,
	];
	const objectVisualInstallSet = createObjectVisualInstallSet({
		directDrawUnits: [
			...itemResult.objectVisualInstallSet.directDrawUnits,
			...staticObjectResult.objectVisualInstallSet.directDrawUnits,
		],
		dynamicAnimationPartBindings: [
			...itemResult.objectVisualInstallSet.dynamicAnimationPartBindings,
			...staticObjectResult.objectVisualInstallSet.dynamicAnimationPartBindings,
		],
		renderInstances: staticObjectResult.objectVisualInstallSet.renderInstances,
		textureDependencies: [
			...itemResult.objectVisualInstallSet.textureDependencies,
			...staticObjectResult.objectVisualInstallSet.textureDependencies,
		],
		visualResources: staticObjectResult.objectVisualInstallSet.visualResources,
	});
	return {
		atlasRegistryUpdates: [],
		buildRevision: input.payload.sourceRevision,
		domain: input.domain,
		drawUnits,
		staticObjectBakeDiagnostics: staticObjectResult.staticObjectBakeDiagnostics,
		materialCoverage: [
			itemResult.materialCoverage,
			...staticObjectResult.materialCoverage.filter(
				(coverage) => coverage.materialCount > 0 || coverage.partitionCount > 0,
			),
		],
		objectVisualInstallSet,
		portalApertureResources: itemResult.portalApertureResources.concat(
			staticObjectResult.portalApertureResources,
		),
		revision: input.revision,
		envCellStaticObjectPlacementRecords:
			itemResult.envCellStaticObjectPlacementRecords,
		staticPortalGraphs: itemResult.staticPortalGraphs.concat(
			staticObjectResult.staticPortalGraphs,
		),
		staticPortalInteriorRecords: itemResult.staticPortalInteriorRecords,
		staticSourceMappings: itemResult.staticSourceMappings,
		staticSpatialRecords: itemResult.staticSpatialRecords.concat(
			staticObjectResult.staticSpatialRecords,
		),
		staticVisibilityRecords: itemResult.staticVisibilityRecords,
		textureUses: mergeTextureUses([
			...itemResult.textureUses,
			...staticObjectResult.textureUses,
		]),
		textureDependencies,
		task: input.task,
	};
}

function validateGeometrySidecars(input: StaticBakeJobInput): void {
	if (input.payload.scope.kind !== "env-cell-system") {
		return;
	}

	for (const envCell of input.payload.scope.envCells) {
		if (envCell.renderGeometry.triangleCount === 0) {
			continue;
		}

		const identity = createEnvCellCellStructureGeometryIdentity({ envCell });
		const identityKey = describeEnvCellCellStructureGeometryIdentity(identity);
		const resource = input.resources.envCellCellStructureGeometry.find(
			(candidate) =>
				describeEnvCellCellStructureGeometryIdentity(candidate.identity) ===
				identityKey,
		);
		if (!resource) {
			throw new Error(
				`Missing env-cell cell-structure geometry resource ${identityKey}.`,
			);
		}

		if (
			resource.sourceId !== envCell.renderGeometry.sourceId ||
			resource.buffer.vertexCount !== envCell.renderGeometry.vertexCount ||
			resource.buffer.triangleCount !== envCell.renderGeometry.triangleCount
		) {
			throw new Error(
				`Stale env-cell cell-structure geometry resource ${identityKey}; source/count metadata does not match resolver facts.`,
			);
		}
	}
}

function bakeLandblockEnvCellItem(
	input: StaticBakeJobInput,
	item: StaticBakeJobPayload,
): EnvCellSystemBakeItemResult {
	if (
		item.task.domain !== "env-cell-system" ||
		item.payload.scope.kind !== "env-cell-system"
	) {
		throw new Error(
			`Landblock env-cell baker only supports landblock env-cell payloads. Received ${item.task.domain}/${item.payload.scope.kind}.`,
		);
	}

	const owner = createLayerPeerRecordOwner(item.task);
	const payload = item.payload.scope;
	const materialPlansByEnvCellId = createStructuredInteriorMaterialPlans(
		payload,
		item.task,
	);
	warnAboutStructuredInteriorMaterialOmissions({
		materialPlansByEnvCellId,
		payload,
		task: item.task,
	});
	const placementSnapshot =
		input.texturePlacementSnapshot === undefined
			? EMPTY_TEXTURE_PLACEMENT_SNAPSHOT
			: requireObjectVisualTexturePlacementSnapshot(
					input.texturePlacementSnapshot,
					"Structured interior bake",
				);
	const drawUnits = createStructuredInteriorDrawUnits(
		input,
		item.task,
		payload,
		materialPlansByEnvCellId,
		placementSnapshot,
	);
	const objectVisualPublication =
		createStructuredInteriorObjectVisualPublication({
			input,
			payload,
			task: item.task,
		});
	const portalInteriorRecord = createPortalInteriorRecord(owner, payload);

	return {
		drawUnits,
		materialCoverage: createStructuredInteriorMaterialCoverageReport({
			materialPlansByEnvCellId,
			payload,
		}),
		objectVisualInstallSet: objectVisualPublication.installSet,
		portalApertureResources: payload.portalApertureResources,
		envCellStaticObjectPlacementRecords:
			createEnvCellStaticObjectPlacementRecords(owner, payload),
		staticPortalGraphs: [createHostPortalGraphRecord(owner, payload)],
		staticPortalInteriorRecords: [portalInteriorRecord],
		staticSourceMappings: createSourceMappingRecords(owner, payload),
		staticSpatialRecords: createSpatialRecords(owner, payload),
		staticVisibilityRecords: [createVisibilityRecord(owner, payload)],
		textureUses: objectVisualPublication.textureUses,
		textureDependencies: [],
	};
}

function createStructuredInteriorObjectVisualPublication(options: {
	readonly input: StaticBakeJobInput;
	readonly payload: EnvCellSystemStaticScopePayload;
	readonly task: StaticBakeTask;
}): {
	readonly installSet: ReturnType<typeof createObjectVisualInstallSet>;
	readonly textureUses: StaticBakeJobResult["textureUses"];
} {
	const publications = options.payload.envCells.map((envCell) =>
		createStructuredInteriorVisualBundleExpansion({
			geometrySidecars: options.input.resources,
			envCell,
			payload: options.payload,
			task: options.task,
		}),
	);
	const recipePublications = publications.flatMap((publication) => {
		if (publication.resolution.kind === "missing-dependencies") {
			console.warn(
				`Skipped structured interior visual recipe publication for ${options.task.ownerId}; missing ${publication.resolution.missingDependencies
					.map((dependency) => dependency.sourceId)
					.join(", ")}.`,
			);
			return [];
		}
		if (publication.publicationMetadata === null) {
			return [];
		}
		return [
			createStaticObjectVisualRecipeInstallPublication({
				bundle: publication.resolution.bundle,
				domain: "env-cell-system",
				geometryBuffers: publication.geometryBuffers,
				metadata: publication.publicationMetadata,
				renderPartIdPrefix: `${options.task.ownerId}:structured-interior`,
				texturePlacementSnapshot:
					publication.resolution.bundle.textureRecipes.size === 0
						? EMPTY_TEXTURE_PLACEMENT_SNAPSHOT
						: requireObjectVisualTexturePlacementSnapshot(
								options.input.texturePlacementSnapshot,
								"Structured interior visual recipe publication",
							),
				textureUseNamespace: "structured-interior-texture",
				textureUseScopeId: options.task.ownerId,
			}),
		];
	});

	return {
		installSet: createObjectVisualInstallSet({
			directDrawUnits: recipePublications.flatMap(
				(publication) => publication.installSet.directDrawUnits,
			),
			dynamicAnimationPartBindings: recipePublications.flatMap(
				(publication) => publication.installSet.dynamicAnimationPartBindings,
			),
			renderInstances: [],
			textureDependencies: recipePublications.flatMap(
				(publication) => publication.installSet.textureDependencies,
			),
			visualResources: [],
		}),
		textureUses: recipePublications.flatMap(
			(publication) => publication.textureUses,
		),
	};
}

function createStructuredInteriorDrawUnits(
	input: StaticBakeJobInput,
	task: StaticBakeTask,
	payload: EnvCellSystemStaticScopePayload,
	materialPlansByEnvCellId: ReadonlyMap<
		number,
		StructuredInteriorCellMaterialPlan
	>,
	placementSnapshot: ObjectVisualTexturePlacementSnapshot,
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

		const sidecar = requireGeometrySidecar(input, envCell);
		const candidates = createStructuredInteriorTriangleCandidates({
			sidecar,
			envCell,
			geometrySurfaceOmissions,
			materialPlan,
			placementSnapshot,
			task,
		});
		assertStructuredInteriorPlacementRequirements({
			candidates,
			envCell,
			placementSnapshot,
		});
		const partitions = groupStructuredInteriorPrimitivesByPartitionKey(
			candidates,
		).flatMap((group, batchIndex) =>
			splitObjectMaterialPartitionByMaterialTableBudget({
				maxMaterialEntriesPerPartition:
					MAX_STRUCTURED_INTERIOR_MATERIAL_ENTRIES_PER_DRAW,
				primitives: group.candidates,
			}).map((split, splitIndex) => ({
				candidates: split,
				sliceId: `slice/${batchIndex}/${splitIndex}`,
			})),
		);

		return partitions.map((slice) =>
			createStructuredInteriorDrawUnit({
				sidecar,
				envCell,
				landblockId: payload.landblock.landblockId,
				materialPlan,
				slice,
				task,
			}),
		);
	});
	warnAboutStructuredInteriorGeometrySurfaceOmissions({
		omissions: geometrySurfaceOmissions,
		payload,
		task,
	});
	return drawUnits;
}

function createStructuredInteriorDrawUnit(options: {
	readonly sidecar: EnvCellCellStructureGeometrySidecar;
	readonly envCell: LandblockEnvCellStaticFacts;
	readonly landblockId: number;
	readonly materialPlan: StructuredInteriorCellMaterialPlan;
	readonly slice: {
		readonly sliceId: string;
		readonly candidates: readonly StructuredInteriorTriangleCandidate[];
	};
	readonly task: StaticBakeTask;
}): StructuredInteriorGeometryStaticDrawUnit {
	const materialEntries = createStructuredInteriorMaterialTableEntries({
		candidates: options.slice.candidates,
		task: options.task,
	});
	const materialSlotByEntryKey = createMaterialSlotByEntryKey(
		options.slice.candidates,
	);
	const geometry = bakeCellStructureGeometry(
		options.envCell,
		options.sidecar,
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
			options.task,
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
	task: StaticBakeTask,
): ReadonlyMap<number, StructuredInteriorCellMaterialPlan> {
	return new Map(
		payload.envCells.map((envCell) => [
			envCell.identity.envCellId,
			planStructuredInteriorCellMaterials({ envCell, payload, task }),
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
	readonly task: StaticBakeTask;
}): void {
	const groups = createStructuredInteriorMaterialOmissionWarningGroups(options);
	if (groups.length === 0) {
		return;
	}

	console.warn(
		"browser omitted/deferred structured-interior material surfaces; affected cell-structure triangles were not baked.",
		{
			domain: options.task.domain,
			groups,
			landblockId: formatHex32(options.payload.landblock.landblockId),
			taskId: options.task.taskId,
		},
	);
}

function warnAboutStructuredInteriorGeometrySurfaceOmissions(options: {
	readonly omissions: readonly StructuredInteriorGeometrySurfaceOmission[];
	readonly payload: EnvCellSystemStaticScopePayload;
	readonly task: StaticBakeTask;
}): void {
	if (options.omissions.length === 0) {
		return;
	}

	console.warn(
		"browser omitted structured-interior triangles whose geometry surface slot could not be resolved through the env-cell surface table.",
		{
			domain: options.task.domain,
			groups: createStructuredInteriorGeometrySurfaceOmissionWarningGroups(
				options.omissions,
			),
			landblockId: formatHex32(options.payload.landblock.landblockId),
			taskId: options.task.taskId,
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
	readonly task: StaticBakeTask;
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
			}, new Map<string, { readonly plan: ObjectVisualMaterialPlan; readonly materialIds: Set<number> }>())
			.entries(),
	]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(
			([, entry], slot): StaticMaterialTableEntry =>
				createStaticMaterialTableEntry({
					createTextureUseId: (dataUse, wrapMode) =>
						createStructuredInteriorTextureUseId({
							dataUse,
							task: options.task,
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
	readonly sidecar: EnvCellCellStructureGeometrySidecar;
	readonly envCell: LandblockEnvCellStaticFacts;
	readonly geometrySurfaceOmissions: StructuredInteriorGeometrySurfaceOmission[];
	readonly materialPlan: StructuredInteriorCellMaterialPlan;
	readonly placementSnapshot: ObjectVisualTexturePlacementSnapshot;
	readonly task: StaticBakeTask;
}): readonly StructuredInteriorTriangleCandidate[] {
	return options.sidecar.buffer.triangles
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
				if (!plan || !isRenderableObjectVisualMaterialPlan(plan)) {
					return null;
				}
				const materialEntryKey = createStaticMaterialEntryKey({
					plan,
					textureWrapMode: resolveStructuredInteriorPlanTextureWrapMode(plan),
				});
				const textureRequirements = createStructuredInteriorTextureRequirements(
					{
						placementSnapshot: options.placementSnapshot,
						plan,
						task: options.task,
					},
				);
				return {
					batchKey: createStructuredInteriorBatchKey({
						diagnosticSubject: `Structured interior ${formatHex32(options.envCell.identity.envCellId)}`,
						materialEntryKey,
						placementSnapshot: options.placementSnapshot,
						plan,
						textureRequirements,
					}),
					materialEntryKey,
					materialPlan: plan,
					sourceTriangleId: createSourceTriangleId(triangle),
					surfaceId: materialSurfaceId,
					textureRequirements,
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

function createStructuredInteriorTextureRequirements(options: {
	readonly placementSnapshot: ObjectVisualTexturePlacementSnapshot;
	readonly plan: ObjectVisualMaterialPlan;
	readonly task: StaticBakeTask;
}): readonly ObjectVisualTextureBindingRequirement[] {
	const wrapMode = resolveStructuredInteriorPlanTextureWrapMode(options.plan);
	return options.plan.textureRoles
		.map((role) => role.dataUse)
		.filter(isCurrentlyStageableStaticObjectDataUse)
		.map((dataUse) => {
			const requirement = createStructuredInteriorTextureBindingRequirement({
				dataUse,
				task: options.task,
				wrapMode,
			});
			return {
				...requirement,
				placementItemId: requireObjectVisualPlacementItemId({
					placementSnapshot: options.placementSnapshot,
					subject: "Structured interior material",
					textureUseId: requirement.textureUseId,
				}),
			};
		});
}

function assertStructuredInteriorPlacementRequirements(options: {
	readonly candidates: readonly StructuredInteriorTriangleCandidate[];
	readonly envCell: LandblockEnvCellStaticFacts;
	readonly placementSnapshot: ObjectVisualTexturePlacementSnapshot;
}): void {
	for (const candidate of options.candidates) {
		for (const requirement of candidate.textureRequirements) {
			if (
				options.placementSnapshot.placementsByItemId.has(
					requirement.placementItemId,
				)
			) {
				continue;
			}
			throw new Error(
				`Structured interior ${formatHex32(options.envCell.identity.envCellId)} texture placement snapshot is missing ${requirement.placementItemId}.`,
			);
		}
	}
}

function resolveRenderableStructuredInteriorFamily(
	plan: ObjectVisualMaterialPlan,
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
	readonly diagnosticSubject: string;
	readonly materialEntryKey: string;
	readonly placementSnapshot: ObjectVisualTexturePlacementSnapshot | undefined;
	readonly plan: ObjectVisualMaterialPlan;
	readonly textureRequirements: readonly ObjectVisualTextureBindingRequirement[];
}): string {
	return createObjectMaterialDrawUnitPartitionKey({
		diagnosticSubject: options.diagnosticSubject,
		includeConcreteEntryInKey: false,
		material: {
			alphaMode: options.plan.alphaPolicy.mode,
			blendMode: options.plan.blend.mode,
			family: resolveRenderableStructuredInteriorFamily(options.plan),
			materialColorKey: createStaticMaterialColorKey(options.plan),
			materialEntryKey: options.materialEntryKey,
			pass: options.plan.pass,
			renderCoverage: options.plan.renderCoverage,
			textureRoleLayoutKey: createStaticMaterialTextureRoleLayoutKey(
				options.plan.textureRoles,
			),
			textureRoleSchemaKey: createStaticMaterialTextureRoleSchemaKey(
				options.plan.textureRoles,
			),
			textureWrapMode: resolveStructuredInteriorPlanTextureWrapMode(
				options.plan,
			),
		},
		texturePlacementSnapshot: options.placementSnapshot,
		textureRequirements: options.textureRequirements,
	}).key;
}

function groupStructuredInteriorPrimitivesByPartitionKey(
	candidates: readonly StructuredInteriorTriangleCandidate[],
): readonly {
	readonly batchKey: string;
	readonly candidates: readonly StructuredInteriorTriangleCandidate[];
}[] {
	const groups = new Map<string, StructuredInteriorTriangleCandidate[]>();
	for (const candidate of candidates) {
		const group = groups.get(candidate.batchKey);
		if (group) {
			group.push(candidate);
		} else {
			groups.set(candidate.batchKey, [candidate]);
		}
	}

	return [...groups.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([batchKey, group]) => ({ batchKey, candidates: group }));
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
	readonly task: StaticBakeTask;
}): readonly StaticBakeTextureUse[] {
	return createStaticMaterialTextureUses({
		createTextureUseId: (dataUse, wrapMode) =>
			createStructuredInteriorTextureUseId({
				dataUse,
				task: options.task,
				wrapMode,
			}),
		domain: "env-cell-system",
		isStageableDataUse: isCurrentlyStageableStaticObjectDataUse,
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
									task: options.task,
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

function requireObjectVisualPlacementItemId(options: {
	readonly placementSnapshot: ObjectVisualTexturePlacementSnapshot;
	readonly subject: string;
	readonly textureUseId: string;
}) {
	const placementItemId = options.placementSnapshot.itemIdsByTextureUseId.get(
		options.textureUseId,
	);
	if (placementItemId === undefined) {
		throw new Error(
			`${options.subject} is missing object-visual placement item id for ${options.textureUseId}.`,
		);
	}
	return placementItemId;
}

function bakeCellStructureGeometry(
	envCell: LandblockEnvCellStaticFacts,
	sidecar: EnvCellCellStructureGeometrySidecar,
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
		sidecar.buffer.triangleCount > 0 &&
		sidecar.buffer.triangles.length !== sidecar.buffer.triangleCount
	) {
		throw new Error(
			`Env-cell cell-structure geometry ${describeEnvCellCellStructureGeometryIdentity(
				sidecar.identity,
			)} expected ${sidecar.buffer.triangleCount} triangle metadata records, got ${sidecar.buffer.triangles.length}.`,
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
		if (firstSourceVertex + 2 >= sidecar.buffer.vertexCount) {
			throw new Error(
				`Env-cell cell-structure geometry ${describeEnvCellCellStructureGeometryIdentity(
					sidecar.identity,
				)} triangle ${candidate.triangleIndex} references vertex ${firstSourceVertex + 2}, but sidecar has ${sidecar.buffer.vertexCount} vertices.`,
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
				source: sidecar.buffer.positions,
				sourceVertexIndex,
				targetVertexIndex,
			});
			writeTexCoord({
				source: sidecar.buffer.texCoords,
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
	triangle: ObjectVisualGeometryTriangle,
): string {
	return [
		`polygon:${triangle.polygonId}`,
		`surface:${triangle.surfaceId ?? "none"}`,
		`first:${triangle.firstVertex}`,
		`variant:${triangle.materialVariantSignature ?? "none"}`,
	].join("|");
}

function requireGeometrySidecar(
	input: StaticBakeJobInput,
	envCell: LandblockEnvCellStaticFacts,
): EnvCellCellStructureGeometrySidecar {
	const identity = createEnvCellCellStructureGeometryIdentity({ envCell });
	const identityKey = describeEnvCellCellStructureGeometryIdentity(identity);
	const resource = input.resources.envCellCellStructureGeometry.find(
		(candidate) =>
			describeEnvCellCellStructureGeometryIdentity(candidate.identity) ===
			identityKey,
	);
	if (!resource) {
		throw new Error(
			`Missing env-cell cell-structure geometry resource ${identityKey}.`,
		);
	}

	return resource;
}

function createStructuredInteriorDrawUnitId(
	task: StaticBakeTask,
	envCell: LandblockEnvCellStaticFacts,
	sliceId: string,
): string {
	return [
		task.taskId,
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
		residencyBvhItemCount: payload.residencySpatial.envCellSystemBvhItemCount,
		residencyBvhNodeCount: payload.residencySpatial.envCellSystemBvhNodeCount,
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

function createHostPortalGraphRecord(
	owner: StaticLayerPeerRecordOwner,
	payload: EnvCellSystemStaticScopePayload,
): StaticPortalGraphRecord {
	return {
		edges: payload.portalConnectivityGraph.edges,
		kind: "static-portal-graph",
		landblockId: payload.landblock.landblockId,
		nodes: payload.portalConnectivityGraph.nodes,
		owner,
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

function createEnvCellStaticObjectPlacementRecords(
	owner: StaticLayerPeerRecordOwner,
	payload: EnvCellSystemStaticScopePayload,
): readonly EnvCellStaticObjectPlacementRecord[] {
	return payload.envCells.flatMap((envCell) =>
		envCell.staticObjectPlacements.flatMap((placement) =>
			createEnvCellStaticObjectPlacementRecord(
				owner,
				payload,
				envCell,
				placement,
			),
		),
	);
}

function createEnvCellStaticObjectPlacementRecord(
	owner: StaticLayerPeerRecordOwner,
	payload: EnvCellSystemStaticScopePayload,
	envCell: LandblockEnvCellStaticFacts,
	placement: LandblockEnvCellStaticFacts["staticObjectPlacements"][number],
): readonly EnvCellStaticObjectPlacementRecord[] {
	const record: EnvCellStaticObjectPlacementRecord = {
		envCellId: envCell.identity.envCellId,
		kind: "env-cell-static-object-placement",
		landblockId: payload.landblock.landblockId,
		owner,
		placement,
	};
	return [record];
}

function createLayerPeerRecordOwner(
	task: StaticBakeTask,
): StaticLayerPeerRecordOwner {
	return createLayerPeerRecordOwnerForStaticBakeTask(task);
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
