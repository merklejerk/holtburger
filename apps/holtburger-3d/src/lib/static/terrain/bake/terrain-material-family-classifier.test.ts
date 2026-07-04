import { describe, expect, it } from "vitest";
import type {
	SurfaceTextureIdentity,
	TerrainMaterialLayerPlan,
} from "../../contracts";
import { classifyTerrainMaterialFamily } from "./terrain-material-family-classifier";

describe("terrain material family classifier", () => {
	it("classifies a single repeat color base as the first textured terrain family", () => {
		const classification = classifyTerrainMaterialFamily({
			domain: "outdoor-terrain",
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
				"shader:terrain-single-base-color|domain:outdoor-terrain|sampler:color-repeat-filterable|texture:terrain-base:06000010",
			materialFamily: "terrain-single-base-color",
			primaryTextureBindingId: "terrain-base:06000010",
			terrainFallbackReasons: [],
			textureBindingIds: ["terrain-base:06000010"],
		});
	});

	it("classifies prepared overlay bindings as layered terrain", () => {
		const classification = classifyTerrainMaterialFamily({
			domain: "outdoor-terrain",
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
				"shader:terrain-layered|domain:outdoor-terrain|sampler:color-mask-detail|textures:terrain-base:06000010,terrain-base:06000030,terrain-alpha:06000020|signature:test-plan",
			materialFamily: "terrain-layered",
			primaryTextureBindingId: "terrain-base:06000010",
			textureBindingIds: [
				"terrain-base:06000010",
				"terrain-base:06000030",
				"terrain-alpha:06000020",
			],
		});
		expect(classification.terrainFallbackReasons).toEqual([]);
	});

	it("classifies multiple prepared base textures as layered terrain", () => {
		const classification = classifyTerrainMaterialFamily({
			domain: "outdoor-terrain",
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

		expect(classification).toMatchObject({
			materialFamily: "terrain-layered",
			primaryTextureBindingId: "terrain-base:06000010",
			textureBindingIds: ["terrain-base:06000010", "terrain-base:06000020"],
		});
		expect(classification.terrainFallbackReasons).toEqual([]);
	});

	it("classifies prepared landscape detail as layered terrain", () => {
		const classification = classifyTerrainMaterialFamily({
			domain: "outdoor-terrain",
			plan: createPlan({
				detailRoles: [
					{
						fadeFar: 64,
						fadeNear: 8,
						role: "landscape",
						texture: createTextureRole({
							role: "detail",
							textureUseId: "detail:06000040",
						}),
					},
				],
				layerEntries: [
					createLayerEntry({
						textureUseId: "terrain-base:06000010",
					}),
				],
			}),
		});

		expect(classification).toMatchObject({
			materialFamily: "terrain-layered",
			textureBindingIds: ["terrain-base:06000010", "detail:06000040"],
		});
	});

	it("falls back when a layered binding is missing its prepared texture use", () => {
		const classification = classifyTerrainMaterialFamily({
			domain: "outdoor-terrain",
			plan: createPlan({
				layerEntries: [
					createLayerEntry({
						overlays: [
							{
								alpha: createTextureRole({
									role: "terrain-alpha",
									textureUseId: null,
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

		expect(classification.materialFamily).toBe("terrain-debug-flat");
		expect(classification.terrainFallbackReasons).toEqual([
			expect.objectContaining({
				code: "unsupported-material-binding",
				message: "Terrain material binding requires a prepared texture use.",
				pcode: 33825,
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
	readonly role?:
		| "terrain-base"
		| "terrain-alpha"
		| "road"
		| "road-alpha"
		| "detail";
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
