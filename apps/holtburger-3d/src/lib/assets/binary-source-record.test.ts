import { describe, expect, it } from "vitest";
import {
	readBinarySection,
	readBinarySectionSlice,
	validateBinarySections,
} from "./binary-source-record";

describe("binary source record sections", () => {
	it.each([NaN, Infinity, -Infinity])(
		"rejects non-finite float %s anywhere in the requested slice",
		(value) => {
			for (const index of [0, 1, 2]) {
				const values = new Float32Array([1, 2, 3]);
				values[index] = value;
				expect(() => readFloats(new Uint8Array(values.buffer), 0, 3)).toThrow(
					"Fixture positions section contains non-finite values.",
				);
			}
		},
	);

	it("reads an isolated finite slice from an offset response without retaining its buffer", () => {
		const values = new Float32Array([99, NaN, -0, 1.25, -2.5, Infinity]);
		const response = new Uint8Array(
			values.buffer,
			Float32Array.BYTES_PER_ELEMENT,
		);
		const result = readFloats(response, 1, 3);
		expect(result).toEqual(new Float32Array([-0, 1.25, -2.5]));
		expect(result.buffer).not.toBe(response.buffer);
		values[3] = 42;
		expect(result[1]).toBe(1.25);
		result[2] = 10;
		expect(values[4]).toBe(-2.5);
	});

	it("accepts an empty float slice without validating neighboring values", () => {
		const values = new Float32Array([NaN]);
		expect(readFloats(new Uint8Array(values.buffer), 1, 0)).toEqual(
			new Float32Array(),
		);
	});

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

/** Float-section fixture whose requested slice may exclude invalid neighboring values. */
function readFloats(
	response: Uint8Array,
	offset: number,
	count: number,
): Float32Array {
	return readBinarySectionSlice(
		response,
		0,
		{
			name: "positions",
			scalarType: "f32",
			elementCount: response.byteLength / Float32Array.BYTES_PER_ELEMENT,
			byteOffset: 0,
			byteLength: response.byteLength,
		},
		offset,
		count,
		Float32Array,
		"Fixture",
	);
}
