import { z } from "zod";
import type { LandblockId } from "../game/game-types";
import { AABB3, Mat4, Vec3 } from "../game/math/types";
import type {
	ResolvedObjectLayerSource,
	ResolvedObjectResident,
} from "../game/resolution/landblock-layer";
import { LandblockLayerKind } from "../game/runtime/scene-interest";
import type {
	ParentLocation,
	ResolvedAttachPoint,
	ResolvedGeometry,
	ResolvedMapSurface,
	ResolvedMaterial,
	ResolvedObjectLight,
	ResolvedObjectPart,
	ResolvedObjectPresentation,
} from "../game/resolution/presentation";
import {
	RESTING_PLACEMENT_KEY,
	resolveObjectPresentationBounds,
	resolvePlacementPose,
} from "../game/resolution/presentation";
import {
	classifyObjectResidents,
	resolveObjectBehavior,
} from "../game/resolution/object-resident-classifier";
import {
	type BinarySectionManifest,
	binarySectionSchema,
	readBinarySectionSlice,
	validateBinarySections,
	readBinarySection,
} from "./binary-source-record";
import { acFrameTransform, renderScale, renderVector } from "./ac-frame";

const HEADER_LENGTH = 12;
const MAGIC = "HBSO";
const datId = z.string().regex(/^0x[0-9a-f]{8}$/i);
const finiteNumber = z.number().finite();
const vec3 = z.tuple([finiteNumber, finiteNumber, finiteNumber]);
const quat = z.tuple([finiteNumber, finiteNumber, finiteNumber, finiteNumber]);
const bounds = z.object({ min: vec3, max: vec3 });
const frame = z.object({ origin: vec3, orientation: quat });
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

/**
 * Extra sections the buildings layer carries, and only the buildings layer.
 *
 * The host derives overhead-map blocker silhouettes for buildings alone — scenery is deliberately
 * absent from the map — so the required section set is discriminated by the manifest's own layer
 * rather than padded with empty sections for layers that will never have them.
 */
const BUILDING_MAP_SECTIONS = {
	mapBlockerPositions: "f32",
	mapBlockerIndices: "u32",
} as const;

export const staticGeometrySchema = z.object({
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
	materialSideKindOffset: z.number().int().nonnegative(),
	materialSideKindCount: z.number().int().nonnegative(),
	materialSideTypeOffset: z.number().int().nonnegative(),
	materialSideTypeCount: z.number().int().nonnegative(),
	materialStipplingOffset: z.number().int().nonnegative(),
	materialStipplingCount: z.number().int().nonnegative(),
	rejectedDegenerateTriangles: z.array(
		z.object({
			polygonId: z.number().int().nonnegative(),
			sideKind: z.enum(["positive", "positive-reversed", "negative"]),
			fanTriangleIndex: z.number().int().nonnegative(),
		}),
	),
	bounds: bounds.nullable(),
});

export const staticMaterialSchema = z.object({
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
			paletteComposite: z
				.object({
					identity: z.string().min(1),
					basePaletteId: datId,
					ranges: z.array(
						z.object({
							replacementPaletteId: datId,
							offset: z.number().int().nonnegative(),
							colorCount: z.number().int().nonnegative(),
						}),
					),
				})
				.nullable(),
			renderSurfaceIds: z.array(datId),
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
	appearanceKey: z.string().min(1),
	sourceAssetId: z.string().min(1),
	geometryId: z.string().min(1),
	materialIds: z.array(z.string().min(1)),
});
const setupPart = z.object({
	partIndex: z.number().int().nonnegative(),
	geometryId: z.string().min(1),
	defaultScale: vec3,
	materialIds: z.array(z.string().min(1)),
});
const setupPlacementFrames = z.object({
	placementId: z.number().int().nonnegative(),
	frames: z.array(frame),
});
const parentLocation = z.enum([
	"none",
	"right-hand",
	"left-hand",
	"shield",
	"belt",
	"quiver",
	"heraldry",
	"mouth",
	"left-weapon",
	"left-unarmed",
]);
const holdingLocation = z.object({
	location: parentLocation,
	partIndex: z.number().int().nonnegative(),
	frame,
});
/**
 * One authored setup light in setup-local space.
 *
 * `lightType` and `coneAngle` are carried losslessly but unread: every EoR asset authors type 0
 * (point) and leaves `coneAngle` as uninitialized memory.
 */
const setupLight = z.object({
	lightType: z.number().int(),
	offset: frame,
	/** Packed authored ARGB, unpacked by `unpackArgbColor`. */
	color: z.number().int().nonnegative(),
	intensity: finiteNumber,
	falloff: finiteNumber,
	coneAngle: finiteNumber,
});
const setupDefinition = z.object({
	id: z.string().min(1),
	kind: z.literal("setup-model"),
	appearanceKey: z.string().min(1),
	setupId: datId,
	sourceAssetId: z.string().min(1),
	parts: z.array(setupPart),
	lights: z.array(setupLight),
	holdingLocations: z.array(holdingLocation),
	placementFrames: z.array(setupPlacementFrames),
	defaultAnimationId: datId.nullable(),
	defaultMotionTableId: datId.nullable(),
	defaultScriptId: datId.nullable(),
	defaultScriptTableId: datId.nullable(),
	defaultSoundTableId: datId.nullable(),
});
export const staticDefinitionSchema = z.discriminatedUnion("kind", [
	directDefinition,
	setupDefinition,
]);
const manifestSchema = z.object({
	transport: z.literal("holtburger-outdoor-static-record"),
	byteOrder: z.literal("little-endian"),
	sectionByteOffsetBase: z.literal("section-data"),
	landblockId: datId,
	layer: z.enum([
		LandblockLayerKind.Buildings,
		LandblockLayerKind.Objects,
		LandblockLayerKind.Generated,
	]),
	residents: z.array(
		z.object({
			id: z.string().min(1),
			source: z.string().min(1),
			placement: frame,
			scale: vec3,
		}),
	),
	definitions: z.array(staticDefinitionSchema),
	geometries: z.array(staticGeometrySchema),
	materials: z.array(staticMaterialSchema),
	textureDependencies: z.array(
		z.object({
			id: z.string().min(1),
			kind: z.enum(["surface-texture", "palette"]),
		}),
	),
	/**
	 * Derived overhead-map blocker silhouettes, one per distinct building source.
	 *
	 * Present only on the buildings layer: the map draws navigational structure, not scenery, so no
	 * other outdoor static layer derives one.
	 */
	mapBlockers: z
		.array(
			z.object({
				/** Presentation identity of the building's GfxObj, joining a resident to its shape. */
				sourceAssetId: z.string().min(1),
				positionOffset: z.number().int().nonnegative(),
				vertexCount: z.number().int().nonnegative(),
				indexOffset: z.number().int().nonnegative(),
				indexCount: z.number().int().nonnegative(),
			}),
		)
		.optional(),
	sections: z.array(binarySectionSchema),
});

type OutdoorStaticRecordManifest = z.infer<typeof manifestSchema>;
export type StaticGeometryManifest = z.infer<typeof staticGeometrySchema>;
export type StaticMaterialManifest = z.infer<typeof staticMaterialSchema>;
export type StaticDefinitionManifest = z.infer<typeof staticDefinitionSchema>;
export interface DecodedStaticPresentation {
	readonly presentation: ResolvedObjectPresentation;
	readonly localBounds: AABB3 | null;
	readonly setupId: string | null;
	readonly behavior: import("../game/resolution/landblock-layer").ResolvedObjectBehavior;
}
export type OutdoorStaticLayerKind =
	| LandblockLayerKind.Buildings
	| LandblockLayerKind.Objects
	| LandblockLayerKind.Generated;

/** Decode and validate one closed outdoor-static source record. */
export function decodeOutdoorStaticRecord(
	response: Uint8Array,
	requestedLandblockId: LandblockId,
	expectedLayer: OutdoorStaticLayerKind,
): ResolvedObjectLayerSource {
	if (response.byteLength < HEADER_LENGTH) {
		throw new Error("Outdoor static record is shorter than its binary header.");
	}
	const view = new DataView(
		response.buffer,
		response.byteOffset,
		response.byteLength,
	);
	const magic = new TextDecoder().decode(response.subarray(0, 4));
	if (magic !== MAGIC)
		throw new Error(`Unexpected outdoor static record magic ${magic}.`);
	const manifestLength = view.getUint32(4, true);
	const totalLength = view.getUint32(8, true);
	if (totalLength !== response.byteLength) {
		throw new Error(
			`Outdoor static record length is ${response.byteLength}; header declares ${totalLength}.`,
		);
	}
	const sectionDataOffset = HEADER_LENGTH + manifestLength;
	if (sectionDataOffset > response.byteLength) {
		throw new Error(
			"Outdoor static record manifest exceeds the binary response.",
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
			`Outdoor static record returned ${manifest.landblockId} for ${requestedLandblockId}.`,
		);
	}
	if (manifest.layer !== expectedLayer) {
		throw new Error(
			`Outdoor static record returned ${manifest.layer} for ${expectedLayer}.`,
		);
	}
	const sections = validatedSections(manifest, response, sectionDataOffset);
	const geometries = new Map(
		manifest.geometries.map((entry) => [
			entry.id,
			decodeStaticGeometry(entry, response, sectionDataOffset, sections),
		]),
	);
	if (geometries.size !== manifest.geometries.length) {
		throw new Error(
			"Outdoor static record contains duplicate geometry identities.",
		);
	}
	const materials = new Map(
		manifest.materials.map((entry) => [entry.id, decodeStaticMaterial(entry)]),
	);
	if (materials.size !== manifest.materials.length) {
		throw new Error(
			"Outdoor static record contains duplicate material identities.",
		);
	}
	const definitions = new Map(
		manifest.definitions.map((definition) => [
			definition.id,
			decodeStaticPresentation(definition, geometries, materials),
		]),
	);
	if (definitions.size !== manifest.definitions.length) {
		throw new Error(
			"Outdoor static record contains duplicate presentation identities.",
		);
	}
	const residents: ResolvedObjectResident[] = [];
	for (const resident of manifest.residents) {
		const source = definitions.get(resident.source);
		if (!source) {
			throw new Error(
				`Outdoor static resident ${resident.id} references missing source ${resident.source}.`,
			);
		}
		const resolved: ResolvedObjectResident = {
			identity: { kind: "authored", sourceId: resident.id },
			setupId: source.setupId,
			presentation: source.presentation,
			behavior: source.behavior,
			placement: {
				envCellId: null,
				landblockId: manifest.landblockId as LandblockId,
				// Source scale remains explicit on the resident so static baking can compose it
				// once with setup-part scale instead of silently applying it twice.
				localTransform: acFrameTransform(resident.placement, [1, 1, 1]),
			},
			scale: renderScale(resident.scale),
			localBounds: source.localBounds,
		};
		residents.push(resolved);
	}
	const { staticResidents, dynamicSources } =
		classifyObjectResidents(residents);
	return {
		kind: expectedLayer,
		landblockId: manifest.landblockId as LandblockId,
		staticResidents,
		dynamicSources,
		mapBlockers: decodeMapBlockers(
			manifest,
			response,
			sectionDataOffset,
			sections,
		),
	};
}

/**
 * Slice each building's derived blocker silhouette out of the shared map sections.
 *
 * Returns an empty map for layers that carry none, so consumers read one shape regardless of layer
 * rather than branching on which layer they were handed.
 */
function decodeMapBlockers(
	manifest: OutdoorStaticRecordManifest,
	response: Uint8Array,
	sectionDataOffset: number,
	sections: ReadonlyMap<string, BinarySectionManifest>,
): ReadonlyMap<string, ResolvedMapSurface> {
	const blockers = new Map<string, ResolvedMapSurface>();
	if (!manifest.mapBlockers) return blockers;
	const positions = readBinarySection(
		response,
		sectionDataOffset,
		sections,
		"mapBlockerPositions",
		Float32Array,
		"Outdoor static record",
	);
	const indices = readBinarySection(
		response,
		sectionDataOffset,
		sections,
		"mapBlockerIndices",
		Uint32Array,
		"Outdoor static record",
	);
	let expectedPositionOffset = 0;
	let expectedIndexOffset = 0;
	for (const entry of manifest.mapBlockers) {
		if (
			entry.positionOffset !== expectedPositionOffset ||
			entry.indexOffset !== expectedIndexOffset ||
			entry.indexCount % 3 !== 0 ||
			entry.positionOffset + entry.vertexCount * 3 > positions.length ||
			entry.indexOffset + entry.indexCount > indices.length
		) {
			throw new Error(
				`Outdoor static record map blocker ${entry.sourceAssetId} has an invalid range.`,
			);
		}
		if (blockers.has(entry.sourceAssetId)) {
			throw new Error(
				`Outdoor static record repeats map blocker ${entry.sourceAssetId}.`,
			);
		}
		const blockerPositions = positions.slice(
			entry.positionOffset,
			entry.positionOffset + entry.vertexCount * 3,
		);
		const blockerIndices = indices.slice(
			entry.indexOffset,
			entry.indexOffset + entry.indexCount,
		);
		if (blockerIndices.some((index) => index >= entry.vertexCount)) {
			throw new Error(
				`Outdoor static record map blocker ${entry.sourceAssetId} has an out-of-range index.`,
			);
		}
		blockers.set(entry.sourceAssetId, {
			positions: blockerPositions,
			indices: blockerIndices,
		});
		expectedPositionOffset += entry.vertexCount * 3;
		expectedIndexOffset += entry.indexCount;
	}
	if (
		expectedPositionOffset !== positions.length ||
		expectedIndexOffset !== indices.length
	) {
		throw new Error(
			"Outdoor static record map blocker ranges do not cover their sections.",
		);
	}
	return blockers;
}

function parseManifest(serialized: string): OutdoorStaticRecordManifest {
	let value: unknown;
	try {
		value = JSON.parse(serialized);
	} catch {
		throw new Error("Outdoor static record manifest is not valid JSON.");
	}
	const parsed = manifestSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`Outdoor static record manifest is invalid: ${parsed.error.message}`,
		);
	}
	return parsed.data;
}

function validatedSections(
	manifest: OutdoorStaticRecordManifest,
	response: Uint8Array,
	sectionDataOffset: number,
): ReadonlyMap<string, BinarySectionManifest> {
	return validateBinarySections(
		response,
		sectionDataOffset,
		manifest.sections,
		manifest.layer === "buildings"
			? { ...REQUIRED_SECTIONS, ...BUILDING_MAP_SECTIONS }
			: REQUIRED_SECTIONS,
		"Outdoor static record",
	);
}

export function decodeStaticGeometry(
	geometry: StaticGeometryManifest,
	response: Uint8Array,
	sectionDataOffset: number,
	sections: ReadonlyMap<string, BinarySectionManifest>,
	sectionPrefix = "",
	recordLabel = "Outdoor static record",
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
		requireSection(
			sections,
			geometrySectionName(sectionPrefix, "positions"),
			recordLabel,
		),
		geometry.positionOffset,
		geometry.vertexCount * 3,
		Float32Array,
	);
	const normals = readSlice(
		response,
		sectionDataOffset,
		requireSection(
			sections,
			geometrySectionName(sectionPrefix, "normals"),
			recordLabel,
		),
		geometry.normalOffset,
		geometry.vertexCount * 3,
		Float32Array,
	);
	const textureCoordinates = readSlice(
		response,
		sectionDataOffset,
		requireSection(
			sections,
			geometrySectionName(sectionPrefix, "textureCoordinates"),
			recordLabel,
		),
		geometry.textureCoordinateOffset,
		geometry.vertexCount * 2,
		Float32Array,
	);
	const indices = readSlice(
		response,
		sectionDataOffset,
		requireSection(
			sections,
			geometrySectionName(sectionPrefix, "indices"),
			recordLabel,
		),
		geometry.indexOffset,
		geometry.indexCount,
		Uint32Array,
	);
	const materialSlotIndices = readSlice(
		response,
		sectionDataOffset,
		requireSection(
			sections,
			geometrySectionName(sectionPrefix, "materialSlots"),
			recordLabel,
		),
		geometry.materialSlotOffset,
		geometry.materialSlotCount,
		Uint16Array,
	);
	const materialWrapModes = readSlice(
		response,
		sectionDataOffset,
		requireSection(
			sections,
			geometrySectionName(sectionPrefix, "materialWrapModes"),
			recordLabel,
		),
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
	const materialSideKinds = readSlice(
		response,
		sectionDataOffset,
		requireSection(
			sections,
			geometrySectionName(sectionPrefix, "materialSideKinds"),
			recordLabel,
		),
		geometry.materialSideKindOffset,
		geometry.materialSideKindCount,
		Uint8Array,
	);
	if (materialSideKinds.length !== materialSlotIndices.length) {
		throw new Error(
			`Geometry ${geometry.id} must provide one polygon-side fact per material slot.`,
		);
	}
	if (materialSideKinds.some((side) => side > 2)) {
		throw new Error(
			`Geometry ${geometry.id} has an invalid polygon-side fact.`,
		);
	}
	const materialSideTypes = readSlice(
		response,
		sectionDataOffset,
		requireSection(
			sections,
			geometrySectionName(sectionPrefix, "materialSideTypes"),
			recordLabel,
		),
		geometry.materialSideTypeOffset,
		geometry.materialSideTypeCount,
		Uint8Array,
	);
	if (materialSideTypes.length !== materialSlotIndices.length) {
		throw new Error(
			`Geometry ${geometry.id} must provide one polygon culling fact per material slot.`,
		);
	}
	if (materialSideTypes.some((sideType) => sideType > 3)) {
		throw new Error(
			`Geometry ${geometry.id} has an invalid polygon culling fact.`,
		);
	}
	const materialStippling = readSlice(
		response,
		sectionDataOffset,
		requireSection(
			sections,
			geometrySectionName(sectionPrefix, "materialStippling"),
			recordLabel,
		),
		geometry.materialStipplingOffset,
		geometry.materialStipplingCount,
		Uint8Array,
	);
	if (materialStippling.length !== materialSlotIndices.length) {
		throw new Error(
			`Geometry ${geometry.id} must provide one polygon stippling fact per material slot.`,
		);
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
		materialSideKinds,
		materialSideTypes,
		materialStippling,
		sourceDiagnostics: {
			rejectedDegenerateTriangles: geometry.rejectedDegenerateTriangles,
		},
		bounds: toBounds(geometry.bounds),
	};
}

function geometrySectionName(prefix: string, name: string): string {
	if (prefix.length === 0) return name;
	return `${prefix}${name[0]?.toUpperCase()}${name.slice(1)}`;
}

function requireSection(
	sections: ReadonlyMap<string, BinarySectionManifest>,
	name: string,
	recordLabel: string,
): BinarySectionManifest {
	const entry = sections.get(name);
	if (!entry) throw new Error(`${recordLabel} lacks ${name} geometry section.`);
	return entry;
}

function readSlice<
	TArray extends Float32Array | Uint32Array | Uint16Array | Uint8Array,
>(
	response: Uint8Array,
	sectionDataOffset: number,
	entry: BinarySectionManifest,
	elementOffset: number,
	elementCount: number,
	ArrayType: {
		readonly BYTES_PER_ELEMENT: number;
		new (buffer: ArrayBuffer, byteOffset: number, length: number): TArray;
	},
): TArray {
	return readBinarySectionSlice(
		response,
		sectionDataOffset,
		entry,
		elementOffset,
		elementCount,
		ArrayType,
		"Outdoor static record",
	);
}

export function decodeStaticMaterial(
	entry: StaticMaterialManifest,
): ResolvedMaterial {
	const facts = {
		rawSurfaceFlags: entry.rawSurfaceFlags,
		translucency: entry.translucency,
		luminosity: entry.luminosity,
		diffuseScale: entry.diffuseScale,
		id: `material:${entry.id}` as const,
	};
	if (entry.source.kind === "solid-color") {
		const { red, green, blue, alpha } = unpackArgbColor(entry.source.color);
		return {
			...facts,
			kind: "solid-color",
			color: [red, green, blue, alpha],
		};
	}
	return {
		...facts,
		kind: "texture",
		colorTextureId: entry.source.surfaceTextureId,
		renderSurfaceId: entry.source.selectedRenderSurface.id,
		paletteTextureId: entry.source.paletteId,
		paletteComposite: entry.source.paletteComposite,
		textureEncoding: textureEncoding(entry.source.selectedRenderSurface.format),
	};
}

function textureEncoding(
	format: Extract<
		StaticMaterialManifest["source"],
		{ readonly kind: "texture" }
	>["selectedRenderSurface"]["format"],
): "direct-color" | "index8" | "index16" {
	if (format === "index8") return "index8";
	if (format === "index16") return "index16";
	if (format === "unsupported") {
		throw new Error(
			"Outdoor static texture uses an unsupported RenderSurface format.",
		);
	}
	return "direct-color";
}

export function decodeStaticPresentation(
	definition: StaticDefinitionManifest,
	geometries: ReadonlyMap<string, ResolvedGeometry>,
	materials: ReadonlyMap<string, ResolvedMaterial>,
): DecodedStaticPresentation {
	const parts =
		definition.kind === "gfx-obj"
			? [
					decodePart(
						0,
						definition.geometryId,
						[1, 1, 1],
						definition.materialIds,
						geometries,
						materials,
					),
				]
			: definition.parts.map((part) =>
					decodePart(
						part.partIndex,
						part.geometryId,
						part.defaultScale,
						part.materialIds,
						geometries,
						materials,
					),
				);
	const placementPoses = decodePlacementPoses(definition, parts.length);
	const presentationId = `presentation:${definition.id}` as const;
	const restingPose = resolvePlacementPose(
		{ id: presentationId, placementPoses },
		RESTING_PLACEMENT_KEY,
	);
	const presentationBounds = resolveObjectPresentationBounds(
		parts,
		restingPose.partTransforms,
		new Vec3(1, 1, 1),
	);
	const behavior =
		definition.kind === "setup-model"
			? resolveObjectBehavior({
					animationId: definition.defaultAnimationId,
					// Static scenery animates from its default clip, not from a motion table; a live
					// entity overrides this from its own content identity when it spawns.
					motionTableId: null,
					physicsScriptId: definition.defaultScriptId,
					physicsScriptTableId: definition.defaultScriptTableId,
					soundTableId: definition.defaultSoundTableId,
				})
			: resolveObjectBehavior({
					animationId: null,
					motionTableId: null,
					physicsScriptId: null,
					physicsScriptTableId: null,
					soundTableId: null,
				});
	return {
		localBounds: presentationBounds,
		setupId: definition.kind === "setup-model" ? definition.setupId : null,
		behavior,
		presentation: {
			appearanceKey: definition.appearanceKey,
			id: presentationId,
			sourceAssetId: definition.sourceAssetId,
			parts,
			lights:
				definition.kind === "setup-model"
					? definition.lights.map(decodeSetupLight)
					: [],
			holdingLocations: decodeHoldingLocations(definition, parts.length),
			placementPoses,
			selectionBounds: null,
			sortingBounds: null,
		},
	};
}

/**
 * Unpack a DAT-packed 32-bit colour, which is ARGB: red occupies bits 16-23 and blue bits 0-7.
 *
 * Both retail unpackers agree and differ only in whether they keep alpha —
 * `RGBAColor::SetColor32` reads `a = HIBYTE, r = BYTE2, g = BYTE1, b = (byte)color`
 * (acclient.c:105741), and `RGBColor::SetColor32` drops the alpha line (acclient.c:136902).
 * Shared so the two callers cannot disagree about the byte order again.
 */
export function unpackArgbColor(packed: number): {
	readonly red: number;
	readonly green: number;
	readonly blue: number;
	readonly alpha: number;
} {
	return {
		red: ((packed >>> 16) & 0xff) / 0xff,
		green: ((packed >>> 8) & 0xff) / 0xff,
		blue: (packed & 0xff) / 0xff,
		alpha: ((packed >>> 24) & 0xff) / 0xff,
	};
}

/** Point lights are the only authored kind; anything else is a source contract violation. */
const POINT_LIGHT_TYPE = 0;

function decodeSetupLight(
	light: z.infer<typeof setupLight>,
): ResolvedObjectLight {
	if (light.lightType !== POINT_LIGHT_TYPE) {
		throw new Error(
			`Setup light declares unsupported light type ${light.lightType}.`,
		);
	}
	const { red, green, blue } = unpackArgbColor(light.color);
	return {
		offset: renderVector(...light.offset.origin),
		color: { red, green, blue },
		intensity: light.intensity,
		falloff: light.falloff,
	};
}

/**
 * Index a setup's attach points by name.
 *
 * The host already validates each part index against the setup's part count. This re-checks against
 * the resolved part list because appearance substitution, not the setup alone, decides how many
 * parts a presentation actually has.
 */
function decodeHoldingLocations(
	definition: StaticDefinitionManifest,
	partCount: number,
): ReadonlyMap<ParentLocation, ResolvedAttachPoint> {
	if (definition.kind === "gfx-obj") return new Map();
	const attachPoints = new Map<ParentLocation, ResolvedAttachPoint>();
	for (const { location, partIndex, frame } of definition.holdingLocations) {
		if (attachPoints.has(location)) {
			throw new Error(
				`Setup ${definition.id} declares attach point ${location} twice.`,
			);
		}
		if (partIndex >= partCount) {
			throw new Error(
				`Setup ${definition.id} attach point ${location} names part ${partIndex} of ${partCount}.`,
			);
		}
		attachPoints.set(location, {
			location,
			partIndex,
			offsetTransform: acFrameTransform(frame, [1, 1, 1]),
		});
	}
	return attachPoints;
}

/** Decode every authored setup pose, preserving its enum key and exact per-part frame list. */
function decodePlacementPoses(
	definition: StaticDefinitionManifest,
	partCount: number,
) {
	if (definition.kind === "gfx-obj") {
		return new Map([
			[0, { placementId: 0, partTransforms: [Mat4.identity()] }],
		]);
	}
	const poses = new Map<
		number,
		{ placementId: number; partTransforms: readonly Mat4[] }
	>();
	for (const { placementId, frames } of definition.placementFrames) {
		if (poses.has(placementId)) {
			throw new Error(
				`Setup ${definition.id} declares placement ${placementId} twice.`,
			);
		}
		if (frames.length !== partCount) {
			throw new Error(
				`Setup ${definition.id} placement ${placementId} carries ${frames.length} frames for ${partCount} parts.`,
			);
		}
		poses.set(placementId, {
			placementId,
			partTransforms: frames.map((value) => acFrameTransform(value, [1, 1, 1])),
		});
	}
	return poses;
}

function decodePart(
	partIndex: number,
	geometryId: string,
	defaultScale: readonly [number, number, number],
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
		geometry,
		defaultScale: renderScale(defaultScale),
		materials: resolvedMaterials,
	};
}

function toBounds(value: z.infer<typeof bounds> | null): AABB3 | null {
	if (value === null) return null;
	const min = new Vec3(value.min[0], value.min[1], value.min[2]);
	const max = new Vec3(value.max[0], value.max[1], value.max[2]);
	if (min.x > max.x || min.y > max.y || min.z > max.z) {
		throw new Error("Outdoor static record contains inverted bounds.");
	}
	return new AABB3(min, max);
}
