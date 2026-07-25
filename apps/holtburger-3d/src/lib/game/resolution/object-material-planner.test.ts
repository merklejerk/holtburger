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
		expect(classifyObjectMaterialOrdering(material(0x10))).toBe("transparent");
	});

	it("uses encoding to produce palette-safe indexed bindings", () => {
		const plan = planObjectMaterial(
			{
				...material(0),
				kind: "texture",
				colorTextureId: "0x05000001",
				paletteTextureId: "0x04000001",
				textureEncoding: "index16",
			},
			TextureWrapMode.Repeat,
		);
		expect(plan.baseTexture).toContain("object-index-16");
		expect(plan.paletteTexture).toContain("object-palette");
	});

	it("fails indexed material planning without a palette", () => {
		expect(() =>
			planObjectMaterial(
				{
					...material(0),
					kind: "texture",
					colorTextureId: "0x05000001",
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
