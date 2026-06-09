export interface PreparedAssetPruneDiagnosticsSample {
	source: string;
	durationMs: number;
	evaluatedAssetCount: number;
	evictedAssetCount: number;
	retainedAssetCount: number;
	completedAtMs: number;
}

export interface PreparedAssetRendererSyncDiagnosticsSample {
	source: string;
	recommittedProductCount: number;
	scheduledFrame: boolean;
	completedAtMs: number;
}

export interface PreparedAssetHotPathDiagnosticsSnapshot {
	pruneCallCount: number;
	latestPrune: PreparedAssetPruneDiagnosticsSample | null;
	rendererAssetSyncCallCount: number;
	latestRendererAssetSync: PreparedAssetRendererSyncDiagnosticsSample | null;
}

interface PreparedAssetHotPathDiagnosticsState {
	pruneCallCount: number;
	latestPrune: PreparedAssetPruneDiagnosticsSample | null;
	rendererAssetSyncCallCount: number;
	latestRendererAssetSync: PreparedAssetRendererSyncDiagnosticsSample | null;
}

const state: PreparedAssetHotPathDiagnosticsState = {
	pruneCallCount: 0,
	latestPrune: null,
	rendererAssetSyncCallCount: 0,
	latestRendererAssetSync: null,
};

export function recordPreparedAssetPruneDiagnostics(
	sample: PreparedAssetPruneDiagnosticsSample,
): void {
	state.pruneCallCount += 1;
	state.latestPrune = sample;
}

export function recordPreparedAssetRendererSyncDiagnostics(
	sample: PreparedAssetRendererSyncDiagnosticsSample,
): void {
	state.rendererAssetSyncCallCount += 1;
	state.latestRendererAssetSync = sample;
}

export function getPreparedAssetHotPathDiagnosticsSnapshot(): PreparedAssetHotPathDiagnosticsSnapshot {
	return {
		pruneCallCount: state.pruneCallCount,
		latestPrune: state.latestPrune ? { ...state.latestPrune } : null,
		rendererAssetSyncCallCount: state.rendererAssetSyncCallCount,
		latestRendererAssetSync: state.latestRendererAssetSync
			? { ...state.latestRendererAssetSync }
			: null,
	};
}
