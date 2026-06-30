import type {
	LandblockSourceIdentity,
	OutdoorStaticObjectDomain,
	StaticDomain,
	StaticMaterialCoverageBucket,
	StaticMaterialCoverageFamily,
	StaticMaterialCoverageFilteringMode,
	StaticMaterialCoveragePass,
	StaticMaterialCoverageReport,
	StaticMaterialRenderOutcome,
	StaticMaterialUnrenderedBucket,
} from "../../contracts";
import type { StaticObjectCompatibilityPartition } from "./static-object-compatibility-partitioner";
import type {
	StaticMaterialFallbackReason,
	StaticObjectMaterialPipelinePlan,
	StaticMaterialPlan,
} from "./static-object-material-planner";
import {
	isRenderableStaticMaterialPlan,
	isRenderableStaticObjectPartition,
} from "./static-object-renderability";

const MAX_UNRENDERED_BUCKETS = 8;

export function createStaticObjectMaterialCoverageReport(options: {
	readonly payload: {
		readonly domain: Extract<
			StaticDomain,
			OutdoorStaticObjectDomain | "env-cell-system"
		>;
		readonly landblock: LandblockSourceIdentity;
	};
	readonly materialPlan: StaticObjectMaterialPipelinePlan;
	readonly partitions: readonly StaticObjectCompatibilityPartition[];
}): StaticMaterialCoverageReport {
	const bucketBuilders = new Map<string, MutableCoverageBucket>();
	const materialKeysByBucket = new Map<string, Set<number>>();

	for (const plan of options.materialPlan.materialPlans) {
		const bucketKey = createBucketKey({
			family: plan.family,
			outcome: resolveMaterialPlanOutcome(plan),
			pass: plan.pass,
		});
		const materialIds =
			materialKeysByBucket.get(bucketKey) ?? new Set<number>();
		materialIds.add(plan.material.materialId);
		materialKeysByBucket.set(bucketKey, materialIds);
		getOrCreateBucket(
			bucketBuilders,
			plan.family,
			plan.pass,
			resolveMaterialPlanOutcome(plan),
		).textureRoleCount += plan.textureRoles.length;
	}

	for (const partition of options.partitions) {
		const bucket = getOrCreateBucket(
			bucketBuilders,
			partition.family,
			partition.pass,
			resolvePartitionOutcome(partition),
		);
		bucket.partitionCount += 1;
		bucket.triangleCount += partition.triangleCount;
	}

	const buckets = [...bucketBuilders.entries()]
		.map(([key, bucket]) => ({
			...bucket,
			materialCount: materialKeysByBucket.get(key)?.size ?? 0,
		}))
		.sort(compareCoverageBuckets);

	const fallbackReasonCounts = createFallbackReasonCounts(
		options.materialPlan.fallbackReasons,
	);
	const unrenderedBuckets = createUnrenderedBuckets(
		buckets,
		options.materialPlan.fallbackReasons,
	);

	return {
		buckets,
		coverageKey: `${options.payload.domain}:static-objects`,
		coverageKind:
			options.payload.domain === "env-cell-system"
				? "env-cell-static-object-seeds"
				: "outdoor-static-objects",
		deferredTriangleCount: countOutcomeTriangles(buckets, "render-deferred"),
		detailRoleCount: options.materialPlan.detailRoles.length,
		domain: options.payload.domain,
		fallbackReasonCount: options.materialPlan.fallbackReasons.length,
		fallbackReasonCounts,
		landblockId: options.payload.landblock.landblockId,
		materialCount: options.materialPlan.materialPlans.length,
		partitionCount: options.partitions.length,
		renderedTriangleCount: countOutcomeTriangles(buckets, "rendered"),
		triangleCount: options.partitions.reduce(
			(count, partition) => count + partition.triangleCount,
			0,
		),
		unrenderedBuckets,
		unsupportedTriangleCount: countOutcomeTriangles(buckets, "unsupported"),
	};
}

function resolveMaterialPlanOutcome(
	plan: StaticMaterialPlan,
): StaticMaterialRenderOutcome {
	if (plan.renderCoverage === "unsupported") {
		return "unsupported";
	}
	return isRenderableStaticMaterialPlan(plan) ? "rendered" : "render-deferred";
}

function resolvePartitionOutcome(
	partition: StaticObjectCompatibilityPartition,
): StaticMaterialRenderOutcome {
	if (partition.renderCoverage === "unsupported") {
		return "unsupported";
	}
	return isRenderableStaticObjectPartition(partition)
		? "rendered"
		: "render-deferred";
}

function getOrCreateBucket(
	buckets: Map<string, MutableCoverageBucket>,
	family: StaticMaterialCoverageFamily,
	pass: StaticMaterialCoveragePass,
	outcome: StaticMaterialRenderOutcome,
): MutableCoverageBucket {
	const key = createBucketKey({ family, outcome, pass });
	const existing = buckets.get(key);
	if (existing) {
		return existing;
	}

	const bucket: MutableCoverageBucket = {
		family,
		filteringMode: resolveCoverageFilteringMode(family, outcome),
		materialCount: 0,
		outcome,
		partitionCount: 0,
		pass,
		textureRoleCount: 0,
		triangleCount: 0,
	};
	buckets.set(key, bucket);

	return bucket;
}

function resolveCoverageFilteringMode(
	family: StaticMaterialCoverageFamily,
	outcome: StaticMaterialRenderOutcome,
): StaticMaterialCoverageFilteringMode {
	return family === "indexed-paletted" && outcome === "rendered"
		? "shader-palette-linear"
		: "none";
}

function createBucketKey(options: {
	readonly family: StaticMaterialCoverageFamily;
	readonly pass: StaticMaterialCoveragePass;
	readonly outcome: StaticMaterialRenderOutcome;
}): string {
	return `${options.family}|${options.pass}|${options.outcome}`;
}

function countOutcomeTriangles(
	buckets: readonly StaticMaterialCoverageBucket[],
	outcome: StaticMaterialRenderOutcome,
): number {
	return buckets
		.filter((bucket) => bucket.outcome === outcome)
		.reduce((count, bucket) => count + bucket.triangleCount, 0);
}

function createFallbackReasonCounts(
	reasons: readonly StaticMaterialFallbackReason[],
): readonly StaticMaterialCoverageReport["fallbackReasonCounts"][number][] {
	const counts = new Map<string, number>();
	for (const reason of reasons) {
		counts.set(reason.code, (counts.get(reason.code) ?? 0) + 1);
	}

	return [...counts.entries()]
		.sort(
			([leftCode, leftCount], [rightCode, rightCount]) =>
				rightCount - leftCount || leftCode.localeCompare(rightCode),
		)
		.map(([code, count]) => ({ code, count }));
}

function createUnrenderedBuckets(
	buckets: readonly StaticMaterialCoverageBucket[],
	reasons: readonly StaticMaterialFallbackReason[],
): readonly StaticMaterialUnrenderedBucket[] {
	const reasonCodes = Array.from(
		new Set(reasons.map((reason) => reason.code)),
	).sort();

	return buckets
		.filter(
			(
				bucket,
			): bucket is StaticMaterialCoverageBucket & {
				readonly outcome: "render-deferred" | "unsupported";
			} => bucket.outcome !== "rendered",
		)
		.sort(
			(left, right) =>
				right.triangleCount - left.triangleCount ||
				right.materialCount - left.materialCount ||
				left.family.localeCompare(right.family) ||
				left.pass.localeCompare(right.pass),
		)
		.slice(0, MAX_UNRENDERED_BUCKETS)
		.map((bucket) => ({
			family: bucket.family,
			materialCount: bucket.materialCount,
			outcome: bucket.outcome,
			partitionCount: bucket.partitionCount,
			pass: bucket.pass,
			reasonCodes,
			triangleCount: bucket.triangleCount,
		}));
}

function compareCoverageBuckets(
	left: StaticMaterialCoverageBucket,
	right: StaticMaterialCoverageBucket,
): number {
	return (
		left.family.localeCompare(right.family) ||
		left.pass.localeCompare(right.pass) ||
		left.outcome.localeCompare(right.outcome)
	);
}

type MutableCoverageBucket = {
	-readonly [Key in keyof StaticMaterialCoverageBucket]: StaticMaterialCoverageBucket[Key];
};
