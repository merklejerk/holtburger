import type {
	LandblockEnvCellStaticFacts,
	LandblockEnvCellsStaticScopePayload,
	ScheduledStaticWork,
	StaticAuthoredDynamicSeedRecord,
	StaticBakeBatchInput,
	StaticBakeBatchItem,
	StaticBakeBatchResult,
	StaticBaker,
	StaticPortalInteriorRecord,
	StaticSourceMappingRecord,
	StaticSpatialRecord,
	StaticVisibilityRecord,
	StaticWorkPeerRecordOwner,
} from "../../contracts";

export class LandblockEnvCellsBaker implements StaticBaker {
	async bake(input: StaticBakeBatchInput): Promise<StaticBakeBatchResult> {
		return bakeLandblockEnvCells(input);
	}
}

export function bakeLandblockEnvCells(
	input: StaticBakeBatchInput,
): StaticBakeBatchResult {
	if (input.domain !== "landblock-env-cells") {
		throw new Error(
			`Landblock env-cell baker only supports landblock env-cell batches. Received ${input.domain}.`,
		);
	}

	const itemResults = input.items.map(bakeLandblockEnvCellItem);

	return {
		atlasRegistryUpdates: [],
		buildRevision: Math.max(
			...input.items.map((item) => item.payload.sourceRevision),
			0,
		),
		domain: input.domain,
		drawUnits: [],
		materialCoverage: [],
		revision: input.revision,
		staticAuthoredDynamicSeeds: itemResults.flatMap(
			(result) => result.staticAuthoredDynamicSeeds,
		),
		staticBatchId: input.staticBatchId,
		staticPortalInteriorRecords: itemResults.flatMap(
			(result) => result.staticPortalInteriorRecords,
		),
		staticSourceMappings: itemResults.flatMap(
			(result) => result.staticSourceMappings,
		),
		staticSpatialRecords: itemResults.flatMap(
			(result) => result.staticSpatialRecords,
		),
		staticVisibilityRecords: itemResults.flatMap(
			(result) => result.staticVisibilityRecords,
		),
		textureUses: [],
		works: input.items.map((item) => item.work),
	};
}

function bakeLandblockEnvCellItem(item: StaticBakeBatchItem): {
	readonly staticAuthoredDynamicSeeds: readonly StaticAuthoredDynamicSeedRecord[];
	readonly staticPortalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly staticSourceMappings: readonly StaticSourceMappingRecord[];
	readonly staticSpatialRecords: readonly StaticSpatialRecord[];
	readonly staticVisibilityRecords: readonly StaticVisibilityRecord[];
} {
	if (
		item.work.job.domain !== "landblock-env-cells" ||
		item.payload.scope.kind !== "landblock-env-cells"
	) {
		throw new Error(
			`Landblock env-cell baker only supports landblock env-cell payloads. Received ${item.work.job.domain}/${item.payload.scope.kind}.`,
		);
	}

	const owner = createWorkPeerRecordOwner(item.work);
	const payload = item.payload.scope;

	return {
		staticAuthoredDynamicSeeds: createAuthoredDynamicSeedRecords(owner, payload),
		staticPortalInteriorRecords: [createPortalInteriorRecord(owner, payload)],
		staticSourceMappings: createSourceMappingRecords(owner, payload),
		staticSpatialRecords: createSpatialRecords(owner, payload),
		staticVisibilityRecords: [createVisibilityRecord(owner, payload)],
	};
}

function createSpatialRecords(
	owner: StaticWorkPeerRecordOwner,
	payload: LandblockEnvCellsStaticScopePayload,
): readonly StaticSpatialRecord[] {
	return payload.envCells.map((envCell) => ({
		cellStructure: envCell.cellStructure,
		envCellId: envCell.identity.envCellId,
		environment: envCell.environment,
		kind: "env-cell-spatial",
		landblockId: payload.landblock.landblockId,
		localBvhItemCount: envCell.localSpatial.localBvhItemCount,
		localBvhNodeCount: envCell.localSpatial.localBvhNodeCount,
		memberId: envCell.memberId,
		owner,
		renderBounds: envCell.renderGeometry.bounds,
		residencyBvhItemCount:
			payload.residencySpatial.landblockEnvCellBvhItemCount,
		residencyBvhNodeCount:
			payload.residencySpatial.landblockEnvCellBvhNodeCount,
	}));
}

function createVisibilityRecord(
	owner: StaticWorkPeerRecordOwner,
	payload: LandblockEnvCellsStaticScopePayload,
): StaticVisibilityRecord {
	return {
		acceptedEnvCellIds: payload.acceptedEnvCellIds,
		diagnostics: payload.visibilityDiagnostics,
		kind: "env-cell-visibility",
		landblockId: payload.landblock.landblockId,
		owner,
		visibleLinks: payload.envCells.flatMap((envCell) =>
			envCell.visibleEnvCellIds.map((targetEnvCellId) => ({
				sourceEnvCellId: envCell.identity.envCellId,
				targetEnvCellId,
			})),
		),
	};
}

function createPortalInteriorRecord(
	owner: StaticWorkPeerRecordOwner,
	payload: LandblockEnvCellsStaticScopePayload,
): StaticPortalInteriorRecord {
	return {
		envCells: payload.envCells.map((envCell) => ({
			envCellId: envCell.identity.envCellId,
			portalApertures: envCell.portalApertures,
			portals: envCell.portals,
		})),
		kind: "env-cell-portal-interior",
		landblockId: payload.landblock.landblockId,
		owner,
		portalLinks: payload.portalLinks,
	};
}

function createSourceMappingRecords(
	owner: StaticWorkPeerRecordOwner,
	payload: LandblockEnvCellsStaticScopePayload,
): readonly StaticSourceMappingRecord[] {
	return payload.envCells.map((envCell) => ({
		cellStructure: envCell.cellStructure,
		envCellId: envCell.identity.envCellId,
		environment: envCell.environment,
		kind: "env-cell-source",
		landblockId: payload.landblock.landblockId,
		memberId: envCell.memberId,
		owner,
		surfaces: envCell.surfaces,
	}));
}

function createAuthoredDynamicSeedRecords(
	owner: StaticWorkPeerRecordOwner,
	payload: LandblockEnvCellsStaticScopePayload,
): readonly StaticAuthoredDynamicSeedRecord[] {
	return payload.envCells.flatMap((envCell) =>
		envCell.staticObjectSeeds.map((seed) =>
			createAuthoredDynamicSeedRecord(owner, payload, envCell, seed),
		),
	);
}

function createAuthoredDynamicSeedRecord(
	owner: StaticWorkPeerRecordOwner,
	payload: LandblockEnvCellsStaticScopePayload,
	envCell: LandblockEnvCellStaticFacts,
	seed: LandblockEnvCellStaticFacts["staticObjectSeeds"][number],
): StaticAuthoredDynamicSeedRecord {
	return {
		envCellId: envCell.identity.envCellId,
		kind: "env-cell-static-object-seed",
		landblockId: payload.landblock.landblockId,
		owner,
		seed,
	};
}

function createWorkPeerRecordOwner(
	work: ScheduledStaticWork,
): StaticWorkPeerRecordOwner {
	return {
		domain: work.job.domain,
		kind: "work",
		scope: work.job.scope,
		scopeKey: describeStaticScopeKey(work.job.scope),
		workId: work.workId,
	};
}

function describeStaticScopeKey(scope: ScheduledStaticWork["job"]["scope"]): string {
	return `landblock:${formatHex32(scope.landblockId)}`;
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
