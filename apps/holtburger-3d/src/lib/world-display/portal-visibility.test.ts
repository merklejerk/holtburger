import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector2 } from "three";

import {
	createPortalVisibilityContext,
	evaluatePortalVisibility,
} from "./portal-visibility";

describe("portal visibility", () => {
	it("accepts front-facing aperture polygons in the camera frustum", () => {
		const result = evaluatePortalVisibility({
			worldPoints: [
				{ x: -1, y: -1, z: -5 },
				{ x: 1, y: -1, z: -5 },
				{ x: 1, y: 1, z: -5 },
				{ x: -1, y: 1, z: -5 },
			],
			worldPlane: createZPlane(-5),
			visibleSide: "positive",
			context: createTestContext(),
		});

		expect(result.visible).toBe(true);
		expect(result.reason).toBe("visible");
		expect(result.screenAreaPx).toBeGreaterThan(1);
	});

	it("rejects cameras on the side opposite the decoded portal side", () => {
		const result = evaluatePortalVisibility({
			worldPoints: [
				{ x: -1, y: -1, z: -5 },
				{ x: 1, y: -1, z: -5 },
				{ x: 1, y: 1, z: -5 },
				{ x: -1, y: 1, z: -5 },
			],
			worldPlane: createZPlane(-5),
			visibleSide: "negative",
			context: createTestContext(),
		});

		expect(result.visible).toBe(false);
		expect(result.reason).toBe("back-facing");
	});

	it("accepts the negative side when the decoded portal side selects it", () => {
		const result = evaluatePortalVisibility({
			worldPoints: [
				{ x: -1, y: -1, z: -5 },
				{ x: 1, y: -1, z: -5 },
				{ x: 1, y: 1, z: -5 },
				{ x: -1, y: 1, z: -5 },
			],
			worldPlane: createZPlane(-5),
			visibleSide: "negative",
			context: createTestContext({ positionZ: -10, targetZ: -5 }),
		});

		expect(result.visible).toBe(true);
		expect(result.reason).toBe("visible");
	});

	it("rejects projected apertures below the configured screen-area threshold", () => {
		const result = evaluatePortalVisibility({
			worldPoints: [
				{ x: -0.001, y: -0.001, z: -50 },
				{ x: 0.001, y: -0.001, z: -50 },
				{ x: 0.001, y: 0.001, z: -50 },
			],
			worldPlane: createZPlane(-50),
			visibleSide: "positive",
			context: createTestContext({ minScreenAreaPx: 10 }),
		});

		expect(result.visible).toBe(false);
		expect(result.reason).toBe("too-small");
	});

	it("uses the supplied plane instead of polygon winding for side culling", () => {
		const result = evaluatePortalVisibility({
			worldPoints: [
				{ x: -1, y: -1, z: -5 },
				{ x: 1, y: -1, z: -5 },
				{ x: 1, y: 1, z: -5 },
				{ x: -1, y: 1, z: -5 },
			],
			worldPlane: {
				normal: { x: 0, y: 0, z: -1 },
				constant: 5,
				source: "drawing-bsp-portal",
			},
			visibleSide: "positive",
			context: createTestContext(),
		});

		expect(result.visible).toBe(false);
		expect(result.reason).toBe("back-facing");
	});

	it("measures clipped polygon footprint instead of a clamped viewport rectangle", () => {
		const result = evaluatePortalVisibility({
			worldPoints: [
				{ x: 800, y: -0.01, z: -5 },
				{ x: 900, y: -0.01, z: -5 },
				{ x: 900, y: 0.01, z: -5 },
				{ x: 800, y: 0.01, z: -5 },
			],
			worldPlane: createZPlane(-5),
			visibleSide: "positive",
			context: createTestContext({ minScreenAreaPx: 10 }),
		});

		expect(result.visible).toBe(false);
		expect(result.reason).toBe("outside-frustum");
		expect(result.screenAreaPx).toBe(0);
	});

	it("rejects near-edge slivers by clipped area rather than clamped bounding area", () => {
		const result = evaluatePortalVisibility({
			worldPoints: [
				{ x: 3.7, y: -0.01, z: -5 },
				{ x: 3.9, y: -0.01, z: -5 },
				{ x: 3.9, y: 0.01, z: -5 },
				{ x: 3.7, y: 0.01, z: -5 },
			],
			worldPlane: createZPlane(-5),
			visibleSide: "positive",
			context: createTestContext({ minScreenAreaPx: 200 }),
		});

		expect(result.visible).toBe(false);
		expect(result.reason).toBe("too-small");
		expect(result.screenAreaPx).toBeLessThan(200);
	});
});

function createZPlane(z: number) {
	return {
		normal: { x: 0, y: 0, z: 1 },
		constant: z,
		source: "drawing-bsp-portal" as const,
	};
}

function createCamera(
	options: { positionZ?: number; targetZ?: number } = {},
): PerspectiveCamera {
	const camera = new PerspectiveCamera(60, 800 / 600, 0.1, 100);
	camera.position.set(0, 0, options.positionZ ?? 0);
	camera.lookAt(0, 0, options.targetZ ?? -1);
	camera.updateProjectionMatrix();
	camera.updateMatrixWorld(true);
	return camera;
}

function createTestContext(
	options: {
		positionZ?: number;
		targetZ?: number;
		minScreenAreaPx?: number;
	} = {},
) {
	return createPortalVisibilityContext({
		camera: createCamera(options),
		viewport: new Vector2(800, 600),
		minScreenAreaPx: options.minScreenAreaPx ?? 1,
	});
}
