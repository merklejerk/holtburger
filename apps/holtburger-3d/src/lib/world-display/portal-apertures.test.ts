import { describe, expect, it } from "vitest";

import type { PreparedPolygonSetBspNode } from "../assets/types";
import type {
	StructuredInteriorCell,
	StructuredInteriorSceneModel,
} from "./structured-interior-scene";
import {
	decodePortalVisibleSide,
	derivePortalAperturesFromStructuredInteriorScene,
	isOutsideTransitionPortal,
	oppositePortalVisibleSide,
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
			visibleSide: "negative",
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

	it("prefers source drawing-BSP portal planes over render-point winding", () => {
		const cell = createStructuredInteriorCell(0x016c0155, 0x016c0156);
		if (!cell.cellStructure) {
			throw new Error("test cell should include a cell structure");
		}
		cell.cellStructure.drawingBsp = {
			kind: "port",
			plane: {
				normal: { x: 0, y: -1, z: 0 },
				d: -7,
			},
			pos: createLeafBspNode(),
			neg: createLeafBspNode(),
			sphere: null,
			polyIds: [],
			portalPolys: [{ portalIndex: 0, polyId: 7 }],
		};

		const apertures = derivePortalAperturesFromStructuredInteriorScene(
			createStructuredInteriorSceneModel([cell]),
		);

		expect(apertures[0]?.plane).toEqual({
			normal: { x: 0, y: 0, z: 1 },
			constant: 7,
			source: "drawing-bsp-portal",
		});
	});

	it("uses pack-prepared aperture geometry without legacy cell structures", () => {
		const cell = {
			...createStructuredInteriorCell(0x016c0155, 0x016cffff),
			cellStructure: null,
			portalApertures: [
				{
					portalId: "portal-16c0155",
					sourceIndex: 0,
					polygonId: 7,
					points: [
						{ x: 0, y: 2, z: -1 },
						{ x: 3, y: 2, z: -1 },
						{ x: 3, y: 5, z: -1 },
					],
					plane: {
						normal: { x: 0, y: 0, z: 1 },
						constant: -1,
						source: "derived-from-render-points" as const,
					},
				},
			],
		};

		const apertures = derivePortalAperturesFromStructuredInteriorScene(
			createStructuredInteriorSceneModel([cell]),
		);

		expect(apertures[0]).toMatchObject({
			id: "portal-16c0155",
			points: [
				{ x: 0, y: 2, z: -1 },
				{ x: 3, y: 2, z: -1 },
				{ x: 3, y: 5, z: -1 },
			],
			plane: {
				normal: { x: 0, y: 0, z: 1 },
				constant: -1,
				source: "derived-from-render-points",
			},
		});
	});

	it("matches source drawing-BSP portal planes by polygon id when portal index differs", () => {
		const cell = createStructuredInteriorCell(0x016c0155, 0x016c0156);
		if (!cell.cellStructure) {
			throw new Error("test cell should include a cell structure");
		}
		cell.cellStructure.drawingBsp = {
			kind: "port",
			plane: {
				normal: { x: 1, y: 2, z: 3 },
				d: -4,
			},
			pos: createLeafBspNode(),
			neg: createLeafBspNode(),
			sphere: null,
			polyIds: [],
			portalPolys: [{ portalIndex: 99, polyId: 7 }],
		};

		const apertures = derivePortalAperturesFromStructuredInteriorScene(
			createStructuredInteriorSceneModel([cell]),
		);

		expect(apertures[0]?.plane).toEqual({
			normal: { x: 1, y: 3, z: -2 },
			constant: 4,
			source: "drawing-bsp-portal",
		});
	});

	it("decodes retail portal side from the inverted raw 0x2 flag", () => {
		expect(decodePortalVisibleSide(0x0)).toBe("negative");
		expect(decodePortalVisibleSide(0x2)).toBe("positive");
		expect(decodePortalVisibleSide(0x6)).toBe("positive");
	});

	it("derives the reciprocal portal side for outside-to-inside views", () => {
		expect(oppositePortalVisibleSide("negative")).toBe("positive");
		expect(oppositePortalVisibleSide("positive")).toBe("negative");
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
		missingInteriorGeometryAssetIds: [],
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
		portalApertures: [],
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
			cellBsp: createLeafBspNode(),
			physicsWitness: {
				polygonCount: 0,
				hasBsp: false,
				rootKind: null,
			},
			drawingBsp: null,
			renderGeometry: createRenderGeometry(),
		},
		cellBsp: createLeafBspNode(),
		renderGeometry: createRenderGeometry(),
		debugColorKey: `cell-${envCellId.toString(16)}`,
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
