import { z } from "zod";

const binaryScalarTypeSchema = z.enum(["f32", "u32", "u16", "u8"]);

export const binarySectionSchema = z.object({
	name: z.string().min(1),
	scalarType: binaryScalarTypeSchema,
	elementCount: z.number().int().nonnegative(),
	byteOffset: z.number().int().nonnegative(),
	byteLength: z.number().int().nonnegative(),
});

export type BinaryScalarType = z.infer<typeof binaryScalarTypeSchema>;
export type BinarySectionManifest = z.infer<typeof binarySectionSchema>;

type BinaryArray = Float32Array | Uint32Array | Uint16Array | Uint8Array;
type BinaryArrayConstructor<TArray extends BinaryArray> = {
	readonly BYTES_PER_ELEMENT: number;
	new (buffer: ArrayBuffer, byteOffset: number, length: number): TArray;
};

/** Validate one record's complete, non-overlapping typed section table. */
export function validateBinarySections(
	response: Uint8Array,
	sectionDataOffset: number,
	entries: readonly BinarySectionManifest[],
	required: Readonly<Record<string, BinaryScalarType>>,
	recordLabel: string,
): ReadonlyMap<string, BinarySectionManifest> {
	const sections = new Map(entries.map((entry) => [entry.name, entry]));
	const requiredNames = Object.keys(required);
	if (
		sections.size !== entries.length ||
		sections.size !== requiredNames.length
	) {
		throw new Error(
			`${recordLabel} must contain every binary section exactly once.`,
		);
	}
	const ranges: Array<{ readonly start: number; readonly end: number }> = [];
	for (const name of requiredNames) {
		const expectedType = required[name]!;
		const entry = sections.get(name);
		if (!entry || entry.scalarType !== expectedType) {
			throw new Error(
				`${recordLabel} ${name} section has an incompatible scalar type.`,
			);
		}
		const elementSize = binaryScalarSize(expectedType);
		const start = sectionDataOffset + entry.byteOffset;
		const end = start + entry.byteLength;
		if (
			entry.byteOffset % elementSize !== 0 ||
			entry.byteLength !== entry.elementCount * elementSize ||
			start < sectionDataOffset ||
			end > response.byteLength
		) {
			throw new Error(`${recordLabel} ${name} section byte range is invalid.`);
		}
		if (ranges.some((range) => start < range.end && end > range.start)) {
			throw new Error(
				`${recordLabel} ${name} section overlaps another section.`,
			);
		}
		ranges.push({ start, end });
	}
	return sections;
}

/** Copy and decode a bounded typed slice from one validated section. */
export function readBinarySectionSlice<TArray extends BinaryArray>(
	response: Uint8Array,
	sectionDataOffset: number,
	entry: BinarySectionManifest,
	elementOffset: number,
	elementCount: number,
	ArrayType: BinaryArrayConstructor<TArray>,
	recordLabel: string,
): TArray {
	if (
		elementOffset < 0 ||
		elementCount < 0 ||
		elementOffset + elementCount > entry.elementCount
	) {
		throw new Error(`${recordLabel} ${entry.name} slice exceeds its section.`);
	}
	const sourceOffset =
		sectionDataOffset +
		entry.byteOffset +
		elementOffset * ArrayType.BYTES_PER_ELEMENT;
	const copied = Uint8Array.from(
		response.subarray(
			sourceOffset,
			sourceOffset + elementCount * ArrayType.BYTES_PER_ELEMENT,
		),
	);
	const result = new ArrayType(copied.buffer, 0, elementCount);
	if (
		entry.scalarType === "f32" &&
		Array.from(result).some((value) => !Number.isFinite(value))
	) {
		throw new Error(
			`${recordLabel} ${entry.name} section contains non-finite values.`,
		);
	}
	return result;
}

/** Read one complete validated section with an optional exact element count. */
export function readBinarySection<TArray extends BinaryArray>(
	response: Uint8Array,
	sectionDataOffset: number,
	sections: ReadonlyMap<string, BinarySectionManifest>,
	name: string,
	ArrayType: BinaryArrayConstructor<TArray>,
	recordLabel: string,
	expectedCount?: number,
): TArray {
	const section = sections.get(name);
	if (!section) throw new Error(`${recordLabel} lacks ${name} section.`);
	if (expectedCount !== undefined && section.elementCount !== expectedCount) {
		throw new Error(`${recordLabel} ${name} section has an invalid count.`);
	}
	return readBinarySectionSlice(
		response,
		sectionDataOffset,
		section,
		0,
		section.elementCount,
		ArrayType,
		recordLabel,
	);
}

function binaryScalarSize(type: BinaryScalarType): number {
	return type === "u8" ? 1 : type === "u16" ? 2 : 4;
}
