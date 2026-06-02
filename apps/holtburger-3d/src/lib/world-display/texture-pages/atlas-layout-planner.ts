export interface AtlasLayoutPolicy {
	maxTextureSize: number;
	maxTextureCount: number;
	gutterPixels: number;
}

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

export type AtlasLayoutOverflowReason = "source-too-large" | "atlas-full";

export interface AtlasLayoutOverflow {
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

export function planAtlasLayout(options: {
	entries: readonly AtlasLayoutEntry[];
	policy: AtlasLayoutPolicy;
}): AtlasLayoutPlan {
	const policy = normalizeAtlasLayoutPolicy(options.policy);
	const entries = dedupeAndSortAtlasLayoutEntries(options.entries, policy);
	const placementsByEntryKey = new Map<string, AtlasTexturePlacement>();
	const overflows: AtlasLayoutOverflow[] = [];
	const texturePages: AtlasTexturePage[] = [];
	let cursorX = 0;
	let cursorY = 0;
	let rowHeight = 0;
	let currentTexture: AtlasTexturePage | null = null;

	for (const entry of entries) {
		const gutterPixels = resolveEntryGutterPixels(entry, policy);
		const paddedWidth = entry.width + gutterPixels * 2;
		const paddedHeight = entry.height + gutterPixels * 2;
		if (
			paddedWidth > policy.maxTextureSize ||
			paddedHeight > policy.maxTextureSize
		) {
			overflows.push({
				atlasEntryKey: entry.key,
				reason: "source-too-large",
				detail: `atlas entry ${entry.key} is ${entry.width}x${entry.height} with ${gutterPixels}px gutter, exceeding ${policy.maxTextureSize}px atlas capacity`,
			});
			continue;
		}

		if (currentTexture === null) {
			currentTexture = createAtlasTexturePage(texturePages.length, policy);
			texturePages.push(currentTexture);
		}
		if (cursorX + paddedWidth > policy.maxTextureSize) {
			cursorX = 0;
			cursorY += rowHeight;
			rowHeight = 0;
		}
		if (cursorY + paddedHeight > policy.maxTextureSize) {
			if (texturePages.length >= policy.maxTextureCount) {
				overflows.push({
					atlasEntryKey: entry.key,
					reason: "atlas-full",
					detail: `atlas entry ${entry.key} did not fit in ${policy.maxTextureCount} atlas textures`,
				});
				continue;
			}
			currentTexture = createAtlasTexturePage(texturePages.length, policy);
			texturePages.push(currentTexture);
			cursorX = 0;
			cursorY = 0;
			rowHeight = 0;
		}

		const placement = {
			atlasEntryKey: entry.key,
			textureIndex: currentTexture.textureIndex,
			x: cursorX + gutterPixels,
			y: cursorY + gutterPixels,
			width: entry.width,
			height: entry.height,
			gutterPixels,
		};
		currentTexture.placements.push(placement);
		placementsByEntryKey.set(entry.key, placement);
		cursorX += paddedWidth;
		rowHeight = Math.max(rowHeight, paddedHeight);
	}

	const overflowsByEntryKey = new Map(
		overflows.map((overflow) => [overflow.atlasEntryKey, overflow] as const),
	);
	return {
		entries,
		texturePages,
		placementsByEntryKey,
		overflows,
		overflowsByEntryKey,
	};
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
	return policy;
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

function createAtlasTexturePage(
	textureIndex: number,
	policy: AtlasLayoutPolicy,
): AtlasTexturePage {
	return {
		textureIndex,
		width: policy.maxTextureSize,
		height: policy.maxTextureSize,
		placements: [],
	};
}
