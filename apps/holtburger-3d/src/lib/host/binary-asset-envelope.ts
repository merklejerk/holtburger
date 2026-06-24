import { z } from "zod";

import {
	assetLookupResponseDtoSchema,
	type AssetLookupResponseDto,
} from "./contracts";

const HEADER_LENGTH = 16;
const MAGIC = "HBAB";
const VERSION = 1;
const SAMPLER_CLAMP_MATERIAL_VARIANT_SIGNATURE = "sampler=clamp";
const SAMPLER_REPEAT_MATERIAL_VARIANT_SIGNATURE = "sampler=repeat";

const binarySectionScalarTypeSchema = z.enum(["f32", "i32", "u8", "u32"]);

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

export function encodeJsonAssetBatchEnvelope(
	responses: readonly AssetLookupResponseDto[],
): ArrayBuffer {
	const manifestBytes = Array.from(
		new TextEncoder().encode(
			JSON.stringify({
				transport: "holtburger-asset-binary",
				version: VERSION,
				byteOrder: "little-endian",
				sectionByteOffsetBase: "section-data",
				responses,
				sections: [],
			}),
		),
	);
	while ((HEADER_LENGTH + manifestBytes.length) % 4 !== 0) {
		manifestBytes.push(0x20);
	}

	const totalLength = HEADER_LENGTH + manifestBytes.length;
	const bytes = new Uint8Array(totalLength);
	bytes.set(
		[...MAGIC].map((character) => character.charCodeAt(0)),
		0,
	);
	const view = new DataView(bytes.buffer);
	view.setUint32(4, VERSION, true);
	view.setUint32(8, manifestBytes.length, true);
	view.setUint32(12, totalLength, true);
	bytes.set(manifestBytes, HEADER_LENGTH);
	return bytes.buffer;
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
	const target = decodeBinarySection(responseRoot, section, bytes);
	assignPath(responseRoot, section.path, target);
}

function decodeBinarySection(
	responseRoot: { responses: AssetLookupResponseDto[] },
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
	if (
		section.role === "prepared.terrainMesh.vertices" ||
		section.role === "landblockTerrain.vertices"
	) {
		return chunk(Array.from(readFloat32Section(bytes)), 3).map(([x, y, z]) => ({
			x,
			y,
			z,
		}));
	}
	if (section.role === "landblockTerrain.triangles") {
		const landblockId = landblockIdForTerrainTriangleSection(
			responseRoot,
			section.path,
		);
		return chunk(Array.from(readFloat32Section(bytes)), 13).map(
			([
				triangleIndex,
				quadIndex,
				triangleInQuad,
				vertexIndexA,
				vertexIndexB,
				vertexIndexC,
				averageHeight,
				minX,
				minY,
				minZ,
				maxX,
				maxY,
				maxZ,
			]) => ({
				terrainTriangleId: `landblock/${formatHex32(
					landblockId,
				)}/outdoor/terrain/triangle/${formatHex16(triangleIndex)}`,
				quadIndex,
				triangleInQuad,
				vertexIndices: [vertexIndexA, vertexIndexB, vertexIndexC],
				averageHeight,
				bounds: {
					min: { x: minX, y: minY, z: minZ },
					max: { x: maxX, y: maxY, z: maxZ },
				},
			}),
		);
	}
	if (section.role === "prepared.terrainMesh.triangles") {
		return chunk(Array.from(readFloat32Section(bytes)), 5).map(
			([a, b, c, terrainType, averageHeight]) => ({
				a,
				b,
				c,
				quadIndex: terrainType,
				triangleInQuad: 0,
				debugTerrainPcode: terrainType,
				averageHeight,
			}),
		);
	}
	if (section.role.endsWith(".renderGeometry.triangles")) {
		return chunk(Array.from(readInt32Section(bytes)), 4).map(
			([polygonId, surfaceId, materialVariantCode, firstVertex]) => ({
				polygonId,
				surfaceId: surfaceId < 0 ? null : surfaceId,
				materialVariantSignature:
					decodeMaterialVariantSignature(materialVariantCode),
				firstVertex,
			}),
		);
	}
	if (section.role.endsWith(".portalApertures.points")) {
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
	if (section.scalarType === "u8") {
		const copy = new Uint8Array(bytes.byteLength);
		copy.set(bytes);
		return copy;
	}
	if (section.scalarType === "u32") {
		return copyUint32Section(bytes);
	}
	throw new Error(
		`Unsupported binary section scalar type ${section.scalarType}.`,
	);
}

function decodeMaterialVariantSignature(code: number): string | null {
	if (code === 1) {
		return SAMPLER_CLAMP_MATERIAL_VARIANT_SIGNATURE;
	}
	if (code === 2) {
		return SAMPLER_REPEAT_MATERIAL_VARIANT_SIGNATURE;
	}
	return null;
}

function landblockIdForTerrainTriangleSection(
	responseRoot: { responses: AssetLookupResponseDto[] },
	path: string,
): number {
	const match = /^responses\.(\d+)\.payload\.terrain\.triangles$/.exec(path);
	if (!match) {
		throw new Error(`Terrain triangle section path ${path} is not supported.`);
	}
	const responseIndex = Number.parseInt(match[1] as string, 10);
	const payload = responseRoot.responses[responseIndex]?.payload;
	if (
		typeof payload !== "object" ||
		payload === null ||
		!("landblockId" in payload) ||
		typeof payload.landblockId !== "number"
	) {
		throw new Error(
			`Terrain triangle section path ${path} could not resolve a landblock id.`,
		);
	}
	return payload.landblockId;
}

function formatHex32(value: number): string {
	return value.toString(16).padStart(8, "0");
}

function formatHex16(value: number): string {
	return value.toString(16).padStart(4, "0");
}

function readFloat32Section(bytes: Uint8Array): Float32Array {
	assertAligned(bytes, Float32Array.BYTES_PER_ELEMENT, "Float32Array");
	return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

function readInt32Section(bytes: Uint8Array): Int32Array {
	assertAligned(bytes, Int32Array.BYTES_PER_ELEMENT, "Int32Array");
	return new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

function copyUint32Section(bytes: Uint8Array): Uint32Array {
	assertAligned(bytes, Uint32Array.BYTES_PER_ELEMENT, "Uint32Array");
	return new Uint32Array(
		bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
	);
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
	return scalarType === "u8" ? 1 : 4;
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
