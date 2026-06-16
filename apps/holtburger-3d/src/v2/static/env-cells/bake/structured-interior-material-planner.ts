import type {
	LandblockEnvCellStaticFacts,
	LandblockEnvCellsStaticScopePayload,
	StaticMaterialCoverageReport,
	StructuredInteriorMaterialFallbackReason,
	StructuredInteriorMaterialPlanEntry,
} from "../../contracts";

export function planStructuredInteriorCellMaterials(
	envCell: LandblockEnvCellStaticFacts,
): readonly StructuredInteriorMaterialPlanEntry[] {
	return envCell.surfaces
		.map((surface): StructuredInteriorMaterialPlanEntry => {
			const fallbackReason: StructuredInteriorMaterialFallbackReason = {
				code: "missing-cell-structure-material-source",
				material: surface.material,
				message:
					"Env-cell cell-structure material sources are not enriched yet; rendering uses structured-interior debug flat material.",
				surfaceId: surface.surfaceId,
			};

			return {
				fallbackReasons: [fallbackReason],
				family: "structured-interior-debug-flat",
				material: surface.material,
				outcome: "render-deferred",
				pass: "opaque",
				slotId: surface.slotId,
				surfaceId: surface.surfaceId,
				textureUseIds: [],
			};
		})
		.sort(
			(left, right) =>
				left.slotId - right.slotId ||
				left.surfaceId - right.surfaceId ||
				left.material.materialId - right.material.materialId,
		);
}

export function createStructuredInteriorMaterialCoverageReport(options: {
	readonly payload: LandblockEnvCellsStaticScopePayload;
	readonly materialPlansByEnvCellId: ReadonlyMap<
		number,
		readonly StructuredInteriorMaterialPlanEntry[]
	>;
}): StaticMaterialCoverageReport {
	const materialIds = new Set<number>();
	let materialCount = 0;
	let triangleCount = 0;
	let fallbackReasonCount = 0;
	const fallbackReasonCodes = new Map<string, number>();

	for (const envCell of options.payload.envCells) {
		const materialPlans =
			options.materialPlansByEnvCellId.get(envCell.identity.envCellId) ?? [];
		for (const plan of materialPlans) {
			materialCount += 1;
			materialIds.add(plan.material.materialId);
			fallbackReasonCount += plan.fallbackReasons.length;
			for (const reason of plan.fallbackReasons) {
				fallbackReasonCodes.set(
					reason.code,
					(fallbackReasonCodes.get(reason.code) ?? 0) + 1,
				);
			}
		}
		if (envCell.renderGeometry.triangleCount > 0) {
			triangleCount += envCell.renderGeometry.triangleCount;
		}
	}

	if (materialCount === 0 && triangleCount === 0) {
		return createEmptyCoverageReport(options.payload);
	}

	return {
		buckets: [
			{
				family: "unsupported",
				filteringMode: "none",
				materialCount: materialIds.size,
				outcome: "render-deferred",
				pass: "opaque",
				partitionCount: countRenderableEnvCells(options.payload),
				textureRoleCount: 0,
				triangleCount,
			},
		],
		coverageKey: "landblock-env-cells:structured-interior",
		coverageKind: "structured-interior",
		deferredTriangleCount: triangleCount,
		detailRoleCount: 0,
		domain: "landblock-env-cells",
		fallbackReasonCount,
		fallbackReasonCounts: [...fallbackReasonCodes.entries()]
			.sort(
				([leftCode, leftCount], [rightCode, rightCount]) =>
					rightCount - leftCount || leftCode.localeCompare(rightCode),
			)
			.map(([code, count]) => ({ code, count })),
		landblockId: options.payload.landblock.landblockId,
		materialCount,
		partitionCount: countRenderableEnvCells(options.payload),
		renderedTriangleCount: 0,
		triangleCount,
		unrenderedBuckets: [
			{
				family: "unsupported",
				materialCount: materialIds.size,
				outcome: "render-deferred",
				partitionCount: countRenderableEnvCells(options.payload),
				pass: "opaque",
				reasonCodes: [...fallbackReasonCodes.keys()].sort(),
				triangleCount,
			},
		],
		unsupportedTriangleCount: 0,
	};
}

function createEmptyCoverageReport(
	payload: LandblockEnvCellsStaticScopePayload,
): StaticMaterialCoverageReport {
	return {
		buckets: [],
		coverageKey: "landblock-env-cells:structured-interior",
		coverageKind: "structured-interior",
		deferredTriangleCount: 0,
		detailRoleCount: 0,
		domain: "landblock-env-cells",
		fallbackReasonCount: 0,
		fallbackReasonCounts: [],
		landblockId: payload.landblock.landblockId,
		materialCount: 0,
		partitionCount: 0,
		renderedTriangleCount: 0,
		triangleCount: 0,
		unrenderedBuckets: [],
		unsupportedTriangleCount: 0,
	};
}

function countRenderableEnvCells(
	payload: LandblockEnvCellsStaticScopePayload,
): number {
	return payload.envCells.filter((envCell) => envCell.renderGeometry.triangleCount > 0)
		.length;
}
