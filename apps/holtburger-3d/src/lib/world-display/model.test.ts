import { describe, expect, it } from "vitest";

import {
	buildCameraHint,
	buildRayPickRequest,
	deriveTerrainViewport,
	deriveWorldDisplayModel,
	normalizeViewportPoint,
	shouldSendThrottledCameraHint,
} from "./model";
import {
	createInitialAssetChannelState,
	type PreparedLandblockStaticInstance,
} from "../assets/types";
import type { RuntimeBatchDto } from "../host/contracts";

function createRuntimeBatch(): RuntimeBatchDto {
	return {
		tick: 7,
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
	};
}

describe("world display model helpers", () => {
	it("derives a world-shell model from the runtime batch and browser destination", () => {
		const model = deriveWorldDisplayModel({
			activeModeLabel: "World Viewer",
			hostStatus: "Connected to the host.",
			runtimeBatch: createRuntimeBatch(),
			viewModelFeed: {
				selectedEntityId: null,
				interactionMode: "inspect",
				busyState: "idle",
			},
			assetState: {
				...createInitialAssetChannelState(),
				status: "ready",
				activeRequest: {
					requestId: "fixture",
					assetId: "gfx/02000001",
					priority: "bootstrap",
				},
				preparedAsset: {
					request: {
						requestId: "fixture",
						assetId: "terrain/0102ffff",
						priority: "bootstrap",
					},
					response: {
						requestId: "fixture",
						assetId: "terrain/0102ffff",
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
							vertices: Array.from({ length: 81 }, (_, index) => ({
								x: (index % 9) * 24,
								y: Math.floor(index / 9) * 24,
								z: index % 12,
							})),
							triangles: Array.from({ length: 128 }, (_, index) => ({
								a: index % 40,
								b: (index % 40) + 1,
								c: (index % 40) + 9,
								terrainType: index % 6,
								averageHeight: (index % 10) + 2,
							})),
							minHeight: 0,
							maxHeight: 11,
						},
					},
					preparedAt: "2026-04-26T00:00:00.000Z",
				},
				lastResponse: {
					requestId: "fixture",
					assetId: "terrain/0102ffff",
					payloadKind: "json",
					payload: { kind: "terrain-landblock", landblockId: 0x0102ffff },
				},
				errorMessage: null,
			},
			browserDestination: {
				kind: "outdoor-location",
				label: "100.55S, 101.65W, 2.0Z",
				northSouth: 100.55,
				northSouthHemisphere: "S",
				eastWest: 101.65,
				eastWestHemisphere: "W",
				elevation: 2,
				source: "manual",
				landblockId: null,
			},
			terrainLodRadius: 1,
			buildingLodRadius: 1,
			detailLodRadius: 1,
			cameraAck: null,
			rayPickResponse: null,
			pendingCameraHint: false,
		});

		expect(model.headline).toMatch(/manual destination/i);
		expect(model.destinationLabel).toBe("100.55S, 101.65W, 2.0Z");
		expect(model.entities).toHaveLength(0);
		expect(model.sceneContext.kind).toBe("outdoor-landblock-ring");
		expect(model.sceneContext.chunks).toHaveLength(6);
		expect(model.sceneContext.focusAnchorLabel).toBe("0x0001ffff");
		expect(model.terrainContract.requestKey).toBe("terrain/0001ffff");
		expect(model.terrainContract.decodeOwner).toBe("rust-host-adapter");
		expect(model.renderCacheText).toMatch(/authoritative residency/);
		expect(model.assetText).toMatch(/Prepared terrain\/0102ffff/);
	});

	it("tracks pack-backed outdoor scenery membership separately from terrain chunks", () => {
		const runtimeBatch = createRuntimeBatch();
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"landblock-pack/0102ffff": {
				request: {
					requestId: "statics",
					assetId: "landblock-pack/0102ffff",
					priority: "streaming",
				},
				response: {
					requestId: "statics",
					assetId: "landblock-pack/0102ffff",
					payloadKind: "json",
					payload: {},
				},
				payload: {
					kind: "landblock-pack",
					sourceAssetKind: "landblock-pack",
					residencyKind: "landblock",
					landblockId: 0x0102ffff,
					landblockInfoId: 0x0102fffe,
					classification: "outdoor",
					sourceFacts: {
						cellLandblock: null,
						landblockInfo: null,
						outdoor: {
							explicitObjects: [],
							buildings: [],
							generatedScenery: [],
						},
						interiors: { envCells: [], environments: [] },
					},
					prepared: {
						terrainMesh: null,
						outdoorStaticInstances: [
							createPackStaticInstance(
								"pack/object/0",
								"scenery",
								"setup-model/02000001",
							),
							createPackStaticInstance(
								"pack/building/0",
								"building",
								"setup-model/02000002",
							),
						],
						interiorCells: [],
						staticMeshes: [],
						spatialItems: [],
						staticLandblockBvh: null,
					},
					dependencies: {
						cellDatIds: [],
						portalDatIds: [],
						renderableAssetIds: [
							"setup-model/02000001",
							"setup-model/02000002",
						],
					},
					diagnostics: { sourceRecords: [], errors: [] },
					provenance: {
						source: "repo-local-hba",
						sourceAssetKind: "landblock-pack",
						errorCode: null,
						detail: "test",
					},
				},
				preparedAt: "2026-05-12T00:00:00.000Z",
			},
		};

		const model = deriveWorldDisplayModel({
			activeModeLabel: "World Viewer",
			hostStatus: "ready",
			runtimeBatch,
			viewModelFeed: null,
			assetState,
			browserDestination: null,
			terrainLodRadius: 1,
			buildingLodRadius: 1,
			detailLodRadius: 1,
			cameraAck: null,
			rayPickResponse: null,
			pendingCameraHint: false,
		});

		expect(model.sceneContext.staticRenderableInstanceCount).toBe(1);
		expect(model.sceneContext.staticRenderableBuildingCount).toBe(1);
		expect(model.sceneContext.staticRenderableSourceAssetIds).toEqual([
			"setup-model/02000001",
			"setup-model/02000002",
		]);
	});

	it("projects a prepared terrain mesh into viewport polygons", () => {
		const viewport = deriveTerrainViewport({
			request: {
				requestId: "fixture",
				assetId: "terrain/0102ffff",
				priority: "bootstrap",
			},
			response: {
				requestId: "fixture",
				assetId: "terrain/0102ffff",
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
					vertices: Array.from({ length: 81 }, (_, index) => ({
						x: (index % 9) * 24,
						y: Math.floor(index / 9) * 24,
						z: (index % 9) + Math.floor(index / 9),
					})),
					triangles: [
						{ a: 0, b: 9, c: 1, terrainType: 1, averageHeight: 4 },
						{ a: 1, b: 9, c: 10, terrainType: 2, averageHeight: 5 },
					],
					minHeight: 0,
					maxHeight: 12,
				},
			},
			preparedAt: "2026-04-26T00:00:00.000Z",
		});

		expect(viewport.ready).toBe(true);
		expect(viewport.landblockLabel).toBe("0x0102ffff");
		expect(viewport.polygons).toHaveLength(2);
		expect(viewport.polygons[0].points).toMatch(/,/);
	});

	it("builds an explicit indoor env-cell scene context when runtime residency is indoors", () => {
		const runtimeBatch = createRuntimeBatch();
		runtimeBatch.residency.indoors = true;
		runtimeBatch.residency.focusLandblockId = 0x016c0155;
		runtimeBatch.residency.focusCellId = null;
		runtimeBatch.residency.focusEnvCellId = 0x016c0155;
		runtimeBatch.residency.visibleCellIds = [0x016c0156, 0x016c0157];
		runtimeBatch.residency.seenOutside = false;
		runtimeBatch.residency.environmentId = 0x0d000001;
		runtimeBatch.residency.cellStructureId = 1;

		const model = deriveWorldDisplayModel({
			activeModeLabel: "World Viewer",
			hostStatus: "Connected to the host.",
			runtimeBatch,
			viewModelFeed: null,
			assetState: {
				...createInitialAssetChannelState(),
				preparedByAssetId: {
					"indoor-env-cell/016c0155": {
						request: {
							requestId: "fixture-indoor",
							assetId: "indoor-env-cell/016c0155",
							priority: "bootstrap",
						},
						response: {
							requestId: "fixture-indoor",
							assetId: "indoor-env-cell/016c0155",
							payloadKind: "json",
							payload: { kind: "indoor-env-cell", envCellId: 0x016c0155 },
						},
						payload: {
							kind: "indoor-env-cell",
							sourceAssetKind: "env-cell",
							residencyKind: "indoor-env-cell",
							provenance: {
								source: "repo-local-hba",
								sourceAssetKind: "env-cell",
								errorCode: null,
								detail: "dats/assets.hba",
							},
							debugPresentation: {
								primitive: "indoor-env-cell-metadata",
								paletteKey: "env-cell-016c0155",
							},
							envCellId: 0x016c0155,
							environmentId: 0x0d000001,
							cellStructureId: 1,
							localPlacement: {
								origin: { x: 0, y: 0, z: 0 },
								orientation: { w: 1, x: 0, y: 0, z: 0 },
							},
							visibleCellIds: [0x016c0156, 0x016c0157],
							landblockEnvCellIds: [],
							seenOutside: false,
							surfaceIds: [],
							portalCount: 0,
							portals: [],
							staticObjectCount: 0,
							staticObjects: [],
						},
						preparedAt: "2026-04-28T00:00:00.000Z",
					},
				},
			},
			browserDestination: null,
			terrainLodRadius: 1,
			buildingLodRadius: 1,
			detailLodRadius: 1,
			cameraAck: null,
			rayPickResponse: null,
			pendingCameraHint: false,
		});

		expect(model.sceneContext.kind).toBe("indoor-visible-cell-set");
		expect(model.sceneContext.chunks).toHaveLength(0);
		expect(model.sceneContext.focusAnchorLabel).toBe("0x016c0155");
		expect(model.sceneContext.coverageText).toMatch(/visible cell/i);
		expect(model.sceneContext.gapText).toBeNull();
		expect(model.terrainContract.requestKey).toBeNull();
	});

	it("builds camera hints and pick requests from viewport input", () => {
		const cameraHint = buildCameraHint(
			"client",
			createRuntimeBatch(),
			null,
			normalizeViewportPoint(180, 60, 240, 120),
		);

		expect(cameraHint).not.toBeNull();
		expect(cameraHint?.mode).toBe("client");
		expect(cameraHint?.viewportNormalizedX).toBeCloseTo(0.75);
		expect(cameraHint?.destinationLabel).toBe("100.40S, 101.55W, 1.0Z");

		const request = buildRayPickRequest(cameraHint!, "pick-1");

		expect(request.requestId).toBe("pick-1");
		expect(request.origin).toEqual(cameraHint?.position);
		expect(request.direction).toEqual(cameraHint?.forward);
	});

	it("throttles camera hints on a fixed minimum interval", () => {
		expect(shouldSendThrottledCameraHint(null, 1000)).toBe(true);
		expect(shouldSendThrottledCameraHint(1000, 1120)).toBe(false);
		expect(shouldSendThrottledCameraHint(1000, 1250)).toBe(true);
	});
});

function createPackStaticInstance(
	instanceId: string,
	kind: "scenery" | "building",
	sourceAssetId: string,
): PreparedLandblockStaticInstance {
	return {
		instanceId,
		kind,
		owningLandblockId: 0x0102ffff,
		owningEnvCellId: null,
		sourceDid: Number.parseInt(sourceAssetId.slice(-8), 16),
		sourceAssetId,
		sourceIndex: 0,
		localPlacement: {
			origin: { x: 0, y: 0, z: 0 },
			orientation: { w: 1, x: 0, y: 0, z: 0 },
		},
		sourceScale: { x: 1, y: 1, z: 1 },
	};
}
