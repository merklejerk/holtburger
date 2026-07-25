import { describe, expect, it } from "vitest";
import {
	allocationBoundsForPlacement,
	createAtlasPageId,
	planStableAtlasLayout,
	reconstructFreeRectangles,
	type AtlasLayoutEntry,
	type AtlasPageLayout,
} from "./layout";
import {
	TexturePurpose,
	createAssetTextureKey,
	type PackedObjectTexturePurpose,
} from "../types";

const purpose = TexturePurpose.ObjectIndex8;

describe("fixed-page resident atlas layout", () => {
	it("produces the same snapshot for equivalent input ordering", () => {
		const entries = [entry("a", 3, 4), entry("b", 5, 2), entry("c", 2, 5)];
		const first = plan(entries, []);
		const second = plan([...entries].reverse(), []);

		expect(first).toEqual(second);
	});

	it("preserves existing live placements while inserting into reconstructed free space", () => {
		const page = pageWith([
			placement("wide", 0, 0, 6, 6),
			placement("shelf-row", 6, 0, 4, 4),
			placement("shelf-tail", 0, 6, 6, 4),
		]);
		const layoutPlan = plan(
			[
				entry("wide", 6, 6),
				entry("shelf-row", 4, 4),
				entry("shelf-tail", 6, 4),
				entry("hole-filler", 4, 6),
			],
			[page],
		);

		expect(layoutPlan.pages).toHaveLength(1);
		expect(layoutPlan.pages[0]?.placements).toEqual(
			expect.arrayContaining([
				placement("wide", 0, 0, 6, 6),
				placement("shelf-row", 6, 0, 4, 4),
				placement("shelf-tail", 0, 6, 6, 4),
				placement("hole-filler", 6, 4, 4, 6),
			]),
		);
	});

	it("drops empty pages and immediately reuses a released allocation rectangle", () => {
		const page = pageWith([
			placement("released", 0, 0, 4, 4),
			placement("retained", 4, 0, 4, 4),
		]);
		const released = plan([entry("retained", 4, 4)], [page]);
		const reused = plan(
			[entry("retained", 4, 4), entry("replacement", 4, 4)],
			[page],
		);

		expect(released.pages).toHaveLength(1);
		expect(released.releasedKeys).toEqual([key("released")]);
		expect(reused.pages[0]).toEqual(
			expect.objectContaining({ pageId: page.pageId }),
		);
		expect(reused.pages[0]?.placements).toEqual(
			expect.arrayContaining([placement("replacement", 0, 0, 4, 4)]),
		);
	});

	it("derives allocation bounds from purpose and validates free-space geometry", () => {
		const directPurpose = TexturePurpose.ObjectDirectColor;
		const directEntry = {
			height: 2,
			key: createAssetTextureKey(directPurpose, "0x05000011"),
			purpose: directPurpose,
			width: 2,
		};
		const directPlan = planStableAtlasLayout(
			{
				correlationId: "direct",
				entries: [directEntry],
				nextPageGeneration: 0,
				pages: [],
				purpose: directPurpose,
			},
			{ pageSize: 16 },
		);
		const directPage = directPlan.pages[0]!;
		const directPlacement = directPage.placements[0]!;

		expect(directPlacement.contentBounds).toEqual({
			height: 2,
			width: 2,
			x: 4,
			y: 4,
		});
		expect(
			allocationBoundsForPlacement(directPurpose, directPlacement),
		).toEqual({
			height: 10,
			width: 10,
			x: 0,
			y: 0,
		});
		expect(reconstructFreeRectangles(directPage, 16)).toEqual(
			expect.arrayContaining([
				{ height: 16, width: 6, x: 10, y: 0 },
				{ height: 6, width: 16, x: 0, y: 10 },
			]),
		);
	});

	it("fails with the logical key, padded dimensions, purpose, and page size for oversized sources", () => {
		const oversized = entry("oversized", 11, 11);
		expect(() => plan([oversized], [])).toThrow(
			`${oversized.key} including its 0px gutter is 11x11, exceeding 10px page capacity`,
		);
	});

	it("rejects cross-purpose pages and overlapping content allocations", () => {
		const foreignPage: AtlasPageLayout = {
			pageId: createAtlasPageId(TexturePurpose.ObjectIndex16, 0),
			placements: [],
			purpose: TexturePurpose.ObjectIndex16,
		};
		expect(() => plan([], [foreignPage])).toThrow("contains page");

		const overlapping = pageWith([
			placement("first", 0, 0, 5, 5),
			placement("second", 4, 4, 5, 5),
		]);
		expect(() => plan([], [overlapping])).toThrow("overlaps another placement");

		expect(() =>
			planStableAtlasLayout({
				correlationId: "unsupported",
				entries: [],
				nextPageGeneration: 0,
				pages: [],
				purpose: TexturePurpose.TerrainColor as PackedObjectTexturePurpose,
			}),
		).toThrow("not supported by the resident object atlas");
	});

	it("maintains fixed-page bounds and non-overlapping allocations across varied input sets", () => {
		for (let seed = 1; seed <= 32; seed += 1) {
			const entries = Array.from({ length: 12 }, (_, index) => {
				const width = ((seed * 17 + index * 7) % 7) + 1;
				const height = ((seed * 11 + index * 5) % 7) + 1;
				return entry(`seed-${seed}-${index}`, width, height);
			});
			const layoutPlan = plan(entries, []);
			for (const page of layoutPlan.pages) {
				const allocations = page.placements.map((placement) =>
					allocationBoundsForPlacement(page.purpose, placement),
				);
				for (const allocation of allocations) {
					expect(allocation.x).toBeGreaterThanOrEqual(0);
					expect(allocation.y).toBeGreaterThanOrEqual(0);
					expect(allocation.x + allocation.width).toBeLessThanOrEqual(10);
					expect(allocation.y + allocation.height).toBeLessThanOrEqual(10);
				}
				for (let index = 0; index < allocations.length; index += 1) {
					for (let other = index + 1; other < allocations.length; other += 1) {
						expect(intersects(allocations[index]!, allocations[other]!)).toBe(
							false,
						);
					}
				}
				for (const freeRect of reconstructFreeRectangles(page, 10)) {
					for (const allocation of allocations) {
						expect(intersects(freeRect, allocation)).toBe(false);
					}
				}
			}
		}
	});
});

function plan(
	entries: readonly AtlasLayoutEntry[],
	pages: readonly AtlasPageLayout[],
) {
	return planStableAtlasLayout(
		{
			correlationId: "layout-test",
			entries,
			nextPageGeneration: 1,
			pages,
			purpose,
		},
		{ pageSize: 10 },
	);
}

function entry(name: string, width: number, height: number): AtlasLayoutEntry {
	return { height, key: key(name), purpose, width };
}

function pageWith(placements: AtlasPageLayout["placements"]): AtlasPageLayout {
	return { pageId: createAtlasPageId(purpose, 0), placements, purpose };
}

function placement(
	name: string,
	x: number,
	y: number,
	width: number,
	height: number,
) {
	return { contentBounds: { height, width, x, y }, key: key(name) };
}

function key(name: string) {
	let hash = 0;
	for (const character of name) {
		hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
	}
	return createAssetTextureKey(
		purpose as PackedObjectTexturePurpose,
		`0x${hash.toString(16).padStart(8, "0")}`,
	);
}

function intersects(
	left: {
		readonly x: number;
		readonly y: number;
		readonly width: number;
		readonly height: number;
	},
	right: {
		readonly x: number;
		readonly y: number;
		readonly width: number;
		readonly height: number;
	},
): boolean {
	return (
		left.x < right.x + right.width &&
		left.x + left.width > right.x &&
		left.y < right.y + right.height &&
		left.y + left.height > right.y
	);
}
