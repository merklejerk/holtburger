import { describe, expect, it } from "vitest";
import type { LandblockId } from "../game/game-types";
import { LandblockLayerKind } from "../game/runtime/scene-interest";
import type { ActiveRegionSource } from "./active-region-source";
import { decodeLandblockSourceBatch } from "./decode-landblock-source-batch";
import {
	decodeOutdoorStaticRecord,
	unpackArgbColor,
} from "./decode-static-source-record";

const LANDBLOCK_ID = "0xda55ffff" as LandblockId;

describe("decodeOutdoorStaticRecord", () => {
	it("decodes a closed direct and setup-backed source bundle", () => {
		const source = decodeOutdoorStaticRecord(
			buildResponse(),
			LANDBLOCK_ID,
			LandblockLayerKind.Buildings,
		);

		expect(source.staticResidents).toHaveLength(1);
		expect(source.dynamicSources).toHaveLength(1);
		expect(
			source.staticResidents[0]?.presentation.parts[0]?.geometry.indices,
		).toEqual(Uint32Array.from([0, 1, 2]));
		expect(
			source.staticResidents[0]?.presentation.parts[0]?.geometry
				.sourceDiagnostics.rejectedDegenerateTriangles,
		).toEqual([
			{
				fanTriangleIndex: 1,
				polygonId: 6,
				sideKind: "positive",
			},
		]);
		expect(source.dynamicSources[0]?.behavior.animationId).toBe("0x030005cf");
		expect(source.dynamicSources[0]?.setupId).toBe("0x02000001");
	});

	it("decodes a Level 2 object record with its typed layer identity", () => {
		const source = decodeOutdoorStaticRecord(
			buildResponse({ layer: "objects" }),
			LANDBLOCK_ID,
			LandblockLayerKind.Objects,
		);

		expect(source.kind).toBe(LandblockLayerKind.Objects);
		expect(source.staticResidents).toHaveLength(1);
		expect(source.dynamicSources).toHaveLength(1);
	});

	it("decodes a present empty Level 3 generated record", () => {
		const source = decodeOutdoorStaticRecord(
			buildResponse({ layer: "generated", residents: [] }),
			LANDBLOCK_ID,
			LandblockLayerKind.Generated,
		);

		expect(source).toMatchObject({
			dynamicSources: [],
			kind: LandblockLayerKind.Generated,
			landblockId: LANDBLOCK_ID,
			staticResidents: [],
		});
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

	it("resolves authored setup lights into object-local render axes", () => {
		const source = decodeOutdoorStaticRecord(
			buildResponse({
				lights: [
					{
						lightType: 0,
						// AC authors Z-up with +Y north; render space is Y-up with -Z north.
						offset: { origin: [1, 2, 3], orientation: [1, 0, 0, 0] },
						color: 0xffff8000,
						intensity: 75,
						falloff: 4,
						coneAngle: -1,
					},
				],
			}),
			LANDBLOCK_ID,
			LandblockLayerKind.Buildings,
		);
		const [light] = source.dynamicSources[0]!.presentation.lights;
		expect(light).toBeDefined();
		expect([light!.offset.x, light!.offset.y, light!.offset.z]).toEqual([
			1, 3, -2,
		]);
		expect(light!.color.red).toBeCloseTo(1);
		expect(light!.color.green).toBeCloseTo(0x80 / 0xff);
		expect(light!.color.blue).toBe(0);
		expect(light!.intensity).toBe(75);
		expect(light!.falloff).toBe(4);
	});

	it("rejects a setup light whose type is not a point light", () => {
		expect(() =>
			decodeOutdoorStaticRecord(
				buildResponse({
					lights: [
						{
							lightType: 2,
							offset: { origin: [0, 0, 0], orientation: [1, 0, 0, 0] },
							color: 0,
							intensity: 1,
							falloff: 1,
							coneAngle: 1,
						},
					],
				}),
				LANDBLOCK_ID,
				LandblockLayerKind.Buildings,
			),
		).toThrow("unsupported light type");
	});

	it("indexes every attach point a setup offers by its named location", () => {
		const source = decodeOutdoorStaticRecord(
			buildResponse({
				holdingLocations: [
					{
						location: "right-hand",
						partIndex: 0,
						frame: { origin: [1, 2, 3], orientation: [1, 0, 0, 0] },
					},
					{
						location: "left-weapon",
						partIndex: 0,
						frame: { origin: [4, 5, 6], orientation: [1, 0, 0, 0] },
					},
				],
			}),
			LANDBLOCK_ID,
			LandblockLayerKind.Buildings,
		);

		const attachPoints =
			source.dynamicSources[0]?.presentation.holdingLocations;
		expect([...(attachPoints?.keys() ?? [])]).toEqual([
			"right-hand",
			"left-weapon",
		]);
		// Renderer space is AC's with Y and Z swapped and handedness flipped, matching the same
		// conversion every other authored frame goes through.
		expect(attachPoints?.get("left-weapon")).toMatchObject({
			location: "left-weapon",
			offsetTransform: { m41: 4, m42: 6, m43: -5 },
			partIndex: 0,
		});
	});

	it("preserves distinct authored placement poses by their enum key", () => {
		const source = decodeOutdoorStaticRecord(
			buildResponse({
				placementFrames: [
					{
						placementId: 0,
						frames: [{ origin: [1, 0, 0], orientation: [1, 0, 0, 0] }],
					},
					{
						placementId: 1,
						frames: [{ origin: [7, 0, 0], orientation: [1, 0, 0, 0] }],
					},
				],
			}),
			LANDBLOCK_ID,
			LandblockLayerKind.Buildings,
		);

		const poses = source.dynamicSources[0]!.presentation.placementPoses;
		expect(poses.get(0)?.partTransforms[0]?.m41).toBe(1);
		expect(poses.get(1)?.partTransforms[0]?.m41).toBe(7);
	});

	it("rejects a duplicate placement key", () => {
		const pose = {
			placementId: 1,
			frames: [{ origin: [0, 0, 0], orientation: [1, 0, 0, 0] }],
		};
		expect(() =>
			decodeOutdoorStaticRecord(
				buildResponse({ placementFrames: [pose, pose] }),
				LANDBLOCK_ID,
				LandblockLayerKind.Buildings,
			),
		).toThrow("declares placement 1 twice");
	});

	it("rejects a setup that authors neither the resting nor the fallback pose", () => {
		expect(() =>
			decodeOutdoorStaticRecord(
				buildResponse({
					placementFrames: [
						{
							placementId: 1,
							frames: [{ origin: [0, 0, 0], orientation: [1, 0, 0, 0] }],
						},
					],
				}),
				LANDBLOCK_ID,
				LandblockLayerKind.Buildings,
			),
		).toThrow("authors neither placement");
	});

	it("rejects a placement with the wrong number of part frames", () => {
		expect(() =>
			decodeOutdoorStaticRecord(
				buildResponse({
					placementFrames: [{ placementId: 1, frames: [] }],
				}),
				LANDBLOCK_ID,
				LandblockLayerKind.Buildings,
			),
		).toThrow("carries 0 frames for 1 parts");
	});

	it("rejects an attach point naming a location outside the enum", () => {
		expect(() =>
			decodeOutdoorStaticRecord(
				buildResponse({
					holdingLocations: [
						{
							location: "third-hand",
							partIndex: 0,
							frame: { origin: [0, 0, 0], orientation: [1, 0, 0, 0] },
						},
					],
				}),
				LANDBLOCK_ID,
				LandblockLayerKind.Buildings,
			),
		).toThrow("holdingLocations");
	});

	it("rejects an attach point naming a part the presentation does not have", () => {
		expect(() =>
			decodeOutdoorStaticRecord(
				buildResponse({
					holdingLocations: [
						{
							location: "belt",
							partIndex: 4,
							frame: { origin: [0, 0, 0], orientation: [1, 0, 0, 0] },
						},
					],
				}),
				LANDBLOCK_ID,
				LandblockLayerKind.Buildings,
			),
		).toThrow("names part 4 of 1");
	});
});

function buildResponse(
	options: {
		readonly residents?: readonly Record<string, unknown>[];
		readonly indices?: readonly number[];
		readonly layer?: "buildings" | "objects" | "generated";
		readonly holdingLocations?: readonly Record<string, unknown>[];
		readonly lights?: readonly Record<string, unknown>[];
		readonly placementFrames?: readonly Record<string, unknown>[];
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
		byteOrder: "little-endian",
		sectionByteOffsetBase: "section-data",
		landblockId: LANDBLOCK_ID,
		layer: options.layer ?? "buildings",
		residents: options.residents ?? [resident("direct"), resident("animated")],
		definitions: [
			{
				id: "direct",
				kind: "gfx-obj",
				appearanceKey: "gfx-obj:0x01000001",
				sourceAssetId: "gfx-obj/01000001",
				geometryId: "geometry",
				materialIds: ["surface/08000001"],
			},
			{
				id: "animated",
				kind: "setup-model",
				appearanceKey: "setup:0x02000001|base",
				setupId: "0x02000001",
				sourceAssetId: "setup-model/02000001",
				parts: [
					{
						partIndex: 0,
						geometryId: "geometry",
						defaultScale: [1, 1, 1],
						materialIds: ["surface/08000001"],
					},
				],
				lights: options.lights ?? [],
				holdingLocations: options.holdingLocations ?? [],
				placementFrames: options.placementFrames ?? [
					{
						placementId: 0,
						frames: [{ origin: [0, 0, 0], orientation: [1, 0, 0, 0] }],
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
				rejectedDegenerateTriangles: [
					{
						polygonId: 6,
						sideKind: "positive",
						fanTriangleIndex: 1,
					},
				],
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
	const headerLength = 12;
	const paddedManifest = new Uint8Array(
		Math.ceil((headerLength + manifestBytes.length) / 4) * 4 - headerLength,
	);
	paddedManifest.fill(0x20);
	paddedManifest.set(manifestBytes);
	const response = new Uint8Array(
		headerLength + paddedManifest.length + payload.length,
	);
	response.set(new TextEncoder().encode("HBSO"));
	new DataView(response.buffer).setUint32(4, paddedManifest.length, true);
	new DataView(response.buffer).setUint32(8, response.length, true);
	response.set(paddedManifest, headerLength);
	response.set(payload, headerLength + paddedManifest.length);
	return response;
}

function resident(source: string): Record<string, unknown> {
	return {
		id: `resident:${source}`,
		source,
		placement: { origin: [1, 2, 3], orientation: [1, 0, 0, 0] },
		scale: [1, 1, 1],
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
	};
	const encodedManifest = new TextEncoder().encode(JSON.stringify(manifest));
	const headerLength = 12;
	const manifestLength =
		Math.ceil((headerLength + encodedManifest.length) / 4) * 4 - headerLength;
	const response = new Uint8Array(
		headerLength + manifestLength + record.byteLength,
	);
	response.set(new TextEncoder().encode("HBLB"));
	const view = new DataView(response.buffer);
	view.setUint32(4, manifestLength, true);
	view.setUint32(8, response.byteLength, true);
	response.fill(0x20, headerLength, headerLength + manifestLength);
	response.set(encodedManifest, headerLength);
	response.set(record, headerLength + manifestLength);
	return response;
}

describe("unpackArgbColor", () => {
	// Retail unpacks red from bits 16-23 and blue from bits 0-7
	// (RGBColor::SetColor32, acclient.c:136902). Reading it the other way round renders warm
	// authored lamps as cool ones, which is how this was originally found.
	it("reads red from the high bytes and blue from the low", () => {
		expect(unpackArgbColor(0xff_ff_80_00)).toEqual({
			red: 1,
			green: 128 / 255,
			blue: 0,
			alpha: 1,
		});
	});

	it("reads alpha from the top byte", () => {
		expect(unpackArgbColor(0x00_00_00_00).alpha).toBe(0);
		expect(unpackArgbColor(0x80_00_00_00).alpha).toBe(128 / 255);
	});
});
