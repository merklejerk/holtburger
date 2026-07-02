import type {
	StaticTextureBinding,
	TexturePlacementUpdate,
} from "../renderer/types";
import type {
	StaticCoordinatorCommitDelta,
	StaticDrawUnit,
	StaticObjectVisualResource,
	StaticPortalApertureResource,
	StaticPortalGraphRecord,
	StaticPortalInteriorRecord,
	StaticResourceKey,
	StaticSourceMappingRecord,
	StaticSpatialRecord,
	StaticVisibilityRecord,
} from "../static/contracts";
import type { ObjectVisualInstallSet } from "../visual/object-visual-install-set";

export interface StaticCommitInstallInput {
	readonly commit: StaticCoordinatorCommitDelta;
	readonly textureUpdate: TexturePlacementUpdate | null;
}

export interface StaticCommitInstallResult {
	readonly installedDrawUnits: readonly StaticDrawUnit[];
	readonly objectVisualInstallSet: ObjectVisualInstallSet;
	readonly portalApertureResources: readonly StaticPortalApertureResource[];
	readonly removedResources: readonly StaticResourceKey[];
	readonly staticPortalGraphs: readonly StaticPortalGraphRecord[];
	readonly staticPortalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly staticSourceMappings: readonly StaticSourceMappingRecord[];
	readonly staticSpatialRecords: readonly StaticSpatialRecord[];
	readonly staticVisibilityRecords: readonly StaticVisibilityRecord[];
	readonly textureUpdate: TexturePlacementUpdate | null;
}

export function installStaticCommit(
	input: StaticCommitInstallInput,
): StaticCommitInstallResult {
	const objectVisualInstallSet = input.commit.objectVisualInstallSet;
	assertTexturedDrawUnitsHaveCommittedBindings(
		input.commit.addedDrawUnits,
		input.textureUpdate?.textureBindings ?? [],
	);
	assertTexturedStaticObjectVisualResourcesHaveCommittedBindings(
		objectVisualInstallSet.visualResources,
		input.textureUpdate?.textureBindings ?? [],
	);

	return {
		installedDrawUnits: input.commit.addedDrawUnits,
		objectVisualInstallSet,
		portalApertureResources: input.commit.addedPortalApertureResources ?? [],
		removedResources: input.commit.removedResources,
		staticPortalGraphs: input.commit.staticPortalGraphs,
		staticPortalInteriorRecords: input.commit.staticPortalInteriorRecords,
		staticSourceMappings: input.commit.staticSourceMappings,
		staticSpatialRecords: input.commit.staticSpatialRecords,
		staticVisibilityRecords: input.commit.staticVisibilityRecords,
		textureUpdate: input.textureUpdate,
	};
}

function assertTexturedDrawUnitsHaveCommittedBindings(
	drawUnits: readonly StaticDrawUnit[],
	bindings: readonly StaticTextureBinding[],
): void {
	const textureUseIdsByDrawUnitId = new Map<string, Set<string>>();
	for (const binding of bindings) {
		if (binding.owner.kind !== "draw-unit") {
			continue;
		}
		const textureUseIds =
			textureUseIdsByDrawUnitId.get(binding.owner.drawUnitId) ??
			new Set<string>();
		textureUseIds.add(binding.bindingKey);
		textureUseIdsByDrawUnitId.set(binding.owner.drawUnitId, textureUseIds);
	}

	for (const drawUnit of drawUnits) {
		const expectedTextureUseIds = drawUnit.textureUseIds;
		if (expectedTextureUseIds.length === 0) {
			continue;
		}

		const committedTextureUseIds =
			textureUseIdsByDrawUnitId.get(drawUnit.drawUnitId) ?? new Set<string>();
		const missingTextureUseIds = expectedTextureUseIds.filter(
			(textureUseId) => !committedTextureUseIds.has(textureUseId),
		);
		if (missingTextureUseIds.length > 0) {
			throw new Error(
				`Static draw unit ${drawUnit.drawUnitId} is missing committed texture bindings for ${missingTextureUseIds.join(", ")}.`,
			);
		}
	}
}

function assertTexturedStaticObjectVisualResourcesHaveCommittedBindings(
	resources: readonly StaticObjectVisualResource[],
	bindings: readonly StaticTextureBinding[],
): void {
	const textureUseIdsByResourceId = new Map<string, Set<string>>();
	for (const binding of bindings) {
		if (binding.owner.kind !== "static-object-visual-resource") {
			continue;
		}
		const textureUseIds =
			textureUseIdsByResourceId.get(binding.owner.resourceId) ??
			new Set<string>();
		textureUseIds.add(binding.bindingKey);
		textureUseIdsByResourceId.set(binding.owner.resourceId, textureUseIds);
	}

	for (const resource of resources) {
		if (resource.textureUseIds.length === 0) {
			continue;
		}
		const committedTextureUseIds =
			textureUseIdsByResourceId.get(resource.resourceId) ?? new Set<string>();
		const missingTextureUseIds = resource.textureUseIds.filter(
			(textureUseId) => !committedTextureUseIds.has(textureUseId),
		);
		if (missingTextureUseIds.length > 0) {
			throw new Error(
				`Static object visual resource ${resource.resourceId} is missing committed texture bindings for ${missingTextureUseIds.join(", ")}.`,
			);
		}
	}
}
