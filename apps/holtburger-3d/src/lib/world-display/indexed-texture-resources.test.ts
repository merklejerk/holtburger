import {
	DataTexture,
	NearestFilter,
	NoColorSpace,
	RedFormat,
	RGFormat,
} from "three";
import { describe, expect, it } from "vitest";

import type {
	PreparedMaterialRecipePayload,
	PreparedRenderSurfacePayload,
} from "../assets/types";
import {
	PIXEL_FORMAT_INDEX16,
	PIXEL_FORMAT_P8,
	createIndexedTextureResource,
	indexedTextureFormat,
	scanMaxPaletteIndex,
	selectIndexedPalette,
} from "./indexed-texture-resources";

describe("indexed texture resources", () => {
	it("classifies AC indexed render surface formats", () => {
		expect(indexedTextureFormat(PIXEL_FORMAT_P8)).toBe("p8");
		expect(indexedTextureFormat(PIXEL_FORMAT_INDEX16)).toBe("index16");
		expect(indexedTextureFormat(0x15)).toBeNull();
	});

	it("creates P8 index textures as one-channel non-color data", () => {
		const resource = createIndexedTextureResource(
			createRenderSurfacePayload({
				formatRaw: PIXEL_FORMAT_P8,
				format: "P8",
				width: 2,
				height: 2,
				sourceBytes: new Uint8Array([1, 2, 7, 4]),
			}),
		);

		expect(resource.format).toBe("p8");
		expect(resource.maxIndex).toBe(7);
		expect(resource.texture).toBeInstanceOf(DataTexture);
		expect(resource.texture.image).toMatchObject({ width: 2, height: 2 });
		expect(resource.texture.format).toBe(RedFormat);
		expect(resource.texture.colorSpace).toBe(NoColorSpace);
		expect(resource.texture.magFilter).toBe(NearestFilter);
		expect(resource.texture.minFilter).toBe(NearestFilter);
		expect(resource.texture.generateMipmaps).toBe(false);
		expect(Array.from(resource.texture.image.data as Uint8Array)).toEqual([
			1, 2, 7, 4,
		]);
	});

	it("creates Index16 index textures as byte-packed RG non-color data", () => {
		const resource = createIndexedTextureResource(
			createRenderSurfacePayload({
				formatRaw: PIXEL_FORMAT_INDEX16,
				format: "Index16",
				width: 2,
				height: 1,
				sourceBytes: new Uint8Array([0x34, 0x12, 0xff, 0x00]),
			}),
		);

		expect(resource.format).toBe("index16");
		expect(resource.maxIndex).toBe(0x1234);
		expect(resource.texture.image).toMatchObject({ width: 2, height: 1 });
		expect(resource.texture.format).toBe(RGFormat);
		expect(resource.texture.colorSpace).toBe(NoColorSpace);
		expect(Array.from(resource.texture.image.data as Uint8Array)).toEqual([
			0x34, 0x12, 0xff, 0x00,
		]);
	});

	it("rejects indexed surfaces with incorrect source length", () => {
		expect(() =>
			createIndexedTextureResource(
				createRenderSurfacePayload({
					formatRaw: PIXEL_FORMAT_INDEX16,
					format: "Index16",
					width: 2,
					height: 1,
					sourceBytes: new Uint8Array([0x01, 0x00]),
				}),
			),
		).toThrow(/expected 4 indexed source bytes/);
	});

	it("selects CSurface palette before render surface default palette", () => {
		const recipe = createTextureMaterialRecipe({
			paletteId: 0x04000001,
			renderSurfaceDefaultPaletteIds: [0x04000002],
		});
		const renderSurface = createRenderSurfacePayload({
			formatRaw: PIXEL_FORMAT_P8,
			format: "P8",
			defaultPaletteId: 0x04000002,
			sourceBytes: new Uint8Array([0]),
		});

		expect(selectIndexedPalette(recipe, renderSurface)).toEqual({
			paletteAssetId: "palette/04000001",
			paletteId: 0x04000001,
			source: "material-recipe",
		});
	});

	it("falls back to render surface default palette", () => {
		const recipe = createTextureMaterialRecipe({
			paletteId: null,
			renderSurfaceDefaultPaletteIds: [0x04000002],
		});
		const renderSurface = createRenderSurfacePayload({
			formatRaw: PIXEL_FORMAT_P8,
			format: "P8",
			defaultPaletteId: 0x04000002,
			sourceBytes: new Uint8Array([0]),
		});

		expect(selectIndexedPalette(recipe, renderSurface)).toEqual({
			paletteAssetId: "palette/04000002",
			paletteId: 0x04000002,
			source: "render-surface-default",
		});
	});

	it("returns no palette selection when neither source provides a palette", () => {
		const recipe = createTextureMaterialRecipe({
			paletteId: null,
			renderSurfaceDefaultPaletteIds: [],
		});
		const renderSurface = createRenderSurfacePayload({
			formatRaw: PIXEL_FORMAT_P8,
			format: "P8",
			defaultPaletteId: null,
			sourceBytes: new Uint8Array([0]),
		});

		expect(selectIndexedPalette(recipe, renderSurface)).toBeNull();
	});

	it("scans max palette index for both indexed encodings", () => {
		expect(scanMaxPaletteIndex(new Uint8Array([2, 9, 4]), "p8")).toBe(9);
		expect(
			scanMaxPaletteIndex(new Uint8Array([0x00, 0x01, 0x05, 0x00]), "index16"),
		).toBe(0x0100);
	});
});

function createRenderSurfacePayload(options: {
	formatRaw: number;
	format: string;
	sourceBytes: Uint8Array;
	width?: number;
	height?: number;
	defaultPaletteId?: number | null;
}): PreparedRenderSurfacePayload {
	return {
		kind: "render-surface",
		sourceAssetKind: "render-surface",
		residencyKind: "unknown",
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "render-surface",
			errorCode: null,
			detail: null,
		},
		renderSurfaceId: 0x06000001,
		unknown: 0,
		width: options.width ?? 1,
		height: options.height ?? 1,
		formatRaw: options.formatRaw,
		format: options.format,
		sourceByteLength: options.sourceBytes.byteLength,
		sourceBytes: options.sourceBytes,
		defaultPaletteId: options.defaultPaletteId ?? null,
		dependencies: {
			paletteAssetIds:
				options.defaultPaletteId === undefined ||
				options.defaultPaletteId === null
					? []
					: [
							`palette/${options.defaultPaletteId.toString(16).padStart(8, "0")}`,
						],
		},
	};
}

function createTextureMaterialRecipe(options: {
	paletteId: number | null;
	renderSurfaceDefaultPaletteIds: number[];
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
		surfaceType: 1,
		source: {
			kind: "texture",
			renderTextureId: 0x05000001,
			renderSurfaceIds: [0x06000001],
			paletteId: options.paletteId,
			renderSurfaceDefaultPaletteIds: options.renderSurfaceDefaultPaletteIds,
		},
		translucency: 0,
		luminosity: 0,
		diffuse: 1,
		dependencies: {
			renderTextureAssetIds: [],
			renderSurfaceAssetIds: ["render-surface/06000001"],
			paletteAssetIds: [
				...(options.paletteId === null
					? []
					: [`palette/${options.paletteId.toString(16).padStart(8, "0")}`]),
				...options.renderSurfaceDefaultPaletteIds.map(
					(paletteId) => `palette/${paletteId.toString(16).padStart(8, "0")}`,
				),
			],
		},
	};
}
