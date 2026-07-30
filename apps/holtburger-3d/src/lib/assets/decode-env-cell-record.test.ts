import { describe, expect, it } from "vitest";
import { decodeEnvCellRecord } from "./decode-env-cell-record";

const LAND_BLOCK_ID = "0x0001ffff";
const CELL_ID = 0x00010100;
const SURFACE_ID = 0x08000001;

describe("decodeEnvCellRecord", () => {
	it("decodes one closed synthetic cell record", () => {
		const source = decodeEnvCellRecord(envCellRecord(), LAND_BLOCK_ID);

		expect(source?.cells).toHaveLength(1);
		expect(source?.cells[0]?.id).toBe("0x00010100");
		expect(source?.cells[0]?.structure.containmentPlanes).toEqual(
			new Float32Array([1, 0, 0, 0]),
		);
		expect(source?.cells[0]?.materials).toHaveLength(1);
		expect(source?.cells[0]?.structure.geometry.indices).toEqual(
			new Uint32Array([0, 1, 2]),
		);
	});

	it("rejects a structure index outside the manifest closure", () => {
		expect(() =>
			decodeEnvCellRecord(
				envCellRecord({ cellStructureIndices: [1] }),
				LAND_BLOCK_ID,
			),
		).toThrow(/invalid structure index/);
	});

	it("rejects overlapping binary sections", () => {
		expect(() =>
			decodeEnvCellRecord(
				envCellRecord({}, (manifest) => {
					const flags = manifest.sections.find(
						(section) => section.name === "cellFlags",
					);
					if (flags) flags.byteOffset = 0;
				}),
				LAND_BLOCK_ID,
			),
		).toThrow(/overlaps another section/);
	});

	it("accepts the explicit absent record as null", () => {
		const manifest = baseManifest("absent");
		const bytes = serializeRecord(manifest, new Uint8Array());

		expect(decodeEnvCellRecord(bytes, LAND_BLOCK_ID)).toBeNull();
	});

	it("decodes distinct authored and reciprocal-intersection apertures", () => {
		const source = decodeEnvCellRecord(
			envCellRecord(
				{
					aperturePositions: [
						0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.25, 0.25, 0,
						0.75, 0.25, 0, 0.25, 0.75, 0,
					],
					apertureIndices: [0, 1, 2, 0, 1, 2, 0, 1, 2],
				},
				(manifest) => {
					installReciprocalVisibilityFixture(manifest);
				},
			),
			LAND_BLOCK_ID,
		);

		expect(source?.portalApertures).toHaveLength(3);
		expect(source?.portalCrossings[0]).toMatchObject({
			sourceApertureIndex: 0,
			visibilityApertureIndex: 2,
			visibilityProvenance: {
				kind: "reciprocal-intersection",
				reciprocalApertureIndex: 1,
			},
		});
		expect(source?.portalCrossings[1]).toMatchObject({
			sourceApertureIndex: 1,
			visibilityApertureIndex: 2,
		});
	});
});

type ScalarType = "f32" | "u32" | "u16" | "u8";
type SectionValues = readonly number[];
type SectionOverrides = Readonly<Record<string, SectionValues>>;
interface MutableSection {
	name: string;
	scalarType: ScalarType;
	elementCount: number;
	byteOffset: number;
	byteLength: number;
}
interface MutableManifest {
	transport: string;
	version: number;
	byteOrder: string;
	sectionByteOffsetBase: string;
	landblockId: string;
	availability: "present" | "absent";
	cellCount: number;
	structures: unknown[];
	apertures: unknown[];
	crossings: unknown[];
	residents: unknown[];
	objectDefinitions: unknown[];
	objectGeometries: unknown[];
	materials: unknown[];
	textureDependencies: unknown[];
	diagnostics: {
		unresolvedOutsideEndpoints: unknown[];
		unresolvedVisibilityReciprocals: unknown[];
		visibilityApertureCounts: {
			authoredSourceCrossings: number;
			reciprocalIntersectionCrossings: number;
			synthesizedIntersectionGeometries: number;
		};
	};
	sections: MutableSection[];
}

function envCellRecord(
	overrides: SectionOverrides = {},
	mutateManifest?: (manifest: MutableManifest) => void,
): Uint8Array {
	const sectionInputs: ReadonlyArray<
		readonly [string, ScalarType, SectionValues]
	> = [
		["cellIds", "u32", [CELL_ID]],
		["cellFlags", "u32", [0]],
		["cellAuthoredIds", "u32", [0x100]],
		["cellStructureIndices", "u32", [0]],
		["cellPlacements", "f32", [0, 0, 0, 1, 0, 0, 0]],
		["cellBounds", "f32", [0, 0, 0, 1, 1, 1]],
		["cellSurfaceRanges", "u32", [0, 1]],
		["surfaceIds", "u32", [SURFACE_ID]],
		["cellVisibleRanges", "u32", [0, 0]],
		["visibleCellIds", "u32", []],
		["cellResidentRanges", "u32", [0, 0]],
		["containmentPlanes", "f32", [1, 0, 0, 0]],
		["aperturePositions", "f32", []],
		["apertureIndices", "u32", []],
		["shellPositions", "f32", [0, 0, 0, 1, 0, 0, 0, 1, 0]],
		["shellNormals", "f32", [0, 0, 1, 0, 0, 1, 0, 0, 1]],
		["shellTextureCoordinates", "f32", [0, 0, 1, 0, 0, 1]],
		["shellIndices", "u32", [0, 1, 2]],
		["shellMaterialSlots", "u16", [0]],
		["shellMaterialWrapModes", "u8", [0]],
		["shellMaterialSideKinds", "u8", [0]],
		["shellMaterialSideTypes", "u8", [1]],
		["shellMaterialStippling", "u8", [0]],
		["objectPositions", "f32", []],
		["objectNormals", "f32", []],
		["objectTextureCoordinates", "f32", []],
		["objectIndices", "u32", []],
		["objectMaterialSlots", "u16", []],
		["objectMaterialWrapModes", "u8", []],
		["objectMaterialSideKinds", "u8", []],
		["objectMaterialSideTypes", "u8", []],
		["objectMaterialStippling", "u8", []],
	];
	const { bytes: sectionBytes, sections } = encodeSections(
		sectionInputs.map(([name, scalarType, values]) => [
			name,
			scalarType,
			overrides[name] ?? values,
		]),
	);
	const manifest = baseManifest("present");
	manifest.cellCount = 1;
	manifest.structures = [
		{
			id: "cell-struct:0d000001/0001",
			environmentId: "0x0d000001",
			localSelector: 1,
			geometry: {
				id: "geometry:cell-struct/0d000001/0001",
				sourceAssetId: "cell-struct/0d000001/0001",
				vertexCount: 3,
				positionOffset: 0,
				normalOffset: 0,
				textureCoordinateOffset: 0,
				indexOffset: 0,
				indexCount: 3,
				materialSlotOffset: 0,
				materialSlotCount: 1,
				materialWrapModeOffset: 0,
				materialWrapModeCount: 1,
				materialSideKindOffset: 0,
				materialSideKindCount: 1,
				materialSideTypeOffset: 0,
				materialSideTypeCount: 1,
				materialStipplingOffset: 0,
				materialStipplingCount: 1,
				rejectedDegenerateTriangles: [],
				bounds: { min: [0, 0, 0], max: [1, 1, 0] },
			},
			surfaceSlotCount: 1,
			containmentPlaneOffset: 0,
			containmentPlaneCount: 1,
			portalPolygons: [],
		},
	];
	manifest.materials = [
		{
			id: "surface/08000001",
			rawSurfaceFlags: 0,
			translucency: 0,
			luminosity: 0,
			diffuseScale: 1,
			source: { kind: "solid-color", color: 0xffffffff },
		},
	];
	manifest.sections = sections;
	mutateManifest?.(manifest);
	return serializeRecord(manifest, sectionBytes);
}

function baseManifest(availability: "present" | "absent"): MutableManifest {
	return {
		transport: "holtburger-env-cell-record",
		version: 2,
		byteOrder: "little-endian",
		sectionByteOffsetBase: "section-data",
		landblockId: LAND_BLOCK_ID,
		availability,
		cellCount: 0,
		structures: [],
		apertures: [],
		crossings: [],
		residents: [],
		objectDefinitions: [],
		objectGeometries: [],
		materials: [],
		textureDependencies: [],
		diagnostics: {
			unresolvedOutsideEndpoints: [],
			unresolvedVisibilityReciprocals: [],
			visibilityApertureCounts: {
				authoredSourceCrossings: 0,
				reciprocalIntersectionCrossings: 0,
				synthesizedIntersectionGeometries: 0,
			},
		},
		sections: [],
	};
}

function installReciprocalVisibilityFixture(manifest: MutableManifest): void {
	const aperture = (
		id: string,
		kind: "env-cell" | "effective-visibility",
		positionOffset: number,
		indexOffset: number,
	) => ({
		id: `portal-aperture:${id}`,
		kind,
		polygonIds: kind === "env-cell" ? [positionOffset] : [],
		positionOffset,
		positionCount: 3,
		indexOffset,
		indexCount: 3,
		plane: { normal: [0, 0, 1], d: 0 },
		bounds: { min: [0, 0, 0], max: [1, 1, 0] },
	});
	manifest.apertures = [
		aperture("source-a", "env-cell", 0, 0),
		aperture("source-b", "env-cell", 3, 3),
		aperture("visibility", "effective-visibility", 6, 6),
	];
	const crossing = (
		index: number,
		sourceApertureIndex: number,
		reciprocalApertureIndex: number,
	) => ({
		id: `portal-crossing:${index}`,
		sourceCellIndex: 0,
		targetCellIndex: 0,
		sourceApertureIndex,
		visibilityApertureIndex: 2,
		visibilityProvenance: {
			kind: "reciprocal-intersection",
			reciprocalApertureIndex,
			maximumPlaneDeviation: 0,
			absoluteNormalDot: 1,
			componentCount: 1,
		},
		acceptedSide: "positive",
		exactMatch: false,
		maskDepthPolicy: "allow-equal-depth",
		reciprocalCrossingIndex: 1 - index,
		sourcePortal: {
			kind: "env-cell",
			envCellId: "0x00010100",
			portalIndex: index,
			polygonId: index,
			flags: 2,
		},
		spatialRelationship: {
			kind: "indoor-topology-boundary",
			reason: "source-not-exact-match",
		},
	});
	manifest.crossings = [crossing(0, 0, 1), crossing(1, 1, 0)];
	manifest.diagnostics.visibilityApertureCounts = {
		authoredSourceCrossings: 0,
		reciprocalIntersectionCrossings: 2,
		synthesizedIntersectionGeometries: 1,
	};
}

function encodeSections(
	inputs: ReadonlyArray<readonly [string, ScalarType, SectionValues]>,
): { readonly bytes: Uint8Array; readonly sections: MutableSection[] } {
	const sections: MutableSection[] = [];
	let length = 0;
	for (const [name, scalarType, values] of inputs) {
		const size = scalarSize(scalarType);
		length = align(length, size);
		sections.push({
			name,
			scalarType,
			elementCount: values.length,
			byteOffset: length,
			byteLength: values.length * size,
		});
		length += values.length * size;
	}
	const bytes = new Uint8Array(length);
	const view = new DataView(bytes.buffer);
	for (const [index, [, scalarType, values]] of inputs.entries()) {
		const section = sections[index]!;
		for (const [valueIndex, value] of values.entries()) {
			const offset = section.byteOffset + valueIndex * scalarSize(scalarType);
			if (scalarType === "f32") view.setFloat32(offset, value, true);
			else if (scalarType === "u32") view.setUint32(offset, value, true);
			else if (scalarType === "u16") view.setUint16(offset, value, true);
			else view.setUint8(offset, value);
		}
	}
	return { bytes, sections };
}

function serializeRecord(
	manifest: MutableManifest,
	sectionBytes: Uint8Array,
): Uint8Array {
	const encoder = new TextEncoder();
	const serialized = encoder.encode(JSON.stringify(manifest));
	const manifestLength = align(serialized.length, 4);
	const result = new Uint8Array(16 + manifestLength + sectionBytes.length);
	result.set(encoder.encode("HBEC"), 0);
	const view = new DataView(result.buffer);
	view.setUint16(4, 2, true);
	view.setUint16(6, 0, true);
	view.setUint32(8, manifestLength, true);
	view.setUint32(12, result.length, true);
	result.fill(0x20, 16, 16 + manifestLength);
	result.set(serialized, 16);
	result.set(sectionBytes, 16 + manifestLength);
	return result;
}

function scalarSize(type: ScalarType): number {
	return type === "u8" ? 1 : type === "u16" ? 2 : 4;
}

function align(value: number, alignment: number): number {
	return Math.ceil(value / alignment) * alignment;
}
