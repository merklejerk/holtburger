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
import { createStaticMaterialTextureSamplingPolicy } from "../static/bake/static-material-texture-policy";
import type {
	MaterialTextureDataUseIdentity,
	StaticObjectSourceGeometrySidecar,
} from "../static/contracts";
import {
	type ObjectVisualMaterialFallbackReason,
	type ObjectVisualMaterialPlan,
} from "../visual/object-visual-material-planner";
import { describeStaticObjectCanonicalGeometryIdentity } from "../static/objects/static-object-source-assets";
import {
	classifyTexturePlacementPool,
	classifyTextureUsagePurpose,
	createRuntimeAuthoredDynamicTexturePlacementBucketKey,
	createStaticAuthoredDynamicTexturePlacementBucketKey,
	type TexturePlacementItemId,
	type TexturePlacementBucketKey,
	type TextureUsagePurpose,
} from "../textures/placement";
import {
	createObjectVisualTexturePlacementIntents,
	type ObjectVisualTexturePlacementRequirement,
} from "../visual/object-visual-texture-placement-planner";
import {
	createDynamicObjectVisualBundleExpansion,
	createDynamicObjectVisualSourceAssets,
	createDynamicObjectVisualRecipePlan,
} from "./object-visual-bundle-producer";
import {
	bakeObjectVisuals,
	type ObjectVisualBakeResult,
	type ObjectVisualTextureBinding,
} from "../visual/object-visual-baker";
import type {
	ObjectVisualTextureRecipe,
	ObjectVisualTextureRecipeId,
} from "../visual/object-visual-recipe-bundle";
import type {
	ObjectVisualPartMaterialSlotFacts,
	ObjectVisualSourceAssetFacts,
} from "../visual/object-visual-source-payload";

export interface DynamicVisualBaker {
	bake(input: DynamicVisualBakeInput): Promise<DynamicVisualBakeResult>;
}

interface DynamicMaterialSlotFacts {
	readonly identity: DynamicVisualMaterialSlotIdentity;
	readonly partIndex: number;
	readonly partSlot: ObjectVisualPartMaterialSlotFacts;
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
		StaticObjectSourceGeometrySidecar
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
	const objectVisual = createDynamicObjectVisualBundleExpansion({
		recipe,
		sourceGeometry: [...options.sourceGeometryByKey.values()],
	});
	if (objectVisual.resolution.kind !== "ready") {
		throw new Error(
			`Dynamic object visual bundle missing dependencies: ${objectVisual.resolution.missingDependencies
				.map((dependency) => `${dependency.sourceKind}:${dependency.sourceId}`)
				.join(", ")}`,
		);
	}
	const objectVisualBake = bakeObjectVisuals({
		bundle: objectVisual.resolution.bundle,
		geometryBuffers: objectVisual.geometryBuffers,
		renderPartIdPrefix: resourceId,
		textureBindings: createDynamicObjectVisualTextureBindings({
			resourceId,
			textureRecipes: objectVisual.resolution.bundle.textureRecipes,
			textureRequirements,
		}),
	});
	return {
		entityId: recipe.entityId,
		materialSlots: materialSlots.map(createMaterialSlotRequirement),
		materialSources: recipe.visual.materialSources,
		objectVisual,
		paletteSources: recipe.visual.paletteSources,
		renderParts: createDynamicRenderPartsFromObjectVisualBake({
			bakeResult: objectVisualBake,
			recipe,
		}),
		resourceId,
		sourceAssets: createDynamicObjectVisualSourceAssets(recipe),
		textureDependencies: objectVisualBake.textureDependencies,
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
	const pendingTextureRequirements =
		createPendingTextureRequirementsFromRecipes({
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
	sidecars: readonly StaticObjectSourceGeometrySidecar[],
): ReadonlyMap<string, StaticObjectSourceGeometrySidecar> {
	return new Map(
		sidecars.map((sidecar) => [
			describeStaticObjectCanonicalGeometryIdentity(sidecar.identity),
			sidecar,
		]),
	);
}

function createDynamicMaterialSlotRequirements(
	visualObject: DynamicVisualObjectIdentity,
	sourceAssets: readonly ObjectVisualSourceAssetFacts[],
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
	readonly part: ObjectVisualSourceAssetFacts["parts"][number];
	readonly source: ObjectVisualSourceAssetFacts;
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
	readonly slot: ObjectVisualPartMaterialSlotFacts;
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

function createDynamicObjectVisualTextureBindings(options: {
	readonly resourceId: string;
	readonly textureRecipes: ReadonlyMap<
		ObjectVisualTextureRecipeId,
		ObjectVisualTextureRecipe
	>;
	readonly textureRequirements: readonly DynamicEntityTextureRequirement[];
}): ReadonlyMap<ObjectVisualTextureRecipeId, ObjectVisualTextureBinding> {
	return new Map(
		[...options.textureRecipes.entries()].map(
			([textureRecipeId, textureRecipe]) => {
				const requirement = requireTextureRequirementForRecipe({
					textureRecipe,
					textureRequirements: options.textureRequirements,
				});
				return [
					textureRecipeId,
					{
						dependency: {
							resourceId: options.resourceId,
							roles: [
								{
									itemIds: [requirement.textureUseId],
									purpose: classifyDynamicRequirementPurpose(requirement),
								},
							],
						},
						textureUseId: requirement.textureUseId,
					},
				] as const;
			},
		),
	);
}

function requireTextureRequirementForRecipe(options: {
	readonly textureRecipe: ObjectVisualTextureRecipe;
	readonly textureRequirements: readonly DynamicEntityTextureRequirement[];
}): DynamicEntityTextureRequirement {
	const role = dynamicRoleForTextureUsage(options.textureRecipe.usage);
	const requirement = options.textureRequirements.find(
		(candidate) =>
			candidate.role === role &&
			createMaterialTextureDataUseSignature(candidate.dataUse) ===
				createMaterialTextureDataUseSignature(options.textureRecipe.dataUse),
	);
	if (!requirement) {
		throw new Error(
			`Dynamic object visual texture recipe ${options.textureRecipe.usage} has no matching texture requirement.`,
		);
	}
	return requirement;
}

function createDynamicRenderPartsFromObjectVisualBake(options: {
	readonly bakeResult: ObjectVisualBakeResult;
	readonly recipe: DynamicVisualBakeInput["recipes"][number];
}): readonly DynamicEntityRenderPart[] {
	return options.bakeResult.renderParts.map((renderPart) => {
		const partIndex = requireSingleDynamicSourcePartIndex(renderPart);
		return {
			...renderPart.sourceLocalPayload,
			partIndex,
			renderPartId: renderPart.renderPartId,
			sourceAssetId: createDynamicRenderPartSourceAssetId({
				partIndex,
				recipe: options.recipe,
			}),
		};
	});
}

function requireSingleDynamicSourcePartIndex(
	renderPart: ObjectVisualBakeResult["renderParts"][number],
): number {
	if (renderPart.sourcePartIndices.length !== 1) {
		throw new Error(
			`Dynamic object visual render part ${renderPart.renderPartId} maps to ${renderPart.sourcePartIndices.length} source parts.`,
		);
	}
	const partIndex = renderPart.sourcePartIndices[0];
	if (partIndex === undefined) {
		throw new Error(
			`Dynamic object visual render part ${renderPart.renderPartId} has no source part index.`,
		);
	}
	return partIndex;
}

function createDynamicRenderPartSourceAssetId(options: {
	readonly partIndex: number;
	readonly recipe: DynamicVisualBakeInput["recipes"][number];
}): string {
	const part = options.recipe.visual.setupModel.parts.find(
		(candidate) => candidate.partIndex === options.partIndex,
	);
	if (!part) {
		throw new Error(
			`Dynamic visual ${options.recipe.entityId} has no setup part ${options.partIndex}.`,
		);
	}
	return `gfx-obj/${formatHex32(part.gfxObj.sourceDid)}`;
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
