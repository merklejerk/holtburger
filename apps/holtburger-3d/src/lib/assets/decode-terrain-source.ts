import { LandblockLayerKind } from "../game/runtime/scene-interest";
import { resolveTerrainTextureFacts } from "../game/terrain/types";
import type { TerrainCompositionFacts } from "../game/terrain/types";
import type { ResolvedTerrainLayerSource } from "../game/resolution/landblock-layer";
import type { LandblockId } from "../game/game-types";

const HEADER_LENGTH = 16;
const MAGIC = "HBTR";
const VERSION = 1;

interface BinarySection {
	readonly name: "heightIndices" | "heights" | "terrainSamples";
	readonly scalarType: "u8" | "f32" | "u16";
	readonly elementCount: number;
	readonly byteOffset: number;
	readonly byteLength: number;
}

interface TerrainManifest {
	readonly gridSize: number;
	readonly tileSize: number;
}

type TerrainAvailability =
	| "available"
	| "missing-cell-landblock"
	| "cell-landblock-decode-failed"
	| "terrain-assembly-failed";

interface TerrainSourceManifest {
	readonly transport: "holtburger-terrain-source";
	readonly version: number;
	readonly byteOrder: "little-endian";
	readonly sectionByteOffsetBase: "section-data";
	readonly landblockId: string;
	readonly regionNumber: number;
	readonly terrain: TerrainManifest | null;
	/** Typed host outcome for the requested outdoor CellLandblock source. */
	readonly terrainAvailability: TerrainAvailability;
	readonly composition: TerrainCompositionFacts;
	readonly sections: readonly BinarySection[];
}

/** Decode and validate one versioned binary terrain-source host response. */
export function decodeTerrainSource(
	response: Uint8Array,
	requestedLandblockId: LandblockId,
): ResolvedTerrainLayerSource | null {
	if (response.byteLength < HEADER_LENGTH) {
		throw new Error(
			"Terrain source response is shorter than its binary header.",
		);
	}
	const view = new DataView(
		response.buffer,
		response.byteOffset,
		response.byteLength,
	);
	const magic = new TextDecoder().decode(response.subarray(0, 4));
	if (magic !== MAGIC)
		throw new Error(`Unexpected terrain source magic ${magic}.`);
	const version = view.getUint32(4, true);
	if (version !== VERSION) {
		throw new Error(`Unsupported terrain source version ${version}.`);
	}
	const manifestLength = view.getUint32(8, true);
	const totalLength = view.getUint32(12, true);
	if (totalLength !== response.byteLength) {
		throw new Error(
			`Terrain source length is ${response.byteLength}; header declares ${totalLength}.`,
		);
	}
	const sectionDataOffset = HEADER_LENGTH + manifestLength;
	if (sectionDataOffset > response.byteLength) {
		throw new Error("Terrain source manifest exceeds the binary response.");
	}
	const manifest = parseManifest(
		new TextDecoder().decode(
			response.subarray(HEADER_LENGTH, sectionDataOffset),
		),
	);
	if (
		manifest.landblockId.toLowerCase() !== requestedLandblockId.toLowerCase()
	) {
		throw new Error(
			`Terrain source returned ${manifest.landblockId} for ${requestedLandblockId}.`,
		);
	}
	if (manifest.terrain === null) {
		if (manifest.terrainAvailability === "missing-cell-landblock") return null;
		throw new Error(
			`Terrain source is unavailable: ${manifest.terrainAvailability}.`,
		);
	}
	if (manifest.terrainAvailability !== "available") {
		throw new Error(
			`Terrain source has terrain data but declares ${manifest.terrainAvailability}.`,
		);
	}
	const expectedCount = manifest.terrain.gridSize * manifest.terrain.gridSize;
	if (
		!Number.isInteger(manifest.terrain.gridSize) ||
		manifest.terrain.gridSize < 2 ||
		!Number.isFinite(manifest.terrain.tileSize) ||
		manifest.terrain.tileSize <= 0
	) {
		throw new Error("Terrain source declares an invalid authored grid.");
	}
	const sections = new Map(
		manifest.sections.map((section) => [section.name, section]),
	);
	if (sections.size !== 3 || sections.size !== manifest.sections.length) {
		throw new Error(
			"Terrain source must contain each typed grid section exactly once.",
		);
	}
	const heightIndices = readSection(
		response,
		sectionDataOffset,
		requireSection(sections, "heightIndices", "u8", expectedCount),
		Uint8Array,
	);
	const heights = readSection(
		response,
		sectionDataOffset,
		requireSection(sections, "heights", "f32", expectedCount),
		Float32Array,
	);
	const terrainSamples = readSection(
		response,
		sectionDataOffset,
		requireSection(sections, "terrainSamples", "u16", expectedCount),
		Uint16Array,
	);
	if (![...heights].every(Number.isFinite)) {
		throw new Error("Terrain source contains a non-finite resolved height.");
	}
	const composition = validateComposition(manifest.composition);
	return {
		generation: {
			gridSize: manifest.terrain.gridSize,
			heightIndices,
			heights,
			landblockId: manifest.landblockId,
			terrainSamples,
			tileSize: manifest.terrain.tileSize,
		},
		kind: LandblockLayerKind.Terrain,
		landblockId: manifest.landblockId,
		presentation: {
			composition,
			textures: resolveTerrainTextureFacts(composition),
		},
	};
}

function parseManifest(serialized: string): TerrainSourceManifest {
	let manifest: unknown;
	try {
		manifest = JSON.parse(serialized);
	} catch {
		throw new Error("Terrain source manifest is not valid JSON.");
	}
	if (!isRecord(manifest))
		throw new Error("Terrain source manifest is not an object.");
	if (
		manifest.transport !== "holtburger-terrain-source" ||
		manifest.version !== VERSION ||
		manifest.byteOrder !== "little-endian" ||
		manifest.sectionByteOffsetBase !== "section-data" ||
		typeof manifest.landblockId !== "string" ||
		typeof manifest.regionNumber !== "number" ||
		!isTerrainAvailability(manifest.terrainAvailability) ||
		!Array.isArray(manifest.sections)
	) {
		throw new Error("Terrain source manifest has an incompatible contract.");
	}
	return manifest as unknown as TerrainSourceManifest;
}

function isTerrainAvailability(value: unknown): value is TerrainAvailability {
	return (
		value === "available" ||
		value === "missing-cell-landblock" ||
		value === "cell-landblock-decode-failed" ||
		value === "terrain-assembly-failed"
	);
}

function validateComposition(
	composition: TerrainCompositionFacts,
): TerrainCompositionFacts {
	if (
		!isRecord(composition) ||
		!Number.isInteger(composition.regionNumber) ||
		composition.regionNumber < 0 ||
		!Array.isArray(composition.terrainTypes) ||
		composition.terrainTypes.length === 0 ||
		!Array.isArray(composition.cornerTerrainAlphaMaps) ||
		!Array.isArray(composition.sideTerrainAlphaMaps) ||
		!Array.isArray(composition.roadAlphaMaps) ||
		!isRecord(composition.landscapeDetail)
	) {
		throw new Error("Terrain source composition is invalid.");
	}
	if (
		composition.cornerTerrainAlphaMaps.length === 0 ||
		composition.sideTerrainAlphaMaps.length === 0 ||
		composition.roadAlphaMaps.length === 0
	) {
		throw new Error(
			"Terrain source composition is missing a required texture family.",
		);
	}
	for (const terrain of composition.terrainTypes) {
		if (
			!isRecord(terrain) ||
			!isNonNegativeInteger(terrain.terrainType) ||
			!isSurfaceTextureAssetId(terrain.colorTextureId) ||
			!isPositiveFiniteNumber(terrain.tiling) ||
			!isColorVariation(terrain.colorVariation)
		) {
			throw new Error(
				"Terrain source contains an invalid terrain material entry.",
			);
		}
	}
	for (const alphaMap of [
		...composition.cornerTerrainAlphaMaps,
		...composition.sideTerrainAlphaMaps,
	]) {
		if (
			!isRecord(alphaMap) ||
			!isNonNegativeInteger(alphaMap.terrainCode) ||
			!isSurfaceTextureAssetId(alphaMap.blendMaskTextureId)
		) {
			throw new Error("Terrain source contains an invalid blend-mask entry.");
		}
	}
	for (const roadMap of composition.roadAlphaMaps) {
		if (
			!isRecord(roadMap) ||
			!isNonNegativeInteger(roadMap.roadCode) ||
			!isSurfaceTextureAssetId(roadMap.roadMaskTextureId)
		) {
			throw new Error("Terrain source contains an invalid road-mask entry.");
		}
	}
	if (
		!isSurfaceTextureAssetId(composition.landscapeDetail.textureId) ||
		!isPositiveFiniteNumber(composition.landscapeDetail.tiling)
	) {
		throw new Error(
			"Terrain source contains an invalid landscape-detail entry.",
		);
	}
	return composition;
}

function isColorVariation(value: unknown): boolean {
	return (
		isRecord(value) &&
		isFiniteNumber(value.minVertexBrightness) &&
		isFiniteNumber(value.maxVertexBrightness) &&
		isFiniteNumber(value.minVertexSaturation) &&
		isFiniteNumber(value.maxVertexSaturation) &&
		isFiniteNumber(value.minVertexHue) &&
		isFiniteNumber(value.maxVertexHue)
	);
}

function isSurfaceTextureAssetId(value: unknown): boolean {
	return (
		typeof value === "string" &&
		/^surface-texture\/0x05[0-9a-f]{6}$/i.test(value)
	);
}

function isNonNegativeInteger(value: unknown): boolean {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveFiniteNumber(value: unknown): boolean {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isFiniteNumber(value: unknown): boolean {
	return typeof value === "number" && Number.isFinite(value);
}

function requireSection(
	sections: ReadonlyMap<string, BinarySection>,
	name: BinarySection["name"],
	scalarType: BinarySection["scalarType"],
	elementCount: number,
): BinarySection {
	const section = sections.get(name);
	if (
		section === undefined ||
		section.scalarType !== scalarType ||
		section.elementCount !== elementCount
	) {
		throw new Error(`Terrain source ${name} section is invalid.`);
	}
	return section;
}

function readSection<TArray extends Uint8Array | Uint16Array | Float32Array>(
	response: Uint8Array,
	sectionDataOffset: number,
	section: BinarySection,
	ArrayType: {
		readonly BYTES_PER_ELEMENT: number;
		new (buffer: ArrayBuffer, byteOffset: number, length: number): TArray;
	},
): TArray {
	const expectedLength = section.elementCount * ArrayType.BYTES_PER_ELEMENT;
	const start = sectionDataOffset + section.byteOffset;
	const end = start + section.byteLength;
	if (
		section.byteLength !== expectedLength ||
		section.byteOffset % ArrayType.BYTES_PER_ELEMENT !== 0 ||
		start < sectionDataOffset ||
		end > response.byteLength
	) {
		throw new Error(`Terrain source ${section.name} byte range is invalid.`);
	}
	const bytes = Uint8Array.from(response.subarray(start, end));
	return new ArrayType(bytes.buffer, 0, section.elementCount);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
