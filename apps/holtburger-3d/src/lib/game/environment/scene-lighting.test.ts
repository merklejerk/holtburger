import { describe, expect, it } from "vitest";
import { Vec3 } from "../math/types";
import type { ResolvedSceneLighting } from "./scene-environment";
import {
	OBJECT_AMBIENT_SUN_SCALE,
	objectLightingRole,
	resolveSceneLightingByRole,
} from "./scene-lighting";

const WHITE = { red: 1, green: 1, blue: 1, alpha: 1 };

/** Sun length is the authored brightness, so this fixture's magnitude is exactly 2. */
const LIGHTING: ResolvedSceneLighting = {
	ambientLevel: 0.4,
	ambientColor: WHITE,
	sunVector: new Vec3(0, 2, 0),
	sunColor: WHITE,
};

describe("resolveSceneLightingByRole", () => {
	it("leaves terrain on the unboosted regional ambient", () => {
		expect(resolveSceneLightingByRole(LIGHTING).terrain.ambientLevel).toBe(
			LIGHTING.ambientLevel,
		);
	});

	it("boosts object ambient by the scaled sun magnitude", () => {
		const roles = resolveSceneLightingByRole(LIGHTING);
		expect(roles["outdoor-object"].ambientLevel).toBeCloseTo(
			2 * OBJECT_AMBIENT_SUN_SCALE + LIGHTING.ambientLevel,
		);
	});

	it("disables the sun for interior draws while keeping the world ambient", () => {
		const roles = resolveSceneLightingByRole(LIGHTING);
		const interior = roles["interior-object"];
		expect(interior.sunVector.x).toBe(0);
		expect(interior.sunVector.y).toBe(0);
		expect(interior.sunVector.z).toBe(0);
		expect(interior.ambientLevel).toBe(roles["outdoor-object"].ambientLevel);
	});

	it("keeps sun and ambient colors shared across roles", () => {
		const roles = resolveSceneLightingByRole(LIGHTING);
		for (const role of [
			"terrain",
			"outdoor-object",
			"interior-object",
		] as const) {
			expect(roles[role].ambientColor).toBe(LIGHTING.ambientColor);
			expect(roles[role].sunColor).toBe(LIGHTING.sunColor);
		}
	});
});

describe("objectLightingRole", () => {
	it("routes cell contributions to the interior policy", () => {
		expect(objectLightingRole("env-cell-shell")).toBe("interior-object");
		expect(objectLightingRole("env-cell-resident")).toBe("interior-object");
	});

	it("routes every outdoor contribution to the sunlit policy", () => {
		expect(objectLightingRole("outdoor")).toBe("outdoor-object");
		expect(objectLightingRole("generated")).toBe("outdoor-object");
		expect(objectLightingRole("dynamic")).toBe("outdoor-object");
	});
});
