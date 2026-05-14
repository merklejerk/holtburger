import { describe, expect, it } from "vitest";

import {
	createInitialAssetChannelState,
	type PreparedAssetRecord,
	type PreparedPolygonSetRenderGeometry,
} from "../assets/types";
import type { PlacementTransformDto, RuntimeBatchDto } from "../host/contracts";
import { deriveStructuredInteriorSceneModel } from "./structured-interior-scene";

const IDENTITY_PLACEMENT: PlacementTransformDto = {
	origin: { x: 0, y: 0, z: 0 },
	orientation: { w: 1, x: 0, y: 0, z: 0 },
};

describe("structured interior scene model", () => {
	it("joins visible env-cell metadata to prepared environment cell structures", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"indoor-env-cell/016c0155": createPreparedIndoorEnvCellAsset(
				0x016c0155,
				0x0d000001,
				1,
				{
					origin: { x: 10, y: 20, z: 30 },
					orientation: IDENTITY_PLACEMENT.orientation,
				},
			),
			"indoor-env-cell/016c0156": createPreparedIndoorEnvCellAsset(
				0x016c0156,
				0x0d000001,
				2,
				IDENTITY_PLACEMENT,
			),
			"environment/0d000001": createPreparedEnvironmentAsset(0x0d000001),
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
			environmentId: 0x0d000001,
			cellStructureId: 1,
			isFocus: true,
			localPlacement: { origin: { x: 10, y: 20, z: 30 } },
			portalCount: 1,
			staticObjectCount: 0,
		});
		expect(model.cells[0]?.renderGeometry.vertexCount).toBe(3);
		expect(model.missingEnvCellAssetIds).toEqual([]);
		expect(model.missingEnvironmentAssetIds).toEqual([]);
		expect(model.missingCellStructureKeys).toEqual([]);
	});

	it("tracks missing visible env-cell, environment, and cell-structure inputs", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"indoor-env-cell/016c0155": createPreparedIndoorEnvCellAsset(
				0x016c0155,
				0x0d000001,
				99,
				IDENTITY_PLACEMENT,
			),
			"indoor-env-cell/016c0156": createPreparedIndoorEnvCellAsset(
				0x016c0156,
				0x0d000002,
				1,
				IDENTITY_PLACEMENT,
			),
			"environment/0d000001": createPreparedEnvironmentAsset(0x0d000001),
		};

		const model = deriveStructuredInteriorSceneModel(
			createIndoorRuntimeBatch(),
			assetState,
		);

		expect(model.cells).toEqual([]);
		expect(model.missingEnvCellAssetIds).toEqual([]);
		expect(model.missingEnvironmentAssetIds).toEqual(["environment/0d000002"]);
		expect(model.missingCellStructureKeys).toEqual([
			"environment/0d000001:cell-structure/00000063",
		]);
	});

	it("derives an indoor scene from browser-selected env-cell focus while runtime residency is outdoors", () => {
		const runtimeBatch = createIndoorRuntimeBatch();
		runtimeBatch.residency.indoors = false;
		runtimeBatch.residency.focusEnvCellId = null;
		runtimeBatch.residency.visibleCellIds = [];
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"indoor-env-cell/016c0155": createPreparedIndoorEnvCellAsset(
				0x016c0155,
				0x0d000001,
				1,
				IDENTITY_PLACEMENT,
			),
			"environment/0d000001": createPreparedEnvironmentAsset(0x0d000001),
		};

		const model = deriveStructuredInteriorSceneModel(runtimeBatch, assetState, {
			kind: "indoor-env-cell",
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
			"indoor-env-cell/01020155": createPreparedIndoorEnvCellAsset(
				0x01020155,
				0x0d000001,
				1,
				IDENTITY_PLACEMENT,
			),
			"environment/0d000001": createPreparedEnvironmentAsset(0x0d000001),
		};

		const model = deriveStructuredInteriorSceneModel(
			runtimeBatch,
			assetState,
			null,
			{
				envCellIds: [0x01020155],
				focusLandblockId: 0x0102ffff,
			},
		);

		expect(model.focusEnvCellId).toBeNull();
		expect(model.activeEnvCellIds).toEqual([0x01020155]);
		expect(model.cells).toContainEqual(
			expect.objectContaining({
				envCellId: 0x01020155,
				isFocus: false,
				landblockWorldOffset: { x: 0, y: 0, z: 0 },
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

function createPreparedIndoorEnvCellAsset(
	envCellId: number,
	environmentId: number,
	cellStructureId: number,
	localPlacement: PlacementTransformDto,
): PreparedAssetRecord {
	const assetId = `indoor-env-cell/${envCellId.toString(16).padStart(8, "0")}`;
	return {
		request: { requestId: assetId, assetId, priority: "streaming" },
		response: {
			requestId: assetId,
			assetId,
			payloadKind: "json",
			payload: {},
		},
		payload: {
			kind: "indoor-env-cell",
			sourceAssetKind: "env-cell",
			residencyKind: "indoor-env-cell",
			provenance: {
				source: "repo-local-hba",
				sourceAssetKind: "env-cell",
				errorCode: null,
				detail: "test",
			},
			debugPresentation: {
				primitive: "indoor-env-cell-metadata",
				paletteKey: assetId,
			},
			envCellId,
			environmentId,
			cellStructureId,
			localPlacement,
			visibleCellIds: [],
			seenOutside: false,
			surfaceIds: [0x08000001],
			portalCount: 1,
			staticObjectCount: 0,
			staticObjects: [],
		},
		preparedAt: "2026-05-13T00:00:00.000Z",
	};
}

function createPreparedEnvironmentAsset(
	environmentId: number,
): PreparedAssetRecord {
	const assetId = `environment/${environmentId.toString(16).padStart(8, "0")}`;
	return {
		request: { requestId: assetId, assetId, priority: "streaming" },
		response: {
			requestId: assetId,
			assetId,
			payloadKind: "json",
			payload: {},
		},
		payload: {
			kind: "environment",
			sourceAssetKind: "environment",
			residencyKind: "indoor-env-cell",
			provenance: {
				source: "repo-local-hba",
				sourceAssetKind: "environment",
				errorCode: null,
				detail: "test",
			},
			debugPresentation: {
				primitive: "environment",
				paletteKey: assetId,
			},
			environmentId,
			cellStructureIds: [1, 2],
			cellStructures: [createCellStructure(1, 3), createCellStructure(2, 6)],
		},
		preparedAt: "2026-05-13T00:00:00.000Z",
	};
}

function createCellStructure(id: number, vertexCount: number) {
	return {
		id,
		vertexArray: {
			vertexType: null,
			vertexCount,
			vertices: [],
		},
		drawingPolygons: [],
		portalPolygonIds: [],
		cellBspWitness: {
			hasBsp: true,
			rootKind: "leaf" as const,
		},
		physicsWitness: {
			polygonCount: 0,
			hasBsp: false,
			rootKind: null,
		},
		drawingBsp: null,
		renderGeometry: createRenderGeometry(id, vertexCount),
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
