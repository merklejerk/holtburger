import type {
	MaterialTextureDataUseIdentity,
	LandblockSourceIdentity,
	OutdoorStaticObjectDomain,
	OutdoorStaticObjectsScopePayload,
	RegionDetailRoleFacts,
	StaticDomain,
	StaticMaterialCoverageReport,
	StaticMaterialSourceIdentity,
	StaticObjectInstanceIdentity,
	StaticObjectMaterialSlotFacts,
	StaticObjectPartSourceFacts,
	StaticObjectSourceIdentity,
} from "../../contracts";
import {
	createStaticMaterialColorKey,
	createStaticMaterialEntryKey,
	createStaticMaterialTextureRoleLayoutKey,
	createStaticMaterialTextureRoleSchemaKey,
	resolveStaticMaterialDetailTextureTiling,
} from "../../bake/static-material-adapter";
import { sliceStaticMaterialBatchCandidates } from "../../bake/static-material-batch-slicer";
import { createMaterialTextureDataUseKey } from "../../bake/static-material-texture-policy";
import { createStaticObjectMaterialCoverageReport } from "./static-object-material-coverage";
import {
	createStaticObjectMaterialUseKey,
	planStaticObjectMaterials,
	type StaticMaterialFallbackReason,
	type StaticMaterialPlan,
	type StaticMaterialTextureUseRole,
} from "./static-object-material-planner";

export const STATIC_OBJECT_MAX_MATERIALS_PER_DRAW_SLICE = 8;

export interface StaticObjectBatchPartitionPlan {
	readonly domain: StaticObjectBatchPayload["domain"];
	readonly partitions: readonly StaticObjectBatchPartition[];
	readonly fallbackReasons: readonly StaticMaterialFallbackReason[];
	readonly materialCoverage: StaticMaterialCoverageReport;
}

export interface StaticObjectBatchPayload {
	readonly domain: Extract<
		StaticDomain,
		OutdoorStaticObjectDomain | "env-cell-system"
	>;
	readonly landblock: LandblockSourceIdentity;
	readonly regionRenderProfile: {
		readonly detailRoles: readonly RegionDetailRoleFacts[];
	};
	readonly objects: readonly StaticObjectBatchObject[];
	readonly sourceAssets: OutdoorStaticObjectsScopePayload["sourceAssets"];
	readonly paletteSources: OutdoorStaticObjectsScopePayload["paletteSources"];
	readonly materialSlots: OutdoorStaticObjectsScopePayload["materialSlots"];
	readonly materialSources: OutdoorStaticObjectsScopePayload["materialSources"];
	readonly textureRefs: OutdoorStaticObjectsScopePayload["textureRefs"];
}

type StaticObjectBatchObject =
	OutdoorStaticObjectsScopePayload["objects"][number] & {
		readonly owningEnvCellId?: number | null;
	};

export interface StaticObjectBatchPartition {
	readonly sliceId: string;
	readonly batchKey: string;
	readonly partitionAxes: StaticObjectBatchPartitionAxes;
	readonly coarseTablePlan: StaticObjectCoarseTablePlan;
	readonly family: StaticMaterialPlan["family"];
	readonly renderCoverage: StaticMaterialPlan["renderCoverage"];
	readonly pass: StaticMaterialPlan["pass"];
	readonly alphaMode: StaticMaterialPlan["alphaPolicy"]["mode"];
	readonly alphaTest: StaticMaterialPlan["alphaPolicy"]["alphaTest"];
	readonly indexedClipThreshold: StaticMaterialPlan["alphaPolicy"]["indexedClipThreshold"];
	readonly materialColor: StaticMaterialPlan["color"];
	readonly materialEmissiveColor: StaticMaterialPlan["emissiveColor"];
	readonly textureWrapMode: StaticObjectTextureWrapMode;
	readonly detailTextureTiling: number;
	readonly textureRoleSchemaKey: string;
	readonly textureRoleLayoutKey: string;
	readonly materialIds: readonly number[];
	readonly materialEntryKeys: readonly string[];
	readonly textureDataUses: readonly MaterialTextureDataUseIdentity[];
	readonly triangles: readonly StaticObjectBatchTriangle[];
	readonly sourceTriangleIds: readonly string[];
	readonly triangleCount: number;
	readonly reason: string;
}

interface StaticObjectCoarseTablePlan {
	readonly tableFamily: StaticMaterialPlan["family"];
	readonly tableSchemaKey: string;
	readonly renderCoverage: StaticMaterialPlan["renderCoverage"];
	readonly pass: StaticMaterialPlan["pass"];
	readonly sortPolicy: StaticObjectSortAxis["policy"];
	readonly visibilityPolicy: StaticObjectVisibilityAxis["policy"];
	readonly entries: readonly StaticObjectCoarseMaterialEntry[];
	readonly textureDataUses: readonly MaterialTextureDataUseIdentity[];
	readonly sourceTriangleIds: readonly string[];
}

interface StaticObjectCoarseMaterialEntry {
	readonly materialEntryKey: string;
	readonly materialUseKey: string;
	readonly materialPlan: StaticMaterialPlan;
	readonly materialIds: readonly number[];
	readonly blend: StaticMaterialPlan["blend"];
	readonly materialColor: StaticMaterialPlan["color"];
	readonly materialEmissiveColor: StaticMaterialPlan["emissiveColor"];
	readonly alphaMode: StaticMaterialPlan["alphaPolicy"]["mode"];
	readonly alphaTest: StaticMaterialPlan["alphaPolicy"]["alphaTest"];
	readonly indexedClipThreshold: StaticMaterialPlan["alphaPolicy"]["indexedClipThreshold"];
	readonly textureWrapMode: StaticObjectTextureWrapMode;
	readonly detailTextureTiling: number;
	readonly textureRoles: readonly StaticMaterialTextureUseRole[];
	readonly textureDataUses: readonly MaterialTextureDataUseIdentity[];
}

interface StaticObjectBatchPartitionAxes {
	readonly material: StaticObjectMaterialBatchAxis;
	readonly ownership: StaticObjectOwnershipAxis;
	readonly sort: StaticObjectSortAxis;
	readonly visibility: StaticObjectVisibilityAxis;
}

interface StaticObjectMaterialBatchAxis {
	readonly key: string;
	readonly family: StaticMaterialPlan["family"];
	readonly renderCoverage: StaticMaterialPlan["renderCoverage"];
	readonly pass: StaticMaterialPlan["pass"];
	readonly alphaMode: StaticMaterialPlan["alphaPolicy"]["mode"];
	readonly blendMode: StaticMaterialPlan["blend"]["mode"];
	readonly materialEntryKey: string;
	readonly materialColorKey: string;
	readonly textureWrapMode: StaticObjectTextureWrapMode;
	readonly textureRoleSchemaKey: string;
	readonly textureRoleLayoutKey: string;
}

interface StaticObjectOwnershipAxis {
	readonly key: string;
	readonly domain: StaticObjectBatchPayload["domain"];
	readonly landblockId: number;
	readonly envCellId: number | null;
	readonly sourceKey: string;
	readonly sourceKeys: readonly string[];
	readonly gfxKey: string;
	readonly gfxKeys: readonly string[];
	readonly objectPartKey: string | null;
}

interface StaticObjectSortAxis {
	readonly policy:
		| "opaque-batchable"
		| "alpha-test-batchable"
		| "transparent-object-part-sortable";
	readonly key: string;
}

interface StaticObjectVisibilityAxis {
	readonly policy: "landblock-static-neutral";
	readonly key: string;
}

export interface StaticObjectBatchTriangle {
	readonly sourceTriangleId: string;
	readonly object: StaticObjectInstanceIdentity;
	readonly source: StaticObjectSourceIdentity;
	readonly gfxObj: StaticObjectSourceIdentity;
	readonly materialEntryKey: string;
	readonly partIndex: number;
	readonly polygonId: number;
	readonly firstVertex: number;
	readonly geometrySurfaceId: number;
	readonly materialVariantSignature: string | null;
	readonly material: StaticMaterialSourceIdentity;
}

type StaticObjectTextureWrapMode = "clamp" | "repeat";

interface StaticObjectTriangleCandidate {
	readonly sourceTriangleId: string;
	readonly batchKey: string;
	readonly partitionAxes: StaticObjectBatchPartitionAxes;
	readonly object: StaticObjectInstanceIdentity;
	readonly source: StaticObjectSourceIdentity;
	readonly gfxObj: StaticObjectSourceIdentity;
	readonly material: StaticMaterialSourceIdentity;
	readonly materialKey: string;
	readonly materialId: number;
	readonly materialPlan: StaticMaterialPlan;
	readonly materialColorKey: string;
	readonly materialEntryKey: string;
	readonly textureRoleSchemaKey: string;
	readonly textureRoleLayoutKey: string;
	readonly sourceKey: string;
	readonly gfxKey: string;
	readonly objectKey: string;
	readonly partIndex: number;
	readonly polygonId: number;
	readonly firstVertex: number;
	readonly geometrySurfaceId: number;
	readonly materialVariantSignature: string | null;
	readonly textureWrapMode: StaticObjectTextureWrapMode;
}

export function partitionStaticObjectBatches(
	payload: StaticObjectBatchPayload,
): StaticObjectBatchPartitionPlan {
	const materialPlan = planStaticObjectMaterials(payload);
	const materialById = new Map(
		materialPlan.materialPlans.map((plan) => [plan.materialUseKey, plan]),
	);
	const candidates = [...createTriangleCandidates(payload, materialById)].sort(
		compareTriangleCandidates,
	);
	const partitions = sliceStaticMaterialBatchCandidates({
		candidates,
		maxMaterialEntriesPerSlice: STATIC_OBJECT_MAX_MATERIALS_PER_DRAW_SLICE,
	}).map((slice) =>
		createBatchPartition({
			candidates: slice.candidates,
			batchIndex: slice.batchIndex,
			batchKey: slice.batchKey,
			sliceIndex: slice.sliceIndex,
		}),
	);

	return {
		domain: payload.domain,
		fallbackReasons: materialPlan.fallbackReasons,
		materialCoverage: createStaticObjectMaterialCoverageReport({
			materialPlan,
			partitions,
			payload,
		}),
		partitions,
	};
}

function createTriangleCandidates(
	payload: StaticObjectBatchPayload,
	materialById: ReadonlyMap<string, StaticMaterialPlan>,
): readonly StaticObjectTriangleCandidate[] {
	const sourceByKey = new Map(
		payload.sourceAssets.map((source) => [
			createSourceKey(source.identity),
			source,
		]),
	);
	const materialSlots = new MaterialSlotIndex(payload);
	const candidates: StaticObjectTriangleCandidate[] = [];

	for (const object of [...payload.objects].sort(compareObjects)) {
		const source = sourceByKey.get(createSourceKey(object.source));
		if (!source) {
			throw new Error(
				`Static object ${createObjectKey(object.identity)} references missing source ${createSourceKey(object.source)}.`,
			);
		}

		for (const part of [...source.parts].sort(
			(left, right) => left.partIndex - right.partIndex,
		)) {
			for (const triangle of [...part.triangles].sort(
				(left, right) => left.polygonId - right.polygonId,
			)) {
				const materialSlot = materialSlots.resolveMaterialSlot(
					object.identity,
					part,
					{
						geometrySurfaceId: triangle.geometrySurfaceId,
						materialVariantSignature: triangle.materialVariantSignature,
					},
				);
				if (!materialSlot) {
					throw new Error(
						`Static object triangle ${createObjectKey(object.identity)}:part:${part.partIndex}:polygon:${triangle.polygonId} has no resolved material slot.`,
					);
				}
				if (triangle.geometrySurfaceId === null) {
					throw new Error(
						`Static object triangle ${createObjectKey(object.identity)}:part:${part.partIndex}:polygon:${triangle.polygonId} has no geometry surface id after material resolution.`,
					);
				}

				const plan = materialById.get(
					createStaticObjectMaterialUseKey(
						materialSlot.material,
						materialSlot.paletteOverride,
						materialSlot.paletteViews,
					),
				);
				if (!plan) {
					throw new Error(
						`Static object triangle ${createObjectKey(object.identity)}:part:${part.partIndex}:polygon:${triangle.polygonId} references material ${createMaterialKey(materialSlot.material)} without a material plan.`,
					);
				}

				const textureRoleSchemaKey = createStaticMaterialTextureRoleSchemaKey(
					plan.textureRoles,
				);
				const textureRoleLayoutKey = createStaticMaterialTextureRoleLayoutKey(
					plan.textureRoles,
				);
				const materialColorKey = createStaticMaterialColorKey(plan);
				const sourceKey = createSourceKey(object.source);
				const gfxKey = createSourceKey(part.gfxObj);
				const materialKey = createStaticObjectMaterialUseKey(
					materialSlot.material,
					materialSlot.paletteOverride,
					materialSlot.paletteViews,
				);
				const objectKey = createObjectKey(object.identity);
				const materialVariantSignature =
					triangle.materialVariantSignature ?? null;
				const textureWrapMode = resolveTextureWrapMode(
					materialVariantSignature,
				);
				const materialEntryKey = createStaticMaterialEntryKey({
					plan,
					textureWrapMode,
				});
				const partitionAxes = createPartitionAxes({
					domain: payload.domain,
					gfxKey,
					landblockId: payload.landblock.landblockId,
					materialColorKey,
					objectKey,
					owningEnvCellId: object.owningEnvCellId ?? null,
					partIndex: part.partIndex,
					materialEntryKey,
					plan,
					sourceKey,
					textureRoleSchemaKey,
					textureRoleLayoutKey,
					textureWrapMode,
				});
				const batchKey = createPartitionBatchKey(partitionAxes);

				candidates.push({
					batchKey,
					geometrySurfaceId: triangle.geometrySurfaceId,
					gfxObj: part.gfxObj,
					gfxKey,
					firstVertex: triangle.firstVertex,
					material: materialSlot.material,
					materialColorKey,
					materialEntryKey,
					materialId: materialSlot.material.materialId,
					materialKey,
					materialPlan: plan,
					materialVariantSignature,
					object: object.identity,
					objectKey,
					partitionAxes,
					partIndex: part.partIndex,
					polygonId: triangle.polygonId,
					source: object.source,
					sourceKey,
					sourceTriangleId: [
						objectKey,
						`part:${part.partIndex}`,
						`polygon:${triangle.polygonId}`,
						`first-vertex:${triangle.firstVertex}`,
						`geometry-surface:${triangle.geometrySurfaceId}`,
						`variant:${materialVariantSignature ?? "base"}`,
					].join(":"),
					textureWrapMode,
					textureRoleSchemaKey,
					textureRoleLayoutKey,
				});
			}
		}
	}

	return candidates;
}

class MaterialSlotIndex {
	readonly #slotsByObjectPartSurface = new Map<
		string,
		StaticObjectMaterialSlotFacts
	>();

	constructor(payload: StaticObjectBatchPayload) {
		for (const slot of payload.materialSlots) {
			this.#slotsByObjectPartSurface.set(
				createMaterialSlotKey({
					materialVariantSignature: slot.materialVariantSignature,
					object: slot.object,
					partIndex: slot.identity.part.partIndex,
					geometrySurfaceId: slot.identity.geometrySurfaceId,
				}),
				slot,
			);
		}
	}

	resolveMaterialSlot(
		object: StaticObjectInstanceIdentity,
		part: StaticObjectPartSourceFacts,
		triangle: {
			readonly geometrySurfaceId: number | null;
			readonly materialVariantSignature: string | null;
		},
	):
		| StaticObjectMaterialSlotFacts
		| StaticObjectPartSourceFacts["materialSlots"][number]
		| null {
		if (triangle.geometrySurfaceId === null) {
			return null;
		}

		return (
			this.#slotsByObjectPartSurface.get(
				createMaterialSlotKey({
					geometrySurfaceId: triangle.geometrySurfaceId,
					materialVariantSignature: triangle.materialVariantSignature,
					object,
					partIndex: part.partIndex,
				}),
			) ??
			part.materialSlots.find(
				(slot) =>
					slot.geometrySurfaceId === triangle.geometrySurfaceId &&
					slot.materialVariantSignature === triangle.materialVariantSignature,
			) ??
			null
		);
	}
}

function createBatchPartition(options: {
	readonly candidates: readonly StaticObjectTriangleCandidate[];
	readonly batchKey: string;
	readonly batchIndex: number;
	readonly sliceIndex: number;
}): StaticObjectBatchPartition {
	const first = options.candidates[0];
	if (!first) {
		throw new Error("Static object batch slice cannot be empty.");
	}

	const materialIds = uniqueSorted(
		options.candidates.map((candidate) => candidate.materialId),
	);
	const materialEntryKeys = uniqueSortedStrings(
		options.candidates.map((candidate) => candidate.materialEntryKey),
	);
	const textureDataUses = uniqueTextureDataUses(
		options.candidates.flatMap((candidate) =>
			candidate.materialPlan.textureRoles.map((role) => role.dataUse),
		),
	);
	const partitionAxes = createPartitionSliceAxes(
		first.partitionAxes,
		options.candidates,
	);
	const sourceTriangleIds = options.candidates.map(
		(candidate) => candidate.sourceTriangleId,
	);

	return {
		alphaMode: first.materialPlan.alphaPolicy.mode,
		alphaTest: first.materialPlan.alphaPolicy.alphaTest,
		indexedClipThreshold: first.materialPlan.alphaPolicy.indexedClipThreshold,
		batchKey: options.batchKey,
		coarseTablePlan: createCoarseTablePlan({
			candidates: options.candidates,
			partitionAxes,
			sourceTriangleIds,
			textureDataUses,
		}),
		family: first.materialPlan.family,
		materialColor: first.materialPlan.color,
		materialEmissiveColor: first.materialPlan.emissiveColor,
		materialIds,
		materialEntryKeys,
		pass: first.materialPlan.pass,
		partitionAxes,
		reason:
			materialIds.length > STATIC_OBJECT_MAX_MATERIALS_PER_DRAW_SLICE
				? "material table overflow partition"
				: "compatible static object material partition",
		renderCoverage: first.materialPlan.renderCoverage,
		detailTextureTiling: resolveStaticMaterialDetailTextureTiling(
			first.materialPlan,
		),
		sliceId: `slice/${options.batchIndex}/${options.sliceIndex}`,
		sourceTriangleIds,
		textureWrapMode: first.textureWrapMode,
		triangles: options.candidates.map((candidate) => ({
			firstVertex: candidate.firstVertex,
			geometrySurfaceId: candidate.geometrySurfaceId,
			gfxObj: candidate.gfxObj,
			material: candidate.material,
			materialEntryKey: candidate.materialEntryKey,
			materialVariantSignature: candidate.materialVariantSignature,
			object: candidate.object,
			partIndex: candidate.partIndex,
			polygonId: candidate.polygonId,
			source: candidate.source,
			sourceTriangleId: candidate.sourceTriangleId,
		})),
		textureDataUses,
		textureRoleSchemaKey: first.textureRoleSchemaKey,
		textureRoleLayoutKey: first.textureRoleLayoutKey,
		triangleCount: options.candidates.length,
	};
}

function createCoarseTablePlan(options: {
	readonly candidates: readonly StaticObjectTriangleCandidate[];
	readonly partitionAxes: StaticObjectBatchPartitionAxes;
	readonly sourceTriangleIds: readonly string[];
	readonly textureDataUses: readonly MaterialTextureDataUseIdentity[];
}): StaticObjectCoarseTablePlan {
	const entriesByKey = new Map<
		string,
		StaticObjectCoarseMaterialEntry & { readonly materialIdSet: Set<number> }
	>();

	for (const candidate of options.candidates) {
		const existing = entriesByKey.get(candidate.materialEntryKey);
		if (existing) {
			existing.materialIdSet.add(candidate.materialId);
			continue;
		}

		entriesByKey.set(candidate.materialEntryKey, {
			alphaMode: candidate.materialPlan.alphaPolicy.mode,
			alphaTest: candidate.materialPlan.alphaPolicy.alphaTest,
			indexedClipThreshold:
				candidate.materialPlan.alphaPolicy.indexedClipThreshold,
			blend: candidate.materialPlan.blend,
			detailTextureTiling: resolveStaticMaterialDetailTextureTiling(
				candidate.materialPlan,
			),
			materialColor: candidate.materialPlan.color,
			materialEmissiveColor: candidate.materialPlan.emissiveColor,
			materialEntryKey: candidate.materialEntryKey,
			materialIds: [candidate.materialId],
			materialIdSet: new Set([candidate.materialId]),
			materialPlan: candidate.materialPlan,
			materialUseKey: candidate.materialKey,
			textureDataUses: uniqueTextureDataUses(
				candidate.materialPlan.textureRoles.map((role) => role.dataUse),
			),
			textureRoles: candidate.materialPlan.textureRoles,
			textureWrapMode: candidate.textureWrapMode,
		});
	}

	return {
		entries: [...entriesByKey.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([, entry]) => {
				const { materialIdSet, ...coarseEntry } = entry;
				return {
					...coarseEntry,
					materialIds: uniqueSorted([...materialIdSet]),
				};
			}),
		pass: options.partitionAxes.material.pass,
		renderCoverage: options.partitionAxes.material.renderCoverage,
		sortPolicy: options.partitionAxes.sort.policy,
		sourceTriangleIds: options.sourceTriangleIds,
		tableFamily: options.partitionAxes.material.family,
		tableSchemaKey: options.partitionAxes.material.textureRoleSchemaKey,
		textureDataUses: options.textureDataUses,
		visibilityPolicy: options.partitionAxes.visibility.policy,
	};
}

function createPartitionSliceAxes(
	axes: StaticObjectBatchPartitionAxes,
	candidates: readonly StaticObjectTriangleCandidate[],
): StaticObjectBatchPartitionAxes {
	return {
		...axes,
		ownership: {
			...axes.ownership,
			gfxKeys: uniqueSortedStrings(
				candidates.map((candidate) => candidate.gfxKey),
			),
			sourceKeys: uniqueSortedStrings(
				candidates.map((candidate) => candidate.sourceKey),
			),
		},
	};
}

function createPartitionAxes(options: {
	readonly domain: StaticObjectBatchPayload["domain"];
	readonly plan: StaticMaterialPlan;
	readonly landblockId: number;
	readonly sourceKey: string;
	readonly gfxKey: string;
	readonly objectKey: string;
	readonly owningEnvCellId: number | null;
	readonly partIndex: number;
	readonly materialEntryKey: string;
	readonly materialColorKey: string;
	readonly textureWrapMode: StaticObjectTextureWrapMode;
	readonly textureRoleSchemaKey: string;
	readonly textureRoleLayoutKey: string;
}): StaticObjectBatchPartitionAxes {
	const sort = createSortAxis(options.plan);
	const material = createMaterialBatchAxis({
		...options,
		includeConcreteEntryInKey:
			sort.policy === "transparent-object-part-sortable",
	});
	const ownership = createOwnershipAxis({
		...options,
		includeObjectPart: sort.policy === "transparent-object-part-sortable",
	});
	const visibility = createVisibilityAxis();

	return {
		material,
		ownership,
		sort,
		visibility,
	};
}

function createMaterialBatchAxis(options: {
	readonly plan: StaticMaterialPlan;
	readonly materialEntryKey: string;
	readonly materialColorKey: string;
	readonly includeConcreteEntryInKey: boolean;
	readonly textureWrapMode: StaticObjectTextureWrapMode;
	readonly textureRoleSchemaKey: string;
	readonly textureRoleLayoutKey: string;
}): StaticObjectMaterialBatchAxis {
	const key = [
		`family:${options.plan.family}`,
		`coverage:${options.plan.renderCoverage}`,
		`pass:${options.plan.pass}`,
		`alpha:${options.plan.alphaPolicy.mode}`,
		`blend:${options.plan.blend.mode}`,
		options.includeConcreteEntryInKey
			? `entry:${options.materialEntryKey}`
			: `schema:${options.textureRoleSchemaKey}`,
	].join("|");

	return {
		alphaMode: options.plan.alphaPolicy.mode,
		blendMode: options.plan.blend.mode,
		family: options.plan.family,
		key,
		materialEntryKey: options.materialEntryKey,
		materialColorKey: options.materialColorKey,
		pass: options.plan.pass,
		renderCoverage: options.plan.renderCoverage,
		textureRoleSchemaKey: options.textureRoleSchemaKey,
		textureRoleLayoutKey: options.textureRoleLayoutKey,
		textureWrapMode: options.textureWrapMode,
	};
}

function createOwnershipAxis(options: {
	readonly domain: StaticObjectBatchPayload["domain"];
	readonly landblockId: number;
	readonly sourceKey: string;
	readonly gfxKey: string;
	readonly objectKey: string;
	readonly owningEnvCellId: number | null;
	readonly partIndex: number;
	readonly includeObjectPart: boolean;
}): StaticObjectOwnershipAxis {
	if (
		options.domain === "env-cell-system" &&
		options.owningEnvCellId === null
	) {
		throw new Error(
			`Env-cell static object ${options.objectKey} is missing owningEnvCellId.`,
		);
	}

	const objectPartKey = options.includeObjectPart
		? `${options.objectKey}:part:${options.partIndex}`
		: null;
	const envCellKey =
		options.domain === "env-cell-system"
			? `env-cell:${formatHex32(options.owningEnvCellId ?? 0)}`
			: null;
	const keyParts = [
		`domain:${options.domain}`,
		`landblock:${formatHex32(options.landblockId)}`,
		...(envCellKey ? [envCellKey] : []),
		objectPartKey ? "scope:object-part" : "scope:batchable",
	];
	if (objectPartKey) {
		keyParts.push(`object-part:${objectPartKey}`);
	}

	return {
		domain: options.domain,
		envCellId:
			options.domain === "env-cell-system" ? options.owningEnvCellId : null,
		gfxKey: options.gfxKey,
		gfxKeys: [options.gfxKey],
		key: keyParts.join("|"),
		landblockId: options.landblockId,
		objectPartKey,
		sourceKey: options.sourceKey,
		sourceKeys: [options.sourceKey],
	};
}

function createSortAxis(plan: StaticMaterialPlan): StaticObjectSortAxis {
	const policy =
		plan.pass === "transparent" || plan.pass === "additive"
			? "transparent-object-part-sortable"
			: plan.pass === "alpha-test"
				? "alpha-test-batchable"
				: "opaque-batchable";

	return {
		key: `sort:${policy}`,
		policy,
	};
}

function createVisibilityAxis(): StaticObjectVisibilityAxis {
	return {
		key: "visibility:landblock-static-neutral",
		policy: "landblock-static-neutral",
	};
}

function createPartitionBatchKey(
	axes: StaticObjectBatchPartitionAxes,
): string {
	const batchKeyParts = [
		axes.material.key,
		axes.sort.key,
		axes.visibility.key,
		axes.ownership.key,
	];

	if (axes.sort.policy === "transparent-object-part-sortable") {
		if (!axes.ownership.objectPartKey) {
			throw new Error(
				"Transparent static object batch partitioning requires an object/part ownership key.",
			);
		}
		batchKeyParts.push(`object-part:${axes.ownership.objectPartKey}`);
	}

	return batchKeyParts.join("|");
}

function uniqueTextureDataUses(
	dataUses: readonly MaterialTextureDataUseIdentity[],
): readonly MaterialTextureDataUseIdentity[] {
	const byKey = new Map<string, MaterialTextureDataUseIdentity>();
	for (const dataUse of dataUses) {
		byKey.set(createMaterialTextureDataUseKey(dataUse), dataUse);
	}

	return [...byKey.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([, dataUse]) => dataUse);
}

function uniqueSorted(values: readonly number[]): readonly number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}

function uniqueSortedStrings(values: readonly string[]): readonly string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function compareTriangleCandidates(
	left: StaticObjectTriangleCandidate,
	right: StaticObjectTriangleCandidate,
): number {
	return (
		left.batchKey.localeCompare(right.batchKey) ||
		left.objectKey.localeCompare(right.objectKey) ||
		left.partIndex - right.partIndex ||
		left.polygonId - right.polygonId ||
		left.firstVertex - right.firstVertex ||
		left.geometrySurfaceId - right.geometrySurfaceId ||
		(left.materialVariantSignature ?? "").localeCompare(
			right.materialVariantSignature ?? "",
		)
	);
}

function resolveTextureWrapMode(
	materialVariantSignature: string | null,
): StaticObjectTextureWrapMode {
	return materialVariantSignature?.includes("sampler=repeat")
		? "repeat"
		: "clamp";
}

function compareObjects(
	left: {
		readonly identity: StaticObjectInstanceIdentity;
		readonly sourceIndex: number;
	},
	right: {
		readonly identity: StaticObjectInstanceIdentity;
		readonly sourceIndex: number;
	},
): number {
	return (
		left.sourceIndex - right.sourceIndex ||
		createObjectKey(left.identity).localeCompare(
			createObjectKey(right.identity),
		)
	);
}

function createMaterialSlotKey(options: {
	readonly object: StaticObjectInstanceIdentity;
	readonly partIndex: number;
	readonly geometrySurfaceId: number;
	readonly materialVariantSignature: string | null;
}): string {
	return [
		createObjectKey(options.object),
		`part:${options.partIndex}`,
		`geometry-surface:${formatHex32(options.geometrySurfaceId)}`,
		`variant:${options.materialVariantSignature ?? "none"}`,
	].join("|");
}

function createObjectKey(object: StaticObjectInstanceIdentity): string {
	return [
		formatHex32(object.landblockId),
		object.objectKind,
		object.instanceId,
	].join(":");
}

function createSourceKey(source: StaticObjectSourceIdentity): string {
	return [
		source.kind,
		source.sourceAssetKind,
		formatHex32(source.sourceDid),
	].join(":");
}

function createMaterialKey(material: StaticMaterialSourceIdentity): string {
	return `${material.kind}:${formatHex32(material.materialId)}`;
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
