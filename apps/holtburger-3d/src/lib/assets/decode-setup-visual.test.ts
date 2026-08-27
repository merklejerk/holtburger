import { describe, expect, it } from "vitest";

import { decodeSetupVisual } from "./decode-setup-visual";

const EMPTY_SECTIONS = [
	["positions", "f32"],
	["normals", "f32"],
	["textureCoordinates", "f32"],
	["indices", "u32"],
	["materialSlots", "u16"],
	["materialWrapModes", "u8"],
	["materialSideKinds", "u8"],
	["materialSideTypes", "u8"],
	["materialStippling", "u8"],
] as const;

describe("decodeSetupVisual", () => {
	it("selects the exact setup appearance and retains its behavior and light facts", () => {
		const visual = decodeSetupVisual(
			envelope({
				transport: "holtburger-setup-visual",
				byteOrder: "little-endian",
				sectionByteOffsetBase: "section-data",
				definitionId: "setup:exact",
				definitions: [
					{
						id: "setup:exact",
						kind: "setup-model",
						appearanceKey: "setup:0x02000001|appearance:test",
						setupId: "0x02000001",
						sourceAssetId: "setup-model/0x02000001",
						parts: [],
						lights: [
							{
								lightType: 0,
								offset: {
									origin: [1, 2, 3],
									orientation: [1, 0, 0, 0],
								},
								color: 0xff804020,
								intensity: 2,
								falloff: 4,
								coneAngle: 0,
							},
						],
						holdingLocations: [],
						placementFrames: [{ placementId: 0, frames: [] }],
						defaultAnimationId: "0x03000001",
						defaultMotionTableId: null,
						defaultScriptId: null,
						defaultScriptTableId: null,
						defaultSoundTableId: null,
					},
				],
				geometries: [],
				materials: [],
				textureDependencies: [],
				sections: EMPTY_SECTIONS.map(([name, scalarType]) => ({
					name,
					scalarType,
					elementCount: 0,
					byteOffset: 0,
					byteLength: 0,
				})),
			}),
		);

		expect(visual).toMatchObject({
			behavior: { animationId: "0x03000001", kind: "animation-only" },
			setupId: "0x02000001",
			presentation: {
				appearanceKey: "setup:0x02000001|appearance:test",
				lights: [
					{
						color: {
							red: 0x80 / 0xff,
							green: 0x40 / 0xff,
							blue: 0x20 / 0xff,
						},
						falloff: 4,
						intensity: 2,
					},
				],
			},
		});
	});

	it("rejects a response whose declared envelope length is dishonest", () => {
		const response = new Uint8Array(12);
		response.set(new TextEncoder().encode("HBSV"));
		new DataView(response.buffer).setUint32(8, 99, true);
		expect(() => decodeSetupVisual(response)).toThrow("header declares 99");
	});
});

function envelope(manifest: unknown): Uint8Array {
	const json = new TextEncoder().encode(JSON.stringify(manifest));
	const response = new Uint8Array(12 + json.length);
	response.set(new TextEncoder().encode("HBSV"));
	const view = new DataView(response.buffer);
	view.setUint32(4, json.length, true);
	view.setUint32(8, response.length, true);
	response.set(json, 12);
	return response;
}
