import { z } from "zod";
import {
	decodeStaticGeometry,
	decodeStaticMaterial,
	decodeStaticPresentation,
	staticDefinitionSchema,
	staticGeometrySchema,
	staticMaterialSchema,
	type DecodedStaticPresentation,
} from "./decode-static-source-record";
import {
	binarySectionSchema,
	validateBinarySections,
} from "./binary-source-record";

const HEADER_LENGTH = 12;
const MAGIC = "HBSV";
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
	transport: z.literal("holtburger-setup-visual"),
	byteOrder: z.literal("little-endian"),
	sectionByteOffsetBase: z.literal("section-data"),
	definitionId: z.string().min(1),
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

/** Decode one complete immutable SetupModel appearance returned by the content host. */
export function decodeSetupVisual(
	response: Uint8Array,
): DecodedStaticPresentation {
	if (response.byteLength < HEADER_LENGTH) {
		throw new Error("Setup visual is shorter than its binary header.");
	}
	const view = new DataView(
		response.buffer,
		response.byteOffset,
		response.byteLength,
	);
	const magic = new TextDecoder().decode(response.subarray(0, 4));
	if (magic !== MAGIC)
		throw new Error(`Unexpected setup visual magic ${magic}.`);
	const manifestLength = view.getUint32(4, true);
	const totalLength = view.getUint32(8, true);
	if (totalLength !== response.byteLength) {
		throw new Error(
			`Setup visual length is ${response.byteLength}; header declares ${totalLength}.`,
		);
	}
	const sectionDataOffset = HEADER_LENGTH + manifestLength;
	if (sectionDataOffset > response.byteLength) {
		throw new Error("Setup visual manifest exceeds the binary response.");
	}
	const parsed = manifestSchema.safeParse(
		JSON.parse(
			new TextDecoder().decode(
				response.subarray(HEADER_LENGTH, sectionDataOffset),
			),
		),
	);
	if (!parsed.success) {
		throw new Error(
			`Setup visual manifest is invalid: ${parsed.error.message}`,
		);
	}
	const manifest = parsed.data;
	const sections = validateBinarySections(
		response,
		sectionDataOffset,
		manifest.sections,
		REQUIRED_SECTIONS,
		"Setup visual",
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
				"Setup visual",
			),
		]),
	);
	if (geometries.size !== manifest.geometries.length) {
		throw new Error("Setup visual contains duplicate geometry identities.");
	}
	const materials = new Map(
		manifest.materials.map((entry) => [entry.id, decodeStaticMaterial(entry)]),
	);
	if (materials.size !== manifest.materials.length) {
		throw new Error("Setup visual contains duplicate material identities.");
	}
	const definitions = new Map(
		manifest.definitions.map((definition) => [
			definition.id,
			decodeStaticPresentation(definition, geometries, materials),
		]),
	);
	if (definitions.size !== manifest.definitions.length) {
		throw new Error("Setup visual contains duplicate presentation identities.");
	}
	const selected = definitions.get(manifest.definitionId);
	if (!selected) {
		throw new Error(
			`Setup visual references missing definition ${manifest.definitionId}.`,
		);
	}
	return {
		...selected,
		// The setup visual is a standalone host envelope, so its exact retained source size is
		// meaningful even though the decoded sections are immediately projected into typed facts.
		sourceByteLength: response.byteLength,
	};
}
