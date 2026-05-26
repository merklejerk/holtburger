import {
	DataTexture,
	MeshStandardMaterial,
	RedFormat,
	RGBAFormat,
} from "three";
import { describe, expect, it } from "vitest";

import type { PreparedMaterialRecipePayload } from "../assets/types";
import type { IndexedTextureResource } from "./indexed-texture-resources";
import {
	createIndexedMaterialShaderPatch,
	createIndexedMeshStandardMaterial,
} from "./indexed-materials";
import {
	INDEXED_CLIP_MAP_ALPHA_TEST,
	isBase1ClipMapSurface,
} from "./material-behavior";
import type { PaletteTextureResource } from "./palette-resources";

describe("indexed materials", () => {
	it("creates a MeshStandardMaterial wired to indexed textures", () => {
		const material = createIndexedMeshStandardMaterial({
			recipe: createTextureMaterialRecipe({ surfaceType: 0x4 }),
			resources: {
				indexedTexture: createIndexedTextureResource("p8"),
				palette: createPaletteResource(),
			},
		});

		expect(material).toBeInstanceOf(MeshStandardMaterial);
		const standardMaterial = material as MeshStandardMaterial;
		expect(standardMaterial.map).toBeInstanceOf(DataTexture);
		expect(standardMaterial.transparent).toBe(true);
		expect(standardMaterial.alphaTest).toBe(INDEXED_CLIP_MAP_ALPHA_TEST);
		expect(standardMaterial.userData.holtburgerIndexedMaterial).toMatchObject({
			format: "p8",
			paletteColorCount: 2,
			clipThreshold: 8,
			alphaTest: INDEXED_CLIP_MAP_ALPHA_TEST,
		});
	});

	it("uses normalized client translucency for indexed material opacity", () => {
		const material = createIndexedMeshStandardMaterial({
			recipe: createTextureMaterialRecipe({
				surfaceType: 0x2,
				translucency: 0.25,
			}),
			resources: {
				indexedTexture: createIndexedTextureResource("p8"),
				palette: createPaletteResource(),
			},
		});

		const standardMaterial = material as MeshStandardMaterial;
		expect(standardMaterial.transparent).toBe(true);
		expect(standardMaterial.opacity).toBe(0.75);
	});

	it("patches map sampling with palette lookup and Index16 reconstruction", () => {
		const shaderPatch = createIndexedMaterialShaderPatch({
			indexedTexture: createIndexedTextureResource("index16"),
			paletteTexture: createPaletteResource().texture,
			paletteColorCount: 2,
			clipThreshold: 8,
		});
		const shader = {
			uniforms: {},
			fragmentShader: "void main() {\n#include <map_fragment>\n}",
		};

		shaderPatch.onBeforeCompile(shader);

		expect(shader.uniforms).toMatchObject({
			indexedPaletteMap: { value: expect.any(DataTexture) },
			indexedPaletteColorCount: { value: 2 },
			indexedFormat: { value: 1 },
			indexedClipThreshold: { value: 8 },
		});
		expect(shader.fragmentShader).toContain(
			"uniform sampler2D indexedPaletteMap",
		);
		expect(shader.fragmentShader).toContain(
			"uniform float indexedPaletteColorCount",
		);
		expect(shader.fragmentShader).toContain("uniform int indexedFormat");
		expect(shader.fragmentShader).toContain("uniform int indexedClipThreshold");
		expect(shader.fragmentShader).toContain("sampledIndexTexel.g");
		expect(shader.fragmentShader).toContain("texture2D( indexedPaletteMap");
		expect(shader.fragmentShader).toContain("discard");
		expect(shaderPatch.customProgramCacheKey()).toBe(
			"holtburger-indexed-material:index16:2:8",
		);
	});

	it("detects Base1ClipMap surface flags", () => {
		expect(isBase1ClipMapSurface(0x4)).toBe(true);
		expect(isBase1ClipMapSurface(0x14)).toBe(true);
		expect(isBase1ClipMapSurface(0x2)).toBe(false);
	});
});

function createIndexedTextureResource(
	format: "p8" | "index16",
): IndexedTextureResource {
	return {
		texture: new DataTexture(new Uint8Array([0, 1]), 1, 1, RedFormat),
		format,
		maxIndex: 1,
	};
}

function createPaletteResource(): PaletteTextureResource {
	return {
		texture: new DataTexture(new Uint8Array(8), 2, 1, RGBAFormat),
		colorCount: 2,
	};
}

function createTextureMaterialRecipe(options: {
	surfaceType: number;
	translucency?: number;
}): PreparedMaterialRecipePayload {
	return {
		kind: "material-recipe",
		sourceAssetKind: "material-recipe",
		residencyKind: "unknown",
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "material-recipe",
			errorCode: null,
			detail: null,
		},
		surfaceId: 0x08000001,
		surfaceType: options.surfaceType,
		source: {
			kind: "texture",
			renderTextureId: 0x05000001,
			renderSurfaceIds: [0x06000001],
			paletteId: 0x04000001,
			renderSurfaceDefaultPaletteIds: [],
		},
		translucency: options.translucency ?? 0,
		luminosity: 0,
		diffuse: 1,
		dependencies: {
			renderTextureAssetIds: [],
			renderSurfaceAssetIds: ["render-surface/06000001"],
			paletteAssetIds: ["palette/04000001"],
		},
	};
}
