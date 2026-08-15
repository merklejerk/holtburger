import { describe, expect, it } from "vitest";
import type { TextureArrayBinding } from "../textures/texture-manager";
import {
	assertSharedTerrainRegion,
	type TerrainProgramInput,
} from "./terrain-program-input";

describe("assertSharedTerrainRegion", () => {
	it("accepts landblocks differing only in their per-landblock resources", () => {
		const pass = createProgramInput();
		expect(() =>
			assertSharedTerrainRegion(
				pass,
				{
					...pass,
					geometry: "geometry-resource:77",
					surfaceField: "texture-2d-resource:78",
				},
				"0xda56ffff",
			),
		).not.toThrow();
	});

	it("rejects a landblock composed against another region's lookup table", () => {
		const pass = createProgramInput();
		expect(() =>
			assertSharedTerrainRegion(
				pass,
				{ ...pass, composition: "texture-2d-resource:99" },
				"0xda56ffff",
			),
		).toThrow(/different active region/);
	});

	it("rejects a landblock using another region's landscape detail", () => {
		const pass = createProgramInput();
		expect(() =>
			assertSharedTerrainRegion(
				pass,
				{
					...pass,
					textures: { ...pass.textures, detail: "texture-2d-resource:99" },
				},
				"0xda56ffff",
			),
		).toThrow(/different active region/);
	});

	it.each(["colors", "blendMasks", "roadMasks"] as const)(
		"rejects a landblock using another region's %s array",
		(array) => {
			const pass = createProgramInput();
			expect(() =>
				assertSharedTerrainRegion(
					pass,
					{
						...pass,
						textures: {
							...pass.textures,
							[array]: createTextureArrayBinding("texture-array-resource:99"),
						},
					},
					"0xda56ffff",
				),
			).toThrow(/different active region/);
		},
	);
});

function createTextureArrayBinding(
	resource: TextureArrayBinding["resource"],
): TextureArrayBinding {
	return { resource, layersByAssetId: new Map() };
}

function createProgramInput(): TerrainProgramInput {
	return {
		geometry: "geometry-resource:1",
		surfaceField: "texture-2d-resource:2",
		composition: "texture-2d-resource:3",
		textures: {
			colors: createTextureArrayBinding("texture-array-resource:4"),
			blendMasks: createTextureArrayBinding("texture-array-resource:5"),
			roadMasks: createTextureArrayBinding("texture-array-resource:6"),
			detail: "texture-2d-resource:7",
		},
	};
}
