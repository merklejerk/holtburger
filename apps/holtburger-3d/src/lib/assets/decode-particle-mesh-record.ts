import { z } from "zod";
import type { DatAssetId } from "../game/game-types";
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

const MAGIC = "HBPM";
const HEADER_LENGTH = 12;
const RECORD_LABEL = "Particle mesh record";
const datId = z.string().regex(/^0x[0-9a-f]{8}$/i);

/** Geometry sections the host always writes for an object closure. */
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
	transport: z.literal("holtburger-particle-mesh"),
	byteOrder: z.literal("little-endian"),
	sectionByteOffsetBase: z.literal("section-data"),
	meshes: z
		.array(z.object({ hwGfxObjId: datId, source: z.string().min(1) }))
		.min(1),
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

/**
 * Decoded presentations for one batch of particle meshes.
 *
 * Keyed by `hw_gfxobj_id` because that is what a `CreateParticle` names and what the renderer keys
 * its cohorts on. The presentations are the same shape every other object path produces, so
 * particles draw through ordinary geometry and materials.
 */
export interface ParticleMeshPresentations {
	readonly presentations: ReadonlyMap<DatAssetId, DecodedStaticPresentation>;
	readonly textureDependencies: readonly {
		readonly id: string;
		readonly kind: "surface-texture" | "palette";
	}[];
}

/** Decode and validate one particle-mesh resource closure. */
export function decodeParticleMeshRecord(
	response: Uint8Array,
): ParticleMeshPresentations {
	if (response.byteLength < HEADER_LENGTH)
		throw new Error(`${RECORD_LABEL} is shorter than its binary header.`);
	const view = new DataView(
		response.buffer,
		response.byteOffset,
		response.byteLength,
	);
	if (new TextDecoder().decode(response.subarray(0, 4)) !== MAGIC)
		throw new Error(`Unexpected ${RECORD_LABEL.toLowerCase()} magic.`);
	const manifestLength = view.getUint32(4, true);
	const totalLength = view.getUint32(8, true);
	if (totalLength !== response.byteLength) {
		throw new Error(
			`${RECORD_LABEL} length is ${response.byteLength}; header declares ${totalLength}.`,
		);
	}
	const sectionDataOffset = HEADER_LENGTH + manifestLength;
	const parsed = manifestSchema.safeParse(
		JSON.parse(
			new TextDecoder().decode(
				response.subarray(HEADER_LENGTH, sectionDataOffset),
			),
		),
	);
	if (!parsed.success)
		throw new Error(`${RECORD_LABEL} manifest is invalid: ${parsed.error.message}`);
	const manifest = parsed.data;
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
	const presentations = new Map<DatAssetId, DecodedStaticPresentation>();
	for (const mesh of manifest.meshes) {
		const presentation = definitions.get(mesh.source);
		if (presentation === undefined) {
			throw new Error(
				`Particle mesh ${mesh.hwGfxObjId} references missing source ${mesh.source}.`,
			);
		}
		presentations.set(
			mesh.hwGfxObjId.toLowerCase() as DatAssetId,
			presentation,
		);
	}
	return {
		presentations,
		textureDependencies: manifest.textureDependencies,
	};
}
