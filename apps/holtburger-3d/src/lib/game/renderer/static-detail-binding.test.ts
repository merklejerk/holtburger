import { describe, expect, it, vi } from "vitest";
import type { ResolvedMaterial } from "../resolution/presentation";
import { resolveStaticMaterialDetail } from "./static-detail-binding";

describe("static material detail binding", () => {
	it.each(["building", "environment", "object"] as const)(
		"resolves the planned %s role",
		(role) => {
			const resolve = vi.fn(() => ({ role }));

			expect(
				resolveStaticMaterialDetail(
					{ detailRole: role, source: material() },
					resolve,
				),
			).toEqual({ role });
			expect(resolve).toHaveBeenCalledExactlyOnceWith(role);
		},
	);

	it("skips lookup for an ineligible material", () => {
		const resolve = vi.fn(() => ({ role: "object" }));

		expect(
			resolveStaticMaterialDetail(
				{ detailRole: null, source: material() },
				resolve,
			),
		).toBeNull();
		expect(resolve).not.toHaveBeenCalled();
	});

	it("fails loudly when the planned role is unavailable", () => {
		expect(() =>
			resolveStaticMaterialDetail(
				{ detailRole: "environment", source: material() },
				() => null,
			),
		).toThrow("requires unavailable environment detail");
	});
});

function material(): ResolvedMaterial {
	return {
		color: [1, 1, 1, 1],
		diffuseScale: 1,
		id: "material:fixture",
		kind: "solid-color",
		luminosity: 0,
		rawSurfaceFlags: 0x20000,
		translucency: 0,
	};
}
