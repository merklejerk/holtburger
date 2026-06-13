import { describe, expect, it } from "vitest";
import { createBrowserStaticPickRay } from "./static-picking";

describe("browser static picking", () => {
	it("builds a center pick ray from the V2 camera convention", () => {
		const request = createBrowserStaticPickRay({
			camera: {
				pitchRadians: 0,
				position: [1, 2, 3],
				yawRadians: 0,
			},
			clientX: 50,
			clientY: 50,
			context: { kind: "outdoor" },
			viewport: {
				height: 100,
				left: 0,
				top: 0,
				width: 100,
			},
		});

		expect(request.ray.origin).toEqual({ x: 1, y: 2, z: 3 });
		expect(request.ray.direction.x).toBeCloseTo(0);
		expect(request.ray.direction.y).toBeCloseTo(0);
		expect(request.ray.direction.z).toBeCloseTo(-1);
	});

	it("offsets rays by viewport position", () => {
		const request = createBrowserStaticPickRay({
			camera: {
				pitchRadians: 0,
				position: [0, 0, 0],
				yawRadians: 0,
			},
			clientX: 125,
			clientY: 75,
			context: { kind: "outdoor" },
			viewport: {
				height: 100,
				left: 100,
				top: 50,
				width: 100,
			},
		});

		expect(request.ray.direction.x).toBeLessThan(0);
		expect(request.ray.direction.y).toBeGreaterThan(0);
		expect(request.ray.direction.z).toBeLessThan(0);
	});
});
