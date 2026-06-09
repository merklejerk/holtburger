import {
	planAtlasLayout,
	type AtlasLayoutCohort,
	type AtlasTexturePage,
	type AtlasTexturePlacement,
} from "./atlas-layout-planner";
import type {
	CompactionFamilyPlanningPolicy,
	RgbaTexturePageAtlasEntryRecord,
	RgbaTexturePageDetailAtlasEntry,
} from "../compaction/compaction-family-planner";
import type { RenderMaterialTexturePageReadiness } from "../render-material-strategy";
import type { TexturePageBucket } from "./texture-page-binding";

export const TERRAIN_COLOR_ATLAS_GUTTER_PIXELS = 96;
export const TERRAIN_MASK_ATLAS_GUTTER_PIXELS = 16;

export interface TexturePageAtlasRgbaCandidate {
	candidateId: string;
	bucket?: TexturePageBucket;
	texturePageReadiness: RenderMaterialTexturePageReadiness;
	detailAtlasEntry: RgbaTexturePageDetailAtlasEntry | null;
}

export interface TexturePageAtlasDetailCandidate {
	candidateId: string;
	bucket?: TexturePageBucket;
	detailAtlasEntry: RgbaTexturePageDetailAtlasEntry | null;
}

export interface TexturePageAtlasCohort {
	key: string;
	bucket: TexturePageBucket;
	atlasEntryKeys: readonly string[];
}

type TexturePageAtlasFailureReason =
	| "source-texture-too-large"
	| "atlas-full"
	| "detail-atlas-full";

interface TexturePageAtlasFailure {
	candidateId: string;
	reason: TexturePageAtlasFailureReason;
	detail: string;
}

export interface TexturePageAtlasPlan {
	key: string;
	rgbaAtlasReadyCandidateIds: readonly string[];
	detailAtlasReadyCandidateIds: readonly string[];
	failures: readonly TexturePageAtlasFailure[];
	atlasEntryRecords: readonly RgbaTexturePageAtlasEntryRecord[];
	atlasTextures: readonly AtlasTexturePage[];
	detailAtlasEntryRecords: readonly RgbaTexturePageDetailAtlasEntry[];
	detailAtlasTextures: readonly AtlasTexturePage[];
	buckets: readonly TexturePageBucketPlan[];
	preparedTextureAssetIds: readonly string[];
}

interface TexturePageBucketPlan {
	bucket: TexturePageBucket;
	atlasEntryRecords: readonly RgbaTexturePageAtlasEntryRecord[];
	atlasTextures: readonly AtlasTexturePage[];
	detailAtlasEntryRecords: readonly RgbaTexturePageDetailAtlasEntry[];
	detailAtlasTextures: readonly AtlasTexturePage[];
}

export function createEmptyTexturePageAtlasPlan(): TexturePageAtlasPlan {
	return {
		key: "texture-page-atlas/empty",
		rgbaAtlasReadyCandidateIds: [],
		detailAtlasReadyCandidateIds: [],
		failures: [],
		atlasEntryRecords: [],
		atlasTextures: [],
		detailAtlasEntryRecords: [],
		detailAtlasTextures: [],
		buckets: [],
		preparedTextureAssetIds: [],
	};
}

export function createTexturePageAtlasPlacementsByEntryKey(
	plan: TexturePageAtlasPlan,
): ReadonlyMap<string, AtlasTexturePlacement> {
	return new Map(
		plan.atlasTextures.flatMap((texture) =>
			texture.placements.map(
				(placement) => [placement.atlasEntryKey, placement] as const,
			),
		),
	);
}

export function createTexturePageDetailAtlasPlacementsByEntryKey(
	plan: TexturePageAtlasPlan,
): ReadonlyMap<string, AtlasTexturePlacement> {
	return new Map(
		plan.detailAtlasTextures.flatMap((texture) =>
			texture.placements.map(
				(placement) => [placement.atlasEntryKey, placement] as const,
			),
		),
	);
}

export function planTexturePageAtlas(options: {
	rgbaCandidates: readonly TexturePageAtlasRgbaCandidate[];
	detailCandidates: readonly TexturePageAtlasDetailCandidate[];
	cohorts?: readonly TexturePageAtlasCohort[];
	policy: CompactionFamilyPlanningPolicy;
}): TexturePageAtlasPlan {
	const failures: TexturePageAtlasFailure[] = [];
	const bucketPlans: TexturePageBucketPlan[] = [];
	const rgbaReady: TexturePageAtlasRgbaCandidate[] = [];
	const detailReady: TexturePageAtlasDetailCandidate[] = [];
	const usedAtlasEntryKeys = new Set<string>();
	const usedDetailEntryKeys = new Set<string>();
	const rgbaCandidatesByBucket = groupRgbaCandidatesByBucket(
		options.rgbaCandidates,
	);
	const detailCandidatesByBucket = groupDetailCandidatesByBucket(
		options.detailCandidates,
	);
	const cohortsByBucket = groupCohortsByBucket(options.cohorts ?? []);
	const buckets = uniqueSortedBuckets([
		...rgbaCandidatesByBucket.keys(),
		...detailCandidatesByBucket.keys(),
		...cohortsByBucket.keys(),
	]);
	for (const bucket of buckets) {
		const rgbaBucketCandidates = rgbaCandidatesByBucket.get(bucket) ?? [];
		const detailBucketCandidates = detailCandidatesByBucket.get(bucket) ?? [];
		const bucketPlan = planTexturePageAtlasBucket({
			bucket,
			rgbaCandidates: rgbaBucketCandidates,
			detailCandidates: detailBucketCandidates,
			cohorts: cohortsByBucket.get(bucket) ?? [],
			policy: options.policy,
			failures,
		});
		bucketPlans.push(bucketPlan.bucketPlan);
		rgbaReady.push(...bucketPlan.rgbaReady);
		detailReady.push(...bucketPlan.detailReady);
		for (const key of bucketPlan.usedAtlasEntryKeys) {
			usedAtlasEntryKeys.add(key);
		}
		for (const key of bucketPlan.usedDetailEntryKeys) {
			usedDetailEntryKeys.add(key);
		}
	}
	return {
		key: describeTexturePageAtlasPlanKey({
			policy: options.policy,
			bucketPlans,
		}),
		rgbaAtlasReadyCandidateIds: rgbaReady.map((candidate) => candidate.candidateId),
		detailAtlasReadyCandidateIds: detailReady.map(
			(candidate) => candidate.candidateId,
		),
		failures,
		atlasEntryRecords: bucketPlans.flatMap((plan) => plan.atlasEntryRecords),
		atlasTextures: bucketPlans.flatMap((plan) => plan.atlasTextures),
		detailAtlasEntryRecords: bucketPlans.flatMap(
			(plan) => plan.detailAtlasEntryRecords,
		),
		detailAtlasTextures: bucketPlans.flatMap(
			(plan) => plan.detailAtlasTextures,
		),
		buckets: bucketPlans.filter(
			(plan) =>
				plan.atlasEntryRecords.length > 0 ||
				plan.detailAtlasEntryRecords.length > 0,
		),
		preparedTextureAssetIds: uniqueSortedStrings(
			rgbaReady.map(
				(candidate) =>
					candidate.texturePageReadiness.atlasEntry.preparedTextureAssetId,
			),
		),
	};
}

function planTexturePageAtlasBucket({
	bucket,
	rgbaCandidates,
	detailCandidates,
	cohorts,
	policy,
	failures,
}: {
	bucket: TexturePageBucket;
	rgbaCandidates: readonly TexturePageAtlasRgbaCandidate[];
	detailCandidates: readonly TexturePageAtlasDetailCandidate[];
	cohorts: readonly TexturePageAtlasCohort[];
	policy: CompactionFamilyPlanningPolicy;
	failures: TexturePageAtlasFailure[];
}): {
	bucketPlan: TexturePageBucketPlan;
	rgbaReady: TexturePageAtlasRgbaCandidate[];
	detailReady: TexturePageAtlasDetailCandidate[];
	usedAtlasEntryKeys: ReadonlySet<string>;
	usedDetailEntryKeys: ReadonlySet<string>;
} {
	const atlasEntries = dedupeRgbaTexturePageEntries(rgbaCandidates);
	const atlasLayoutCohorts = filterTexturePageAtlasCohorts({
		cohorts,
		entryKeys: new Set(atlasEntries.map((record) => record.key)),
	});
	const layout = planAtlasLayout({
		entries: atlasEntries.map((record) => ({
			key: record.key,
			width: record.entry.level.width,
			height: record.entry.level.height,
			gutterPixels: resolveTexturePageBucketGutterPixels(bucket, policy),
		})),
		policy: {
			maxTextureSize: policy.maxAtlasTextureSize,
			maxTextureCount: policy.maxAtlasTextureCount,
			gutterPixels: policy.baseGutterPixels,
		},
		cohorts: atlasLayoutCohorts,
	});
	const basePlaced = rgbaCandidates.filter((candidate) =>
		layout.placementsByEntryKey.has(candidate.texturePageReadiness.atlasEntryKey),
	);
	for (const candidate of rgbaCandidates) {
		const overflow = layout.overflowsByEntryKey.get(
			candidate.texturePageReadiness.atlasEntryKey,
		);
		if (!overflow) {
			continue;
		}
		failures.push({
			candidateId: candidate.candidateId,
			reason:
				overflow.reason === "source-too-large"
					? "source-texture-too-large"
					: "atlas-full",
			detail: overflow.detail,
		});
	}

	const detailEntries = dedupeDetailAtlasEntries([
		...basePlaced,
		...detailCandidates,
	]);
	const detailLayout = planAtlasLayout({
		entries: detailEntries.map((entry) => ({
			key: entry.key,
			width: entry.width,
			height: entry.height,
			gutterPixels: resolveTexturePageBucketGutterPixels(bucket, policy),
		})),
		policy: {
			maxTextureSize: policy.maxAtlasTextureSize,
			maxTextureCount: policy.maxAtlasTextureCount,
			gutterPixels: policy.baseGutterPixels,
		},
	});
	const rgbaReady = basePlaced.filter((candidate) =>
		isDetailAtlasReady(candidate, detailLayout.placementsByEntryKey),
	);
	const detailReady = detailCandidates.filter((candidate) =>
		isDetailAtlasReady(candidate, detailLayout.placementsByEntryKey),
	);
	for (const candidate of [...basePlaced, ...detailCandidates]) {
		const detailEntryKey = candidate.detailAtlasEntry?.key ?? null;
		if (detailEntryKey === null) {
			continue;
		}
		const overflow = detailLayout.overflowsByEntryKey.get(detailEntryKey);
		if (!overflow) {
			continue;
		}
		failures.push({
			candidateId: candidate.candidateId,
			reason: "detail-atlas-full",
			detail: overflow.detail,
		});
	}

	const usedAtlasEntryKeys = new Set(
		rgbaReady.map((candidate) => candidate.texturePageReadiness.atlasEntryKey),
	);
	const usedDetailEntryKeys = new Set(
		[...rgbaReady, ...detailReady]
			.map((candidate) => candidate.detailAtlasEntry?.key ?? "")
			.filter((key) => key.length > 0),
	);
	return {
		bucketPlan: {
			bucket,
			atlasEntryRecords: atlasEntries.filter((record) =>
				usedAtlasEntryKeys.has(record.key),
			),
			atlasTextures: filterAtlasTexturePages({
				pages: layout.texturePages,
				usedEntryKeys: usedAtlasEntryKeys,
			}),
			detailAtlasEntryRecords: detailEntries.filter((entry) =>
				usedDetailEntryKeys.has(entry.key),
			),
			detailAtlasTextures: filterAtlasTexturePages({
				pages: detailLayout.texturePages,
				usedEntryKeys: usedDetailEntryKeys,
			}),
		},
		rgbaReady,
		detailReady,
		usedAtlasEntryKeys,
		usedDetailEntryKeys,
	};
}

function resolveTexturePageBucketGutterPixels(
	bucket: TexturePageBucket,
	policy: CompactionFamilyPlanningPolicy,
): number {
	if (bucket === "terrain-color") {
		return Math.max(policy.baseGutterPixels, TERRAIN_COLOR_ATLAS_GUTTER_PIXELS);
	}
	if (bucket === "terrain-mask") {
		return Math.max(policy.baseGutterPixels, TERRAIN_MASK_ATLAS_GUTTER_PIXELS);
	}
	return policy.baseGutterPixels;
}

function isDetailAtlasReady(
	candidate: TexturePageAtlasDetailCandidate,
	placementsByEntryKey: ReadonlyMap<string, unknown>,
): boolean {
	const detailEntryKey = candidate.detailAtlasEntry?.key ?? null;
	return detailEntryKey === null || placementsByEntryKey.has(detailEntryKey);
}

function dedupeRgbaTexturePageEntries(
	candidates: readonly TexturePageAtlasRgbaCandidate[],
): RgbaTexturePageAtlasEntryRecord[] {
	const entriesByKey = new Map<string, RgbaTexturePageAtlasEntryRecord>();
	for (const candidate of candidates) {
		entriesByKey.set(candidate.texturePageReadiness.atlasEntryKey, {
			key: candidate.texturePageReadiness.atlasEntryKey,
			entry: candidate.texturePageReadiness.atlasEntry,
		});
	}
	return [...entriesByKey.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
}

function dedupeDetailAtlasEntries(
	candidates: readonly TexturePageAtlasDetailCandidate[],
): RgbaTexturePageDetailAtlasEntry[] {
	const entriesByKey = new Map<string, RgbaTexturePageDetailAtlasEntry>();
	for (const candidate of candidates) {
		const detailEntry = candidate.detailAtlasEntry;
		if (detailEntry) {
			entriesByKey.set(detailEntry.key, detailEntry);
		}
	}
	return [...entriesByKey.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
}

function groupRgbaCandidatesByBucket(
	candidates: readonly TexturePageAtlasRgbaCandidate[],
): Map<TexturePageBucket, TexturePageAtlasRgbaCandidate[]> {
	const groups = new Map<TexturePageBucket, TexturePageAtlasRgbaCandidate[]>();
	for (const candidate of candidates) {
		const bucket = candidate.bucket ?? "static-base-color";
		const group = groups.get(bucket) ?? [];
		group.push(candidate);
		groups.set(bucket, group);
	}
	return groups;
}

function groupDetailCandidatesByBucket(
	candidates: readonly TexturePageAtlasDetailCandidate[],
): Map<TexturePageBucket, TexturePageAtlasDetailCandidate[]> {
	const groups = new Map<TexturePageBucket, TexturePageAtlasDetailCandidate[]>();
	for (const candidate of candidates) {
		const bucket = candidate.bucket ?? "static-detail";
		const group = groups.get(bucket) ?? [];
		group.push(candidate);
		groups.set(bucket, group);
	}
	return groups;
}

function groupCohortsByBucket(
	cohorts: readonly TexturePageAtlasCohort[],
): Map<TexturePageBucket, TexturePageAtlasCohort[]> {
	const groups = new Map<TexturePageBucket, TexturePageAtlasCohort[]>();
	for (const cohort of cohorts) {
		const group = groups.get(cohort.bucket) ?? [];
		group.push(cohort);
		groups.set(cohort.bucket, group);
	}
	return groups;
}

function filterTexturePageAtlasCohorts({
	cohorts,
	entryKeys,
}: {
	cohorts: readonly TexturePageAtlasCohort[];
	entryKeys: ReadonlySet<string>;
}): AtlasLayoutCohort[] {
	return cohorts
		.map((cohort) => ({
			key: cohort.key,
			entryKeys: uniqueSortedStrings(
				cohort.atlasEntryKeys.filter((key) => entryKeys.has(key)),
			),
		}))
		.filter((cohort) => cohort.entryKeys.length > 0);
}

function uniqueSortedBuckets(
	buckets: Iterable<TexturePageBucket>,
): TexturePageBucket[] {
	return [...new Set(buckets)].sort();
}

function filterAtlasTexturePages({
	pages,
	usedEntryKeys,
}: {
	pages: readonly AtlasTexturePage[];
	usedEntryKeys: ReadonlySet<string>;
}): AtlasTexturePage[] {
	return pages
		.map((page) => ({
			...page,
			placements: page.placements.filter((placement) =>
				usedEntryKeys.has(placement.atlasEntryKey),
			),
		}))
		.filter((page) => page.placements.length > 0);
}

function describeTexturePageAtlasPlanKey(options: {
	policy: CompactionFamilyPlanningPolicy;
	bucketPlans: readonly TexturePageBucketPlan[];
}): string {
	const signature = [
		"texture-page-atlas",
		`size=${options.policy.maxAtlasTextureSize}`,
		`textures=${options.policy.maxAtlasTextureCount}`,
		`gutter=${options.policy.baseGutterPixels}`,
		...options.bucketPlans.flatMap((plan) => [
			`bucket=${plan.bucket}`,
			...plan.atlasEntryRecords.map((record) => record.key),
			...plan.detailAtlasEntryRecords.map((entry) => `detail=${entry.key}`),
			...plan.atlasTextures.map((page) =>
				describeAtlasTexturePagePlanKey("rgba-page", page),
			),
			...plan.detailAtlasTextures.map((page) =>
				describeAtlasTexturePagePlanKey("detail-page", page),
			),
		]),
	].join("|");
	return `texture-page-atlas/${hashTexturePageAtlasPlanSignature(signature)}`;
}

function describeAtlasTexturePagePlanKey(
	prefix: string,
	page: AtlasTexturePage,
): string {
	return [
		prefix,
		page.textureIndex,
		`${page.width}x${page.height}`,
		...page.placements.map((placement) =>
			[
				placement.atlasEntryKey,
				placement.x,
				placement.y,
				placement.width,
				placement.height,
				placement.gutterPixels,
			].join("@"),
		),
	].join(":");
}

function uniqueSortedStrings(values: readonly string[]): string[] {
	return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function hashTexturePageAtlasPlanSignature(signature: string): string {
	let hash = 0xcbf29ce484222325n;
	const prime = 0x100000001b3n;
	const mask = 0xffffffffffffffffn;
	for (let index = 0; index < signature.length; index += 1) {
		hash ^= BigInt(signature.charCodeAt(index));
		hash = (hash * prime) & mask;
	}
	return hash.toString(16).padStart(16, "0");
}
