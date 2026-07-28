import { describe, expect, it } from "vitest";
import {
	readBinarySection,
	validateBinarySections,
} from "./binary-source-record";

describe("binary source record sections", () => {
	it("validates non-overlapping aligned sections and reads typed values", () => {
		const response = new Uint8Array(12);
		new DataView(response.buffer).setUint32(4, 0x01020304, true);
		const sections = validateBinarySections(
			response,
			4,
			[
				{
					name: "indices",
					scalarType: "u32",
					elementCount: 1,
					byteOffset: 0,
					byteLength: 4,
				},
				{
					name: "flags",
					scalarType: "u8",
					elementCount: 1,
					byteOffset: 4,
					byteLength: 1,
				},
			],
			{ indices: "u32", flags: "u8" },
			"Fixture",
		);

		expect(
			readBinarySection(
				response,
				4,
				sections,
				"indices",
				Uint32Array,
				"Fixture",
			),
		).toEqual(Uint32Array.from([0x01020304]));
	});

	it("rejects overlapping sections", () => {
		expect(() =>
			validateBinarySections(
				new Uint8Array(12),
				0,
				[
					{
						name: "first",
						scalarType: "u32",
						elementCount: 2,
						byteOffset: 0,
						byteLength: 8,
					},
					{
						name: "second",
						scalarType: "u32",
						elementCount: 1,
						byteOffset: 4,
						byteLength: 4,
					},
				],
				{ first: "u32", second: "u32" },
				"Fixture",
			),
		).toThrow("overlaps another section");
	});
});
