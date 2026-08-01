import { describe, expect, it } from "vitest";
import { decodeAnimationRecord } from "./decode-animation-record";

describe("decodeAnimationRecord", () => {
	it("decodes flat rigid frames into a semantic SetOmega hook", () => {
		const response = animationResponse();

		const decoded = decodeAnimationRecord(response, "0x03000001");

		expect(decoded).toMatchObject({
			frameCount: 1,
			id: "0x03000001",
			partCount: 1,
			positionFrames: [],
		});
		expect(decoded.partFrames[0]).toMatchObject({
			m11: 1,
			m22: 1,
			m33: 1,
			m41: 1,
			m42: 3,
			m43: -2,
		});
		expect(decoded.hooks[0]).toMatchObject({
			authoredOrder: 0,
			direction: "both",
			frameIndex: 0,
			kind: "set-omega",
			omega: { x: 0, y: 1, z: -0 },
		});
	});

	it("rejects a response whose typed identity differs from the request", () => {
		expect(() =>
			decodeAnimationRecord(animationResponse(), "0x03000002"),
		).toThrow("returned 0x03000001 for 0x03000002");
	});

	it("rejects contradictory transport provenance before normalization", () => {
		expect(() =>
			decodeAnimationRecord(animationResponse("sound"), "0x03000001"),
		).toThrow("hook type 22 is named sound, expected set-omega");
	});
});

function animationResponse(hookName = "set-omega"): Uint8Array {
	const partFrames = new Float32Array([1, 2, 3, 1, 0, 0, 0]);
	const hookPayload = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 128, 63]);
	const manifest = {
		animationId: "0x03000001",
		byteOrder: "little-endian",
		frameCount: 1,
		hasPositionFrames: false,
		hooks: [
			{
				authoredOrder: 0,
				direction: "both",
				frameIndex: 0,
				hookName,
				hookType: 22,
				payload: {
					byteLength: hookPayload.length,
					byteOffset: 0,
					kind: "set-omega",
					omega: [0, 0, 1],
				},
				rawDirection: 0,
			},
		],
		partCount: 1,
		sectionByteOffsetBase: "section-data",
		sections: [
			{
				byteLength: partFrames.byteLength,
				byteOffset: 0,
				elementCount: partFrames.length,
				name: "partFrames",
				scalarType: "f32",
			},
			{
				byteLength: 0,
				byteOffset: partFrames.byteLength,
				elementCount: 0,
				name: "positionFrames",
				scalarType: "f32",
			},
			{
				byteLength: hookPayload.byteLength,
				byteOffset: partFrames.byteLength,
				elementCount: hookPayload.length,
				name: "hookPayloadBytes",
				scalarType: "u8",
			},
		],
		transport: "holtburger-animation",
	};
	const manifestBytes = [...new TextEncoder().encode(JSON.stringify(manifest))];
	while ((12 + manifestBytes.length) % 4 !== 0) manifestBytes.push(32);
	const response = new Uint8Array(
		12 + manifestBytes.length + partFrames.byteLength + hookPayload.length,
	);
	response.set(new TextEncoder().encode("HBAN"));
	const view = new DataView(response.buffer);
	view.setUint32(4, manifestBytes.length, true);
	view.setUint32(8, response.length, true);
	response.set(manifestBytes, 12);
	response.set(new Uint8Array(partFrames.buffer), 12 + manifestBytes.length);
	response.set(hookPayload, 12 + manifestBytes.length + partFrames.byteLength);
	return response;
}
