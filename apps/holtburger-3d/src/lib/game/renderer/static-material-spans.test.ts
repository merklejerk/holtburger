import { describe, expect, it } from "vitest";
import { compileStaticMaterialSpans } from "./static-material-spans";
import type { PreparedStaticObjectDrawCompatibility } from "./object-rendering-policy";
import type { ObjectMaterialOrdering } from "../resolution/object-material-planner";

function range(
	indexStart: number,
	overrides: Partial<
		PreparedStaticObjectDrawCompatibility<string, string, string>
	> = {},
	ordering: ObjectMaterialOrdering = "opaque",
) {
	return {
		indexStart,
		indexCount: 3,
		ordering,
		retailVisibility: "normally-visible" as const,
		compatibility: {
			geometry: "geometry",
			indexStart,
			indexCount: 3,
			cullFace: "back",
			detail: null,
			material: {
				kind: "direct-color",
				color: [1, 1, 1, 1],
				base: { texture: "atlas", sampler: "sampler", rect: [0, 0, 16, 16] },
			},
			alphaTest: 0,
			luminosity: 0,
			palettedClipMap: false,
			wrapRepeat: false,
			...overrides,
		} satisfies PreparedStaticObjectDrawCompatibility<string, string, string>,
	};
}

describe("compileStaticMaterialSpans", () => {
	it("merges contiguous rows with distinct surface values without mutating source ranges", () => {
		const a = range(0),
			b = range(3, {
				luminosity: 0.5,
				wrapRepeat: true,
				material: {
					kind: "direct-color",
					color: [0.2, 0.4, 0.8, 1],
					base: { texture: "atlas", sampler: "sampler", rect: [32, 0, 16, 16] },
				},
			});
		const merged = compileStaticMaterialSpans([a, b, range(6)]);
		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({
			indexStart: 0,
			indexCount: 9,
			compatibility: { indexCount: 9 },
		});
		expect(a.indexCount).toBe(3);
	});
	it.each([
		range(6),
		range(3, { geometry: "other" }),
		range(3, { cullFace: "front" }),
		range(3, {
			detail: {
				texture: "detail",
				sampler: "sampler",
				rect: [0, 0, 1, 1],
				tiling: 2,
			},
		}),
		range(3, {
			material: {
				kind: "direct-color",
				color: [1, 1, 1, 1],
				base: { texture: "other", sampler: "sampler", rect: [0, 0, 16, 16] },
			},
		}),
		range(3, {
			material: {
				kind: "direct-color",
				color: [1, 1, 1, 1],
				base: { texture: "atlas", sampler: "other", rect: [0, 0, 16, 16] },
			},
		}),
		{ ...range(3), retailVisibility: "degrade-hidden" as const },
		range(3, {}, "alpha-test"),
	])(
		"preserves physical, visibility, ordering and index barriers %#",
		(barrier) => {
			expect(compileStaticMaterialSpans([range(0), barrier])).toEqual([
				range(0),
				barrier,
			]);
		},
	);
	it.each(["transparent", "additive"] as const)(
		"preserves authored %s range granularity",
		(ordering) => {
			const ranges = [range(0, {}, ordering), range(3, {}, ordering)];
			expect(compileStaticMaterialSpans(ranges)).toEqual(ranges);
		},
	);
});
