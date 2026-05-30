import { describe, expect, it } from "vitest";

import type {
	AssetChannelState,
	PreparedAssetPayload,
	PreparedAssetRecord,
	PreparedMaterialRecipePayload,
	PreparedPalettePayload,
	PreparedRenderSurfacePayload,
} from "../assets/types";
import {
	PIXEL_FORMAT_INDEX16,
	PIXEL_FORMAT_P8,
	createIndexedTextureData,
	createNeighborPackedIndexedPayload,
	resolveIndexedMaterialData,
	selectIndexedPalette,
} from "./indexed-material-data";
import type { MaterialAppearanceContext } from "./material-appearance";
import { describeDerivedPaletteDataKey } from "./palette-data";
import { createDefaultMaterialTextureSamplingPolicy } from "./texture-sampling-policy";

describe("indexed material data", () => {
	it("extracts indexed render surface DTOs without Three resources", () => {
		const texture = createIndexedTextureData(
			createRenderSurfacePayload({
				formatRaw: PIXEL_FORMAT_INDEX16,
				format: "Index16",
				width: 2,
				height: 1,
				sourceBytes: new Uint8Array([0x34, 0x12, 0x07, 0x00]),
			}),
		);

		expect(texture).toMatchObject({
			renderSurfaceAssetId: "render-surface/06000001",
			renderSurfaceId: 0x06000001,
			width: 2,
			height: 1,
			format: "index16",
			maxIndex: 0x1234,
		});
		expect(Array.from(texture.sourceBytes)).toEqual([0x34, 0x12, 0x07, 0x00]);
	});

	it("packs P8 bilinear neighbor indices with repeat edge policy", () => {
		const texture = createIndexedTextureData(
			createRenderSurfacePayload({
				formatRaw: PIXEL_FORMAT_P8,
				format: "P8",
				width: 2,
				height: 2,
				sourceBytes: new Uint8Array([1, 2, 3, 4]),
			}),
		);

		const packed = createNeighborPackedIndexedPayload({
			texture,
			wrapS: "repeat",
			wrapT: "repeat",
		});

		expect(packed.format).toBe("p8-neighbor-rgba8");
		expect(Array.from(packed.data)).toEqual([
			1, 2, 3, 4,
			2, 1, 4, 3,
			3, 4, 1, 2,
			4, 3, 2, 1,
		]);
	});

	it("packs P16 bilinear neighbor indices with clamp edge policy", () => {
		const texture = createIndexedTextureData(
			createRenderSurfacePayload({
				formatRaw: PIXEL_FORMAT_INDEX16,
				format: "Index16",
				width: 2,
				height: 2,
				sourceBytes: new Uint8Array([
					0x01, 0x00,
					0x02, 0x00,
					0x00, 0x01,
					0x00, 0x02,
				]),
			}),
		);

		const packed = createNeighborPackedIndexedPayload({
			texture,
			wrapS: "clamp-to-edge",
			wrapT: "clamp-to-edge",
		});

		expect(packed.format).toBe("index16-neighbor-rgba16ui");
		expect(Array.from(packed.data)).toEqual([
			1, 2, 0x0100, 0x0200,
			2, 2, 0x0200, 0x0200,
			0x0100, 0x0200, 0x0100, 0x0200,
			0x0200, 0x0200, 0x0200, 0x0200,
		]);
	});

	it("selects setup appearance palette before recipe and default palettes", () => {
		const recipe = createTextureMaterialRecipe({
			paletteId: 0x04000001,
			renderSurfaceId: 0x06000001,
		});
		const renderSurface = createRenderSurfacePayload({
			formatRaw: PIXEL_FORMAT_P8,
			format: "P8",
			defaultPaletteId: 0x04000002,
			sourceBytes: new Uint8Array([0]),
		});

		expect(
			selectIndexedPalette({
				recipe,
				renderSurface,
				appearance: createAppearance({
					paletteId: 0x04000003,
				}),
			}),
		).toEqual({
			paletteAssetId: "palette/04000003",
			paletteId: 0x04000003,
			source: "appearance-override",
		});
	});

	it("resolves indexed material DTOs with derived palette dependencies", () => {
		const diagnostics: string[] = [];
		const materialAssetId = "material/08000001";
		const renderSurfaceAssetId = "render-surface/06000001";
		const assetState = createAssetState({
			[materialAssetId]: createPreparedAsset(
				materialAssetId,
				createTextureMaterialRecipe({
					paletteId: 0x04000001,
					renderSurfaceId: 0x06000001,
				}),
			),
			[renderSurfaceAssetId]: createPreparedAsset(
				renderSurfaceAssetId,
				createRenderSurfacePayload({
					formatRaw: PIXEL_FORMAT_P8,
					format: "P8",
					width: 2,
					height: 1,
					sourceBytes: new Uint8Array([1, 2]),
				}),
			),
			"palette/04000003": createPreparedAsset(
				"palette/04000003",
				createPalettePayload(0x04000003, [
					0xff000000,
					0xff111111,
					0xff222222,
					0xff333333,
				]),
			),
			"palette/04000004": createPreparedAsset(
				"palette/04000004",
				createPalettePayload(0x04000004, [
					0xff990000,
					0xffaa0000,
					0xff00bb00,
					0xff0000cc,
				]),
			),
		});

		const material = resolveIndexedMaterialData({
			assetState,
			slot: {
				slotIndex: 0,
				surfaceId: 0x08000001,
				materialAssetId,
				materialVariantSignature: "sampler=repeat",
			},
			appearance: createAppearance({
				paletteId: 0x04000003,
				subPalettes: [{ subId: 0x04000004, offset: 1, numColors: 2 }],
			}),
			samplingPolicy: createDefaultMaterialTextureSamplingPolicy().indexed,
			reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic.key),
		});

		expect(diagnostics).toEqual([]);
		expect(material?.paletteSelection).toMatchObject({
			paletteAssetId: "palette/04000003",
			source: "appearance-override",
		});
		expect(material?.palette.colorsArgb[1]).toBe(0xffaa0000);
		expect(material?.palette.colorsArgb[2]).toBe(0xff00bb00);
		expect(material?.preparedAssetIds).toEqual([
			"material/08000001",
			"palette/04000003",
			"palette/04000004",
			"render-surface/06000001",
		]);
	});

	it("reports missing subpalettes before an indexed material DTO is resolved", () => {
		const diagnostics: string[] = [];
		const materialAssetId = "material/08000001";
		const material = resolveIndexedMaterialData({
			assetState: createAssetState({
				[materialAssetId]: createPreparedAsset(
					materialAssetId,
					createTextureMaterialRecipe({
						paletteId: 0x04000001,
						renderSurfaceId: 0x06000001,
					}),
				),
				"render-surface/06000001": createPreparedAsset(
					"render-surface/06000001",
					createRenderSurfacePayload({
						formatRaw: PIXEL_FORMAT_P8,
						format: "P8",
						sourceBytes: new Uint8Array([0]),
					}),
				),
				"palette/04000001": createPreparedAsset(
					"palette/04000001",
					createPalettePayload(0x04000001, [0xff000000, 0xffffffff]),
				),
			}),
			slot: {
				slotIndex: 0,
				surfaceId: 0x08000001,
				materialAssetId,
				materialVariantSignature: null,
			},
			appearance: createAppearance({
				subPalettes: [{ subId: 0x04000002, offset: 0, numColors: 1 }],
			}),
			samplingPolicy: createDefaultMaterialTextureSamplingPolicy().indexed,
			reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic.key),
		});

		expect(material).toBeNull();
		expect(diagnostics).toContain(
			"derived-palette-subpalette-unprepared:palette/04000001:palette/04000002",
		);
	});

	it("keys derived palettes by base palette, subpalette ranges, and prepared state", () => {
		const firstPreparedByAssetId = {
			"palette/04000001": createPreparedAsset(
				"palette/04000001",
				createPalettePayload(0x04000001, [0xff000000, 0xffffffff]),
				"2026-05-29T00:00:00.000Z",
			),
			"palette/04000002": createPreparedAsset(
				"palette/04000002",
				createPalettePayload(0x04000002, [0xff111111, 0xff222222]),
				"2026-05-29T00:00:00.000Z",
			),
		};
		const refreshedPreparedByAssetId = {
			...firstPreparedByAssetId,
			"palette/04000002": createPreparedAsset(
				"palette/04000002",
				createPalettePayload(0x04000002, [0xff333333, 0xff444444]),
				"2026-05-29T00:00:01.000Z",
			),
		};
		const paletteView = {
			paletteId: null,
			subPalettes: [{ subId: 0x04000002, offset: 0, numColors: 1 }],
		};

		const firstKey = describeDerivedPaletteDataKey({
			basePaletteAssetId: "palette/04000001",
			basePaletteAsset: firstPreparedByAssetId["palette/04000001"],
			paletteView,
			preparedByAssetId: firstPreparedByAssetId,
		});
		const refreshedKey = describeDerivedPaletteDataKey({
			basePaletteAssetId: "palette/04000001",
			basePaletteAsset: refreshedPreparedByAssetId["palette/04000001"],
			paletteView,
			preparedByAssetId: refreshedPreparedByAssetId,
		});

		expect(firstKey).toContain("palette/04000002:0:1");
		expect(refreshedKey).not.toBe(firstKey);
	});
});

function createAssetState(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
): AssetChannelState {
	return {
		channel: "test",
		status: "ready",
		activeRequest: null,
		preparedAsset: null,
		preparedByPriority: {
			bootstrap: null,
			streaming: null,
			prefetch: null,
		},
		preparedByAssetId,
		cacheMetadataByAssetId: {},
		cacheDiagnostics: null,
		lastResponse: null,
		errorMessage: null,
		history: [],
	};
}

function createAppearance(options: {
	paletteId?: number | null;
	subPalettes?: { subId: number; offset: number; numColors: number }[];
}): MaterialAppearanceContext {
	return {
		appearanceKey: "test-appearance",
		selectedPartsSignature: null,
		textureSwapSignature: null,
		paletteViewSignature: null,
		paletteView:
			options.paletteId === undefined && !options.subPalettes?.length
				? null
				: {
						paletteId: options.paletteId ?? null,
						subPalettes: options.subPalettes ?? [],
					},
	};
}

function createPreparedAsset<TPayload extends PreparedAssetPayload>(
	assetId: string,
	payload: TPayload,
	preparedAt = "2026-05-29T00:00:00.000Z",
): PreparedAssetRecord {
	return {
		request: {
			requestId: `request-${assetId}`,
			assetId,
			priority: "bootstrap",
		},
		response: {
			requestId: `request-${assetId}`,
			assetId,
			payloadKind: "json",
			payload,
		},
		payload,
		preparedAt,
	};
}

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
		provenance: createProvenance("render-surface"),
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
							`palette/${options.defaultPaletteId
								.toString(16)
								.padStart(8, "0")}`,
						],
		},
	};
}

function createTextureMaterialRecipe(options: {
	paletteId: number | null;
	renderSurfaceId: number;
}): PreparedMaterialRecipePayload {
	return {
		kind: "material-recipe",
		sourceAssetKind: "material-recipe",
		residencyKind: "unknown",
		provenance: createProvenance("material-recipe"),
		surfaceId: 0x08000001,
		surfaceType: 1,
		source: {
			kind: "texture",
			surfaceTextureId: 0x05000001,
			selectedRenderSurfaceId: options.renderSurfaceId,
			paletteId: options.paletteId,
			renderSurfaceDefaultPaletteIds: [],
		},
		translucency: 0,
		luminosity: 0,
		diffuse: 1,
		dependencies: {
			surfaceTextureAssetIds: [],
			renderSurfaceAssetIds: [
				`render-surface/${options.renderSurfaceId
					.toString(16)
					.padStart(8, "0")}`,
			],
			paletteAssetIds:
				options.paletteId === null
					? []
					: [
							`palette/${options.paletteId
								.toString(16)
								.padStart(8, "0")}`,
						],
		},
	};
}

function createPalettePayload(
	paletteId: number,
	colorsArgb: number[],
): PreparedPalettePayload {
	return {
		kind: "palette",
		sourceAssetKind: "palette",
		residencyKind: "unknown",
		provenance: createProvenance("palette"),
		paletteId,
		colorCount: colorsArgb.length,
		colorsArgb: Uint32Array.from(colorsArgb),
	};
}

function createProvenance(sourceAssetKind: string) {
	return {
		source: "repo-local-hba" as const,
		sourceAssetKind,
		errorCode: null,
		detail: null,
	};
}
