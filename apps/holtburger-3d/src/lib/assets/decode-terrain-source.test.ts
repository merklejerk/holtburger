import { describe, expect, it } from "vitest";
import { decodeTerrainSource } from "./decode-terrain-source";
import type { LandblockId } from "../game/game-types";

const LANDBLOCK_ID = "0x0102ffff" as LandblockId;

describe("decodeTerrainSource", () => {
	it("decodes canonical terrain-grid sections and source composition", () => {
		const source = decodeTerrainSource(terrainResponse(), LANDBLOCK_ID);

		expect(source).not.toBeNull();
		expect(source?.generation.heightIndices).toEqual(
			new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
		);
		expect(source?.generation.heights).toEqual(
			new Float32Array([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5]),
		);
		expect(source?.generation.terrainSamples).toEqual(
			new Uint16Array([9, 10, 11, 12, 13, 14, 15, 16, 17]),
		);
		expect(source?.presentation.textures.colors.sourceAssetIds).toEqual([
			"surface-texture/0x05000001",
		]);
	});

	it("rejects a response for another landblock", () => {
		expect(() =>
			decodeTerrainSource(
				terrainResponse({ landblockId: "0x0103ffff" }),
				LANDBLOCK_ID,
			),
		).toThrow("returned 0x0103ffff");
	});

	it("rejects a truncated binary response", () => {
		const response = terrainResponse();
		expect(() =>
			decodeTerrainSource(response.subarray(0, -1), LANDBLOCK_ID),
		).toThrow("header declares");
	});

	it("rejects non-finite resolved heights", () => {
		expect(() =>
			decodeTerrainSource(
				terrainResponse({ heights: [Infinity, 1, 2, 3, 4, 5, 6, 7, 8] }),
				LANDBLOCK_ID,
			),
		).toThrow("non-finite");
	});

	it("rejects an invalid terrain texture identity before deriving texture facts", () => {
		expect(() =>
			decodeTerrainSource(
				terrainResponse({ colorTextureId: "render-surface/0x06000001" }),
				LANDBLOCK_ID,
			),
		).toThrow("invalid terrain material");
	});

	it("accepts only a missing outdoor record as a terrain-absent result", () => {
		expect(
			decodeTerrainSource(
				terrainResponse({
					terrain: null,
					terrainAvailability: "missing-cell-landblock",
				}),
				LANDBLOCK_ID,
			),
		).toBeNull();
		expect(() =>
			decodeTerrainSource(
				terrainResponse({
					terrain: null,
					terrainAvailability: "cell-landblock-decode-failed",
				}),
				LANDBLOCK_ID,
			),
		).toThrow("cell-landblock-decode-failed");
	});
});

function terrainResponse(
	options: {
		readonly colorTextureId?: string;
		readonly heights?: readonly number[];
		readonly landblockId?: string;
		readonly terrain?: { readonly gridSize: number; readonly tileSize: number } | null;
		readonly terrainAvailability?:
			| "available"
			| "missing-cell-landblock"
			| "cell-landblock-decode-failed"
			| "terrain-assembly-failed";
	} = {},
): Uint8Array {
	const heightIndices = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
	const heights = options.heights ?? [
		0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5,
	];
	const terrainSamples = new Uint16Array([9, 10, 11, 12, 13, 14, 15, 16, 17]);
	const heightsOffset = 12;
	const terrainSamplesOffset =
		heightsOffset + heights.length * Float32Array.BYTES_PER_ELEMENT;
	const sectionBytes = new Uint8Array(
		terrainSamplesOffset + terrainSamples.byteLength,
	);
	sectionBytes.set(heightIndices, 0);
	for (const [index, height] of heights.entries()) {
		new DataView(sectionBytes.buffer).setFloat32(
			heightsOffset + index * Float32Array.BYTES_PER_ELEMENT,
			height,
			true,
		);
	}
	sectionBytes.set(new Uint8Array(terrainSamples.buffer), terrainSamplesOffset);
	const manifest = new TextEncoder().encode(
		JSON.stringify({
			byteOrder: "little-endian",
			composition: terrainComposition(options),
			landblockId: options.landblockId ?? LANDBLOCK_ID,
			regionNumber: 1,
			sectionByteOffsetBase: "section-data",
			sections: [
				{
					byteLength: heightIndices.byteLength,
					byteOffset: 0,
					elementCount: heightIndices.length,
					name: "heightIndices",
					scalarType: "u8",
				},
				{
					byteLength: heights.length * Float32Array.BYTES_PER_ELEMENT,
					byteOffset: heightsOffset,
					elementCount: heights.length,
					name: "heights",
					scalarType: "f32",
				},
				{
					byteLength: terrainSamples.byteLength,
					byteOffset: terrainSamplesOffset,
					elementCount: terrainSamples.length,
					name: "terrainSamples",
					scalarType: "u16",
				},
			],
			terrain: options.terrain === undefined ? { gridSize: 3, tileSize: 24 } : options.terrain,
			terrainAvailability:
				options.terrainAvailability ??
				(options.terrain === null ? "missing-cell-landblock" : "available"),
			transport: "holtburger-terrain-source",
			version: 1,
		}),
	);
	const manifestLength = Math.ceil((16 + manifest.length) / 4) * 4 - 16;
	const response = new Uint8Array(16 + manifestLength + sectionBytes.length);
	response.set(new TextEncoder().encode("HBTR"), 0);
	const view = new DataView(response.buffer);
	view.setUint32(4, 1, true);
	view.setUint32(8, manifestLength, true);
	view.setUint32(12, response.byteLength, true);
	response.set(manifest, 16);
	response.fill(0x20, 16 + manifest.length, 16 + manifestLength);
	response.set(sectionBytes, 16 + manifestLength);
	return response;
}

function terrainComposition(options: { readonly colorTextureId?: string }) {
	return {
		cornerTerrainAlphaMaps: [
			{ blendMaskTextureId: "surface-texture/0x05000002", terrainCode: 1 },
		],
		landscapeDetail: { textureId: "surface-texture/0x05000005", tiling: 4 },
		regionNumber: 1,
		roadAlphaMaps: [
			{ roadCode: 1, roadMaskTextureId: "surface-texture/0x05000004" },
		],
		sideTerrainAlphaMaps: [
			{ blendMaskTextureId: "surface-texture/0x05000003", terrainCode: 2 },
		],
		terrainTypes: [
			{
				colorTextureId: options.colorTextureId ?? "surface-texture/0x05000001",
				colorVariation: {
					maxVertexBrightness: 0,
					maxVertexHue: 0,
					maxVertexSaturation: 0,
					minVertexBrightness: 0,
					minVertexHue: 0,
					minVertexSaturation: 0,
				},
				terrainType: 0,
				tiling: 1,
			},
		],
	};
}
