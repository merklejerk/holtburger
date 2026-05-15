import type {
	FrontendStateFeedDto,
	HostBoundarySnapshot,
	RuntimeBatchDto,
} from "../lib/host/contracts";
import type { PreparedAssetRecord } from "../lib/assets/types";

export function createRuntimeBatch(
	overrides: Partial<RuntimeBatchDto> = {},
): RuntimeBatchDto {
	return {
		tick: 1,
		entities: [],
		residency: {
			focusEntityId: null,
			focusLandblockId: 0x01020003,
			focusCellId: 3,
			focusEnvCellId: null,
			visibleCellIds: [],
			seenOutside: null,
			environmentId: null,
			cellStructureId: null,
			focusLocationLabel: "100.40S, 101.55W, 1.0Z",
			indoors: false,
			trackedBodyCount: 0,
		},
		...overrides,
	};
}

export function createViewModelFeed(
	overrides: Partial<FrontendStateFeedDto> = {},
): FrontendStateFeedDto {
	return {
		selectedEntityId: null,
		interactionMode: "inspect",
		busyState: "idle",
		...overrides,
	};
}

export function createHostSnapshot(): HostBoundarySnapshot {
	return {
		source: "tauri",
		lifecycleState: {
			phase: "ready",
			activeModeHint: "client",
			sessionState: "disconnected",
		},
		runtimeBatch: createRuntimeBatch(),
		viewModelFeed: createViewModelFeed(),
		overview: {
			assetChannel: "asset",
			runtimeChannel: "runtime",
			runtimeNotificationEvent: "runtime:notification",
			runtimeLifecycleTopic: "lifecycle.state",
			runtimeBatchCommand: "get_runtime_batch",
			assetLookupCommand: "lookup_asset",
			indoorContractBacklog: {
				runtimeFieldIds: [
					"focus-env-cell-id",
					"visible-cell-ids",
					"seen-outside",
					"environment-id",
					"cell-structure-id",
				],
				assetFamilyIds: ["indoor-env-cell", "environment"],
			},
		},
	};
}

export function createPreparedTerrainAsset(
	requestId: string,
	assetId: string,
): PreparedAssetRecord {
	return {
		request: {
			requestId,
			assetId,
			priority: "bootstrap",
		},
		response: {
			requestId,
			assetId,
			payloadKind: "json",
			payload: { kind: "terrain-landblock", landblockId: 0x0102ffff },
		},
		payload: {
			kind: "terrain-landblock",
			sourceAssetKind: "cell-landblock",
			residencyKind: "outdoor-landblock",
			provenance: {
				source: "unknown",
				sourceAssetKind: "cell-landblock",
				errorCode: null,
				detail: null,
			},
			debugPresentation: {
				primitive: "terrain-landblock-mesh",
				paletteKey: "terrain-0102ffff",
			},
			terrainMesh: {
				landblockId: 0x0102ffff,
				gridSize: 9,
				tileSize: 24,
				vertices: [],
				triangles: [],
				minHeight: 0,
				maxHeight: 24,
			},
		},
		preparedAt: "2026-04-26T00:00:00.000Z",
	};
}
