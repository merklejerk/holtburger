import { describe, expect, it } from "vitest";
import { decodePhysicsScriptRecord } from "./decode-physics-script-record";

const MAGIC = "HBPS";

/** Build a host-shaped response so the decoder is exercised over real transport bytes. */
function encode(
	manifest: Record<string, unknown>,
	sectionBytes = new Uint8Array(),
): Uint8Array {
	let manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
	while ((12 + manifestBytes.length) % 4 !== 0) {
		manifestBytes = Uint8Array.from([...manifestBytes, 0x20]);
	}
	const total = 12 + manifestBytes.length + sectionBytes.length;
	const bytes = new Uint8Array(total);
	bytes.set(new TextEncoder().encode(MAGIC), 0);
	new DataView(bytes.buffer).setUint32(4, manifestBytes.length, true);
	new DataView(bytes.buffer).setUint32(8, total, true);
	bytes.set(manifestBytes, 12);
	bytes.set(sectionBytes, 12 + manifestBytes.length);
	return bytes;
}

function manifest(records: unknown[], lengthSeconds: number) {
	return {
		byteOrder: "little-endian",
		lengthSeconds,
		records,
		scriptId: "0x33000863",
		sectionByteOffsetBase: "section-data",
		sections: [
			{
				byteLength: 0,
				byteOffset: 0,
				elementCount: 0,
				name: "hookPayloadBytes",
				scalarType: "u8",
			},
		],
		transport: "holtburger-physics-script",
	};
}

const SOUND_RECORD = {
	authoredOrder: 0,
	hookName: "sound-tweaked",
	hookType: 21,
	payload: {
		kind: "sound-tweaked",
		probability: 1,
		soundId: "0x0a000207",
		unused: 0,
		volume: 0.3,
	},
	startTime: 0,
};

const CALL_RECORD = {
	authoredOrder: 1,
	hookName: "call-pes",
	hookType: 19,
	payload: { kind: "call-pes", pauseSeconds: 1, scriptId: "0x33000863" },
	startTime: 2,
};

describe("decodePhysicsScriptRecord", () => {
	it("decodes the representative self-cycling script into semantic commands", () => {
		const decoded = decodePhysicsScriptRecord(
			encode(manifest([SOUND_RECORD, CALL_RECORD], 2)),
			"0x33000863",
		);

		expect(decoded.id).toBe("0x33000863");
		expect(decoded.lengthSeconds).toBe(2);
		// `unused` is dropped at decode: retail parses and discards it, so no consumer may read it.
		expect(decoded.records[0]).toEqual({
			authoredOrder: 0,
			kind: "sound-tweaked",
			probability: 1,
			soundId: "0x0a000207",
			startTime: 0,
			volume: 0.3,
		});
		expect(decoded.records[1]).toMatchObject({
			kind: "call-pes",
			pauseSeconds: 1,
			scriptId: "0x33000863",
		});
	});

	it("rejects a declared length that disagrees with the last record", () => {
		expect(() =>
			decodePhysicsScriptRecord(
				encode(manifest([SOUND_RECORD, CALL_RECORD], 5)),
				"0x33000863",
			),
		).toThrow("declares length 5 but its last record is at 2");
	});

	it("rejects records that are not in execution order", () => {
		expect(() =>
			decodePhysicsScriptRecord(
				encode(
					manifest(
						[
							{ ...CALL_RECORD, authoredOrder: 0, startTime: 2 },
							{ ...SOUND_RECORD, authoredOrder: 1, startTime: 0 },
						],
						0,
					),
				),
				"0x33000863",
			),
		).toThrow("not in execution order");
	});

	it("rejects a hook whose type and payload kind disagree", () => {
		expect(() =>
			decodePhysicsScriptRecord(
				encode(
					manifest(
						[{ ...SOUND_RECORD, hookName: "call-pes", hookType: 19 }],
						0,
					),
				),
				"0x33000863",
			),
		).toThrow("requires call-pes payload, received sound-tweaked");
	});

	it("rejects a response served for a different script", () => {
		expect(() =>
			decodePhysicsScriptRecord(
				encode(manifest([SOUND_RECORD, CALL_RECORD], 2)),
				"0x33000711",
			),
		).toThrow("returned 0x33000863 for 0x33000711");
	});
});
