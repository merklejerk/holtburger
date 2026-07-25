import { describe, expect, it } from "vitest";
import type { LandblockId } from "../game/game-types";
import { decodeBuildingSource } from "./decode-building-source";

const LANDBLOCK_ID = "0xda55ffff" as LandblockId;

describe("decodeBuildingSource", () => {
	it("decodes a closed direct and setup-backed source bundle", () => {
		const source = decodeBuildingSource(buildResponse(), LANDBLOCK_ID);

		expect(source.staticResidents).toHaveLength(1);
		expect(source.dynamicResidents).toHaveLength(1);
		expect(
			source.staticResidents[0]?.presentation.parts[0]?.geometry.indices,
		).toEqual(Uint32Array.from([0, 1, 2]));
		expect(source.dynamicResidents[0]?.presentation.effects.animationId).toBe(
			"0x030005cf",
		);
	});

	it("rejects a resident whose closed source definition is absent", () => {
		const response = buildResponse({
			residents: [{ ...resident("direct"), source: "missing" }],
		});
		expect(() => decodeBuildingSource(response, LANDBLOCK_ID)).toThrow(
			"references missing source",
		);
	});

	it("rejects an out-of-range index before publishing a source", () => {
		const response = buildResponse({ indices: [0, 1, 3] });
		expect(() => decodeBuildingSource(response, LANDBLOCK_ID)).toThrow(
			"out-of-range index",
		);
	});
});

function buildResponse(
	options: {
		readonly residents?: readonly Record<string, unknown>[];
		readonly indices?: readonly number[];
	} = {},
): Uint8Array {
	const positions = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]);
	const normals = Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]);
	const textureCoordinates = Float32Array.from([0, 0, 1, 0, 0, 1]);
	const indices = Uint32Array.from(options.indices ?? [0, 1, 2]);
	const materialSlots = Uint16Array.from([0]);
	const parts = [
		positions,
		normals,
		textureCoordinates,
		indices,
		materialSlots,
	];
	const names = [
		"positions",
		"normals",
		"textureCoordinates",
		"indices",
		"materialSlots",
	] as const;
	let byteOffset = 0;
	const sections = parts.map((part, index) => {
		const alignment = part.BYTES_PER_ELEMENT;
		byteOffset = Math.ceil(byteOffset / alignment) * alignment;
		const result = {
			name: names[index],
			scalarType: index < 3 ? "f32" : index === 3 ? "u32" : "u16",
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
		transport: "holtburger-building-source",
		version: 1,
		byteOrder: "little-endian",
		sectionByteOffsetBase: "section-data",
		landblockId: LANDBLOCK_ID,
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
	response.set(new TextEncoder().encode("HBBL"));
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
