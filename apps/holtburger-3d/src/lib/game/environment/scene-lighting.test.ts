import { describe, expect, it } from "vitest";
import { Vec3 } from "../math/types";
import type { ResolvedSceneLighting } from "./scene-environment";
import {
	OBJECT_AMBIENT_SUN_SCALE,
	objectLightingRole,
	resolveAuthoredLightResponse,
	resolveSceneLightingByRole,
	SEALED_INTERIOR_AMBIENT,
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

describe("sealed interior ambient", () => {
	it("forces retail's flat white ambient when the camera cannot see outdoors", () => {
		const interior = resolveSceneLightingByRole(LIGHTING, true)[
			"interior-object"
		];
		expect(interior.ambientLevel).toBe(SEALED_INTERIOR_AMBIENT.level);
		expect(interior.ambientColor).toEqual(SEALED_INTERIOR_AMBIENT.color);
	});

	it("keeps the regional ambient for a cell that can see outdoors", () => {
		const interior = resolveSceneLightingByRole(LIGHTING, false)[
			"interior-object"
		];
		expect(interior.ambientLevel).not.toBe(SEALED_INTERIOR_AMBIENT.level);
		expect(interior.ambientColor).toBe(LIGHTING.ambientColor);
	});

	it("never applies the interior override to outdoor draws", () => {
		const roles = resolveSceneLightingByRole(LIGHTING, true);
		expect(roles["outdoor-object"].ambientColor).toBe(LIGHTING.ambientColor);
		expect(roles.terrain.ambientLevel).toBe(LIGHTING.ambientLevel);
	});
});

describe("resolveAuthoredLightResponse", () => {
	// Retail's outdoor pass never rendered authored lamps at all, so the daytime half of this
	// policy is ours: a lamp must not pin midday ground to full white.
	it("passes authored lamps through in the dark and suppresses them at noon", () => {
		const night = resolveAuthoredLightResponse({
			ambientLevel: 0.4,
			ambientColor: { red: 1, green: 0.39, blue: 0.78, alpha: 1 },
			sunVector: new Vec3(0.25, 0, 0),
			sunColor: { red: 0.86, green: 0.86, blue: 0.86, alpha: 1 },
		});
		const noon = resolveAuthoredLightResponse({
			ambientLevel: 0.35,
			ambientColor: { red: 1, green: 0.9, blue: 0.9, alpha: 1 },
			sunVector: new Vec3(0.3, 0.71, 0),
			sunColor: { red: 0.59, green: 0.84, blue: 0.98, alpha: 1 },
		});
		expect(night).toBe(1);
		expect(noon).toBe(0);
	});

	it("ramps monotonically as the sun climbs", () => {
		const responses = [0, 0.2, 0.45, 0.71].map((height) =>
			resolveAuthoredLightResponse({
				ambientLevel: 0.35,
				ambientColor: { red: 1, green: 0.9, blue: 0.9, alpha: 1 },
				sunVector: new Vec3(0.3, height, 0),
				sunColor: { red: 0.59, green: 0.84, blue: 0.98, alpha: 1 },
			}),
		);
		for (let index = 1; index < responses.length; index += 1) {
			expect(responses[index]!).toBeLessThan(responses[index - 1]!);
		}
	});
});
