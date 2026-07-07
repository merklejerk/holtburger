import type {
	RuntimeDiagnosticsSnapshot,
	RuntimeOverviewSnapshot,
} from "../../../runtime/client-runtime";
import type { OpenWorldStreamingDiagnosticsSnapshot } from "../diagnostics/contracts";
import {
	createEmptyLegacyStaticDiagnosticsSnapshot,
	createEmptyLegacyStaticOverviewSnapshot,
} from "../testing/empty-runtime-snapshots";
import type { OpenWorldStreamingControllerSnapshot } from "./open-world-streaming-controller";

/** Deletion-targeted shim for the legacy ClientRuntime snapshot methods. */
export const CLIENT_RUNTIME_LEGACY_SHIM_DIAGNOSTIC: OpenWorldStreamingDiagnosticsSnapshot["compatibilityShims"][number] =
	{
		deletionTarget: "Phase 16 legacy pipeline deletion",
		kind: "compatibility-shim",
		owner: "browser-runtime-adapter",
		reason:
			"ClientRuntime still exposes legacy-shaped overview and diagnostics snapshot methods during browser cutover.",
	};

/** Projects replacement static progress into the legacy overview shape. */
export function createLegacyStaticOverviewFromController(
	controller: OpenWorldStreamingControllerSnapshot,
): RuntimeOverviewSnapshot["static"] {
	return {
		...createEmptyLegacyStaticOverviewSnapshot(),
		baking:
			controller.terrain.baking +
			controller.outdoorObjects.baking +
			controller.envCells.baking,
		committed:
			controller.terrain.committed +
			controller.outdoorObjects.committed +
			controller.envCells.committed,
		latestEnvCellSystemPayload: controller.envCells.latestEnvCellSystemPayload,
		latestTerrainPayload: controller.terrain.latestTerrainPayload,
		requested:
			controller.terrain.requested +
			controller.outdoorObjects.requested +
			controller.envCells.requested,
		resolving:
			controller.terrain.resolving +
			controller.outdoorObjects.resolving +
			controller.envCells.resolving,
	};
}

/** Projects replacement static progress into the legacy diagnostics snapshot shape. */
export function createLegacyStaticDiagnosticsFromController(
	controller: OpenWorldStreamingControllerSnapshot,
): RuntimeDiagnosticsSnapshot["static"] {
	return {
		...createEmptyLegacyStaticDiagnosticsSnapshot(),
		baking:
			controller.terrain.baking +
			controller.outdoorObjects.baking +
			controller.envCells.baking,
		committed:
			controller.terrain.committed +
			controller.outdoorObjects.committed +
			controller.envCells.committed,
		committedDrawUnits:
			controller.terrain.installedDrawUnits +
			controller.outdoorObjects.installedDrawUnits +
			controller.envCells.installedDrawUnits,
		failed:
			controller.terrain.failed +
			controller.outdoorObjects.failed +
			controller.envCells.failed,
		latestEnvCellSystemPayload: controller.envCells.latestEnvCellSystemPayload,
		latestTerrainPayload: controller.terrain.latestTerrainPayload,
		requested:
			controller.terrain.requested +
			controller.outdoorObjects.requested +
			controller.envCells.requested,
		resolving:
			controller.terrain.resolving +
			controller.outdoorObjects.resolving +
			controller.envCells.resolving,
	};
}
