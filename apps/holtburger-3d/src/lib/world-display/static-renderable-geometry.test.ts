import { Vector3 } from "three";
import { describe, expect, it } from "vitest";

import type { StaticRenderablePart } from "./static-renderables";
import { WORLD_RENDER_DOMAIN } from "./render-domains";
import { createBaseMaterialAppearanceContext } from "./material-appearance";
import {
	buildGfxObjGeometry,
	buildStaticRenderableColor,
	buildStaticRenderableInstanceColor,
	buildStaticRenderablePartMatrix,
} from "./static-renderable-geometry";

describe("static renderable geometry", () => {
	it("authors instance matrices in chunk-local coordinates", () => {
		const part: StaticRenderablePart = {
			renderKey: "exterior-static/part",
			renderDomain: WORLD_RENDER_DOMAIN.exteriorStatic,
			instanceId: "instance",
			sourceAssetId: "gfx-obj/01000001",
			sourceDid: 0x01000001,
			owningLandblockId: 0x0203ffff,
			owningEnvCellId: null,
			renderChunk: {
				chunkKey: "landblock/0203ffff",
				chunkLandblockId: 0x0203ffff,
			},
			kind: "scenery",
			partIndex: 0,
			gfxObjId: 0x01000001,
			gfxObjAssetId: "gfx-obj/01000001",
			materialAppearanceKey: "base",
			materialAppearanceContext: createBaseMaterialAppearanceContext("base"),
			materialSlots: [],
			materialSignature: "base",
			parentPlacements: [],
			chunkLocalInstancePlacement: createPlacement({ x: 24, y: 48, z: 6 }),
			partPlacements: [],
			scale: { x: 1, y: 1, z: 1 },
			debugColorKey: "part",
		};
		const matrix = buildStaticRenderablePartMatrix(part);
		const position = new Vector3().setFromMatrixPosition(matrix);

		expect(position).toEqual(new Vector3(24, 6, -48));
	});

	it("reuses typed render geometry buffers without copying", () => {
		const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
		const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
		const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
		const geometry = buildGfxObjGeometry({
			sourceId: 1,
			vertexCount: 3,
			triangleCount: 1,
			positions,
			normals,
			uvs,
			triangles: [{ polygonId: 0, surfaceId: null, firstVertex: 0 }],
			surfaceIds: [],
			invalidPolygons: [],
			skippedPolygonCount: 0,
			bounds: null,
		});

		expect(geometry.getAttribute("position").array).toBe(positions);
		expect(geometry.getAttribute("normal").array).toBe(normals);
		expect(geometry.getAttribute("uv").array).toBe(uvs);
	});

	it("uses neutral instance colors while real materials are active", () => {
		const debugColor = buildStaticRenderableColor("part");
		const materialColor = buildStaticRenderableInstanceColor("part", "material");
		const noMaterialColor = buildStaticRenderableInstanceColor("part", "debug");

		expect(materialColor.getHex()).toBe(0xffffff);
		expect(noMaterialColor.getHex()).toBe(debugColor.getHex());
		expect(noMaterialColor.getHex()).not.toBe(materialColor.getHex());
	});

	it("creates contiguous material groups from triangle surface ids", () => {
		const geometry = buildGfxObjGeometry(
			{
				sourceId: 1,
				vertexCount: 9,
				triangleCount: 3,
				positions: new Float32Array(27),
				normals: new Float32Array(27),
				uvs: new Float32Array(18),
				triangles: [
					{ polygonId: 0, surfaceId: 0x08000001, firstVertex: 0 },
					{ polygonId: 1, surfaceId: 0x08000001, firstVertex: 3 },
					{ polygonId: 2, surfaceId: 0x08000002, firstVertex: 6 },
				],
				surfaceIds: [0x08000001, 0x08000002],
				invalidPolygons: [],
				skippedPolygonCount: 0,
				bounds: null,
			},
			[
				{ surfaceId: 0x08000001, materialIndex: 0 },
				{ surfaceId: 0x08000002, materialIndex: 1 },
			],
		);

		expect(geometry.groups).toEqual([
			{ start: 0, count: 6, materialIndex: 0 },
			{ start: 6, count: 3, materialIndex: 1 },
		]);
	});

	it("splits material groups by surface id and material variant", () => {
		const geometry = buildGfxObjGeometry(
			{
				sourceId: 1,
				vertexCount: 9,
				triangleCount: 3,
				positions: new Float32Array(27),
				normals: new Float32Array(27),
				uvs: new Float32Array(18),
				triangles: [
					{
						polygonId: 0,
						surfaceId: 0x08000001,
						materialVariantSignature: "sampler=clamp",
						firstVertex: 0,
					},
					{
						polygonId: 1,
						surfaceId: 0x08000001,
						materialVariantSignature: "sampler=repeat",
						firstVertex: 3,
					},
					{
						polygonId: 2,
						surfaceId: 0x08000001,
						materialVariantSignature: "sampler=repeat",
						firstVertex: 6,
					},
				],
				surfaceIds: [0x08000001],
				invalidPolygons: [],
				skippedPolygonCount: 0,
				bounds: null,
			},
			[
				{
					surfaceId: 0x08000001,
					materialVariantSignature: "sampler=clamp",
					materialIndex: 0,
				},
				{
					surfaceId: 0x08000001,
					materialVariantSignature: "sampler=repeat",
					materialIndex: 1,
				},
			],
		);

		expect(geometry.groups).toEqual([
			{ start: 0, count: 3, materialIndex: 0 },
			{ start: 3, count: 6, materialIndex: 1 },
		]);
	});
});

function createPlacement(origin: { x: number; y: number; z: number }) {
	return {
		origin,
		orientation: { w: 1, x: 0, y: 0, z: 0 },
	};
}
