import { describe, expect, it } from "vitest";

import {
	describeTextureVelocitySignature,
	normalizeTextureVelocity,
} from "./texture-velocity";

describe("texture velocity", () => {
	it("normalizes zero velocity and produces stable signatures", () => {
		expect(normalizeTextureVelocity(null)).toBeNull();
		expect(normalizeTextureVelocity({ uSpeed: 0, vSpeed: -0 })).toBeNull();
		expect(describeTextureVelocitySignature(null)).toBe("uv:none");
		expect(
			describeTextureVelocitySignature({ uSpeed: 0.125, vSpeed: -0.25 }),
		).toBe("uv:0.125,-0.25");
	});
});
