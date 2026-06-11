import { describe, expect, it } from "vitest";
import { planAtlasLayout } from "./atlas-layout";

describe("V2 atlas layout planner", () => {
	it("uses deterministic keys and memory-minimizing power-of-two page sizes", () => {
		const first = planAtlasLayout({
			entries: [
				{ height: 16, key: "b", width: 16 },
				{ height: 16, key: "a", width: 16 },
			],
			policy: createPolicy(),
		});
		const second = planAtlasLayout({
			entries: [
				{ height: 16, key: "a", width: 16 },
				{ height: 16, key: "b", width: 16 },
			],
			policy: createPolicy(),
		});

		expect(first.texturePages).toEqual(second.texturePages);
		expect(first.texturePages).toMatchObject([
			{
				height: 16,
				placements: [
					{ atlasEntryKey: "a", x: 0, y: 0 },
					{ atlasEntryKey: "b", x: 16, y: 0 },
				],
				width: 32,
			},
		]);
	});

	it("sizes pages to include gutter padding and reports content rects inside the padding", () => {
		const plan = planAtlasLayout({
			entries: [{ height: 16, key: "terrain-color", width: 16 }],
			policy: {
				...createPolicy(),
				gutterPixels: 96,
			},
		});

		expect(plan.texturePages).toMatchObject([
			{
				height: 256,
				placements: [
					{
						atlasEntryKey: "terrain-color",
						gutterPixels: 96,
						height: 16,
						width: 16,
						x: 96,
						y: 96,
					},
				],
				width: 256,
			},
		]);
	});

	it("keeps cohort entries on one page when independent entries would split", () => {
		const entries = [
			{ height: 8, key: "terrain-wide-a", width: 300 },
			{ height: 8, key: "terrain-wide-b", width: 300 },
			{ height: 8, key: "terrain-wide-c", width: 300 },
		];
		const unconstrained = planAtlasLayout({
			entries,
			policy: {
				...createPolicy(),
				maxTextureSize: 512,
			},
		});
		const constrained = planAtlasLayout({
			cohorts: [
				{
					entryKeys: ["terrain-wide-a", "terrain-wide-b", "terrain-wide-c"],
					key: "terrain-tile",
				},
			],
			entries,
			policy: {
				...createPolicy(),
				maxTextureSize: 512,
			},
		});

		expect(unconstrained.texturePages).toHaveLength(3);
		expect(constrained.texturePages).toHaveLength(1);
		expect(constrained.texturePages[0]).toMatchObject({
			height: 32,
			width: 512,
		});
	});

	it("reports source-too-large and atlas-full overflows", () => {
		const sourceTooLarge = planAtlasLayout({
			entries: [{ height: 65, key: "too-large", width: 65 }],
			policy: {
				...createPolicy(),
				maxTextureSize: 64,
			},
		});
		const atlasFull = planAtlasLayout({
			entries: [
				{ height: 64, key: "a", width: 64 },
				{ height: 64, key: "b", width: 64 },
			],
			policy: {
				...createPolicy(),
				maxTextureCount: 1,
				maxTextureSize: 64,
			},
		});

		expect(sourceTooLarge.overflows).toMatchObject([
			{ atlasEntryKey: "too-large", reason: "source-too-large" },
		]);
		expect(atlasFull.overflows).toMatchObject([
			{ atlasEntryKey: "b", reason: "atlas-full" },
		]);
	});
});

function createPolicy() {
	return {
		gutterPixels: 0,
		maxTextureCount: 8,
		maxTextureSize: 512,
	};
}
