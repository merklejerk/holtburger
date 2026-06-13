import { describe, expect, it } from "vitest";

import {
	planAtlasLayout,
	type AtlasLayoutEntry,
	type AtlasLayoutPolicy,
	type AtlasTexturePage,
	type AtlasTexturePlacement,
} from "./texture-pages/atlas-layout-planner";

describe("atlas layout planner", () => {
	it("returns an empty layout without allocating pages", () => {
		const plan = planAtlasLayout({
			entries: [],
			policy: { maxTextureSize: 16, maxTextureCount: 1, gutterPixels: 2 },
		});

		expect(plan.entries).toEqual([]);
		expect(plan.texturePages).toEqual([]);
		expect(plan.overflows).toEqual([]);
	});

	it("is deterministic independent of input order", () => {
		const entries: AtlasLayoutEntry[] = [
			{ key: "c", width: 8, height: 8 },
			{ key: "a", width: 8, height: 8 },
			{ key: "b", width: 8, height: 8 },
		];
		const policy: AtlasLayoutPolicy = {
			maxTextureSize: 16,
			maxTextureCount: 2,
			gutterPixels: 2,
		};
		const first = planAtlasLayout({ entries, policy });
		const second = planAtlasLayout({ entries: [...entries].reverse(), policy });

		expect(first.entries.map((entry) => entry.key)).toEqual(["a", "b", "c"]);
		expect(second.texturePages).toEqual(first.texturePages);
		expect(second.overflows).toEqual(first.overflows);
		assertNoPaddedOverlaps(first.texturePages);
	});

	it("keeps returned entries key-sorted while packing by size", () => {
		const plan = planAtlasLayout({
			entries: [
				{ key: "a-small", width: 4, height: 4 },
				{ key: "z-large", width: 16, height: 16 },
			],
			policy: { maxTextureSize: 32, maxTextureCount: 1, gutterPixels: 0 },
		});

		expect(plan.entries.map((entry) => entry.key)).toEqual([
			"a-small",
			"z-large",
		]);
		expect(plan.texturePages[0]?.placements[0]?.atlasEntryKey).toBe("z-large");
		assertNoPaddedOverlaps(plan.texturePages);
	});

	it("reuses free space beside tall placements", () => {
		const plan = planAtlasLayout({
			entries: [
				{ key: "tall", width: 8, height: 16 },
				{ key: "small-a", width: 8, height: 8 },
				{ key: "small-b", width: 8, height: 8 },
			],
			policy: { maxTextureSize: 32, maxTextureCount: 1, gutterPixels: 0 },
		});

		expect(plan.overflows).toEqual([]);
		expect(plan.texturePages).toHaveLength(1);
		expect(plan.texturePages[0]).toMatchObject({ width: 16, height: 16 });
		assertNoPaddedOverlaps(plan.texturePages);
	});

	it("allocates the smallest viable power-of-two page tier", () => {
		const plan = planAtlasLayout({
			entries: [{ key: "tiny", width: 5, height: 5 }],
			policy: { maxTextureSize: 4096, maxTextureCount: 1, gutterPixels: 1 },
		});

		expect(plan.texturePages).toHaveLength(1);
		expect(plan.texturePages[0]).toMatchObject({ width: 8, height: 8 });
		expect(plan.texturePages[0]?.placements[0]).toMatchObject({
			atlasEntryKey: "tiny",
			x: 1,
			y: 1,
			width: 5,
			height: 5,
			gutterPixels: 1,
		});
	});

	it("selects rectangular page tiers when they are the smallest fit", () => {
		const plan = planAtlasLayout({
			entries: [{ key: "wide", width: 32, height: 8 }],
			policy: { maxTextureSize: 64, maxTextureCount: 1, gutterPixels: 0 },
		});

		expect(plan.texturePages).toHaveLength(1);
		expect(plan.texturePages[0]).toMatchObject({ width: 32, height: 8 });
	});

	it("can prefer fewer atlas textures over smaller total allocation", () => {
		const entries = Array.from({ length: 9 }, (_value, index) => ({
			key: `entry-${index}`,
			width: 8,
			height: 8,
		}));
		const memoryPlan = planAtlasLayout({
			entries,
			policy: { maxTextureSize: 64, maxTextureCount: 4, gutterPixels: 0 },
		});
		const textureCountPlan = planAtlasLayout({
			entries,
			policy: {
				maxTextureSize: 64,
				maxTextureCount: 4,
				gutterPixels: 0,
				pageSelection: "minimize-textures",
			},
		});

		expect(memoryPlan.texturePages).toHaveLength(3);
		expect(memoryPlan.texturePages[0]).toMatchObject({ width: 16, height: 16 });
		expect(textureCountPlan.texturePages).toHaveLength(1);
		expect(textureCountPlan.texturePages[0]).toMatchObject({
			width: 32,
			height: 32,
		});
		assertNoPaddedOverlaps(textureCountPlan.texturePages);
	});

	it("keeps cohort entries on the same page while minimizing memory", () => {
		const plan = planAtlasLayout({
			entries: [
				{ key: "small", width: 8, height: 8 },
				{ key: "wide", width: 300, height: 8 },
			],
			policy: { maxTextureSize: 512, maxTextureCount: 4, gutterPixels: 0 },
			cohorts: [{ key: "terrain-unit", entryKeys: ["small", "wide"] }],
		});

		expect(plan.overflows).toEqual([]);
		expect(plan.texturePages).toHaveLength(1);
		expect(plan.texturePages[0]).toMatchObject({ width: 512, height: 8 });
		expect(
			new Set(
				["small", "wide"].map(
					(key) => plan.placementsByEntryKey.get(key)?.textureIndex,
				),
			),
		).toEqual(new Set([0]));
		assertNoPaddedOverlaps(plan.texturePages);
	});

	it("allows independent cohorts to use separate smaller pages", () => {
		const plan = planAtlasLayout({
			entries: [
				{ key: "a-small", width: 8, height: 8 },
				{ key: "a-wide", width: 300, height: 200 },
				{ key: "b-small", width: 8, height: 8 },
				{ key: "b-wide", width: 300, height: 200 },
				{ key: "c-small", width: 8, height: 8 },
				{ key: "c-wide", width: 300, height: 200 },
			],
			policy: { maxTextureSize: 512, maxTextureCount: 4, gutterPixels: 0 },
			cohorts: [
				{ key: "terrain-a", entryKeys: ["a-small", "a-wide"] },
				{ key: "terrain-b", entryKeys: ["b-small", "b-wide"] },
				{ key: "terrain-c", entryKeys: ["c-small", "c-wide"] },
			],
		});

		expect(plan.overflows).toEqual([]);
		expect(plan.texturePages).toHaveLength(3);
		for (const cohort of [
			["a-small", "a-wide"],
			["b-small", "b-wide"],
			["c-small", "c-wide"],
		]) {
			expect(
				new Set(
					cohort.map((key) => plan.placementsByEntryKey.get(key)?.textureIndex),
				).size,
			).toBe(1);
		}
		assertNoPaddedOverlaps(plan.texturePages);
	});

	it("merges overlapping cohorts transitively", () => {
		const plan = planAtlasLayout({
			entries: [
				{ key: "a", width: 12, height: 12 },
				{ key: "b", width: 12, height: 12 },
				{ key: "c", width: 12, height: 12 },
			],
			policy: { maxTextureSize: 64, maxTextureCount: 4, gutterPixels: 0 },
			cohorts: [
				{ key: "first", entryKeys: ["a", "b"] },
				{ key: "second", entryKeys: ["b", "c"] },
			],
		});

		expect(plan.overflows).toEqual([]);
		expect(
			new Set(
				["a", "b", "c"].map(
					(key) => plan.placementsByEntryKey.get(key)?.textureIndex,
				),
			),
		).toEqual(new Set([0]));
		assertNoPaddedOverlaps(plan.texturePages);
	});

	it("rejects cohorts that reference unknown entries", () => {
		expect(() =>
			planAtlasLayout({
				entries: [{ key: "known", width: 8, height: 8 }],
				policy: { maxTextureSize: 16, maxTextureCount: 1, gutterPixels: 0 },
				cohorts: [{ key: "bad", entryKeys: ["known", "missing"] }],
			}),
		).toThrow(/unknown entry missing/);
	});

	it("reports multiple pages and atlas-full overflows deterministically", () => {
		const plan = planAtlasLayout({
			entries: [
				{ key: "a", width: 8, height: 8 },
				{ key: "b", width: 8, height: 8 },
				{ key: "c", width: 8, height: 8 },
				{ key: "d", width: 8, height: 8 },
			],
			policy: { maxTextureSize: 8, maxTextureCount: 2, gutterPixels: 0 },
		});

		expect(plan.texturePages).toHaveLength(2);
		expect(plan.texturePages.map((page) => page.placements)).toHaveLength(2);
		expect(plan.overflows).toMatchObject([
			{ atlasEntryKey: "c", reason: "atlas-full" },
			{ atlasEntryKey: "d", reason: "atlas-full" },
		]);
		expect(plan.overflowsByEntryKey.get("c")?.reason).toBe("atlas-full");
	});

	it("reports source-too-large before allocating a page for that entry", () => {
		const plan = planAtlasLayout({
			entries: [{ key: "too-big", width: 13, height: 8 }],
			policy: { maxTextureSize: 16, maxTextureCount: 1, gutterPixels: 2 },
		});

		expect(plan.texturePages).toEqual([]);
		expect(plan.overflows).toMatchObject([
			{ atlasEntryKey: "too-big", reason: "source-too-large" },
		]);
		expect(plan.overflowsByEntryKey.get("too-big")?.reason).toBe(
			"source-too-large",
		);
	});

	it("deduplicates identical entries and rejects conflicting duplicates", () => {
		const plan = planAtlasLayout({
			entries: [
				{ key: "shared", width: 4, height: 4 },
				{ key: "shared", width: 4, height: 4 },
			],
			policy: { maxTextureSize: 16, maxTextureCount: 1, gutterPixels: 2 },
		});

		expect(plan.entries.map((entry) => entry.key)).toEqual(["shared"]);
		expect(plan.texturePages[0]?.placements).toHaveLength(1);
		expect(() =>
			planAtlasLayout({
				entries: [
					{ key: "shared", width: 4, height: 4 },
					{ key: "shared", width: 8, height: 4 },
				],
				policy: { maxTextureSize: 16, maxTextureCount: 1, gutterPixels: 2 },
			}),
		).toThrow(/conflicting dimensions or gutter/);
	});

	it("uses per-entry gutter overrides for placement and padded fit", () => {
		const plan = planAtlasLayout({
			entries: [{ key: "tight", width: 4, height: 4, gutterPixels: 1 }],
			policy: { maxTextureSize: 16, maxTextureCount: 1, gutterPixels: 2 },
		});

		expect(plan.texturePages[0]?.placements).toEqual([
			{
				atlasEntryKey: "tight",
				textureIndex: 0,
				x: 1,
				y: 1,
				width: 4,
				height: 4,
				gutterPixels: 1,
			},
		]);
		expect(plan.texturePages[0]).toMatchObject({ width: 8, height: 8 });
		assertNoPaddedOverlaps(plan.texturePages);
	});
});

function assertNoPaddedOverlaps(
	texturePages: readonly AtlasTexturePage[],
): void {
	for (const page of texturePages) {
		for (
			let leftIndex = 0;
			leftIndex < page.placements.length;
			leftIndex += 1
		) {
			const left = page.placements[leftIndex];
			if (left === undefined) {
				continue;
			}
			expect(left.x - left.gutterPixels).toBeGreaterThanOrEqual(0);
			expect(left.y - left.gutterPixels).toBeGreaterThanOrEqual(0);
			expect(left.x + left.width + left.gutterPixels).toBeLessThanOrEqual(
				page.width,
			);
			expect(left.y + left.height + left.gutterPixels).toBeLessThanOrEqual(
				page.height,
			);
			for (
				let rightIndex = leftIndex + 1;
				rightIndex < page.placements.length;
				rightIndex += 1
			) {
				const right = page.placements[rightIndex];
				if (right === undefined) {
					continue;
				}
				expect(paddedRectsIntersect(left, right)).toBe(false);
			}
		}
	}
}

function paddedRectsIntersect(
	left: AtlasTexturePlacement,
	right: AtlasTexturePlacement,
): boolean {
	const leftX = left.x - left.gutterPixels;
	const leftY = left.y - left.gutterPixels;
	const leftWidth = left.width + left.gutterPixels * 2;
	const leftHeight = left.height + left.gutterPixels * 2;
	const rightX = right.x - right.gutterPixels;
	const rightY = right.y - right.gutterPixels;
	const rightWidth = right.width + right.gutterPixels * 2;
	const rightHeight = right.height + right.gutterPixels * 2;
	return (
		leftX < rightX + rightWidth &&
		leftX + leftWidth > rightX &&
		leftY < rightY + rightHeight &&
		leftY + leftHeight > rightY
	);
}
