import { z } from "zod";
import {
	binarySectionSchema,
	validateBinarySections,
} from "./binary-source-record";
import {
	type DecodedStaticPresentation,
	decodeStaticGeometry,
	decodeStaticMaterial,
	decodeStaticPresentation,
	staticDefinitionSchema,
	staticGeometrySchema,
	staticMaterialSchema,
} from "./decode-static-source-record";

const MAGIC = "HBSK";
const HEADER_LENGTH = 12;
const RECORD_LABEL = "Sky source record";
const datId = z.string().regex(/^0x[0-9a-f]{8}$/i);

/** Geometry sections the host always writes, even when the region authors no sky objects. */
const REQUIRED_SECTIONS = {
	positions: "f32",
	normals: "f32",
	textureCoordinates: "f32",
	indices: "u32",
	materialSlots: "u16",
	materialWrapModes: "u8",
	materialSideKinds: "u8",
	materialSideTypes: "u8",
	materialStippling: "u8",
} as const;

const manifestSchema = z.object({
	transport: z.literal("holtburger-sky-source-record"),
	byteOrder: z.literal("little-endian"),
	sectionByteOffsetBase: z.literal("section-data"),
	objects: z.array(z.object({ gfxObjectId: datId, source: z.string().min(1) })),
	definitions: z.array(staticDefinitionSchema),
	geometries: z.array(staticGeometrySchema),
	materials: z.array(staticMaterialSchema),
	textureDependencies: z.array(
		z.object({
			id: z.string().min(1),
			kind: z.enum(["surface-texture", "palette"]),
		}),
	),
	sections: z.array(binarySectionSchema),
});

type SkySourceRecordManifest = z.infer<typeof manifestSchema>;

export type { DecodedStaticPresentation };

/**
 * The active region's closed celestial resource set, keyed by the DAT id a resolved sky object
 * names.
 *
 * The set is closed at region load rather than discovered per day group: the shipped region
 * reaches 16 unique ids across all 20 day groups, so residency costs nothing and no day-group
 * rollover or time-of-day scrub can pop in a missing object.
 */
export interface SkySourcePresentations {
	readonly presentations: ReadonlyMap<string, DecodedStaticPresentation>;
	readonly textureDependencies: readonly {
		readonly id: string;
		readonly kind: "surface-texture" | "palette";
	}[];
}

/** Decode and validate the closed celestial sky resource record. */
export function decodeSkySourceRecord(
	response: Uint8Array,
): SkySourcePresentations {
	if (response.byteLength < HEADER_LENGTH) {
		throw new Error(`${RECORD_LABEL} is shorter than its binary header.`);
	}
	const view = new DataView(
		response.buffer,
		response.byteOffset,
		response.byteLength,
	);
	const magic = new TextDecoder().decode(response.subarray(0, 4));
	if (magic !== MAGIC) {
		throw new Error(`Unexpected sky source record magic ${magic}.`);
	}
	const manifestLength = view.getUint32(4, true);
	const totalLength = view.getUint32(8, true);
	if (totalLength !== response.byteLength) {
		throw new Error(
			`${RECORD_LABEL} length is ${response.byteLength}; header declares ${totalLength}.`,
		);
	}
	const sectionDataOffset = HEADER_LENGTH + manifestLength;
	if (sectionDataOffset > response.byteLength) {
		throw new Error(`${RECORD_LABEL} manifest exceeds the binary response.`);
	}
	const manifest = parseManifest(
		new TextDecoder().decode(
			response.subarray(HEADER_LENGTH, sectionDataOffset),
		),
	);
	const sections = validateBinarySections(
		response,
		sectionDataOffset,
		manifest.sections,
		REQUIRED_SECTIONS,
		RECORD_LABEL,
	);
	const geometries = new Map(
		manifest.geometries.map((entry) => [
			entry.id,
			decodeStaticGeometry(
				entry,
				response,
				sectionDataOffset,
				sections,
				"",
				RECORD_LABEL,
			),
		]),
	);
	const materials = new Map(
		manifest.materials.map((entry) => [entry.id, decodeStaticMaterial(entry)]),
	);
	const definitions = new Map(
		manifest.definitions.map((definition) => [
			definition.id,
			decodeStaticPresentation(definition, geometries, materials),
		]),
	);
	if (definitions.size !== manifest.definitions.length) {
		throw new Error(
			`${RECORD_LABEL} contains duplicate presentation identities.`,
		);
	}
	const presentations = new Map<string, DecodedStaticPresentation>();
	for (const object of manifest.objects) {
		const presentation = definitions.get(object.source);
		if (presentation === undefined) {
			throw new Error(
				`Sky object ${object.gfxObjectId} references missing source ${object.source}.`,
			);
		}
		presentations.set(object.gfxObjectId.toLowerCase(), presentation);
	}
	return {
		presentations,
		textureDependencies: manifest.textureDependencies,
	};
}

function parseManifest(serialized: string): SkySourceRecordManifest {
	let value: unknown;
	try {
		value = JSON.parse(serialized);
	} catch {
		throw new Error(`${RECORD_LABEL} manifest is not valid JSON.`);
	}
	const parsed = manifestSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`${RECORD_LABEL} manifest is invalid: ${parsed.error.message}`,
		);
	}
	return parsed.data;
}
