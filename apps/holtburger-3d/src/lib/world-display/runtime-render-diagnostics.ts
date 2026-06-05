import type {
	CompactionAlphaPolicy,
	CompactionFamilyBypass,
	CompactionGeometryBlocker,
	CompactionMaterialBlocker,
	CompactionMaterialFamily,
} from "./compaction/compaction-family-planner";
import type { StagedWorldDrawUnitAssembly } from "./staged-world-assembly";

export interface DrawUnitRuntimeDiagnostic {
	drawUnitId: string;
	submissionPath: "missing-draw-unit" | "direct-retained";
	drawUnit: DrawUnitRuntimeFacts | null;
}

interface DrawUnitRuntimeFacts {
	kind: StagedWorldDrawUnitAssembly["kind"] | "portal-mask";
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
