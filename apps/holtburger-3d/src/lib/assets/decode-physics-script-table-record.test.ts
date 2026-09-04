import { describe, expect, it } from "vitest";
import type { DatAssetId } from "../game/game-types";
import {
	decodePhysicsScriptTableRecord,
	selectPhysicsScript,
} from "./decode-physics-script-table-record";

function encode(cues: unknown[]): Uint8Array {
	const manifest = {
		byteOrder: "little-endian",
		cues,
		physicsScriptTableId: "0x34000001",
		transport: "holtburger-physics-script-table",
	};
	const body = new TextEncoder().encode(JSON.stringify(manifest));
	const bytes = new Uint8Array(12 + body.length);
	bytes.set(new TextEncoder().encode("HBPT"), 0);
	new DataView(bytes.buffer).setUint32(4, body.length, true);
	new DataView(bytes.buffer).setUint32(8, bytes.length, true);
	bytes.set(body, 12);
	return bytes;
}

const TABLE_ID = "0x34000001" as DatAssetId;

describe("decodePhysicsScriptTableRecord", () => {
	it("decodes cue thresholds into a lookup", () => {
		const table = decodePhysicsScriptTableRecord(
			encode([
				{
					choices: [
						{ maximumIntensity: 0.25, scriptId: "0x33000001" },
						{ maximumIntensity: 1, scriptId: "0x33000002" },
					],
					cue: 7,
				},
			]),
			TABLE_ID,
		);

		expect(table.cues.get(7)).toEqual([
			{ maximumIntensity: 0.25, scriptId: "0x33000001" },
			{ maximumIntensity: 1, scriptId: "0x33000002" },
		]);
	});

	it("rejects duplicate cue keys instead of choosing an arbitrary entry", () => {
		expect(() =>
			decodePhysicsScriptTableRecord(
				encode([
					{
						choices: [{ maximumIntensity: 1, scriptId: "0x33000001" }],
						cue: 7,
					},
					{
						choices: [{ maximumIntensity: 1, scriptId: "0x33000002" }],
						cue: 7,
					},
				]),
				TABLE_ID,
			),
		).toThrow("repeats cue 7");
	});
});

describe("selectPhysicsScript", () => {
	const table = decodePhysicsScriptTableRecord(
		encode([
			{
				choices: [
					{ maximumIntensity: 0.25, scriptId: "0x33000001" },
					{ maximumIntensity: 0.75, scriptId: "0x33000002" },
				],
				cue: 7,
			},
		]),
		TABLE_ID,
	);

	it("selects the first inclusive intensity threshold", () => {
		expect(selectPhysicsScript(table, 7, 0.25)).toBe("0x33000001");
		expect(selectPhysicsScript(table, 7, 0.250_001)).toBe("0x33000002");
	});

	it("returns no script when the cue or intensity has no authored match", () => {
		expect(selectPhysicsScript(table, 8, 0.1)).toBeNull();
		expect(selectPhysicsScript(table, 7, 0.9)).toBeNull();
	});
});
