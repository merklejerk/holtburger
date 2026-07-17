import { describe, expect, it } from "vitest";
import type { GeometryResourceKey } from "./resource-manager";
import { RenderResourceRegistry } from "./render-resources";

const GEOMETRY = "geometry-resource:1" as const satisfies GeometryResourceKey;

describe("RenderResourceRegistry", () => {
	it("retains object draw metadata independently of scene occurrences", () => {
		const resources = new RenderResourceRegistry();
		const resourceId = resources.createObjectResource(GEOMETRY, [
			createDrawUnit(),
		]);

		expect(resources.getObjectResource(resourceId)).toMatchObject({
			geometryKey: GEOMETRY,
			drawUnits: [createDrawUnit()],
		});
	});

	it("removes logical object resources only through an explicit operation", () => {
		const resources = new RenderResourceRegistry();
		const resourceId = resources.createObjectResource(GEOMETRY, []);

		expect(resources.removeObjectResource(resourceId).geometryKey).toBe(
			GEOMETRY,
		);
		expect(() => resources.getObjectResource(resourceId)).toThrow(
			"does not exist",
		);
	});
});

function createDrawUnit() {
	return {
		indexCount: 3,
		indexStart: 0,
		material: {
			depthWrite: true,
			family: "flat-color" as const,
			pass: "opaque" as const,
			textureKeys: [],
		},
		poseIndex: null,
	};
}
