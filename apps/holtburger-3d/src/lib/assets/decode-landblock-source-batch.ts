import { z } from "zod";
import type { LandblockId } from "../game/game-types";
import { LandblockLayerKind } from "../game/runtime/scene-interest";
import type { ActiveRegionSource } from "./active-region-source";
import { decodeLandblockTerrainRecord } from "./decode-landblock-terrain-record";
import {
	decodeOutdoorStaticRecord,
	type OutdoorStaticLayerKind,
} from "./decode-outdoor-static-record";
import type {
	LandblockSourceBatch,
	LandblockSourceRecord,
	LandblockSourceLayer,
} from "./landblock-source-batch";

const HEADER_LENGTH = 16;
const MAGIC = "HBLB";
const VERSION = 1;
const datId = z.string().regex(/^0x[0-9a-f]{8}$/i);
const layer = z.enum([
	LandblockLayerKind.Terrain,
	LandblockLayerKind.Buildings,
	LandblockLayerKind.Objects,
]);
const manifestSchema = z.object({
	transport: z.literal("holtburger-landblock-source-batch"),
	version: z.literal(VERSION),
	byteOrder: z.literal("little-endian"),
	recordByteOffsetBase: z.literal("record-data"),
	landblockId: datId,
	requestedLayers: z.array(layer).nonempty(),
	records: z.array(
		z.object({
			layer,
			byteOffset: z.number().int().nonnegative(),
			byteLength: z.number().int().positive(),
		}),
	),
});

/** Decodes, validates, and projects one closed landblock source batch response. */
export function decodeLandblockSourceBatch(
	response: Uint8Array,
	requestedLandblockId: LandblockId,
	requestedLayers: ReadonlySet<LandblockSourceLayer>,
	activeRegion: ActiveRegionSource,
): LandblockSourceBatch {
	if (response.byteLength < HEADER_LENGTH) {
		throw new Error(
			"Landblock source batch is shorter than its binary header.",
		);
	}
	const view = new DataView(
		response.buffer,
		response.byteOffset,
		response.byteLength,
	);
	const magic = new TextDecoder().decode(response.subarray(0, 4));
	if (magic !== MAGIC)
		throw new Error(`Unexpected landblock source batch magic ${magic}.`);
	const version = view.getUint32(4, true);
	if (version !== VERSION) {
		throw new Error(`Unsupported landblock source batch version ${version}.`);
	}
	const manifestLength = view.getUint32(8, true);
	const totalLength = view.getUint32(12, true);
	if (totalLength !== response.byteLength) {
		throw new Error(
			`Landblock source batch length is ${response.byteLength}; header declares ${totalLength}.`,
		);
	}
	const recordDataOffset = HEADER_LENGTH + manifestLength;
	if (recordDataOffset > response.byteLength) {
		throw new Error(
			"Landblock source batch manifest exceeds the binary response.",
		);
	}
	const manifest = parseManifest(
		new TextDecoder().decode(
			response.subarray(HEADER_LENGTH, recordDataOffset),
		),
	);
	if (
		manifest.landblockId.toLowerCase() !== requestedLandblockId.toLowerCase()
	) {
		throw new Error(
			`Landblock source batch returned ${manifest.landblockId} for ${requestedLandblockId}.`,
		);
	}
	assertExactLayerSet(
		manifest.requestedLayers,
		requestedLayers,
		"requested layer set",
	);
	if (manifest.records.length !== manifest.requestedLayers.length) {
		throw new Error(
			"Landblock source batch must contain exactly one record for every requested layer.",
		);
	}
	assertExactLayerSet(
		manifest.records.map((record) => record.layer),
		requestedLayers,
		"returned record set",
	);
	if (
		new Set(manifest.records.map((record) => record.layer)).size !==
		manifest.records.length
	) {
		throw new Error("Landblock source batch contains duplicate layer records.");
	}

	const records = new Map<LandblockSourceLayer, LandblockSourceRecord>();
	for (const record of manifest.records) {
		if (records.has(record.layer)) {
			throw new Error(
				`Landblock source batch contains duplicate ${record.layer} records.`,
			);
		}
		const start = recordDataOffset + record.byteOffset;
		const end = start + record.byteLength;
		if (start < recordDataOffset || end > response.byteLength) {
			throw new Error(
				`Landblock source batch ${record.layer} record byte range is invalid.`,
			);
		}
		const bytes = Uint8Array.from(response.subarray(start, end));
		const decoded = decodeRecord(
			record.layer,
			bytes,
			requestedLandblockId,
			activeRegion,
		);
		records.set(record.layer, decoded);
	}
	return { landblockId: manifest.landblockId as LandblockId, records };
}

function decodeRecord(
	layer: LandblockSourceLayer,
	bytes: Uint8Array,
	landblockId: LandblockId,
	activeRegion: ActiveRegionSource,
) {
	if (layer === LandblockLayerKind.Terrain) {
		return decodeLandblockTerrainRecord(bytes, landblockId, activeRegion);
	}
	return decodeOutdoorStaticRecord(
		bytes,
		landblockId,
		layer as OutdoorStaticLayerKind,
	);
}

function parseManifest(serialized: string): z.infer<typeof manifestSchema> {
	let value: unknown;
	try {
		value = JSON.parse(serialized);
	} catch {
		throw new Error("Landblock source batch manifest is not valid JSON.");
	}
	const parsed = manifestSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`Landblock source batch manifest is invalid: ${parsed.error.message}`,
		);
	}
	return parsed.data;
}

function assertExactLayerSet(
	actual: Iterable<LandblockSourceLayer>,
	expected: ReadonlySet<LandblockSourceLayer>,
	label: string,
): void {
	const actualSet = new Set(actual);
	if (
		actualSet.size !== expected.size ||
		[...expected].some((layer) => !actualSet.has(layer))
	) {
		throw new Error(
			`Landblock source batch ${label} does not match the request.`,
		);
	}
}
