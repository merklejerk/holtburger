import {
	planAtlasLayout,
	type AtlasTexturePage,
	type AtlasTexturePlacement,
} from "./atlas-layout-planner";
import type {
	CompactionFamilyPlanningPolicy,
	RgbaTexturePageAtlasEntryRecord,
	RgbaTexturePageDetailAtlasEntry,
} from "../compaction/compaction-family-planner";
import type { RenderMaterialTexturePageReadiness } from "../render-material-strategy";

export type TexturePageFamily =
	| "static-rgba"
	| "static-detail"
	| "terrain-color"
	| "terrain-mask"
	| "terrain-detail";

export const TERRAIN_COLOR_ATLAS_GUTTER_PIXELS = 96;
export const TERRAIN_MASK_ATLAS_GUTTER_PIXELS = 16;

export interface TexturePageAtlasRgbaCandidate {
	drawUnitId: string;
	family?: TexturePageFamily;
	texturePageReadiness: RenderMaterialTexturePageReadiness;
	detailAtlasEntry: RgbaTexturePageDetailAtlasEntry | null;
}

export interface TexturePageAtlasDetailCandidate {
	drawUnitId: string;
	family?: TexturePageFamily;
	detailAtlasEntry: RgbaTexturePageDetailAtlasEntry | null;
}

type TexturePageAtlasFailureReason =
	| "source-texture-too-large"
	| "atlas-full"
	| "detail-atlas-full";

interface TexturePageAtlasFailure {
	drawUnitId: string;
	reason: TexturePageAtlasFailureReason;
	detail: string;
}

export interface TexturePageAtlasPlan {
	key: string;
	rgbaAtlasReadyDrawUnitIds: readonly string[];
	detailAtlasReadyDrawUnitIds: readonly string[];
	failures: readonly TexturePageAtlasFailure[];
	atlasEntryRecords: readonly RgbaTexturePageAtlasEntryRecord[];
	atlasTextures: readonly AtlasTexturePage[];
	detailAtlasEntryRecords: readonly RgbaTexturePageDetailAtlasEntry[];
	detailAtlasTextures: readonly AtlasTexturePage[];
	families: readonly TexturePageFamilyPlan[];
	preparedTextureAssetIds: readonly string[];
}

interface TexturePageFamilyPlan {
	family: TexturePageFamily;
	atlasEntryRecords: readonly RgbaTexturePageAtlasEntryRecord[];
	atlasTextures: readonly AtlasTexturePage[];
	detailAtlasEntryRecords: readonly RgbaTexturePageDetailAtlasEntry[];
	detailAtlasTextures: readonly AtlasTexturePage[];
}

export function createEmptyTexturePageAtlasPlan(): TexturePageAtlasPlan {
	return {
		key: "texture-page-atlas/empty",
		rgbaAtlasReadyDrawUnitIds: [],
		detailAtlasReadyDrawUnitIds: [],
		failures: [],
		atlasEntryRecords: [],
		atlasTextures: [],
		detailAtlasEntryRecords: [],
		detailAtlasTextures: [],
		families: [],
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
	policy: CompactionFamilyPlanningPolicy;
}): TexturePageAtlasPlan {
	const failures: TexturePageAtlasFailure[] = [];
	const familyPlans: TexturePageFamilyPlan[] = [];
	const rgbaReady: TexturePageAtlasRgbaCandidate[] = [];
	const detailReady: TexturePageAtlasDetailCandidate[] = [];
	const usedAtlasEntryKeys = new Set<string>();
	const usedDetailEntryKeys = new Set<string>();
	const rgbaCandidatesByFamily = groupRgbaCandidatesByFamily(
		options.rgbaCandidates,
	);
	const detailCandidatesByFamily = groupDetailCandidatesByFamily(
		options.detailCandidates,
	);
	const families = uniqueSortedFamilies([
		...rgbaCandidatesByFamily.keys(),
		...detailCandidatesByFamily.keys(),
	]);
	for (const family of families) {
		const rgbaFamilyCandidates = rgbaCandidatesByFamily.get(family) ?? [];
		const detailFamilyCandidates = detailCandidatesByFamily.get(family) ?? [];
		const familyPlan = planTexturePageAtlasFamily({
			family,
			rgbaCandidates: rgbaFamilyCandidates,
			detailCandidates: detailFamilyCandidates,
			policy: options.policy,
			failures,
		});
		familyPlans.push(familyPlan.familyPlan);
		rgbaReady.push(...familyPlan.rgbaReady);
		detailReady.push(...familyPlan.detailReady);
		for (const key of familyPlan.usedAtlasEntryKeys) {
			usedAtlasEntryKeys.add(key);
		}
		for (const key of familyPlan.usedDetailEntryKeys) {
			usedDetailEntryKeys.add(key);
		}
	}
	return {
		key: describeTexturePageAtlasPlanKey({
			policy: options.policy,
			familyPlans,
		}),
		rgbaAtlasReadyDrawUnitIds: rgbaReady.map((candidate) => candidate.drawUnitId),
		detailAtlasReadyDrawUnitIds: detailReady.map(
			(candidate) => candidate.drawUnitId,
		),
		failures,
		atlasEntryRecords: familyPlans.flatMap((plan) => plan.atlasEntryRecords),
		atlasTextures: familyPlans.flatMap((plan) => plan.atlasTextures),
		detailAtlasEntryRecords: familyPlans.flatMap(
			(plan) => plan.detailAtlasEntryRecords,
		),
		detailAtlasTextures: familyPlans.flatMap(
			(plan) => plan.detailAtlasTextures,
		),
		families: familyPlans.filter(
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

function planTexturePageAtlasFamily({
	family,
	rgbaCandidates,
	detailCandidates,
	policy,
	failures,
}: {
	family: TexturePageFamily;
	rgbaCandidates: readonly TexturePageAtlasRgbaCandidate[];
	detailCandidates: readonly TexturePageAtlasDetailCandidate[];
	policy: CompactionFamilyPlanningPolicy;
	failures: TexturePageAtlasFailure[];
}): {
	familyPlan: TexturePageFamilyPlan;
	rgbaReady: TexturePageAtlasRgbaCandidate[];
	detailReady: TexturePageAtlasDetailCandidate[];
	usedAtlasEntryKeys: ReadonlySet<string>;
	usedDetailEntryKeys: ReadonlySet<string>;
} {
	const atlasEntries = dedupeRgbaTexturePageEntries(rgbaCandidates);
	const layout = planAtlasLayout({
		entries: atlasEntries.map((record) => ({
			key: record.key,
			width: record.entry.level.width,
			height: record.entry.level.height,
			gutterPixels: resolveTexturePageFamilyGutterPixels(family, policy),
		})),
		policy: {
			maxTextureSize: policy.maxAtlasTextureSize,
			maxTextureCount: policy.maxAtlasTextureCount,
			gutterPixels: policy.baseGutterPixels,
		},
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
			drawUnitId: candidate.drawUnitId,
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
			gutterPixels: resolveTexturePageFamilyGutterPixels(family, policy),
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
			drawUnitId: candidate.drawUnitId,
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
		familyPlan: {
			family,
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

function resolveTexturePageFamilyGutterPixels(
	family: TexturePageFamily,
	policy: CompactionFamilyPlanningPolicy,
): number {
	if (family === "terrain-color") {
		return Math.max(policy.baseGutterPixels, TERRAIN_COLOR_ATLAS_GUTTER_PIXELS);
	}
	if (family === "terrain-mask") {
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

function groupRgbaCandidatesByFamily(
	candidates: readonly TexturePageAtlasRgbaCandidate[],
): Map<TexturePageFamily, TexturePageAtlasRgbaCandidate[]> {
	const groups = new Map<TexturePageFamily, TexturePageAtlasRgbaCandidate[]>();
	for (const candidate of candidates) {
		const family = candidate.family ?? "static-rgba";
		const group = groups.get(family) ?? [];
		group.push(candidate);
		groups.set(family, group);
	}
	return groups;
}

function groupDetailCandidatesByFamily(
	candidates: readonly TexturePageAtlasDetailCandidate[],
): Map<TexturePageFamily, TexturePageAtlasDetailCandidate[]> {
	const groups = new Map<TexturePageFamily, TexturePageAtlasDetailCandidate[]>();
	for (const candidate of candidates) {
		const family = candidate.family ?? "static-detail";
		const group = groups.get(family) ?? [];
		group.push(candidate);
		groups.set(family, group);
	}
	return groups;
}

function uniqueSortedFamilies(
	families: Iterable<TexturePageFamily>,
): TexturePageFamily[] {
	return [...new Set(families)].sort();
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
	familyPlans: readonly TexturePageFamilyPlan[];
}): string {
	return [
		"texture-page-atlas",
		`size=${options.policy.maxAtlasTextureSize}`,
		`textures=${options.policy.maxAtlasTextureCount}`,
		`gutter=${options.policy.baseGutterPixels}`,
		...options.familyPlans.flatMap((plan) => [
			`family=${plan.family}`,
			...plan.atlasEntryRecords.map((record) => record.key),
			...plan.detailAtlasEntryRecords.map((entry) => `detail=${entry.key}`),
		]),
	].join("|");
}

function uniqueSortedStrings(values: readonly string[]): string[] {
	return [...new Set(values.filter((value) => value.length > 0))].sort();
}
