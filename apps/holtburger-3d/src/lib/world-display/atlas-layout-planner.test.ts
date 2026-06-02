import { describe, expect, it } from "vitest";

import { planAtlasLayout } from "./texture-pages/atlas-layout-planner";

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

	it("packs entries deterministically across multiple atlas pages", () => {
		const first = planAtlasLayout({
			entries: [
				{ key: "c", width: 8, height: 8 },
				{ key: "a", width: 8, height: 8 },
				{ key: "b", width: 8, height: 8 },
			],
			policy: { maxTextureSize: 16, maxTextureCount: 2, gutterPixels: 2 },
		});
		const second = planAtlasLayout({
			entries: [
				{ key: "b", width: 8, height: 8 },
				{ key: "c", width: 8, height: 8 },
				{ key: "a", width: 8, height: 8 },
			],
			policy: { maxTextureSize: 16, maxTextureCount: 2, gutterPixels: 2 },
		});

		expect(first.entries.map((entry) => entry.key)).toEqual(["a", "b", "c"]);
		expect(
			first.texturePages.map((page) =>
				page.placements.map((placement) => placement.atlasEntryKey),
			),
		).toEqual([["a"], ["b"]]);
		expect(first.overflows).toMatchObject([
			{ atlasEntryKey: "c", reason: "atlas-full" },
		]);
		expect(second.texturePages).toEqual(first.texturePages);
		expect(second.overflows).toEqual(first.overflows);
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

	it("uses per-entry gutter overrides for placement", () => {
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
	});
});
