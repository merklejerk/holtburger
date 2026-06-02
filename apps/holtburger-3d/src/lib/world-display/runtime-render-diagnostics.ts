import type {
	CompactionAlphaPolicy,
	CompactionFamilyBypass,
	CompactionGeometryBlocker,
	CompactionMaterialBlocker,
	CompactionMaterialFamily,
} from "./compaction-family-planner";
import type { StagedWorldDrawUnitAssembly } from "./staged-world-assembly";

export interface DrawUnitRuntimeDiagnostic {
	drawUnitId: string;
	submissionPath:
		| "missing-draw-unit"
		| "direct-retained"
		| "compacted-resource";
	drawUnit: DrawUnitRuntimeFacts | null;
	compactedRoutes: readonly DrawUnitCompactedRouteDiagnostic[];
}

interface DrawUnitRuntimeFacts {
	kind: StagedWorldDrawUnitAssembly["kind"];
	materialKind: StagedWorldDrawUnitAssembly["material"]["kind"];
	materialKey: string;
	triangleCount: number;
	compactionDecision: "compacted" | "direct-draw";
	finalCompactionPlan: DrawUnitFinalCompactionPlanDiagnostic;
	compactionMaterialFamily: CompactionMaterialFamily;
	compactionAlphaPolicy: CompactionAlphaPolicy;
	compactionMaterialBlockers: readonly CompactionMaterialBlocker[];
	compactionGeometryBlockers: readonly CompactionGeometryBlocker[];
}

interface DrawUnitFinalCompactionPlanDiagnostic {
	status:
		| "planned-rgba-texture-page"
		| "planned-indexed-paletted"
		| "not-planned";
	materialSlotKey: string | null;
	bypasses: readonly {
		reason: CompactionFamilyBypass["reason"];
		detail: string;
	}[];
}

type DrawUnitCompactedRouteDiagnostic =
	| RgbaTexturePageCompactedRouteDiagnostic
	| IndexedPalettedCompactedRouteDiagnostic;

interface CompactedRouteBaseDiagnostic {
	family: "rgba-texture-page" | "indexed-paletted";
	familyResourceKey: string;
	geometryBatchKey: string;
	batchLandblockId: number | null;
	batchAvailable: boolean;
	sliceKey: string;
	sliceFirstIndex: number;
	sliceIndexCount: number;
	sliceDrawUnitCount: number;
	sliceMaterialSlotKeys: readonly string[];
}

interface RgbaTexturePageCompactedRouteDiagnostic extends CompactedRouteBaseDiagnostic {
	family: "rgba-texture-page";
	atlasTextureIndex: number;
	detailAtlasTextureIndex: number | null;
	materialSlot: RgbaTexturePageRuntimeMaterialSlotDiagnostic | null;
}

interface RgbaTexturePageRuntimeMaterialSlotDiagnostic {
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
	wrap: string;
}

interface IndexedPalettedCompactedRouteDiagnostic extends CompactedRouteBaseDiagnostic {
	family: "indexed-paletted";
	indexFormat: "p8" | "index16";
	indexPageKey: string;
	palettePageKey: string;
	detailAtlasTextureIndex: number | null;
	materialRecord: IndexedPalettedRuntimeMaterialRecordDiagnostic | null;
}

interface IndexedPalettedRuntimeMaterialRecordDiagnostic {
	key: string;
	sourceMaterialKey: string;
	indexPageKey: string;
	palettePageKey: string;
	indexFormat: "p8" | "index16";
	indexPageSize: string;
	paletteColorCount: number;
	clipThreshold: number;
	wrap: string;
	detailAtlasTextureIndex: number | null;
	detailAtlasRect: readonly [number, number, number, number];
	detailTiling: number;
}
