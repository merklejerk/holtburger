import type { TexturePlacementUpdate } from "../renderer/types";
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
	readonly textureReadiness?: readonly StaticCommitTextureBindingReadiness[];
	readonly textureUpdate: TexturePlacementUpdate | null;
}

type StaticCommitTextureBindingReadiness =
	| {
			readonly bindingId: string;
			readonly kind: "resident";
	  }
	| {
			readonly bindingId: string;
			readonly kind: "pending";
	  }
	| {
			readonly bindingId: string;
			readonly kind: "failed";
			readonly reason: string;
	  };

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
	assertTexturedDrawUnitsHaveTextureReadiness(
		input.commit.addedDrawUnits,
		createStaticCommitTextureReadiness(input),
	);
	assertTexturedObjectVisualResourcesHaveTextureReadiness(
		objectVisualInstallSet.visualResources,
		createStaticCommitTextureReadiness(input),
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

function createStaticCommitTextureReadiness(
	input: StaticCommitInstallInput,
): ReadonlyMap<string, StaticCommitTextureBindingReadiness> {
	if (input.textureReadiness) {
		return new Map(
			input.textureReadiness.map((readiness) => [
				readiness.bindingId,
				readiness,
			]),
		);
	}
	return new Map(
		(input.textureUpdate?.resolvedTexturePlacements ?? []).map((placement) => [
			placement.bindingId,
			{
				bindingId: placement.bindingId,
				kind: "resident" as const,
			},
		]),
	);
}

function assertTexturedDrawUnitsHaveTextureReadiness(
	drawUnits: readonly StaticDrawUnit[],
	readinessByBindingId: ReadonlyMap<
		string,
		StaticCommitTextureBindingReadiness
	>,
): void {
	for (const drawUnit of drawUnits) {
		const expectedTextureBindingIds = drawUnit.textureBindingIds;
		if (expectedTextureBindingIds.length === 0) {
			continue;
		}

		const missingTextureBindingIds = expectedTextureBindingIds.filter(
			(textureBindingId) => !readinessByBindingId.has(textureBindingId),
		);
		if (missingTextureBindingIds.length > 0) {
			throw new Error(
				`Static draw unit ${drawUnit.drawUnitId} is missing resolved texture placements for ${missingTextureBindingIds.join(", ")}.`,
			);
		}
		assertNoFailedTextureReadiness(
			`Static draw unit ${drawUnit.drawUnitId}`,
			expectedTextureBindingIds,
			readinessByBindingId,
		);
	}
}

function assertTexturedObjectVisualResourcesHaveTextureReadiness(
	resources: readonly ObjectVisualResource[],
	readinessByBindingId: ReadonlyMap<
		string,
		StaticCommitTextureBindingReadiness
	>,
): void {
	for (const resource of resources) {
		if (resource.textureBindingIds.length === 0) {
			continue;
		}
		const missingTextureBindingIds = resource.textureBindingIds.filter(
			(textureBindingId) => !readinessByBindingId.has(textureBindingId),
		);
		if (missingTextureBindingIds.length > 0) {
			throw new Error(
				`Static object visual resource ${resource.resourceId} is missing resolved texture placements for ${missingTextureBindingIds.join(", ")}.`,
			);
		}
		assertNoFailedTextureReadiness(
			`Static object visual resource ${resource.resourceId}`,
			resource.textureBindingIds,
			readinessByBindingId,
		);
	}
}

function assertNoFailedTextureReadiness(
	subject: string,
	textureBindingIds: readonly string[],
	readinessByBindingId: ReadonlyMap<
		string,
		StaticCommitTextureBindingReadiness
	>,
): void {
	const failed = textureBindingIds
		.map((bindingId) => readinessByBindingId.get(bindingId))
		.filter(
			(
				readiness,
			): readiness is Extract<
				StaticCommitTextureBindingReadiness,
				{ readonly kind: "failed" }
			> => readiness?.kind === "failed",
		);
	if (failed.length === 0) {
		return;
	}
	throw new Error(
		`${subject} has failed texture bindings: ${failed.map((readiness) => `${readiness.bindingId} (${readiness.reason})`).join(", ")}.`,
	);
}
