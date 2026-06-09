import { describe, expect, it } from "vitest";

import type { BrowserLocationSelection } from "../../app/browser-mode";
import {
	createInitialAssetChannelState,
	type AssetChannelState,
	type PreparedEnvCellPayload,
	type PreparedAssetProvenance,
	type PreparedAssetRecord,
	type PreparedLandblockOutdoorPayload,
	type PreparedPolygonSetRenderGeometry,
} from "../assets/types";
import {
	PreparedAssetStore,
	createPreparedAssetResolverFromRecordSnapshot,
} from "../assets/prepared-asset-store";
import {
	formatEnvCellAssetId,
	formatLandblockOutdoorAssetId,
} from "../landblocks";
import {
	BrowserRenderResourceCoordinator,
	type BrowserRenderResourceCoordinatorInput,
	type BrowserRenderResourceSurface,
} from "./browser-render-resource-coordinator";

describe("browser render resource coordinator", () => {
	it("does not commit prepared outdoor assets as static products", () => {
		const landblockId = 0x02030000;
		const surface = createCapturingSurface();
		const coordinator = new BrowserRenderResourceCoordinator();
		coordinator.setSurface(surface);

		coordinator.update(
			createCoordinatorInput({
				records: [
					createLandblockOutdoorRecord({
						landblockId,
						sourceDid: 0x01000001,
						localPlacement: createPlacement({ x: 1, y: 2, z: 3 }),
					}),
					createGfxObjRecord(0x01000001),
				],
				browserDestination: createOutdoorDestination(landblockId),
			}),
		);

		expect(surface.committedStaticProductCount).toBe(0);
	});

	it("does not commit prepared indoor assets as static products", () => {
		const envCellId = 0x02030100;
		const surface = createCapturingSurface();
		const coordinator = new BrowserRenderResourceCoordinator();
		coordinator.setSurface(surface);

		coordinator.update(
			createCoordinatorInput({
				records: [
					createEnvCellRecord({
						envCellId,
						sourceDid: 0x01000001,
						localPlacement: createPlacement({ x: 0, y: 0, z: 0 }),
						staticPlacement: createPlacement({ x: 1, y: 2, z: 3 }),
					}),
					createGfxObjRecord(0x01000001),
				],
				browserDestination: createInteriorDestination(envCellId),
			}),
		);

		expect(surface.committedStaticProductCount).toBe(0);
	});

	it("does not push renderer asset state for cache metadata-only resolver changes", () => {
		const landblockId = 0x02030000;
		const surface = createCapturingSurface();
		const coordinator = new BrowserRenderResourceCoordinator();
		const store = new PreparedAssetStore();
		coordinator.setSurface(surface);
		store.applyPreparedAssets(
			[
				createLandblockOutdoorRecord({
					landblockId,
					sourceDid: 0x01000001,
					localPlacement: createPlacement({ x: 0, y: 0, z: 0 }),
				}),
			],
			1_000,
		);

		coordinator.update(
			createCoordinatorInput({
				preparedAssetResolver: store.resolver,
				browserDestination: createOutdoorDestination(landblockId),
			}),
		);

		expect(surface.setAssetStateCount).toBe(0);

		store.applyPrunePlan({
			retainedAssetIds: [formatLandblockOutdoorAssetId(landblockId)],
			evictedAssetIds: [],
			cacheMetadataByAssetId: {
				[formatLandblockOutdoorAssetId(landblockId)]: {
					lastPreparedAtMs: 1_000,
					lastRetainedAtMs: 2_000,
				},
			},
			diagnostics: {
				prepared: { total: 1, byKind: { "landblock-outdoor": 1 } },
				hardRetained: { total: 1, byKind: { "landblock-outdoor": 1 } },
				warmRetained: { total: 0, byKind: {} },
				retained: { total: 1, byKind: { "landblock-outdoor": 1 } },
				evicted: { total: 0, byKind: {} },
			},
			nextWarmPruneAtMs: null,
		});

		coordinator.update(
			createCoordinatorInput({
				preparedAssetResolver: store.resolver,
				browserDestination: createOutdoorDestination(landblockId),
			}),
		);

		expect(surface.setAssetStateCount).toBe(0);
	});
});

const PROVENANCE: PreparedAssetProvenance = {
	source: "repo-local-hba",
	sourceAssetKind: null,
	errorCode: null,
	detail: null,
};

function createCapturingSurface(): BrowserRenderResourceSurface & {
	committedStaticProductCount: number;
	setAssetStateCount: number;
} {
	return {
		committedStaticProductCount: 0,
		setAssetStateCount: 0,
		setRenderSceneContext() {},
		setRenderChunkTransforms() {},
		commitStaticLandblockProduct() {
			this.committedStaticProductCount += 1;
		},
		evictStaticLandblockProduct() {},
		clearStaticLandblockProducts() {},
		setDebugOverlayScene() {},
		setRenderSpatialQuery() {},
		setSelectedStaticRenderableRenderKey() {},
		setControlledCameraFrame() {},
		setTransitionPortalMaxDepth() {},
		setRenderStyle() {},
		setTextureFilteringMode() {},
		setDetailTexturesEnabled() {},
	};
}

function createCoordinatorInput(
	overrides: Partial<BrowserRenderResourceCoordinatorInput> &
		Pick<BrowserRenderResourceCoordinatorInput, "browserDestination"> & {
			records?: PreparedAssetRecord[];
		},
): BrowserRenderResourceCoordinatorInput {
	const assetPresentationState = createInitialAssetChannelState();
	const preparedAssetResolver =
		overrides.preparedAssetResolver ??
		createResolver(overrides.records ?? []);
	return {
		assetPresentationState,
		preparedAssetResolver,
		browserDestination: overrides.browserDestination,
		terrainLodRadius: 0,
		buildingLodRadius: 0,
		detailLodRadius: 0,
		envCellLodRadius: 0,
		transitionPortalMaxDepth: 0,
		renderStyle: "solid",
		textureFilteringMode: "nearest",
		detailTexturesEnabled: true,
		showPortalPolygons: false,
		showCellIndicators: false,
		highlightPortalTargets: false,
		diagnosticSelection: null,
		selectedStaticRenderableRenderKey: null,
		activeRenderAnchor: null,
		browserCameraFrame: null,
		...overrides,
	};
}

function createAssetState(records: PreparedAssetRecord[]): AssetChannelState {
	const state = createInitialAssetChannelState();
	state.preparedByAssetId = Object.fromEntries(
		records.map((record) => [record.request.assetId, record]),
	);
	return state;
}

function createResolver(records: PreparedAssetRecord[]) {
	const state = createAssetState(records);
	return createPreparedAssetResolverFromRecordSnapshot({
		preparedByAssetId: state.preparedByAssetId,
	});
}

function createOutdoorDestination(
	landblockId: number,
): BrowserLocationSelection {
	return {
		kind: "outdoor-location",
		label: "24.00N, 36.00E, 0.0Z",
		source: "manual",
		northSouth: 24,
		northSouthHemisphere: "N",
		eastWest: 36,
		eastWestHemisphere: "E",
		elevation: 0,
		landblockId,
	};
}

function createInteriorDestination(envCellId: number): BrowserLocationSelection {
	return {
		kind: "interior-cell",
		label: `Env cell 0x${envCellId.toString(16).padStart(8, "0")}`,
		source: "manual",
		envCellId,
		landblockId: (envCellId & 0xffff0000) | 0xffff,
	};
}

function createLandblockOutdoorRecord(options: {
	landblockId: number;
	sourceDid: number;
	localPlacement: PreparedLandblockOutdoorPayload["statics"][number]["localPlacement"];
}): PreparedAssetRecord {
	const assetId = formatLandblockOutdoorAssetId(options.landblockId);
	return {
		request: { requestId: assetId, assetId, priority: "bootstrap" },
		response: {
			requestId: assetId,
			assetId,
			payloadKind: "json",
			payload: null,
		},
		preparedAt: "test",
		payload: {
			kind: "landblock-outdoor",
			sourceAssetKind: "landblock-outdoor",
			residencyKind: "outdoor-landblock",
			provenance: PROVENANCE,
			landblockId: options.landblockId,
			regionId: 0,
			regionNumber: 0,
			classification: "outdoor",
			terrain: {
				gridSize: 0,
				tileSize: 24,
				vertices: [],
				triangles: [],
				quads: [],
				terrainBvh: {
					coordinateSpace: "landblock-render-local",
					nodes: [],
					items: [],
				},
				minHeight: 0,
				maxHeight: 0,
				bounds: null,
			},
			statics: [
				{
					kind: "explicit-object",
					instanceId: "outdoor-static",
					sourceDid: options.sourceDid,
					sourceAssetId: formatGfxObjAssetId(options.sourceDid),
					sourceIndex: 0,
					localPlacement: options.localPlacement,
					sourceScale: { x: 1, y: 1, z: 1 },
					sourceBounds: null,
					instanceBounds: null,
					building: null,
					generated: null,
				},
			],
			outdoorBvh: null,
			diagnostics: {
				sourceRecords: [],
				omissions: [],
				errors: [],
			},
		},
	};
}

function createGfxObjRecord(gfxObjId: number): PreparedAssetRecord {
	const assetId = formatGfxObjAssetId(gfxObjId);
	return {
		request: { requestId: assetId, assetId, priority: "bootstrap" },
		response: {
			requestId: assetId,
			assetId,
			payloadKind: "json",
			payload: null,
		},
		preparedAt: "test",
		payload: {
			kind: "gfx-obj",
			sourceAssetKind: "gfx-obj",
			residencyKind: "unknown",
			provenance: PROVENANCE,
			gfxObjId,
			flags: null,
			surfaceIds: [],
			vertexArray: { vertexType: null, vertexCount: 0, vertices: [] },
			drawingPolygons: [],
			drawingBsp: null,
			physicsWitness: { polygonCount: 0, hasBsp: false },
			renderGeometry: createEmptyRenderGeometry(),
			sortCenter: null,
			didDegrade: null,
		},
	};
}

function createEnvCellRecord(options: {
	envCellId: number;
	sourceDid: number;
	localPlacement: PreparedEnvCellPayload["localPlacement"];
	staticPlacement: PreparedEnvCellPayload["localPlacement"];
}): PreparedAssetRecord {
	const assetId = formatEnvCellAssetId(options.envCellId);
	return {
		request: { requestId: assetId, assetId, priority: "bootstrap" },
		response: {
			requestId: assetId,
			assetId,
			payloadKind: "json",
			payload: null,
		},
		preparedAt: "test",
		payload: {
			kind: "env-cell",
			sourceAssetKind: "env-cell",
			residencyKind: "interior-cell",
			provenance: PROVENANCE,
			envCellId: options.envCellId,
			environmentId: 0x0d000001,
			cellStructureId: 0x0001,
			localPlacement: options.localPlacement,
			surfaces: [],
			portals: [],
			visibleEnvCellIds: [],
			portalApertures: [],
			statics: [
				{
					instanceId: "indoor-static",
					sourceDid: options.sourceDid,
					sourceAssetId: formatGfxObjAssetId(options.sourceDid),
					sourceIndex: 0,
					localPlacement: options.staticPlacement,
					sourceScale: { x: 1, y: 1, z: 1 },
					sourceBounds: null,
					instanceBounds: null,
				},
			],
			renderGeometry: createEmptyRenderGeometry(),
			cellBsp: null,
			localBvh: {
				coordinateSpace: "env-cell-local",
				nodes: [],
				items: [],
			},
		},
	};
}

function createEmptyRenderGeometry(): PreparedPolygonSetRenderGeometry {
	return {
		sourceId: 0,
		vertexCount: 0,
		triangleCount: 0,
		positions: new Float32Array(),
		normals: new Float32Array(),
		uvs: new Float32Array(),
		triangles: [],
		surfaceIds: [],
		invalidPolygons: [],
		skippedPolygonCount: 0,
		bounds: null,
	};
}

function createPlacement(origin: { x: number; y: number; z: number }) {
	return {
		origin,
		orientation: { w: 1, x: 0, y: 0, z: 0 },
	};
}

function formatGfxObjAssetId(gfxObjId: number): string {
	return `gfx-obj/${gfxObjId.toString(16).padStart(8, "0")}`;
}
