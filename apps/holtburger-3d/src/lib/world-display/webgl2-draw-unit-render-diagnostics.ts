import type { DrawUnitRuntimeDiagnostic } from "./draw-unit-render-diagnostics";
import type { CompactionFamilyPlan } from "./compaction/compaction-family-planner";
import type {
	Webgl2WorldDrawUnit,
	Webgl2WorldResourceStore,
} from "./webgl2-world-resources";

export function deriveWebgl2DrawUnitRuntimeDiagnostics({
	store,
	drawUnitIds,
}: {
	store: Webgl2WorldResourceStore;
	drawUnitIds: readonly string[];
}): DrawUnitRuntimeDiagnostic[] {
	return drawUnitIds.map((drawUnitId) =>
		describeDrawUnitRuntimeDiagnostic(store, drawUnitId),
	);
}

function describeDrawUnitRuntimeDiagnostic(
	store: Webgl2WorldResourceStore,
	drawUnitId: string,
): DrawUnitRuntimeDiagnostic {
	const drawUnit = store.drawUnitsById.get(drawUnitId) ?? null;
	if (!drawUnit) {
		return {
			drawUnitId,
			submissionPath: "missing-draw-unit",
			drawUnit: null,
		};
	}
	return {
		drawUnitId,
		submissionPath: "direct-retained",
		drawUnit: {
			kind: drawUnit.kind,
			materialKind: drawUnit.materialKind,
			materialKey: drawUnit.materialKey,
			triangleCount: drawUnit.triangleCount,
			materialBatchingDecision: drawUnit.compactionEligibility.decision,
			finalMaterialBatchingPlan: describeFinalCompactionPlan(
				store.compactionFamilyPlan,
				drawUnit,
			),
			materialBatchingMaterialFamily: drawUnit.compactionEligibility.material.family,
			materialBatchingAlphaPolicy:
				drawUnit.compactionEligibility.material.alphaPolicy,
			materialBatchingMaterialBlockers:
				drawUnit.compactionEligibility.material.blockers,
			materialBatchingGeometryBlockers:
				drawUnit.compactionEligibility.geometry.blockers,
		},
	};
}

function describeFinalCompactionPlan(
	plan: CompactionFamilyPlan,
	drawUnit: Webgl2WorldDrawUnit,
): NonNullable<DrawUnitRuntimeDiagnostic["drawUnit"]>["finalMaterialBatchingPlan"] {
	const rgbaMaterialSlotKey =
		plan.renderFamilies.rgbaTexturePage.drawUnitMaterialSlots.find(
			(record) => record.drawUnitId === drawUnit.id,
		)?.materialSlotKey ?? null;
	if (
		plan.renderFamilies.rgbaTexturePage.compactableDrawUnitIds.includes(
			drawUnit.id,
		)
	) {
		return {
			status: "planned-rgba-texture-page",
			materialSlotKey: rgbaMaterialSlotKey,
			bypasses: [],
		};
	}
	const indexedMaterialSlotKey =
		plan.renderFamilies.indexedPaletted.drawUnitMaterialSlots.find(
			(record) => record.drawUnitId === drawUnit.id,
		)?.materialSlotKey ?? null;
	if (
		plan.renderFamilies.indexedPaletted.compactableDrawUnitIds.includes(
			drawUnit.id,
		)
	) {
		return {
			status: "planned-indexed-paletted",
			materialSlotKey: indexedMaterialSlotKey,
			bypasses: [],
		};
	}
	return {
		status: "not-planned",
		materialSlotKey: null,
		bypasses: plan.bypasses
			.filter((bypass) => bypass.drawUnitId === drawUnit.id)
			.map((bypass) => ({
				reason: bypass.reason,
				detail: bypass.detail,
			})),
	};
}
