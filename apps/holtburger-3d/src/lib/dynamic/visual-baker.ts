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
import {
	createPreparedPaletteTextureHostKey,
	createPreparedTextureHostKey,
} from "../assets/preparation/prepared-texture-source";
import { createStaticMaterialTextureSamplingPolicy } from "../static/bake/static-material-texture-policy";
import type {
	MaterialTextureDataUseIdentity,
	StaticObjectSourceGeometrySidecar,
	VisualTextureDomain,
} from "../static/contracts";
import {
	type ObjectVisualMaterialFallbackReason,
	type ObjectVisualMaterialPlan,
} from "../visual/object-visual-material-planner";
import { describeStaticObjectCanonicalGeometryIdentity } from "../static/objects/static-object-source-assets";
import {
	classifyTextureUsagePurpose,
	type TexturePlacementPolicy,
	type TexturePlacementItemId,
	type TextureUsagePurpose,
} from "../textures/placement";
import {
	createMaterialTextureSourceKey,
	createTextureBindingId,
	createTextureKey,
	createTextureOwnerId,
	createTexturePageClass,
	type TextureBindingId,
	type TextureKey,
	type TextureOwnerId,
	type TexturePageClass,
} from "../textures/identity";
import { getRuntimeTexturePageGutterPixels } from "../textures/material-texture-identity";
import {
	createRuntimeTexturePagePolicy,
	type RuntimeTexturePagePolicy,
} from "../textures/sampling-policy";
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
	"bindingId" | "ownerIds" | "pageClass" | "placementItemId" | "textureKey"
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
	const failures: DynamicVisualBakeResult["failures"][number][] = [];
	const recipe = input.recipe;
	let product: DynamicVisualBakeProduct | null = null;

	if (recipe.visual.missingRefs.length > 0) {
		product = {
			entityId: recipe.entityId,
			kind: "skipped",
			reason: {
				kind: "missing-dependencies",
				missingRefs: recipe.visual.missingRefs,
			},
		};
	} else {
		try {
			const resource = bakeDynamicVisualRecipe({
				recipe,
				sourceGeometryByKey,
				texturePlacementSnapshot: input.texturePlacementSnapshot,
				texturePlanning: input.texturePlanning,
			});
			product = {
				kind: "baked",
				resource,
			};
		} catch (error) {
			if (error instanceof DynamicVisualSkipError) {
				product = {
					entityId: recipe.entityId,
					kind: "skipped",
					reason: error.productReason,
				};
			} else {
				failures.push({
					entityId: recipe.entityId,
					message: formatErrorMessage(error),
					stage: "render-part-extraction",
				});
			}
		}
	}

	return {
		failures,
		product,
		revision: input.revision,
	};
}

function bakeDynamicVisualRecipe(options: {
	readonly recipe: DynamicVisualBakeInput["recipe"];
	readonly sourceGeometryByKey: ReadonlyMap<
		string,
		StaticObjectSourceGeometrySidecar
	>;
	readonly texturePlacementSnapshot: DynamicVisualBakeInput["texturePlacementSnapshot"];
	readonly texturePlanning: DynamicVisualTexturePlanning;
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
	recipe: DynamicVisualBakeInput["recipe"],
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
	const placementRequirements = pendingTextureRequirements.map(
		(requirement) => ({
			pendingRequirement: requirement,
			placementRequirement: createDynamicTexturePlacementRequirement({
				recipe,
				requirement,
			}),
		}),
	);
	const placementIntents = createObjectVisualTexturePlacementIntents({
		requirements: placementRequirements.map(
			(item) => item.placementRequirement,
		),
	});
	const placementItemIdByBindingId = new Map(
		placementIntents.map((intent) => [intent.bindingId, intent.itemId]),
	);
	const textureRequirements = placementRequirements.map(
		(item): DynamicEntityTextureRequirement => ({
			...item.pendingRequirement,
			bindingId: item.placementRequirement.requirement.bindingId,
			ownerIds: item.placementRequirement.requirement.ownerIds,
			pageClass: item.placementRequirement.requirement.pageClass,
			placementItemId: requireDynamicTexturePlanningItemId({
				bindingId: item.placementRequirement.requirement.bindingId,
				entityId: recipe.entityId,
				placementItemIdByBindingId,
			}),
			textureKey: item.placementRequirement.requirement.textureKey,
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
	readonly recipe: DynamicVisualBakeInput["recipe"];
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
			placementPolicy: createDynamicTexturePlacementPolicy({
				recipe: options.recipe,
				textureDomain,
			}),
			textureDomain,
		},
		requirement: {
			bindingId: createTextureBindingId({
				resourceId: `dynamic:${options.recipe.entityId}`,
				role: classifyTextureUsagePurpose(
					options.requirement.dataUse,
					textureDomain,
				),
				slot: options.requirement.dynamicTextureSourceId,
			}),
			samplingPolicy: options.requirement.samplingPolicy,
			source: {
				dataUse: options.requirement.dataUse,
				kind: "material-texture-data-use",
				samplingPolicy: options.requirement.samplingPolicy,
			},
			...createRuntimeAuthoredDynamicTextureIdentity({
				dataUse: options.requirement.dataUse,
				purpose: classifyTextureUsagePurpose(
					options.requirement.dataUse,
					textureDomain,
				),
				resourceId: resourceIdForDynamicTextureIdentity(options.recipe),
				samplingPolicy: options.requirement.samplingPolicy,
				textureDomain,
				dynamicTextureSourceId: options.requirement.dynamicTextureSourceId,
			}),
		},
	};
}

function createDynamicTexturePlacementPolicy(options: {
	readonly recipe: DynamicVisualBakeInput["recipe"];
	readonly textureDomain:
		| "runtime-object-material"
		| Exclude<
				DynamicVisualBakeInput["recipe"]["visual"]["materialPolicy"]["detailRolePolicy"],
				{ readonly kind: "runtime-authored-none" }
		  >["domain"];
}): TexturePlacementPolicy {
	if (options.textureDomain === "runtime-object-material") {
		return {
			bucketScope: {
				kind: "runtime-owner",
				ownerId: options.recipe.entityId,
			},
			sourceStability: {
				kind: "owner-specific",
				reason: "runtime-customized",
			},
		};
	}
	if (options.recipe.source.kind !== "static-authored") {
		throw new Error(
			`Dynamic recipe ${options.recipe.entityId} cannot use static texture policy for non-static source ownership.`,
		);
	}
	return {
		bucketScope: { kind: "static-domain" },
		sourceStability: { kind: "content-stable" },
	};
}

function createRuntimeAuthoredDynamicTextureIdentity(options: {
	readonly dataUse: MaterialTextureDataUseIdentity;
	readonly purpose: TextureUsagePurpose;
	readonly resourceId: string;
	readonly samplingPolicy?: PendingDynamicEntityTextureRequirement["samplingPolicy"];
	readonly textureDomain: VisualTextureDomain;
	readonly dynamicTextureSourceId: string;
}): {
	readonly ownerIds: readonly TextureOwnerId[];
	readonly pageClass: TexturePageClass;
	readonly textureKey: TextureKey;
} {
	const pagePolicy = createRuntimeTexturePagePolicy(
		options.dataUse,
		options.samplingPolicy,
	);
	const outputFormat = createDynamicTextureOutputFormat(options.dataUse);
	return {
		ownerIds: [
			createTextureOwnerId({
				dynamicResourceId: options.resourceId,
				kind: "dynamic-resource",
			}),
		],
		pageClass: createTexturePageClass({
			domain: options.textureDomain,
			format: outputFormat,
			gutterPixels: getRuntimeTexturePageGutterPixels(
				options.textureDomain,
				pagePolicy,
			),
			physicalWrapMode: createDynamicTexturePhysicalWrapMode(
				options.textureDomain,
				pagePolicy,
			),
			purpose: options.purpose,
			sampleClass: pagePolicy.sampleClass,
		}),
		textureKey: createTextureKey({
			outputFormat,
			sampleClass: pagePolicy.sampleClass,
			sourceKey: createMaterialTextureSourceKey({
				kind: "runtime",
				sourceId: `dynamic:${options.dynamicTextureSourceId}`,
				usage:
					options.dataUse.kind === "prepared-palette-texture-use"
						? "palette-rgba"
						: options.dataUse.usage,
			}),
		}),
	};
}

function resourceIdForDynamicTextureIdentity(
	recipe: DynamicVisualBakeInput["recipe"],
): string {
	return createDynamicVisualResourceId(recipe.entityId);
}

function createDynamicTextureOutputFormat(
	dataUse: MaterialTextureDataUseIdentity,
): "rgba8" | "index8" | "index16" {
	if (dataUse.kind === "prepared-palette-texture-use") {
		return "rgba8";
	}
	switch (dataUse.usage) {
		case "index8":
			return "index8";
		case "index16":
			return "index16";
		case "rgba-color":
		case "rgba-detail":
		case "rgba-mask":
		case "rgba-raw":
			return "rgba8";
	}
}

function createDynamicTexturePhysicalWrapMode(
	domain: VisualTextureDomain,
	pagePolicy: RuntimeTexturePagePolicy,
): RuntimeTexturePagePolicy["wrapS"] | undefined {
	if (domain !== "outdoor-terrain" && pagePolicy.sampleClass !== "rgba-mask") {
		return undefined;
	}
	if (pagePolicy.wrapS !== pagePolicy.wrapT) {
		throw new Error(
			`Dynamic texture page class cannot encode mixed physical wrap modes ${pagePolicy.wrapS},${pagePolicy.wrapT}.`,
		);
	}
	return pagePolicy.wrapS;
}

function requireDynamicTexturePlanningItemId(options: {
	readonly bindingId: TextureBindingId;
	readonly entityId: string;
	readonly placementItemIdByBindingId: ReadonlyMap<
		TextureBindingId,
		TexturePlacementItemId
	>;
}): TexturePlacementItemId {
	const placementItemId = options.placementItemIdByBindingId.get(
		options.bindingId,
	);
	if (placementItemId === undefined) {
		throw new Error(
			`Dynamic visual ${options.entityId} has no planned placement item id for binding ${options.bindingId}.`,
		);
	}
	return placementItemId;
}

function requireDynamicVisualTexturePlanning(options: {
	readonly entityId: string;
	readonly texturePlanning: DynamicVisualTexturePlanning;
}): DynamicVisualTexturePlanning & {
	readonly materialPlan: NonNullable<
		DynamicVisualTexturePlanning["materialPlan"]
	>;
} {
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
				dynamicTextureSourceId: createDynamicTextureSourceId(
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

function createDynamicTextureSourceId(
	resourceId: string,
	plan: ObjectVisualMaterialPlan,
	role: ObjectVisualMaterialPlan["textureRoles"][number],
): string {
	return [
		"dynamic-texture",
		resourceId,
		plan.material.materialId.toString(16).padStart(8, "0"),
		role.role,
		role.dataUse.kind === "prepared-palette-texture-use"
			? createMaterialTextureDataUseSignature(role.dataUse)
			: createPreparedTextureHostKey(role.dataUse).id,
	].join(":");
}

function createMaterialTextureDataUseSignature(
	dataUse: MaterialTextureDataUseIdentity,
): string {
	if (dataUse.kind !== "prepared-palette-texture-use") {
		return [
			dataUse.kind,
			dataUse.usage,
			createPreparedTextureHostKey(dataUse).id,
		].join(":");
	}

	const replacementSignature =
		dataUse.replacements.length === 0
			? "none"
			: [...dataUse.replacements]
					.sort(
						(left, right) =>
							left.offset - right.offset ||
							left.count - right.count ||
							left.palette.paletteId - right.palette.paletteId,
					)
					.map(
						(replacement) =>
							`${formatHex32(replacement.palette.paletteId)}@${replacement.offset}+${replacement.count}`,
					)
					.join(",");
	return [
		dataUse.kind,
		dataUse.usage,
		formatHex32(dataUse.palette.paletteId),
		dataUse.domain,
		replacementSignature,
	].join(":");
}

function createTextureRequirementKey(
	dataUse: MaterialTextureDataUseIdentity,
): DynamicEntityTextureRequirement["key"] {
	if (dataUse.kind === "prepared-palette-texture-use") {
		return {
			id: createPreparedPaletteTextureHostKey(dataUse).id,
			kind: "prepared-palette-texture",
		};
	}

	return {
		id: createPreparedTextureHostKey(dataUse).id,
		kind: "prepared-texture",
	};
}

function createDynamicTextureAffinityKey(
	recipe: DynamicVisualBakeInput["recipe"],
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
			bindingId: requirement.bindingId,
			texturePlacementSnapshot: options.texturePlacementSnapshot,
		}),
	}));
}

function requireDynamicPlacementItemId(options: {
	readonly bindingId: TextureBindingId;
	readonly texturePlacementSnapshot: DynamicVisualBakeInput["texturePlacementSnapshot"];
}) {
	const placementItemId =
		options.texturePlacementSnapshot.itemIdsByBindingId.get(options.bindingId);
	if (placementItemId === undefined) {
		throw new Error(
			`Dynamic visual texture planning is missing object-visual placement item id for binding ${options.bindingId}.`,
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
						bindingId: requirement.bindingId,
						dependency: {
							resourceId: options.resourceId,
							roles: [
								{
									itemIds: [requirement.bindingId],
									purpose: classifyDynamicRequirementPurpose(requirement),
								},
							],
						},
						pageClass: requirement.pageClass,
						textureKey: requirement.textureKey,
						dynamicTextureSourceId: requirement.dynamicTextureSourceId,
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
	readonly recipe: DynamicVisualBakeInput["recipe"];
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
	readonly recipe: DynamicVisualBakeInput["recipe"];
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
