import { z } from "zod";

const HEADER_LENGTH = 12;
const MAGIC = "HBAR";
const HEIGHT_TABLE_ENTRY_COUNT = 256;

const finiteNumber = z.number().finite();
const nonNegativeInteger = z.number().int().nonnegative();
const datId = z.string().regex(/^0x[0-9a-f]{8}$/i);

const timeOfDaySchema = z.object({
	start: finiteNumber,
	isNight: z.boolean(),
	name: z.string(),
});

const skyObjectReplacementSchema = z.object({
	objectIndex: nonNegativeInteger,
	gfxObjectId: datId,
	rotate: finiteNumber,
	transparent: finiteNumber,
	luminosity: finiteNumber,
	maxBrightness: finiteNumber,
});

const skyTimeSchema = z.object({
	begin: finiteNumber,
	directionalBrightness: finiteNumber,
	directionalHeading: finiteNumber,
	directionalPitch: finiteNumber,
	directionalColor: nonNegativeInteger,
	ambientBrightness: finiteNumber,
	ambientColor: nonNegativeInteger,
	minWorldFog: finiteNumber,
	maxWorldFog: finiteNumber,
	worldFogColor: nonNegativeInteger,
	worldFog: nonNegativeInteger,
	skyObjectReplacements: z.array(skyObjectReplacementSchema),
});

const skyObjectSchema = z.object({
	beginTime: finiteNumber,
	endTime: finiteNumber,
	beginAngle: finiteNumber,
	endAngle: finiteNumber,
	textureVelocityX: finiteNumber,
	textureVelocityY: finiteNumber,
	defaultGfxObjectId: datId,
	defaultParticleEffectId: datId,
	properties: nonNegativeInteger,
});

const skySchema = z.object({
	tickSize: finiteNumber,
	lightTickSize: finiteNumber,
	dayGroups: z.array(
		z.object({
			chanceOfOccur: finiteNumber,
			dayName: z.string(),
			skyObjects: z.array(skyObjectSchema),
			skyTimes: z.array(skyTimeSchema),
		}),
	),
});

const soundSchema = z.object({
	tables: z.array(
		z.object({
			soundTableId: datId,
			sounds: z.array(
				z.object({
					soundType: nonNegativeInteger,
					volume: finiteNumber,
					baseChance: finiteNumber,
					minRate: finiteNumber,
					maxRate: finiteNumber,
				}),
			),
		}),
	),
});

const textureMergeLandSurfaceSchema = z.object({
	kind: z.literal("texture-merge"),
	baseTextureSize: nonNegativeInteger,
	cornerTerrainMaps: z.array(
		z.object({ terrainCode: nonNegativeInteger, surfaceTextureId: datId }),
	),
	sideTerrainMaps: z.array(
		z.object({ terrainCode: nonNegativeInteger, surfaceTextureId: datId }),
	),
	roadMaps: z.array(
		z.object({ roadCode: nonNegativeInteger, surfaceTextureId: datId }),
	),
	terrainTextures: z.array(
		z.object({
			terrainType: nonNegativeInteger,
			colorTextureId: datId,
			tiling: nonNegativeInteger,
			maxVertexBrightness: nonNegativeInteger,
			minVertexBrightness: nonNegativeInteger,
			maxVertexSaturation: nonNegativeInteger,
			minVertexSaturation: nonNegativeInteger,
			maxVertexHue: nonNegativeInteger,
			minVertexHue: nonNegativeInteger,
			detailTiling: nonNegativeInteger,
			detailTextureId: datId,
		}),
	),
});

const paletteShiftLandSurfaceSchema = z.object({
	kind: z.literal("palette-shift"),
	landTextures: z.array(
		z.object({
			surfaceTextureId: datId,
			subPalettes: z.array(
				z.object({ index: nonNegativeInteger, length: nonNegativeInteger }),
			),
			roadCodes: z.array(
				z.object({
					roadCode: nonNegativeInteger,
					subPaletteTypes: z.array(nonNegativeInteger),
				}),
			),
			terrainPalettes: z.array(
				z.object({
					terrainIndex: nonNegativeInteger,
					paletteId: datId,
				}),
			),
		}),
	),
});

const terrainSchema = z.object({
	types: z.array(
		z.object({
			name: z.string(),
			color: nonNegativeInteger,
			sceneTypes: z.array(nonNegativeInteger),
		}),
	),
	landSurface: z.discriminatedUnion("kind", [
		textureMergeLandSurfaceSchema,
		paletteShiftLandSurfaceSchema,
	]),
});

const activeRegionDataSchema = z.object({
	land: z.object({
		numBlockLength: z.number().int(),
		numBlockWidth: z.number().int(),
		squareLength: finiteNumber,
		landblockLength: z.number().int(),
		verticesPerCell: z.number().int(),
		maxObjectHeight: finiteNumber,
		roadWidth: finiteNumber,
	}),
	calendar: z.object({
		zeroTimeOfYear: finiteNumber,
		zeroYear: nonNegativeInteger,
		dayLength: finiteNumber,
		daysPerYear: nonNegativeInteger,
		yearSpec: z.string(),
		timesOfDay: z.array(timeOfDaySchema),
		daysOfTheWeek: z.array(z.string()),
		seasons: z.array(
			z.object({ startDate: nonNegativeInteger, name: z.string() }),
		),
	}),
	sky: skySchema.nullable(),
	sound: soundSchema.nullable(),
	scenes: z
		.object({
			types: z.array(
				z.object({
					soundTableIndex: nonNegativeInteger,
					sceneIds: z.array(datId),
				}),
			),
		})
		.nullable(),
	terrain: terrainSchema.nullable(),
	misc: z
		.object({
			version: nonNegativeInteger,
			gameMapId: datId,
			autotestMapId: datId,
			autotestMapSize: nonNegativeInteger,
			clearCellId: datId,
			clearMonsterId: datId,
		})
		.nullable(),
});

const manifestSchema = z.object({
	transport: z.literal("holtburger-active-region-data"),
	byteOrder: z.literal("little-endian"),
	sectionByteOffsetBase: z.literal("section-data"),
	provenance: z.object({
		sourceRecordId: datId,
		number: nonNegativeInteger,
		version: nonNegativeInteger,
		name: z.string(),
		partsMask: nonNegativeInteger,
	}),
	data: activeRegionDataSchema,
	sections: z.array(
		z.object({
			name: z.literal("landHeightTable"),
			scalarType: z.literal("f32"),
			elementCount: z.literal(HEIGHT_TABLE_ENTRY_COUNT),
			byteOffset: z.literal(0),
			byteLength: z.literal(
				HEIGHT_TABLE_ENTRY_COUNT * Float32Array.BYTES_PER_ELEMENT,
			),
		}),
	),
});

/** Full typed static records installed for one immutable active content scope. */
type ActiveRegionData = z.infer<typeof activeRegionDataSchema>;

/** Immutable frontend cache value for the host-selected active region. */
export interface ActiveRegionSource {
	/** Record provenance only; it is not a frontend selector or loading key. */
	readonly provenance: z.infer<typeof manifestSchema>["provenance"];
	readonly data: ActiveRegionData;
	/** The 256 authored heights addressed by outdoor CellLandblock height indices. */
	readonly landHeightTable: Float32Array;
}

/** Decode and validate the active-region host response before runtime installation. */
export function decodeActiveRegionSource(
	response: Uint8Array,
): ActiveRegionSource {
	if (response.byteLength < HEADER_LENGTH) {
		throw new Error(
			"Active-region response is shorter than its binary header.",
		);
	}
	const view = new DataView(
		response.buffer,
		response.byteOffset,
		response.byteLength,
	);
	const magic = new TextDecoder().decode(response.subarray(0, 4));
	if (magic !== MAGIC)
		throw new Error(`Unexpected active-region magic ${magic}.`);
	const manifestLength = view.getUint32(4, true);
	const totalLength = view.getUint32(8, true);
	if (totalLength !== response.byteLength) {
		throw new Error(
			`Active-region response is ${response.byteLength}; header declares ${totalLength}.`,
		);
	}
	const sectionDataOffset = HEADER_LENGTH + manifestLength;
	if (sectionDataOffset > response.byteLength) {
		throw new Error("Active-region manifest exceeds the binary response.");
	}
	const manifest = parseManifest(
		new TextDecoder().decode(
			response.subarray(HEADER_LENGTH, sectionDataOffset),
		),
	);
	if (manifest.sections.length !== 1) {
		throw new Error(
			"Active-region response must contain one height-table section.",
		);
	}
	const section = manifest.sections[0];
	const sectionStart = sectionDataOffset + section.byteOffset;
	const sectionEnd = sectionStart + section.byteLength;
	if (sectionEnd !== response.byteLength) {
		throw new Error(
			"Active-region height-table section does not occupy the response tail.",
		);
	}
	if (sectionStart % Float32Array.BYTES_PER_ELEMENT !== 0) {
		throw new Error("Active-region height-table section is not float-aligned.");
	}
	const landHeightTable = new Float32Array(
		response.buffer.slice(
			response.byteOffset + sectionStart,
			response.byteOffset + sectionEnd,
		),
	);
	if (
		landHeightTable.length !== HEIGHT_TABLE_ENTRY_COUNT ||
		![...landHeightTable].every(Number.isFinite)
	) {
		throw new Error("Active-region height table contains invalid values.");
	}
	return {
		provenance: manifest.provenance,
		data: manifest.data,
		landHeightTable,
	};
}

function parseManifest(serialized: string): z.infer<typeof manifestSchema> {
	let rawManifest: unknown;
	try {
		rawManifest = JSON.parse(serialized);
	} catch {
		throw new Error("Active-region manifest is not valid JSON.");
	}
	const parsed = manifestSchema.safeParse(rawManifest);
	if (!parsed.success) {
		throw new Error("Active-region manifest has an incompatible contract.");
	}
	return parsed.data;
}
