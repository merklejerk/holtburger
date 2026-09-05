import { Vec3 } from "../math/types";
import { describe, expect, it } from "vitest";
import type { DynamicAppearance } from "../systems/dynamic-appearance";
import { TextureWrapMode } from "../textures/types";
import type { PreparedObjectSurface } from "./object-rendering-policy";
import { compileDynamicIndexBatches } from "./dynamic-index-batches";

function surface(page: string): PreparedObjectSurface<string, string> {
	return {
		material: {
			kind: "index8",
			color: [1, 1, 1, 1],
			base: { texture: page, sampler: "exact", rect: [0, 0, 4, 4] },
			palette: { texture: "palette", sampler: "exact", rect: [0, 0, 256, 1] },
		},
		alphaTest: 0,
		luminosity: 0,
		palettedClipMap: false,
		wrapRepeat: false,
	};
}

function appearance(): DynamicAppearance {
	return {
		materials: [0, 1, 2].map(() => ({
			source: {
				id: "material:test",
				kind: "texture",
				colorTextureId: "0x05000001",
				renderSurfaceId: "0x06000001",
				paletteTextureId: "0x04000001",
				paletteComposite: null,
				textureEncoding: "index8",
				rawSurfaceFlags: 0,
				translucency: 0,
				luminosity: 0,
				diffuseScale: 1,
			},
			detailRole: null,
			textures: { base: null, palette: null },
			sampler: { wrap: TextureWrapMode.Clamp },
			palettedClipMap: false,
		})),
		ranges: [0, 1, 2].map((selector) => ({
			transparentSort: { key: "fixture-order", center: Vec3.zero() },
			partSelector: selector,
			materialSelector: selector,
			indexStart: selector * 3,
			indexCount: 3,
			ordering: "opaque",
			polygon: { cullFace: "back", stippled: false },
			retailVisibility: "normally-visible",
		})),
	};
}

const sourceIndices = new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);

describe("dynamic physical index batches", () => {
	it.each([0x10000, 0x10100, 0x10200])(
		"packs additive source-only flags %i across material pages without changing logical ranges",
		(rawSurfaceFlags) => {
			const logical = appearance();
			const additive: DynamicAppearance = {
				materials: logical.materials.map((material) => ({
					...material,
					source: { ...material.source, rawSurfaceFlags },
				})),
				ranges: logical.ranges.map((range) => ({
					...range,
					ordering: "additive",
				})),
			};
			const result = compileDynamicIndexBatches(sourceIndices, additive, [
				surface("a"),
				surface("b"),
				surface("a"),
			]);
			expect(result.batches).toHaveLength(2);
			expect([...result.indices]).toEqual([0, 1, 2, 6, 7, 8, 3, 4, 5]);
			expect(result.batches.map((batch) => batch.indexCount)).toEqual([6, 3]);
			expect(result.ranges.map((range) => range.source)).toEqual(
				additive.ranges,
			);
		},
	);
	it("keeps a non-commutative additive-phase surface between matching additive batches", () => {
		const logical = appearance();
		const result = compileDynamicIndexBatches(
			sourceIndices,
			{
				materials: logical.materials.map((material, index) => ({
					...material,
					source: {
						...material.source,
						rawSurfaceFlags: index === 1 ? 0x10114 : 0x10100,
					},
				})),
				ranges: logical.ranges.map((range) => ({
					...range,
					ordering: "additive",
				})),
			},
			[surface("a"), surface("a"), surface("a")],
		);
		expect(result.batches).toHaveLength(3);
		expect(result.indices).toEqual(sourceIndices);
		expect(
			result.batches.map((batch) => batch.blendPolicy.destination),
		).toEqual(["one", "one-minus-src-alpha", "one"]);
	});
	it("joins non-adjacent compatible parts and retains remapped authored range order without duplicating indices", () => {
		const logical = appearance();
		const result = compileDynamicIndexBatches(sourceIndices, logical, [
			surface("a"),
			surface("b"),
			{ ...surface("a"), wrapRepeat: true, luminosity: 0.5 },
		]);
		expect(result.batches).toHaveLength(2);
		expect([...result.indices]).toEqual([0, 1, 2, 6, 7, 8, 3, 4, 5]);
		expect(result.indices.byteLength).toBe(sourceIndices.byteLength);
		expect(result.ranges.map((range) => range.indexStart)).toEqual([0, 6, 3]);
		expect(result.physicalRanges.map((range) => range.indexStart)).toEqual([
			0, 3, 6,
		]);
		expect(result.physicalRanges[1]).toBe(result.ranges[2]);
		expect(result.ranges.map((range) => range.source)).toEqual(logical.ranges);
		expect(result.ranges[0]?.batch).toBe(result.ranges[2]?.batch);
	});
	it.each(["transparent", "additive"] as const)(
		"retains separate ordered %s ranges",
		(ordering) => {
			const logical = appearance();
			const result = compileDynamicIndexBatches(
				sourceIndices,
				{
					...logical,
					ranges: logical.ranges.map((range) => ({ ...range, ordering })),
				},
				[surface("a"), surface("a"), surface("a")],
			);
			expect(result.batches).toHaveLength(3);
			expect(result.indices).toEqual(sourceIndices);
		},
	);
	it("partitions culling, visibility and authored phase", () => {
		const logical = appearance();
		for (const patch of [
			{ polygon: { cullFace: "front", stippled: false } },
			{ retailVisibility: "degrade-hidden" },
			{ ordering: "alpha-test" },
		] as const) {
			const ranges = logical.ranges.map((range, index) =>
				index === 1 ? { ...range, ...patch } : range,
			);
			const result = compileDynamicIndexBatches(
				sourceIndices,
				{ ...logical, ranges },
				[surface("a"), surface("a"), surface("a")],
			);
			expect(result.batches).toHaveLength(2);
		}
	});
	it("partitions physical palette pages and samplers but not atlas rectangles or colors", () => {
		const left = surface("a");
		if (left.material.kind !== "index8")
			throw new Error("Fixture requires indexed material.");
		const changedRect = {
			...left,
			material: {
				...left.material,
				color: [0.5, 0.25, 1, 1] as const,
				base: { ...left.material.base, rect: [8, 8, 4, 4] as const },
			},
		};
		expect(
			compileDynamicIndexBatches(sourceIndices, appearance(), [
				left,
				changedRect,
				left,
			]).batches,
		).toHaveLength(1);
		for (const palette of [
			{ ...left.material.palette, texture: "other" },
			{ ...left.material.palette, sampler: "other" },
		]) {
			expect(
				compileDynamicIndexBatches(sourceIndices, appearance(), [
					left,
					{ ...left, material: { ...left.material, palette } },
					left,
				]).batches,
			).toHaveLength(2);
		}
	});
	it("rejects missing selector surfaces and out-of-buffer ranges", () => {
		expect(() =>
			compileDynamicIndexBatches(sourceIndices, appearance(), []),
		).toThrow("missing material selector 0");
		expect(() =>
			compileDynamicIndexBatches(sourceIndices.subarray(0, 3), appearance(), [
				surface("a"),
				surface("a"),
				surface("a"),
			]),
		).toThrow("exceeds its source index buffer");
	});
});
