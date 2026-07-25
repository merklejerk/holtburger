import { describe, expect, it } from "vitest";
import type { Frustum } from "../math/frustum";
import { Vec3 } from "../math/types";
import type { Camera } from "../runtime/types";
import type { VisibleScene } from "../scene";
import type { TerrainDrawUnit } from "../terrain/types";
import type { TextureArrayBinding } from "../textures/texture-manager";
import type {
	GeneratedTextureKey,
	AssetTextureKey,
	TextureArrayKey,
} from "../textures/types";
import { RenderWorld } from "./render-world";
import type {
	GeometryResourceKey,
	Texture2DResourceKey,
} from "./resource-manager";
import type { GeometryKey } from "../geometry/types";
import type { StaticObjectRenderable } from "../commit/artifacts";
import type { InstanceStreamResourceKey } from "./resource-manager";

const CAMERA = {
	far: 10,
	fov: 90,
	near: 1,
	placement: {
		envCellId: null,
		landblockId: "0001",
		position: {},
		rotation: {},
	},
} as Camera;
const VISIBLE_SCENE = {
	crossings: [],
	entries: [],
} as const satisfies VisibleScene;
const FRUSTUM = {
	cameraPosition: Vec3.zero(),
	planes: [],
} as const satisfies Frustum;
const TERRAIN = {} as TerrainDrawUnit;
const GEOMETRY = "geometry-resource:1" as GeometryResourceKey;
const INSTANCE_STREAM =
	"instance-stream-resource:1" as InstanceStreamResourceKey;
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
			instances: {
				getResource: () => {
					calls.push("instances");
					return INSTANCE_STREAM;
				},
			},
			objectDetail: { getBinding: () => null },
			scene: {
				getResolvedPlacement: () => undefined,
				queryFrustum: () => {
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
			staticObjects: { getRenderable: () => null },
			dynamics: { getRenderable: () => null },
			envCells: {
				getCellRenderable: () => null,
				getPortalDrawUnit: () => null,
			},
			textures: {
				getAtlasBinding: () => {
					throw new Error("Fixture has no atlas textures.");
				},
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

		expect(world.queryVisibleScene(CAMERA, FRUSTUM, "0001")).toBe(
			VISIBLE_SCENE,
		);
		expect(world.resolveTerrainDrawUnit("0001", "0002")).toBe(TERRAIN);
		expect(world.resolveGeometry("terrain-geometry:0001" as GeometryKey)).toBe(
			GEOMETRY,
		);
		expect(
			world.resolveTexture2D("terrain-surface:0001/1" as GeneratedTextureKey),
		).toBe(TEXTURE_2D);
		expect(
			world.resolveTexture2D(
				"asset-texture:terrain-detail:1" as AssetTextureKey,
			),
		).toBe(TEXTURE_2D);
		expect(
			world.resolveTextureArray(
				"texture-array:terrain-color:fixture" as TextureArrayKey,
			),
		).toBe(ARRAY);
		const staticRenderable = {
			drawUnits: [
				{
					geometry: "static-source-geometry:fixture" as GeometryKey,
					indexCount: 3,
					indexStart: 0,
					kind: "instanced",
					instances: "static-instance-stream:static-install:1/cohort",
					material: {},
				},
			],
		} as StaticObjectRenderable;
		expect(world.resolveStaticObjectRenderable(staticRenderable)).toEqual([
			{
				drawUnit: staticRenderable.drawUnits[0],
				geometry: GEOMETRY,
				instances: INSTANCE_STREAM,
			},
		]);
		expect(calls).toEqual([
			"scene",
			"terrain",
			"geometry",
			"texture-2d",
			"texture-2d",
			"texture-array",
			"geometry",
			"instances",
		]);
	});
});
