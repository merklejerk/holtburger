import type {
	LandblockEnvCellStaticFacts,
	LandblockEnvCellsStaticScopePayload,
	MaterialTextureDataUseIdentity,
	ScheduledStaticWork,
	StaticAuthoredDynamicSeedRecord,
	StaticBakeBatchInput,
	StaticBakeBatchItem,
	StaticBakeBatchResult,
	StaticBakeTextureSamplingPolicy,
	StaticBakeTextureUse,
	StaticBaker,
	StaticDrawUnit,
	EnvCellCellStructureGeometryAttachment,
	StaticMaterialCoverageReport,
	StaticObjectMaterialTableEntry,
	StaticPortalInteriorRecord,
	StaticSourceMappingRecord,
	StaticSpatialRecord,
	StructuredInteriorGeometryStaticDrawUnit,
	StaticVisibilityRecord,
	StaticWorkPeerRecordOwner,
} from "../../contracts";
import {
	AC_UNIT_SCALE,
	buildAcPlacementMatrix,
	writeTexCoord,
	writeTransformedPosition,
} from "../../bake/ac-placement-transform";
import {
	createEnvCellCellStructureGeometryIdentity,
	describeEnvCellCellStructureGeometryIdentity,
} from "./landblock-env-cell-geometry-attachments";
import { bakeStaticObjectCompatibility } from "../../objects/bake/static-object-compatibility-baker";
import {
	createStructuredInteriorTextureUseId,
	createStructuredInteriorMaterialCoverageReport,
	getStructuredInteriorMaterialEntries,
	planStructuredInteriorCellMaterials,
	type StructuredInteriorCellMaterialPlan,
} from "./structured-interior-material-planner";
import type { StaticObjectMaterialPlan } from "../../objects/bake/static-object-material-planner";
import { isCurrentlyStageableStaticObjectDataUse } from "../../objects/bake/static-object-renderability";

const MAX_STRUCTURED_INTERIOR_MATERIAL_ENTRIES_PER_DRAW = 8;

export class LandblockEnvCellsBaker implements StaticBaker {
	async bake(input: StaticBakeBatchInput): Promise<StaticBakeBatchResult> {
		return bakeLandblockEnvCells(input);
	}
}

export function bakeLandblockEnvCells(
	input: StaticBakeBatchInput,
): StaticBakeBatchResult {
	if (input.domain !== "landblock-env-cells") {
		throw new Error(
			`Landblock env-cell baker only supports landblock env-cell batches. Received ${input.domain}.`,
		);
	}

	validateGeometryAttachments(input);

	const itemResults = input.items.map((item) =>
		bakeLandblockEnvCellItem(input, item),
	);
	const staticObjectResult = bakeStaticObjectCompatibility(input);
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
		materialCoverage: [
			...itemResults.map((result) => result.materialCoverage),
			...staticObjectResult.materialCoverage.filter(
				(coverage) =>
					coverage.materialCount > 0 || coverage.partitionCount > 0,
			),
		],
		revision: input.revision,
		staticAuthoredDynamicSeeds: itemResults.flatMap(
			(result) => result.staticAuthoredDynamicSeeds,
		),
		staticBatchId: input.staticBatchId,
		staticPortalInteriorRecords: itemResults.flatMap(
			(result) => result.staticPortalInteriorRecords,
		),
		staticSourceMappings: itemResults.flatMap(
			(result) => result.staticSourceMappings,
		),
		staticSpatialRecords: itemResults.flatMap(
			(result) => result.staticSpatialRecords,
		),
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
		if (item.payload.scope.kind !== "landblock-env-cells") {
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
	readonly staticAuthoredDynamicSeeds: readonly StaticAuthoredDynamicSeedRecord[];
	readonly staticPortalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly staticSourceMappings: readonly StaticSourceMappingRecord[];
	readonly staticSpatialRecords: readonly StaticSpatialRecord[];
	readonly staticVisibilityRecords: readonly StaticVisibilityRecord[];
	readonly textureUses: readonly StaticBakeTextureUse[];
} {
	if (
		item.work.job.domain !== "landblock-env-cells" ||
		item.payload.scope.kind !== "landblock-env-cells"
	) {
		throw new Error(
			`Landblock env-cell baker only supports landblock env-cell payloads. Received ${item.work.job.domain}/${item.payload.scope.kind}.`,
		);
	}

	const owner = createWorkPeerRecordOwner(item.work);
	const payload = item.payload.scope;
	const materialPlansByEnvCellId = createStructuredInteriorMaterialPlans(
		payload,
		item.work,
	);
	const drawUnits = createStructuredInteriorDrawUnits(
		input,
		item.work,
		payload,
		materialPlansByEnvCellId,
	);

	return {
		drawUnits,
		materialCoverage: createStructuredInteriorMaterialCoverageReport({
			materialPlansByEnvCellId,
			payload,
		}),
		staticAuthoredDynamicSeeds: createAuthoredDynamicSeedRecords(owner, payload),
		staticPortalInteriorRecords: [createPortalInteriorRecord(owner, payload)],
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
	payload: LandblockEnvCellsStaticScopePayload,
	materialPlansByEnvCellId: ReadonlyMap<number, StructuredInteriorCellMaterialPlan>,
): readonly StructuredInteriorGeometryStaticDrawUnit[] {
	return payload.envCells.flatMap((envCell) => {
		if (envCell.renderGeometry.triangleCount === 0) {
			return [];
		}

		const materialPlan = materialPlansByEnvCellId.get(envCell.identity.envCellId);
		if (!materialPlan || !isRenderableStructuredInteriorCell(materialPlan)) {
			return [];
		}

		const attachment = requireGeometryAttachment(input, envCell);
		return [
			createStructuredInteriorDrawUnit({
				attachment,
				envCell,
				landblockId: payload.landblock.landblockId,
				materialPlan,
				work,
			}),
		];
	});
}

function createStructuredInteriorDrawUnit(options: {
	readonly attachment: EnvCellCellStructureGeometryAttachment;
	readonly envCell: LandblockEnvCellStaticFacts;
	readonly landblockId: number;
	readonly materialPlan: StructuredInteriorCellMaterialPlan;
	readonly work: ScheduledStaticWork;
}): StructuredInteriorGeometryStaticDrawUnit {
	const materialEntries = createStructuredInteriorMaterialTableEntries({
		materialPlan: options.materialPlan,
		work: options.work,
	});
	const materialSlotBySurfaceId = createMaterialSlotBySurfaceId(
		options.materialPlan,
		materialEntries,
	);
	const geometry = bakeCellStructureGeometry(
		options.envCell,
		options.attachment,
		materialSlotBySurfaceId,
	);
	const materialIds = uniqueSortedNumbers(
		options.envCell.surfaces.map((surface) => surface.material.materialId),
	);
	const firstMaterialEntry = materialEntries[0];
	const firstMaterialPlan = getFirstMaterializedPlan(options.materialPlan);
	if (!firstMaterialEntry || !firstMaterialPlan) {
		throw new Error(
			`Structured interior ${formatHex32(options.envCell.identity.envCellId)} has no materialized material entries.`,
		);
	}

	return {
		cellStructure: options.envCell.cellStructure,
		coordinateSpace: "landblock-render-local",
		domain: "landblock-env-cells",
		drawUnitId: createStructuredInteriorDrawUnitId(options.work, options.envCell),
		envCellId: options.envCell.identity.envCellId,
		environment: options.envCell.environment,
		indexType: geometry.indices instanceof Uint16Array ? "uint16" : "uint32",
		indices: geometry.indices,
		kind: "structured-interior-geometry",
		landblockId: options.landblockId,
		localPlacement: options.envCell.localPlacement,
		materialBucketKey: createStructuredInteriorMaterialBucketKey(
			options.materialPlan,
		),
		materialEntries,
		materialFamily: resolveRenderableStructuredInteriorFamily(firstMaterialPlan),
		materialIds,
		materialPass: firstMaterialPlan.pass,
		materialPlan: getStructuredInteriorMaterialEntries(options.materialPlan),
		materialSlotIndices: geometry.materialSlotIndices,
		memberId: options.envCell.memberId,
		positions: geometry.positions,
		renderState: firstMaterialEntry.renderState,
		sourceTriangleIds: geometry.sourceTriangleIds,
		surfaceIds: uniqueSortedNumbers(options.attachment.surfaceIds),
		texCoords: geometry.texCoords,
		textureUseIds: uniqueSortedStrings(
			materialEntries.flatMap((entry) =>
				[
					entry.primaryTextureUseId,
					entry.indexTextureUseId,
					entry.paletteTextureUseId,
					entry.detailTextureUseId,
				].filter((textureUseId): textureUseId is string => textureUseId !== null),
			),
		),
		triangleCount: options.attachment.triangleCount,
		vertexCount: options.attachment.vertexCount,
	};
}

function createStructuredInteriorMaterialPlans(
	payload: LandblockEnvCellsStaticScopePayload,
	work: ScheduledStaticWork,
): ReadonlyMap<number, StructuredInteriorCellMaterialPlan> {
	return new Map(
		payload.envCells.map((envCell) => [
			envCell.identity.envCellId,
			planStructuredInteriorCellMaterials({ envCell, payload, work }),
		]),
	);
}

function isRenderableStructuredInteriorCell(
	plan: StructuredInteriorCellMaterialPlan,
): boolean {
	const materialPlans = [...plan.materialPlansBySurfaceId.values()];
	if (
		materialPlans.length === 0 ||
		materialPlans.length > MAX_STRUCTURED_INTERIOR_MATERIAL_ENTRIES_PER_DRAW
	) {
		return false;
	}
	const firstPlan = materialPlans[0];
	if (!firstPlan) {
		return false;
	}
	return materialPlans.every(
		(candidate) =>
			candidate.renderCoverage === "classified-render-candidate" &&
			candidate.family !== "unsupported" &&
			candidate.family === firstPlan.family &&
			candidate.pass === firstPlan.pass &&
			candidate.textureRoles.every((role) =>
				isCurrentlyStageableStaticObjectDataUse(role.dataUse),
			),
	);
}

function createStructuredInteriorMaterialTableEntries(options: {
	readonly materialPlan: StructuredInteriorCellMaterialPlan;
	readonly work: ScheduledStaticWork;
}): readonly StaticObjectMaterialTableEntry[] {
	return getStructuredInteriorMaterialEntries(options.materialPlan).map(
		(entry, slot): StaticObjectMaterialTableEntry => {
			const plan = options.materialPlan.materialPlansBySurfaceId.get(
				entry.surfaceId,
			);
			if (!plan) {
				throw new Error(
					`Structured interior material entry ${entry.surfaceId} had no materialized material plan.`,
				);
			}

			return createStructuredInteriorMaterialTableEntry({
				plan,
				slot,
				work: options.work,
			});
		},
	);
}

function resolveRenderableStructuredInteriorFamily(
	plan: StaticObjectMaterialPlan,
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

function createStructuredInteriorMaterialTableEntry(options: {
	readonly plan: StaticObjectMaterialPlan;
	readonly slot: number;
	readonly work: ScheduledStaticWork;
}): StaticObjectMaterialTableEntry {
	const primaryTextureUse = findTextureDataUse(options.plan, "rgba-color");
	const indexTextureUse =
		findTextureDataUse(options.plan, "index8") ??
		findTextureDataUse(options.plan, "index16");
	const paletteTextureUse = options.plan.textureRoles
		.map((role) => role.dataUse)
		.find((dataUse) => dataUse.kind === "palette-texture-use");
	const detailTextureUse = findTextureDataUse(options.plan, "rgba-detail");
	const indexedTextureFormat =
		indexTextureUse?.kind === "prepared-render-surface-texture-use"
			? indexTextureUse.usage === "index16"
				? "index16"
				: "p8"
			: null;

	return {
		alphaTest: options.plan.alphaPolicy.alphaTest,
		indexedClipThreshold: options.plan.alphaPolicy.indexedClipThreshold,
		renderState: {
			blend: {
				dstFactor: options.plan.blend.dstFactor,
				enabled: options.plan.blend.enabled,
				mode: options.plan.blend.mode,
				srcFactor: options.plan.blend.srcFactor,
			},
			depthTest: true,
			depthWrite: options.plan.blend.depthWrite,
		},
		detailTextureTiling:
			options.plan.textureRoles.find((role) => role.role === "detail-overlay")
				?.tiling ?? 1,
		detailTextureUseId: detailTextureUse
			? createStructuredInteriorTextureUseId(options.work, detailTextureUse)
			: null,
		indexedTextureFormat,
		indexTextureUseId: indexTextureUse
			? createStructuredInteriorTextureUseId(options.work, indexTextureUse)
			: null,
		materialColor: options.plan.color,
		materialEmissiveColor: options.plan.emissiveColor,
		materialIds: [options.plan.material.materialId],
		paletteFirstIndex:
			paletteTextureUse?.kind === "palette-texture-use"
				? paletteTextureUse.firstIndex
				: 0,
		paletteTextureUseId: paletteTextureUse
			? createStructuredInteriorTextureUseId(options.work, paletteTextureUse)
			: null,
		primaryTextureUseId: primaryTextureUse
			? createStructuredInteriorTextureUseId(options.work, primaryTextureUse)
			: null,
		primaryTextureWrapMode: "clamp",
		slot: options.slot,
	};
}

function findTextureDataUse(
	plan: StaticObjectMaterialPlan,
	usage: Extract<
		MaterialTextureDataUseIdentity,
		{ readonly kind: "prepared-render-surface-texture-use" }
	>["usage"],
): MaterialTextureDataUseIdentity | null {
	return (
		plan.textureRoles
			.map((role) => role.dataUse)
			.find(
				(dataUse) =>
					dataUse.kind === "prepared-render-surface-texture-use" &&
					dataUse.usage === usage,
			) ?? null
	);
}

function createMaterialSlotBySurfaceId(
	plan: StructuredInteriorCellMaterialPlan,
	materialEntries: readonly StaticObjectMaterialTableEntry[],
): ReadonlyMap<number, number> {
	const slots = new Map<number, number>();
	for (const entry of getStructuredInteriorMaterialEntries(plan)) {
		const materialEntry = materialEntries.find((candidate) =>
			candidate.materialIds.includes(entry.material.materialId),
		);
		slots.set(entry.surfaceId, materialEntry?.slot ?? 0);
	}
	return slots;
}

function getFirstMaterializedPlan(
	plan: StructuredInteriorCellMaterialPlan,
): StaticObjectMaterialPlan | null {
	return plan.materialPlansBySurfaceId.values().next().value ?? null;
}

function createStructuredInteriorMaterialBucketKey(
	plan: StructuredInteriorCellMaterialPlan,
): string {
	return uniqueSortedStrings(
		[...plan.materialPlansBySurfaceId.values()].map(
			(materialPlan) => materialPlan.materialBucketKey,
		),
	).join("|");
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
	const textureUsesById = new Map<string, StaticBakeTextureUse>();
	for (const drawUnit of options.drawUnits) {
		const materialPlan = options.materialPlansByEnvCellId.get(drawUnit.envCellId);
		if (!materialPlan) {
			continue;
		}
		for (const plan of materialPlan.materialPlansBySurfaceId.values()) {
			for (const role of plan.textureRoles) {
				if (!isCurrentlyStageableStaticObjectDataUse(role.dataUse)) {
					continue;
				}
				const textureUseId = createStructuredInteriorTextureUseId(
					options.work,
					role.dataUse,
				);
				if (!drawUnit.textureUseIds.includes(textureUseId)) {
					continue;
				}
				const existing = textureUsesById.get(textureUseId);
				if (existing) {
					textureUsesById.set(textureUseId, {
						...existing,
						ownerDrawUnitIds: [
							...existing.ownerDrawUnitIds,
							drawUnit.drawUnitId,
						],
					});
					continue;
				}
				textureUsesById.set(textureUseId, {
					domain: "landblock-env-cells",
					ownerDrawUnitIds: [drawUnit.drawUnitId],
					samplingPolicy: createStructuredInteriorSamplingPolicy(),
					source: role.dataUse,
					staticBatchId: options.staticBatchId,
					textureUseId,
				});
			}
		}
	}
	return [...textureUsesById.values()].sort((left, right) =>
		left.textureUseId.localeCompare(right.textureUseId),
	);
}

function createStructuredInteriorSamplingPolicy(): StaticBakeTextureSamplingPolicy {
	return {
		wrapS: "clamp-to-edge",
		wrapT: "clamp-to-edge",
	};
}

function bakeCellStructureGeometry(
	envCell: LandblockEnvCellStaticFacts,
	attachment: EnvCellCellStructureGeometryAttachment,
	materialSlotBySurfaceId: ReadonlyMap<number, number>,
): {
	readonly positions: Float32Array;
	readonly texCoords: Float32Array;
	readonly materialSlotIndices: Float32Array;
	readonly indices: Uint16Array | Uint32Array;
	readonly sourceTriangleIds: readonly string[];
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
	const positions = new Float32Array(attachment.vertexCount * 3);
	const texCoords = new Float32Array(attachment.vertexCount * 2);
	const materialSlotIndices = new Float32Array(attachment.vertexCount);
	for (
		let vertexIndex = 0;
		vertexIndex < attachment.vertexCount;
		vertexIndex += 1
	) {
		writeTransformedPosition({
			matrix,
			positions,
			source: attachment.positions,
			sourceVertexIndex: vertexIndex,
			targetVertexIndex: vertexIndex,
		});
		writeTexCoord({
			source: attachment.uvs,
			sourceVertexIndex: vertexIndex,
			target: texCoords,
			targetVertexIndex: vertexIndex,
		});
	}
	for (const triangle of attachment.triangles) {
		const materialSlot =
			triangle.surfaceId === null
				? 0
				: (materialSlotBySurfaceId.get(triangle.surfaceId) ?? 0);
		materialSlotIndices[triangle.firstVertex] = materialSlot;
		materialSlotIndices[triangle.firstVertex + 1] = materialSlot;
		materialSlotIndices[triangle.firstVertex + 2] = materialSlot;
	}

	return {
		indices: createTriangleIndices(attachment),
		materialSlotIndices,
		positions,
		sourceTriangleIds: attachment.triangles.map(createSourceTriangleId),
		texCoords,
	};
}

function createTriangleIndices(
	attachment: EnvCellCellStructureGeometryAttachment,
): Uint16Array | Uint32Array {
	const indices = createIndexArray(attachment.vertexCount, attachment.triangleCount * 3);
	for (const [triangleIndex, triangle] of attachment.triangles.entries()) {
		const firstVertex = triangle.firstVertex;
		if (firstVertex + 2 >= attachment.vertexCount) {
			throw new Error(
				`Env-cell cell-structure geometry ${describeEnvCellCellStructureGeometryIdentity(
					attachment.identity,
				)} triangle ${triangleIndex} references vertex ${firstVertex + 2}, but attachment has ${attachment.vertexCount} vertices.`,
			);
		}
		const offset = triangleIndex * 3;
		indices[offset] = firstVertex;
		indices[offset + 1] = firstVertex + 1;
		indices[offset + 2] = firstVertex + 2;
	}

	return indices;
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
): string {
	return [
		work.workId,
		"structured-interior",
		formatHex32(envCell.identity.envCellId),
		formatHex32(envCell.cellStructure.cellStructureId),
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
				ownerDrawUnitIds: [
					...existing.ownerDrawUnitIds,
					...textureUse.ownerDrawUnitIds,
				],
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
	owner: StaticWorkPeerRecordOwner,
	payload: LandblockEnvCellsStaticScopePayload,
): readonly StaticSpatialRecord[] {
	return payload.envCells.map((envCell) => ({
		cellStructure: envCell.cellStructure,
		envCellId: envCell.identity.envCellId,
		environment: envCell.environment,
		kind: "env-cell-spatial",
		landblockId: payload.landblock.landblockId,
		localBvhItemCount: envCell.localSpatial.localBvhItemCount,
		localBvhNodeCount: envCell.localSpatial.localBvhNodeCount,
		memberId: envCell.memberId,
		owner,
		renderBounds: envCell.renderGeometry.bounds,
		residencyBvhItemCount:
			payload.residencySpatial.landblockEnvCellBvhItemCount,
		residencyBvhNodeCount:
			payload.residencySpatial.landblockEnvCellBvhNodeCount,
	}));
}

function createVisibilityRecord(
	owner: StaticWorkPeerRecordOwner,
	payload: LandblockEnvCellsStaticScopePayload,
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
	owner: StaticWorkPeerRecordOwner,
	payload: LandblockEnvCellsStaticScopePayload,
): StaticPortalInteriorRecord {
	return {
		envCells: payload.envCells.map((envCell) => ({
			envCellId: envCell.identity.envCellId,
			portalApertures: envCell.portalApertures,
			portals: envCell.portals,
		})),
		kind: "env-cell-portal-interior",
		landblockId: payload.landblock.landblockId,
		owner,
		portalLinks: payload.portalLinks,
	};
}

function createSourceMappingRecords(
	owner: StaticWorkPeerRecordOwner,
	payload: LandblockEnvCellsStaticScopePayload,
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
	owner: StaticWorkPeerRecordOwner,
	payload: LandblockEnvCellsStaticScopePayload,
): readonly StaticAuthoredDynamicSeedRecord[] {
	return payload.envCells.flatMap((envCell) =>
		envCell.staticObjectSeeds.map((seed) =>
			createAuthoredDynamicSeedRecord(owner, payload, envCell, seed),
		),
	);
}

function createAuthoredDynamicSeedRecord(
	owner: StaticWorkPeerRecordOwner,
	payload: LandblockEnvCellsStaticScopePayload,
	envCell: LandblockEnvCellStaticFacts,
	seed: LandblockEnvCellStaticFacts["staticObjectSeeds"][number],
): StaticAuthoredDynamicSeedRecord {
	return {
		envCellId: envCell.identity.envCellId,
		kind: "env-cell-static-object-seed",
		landblockId: payload.landblock.landblockId,
		owner,
		seed,
	};
}

function createWorkPeerRecordOwner(
	work: ScheduledStaticWork,
): StaticWorkPeerRecordOwner {
	return {
		domain: work.job.domain,
		kind: "work",
		scope: work.job.scope,
		scopeKey: describeStaticScopeKey(work.job.scope),
		workId: work.workId,
	};
}

function describeStaticScopeKey(scope: ScheduledStaticWork["job"]["scope"]): string {
	return `landblock:${formatHex32(scope.landblockId)}`;
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
