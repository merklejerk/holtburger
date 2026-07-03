export interface AtlasLayoutPolicy {
	readonly maxTextureSize: number;
	readonly maxTextureCount: number;
	readonly gutterPixels: number;
	readonly minTextureWidth?: number;
	readonly minTextureHeight?: number;
	readonly pageSelection?: AtlasLayoutPageSelection;
	// Grows materialized page dimensions after selecting the winning pack attempt.
	readonly pageRunway?: AtlasLayoutPageRunway;
}

type AtlasLayoutPageSelection = "minimize-memory" | "minimize-textures";
type AtlasLayoutPageRunway = "none" | "one-tier";

export interface AtlasLayoutEntry {
	readonly key: string;
	readonly width: number;
	readonly height: number;
	readonly gutterPixels?: number;
}

export interface AtlasLayoutCohort {
	readonly key: string;
	readonly entryKeys: readonly string[];
}

export interface AtlasTexturePlacement {
	readonly atlasEntryKey: string;
	readonly textureIndex: number;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly gutterPixels: number;
}

export interface AtlasTexturePage {
	readonly textureIndex: number;
	readonly width: number;
	readonly height: number;
	readonly placements: readonly AtlasTexturePlacement[];
}

type AtlasLayoutOverflowReason = "source-too-large" | "atlas-full";

export interface AtlasLayoutOverflow {
	readonly atlasEntryKey: string;
	readonly reason: AtlasLayoutOverflowReason;
	readonly detail: string;
}

interface AtlasLayoutPlan {
	readonly entries: readonly AtlasLayoutEntry[];
	readonly texturePages: readonly AtlasTexturePage[];
	readonly placementsByEntryKey: ReadonlyMap<string, AtlasTexturePlacement>;
	readonly overflows: readonly AtlasLayoutOverflow[];
	readonly overflowsByEntryKey: ReadonlyMap<string, AtlasLayoutOverflow>;
}

export interface AtlasPageInsertionPlan {
	readonly insertedPlacementsByEntryKey: ReadonlyMap<string, AtlasTexturePlacement>;
	readonly overflows: readonly AtlasLayoutOverflow[];
	readonly overflowsByEntryKey: ReadonlyMap<string, AtlasLayoutOverflow>;
	readonly texturePages: readonly AtlasTexturePage[];
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
	readonly texturePages: readonly AtlasTexturePage[];
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

export function planAtlasLayout(options: {
	readonly entries: readonly AtlasLayoutEntry[];
	readonly policy: AtlasLayoutPolicy;
	readonly cohorts?: readonly AtlasLayoutCohort[];
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
				detail: `atlas entry ${paddedEntry.entry.key} is ${paddedEntry.entry.width}x${paddedEntry.entry.height} with ${paddedEntry.gutterPixels}px gutter, exceeding ${policy.maxTextureSize}px atlas capacity`,
				reason: "source-too-large",
			});
			continue;
		}
		packableEntries.push(paddedEntry);
	}

	const selectedAttempt = selectAtlasPackAttempt({
		cohorts,
		entries: packableEntries,
		policy,
	});
	const overflows = [
		...sourceTooLargeOverflows,
		...(selectedAttempt?.atlasFullOverflows ?? []),
	].sort((left, right) =>
		left.atlasEntryKey.localeCompare(right.atlasEntryKey),
	);

	return {
		entries,
		overflows,
		overflowsByEntryKey: new Map(
			overflows.map((overflow) => [overflow.atlasEntryKey, overflow] as const),
		),
		placementsByEntryKey: selectedAttempt?.placementsByEntryKey ?? new Map(),
		texturePages: selectedAttempt
			? applyPageRunway(selectedAttempt.texturePages, policy)
			: [],
	};
}

export function planAtlasPageInsertion(options: {
	readonly entries: readonly AtlasLayoutEntry[];
	readonly lockedPages: readonly AtlasTexturePage[];
	readonly policy: AtlasLayoutPolicy;
	readonly cohorts?: readonly AtlasLayoutCohort[];
}): AtlasPageInsertionPlan {
	const policy = normalizeAtlasLayoutPolicy(options.policy);
	const entries = dedupeAndSortAtlasLayoutEntries(options.entries, policy);
	const cohorts = normalizeAtlasLayoutCohorts(options.cohorts ?? [], entries);
	const pageStates = options.lockedPages
		.slice()
		.sort((left, right) => left.textureIndex - right.textureIndex)
		.map(reconstructLockedAtlasPagePackState);
	const insertedPlacementsByEntryKey = new Map<string, AtlasTexturePlacement>();
	const packableEntries: PaddedAtlasLayoutEntry[] = [];
	const overflows: AtlasLayoutOverflow[] = [];

	for (const paddedEntry of createPaddedAtlasLayoutEntries(entries, policy)) {
		if (
			paddedEntry.paddedWidth > policy.maxTextureSize ||
			paddedEntry.paddedHeight > policy.maxTextureSize
		) {
			overflows.push({
				atlasEntryKey: paddedEntry.entry.key,
				detail: `atlas entry ${paddedEntry.entry.key} is ${paddedEntry.entry.width}x${paddedEntry.entry.height} with ${paddedEntry.gutterPixels}px gutter, exceeding ${policy.maxTextureSize}px atlas capacity`,
				reason: "source-too-large",
			});
			continue;
		}
		packableEntries.push(paddedEntry);
	}

	for (const unit of createAtlasPackingUnits(packableEntries, cohorts)) {
		const placement = findBestUnitPagePlacement(unit, pageStates);
		if (placement === null) {
			overflows.push(...createAtlasExistingPageOverflows(unit));
			continue;
		}
		commitUnitPagePlacement(
			placement,
			pageStates,
			insertedPlacementsByEntryKey,
		);
	}

	const sortedOverflows = overflows.sort((left, right) =>
		left.atlasEntryKey.localeCompare(right.atlasEntryKey),
	);
	return {
		insertedPlacementsByEntryKey,
		overflows: sortedOverflows,
		overflowsByEntryKey: new Map(
			sortedOverflows.map(
				(overflow) => [overflow.atlasEntryKey, overflow] as const,
			),
		),
		texturePages: pageStates.map((page) => ({
			height: page.height,
			placements: page.placements,
			textureIndex: page.textureIndex,
			width: page.width,
		})),
	};
}

function applyPageRunway(
	texturePages: readonly AtlasTexturePage[],
	policy: AtlasLayoutPolicy,
): readonly AtlasTexturePage[] {
	if (policy.pageRunway !== "one-tier") {
		return texturePages;
	}
	return texturePages.map((page) => ({
		...page,
		...growAtlasPageOneTier(page, policy.maxTextureSize),
	}));
}

function growAtlasPageOneTier(
	page: Pick<AtlasTexturePage, "width" | "height">,
	maxTextureSize: number,
): Pick<AtlasTexturePage, "width" | "height"> {
	if (page.width === page.height) {
		return {
			height: nextTextureSizeTier(page.height, maxTextureSize),
			width: nextTextureSizeTier(page.width, maxTextureSize),
		};
	}
	if (page.width < page.height) {
		return {
			height: page.height,
			width: nextTextureSizeTier(page.width, maxTextureSize),
		};
	}
	return {
		height: nextTextureSizeTier(page.height, maxTextureSize),
		width: page.width,
	};
}

function nextTextureSizeTier(size: number, maxTextureSize: number): number {
	return Math.min(size * 2, maxTextureSize);
}

function createPaddedAtlasLayoutEntries(
	entries: readonly AtlasLayoutEntry[],
	policy: AtlasLayoutPolicy,
): PaddedAtlasLayoutEntry[] {
	return entries.map((entry) => {
		const gutterPixels = entry.gutterPixels ?? policy.gutterPixels;
		const paddedWidth = entry.width + gutterPixels * 2;
		const paddedHeight = entry.height + gutterPixels * 2;
		return {
			entry,
			gutterPixels,
			paddedArea: paddedWidth * paddedHeight,
			paddedHeight,
			paddedWidth,
		};
	});
}

function selectAtlasPackAttempt(options: {
	readonly entries: readonly PaddedAtlasLayoutEntry[];
	readonly cohorts: readonly AtlasLayoutCohort[];
	readonly policy: AtlasLayoutPolicy;
}): AtlasPackAttempt | null {
	if (options.entries.length === 0) {
		return null;
	}

	const units = createAtlasPackingUnits(options.entries, options.cohorts);
	const candidates = createAtlasPageSizeCandidates(
		options.entries,
		options.policy,
	);
	let selected: AtlasPackAttempt | null = null;
	for (const candidate of candidates) {
		const attempt = packEntriesInPageSize({
			pageSize: candidate,
			policy: options.policy,
			units,
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
	const minWidth = Math.max(
		policy.minTextureWidth ?? 1,
		...entries.map((entry) => entry.paddedWidth),
	);
	const minHeight = Math.max(
		policy.minTextureHeight ?? 1,
		...entries.map((entry) => entry.paddedHeight),
	);
	const candidates: AtlasPageSizeCandidate[] = [];
	for (const width of createTextureSizeTiers(minWidth, policy.maxTextureSize)) {
		for (const height of createTextureSizeTiers(
			minHeight,
			policy.maxTextureSize,
		)) {
			candidates.push({ height, width });
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

function createAtlasPackingUnits(
	entries: readonly PaddedAtlasLayoutEntry[],
	cohorts: readonly AtlasLayoutCohort[],
): AtlasPackingUnit[] {
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
): Array<{ readonly key: string; readonly entryKeys: readonly string[] }> {
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
			entryKeys,
			key: `cohort:${entryKeys.join("+")}`,
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
	return { entries, key, maxPaddedSide, minPaddedSide, paddedArea };
}

function packEntriesInPageSize(options: {
	readonly units: readonly AtlasPackingUnit[];
	readonly policy: AtlasLayoutPolicy;
	readonly pageSize: AtlasPageSizeCandidate;
}): AtlasPackAttempt {
	const pageStates: AtlasPagePackState[] = [];
	const placementsByEntryKey = new Map<string, AtlasTexturePlacement>();
	const atlasFullOverflows: AtlasLayoutOverflow[] = [];
	for (const unit of options.units) {
		const existingPagePlacement = findBestUnitPagePlacement(unit, pageStates);
		if (existingPagePlacement !== null) {
			commitUnitPagePlacement(
				existingPagePlacement,
				pageStates,
				placementsByEntryKey,
			);
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
				...createAtlasUnitPageOverflows(unit, options.pageSize),
			);
			continue;
		}
		pageStates.push(page);
		commitUnitPagePlacement(newPagePlacement, pageStates, placementsByEntryKey);
	}
	return {
		atlasFullOverflows,
		pageSize: options.pageSize,
		placementsByEntryKey,
		texturePages: pageStates.map((page) => ({
			height: page.height,
			placements: page.placements,
			textureIndex: page.textureIndex,
			width: page.width,
		})),
	};
}

function createAtlasPagePackState(
	textureIndex: number,
	pageSize: AtlasPageSizeCandidate,
): AtlasPagePackState {
	return {
		freeRects: [{ height: pageSize.height, width: pageSize.width, x: 0, y: 0 }],
		height: pageSize.height,
		placements: [],
		textureIndex,
		width: pageSize.width,
	};
}

function reconstructLockedAtlasPagePackState(
	page: AtlasTexturePage,
): AtlasPagePackState {
	const state = createAtlasPagePackState(page.textureIndex, page);
	const paddedRects: AtlasFreeRect[] = [];
	for (const placement of page.placements
		.slice()
		.sort((left, right) => left.atlasEntryKey.localeCompare(right.atlasEntryKey))) {
		const paddedRect = createPaddedRectFromPlacement(placement);
		if (
			paddedRect.x < 0 ||
			paddedRect.y < 0 ||
			paddedRect.x + paddedRect.width > page.width ||
			paddedRect.y + paddedRect.height > page.height
		) {
			throw new Error(
				`Atlas locked placement ${placement.atlasEntryKey} exceeds page ${page.textureIndex}.`,
			);
		}
		if (paddedRects.some((existing) => rectsIntersect(existing, paddedRect))) {
			throw new Error(
				`Atlas locked placement ${placement.atlasEntryKey} overlaps another locked placement on page ${page.textureIndex}.`,
			);
		}
		paddedRects.push(paddedRect);
		state.placements.push(placement);
		state.freeRects = pruneContainedFreeRects(
			splitFreeRects(state.freeRects, paddedRect),
		);
	}
	return state;
}

function createPaddedRectFromPlacement(
	placement: AtlasTexturePlacement,
): AtlasFreeRect {
	return {
		height: placement.height + placement.gutterPixels * 2,
		width: placement.width + placement.gutterPixels * 2,
		x: placement.x - placement.gutterPixels,
		y: placement.y - placement.gutterPixels,
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
		freeRects: [...page.freeRects],
		height: page.height,
		placements: [...page.placements],
		textureIndex: page.textureIndex,
		width: page.width,
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
		freeRects: pageClone.freeRects,
		page,
		placements: [...unitPlacementsByEntryKey.values()].sort((left, right) =>
			left.atlasEntryKey.localeCompare(right.atlasEntryKey),
		),
		remainingFreeArea: pageClone.freeRects.reduce(
			(total, rect) => total + rect.width * rect.height,
			0,
		),
	};
}

function commitUnitPagePlacement(
	placement: AtlasUnitPagePlacement,
	pageStates: readonly AtlasPagePackState[],
	placementsByEntryKey: Map<string, AtlasTexturePlacement>,
): void {
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
			detail:
				unit.entries.length === 1
					? `atlas entry ${entry.entry.key} did not fit in ${policy.maxTextureCount} atlas textures`
					: `atlas entry ${entry.entry.key} belongs to cohort ${unit.key}, which did not fit in ${policy.maxTextureCount} atlas textures`,
			reason: "atlas-full" as const,
		}))
		.sort((left, right) =>
			left.atlasEntryKey.localeCompare(right.atlasEntryKey),
		);
}

function createAtlasUnitPageOverflows(
	unit: AtlasPackingUnit,
	pageSize: AtlasPageSizeCandidate,
): AtlasLayoutOverflow[] {
	return unit.entries
		.map((entry) => ({
			atlasEntryKey: entry.entry.key,
			detail:
				unit.entries.length === 1
					? `atlas entry ${entry.entry.key} did not fit on a ${pageSize.width}x${pageSize.height} atlas texture`
					: `atlas entry ${entry.entry.key} belongs to cohort ${unit.key}, which did not fit together on one ${pageSize.width}x${pageSize.height} atlas texture`,
			reason: "atlas-full" as const,
		}))
		.sort((left, right) =>
			left.atlasEntryKey.localeCompare(right.atlasEntryKey),
		);
}

function createAtlasExistingPageOverflows(
	unit: AtlasPackingUnit,
): AtlasLayoutOverflow[] {
	return unit.entries
		.map((entry) => ({
			atlasEntryKey: entry.entry.key,
			detail:
				unit.entries.length === 1
					? `atlas entry ${entry.entry.key} did not fit any existing atlas texture`
					: `atlas entry ${entry.entry.key} belongs to cohort ${unit.key}, which did not fit together on any existing atlas texture`,
			reason: "atlas-full" as const,
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
			const candidate = {
				longSideLeftover: Math.max(widthLeftover, heightLeftover),
				paddedX: freeRect.x,
				paddedY: freeRect.y,
				page,
				shortSideLeftover: Math.min(widthLeftover, heightLeftover),
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
	const paddedRect = {
		height: entry.paddedHeight,
		width: entry.paddedWidth,
		x: candidate.paddedX,
		y: candidate.paddedY,
	};
	const placement = {
		atlasEntryKey: entry.entry.key,
		gutterPixels: entry.gutterPixels,
		height: entry.entry.height,
		textureIndex: candidate.page.textureIndex,
		width: entry.entry.width,
		x: paddedRect.x + entry.gutterPixels,
		y: paddedRect.y + entry.gutterPixels,
	};
	candidate.page.placements.push(placement);
	placementsByEntryKey.set(entry.entry.key, placement);
	candidate.page.freeRects = pruneContainedFreeRects(
		splitFreeRects(candidate.page.freeRects, paddedRect),
	);
}

function splitFreeRects(
	freeRects: readonly AtlasFreeRect[],
	placedRect: AtlasFreeRect,
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
				height: topHeight,
				width: freeRect.width,
				x: freeRect.x,
				y: freeRect.y,
			});
		}
		if (bottomHeight > 0) {
			nextFreeRects.push({
				height: bottomHeight,
				width: freeRect.width,
				x: freeRect.x,
				y: bottomY,
			});
		}
		if (leftWidth > 0) {
			nextFreeRects.push({
				height: freeRect.height,
				width: leftWidth,
				x: freeRect.x,
				y: freeRect.y,
			});
		}
		if (rightWidth > 0) {
			nextFreeRects.push({
				height: freeRect.height,
				width: rightWidth,
				x: rightX,
				y: freeRect.y,
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
		policy.minTextureWidth !== undefined &&
		(!Number.isInteger(policy.minTextureWidth) || policy.minTextureWidth <= 0)
	) {
		throw new Error(
			"Atlas layout minimum texture width must be a positive integer.",
		);
	}
	if (
		policy.minTextureHeight !== undefined &&
		(!Number.isInteger(policy.minTextureHeight) || policy.minTextureHeight <= 0)
	) {
		throw new Error(
			"Atlas layout minimum texture height must be a positive integer.",
		);
	}
	if (
		policy.minTextureWidth !== undefined &&
		policy.minTextureWidth > policy.maxTextureSize
	) {
		throw new Error(
			"Atlas layout minimum texture width must not exceed max texture size.",
		);
	}
	if (
		policy.minTextureHeight !== undefined &&
		policy.minTextureHeight > policy.maxTextureSize
	) {
		throw new Error(
			"Atlas layout minimum texture height must not exceed max texture size.",
		);
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
	if (
		policy.pageRunway !== undefined &&
		policy.pageRunway !== "none" &&
		policy.pageRunway !== "one-tier"
	) {
		throw new Error("Atlas layout page runway must be none or one-tier.");
	}
	return {
		...policy,
		pageSelection: policy.pageSelection ?? "minimize-memory",
		pageRunway: policy.pageRunway ?? "none",
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
			entryKeys: normalizedEntryKeys,
			key: cohort.key,
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
			const previousGutter = previous.gutterPixels ?? policy.gutterPixels;
			const entryGutter = entry.gutterPixels ?? policy.gutterPixels;
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
	if (leftOverflowCount !== 0) {
		return comparePageSizeCandidates(right.pageSize, left.pageSize);
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
