import { z } from "zod";

import {
	assetLookupResponseDtoSchema,
	type AssetLookupResponseDto,
} from "./contracts";

const HEADER_LENGTH = 16;
const MAGIC = "HBAB";
const VERSION = 1;

const binarySectionScalarTypeSchema = z.enum(["f32", "i32"]);

const binarySectionSchema = z.object({
	role: z.string().min(1),
	path: z.string().min(1),
	scalarType: binarySectionScalarTypeSchema,
	componentCount: z.number().int().positive(),
	elementCount: z.number().int().nonnegative(),
	byteOffset: z.number().int().nonnegative(),
	byteLength: z.number().int().nonnegative(),
});

const binaryEnvelopeManifestSchema = z.object({
	transport: z.literal("holtburger-asset-binary"),
	version: z.literal(VERSION),
	byteOrder: z.literal("little-endian"),
	sectionByteOffsetBase: z.literal("section-data"),
	responses: z.array(assetLookupResponseDtoSchema),
	sections: z.array(binarySectionSchema),
});

type BinarySection = z.infer<typeof binarySectionSchema>;

export function decodeBinaryAssetEnvelope(
	value: unknown,
): AssetLookupResponseDto {
	const responses = decodeBinaryAssetBatchEnvelope(value);
	if (responses.length !== 1) {
		throw new Error(
			`Binary asset envelope contained ${responses.length} responses; expected exactly one.`,
		);
	}
	return responses[0] as AssetLookupResponseDto;
}

export function decodeBinaryAssetBatchEnvelope(
	value: unknown,
): AssetLookupResponseDto[] {
	const bytes = normalizeBinaryResponse(value);
	if (bytes.byteLength < HEADER_LENGTH) {
		throw new Error("Binary asset envelope is shorter than its fixed header.");
	}

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const magic = String.fromCharCode(...bytes.slice(0, 4));
	if (magic !== MAGIC) {
		throw new Error(`Binary asset envelope has invalid magic ${magic}.`);
	}

	const version = view.getUint32(4, true);
	if (version !== VERSION) {
		throw new Error(`Binary asset envelope version ${version} is unsupported.`);
	}

	const manifestLength = view.getUint32(8, true);
	const totalLength = view.getUint32(12, true);
	if (totalLength !== bytes.byteLength) {
		throw new Error(
			`Binary asset envelope declared ${totalLength} bytes but received ${bytes.byteLength}.`,
		);
	}
	const manifestStart = HEADER_LENGTH;
	const manifestEnd = manifestStart + manifestLength;
	if (manifestEnd > bytes.byteLength) {
		throw new Error("Binary asset envelope manifest exceeds payload length.");
	}

	const manifestText = new TextDecoder().decode(
		bytes.subarray(manifestStart, manifestEnd),
	);
	const manifest = binaryEnvelopeManifestSchema.parse(JSON.parse(manifestText));
	const sectionDataStart = manifestEnd;
	const hydrated = {
		responses: structuredClone(manifest.responses),
	};
	for (const section of manifest.sections) {
		hydrateBinarySection(hydrated, bytes, sectionDataStart, section);
	}
	return hydrated.responses;
}

function normalizeBinaryResponse(value: unknown): Uint8Array {
	if (value instanceof ArrayBuffer) {
		return new Uint8Array(value);
	}
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}
	if (Array.isArray(value)) {
		return Uint8Array.from(value);
	}
	throw new Error("Binary asset response was not returned as bytes.");
}

function hydrateBinarySection(
	responseRoot: { responses: AssetLookupResponseDto[] },
	envelopeBytes: Uint8Array,
	sectionDataStart: number,
	section: BinarySection,
): void {
	const sectionStart = sectionDataStart + section.byteOffset;
	const sectionEnd = sectionStart + section.byteLength;
	if (sectionEnd > envelopeBytes.byteLength) {
		throw new Error(`Binary section ${section.role} exceeds payload length.`);
	}

	const expectedScalarBytes = scalarByteLength(section.scalarType);
	const expectedByteLength =
		section.elementCount * section.componentCount * expectedScalarBytes;
	if (expectedByteLength !== section.byteLength) {
		throw new Error(
			`Binary section ${section.role} declared inconsistent byte length.`,
		);
	}

	const bytes = envelopeBytes.subarray(sectionStart, sectionEnd);
	const target = decodeBinarySection(section, bytes);
	assignPath(responseRoot, section.path, target);
}

function decodeBinarySection(
	section: BinarySection,
	bytes: Uint8Array,
): unknown {
	if (
		section.role.endsWith(".renderGeometry.positions") ||
		section.role.endsWith(".renderGeometry.normals") ||
		section.role.endsWith(".renderGeometry.uvs")
	) {
		return readFloat32Section(bytes);
	}
	if (section.role === "prepared.terrainMesh.vertices") {
		return chunk(Array.from(readFloat32Section(bytes)), 3).map(([x, y, z]) => ({
			x,
			y,
			z,
		}));
	}
	if (section.role === "prepared.terrainMesh.triangles") {
		return chunk(Array.from(readFloat32Section(bytes)), 5).map(
			([a, b, c, terrainType, averageHeight]) => ({
				a,
				b,
				c,
				terrainType,
				averageHeight,
			}),
		);
	}
	if (section.role.endsWith(".renderGeometry.triangles")) {
		return chunk(Array.from(readInt32Section(bytes)), 3).map(
			([polygonId, surfaceId, firstVertex]) => ({
				polygonId,
				surfaceId: surfaceId < 0 ? null : surfaceId,
				firstVertex,
			}),
		);
	}
	if (section.role === "prepared.interiorCells.portalApertures.points") {
		return chunk(Array.from(readFloat32Section(bytes)), 3).map(([x, y, z]) => ({
			x,
			y,
			z,
		}));
	}
	if (
		section.role === "prepared.spatialItems.bounds" ||
		section.role === "prepared.staticLandblockBvh.nodes.bounds"
	) {
		const [minX, minY, minZ, maxX, maxY, maxZ] = Array.from(
			readFloat32Section(bytes),
		);
		return {
			min: { x: minX, y: minY, z: minZ },
			max: { x: maxX, y: maxY, z: maxZ },
		};
	}
	if (section.scalarType === "f32") {
		return Array.from(readFloat32Section(bytes));
	}
	if (section.scalarType === "i32") {
		return Array.from(readInt32Section(bytes));
	}
	throw new Error(
		`Unsupported binary section scalar type ${section.scalarType}.`,
	);
}

function readFloat32Section(bytes: Uint8Array): Float32Array {
	assertAligned(bytes, Float32Array.BYTES_PER_ELEMENT, "Float32Array");
	return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

function readInt32Section(bytes: Uint8Array): Int32Array {
	assertAligned(bytes, Int32Array.BYTES_PER_ELEMENT, "Int32Array");
	return new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

function assertAligned(
	bytes: Uint8Array,
	alignment: number,
	typeName: string,
): void {
	if (
		bytes.byteOffset % alignment !== 0 ||
		bytes.byteLength % alignment !== 0
	) {
		throw new Error(`Binary section is not aligned for ${typeName}.`);
	}
}

function scalarByteLength(scalarType: BinarySection["scalarType"]): number {
	return scalarType === "f32" ? 4 : 4;
}

function assignPath(
	responseRoot: { responses: AssetLookupResponseDto[] },
	path: string,
	value: unknown,
): void {
	const segments = path.split(".");
	let target: unknown = responseRoot;
	for (const segment of segments.slice(0, -1)) {
		if (typeof target !== "object" || target === null) {
			throw new Error(`Binary section path ${path} cannot be hydrated.`);
		}
		target = (target as Record<string, unknown>)[segment];
	}
	const finalSegment = segments.at(-1);
	if (
		!finalSegment ||
		typeof target !== "object" ||
		target === null ||
		!(finalSegment in target)
	) {
		throw new Error(`Binary section path ${path} cannot be assigned.`);
	}
	(target as Record<string, unknown>)[finalSegment] = value;
}

function chunk(values: number[], size: number): number[][] {
	const chunks: number[][] = [];
	for (let index = 0; index < values.length; index += size) {
		chunks.push(values.slice(index, index + size));
	}
	return chunks;
}
