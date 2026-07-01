import type { StaticMaterialTableEntry } from "../contracts";
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
}

export function createStaticObjectVisualRecipeInstallPublication(input: {
	readonly bundle: ObjectVisualRecipeBundle;
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
	const bakeResult = bakeObjectVisuals({
		bundle: input.bundle,
		geometryBuffers: input.geometryBuffers,
		partitionKeyByPartInstanceIndex:
			input.partitionKeyByPartInstanceIndex ??
			createPublicationPartitionKeys(input.metadata),
		renderPartIdPrefix: input.renderPartIdPrefix,
		textureBindings: createTextureBindings(input),
	});
	const installSet = createObjectVisualStaticInstallSet({
		bakeResult,
		metadata: input.metadata,
	});
	const textureDependencies = createPublishedTextureDependencies(installSet);

	return {
		installSet: {
			...installSet,
			textureDependencies,
		},
		textureDependencies,
	};
}

function createPublicationPartitionKeys(
	metadata: ObjectVisualStaticPublicationMetadata,
): ReadonlyMap<number, string> {
	const keys = new Map<number, string>();
	for (const drawUnit of metadata.directStaticObjectDrawUnits) {
		for (const partInstanceIndex of drawUnit.partInstanceIndices) {
			keys.set(partInstanceIndex, `direct:${drawUnit.drawUnitIdSeed}`);
		}
	}
	for (const drawUnit of metadata.structuredInteriorDrawUnits) {
		for (const partInstanceIndex of drawUnit.partInstanceIndices) {
			keys.set(partInstanceIndex, `structured:${drawUnit.drawUnitIdSeed}`);
		}
	}
	for (const renderInstance of metadata.instancedRenderInstances) {
		keys.set(
			renderInstance.partInstanceIndex,
			`instanced:${renderInstance.groupId}:${renderInstance.instanceIdSeed}`,
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
