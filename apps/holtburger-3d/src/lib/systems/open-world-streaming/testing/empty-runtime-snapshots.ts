import type {
	RuntimeDiagnosticsSnapshot,
	RuntimeOverviewSnapshot,
} from "../../../runtime/client-runtime";

export function createEmptyLegacyDynamicRuntimeSnapshot(): RuntimeDiagnosticsSnapshot["dynamic"] {
	return {
		activeEntityCount: 0,
		nonRenderableEntityCount: 0,
		records: [],
		runtimeSpawnCount: 0,
		staticAuthoredCount: 0,
	};
}

export function createEmptyLegacyStaticOverviewSnapshot(): RuntimeOverviewSnapshot["static"] {
	return {
		baking: 0,
		committed: 0,
		latestEnvCellSystemPayload: null,
		latestTerrainPayload: null,
		requested: 0,
		resolving: 0,
		revision: 0,
	};
}

export function createEmptyLegacyStaticDiagnosticsSnapshot(): RuntimeDiagnosticsSnapshot["static"] {
	return {
		baking: 0,
		committed: 0,
		committedDrawUnits: 0,
		failed: 0,
		latestEnvCellSystemPayload: null,
		latestOutdoorStaticObjectsPayload: null,
		latestTerrainPayload: null,
		layerTasks: [],
		materialCoverage: [],
		ownerStates: [],
		recentTiming: [],
		requested: 0,
		resolving: 0,
		revision: 0,
		sourceResolutionDiagnostics: [],
		staticBakerDiagnostics: createEmptyLegacyStaticBakerDiagnosticsSnapshot(),
		staticObjectBakeDiagnostics: [],
	};
}

export function createEmptyLegacyStaticSceneQueryOverviewSnapshot(): RuntimeOverviewSnapshot["staticSceneQuery"] {
	return {
		envCellLandblockCount: 0,
		envCellRecordCount: 0,
		outdoorRecordCount: 0,
	};
}

export function createEmptyLegacyStaticSceneQueryDiagnosticsSnapshot(): RuntimeDiagnosticsSnapshot["staticSceneQuery"] {
	return {
		committedEnvCellLandblockCount: 0,
		committedEnvCellPortalGraphRecordCount: 0,
		committedEnvCellPortalInteriorRecordCount: 0,
		committedEnvCellSourceMappingRecordCount: 0,
		committedEnvCellSpatialRecordCount: 0,
		committedEnvCellVisibilityRecordCount: 0,
		envCellLandblockCount: 0,
		envCellRecordCount: 0,
		envCellResidencyBspAcceptedCandidateCount: 0,
		envCellResidencyBspFallbackCount: 0,
		envCellResidencyBspTestedCandidateCount: 0,
		envCellResidencyCoarseCandidateCount: 0,
		landblockBucketCount: 0,
		outdoorRecordCount: 0,
		terrainLandblockCount: 0,
		terrainRecordCount: 0,
	};
}

function createEmptyLegacyStaticBakerDiagnosticsSnapshot(): RuntimeDiagnosticsSnapshot["static"]["staticBakerDiagnostics"] {
	return {
		kind: "static-baker",
		pendingJobs: [],
		workerCount: null,
	};
}
