import type { ActiveRegionSource } from "./active-region-source";
import { resolveOutdoorTerrainLayer } from "../game/terrain/active-region-terrain-resolver";
import type { ResolvedTerrainLayerSource } from "../game/resolution/landblock-layer";
import type { LandblockId } from "../game/game-types";
import {
	OUTDOOR_TERRAIN_GRID_CELLS,
	OUTDOOR_TERRAIN_GRID_SIZE,
} from "../game/landblocks";

const HEADER_LENGTH = 12;
const MAGIC = "HBTR";

interface BinarySection {
	readonly name:
		| "heightIndices"
		| "resolvedHeights"
		| "terrainSamples"
		| "cellDiagonals";
	readonly scalarType: "u8" | "u16" | "f32";
	readonly elementCount: number;
	readonly byteOffset: number;
	readonly byteLength: number;
}

type TerrainAvailability = "available" | "missing-cell-landblock";

interface TerrainSourceManifest {
	readonly transport: "holtburger-landblock-terrain-record";
	readonly byteOrder: "little-endian";
	readonly sectionByteOffsetBase: "section-data";
	readonly landblockId: string;
	/** Typed host outcome for the requested outdoor CellLandblock source. */
	readonly terrainAvailability: TerrainAvailability;
	readonly sections: readonly BinarySection[];
}

/** Decode and validate one terrain record nested in a landblock source batch. */
export function decodeLandblockTerrainRecord(
	response: Uint8Array,
	requestedLandblockId: LandblockId,
	activeRegion: ActiveRegionSource,
): ResolvedTerrainLayerSource | null {
	if (response.byteLength < HEADER_LENGTH) {
		throw new Error(
			"Landblock terrain record is shorter than its binary header.",
		);
	}
	const view = new DataView(
		response.buffer,
		response.byteOffset,
		response.byteLength,
	);
	const magic = new TextDecoder().decode(response.subarray(0, 4));
	if (magic !== MAGIC)
		throw new Error(`Unexpected landblock terrain record magic ${magic}.`);
	const manifestLength = view.getUint32(4, true);
	const totalLength = view.getUint32(8, true);
	if (totalLength !== response.byteLength) {
		throw new Error(
			`Landblock terrain record length is ${response.byteLength}; header declares ${totalLength}.`,
		);
	}
	const sectionDataOffset = HEADER_LENGTH + manifestLength;
	if (sectionDataOffset > response.byteLength) {
		throw new Error(
			"Landblock terrain record manifest exceeds the binary response.",
		);
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
			`Landblock terrain record returned ${manifest.landblockId} for ${requestedLandblockId}.`,
		);
	}
	if (manifest.terrainAvailability !== "available") {
		if (manifest.terrainAvailability === "missing-cell-landblock") return null;
		throw new Error(
			`Landblock terrain record is unavailable: ${manifest.terrainAvailability}.`,
		);
	}
	const sections = new Map(
		manifest.sections.map((section) => [section.name, section]),
	);
	if (sections.size !== 4 || sections.size !== manifest.sections.length) {
		throw new Error(
			"Landblock terrain record must contain each raw grid section exactly once.",
		);
	}
	const expectedCount = OUTDOOR_TERRAIN_GRID_SIZE ** 2;
	const heightIndices = readSection(
		response,
		sectionDataOffset,
		requireSection(sections, "heightIndices", "u8", expectedCount),
		Uint8Array,
	);
	const heights = readSection(
		response,
		sectionDataOffset,
		requireSection(sections, "resolvedHeights", "f32", expectedCount),
		Float32Array,
	);
	const terrainSamples = readSection(
		response,
		sectionDataOffset,
		requireSection(sections, "terrainSamples", "u16", expectedCount),
		Uint16Array,
	);
	const cellDiagonals = readSection(
		response,
		sectionDataOffset,
		requireSection(
			sections,
			"cellDiagonals",
			"u8",
			OUTDOOR_TERRAIN_GRID_CELLS ** 2,
		),
		Uint8Array,
	);
	return resolveOutdoorTerrainLayer(
		{
			cellDiagonals,
			heightIndices,
			heights,
			landblockId: manifest.landblockId,
			terrainSamples,
		},
		activeRegion,
	);
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
		manifest.transport !== "holtburger-landblock-terrain-record" ||
		manifest.byteOrder !== "little-endian" ||
		manifest.sectionByteOffsetBase !== "section-data" ||
		typeof manifest.landblockId !== "string" ||
		!isTerrainAvailability(manifest.terrainAvailability) ||
		!Array.isArray(manifest.sections)
	) {
		throw new Error(
			"Landblock terrain record manifest has an incompatible contract.",
		);
	}
	return manifest as unknown as TerrainSourceManifest;
}

function isTerrainAvailability(value: unknown): value is TerrainAvailability {
	return value === "available" || value === "missing-cell-landblock";
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
		throw new Error(
			`Landblock terrain record ${section.name} byte range is invalid.`,
		);
	}
	const bytes = Uint8Array.from(response.subarray(start, end));
	return new ArrayType(bytes.buffer, 0, section.elementCount);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
