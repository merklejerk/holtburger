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

function createEmptyLegacyStaticBakerDiagnosticsSnapshot(): RuntimeDiagnosticsSnapshot["static"]["staticBakerDiagnostics"] {
	return {
		kind: "static-baker",
		pendingJobs: [],
		workerCount: null,
	};
}
