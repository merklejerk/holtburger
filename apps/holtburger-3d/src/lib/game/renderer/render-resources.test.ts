import { describe, expect, it } from "vitest";
import { createPublishedGeometryManager } from "../geometry/geometry-manager.test-utils";
import type { GeometryKey } from "../geometry/types";
import { RenderResourceRegistry } from "./render-resources";

const GEOMETRY = "static-geometry:fixture" as const satisfies GeometryKey;

describe("RenderResourceRegistry", () => {
	it("retains object draw metadata independently of scene occurrences", () => {
		const resources = createRegistry();
		const resourceId = resources.createObjectResource(GEOMETRY, [
			createDrawUnit(),
		]);

		expect(resources.getObjectResource(resourceId)).toMatchObject({
			geometry: GEOMETRY,
			drawUnits: [createDrawUnit()],
		});
	});

	it("removes logical object resources only through an explicit operation", () => {
		const resources = createRegistry();
		const resourceId = resources.createObjectResource(GEOMETRY, []);

		expect(resources.removeObjectResource(resourceId).geometry).toBe(GEOMETRY);
		expect(() => resources.getObjectResource(resourceId)).toThrow(
			"does not exist",
		);
	});
});

function createRegistry(): RenderResourceRegistry {
	return new RenderResourceRegistry(createPublishedGeometryManager(GEOMETRY));
}

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
