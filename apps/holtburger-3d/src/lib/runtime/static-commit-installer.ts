import type {
	ResolvedTexturePlacement,
	TexturePlacementUpdate,
} from "../renderer/types";
import type {
	StaticCoordinatorCommitDelta,
	StaticDrawUnit,
	StaticPortalApertureResource,
	StaticPortalGraphRecord,
	StaticPortalInteriorRecord,
	StaticResourceKey,
	StaticSourceMappingRecord,
	StaticSpatialRecord,
	StaticVisibilityRecord,
} from "../static/contracts";
import type {
	ObjectVisualInstallSet,
	ObjectVisualResource,
} from "../visual/object-visual-install-set";

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
	assertTexturedDrawUnitsHaveResolvedPlacements(
		input.commit.addedDrawUnits,
		input.textureUpdate?.resolvedTexturePlacements ?? [],
	);
	assertTexturedObjectVisualResourcesHaveResolvedPlacements(
		objectVisualInstallSet.visualResources,
		input.textureUpdate?.resolvedTexturePlacements ?? [],
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

function assertTexturedDrawUnitsHaveResolvedPlacements(
	drawUnits: readonly StaticDrawUnit[],
	placements: readonly ResolvedTexturePlacement[],
): void {
	const committedTextureBindingIds = new Set(
		placements.map((placement) => placement.bindingId),
	);

	for (const drawUnit of drawUnits) {
		const expectedTextureBindingIds = drawUnit.textureBindingIds;
		if (expectedTextureBindingIds.length === 0) {
			continue;
		}

		const missingTextureBindingIds = expectedTextureBindingIds.filter(
			(textureBindingId) => !committedTextureBindingIds.has(textureBindingId),
		);
		if (missingTextureBindingIds.length > 0) {
			throw new Error(
				`Static draw unit ${drawUnit.drawUnitId} is missing resolved texture placements for ${missingTextureBindingIds.join(", ")}.`,
			);
		}
	}
}

function assertTexturedObjectVisualResourcesHaveResolvedPlacements(
	resources: readonly ObjectVisualResource[],
	placements: readonly ResolvedTexturePlacement[],
): void {
	const committedTextureBindingIds = new Set(
		placements.map((placement) => placement.bindingId),
	);

	for (const resource of resources) {
		if (resource.textureBindingIds.length === 0) {
			continue;
		}
		const missingTextureBindingIds = resource.textureBindingIds.filter(
			(textureBindingId) => !committedTextureBindingIds.has(textureBindingId),
		);
		if (missingTextureBindingIds.length > 0) {
			throw new Error(
				`Static object visual resource ${resource.resourceId} is missing resolved texture placements for ${missingTextureBindingIds.join(", ")}.`,
			);
		}
	}
}
