import { describe, expect, it } from "vitest";

import { portalTunnelRollRadians } from "./portal-transition-visual";

describe("portalTunnelRollRadians", () => {
	it("is deterministic, generation-keyed, and continuous at segment edges", () => {
		expect(portalTunnelRollRadians(7, 31.5)).toBe(
			portalTunnelRollRadians(7, 31.5),
		);
		expect(portalTunnelRollRadians(8, 31.5)).not.toBe(
			portalTunnelRollRadians(7, 31.5),
		);
		expect(portalTunnelRollRadians(7, 24 - 0.001)).toBeCloseTo(
			portalTunnelRollRadians(7, 24),
			4,
		);
	});

	it("rejects invalid identity and time inputs", () => {
		expect(() => portalTunnelRollRadians(-1, 0)).toThrow();
		expect(() => portalTunnelRollRadians(1, Number.NaN)).toThrow();
	});
});
