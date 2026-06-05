import type {
	CompactedGeometryBatch,
	CompactedGeometrySlice,
} from "../../compaction/compacted-geometry";
import type { IndexedPalettedFamilyMaterialTableRecord } from "../../compaction/compaction-family-planner";
import type {
	Webgl2BufferResource,
	Webgl2VertexArrayResource,
} from "../../webgl2-gl";

interface Webgl2RgbaTexturePageFamilyMaterialSlot {
	key: string;
	sourceMaterialSlotKey: string;
	index: number;
	atlasTextureIndex: number;
	atlasRect: readonly [number, number, number, number];
	detailAtlasTextureIndex: number | null;
	detailAtlasRect: readonly [number, number, number, number];
	detailTiling: number;
	renderStateKey: string;
	samplingKey: string;
	alphaPolicy: "opaque" | "cutout";
	alphaTest: number;
	wrapS: "clamp" | "repeat";
	wrapT: "clamp" | "repeat";
}

interface Webgl2RgbaTexturePageFamilyDrawSlice extends CompactedGeometrySlice {
	atlasTextureIndex: number;
	detailAtlasTextureIndex: number | null;
}

interface Webgl2IndexedPalettedFamilyDrawSlice extends CompactedGeometrySlice {
	indexFormat: "p8" | "index16";
	indexPageKey: string;
	palettePageKey: string;
	indexAtlasTextureIndex: number;
	paletteAtlasTextureIndex: number;
	detailAtlasTextureIndex: number | null;
}

interface Webgl2IndexedPalettedFamilyMaterialTableRecord
	extends IndexedPalettedFamilyMaterialTableRecord {
	indexAtlasTextureIndex: number;
	indexAtlasRect: readonly [number, number, number, number];
	paletteAtlasTextureIndex: number;
	paletteAtlasRect: readonly [number, number, number, number];
	detailAtlasTextureIndex: number | null;
	detailAtlasRect: readonly [number, number, number, number];
}

export interface Webgl2RgbaTexturePageFamilyResource {
	family: "rgba-texture-page";
	key: string;
	geometryBatchKey: string;
	textureAtlasGenerationKey: string;
	materialSlots: readonly Webgl2RgbaTexturePageFamilyMaterialSlot[];
	drawSlices: readonly Webgl2RgbaTexturePageFamilyDrawSlice[];
}

export interface Webgl2IndexedPalettedFamilyResource {
	family: "indexed-paletted";
	key: string;
	geometryBatchKey: string;
	indexedResourceAtlasGenerationKey: string;
	detailTextureAtlasGenerationKey: string | null;
	materialTableRecords: readonly Webgl2IndexedPalettedFamilyMaterialTableRecord[];
	drawSlices: readonly Webgl2IndexedPalettedFamilyDrawSlice[];
}

export type Webgl2CompactedGeometryFamilyResource =
	| Webgl2RgbaTexturePageFamilyResource
	| Webgl2IndexedPalettedFamilyResource;

export interface Webgl2CompactedGeometryBatchResource {
	key: string;
	landblockId: number;
	vertexArray: Webgl2VertexArrayResource;
	positionBuffer: Webgl2BufferResource;
	uvBuffer: Webgl2BufferResource;
	materialSlotBuffer: Webgl2BufferResource;
	indexBuffer: Webgl2BufferResource;
	indexType: GLenum;
	batchModelMatrix: CompactedGeometryBatch["batchModelMatrix"];
	vertexCount: number;
	indexCount: number;
	triangleCount: number;
	drawSliceCount: number;
	drawUnitCount: number;
	positionByteLength: number;
	uvByteLength: number;
	materialSlotByteLength: number;
	indexByteLength: number;
	totalByteLength: number;
	dispose(): void;
}
