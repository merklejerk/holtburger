import { describe, expect, it, vi } from "vitest";
import type { Frustum } from "../math/frustum";
import { AABB3, Mat4, Vec3 } from "../math/types";
import type {
	ResolvedScenePlacement,
	SceneTopologyView,
	VisibleScene,
	SceneNodeId,
	SceneScope,
} from "../scene";
import { INCLUDE_ALL_SCENE_CULLING_GROUPS, SceneGraph } from "../scene";
import type { DynamicEntityPresentationClass } from "../dynamic-entity-presentation-class";
import { isEntityShadowCasterClass } from "./entity-shadow-policy";
import {
	createOutdoorPssmCasterBatch,
	createOutdoorPssmCasterSelectionScratch,
	planOutdoorShadowCastersForView,
	type OutdoorPssmCasterWorld,
} from "./outdoor-pssm-casters";
import type { EntityShadowCasterShape } from "./entity-grounding";
import { createDynamicDepthTestFixture } from "./dynamic-depth-test-fixture";
import type { TerrainDrawUnit } from "../terrain/types";
import { TERRAIN_TYPE_COUNT } from "../terrain/pcode";
import type { TextureArrayBinding } from "../textures/texture-manager";
import type {
	GeneratedTextureKey,
	AssetTextureKey,
	TextureArrayKey,
} from "../textures/types";
import { RenderWorld } from "./render-world";
import { CompiledObjectDrawStore } from "./compiled-object-draws";
import type {
	GeometryResourceKey,
	Texture2DResourceKey,
} from "./resource-manager";
import type { GeometryKey } from "../geometry/types";
import { compileDynamicLayout } from "../geometry/dynamic-layout";
import type { StaticGeometryKey } from "../systems/static-resources";
import type {
	EnvCellRenderable,
	StaticObjectRenderable,
} from "../commit/artifacts";
import type { ObjectMaterialBinding } from "../commit/artifacts";
import { TexturePurpose, TextureWrapMode } from "../textures/types";
import type { VisibleDynamicPresentation } from "../systems/components";

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
const ENV_CELL_PLACEMENT = {
	envCellId: "0x00010100",
	landblockId: "0x0001ffff",
	localToLandblock: Mat4.identity(),
	scope: {
		kind: "env-cell",
		landblockId: "0x0001ffff",
		envCellId: "0x00010100",
	},
} as const satisfies ResolvedScenePlacement;
const ENV_CELL_BOUNDS = new AABB3(Vec3.zero(), new Vec3(10, 10, 10));
const RIGID_DYNAMIC_BOUNDS = new AABB3(new Vec3(-1, -2, -3), new Vec3(4, 5, 6));
const ENV_CELL_RENDERABLE = { drawUnits: [] } satisfies EnvCellRenderable;
const TEXTURE_2D = "texture-2d-resource:1" as Texture2DResourceKey;
const ARRAY = {
	layersByAssetId: new Map(),
	purpose: TexturePurpose.TerrainBlendMask,
	resource: "texture-array-resource:1",
} as TextureArrayBinding;
const COLOR_ARRAY = {
	layersByAssetId: new Map(),
	palette: { colors: new Float32Array(TERRAIN_TYPE_COUNT * 3) },
	purpose: TexturePurpose.TerrainColor,
	resource: "texture-array-resource:2",
} as const;

describe("RenderWorld", () => {
	it("borrows frame inputs but owns static compilation placements across scene mutations", () => {
		const scene = new SceneGraph();
		const bounds = new AABB3(Vec3.zero(), new Vec3(1, 2, 1));
		const add = (cullingGroup: string) =>
			scene.createNode({
				cullingGroup,
				envCellId: null,
				landblockId: PLACEMENT.landblockId,
				localBounds: bounds,
				localTransform: Mat4.identity(),
				parentId: null,
			});
		const actor = add("dynamic"),
			building = add("buildings");
		const renderable: StaticObjectRenderable = {
			drawUnits: [],
			frameStreamedInstances: [],
		};
		const classes = new Map<SceneNodeId, DynamicEntityPresentationClass>([
			[actor, "mob"],
		]);
		const world = createShadowWorld(
			scene,
			classes,
			bounds,
			new Map([[building, renderable]]),
		);
		const copied = vi.spyOn(scene, "getResolvedPlacement");
		const dynamic = world.readRenderContribution(actor),
			fixed = world.readRenderContribution(building);
		if (
			dynamic?.kind !== "dynamic" ||
			fixed?.kind !== "static-object" ||
			fixed.footprint.kind !== "eligible"
		)
			throw new Error("Fixture needs both contribution kinds.");
		expect(dynamic.footprint.placement).toBe(
			scene.readResolvedState(actor)?.placement,
		);
		expect(fixed.footprint.placement).toBe(
			scene.readResolvedState(building)?.placement,
		);
		expect(fixed.footprint.localBounds).toBe(
			scene.readResolvedBounds(building)?.localBounds,
		);
		expect(world.getRenderScopeKey(actor)).toBe("outdoor");
		expect(copied).not.toHaveBeenCalled();
		const cache = new CompiledObjectDrawStore<
			ReturnType<RenderWorld["resolveStaticObjectNode"]>,
			never
		>();
		const compile = () => world.resolveStaticObjectNode(building, renderable);
		const retained = cache.resolveNodeSubmissions(
			renderable,
			"building",
			compile,
		);
		expect(cache.resolveNodeSubmissions(renderable, "building", compile)).toBe(
			retained,
		);
		expect(copied).toHaveBeenCalledTimes(1);
		expect(retained.placement.localToLandblock).not.toBe(
			fixed.footprint.placement.localToLandblock,
		);
		const moved = Mat4.identity();
		moved.m41 = 12;
		scene.updateRootPlacement(building, {
			envCellId: null,
			landblockId: PLACEMENT.landblockId,
			localTransform: moved,
		});
		const current = world.readRenderContribution(building);
		if (
			current?.kind !== "static-object" ||
			current.footprint.kind !== "eligible"
		)
			throw new Error("Building disappeared.");
		expect(current.footprint.placement.localToLandblock.m41).toBe(12);
		expect(retained.placement.localToLandblock.m41).toBe(0);
		expect(copied).toHaveBeenCalledTimes(1);
		expect(cache.resolveNodeSubmissions(renderable, "building", compile)).toBe(
			retained,
		);
		cache.flush("texture-filtering");
		const rebuilt = cache.resolveNodeSubmissions(
			renderable,
			"building",
			compile,
		);
		expect(rebuilt.placement.localToLandblock.m41).toBe(12);
		expect(retained.placement.localToLandblock.m41).toBe(0);
		expect(copied).toHaveBeenCalledTimes(2);
		scene.updateRootPlacement(actor, {
			envCellId: null,
			landblockId: PLACEMENT.landblockId,
			localTransform: moved,
		});
		const currentActor = world.readRenderContribution(actor);
		if (currentActor?.kind !== "dynamic") throw new Error("Actor disappeared.");
		expect(currentActor.footprint.placement.localToLandblock.m41).toBe(12);
		expect(copied).toHaveBeenCalledTimes(2);
		scene.destroyNode(actor);
		classes.delete(actor);
		expect(world.getRenderScopeKey(actor)).toBeNull();
		expect(world.readRenderContribution(actor)).toBeNull();
	});

	it("preserves actor cascade selection when non-casters are rejected before individual culling", () => {
		const scene = new SceneGraph();
		const classes = new Map<SceneNodeId, DynamicEntityPresentationClass>();
		const bounds = new AABB3(new Vec3(-1, 0, -1), new Vec3(1, 2, 1));
		const indoor = {
			kind: "env-cell",
			envCellId: "0x00010100",
			landblockId: PLACEMENT.landblockId,
		} as const;
		const outdoor = { kind: "outdoor" } as const;
		scene.upsertEnvCellScope({
			containmentPlanes: new Float32Array(),
			landblockBounds: bounds,
			potentiallyVisibleEnvCellIds: new Set(),
			scope: indoor,
			structureToLandblock: Mat4.identity(),
			seenOutside: true,
			visibilityIslandId: "env-cell-island:test",
		});
		const add = (
			entityClass: DynamicEntityPresentationClass,
			x: number,
			scopes: readonly SceneScope[],
		) => {
			const transform = Mat4.identity();
			transform.m41 = x;
			const id = scene.createNode({
				cullingGroup: "dynamic",
				envCellId: scopes.includes(outdoor) ? null : indoor.envCellId,
				landblockId: PLACEMENT.landblockId,
				localTransform: transform,
				parentId: null,
				localBounds:
					entityClass === "other"
						? new AABB3(
								new Vec3(-1000, -1000, -1000),
								new Vec3(1000, 1000, 1000),
							)
						: bounds,
				spatialMembership: { scopes },
			});
			classes.set(id, entityClass);
			return id;
		};
		const effect = add("other", 0, [outdoor]);
		const npc = add("npc", 3, [outdoor, indoor]);
		add("portal", 0, [outdoor]);
		const mob = add("mob", -4, [outdoor]);
		const player = add("player", 8, [outdoor]);
		add("mob", 1, [indoor]);
		const empty = add("mob", 0, [outdoor]);
		const indoorVisual = add("npc", 1, [outdoor, indoor]);
		const world = createShadowWorld(scene, classes, bounds, new Map());
		const frusta: Frustum[] = [
			{
				cameraPosition: Vec3.zero(),
				planes: [{ x: -1, y: 0, z: 0, constant: 5 }],
			},
			{
				cameraPosition: Vec3.zero(),
				planes: [{ x: 1, y: 0, z: 0, constant: 0 }],
			},
		];
		const camera = frusta[1];
		if (!camera) throw new Error("Fixture needs camera frustum.");
		const getDynamicDepth: OutdoorPssmCasterWorld["getDynamicDepth"] = (id) => {
			if (id === empty) return null;
			const depth = createDynamicDepthTestFixture(id, PLACEMENT.landblockId, 3);
			return id === indoorVisual ? { ...depth, renderScopes: [indoor] } : depth;
		};
		const select = (
			query: OutdoorPssmCasterWorld["queryOutdoorShadowCasters"],
			budget: { maximumMappedRoots: number; maximumSelectedRoots: number },
		) => {
			const batches = frusta.map(() => createOutdoorPssmCasterBatch());
			const selected = new Set<SceneNodeId>();
			const analytic: EntityShadowCasterShape[] = [];
			planOutdoorShadowCastersForView(
				{
					queryOutdoorShadowCasters: query,
					getDynamicDepth,
					readRenderContribution: (id) => world.readRenderContribution(id),
					getEntityShadowDynamicFacts: (id) =>
						world.getEntityShadowDynamicFacts(id),
				},
				frusta,
				camera,
				PLACEMENT.landblockId,
				budget,
				selected,
				analytic,
				false,
				batches,
				createOutdoorPssmCasterSelectionScratch(),
				null,
			);
			return { batches, selected: [...selected], analytic };
		};
		// Independent reference: query the unchanged scene, then apply the original late class rule.
		const reference: OutdoorPssmCasterWorld["queryOutdoorShadowCasters"] = (
			frustum,
			anchor,
		) => ({
			entries: [
				...scene.queryScopesFrustum(
					frustum,
					anchor,
					[outdoor],
					(group) => group === "dynamic",
					null,
				).entries,
			].filter((id) => {
				const descriptor = world.readRenderContribution(id);
				return (
					descriptor?.kind === "dynamic" &&
					isEntityShadowCasterClass(descriptor.entityClass)
				);
			}),
		});
		const colorBefore = [
			...world.queryFlatScene(
				FRUSTUM,
				PLACEMENT.landblockId,
				INCLUDE_ALL_SCENE_CULLING_GROUPS,
			).entries,
		];
		for (const budget of [
			{ maximumMappedRoots: 0, maximumSelectedRoots: 3 },
			{ maximumMappedRoots: 1, maximumSelectedRoots: 3 },
			{ maximumMappedRoots: 8, maximumSelectedRoots: 8 },
		]) {
			expect(
				select(
					(frustum, anchor) => world.queryOutdoorShadowCasters(frustum, anchor),
					budget,
				),
			).toEqual(select(reference, budget));
		}
		const complete = select(
			(frustum, anchor) => world.queryOutdoorShadowCasters(frustum, anchor),
			{ maximumMappedRoots: 8, maximumSelectedRoots: 8 },
		);
		expect(complete.selected).toEqual([npc, mob, player]);
		expect(
			complete.batches.map(({ casters }) =>
				casters.map(({ nodeId }) => nodeId),
			),
		).toEqual([
			[npc, mob],
			[npc, player],
		]);
		expect([
			...world.queryOutdoorShadowCasters(FRUSTUM, PLACEMENT.landblockId)
				.entries,
		]).toEqual([npc, mob, player, empty, indoorVisual]);
		// A committed source-class change is visible immediately, without scene reindexing.
		classes.set(effect, "mob");
		expect([
			...world.queryOutdoorShadowCasters(FRUSTUM, PLACEMENT.landblockId)
				.entries,
		]).toEqual([effect, npc, mob, player, empty, indoorVisual]);
		classes.delete(effect);
		expect([
			...world.queryOutdoorShadowCasters(FRUSTUM, PLACEMENT.landblockId)
				.entries,
		]).toEqual([npc, mob, player, empty, indoorVisual]);
		expect(
			world.queryFlatScene(
				FRUSTUM,
				PLACEMENT.landblockId,
				INCLUDE_ALL_SCENE_CULLING_GROUPS,
			).entries,
		).toEqual(colorBefore);
	});

	it("exposes only renderer queries over live runtime systems", () => {
		const calls: string[] = [];
		const presentation: VisibleDynamicPresentation = {
			identity: "fixture:dynamic",
			visual: {
				kind: "ready",
				parts: [],
				layout: compileDynamicLayout([]),
				appearance: { materials: [], ranges: [] },
			},
			landblockId: PLACEMENT.landblockId,
			renderScopes: [PLACEMENT.scope],
		};
		let selectedStaticRenderable: StaticObjectRenderable | null = null;
		let staticCullingGroup = "buildings";
		const world = new RenderWorld({
			oceanBackdrop: { readDrawUnits: () => [] },
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
				readResolvedState: (nodeId) => {
					const placement =
						nodeId === "scene-node:7"
							? ENV_CELL_PLACEMENT
							: nodeId === "scene-node:8" || nodeId === "scene-node:9"
								? PLACEMENT
								: null;
					return placement === null
						? undefined
						: { placement, spatialMembership: { scopes: [placement.scope] } };
				},
				readResolvedBounds: (nodeId) =>
					nodeId === "scene-node:8"
						? {
								localBounds: AABB3.zero(),
								placement: PLACEMENT,
							}
						: null,
				getResolvedPlacement: (nodeId) =>
					nodeId === "scene-node:7"
						? ENV_CELL_PLACEMENT
						: nodeId === "scene-node:8" || nodeId === "scene-node:9"
							? PLACEMENT
							: undefined,
				getResolvedSpatialMembership: (nodeId) =>
					nodeId === "scene-node:9" ? { scopes: [PLACEMENT.scope] } : undefined,
				queryEnvCellBounds: (envCellId) =>
					envCellId === ENV_CELL_PLACEMENT.envCellId ? ENV_CELL_BOUNDS : null,
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
				getVisiblePresentation: (nodeId) =>
					nodeId === "scene-node:9" ? presentation : null,
				getNameplatePopulationRevision: () => 0,
				forEachNameplateVisual: () => {},
				getNameplateFacts: () => null,
				getPresentationClass: (nodeId) =>
					nodeId === "scene-node:9" ? "mob" : null,
				getPresentationIdentity: (nodeId) =>
					nodeId === "scene-node:9" ? "guid:9" : null,
				getPublishedPresentationBounds: (nodeId) =>
					nodeId === "scene-node:9" ? AABB3.zero() : null,
				getPublishedRigidPresentationBounds: (nodeId) =>
					nodeId === "scene-node:9" ? RIGID_DYNAMIC_BOUNDS : null,
			},
			envCells: {
				getCellRenderable: (nodeId) =>
					nodeId === "scene-node:7" ? ENV_CELL_RENDERABLE : null,
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
				getTerrainColorTextureArrayBinding: () => COLOR_ARRAY,
			},
		});

		expect(world.queryOutdoorShadowCasters(FRUSTUM, "0001")).toBe(
			VISIBLE_SCENE,
		);
		expect(
			world.queryFlatScene(FRUSTUM, "0001", INCLUDE_ALL_SCENE_CULLING_GROUPS),
		).toBe(VISIBLE_SCENE);
		expect(world.getPortalTopologyView()).toBe(TOPOLOGY);
		expect(world.resolveTerrainDrawUnit("scene-node:1")).toBe(TERRAIN);
		expect(world.readRenderContribution("scene-node:9")).toEqual({
			entityClass: "mob",
			footprint: {
				kind: "eligible",
				localBounds: AABB3.zero(),
				objectClass: "authored-dynamic",
				placement: PLACEMENT,
			},
			kind: "dynamic",
		});
		expect(world.getEntityShadowDynamicFacts("scene-node:9")).toEqual({
			identity: "guid:9",
			rigidBounds: RIGID_DYNAMIC_BOUNDS,
			spatialMembership: { scopes: [PLACEMENT.scope] },
		});
		expect(world.readRenderContribution("scene-node:7")).toEqual({
			kind: "env-cell",
			renderable: ENV_CELL_RENDERABLE,
		});
		expect(world.getIndoorGroundingEnvCellFacts("scene-node:7")).toEqual({
			bounds: ENV_CELL_BOUNDS,
			scope: ENV_CELL_PLACEMENT.scope,
		});
		expect(world.getVisibleDynamicPresentation("scene-node:9")).toBe(
			presentation,
		);
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
					materialSelector: 0,
					indexCount: 3,
					indexStart: 0,
					material: staticMaterial(),
					ordering: "opaque",
					retailVisibility: "normally-visible",
					transparentSort: null,
				},
			],
			frameStreamedInstances: [],
		} satisfies StaticObjectRenderable;
		selectedStaticRenderable = staticRenderable;
		expect(world.readRenderContribution("scene-node:8")).toMatchObject({
			cullingGroup: "buildings",
			footprint: {
				kind: "eligible",
				localBounds: AABB3.zero(),
				objectClass: "building",
				placement: PLACEMENT,
			},
			kind: "static-object",
			renderable: staticRenderable,
		});
		staticCullingGroup = "generated";
		expect(world.readRenderContribution("scene-node:8")).toMatchObject({
			footprint: {
				kind: "ineligible",
				reason: "generated-instance-container",
			},
		});
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
			"geometry",
			"texture-2d",
			"texture-2d",
			"texture-array",
			"geometry",
		]);
	});
});

/** Real scene queries with only the dynamic publication facts consumed by shadow selection. */
function createShadowWorld(
	scene: SceneGraph,
	classes: ReadonlyMap<SceneNodeId, DynamicEntityPresentationClass>,
	bounds: AABB3,
	staticObjects: ReadonlyMap<SceneNodeId, StaticObjectRenderable>,
): RenderWorld {
	const unused = (): never => {
		throw new Error("Unexpected shadow fixture dependency.");
	};
	return new RenderWorld({
		scene,
		oceanBackdrop: { readDrawUnits: unused },
		staticDetails: { getBinding: unused },
		staticObjects: { getRenderable: (id) => staticObjects.get(id) ?? null },
		terrain: { getDrawUnit: () => null },
		envCells: { getCellRenderable: () => null, getPortalDrawUnit: unused },
		geometry: { getResource: unused },
		textures: {
			getAtlasBinding: unused,
			getTexture2DResource: unused,
			getTextureArrayBinding: unused,
			getTerrainColorTextureArrayBinding: unused,
		},
		dynamics: {
			getPresentationClass: (id) => classes.get(id) ?? null,
			getPresentationIdentity: (id) => (classes.has(id) ? id : null),
			getPublishedPresentationBounds: (id) => (classes.has(id) ? bounds : null),
			getPublishedRigidPresentationBounds: (id) =>
				classes.has(id) ? bounds : null,
			getNameplatePopulationRevision: unused,
			forEachNameplateVisual: unused,
			getNameplateFacts: unused,
			getVisiblePresentation: unused,
		},
	});
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
