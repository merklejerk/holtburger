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

	it("rejects invalid frame, authored-order, and direction facts", () => {
		expect(() =>
			decodeAnimationRecord(
				animationResponse("set-omega", { frameIndex: 1 }),
				"0x03000001",
			),
		).toThrow("Animation hook frame 1 is out of range");
		expect(() =>
			decodeAnimationRecord(
				animationResponse("set-omega", { authoredOrder: 1 }),
				"0x03000001",
			),
		).toThrow("Animation frame 0 hook order is not contiguous");
		expect(() =>
			decodeAnimationRecord(
				animationResponse("set-omega", {
					direction: "forward",
					rawDirection: -1,
				}),
				"0x03000001",
			),
		).toThrow("Animation hook set-omega direction facts disagree");
	});

	it("decodes a typed TransparentPart hook without retaining transport provenance", () => {
		const decoded = decodeAnimationRecord(
			transparentPartResponse(),
			"0x03000001",
		);

		expect(decoded.hooks).toEqual([
			{
				authoredOrder: 0,
				direction: "forward",
				durationSeconds: 0.75,
				end: 1,
				frameIndex: 0,
				kind: "transparent-part",
				partIndex: 0,
				start: 0.25,
			},
		]);
	});

	it("rejects malformed TransparentPart transport facts", () => {
		expect(() =>
			decodeAnimationRecord(
				transparentPartResponse({ partIndex: 1 }),
				"0x03000001",
			),
		).toThrow("transparent-part index 1 is out of range for 1 parts");
		expect(() =>
			decodeAnimationRecord(
				transparentPartResponse({ durationSeconds: undefined }),
				"0x03000001",
			),
		).toThrow("durationSeconds");
		expect(() =>
			decodeAnimationRecord(
				transparentPartResponse({ start: null }),
				"0x03000001",
			),
		).toThrow("start");
	});

	it("rejects a TransparentPart hook with a mismatched typed payload", () => {
		expect(() =>
			decodeAnimationRecord(
				animationResponse("transparent-part", {
					hookType: 7,
					payload: { kind: "set-omega", omega: [0, 0, 1] },
					rawDirection: 0,
				}),
				"0x03000001",
			),
		).toThrow("hook type 7 requires transparent-part payload");
	});

	it("preserves genuinely deferred raw payloads and validates their section bounds", () => {
		const payloadBytes = Uint8Array.from([1, 2, 3, 4]);
		const decoded = decodeAnimationRecord(
			animationResponse(
				"sound",
				{
					hookType: 1,
					payload: { byteLength: 4, byteOffset: 0, kind: "raw" },
				},
				payloadBytes,
			),
			"0x03000001",
		);

		expect(decoded.hooks[0]).toMatchObject({
			command: "sound",
			kind: "unimplemented",
			payload: { bytes: payloadBytes, kind: "raw" },
		});
		expect(() =>
			decodeAnimationRecord(
				animationResponse(
					"sound",
					{
						hookType: 1,
						payload: { byteLength: 5, byteOffset: 0, kind: "raw" },
					},
					payloadBytes,
				),
				"0x03000001",
			),
		).toThrow("hook payload exceeds its section");
	});

	it("classifies Ethereal as host-owned and presentation-safe", () => {
		const decoded = decodeAnimationRecord(
			animationResponse("ethereal", {
				direction: "forward",
				hookType: 6,
				payload: { ethereal: true, kind: "ethereal" },
				rawDirection: 1,
			}),
			"0x03000001",
		);

		expect(decoded.hooks[0]).toMatchObject({
			blocksActivation: false,
			command: "ethereal",
			kind: "unimplemented",
			payload: { ethereal: true, kind: "ethereal" },
		});
	});
});

function transparentPartResponse(
	overrides: Record<string, unknown> = {},
): Uint8Array {
	return animationResponse(
		"transparent-part",
		{
			direction: "forward",
			hookType: 7,
			payload: {
				durationSeconds: 0.75,
				end: 1,
				kind: "transparent-part",
				partIndex: 0,
				start: 0.25,
				...overrides,
			},
			rawDirection: 1,
		},
		new Uint8Array(),
	);
}

function animationResponse(
	hookName = "set-omega",
	hookOverrides: Record<string, unknown> = {},
	hookPayload = new Uint8Array(),
): Uint8Array {
	const partFrames = new Float32Array([1, 2, 3, 1, 0, 0, 0]);
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
					kind: "set-omega",
					omega: [0, 0, 1],
				},
				rawDirection: 0,
				...hookOverrides,
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
