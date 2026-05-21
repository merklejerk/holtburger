import { describe, expect, it } from "vitest";

import { decodeBinaryAssetEnvelope } from "./binary-asset-envelope";

describe("decodeBinaryAssetEnvelope", () => {
	it("hydrates binary landblock-pack arrays into the normalized response payload", () => {
		const payload = {
			prepared: {
				terrainMesh: {
					vertices: [],
					triangles: [],
				},
			},
		};
		const vertices = new Float32Array([1, 2, 3, 4, 5, 6]);
		const triangles = new Float32Array([0, 1, 2, 7, 4.5]);
		const response = decodeBinaryAssetEnvelope(
			buildEnvelope({
				response: {
					requestId: "request-1",
					assetId: "landblock-pack/0102ffff",
					payloadKind: "json",
					payload,
				},
				sections: [
					{
						role: "prepared.terrainMesh.vertices",
						path: "payload.prepared.terrainMesh.vertices",
						scalarType: "f32",
						componentCount: 3,
						elementCount: 2,
						byteOffset: 0,
						byteLength: vertices.byteLength,
					},
					{
						role: "prepared.terrainMesh.triangles",
						path: "payload.prepared.terrainMesh.triangles",
						scalarType: "f32",
						componentCount: 5,
						elementCount: 1,
						byteOffset: vertices.byteLength,
						byteLength: triangles.byteLength,
					},
				],
				sectionData: [vertices, triangles],
			}),
		);

		expect(response.payload).toMatchObject({
			prepared: {
				terrainMesh: {
					vertices: [
						{ x: 1, y: 2, z: 3 },
						{ x: 4, y: 5, z: 6 },
					],
					triangles: [
						{
							a: 0,
							b: 1,
							c: 2,
							terrainType: 7,
							averageHeight: 4.5,
						},
					],
				},
			},
		});
	});
});

function buildEnvelope({
	response,
	sections,
	sectionData,
}: {
	response: unknown;
	sections: unknown[];
	sectionData: ArrayBufferView[];
}): Uint8Array {
	const encoder = new TextEncoder();
	const manifest = {
		transport: "holtburger-asset-binary",
		version: 1,
		byteOrder: "little-endian",
		sectionByteOffsetBase: "section-data",
		response,
		sections,
	};
	const manifestBytes = Array.from(encoder.encode(JSON.stringify(manifest)));
	while ((16 + manifestBytes.length) % 4 !== 0) {
		manifestBytes.push(0x20);
	}
	const dataBytes = sectionData.flatMap((section) =>
		Array.from(
			new Uint8Array(section.buffer, section.byteOffset, section.byteLength),
		),
	);
	const bytes = new Uint8Array(16 + manifestBytes.length + dataBytes.length);
	bytes.set([0x48, 0x42, 0x41, 0x42], 0);
	const view = new DataView(bytes.buffer);
	view.setUint32(4, 1, true);
	view.setUint32(8, manifestBytes.length, true);
	view.setUint32(12, bytes.byteLength, true);
	bytes.set(manifestBytes, 16);
	bytes.set(dataBytes, 16 + manifestBytes.length);
	return bytes;
}
