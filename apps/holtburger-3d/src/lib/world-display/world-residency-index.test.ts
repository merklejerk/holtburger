import { describe, expect, it } from "vitest";

import type { PreparedPolygonSetRenderGeometry } from "../assets/types";
import type { PlacementTransformDto } from "../host/contracts";
import { makeOutdoorLandblockId } from "../landblocks";
import type { RenderChunkTransform } from "./render-anchor";
import type { StructuredInteriorCell } from "./structured-interior-scene";
import {
	buildWorldResidencyIndex,
	computeRendererPositionLandblockResidency,
	deriveResidencyCellBounds,
	inferRenderAnchor,
} from "./world-residency-index";

describe("world residency index", () => {
	it("infers the active render anchor from chunk transforms", () => {
		expect(
			inferRenderAnchor([
				{
					chunkKey: "landblock/0203ffff",
					chunkLandblockId: makeOutdoorLandblockId(2, 3),
					offset: { x: 192, y: 0, z: -384 },
				},
			]),
		).toEqual({
			landblockId: makeOutdoorLandblockId(1, 1),
		});
	});

	it("computes renderer-local landblock residency from the inferred anchor", () => {
		const anchor = { landblockId: makeOutdoorLandblockId(10, 20) };

		expect(
			computeRendererPositionLandblockResidency(
				{ x: 205, y: 7, z: -389 },
				anchor,
			),
		).toMatchObject({
			landblockId: makeOutdoorLandblockId(11, 22),
			landblockRelativePosition: { x: 13, y: 7, z: -5 },
		});
	});

	it("derives landblock-relative residency bounds from cell render bounds and placement", () => {
		const bounds = deriveResidencyCellBounds(
			createCell({
				envCellId: makeOutdoorLandblockId(1, 2) & 0xffff0000,
				origin: { x: 10, y: 20, z: 30 },
				boundsMin: { x: 1, y: 2, z: 3 },
				boundsMax: { x: 4, y: 5, z: 6 },
			}),
		);

		expect(bounds?.min.toArray()).toEqual([11, 32, -17]);
		expect(bounds?.max.toArray()).toEqual([14, 35, -14]);
	});

	it("queries an env cell when the camera point is inside a loaded cell AABB", () => {
		const landblockId = makeOutdoorLandblockId(1, 2);
		const index = buildWorldResidencyIndex({
			renderChunkTransforms: [createChunkTransform(landblockId, landblockId)],
			cells: [
				createCell({
					envCellId: 0x01020001,
					origin: { x: 10, y: 20, z: 30 },
					boundsMin: { x: 0, y: 0, z: 0 },
					boundsMax: { x: 10, y: 10, z: 10 },
				}),
			],
		});

		expect(index.query({ x: 15, y: 35, z: -15 })).toEqual({
			kind: "env-cell",
			landblockId,
			envCellId: 0x01020001,
		});
	});

	it("returns outdoor landblock residency when no loaded cell contains the point", () => {
		const landblockId = makeOutdoorLandblockId(1, 2);
		const index = buildWorldResidencyIndex({
			renderChunkTransforms: [createChunkTransform(landblockId, landblockId)],
			cells: [
				createCell({
					envCellId: 0x01020001,
					origin: { x: 10, y: 20, z: 30 },
					boundsMin: { x: 0, y: 0, z: 0 },
					boundsMax: { x: 10, y: 10, z: 10 },
				}),
			],
		});

		expect(index.query({ x: 100, y: 35, z: -100 })).toEqual({
			kind: "outdoor-landblock",
			landblockId,
		});
	});

	it("resolves overlapping cell AABBs with deterministic nearest-center selection", () => {
		const landblockId = makeOutdoorLandblockId(1, 2);
		const index = buildWorldResidencyIndex({
			renderChunkTransforms: [createChunkTransform(landblockId, landblockId)],
			cells: [
				createCell({
					envCellId: 0x01020001,
					origin: { x: 0, y: 0, z: 0 },
					boundsMin: { x: 0, y: 0, z: -20 },
					boundsMax: { x: 30, y: 30, z: 20 },
				}),
				createCell({
					envCellId: 0x01020002,
					origin: { x: 20, y: 0, z: 0 },
					boundsMin: { x: 0, y: 0, z: -20 },
					boundsMax: { x: 30, y: 30, z: 20 },
				}),
			],
		});

		expect(index.query({ x: 42, y: 15, z: -5 })).toEqual({
			kind: "env-cell",
			landblockId,
			envCellId: 0x01020002,
		});
	});
});

function createChunkTransform(
	chunkLandblockId: number,
	anchorLandblockId: number,
): RenderChunkTransform {
	const chunkX = (chunkLandblockId >>> 24) & 0xff;
	const chunkY = (chunkLandblockId >>> 16) & 0xff;
	const anchorX = (anchorLandblockId >>> 24) & 0xff;
	const anchorY = (anchorLandblockId >>> 16) & 0xff;
	return {
		chunkKey: `landblock/${(chunkLandblockId >>> 0).toString(16).padStart(8, "0")}`,
		chunkLandblockId,
		offset: {
			x: (chunkX - anchorX) * 192,
			y: 0,
			z: -(chunkY - anchorY) * 192,
		},
	};
}

function createCell(options: {
	envCellId: number;
	origin: { x: number; y: number; z: number };
	boundsMin: { x: number; y: number; z: number };
	boundsMax: { x: number; y: number; z: number };
}): StructuredInteriorCell {
	return {
		renderKey: `interior-cell-shell/test/${options.envCellId}`,
		envCellId: options.envCellId,
		renderChunk: {
			chunkKey: `landblock/${(options.envCellId & 0xffff0000).toString(16).padStart(8, "0")}`,
			chunkLandblockId: options.envCellId & 0xffff0000,
		},
		environmentId: 1,
		cellStructureId: 1,
		isFocus: false,
		chunkLocalPlacement: createPlacement(options.origin),
		surfaceIds: [],
		portalCount: 0,
		portals: [],
		staticObjectCount: 0,
		cellStructure: null,
		renderGeometry: createRenderGeometry(options.boundsMin, options.boundsMax),
		debugColorKey: "test",
	};
}

function createPlacement(origin: {
	x: number;
	y: number;
	z: number;
}): PlacementTransformDto {
	return {
		origin,
		orientation: { w: 1, x: 0, y: 0, z: 0 },
	};
}

function createRenderGeometry(
	min: { x: number; y: number; z: number },
	max: { x: number; y: number; z: number },
): PreparedPolygonSetRenderGeometry {
	return {
		sourceId: 1,
		vertexCount: 8,
		triangleCount: 0,
		positions: [],
		normals: [],
		uvs: [],
		triangles: [],
		surfaceIds: [],
		bounds: { min, max },
	};
}
