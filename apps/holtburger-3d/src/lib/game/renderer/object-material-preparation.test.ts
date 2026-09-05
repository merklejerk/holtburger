import { describe, expect, it, vi } from "vitest";
import type { ObjectMaterialBinding } from "../commit/artifacts";
import {
	createAssetTextureKey,
	TexturePurpose,
	TextureWrapMode,
} from "../textures/types";
import { prepareObjectSurface } from "./object-material-preparation";
import {
	createDynamicMaterialTable,
	DYNAMIC_MATERIAL_TEXELS,
} from "./dynamic-material-table";

const base = createAssetTextureKey(TexturePurpose.ObjectIndex8, "0x06000001");
const palette = createAssetTextureKey(
	TexturePurpose.ObjectPalette,
	"0x04000001",
);

function binding(): Omit<ObjectMaterialBinding, "polygon"> {
	return {
		source: {
			id: "material:test",
			kind: "texture",
			colorTextureId: "0x05000001",
			renderSurfaceId: "0x06000001",
			paletteTextureId: "0x04000001",
			paletteComposite: null,
			textureEncoding: "index8",
			rawSurfaceFlags: 0,
			translucency: 0.25,
			luminosity: 0.5,
			diffuseScale: 0.1,
		},
		detailRole: null,
		textures: { base, palette },
		sampler: { wrap: TextureWrapMode.Repeat },
		palettedClipMap: true,
	};
}

describe("object surface preparation and dynamic table encoding", () => {
	it.each(["index8", "index16", "direct-color"] as const)(
		"preserves %s sampling and surface policy",
		(textureEncoding) => {
			const input = binding();
			if (input.source.kind !== "texture")
				throw new Error("Fixture must be textured.");
			const resolve = vi.fn((key: typeof base) => ({
				texture: key,
				sampler: "sampler",
				rect: [4, 8, 16, 32] as const,
			}));
			const surface = prepareObjectSurface(
				{ ...input, source: { ...input.source, textureEncoding } },
				"alpha-test",
				resolve,
			);
			expect(resolve).toHaveBeenNthCalledWith(
				1,
				base,
				textureEncoding === "direct-color" ? "filterable" : "exact",
			);
			if (textureEncoding === "direct-color")
				expect(resolve).toHaveBeenCalledTimes(1);
			else expect(resolve).toHaveBeenNthCalledWith(2, palette, "exact");
			expect(surface.material.color).toEqual([1, 1, 1, 0.75]);
			expect(surface).toMatchObject({
				alphaTest: 200 / 255,
				luminosity: 0.5,
				palettedClipMap: true,
				wrapRepeat: true,
			});
			const data = createDynamicMaterialTable([surface]);
			expect(data).toHaveLength(DYNAMIC_MATERIAL_TEXELS * 4);
			expect([...data.slice(0, 8)]).toEqual([1, 1, 1, 0.75, 4, 8, 16, 32]);
			expect(data[12]).toBe(
				{ "direct-color": 1, index8: 2, index16: 3 }[textureEncoding],
			);
			expect([...data.slice(13, 16)]).toEqual([1, 1, 0.5]);
			expect(data[16]).toBeCloseTo(surface.alphaTest);
		},
	);
	it("multiplies solid alpha by source opacity without applying diffuse scale or resolving textures", () => {
		const input = binding();
		const resolve = vi.fn();
		const surface = prepareObjectSurface(
			{
				...input,
				source: {
					id: "material:solid",
					kind: "solid-color",
					color: [0.5, 0.25, 1, 0.5],
					rawSurfaceFlags: 0,
					translucency: 0.5,
					luminosity: 0,
					diffuseScale: 0.1,
				},
			},
			"alpha-test",
			resolve,
		);
		expect(resolve).not.toHaveBeenCalled();
		expect(surface.material).toEqual({
			kind: "solid-color",
			color: [0.5, 0.25, 1, 0.25],
		});
		expect(surface.alphaTest).toBe(0);
		expect([...createDynamicMaterialTable([surface]).slice(4, 13)]).toEqual(
			new Array(9).fill(0),
		);
	});
	it.each(["base", "palette"] as const)(
		"rejects missing %s bindings",
		(role) => {
			const input = binding();
			expect(() =>
				prepareObjectSurface(
					{ ...input, textures: { ...input.textures, [role]: null } },
					"opaque",
					() => ({
						texture: "texture",
						sampler: "sampler",
						rect: [0, 0, 1, 1],
					}),
				),
			).toThrow(`has no ${role} texture`);
		},
	);
	it("re-encodes relocated atlas coordinates without changing logical material inputs", () => {
		const input = binding();
		const prepare = (x: number) =>
			prepareObjectSurface(input, "opaque", () => ({
				texture: "page",
				sampler: "sampler",
				rect: [x, 2, 3, 4],
			}));
		const first = createDynamicMaterialTable([prepare(1), prepare(9)]);
		expect(first[4]).toBe(1);
		expect(first[DYNAMIC_MATERIAL_TEXELS * 4 + 4]).toBe(9);
		expect(first[16]).toBe(0);
	});
});
