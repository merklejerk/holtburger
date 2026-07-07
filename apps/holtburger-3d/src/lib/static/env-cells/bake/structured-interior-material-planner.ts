import type {
	LandblockEnvCellStaticFacts,
	EnvCellSystemStaticScopePayload,
	MaterialTextureDataUseIdentity,
	StaticBakeTask,
	StaticMaterialCoverageReport,
	StaticMaterialUnrenderedBucket,
	StaticObjectMaterialSourceFacts,
	StructuredInteriorMaterialDiagnostic,
	StructuredInteriorMaterialPlanEntry,
} from "../../contracts";
import {
	createStaticMaterialTextureBindingRequirement,
	resolveRepeatedStaticMaterialPrimaryWrapMode,
	type StaticMaterialTextureWrapMode,
} from "../../bake/static-material-texture-policy";
import type { TextureBindingRequirement } from "../../../textures/placement";
import type { TextureBindingId } from "../../../textures/identity";
import {
	composeStaticMaterialDetailRole,
	planStaticMaterialDetailRoles,
} from "../../bake/static-material-detail-roles";
import {
	classifyObjectVisualMaterial,
	type ObjectVisualMaterialFallbackReason,
	type ObjectVisualMaterialPlan,
} from "../../../visual/object-visual-material-planner";
import { isRenderableObjectVisualMaterialPlan } from "../../objects/bake/static-object-renderability";

export interface StructuredInteriorCellMaterialPlan {
	readonly entries: readonly StructuredInteriorMaterialPlanEntry[];
	readonly materialPlansBySurfaceId: ReadonlyMap<
		number,
		ObjectVisualMaterialPlan
	>;
}

export interface StructuredInteriorMaterialPlanner {
	planCellMaterials(options: {
		readonly envCell: LandblockEnvCellStaticFacts;
	}): StructuredInteriorCellMaterialPlan;
	planCellMaterialsWithBudget(options: {
		readonly envCell: LandblockEnvCellStaticFacts;
		readonly planningBudget?: StructuredInteriorMaterialPlanningBudget;
	}): Promise<StructuredInteriorCellMaterialPlan>;
}

export interface StructuredInteriorMaterialPlanningBudget {
	/** Cooperative yield hook used by replacement runners to split long planners. */
	readonly yieldToFrameBudget: () => Promise<void>;
	/** Main-thread planning slice before yielding. Defaults to one short tasklet. */
	readonly maxMsBeforeYield?: number;
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

export function createStructuredInteriorMaterialPlanner(options: {
	readonly payload: EnvCellSystemStaticScopePayload;
	readonly task: StaticBakeTask;
}): StructuredInteriorMaterialPlanner {
	const materialSourcesById = new Map(
		options.payload.materialSources.map((source) => [
			source.identity.materialId,
			source,
		]),
	);
	const detailRoles = planStaticMaterialDetailRoles({
		detailRoles: options.payload.regionRenderProfile.detailRoles,
		textureRefs: options.payload.textureRefs,
	});
	const materialPlansByMaterialId = new Map<number, ObjectVisualMaterialPlan>();

	const createEntry = (
		surface: LandblockEnvCellStaticFacts["surfaces"][number],
	): {
		readonly entry: StructuredInteriorMaterialPlanEntry;
		readonly plan: ObjectVisualMaterialPlan | null;
	} => {
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
				entry: {
					diagnostics: [diagnostic],
					family: "unsupported",
					material: surface.material,
					outcome: "render-deferred",
					pass: "opaque",
					slotId: surface.slotId,
					surfaceId: surface.surfaceId,
					textureBindingIds: [],
				},
				plan: null,
			};
		}

		const plan =
			materialPlansByMaterialId.get(material.identity.materialId) ??
			classifyStructuredInteriorMaterial({
				detailRoles,
				material,
				payload: options.payload,
			});
		materialPlansByMaterialId.set(material.identity.materialId, plan);
		const textureWrapMode = resolveStructuredInteriorPlanTextureWrapMode(plan);
		return {
			entry: {
				diagnostics: plan.fallbackReasons.map((reason) =>
					createStructuredInteriorDiagnostic({
						material: surface.material,
						reason,
						surfaceId: surface.surfaceId,
					}),
				),
				family: plan.family,
				material: surface.material,
				outcome: isRenderableObjectVisualMaterialPlan(plan)
					? "rendered"
					: plan.renderCoverage === "unsupported"
						? "unsupported"
						: "render-deferred",
				pass: plan.pass,
				slotId: surface.slotId,
				surfaceId: surface.surfaceId,
				textureBindingIds: plan.textureRoles.map((role) =>
					createStructuredInteriorTextureBindingId({
						dataUse: role.dataUse,
						task: options.task,
						wrapMode: textureWrapMode,
					}),
				),
			},
			plan,
		};
	};

	const createPlan = (
		entries: readonly StructuredInteriorMaterialPlanEntry[],
		materialPlansBySurfaceId: ReadonlyMap<number, ObjectVisualMaterialPlan>,
	): StructuredInteriorCellMaterialPlan => ({
		entries: [...entries].sort(compareStructuredInteriorMaterialEntries),
		materialPlansBySurfaceId,
	});

	return {
		planCellMaterials({ envCell }) {
			const materialPlansBySurfaceId = new Map<
				number,
				ObjectVisualMaterialPlan
			>();
			const entries: StructuredInteriorMaterialPlanEntry[] = [];
			for (const surface of envCell.surfaces) {
				const planned = createEntry(surface);
				entries.push(planned.entry);
				if (planned.plan) {
					materialPlansBySurfaceId.set(surface.surfaceId, planned.plan);
				}
			}
			return createPlan(entries, materialPlansBySurfaceId);
		},
		async planCellMaterialsWithBudget({ envCell, planningBudget }) {
			const budget = createStructuredInteriorPlanningBudget(planningBudget);
			const materialPlansBySurfaceId = new Map<
				number,
				ObjectVisualMaterialPlan
			>();
			const entries: StructuredInteriorMaterialPlanEntry[] = [];
			for (const surface of envCell.surfaces) {
				await budget.yieldIfNeeded();
				const planned = createEntry(surface);
				entries.push(planned.entry);
				if (planned.plan) {
					materialPlansBySurfaceId.set(surface.surfaceId, planned.plan);
				}
			}
			return createPlan(entries, materialPlansBySurfaceId);
		},
	};
}

export function planStructuredInteriorCellMaterials(options: {
	readonly envCell: LandblockEnvCellStaticFacts;
	readonly payload: EnvCellSystemStaticScopePayload;
	readonly task: StaticBakeTask;
}): StructuredInteriorCellMaterialPlan {
	return createStructuredInteriorMaterialPlanner({
		payload: options.payload,
		task: options.task,
	}).planCellMaterials({ envCell: options.envCell });
}

function createStructuredInteriorTextureBindingId(options: {
	readonly dataUse: MaterialTextureDataUseIdentity;
	readonly task: StaticBakeTask;
	readonly wrapMode: StaticMaterialTextureWrapMode;
}): TextureBindingId {
	return createStructuredInteriorTextureBindingRequirement(options).bindingId;
}

export function createStructuredInteriorTextureBindingRequirement(options: {
	readonly dataUse: MaterialTextureDataUseIdentity;
	readonly task: StaticBakeTask;
	readonly wrapMode: StaticMaterialTextureWrapMode;
}): TextureBindingRequirement {
	return createStaticMaterialTextureBindingRequirement({
		dataUse: options.dataUse,
		domain: options.task.domain,
		textureUseNamespace: "structured-interior-texture",
		textureUseScopeId: options.task.ownerId,
		wrapMode: options.wrapMode,
	});
}

export function resolveStructuredInteriorPlanTextureWrapMode(
	plan: ObjectVisualMaterialPlan,
): StaticMaterialTextureWrapMode {
	return resolveRepeatedStaticMaterialPrimaryWrapMode(
		plan.textureRoles.map((role) => role.dataUse),
	);
}

function classifyStructuredInteriorMaterial(options: {
	readonly detailRoles: ReturnType<typeof planStaticMaterialDetailRoles>;
	readonly material: StaticObjectMaterialSourceFacts;
	readonly payload: EnvCellSystemStaticScopePayload;
}): ObjectVisualMaterialPlan {
	const basePlan = classifyObjectVisualMaterial({
		material: options.material,
		paletteOverride: null,
		paletteSources: options.payload.paletteSources,
		paletteViews: [],
		textureRefs: options.payload.textureRefs,
	});
	return composeStaticMaterialDetailRole({
		detailRoles: options.detailRoles,
		domain: "env-cell-system",
		plan: basePlan,
	});
}

function compareStructuredInteriorMaterialEntries(
	left: StructuredInteriorMaterialPlanEntry,
	right: StructuredInteriorMaterialPlanEntry,
): number {
	return (
		left.slotId - right.slotId ||
		left.surfaceId - right.surfaceId ||
		left.material.materialId - right.material.materialId
	);
}

function createStructuredInteriorPlanningBudget(
	budget: StructuredInteriorMaterialPlanningBudget | undefined,
) {
	let lastYieldAtMs = nowMs();
	return {
		async yieldIfNeeded(): Promise<void> {
			if (!budget) {
				return;
			}
			if (nowMs() - lastYieldAtMs < (budget.maxMsBeforeYield ?? 8)) {
				return;
			}
			await budget.yieldToFrameBudget();
			lastYieldAtMs = nowMs();
		},
	};
}

function nowMs(): number {
	return globalThis.performance?.now() ?? Date.now();
}

function createStructuredInteriorDiagnostic(options: {
	readonly material: StructuredInteriorMaterialDiagnostic["material"];
	readonly reason: ObjectVisualMaterialFallbackReason;
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
	readonly payload: EnvCellSystemStaticScopePayload;
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
				planEntry.textureBindingIds.length,
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
				family: bucket.family === "unsupported" ? "unsupported" : bucket.family,
				filteringMode: "none",
				materialCount: bucket.materialIds.size,
				outcome: bucket.outcome,
				pass: bucket.pass,
				partitionCount: countRenderableEnvCells(options.payload),
				textureRoleCount: bucket.textureRoleCount,
				triangleCount: bucket.triangleCount,
			})),
		coverageKey: "env-cell-system:structured-interior",
		coverageKind: "structured-interior",
		deferredTriangleCount,
		detailRoleCount: 0,
		domain: "env-cell-system",
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
	payload: EnvCellSystemStaticScopePayload,
): StaticMaterialCoverageReport {
	return {
		buckets: [],
		coverageKey: "env-cell-system:structured-interior",
		coverageKind: "structured-interior",
		deferredTriangleCount: 0,
		detailRoleCount: 0,
		domain: "env-cell-system",
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
	payload: EnvCellSystemStaticScopePayload,
): number {
	return payload.envCells.filter(
		(envCell) => envCell.renderGeometry.triangleCount > 0,
	).length;
}

function countSurfaceTriangles(
	envCell: LandblockEnvCellStaticFacts,
	surfaceId: number,
): number {
	return envCell.renderGeometry.triangles.filter(
		(triangle) =>
			triangle.surfaceId !== null &&
			resolveStructuredInteriorMaterialSurfaceId(
				envCell,
				triangle.surfaceId,
			) === surfaceId,
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
