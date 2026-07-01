import type {
	StaticTextureBinding,
	TexturePlacementUpdate,
} from "../renderer/types";
import type {
	StaticCoordinatorCommitDelta,
	StaticDrawUnit,
	StaticObjectRenderInstance,
	StaticObjectVisualResource,
	StaticPortalApertureResource,
	StaticPortalGraphRecord,
	StaticPortalInteriorRecord,
	StaticResourceKey,
	StaticSourceMappingRecord,
	StaticSpatialRecord,
	StaticVisibilityRecord,
} from "../static/contracts";

export interface StaticCommitInstallInput {
	readonly commit: StaticCoordinatorCommitDelta;
	readonly textureUpdate: TexturePlacementUpdate | null;
}

export interface StaticCommitInstallResult {
	readonly installedDrawUnits: readonly StaticDrawUnit[];
	readonly portalApertureResources: readonly StaticPortalApertureResource[];
	readonly removedResources: readonly StaticResourceKey[];
	readonly staticObjectRenderInstances: readonly StaticObjectRenderInstance[];
	readonly staticObjectVisualResources: readonly StaticObjectVisualResource[];
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
	assertTexturedDrawUnitsHaveCommittedBindings(
		input.commit.addedDrawUnits,
		input.textureUpdate?.textureBindings ?? [],
	);

	return {
		installedDrawUnits: input.commit.addedDrawUnits,
		portalApertureResources: input.commit.addedPortalApertureResources ?? [],
		removedResources: input.commit.removedResources,
		staticObjectRenderInstances: input.commit.staticObjectRenderInstances,
		staticObjectVisualResources: input.commit.staticObjectVisualResources,
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
