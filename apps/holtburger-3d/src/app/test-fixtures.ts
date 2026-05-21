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
				assetFamilyIds: ["landblock-pack"],
			},
		},
	};
}

export function createPreparedTerrainAsset(
	requestId: string,
	assetId: string,
): PreparedAssetRecord {
	const landblockId = parseLandblockPackAssetId(assetId) ?? 0x0102ffff;

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
			payload: { kind: "landblock-pack", landblockId },
		},
		payload: {
			kind: "landblock-pack",
			sourceAssetKind: "landblock-pack",
			residencyKind: "landblock",
			provenance: {
				source: "unknown",
				sourceAssetKind: "landblock-pack",
				errorCode: null,
				detail: null,
			},
			landblockId,
			landblockInfoId: landblockId & 0xffff_fffe,
			classification: "outdoor",
			sourceFacts: {
				buildings: [],
			},
			prepared: {
				terrainMesh: {
					landblockId,
					gridSize: 9,
					tileSize: 24,
					vertices: [],
					triangles: [],
					minHeight: 0,
					maxHeight: 24,
				},
				outdoorStaticInstances: [],
				interiorCells: [],
				staticMeshes: [],
				spatialItems: [],
				staticLandblockBvh: null,
			},
			dependencies: {
				cellDatIds: [],
				portalDatIds: [],
				renderableAssetIds: [],
			},
			diagnostics: {
				sourceRecords: [],
				errors: [],
			},
		},
		preparedAt: "2026-04-26T00:00:00.000Z",
	};
}

function parseLandblockPackAssetId(assetId: string): number | null {
	const match = /^landblock-pack\/([0-9a-fA-F]{8})$/.exec(assetId);
	if (!match) {
		return null;
	}
	return Number.parseInt(match[1], 16);
}
