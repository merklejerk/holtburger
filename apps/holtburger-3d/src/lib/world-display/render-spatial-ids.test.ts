import { describe, expect, it } from "vitest";

import {
	debugCellSpatialItemId,
	portalSpatialItemId,
	structuredCellSpatialItemId,
	terrainSpatialItemId,
} from "./render-spatial-ids";

describe("render spatial ids", () => {
	it("derives deterministic item ids from scene identities", () => {
		expect(terrainSpatialItemId("terrain/01020304")).toBe(
			"terrain:terrain/01020304",
		);
		expect(structuredCellSpatialItemId("016c0155:00000001")).toBe(
			"structured-cell:016c0155:00000001",
		);
		expect(debugCellSpatialItemId("016c0155:00000001")).toBe(
			"debug-cell:016c0155:00000001",
		);
		expect(portalSpatialItemId("portal/016c0155/0")).toBe(
			"portal:portal/016c0155/0",
		);
	});
});
