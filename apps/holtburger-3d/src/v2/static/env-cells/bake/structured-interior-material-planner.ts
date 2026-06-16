import type {
	LandblockEnvCellStaticFacts,
	LandblockEnvCellsStaticScopePayload,
	ScheduledStaticWork,
	StaticMaterialCoverageReport,
	StaticMaterialUnrenderedBucket,
	StaticObjectMaterialSourceFacts,
	StructuredInteriorMaterialDiagnostic,
	StructuredInteriorMaterialPlanEntry,
} from "../../contracts";
import {
	createMaterialTextureDataUseKey,
	createStaticMaterialTextureUseId,
	resolveRepeatedStaticMaterialPrimaryWrapMode,
	type StaticMaterialTextureWrapMode,
} from "../../bake/static-material-texture-policy";
import {
	classifyStaticObjectMaterial,
	type StaticObjectMaterialFallbackReason,
	type StaticObjectMaterialPlan,
} from "../../objects/bake/static-object-material-planner";
import { isRenderableStaticObjectMaterialPlan } from "../../objects/bake/static-object-renderability";

export interface StructuredInteriorCellMaterialPlan {
	readonly entries: readonly StructuredInteriorMaterialPlanEntry[];
	readonly materialPlansBySurfaceId: ReadonlyMap<number, StaticObjectMaterialPlan>;
}

export function resolveStructuredInteriorMaterialSurfaceId(
	envCell: LandblockEnvCellStaticFacts,
	geometrySurfaceId: number,
): number | null {
	const slotSurface = envCell.surfaces.find(
		(surface) => surface.slotId === geometrySurfaceId,
	);
	return slotSurface?.surfaceId ?? null;
}

export function planStructuredInteriorCellMaterials(options: {
	readonly envCell: LandblockEnvCellStaticFacts;
	readonly payload: LandblockEnvCellsStaticScopePayload;
	readonly work: ScheduledStaticWork;
}): StructuredInteriorCellMaterialPlan {
	const materialSourcesById = new Map(
		options.payload.materialSources.map((source) => [
			source.identity.materialId,
			source,
		]),
	);
	const materialPlansBySurfaceId = new Map<number, StaticObjectMaterialPlan>();
	const entries = options.envCell.surfaces
		.map((surface): StructuredInteriorMaterialPlanEntry => {
			const material = materialSourcesById.get(surface.material.materialId);
			if (!material) {
				const diagnostic: StructuredInteriorMaterialDiagnostic = {
					code: "missing-cell-structure-material-source",
					material: surface.material,
					message:
						"Env-cell cell-structure material source was not resolved; structured-interior surface is not renderable.",
					surfaceId: surface.surfaceId,
				};

				return {
					diagnostics: [diagnostic],
					family: "unsupported",
					material: surface.material,
					outcome: "render-deferred",
					pass: "opaque",
					slotId: surface.slotId,
					surfaceId: surface.surfaceId,
					textureUseIds: [],
				};
			}

			const plan = classifyStructuredInteriorMaterial({
				material,
				payload: options.payload,
			});
			const textureWrapMode =
				resolveStructuredInteriorPlanTextureWrapMode(plan);
			materialPlansBySurfaceId.set(surface.surfaceId, plan);
			return {
				diagnostics: plan.fallbackReasons.map((reason) =>
					createStructuredInteriorDiagnostic({
						material: surface.material,
						reason,
						surfaceId: surface.surfaceId,
					}),
				),
				family: plan.family,
				material: surface.material,
				outcome: isRenderableStaticObjectMaterialPlan(plan)
					? "rendered"
					: plan.renderCoverage === "unsupported"
						? "unsupported"
						: "render-deferred",
				pass: plan.pass,
				slotId: surface.slotId,
				surfaceId: surface.surfaceId,
				textureUseIds: plan.textureRoles.map((role) =>
					createStructuredInteriorTextureUseId({
						dataUse: role.dataUse,
						work: options.work,
						wrapMode: textureWrapMode,
					}),
				),
			};
		})
		.sort(
			(left, right) =>
				left.slotId - right.slotId ||
				left.surfaceId - right.surfaceId ||
				left.material.materialId - right.material.materialId,
		);

	return { entries, materialPlansBySurfaceId };
}

export function createStructuredInteriorTextureUseId(
	options: {
		readonly dataUse: Parameters<typeof createMaterialTextureDataUseKey>[0];
		readonly work: ScheduledStaticWork;
		readonly wrapMode: StaticMaterialTextureWrapMode;
	},
): string {
	return createStaticMaterialTextureUseId({
		dataUse: options.dataUse,
		textureUseNamespace: "structured-interior-texture",
		workId: options.work.workId,
		wrapMode: options.wrapMode,
	});
}

export function resolveStructuredInteriorPlanTextureWrapMode(
	plan: StaticObjectMaterialPlan,
): StaticMaterialTextureWrapMode {
	return resolveRepeatedStaticMaterialPrimaryWrapMode(
		plan.textureRoles.map((role) => role.dataUse),
	);
}

function classifyStructuredInteriorMaterial(options: {
	readonly material: StaticObjectMaterialSourceFacts;
	readonly payload: LandblockEnvCellsStaticScopePayload;
}): StaticObjectMaterialPlan {
	return classifyStaticObjectMaterial({
		material: options.material,
		paletteOverride: null,
		paletteSources: options.payload.paletteSources,
		paletteViews: [],
		textureRefs: options.payload.textureRefs,
	});
}

function createStructuredInteriorDiagnostic(options: {
	readonly material: StructuredInteriorMaterialDiagnostic["material"];
	readonly reason: StaticObjectMaterialFallbackReason;
	readonly surfaceId: number;
}): StructuredInteriorMaterialDiagnostic {
	return {
		code: options.reason.code,
		material: options.material,
		message: options.reason.message,
		surfaceId: options.surfaceId,
	};
}

export function getStructuredInteriorMaterialEntries(
	plan: StructuredInteriorCellMaterialPlan,
): readonly StructuredInteriorMaterialPlanEntry[] {
	return plan.entries;
}

export function createStructuredInteriorMaterialCoverageReport(options: {
	readonly payload: LandblockEnvCellsStaticScopePayload;
	readonly materialPlansByEnvCellId: ReadonlyMap<
		number,
		StructuredInteriorCellMaterialPlan
	>;
}): StaticMaterialCoverageReport {
	const materialIds = new Set<number>();
	let materialCount = 0;
	let triangleCount = 0;
	let renderedTriangleCount = 0;
	let deferredTriangleCount = 0;
	let unsupportedTriangleCount = 0;
	let diagnosticCount = 0;
	const diagnosticCodes = new Map<string, number>();
	const diagnosticCodesByBucket = new Map<string, Set<string>>();
	const bucketCounts = new Map<
		string,
		{
			readonly family: StructuredInteriorMaterialPlanEntry["family"];
			readonly outcome: StructuredInteriorMaterialPlanEntry["outcome"];
			readonly pass: StructuredInteriorMaterialPlanEntry["pass"];
			textureRoleCount: number;
			materialIds: Set<number>;
			triangleCount: number;
		}
	>();

	for (const envCell of options.payload.envCells) {
		const plan =
			options.materialPlansByEnvCellId.get(envCell.identity.envCellId) ?? null;
		const materialEntries = plan?.entries ?? [];
		for (const planEntry of materialEntries) {
			materialCount += 1;
			materialIds.add(planEntry.material.materialId);
			diagnosticCount += planEntry.diagnostics.length;
			for (const reason of planEntry.diagnostics) {
				diagnosticCodes.set(
					reason.code,
					(diagnosticCodes.get(reason.code) ?? 0) + 1,
				);
			}

			const surfaceTriangleCount = countSurfaceTriangles(
				envCell,
				planEntry.surfaceId,
			);
			if (planEntry.outcome === "rendered") {
				renderedTriangleCount += surfaceTriangleCount;
			} else if (planEntry.outcome === "unsupported") {
				unsupportedTriangleCount += surfaceTriangleCount;
			} else {
				deferredTriangleCount += surfaceTriangleCount;
			}
			const bucketKey = [
				planEntry.family,
				planEntry.pass,
				planEntry.outcome,
			].join("|");
			const bucketDiagnosticCodes =
				diagnosticCodesByBucket.get(bucketKey) ?? new Set<string>();
			for (const diagnostic of planEntry.diagnostics) {
				bucketDiagnosticCodes.add(diagnostic.code);
			}
			diagnosticCodesByBucket.set(bucketKey, bucketDiagnosticCodes);
			const bucket = bucketCounts.get(bucketKey) ?? {
				family: planEntry.family,
				materialIds: new Set<number>(),
				outcome: planEntry.outcome,
				pass: planEntry.pass,
				textureRoleCount: 0,
				triangleCount: 0,
			};
			bucket.materialIds.add(planEntry.material.materialId);
			bucket.textureRoleCount = Math.max(
				bucket.textureRoleCount,
				planEntry.textureUseIds.length,
			);
			bucket.triangleCount += surfaceTriangleCount;
			bucketCounts.set(bucketKey, bucket);
		}
		if (envCell.renderGeometry.triangleCount > 0) {
			triangleCount += envCell.renderGeometry.triangleCount;
		}
	}

	if (materialCount === 0 && triangleCount === 0) {
		return createEmptyCoverageReport(options.payload);
	}

	return {
		buckets: [...bucketCounts.values()]
			.sort(compareCoverageBuckets)
			.map((bucket) => ({
				family:
					bucket.family === "unsupported" ? "unsupported" : bucket.family,
				filteringMode: "none",
				materialCount: bucket.materialIds.size,
				outcome: bucket.outcome,
				pass: bucket.pass,
				partitionCount: countRenderableEnvCells(options.payload),
				textureRoleCount: bucket.textureRoleCount,
				triangleCount: bucket.triangleCount,
			})),
		coverageKey: "landblock-env-cells:structured-interior",
		coverageKind: "structured-interior",
		deferredTriangleCount,
		detailRoleCount: 0,
		domain: "landblock-env-cells",
		fallbackReasonCount: diagnosticCount,
		fallbackReasonCounts: [...diagnosticCodes.entries()]
			.sort(
				([leftCode, leftCount], [rightCode, rightCount]) =>
					rightCount - leftCount || leftCode.localeCompare(rightCode),
			)
			.map(([code, count]) => ({ code, count })),
		landblockId: options.payload.landblock.landblockId,
		materialCount,
		partitionCount: countRenderableEnvCells(options.payload),
		renderedTriangleCount,
		triangleCount,
		unrenderedBuckets: [...bucketCounts.values()]
			.sort(compareCoverageBuckets)
			.flatMap((bucket) => {
				const unrenderedBucket = createUnrenderedBucket({
					bucket,
					partitionCount: countRenderableEnvCells(options.payload),
					reasonCodes: [
						...(diagnosticCodesByBucket.get(
							[bucket.family, bucket.pass, bucket.outcome].join("|"),
						) ?? []),
					].sort(),
				});
				return unrenderedBucket ? [unrenderedBucket] : [];
			}),
		unsupportedTriangleCount,
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

function countSurfaceTriangles(
	envCell: LandblockEnvCellStaticFacts,
	surfaceId: number,
): number {
	return envCell.renderGeometry.triangles.filter(
		(triangle) =>
			triangle.surfaceId !== null &&
			resolveStructuredInteriorMaterialSurfaceId(envCell, triangle.surfaceId) ===
				surfaceId,
	).length;
}

function compareCoverageBuckets(
	left: {
		readonly family: string;
		readonly outcome: string;
		readonly pass: string;
	},
	right: {
		readonly family: string;
		readonly outcome: string;
		readonly pass: string;
	},
): number {
	return (
		left.outcome.localeCompare(right.outcome) ||
		left.pass.localeCompare(right.pass) ||
		left.family.localeCompare(right.family)
	);
}

function createUnrenderedBucket(options: {
	readonly bucket: {
		readonly family: StructuredInteriorMaterialPlanEntry["family"];
		readonly outcome: StructuredInteriorMaterialPlanEntry["outcome"];
		readonly pass: StructuredInteriorMaterialPlanEntry["pass"];
		readonly materialIds: ReadonlySet<number>;
		readonly triangleCount: number;
	};
	readonly partitionCount: number;
	readonly reasonCodes: readonly string[];
}): StaticMaterialUnrenderedBucket | null {
	if (options.bucket.outcome === "rendered") {
		return null;
	}

	return {
		family:
			options.bucket.family === "unsupported"
				? "unsupported"
				: options.bucket.family,
		materialCount: options.bucket.materialIds.size,
		outcome: options.bucket.outcome,
		partitionCount: options.partitionCount,
		pass: options.bucket.pass,
		reasonCodes: options.reasonCodes,
		triangleCount: options.bucket.triangleCount,
	};
}
