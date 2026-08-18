import { describe, expect, it } from "vitest";
import type { ResolvedMaterial } from "./presentation";
import {
	classifyObjectMaterialOrdering,
	planObjectMaterial,
} from "./object-material-planner";
import { TextureWrapMode } from "../textures/types";

describe("object material planning", () => {
	it("keeps additive separate from transparent source materials", () => {
		expect(classifyObjectMaterialOrdering(material(0x10000))).toBe("additive");
		expect(classifyObjectMaterialOrdering(material(0x100))).toBe("transparent");
		expect(classifyObjectMaterialOrdering(material(0x200))).toBe("transparent");
	});

	it("uses encoding to produce palette-safe indexed bindings", () => {
		const plan = planObjectMaterial(
			{
				...material(0),
				kind: "texture",
				colorTextureId: "0x05000001",
				renderSurfaceId: "0x06000001",
				paletteTextureId: "0x04000001",
				paletteComposite: null,
				textureEncoding: "index16",
			},
			TextureWrapMode.Repeat,
			"building",
		);
		expect(plan.baseTexture).toContain("object-index-16");
		expect(plan.paletteTexture).toContain("object-palette");
		expect(plan.textureRequirements).toEqual([
			{
				kind: "asset",
				key: plan.baseTexture,
				purpose: "object-index-16",
				sourceAssetId: "0x05000001",
			},
			{
				kind: "asset",
				key: plan.paletteTexture,
				purpose: "object-palette",
				sourceAssetId: "0x04000001",
			},
		]);
	});

	it("prepares a composited palette under its own identity, not the base palette", () => {
		const composite = {
			identity: "palette-composite:04000001:04000abc+18+8",
			basePaletteId: "0x04000001",
			ranges: [
				{
					replacementPaletteId: "0x04000abc",
					offset: 0x18,
					colorCount: 0x08,
				},
			],
		} as const;
		const plan = planObjectMaterial(
			{
				...material(0),
				kind: "texture",
				colorTextureId: "0x05000001",
				renderSurfaceId: "0x06000001",
				paletteTextureId: "0x04000001",
				paletteComposite: composite,
				textureEncoding: "index8",
			},
			TextureWrapMode.Repeat,
			null,
		);

		expect(plan.paletteTexture).toBe(
			`asset-texture:object-palette:${composite.identity}`,
		);
		expect(plan.textureRequirements[1]).toEqual({
			kind: "asset",
			key: plan.paletteTexture,
			purpose: "object-palette",
			sourceAssetId: composite.identity,
			paletteComposite: composite,
		});
	});

	it("gives two range sets over one base palette distinct palette textures", () => {
		const plan = (identity: string) =>
			planObjectMaterial(
				{
					...material(0),
					kind: "texture",
					colorTextureId: "0x05000001",
					renderSurfaceId: "0x06000001",
					paletteTextureId: "0x04000001",
					paletteComposite: {
						identity,
						basePaletteId: "0x04000001",
						ranges: [],
					},
					textureEncoding: "index8",
				},
				TextureWrapMode.Repeat,
				null,
			);

		expect(plan("composite:a").paletteTexture).not.toBe(
			plan("composite:b").paletteTexture,
		);
		expect(plan("composite:a").paletteTexture).toBe(
			plan("composite:a").paletteTexture,
		);
	});

	it("keeps logical textures distinct and preserves paletted clip-map facts", () => {
		const first = planObjectMaterial(
			texturedMaterial("0x05000001", 0x04),
			TextureWrapMode.Clamp,
			null,
		);
		const second = planObjectMaterial(
			texturedMaterial("0x05000002", 0x04),
			TextureWrapMode.Clamp,
			null,
		);

		expect(first.id).not.toBe(second.id);
		expect(first.palettedClipMap).toBe(true);
		expect(second.palettedClipMap).toBe(true);
	});

	it("gives identical source facts a traversal-independent binding key", () => {
		const input = texturedMaterial("0x05000001", 0);
		expect(planObjectMaterial(input, TextureWrapMode.Repeat, null).id).toBe(
			planObjectMaterial({ ...input }, TextureWrapMode.Repeat, null).id,
		);
	});

	it("retains the owning detail domain independently of raw surface flags", () => {
		expect(
			planObjectMaterial(
				texturedMaterial("0x05000001", 0),
				TextureWrapMode.Clamp,
				"building",
			).detailRole,
		).toBe("building");
		expect(
			planObjectMaterial(
				texturedMaterial("0x05000001", 0x20000),
				TextureWrapMode.Clamp,
				"environment",
			).detailRole,
		).toBe("environment");
		expect(
			planObjectMaterial(
				texturedMaterial("0x05000001", 0x20000),
				TextureWrapMode.Clamp,
				null,
			).detailRole,
		).toBeNull();
	});

	it("keeps otherwise identical bindings distinct by detail role", () => {
		const input = texturedMaterial("0x05000001", 0);
		expect(
			planObjectMaterial(input, TextureWrapMode.Repeat, "building").id,
		).not.toBe(planObjectMaterial(input, TextureWrapMode.Repeat, null).id);
	});

	it("fails indexed material planning without a palette", () => {
		expect(() =>
			planObjectMaterial(
				{
					...material(0),
					kind: "texture",
					colorTextureId: "0x05000001",
					renderSurfaceId: "0x06000001",
					paletteTextureId: null,
					paletteComposite: null,
					textureEncoding: "index8",
				},
				TextureWrapMode.Clamp,
				null,
			),
		).toThrow("no palette dependency");
	});
});

function material(rawSurfaceFlags: number): ResolvedMaterial {
	return {
		id: "material:surface/08000001",
		kind: "solid-color",
		color: [1, 1, 1, 1],
		rawSurfaceFlags,
		translucency: 0,
		luminosity: 0,
		diffuseScale: 1,
	};
}

function texturedMaterial(
	colorTextureId: string,
	rawSurfaceFlags: number,
): ResolvedMaterial {
	return {
		...material(rawSurfaceFlags),
		kind: "texture",
		colorTextureId,
		renderSurfaceId: "0x06000001",
		paletteTextureId: "0x04000001",
		paletteComposite: null,
		textureEncoding: "index8",
	};
}
