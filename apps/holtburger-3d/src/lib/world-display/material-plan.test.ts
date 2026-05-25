import { describe, expect, it } from "vitest";

import type { PreparedPolygonSetRenderGeometry } from "../assets/types";
import { applyRenderGeometryMaterialVariants } from "./material-plan";

describe("material plan helpers", () => {
	it("expands slots by render-geometry material variants", () => {
		const slots = [
			{
				slotIndex: 0,
				surfaceId: 0x08000001,
				materialAssetId: "material/08000001",
			},
		];

		expect(
			applyRenderGeometryMaterialVariants({
				slots,
				renderGeometry: createRenderGeometry([
					{
						polygonId: 4,
						surfaceId: 0,
						materialVariantSignature: "sampler=repeat",
						firstVertex: 12,
					},
				]),
			}),
		).toEqual([
			{
				slotIndex: 0,
				surfaceId: 0x08000001,
				materialAssetId: "material/08000001",
				materialVariantSignature: "sampler=repeat",
			},
		]);
	});
});

function createRenderGeometry(
	triangles: PreparedPolygonSetRenderGeometry["triangles"],
): PreparedPolygonSetRenderGeometry {
	return {
		sourceId: 0,
		vertexCount: 0,
		triangleCount: triangles.length,
		positions: [],
		normals: [],
		uvs: [],
		triangles,
		surfaceIds: [],
		invalidPolygons: [],
		skippedPolygonCount: 0,
		bounds: null,
	};
}
