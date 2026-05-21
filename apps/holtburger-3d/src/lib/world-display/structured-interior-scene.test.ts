import { describe, expect, it } from "vitest";

import {
	createInitialAssetChannelState,
	type PreparedAssetRecord,
	type PreparedPolygonSetBspNode,
	type PreparedPolygonSetRenderGeometry,
} from "../assets/types";
import type { PlacementTransformDto, RuntimeBatchDto } from "../host/contracts";
import { deriveStructuredInteriorSceneModel } from "./structured-interior-scene";

const IDENTITY_PLACEMENT: PlacementTransformDto = {
	origin: { x: 0, y: 0, z: 0 },
	orientation: { w: 1, x: 0, y: 0, z: 0 },
};

describe("structured interior scene model", () => {
	it("joins visible interior metadata to prepared pack cell structures", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"landblock-pack/016cffff": createPreparedLandblockPackAsset(0x016cffff, [
				createPackInteriorCell(0x016c0155, 1, {
					origin: { x: 10, y: 20, z: 30 },
					orientation: IDENTITY_PLACEMENT.orientation,
				}),
				createPackInteriorCell(0x016c0156, 2, IDENTITY_PLACEMENT),
			]),
		};

		const model = deriveStructuredInteriorSceneModel(
			createIndoorRuntimeBatch(),
			assetState,
		);

		expect(model.focusEnvCellId).toBe(0x016c0155);
		expect(model.activeEnvCellIds).toEqual([0x016c0155, 0x016c0156]);
		expect(model.cells.map((cell) => cell.envCellId)).toEqual([
			0x016c0155, 0x016c0156,
		]);
		expect(model.cells[0]).toMatchObject({
			envCellId: 0x016c0155,
			renderChunk: {
				chunkKey: "landblock/016cffff",
				chunkLandblockId: 0x016cffff,
			},
			environmentId: 0x0d000001,
			cellStructureId: 1,
			isFocus: true,
			chunkLocalPlacement: { origin: { x: 10, y: 20, z: 30 } },
			portalCount: 1,
			staticObjectCount: 0,
		});
		expect(model.cells[0]?.renderGeometry.vertexCount).toBe(3);
		expect(model.missingEnvCellAssetIds).toEqual([]);
		expect(model.missingInteriorGeometryAssetIds).toEqual([]);
		expect(model.missingCellStructureKeys).toEqual([]);
	});

	it("leaves missing pack-backed cells out of the rendered set", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"landblock-pack/016cffff": createPreparedLandblockPackAsset(0x016cffff, [
				createPackInteriorCell(0x016c0156, 1, IDENTITY_PLACEMENT),
			]),
		};

		const model = deriveStructuredInteriorSceneModel(
			createIndoorRuntimeBatch(),
			assetState,
		);

		expect(model.cells.map((cell) => cell.envCellId)).toEqual([0x016c0156]);
		expect(model.missingEnvCellAssetIds).toEqual([]);
		expect(model.missingInteriorGeometryAssetIds).toEqual([]);
		expect(model.missingCellStructureKeys).toEqual([]);
	});

	it("derives an indoor scene from browser-selected env-cell focus while runtime residency is outdoors", () => {
		const runtimeBatch = createIndoorRuntimeBatch();
		runtimeBatch.residency.indoors = false;
		runtimeBatch.residency.focusEnvCellId = null;
		runtimeBatch.residency.visibleCellIds = [];
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"landblock-pack/016cffff": createPreparedLandblockPackAsset(0x016cffff, [
				createPackInteriorCell(0x016c0155, 1, IDENTITY_PLACEMENT),
			]),
		};

		const model = deriveStructuredInteriorSceneModel(runtimeBatch, assetState, {
			kind: "interior-cell",
			label: "Env cell 0x016c0155",
			source: "manual",
			envCellId: 0x016c0155,
			landblockId: 0x016cffff,
		});

		expect(model.focusEnvCellId).toBe(0x016c0155);
		expect(model.cells.map((cell) => cell.envCellId)).toEqual([0x016c0155]);
		expect(model.missingEnvCellAssetIds).toEqual([]);
	});

	it("derives outdoor-linked interior cells without an indoor focus cell", () => {
		const runtimeBatch = createIndoorRuntimeBatch();
		runtimeBatch.residency.indoors = false;
		runtimeBatch.residency.focusEnvCellId = null;
		runtimeBatch.residency.visibleCellIds = [];
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"landblock-pack/0102ffff": createPreparedLandblockPackAsset(0x0102ffff, [
				createPackInteriorCell(0x01020155, 1, IDENTITY_PLACEMENT),
			]),
		};

		const model = deriveStructuredInteriorSceneModel(
			runtimeBatch,
			assetState,
			null,
			{
				envCellIds: [0x01020155],
			},
		);

		expect(model.focusEnvCellId).toBeNull();
		expect(model.activeEnvCellIds).toEqual([0x01020155]);
		expect(model.cells).toContainEqual(
			expect.objectContaining({
				envCellId: 0x01020155,
				renderChunk: {
					chunkKey: "landblock/0102ffff",
					chunkLandblockId: 0x0102ffff,
				},
				isFocus: false,
				chunkLocalPlacement: IDENTITY_PLACEMENT,
			}),
		);
	});
});

function createIndoorRuntimeBatch(): RuntimeBatchDto {
	return {
		tick: 12,
		entities: [],
		residency: {
			focusEntityId: null,
			focusLandblockId: 0x016c0155,
			focusCellId: null,
			focusEnvCellId: 0x016c0155,
			visibleCellIds: [0x016c0156],
			seenOutside: false,
			environmentId: 0x0d000001,
			cellStructureId: 1,
			focusLocationLabel: "Indoors 0x016c0155",
			indoors: true,
			trackedBodyCount: 0,
		},
	};
}

function createPreparedLandblockPackAsset(
	landblockId: number,
	interiorCells: ReturnType<typeof createPackInteriorCell>[],
): PreparedAssetRecord {
	const assetId = `landblock-pack/${landblockId.toString(16).padStart(8, "0")}`;
	return {
		request: { requestId: assetId, assetId, priority: "streaming" },
		response: {
			requestId: assetId,
			assetId,
			payloadKind: "json",
			payload: {},
		},
		payload: {
			kind: "landblock-pack",
			sourceAssetKind: "landblock-pack",
			residencyKind: "landblock",
			provenance: {
				source: "repo-local-hba",
				sourceAssetKind: "landblock-pack",
				errorCode: null,
				detail: "test",
			},
			landblockId,
			landblockInfoId: landblockId & 0xffff_fffe,
			classification: "dungeon",
			sourceFacts: { buildings: [] },
			prepared: {
				terrainMesh: null,
				outdoorStaticInstances: [],
				interiorCells,
				staticMeshes: [],
				spatialItems: [],
				staticLandblockBvh: null,
			},
			dependencies: {
				cellDatIds: [],
				portalDatIds: [],
				renderableAssetIds: [],
			},
			diagnostics: { sourceRecords: [], errors: [] },
		},
		preparedAt: "2026-05-13T00:00:00.000Z",
	};
}

function createPackInteriorCell(
	envCellId: number,
	cellStructureId: number,
	localPlacement: PlacementTransformDto,
) {
	const assetId = `landblock-pack/${(envCellId & 0xffff0000).toString(16).padStart(8, "0")}/interior-cell/${envCellId.toString(16).padStart(8, "0")}`;
	return {
		envCellId,
		environmentId: 0x0d000001,
		cellStructureId,
		localPlacement,
		surfaceIds: [0x08000001],
		portals: [
			{
				portalId: `${assetId}/portal/00`,
				sourceIndex: 0,
				flags: 0,
				polygonId: 1,
				otherCellId: 0x0156,
				otherPortalId: 0,
				targetEnvCellId: 0x016c0156,
				isOutsideTransition: false,
			},
		],
		portalApertures: [],
		staticObjectCount: 0,
		cellBsp: createLeafBspNode(),
		renderGeometry: createRenderGeometry(
			cellStructureId,
			cellStructureId === 1 ? 3 : 6,
		),
	};
}

function createLeafBspNode(): PreparedPolygonSetBspNode {
	return {
		kind: "leaf",
		index: 0,
		solid: 0,
		sphere: null,
		polyIds: [],
	};
}

function createRenderGeometry(
	sourceId: number,
	vertexCount: number,
): PreparedPolygonSetRenderGeometry {
	return {
		sourceId,
		vertexCount,
		triangleCount: vertexCount / 3,
		positions: Array.from({ length: vertexCount * 3 }, (_, index) => index),
		normals: [],
		uvs: [],
		triangles: [{ polygonId: sourceId, surfaceId: null, firstVertex: 0 }],
		surfaceIds: [],
		bounds: {
			min: { x: 0, y: 0, z: 0 },
			max: { x: 1, y: 1, z: 1 },
		},
	};
}
