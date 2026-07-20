import { describe, expect, it } from "vitest";
import type { Camera } from "../runtime/types";
import type { VisibleScene } from "../scene";
import type { TerrainDrawUnit } from "../terrain/types";
import type { TextureArrayBinding } from "../textures/texture-manager";
import type {
	GeneratedTextureKey,
	StandaloneTextureKey,
	TextureArrayKey,
} from "../textures/types";
import { RenderWorld } from "./render-world";
import type {
	GeometryResourceKey,
	Texture2DResourceKey,
} from "./resource-manager";
import type { GeometryKey } from "../geometry/types";

const CAMERA = {} as Camera;
const VISIBLE_SCENE = { entries: [] } as const satisfies VisibleScene;
const TERRAIN = {} as TerrainDrawUnit;
const GEOMETRY = "geometry-resource:1" as GeometryResourceKey;
const TEXTURE_2D = "texture-2d-resource:1" as Texture2DResourceKey;
const ARRAY = {
	layersByAssetId: new Map(),
	resource: "texture-array-resource:1",
} as TextureArrayBinding;

describe("RenderWorld", () => {
	it("exposes only renderer queries over live runtime systems", () => {
		const calls: string[] = [];
		const world = new RenderWorld({
			geometry: {
				getResource: () => {
					calls.push("geometry");
					return GEOMETRY;
				},
			},
			scene: {
				updateVisibility: () => {
					calls.push("scene");
					return VISIBLE_SCENE;
				},
			},
			terrain: {
				getDrawUnit: () => {
					calls.push("terrain");
					return TERRAIN;
				},
			},
			textures: {
				getTexture2DResource: () => {
					calls.push("texture-2d");
					return TEXTURE_2D;
				},
				getTextureArrayBinding: () => {
					calls.push("texture-array");
					return ARRAY;
				},
			},
		});

		expect(world.queryVisibleScene(CAMERA)).toBe(VISIBLE_SCENE);
		expect(world.resolveTerrainDrawUnit("0001", "0002")).toBe(TERRAIN);
		expect(world.resolveGeometry("terrain-geometry:0001" as GeometryKey)).toBe(
			GEOMETRY,
		);
		expect(
			world.resolveTexture2D("terrain-surface:0001/1" as GeneratedTextureKey),
		).toBe(TEXTURE_2D);
		expect(
			world.resolveTexture2D(
				"standalone-texture:terrain-detail:1" as StandaloneTextureKey,
			),
		).toBe(TEXTURE_2D);
		expect(
			world.resolveTextureArray(
				"texture-array:terrain-color:fixture" as TextureArrayKey,
			),
		).toBe(ARRAY);
		expect(calls).toEqual([
			"scene",
			"terrain",
			"geometry",
			"texture-2d",
			"texture-2d",
			"texture-array",
		]);
	});
});
