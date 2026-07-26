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
			skyHeight: 500,
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
	it("resolves raw terrain samples through the installed active region", () => {
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

	it("accepts only a missing outdoor record as a terrain-absent result", () => {
		expect(
			decodeLandblockTerrainRecord(
				terrainResponse({ terrainAvailability: "missing-cell-landblock" }),
				LANDBLOCK_ID,
				ACTIVE_REGION,
			),
		).toBeNull();
		expect(() =>
			decodeLandblockTerrainRecord(
				terrainResponse({
					terrainAvailability: "cell-landblock-decode-failed",
				}),
				LANDBLOCK_ID,
				ACTIVE_REGION,
			),
		).toThrow("cell-landblock-decode-failed");
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

		expect(presentation.detailRoles.map(({ role }) => role)).toEqual([
			"landscape",
			"building",
			"environment",
			"object",
		]);
		expect(presentation.composition.terrainTypes.at(-1)?.terrainType).toBe(
			0x20,
		);
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
		readonly terrainAvailability?:
			| "available"
			| "missing-cell-landblock"
			| "cell-landblock-decode-failed"
			| "terrain-assembly-failed";
	} = {},
): Uint8Array {
	const heightIndices = Uint8Array.from({ length: 81 }, (_, index) => index);
	const terrainSamples = Uint16Array.from({ length: 81 }, (_, index) => index);
	const terrainSamplesOffset =
		Math.ceil(heightIndices.byteLength / Uint16Array.BYTES_PER_ELEMENT) *
		Uint16Array.BYTES_PER_ELEMENT;
	const sectionBytes = new Uint8Array(
		terrainSamplesOffset + terrainSamples.byteLength,
	);
	sectionBytes.set(heightIndices, 0);
	sectionBytes.set(new Uint8Array(terrainSamples.buffer), terrainSamplesOffset);
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
					byteLength: terrainSamples.byteLength,
					byteOffset: terrainSamplesOffset,
					elementCount: terrainSamples.length,
					name: "terrainSamples",
					scalarType: "u16",
				},
			],
			terrainAvailability: options.terrainAvailability ?? "available",
			transport: "holtburger-landblock-terrain-record",
			version: 1,
		}),
	);
	const headerLength = 16;
	const manifestLength =
		Math.ceil((headerLength + manifest.length) / 4) * 4 - headerLength;
	const response = new Uint8Array(
		headerLength + manifestLength + sectionBytes.length,
	);
	response.set(new TextEncoder().encode("HBTR"), 0);
	const view = new DataView(response.buffer);
	view.setUint32(4, 1, true);
	view.setUint32(8, manifestLength, true);
	view.setUint32(12, response.byteLength, true);
	response.set(manifest, headerLength);
	response.fill(
		0x20,
		headerLength + manifest.length,
		headerLength + manifestLength,
	);
	response.set(sectionBytes, headerLength + manifestLength);
	return response;
}
