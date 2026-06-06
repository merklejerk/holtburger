import type {
	CompactionAlphaPolicy,
	CompactionFamilyBypass,
	CompactionGeometryBlocker,
	CompactionMaterialBlocker,
	CompactionMaterialFamily,
} from "./compaction/compaction-family-planner";
import type { RenderMaterialPlan } from "./render-material-plans";

export interface DrawUnitRuntimeDiagnostic {
	drawUnitId: string;
	submissionPath: "missing-draw-unit" | "direct-retained";
	drawUnit: DrawUnitRuntimeFacts | null;
}

interface DrawUnitRuntimeFacts {
	kind: "portal-mask";
	materialKind: RenderMaterialPlan["kind"];
	materialKey: string;
	triangleCount: number;
	materialBatchingDecision: "compacted" | "direct-draw";
	finalMaterialBatchingPlan: DrawUnitFinalMaterialBatchingPlanDiagnostic;
	materialBatchingMaterialFamily: CompactionMaterialFamily;
	materialBatchingAlphaPolicy: CompactionAlphaPolicy;
	materialBatchingMaterialBlockers: readonly CompactionMaterialBlocker[];
	materialBatchingGeometryBlockers: readonly CompactionGeometryBlocker[];
}

interface DrawUnitFinalMaterialBatchingPlanDiagnostic {
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
