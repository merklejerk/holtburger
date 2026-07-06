import { describe, expect, it } from "vitest";
import type { TexturePlacementSnapshot } from "../../../textures/placement";
import { createBakeTexturePlacementFactsFromLegacySnapshot } from "./legacy-texture-placement-adapter";

describe("legacy texture placement adapter", () => {
	it("converts legacy placements into bake-facing compatibility facts", () => {
		const snapshot: TexturePlacementSnapshot = {
			placementsByItemId: new Map([
				[
					"terrain-color-a",
					{
						height: 64,
						itemId: "terrain-color-a",
						pageId: "page-a",
						pageVersion: {
							placementRevision: 1,
							textureRefId: "texture-page-a",
						},
						purpose: "terrain-color",
						rect: [0, 0, 1, 1],
						textureKey: {
							assetId: "06000010",
							kind: "prepared-texture",
						},
						textureRefId: "texture-page-a",
						width: 64,
					},
				],
			]),
		};

		expect(createBakeTexturePlacementFactsFromLegacySnapshot(snapshot)).toEqual(
			[
				{
					itemId: "terrain-color-a",
					pageCompatibilityKey: "terrain-color:page-a",
					purpose: "terrain-color",
				},
			],
		);
	});
});
