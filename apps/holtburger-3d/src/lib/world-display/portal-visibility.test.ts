import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector2 } from "three";

import { evaluatePortalVisibility } from "./portal-visibility";

describe("portal visibility", () => {
	it("accepts front-facing aperture polygons in the camera frustum", () => {
		const result = evaluatePortalVisibility({
			worldPoints: [
				{ x: -1, y: -1, z: -5 },
				{ x: 1, y: -1, z: -5 },
				{ x: 1, y: 1, z: -5 },
				{ x: -1, y: 1, z: -5 },
			],
			camera: createCamera(),
			viewport: new Vector2(800, 600),
			minScreenAreaPx: 1,
		});

		expect(result.visible).toBe(true);
		expect(result.reason).toBe("visible");
		expect(result.screenAreaPx).toBeGreaterThan(1);
	});

	it("rejects back-facing aperture polygons", () => {
		const result = evaluatePortalVisibility({
			worldPoints: [
				{ x: -1, y: -1, z: -5 },
				{ x: -1, y: 1, z: -5 },
				{ x: 1, y: 1, z: -5 },
				{ x: 1, y: -1, z: -5 },
			],
			camera: createCamera(),
			viewport: new Vector2(800, 600),
			minScreenAreaPx: 1,
		});

		expect(result.visible).toBe(false);
		expect(result.reason).toBe("back-facing");
	});

	it("rejects projected apertures below the configured screen-area threshold", () => {
		const result = evaluatePortalVisibility({
			worldPoints: [
				{ x: -0.001, y: -0.001, z: -50 },
				{ x: 0.001, y: -0.001, z: -50 },
				{ x: 0.001, y: 0.001, z: -50 },
			],
			camera: createCamera(),
			viewport: new Vector2(800, 600),
			minScreenAreaPx: 10,
		});

		expect(result.visible).toBe(false);
		expect(result.reason).toBe("too-small");
	});
});

function createCamera(): PerspectiveCamera {
	const camera = new PerspectiveCamera(60, 800 / 600, 0.1, 100);
	camera.position.set(0, 0, 0);
	camera.lookAt(0, 0, -1);
	camera.updateProjectionMatrix();
	camera.updateMatrixWorld(true);
	return camera;
}
