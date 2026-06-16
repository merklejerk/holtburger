import type {
	MaterialTextureDataUseIdentity,
	LandblockSourceIdentity,
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
import { createStaticObjectMaterialCoverageReport } from "./static-object-material-coverage";
import {
	createStaticObjectMaterialUseKey,
	planStaticObjectMaterials,
	type StaticObjectMaterialFallbackReason,
	type StaticObjectMaterialPlan,
	type StaticObjectMaterialTextureUseRole,
} from "./static-object-material-planner";
import { sliceStaticMaterialCompatibilityCandidates } from "./static-material-compatibility-slicer";

export const STATIC_OBJECT_MAX_MATERIALS_PER_DRAW_SLICE = 8;

export interface StaticObjectCompatibilityPartitionPlan {
	readonly domain: StaticObjectCompatibilityPayload["domain"];
	readonly partitions: readonly StaticObjectCompatibilityPartition[];
	readonly fallbackReasons: readonly StaticObjectMaterialFallbackReason[];
	readonly materialCoverage: StaticMaterialCoverageReport;
}

export interface StaticObjectCompatibilityPayload {
	readonly domain: Extract<
		StaticDomain,
		"outdoor-buildings" | "outdoor-detail" | "landblock-env-cells"
	>;
	readonly landblock: LandblockSourceIdentity;
	readonly regionRenderProfile: {
		readonly detailRoles: readonly RegionDetailRoleFacts[];
	};
	readonly objects: readonly StaticObjectCompatibilityObject[];
	readonly sourceAssets: OutdoorStaticObjectsScopePayload["sourceAssets"];
	readonly paletteSources: OutdoorStaticObjectsScopePayload["paletteSources"];
	readonly materialSlots: OutdoorStaticObjectsScopePayload["materialSlots"];
	readonly materialSources: OutdoorStaticObjectsScopePayload["materialSources"];
	readonly textureRefs: OutdoorStaticObjectsScopePayload["textureRefs"];
}

export type StaticObjectCompatibilityObject =
	OutdoorStaticObjectsScopePayload["objects"][number] & {
		readonly owningEnvCellId?: number | null;
	};

export interface StaticObjectCompatibilityPartition {
	readonly sliceId: string;
	readonly compatibilityKey: string;
	readonly partitionAxes: StaticObjectCompatibilityPartitionAxes;
	readonly coarseTablePlan: StaticObjectCoarseTablePlan;
	readonly family: StaticObjectMaterialPlan["family"];
	readonly renderCoverage: StaticObjectMaterialPlan["renderCoverage"];
	readonly pass: StaticObjectMaterialPlan["pass"];
	readonly alphaMode: StaticObjectMaterialPlan["alphaPolicy"]["mode"];
	readonly alphaTest: StaticObjectMaterialPlan["alphaPolicy"]["alphaTest"];
	readonly indexedClipThreshold: StaticObjectMaterialPlan["alphaPolicy"]["indexedClipThreshold"];
	readonly materialColor: StaticObjectMaterialPlan["color"];
	readonly materialEmissiveColor: StaticObjectMaterialPlan["emissiveColor"];
	readonly textureWrapMode: StaticObjectTextureWrapMode;
	readonly detailTextureTiling: number;
	readonly textureRoleSchemaKey: string;
	readonly textureRoleLayoutKey: string;
	readonly materialIds: readonly number[];
	readonly materialEntryKeys: readonly string[];
	readonly textureDataUses: readonly MaterialTextureDataUseIdentity[];
	readonly triangles: readonly StaticObjectCompatibilityTriangle[];
	readonly sourceTriangleIds: readonly string[];
	readonly triangleCount: number;
	readonly reason: string;
}

interface StaticObjectCoarseTablePlan {
	readonly tableFamily: StaticObjectMaterialPlan["family"];
	readonly tableSchemaKey: string;
	readonly renderCoverage: StaticObjectMaterialPlan["renderCoverage"];
	readonly pass: StaticObjectMaterialPlan["pass"];
	readonly sortPolicy: StaticObjectSortAxis["policy"];
	readonly visibilityPolicy: StaticObjectVisibilityAxis["policy"];
	readonly entries: readonly StaticObjectCoarseMaterialEntry[];
	readonly textureDataUses: readonly MaterialTextureDataUseIdentity[];
	readonly sourceTriangleIds: readonly string[];
}

interface StaticObjectCoarseMaterialEntry {
	readonly materialEntryKey: string;
	readonly materialUseKey: string;
	readonly materialIds: readonly number[];
	readonly blend: StaticObjectMaterialPlan["blend"];
	readonly materialColor: StaticObjectMaterialPlan["color"];
	readonly materialEmissiveColor: StaticObjectMaterialPlan["emissiveColor"];
	readonly alphaMode: StaticObjectMaterialPlan["alphaPolicy"]["mode"];
	readonly alphaTest: StaticObjectMaterialPlan["alphaPolicy"]["alphaTest"];
	readonly indexedClipThreshold: StaticObjectMaterialPlan["alphaPolicy"]["indexedClipThreshold"];
	readonly textureWrapMode: StaticObjectTextureWrapMode;
	readonly detailTextureTiling: number;
	readonly textureRoles: readonly StaticObjectMaterialTextureUseRole[];
	readonly textureDataUses: readonly MaterialTextureDataUseIdentity[];
}

interface StaticObjectCompatibilityPartitionAxes {
	readonly material: StaticObjectMaterialCompatibilityAxis;
	readonly ownership: StaticObjectOwnershipAxis;
	readonly sort: StaticObjectSortAxis;
	readonly visibility: StaticObjectVisibilityAxis;
}

interface StaticObjectMaterialCompatibilityAxis {
	readonly key: string;
	readonly family: StaticObjectMaterialPlan["family"];
	readonly renderCoverage: StaticObjectMaterialPlan["renderCoverage"];
	readonly pass: StaticObjectMaterialPlan["pass"];
	readonly alphaMode: StaticObjectMaterialPlan["alphaPolicy"]["mode"];
	readonly blendMode: StaticObjectMaterialPlan["blend"]["mode"];
	readonly materialEntryKey: string;
	readonly materialColorKey: string;
	readonly textureWrapMode: StaticObjectTextureWrapMode;
	readonly textureRoleSchemaKey: string;
	readonly textureRoleLayoutKey: string;
}

interface StaticObjectOwnershipAxis {
	readonly key: string;
	readonly domain: StaticObjectCompatibilityPayload["domain"];
	readonly landblockId: number;
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

export interface StaticObjectCompatibilityTriangle {
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
	readonly compatibilityKey: string;
	readonly partitionAxes: StaticObjectCompatibilityPartitionAxes;
	readonly object: StaticObjectInstanceIdentity;
	readonly source: StaticObjectSourceIdentity;
	readonly gfxObj: StaticObjectSourceIdentity;
	readonly material: StaticMaterialSourceIdentity;
	readonly materialKey: string;
	readonly materialId: number;
	readonly materialPlan: StaticObjectMaterialPlan;
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

export function partitionStaticObjectCompatibility(
	payload: StaticObjectCompatibilityPayload,
): StaticObjectCompatibilityPartitionPlan {
	const materialPlan = planStaticObjectMaterials(payload);
	const materialById = new Map(
		materialPlan.materialPlans.map((plan) => [plan.materialUseKey, plan]),
	);
	const candidates = [...createTriangleCandidates(payload, materialById)].sort(
		compareTriangleCandidates,
	);
	const partitions = sliceStaticMaterialCompatibilityCandidates({
		candidates,
		maxMaterialEntriesPerSlice: STATIC_OBJECT_MAX_MATERIALS_PER_DRAW_SLICE,
	}).map((slice) =>
		createCompatibilityPartition({
			candidates: slice.candidates,
			compatibilityIndex: slice.compatibilityIndex,
			compatibilityKey: slice.compatibilityKey,
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
	payload: StaticObjectCompatibilityPayload,
	materialById: ReadonlyMap<string, StaticObjectMaterialPlan>,
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

				const textureRoleSchemaKey = createTextureRoleSchemaKey(
					plan.textureRoles,
				);
				const textureRoleLayoutKey = createTextureRoleLayoutKey(
					plan.textureRoles,
				);
				const materialColorKey = createMaterialColorKey(plan);
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
				const materialEntryKey = createMaterialEntryKey({
					materialColorKey,
					plan,
					textureRoleLayoutKey,
					textureWrapMode,
				});
				const partitionAxes = createPartitionAxes({
					domain: payload.domain,
					gfxKey,
					landblockId: payload.landblock.landblockId,
					materialColorKey,
					objectKey,
					partIndex: part.partIndex,
					materialEntryKey,
					plan,
					sourceKey,
					textureRoleSchemaKey,
					textureRoleLayoutKey,
					textureWrapMode,
				});
				const compatibilityKey = createPartitionCompatibilityKey(partitionAxes);

				candidates.push({
					compatibilityKey,
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

	constructor(payload: StaticObjectCompatibilityPayload) {
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

function createCompatibilityPartition(options: {
	readonly candidates: readonly StaticObjectTriangleCandidate[];
	readonly compatibilityKey: string;
	readonly compatibilityIndex: number;
	readonly sliceIndex: number;
}): StaticObjectCompatibilityPartition {
	const first = options.candidates[0];
	if (!first) {
		throw new Error("Static object compatibility slice cannot be empty.");
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
		compatibilityKey: options.compatibilityKey,
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
		detailTextureTiling: resolveDetailTextureTiling(first.materialPlan),
		sliceId: `slice/${options.compatibilityIndex}/${options.sliceIndex}`,
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
	readonly partitionAxes: StaticObjectCompatibilityPartitionAxes;
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
			detailTextureTiling: resolveDetailTextureTiling(candidate.materialPlan),
			materialColor: candidate.materialPlan.color,
			materialEmissiveColor: candidate.materialPlan.emissiveColor,
			materialEntryKey: candidate.materialEntryKey,
			materialIds: [candidate.materialId],
			materialIdSet: new Set([candidate.materialId]),
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
	axes: StaticObjectCompatibilityPartitionAxes,
	candidates: readonly StaticObjectTriangleCandidate[],
): StaticObjectCompatibilityPartitionAxes {
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
	readonly domain: StaticObjectCompatibilityPayload["domain"];
	readonly plan: StaticObjectMaterialPlan;
	readonly landblockId: number;
	readonly sourceKey: string;
	readonly gfxKey: string;
	readonly objectKey: string;
	readonly partIndex: number;
	readonly materialEntryKey: string;
	readonly materialColorKey: string;
	readonly textureWrapMode: StaticObjectTextureWrapMode;
	readonly textureRoleSchemaKey: string;
	readonly textureRoleLayoutKey: string;
}): StaticObjectCompatibilityPartitionAxes {
	const sort = createSortAxis(options.plan);
	const material = createMaterialCompatibilityAxis({
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

function createMaterialCompatibilityAxis(options: {
	readonly plan: StaticObjectMaterialPlan;
	readonly materialEntryKey: string;
	readonly materialColorKey: string;
	readonly includeConcreteEntryInKey: boolean;
	readonly textureWrapMode: StaticObjectTextureWrapMode;
	readonly textureRoleSchemaKey: string;
	readonly textureRoleLayoutKey: string;
}): StaticObjectMaterialCompatibilityAxis {
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
	readonly domain: StaticObjectCompatibilityPayload["domain"];
	readonly landblockId: number;
	readonly sourceKey: string;
	readonly gfxKey: string;
	readonly objectKey: string;
	readonly partIndex: number;
	readonly includeObjectPart: boolean;
}): StaticObjectOwnershipAxis {
	const objectPartKey = options.includeObjectPart
		? `${options.objectKey}:part:${options.partIndex}`
		: null;
	const keyParts = [
		`domain:${options.domain}`,
		`landblock:${formatHex32(options.landblockId)}`,
		objectPartKey ? "scope:object-part" : "scope:batchable",
	];
	if (objectPartKey) {
		keyParts.push(`object-part:${objectPartKey}`);
	}

	return {
		domain: options.domain,
		gfxKey: options.gfxKey,
		gfxKeys: [options.gfxKey],
		key: keyParts.join("|"),
		landblockId: options.landblockId,
		objectPartKey,
		sourceKey: options.sourceKey,
		sourceKeys: [options.sourceKey],
	};
}

function createSortAxis(plan: StaticObjectMaterialPlan): StaticObjectSortAxis {
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

function createPartitionCompatibilityKey(
	axes: StaticObjectCompatibilityPartitionAxes,
): string {
	const compatibilityKeyParts = [
		axes.material.key,
		axes.sort.key,
		axes.visibility.key,
		axes.ownership.key,
	];

	if (axes.sort.policy === "transparent-object-part-sortable") {
		if (!axes.ownership.objectPartKey) {
			throw new Error(
				"Transparent static object compatibility requires an object/part ownership key.",
			);
		}
		compatibilityKeyParts.push(`object-part:${axes.ownership.objectPartKey}`);
	}

	return compatibilityKeyParts.join("|");
}

function createMaterialColorKey(plan: StaticObjectMaterialPlan): string {
	return [
		...plan.color.map(formatMaterialScalar),
		...plan.emissiveColor.map(formatMaterialScalar),
	].join(",");
}

function createMaterialEntryKey(options: {
	readonly plan: StaticObjectMaterialPlan;
	readonly materialColorKey: string;
	readonly textureWrapMode: StaticObjectTextureWrapMode;
	readonly textureRoleLayoutKey: string;
}): string {
	return [
		`color:${options.materialColorKey}`,
		`wrap:${options.textureWrapMode}`,
		`roles:${options.textureRoleLayoutKey}`,
		`alpha-test:${formatMaterialScalar(options.plan.alphaPolicy.alphaTest)}`,
		`indexed-clip:${formatMaterialScalar(
			options.plan.alphaPolicy.indexedClipThreshold,
		)}`,
		`detail-tiling:${formatMaterialScalar(
			resolveDetailTextureTiling(options.plan),
		)}`,
	].join("|");
}

function formatMaterialScalar(value: number): string {
	return value.toFixed(6);
}

function createTextureRoleLayoutKey(
	roles: readonly StaticObjectMaterialTextureUseRole[],
): string {
	if (roles.length === 0) {
		return "none";
	}

	return roles
		.map((role) => {
			const dataUseKey = createMaterialTextureDataUseKey(role.dataUse);
			const detailSuffix =
				role.role === "detail-overlay" ? `:tiling=${role.tiling}` : "";
			return `${role.role}:${dataUseKey}${detailSuffix}`;
		})
		.join(",");
}

function createTextureRoleSchemaKey(
	roles: readonly StaticObjectMaterialTextureUseRole[],
): string {
	if (roles.length === 0) {
		return "none";
	}

	return roles
		.map((role) => {
			const detailSuffix =
				role.role === "detail-overlay" ? `:tiling=${role.tiling}` : "";
			return `${role.role}:${createTextureDataUseSchemaKey(role.dataUse)}${detailSuffix}`;
		})
		.join(",");
}

function createTextureDataUseSchemaKey(
	dataUse: MaterialTextureDataUseIdentity,
): string {
	if (dataUse.kind === "palette-texture-use") {
		return [
			dataUse.kind,
			`range:${dataUse.firstIndex}-${dataUse.indexCount}`,
			dataUse.usage,
		].join(":");
	}

	return [dataUse.kind, dataUse.usage].join(":");
}

function resolveDetailTextureTiling(plan: StaticObjectMaterialPlan): number {
	const detailRole = plan.textureRoles.find(
		(role) => role.role === "detail-overlay",
	);
	return detailRole?.role === "detail-overlay" ? detailRole.tiling : 1;
}

export function createMaterialTextureDataUseKey(
	dataUse: MaterialTextureDataUseIdentity,
): string {
	if (dataUse.kind === "palette-texture-use") {
		return [
			dataUse.kind,
			formatHex32(dataUse.palette.paletteId),
			`range:${dataUse.firstIndex}-${dataUse.indexCount}`,
			createPaletteTextureSubPalettesKey(dataUse.subPalettes ?? []),
			dataUse.usage,
		].join(":");
	}

	return [
		dataUse.kind,
		formatHex32(dataUse.renderSurface.renderSurfaceId),
		dataUse.usage,
	].join(":");
}

function createPaletteTextureSubPalettesKey(
	subPalettes: Extract<
		MaterialTextureDataUseIdentity,
		{ readonly kind: "palette-texture-use" }
	>["subPalettes"],
): string {
	if (subPalettes.length === 0) {
		return "sub:none";
	}
	return [
		"sub",
		...subPalettes.map(
			(subPalette) =>
				`${formatHex32(subPalette.palette.paletteId)}@${subPalette.firstIndex}+${subPalette.indexCount}`,
		),
	].join(":");
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
		left.compatibilityKey.localeCompare(right.compatibilityKey) ||
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
