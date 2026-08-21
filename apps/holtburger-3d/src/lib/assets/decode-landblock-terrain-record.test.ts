import { describe, expect, it } from "vitest";
import type { ActiveRegionSource } from "./active-region-source";
import { decodeLandblockTerrainRecord } from "./decode-landblock-terrain-record";
import type { LandblockId } from "../game/game-types";
import { resolveActiveRegionTerrainPresentation } from "../game/terrain/active-region-terrain-resolver";

const LANDBLOCK_ID = "0x0102ffff" as LandblockId;
const ACTIVE_REGION: ActiveRegionSource = {
	provenance: {
		sourceRecordId: "0x13000000",
		number: 1,
		version: 3,
		name: "test",
		partsMask: 0x04,
	},
	data: {
		land: {
			numBlockLength: 255,
			numBlockWidth: 255,
			squareLength: 24,
			landblockLength: 192,
			verticesPerCell: 8,
			maxObjectHeight: 64,
			roadWidth: 1,
		},
		calendar: {
			zeroTimeOfYear: 0,
			zeroYear: 0,
			dayLength: 1,
			daysPerYear: 365,
			yearSpec: "year",
			timesOfDay: [],
			daysOfTheWeek: [],
			seasons: [],
		},
		sky: null,
		sound: null,
		scenes: null,
		misc: null,
		terrain: {
			types: [],
			landSurface: {
				kind: "texture-merge",
				baseTextureSize: 1,
				cornerTerrainMaps: [{ terrainCode: 1, surfaceTextureId: "0x05000002" }],
				sideTerrainMaps: [{ terrainCode: 2, surfaceTextureId: "0x05000003" }],
				roadMaps: [{ roadCode: 1, surfaceTextureId: "0x05000004" }],
				terrainTextures: [terrainTexture(0)],
			},
		},
	},
	landHeightTable: Float32Array.from(
		{ length: 256 },
		(_, index) => index + 0.5,
	),
};

describe("decodeLandblockTerrainRecord", () => {
	it("consumes content-resolved heights and active-region presentation", () => {
		const source = decodeLandblockTerrainRecord(
			terrainResponse(),
			LANDBLOCK_ID,
			ACTIVE_REGION,
		);

		expect(source?.generation.heightIndices).toHaveLength(81);
		expect(source?.generation.heights[80]).toBe(80.5);
		expect(source?.presentation.textures.colors.sourceAssetIds).toEqual([
			"surface-texture/0x05000001",
		]);
	});

	it("rejects a response for another landblock", () => {
		expect(() =>
			decodeLandblockTerrainRecord(
				terrainResponse({ landblockId: "0x0103ffff" }),
				LANDBLOCK_ID,
				ACTIVE_REGION,
			),
		).toThrow("returned 0x0103ffff");
	});

	it("rejects a truncated binary response", () => {
		const response = terrainResponse();
		expect(() =>
			decodeLandblockTerrainRecord(
				response.subarray(0, -1),
				LANDBLOCK_ID,
				ACTIVE_REGION,
			),
		).toThrow("header declares");
	});

	it("accepts a missing outdoor record as a terrain-absent result", () => {
		expect(
			decodeLandblockTerrainRecord(
				terrainResponse({ terrainAvailability: "missing-cell-landblock" }),
				LANDBLOCK_ID,
				ACTIVE_REGION,
			),
		).toBeNull();
	});

	it("preserves ordered detail roles and the road terrain descriptor", () => {
		const terrain = ACTIVE_REGION.data.terrain;
		if (terrain === null || terrain.landSurface.kind !== "texture-merge") {
			throw new Error("test active region requires TextureMerge terrain");
		}
		const activeRegion: ActiveRegionSource = {
			...ACTIVE_REGION,
			data: {
				...ACTIVE_REGION.data,
				terrain: {
					...terrain,
					landSurface: {
						...terrain.landSurface,
						terrainTextures: [
							terrainTexture(0),
							terrainTexture(1),
							terrainTexture(2),
							terrainTexture(3),
							terrainTexture(0x20),
						],
					},
				},
			},
		};

		const presentation = resolveActiveRegionTerrainPresentation(activeRegion);
		const repeated = resolveActiveRegionTerrainPresentation(activeRegion);

		expect(repeated).toBe(presentation);
		expect(presentation.detailRoles.map(({ role }) => role)).toEqual([
			"landscape",
			"building",
			"environment",
			"object",
		]);
		expect(
			presentation.terrain.composition.terrainMaterials.authored.at(-1)
				?.terrainType,
		).toBe(0x20);
		expect(
			presentation.terrain.composition.terrainMaterials.byCode[4]?.terrainType,
		).toBe(0);
		expect(
			presentation.terrain.composition.terrainMaterials.byCode[0x20]
				?.terrainType,
		).toBe(0x20);
		expect(
			presentation.terrain.textures.colors.sourceAssetIdsByTerrainCode,
		).toHaveLength(32);
	});
});

function terrainTexture(terrainType: number) {
	const colorTextureId = (0x05000001 + terrainType)
		.toString(16)
		.padStart(8, "0");
	const detailTextureId = (0x05000101 + terrainType)
		.toString(16)
		.padStart(8, "0");
	return {
		terrainType,
		colorTextureId: `0x${colorTextureId}`,
		tiling: 1,
		maxVertexBrightness: 0,
		minVertexBrightness: 0,
		maxVertexSaturation: 0,
		minVertexSaturation: 0,
		maxVertexHue: 0,
		minVertexHue: 0,
		detailTiling: 1,
		detailTextureId: `0x${detailTextureId}`,
	};
}

function terrainResponse(
	options: {
		readonly landblockId?: string;
		readonly terrainAvailability?: "available" | "missing-cell-landblock";
	} = {},
): Uint8Array {
	const heightIndices = Uint8Array.from({ length: 81 }, (_, index) => index);
	const heights = Float32Array.from({ length: 81 }, (_, index) => index + 0.5);
	const terrainSamples = Uint16Array.from({ length: 81 }, (_, index) => index);
	const cellDiagonals = Uint8Array.from(
		{ length: 64 },
		(_, index) => index % 2,
	);
	const heightsOffset =
		Math.ceil(heightIndices.byteLength / Float32Array.BYTES_PER_ELEMENT) *
		Float32Array.BYTES_PER_ELEMENT;
	const terrainSamplesOffset =
		Math.ceil(
			(heightsOffset + heights.byteLength) / Uint16Array.BYTES_PER_ELEMENT,
		) * Uint16Array.BYTES_PER_ELEMENT;
	const sectionBytes = new Uint8Array(
		terrainSamplesOffset + terrainSamples.byteLength + cellDiagonals.byteLength,
	);
	sectionBytes.set(heightIndices, 0);
	sectionBytes.set(new Uint8Array(heights.buffer), heightsOffset);
	sectionBytes.set(new Uint8Array(terrainSamples.buffer), terrainSamplesOffset);
	sectionBytes.set(
		cellDiagonals,
		terrainSamplesOffset + terrainSamples.byteLength,
	);
	const manifest = new TextEncoder().encode(
		JSON.stringify({
			byteOrder: "little-endian",
			landblockId: options.landblockId ?? LANDBLOCK_ID,
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
					byteLength: heights.byteLength,
					byteOffset: heightsOffset,
					elementCount: heights.length,
					name: "resolvedHeights",
					scalarType: "f32",
				},
				{
					byteLength: terrainSamples.byteLength,
					byteOffset: terrainSamplesOffset,
					elementCount: terrainSamples.length,
					name: "terrainSamples",
					scalarType: "u16",
				},
				{
					byteLength: cellDiagonals.byteLength,
					byteOffset: terrainSamplesOffset + terrainSamples.byteLength,
					elementCount: cellDiagonals.length,
					name: "cellDiagonals",
					scalarType: "u8",
				},
			],
			terrainAvailability: options.terrainAvailability ?? "available",
			transport: "holtburger-landblock-terrain-record",
		}),
	);
	const headerLength = 12;
	const manifestLength =
		Math.ceil((headerLength + manifest.length) / 4) * 4 - headerLength;
	const response = new Uint8Array(
		headerLength + manifestLength + sectionBytes.length,
	);
	response.set(new TextEncoder().encode("HBTR"), 0);
	const view = new DataView(response.buffer);
	view.setUint32(4, manifestLength, true);
	view.setUint32(8, response.byteLength, true);
	response.set(manifest, headerLength);
	response.fill(
		0x20,
		headerLength + manifest.length,
		headerLength + manifestLength,
	);
	response.set(sectionBytes, headerLength + manifestLength);
	return response;
}
