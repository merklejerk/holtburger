import { describe, expect, it } from "vitest";
import type { ActiveRegionSource } from "./active-region-source";
import { decodeLandblockSourceBatch } from "./decode-landblock-source-batch";
import { LandblockLayerKind } from "../game/runtime/scene-interest";
import type { LandblockOwnerId } from "../game/game-types";

const LANDBLOCK_ID = "0xda55ffff" as LandblockOwnerId;
const ACTIVE_REGION = {} as ActiveRegionSource;

describe("decodeLandblockSourceBatch", () => {
	it("rejects a manifest whose requested layer set differs from the caller request", () => {
		expect(() =>
			decodeLandblockSourceBatch(
				batchResponse({ requestedLayers: [LandblockLayerKind.Terrain] }),
				LANDBLOCK_ID,
				new Set([LandblockLayerKind.Buildings]),
				ACTIVE_REGION,
			),
		).toThrow("requested layer set does not match");
	});

	it("rejects a manifest whose returned record set differs from its request", () => {
		expect(() =>
			decodeLandblockSourceBatch(
				batchResponse({
					records: [
						{
							byteLength: 1,
							byteOffset: 0,
							layer: LandblockLayerKind.Buildings,
						},
					],
				}),
				LANDBLOCK_ID,
				new Set([LandblockLayerKind.Terrain]),
				ACTIVE_REGION,
			),
		).toThrow("returned record set does not match");
	});

	it("rejects duplicate generated records", () => {
		expect(() =>
			decodeLandblockSourceBatch(
				batchResponse({
					recordDataLength: 2,
					records: [
						{
							byteLength: 1,
							byteOffset: 0,
							layer: LandblockLayerKind.Generated,
						},
						{
							byteLength: 1,
							byteOffset: 1,
							layer: LandblockLayerKind.Generated,
						},
					],
					requestedLayers: [LandblockLayerKind.Generated],
				}),
				LANDBLOCK_ID,
				new Set([LandblockLayerKind.Generated]),
				ACTIVE_REGION,
			),
		).toThrow("exactly one record");
	});

	it("rejects overlapping record ranges before nested decoding", () => {
		expect(() =>
			decodeLandblockSourceBatch(
				batchResponse({
					recordDataLength: 3,
					records: [
						{
							byteLength: 2,
							byteOffset: 0,
							layer: LandblockLayerKind.Buildings,
						},
						{
							byteLength: 2,
							byteOffset: 1,
							layer: LandblockLayerKind.Generated,
						},
					],
					requestedLayers: [
						LandblockLayerKind.Buildings,
						LandblockLayerKind.Generated,
					],
				}),
				LANDBLOCK_ID,
				new Set([LandblockLayerKind.Buildings, LandblockLayerKind.Generated]),
				ACTIVE_REGION,
			),
		).toThrow("overlaps");
	});

	it("rejects an out-of-bounds generated record range", () => {
		expect(() =>
			decodeLandblockSourceBatch(
				batchResponse({
					records: [
						{
							byteLength: 2,
							byteOffset: 0,
							layer: LandblockLayerKind.Generated,
						},
					],
					requestedLayers: [LandblockLayerKind.Generated],
				}),
				LANDBLOCK_ID,
				new Set([LandblockLayerKind.Generated]),
				ACTIVE_REGION,
			),
		).toThrow("byte range is invalid");
	});

	it("range-checks and skips an independently bounded unknown record", () => {
		const source = decodeLandblockSourceBatch(
			batchResponse({
				records: [{ byteLength: 1, byteOffset: 0, layer: "future-layer" }],
				requestedLayers: ["future-layer"],
			}),
			LANDBLOCK_ID,
			new Set(),
			ACTIVE_REGION,
		);

		expect(source.records.size).toBe(0);
	});
});

function batchResponse(
	overrides: {
		readonly requestedLayers?: readonly string[];
		readonly records?: readonly {
			readonly byteLength: number;
			readonly byteOffset: number;
			readonly layer: string;
		}[];
		readonly recordDataLength?: number;
	} = {},
): Uint8Array {
	const manifest = {
		byteOrder: "little-endian",
		landblockId: LANDBLOCK_ID,
		recordByteOffsetBase: "record-data",
		records: overrides.records ?? [
			{
				byteLength: 1,
				byteOffset: 0,
				layer: LandblockLayerKind.Terrain,
			},
		],
		requestedLayers: overrides.requestedLayers ?? [LandblockLayerKind.Terrain],
		transport: "holtburger-landblock-source-batch",
	};
	const encoded = new TextEncoder().encode(JSON.stringify(manifest));
	const headerLength = 12;
	const manifestLength =
		Math.ceil((headerLength + encoded.length) / 4) * 4 - headerLength;
	const response = new Uint8Array(
		headerLength + manifestLength + (overrides.recordDataLength ?? 1),
	);
	response.set(new TextEncoder().encode("HBLB"));
	const view = new DataView(response.buffer);
	view.setUint32(4, manifestLength, true);
	view.setUint32(8, response.length, true);
	response.fill(0x20, headerLength, headerLength + manifestLength);
	response.set(encoded, headerLength);
	return response;
}
