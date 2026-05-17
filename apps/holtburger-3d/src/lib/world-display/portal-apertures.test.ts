import { describe, expect, it } from "vitest";

import type {
	StructuredInteriorCell,
	StructuredInteriorSceneModel,
} from "./structured-interior-scene";
import {
	derivePortalAperturesFromStructuredInteriorScene,
	isOutsideTransitionPortal,
} from "./portal-apertures";
import { deriveStructuredCellRenderChunk } from "./render-chunks";

const IDENTITY_PLACEMENT = {
	origin: { x: 0, y: 0, z: 0 },
	orientation: { w: 1, x: 0, y: 0, z: 0 },
};

describe("portal apertures", () => {
	it("derives env-cell portal apertures independently of debug overlays", () => {
		const apertures = derivePortalAperturesFromStructuredInteriorScene(
			createStructuredInteriorSceneModel([
				createStructuredInteriorCell(0x016c0155, 0x016c0156),
				createStructuredInteriorCell(0x016c0156, 0),
			]),
		);

		expect(apertures).toHaveLength(2);
		expect(apertures[0]).toMatchObject({
			id: "portal-16c0155",
			source: {
				kind: "env-cell",
				envCellId: 0x016c0155,
				portalId: "portal-16c0155",
				sourceIndex: 0,
				polygonId: 7,
				flags: 0,
				otherPortalId: 0,
			},
			renderChunk: {
				chunkKey: "landblock/016cffff",
				chunkLandblockId: 0x016cffff,
			},
			chunkLocalPlacement: IDENTITY_PLACEMENT,
			targetEnvCellId: 0x016c0156,
			targetStatus: "loaded-visible",
			outsideTransition: false,
		});
		expect(apertures[0]?.points).toEqual([
			{ x: 0, y: 2, z: -1 },
			{ x: 3, y: 2, z: -1 },
			{ x: 3, y: 5, z: -1 },
		]);
		expect(apertures[0]?.plane).toEqual({
			normal: { x: 0, y: 0, z: 1 },
			constant: -1,
			source: "derived-from-render-points",
		});
		expect(apertures[1]?.targetStatus).toBe("unsupported");
	});

	it("classifies missing polygons and outside transitions", () => {
		const outsidePortal = {
			portalId: "outside",
			sourceIndex: 0,
			flags: 0x4,
			polygonId: 7,
			otherCellId: 0xffff,
			otherPortalId: 0xffff,
			targetEnvCellId: 0x016cffff,
		};
		const apertures = derivePortalAperturesFromStructuredInteriorScene(
			createStructuredInteriorSceneModel([
				{
					...createStructuredInteriorCell(0x016c0155, 0),
					portals: [
						outsidePortal,
						{
							portalId: "missing",
							sourceIndex: 1,
							flags: 0,
							polygonId: 99,
							otherCellId: 0x0156,
							otherPortalId: 0,
							targetEnvCellId: 0x016c0156,
						},
					],
				},
			]),
		);

		expect(isOutsideTransitionPortal(outsidePortal)).toBe(true);
		expect(apertures[0]).toMatchObject({
			id: "outside",
			targetEnvCellId: 0x016cffff,
			targetStatus: "outside",
			outsideTransition: true,
		});
		expect(apertures[1]).toMatchObject({
			id: "missing",
			points: [],
			plane: null,
			targetStatus: "missing-polygon",
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
			renderGeometry: createRenderGeometry(),
		},
		renderGeometry: createRenderGeometry(),
		debugColorKey: `cell-${envCellId.toString(16)}`,
	};
}

function createRenderGeometry(): StructuredInteriorCell["renderGeometry"] {
	return {
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
	};
}
