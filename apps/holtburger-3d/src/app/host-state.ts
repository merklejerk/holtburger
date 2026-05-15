import type {
	HostBoundarySnapshot,
	RuntimeNotificationEnvelopeDto,
} from "../lib/host/contracts";

export interface HostConnectionState {
	boundarySnapshot: HostBoundarySnapshot | null;
	latestRuntimeNotification: RuntimeNotificationEnvelopeDto | null;
	boundaryStatus: string;
}

const DEFAULT_BOUNDARY_STATUS = "Loading host boundary...";

export function createHostConnectionState(): HostConnectionState {
	return {
		boundarySnapshot: null,
		latestRuntimeNotification: null,
		boundaryStatus: DEFAULT_BOUNDARY_STATUS,
	};
}

export function applyLoadedSnapshot(
	hostState: HostConnectionState,
	snapshot: HostBoundarySnapshot,
): HostConnectionState {
	return {
		boundarySnapshot: snapshot,
		latestRuntimeNotification: hostState.latestRuntimeNotification,
		boundaryStatus:
			snapshot.source === "tauri"
				? "Connected to the Tauri host boundary with a live authoritative runtime feed."
				: "Tauri runtime is unavailable. Start the app with npm run tauri:dev.",
	};
}

export function applyRuntimeNotification(
	hostState: HostConnectionState,
	notification: RuntimeNotificationEnvelopeDto,
): HostConnectionState {
	if (!hostState.boundarySnapshot) {
		return {
			...hostState,
			latestRuntimeNotification: notification,
		};
	}

	return {
		...hostState,
		boundarySnapshot: mergeHostBoundarySnapshot(
			hostState.boundarySnapshot,
			notification,
		),
		latestRuntimeNotification: notification,
	};
}

function mergeHostBoundarySnapshot(
	boundarySnapshot: HostBoundarySnapshot,
	notification: RuntimeNotificationEnvelopeDto,
): HostBoundarySnapshot {
	return {
		...boundarySnapshot,
		lifecycleState:
			notification.lifecycleState ?? boundarySnapshot.lifecycleState,
		runtimeBatch: notification.runtimeBatch ?? boundarySnapshot.runtimeBatch,
		viewModelFeed: notification.viewModelFeed ?? boundarySnapshot.viewModelFeed,
	};
}
