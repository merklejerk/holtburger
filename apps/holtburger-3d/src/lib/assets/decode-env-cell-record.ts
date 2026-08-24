import { z } from "zod";
import type { EnvCellId, LandblockId } from "../game/game-types";
import { AABB3, Vec3 } from "../game/math/types";
import type {
	PortalApertureId,
	ResolvedCellStructure,
	ResolvedEnvCellLayerSource,
	ResolvedEnvCellPresentation,
	ResolvedEnvCellResidentSource,
	ResolvedPortalAperture,
	ResolvedPortalCrossing,
} from "../game/resolution/landblock-layer";
import type {
	ResolvedGeometry,
	ResolvedMaterial,
} from "../game/resolution/presentation";
import { LandblockLayerKind } from "../game/runtime/scene-interest";
import type { SceneScope } from "../game/scene";
import {
	type BinarySectionManifest,
	binarySectionSchema,
	readBinarySection,
	validateBinarySections,
} from "./binary-source-record";
import {
	decodeStaticGeometry,
	decodeStaticMaterial,
	decodeStaticPresentation,
	staticDefinitionSchema,
	staticGeometrySchema,
	staticMaterialSchema,
} from "./decode-static-source-record";
import { acFrameTransform, renderScale } from "./ac-frame";

const MAGIC = "HBEC";
// v4 added the derived overhead-map floor sections (mapFloorPositions/mapFloorIndices and each
// structure's mapFloor ranges).
export const ENV_CELL_RECORD_VERSION = 4;
const VERSION = ENV_CELL_RECORD_VERSION;
const HEADER_LENGTH = 16;
const datId = z.string().regex(/^0x[0-9a-f]{8}$/i);
const finiteNumber = z.number().finite();
const vec3 = z.tuple([finiteNumber, finiteNumber, finiteNumber]);
const quat = z.tuple([finiteNumber, finiteNumber, finiteNumber, finiteNumber]);
const frame = z.object({ origin: vec3, orientation: quat });
const bounds = z.object({ min: vec3, max: vec3 });
const structureSchema = z.object({
	id: z.string().min(1),
	environmentId: datId,
	localSelector: z.number().int().nonnegative(),
	geometry: staticGeometrySchema,
	surfaceSlotCount: z.number().int().nonnegative(),
	containmentPlaneOffset: z.number().int().nonnegative(),
	containmentPlaneCount: z.number().int().nonnegative(),
	/** Derived overhead-map walkable floor, in the same structure-local frame as the geometry. */
	mapFloor: z.object({
		positionOffset: z.number().int().nonnegative(),
		vertexCount: z.number().int().nonnegative(),
		indexOffset: z.number().int().nonnegative(),
		indexCount: z.number().int().nonnegative(),
	}),
	portalPolygons: z.array(
		z.object({
			cellStructPortalIndex: z.number().int().nonnegative(),
			polygonId: z.number().int().nonnegative(),
		}),
	),
});
const apertureSchema = z
	.object({
		id: z.string().startsWith("portal-aperture:"),
		kind: z.enum(["env-cell", "building-transition", "effective-visibility"]),
		polygonIds: z.array(z.number().int().nonnegative()),
		positionOffset: z.number().int().nonnegative(),
		positionCount: z.number().int().min(3),
		indexOffset: z.number().int().nonnegative(),
		indexCount: z.number().int().positive(),
		plane: z.object({ normal: vec3, d: finiteNumber }),
		bounds,
	})
	.superRefine((aperture, context) => {
		if (
			aperture.kind !== "effective-visibility" &&
			aperture.polygonIds.length === 0
		) {
			context.addIssue({
				code: "custom",
				message: "Authored portal apertures require at least one polygon ID.",
				path: ["polygonIds"],
			});
		}
	});
const boundaryReason = z.enum([
	"missing-reciprocal-identity",
	"source-not-exact-match",
	"target-not-exact-match",
	"apertures-differ",
	"accepted-sides-not-opposed",
	"missing-source-cell-bounds",
	"missing-target-cell-bounds",
	"source-cell-crosses-portal-plane",
	"target-cell-crosses-portal-plane",
]);
const spatialRelationship = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("indoor-depth-continuous"),
		reciprocalApertureIndex: z.number().int().nonnegative(),
	}),
	z.object({
		kind: z.literal("indoor-topology-boundary"),
		reason: boundaryReason,
	}),
	z.object({
		kind: z.literal("exterior-transition"),
		exteriorLandblockId: datId,
	}),
]);
const sourcePortal = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("env-cell"),
		envCellId: datId,
		portalIndex: z.number().int().nonnegative(),
		polygonId: z.number().int().nonnegative(),
		flags: z.number().int().nonnegative(),
	}),
	z.object({
		kind: z.literal("building-transition"),
		buildingIndex: z.number().int().nonnegative(),
		buildingSourceDid: datId,
		portalIndex: z.number().int().nonnegative(),
		flags: z.number().int().nonnegative(),
	}),
]);
const crossingSchema = z.object({
	id: z.string().startsWith("portal-crossing:"),
	sourceCellIndex: z.number().int().nonnegative().nullable(),
	targetCellIndex: z.number().int().nonnegative().nullable(),
	sourceApertureIndex: z.number().int().nonnegative(),
	visibilityApertureIndex: z.number().int().nonnegative(),
	visibilityProvenance: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("authored-source") }),
		z.object({
			kind: z.literal("reciprocal-intersection"),
			reciprocalApertureIndex: z.number().int().nonnegative(),
			maximumPlaneDeviation: finiteNumber.nonnegative(),
			absoluteNormalDot: finiteNumber.min(0).max(1),
			componentCount: z.number().int().positive(),
		}),
	]),
	acceptedSide: z.enum(["positive", "negative"]),
	exactMatch: z.boolean(),
	maskDepthPolicy: z.enum(["allow-equal-depth", "reject-equal-depth"]),
	junctionGroupId: z.number().int().positive().nullable(),
	reciprocalCrossingIndex: z.number().int().nonnegative().nullable(),
	sourcePortal,
	spatialRelationship,
});
const residentSchema = z.object({
	id: z.string().min(1),
	cellIndex: z.number().int().nonnegative(),
	sourceIndex: z.number().int().nonnegative(),
	sourceDid: datId,
	definitionId: z.string().min(1),
	placement: frame,
});
const unresolvedOutsideEndpoint = z.object({
	envCellId: datId,
	portalIndex: z.number().int().nonnegative(),
	polygonId: z.number().int().nonnegative(),
});
const unresolvedVisibilityReciprocal = z.object({
	crossingIndex: z.number().int().nonnegative(),
	sourceApertureId: z.string().startsWith("portal-aperture:"),
});
const manifestSchema = z.object({
	transport: z.literal("holtburger-env-cell-record"),
	version: z.literal(VERSION),
	byteOrder: z.literal("little-endian"),
	sectionByteOffsetBase: z.literal("section-data"),
	landblockId: datId,
	availability: z.enum(["present", "absent"]),
	cellCount: z.number().int().nonnegative(),
	structures: z.array(structureSchema),
	apertures: z.array(apertureSchema),
	crossings: z.array(crossingSchema),
	residents: z.array(residentSchema),
	objectDefinitions: z.array(staticDefinitionSchema),
	objectGeometries: z.array(staticGeometrySchema),
	materials: z.array(staticMaterialSchema),
	textureDependencies: z.array(
		z.object({
			id: z.string().min(1),
			kind: z.enum(["surface-texture", "palette"]),
		}),
	),
	diagnostics: z.object({
		unresolvedOutsideEndpoints: z.array(unresolvedOutsideEndpoint),
		unresolvedVisibilityReciprocals: z.array(unresolvedVisibilityReciprocal),
		visibilityApertureCounts: z.object({
			authoredSourceCrossings: z.number().int().nonnegative(),
			reciprocalIntersectionCrossings: z.number().int().nonnegative(),
			synthesizedIntersectionGeometries: z.number().int().nonnegative(),
		}),
	}),
	sections: z.array(binarySectionSchema),
});

type EnvCellManifest = z.infer<typeof manifestSchema>;

const REQUIRED_SECTIONS = {
	cellIds: "u32",
	cellFlags: "u32",
	cellAuthoredIds: "u32",
	cellStructureIndices: "u32",
	cellIslandIndices: "u32",
	cellPlacements: "f32",
	cellBounds: "f32",
	cellSurfaceRanges: "u32",
	surfaceIds: "u32",
	cellVisibleRanges: "u32",
	visibleCellIds: "u32",
	cellResidentRanges: "u32",
	containmentPlanes: "f32",
	// Derived overhead-map floor geometry, present on every v4 interior record. Consumed when the
	// map's interior layer lands; validated here so the record decodes today.
	mapFloorPositions: "f32",
	mapFloorIndices: "u32",
	aperturePositions: "f32",
	apertureIndices: "u32",
	shellPositions: "f32",
	shellNormals: "f32",
	shellTextureCoordinates: "f32",
	shellIndices: "u32",
	shellMaterialSlots: "u16",
	shellMaterialWrapModes: "u8",
	shellMaterialSideKinds: "u8",
	shellMaterialSideTypes: "u8",
	shellMaterialStippling: "u8",
	objectPositions: "f32",
	objectNormals: "f32",
	objectTextureCoordinates: "f32",
	objectIndices: "u32",
	objectMaterialSlots: "u16",
	objectMaterialWrapModes: "u8",
	objectMaterialSideKinds: "u8",
	objectMaterialSideTypes: "u8",
	objectMaterialStippling: "u8",
} as const satisfies Readonly<
	Record<string, BinarySectionManifest["scalarType"]>
>;

/** Decode one independently versioned environment-cell source record. */
export function decodeEnvCellRecord(
	response: Uint8Array,
	requestedLandblockId: LandblockId,
): ResolvedEnvCellLayerSource | null {
	const { manifest, sectionDataOffset } = decodeEnvelope(response);
	if (
		manifest.landblockId.toLowerCase() !== requestedLandblockId.toLowerCase()
	) {
		throw new Error(
			`EnvCell record returned ${manifest.landblockId} for ${requestedLandblockId}.`,
		);
	}
	if (manifest.availability === "absent") {
		assertAbsentManifest(manifest);
		return null;
	}
	if (manifest.cellCount === 0) {
		throw new Error("Present EnvCell record must contain at least one cell.");
	}
	const sections = validateSections(manifest, response, sectionDataOffset);
	const arrays = decodeCellArrays(
		response,
		sectionDataOffset,
		sections,
		manifest.cellCount,
	);
	const materials = uniqueMap(
		manifest.materials,
		(entry) => entry.id,
		(entry) => decodeStaticMaterial(entry),
		"material",
	);
	const shellGeometries = uniqueMap(
		manifest.structures,
		(entry) => entry.geometry.id,
		(entry) =>
			decodeStaticGeometry(
				entry.geometry,
				response,
				sectionDataOffset,
				sections,
				"shell",
				"EnvCell record",
			),
		"shell geometry",
	);
	const structures = decodeStructures(
		manifest,
		arrays.containmentPlanes,
		arrays.mapFloorPositions,
		arrays.mapFloorIndices,
		shellGeometries,
	);
	const objectGeometries = uniqueMap(
		manifest.objectGeometries,
		(entry) => entry.id,
		(entry) =>
			decodeStaticGeometry(
				entry,
				response,
				sectionDataOffset,
				sections,
				"object",
				"EnvCell record",
			),
		"object geometry",
	);
	const presentations = uniqueMap(
		manifest.objectDefinitions,
		(entry) => entry.id,
		(entry) => {
			try {
				return decodeStaticPresentation(entry, objectGeometries, materials);
			} catch (cause) {
				const message = cause instanceof Error ? cause.message : String(cause);
				throw new Error(
					`EnvCell ${requestedLandblockId} object definition ${entry.id} (${entry.sourceAssetId}) is invalid: ${message}`,
					{ cause },
				);
			}
		},
		"object definition",
	);
	const cells = decodeCells(
		manifest,
		requestedLandblockId,
		arrays,
		structures,
		materials,
		presentations,
	);
	if (new Set(cells.map((cell) => cell.id)).size !== cells.length) {
		throw new Error("EnvCell record contains duplicate cell identities.");
	}
	const portalApertures = decodeApertures(
		manifest,
		response,
		sectionDataOffset,
		sections,
	);
	const portalCrossings = decodeCrossings(
		manifest,
		requestedLandblockId,
		cells,
		portalApertures,
	);
	return {
		kind: LandblockLayerKind.EnvCells,
		landblockId: manifest.landblockId as LandblockId,
		cells,
		portalApertures,
		portalCrossings,
		diagnostics: {
			unresolvedOutsideEndpoints:
				manifest.diagnostics.unresolvedOutsideEndpoints.map((endpoint) => ({
					...endpoint,
					envCellId: endpoint.envCellId as EnvCellId,
				})),
			unresolvedVisibilityReciprocals:
				manifest.diagnostics.unresolvedVisibilityReciprocals.map(
					(diagnostic) => ({
						...diagnostic,
						sourceApertureId: diagnostic.sourceApertureId as PortalApertureId,
					}),
				),
			visibilityApertureCounts: manifest.diagnostics.visibilityApertureCounts,
		},
	};
}

function decodeEnvelope(response: Uint8Array): {
	readonly manifest: EnvCellManifest;
	readonly sectionDataOffset: number;
} {
	if (response.byteLength < HEADER_LENGTH) {
		throw new Error("EnvCell record is shorter than its binary header.");
	}
	const view = new DataView(
		response.buffer,
		response.byteOffset,
		response.byteLength,
	);
	const magic = new TextDecoder().decode(response.subarray(0, 4));
	if (magic !== MAGIC)
		throw new Error(`Unexpected EnvCell record magic ${magic}.`);
	const version = view.getUint16(4, true);
	const flags = view.getUint16(6, true);
	const manifestLength = view.getUint32(8, true);
	const totalLength = view.getUint32(12, true);
	if (version !== VERSION || flags !== 0) {
		throw new Error(
			`EnvCell record header version ${version} or flags ${flags} are unsupported.`,
		);
	}
	if (totalLength !== response.byteLength) {
		throw new Error(
			`EnvCell record length is ${response.byteLength}; header declares ${totalLength}.`,
		);
	}
	const sectionDataOffset = HEADER_LENGTH + manifestLength;
	if (
		sectionDataOffset > response.byteLength ||
		sectionDataOffset % Uint32Array.BYTES_PER_ELEMENT !== 0
	) {
		throw new Error("EnvCell record manifest has an invalid byte range.");
	}
	let value: unknown;
	try {
		value = JSON.parse(
			new TextDecoder().decode(
				response.subarray(HEADER_LENGTH, sectionDataOffset),
			),
		);
	} catch {
		throw new Error("EnvCell record manifest is not valid JSON.");
	}
	const parsed = manifestSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`EnvCell record manifest is invalid: ${parsed.error.message}`,
		);
	}
	return { manifest: parsed.data, sectionDataOffset };
}

function assertAbsentManifest(manifest: EnvCellManifest): void {
	if (
		manifest.cellCount !== 0 ||
		manifest.structures.length !== 0 ||
		manifest.apertures.length !== 0 ||
		manifest.crossings.length !== 0 ||
		manifest.residents.length !== 0 ||
		manifest.objectDefinitions.length !== 0 ||
		manifest.objectGeometries.length !== 0 ||
		manifest.materials.length !== 0 ||
		manifest.textureDependencies.length !== 0 ||
		manifest.sections.length !== 0
	) {
		throw new Error("Absent EnvCell record carries source payload.");
	}
}

function validateSections(
	manifest: EnvCellManifest,
	response: Uint8Array,
	sectionDataOffset: number,
): ReadonlyMap<string, BinarySectionManifest> {
	return validateBinarySections(
		response,
		sectionDataOffset,
		manifest.sections,
		REQUIRED_SECTIONS,
		"EnvCell record",
	);
}

interface CellArrays {
	readonly cellIds: Uint32Array;
	readonly cellFlags: Uint32Array;
	readonly authoredIds: Uint32Array;
	readonly structureIndices: Uint32Array;
	readonly islandIndices: Uint32Array;
	readonly placements: Float32Array;
	readonly bounds: Float32Array;
	readonly surfaceRanges: Uint32Array;
	readonly surfaceIds: Uint32Array;
	readonly visibleRanges: Uint32Array;
	readonly visibleCellIds: Uint32Array;
	readonly residentRanges: Uint32Array;
	readonly containmentPlanes: Float32Array;
	/** Derived overhead-map floor vertices shared by every structure's range. */
	readonly mapFloorPositions: Float32Array;
	readonly mapFloorIndices: Uint32Array;
}

function decodeCellArrays(
	response: Uint8Array,
	sectionDataOffset: number,
	sections: ReadonlyMap<string, BinarySectionManifest>,
	cellCount: number,
): CellArrays {
	return {
		cellIds: readWhole(
			response,
			sectionDataOffset,
			sections,
			"cellIds",
			Uint32Array,
			cellCount,
		),
		cellFlags: readWhole(
			response,
			sectionDataOffset,
			sections,
			"cellFlags",
			Uint32Array,
			cellCount,
		),
		authoredIds: readWhole(
			response,
			sectionDataOffset,
			sections,
			"cellAuthoredIds",
			Uint32Array,
			cellCount,
		),
		structureIndices: readWhole(
			response,
			sectionDataOffset,
			sections,
			"cellStructureIndices",
			Uint32Array,
			cellCount,
		),
		islandIndices: readWhole(
			response,
			sectionDataOffset,
			sections,
			"cellIslandIndices",
			Uint32Array,
			cellCount,
		),
		placements: readWhole(
			response,
			sectionDataOffset,
			sections,
			"cellPlacements",
			Float32Array,
			cellCount * 7,
		),
		bounds: readWhole(
			response,
			sectionDataOffset,
			sections,
			"cellBounds",
			Float32Array,
			cellCount * 6,
		),
		surfaceRanges: readWhole(
			response,
			sectionDataOffset,
			sections,
			"cellSurfaceRanges",
			Uint32Array,
			cellCount * 2,
		),
		surfaceIds: readWhole(
			response,
			sectionDataOffset,
			sections,
			"surfaceIds",
			Uint32Array,
		),
		visibleRanges: readWhole(
			response,
			sectionDataOffset,
			sections,
			"cellVisibleRanges",
			Uint32Array,
			cellCount * 2,
		),
		visibleCellIds: readWhole(
			response,
			sectionDataOffset,
			sections,
			"visibleCellIds",
			Uint32Array,
		),
		residentRanges: readWhole(
			response,
			sectionDataOffset,
			sections,
			"cellResidentRanges",
			Uint32Array,
			cellCount * 2,
		),
		containmentPlanes: readWhole(
			response,
			sectionDataOffset,
			sections,
			"containmentPlanes",
			Float32Array,
		),
		mapFloorPositions: readWhole(
			response,
			sectionDataOffset,
			sections,
			"mapFloorPositions",
			Float32Array,
		),
		mapFloorIndices: readWhole(
			response,
			sectionDataOffset,
			sections,
			"mapFloorIndices",
			Uint32Array,
		),
	};
}

function decodeStructures(
	manifest: EnvCellManifest,
	containmentPlanes: Float32Array,
	mapFloorPositions: Float32Array,
	mapFloorIndices: Uint32Array,
	geometries: ReadonlyMap<string, ResolvedGeometry>,
): readonly ResolvedCellStructure[] {
	if (containmentPlanes.length % 4 !== 0) {
		throw new Error("EnvCell containment section is not a plane tuple array.");
	}
	let expectedPlaneOffset = 0;
	let expectedMapFloorPositionOffset = 0;
	let expectedMapFloorIndexOffset = 0;
	const structures = manifest.structures.map((entry) => {
		const geometry = geometries.get(entry.geometry.id);
		if (!geometry)
			throw new Error(`EnvCell structure ${entry.id} lost its geometry.`);
		if (
			entry.containmentPlaneOffset !== expectedPlaneOffset ||
			entry.containmentPlaneOffset + entry.containmentPlaneCount >
				containmentPlanes.length / 4
		) {
			throw new Error(
				`EnvCell structure ${entry.id} has a non-contiguous containment range.`,
			);
		}
		expectedPlaneOffset += entry.containmentPlaneCount;
		if (
			geometry.materialSlotIndices.some(
				(slot) => slot >= entry.surfaceSlotCount,
			)
		) {
			throw new Error(
				`EnvCell structure ${entry.id} geometry exceeds its surface slots.`,
			);
		}
		const start = entry.containmentPlaneOffset * 4;
		const floor = entry.mapFloor;
		if (
			floor.positionOffset !== expectedMapFloorPositionOffset ||
			floor.indexOffset !== expectedMapFloorIndexOffset ||
			floor.indexCount % 3 !== 0 ||
			floor.positionOffset + floor.vertexCount * 3 > mapFloorPositions.length ||
			floor.indexOffset + floor.indexCount > mapFloorIndices.length
		) {
			throw new Error(
				`EnvCell structure ${entry.id} has an invalid map-floor range.`,
			);
		}
		const floorPositions = mapFloorPositions.slice(
			floor.positionOffset,
			floor.positionOffset + floor.vertexCount * 3,
		);
		const floorIndices = mapFloorIndices.slice(
			floor.indexOffset,
			floor.indexOffset + floor.indexCount,
		);
		if (floorIndices.some((index) => index >= floor.vertexCount)) {
			throw new Error(
				`EnvCell structure ${entry.id} has an out-of-range map-floor index.`,
			);
		}
		expectedMapFloorPositionOffset += floor.vertexCount * 3;
		expectedMapFloorIndexOffset += floor.indexCount;
		const resolved = {
			id: entry.id,
			geometry,
			surfaceSlotCount: entry.surfaceSlotCount,
			containmentPlanes: containmentPlanes.slice(
				start,
				start + entry.containmentPlaneCount * 4,
			),
			mapFloor: {
				positions: floorPositions,
				indices: floorIndices,
			},
			portalPolygons: entry.portalPolygons,
		};
		if (
			new Set(entry.portalPolygons.map((portal) => portal.polygonId)).size !==
			entry.portalPolygons.length
		) {
			throw new Error(
				`EnvCell structure ${entry.id} repeats a portal polygon identity.`,
			);
		}
		return resolved;
	});
	if (expectedPlaneOffset !== containmentPlanes.length / 4) {
		throw new Error(
			"EnvCell structure ranges do not cover the containment section.",
		);
	}
	if (
		expectedMapFloorPositionOffset !== mapFloorPositions.length ||
		expectedMapFloorIndexOffset !== mapFloorIndices.length
	) {
		throw new Error(
			"EnvCell structure ranges do not cover the map-floor sections.",
		);
	}
	return structures;
}

function decodeCells(
	manifest: EnvCellManifest,
	landblockId: LandblockId,
	arrays: CellArrays,
	structures: readonly ResolvedCellStructure[],
	materials: ReadonlyMap<string, ResolvedMaterial>,
	presentations: ReadonlyMap<
		string,
		ReturnType<typeof decodeStaticPresentation>
	>,
): readonly ResolvedEnvCellPresentation[] {
	assertRangesCover(arrays.surfaceRanges, arrays.surfaceIds.length, "surface");
	assertRangesCover(
		arrays.visibleRanges,
		arrays.visibleCellIds.length,
		"visible-cell",
	);
	assertRangesCover(
		arrays.residentRanges,
		manifest.residents.length,
		"resident",
	);
	return Array.from({ length: manifest.cellCount }, (_, cellIndex) => {
		const id = datIdFromU32(arrays.cellIds[cellIndex]!) as EnvCellId;
		const visibilityIslandOrdinal = arrays.islandIndices[cellIndex]!;
		const structure = structures[arrays.structureIndices[cellIndex]!];
		if (!structure) {
			throw new Error(`EnvCell ${id} references an invalid structure index.`);
		}
		const cellMaterials = rangedValues(
			arrays.surfaceRanges,
			cellIndex,
			arrays.surfaceIds,
		).map((surfaceId) => {
			const material = materials.get(
				`surface/${surfaceId.toString(16).padStart(8, "0")}`,
			);
			if (!material) {
				throw new Error(
					`EnvCell ${id} references missing surface ${datIdFromU32(surfaceId)}.`,
				);
			}
			return material;
		});
		if (cellMaterials.length !== structure.surfaceSlotCount) {
			throw new Error(
				`EnvCell ${id} surface count does not match its structure.`,
			);
		}
		const residentRange = rangeAt(arrays.residentRanges, cellIndex);
		const residents = manifest.residents
			.slice(residentRange.offset, residentRange.offset + residentRange.count)
			.map((resident): ResolvedEnvCellResidentSource => {
				if (resident.cellIndex !== cellIndex) {
					throw new Error(
						`EnvCell ${id} resident ${resident.id} claims another cell.`,
					);
				}
				const source = presentations.get(resident.definitionId);
				if (!source) {
					throw new Error(
						`EnvCell resident ${resident.id} references missing definition ${resident.definitionId}.`,
					);
				}
				return {
					id: resident.id,
					sourceDid: resident.sourceDid,
					presentation: source.presentation,
					setupId: source.setupId,
					behavior: source.behavior,
					placement: {
						landblockId,
						envCellId: id,
						localTransform: acFrameTransform(resident.placement, [1, 1, 1]),
					},
					scale: renderScale([1, 1, 1]),
					localBounds: source.localBounds,
				};
			});
		const placementOffset = cellIndex * 7;
		const cellFrame = {
			origin: [
				arrays.placements[placementOffset]!,
				arrays.placements[placementOffset + 1]!,
				arrays.placements[placementOffset + 2]!,
			] as const,
			orientation: [
				arrays.placements[placementOffset + 3]!,
				arrays.placements[placementOffset + 4]!,
				arrays.placements[placementOffset + 5]!,
				arrays.placements[placementOffset + 6]!,
			] as const,
		};
		return {
			id,
			flags: arrays.cellFlags[cellIndex]!,
			authoredCellId: arrays.authoredIds[cellIndex]!,
			visibilityIslandOrdinal,
			structure,
			structureToLandblock: {
				landblockId,
				envCellId: id,
				localTransform: acFrameTransform(cellFrame, [1, 1, 1]),
			},
			landblockBounds: boundsFromArray(arrays.bounds, cellIndex * 6),
			materials: cellMaterials,
			residents,
			potentiallyVisibleEnvCellIds: new Set(
				rangedValues(
					arrays.visibleRanges,
					cellIndex,
					arrays.visibleCellIds,
				).map((visibleId) => datIdFromU32(visibleId) as EnvCellId),
			),
		};
	});
}

function decodeApertures(
	manifest: EnvCellManifest,
	response: Uint8Array,
	sectionDataOffset: number,
	sections: ReadonlyMap<string, BinarySectionManifest>,
): readonly ResolvedPortalAperture[] {
	const positions = readWhole(
		response,
		sectionDataOffset,
		sections,
		"aperturePositions",
		Float32Array,
	);
	const indices = readWhole(
		response,
		sectionDataOffset,
		sections,
		"apertureIndices",
		Uint32Array,
	);
	let expectedPositionOffset = 0;
	let expectedIndexOffset = 0;
	const resolved = manifest.apertures.map((entry) => {
		const positionStart = entry.positionOffset * 3;
		const positionEnd = positionStart + entry.positionCount * 3;
		const indexEnd = entry.indexOffset + entry.indexCount;
		if (
			entry.indexCount % 3 !== 0 ||
			entry.positionOffset !== expectedPositionOffset ||
			entry.indexOffset !== expectedIndexOffset ||
			positionEnd > positions.length ||
			indexEnd > indices.length
		) {
			throw new Error(
				`Portal aperture ${entry.id} has an invalid geometry range.`,
			);
		}
		const triangleIndices = indices.slice(entry.indexOffset, indexEnd);
		expectedPositionOffset += entry.positionCount;
		expectedIndexOffset += entry.indexCount;
		if (triangleIndices.some((index) => index >= entry.positionCount)) {
			throw new Error(`Portal aperture ${entry.id} contains an invalid index.`);
		}
		return {
			id: entry.id as PortalApertureId,
			kind: entry.kind,
			positions: positions.slice(positionStart, positionEnd),
			triangleIndices,
			plane: {
				normal: new Vec3(...entry.plane.normal),
				d: entry.plane.d,
			},
			landblockBounds: checkedBounds(entry.bounds.min, entry.bounds.max),
			polygonIds: entry.polygonIds,
		};
	});
	if (
		expectedPositionOffset * 3 !== positions.length ||
		expectedIndexOffset !== indices.length
	) {
		throw new Error(
			"Portal aperture ranges do not cover their binary sections.",
		);
	}
	if (new Set(resolved.map((entry) => entry.id)).size !== resolved.length) {
		throw new Error("EnvCell record contains duplicate aperture identities.");
	}
	return resolved;
}

function decodeCrossings(
	manifest: EnvCellManifest,
	landblockId: LandblockId,
	cells: readonly ResolvedEnvCellPresentation[],
	apertures: readonly ResolvedPortalAperture[],
): readonly ResolvedPortalCrossing[] {
	const crossings = manifest.crossings.map((entry): ResolvedPortalCrossing => {
		const source = scopeForCellIndex(entry.sourceCellIndex, cells, landblockId);
		const target = scopeForCellIndex(entry.targetCellIndex, cells, landblockId);
		if (entry.sourceCellIndex === null && entry.targetCellIndex === null) {
			throw new Error(`Portal crossing ${entry.id} has no EnvCell endpoint.`);
		}
		if (!apertures[entry.sourceApertureIndex]) {
			throw new Error(
				`Portal crossing ${entry.id} references an invalid source aperture.`,
			);
		}
		if (!apertures[entry.visibilityApertureIndex]) {
			throw new Error(
				`Portal crossing ${entry.id} references an invalid visibility aperture.`,
			);
		}
		if (
			entry.visibilityProvenance.kind === "authored-source" &&
			entry.visibilityApertureIndex !== entry.sourceApertureIndex
		) {
			throw new Error(
				`Portal crossing ${entry.id} authored visibility does not use its source aperture.`,
			);
		}
		if (
			entry.visibilityProvenance.kind === "reciprocal-intersection" &&
			(apertures[entry.visibilityApertureIndex]?.kind !==
				"effective-visibility" ||
				!apertures[entry.visibilityProvenance.reciprocalApertureIndex])
		) {
			throw new Error(
				`Portal crossing ${entry.id} has invalid reciprocal-intersection provenance.`,
			);
		}
		if (
			entry.sourcePortal.kind === "env-cell" &&
			(entry.sourceCellIndex === null ||
				entry.sourcePortal.envCellId.toLowerCase() !==
					cells[entry.sourceCellIndex]?.id.toLowerCase())
		) {
			throw new Error(
				`Portal crossing ${entry.id} source portal does not match its source cell.`,
			);
		}
		if (
			entry.sourcePortal.kind === "building-transition" &&
			entry.sourceCellIndex !== null
		) {
			throw new Error(
				`Portal crossing ${entry.id} building source is not exterior.`,
			);
		}
		if (
			entry.spatialRelationship.kind === "exterior-transition" &&
			entry.spatialRelationship.exteriorLandblockId.toLowerCase() !==
				landblockId.toLowerCase()
		) {
			throw new Error(
				`Portal crossing ${entry.id} references another exterior landblock.`,
			);
		}
		if (
			(entry.spatialRelationship.kind === "exterior-transition") !==
			(entry.sourceCellIndex === null || entry.targetCellIndex === null)
		) {
			throw new Error(
				`Portal crossing ${entry.id} has inconsistent exterior topology.`,
			);
		}
		if (
			entry.spatialRelationship.kind === "indoor-depth-continuous" &&
			!apertures[entry.spatialRelationship.reciprocalApertureIndex]
		) {
			throw new Error(
				`Portal crossing ${entry.id} references an invalid reciprocal aperture.`,
			);
		}
		return {
			...entry,
			id: entry.id as ResolvedPortalCrossing["id"],
			source,
			target,
			sourcePortal:
				entry.sourcePortal.kind === "env-cell"
					? {
							...entry.sourcePortal,
							envCellId: entry.sourcePortal.envCellId as EnvCellId,
						}
					: entry.sourcePortal,
			spatialRelationship:
				entry.spatialRelationship.kind === "exterior-transition"
					? {
							...entry.spatialRelationship,
							exteriorLandblockId: entry.spatialRelationship
								.exteriorLandblockId as LandblockId,
						}
					: entry.spatialRelationship,
		};
	});
	if (
		new Set(crossings.map((crossing) => crossing.id)).size !== crossings.length
	) {
		throw new Error("EnvCell record contains duplicate crossing identities.");
	}
	for (const [index, crossing] of crossings.entries()) {
		const reciprocalIndex = crossing.reciprocalCrossingIndex;
		if (
			crossing.visibilityProvenance.kind === "reciprocal-intersection" &&
			(crossing.exactMatch || reciprocalIndex === null)
		) {
			throw new Error(
				`Portal crossing ${crossing.id} has impossible reciprocal-intersection provenance.`,
			);
		}
		if (reciprocalIndex === null) continue;
		const reciprocal = crossings[reciprocalIndex];
		if (
			!reciprocal ||
			reciprocal.reciprocalCrossingIndex !== index ||
			!scopesEqual(crossing.source, reciprocal.target) ||
			!scopesEqual(crossing.target, reciprocal.source)
		) {
			throw new Error(
				`Portal crossing ${crossing.id} has an invalid reciprocal link.`,
			);
		}
		if (
			crossing.visibilityProvenance.kind === "reciprocal-intersection" &&
			crossing.visibilityProvenance.reciprocalApertureIndex !==
				reciprocal.sourceApertureIndex
		) {
			throw new Error(
				`Portal crossing ${crossing.id} visibility provenance does not match its reciprocal source aperture.`,
			);
		}
		if (
			crossing.spatialRelationship.kind === "indoor-depth-continuous" &&
			crossing.spatialRelationship.reciprocalApertureIndex !==
				reciprocal.sourceApertureIndex
		) {
			throw new Error(
				`Portal crossing ${crossing.id} depth-continuous aperture does not match its reciprocal.`,
			);
		}
	}
	validateVisibilityDiagnostics(manifest, crossings, apertures);
	return crossings;
}

function validateVisibilityDiagnostics(
	manifest: EnvCellManifest,
	crossings: readonly ResolvedPortalCrossing[],
	apertures: readonly ResolvedPortalAperture[],
): void {
	const authoredSourceCrossings = crossings.filter(
		(crossing) => crossing.visibilityProvenance.kind === "authored-source",
	).length;
	const reciprocalIntersectionCrossings =
		crossings.length - authoredSourceCrossings;
	const synthesizedIntersectionGeometries = new Set(
		crossings.flatMap((crossing) =>
			crossing.visibilityProvenance.kind === "reciprocal-intersection"
				? [crossing.visibilityApertureIndex]
				: [],
		),
	).size;
	const declared = manifest.diagnostics.visibilityApertureCounts;
	if (
		declared.authoredSourceCrossings !== authoredSourceCrossings ||
		declared.reciprocalIntersectionCrossings !==
			reciprocalIntersectionCrossings ||
		declared.synthesizedIntersectionGeometries !==
			synthesizedIntersectionGeometries
	) {
		throw new Error(
			"EnvCell visibility-aperture diagnostics do not match the decoded crossing closure.",
		);
	}
	for (const diagnostic of manifest.diagnostics
		.unresolvedVisibilityReciprocals) {
		const crossing = crossings[diagnostic.crossingIndex];
		if (
			!crossing ||
			crossing.reciprocalCrossingIndex !== null ||
			crossing.sourceApertureIndex !==
				apertures.findIndex(
					(aperture) => aperture.id === diagnostic.sourceApertureId,
				)
		) {
			throw new Error(
				"EnvCell unresolved visibility reciprocal diagnostic does not match its crossing.",
			);
		}
	}
}

function scopeForCellIndex(
	cellIndex: number | null,
	cells: readonly ResolvedEnvCellPresentation[],
	landblockId: LandblockId,
): SceneScope {
	if (cellIndex === null) return { kind: "outdoor" };
	const cell = cells[cellIndex];
	if (!cell)
		throw new Error(`Portal crossing references invalid cell ${cellIndex}.`);
	return { kind: "env-cell", landblockId, envCellId: cell.id };
}

function scopesEqual(left: SceneScope, right: SceneScope): boolean {
	return (
		left.kind === right.kind &&
		(left.kind === "outdoor" ||
			(right.kind === "env-cell" &&
				left.landblockId === right.landblockId &&
				left.envCellId === right.envCellId))
	);
}

function assertRangesCover(
	ranges: Uint32Array,
	valueCount: number,
	label: string,
): void {
	let expectedOffset = 0;
	for (let index = 0; index < ranges.length / 2; index += 1) {
		const range = rangeAt(ranges, index);
		if (
			range.offset !== expectedOffset ||
			range.offset + range.count > valueCount
		) {
			throw new Error(
				`EnvCell ${label} ranges are not contiguous and bounded.`,
			);
		}
		expectedOffset += range.count;
	}
	if (expectedOffset !== valueCount) {
		throw new Error(`EnvCell ${label} ranges do not cover their section.`);
	}
}

function rangeAt(
	ranges: Uint32Array,
	index: number,
): { readonly offset: number; readonly count: number } {
	return { offset: ranges[index * 2]!, count: ranges[index * 2 + 1]! };
}

function rangedValues(
	ranges: Uint32Array,
	index: number,
	values: Uint32Array,
): number[] {
	const range = rangeAt(ranges, index);
	return Array.from(values.slice(range.offset, range.offset + range.count));
}

function boundsFromArray(values: Float32Array, offset: number): AABB3 {
	return checkedBounds(
		[values[offset]!, values[offset + 1]!, values[offset + 2]!],
		[values[offset + 3]!, values[offset + 4]!, values[offset + 5]!],
	);
}

function checkedBounds(
	minimum: readonly [number, number, number],
	maximum: readonly [number, number, number],
): AABB3 {
	const minimumVector = new Vec3(...minimum);
	const maximumVector = new Vec3(...maximum);
	if (
		minimumVector.x > maximumVector.x ||
		minimumVector.y > maximumVector.y ||
		minimumVector.z > maximumVector.z
	) {
		throw new Error("EnvCell record contains inverted bounds.");
	}
	return new AABB3(minimumVector, maximumVector);
}

function datIdFromU32(value: number): string {
	return `0x${value.toString(16).padStart(8, "0")}`;
}

function readWhole<
	TArray extends Float32Array | Uint32Array | Uint16Array | Uint8Array,
>(
	response: Uint8Array,
	sectionDataOffset: number,
	sections: ReadonlyMap<string, BinarySectionManifest>,
	name: string,
	ArrayType: {
		readonly BYTES_PER_ELEMENT: number;
		new (buffer: ArrayBuffer, byteOffset: number, length: number): TArray;
	},
	expectedCount?: number,
): TArray {
	return readBinarySection(
		response,
		sectionDataOffset,
		sections,
		name,
		ArrayType,
		"EnvCell record",
		expectedCount,
	);
}

function uniqueMap<TEntry, TKey, TValue>(
	entries: readonly TEntry[],
	key: (entry: TEntry) => TKey,
	value: (entry: TEntry) => TValue,
	label: string,
): ReadonlyMap<TKey, TValue> {
	const result = new Map(entries.map((entry) => [key(entry), value(entry)]));
	if (result.size !== entries.length) {
		throw new Error(`EnvCell record contains duplicate ${label} identities.`);
	}
	return result;
}
