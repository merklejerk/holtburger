import { describe, expect, it } from "vitest";
import type { Frustum } from "../math/frustum";
import { AABB3, Mat4, Vec3 } from "../math/types";
import type {
	ResolvedScenePlacement,
	SceneTopologyView,
	VisibleScene,
} from "../scene";
import { INCLUDE_ALL_SCENE_CULLING_GROUPS } from "../scene";
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
import type { GeometryKey, ObjectGeometryKey } from "../geometry/types";
import type { StaticGeometryKey } from "../systems/static-resources";
import type { StaticObjectRenderable } from "../commit/artifacts";
import type { ObjectMaterialBinding } from "../commit/artifacts";
import { TextureWrapMode } from "../textures/types";
import { landblockVec3 } from "../../assets/ac-frame";
import type {
	PartVisualTemplateKey,
	VisibleRigidPartContribution,
} from "../systems/components";

const VISIBLE_SCENE = {
	entries: [],
} as const satisfies VisibleScene;
const TOPOLOGY = {
	crossings: [],
	outgoing: () => [],
	revision: 1,
	scopes: [],
} as const satisfies SceneTopologyView;
const FRUSTUM = {
	cameraPosition: Vec3.zero(),
	planes: [],
} as const satisfies Frustum;
const TERRAIN = {} as TerrainDrawUnit;
const GEOMETRY = "geometry-resource:1" as GeometryResourceKey;
const PLACEMENT = {
	envCellId: null,
	landblockId: "0x0001ffff",
	localToLandblock: Mat4.identity(),
	scope: { kind: "outdoor" },
} as const satisfies ResolvedScenePlacement;
const TEXTURE_2D = "texture-2d-resource:1" as Texture2DResourceKey;
const ARRAY = {
	layersByAssetId: new Map(),
	resource: "texture-array-resource:1",
} as TextureArrayBinding;

describe("RenderWorld", () => {
	it("exposes only renderer queries over live runtime systems", () => {
		const calls: string[] = [];
		const dynamic = dynamicContribution();
		let selectedStaticRenderable: StaticObjectRenderable | null = null;
		let staticCullingGroup = "buildings";
		const world = new RenderWorld({
			geometry: {
				getResource: () => {
					calls.push("geometry");
					return GEOMETRY;
				},
			},
			staticDetails: { getBinding: () => null },
			scene: {
				getPortalTopologyView: () => {
					calls.push("topology");
					return TOPOLOGY;
				},
				getCullingGroup: () => staticCullingGroup,
				getResolvedBounds: (nodeId) =>
					nodeId === "scene-node:8"
						? {
								localBounds: AABB3.zero(),
								placement: PLACEMENT,
							}
						: null,
				getResolvedPlacement: (nodeId) =>
					nodeId === "scene-node:8" || nodeId === "scene-node:9"
						? PLACEMENT
						: undefined,
				queryScopesFrustum: () => {
					calls.push("scene-scopes");
					return VISIBLE_SCENE;
				},
				queryScopeSelectionFrustum: () => {
					throw new Error("not used");
				},
				queryFlatFrustum: () => {
					calls.push("scene-flat");
					return VISIBLE_SCENE;
				},
			},
			terrain: {
				getDrawUnit: () => {
					calls.push("terrain");
					return TERRAIN;
				},
			},
			staticObjects: {
				getRenderable: (nodeId) =>
					nodeId === "scene-node:8" ? selectedStaticRenderable : null,
			},
			dynamics: {
				getPublishedPresentationBounds: (nodeId) =>
					nodeId === "scene-node:9" ? AABB3.zero() : null,
				getVisibleContributions: (nodeId) => {
					calls.push("dynamic-expand");
					return nodeId === "scene-node:9" ? [dynamic] : null;
				},
			},
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

		expect(
			world.queryScopesScene(
				FRUSTUM,
				"0001",
				[{ kind: "outdoor" }],
				INCLUDE_ALL_SCENE_CULLING_GROUPS,
			),
		).toBe(VISIBLE_SCENE);
		expect(
			world.queryFlatScene(FRUSTUM, "0001", INCLUDE_ALL_SCENE_CULLING_GROUPS),
		).toBe(VISIBLE_SCENE);
		expect(world.getPortalTopologyView()).toBe(TOPOLOGY);
		expect(world.resolveTerrainDrawUnit("scene-node:1")).toBe(TERRAIN);
		expect(world.getRenderContributionDescriptor("scene-node:9")).toEqual({
			footprint: {
				kind: "eligible",
				localBounds: AABB3.zero(),
				objectClass: "authored-dynamic",
				placement: PLACEMENT,
			},
			kind: "dynamic",
		});
		expect(calls).not.toContain("dynamic-expand");
		expect(world.expandDynamicContributions("scene-node:9")).toEqual([dynamic]);
		expect(world.resolveDynamicContributions([dynamic])).toEqual([
			{ drawUnit: dynamic, geometry: GEOMETRY },
		]);
		const translucent = dynamicContribution("transparent", 0.6);
		expect(world.resolveDynamicContributions([translucent])).toEqual([
			{
				drawUnit: expect.objectContaining({
					drawUnit: expect.objectContaining({ ordering: "transparent" }),
					instance: expect.objectContaining({
						color: expect.objectContaining({ a: 0.6 }),
					}),
					transparentSort: expect.objectContaining({ stableId: "part/range" }),
				}),
				geometry: GEOMETRY,
			},
		]);
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
					geometry: "static-source-geometry:fixture" as StaticGeometryKey,
					indexCount: 3,
					indexStart: 0,
					material: staticMaterial(),
					ordering: "opaque",
					transparentSort: null,
				},
			],
			frameStreamedInstances: [],
		} satisfies StaticObjectRenderable;
		selectedStaticRenderable = staticRenderable;
		expect(world.getRenderContributionDescriptor("scene-node:8")).toMatchObject(
			{
				cullingGroup: "buildings",
				footprint: {
					kind: "eligible",
					localBounds: AABB3.zero(),
					objectClass: "building",
					placement: PLACEMENT,
				},
				kind: "static-object",
				renderable: staticRenderable,
			},
		);
		staticCullingGroup = "generated";
		expect(world.getRenderContributionDescriptor("scene-node:8")).toMatchObject(
			{
				footprint: {
					kind: "ineligible",
					reason: "generated-instance-container",
				},
			},
		);
		expect(world.resolveStaticObjectRenderable(staticRenderable)).toEqual([
			{
				drawUnit: staticRenderable.drawUnits[0],
				geometry: GEOMETRY,
			},
		]);
		expect(calls).toEqual([
			"scene-scopes",
			"scene-flat",
			"topology",
			"terrain",
			"dynamic-expand",
			"geometry",
			"geometry",
			"geometry",
			"texture-2d",
			"texture-2d",
			"texture-array",
			"geometry",
		]);
	});
});

function dynamicContribution(
	ordering: "opaque" | "transparent" = "opaque",
	alpha = 1,
): VisibleRigidPartContribution {
	return {
		domain: {
			key: "0x0001ffff/outdoor",
			landblockId: "0x0001ffff",
			scope: { kind: "outdoor" },
		},
		drawUnit: {
			batchKey: "part/range",
			geometry: "object-geometry:fixture" as ObjectGeometryKey,
			indexCount: 3,
			indexStart: 0,
			material: staticMaterial(),
			ordering,
			partIndex: 0,
			templatePartKey: "part-visual-template:fixture" as PartVisualTemplateKey,
		},
		instance: {
			color: { a: alpha, b: 1, g: 1, r: 1 },
			sourceToLandblock: Mat4.identity(),
		},
		ordering,
		transparentSort:
			ordering === "transparent"
				? { center: landblockVec3(Vec3.zero()), stableId: "part/range" }
				: null,
	};
}

function staticMaterial(): ObjectMaterialBinding {
	return {
		detailRole: null,
		palettedClipMap: false,
		polygon: {
			cullFace: "back",
			stippled: false,
		},
		sampler: {
			wrap: TextureWrapMode.Clamp,
		},
		source: {
			color: [1, 1, 1, 1],
			diffuseScale: 1,
			id: "material:render-world-test",
			kind: "solid-color",
			luminosity: 0,
			rawSurfaceFlags: 0,
			translucency: 0,
		},
		textures: { base: null, palette: null },
	};
}
