import { describe, expect, it } from "vitest";
import type { GeometryResourceKey } from "./resource-manager";
import { RenderResourceRegistry } from "./render-resources";

const GEOMETRY = "geometry-resource:1" as const satisfies GeometryResourceKey;

describe("RenderResourceRegistry", () => {
	it("preserves terrain identity and geometry across draw-unit replacement", () => {
		const resources = new RenderResourceRegistry();
		const replacement = createTerrainDrawUnits(6);
		const resourceId = resources.createTerrainResource(
			GEOMETRY,
			createTerrainDrawUnits(),
		);

		resources.replaceTerrainResource(resourceId, replacement);

		const resource = resources.getTerrainResource(resourceId);
		expect(resource.geometryKey).toBe(GEOMETRY);
		expect(resource.drawUnits).toBe(replacement);
	});

	it("removes logical resources only through an explicit operation", () => {
		const resources = new RenderResourceRegistry();
		const resourceId = resources.createTerrainResource(
			GEOMETRY,
			createTerrainDrawUnits(),
		);

		expect(resources.removeTerrainResource(resourceId).geometryKey).toBe(
			GEOMETRY,
		);
		expect(() => resources.getTerrainResource(resourceId)).toThrow(
			"does not exist",
		);
	});
});

function createTerrainDrawUnits(indexCount = 3) {
	return [
		{
			indexCount,
			indexStart: 0,
			material: {
				colorTexture: "terrain-color:1/wrap-4" as const,
				detailTexture: "terrain-detail:2/wrap-4" as const,
				roadMaskTexture: "terrain-road-mask:3/wrap-4" as const,
			},
		},
	];
}
