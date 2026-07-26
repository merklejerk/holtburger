import { describe, expect, it } from "vitest";
import type { LandblockId } from "../game/game-types";
import { LandblockLayerKind } from "../game/runtime/scene-interest";
import type { ActiveRegionSource } from "./active-region-source";
import { decodeLandblockSourceBatch } from "./decode-landblock-source-batch";
import { decodeOutdoorStaticRecord } from "./decode-outdoor-static-record";

const LANDBLOCK_ID = "0xda55ffff" as LandblockId;

describe("decodeOutdoorStaticRecord", () => {
	it("decodes a closed direct and setup-backed source bundle", () => {
		const source = decodeOutdoorStaticRecord(
			buildResponse(),
			LANDBLOCK_ID,
			LandblockLayerKind.Buildings,
		);

		expect(source.staticResidents).toHaveLength(1);
		expect(source.dynamicResidents).toHaveLength(1);
		expect(
			source.staticResidents[0]?.presentation.parts[0]?.geometry.indices,
		).toEqual(Uint32Array.from([0, 1, 2]));
		expect(source.dynamicResidents[0]?.presentation.effects.animationId).toBe(
			"0x030005cf",
		);
	});

	it("decodes a Level 2 object record with its typed layer identity", () => {
		const source = decodeOutdoorStaticRecord(
			buildResponse({ layer: "objects" }),
			LANDBLOCK_ID,
			LandblockLayerKind.Objects,
		);

		expect(source.kind).toBe(LandblockLayerKind.Objects);
		expect(source.staticResidents).toHaveLength(1);
		expect(source.dynamicResidents).toHaveLength(1);
	});

	it("decodes an object record nested in a matching landblock batch", () => {
		const source = decodeLandblockSourceBatch(
			batchResponse(
				buildResponse({ layer: "objects" }),
				LandblockLayerKind.Objects,
			),
			LANDBLOCK_ID,
			new Set([LandblockLayerKind.Objects]),
			{} as ActiveRegionSource,
		);

		expect(source.records.get(LandblockLayerKind.Objects)?.kind).toBe(
			LandblockLayerKind.Objects,
		);
	});

	it("rejects a resident whose closed source definition is absent", () => {
		const response = buildResponse({
			residents: [{ ...resident("direct"), source: "missing" }],
		});
		expect(() =>
			decodeOutdoorStaticRecord(
				response,
				LANDBLOCK_ID,
				LandblockLayerKind.Buildings,
			),
		).toThrow("references missing source");
	});

	it("rejects an out-of-range index before publishing a source", () => {
		const response = buildResponse({ indices: [0, 1, 3] });
		expect(() =>
			decodeOutdoorStaticRecord(
				response,
				LANDBLOCK_ID,
				LandblockLayerKind.Buildings,
			),
		).toThrow("out-of-range index");
	});
});

function buildResponse(
	options: {
		readonly residents?: readonly Record<string, unknown>[];
		readonly indices?: readonly number[];
		readonly layer?: "buildings" | "objects";
	} = {},
): Uint8Array {
	const positions = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]);
	const normals = Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]);
	const textureCoordinates = Float32Array.from([0, 0, 1, 0, 0, 1]);
	const indices = Uint32Array.from(options.indices ?? [0, 1, 2]);
	const materialSlots = Uint16Array.from([0]);
	const materialWrapModes = Uint8Array.from([1]);
	const materialSideKinds = Uint8Array.from([0]);
	const materialSideTypes = Uint8Array.from([1]);
	const materialStippling = Uint8Array.from([1]);
	const parts = [
		positions,
		normals,
		textureCoordinates,
		indices,
		materialSlots,
		materialWrapModes,
		materialSideKinds,
		materialSideTypes,
		materialStippling,
	];
	const names = [
		"positions",
		"normals",
		"textureCoordinates",
		"indices",
		"materialSlots",
		"materialWrapModes",
		"materialSideKinds",
		"materialSideTypes",
		"materialStippling",
	] as const;
	let byteOffset = 0;
	const sections = parts.map((part, index) => {
		const alignment = part.BYTES_PER_ELEMENT;
		byteOffset = Math.ceil(byteOffset / alignment) * alignment;
		const result = {
			name: names[index],
			scalarType:
				index < 3 ? "f32" : index === 3 ? "u32" : index === 4 ? "u16" : "u8",
			elementCount: part.length,
			byteOffset,
			byteLength: part.byteLength,
		};
		byteOffset += part.byteLength;
		return result;
	});
	const payload = new Uint8Array(byteOffset);
	for (const [index, part] of parts.entries()) {
		payload.set(new Uint8Array(part.buffer), sections[index]!.byteOffset);
	}
	const manifest = {
		transport: "holtburger-outdoor-static-record",
		version: 1,
		byteOrder: "little-endian",
		sectionByteOffsetBase: "section-data",
		landblockId: LANDBLOCK_ID,
		layer: options.layer ?? "buildings",
		residents: options.residents ?? [resident("direct"), resident("animated")],
		definitions: [
			{
				id: "direct",
				kind: "gfx-obj",
				sourceAssetId: "gfx-obj/01000001",
				geometryId: "geometry",
				materialIds: ["surface/08000001"],
			},
			{
				id: "animated",
				kind: "setup-model",
				sourceAssetId: "setup-model/02000001",
				parts: [
					{
						partIndex: 0,
						parentPartIndex: null,
						geometryId: "geometry",
						defaultScale: [1, 1, 1],
						defaultPlacement: null,
						materialIds: ["surface/08000001"],
					},
				],
				defaultAnimationId: "0x030005cf",
				defaultMotionTableId: null,
				defaultScriptId: null,
				defaultScriptTableId: null,
				defaultSoundTableId: null,
			},
		],
		geometries: [
			{
				id: "geometry",
				sourceAssetId: "gfx-obj/01000001",
				vertexCount: 3,
				positionOffset: 0,
				normalOffset: 0,
				textureCoordinateOffset: 0,
				indexOffset: 0,
				indexCount: 3,
				materialSlotOffset: 0,
				materialSlotCount: 1,
				materialWrapModeOffset: 0,
				materialWrapModeCount: 1,
				materialSideKindOffset: 0,
				materialSideKindCount: 1,
				materialSideTypeOffset: 0,
				materialSideTypeCount: 1,
				materialStipplingOffset: 0,
				materialStipplingCount: 1,
				bounds: { min: [0, 0, 0], max: [1, 1, 0] },
			},
		],
		materials: [
			{
				id: "surface/08000001",
				rawSurfaceFlags: 1,
				translucency: 0,
				luminosity: 0,
				diffuseScale: 1,
				source: { kind: "solid-color", color: 0xff336699 },
			},
		],
		textureDependencies: [],
		sections,
	};
	const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
	const paddedManifest = new Uint8Array(
		Math.ceil((16 + manifestBytes.length) / 4) * 4 - 16,
	);
	paddedManifest.fill(0x20);
	paddedManifest.set(manifestBytes);
	const response = new Uint8Array(16 + paddedManifest.length + payload.length);
	response.set(new TextEncoder().encode("HBSO"));
	new DataView(response.buffer).setUint32(4, 1, true);
	new DataView(response.buffer).setUint32(8, paddedManifest.length, true);
	new DataView(response.buffer).setUint32(12, response.length, true);
	response.set(paddedManifest, 16);
	response.set(payload, 16 + paddedManifest.length);
	return response;
}

function resident(source: string): Record<string, unknown> {
	return {
		id: `resident:${source}`,
		source,
		placement: { origin: [1, 2, 3], orientation: [1, 0, 0, 0] },
		scale: [1, 1, 1],
		localBounds: { min: [0, 0, 0], max: [1, 1, 0] },
	};
}

function batchResponse(
	record: Uint8Array,
	layer: LandblockLayerKind,
): Uint8Array {
	const manifest = {
		byteOrder: "little-endian",
		landblockId: LANDBLOCK_ID,
		recordByteOffsetBase: "record-data",
		records: [{ byteLength: record.byteLength, byteOffset: 0, layer }],
		requestedLayers: [layer],
		transport: "holtburger-landblock-source-batch",
		version: 1,
	};
	const encodedManifest = new TextEncoder().encode(JSON.stringify(manifest));
	const manifestLength = Math.ceil((16 + encodedManifest.length) / 4) * 4 - 16;
	const response = new Uint8Array(16 + manifestLength + record.byteLength);
	response.set(new TextEncoder().encode("HBLB"));
	const view = new DataView(response.buffer);
	view.setUint32(4, 1, true);
	view.setUint32(8, manifestLength, true);
	view.setUint32(12, response.byteLength, true);
	response.fill(0x20, 16, 16 + manifestLength);
	response.set(encodedManifest, 16);
	response.set(record, 16 + manifestLength);
	return response;
}
