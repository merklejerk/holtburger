export interface AtlasLayoutPolicy {
	maxTextureSize: number;
	maxTextureCount: number;
	gutterPixels: number;
	pageSelection?: AtlasLayoutPageSelection;
}

export type AtlasLayoutPageSelection = "minimize-memory" | "minimize-textures";

export interface AtlasLayoutEntry {
	key: string;
	width: number;
	height: number;
	gutterPixels?: number;
}

export interface AtlasTexturePlacement {
	atlasEntryKey: string;
	textureIndex: number;
	x: number;
	y: number;
	width: number;
	height: number;
	gutterPixels: number;
}

export interface AtlasTexturePage {
	textureIndex: number;
	width: number;
	height: number;
	placements: AtlasTexturePlacement[];
}

type AtlasLayoutOverflowReason = "source-too-large" | "atlas-full";

interface AtlasLayoutOverflow {
	atlasEntryKey: string;
	reason: AtlasLayoutOverflowReason;
	detail: string;
}

export interface AtlasLayoutPlan {
	entries: readonly AtlasLayoutEntry[];
	texturePages: readonly AtlasTexturePage[];
	placementsByEntryKey: ReadonlyMap<string, AtlasTexturePlacement>;
	overflows: readonly AtlasLayoutOverflow[];
	overflowsByEntryKey: ReadonlyMap<string, AtlasLayoutOverflow>;
}

interface PaddedAtlasLayoutEntry {
	readonly entry: AtlasLayoutEntry;
	readonly gutterPixels: number;
	readonly paddedWidth: number;
	readonly paddedHeight: number;
	readonly paddedArea: number;
}

interface AtlasPageSizeCandidate {
	readonly width: number;
	readonly height: number;
}

interface AtlasFreeRect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

type AtlasPlacedRect = AtlasFreeRect;

interface AtlasPagePackState {
	readonly textureIndex: number;
	readonly width: number;
	readonly height: number;
	readonly placements: AtlasTexturePlacement[];
	freeRects: AtlasFreeRect[];
}

interface AtlasPlacementCandidate {
	readonly page: AtlasPagePackState;
	readonly paddedX: number;
	readonly paddedY: number;
	readonly shortSideLeftover: number;
	readonly longSideLeftover: number;
}

interface AtlasPackAttempt {
	readonly pageSize: AtlasPageSizeCandidate;
	readonly texturePages: AtlasTexturePage[];
	readonly placementsByEntryKey: ReadonlyMap<string, AtlasTexturePlacement>;
	readonly atlasFullOverflows: readonly AtlasLayoutOverflow[];
}

/**
 * Plans an offline, deterministic atlas layout for a complete entry set.
 *
 * `policy.maxTextureSize` is a capacity cap. The planner may select smaller
 * page dimensions when the entries fit a lower power-of-two tier. The default
 * page selection objective minimizes allocated pixels; render paths with strict
 * texture-count contracts can request `minimize-textures`.
 */
export function planAtlasLayout(options: {
	entries: readonly AtlasLayoutEntry[];
	policy: AtlasLayoutPolicy;
}): AtlasLayoutPlan {
	const policy = normalizeAtlasLayoutPolicy(options.policy);
	const entries = dedupeAndSortAtlasLayoutEntries(options.entries, policy);
	const packableEntries: PaddedAtlasLayoutEntry[] = [];
	const sourceTooLargeOverflows: AtlasLayoutOverflow[] = [];

	for (const paddedEntry of createPaddedAtlasLayoutEntries(entries, policy)) {
		if (
			paddedEntry.paddedWidth > policy.maxTextureSize ||
			paddedEntry.paddedHeight > policy.maxTextureSize
		) {
			sourceTooLargeOverflows.push({
				atlasEntryKey: paddedEntry.entry.key,
				reason: "source-too-large",
				detail: `atlas entry ${paddedEntry.entry.key} is ${paddedEntry.entry.width}x${paddedEntry.entry.height} with ${paddedEntry.gutterPixels}px gutter, exceeding ${policy.maxTextureSize}px atlas capacity`,
			});
			continue;
		}
		packableEntries.push(paddedEntry);
	}

	const selectedAttempt = selectAtlasPackAttempt({
		entries: packableEntries,
		policy,
	});
	const overflows = [
		...sourceTooLargeOverflows,
		...(selectedAttempt?.atlasFullOverflows ?? []),
	].sort((left, right) => left.atlasEntryKey.localeCompare(right.atlasEntryKey));
	const overflowsByEntryKey = new Map(
		overflows.map((overflow) => [overflow.atlasEntryKey, overflow] as const),
	);
	return {
		entries,
		texturePages: selectedAttempt?.texturePages ?? [],
		placementsByEntryKey: selectedAttempt?.placementsByEntryKey ?? new Map(),
		overflows,
		overflowsByEntryKey,
	};
}

function createPaddedAtlasLayoutEntries(
	entries: readonly AtlasLayoutEntry[],
	policy: AtlasLayoutPolicy,
): PaddedAtlasLayoutEntry[] {
	return entries.map((entry) => {
		const gutterPixels = resolveEntryGutterPixels(entry, policy);
		const paddedWidth = entry.width + gutterPixels * 2;
		const paddedHeight = entry.height + gutterPixels * 2;
		return {
			entry,
			gutterPixels,
			paddedWidth,
			paddedHeight,
			paddedArea: paddedWidth * paddedHeight,
		};
	});
}

function selectAtlasPackAttempt(options: {
	entries: readonly PaddedAtlasLayoutEntry[];
	policy: AtlasLayoutPolicy;
}): AtlasPackAttempt | null {
	if (options.entries.length === 0) {
		return null;
	}

	const packingEntries = [...options.entries].sort(comparePaddedEntriesForPacking);
	const candidates = createAtlasPageSizeCandidates(options.entries, options.policy);
	let selected: AtlasPackAttempt | null = null;
	for (const candidate of candidates) {
		const attempt = packEntriesInPageSize({
			entries: packingEntries,
			policy: options.policy,
			pageSize: candidate,
		});
		if (
			selected === null ||
			comparePackAttempts(attempt, selected, options.policy.pageSelection) < 0
		) {
			selected = attempt;
		}
	}
	return selected;
}

function createAtlasPageSizeCandidates(
	entries: readonly PaddedAtlasLayoutEntry[],
	policy: AtlasLayoutPolicy,
): AtlasPageSizeCandidate[] {
	const minWidth = Math.max(...entries.map((entry) => entry.paddedWidth));
	const minHeight = Math.max(...entries.map((entry) => entry.paddedHeight));
	const widthTiers = createTextureSizeTiers(minWidth, policy.maxTextureSize);
	const heightTiers = createTextureSizeTiers(minHeight, policy.maxTextureSize);
	const candidates: AtlasPageSizeCandidate[] = [];
	for (const width of widthTiers) {
		for (const height of heightTiers) {
			candidates.push({ width, height });
		}
	}
	return candidates.sort(comparePageSizeCandidates);
}

function createTextureSizeTiers(minSize: number, maxSize: number): number[] {
	const tiers: number[] = [];
	let size = 1;
	while (size < minSize && size < maxSize) {
		size *= 2;
	}
	while (size <= maxSize) {
		tiers.push(size);
		size *= 2;
	}
	if (!tiers.includes(maxSize)) {
		tiers.push(maxSize);
	}
	return tiers;
}

function packEntriesInPageSize(options: {
	entries: readonly PaddedAtlasLayoutEntry[];
	policy: AtlasLayoutPolicy;
	pageSize: AtlasPageSizeCandidate;
}): AtlasPackAttempt {
	const pageStates: AtlasPagePackState[] = [];
	const placementsByEntryKey = new Map<string, AtlasTexturePlacement>();
	const atlasFullOverflows: AtlasLayoutOverflow[] = [];
	for (const entry of options.entries) {
		const candidate = findBestPlacementCandidate(entry, pageStates);
		if (candidate !== null) {
			placeEntry(entry, candidate, placementsByEntryKey);
			continue;
		}
		if (pageStates.length >= options.policy.maxTextureCount) {
			atlasFullOverflows.push({
				atlasEntryKey: entry.entry.key,
				reason: "atlas-full",
				detail: `atlas entry ${entry.entry.key} did not fit in ${options.policy.maxTextureCount} atlas textures`,
			});
			continue;
		}
		const page = createAtlasPagePackState(pageStates.length, options.pageSize);
		pageStates.push(page);
		const newPageCandidate = findBestPlacementCandidate(entry, [page]);
		if (newPageCandidate === null) {
			throw new Error(
				`Atlas layout candidate ${options.pageSize.width}x${options.pageSize.height} cannot fit entry ${entry.entry.key} despite size filtering.`,
			);
		}
		placeEntry(entry, newPageCandidate, placementsByEntryKey);
	}
	return {
		pageSize: options.pageSize,
		texturePages: pageStates.map((page) => ({
			textureIndex: page.textureIndex,
			width: page.width,
			height: page.height,
			placements: page.placements,
		})),
		placementsByEntryKey,
		atlasFullOverflows,
	};
}

function createAtlasPagePackState(
	textureIndex: number,
	pageSize: AtlasPageSizeCandidate,
): AtlasPagePackState {
	return {
		textureIndex,
		width: pageSize.width,
		height: pageSize.height,
		placements: [],
		freeRects: [{ x: 0, y: 0, width: pageSize.width, height: pageSize.height }],
	};
}

function findBestPlacementCandidate(
	entry: PaddedAtlasLayoutEntry,
	pages: readonly AtlasPagePackState[],
): AtlasPlacementCandidate | null {
	let bestCandidate: AtlasPlacementCandidate | null = null;
	for (const page of pages) {
		for (const freeRect of page.freeRects) {
			if (
				entry.paddedWidth > freeRect.width ||
				entry.paddedHeight > freeRect.height
			) {
				continue;
			}
			const widthLeftover = freeRect.width - entry.paddedWidth;
			const heightLeftover = freeRect.height - entry.paddedHeight;
			const candidate: AtlasPlacementCandidate = {
				page,
				paddedX: freeRect.x,
				paddedY: freeRect.y,
				shortSideLeftover: Math.min(widthLeftover, heightLeftover),
				longSideLeftover: Math.max(widthLeftover, heightLeftover),
			};
			if (
				bestCandidate === null ||
				comparePlacementCandidates(candidate, bestCandidate) < 0
			) {
				bestCandidate = candidate;
			}
		}
	}
	return bestCandidate;
}

function placeEntry(
	entry: PaddedAtlasLayoutEntry,
	candidate: AtlasPlacementCandidate,
	placementsByEntryKey: Map<string, AtlasTexturePlacement>,
): void {
	const paddedRect: AtlasPlacedRect = {
		x: candidate.paddedX,
		y: candidate.paddedY,
		width: entry.paddedWidth,
		height: entry.paddedHeight,
	};
	const placement: AtlasTexturePlacement = {
		atlasEntryKey: entry.entry.key,
		textureIndex: candidate.page.textureIndex,
		x: paddedRect.x + entry.gutterPixels,
		y: paddedRect.y + entry.gutterPixels,
		width: entry.entry.width,
		height: entry.entry.height,
		gutterPixels: entry.gutterPixels,
	};
	candidate.page.placements.push(placement);
	placementsByEntryKey.set(entry.entry.key, placement);
	candidate.page.freeRects = pruneContainedFreeRects(
		splitFreeRects(candidate.page.freeRects, paddedRect),
	);
}

function splitFreeRects(
	freeRects: readonly AtlasFreeRect[],
	placedRect: AtlasPlacedRect,
): AtlasFreeRect[] {
	const nextFreeRects: AtlasFreeRect[] = [];
	for (const freeRect of freeRects) {
		if (!rectsIntersect(freeRect, placedRect)) {
			nextFreeRects.push(freeRect);
			continue;
		}
		const topHeight = placedRect.y - freeRect.y;
		const bottomY = placedRect.y + placedRect.height;
		const bottomHeight = freeRect.y + freeRect.height - bottomY;
		const leftWidth = placedRect.x - freeRect.x;
		const rightX = placedRect.x + placedRect.width;
		const rightWidth = freeRect.x + freeRect.width - rightX;
		if (topHeight > 0) {
			nextFreeRects.push({
				x: freeRect.x,
				y: freeRect.y,
				width: freeRect.width,
				height: topHeight,
			});
		}
		if (bottomHeight > 0) {
			nextFreeRects.push({
				x: freeRect.x,
				y: bottomY,
				width: freeRect.width,
				height: bottomHeight,
			});
		}
		if (leftWidth > 0) {
			nextFreeRects.push({
				x: freeRect.x,
				y: freeRect.y,
				width: leftWidth,
				height: freeRect.height,
			});
		}
		if (rightWidth > 0) {
			nextFreeRects.push({
				x: rightX,
				y: freeRect.y,
				width: rightWidth,
				height: freeRect.height,
			});
		}
	}
	return nextFreeRects.sort(compareFreeRects);
}

function pruneContainedFreeRects(
	freeRects: readonly AtlasFreeRect[],
): AtlasFreeRect[] {
	const pruned: AtlasFreeRect[] = [];
	for (let index = 0; index < freeRects.length; index += 1) {
		const candidate = freeRects[index];
		if (
			candidate === undefined ||
			freeRects.some(
				(other, otherIndex) =>
					otherIndex !== index && rectContains(other, candidate),
			)
		) {
			continue;
		}
		if (!pruned.some((other) => rectContains(other, candidate))) {
			pruned.push(candidate);
		}
	}
	return pruned.sort(compareFreeRects);
}

function rectsIntersect(left: AtlasFreeRect, right: AtlasFreeRect): boolean {
	return (
		left.x < right.x + right.width &&
		left.x + left.width > right.x &&
		left.y < right.y + right.height &&
		left.y + left.height > right.y
	);
}

function rectContains(outer: AtlasFreeRect, inner: AtlasFreeRect): boolean {
	return (
		outer.x <= inner.x &&
		outer.y <= inner.y &&
		outer.x + outer.width >= inner.x + inner.width &&
		outer.y + outer.height >= inner.y + inner.height
	);
}

function normalizeAtlasLayoutPolicy(
	policy: AtlasLayoutPolicy,
): AtlasLayoutPolicy {
	if (!Number.isInteger(policy.maxTextureSize) || policy.maxTextureSize <= 0) {
		throw new Error("Atlas layout texture size must be a positive integer.");
	}
	if (
		!Number.isInteger(policy.maxTextureCount) ||
		policy.maxTextureCount <= 0
	) {
		throw new Error("Atlas layout texture count must be a positive integer.");
	}
	if (!Number.isInteger(policy.gutterPixels) || policy.gutterPixels < 0) {
		throw new Error("Atlas layout gutter must be a non-negative integer.");
	}
	if (
		policy.pageSelection !== undefined &&
		policy.pageSelection !== "minimize-memory" &&
		policy.pageSelection !== "minimize-textures"
	) {
		throw new Error(
			"Atlas layout page selection must be minimize-memory or minimize-textures.",
		);
	}
	return {
		...policy,
		pageSelection: policy.pageSelection ?? "minimize-memory",
	};
}

function dedupeAndSortAtlasLayoutEntries(
	entries: readonly AtlasLayoutEntry[],
	policy: AtlasLayoutPolicy,
): AtlasLayoutEntry[] {
	const entriesByKey = new Map<string, AtlasLayoutEntry>();
	for (const entry of entries) {
		validateAtlasLayoutEntry(entry);
		const previous = entriesByKey.get(entry.key);
		if (previous) {
			const previousGutter = resolveEntryGutterPixels(previous, policy);
			const entryGutter = resolveEntryGutterPixels(entry, policy);
			if (
				previous.width !== entry.width ||
				previous.height !== entry.height ||
				previousGutter !== entryGutter
			) {
				throw new Error(
					`Atlas layout entry ${entry.key} has conflicting dimensions or gutter.`,
				);
			}
			continue;
		}
		entriesByKey.set(entry.key, entry);
	}
	return [...entriesByKey.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
}

function validateAtlasLayoutEntry(entry: AtlasLayoutEntry): void {
	if (entry.key.length === 0) {
		throw new Error("Atlas layout entry key must be non-empty.");
	}
	if (!Number.isInteger(entry.width) || entry.width <= 0) {
		throw new Error(`Atlas layout entry ${entry.key} width must be positive.`);
	}
	if (!Number.isInteger(entry.height) || entry.height <= 0) {
		throw new Error(`Atlas layout entry ${entry.key} height must be positive.`);
	}
	if (
		entry.gutterPixels !== undefined &&
		(!Number.isInteger(entry.gutterPixels) || entry.gutterPixels < 0)
	) {
		throw new Error(
			`Atlas layout entry ${entry.key} gutter must be non-negative.`,
		);
	}
}

function resolveEntryGutterPixels(
	entry: AtlasLayoutEntry,
	policy: AtlasLayoutPolicy,
): number {
	return entry.gutterPixels ?? policy.gutterPixels;
}

function comparePaddedEntriesForPacking(
	left: PaddedAtlasLayoutEntry,
	right: PaddedAtlasLayoutEntry,
): number {
	return (
		right.paddedArea - left.paddedArea ||
		Math.max(right.paddedWidth, right.paddedHeight) -
			Math.max(left.paddedWidth, left.paddedHeight) ||
		Math.min(right.paddedWidth, right.paddedHeight) -
			Math.min(left.paddedWidth, left.paddedHeight) ||
		left.entry.key.localeCompare(right.entry.key)
	);
}

function comparePlacementCandidates(
	left: AtlasPlacementCandidate,
	right: AtlasPlacementCandidate,
): number {
	return (
		left.shortSideLeftover - right.shortSideLeftover ||
		left.longSideLeftover - right.longSideLeftover ||
		left.paddedY - right.paddedY ||
		left.paddedX - right.paddedX ||
		left.page.textureIndex - right.page.textureIndex
	);
}

function comparePackAttempts(
	left: AtlasPackAttempt,
	right: AtlasPackAttempt,
	pageSelection: AtlasLayoutPageSelection = "minimize-memory",
): number {
	const leftOverflowCount = left.atlasFullOverflows.length;
	const rightOverflowCount = right.atlasFullOverflows.length;
	if (leftOverflowCount === 0 && rightOverflowCount !== 0) {
		return -1;
	}
	if (leftOverflowCount !== 0 && rightOverflowCount === 0) {
		return 1;
	}
	const overflowDelta = leftOverflowCount - rightOverflowCount;
	if (overflowDelta !== 0) {
		return overflowDelta;
	}
	if (pageSelection === "minimize-textures") {
		return (
			left.texturePages.length - right.texturePages.length ||
			totalAllocatedPixels(left) - totalAllocatedPixels(right) ||
			comparePageSizeCandidates(left.pageSize, right.pageSize)
		);
	}
	return (
		totalAllocatedPixels(left) - totalAllocatedPixels(right) ||
		left.texturePages.length - right.texturePages.length ||
		comparePageSizeCandidates(left.pageSize, right.pageSize)
	);
}

function totalAllocatedPixels(attempt: AtlasPackAttempt): number {
	return (
		attempt.pageSize.width *
		attempt.pageSize.height *
		attempt.texturePages.length
	);
}

function comparePageSizeCandidates(
	left: AtlasPageSizeCandidate,
	right: AtlasPageSizeCandidate,
): number {
	return (
		left.width * left.height - right.width * right.height ||
		Math.max(left.width, left.height) - Math.max(right.width, right.height) ||
		left.height - right.height ||
		left.width - right.width
	);
}

function compareFreeRects(left: AtlasFreeRect, right: AtlasFreeRect): number {
	return (
		left.y - right.y ||
		left.x - right.x ||
		left.height - right.height ||
		left.width - right.width
	);
}
