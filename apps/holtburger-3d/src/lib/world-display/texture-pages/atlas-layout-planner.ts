export interface AtlasLayoutPolicy {
	maxTextureSize: number;
	maxTextureCount: number;
	gutterPixels: number;
	pageSelection?: AtlasLayoutPageSelection;
}

type AtlasLayoutPageSelection = "minimize-memory" | "minimize-textures";

export interface AtlasLayoutEntry {
	key: string;
	width: number;
	height: number;
	gutterPixels?: number;
}

export interface AtlasLayoutCohort {
	key: string;
	entryKeys: readonly string[];
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

interface AtlasPackingUnit {
	readonly key: string;
	readonly entries: readonly PaddedAtlasLayoutEntry[];
	readonly paddedArea: number;
	readonly maxPaddedSide: number;
	readonly minPaddedSide: number;
}

interface AtlasUnitPagePlacement {
	readonly page: AtlasPagePackState;
	readonly placements: readonly AtlasTexturePlacement[];
	readonly freeRects: readonly AtlasFreeRect[];
	readonly remainingFreeArea: number;
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
	cohorts?: readonly AtlasLayoutCohort[];
}): AtlasLayoutPlan {
	const policy = normalizeAtlasLayoutPolicy(options.policy);
	const entries = dedupeAndSortAtlasLayoutEntries(options.entries, policy);
	const cohorts = normalizeAtlasLayoutCohorts(options.cohorts ?? [], entries);
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
		cohorts,
		policy,
	});
	const overflows = [
		...sourceTooLargeOverflows,
		...(selectedAttempt?.atlasFullOverflows ?? []),
	].sort((left, right) =>
		left.atlasEntryKey.localeCompare(right.atlasEntryKey),
	);
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
	cohorts: readonly AtlasLayoutCohort[];
	policy: AtlasLayoutPolicy;
}): AtlasPackAttempt | null {
	if (options.entries.length === 0) {
		return null;
	}

	const packingUnits = createAtlasPackingUnits({
		entries: options.entries,
		cohorts: options.cohorts,
	});
	const candidates = createAtlasPageSizeCandidates(
		options.entries,
		options.policy,
	);
	let selected: AtlasPackAttempt | null = null;
	for (const candidate of candidates) {
		const attempt = packEntriesInPageSize({
			units: packingUnits,
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

function createAtlasPackingUnits({
	entries,
	cohorts,
}: {
	entries: readonly PaddedAtlasLayoutEntry[];
	cohorts: readonly AtlasLayoutCohort[];
}): AtlasPackingUnit[] {
	const entriesByKey = new Map(
		entries.map((entry) => [entry.entry.key, entry] as const),
	);
	const constrainedEntryKeys = new Set<string>();
	const units: AtlasPackingUnit[] = [];
	for (const component of createAtlasCohortComponents(cohorts)) {
		const componentEntries = component.entryKeys
			.map((key) => entriesByKey.get(key) ?? null)
			.filter((entry): entry is PaddedAtlasLayoutEntry => entry !== null)
			.sort(comparePaddedEntriesForPacking);
		if (componentEntries.length === 0) {
			continue;
		}
		for (const entry of componentEntries) {
			constrainedEntryKeys.add(entry.entry.key);
		}
		units.push(createAtlasPackingUnit(component.key, componentEntries));
	}
	for (const entry of entries) {
		if (!constrainedEntryKeys.has(entry.entry.key)) {
			units.push(createAtlasPackingUnit(entry.entry.key, [entry]));
		}
	}
	return units.sort(compareAtlasPackingUnits);
}

function createAtlasCohortComponents(
	cohorts: readonly AtlasLayoutCohort[],
): Array<{ key: string; entryKeys: readonly string[] }> {
	const parentByEntryKey = new Map<string, string>();
	for (const cohort of cohorts) {
		for (const entryKey of cohort.entryKeys) {
			parentByEntryKey.set(
				entryKey,
				parentByEntryKey.get(entryKey) ?? entryKey,
			);
		}
		const [firstEntryKey] = cohort.entryKeys;
		if (!firstEntryKey) {
			continue;
		}
		for (const entryKey of cohort.entryKeys.slice(1)) {
			unionAtlasCohortEntries(parentByEntryKey, firstEntryKey, entryKey);
		}
	}
	const componentKeysByRoot = new Map<string, string[]>();
	for (const entryKey of [...parentByEntryKey.keys()].sort()) {
		const root = findAtlasCohortRoot(parentByEntryKey, entryKey);
		const componentKeys = componentKeysByRoot.get(root) ?? [];
		componentKeys.push(entryKey);
		componentKeysByRoot.set(root, componentKeys);
	}
	return [...componentKeysByRoot.values()]
		.map((entryKeys) => ({
			key: `cohort:${entryKeys.join("+")}`,
			entryKeys,
		}))
		.sort((left, right) => left.key.localeCompare(right.key));
}

function unionAtlasCohortEntries(
	parentByEntryKey: Map<string, string>,
	left: string,
	right: string,
): void {
	const leftRoot = findAtlasCohortRoot(parentByEntryKey, left);
	const rightRoot = findAtlasCohortRoot(parentByEntryKey, right);
	if (leftRoot === rightRoot) {
		return;
	}
	if (leftRoot.localeCompare(rightRoot) <= 0) {
		parentByEntryKey.set(rightRoot, leftRoot);
	} else {
		parentByEntryKey.set(leftRoot, rightRoot);
	}
}

function findAtlasCohortRoot(
	parentByEntryKey: Map<string, string>,
	entryKey: string,
): string {
	const parent = parentByEntryKey.get(entryKey);
	if (parent === undefined) {
		throw new Error(`Atlas cohort entry ${entryKey} is missing a parent.`);
	}
	if (parent === entryKey) {
		return entryKey;
	}
	const root = findAtlasCohortRoot(parentByEntryKey, parent);
	parentByEntryKey.set(entryKey, root);
	return root;
}

function createAtlasPackingUnit(
	key: string,
	entries: readonly PaddedAtlasLayoutEntry[],
): AtlasPackingUnit {
	const paddedArea = entries.reduce(
		(total, entry) => total + entry.paddedArea,
		0,
	);
	const maxPaddedSide = Math.max(
		...entries.map((entry) => Math.max(entry.paddedWidth, entry.paddedHeight)),
	);
	const minPaddedSide = Math.max(
		...entries.map((entry) => Math.min(entry.paddedWidth, entry.paddedHeight)),
	);
	return { key, entries, paddedArea, maxPaddedSide, minPaddedSide };
}

function packEntriesInPageSize(options: {
	units: readonly AtlasPackingUnit[];
	policy: AtlasLayoutPolicy;
	pageSize: AtlasPageSizeCandidate;
}): AtlasPackAttempt {
	const pageStates: AtlasPagePackState[] = [];
	const placementsByEntryKey = new Map<string, AtlasTexturePlacement>();
	const atlasFullOverflows: AtlasLayoutOverflow[] = [];
	for (const unit of options.units) {
		const existingPagePlacement = findBestUnitPagePlacement(unit, pageStates);
		if (existingPagePlacement !== null) {
			commitUnitPagePlacement({
				pageStates,
				placement: existingPagePlacement,
				placementsByEntryKey,
			});
			continue;
		}
		if (pageStates.length >= options.policy.maxTextureCount) {
			atlasFullOverflows.push(
				...createAtlasFullOverflows(unit, options.policy),
			);
			continue;
		}
		const page = createAtlasPagePackState(pageStates.length, options.pageSize);
		const newPagePlacement = tryPlaceUnitOnPage(unit, page);
		if (newPagePlacement === null) {
			atlasFullOverflows.push(
				...createAtlasFullOverflows(unit, options.policy),
			);
			continue;
		}
		pageStates.push(page);
		commitUnitPagePlacement({
			pageStates,
			placement: newPagePlacement,
			placementsByEntryKey,
		});
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

function findBestUnitPagePlacement(
	unit: AtlasPackingUnit,
	pages: readonly AtlasPagePackState[],
): AtlasUnitPagePlacement | null {
	let bestPlacement: AtlasUnitPagePlacement | null = null;
	for (const page of pages) {
		const placement = tryPlaceUnitOnPage(unit, page);
		if (
			placement !== null &&
			(bestPlacement === null ||
				compareUnitPagePlacements(placement, bestPlacement) < 0)
		) {
			bestPlacement = placement;
		}
	}
	return bestPlacement;
}

function tryPlaceUnitOnPage(
	unit: AtlasPackingUnit,
	page: AtlasPagePackState,
): AtlasUnitPagePlacement | null {
	const pageClone: AtlasPagePackState = {
		textureIndex: page.textureIndex,
		width: page.width,
		height: page.height,
		placements: [...page.placements],
		freeRects: [...page.freeRects],
	};
	const unitPlacementsByEntryKey = new Map<string, AtlasTexturePlacement>();
	for (const entry of unit.entries) {
		const candidate = findBestPlacementCandidate(entry, [pageClone]);
		if (candidate === null) {
			return null;
		}
		placeEntry(entry, candidate, unitPlacementsByEntryKey);
	}
	return {
		page,
		placements: [...unitPlacementsByEntryKey.values()].sort((left, right) =>
			left.atlasEntryKey.localeCompare(right.atlasEntryKey),
		),
		freeRects: pageClone.freeRects,
		remainingFreeArea: pageClone.freeRects.reduce(
			(total, rect) => total + rect.width * rect.height,
			0,
		),
	};
}

function commitUnitPagePlacement({
	pageStates,
	placement,
	placementsByEntryKey,
}: {
	pageStates: readonly AtlasPagePackState[];
	placement: AtlasUnitPagePlacement;
	placementsByEntryKey: Map<string, AtlasTexturePlacement>;
}): void {
	const page = pageStates[placement.page.textureIndex];
	if (!page) {
		throw new Error(
			`Atlas unit placement references missing page ${placement.page.textureIndex}.`,
		);
	}
	page.placements.push(...placement.placements);
	page.freeRects = [...placement.freeRects];
	for (const entryPlacement of placement.placements) {
		placementsByEntryKey.set(entryPlacement.atlasEntryKey, entryPlacement);
	}
}

function createAtlasFullOverflows(
	unit: AtlasPackingUnit,
	policy: AtlasLayoutPolicy,
): AtlasLayoutOverflow[] {
	return unit.entries
		.map((entry) => ({
			atlasEntryKey: entry.entry.key,
			reason: "atlas-full" as const,
			detail:
				unit.entries.length === 1
					? `atlas entry ${entry.entry.key} did not fit in ${policy.maxTextureCount} atlas textures`
					: `atlas entry ${entry.entry.key} belongs to cohort ${unit.key}, which did not fit in ${policy.maxTextureCount} atlas textures`,
		}))
		.sort((left, right) =>
			left.atlasEntryKey.localeCompare(right.atlasEntryKey),
		);
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

function normalizeAtlasLayoutCohorts(
	cohorts: readonly AtlasLayoutCohort[],
	entries: readonly AtlasLayoutEntry[],
): AtlasLayoutCohort[] {
	const entryKeys = new Set(entries.map((entry) => entry.key));
	const cohortsByKey = new Map<string, AtlasLayoutCohort>();
	for (const cohort of cohorts) {
		if (cohort.key.length === 0) {
			throw new Error("Atlas layout cohort key must be non-empty.");
		}
		const normalizedEntryKeys = [...new Set(cohort.entryKeys)].sort();
		if (normalizedEntryKeys.length === 0) {
			throw new Error(`Atlas layout cohort ${cohort.key} must not be empty.`);
		}
		for (const entryKey of normalizedEntryKeys) {
			if (!entryKeys.has(entryKey)) {
				throw new Error(
					`Atlas layout cohort ${cohort.key} references unknown entry ${entryKey}.`,
				);
			}
		}
		const previous = cohortsByKey.get(cohort.key);
		if (previous) {
			const previousKeys = previous.entryKeys.join("\n");
			const nextKeys = normalizedEntryKeys.join("\n");
			if (previousKeys !== nextKeys) {
				throw new Error(
					`Atlas layout cohort ${cohort.key} has conflicting entry keys.`,
				);
			}
			continue;
		}
		cohortsByKey.set(cohort.key, {
			key: cohort.key,
			entryKeys: normalizedEntryKeys,
		});
	}
	return [...cohortsByKey.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
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

function compareAtlasPackingUnits(
	left: AtlasPackingUnit,
	right: AtlasPackingUnit,
): number {
	return (
		right.paddedArea - left.paddedArea ||
		right.maxPaddedSide - left.maxPaddedSide ||
		right.minPaddedSide - left.minPaddedSide ||
		left.key.localeCompare(right.key)
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

function compareUnitPagePlacements(
	left: AtlasUnitPagePlacement,
	right: AtlasUnitPagePlacement,
): number {
	return (
		left.remainingFreeArea - right.remainingFreeArea ||
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
