import { describe, expect, it } from "vitest";

import { resolveRegionDetailRolePolicy } from "./region-detail-overlays";

describe("region detail overlays", () => {
	it("exposes typed detail role policies and keeps object detail disabled", () => {
		expect(resolveRegionDetailRolePolicy("landscape")).toEqual({
			roleKind: "landscape",
			blendMode: "src-alpha",
			fadeMode: "distance",
		});
		expect(resolveRegionDetailRolePolicy("building")).toEqual({
			roleKind: "building",
			blendMode: "dst-color",
			fadeMode: "constant",
		});
		expect(resolveRegionDetailRolePolicy("environment")).toEqual({
			roleKind: "environment",
			blendMode: "dst-color",
			fadeMode: "constant",
		});
		expect(resolveRegionDetailRolePolicy("object")).toBeNull();
	});
});
