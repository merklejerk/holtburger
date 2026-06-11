import { describe, expect, it } from "vitest";
import type {
	SurfaceTextureIdentity,
	TerrainMaterialLayerPlan,
} from "../../contracts";
import { classifyTerrainMaterialFamily } from "./terrain-material-family-classifier";

describe("V2 terrain material family classifier", () => {
	it("classifies a single repeat color base as the first textured terrain family", () => {
		const classification = classifyTerrainMaterialFamily({
			domain: "outdoor-terrain",
			placementRevisionAssumption: 42,
			plan: createPlan({
				layerEntries: [
					createLayerEntry({
						textureUseId: "terrain-base:06000010",
					}),
				],
			}),
		});

		expect(classification).toEqual({
			materialBucketKey:
				"shader:terrain-single-base-color|domain:outdoor-terrain|sampler:color-repeat-filterable|placement:42|texture:terrain-base:06000010",
			materialFamily: "terrain-single-base-color",
			primaryTextureUseId: "terrain-base:06000010",
			terrainFallbackReasons: [],
			textureUseIds: ["terrain-base:06000010"],
		});
	});

	it("falls back explicitly when terrain needs unsupported overlay bindings", () => {
		const classification = classifyTerrainMaterialFamily({
			domain: "outdoor-terrain",
			placementRevisionAssumption: 42,
			plan: createPlan({
				layerEntries: [
					createLayerEntry({
						overlays: [
							{
								alpha: createTextureRole({
									role: "terrain-alpha",
									textureUseId: "terrain-alpha:06000020",
									wrap: "clamp",
								}),
								rotation: 1,
								terrain: createTextureRole({
									textureUseId: "terrain-base:06000030",
								}),
							},
						],
						textureUseId: "terrain-base:06000010",
					}),
				],
			}),
		});

		expect(classification).toMatchObject({
			materialBucketKey:
				"shader:terrain-debug-flat|domain:outdoor-terrain|sampler:none|placement:none",
			materialFamily: "terrain-debug-flat",
			primaryTextureUseId: null,
			textureUseIds: [],
		});
		expect(classification.terrainFallbackReasons).toEqual([
			expect.objectContaining({
				code: "unsupported-material-binding",
				pcode: 33825,
			}),
		]);
	});

	it("falls back when one draw unit would require multiple base textures", () => {
		const classification = classifyTerrainMaterialFamily({
			domain: "outdoor-terrain",
			placementRevisionAssumption: 42,
			plan: createPlan({
				layerEntries: [
					createLayerEntry({
						pcode: 1,
						textureUseId: "terrain-base:06000010",
					}),
					createLayerEntry({
						pcode: 2,
						textureUseId: "terrain-base:06000020",
					}),
				],
			}),
		});

		expect(classification.materialFamily).toBe("terrain-debug-flat");
		expect(classification.terrainFallbackReasons).toEqual([
			expect.objectContaining({
				code: "unsupported-material-binding",
				message:
					"Terrain material plan uses multiple base textures in one draw unit.",
			}),
		]);
	});
});

function createPlan(
	overrides: Partial<TerrainMaterialLayerPlan> = {},
): TerrainMaterialLayerPlan {
	return {
		detailRoles: [],
		drawSlices: [
			{
				layerSlots: [0],
				pcodes: [33825],
				reason: "single slice",
				sliceId: "slice-0",
			},
		],
		fallbackReasons: [],
		layerEntries: [],
		signature: "test-plan",
		...overrides,
	};
}

function createLayerEntry({
	overlays = [],
	pcode = 33825,
	textureUseId,
}: {
	readonly overlays?: TerrainMaterialLayerPlan["layerEntries"][number]["overlays"];
	readonly pcode?: number;
	readonly textureUseId: string | null;
}): TerrainMaterialLayerPlan["layerEntries"][number] {
	return {
		allRoad: false,
		base: createTextureRole({ textureUseId }),
		colorRefCount: 1,
		maskRefCount: 0,
		overlays,
		pcode,
		roads: [],
		slot: 0,
	};
}

function createTextureRole({
	role = "terrain-base",
	texture = surfaceTexture(0x05000010),
	textureUseId,
	tiling = 1,
	wrap = "repeat",
}: {
	readonly role?: "terrain-base" | "terrain-alpha";
	readonly texture?: SurfaceTextureIdentity;
	readonly textureUseId: string | null;
	readonly tiling?: number;
	readonly wrap?: "repeat" | "clamp";
}): TerrainMaterialLayerPlan["layerEntries"][number]["base"] {
	return {
		role,
		texture,
		textureUseId,
		tiling,
		wrap,
	};
}

function surfaceTexture(surfaceTextureId: number): SurfaceTextureIdentity {
	return {
		kind: "surface-texture",
		surfaceTextureId,
	};
}
