import {
	uniqueSortedStaticTextureUseOwners,
	type StaticBakeTextureUse,
	type StaticMaterialTableEntry,
	type StaticTextureUseOwner,
} from "../contracts";
import {
	type ObjectVisualTexturePlacementSnapshot,
	type TextureResourceDependencies,
	type TextureResourceRoleDependency,
} from "../../textures/placement";
import { createStaticMaterialTextureBindingRequirement } from "./static-material-texture-policy";
import {
	bakeObjectVisuals,
	type ObjectVisualTextureBinding,
} from "../../visual/object-visual-baker";
import type {
	ObjectVisualGeometryBuffer,
	ObjectVisualGeometryBufferId,
	ObjectVisualRecipeBundle,
	ObjectVisualTextureRecipeId,
} from "../../visual/object-visual-recipe-bundle";
import { createObjectVisualStaticInstallSet } from "../../visual/object-visual-static-publication-baker";
import type { ObjectVisualStaticPublicationMetadata } from "../../visual/object-visual-static-publication";
import type { ObjectVisualInstallSet } from "../../visual/object-visual-install-set";

export interface StaticObjectVisualRecipeInstallPublication {
	readonly installSet: ObjectVisualInstallSet;
	readonly textureDependencies: readonly TextureResourceDependencies[];
	readonly textureUses: readonly StaticBakeTextureUse[];
}

export function createStaticObjectVisualRecipeInstallPublication(input: {
	readonly bundle: ObjectVisualRecipeBundle;
	readonly domain: StaticBakeTextureUse["domain"];
	readonly geometryBuffers: ReadonlyMap<
		ObjectVisualGeometryBufferId,
		ObjectVisualGeometryBuffer
	>;
	readonly metadata: ObjectVisualStaticPublicationMetadata;
	readonly renderPartIdPrefix: string;
	readonly texturePlacementSnapshot: ObjectVisualTexturePlacementSnapshot;
	readonly textureUseNamespace: string;
	readonly textureUseScopeId: string;
	readonly partitionKeyByPartInstanceIndex?: ReadonlyMap<number, string>;
}): StaticObjectVisualRecipeInstallPublication {
	const textureBindings = createTextureBindings(input);
	const bakeResult = bakeObjectVisuals({
		bundle: input.bundle,
		geometryBuffers: input.geometryBuffers,
		partitionKeyByPartInstanceIndex:
			input.partitionKeyByPartInstanceIndex ??
			createPublicationPartitionKeys(input.metadata),
		renderPartIdPrefix: input.renderPartIdPrefix,
		textureBindings,
	});
	const installSet = createObjectVisualStaticInstallSet({
		bakeResult,
		metadata: input.metadata,
	});
	const textureDependencies = createPublishedTextureDependencies(installSet);
	const textureUses = createPublishedTextureUses({
		bundle: input.bundle,
		domain: input.domain,
		installSet,
		textureBindings,
	});

	return {
		installSet: {
			...installSet,
			textureDependencies,
		},
		textureDependencies,
		textureUses,
	};
}

function createPublicationPartitionKeys(
	metadata: ObjectVisualStaticPublicationMetadata,
): ReadonlyMap<number, string> {
	const keys = new Map<number, string>();
	for (const publication of metadata.directStaticObjectPublications) {
		for (const partInstanceIndex of publication.partInstanceIndices) {
			keys.set(partInstanceIndex, `direct:${publication.publicationIdSeed}`);
		}
	}
	for (const publication of metadata.structuredInteriorPublications) {
		for (const partInstanceIndex of publication.partInstanceIndices) {
			keys.set(
				partInstanceIndex,
				`structured:${publication.publicationIdSeed}`,
			);
		}
	}
	for (const renderInstance of metadata.instancedRenderInstances) {
		keys.set(
			renderInstance.partInstanceIndex,
			`instanced:${renderInstance.groupId}`,
		);
	}
	return keys;
}

function createTextureBindings(input: {
	readonly bundle: ObjectVisualRecipeBundle;
	readonly texturePlacementSnapshot: ObjectVisualTexturePlacementSnapshot;
	readonly textureUseNamespace: string;
	readonly textureUseScopeId: string;
}): ReadonlyMap<ObjectVisualTextureRecipeId, ObjectVisualTextureBinding> {
	const bindings = new Map<
		ObjectVisualTextureRecipeId,
		ObjectVisualTextureBinding
	>();
	for (const [textureRecipeId, recipe] of input.bundle.textureRecipes) {
		const requirement = createStaticMaterialTextureBindingRequirement({
			dataUse: recipe.dataUse,
			textureUseNamespace: input.textureUseNamespace,
			textureUseScopeId: input.textureUseScopeId,
			wrapMode: recipe.wrapMode,
		});
		const itemId = input.texturePlacementSnapshot.itemIdsByTextureUseId.get(
			requirement.textureUseId,
		);
		if (itemId === undefined) {
			throw new Error(
				`Object visual texture recipe ${textureRecipeId} requires unplaced texture use ${requirement.textureUseId}.`,
			);
		}
		const placement =
			input.texturePlacementSnapshot.placementsByItemId.get(itemId);
		if (!placement) {
			throw new Error(
				`Object visual texture recipe ${textureRecipeId} resolves to missing placement item ${itemId}.`,
			);
		}
		if (placement.textureUseId !== requirement.textureUseId) {
			throw new Error(
				`Object visual texture recipe ${textureRecipeId} placement item ${itemId} belongs to ${placement.textureUseId}, not ${requirement.textureUseId}.`,
			);
		}

		bindings.set(textureRecipeId, {
			dependency: {
				resourceId: requirement.textureUseId,
				roles: [
					{
						itemIds: [requirement.textureUseId],
						purpose: requirement.purpose,
					},
				],
			},
			textureUseId: requirement.textureUseId,
		});
	}
	return bindings;
}

function createPublishedTextureDependencies(
	installSet: ObjectVisualInstallSet,
): readonly TextureResourceDependencies[] {
	return [
		...installSet.directDrawUnits.flatMap((drawUnit) =>
			createVisualResourceTextureDependency({
				entries: drawUnit.materialEntries,
				resourceId: drawUnit.drawUnitId,
			}),
		),
		...installSet.visualResources.flatMap((resource) =>
			createVisualResourceTextureDependency({
				entries: resource.materialEntries,
				resourceId: resource.resourceId,
			}),
		),
	];
}

function createPublishedTextureUses(input: {
	readonly bundle: ObjectVisualRecipeBundle;
	readonly domain: StaticBakeTextureUse["domain"];
	readonly installSet: ObjectVisualInstallSet;
	readonly textureBindings: ReadonlyMap<
		ObjectVisualTextureRecipeId,
		ObjectVisualTextureBinding
	>;
}): readonly StaticBakeTextureUse[] {
	return [...input.bundle.textureRecipes.entries()]
		.flatMap(([textureRecipeId, recipe]) => {
			const binding = input.textureBindings.get(textureRecipeId);
			if (!binding) {
				return [];
			}
			const owners = collectPublishedTextureUseOwners({
				installSet: input.installSet,
				textureUseId: binding.textureUseId,
			});
			if (owners.length === 0) {
				return [];
			}
			return {
				domain: input.domain,
				owners,
				samplingPolicy: createTextureSamplingPolicy(recipe.wrapMode),
				source: recipe.dataUse,
				textureUseId: binding.textureUseId,
			};
		})
		.sort((left, right) => left.textureUseId.localeCompare(right.textureUseId));
}

function collectPublishedTextureUseOwners(input: {
	readonly installSet: ObjectVisualInstallSet;
	readonly textureUseId: string;
}): readonly StaticTextureUseOwner[] {
	return uniqueSortedStaticTextureUseOwners([
		...input.installSet.directDrawUnits.flatMap((drawUnit) =>
			drawUnit.textureUseIds.includes(input.textureUseId)
				? [{ drawUnitId: drawUnit.drawUnitId, kind: "draw-unit" as const }]
				: [],
		),
		...input.installSet.visualResources.flatMap((resource) =>
			resource.textureUseIds.includes(input.textureUseId)
				? [
						{
							kind: "static-object-visual-resource" as const,
							resourceId: resource.resourceId,
						},
					]
				: [],
		),
	]);
}

function createTextureSamplingPolicy(
	wrapMode: "clamp" | "repeat",
): StaticBakeTextureUse["samplingPolicy"] {
	return wrapMode === "repeat"
		? { wrapS: "repeat", wrapT: "repeat" }
		: { wrapS: "clamp-to-edge", wrapT: "clamp-to-edge" };
}

function createVisualResourceTextureDependency(options: {
	readonly entries: readonly StaticMaterialTableEntry[];
	readonly resourceId: string;
}): readonly TextureResourceDependencies[] {
	const roles = createTextureRoleDependencies(options.entries);
	if (roles.length === 0) {
		return [];
	}
	return [
		{
			resourceId: options.resourceId,
			roles,
		},
	];
}

function createTextureRoleDependencies(
	entries: readonly StaticMaterialTableEntry[],
): readonly TextureResourceRoleDependency[] {
	const baseColor = new Set<string>();
	const detail = new Set<string>();
	const index = new Set<string>();
	const palette = new Set<string>();
	for (const entry of entries) {
		addNullableString(baseColor, entry.primaryTextureUseId);
		addNullableString(detail, entry.detailTextureUseId);
		addNullableString(index, entry.indexTextureUseId);
		addNullableString(palette, entry.paletteTextureUseId);
	}

	return [
		createRoleDependency("object-base-color", baseColor),
		createRoleDependency("object-detail", detail),
		createRoleDependency("object-index", index),
		createRoleDependency("object-palette", palette),
	].filter((role): role is TextureResourceRoleDependency => role !== null);
}

function createRoleDependency(
	purpose: TextureResourceRoleDependency["purpose"],
	itemIds: ReadonlySet<string>,
): TextureResourceRoleDependency | null {
	if (itemIds.size === 0) {
		return null;
	}
	return {
		itemIds: [...itemIds].sort(),
		purpose,
	};
}

function addNullableString(target: Set<string>, value: string | null): void {
	if (value !== null) {
		target.add(value);
	}
}
