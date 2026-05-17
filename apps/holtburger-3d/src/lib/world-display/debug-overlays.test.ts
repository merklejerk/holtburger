import { describe, expect, it } from "vitest";

import type {
	StructuredInteriorCell,
	StructuredInteriorSceneModel,
} from "./structured-interior-scene";
import { deriveWorldDebugOverlayModel } from "./debug-overlays";
import { deriveStructuredCellRenderChunk } from "./render-chunks";

const IDENTITY_PLACEMENT = {
	origin: { x: 0, y: 0, z: 0 },
	orientation: { w: 1, x: 0, y: 0, z: 0 },
};

describe("debug overlays", () => {
	it("derives cell markers and portal polygon witnesses without asset records", () => {
		const model = deriveWorldDebugOverlayModel(
			createStructuredInteriorSceneModel([
				createStructuredInteriorCell(0x016c0155, 0x016c0156),
				createStructuredInteriorCell(0x016c0156, 0),
			]),
			{
				showPortalPolygons: true,
				showCellIndicators: true,
				highlightPortalTargets: true,
			},
		);

		expect(model.cells.map((cell) => cell.label)).toEqual(["0155", "0156"]);
		expect(model.cells[0]).toMatchObject({
			envCellId: 0x016c0155,
			renderChunk: {
				chunkKey: "landblock/016cffff",
				chunkLandblockId: 0x016cffff,
			},
			chunkLocalPlacement: IDENTITY_PLACEMENT,
		});
		expect(model.portals).toHaveLength(2);
		expect(model.portals[0]).toMatchObject({
			sourceEnvCellId: 0x016c0155,
			renderChunk: {
				chunkKey: "landblock/016cffff",
				chunkLandblockId: 0x016cffff,
			},
			targetEnvCellId: 0x016c0156,
			targetStatus: "loaded-visible",
			polygonId: 7,
		});
		expect(model.portals[0]?.points).toEqual([
			{ x: 0, y: 2, z: -1 },
			{ x: 3, y: 2, z: -1 },
			{ x: 3, y: 5, z: -1 },
		]);
		expect(model.portals[1]?.targetStatus).toBe("unsupported");
		expect(model.diagnostics).toMatchObject({
			cellCount: 2,
			portalCount: 2,
			knownTargetCount: 1,
			loadedTargetCount: 1,
			missingPortalPolygonCount: 0,
		});
	});

	it("surfaces missing portal polygon witnesses as diagnostics", () => {
		const scene = createStructuredInteriorSceneModel([
			{
				...createStructuredInteriorCell(0x016c0155, 0x016c0156),
				portals: [
					{
						portalId: "missing",
						sourceIndex: 0,
						flags: 0,
						polygonId: 99,
						otherCellId: 0x0156,
						otherPortalId: 0,
						targetEnvCellId: 0x016c0156,
					},
				],
			},
		]);

		const model = deriveWorldDebugOverlayModel(scene, {
			showPortalPolygons: true,
			showCellIndicators: false,
			highlightPortalTargets: true,
		});

		expect(model.cells).toEqual([]);
		expect(model.portals[0]?.targetStatus).toBe("missing-polygon");
		expect(model.diagnostics.missingPortalPolygonCount).toBe(1);
	});

	it("classifies flag 0x4 portals as outside transitions", () => {
		const scene = createStructuredInteriorSceneModel([
			{
				...createStructuredInteriorCell(0x016c0155, 0),
				portals: [
					{
						portalId: "outside",
						sourceIndex: 0,
						flags: 0x4,
						polygonId: 7,
						otherCellId: 0xffff,
						otherPortalId: 0xffff,
						targetEnvCellId: 0x016cffff,
					},
				],
			},
		]);

		const model = deriveWorldDebugOverlayModel(scene, {
			showPortalPolygons: true,
			showCellIndicators: false,
			highlightPortalTargets: true,
		});

		expect(model.portals[0]).toMatchObject({
			targetEnvCellId: 0x016cffff,
			targetStatus: "outside",
		});
	});
});

function createStructuredInteriorSceneModel(
	cells: StructuredInteriorCell[],
): StructuredInteriorSceneModel {
	return {
		focusEnvCellId: cells[0]?.envCellId ?? null,
		activeEnvCellIds: cells.map((cell) => cell.envCellId),
		cells,
		missingEnvCellAssetIds: [],
		missingEnvironmentAssetIds: [],
		missingCellStructureKeys: [],
		statusText: "test",
		cacheText: "test",
	};
}

function createStructuredInteriorCell(
	envCellId: number,
	targetSuffix: number,
): StructuredInteriorCell {
	const renderChunk = deriveStructuredCellRenderChunk(envCellId);
	return {
		renderKey: `cell-${envCellId.toString(16)}`,
		envCellId,
		renderChunk,
		environmentId: 0x0d000001,
		cellStructureId: 1,
		isFocus: envCellId === 0x016c0155,
		chunkLocalPlacement: IDENTITY_PLACEMENT,
		localPlacement: IDENTITY_PLACEMENT,
		landblockWorldOffset: { x: 0, y: 0, z: 0 },
		surfaceIds: [],
		portalCount: 1,
		portals: [
			{
				portalId: `portal-${envCellId.toString(16)}`,
				sourceIndex: 0,
				flags: 0,
				polygonId: 7,
				otherCellId: targetSuffix,
				otherPortalId: 0,
				targetEnvCellId:
					targetSuffix === 0 ? 0 : (envCellId & 0xffff0000) | targetSuffix,
			},
		],
		staticObjectCount: 0,
		cellStructure: {
			id: 1,
			vertexArray: {
				vertexType: null,
				vertexCount: 3,
				vertices: [
					{
						id: 1,
						origin: { x: 0, y: 1, z: 2 },
						normal: { x: 0, y: 0, z: 1 },
						uvs: [],
					},
					{
						id: 2,
						origin: { x: 3, y: 1, z: 2 },
						normal: { x: 0, y: 0, z: 1 },
						uvs: [],
					},
					{
						id: 3,
						origin: { x: 3, y: 1, z: 5 },
						normal: { x: 0, y: 0, z: 1 },
						uvs: [],
					},
				],
			},
			drawingPolygons: [
				{
					id: 7,
					numPts: 3,
					stippling: 0,
					sidesType: 0,
					posSurface: 0,
					negSurface: 0,
					vertexIds: [1, 2, 3],
					posUvIndices: [],
					negUvIndices: [],
				},
			],
			portalPolygonIds: [7],
			cellBspWitness: {
				hasBsp: true,
				rootKind: "port",
			},
			physicsWitness: {
				polygonCount: 0,
				hasBsp: false,
				rootKind: null,
			},
			drawingBsp: null,
			renderGeometry: {
				sourceId: 1,
				vertexCount: 3,
				triangleCount: 1,
				positions: [],
				normals: [],
				uvs: [],
				triangles: [],
				surfaceIds: [],
				bounds: {
					min: { x: 0, y: 0, z: 0 },
					max: { x: 3, y: 5, z: 1 },
				},
			},
		},
		renderGeometry: {
			sourceId: 1,
			vertexCount: 3,
			triangleCount: 1,
			positions: [],
			normals: [],
			uvs: [],
			triangles: [],
			surfaceIds: [],
			bounds: {
				min: { x: 0, y: 0, z: 0 },
				max: { x: 3, y: 5, z: 1 },
			},
		},
		debugColorKey: `cell-${envCellId.toString(16)}`,
	};
}
