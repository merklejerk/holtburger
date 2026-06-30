import {
	createStaticLandblockLayerGenerationId,
	type EnvCellSystemLayerPayload,
} from "../renderer/types";
import {
	createOutdoorPortalProjectionRoot,
	createStaticPortalProjection,
} from "../static/portal-graphs";
import type {
	StaticBakeTextureUse,
	StaticCoordinatorCommitDelta,
	StaticMaterialCoverageReport,
	StaticPortalApertureResource,
	StaticPortalGraphRecord,
	StaticPortalInteriorRecord,
	StaticPortalProjectionRecord,
	StaticSourceMappingRecord,
	StaticSpatialRecord,
	StaticVisibilityRecord,
	StructuredInteriorGeometryStaticDrawUnit,
} from "../static/contracts";
import type { StaticMaterializationResult } from "./static-materializer";

export interface EnvCellSystemLayerPublication {
	readonly payload: EnvCellSystemLayerPayload;
}

interface EnvCellFacts {
	readonly envCellStaticObjectPlacementRecords: EnvCellSystemLayerPayload["envCellStaticObjectPlacementRecords"];
	readonly envCellStaticObjectDrawUnits: EnvCellSystemLayerPayload["envCellStaticObjectDrawUnits"];
	readonly landblockId: number;
	readonly materialCoverage: readonly StaticMaterialCoverageReport[];
	readonly materializedRevision: number;
	readonly portalApertureResources: readonly StaticPortalApertureResource[];
	readonly portalGraphs: readonly StaticPortalGraphRecord[];
	readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly sourceMappingRecords: readonly StaticSourceMappingRecord[];
	readonly spatialRecords: readonly StaticSpatialRecord[];
	readonly structuredInteriorDrawUnits: readonly StructuredInteriorGeometryStaticDrawUnit[];
	readonly textureUses: readonly StaticBakeTextureUse[];
	readonly visibilityRecords: readonly StaticVisibilityRecord[];
}

export function createEnvCellSystemLayerPublications(
	delta: StaticCoordinatorCommitDelta,
	materialized: StaticMaterializationResult,
): readonly EnvCellSystemLayerPublication[] {
	return [...createEnvCellFactsByLandblock(delta, materialized).entries()].map(
		([landblockId, envCellFacts]) => {
			const portalProjectionRecords = createPortalProjectionRecords({
				envCellFacts,
				landblockId,
			});
			return {
				payload: {
					envCellStaticObjectPlacementRecords:
						envCellFacts.envCellStaticObjectPlacementRecords,
					envCellStaticObjectDrawUnits:
						envCellFacts.envCellStaticObjectDrawUnits,
					generationId: createEnvCellSystemLayerGenerationId({
						envCellFacts,
						landblockId,
						portalProjectionRecords,
					}),
					kind: "env-cell-system",
					landblockId,
					materialCoverage: envCellFacts.materialCoverage,
					portalApertureResources: envCellFacts.portalApertureResources,
					portalGraphRecords: envCellFacts.portalGraphs,
					portalInteriorRecords: envCellFacts.portalInteriorRecords,
					portalProjectionRecords,
					resourceMembership: createResourceMembership(envCellFacts),
					sourceMappingRecords: envCellFacts.sourceMappingRecords,
					spatialRecords: envCellFacts.spatialRecords,
					structuredInteriorDrawUnits:
						envCellFacts.structuredInteriorDrawUnits,
					textureUses: envCellFacts.textureUses,
					visibilityRecords: envCellFacts.visibilityRecords,
				},
			};
		},
	);
}

function createEnvCellFactsByLandblock(
	delta: StaticCoordinatorCommitDelta,
	materialized: StaticMaterializationResult,
): ReadonlyMap<number, EnvCellFacts> {
	const landblockIds = collectEnvCellLandblockIds(materialized);
	const factsByLandblock = new Map<number, EnvCellFacts>();
	for (const landblockId of landblockIds) {
		const envCellStaticObjectDrawUnits =
			materialized.materializedDrawUnits.filter(
				(
					drawUnit,
				): drawUnit is EnvCellFacts["envCellStaticObjectDrawUnits"][number] =>
					drawUnit.kind === "static-object-geometry" &&
					drawUnit.domain === "env-cell-system" &&
					drawUnit.landblockId === landblockId,
			);
		const structuredInteriorDrawUnits =
			materialized.materializedDrawUnits.filter(
				(drawUnit): drawUnit is StructuredInteriorGeometryStaticDrawUnit =>
					drawUnit.kind === "structured-interior-geometry" &&
					drawUnit.landblockId === landblockId,
			);
		factsByLandblock.set(landblockId, {
			envCellStaticObjectPlacementRecords:
				delta.envCellStaticObjectPlacementRecords.filter(
					(record) =>
						record.kind === "env-cell-static-object-placement" &&
						record.owner.domain === "env-cell-system" &&
						record.owner.key.landblockId === landblockId,
				),
			envCellStaticObjectDrawUnits,
			landblockId,
			materialCoverage: delta.materialCoverage.filter(
				(record) =>
					record.domain === "env-cell-system" &&
					record.landblockId === landblockId,
			),
			materializedRevision: delta.revision,
			portalApertureResources: materialized.portalApertureResources.filter(
				(resource) =>
					resource.landblockId === landblockId &&
					(resource.sourceDomain === "env-cell-system" ||
						resource.ranges.some(
							(range) => range.sourceKind === "building-transition",
						)),
			),
			portalGraphs: materialized.staticPortalGraphs.filter(
				(record) =>
					record.owner.domain === "env-cell-system" &&
					record.landblockId === landblockId,
			),
			portalInteriorRecords: materialized.staticPortalInteriorRecords.filter(
				(record) => record.landblockId === landblockId,
			),
			sourceMappingRecords: materialized.staticSourceMappings.filter(
				(record) =>
					record.owner.kind === "layer-owner" &&
					record.owner.domain === "env-cell-system" &&
					record.owner.key.landblockId === landblockId,
			),
			spatialRecords: materialized.staticSpatialRecords.filter(
				(record) =>
					record.owner.kind === "layer-owner" &&
					record.owner.domain === "env-cell-system" &&
					record.owner.key.landblockId === landblockId,
			),
			structuredInteriorDrawUnits,
			textureUses: delta.textureUses.filter(
				(textureUse) => textureUse.domain === "env-cell-system",
			),
			visibilityRecords: materialized.staticVisibilityRecords.filter(
				(record) => record.landblockId === landblockId,
			),
		});
	}
	return factsByLandblock;
}

function createPortalProjectionRecords(options: {
	readonly envCellFacts: EnvCellFacts;
	readonly landblockId: number;
}): readonly StaticPortalProjectionRecord[] {
	const projection = createStaticPortalProjection({
		landblockId: options.landblockId,
		portalApertureResources: options.envCellFacts.portalApertureResources,
		portalGraphs: options.envCellFacts.portalGraphs,
		portalInteriorRecords: options.envCellFacts.portalInteriorRecords,
		root: createOutdoorPortalProjectionRoot(options.landblockId),
	});
	return projection ? [projection] : [];
}

function createEnvCellSystemLayerGenerationId(options: {
	readonly envCellFacts: EnvCellFacts;
	readonly landblockId: number;
	readonly portalProjectionRecords: readonly StaticPortalProjectionRecord[];
}): string {
	return createStaticLandblockLayerGenerationId({
		kind: "env-cell-system",
		landblockId: options.landblockId,
		sourceKey: [
			`env:${options.envCellFacts.materializedRevision}`,
			`portal-apertures:${options.envCellFacts.portalApertureResources
				.flatMap((resource) => resource.ranges.map((range) => range.rangeId))
				.sort(compareStrings)
				.join(",")}`,
			`projections:${options.portalProjectionRecords.map((record) => record.sourceRevisionKey).join(",")}`,
		].join("|"),
	});
}

function createResourceMembership(
	envCellFacts: EnvCellFacts,
): EnvCellSystemLayerPayload["resourceMembership"] {
	const membershipByEnvCellId = new Map<
		number,
		{
			envCellStaticObjectDrawUnitIds: string[];
			structuredInteriorDrawUnitIds: string[];
		}
	>();
	for (const drawUnit of envCellFacts.structuredInteriorDrawUnits) {
		getOrCreateMembership(
			membershipByEnvCellId,
			drawUnit.envCellId,
		).structuredInteriorDrawUnitIds.push(drawUnit.drawUnitId);
	}
	for (const drawUnit of envCellFacts.envCellStaticObjectDrawUnits) {
		if (drawUnit.ownership.kind !== "env-cell-static-object-placements") {
			continue;
		}
		for (const envCellId of drawUnit.ownership.envCellIds) {
			getOrCreateMembership(
				membershipByEnvCellId,
				envCellId,
			).envCellStaticObjectDrawUnitIds.push(drawUnit.drawUnitId);
		}
	}
	return [...membershipByEnvCellId.entries()]
		.map(([envCellId, membership]) => ({
			envCellId,
			envCellStaticObjectDrawUnitIds:
				membership.envCellStaticObjectDrawUnitIds.sort(compareStrings),
			structuredInteriorDrawUnitIds:
				membership.structuredInteriorDrawUnitIds.sort(compareStrings),
		}))
		.sort((left, right) => left.envCellId - right.envCellId);
}

function getOrCreateMembership(
	membershipByEnvCellId: Map<
		number,
		{
			envCellStaticObjectDrawUnitIds: string[];
			structuredInteriorDrawUnitIds: string[];
		}
	>,
	envCellId: number,
): {
	envCellStaticObjectDrawUnitIds: string[];
	structuredInteriorDrawUnitIds: string[];
} {
	const existing = membershipByEnvCellId.get(envCellId);
	if (existing) {
		return existing;
	}
	const created = {
		envCellStaticObjectDrawUnitIds: [],
		structuredInteriorDrawUnitIds: [],
	};
	membershipByEnvCellId.set(envCellId, created);
	return created;
}

function collectEnvCellLandblockIds(
	materialized: StaticMaterializationResult,
): readonly number[] {
	return uniqueNumbers([
		...materialized.materializedDrawUnits.flatMap((drawUnit) =>
			(drawUnit.kind === "static-object-geometry" &&
				drawUnit.domain === "env-cell-system") ||
			drawUnit.kind === "structured-interior-geometry"
				? [drawUnit.landblockId]
				: [],
		),
		...materialized.staticPortalInteriorRecords.map(
			(record) => record.landblockId,
		),
		...materialized.staticPortalGraphs.flatMap((record) =>
			record.owner.domain === "env-cell-system" ? [record.landblockId] : [],
		),
	]);
}

function uniqueNumbers(values: readonly number[]): readonly number[] {
	return [...new Set(values.map((value) => value >>> 0))].sort(
		(left, right) => left - right,
	);
}

function compareStrings(left: string, right: string): number {
	return left.localeCompare(right);
}
