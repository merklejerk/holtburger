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
	DynamicVisualTexturePlanning,
} from "./contracts";
import { createDynamicVisualResourceId } from "./contracts";
import { createPreparedTextureHostKey } from "../assets/preparation/prepared-texture-source";
import { createStaticMaterialTableEntry } from "../static/bake/static-material-adapter";
import {
	createStaticMaterialTextureSamplingPolicy,
	resolveRepeatedStaticMaterialPrimaryWrapMode,
} from "../static/bake/static-material-texture-policy";
import type {
	MaterialTextureDataUseIdentity,
	StaticMaterialTableEntry,
	StaticObjectPartMaterialSlotFacts,
	StaticObjectSourceAssetFacts,
	StaticObjectSourceGeometryAttachment,
} from "../static/contracts";
import {
	createObjectVisualMaterialUseKey,
	type ObjectVisualMaterialFallbackReason,
	type ObjectVisualMaterialPlan,
} from "../visual/object-visual-material-planner";
import {
	describeStaticObjectCanonicalGeometryIdentity,
	describeStaticObjectSourceGeometryIdentity,
	getStaticObjectCanonicalGeometryIdentity,
} from "../static/objects/static-object-source-assets";
import { MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW } from "../renderer/types";
import {
	classifyTexturePlacementPool,
	classifyTextureUsagePurpose,
	createRuntimeAuthoredDynamicTexturePlacementBucketKey,
	createStaticAuthoredDynamicTexturePlacementBucketKey,
	type TexturePlacementItemId,
	type TexturePlacementBucketKey,
	type TextureResourceDependencies,
	type TextureResourceRoleDependency,
	type TextureUsagePurpose,
} from "../textures/placement";
import {
	createObjectMaterialDrawUnitPartitionKey,
	splitObjectMaterialPartitionByMaterialTableBudget,
} from "../visual/object-material-draw-unit-partition";
import {
	createObjectVisualTexturePlacementIntents,
	type ObjectVisualTexturePlacementRequirement,
} from "../visual/object-visual-texture-placement-planner";
import {
	createDynamicObjectVisualBundleExpansion,
	createDynamicObjectVisualRecipePlan,
} from "./object-visual-bundle-producer";
import type { ObjectVisualTextureRecipe } from "../visual/object-visual-recipe-bundle";

export interface DynamicVisualBaker {
	bake(input: DynamicVisualBakeInput): Promise<DynamicVisualBakeResult>;
}

interface DynamicMaterialSlotFacts {
	readonly identity: DynamicVisualMaterialSlotIdentity;
	readonly partIndex: number;
	readonly partSlot: StaticObjectPartMaterialSlotFacts;
}

interface DynamicMaterialRenderEntry {
	readonly entry: StaticMaterialTableEntry;
	readonly family: DynamicMaterialRenderFamily;
	readonly pass: "opaque" | "alpha-test" | "transparent" | "additive";
	readonly partitionMaterial: Parameters<
		typeof createObjectMaterialDrawUnitPartitionKey
	>[0]["material"];
	readonly textureRequirements: readonly DynamicEntityTextureRequirement[];
}

type DynamicMaterialRenderFamily =
	| "flat-color"
	| "indexed-paletted"
	| "texture-rgba";

interface DynamicTriangleRenderPrimitive {
	readonly materialEntry: DynamicMaterialRenderEntry;
	readonly materialEntryKey: string;
	readonly triangle: StaticObjectSourceAssetFacts["parts"][number]["triangles"][number];
	readonly textureRequirements: readonly {
		readonly placementItemId: TexturePlacementItemId;
		readonly purpose: TextureUsagePurpose;
	}[];
}

type PendingDynamicEntityTextureRequirement = Omit<
	DynamicEntityTextureRequirement,
	"placementItemId"
>;

export class LocalDynamicVisualBaker implements DynamicVisualBaker {
	async bake(input: DynamicVisualBakeInput): Promise<DynamicVisualBakeResult> {
		return bakeDynamicVisuals(input);
	}
}

export function bakeDynamicVisuals(
	input: DynamicVisualBakeInput,
): DynamicVisualBakeResult {
	const sourceGeometryByKey = createSourceGeometryIndex(input.sourceGeometry);
	const texturePlanningByEntityId = new Map(
		input.texturePlannings.map((planning) => [planning.entityId, planning]),
	);
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
				texturePlacementSnapshot: input.texturePlacementSnapshot,
				texturePlanning: texturePlanningByEntityId.get(recipe.entityId) ?? null,
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
	readonly texturePlacementSnapshot: DynamicVisualBakeInput["texturePlacementSnapshot"];
	readonly texturePlanning: DynamicVisualTexturePlanning | null;
}): BakedDynamicVisualResource {
	const { recipe } = options;
	const texturePlanning = requireDynamicVisualTexturePlanning({
		entityId: recipe.entityId,
		texturePlanning: options.texturePlanning,
	});
	const materialPlans = texturePlanning.materialPlan;
	const resourceId = createDynamicVisualResourceId(recipe.entityId);
	const materialSlots = createDynamicMaterialSlotRequirements(
		recipe.visual.materialPolicy.visualObject,
		recipe.visual.sourceAssets,
	);
	const unsupportedReasons = createUnsupportedMaterialReasons(
		materialPlans.fallbackReasons,
	);
	if (unsupportedReasons.length > 0) {
		throw new DynamicVisualSkipError({
			kind: "unsupported-materials",
			unsupportedReasons,
		});
	}

	const textureRequirements = resolveDynamicTextureRequirementPlacementItemIds({
		texturePlacementSnapshot: options.texturePlacementSnapshot,
		textureRequirements: texturePlanning.textureRequirements,
	});
	assertTextureRequirementsPlaced({
		resourceId,
		texturePlacementSnapshot: options.texturePlacementSnapshot,
		textureRequirements,
	});
	return {
		entityId: recipe.entityId,
		materialSlots: materialSlots.map(createMaterialSlotRequirement),
		materialSources: recipe.visual.materialSources,
		objectVisual: createDynamicObjectVisualBundleExpansion({
			recipe,
			sourceGeometry: [...options.sourceGeometryByKey.values()],
		}),
		paletteSources: recipe.visual.paletteSources,
		renderParts: createDynamicRenderParts({
			materialPlans: materialPlans.materialPlans,
			sourceAssets: recipe.visual.sourceAssets,
			sourceGeometryByKey: options.sourceGeometryByKey,
			texturePlacementSnapshot: options.texturePlacementSnapshot,
			textureRequirements,
		}),
		resourceId,
		sourceAssets: recipe.visual.sourceAssets,
		textureDependencies: createDynamicTextureDependencies({
			resourceId,
			textureRequirements,
		}),
		textureRefs: recipe.visual.textureRefs,
		textureRequirements,
	};
}

export function createDynamicVisualTexturePlanning(
	recipe: DynamicVisualBakeInput["recipes"][number],
): DynamicVisualTexturePlanning {
	if (recipe.visual.missingRefs.length > 0) {
		return {
			entityId: recipe.entityId,
			materialPlan: null,
			placementIntents: [],
			textureRequirements: [],
		};
	}
	const resourceId = createDynamicVisualResourceId(recipe.entityId);
	const recipePlan = createDynamicObjectVisualRecipePlan(recipe);
	const materialPlans = recipePlan.materialPlan;
	const unsupportedReasons = createUnsupportedMaterialReasons(
		materialPlans.fallbackReasons,
	);
	if (unsupportedReasons.length > 0) {
		return {
			entityId: recipe.entityId,
			materialPlan: materialPlans,
			placementIntents: [],
			textureRequirements: [],
		};
	}
	const pendingTextureRequirements = createPendingTextureRequirementsFromRecipes({
		materialPlans: materialPlans.materialPlans,
		resourceId,
		textureRecipes: recipePlan.textureRecipes,
	});
	const placementIntents = createObjectVisualTexturePlacementIntents({
		requirements: pendingTextureRequirements.map((requirement) =>
			createDynamicTexturePlacementRequirement({
				recipe,
				requirement,
			}),
		),
	});
	const placementItemIdByTextureUseId = new Map(
		placementIntents.map((intent) => [intent.textureUseId, intent.itemId]),
	);
	const textureRequirements = pendingTextureRequirements.map(
		(requirement): DynamicEntityTextureRequirement => ({
			...requirement,
			placementItemId: requireDynamicTexturePlanningItemId({
				entityId: recipe.entityId,
				placementItemIdByTextureUseId,
				textureUseId: requirement.textureUseId,
			}),
		}),
	);
	return {
		entityId: recipe.entityId,
		materialPlan: materialPlans,
		placementIntents,
		textureRequirements,
	};
}

function createDynamicTexturePlacementRequirement(options: {
	readonly recipe: DynamicVisualBakeInput["recipes"][number];
	readonly requirement: PendingDynamicEntityTextureRequirement;
}): ObjectVisualTexturePlacementRequirement {
	const textureDomain =
		options.recipe.visual.materialPolicy.detailRolePolicy.kind ===
		"runtime-authored-none"
			? "runtime-object-material"
			: options.recipe.visual.materialPolicy.detailRolePolicy.domain;
	return {
		policy: {
			affinityKey: createDynamicTextureAffinityKey(options.recipe),
			kind: "dynamic",
			placementBucketKey: createDynamicTexturePlacementBucketKey({
				purpose: classifyTextureUsagePurpose(
					options.requirement.dataUse,
					classifyTexturePlacementPool(textureDomain),
				),
				recipe: options.recipe,
				textureDomain,
			}),
			textureDomain,
		},
		requirement: {
			bindingKey: options.requirement.textureUseId,
			samplingPolicy: options.requirement.samplingPolicy,
			source: {
				dataUse: options.requirement.dataUse,
				kind: "material-texture-data-use",
				samplingPolicy: options.requirement.samplingPolicy,
			},
			textureUseId: options.requirement.textureUseId,
		},
	};
}

function requireDynamicTexturePlanningItemId(options: {
	readonly entityId: string;
	readonly placementItemIdByTextureUseId: ReadonlyMap<
		string,
		TexturePlacementItemId
	>;
	readonly textureUseId: string;
}): TexturePlacementItemId {
	const placementItemId = options.placementItemIdByTextureUseId.get(
		options.textureUseId,
	);
	if (placementItemId === undefined) {
		throw new Error(
			`Dynamic visual ${options.entityId} has no planned placement item id for texture use ${options.textureUseId}.`,
		);
	}
	return placementItemId;
}

function createDynamicTexturePlacementBucketKey(options: {
	readonly purpose: TextureUsagePurpose;
	readonly recipe: DynamicVisualBakeInput["recipes"][number];
	readonly textureDomain:
		| "runtime-object-material"
		| Exclude<
				DynamicVisualBakeInput["recipes"][number]["visual"]["materialPolicy"]["detailRolePolicy"],
				{ readonly kind: "runtime-authored-none" }
		  >["domain"];
}): TexturePlacementBucketKey {
	const { purpose, recipe, textureDomain } = options;
	if (textureDomain === "runtime-object-material") {
		return createRuntimeAuthoredDynamicTexturePlacementBucketKey({
			entityId: recipe.entityId,
			purpose,
		});
	}
	if (recipe.source.kind !== "static-authored") {
		throw new Error(
			`Dynamic recipe ${recipe.entityId} cannot use static texture domain ${textureDomain} without static source ownership.`,
		);
	}
	return createStaticAuthoredDynamicTexturePlacementBucketKey({
		domain: textureDomain,
		ownerId: recipe.source.owner.ownerId,
		purpose,
	});
}

function requireDynamicVisualTexturePlanning(options: {
	readonly entityId: string;
	readonly texturePlanning: DynamicVisualTexturePlanning | null;
}): DynamicVisualTexturePlanning & {
	readonly materialPlan: NonNullable<
		DynamicVisualTexturePlanning["materialPlan"]
	>;
} {
	if (!options.texturePlanning) {
		throw new Error(
			`Dynamic visual ${options.entityId} is missing pre-bake material planning.`,
		);
	}
	if (!options.texturePlanning.materialPlan) {
		throw new Error(
			`Dynamic visual ${options.entityId} has no material plan in pre-bake texture planning.`,
		);
	}
	return options.texturePlanning as DynamicVisualTexturePlanning & {
		readonly materialPlan: NonNullable<
			DynamicVisualTexturePlanning["materialPlan"]
		>;
	};
}

function createSourceGeometryIndex(
	attachments: readonly StaticObjectSourceGeometryAttachment[],
): ReadonlyMap<string, StaticObjectSourceGeometryAttachment> {
	return new Map(
		attachments.map((attachment) => [
			describeStaticObjectCanonicalGeometryIdentity(attachment.identity),
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

function createPendingTextureRequirementsFromRecipes(options: {
	readonly materialPlans: readonly ObjectVisualMaterialPlan[];
	readonly resourceId: string;
	readonly textureRecipes: ReadonlyMap<number, ObjectVisualTextureRecipe>;
}): readonly PendingDynamicEntityTextureRequirement[] {
	return [...options.textureRecipes.entries()]
		.sort(([left], [right]) => left - right)
		.map(([, textureRecipe]) => {
			const role = requireMaterialTextureRoleForRecipe({
				materialPlans: options.materialPlans,
				textureRecipe,
			});
			return {
				dataUse: textureRecipe.dataUse,
				key: createTextureRequirementKey(textureRecipe.dataUse),
				material: role.plan.material,
				role: role.role.role,
				samplingPolicy: createStaticMaterialTextureSamplingPolicy({
					dataUse: textureRecipe.dataUse,
					wrapMode: textureRecipe.wrapMode,
				}),
				textureUseId: createDynamicTextureUseId(
					options.resourceId,
					role.plan,
					role.role,
				),
			};
		});
}

function requireMaterialTextureRoleForRecipe(options: {
	readonly materialPlans: readonly ObjectVisualMaterialPlan[];
	readonly textureRecipe: ObjectVisualTextureRecipe;
}): {
	readonly plan: ObjectVisualMaterialPlan;
	readonly role: ObjectVisualMaterialPlan["textureRoles"][number];
} {
	for (const plan of options.materialPlans) {
		for (const role of plan.textureRoles) {
			if (
				role.role === dynamicRoleForTextureUsage(options.textureRecipe.usage) &&
				createMaterialTextureDataUseSignature(role.dataUse) ===
					createMaterialTextureDataUseSignature(options.textureRecipe.dataUse)
			) {
				return { plan, role };
			}
		}
	}
	throw new Error(
		`Dynamic object visual texture recipe ${options.textureRecipe.usage} has no matching material texture role.`,
	);
}

function dynamicRoleForTextureUsage(
	usage: ObjectVisualTextureRecipe["usage"],
): ObjectVisualMaterialPlan["textureRoles"][number]["role"] {
	switch (usage) {
		case "object-base-color":
			return "base-color";
		case "object-detail":
			return "detail-overlay";
		case "object-index":
			return "base-index";
		case "object-palette":
			return "palette-rgba";
	}
}

function createDynamicTextureUseId(
	resourceId: string,
	plan: ObjectVisualMaterialPlan,
	role: ObjectVisualMaterialPlan["textureRoles"][number],
): string {
	return [
		"dynamic-texture",
		resourceId,
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

function createDynamicTextureAffinityKey(
	recipe: DynamicVisualBakeInput["recipes"][number],
): string {
	return [
		"dynamic-visual",
		recipe.visual.materialPolicy.visualObject.resourceId,
	].join(":");
}

function assertTextureRequirementsPlaced(options: {
	readonly resourceId: string;
	readonly texturePlacementSnapshot: DynamicVisualBakeInput["texturePlacementSnapshot"];
	readonly textureRequirements: readonly DynamicEntityTextureRequirement[];
}): void {
	const missingItemIds = options.textureRequirements
		.map((requirement) => requirement.placementItemId)
		.filter(
			(placementItemId) =>
				!options.texturePlacementSnapshot.placementsByItemId.has(
					placementItemId,
				),
		);
	if (missingItemIds.length === 0) {
		return;
	}
	throw new Error(
		`Dynamic visual resource ${options.resourceId} is missing pre-bake texture placements: ${missingItemIds.join(
			", ",
		)}.`,
	);
}

function resolveDynamicTextureRequirementPlacementItemIds(options: {
	readonly texturePlacementSnapshot: DynamicVisualBakeInput["texturePlacementSnapshot"];
	readonly textureRequirements: readonly DynamicEntityTextureRequirement[];
}): readonly DynamicEntityTextureRequirement[] {
	return options.textureRequirements.map((requirement) => ({
		...requirement,
		placementItemId: requireDynamicPlacementItemId({
			texturePlacementSnapshot: options.texturePlacementSnapshot,
			textureUseId: requirement.textureUseId,
		}),
	}));
}

function requireDynamicPlacementItemId(options: {
	readonly texturePlacementSnapshot: DynamicVisualBakeInput["texturePlacementSnapshot"];
	readonly textureUseId: string;
}) {
	const placementItemId =
		options.texturePlacementSnapshot.itemIdsByTextureUseId.get(
			options.textureUseId,
		);
	if (placementItemId === undefined) {
		throw new Error(
			`Dynamic visual texture planning is missing object-visual placement item id for ${options.textureUseId}.`,
		);
	}
	return placementItemId;
}

function createDynamicTextureDependencies(options: {
	readonly resourceId: string;
	readonly textureRequirements: readonly DynamicEntityTextureRequirement[];
}): readonly TextureResourceDependencies[] {
	const roles = createDynamicTextureRoleDependencies(
		options.textureRequirements,
	);
	if (roles.length === 0) {
		return [];
	}
	return [{ resourceId: options.resourceId, roles }];
}

function createDynamicTextureRoleDependencies(
	textureRequirements: readonly DynamicEntityTextureRequirement[],
): readonly TextureResourceRoleDependency[] {
	const itemIdsByPurpose = new Map<TextureUsagePurpose, Set<string>>();
	for (const requirement of textureRequirements) {
		const purpose = classifyDynamicRequirementPurpose(requirement);
		let itemIds = itemIdsByPurpose.get(purpose);
		if (!itemIds) {
			itemIds = new Set<string>();
			itemIdsByPurpose.set(purpose, itemIds);
		}
		itemIds.add(requirement.textureUseId);
	}
	return Array.from(itemIdsByPurpose, ([purpose, itemIds]) => ({
		itemIds: Array.from(itemIds).sort(),
		purpose,
	})).sort((left, right) => left.purpose.localeCompare(right.purpose));
}

function classifyDynamicRequirementPurpose(
	requirement: DynamicEntityTextureRequirement,
): TextureUsagePurpose {
	switch (requirement.role) {
		case "base-color":
			return "object-base-color";
		case "base-index":
			return "object-index";
		case "detail-overlay":
			return "object-detail";
		case "palette-rgba":
			return "object-palette";
	}
}

function createUnsupportedMaterialReasons(
	reasons: readonly ObjectVisualMaterialFallbackReason[],
): readonly DynamicEntityUnsupportedMaterialReason[] {
	return reasons.map((reason) => ({
		code: reason.code,
		material: reason.material,
		message: reason.message,
	}));
}

function createDynamicRenderParts(options: {
	readonly materialPlans: readonly ObjectVisualMaterialPlan[];
	readonly sourceAssets: readonly StaticObjectSourceAssetFacts[];
	readonly sourceGeometryByKey: ReadonlyMap<
		string,
		StaticObjectSourceGeometryAttachment
	>;
	readonly texturePlacementSnapshot: DynamicVisualBakeInput["texturePlacementSnapshot"];
	readonly textureRequirements: readonly DynamicEntityTextureRequirement[];
}): readonly DynamicEntityRenderPart[] {
	const materialEntryByUseKey = createDynamicMaterialEntriesByUseKey(
		options.materialPlans,
		options.textureRequirements,
	);
	const parts: DynamicEntityRenderPart[] = [];
	for (const sourceAsset of options.sourceAssets) {
		for (const part of sourceAsset.parts) {
			const canonical = getStaticObjectCanonicalGeometryIdentity(part.geometry);
			const attachment = options.sourceGeometryByKey.get(
				describeStaticObjectCanonicalGeometryIdentity(canonical),
			);
			if (!attachment) {
				throw new Error(
					`Dynamic render part ${part.partIndex} missing source geometry ${describeStaticObjectCanonicalGeometryIdentity(
						canonical,
					)} for source part ${describeStaticObjectSourceGeometryIdentity(
						part.geometry,
					)}.`,
				);
			}
			parts.push(
				...createDynamicRenderPartPartitions({
					materialEntryByUseKey,
					part,
					sourceGeometry: attachment,
					texturePlacementSnapshot: options.texturePlacementSnapshot,
				}),
			);
		}
	}
	return parts;
}

function createDynamicRenderPartPartitions(options: {
	readonly materialEntryByUseKey: ReadonlyMap<
		string,
		DynamicMaterialRenderEntry
	>;
	readonly part: StaticObjectSourceAssetFacts["parts"][number];
	readonly sourceGeometry: StaticObjectSourceGeometryAttachment;
	readonly texturePlacementSnapshot: DynamicVisualBakeInput["texturePlacementSnapshot"];
}): readonly DynamicEntityRenderPart[] {
	const triangles = options.part.triangles;
	const sourcePositions = options.sourceGeometry.buffer.positions;
	const sourceTexCoords = options.sourceGeometry.buffer.texCoords;
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
	const primitivesByPartitionKey = new Map<
		string,
		DynamicTriangleRenderPrimitive[]
	>();
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
		const materialEntryKey = createDynamicMaterialRenderEntryKey(materialEntry);
		const objectMaterialPartitionKey = createObjectMaterialDrawUnitPartitionKey(
			{
				diagnosticSubject: `Dynamic render part ${options.part.partIndex}`,
				includeConcreteEntryInKey: false,
				material: materialEntry.partitionMaterial,
				texturePlacementSnapshot: options.texturePlacementSnapshot,
				textureRequirements: materialEntry.textureRequirements.map(
					(requirement) => ({
						placementItemId: requirement.placementItemId,
						purpose: classifyDynamicRequirementPurpose(requirement),
					}),
				),
			},
		);
		const existing = primitivesByPartitionKey.get(
			objectMaterialPartitionKey.key,
		);
		const primitive = {
			materialEntry,
			materialEntryKey,
			textureRequirements: materialEntry.textureRequirements.map(
				(requirement) => ({
					placementItemId: requirement.placementItemId,
					purpose: classifyDynamicRequirementPurpose(requirement),
				}),
			),
			triangle,
		};
		if (existing) {
			existing.push(primitive);
		} else {
			primitivesByPartitionKey.set(objectMaterialPartitionKey.key, [primitive]);
		}
	}
	return [...primitivesByPartitionKey.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.flatMap(([, primitives], partitionIndex) =>
			splitObjectMaterialPartitionByMaterialTableBudget({
				maxMaterialEntriesPerPartition: MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW,
				primitives,
			}).map((splitPrimitives, splitIndex) =>
				createDynamicRenderPartPartition({
					part: options.part,
					partitionIndex,
					primitives: splitPrimitives,
					sourcePositions,
					sourceTexCoords,
					splitIndex,
				}),
			),
		);
}

function createDynamicRenderPartPartition(options: {
	readonly partitionIndex: number;
	readonly part: StaticObjectSourceAssetFacts["parts"][number];
	readonly primitives: readonly DynamicTriangleRenderPrimitive[];
	readonly sourcePositions: Float32Array;
	readonly sourceTexCoords: Float32Array;
	readonly splitIndex: number;
}): DynamicEntityRenderPart {
	const positions = new Float32Array(options.primitives.length * 9);
	const texCoords = new Float32Array(options.primitives.length * 6);
	const materialSlotIndices = new Float32Array(options.primitives.length * 3);
	const indices =
		options.primitives.length * 3 > 65535
			? new Uint32Array(options.primitives.length * 3)
			: new Uint16Array(options.primitives.length * 3);
	const renderEntries = uniqueMaterialRenderEntries(
		options.primitives.map((primitive) => primitive.materialEntry),
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
		triangleIndex < options.primitives.length;
		triangleIndex += 1
	) {
		const primitive = options.primitives[triangleIndex];
		if (!primitive) {
			continue;
		}
		const { materialEntry, triangle } = primitive;
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
		renderPartId: createDynamicRenderPartId({
			partIndex: options.part.partIndex,
			partitionIndex: options.partitionIndex,
			splitIndex: options.splitIndex,
		}),
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
		triangleCount: options.primitives.length,
		vertexCount: options.primitives.length * 3,
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

function createDynamicSlotMaterialUseKey(
	slot: StaticObjectPartMaterialSlotFacts,
): string {
	return createObjectVisualMaterialUseKey(
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
	materialPlans: readonly ObjectVisualMaterialPlan[],
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
	plan: ObjectVisualMaterialPlan,
	slot: number,
	textureRequirements: readonly DynamicEntityTextureRequirement[],
): DynamicMaterialRenderEntry {
	const dataUses = plan.textureRoles.map((role) => role.dataUse);
	const textureWrapMode =
		resolveRepeatedStaticMaterialPrimaryWrapMode(dataUses);
	const materialTextureRequirements = resolveDynamicMaterialTextureRequirements(
		plan,
		textureRequirements,
	);
	const family = resolveDynamicRenderableMaterialFamily(plan);
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
		family,
		pass: plan.pass,
		partitionMaterial: {
			alphaMode: plan.alphaPolicy.mode,
			blendMode: plan.blend.mode,
			family,
			materialColorKey: createDynamicMaterialColorKey(plan),
			materialEntryKey: createDynamicMaterialPlanEntryKey(plan),
			pass: plan.pass,
			renderCoverage: null,
			textureRoleLayoutKey: createDynamicTextureRoleLayoutKey(plan),
			textureRoleSchemaKey: createDynamicTextureRoleSchemaKey(plan),
			textureWrapMode,
		},
		textureRequirements: materialTextureRequirements,
	};
}

function resolveDynamicMaterialTextureRequirements(
	plan: ObjectVisualMaterialPlan,
	textureRequirements: readonly DynamicEntityTextureRequirement[],
): readonly DynamicEntityTextureRequirement[] {
	return plan.textureRoles.map((role) =>
		resolveDynamicTextureRequirement({
			dataUse: role.dataUse,
			materialId: plan.material.materialId,
			textureRequirements,
		}),
	);
}

function resolveDynamicTextureRequirement(options: {
	readonly dataUse: MaterialTextureDataUseIdentity;
	readonly materialId: number;
	readonly textureRequirements: readonly DynamicEntityTextureRequirement[];
}): DynamicEntityTextureRequirement {
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
			`Dynamic material 0x${options.materialId.toString(16).padStart(8, "0")} has no texture requirement for ${dataUseSignature}.`,
		);
	}
	return requirement;
}

function createDynamicMaterialColorKey(plan: ObjectVisualMaterialPlan): string {
	return [plan.color.join(","), plan.emissiveColor.join(",")].join("|");
}

function createDynamicMaterialPlanEntryKey(
	plan: ObjectVisualMaterialPlan,
): string {
	return [
		plan.material.materialId.toString(16).padStart(8, "0"),
		plan.materialUseKey,
	].join(":");
}

function createDynamicTextureRoleLayoutKey(
	plan: ObjectVisualMaterialPlan,
): string {
	return plan.textureRoles
		.map(
			(role) =>
				`${role.role}:${createMaterialTextureDataUseSignature(role.dataUse)}`,
		)
		.sort()
		.join("|");
}

function createDynamicTextureRoleSchemaKey(
	plan: ObjectVisualMaterialPlan,
): string {
	return plan.textureRoles
		.map((role) => role.role)
		.sort()
		.join("|");
}

function resolveDynamicRenderableMaterialFamily(
	plan: ObjectVisualMaterialPlan,
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

function createDynamicRenderPartId(options: {
	readonly partIndex: number;
	readonly partitionIndex: number;
	readonly splitIndex: number;
}): string {
	return [
		`part:${options.partIndex}`,
		`partition:${options.partitionIndex}`,
		`split:${options.splitIndex}`,
	].join("/");
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
