import { z } from "zod";
import type { LandblockId } from "../game/game-types";
import { AABB3, Mat4, Quat, Vec3 } from "../game/math/types";
import type {
	ResolvedObjectLayerSource,
	ResolvedObjectResident,
} from "../game/resolution/landblock-layer";
import { LandblockLayerKind } from "../game/runtime/scene-interest";
import type {
	ResolvedGeometry,
	ResolvedMaterial,
	ResolvedObjectPart,
	ResolvedObjectPresentation,
} from "../game/resolution/presentation";
import { classifyObjectResidents } from "../game/resolution/object-resident-classifier";

const HEADER_LENGTH = 16;
const MAGIC = "HBBL";
const VERSION = 2;
const datId = z.string().regex(/^0x[0-9a-f]{8}$/i);
const finiteNumber = z.number().finite();
const vec3 = z.tuple([finiteNumber, finiteNumber, finiteNumber]);
const quat = z.tuple([finiteNumber, finiteNumber, finiteNumber, finiteNumber]);
const bounds = z.object({ min: vec3, max: vec3 });
const frame = z.object({ origin: vec3, orientation: quat });
const section = z.object({
	name: z.enum([
		"positions",
		"normals",
		"textureCoordinates",
		"indices",
		"materialSlots",
		"materialWrapModes",
	]),
	scalarType: z.enum(["f32", "u32", "u16", "u8"]),
	elementCount: z.number().int().nonnegative(),
	byteOffset: z.number().int().nonnegative(),
	byteLength: z.number().int().nonnegative(),
});

const geometry = z.object({
	id: z.string().min(1),
	sourceAssetId: z.string().min(1),
	vertexCount: z.number().int().nonnegative(),
	positionOffset: z.number().int().nonnegative(),
	normalOffset: z.number().int().nonnegative(),
	textureCoordinateOffset: z.number().int().nonnegative(),
	indexOffset: z.number().int().nonnegative(),
	indexCount: z.number().int().nonnegative(),
	materialSlotOffset: z.number().int().nonnegative(),
	materialSlotCount: z.number().int().nonnegative(),
	materialWrapModeOffset: z.number().int().nonnegative(),
	materialWrapModeCount: z.number().int().nonnegative(),
	bounds: bounds.nullable(),
});

const material = z.object({
	id: z.string().min(1),
	rawSurfaceFlags: z.number().int().nonnegative(),
	translucency: finiteNumber,
	luminosity: finiteNumber,
	diffuseScale: finiteNumber,
	source: z.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("solid-color"),
			color: z.number().int().nonnegative(),
		}),
		z.object({
			kind: z.literal("texture"),
			surfaceTextureId: datId,
			paletteId: datId.nullable(),
			renderSurfaceIds: z.array(datId),
			defaultPaletteIds: z.array(datId),
			selectedRenderSurface: z.object({
				id: datId,
				format: z.enum([
					"r8g8b8",
					"a8r8g8b8",
					"x8r8g8b8",
					"r5g6b5",
					"a4r4g4b4",
					"a8",
					"index8",
					"index16",
					"dxt1",
					"dxt3",
					"dxt5",
					"unsupported",
				]),
			}),
		}),
	]),
});

const directDefinition = z.object({
	id: z.string().min(1),
	kind: z.literal("gfx-obj"),
	sourceAssetId: z.string().min(1),
	geometryId: z.string().min(1),
	materialIds: z.array(z.string().min(1)),
});
const setupPart = z.object({
	partIndex: z.number().int().nonnegative(),
	parentPartIndex: z.number().int().nonnegative().nullable(),
	geometryId: z.string().min(1),
	defaultScale: vec3,
	defaultPlacement: frame.nullable(),
	materialIds: z.array(z.string().min(1)),
});
const setupDefinition = z.object({
	id: z.string().min(1),
	kind: z.literal("setup-model"),
	sourceAssetId: z.string().min(1),
	parts: z.array(setupPart),
	defaultAnimationId: datId.nullable(),
	defaultMotionTableId: datId.nullable(),
	defaultScriptId: datId.nullable(),
	defaultScriptTableId: datId.nullable(),
	defaultSoundTableId: datId.nullable(),
});
const manifestSchema = z.object({
	transport: z.literal("holtburger-building-source"),
	version: z.literal(VERSION),
	byteOrder: z.literal("little-endian"),
	sectionByteOffsetBase: z.literal("section-data"),
	landblockId: datId,
	residents: z.array(
		z.object({
			id: z.string().min(1),
			source: z.string().min(1),
			placement: frame,
			scale: vec3,
			localBounds: bounds.nullable(),
		}),
	),
	definitions: z.array(
		z.discriminatedUnion("kind", [directDefinition, setupDefinition]),
	),
	geometries: z.array(geometry),
	materials: z.array(material),
	textureDependencies: z.array(
		z.object({
			id: z.string().min(1),
			kind: z.enum(["surface-texture", "palette"]),
		}),
	),
	sections: z.array(section),
});

type BuildingManifest = z.infer<typeof manifestSchema>;
type BuildingGeometry = z.infer<typeof geometry>;
type BuildingMaterial = z.infer<typeof material>;

/** Decode and validate a closed versioned Level 1 building source response. */
export function decodeBuildingSource(
	response: Uint8Array,
	requestedLandblockId: LandblockId,
): ResolvedObjectLayerSource | null {
	if (response.byteLength < HEADER_LENGTH) {
		throw new Error(
			"Building source response is shorter than its binary header.",
		);
	}
	const view = new DataView(
		response.buffer,
		response.byteOffset,
		response.byteLength,
	);
	const magic = new TextDecoder().decode(response.subarray(0, 4));
	if (magic !== MAGIC)
		throw new Error(`Unexpected building source magic ${magic}.`);
	const version = view.getUint32(4, true);
	if (version !== VERSION)
		throw new Error(`Unsupported building source version ${version}.`);
	const manifestLength = view.getUint32(8, true);
	const totalLength = view.getUint32(12, true);
	if (totalLength !== response.byteLength) {
		throw new Error(
			`Building source length is ${response.byteLength}; header declares ${totalLength}.`,
		);
	}
	const sectionDataOffset = HEADER_LENGTH + manifestLength;
	if (sectionDataOffset > response.byteLength) {
		throw new Error("Building source manifest exceeds the binary response.");
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
			`Building source returned ${manifest.landblockId} for ${requestedLandblockId}.`,
		);
	}
	const sections = validatedSections(manifest, response, sectionDataOffset);
	const geometries = new Map(
		manifest.geometries.map((entry) => [
			entry.id,
			decodeGeometry(entry, response, sectionDataOffset, sections),
		]),
	);
	if (geometries.size !== manifest.geometries.length) {
		throw new Error("Building source contains duplicate geometry identities.");
	}
	const materials = new Map(
		manifest.materials.map((entry) => [entry.id, decodeMaterial(entry)]),
	);
	if (materials.size !== manifest.materials.length) {
		throw new Error("Building source contains duplicate material identities.");
	}
	const definitions = new Map(
		manifest.definitions.map((definition) => [
			definition.id,
			decodePresentation(definition, geometries, materials),
		]),
	);
	if (definitions.size !== manifest.definitions.length) {
		throw new Error(
			"Building source contains duplicate presentation identities.",
		);
	}
	const residents: ResolvedObjectResident[] = [];
	for (const resident of manifest.residents) {
		const presentation = definitions.get(resident.source);
		if (!presentation) {
			throw new Error(
				`Building resident ${resident.id} references missing source ${resident.source}.`,
			);
		}
		const resolved: ResolvedObjectResident = {
			id: resident.id,
			presentation,
			placement: {
				envCellId: null,
				landblockId: manifest.landblockId as LandblockId,
				localTransform: acFrameTransform(resident.placement, resident.scale),
			},
			scale: renderScale(resident.scale),
			localBounds: toBounds(resident.localBounds),
			appearance: null,
		};
		residents.push(resolved);
	}
	const { staticResidents, dynamicResidents } = classifyObjectResidents(residents);
	return {
		kind: LandblockLayerKind.Buildings,
		landblockId: manifest.landblockId as LandblockId,
		staticResidents,
		dynamicResidents,
	};
}

function parseManifest(serialized: string): BuildingManifest {
	let value: unknown;
	try {
		value = JSON.parse(serialized);
	} catch {
		throw new Error("Building source manifest is not valid JSON.");
	}
	const parsed = manifestSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`Building source manifest is invalid: ${parsed.error.message}`,
		);
	}
	return parsed.data;
}

function validatedSections(
	manifest: BuildingManifest,
	response: Uint8Array,
	sectionDataOffset: number,
): ReadonlyMap<string, z.infer<typeof section>> {
	const sections = new Map(
		manifest.sections.map((entry) => [entry.name, entry]),
	);
	if (sections.size !== 6 || sections.size !== manifest.sections.length) {
		throw new Error(
			"Building source must contain every geometry section exactly once.",
		);
	}
	for (const [name, scalarType] of [
		["positions", "f32"],
		["normals", "f32"],
		["textureCoordinates", "f32"],
		["indices", "u32"],
		["materialSlots", "u16"],
		["materialWrapModes", "u8"],
	] as const) {
		const entry = sections.get(name);
		if (!entry || entry.scalarType !== scalarType) {
			throw new Error(
				`Building source ${name} section has an incompatible scalar type.`,
			);
		}
		const elementSize =
			scalarType === "u8" ? 1 : scalarType === "u16" ? 2 : 4;
		const start = sectionDataOffset + entry.byteOffset;
		const end = start + entry.byteLength;
		if (
			entry.byteOffset % elementSize !== 0 ||
			entry.byteLength !== entry.elementCount * elementSize ||
			start < sectionDataOffset ||
			end > response.byteLength
		) {
			throw new Error(`Building source ${name} section byte range is invalid.`);
		}
	}
	return sections;
}

function decodeGeometry(
	geometry: BuildingGeometry,
	response: Uint8Array,
	sectionDataOffset: number,
	sections: ReadonlyMap<string, z.infer<typeof section>>,
): ResolvedGeometry {
	if (
		geometry.indexCount % 3 !== 0 ||
		geometry.materialSlotCount * 3 !== geometry.indexCount
	) {
		throw new Error(
			`Geometry ${geometry.id} has inconsistent triangle ranges.`,
		);
	}
	const positions = readSlice(
		response,
		sectionDataOffset,
		requireSection(sections, "positions"),
		geometry.positionOffset,
		geometry.vertexCount * 3,
		Float32Array,
	);
	const normals = readSlice(
		response,
		sectionDataOffset,
		requireSection(sections, "normals"),
		geometry.normalOffset,
		geometry.vertexCount * 3,
		Float32Array,
	);
	const textureCoordinates = readSlice(
		response,
		sectionDataOffset,
		requireSection(sections, "textureCoordinates"),
		geometry.textureCoordinateOffset,
		geometry.vertexCount * 2,
		Float32Array,
	);
	const indices = readSlice(
		response,
		sectionDataOffset,
		requireSection(sections, "indices"),
		geometry.indexOffset,
		geometry.indexCount,
		Uint32Array,
	);
	const materialSlotIndices = readSlice(
		response,
		sectionDataOffset,
		requireSection(sections, "materialSlots"),
		geometry.materialSlotOffset,
		geometry.materialSlotCount,
		Uint16Array,
	);
	const materialWrapModes = readSlice(
		response,
		sectionDataOffset,
		requireSection(sections, "materialWrapModes"),
		geometry.materialWrapModeOffset,
		geometry.materialWrapModeCount,
		Uint8Array,
	);
	if (materialWrapModes.length !== materialSlotIndices.length) {
		throw new Error(
			`Geometry ${geometry.id} must provide one sampler fact per material slot.`,
		);
	}
	if (materialWrapModes.some((wrap) => wrap !== 0 && wrap !== 1)) {
		throw new Error(`Geometry ${geometry.id} has an invalid sampler fact.`);
	}
	if (indices.some((index) => index >= geometry.vertexCount)) {
		throw new Error(`Geometry ${geometry.id} contains an out-of-range index.`);
	}
	return {
		id: `geometry:${geometry.id}`,
		positions,
		normals,
		textureCoordinates,
		indices,
		materialSlotIndices,
		materialWrapModes,
		bounds: toBounds(geometry.bounds),
	};
}

function requireSection(
	sections: ReadonlyMap<string, z.infer<typeof section>>,
	name: z.infer<typeof section>["name"],
): z.infer<typeof section> {
	const entry = sections.get(name);
	if (!entry)
		throw new Error(`Building source lacks ${name} geometry section.`);
	return entry;
}

function readSlice<
	TArray extends Float32Array | Uint32Array | Uint16Array | Uint8Array,
>(
	response: Uint8Array,
	sectionDataOffset: number,
	entry: z.infer<typeof section>,
	elementOffset: number,
	elementCount: number,
	ArrayType: {
		readonly BYTES_PER_ELEMENT: number;
		new (buffer: ArrayBuffer, byteOffset: number, length: number): TArray;
	},
): TArray {
	if (elementOffset + elementCount > entry.elementCount) {
		throw new Error(`Building source ${entry.name} slice exceeds its section.`);
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
	return new ArrayType(copied.buffer, 0, elementCount);
}

function decodeMaterial(entry: BuildingMaterial): ResolvedMaterial {
	const facts = {
		rawSurfaceFlags: entry.rawSurfaceFlags,
		translucency: entry.translucency,
		luminosity: entry.luminosity,
		diffuseScale: entry.diffuseScale,
		id: `material:${entry.id}` as const,
	};
	if (entry.source.kind === "solid-color") {
		const color = entry.source.color;
		return {
			...facts,
			kind: "solid-color",
			color: [
				(color & 0xff) / 0xff,
				((color >>> 8) & 0xff) / 0xff,
				((color >>> 16) & 0xff) / 0xff,
				((color >>> 24) & 0xff) / 0xff,
			],
		};
	}
	return {
		...facts,
		kind: "texture",
		colorTextureId: entry.source.surfaceTextureId,
		renderSurfaceId: entry.source.selectedRenderSurface.id,
		paletteTextureId:
			entry.source.paletteId ?? entry.source.defaultPaletteIds.at(0) ?? null,
		textureEncoding: textureEncoding(entry.source.selectedRenderSurface.format),
	};
}

function textureEncoding(
	format: Extract<
		BuildingMaterial["source"],
		{ readonly kind: "texture" }
	>["selectedRenderSurface"]["format"],
): "direct-color" | "index8" | "index16" {
	if (format === "index8") return "index8";
	if (format === "index16") return "index16";
	if (format === "unsupported") {
		throw new Error("Building texture uses an unsupported RenderSurface format.");
	}
	return "direct-color";
}

function decodePresentation(
	definition: BuildingManifest["definitions"][number],
	geometries: ReadonlyMap<string, ResolvedGeometry>,
	materials: ReadonlyMap<string, ResolvedMaterial>,
): ResolvedObjectPresentation {
	const parts =
		definition.kind === "gfx-obj"
			? [
					decodePart(
						0,
						null,
						definition.geometryId,
						[1, 1, 1],
						null,
						definition.materialIds,
						geometries,
						materials,
					),
				]
			: definition.parts.map((part) =>
					decodePart(
						part.partIndex,
						part.parentPartIndex,
						part.geometryId,
						part.defaultScale,
						part.defaultPlacement,
						part.materialIds,
						geometries,
						materials,
					),
				);
	const partTransforms =
		definition.kind === "gfx-obj"
			? [Mat4.identity()]
			: definition.parts.map((part) =>
					part.defaultPlacement === null
						? scaleTransform(part.defaultScale)
						: acFrameTransform(part.defaultPlacement, part.defaultScale),
				);
	const effects =
		definition.kind === "setup-model"
			? {
					animationId: definition.defaultAnimationId,
					physicsScriptId: definition.defaultScriptId,
					physicsScriptTableId: definition.defaultScriptTableId,
					soundTableId: definition.defaultSoundTableId,
				}
			: {
					animationId: null,
					physicsScriptId: null,
					physicsScriptTableId: null,
					soundTableId: null,
				};
	return {
		id: `presentation:${definition.id}`,
		sourceAssetId: definition.sourceAssetId,
		parts,
		placementPoses: new Map([[0, { placementId: 0, partTransforms }]]),
		motion: null,
		effects,
		selectionBounds: null,
		sortingBounds: null,
	};
}

function decodePart(
	partIndex: number,
	parentPartIndex: number | null,
	geometryId: string,
	defaultScale: readonly [number, number, number],
	defaultPlacement: z.infer<typeof frame> | null,
	materialIds: readonly string[],
	geometries: ReadonlyMap<string, ResolvedGeometry>,
	materials: ReadonlyMap<string, ResolvedMaterial>,
): ResolvedObjectPart {
	const geometry = geometries.get(geometryId);
	if (!geometry)
		throw new Error(
			`Object part ${partIndex} references missing geometry ${geometryId}.`,
		);
	const resolvedMaterials = materialIds.map((id) => {
		const material = materials.get(id);
		if (!material)
			throw new Error(
				`Object part ${partIndex} references missing material ${id}.`,
			);
		return material;
	});
	if (
		geometry.materialSlotIndices.some(
			(slot) => slot >= resolvedMaterials.length,
		)
	) {
		throw new Error(
			`Object part ${partIndex} material slots exceed its material closure.`,
		);
	}
	return {
		partIndex,
		parentPartIndex,
		geometry,
		defaultScale: renderScale(defaultScale),
		materials: resolvedMaterials,
	};
}

function acFrameTransform(
	input: z.infer<typeof frame>,
	scale: readonly [number, number, number],
): Mat4 {
	const [w, x, y, z] = input.orientation;
	const rotation = new Quat(w, x, z, -y);
	const magnitude = Math.hypot(rotation.w, rotation.x, rotation.y, rotation.z);
	if (magnitude === 0)
		throw new Error("Building source contains a zero frame orientation.");
	const qw = rotation.w / magnitude;
	const qx = rotation.x / magnitude;
	const qy = rotation.y / magnitude;
	const qz = rotation.z / magnitude;
	const transformedScale = renderScale(scale);
	return new Mat4(
		(1 - 2 * (qy * qy + qz * qz)) * transformedScale.x,
		2 * (qx * qy + qw * qz) * transformedScale.x,
		2 * (qx * qz - qw * qy) * transformedScale.x,
		0,
		2 * (qx * qy - qw * qz) * transformedScale.y,
		(1 - 2 * (qx * qx + qz * qz)) * transformedScale.y,
		2 * (qy * qz + qw * qx) * transformedScale.y,
		0,
		2 * (qx * qz + qw * qy) * transformedScale.z,
		2 * (qy * qz - qw * qx) * transformedScale.z,
		(1 - 2 * (qx * qx + qy * qy)) * transformedScale.z,
		0,
		input.origin[0],
		input.origin[2],
		-input.origin[1],
		1,
	);
}

function renderScale(scale: readonly [number, number, number]): Vec3 {
	return new Vec3(scale[0], scale[2], scale[1]);
}

function scaleTransform(scale: readonly [number, number, number]): Mat4 {
	const resolved = renderScale(scale);
	return new Mat4(
		resolved.x,
		0,
		0,
		0,
		0,
		resolved.y,
		0,
		0,
		0,
		0,
		resolved.z,
		0,
		0,
		0,
		0,
		1,
	);
}

function toBounds(value: z.infer<typeof bounds> | null): AABB3 | null {
	if (value === null) return null;
	const min = new Vec3(value.min[0], value.min[1], value.min[2]);
	const max = new Vec3(value.max[0], value.max[1], value.max[2]);
	if (min.x > max.x || min.y > max.y || min.z > max.z) {
		throw new Error("Building source contains inverted bounds.");
	}
	return new AABB3(min, max);
}
