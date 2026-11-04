import { describe, expect, it } from "vitest";
import { decodeAudioRecord } from "./decode-audio-record";

function encode(
	overrides: Record<string, unknown> = {},
	payload = new Uint8Array([1, 2, 3, 4]),
): Uint8Array {
	const manifest = {
		bitsPerSample: 16,
		byteOrder: "little-endian",
		channels: 1,
		mediaType: "audio/wav",
		payloadByteLength: payload.length,
		samplesPerSecond: 11025,
		soundId: "0x0a000207",
		transport: "holtburger-audio",
		...overrides,
	};
	let body = new TextEncoder().encode(JSON.stringify(manifest));
	while ((12 + body.length) % 4 !== 0) body = Uint8Array.from([...body, 0x20]);
	const bytes = new Uint8Array(12 + body.length + payload.length);
	bytes.set(new TextEncoder().encode("HBAU"), 0);
	new DataView(bytes.buffer).setUint32(4, body.length, true);
	new DataView(bytes.buffer).setUint32(8, bytes.length, true);
	bytes.set(body, 12);
	bytes.set(payload, 12 + body.length);
	return bytes;
}

describe("decodeAudioRecord", () => {
	it("returns a decoder-ready payload with its media type", () => {
		const record = decodeAudioRecord(encode(), "0x0a000207");

		expect(record.id).toBe("0x0a000207");
		expect(record.mediaType).toBe("audio/wav");
		expect([...new Uint8Array(record.payload)]).toEqual([1, 2, 3, 4]);
	});

	it("copies the payload so decodeAudioData cannot detach the response", () => {
		const response = encode();
		const record = decodeAudioRecord(response, "0x0a000207");

		// A view would share the response buffer, which decodeAudioData detaches on use.
		expect(record.payload.byteLength).toBe(4);
		expect(record.payload).not.toBe(response.buffer);
	});

	it("rejects a payload length that disagrees with its manifest", () => {
		expect(() =>
			decodeAudioRecord(encode({ payloadByteLength: 99 }), "0x0a000207"),
		).toThrow("manifest declares 99");
	});

	it("rejects a response served for a different sound", () => {
		expect(() => decodeAudioRecord(encode(), "0x0a000999")).toThrow(
			"returned 0x0a000207 for 0x0a000999",
		);
	});
});
