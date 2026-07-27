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
				textureEncoding: "index16",
			},
			TextureWrapMode.Repeat,
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

	it("keeps logical textures distinct and preserves paletted clip-map facts", () => {
		const first = planObjectMaterial(
			texturedMaterial("0x05000001", 0x04),
			TextureWrapMode.Clamp,
		);
		const second = planObjectMaterial(
			texturedMaterial("0x05000002", 0x04),
			TextureWrapMode.Clamp,
		);

		expect(first.id).not.toBe(second.id);
		expect(first.palettedClipMap).toBe(true);
		expect(second.palettedClipMap).toBe(true);
	});

	it("gives identical source facts a traversal-independent binding key", () => {
		const input = texturedMaterial("0x05000001", 0);
		expect(planObjectMaterial(input, TextureWrapMode.Repeat).id).toBe(
			planObjectMaterial({ ...input }, TextureWrapMode.Repeat).id,
		);
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
					textureEncoding: "index8",
				},
				TextureWrapMode.Clamp,
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
		textureEncoding: "index8",
	};
}
