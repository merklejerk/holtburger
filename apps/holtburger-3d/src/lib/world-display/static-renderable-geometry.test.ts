import { Vector3 } from "three";
import { describe, expect, it } from "vitest";

import type { StaticRenderablePart } from "./static-renderables";
import { WORLD_RENDER_DOMAIN } from "./render-domains";
import {
	buildGfxObjGeometry,
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
});

function createPlacement(origin: { x: number; y: number; z: number }) {
	return {
		origin,
		orientation: { w: 1, x: 0, y: 0, z: 0 },
	};
}
