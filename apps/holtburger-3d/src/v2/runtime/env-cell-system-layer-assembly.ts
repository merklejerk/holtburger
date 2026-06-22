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
	StaticCoordinatorSourcePayloadDelta,
	StaticMaterialCoverageReport,
	StaticPortalApertureResource,
	StaticPortalGraphRecord,
	StaticPortalInteriorRecord,
	StaticPortalProjectionRecord,
	StaticSourceMappingRecord,
	StaticSpatialRecord,
	StaticVisibilityRecord,
	StructuredInteriorGeometryStaticDrawUnit,
	TransitionApertureBatch,
} from "../static/contracts";
import type { StaticMaterializationResult } from "./static-materializer";

export interface EnvCellSystemLayerAssemblyPublication {
	readonly key: string;
	readonly payload: EnvCellSystemLayerPayload;
}

interface BuildingTransitionFacts {
	readonly landblockId: number;
	readonly materializedRevision: number | null;
	readonly portalApertureResources: readonly StaticPortalApertureResource[];
	readonly portalGraphs: readonly StaticPortalGraphRecord[];
	readonly sourceRevision: number;
	readonly sourceTransitionApertureCount: number;
	readonly transitionApertureBatches: readonly TransitionApertureBatch[];
}

interface EnvCellFacts {
	readonly authoredDynamicSeedRecords: EnvCellSystemLayerPayload["authoredDynamicSeedRecords"];
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

export class EnvCellSystemLayerAssemblyStore {
	readonly #buildingFactsByLandblock = new Map<
		number,
		BuildingTransitionFacts
	>();
	readonly #envCellFactsByLandblock = new Map<number, EnvCellFacts>();
	readonly #publishedGenerationByLandblock = new Map<number, string>();

	ingestSourcePayload(
		delta: StaticCoordinatorSourcePayloadDelta,
	): EnvCellSystemLayerAssemblyPublication | null {
		if (
			delta.payload.scope.kind !== "outdoor-static-objects" ||
			delta.payload.scope.domain !== "outdoor-buildings"
		) {
			return null;
		}

		const landblockId = delta.payload.scope.landblock.landblockId >>> 0;
		const existing = this.#buildingFactsByLandblock.get(landblockId);
		this.#buildingFactsByLandblock.set(landblockId, {
			landblockId,
			materializedRevision: null,
			portalApertureResources: [],
			portalGraphs: [],
			sourceRevision: delta.payload.sourceRevision,
			sourceTransitionApertureCount:
				delta.payload.scope.buildingTransitionApertures.length,
			transitionApertureBatches: [],
			...(existing
				? {
						materializedRevision: existing.materializedRevision,
						portalApertureResources: existing.portalApertureResources,
						portalGraphs: existing.portalGraphs,
						transitionApertureBatches: existing.transitionApertureBatches,
					}
				: {}),
		});

		return this.#publishIfReady(landblockId);
	}

	ingestMaterializedCommit(
		delta: StaticCoordinatorCommitDelta,
		materialized: StaticMaterializationResult,
	): readonly EnvCellSystemLayerAssemblyPublication[] {
		const publications: EnvCellSystemLayerAssemblyPublication[] = [];
		const buildingLandblockIds = collectBuildingLandblockIds(
			delta,
			materialized,
		);
		for (const landblockId of buildingLandblockIds) {
			const existing = this.#buildingFactsByLandblock.get(landblockId);
			this.#buildingFactsByLandblock.set(landblockId, {
				landblockId,
				materializedRevision: delta.revision,
				portalApertureResources:
					materialized.staticDelta.addedPortalApertureResources.filter(
						(resource) =>
							resource.sourceDomain === "outdoor-buildings" &&
							resource.landblockId === landblockId,
					),
				portalGraphs: materialized.staticPortalGraphs.filter(
					(record) =>
						record.owner.domain === "outdoor-buildings" &&
						record.landblockId === landblockId,
				),
				sourceRevision: existing?.sourceRevision ?? delta.revision,
				sourceTransitionApertureCount:
					existing?.sourceTransitionApertureCount ??
					materialized.staticDelta.addedTransitionApertureBatches.filter(
						(batch) => batch.landblockId === landblockId,
					).length,
				transitionApertureBatches:
					materialized.staticDelta.addedTransitionApertureBatches.filter(
						(batch) => batch.landblockId === landblockId,
					),
			});
			appendPublication(publications, this.#publishIfReady(landblockId));
		}

		const envCellFacts = createEnvCellFactsByLandblock(delta, materialized);
		for (const [landblockId, facts] of envCellFacts) {
			this.#envCellFactsByLandblock.set(landblockId, facts);
			appendPublication(publications, this.#publishIfReady(landblockId));
		}

		return publications;
	}

	#publishIfReady(
		landblockId: number,
	): EnvCellSystemLayerAssemblyPublication | null {
		const envCellFacts = this.#envCellFactsByLandblock.get(landblockId);
		const buildingFacts = this.#buildingFactsByLandblock.get(landblockId);
		if (!envCellFacts || !buildingFacts) {
			return null;
		}
		if (
			buildingFacts.sourceTransitionApertureCount > 0 &&
			buildingFacts.materializedRevision === null
		) {
			return null;
		}

		const portalProjectionRecords = createPortalProjectionRecords({
			buildingFacts,
			envCellFacts,
			landblockId,
		});
		const generationId = createEnvCellSystemLayerGenerationId({
			buildingFacts,
			envCellFacts,
			landblockId,
			portalProjectionRecords,
		});
		if (
			this.#publishedGenerationByLandblock.get(landblockId) === generationId
		) {
			return null;
		}
		this.#publishedGenerationByLandblock.set(landblockId, generationId);

		return {
			key: createEnvCellSystemLayerAssemblyKey(landblockId),
			payload: {
				authoredDynamicSeedRecords: envCellFacts.authoredDynamicSeedRecords,
				envCellStaticObjectDrawUnits: envCellFacts.envCellStaticObjectDrawUnits,
				generationId,
				kind: "env-cell-system",
				landblockId,
				materialCoverage: envCellFacts.materialCoverage,
				portalApertureResources: [
					...envCellFacts.portalApertureResources,
					...buildingFacts.portalApertureResources,
				],
				portalGraphRecords: [
					...envCellFacts.portalGraphs,
					...buildingFacts.portalGraphs,
				],
				portalInteriorRecords: envCellFacts.portalInteriorRecords,
				portalProjectionRecords,
				resourceMembership: createResourceMembership(envCellFacts),
				sourceMappingRecords: envCellFacts.sourceMappingRecords,
				spatialRecords: envCellFacts.spatialRecords,
				structuredInteriorDrawUnits: envCellFacts.structuredInteriorDrawUnits,
				textureUses: envCellFacts.textureUses,
				visibilityRecords: envCellFacts.visibilityRecords,
			},
		};
	}
}

export function createEnvCellSystemLayerAssemblyKey(
	landblockId: number,
): string {
	return `env-cell-system:0x${(landblockId >>> 0).toString(16).padStart(8, "0")}`;
}

function createEnvCellFactsByLandblock(
	delta: StaticCoordinatorCommitDelta,
	materialized: StaticMaterializationResult,
): ReadonlyMap<number, EnvCellFacts> {
	const landblockIds = collectEnvCellLandblockIds(materialized);
	const factsByLandblock = new Map<number, EnvCellFacts>();
	for (const landblockId of landblockIds) {
		const envCellStaticObjectDrawUnits =
			materialized.staticDelta.addedDrawUnits.filter(
				(
					drawUnit,
				): drawUnit is EnvCellFacts["envCellStaticObjectDrawUnits"][number] =>
					drawUnit.kind === "static-object-geometry" &&
					drawUnit.domain === "landblock-env-cells" &&
					drawUnit.landblockId === landblockId,
			);
		const structuredInteriorDrawUnits =
			materialized.staticDelta.addedDrawUnits.filter(
				(drawUnit): drawUnit is StructuredInteriorGeometryStaticDrawUnit =>
					drawUnit.kind === "structured-interior-geometry" &&
					drawUnit.landblockId === landblockId,
			);
		factsByLandblock.set(landblockId, {
			authoredDynamicSeedRecords:
				materialized.staticAuthoredDynamicSeeds.filter(
					(record) =>
						record.owner.domain === "landblock-env-cells" &&
						record.owner.scope.landblockId === landblockId,
				),
			envCellStaticObjectDrawUnits,
			landblockId,
			materialCoverage: delta.materialCoverage.filter(
				(record) =>
					record.domain === "landblock-env-cells" &&
					record.landblockId === landblockId,
			),
			materializedRevision: delta.revision,
			portalApertureResources:
				materialized.staticDelta.addedPortalApertureResources.filter(
					(resource) =>
						resource.sourceDomain === "landblock-env-cells" &&
						resource.landblockId === landblockId,
				),
			portalGraphs: materialized.staticPortalGraphs.filter(
				(record) =>
					record.owner.domain === "landblock-env-cells" &&
					record.landblockId === landblockId,
			),
			portalInteriorRecords: materialized.staticPortalInteriorRecords.filter(
				(record) => record.landblockId === landblockId,
			),
			sourceMappingRecords: materialized.staticSourceMappings.filter(
				(record) =>
					record.owner.kind === "work" &&
					record.owner.domain === "landblock-env-cells" &&
					record.owner.scope.landblockId === landblockId,
			),
			spatialRecords: materialized.staticSpatialRecords.filter(
				(record) =>
					record.owner.kind === "work" &&
					record.owner.domain === "landblock-env-cells" &&
					record.owner.scope.landblockId === landblockId,
			),
			structuredInteriorDrawUnits,
			textureUses: delta.textureUses.filter(
				(textureUse) => textureUse.domain === "landblock-env-cells",
			),
			visibilityRecords: materialized.staticVisibilityRecords.filter(
				(record) => record.landblockId === landblockId,
			),
		});
	}
	return factsByLandblock;
}

function createPortalProjectionRecords(options: {
	readonly buildingFacts: BuildingTransitionFacts;
	readonly envCellFacts: EnvCellFacts;
	readonly landblockId: number;
}): readonly StaticPortalProjectionRecord[] {
	const projection = createStaticPortalProjection({
		landblockId: options.landblockId,
		portalGraphs: [
			...options.envCellFacts.portalGraphs,
			...options.buildingFacts.portalGraphs,
		],
		portalInteriorRecords: options.envCellFacts.portalInteriorRecords,
		root: createOutdoorPortalProjectionRoot(options.landblockId),
		transitionApertureBatches: options.buildingFacts.transitionApertureBatches,
	});
	return projection ? [projection] : [];
}

function createEnvCellSystemLayerGenerationId(options: {
	readonly buildingFacts: BuildingTransitionFacts;
	readonly envCellFacts: EnvCellFacts;
	readonly landblockId: number;
	readonly portalProjectionRecords: readonly StaticPortalProjectionRecord[];
}): string {
	return createStaticLandblockLayerGenerationId({
		kind: "env-cell-system",
		landblockId: options.landblockId,
		sourceKey: [
			`env:${options.envCellFacts.materializedRevision}`,
			`building-source:${options.buildingFacts.sourceRevision}`,
			`building-materialized:${options.buildingFacts.materializedRevision ?? "empty"}`,
			`transition-batches:${options.buildingFacts.transitionApertureBatches.map((batch) => batch.apertureBatchId).join(",")}`,
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
		if (drawUnit.ownership.kind !== "env-cell-static-object-seeds") {
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

function collectBuildingLandblockIds(
	delta: StaticCoordinatorCommitDelta,
	materialized: StaticMaterializationResult,
): readonly number[] {
	return uniqueNumbers([
		...delta.materialCoverage.flatMap((record) =>
			record.domain === "outdoor-buildings" && record.landblockId !== null
				? [record.landblockId]
				: [],
		),
		...materialized.staticDelta.addedDrawUnits.flatMap((drawUnit) =>
			drawUnit.kind === "static-object-geometry" &&
			drawUnit.domain === "outdoor-buildings"
				? [drawUnit.landblockId]
				: [],
		),
		...materialized.staticDelta.addedTransitionApertureBatches.map(
			(batch) => batch.landblockId,
		),
		...materialized.staticPortalGraphs.flatMap((record) =>
			record.owner.domain === "outdoor-buildings" ? [record.landblockId] : [],
		),
	]);
}

function collectEnvCellLandblockIds(
	materialized: StaticMaterializationResult,
): readonly number[] {
	return uniqueNumbers([
		...materialized.staticDelta.addedDrawUnits.flatMap((drawUnit) =>
			(drawUnit.kind === "static-object-geometry" &&
				drawUnit.domain === "landblock-env-cells") ||
			drawUnit.kind === "structured-interior-geometry"
				? [drawUnit.landblockId]
				: [],
		),
		...materialized.staticPortalInteriorRecords.map(
			(record) => record.landblockId,
		),
		...materialized.staticPortalGraphs.flatMap((record) =>
			record.owner.domain === "landblock-env-cells" ? [record.landblockId] : [],
		),
	]);
}

function appendPublication(
	publications: EnvCellSystemLayerAssemblyPublication[],
	publication: EnvCellSystemLayerAssemblyPublication | null,
): void {
	if (publication) {
		publications.push(publication);
	}
}

function uniqueNumbers(values: readonly number[]): readonly number[] {
	return [...new Set(values.map((value) => value >>> 0))].sort(
		(left, right) => left - right,
	);
}

function compareStrings(left: string, right: string): number {
	return left.localeCompare(right);
}
