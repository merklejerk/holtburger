import type {
	BakedDynamicVisualResource,
	DynamicEntityMaterialSlotRequirement,
	DynamicEntityRenderPart,
	DynamicEntityTextureRequirement,
	DynamicEntityUnsupportedMaterialReason,
	DynamicVisualMaterialSlotIdentity,
	DynamicVisualObjectIdentity,
	DynamicVisualPartIdentity,
	DynamicVisualBakeInput,
	DynamicVisualBakeProduct,
	DynamicVisualBakeResult,
} from "./contracts";
import { createDynamicVisualResourceId } from "./contracts";
import { createPreparedTextureHostKey } from "../assets/preparation/prepared-texture-source";
import { createStaticMaterialTableEntry } from "../static/bake/static-material-adapter";
import {
	createStaticMaterialTextureSamplingPolicy,
	resolveRepeatedStaticMaterialPrimaryWrapMode,
} from "../static/bake/static-material-texture-policy";
import type {
	LandblockSourceIdentity,
	MaterialTextureDataUseIdentity,
	StaticMaterialTableEntry,
	StaticObjectPartMaterialSlotFacts,
	StaticObjectSourceAssetFacts,
	StaticObjectSourceGeometryAttachment,
} from "../static/contracts";
import {
	createStaticObjectMaterialUseKey,
	planStaticObjectMaterials,
	type StaticMaterialFallbackReason,
	type StaticMaterialPlan,
	type StaticMaterialPlanningSlotFacts,
} from "../static/objects/bake/static-object-material-planner";
import { describeStaticObjectSourceGeometryIdentity } from "../static/objects/static-object-source-assets";

export interface DynamicVisualBaker {
	bake(input: DynamicVisualBakeInput): Promise<DynamicVisualBakeResult>;
}

interface DynamicMaterialSlotFacts {
	readonly identity: DynamicVisualMaterialSlotIdentity;
	readonly partIndex: number;
	readonly partSlot: StaticObjectPartMaterialSlotFacts;
	readonly planningFacts: StaticMaterialPlanningSlotFacts;
}

interface DynamicMaterialRenderEntry {
	readonly entry: StaticMaterialTableEntry;
	readonly family: DynamicMaterialRenderFamily;
	readonly pass: "opaque" | "alpha-test" | "transparent" | "additive";
}

type DynamicMaterialRenderFamily =
	| "flat-color"
	| "indexed-paletted"
	| "texture-rgba";

interface DynamicTriangleRenderCandidate {
	readonly materialEntry: DynamicMaterialRenderEntry;
	readonly triangle: StaticObjectSourceAssetFacts["parts"][number]["triangles"][number];
}

export class LocalDynamicVisualBaker implements DynamicVisualBaker {
	async bake(input: DynamicVisualBakeInput): Promise<DynamicVisualBakeResult> {
		return bakeDynamicVisuals(input);
	}
}

export function bakeDynamicVisuals(
	input: DynamicVisualBakeInput,
): DynamicVisualBakeResult {
	const sourceGeometryByKey = createSourceGeometryIndex(input.sourceGeometry);
	const products: DynamicVisualBakeProduct[] = [];
	const failures: DynamicVisualBakeResult["failures"][number][] = [];

	for (const recipe of input.recipes) {
		if (recipe.visual.missingRefs.length > 0) {
			products.push({
				entityId: recipe.entityId,
				kind: "skipped",
				reason: {
					kind: "missing-dependencies",
					missingRefs: recipe.visual.missingRefs,
				},
			});
			continue;
		}

		try {
			const resource = bakeDynamicVisualRecipe({
				recipe,
				sourceGeometryByKey,
			});
			products.push({
				kind: "baked",
				resource,
			});
		} catch (error) {
			if (error instanceof DynamicVisualSkipError) {
				products.push({
					entityId: recipe.entityId,
					kind: "skipped",
					reason: error.productReason,
				});
				continue;
			}
			failures.push({
				entityId: recipe.entityId,
				message: formatErrorMessage(error),
				stage: "render-part-extraction",
			});
		}
	}

	return {
		batchId: input.batchId,
		failures,
		products,
		revision: input.revision,
	};
}

function bakeDynamicVisualRecipe(options: {
	readonly recipe: DynamicVisualBakeInput["recipes"][number];
	readonly sourceGeometryByKey: ReadonlyMap<
		string,
		StaticObjectSourceGeometryAttachment
	>;
}): BakedDynamicVisualResource {
	const { recipe } = options;
	const materialSlots = createDynamicMaterialSlotRequirements(
		recipe.visual.materialPolicy.visualObject,
		recipe.visual.sourceAssets,
	);
	const materialPlans = planStaticObjectMaterials({
		domain: recipe.visual.materialPolicy.materialPlanningDomain,
		landblock: createMaterialPlanningLandblockSource(recipe),
		materialSlots: materialSlots.map((slot) => slot.planningFacts),
		materialSources: recipe.visual.materialSources,
		paletteSources: recipe.visual.paletteSources,
		regionRenderProfile: { detailRoles: [] },
		textureRefs: recipe.visual.textureRefs,
	});
	const unsupportedReasons = createUnsupportedMaterialReasons(
		materialPlans.fallbackReasons,
	);
	if (unsupportedReasons.length > 0) {
		throw new DynamicVisualSkipError({
			kind: "unsupported-materials",
			unsupportedReasons,
		});
	}

	const textureRequirements = createTextureRequirements(
		materialPlans.materialPlans,
	);
	return {
		entityId: recipe.entityId,
		materialSlots: materialSlots.map(createMaterialSlotRequirement),
		materialSources: recipe.visual.materialSources,
		paletteSources: recipe.visual.paletteSources,
		renderParts: createDynamicRenderParts({
			materialPlans: materialPlans.materialPlans,
			sourceAssets: recipe.visual.sourceAssets,
			sourceGeometryByKey: options.sourceGeometryByKey,
			textureRequirements,
		}),
		resourceId: createDynamicVisualResourceId(recipe.entityId),
		sourceAssets: recipe.visual.sourceAssets,
		textureRefs: recipe.visual.textureRefs,
		textureRequirements,
	};
}

function createSourceGeometryIndex(
	attachments: readonly StaticObjectSourceGeometryAttachment[],
): ReadonlyMap<string, StaticObjectSourceGeometryAttachment> {
	return new Map(
		attachments.map((attachment) => [
			describeStaticObjectSourceGeometryIdentity(attachment.identity),
			attachment,
		]),
	);
}

function createDynamicMaterialSlotRequirements(
	visualObject: DynamicVisualObjectIdentity,
	sourceAssets: readonly StaticObjectSourceAssetFacts[],
): readonly DynamicMaterialSlotFacts[] {
	return sourceAssets.flatMap((source) =>
		source.parts.flatMap((part) =>
			part.materialSlots.map((slot) => {
				const visualPart = createDynamicVisualPartIdentity({
					part,
					source,
					visualObject,
				});
				return {
					identity: createDynamicVisualMaterialSlotIdentity({
						part: visualPart,
						slot,
					}),
					partIndex: part.partIndex,
					partSlot: slot,
					planningFacts: {
						material: slot.material,
						paletteOverride: slot.paletteOverride,
						paletteViews: slot.paletteViews,
					},
				};
			}),
		),
	);
}

function createDynamicVisualPartIdentity(options: {
	readonly part: StaticObjectSourceAssetFacts["parts"][number];
	readonly source: StaticObjectSourceAssetFacts;
	readonly visualObject: DynamicVisualObjectIdentity;
}): DynamicVisualPartIdentity {
	return {
		gfxObj: options.part.gfxObj,
		kind: "dynamic-visual-part",
		object: options.visualObject,
		partIndex: options.part.partIndex,
		source: options.source.identity,
	};
}

function createDynamicVisualMaterialSlotIdentity(options: {
	readonly part: DynamicVisualPartIdentity;
	readonly slot: StaticObjectPartMaterialSlotFacts;
}): DynamicVisualMaterialSlotIdentity {
	return {
		geometrySurfaceId: options.slot.geometrySurfaceId,
		kind: "dynamic-visual-material-slot",
		materialSurfaceId: options.slot.materialSurfaceId,
		part: options.part,
		slotIndex: options.slot.slotIndex,
	};
}

function createMaterialSlotRequirement(
	slot: DynamicMaterialSlotFacts,
): DynamicEntityMaterialSlotRequirement {
	return {
		identity: slot.identity,
		material: slot.partSlot.material,
		partIndex: slot.partIndex,
		slot: slot.partSlot,
	};
}

function createMaterialPlanningLandblockSource(
	recipe: DynamicVisualBakeInput["recipes"][number],
): LandblockSourceIdentity {
	return {
		kind: "landblock-source",
		landblockId: recipe.source.sourceResidence.landblockId,
		source:
			recipe.source.sourceResidence.kind === "env-cell"
				? "env-cells"
				: "outdoor",
	};
}

function createTextureRequirements(
	materialPlans: readonly StaticMaterialPlan[],
): readonly DynamicEntityTextureRequirement[] {
	return materialPlans.flatMap((plan) => {
		const dataUses = plan.textureRoles.map((role) => role.dataUse);
		const wrapMode = resolveRepeatedStaticMaterialPrimaryWrapMode(dataUses);
		return plan.textureRoles.map(
			(role): DynamicEntityTextureRequirement => ({
				dataUse: role.dataUse,
				key: createTextureRequirementKey(role.dataUse),
				material: plan.material,
				role: role.role,
				samplingPolicy: createStaticMaterialTextureSamplingPolicy({
					dataUse: role.dataUse,
					wrapMode,
				}),
				textureUseId: createDynamicTextureUseId(plan, role),
			}),
		);
	});
}

function createDynamicTextureUseId(
	plan: StaticMaterialPlan,
	role: StaticMaterialPlan["textureRoles"][number],
): string {
	return [
		"dynamic-texture",
		plan.material.materialId.toString(16).padStart(8, "0"),
		role.role,
		role.dataUse.kind === "palette-texture-use"
			? createMaterialTextureDataUseSignature(role.dataUse)
			: createPreparedTextureHostKey(role.dataUse).id,
	].join(":");
}

function createMaterialTextureDataUseSignature(
	dataUse: MaterialTextureDataUseIdentity,
): string {
	if (dataUse.kind !== "palette-texture-use") {
		return [
			dataUse.kind,
			dataUse.usage,
			createPreparedTextureHostKey(dataUse).id,
		].join(":");
	}

	const subPaletteSignature =
		dataUse.subPalettes.length === 0
			? "none"
			: [...dataUse.subPalettes]
					.sort(
						(left, right) =>
							left.firstIndex - right.firstIndex ||
							left.indexCount - right.indexCount ||
							left.palette.paletteId - right.palette.paletteId,
					)
					.map(
						(subPalette) =>
							`${formatHex32(subPalette.palette.paletteId)}@${subPalette.firstIndex}+${subPalette.indexCount}`,
					)
					.join(",");
	return [
		dataUse.kind,
		dataUse.usage,
		formatHex32(dataUse.palette.paletteId),
		`${dataUse.firstIndex}+${dataUse.indexCount}`,
		subPaletteSignature,
	].join(":");
}

function createTextureRequirementKey(
	dataUse: MaterialTextureDataUseIdentity,
): DynamicEntityTextureRequirement["key"] {
	if (dataUse.kind === "palette-texture-use") {
		return {
			id: dataUse.palette.paletteId,
			kind: "palette",
		};
	}

	return {
		id: createPreparedTextureHostKey(dataUse).id,
		kind: "prepared-texture",
	};
}

function createUnsupportedMaterialReasons(
	reasons: readonly StaticMaterialFallbackReason[],
): readonly DynamicEntityUnsupportedMaterialReason[] {
	return reasons.map((reason) => ({
		code: reason.code,
		material: reason.material,
		message: reason.message,
	}));
}

function createDynamicRenderParts(options: {
	readonly materialPlans: readonly StaticMaterialPlan[];
	readonly sourceAssets: readonly StaticObjectSourceAssetFacts[];
	readonly sourceGeometryByKey: ReadonlyMap<
		string,
		StaticObjectSourceGeometryAttachment
	>;
	readonly textureRequirements: readonly DynamicEntityTextureRequirement[];
}): readonly DynamicEntityRenderPart[] {
	const materialEntryByUseKey = createDynamicMaterialEntriesByUseKey(
		options.materialPlans,
		options.textureRequirements,
	);
	const parts: DynamicEntityRenderPart[] = [];
	for (const sourceAsset of options.sourceAssets) {
		for (const part of sourceAsset.parts) {
			const attachment = options.sourceGeometryByKey.get(
				describeStaticObjectSourceGeometryIdentity(part.geometry),
			);
			if (!attachment) {
				throw new Error(
					`Dynamic render part ${part.partIndex} missing source geometry ${describeStaticObjectSourceGeometryIdentity(
						part.geometry,
					)}.`,
				);
			}
			parts.push(
				...createDynamicRenderPartSlices({
					materialEntryByUseKey,
					part,
					sourceGeometry: attachment,
				}),
			);
		}
	}
	return parts;
}

function createDynamicRenderPartSlices(options: {
	readonly materialEntryByUseKey: ReadonlyMap<
		string,
		DynamicMaterialRenderEntry
	>;
	readonly part: StaticObjectSourceAssetFacts["parts"][number];
	readonly sourceGeometry: StaticObjectSourceGeometryAttachment;
}): readonly DynamicEntityRenderPart[] {
	const triangles = options.part.triangles;
	const sourcePositions = options.sourceGeometry.positions;
	const sourceTexCoords = options.sourceGeometry.texCoords;
	const renderEntries = uniqueMaterialRenderEntries(
		options.part.materialSlots.flatMap((slot) => {
			const materialUseKey = createDynamicSlotMaterialUseKey(slot);
			const renderEntry = options.materialEntryByUseKey.get(materialUseKey);
			if (!renderEntry) {
				throw new Error(
					`Dynamic render part ${options.part.partIndex} has no material entry for material use ${materialUseKey}.`,
				);
			}
			return [renderEntry];
		}),
	);
	if (renderEntries.length === 0) {
		throw new Error(
			`Dynamic render part ${options.part.partIndex} has no material entries.`,
		);
	}
	const materialEntryBySurfaceId = new Map(
		options.part.materialSlots.flatMap((slot) => {
			const renderEntry = renderEntries.find((entry) =>
				entry.entry.materialIds.includes(slot.material.materialId),
			);
			if (!renderEntry) {
				throw new Error(
					`Dynamic render part ${options.part.partIndex} cannot map surface ${slot.geometrySurfaceId} to a material entry.`,
				);
			}
			return uniqueNumbers([
				slot.geometrySurfaceId,
				slot.materialSurfaceId,
			]).map((surfaceId) => [surfaceId, renderEntry] as const);
		}),
	);
	const candidateSlices = new Map<string, DynamicTriangleRenderCandidate[]>();
	for (
		let triangleIndex = 0;
		triangleIndex < triangles.length;
		triangleIndex += 1
	) {
		const triangle = triangles[triangleIndex];
		if (!triangle) {
			continue;
		}
		const materialEntry = resolveDynamicTriangleMaterialEntry({
			materialEntryBySurfaceId,
			partIndex: options.part.partIndex,
			triangleGeometrySurfaceId: triangle.geometrySurfaceId,
		});
		const batchKey = createDynamicMaterialBatchKey(materialEntry);
		const existing = candidateSlices.get(batchKey);
		const candidate = { materialEntry, triangle };
		if (existing) {
			existing.push(candidate);
		} else {
			candidateSlices.set(batchKey, [candidate]);
		}
	}
	return [...candidateSlices.values()].map((candidates) =>
		createDynamicRenderPartSlice({
			candidates,
			part: options.part,
			sourcePositions,
			sourceTexCoords,
		}),
	);
}

function createDynamicRenderPartSlice(options: {
	readonly candidates: readonly DynamicTriangleRenderCandidate[];
	readonly part: StaticObjectSourceAssetFacts["parts"][number];
	readonly sourcePositions: Float32Array;
	readonly sourceTexCoords: Float32Array;
}): DynamicEntityRenderPart {
	const positions = new Float32Array(options.candidates.length * 9);
	const texCoords = new Float32Array(options.candidates.length * 6);
	const materialSlotIndices = new Float32Array(options.candidates.length * 3);
	const indices =
		options.candidates.length * 3 > 65535
			? new Uint32Array(options.candidates.length * 3)
			: new Uint16Array(options.candidates.length * 3);
	const renderEntries = uniqueMaterialRenderEntries(
		options.candidates.map((candidate) => candidate.materialEntry),
	);
	const localSlotByEntryKey = new Map(
		renderEntries.map((entry, localSlot) => [
			createDynamicMaterialRenderEntryKey(entry),
			localSlot,
		]),
	);
	const materialEntries = renderEntries.map((entry, localSlot) => ({
		...entry.entry,
		slot: localSlot,
	}));
	for (
		let triangleIndex = 0;
		triangleIndex < options.candidates.length;
		triangleIndex += 1
	) {
		const candidate = options.candidates[triangleIndex];
		if (!candidate) {
			continue;
		}
		const { materialEntry, triangle } = candidate;
		for (let vertex = 0; vertex < 3; vertex += 1) {
			const sourceVertexIndex = triangle.firstVertex + vertex;
			const targetVertexIndex = triangleIndex * 3 + vertex;
			assertDynamicSourceVertexAvailable({
				partIndex: options.part.partIndex,
				sourcePositions: options.sourcePositions,
				sourceTexCoords: options.sourceTexCoords,
				sourceVertexIndex,
			});
			positions[targetVertexIndex * 3] = options.sourcePositions[
				sourceVertexIndex * 3
			] as number;
			positions[targetVertexIndex * 3 + 1] = options.sourcePositions[
				sourceVertexIndex * 3 + 1
			] as number;
			positions[targetVertexIndex * 3 + 2] = options.sourcePositions[
				sourceVertexIndex * 3 + 2
			] as number;
			texCoords[targetVertexIndex * 2] = options.sourceTexCoords[
				sourceVertexIndex * 2
			] as number;
			texCoords[targetVertexIndex * 2 + 1] = options.sourceTexCoords[
				sourceVertexIndex * 2 + 1
			] as number;
			const materialLocalSlot = localSlotByEntryKey.get(
				createDynamicMaterialRenderEntryKey(materialEntry),
			);
			if (materialLocalSlot === undefined) {
				throw new Error(
					`Dynamic render part ${options.part.partIndex} cannot remap material slot ${materialEntry.entry.slot}.`,
				);
			}
			materialSlotIndices[targetVertexIndex] = materialLocalSlot;
			indices[targetVertexIndex] = targetVertexIndex;
		}
	}
	const firstMaterial = renderEntries[0] as DynamicMaterialRenderEntry;
	return {
		bounds: options.part.bounds,
		indexType: indices instanceof Uint16Array ? "uint16" : "uint32",
		indices,
		materialEntries,
		materialFamily: firstMaterial.family,
		materialPass: firstMaterial.pass,
		materialSlotIndices,
		partIndex: options.part.partIndex,
		positions,
		renderState: firstMaterial.entry.renderState,
		sourceAssetId: `gfx-obj/${options.part.gfxObj.sourceDid.toString(16).padStart(8, "0")}`,
		texCoords,
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
		triangleCount: options.candidates.length,
		vertexCount: options.candidates.length * 3,
	};
}

function resolveDynamicTriangleMaterialEntry(options: {
	readonly materialEntryBySurfaceId: ReadonlyMap<
		number,
		DynamicMaterialRenderEntry
	>;
	readonly partIndex: number;
	readonly triangleGeometrySurfaceId: number | null;
}): DynamicMaterialRenderEntry {
	if (options.triangleGeometrySurfaceId === null) {
		if (options.materialEntryBySurfaceId.size === 1) {
			return [
				...options.materialEntryBySurfaceId.values(),
			][0] as DynamicMaterialRenderEntry;
		}
		throw new Error(
			`Dynamic render part ${options.partIndex} has a triangle without geometry surface id and ${options.materialEntryBySurfaceId.size} material slots.`,
		);
	}
	const materialEntry = options.materialEntryBySurfaceId.get(
		options.triangleGeometrySurfaceId,
	);
	if (materialEntry === undefined) {
		throw new Error(
			`Dynamic render part ${options.partIndex} has no material slot for geometry surface ${options.triangleGeometrySurfaceId}.`,
		);
	}
	return materialEntry;
}

function createDynamicMaterialBatchKey(
	entry: DynamicMaterialRenderEntry,
): string {
	const { blend, depthTest, depthWrite } = entry.entry.renderState;
	return [
		`family:${entry.family}`,
		`pass:${entry.pass}`,
		`blend:${blend.enabled}:${blend.mode}:${blend.srcFactor ?? "none"}:${blend.dstFactor ?? "none"}`,
		`depth:${depthTest}:${depthWrite}`,
	].join("|");
}

function createDynamicSlotMaterialUseKey(
	slot: StaticObjectPartMaterialSlotFacts,
): string {
	return createStaticObjectMaterialUseKey(
		slot.material,
		slot.paletteOverride,
		slot.paletteViews,
	);
}

function assertDynamicSourceVertexAvailable(options: {
	readonly partIndex: number;
	readonly sourcePositions: Float32Array;
	readonly sourceTexCoords: Float32Array;
	readonly sourceVertexIndex: number;
}): void {
	const positionOffset = options.sourceVertexIndex * 3;
	const texCoordOffset = options.sourceVertexIndex * 2;
	if (positionOffset + 2 >= options.sourcePositions.length) {
		throw new Error(
			`Dynamic render part ${options.partIndex} triangle references missing position vertex ${options.sourceVertexIndex}.`,
		);
	}
	if (texCoordOffset + 1 >= options.sourceTexCoords.length) {
		throw new Error(
			`Dynamic render part ${options.partIndex} triangle references missing texcoord vertex ${options.sourceVertexIndex}.`,
		);
	}
}

function createDynamicMaterialEntriesByUseKey(
	materialPlans: readonly StaticMaterialPlan[],
	textureRequirements: readonly DynamicEntityTextureRequirement[],
): ReadonlyMap<string, DynamicMaterialRenderEntry> {
	return new Map(
		materialPlans.map((plan, slot): [string, DynamicMaterialRenderEntry] => [
			plan.materialUseKey,
			createDynamicMaterialEntry(plan, slot, textureRequirements),
		]),
	);
}

function resolveDynamicTextureUseId(options: {
	readonly dataUse: MaterialTextureDataUseIdentity;
	readonly materialId: number;
	readonly textureRequirements: readonly DynamicEntityTextureRequirement[];
}): string {
	const dataUseSignature = createMaterialTextureDataUseSignature(
		options.dataUse,
	);
	const requirement = options.textureRequirements.find(
		(candidate) =>
			candidate.material.materialId === options.materialId &&
			createMaterialTextureDataUseSignature(candidate.dataUse) ===
				dataUseSignature,
	);
	if (!requirement) {
		throw new Error(
			`Dynamic material 0x${options.materialId.toString(16).padStart(8, "0")} has no texture use id for ${dataUseSignature}.`,
		);
	}
	return requirement.textureUseId;
}

function createDynamicMaterialEntry(
	plan: StaticMaterialPlan,
	slot: number,
	textureRequirements: readonly DynamicEntityTextureRequirement[],
): DynamicMaterialRenderEntry {
	const dataUses = plan.textureRoles.map((role) => role.dataUse);
	const textureWrapMode =
		resolveRepeatedStaticMaterialPrimaryWrapMode(dataUses);
	return {
		entry: createStaticMaterialTableEntry({
			createTextureUseId: (dataUse) =>
				resolveDynamicTextureUseId({
					dataUse,
					materialId: plan.material.materialId,
					textureRequirements,
				}),
			materialIds: [plan.material.materialId],
			plan,
			slot,
			textureWrapMode,
		}),
		family: resolveDynamicRenderableMaterialFamily(plan),
		pass: plan.pass,
	};
}

function resolveDynamicRenderableMaterialFamily(
	plan: StaticMaterialPlan,
): DynamicMaterialRenderFamily {
	if (
		plan.family === "flat-color" ||
		plan.family === "indexed-paletted" ||
		plan.family === "texture-rgba"
	) {
		return plan.family;
	}
	throw new Error(
		`Dynamic material 0x${plan.material.materialId.toString(16).padStart(8, "0")} has unrenderable family ${plan.family}.`,
	);
}

function uniqueMaterialRenderEntries(
	entries: readonly DynamicMaterialRenderEntry[],
): readonly DynamicMaterialRenderEntry[] {
	const byEntryKey = new Map<string, DynamicMaterialRenderEntry>();
	for (const entry of entries) {
		byEntryKey.set(createDynamicMaterialRenderEntryKey(entry), entry);
	}
	return [...byEntryKey.values()].sort(
		(left, right) => left.entry.slot - right.entry.slot,
	);
}

function createDynamicMaterialRenderEntryKey(
	entry: DynamicMaterialRenderEntry,
): string {
	const materialIds = entry.entry.materialIds
		.map((materialId) => materialId.toString(16).padStart(8, "0"))
		.join(",");
	return [
		materialIds,
		entry.entry.primaryTextureUseId ?? "none",
		entry.entry.indexTextureUseId ?? "none",
		entry.entry.paletteTextureUseId ?? "none",
		entry.entry.detailTextureUseId ?? "none",
		entry.family,
		entry.pass,
	].join("|");
}

function uniqueNumbers(values: readonly number[]): readonly number[] {
	return [...new Set(values)];
}

function uniqueSortedStrings(values: readonly string[]): readonly string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function formatHex32(value: number): string {
	return value.toString(16).padStart(8, "0");
}

function formatErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

class DynamicVisualSkipError extends Error {
	readonly productReason: Exclude<
		DynamicVisualBakeProduct,
		{ readonly kind: "baked" }
	>["reason"];

	constructor(
		productReason: Exclude<
			DynamicVisualBakeProduct,
			{ readonly kind: "baked" }
		>["reason"],
	) {
		super(productReason.kind);
		this.productReason = productReason;
	}
}
