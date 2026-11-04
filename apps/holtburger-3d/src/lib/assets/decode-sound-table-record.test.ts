import { describe, expect, it } from "vitest";
import {
	decodeSoundTableRecord,
	selectSoundCandidate,
	type SoundCandidate,
} from "./decode-sound-table-record";
import type { DatAssetId } from "../game/game-types";

function encode(entries: unknown[]): Uint8Array {
	const manifest = {
		byteOrder: "little-endian",
		entries,
		soundTableId: "0x20000001",
		transport: "holtburger-sound-table",
	};
	let body = new TextEncoder().encode(JSON.stringify(manifest));
	while ((12 + body.length) % 4 !== 0) body = Uint8Array.from([...body, 0x20]);
	const bytes = new Uint8Array(12 + body.length);
	bytes.set(new TextEncoder().encode("HBST"), 0);
	new DataView(bytes.buffer).setUint32(4, body.length, true);
	new DataView(bytes.buffer).setUint32(8, bytes.length, true);
	bytes.set(body, 12);
	return bytes;
}

const candidate = (soundId: string): SoundCandidate => ({
	probability: 1,
	soundId: soundId as DatAssetId,
	volume: 0.75,
});

describe("decodeSoundTableRecord", () => {
	it("decodes keyed candidates into a lookup", () => {
		const table = decodeSoundTableRecord(
			encode([
				{
					candidates: [{ probability: 1, soundId: "0x0a000207", volume: 0.75 }],
					soundType: 4,
				},
			]),
			"0x20000001",
		);

		expect(table.entries.get(4)).toEqual([candidate("0x0a000207")]);
		expect(table.entries.get(99)).toBeUndefined();
	});

	it("rejects a key with no candidates", () => {
		// A key that authors nothing could never play; that is a decode fault, not content.
		expect(() =>
			decodeSoundTableRecord(
				encode([{ candidates: [], soundType: 4 }]),
				"0x20000001",
			),
		).toThrow("invalid");
	});
});

describe("selectSoundCandidate", () => {
	it("always returns the only candidate", () => {
		// 4,183 of 4,184 archive keys author exactly one, so this is the overwhelming case.
		const only = [candidate("0x0a000207")];
		expect(selectSoundCandidate(only, 0)).toBe(only[0]);
		expect(selectSoundCandidate(only, 0.999)).toBe(only[0]);
	});

	it("reaches the last candidate, which retail's own formula strands", () => {
		const candidates = [candidate("0x0a000001"), candidate("0x0a000002")];

		// Retail's floor((n - 1) * roll) never reaches index 1. floor(n * roll) splits the roll.
		expect(selectSoundCandidate(candidates, 0)).toBe(candidates[0]);
		expect(selectSoundCandidate(candidates, 0.25)).toBe(candidates[0]);
		expect(selectSoundCandidate(candidates, 0.5)).toBe(candidates[1]);
		expect(selectSoundCandidate(candidates, 0.999)).toBe(candidates[1]);
		// Unreachable from `Random::rand`, but it must not index past the end.
		expect(selectSoundCandidate(candidates, 1)).toBe(candidates[1]);
	});

	it("reports an empty candidate list rather than inventing a sound", () => {
		expect(selectSoundCandidate([], 0.5)).toBeNull();
	});
});
