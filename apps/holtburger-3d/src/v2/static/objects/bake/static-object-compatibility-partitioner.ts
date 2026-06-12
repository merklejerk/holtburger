import type {
	MaterialTextureDataUseIdentity,
	OutdoorStaticObjectsScopePayload,
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

export const STATIC_OBJECT_MAX_MATERIALS_PER_DRAW_SLICE = 8;

export interface StaticObjectCompatibilityPartitionPlan {
	readonly domain: OutdoorStaticObjectsScopePayload["domain"];
	readonly partitions: readonly StaticObjectCompatibilityPartition[];
	readonly fallbackReasons: readonly StaticObjectMaterialFallbackReason[];
	readonly materialCoverage: StaticMaterialCoverageReport;
}

export interface StaticObjectCompatibilityPartition {
	readonly sliceId: string;
	readonly compatibilityKey: string;
	readonly family: StaticObjectMaterialPlan["family"];
	readonly renderCoverage: StaticObjectMaterialPlan["renderCoverage"];
	readonly pass: StaticObjectMaterialPlan["pass"];
	readonly alphaMode: StaticObjectMaterialPlan["alphaPolicy"]["mode"];
	readonly alphaTest: StaticObjectMaterialPlan["alphaPolicy"]["alphaTest"];
	readonly materialColor: StaticObjectMaterialPlan["color"];
	readonly materialEmissiveColor: StaticObjectMaterialPlan["emissiveColor"];
	readonly textureWrapMode: StaticObjectTextureWrapMode;
	readonly textureRoleLayoutKey: string;
	readonly materialIds: readonly number[];
	readonly textureDataUses: readonly MaterialTextureDataUseIdentity[];
	readonly triangles: readonly StaticObjectCompatibilityTriangle[];
	readonly sourceTriangleIds: readonly string[];
	readonly triangleCount: number;
	readonly reason: string;
}

export interface StaticObjectCompatibilityTriangle {
	readonly sourceTriangleId: string;
	readonly object: StaticObjectInstanceIdentity;
	readonly source: StaticObjectSourceIdentity;
	readonly gfxObj: StaticObjectSourceIdentity;
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
	readonly object: StaticObjectInstanceIdentity;
	readonly source: StaticObjectSourceIdentity;
	readonly gfxObj: StaticObjectSourceIdentity;
	readonly material: StaticMaterialSourceIdentity;
	readonly materialKey: string;
	readonly materialId: number;
	readonly materialPlan: StaticObjectMaterialPlan;
	readonly materialColorKey: string;
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
	payload: OutdoorStaticObjectsScopePayload,
): StaticObjectCompatibilityPartitionPlan {
	const materialPlan = planStaticObjectMaterials(payload);
	const materialById = new Map(
		materialPlan.materialPlans.map((plan) => [plan.materialUseKey, plan]),
	);
	const candidates = [...createTriangleCandidates(payload, materialById)].sort(
		compareTriangleCandidates,
	);
	const candidatesByCompatibility = groupByCompatibility(candidates);
	const partitions = [...candidatesByCompatibility.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.flatMap(([compatibilityKey, group], compatibilityIndex) =>
			createCompatibilitySlices(compatibilityKey, compatibilityIndex, group),
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
	payload: OutdoorStaticObjectsScopePayload,
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
				const materialSlot = materialSlots.resolveMaterialSlot(object.identity, part, {
					geometrySurfaceId: triangle.geometrySurfaceId,
					materialVariantSignature: triangle.materialVariantSignature,
				});
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
				const compatibilityKey = createCompatibilityKey({
					gfxKey,
					plan,
					materialColorKey,
					sourceKey,
					textureWrapMode,
					textureRoleLayoutKey,
				});

				candidates.push({
					compatibilityKey,
					geometrySurfaceId: triangle.geometrySurfaceId,
					gfxObj: part.gfxObj,
					gfxKey,
					firstVertex: triangle.firstVertex,
					material: materialSlot.material,
					materialColorKey,
					materialId: materialSlot.material.materialId,
					materialKey,
					materialPlan: plan,
					materialVariantSignature,
					object: object.identity,
					objectKey,
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

	constructor(payload: OutdoorStaticObjectsScopePayload) {
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
	): StaticObjectMaterialSlotFacts | StaticObjectPartSourceFacts["materialSlots"][number] | null {
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

function groupByCompatibility(
	candidates: readonly StaticObjectTriangleCandidate[],
): Map<string, readonly StaticObjectTriangleCandidate[]> {
	const groups = new Map<string, StaticObjectTriangleCandidate[]>();

	for (const candidate of candidates) {
		const group = groups.get(candidate.compatibilityKey);
		if (group) {
			group.push(candidate);
		} else {
			groups.set(candidate.compatibilityKey, [candidate]);
		}
	}

	return groups;
}

function createCompatibilitySlices(
	compatibilityKey: string,
	compatibilityIndex: number,
	candidates: readonly StaticObjectTriangleCandidate[],
): readonly StaticObjectCompatibilityPartition[] {
	const slices: StaticObjectTriangleCandidate[][] = [];
	let currentSlice: StaticObjectTriangleCandidate[] = [];
	let currentMaterialKeys = new Set<string>();

	for (const candidate of candidates) {
		if (
			!currentMaterialKeys.has(candidate.materialKey) &&
			currentMaterialKeys.size >= STATIC_OBJECT_MAX_MATERIALS_PER_DRAW_SLICE
		) {
			slices.push(currentSlice);
			currentSlice = [];
			currentMaterialKeys = new Set<string>();
		}

		currentSlice.push(candidate);
		currentMaterialKeys.add(candidate.materialKey);
	}

	if (currentSlice.length > 0) {
		slices.push(currentSlice);
	}

	return slices.map((slice, sliceIndex) =>
		createCompatibilityPartition({
			candidates: slice,
			compatibilityIndex,
			compatibilityKey,
			sliceIndex,
		}),
	);
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
	const textureDataUses = uniqueTextureDataUses(
		options.candidates.flatMap((candidate) =>
			candidate.materialPlan.textureRoles.map((role) => role.dataUse),
		),
	);

	return {
		alphaMode: first.materialPlan.alphaPolicy.mode,
		alphaTest: first.materialPlan.alphaPolicy.alphaTest,
		compatibilityKey: options.compatibilityKey,
		family: first.materialPlan.family,
		materialColor: first.materialPlan.color,
		materialEmissiveColor: first.materialPlan.emissiveColor,
		materialIds,
		pass: first.materialPlan.pass,
		reason:
			materialIds.length > STATIC_OBJECT_MAX_MATERIALS_PER_DRAW_SLICE
				? "material table overflow partition"
				: "compatible static object material partition",
		renderCoverage: first.materialPlan.renderCoverage,
		sliceId: `slice/${options.compatibilityIndex}/${options.sliceIndex}`,
		sourceTriangleIds: options.candidates.map(
			(candidate) => candidate.sourceTriangleId,
		),
		textureWrapMode: first.textureWrapMode,
		triangles: options.candidates.map((candidate) => ({
			firstVertex: candidate.firstVertex,
			geometrySurfaceId: candidate.geometrySurfaceId,
			gfxObj: candidate.gfxObj,
			material: candidate.material,
			materialVariantSignature: candidate.materialVariantSignature,
			object: candidate.object,
			partIndex: candidate.partIndex,
			polygonId: candidate.polygonId,
			source: candidate.source,
			sourceTriangleId: candidate.sourceTriangleId,
		})),
		textureDataUses,
		textureRoleLayoutKey: first.textureRoleLayoutKey,
		triangleCount: options.candidates.length,
	};
}

function createCompatibilityKey(options: {
	readonly plan: StaticObjectMaterialPlan;
	readonly sourceKey: string;
	readonly gfxKey: string;
	readonly materialColorKey: string;
	readonly textureWrapMode: StaticObjectTextureWrapMode;
	readonly textureRoleLayoutKey: string;
}): string {
	return [
		`family:${options.plan.family}`,
		`coverage:${options.plan.renderCoverage}`,
		`pass:${options.plan.pass}`,
		`alpha:${options.plan.alphaPolicy.mode}`,
		`blend:${options.plan.blend.mode}`,
		`color:${options.materialColorKey}`,
		`wrap:${options.textureWrapMode}`,
		`roles:${options.textureRoleLayoutKey}`,
		`source:${options.sourceKey}`,
		`gfx:${options.gfxKey}`,
	].join("|");
}

function createMaterialColorKey(plan: StaticObjectMaterialPlan): string {
	return [
		...plan.color.map(formatMaterialScalar),
		...plan.emissiveColor.map(formatMaterialScalar),
	].join(",");
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
			return `${role.role}:${dataUseKey}`;
		})
		.join(",");
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
