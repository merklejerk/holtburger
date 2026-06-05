import { describe, expect, it } from "vitest";

import {
	createInitialAssetChannelState,
	formatAtlasReadyPreparedTextureAssetId,
	type AssetChannelState,
	type PreparedMaterialRecipePayload,
	type PreparedPalettePayload,
	type PreparedPolygonSetBspNode,
	type PreparedTerrainMesh,
	type PreparedPolygonSetRenderGeometry,
	type PreparedRenderSurfacePayload,
	type PreparedTexturePayload,
} from "../assets/types";
import { formatHex32 } from "../landblocks";
import {
	createEmptyCompactionFamilyPlan,
	type CompactionFamilyPlan,
	type IndexedPalettedFamilyMaterialTableRecord,
} from "./compaction/compaction-family-planner";
import { createBaseMaterialAppearanceContext } from "./material-appearance";
import type { ResolvedMaterialSlot } from "./material-plan";
import { WORLD_RENDER_DOMAIN } from "./render-domains";
import { RendererResourceGraph } from "./renderer-resource-graph";
import { RenderResourceWorkerClient } from "./render-resource-worker-client";
import type { RenderResourceWorkerLike } from "./render-resource-worker-client";
import type { RenderChunkTransform } from "./render-anchor";
import {
	createEmptyStaticRenderableSceneModel,
	type StaticRenderablePart,
} from "./static-renderables";
import type { StructuredInteriorCell } from "./structured-interior-scene";
import type { IndexedResourceAtlasPlan } from "./texture-pages/indexed-resource-atlas-planner";
import { createEmptyTexturePageAtlasPlan } from "./texture-pages/texture-page-atlas-planner";
import type { LandblockTerrainRenderArtifact } from "./terrain-render-artifact";
import type { LandblockRenderProductWorkerResult } from "./landblock-render-product";
import type { TerrainSceneModel } from "./terrain-scene";
import {
	buildTerrainTileLayerGeometry,
	type TerrainTileLayerPlan,
} from "./terrain-tile-plan";
import { createEmptyTransitionPortalCandidateModel } from "./transition-portal-work-items";
import {
	commitWebgl2IndexedResourceAtlasGeneration,
	commitWebgl2TextureAtlasGeneration,
	createWebgl2WorldResourceStore,
	destroyWebgl2WorldResources,
	markWebgl2CompactedGeometryBatchReplacementPending,
	markWebgl2IndexedResourceAtlasGenerationReplacementPending,
	markWebgl2TextureAtlasGenerationReplacementPending,
	syncWebgl2StaticLandblockRenderArtifactResources,
	syncWebgl2WorldResources,
	type Webgl2WorldResourceStore,
} from "./webgl2-world-resources";
import type { StaticLandblockRenderArtifactStoreSnapshot } from "./static-landblock-render-artifact-store";
import type { StaticObjectBundleArtifact } from "./static-bundle-layer";
import {
	createIndexedPalettedCompactedLandblockBatchPlans,
	shouldRetainWebgl2CompactedGeometryBatch,
} from "./webgl2/resources/compacted-geometry-sync";
import type { Webgl2IndexedResourceAtlasGenerationResource } from "./webgl2/resources/indexed-resource-atlas-generation";
import type { Webgl2TextureAtlasGenerationResource } from "./webgl2/resources/texture-atlas-generation";
import { CompactedGeometryWorkerScheduler } from "./worker-resources/compacted-geometry-worker-scheduler";
import { TextureAtlasWorkerScheduler } from "./worker-resources/texture-atlas-worker-scheduler";
import type {
	RenderResourceWorkerRequestMessage,
} from "../../workers/render-resource-worker";
import type { RenderMat4 } from "./render-math";
import type { StagedWorldDrawUnitAssembly } from "./staged-world-assembly";

describe("webgl2 world resources", () => {
	it("keeps committed texture atlas generation alive while a replacement is pending", () => {
		const disposedKeys: string[] = [];
		const store = createWebgl2WorldResourceStore();
		const previous = createTextureAtlasGeneration(
			"texture-atlas/previous",
			disposedKeys,
		);
		const next = createTextureAtlasGeneration(
			"texture-atlas/next",
			disposedKeys,
		);
		store.textureAtlasGeneration = previous;

		markWebgl2TextureAtlasGenerationReplacementPending({
			store,
			generationKey: next.key,
		});

		expect(store.textureAtlasGeneration).toBe(previous);
		expect(store.pendingTextureAtlasGenerationKey).toBe(next.key);
		expect(disposedKeys).toEqual([]);

		commitWebgl2TextureAtlasGeneration({ store, generation: next });

		expect(store.textureAtlasGeneration).toBe(next);
		expect(store.pendingTextureAtlasGenerationKey).toBeNull();
		expect(disposedKeys).toEqual([previous.key]);
	});

	it("keeps committed indexed atlas generation alive while a replacement is pending", () => {
		const disposedKeys: string[] = [];
		const store = createWebgl2WorldResourceStore();
		const previous = createIndexedAtlasGeneration(
			"indexed-atlas/previous",
			disposedKeys,
		);
		const next = createIndexedAtlasGeneration(
			"indexed-atlas/next",
			disposedKeys,
		);
		store.indexedResourceAtlasGeneration = previous;

		markWebgl2IndexedResourceAtlasGenerationReplacementPending({
			store,
			generationKey: next.key,
		});

		expect(store.indexedResourceAtlasGeneration).toBe(previous);
		expect(store.pendingIndexedResourceAtlasGenerationKey).toBe(next.key);
		expect(disposedKeys).toEqual([]);

		commitWebgl2IndexedResourceAtlasGeneration({ store, generation: next });

		expect(store.indexedResourceAtlasGeneration).toBe(next);
		expect(store.pendingIndexedResourceAtlasGenerationKey).toBeNull();
		expect(disposedKeys).toEqual([previous.key]);
	});

	it("retains compacted geometry batches protected by pending replacement work", () => {
		const store = createWebgl2WorldResourceStore();

		expect(
			shouldRetainWebgl2CompactedGeometryBatch({
				store,
				batchKey: "batch/old",
				retainedGeometryBatchKeys: new Set(),
			}),
		).toBe(false);

		markWebgl2CompactedGeometryBatchReplacementPending({
			store,
			batchKey: "batch/old",
		});

		expect(
			shouldRetainWebgl2CompactedGeometryBatch({
				store,
				batchKey: "batch/old",
				retainedGeometryBatchKeys: new Set(),
			}),
		).toBe(true);
	});

	it("syncs resident outdoor static bundle layers into WebGL resources", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2WorldResourceStore();
		const firstSnapshot = createStaticLandblockArtifactSnapshot([
			createStaticBundleLayer("static-layer", "revision-a"),
		]);

		syncWebgl2StaticLandblockRenderArtifactResources({
			gl: gl.asContext(),
			store,
			artifacts: firstSnapshot,
		});

		expect(store.staticBundleLayerResourceCount).toBe(1);
		expect(store.staticBundleLayerCompactedBatchResourceCount).toBe(1);
		expect(store.staticBundleLayerDirectEntryResourceCount).toBe(1);
		expect(store.staticBundleLayerTexturePageResourceCount).toBe(1);
		expect(gl.createdTextures).toHaveLength(1);

		syncWebgl2StaticLandblockRenderArtifactResources({
			gl: gl.asContext(),
			store,
			artifacts: firstSnapshot,
		});

		expect(gl.createdTextures).toHaveLength(1);

		syncWebgl2StaticLandblockRenderArtifactResources({
			gl: gl.asContext(),
			store,
			artifacts: createStaticLandblockArtifactSnapshot([
				createStaticBundleLayer("static-layer", "revision-b"),
			]),
		});

		expect(store.staticBundleLayerResourceCount).toBe(1);
		expect(gl.createdTextures).toHaveLength(2);
		expect(gl.deletedTextures).toHaveLength(1);

		syncWebgl2StaticLandblockRenderArtifactResources({
			gl: gl.asContext(),
			store,
			artifacts: createStaticLandblockArtifactSnapshot([]),
		});

		expect(store.staticBundleLayerResourceCount).toBe(0);
		expect(gl.deletedTextures).toHaveLength(2);
	});

	it("syncs additive outdoor and env-cell static bundle products independently", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2WorldResourceStore();
		const landblockId = 0xda55ffff;

		syncWebgl2StaticLandblockRenderArtifactResources({
			gl: gl.asContext(),
			store,
			artifacts: createStaticLandblockProductArtifactSnapshot([
				createStaticLandblockProductArtifact({
					landblockId,
					product: "outdoor",
					layers: [
						createStaticBundleLayer("static-layer/buildings", "revision-a", {
							landblockId,
							bundleKind: "outdoor-buildings",
						}),
					],
				}),
				createStaticLandblockProductArtifact({
					landblockId,
					product: "outdoor-env-cells",
					layers: [
						createStaticBundleLayer("static-layer/env-cell", "revision-a", {
							landblockId,
							bundleKind: "env-cell-static",
						}),
					],
				}),
			]),
		});

		expect(store.staticBundleLayerResourceCount).toBe(2);
		expect(
			[...store.staticBundleLayerResources.layersByKey.keys()].sort(),
		).toEqual([
			"static-layer/buildings:revision-a",
			"static-layer/env-cell:revision-a",
		]);
		expect(gl.createdTextures).toHaveLength(2);
	});

	it("syncs dungeon env-cell static bundle products without outdoor resources", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2WorldResourceStore();
		const landblockId = 0xda55ffff;

		syncWebgl2StaticLandblockRenderArtifactResources({
			gl: gl.asContext(),
			store,
			artifacts: createStaticLandblockProductArtifactSnapshot([
				createStaticLandblockProductArtifact({
					landblockId,
					product: "dungeon-env-cells",
					layers: [
						createStaticBundleLayer("static-layer/dungeon-env", "revision-a", {
							landblockId,
							bundleKind: "env-cell-static",
						}),
					],
				}),
			]),
		});

		expect(store.staticBundleLayerResourceCount).toBe(1);
		expect([...store.staticBundleLayerResources.layersByKey.keys()]).toEqual([
			"static-layer/dungeon-env:revision-a",
		]);
		expect(gl.createdTextures).toHaveLength(1);
	});

	it("syncs worker detailed structured interiors as direct WebGL resources", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2WorldResourceStore();
		const cell = createStructuredInteriorCell();

		syncWebgl2StaticLandblockRenderArtifactResources({
			gl: gl.asContext(),
			store,
			artifacts: createStaticLandblockProductArtifactSnapshot([
				createDetailedLandblockProductArtifact(cell),
			]),
			renderChunkTransforms: [createChunkTransform()],
			textureFilteringMode: "linear",
		});
		const resource = [
			...store.structuredInteriorResources.cellsByKey.values(),
		][0];

		expect(store.structuredInteriorResourceCount).toBe(1);
		expect(store.structuredInteriorResourceTriangleCount).toBe(1);
		expect(store.structuredInteriorResources.cellsByKey.size).toBe(1);
		expect(gl.createdBuffers).toHaveLength(3);
		expect(gl.createdVertexArrays).toHaveLength(1);
		expect(gl.createdTextures).toHaveLength(1);
		expect(gl.generatedMipmapCount).toBe(1);

		syncWebgl2StaticLandblockRenderArtifactResources({
			gl: gl.asContext(),
			store,
			artifacts: createStaticLandblockProductArtifactSnapshot([
				createDetailedLandblockProductArtifact(cell),
			]),
			renderChunkTransforms: [createChunkTransform()],
			textureFilteringMode: "nearest",
		});

		expect([...store.structuredInteriorResources.cellsByKey.values()][0]).toBe(
			resource,
		);
		expect(gl.createdBuffers).toHaveLength(3);
		expect(gl.createdTextures).toHaveLength(1);
		expect(gl.generatedMipmapCount).toBe(1);
		expect(gl.textureParameters).toContainEqual({
			pname: gl.TEXTURE_MIN_FILTER,
			param: gl.NEAREST,
		});

		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState: createAssetState(),
			terrainScene: createTerrainScene(),
			staticRenderableScene: createStaticRenderableScene([]),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform()],
		});

		expect(
			store.drawUnits.some(
				(drawUnit) => drawUnit.kind === "structured-interior",
			),
		).toBe(false);
	});

	it("realizes appearance preview draw units as retained WebGL2 resources", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2WorldResourceStore();
		const graph = new RendererResourceGraph();
		const part = createStaticPart();

		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState: createAssetState(),
			terrainScene: createTerrainScene(),
			staticRenderableScene: createStaticRenderableScene([part]),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform()],
			rendererResourceGraph: graph,
		});

		expect(store.drawUnits).toHaveLength(1);
		expect(store.appearancePreviewDrawUnitCount).toBe(1);
		expect(store.appearancePreviewInstanceCount).toBe(1);
		expect(store.triangleCount).toBe(1);
		expect(store.drawUnits[0]?.directGeometryLayout).toBe("position");
		expect(gl.createdBuffers).toHaveLength(2);
		expect(gl.createdVertexArrays).toHaveLength(1);
		expect(graph.retainedPreparedAssetIds()).toEqual(["gfx-obj/01000001"]);

		const vertexBuffer = store.drawUnits[0]?.vertexBuffer;
		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState: createAssetState(),
			terrainScene: createTerrainScene(),
			staticRenderableScene: createStaticRenderableScene([part]),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [
				createChunkTransform({ offset: { x: 40, y: 50, z: 60 } }),
			],
			rendererResourceGraph: graph,
		});

		expect(store.drawUnits[0]?.vertexBuffer).toBe(vertexBuffer);
		expect(store.drawUnits[0]?.modelMatrix[12]).toBe(40);
		expect(gl.deletedBuffers).toHaveLength(0);
	});

	it("realizes terrain tile resources without generic draw-unit compatibility output", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2WorldResourceStore();
		const graph = new RendererResourceGraph();
		const terrainScene = createTerrainScene([createTerrainTile()]);

		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState: createAssetState(),
			terrainScene,
			staticRenderableScene: createStaticRenderableScene([]),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [
				createChunkTransform({ landblockId: 0x1234ffff }),
			],
			rendererResourceGraph: graph,
		});

		expect(store.terrainTiles).toHaveLength(1);
		expect(store.terrainTileCount).toBe(1);
		expect(store.terrainDrawUnitCount).toBe(0);
		expect(store.terrainTiles[0]).toMatchObject({
			id: "terrain-tile/terrain/12340000",
			landblockId: 0x12340000,
			readiness: {
				status: "fallback-debug",
				reason: "terrain material resources are unresolved",
			},
			bvhFallbackReason: null,
		});
		expect(store.terrainTiles[0]?.bvhItemKeys).toEqual([
			"terrain:landblock:12340000:quad:0",
		]);
		expect(store.terrainTiles[0]?.texturePageBindings).toEqual([]);
		expect(store.terrainTiles[0]?.texturePageBlockers).toEqual([
			"terrain tile has no terrain blend page inputs",
		]);
		expect(store.terrainTiles[0]?.layerPlan).toBeNull();
		expect(store.terrainTiles[0]?.layerPlanBlockers).toEqual([
			"terrain material resources are unresolved",
		]);
		expect(store.terrainTiles[0]?.oneDrawReadiness).toEqual({
			status: "blocked",
			blockers: [
				"terrain material resources are unresolved",
				"terrain tile has no layer plan",
				"terrain tile has no terrain blend page inputs",
				"terrain tile one-draw geometry has no layer-slot buffer",
				"terrain tile one-draw geometry has no uv buffer",
			],
		});
		expect(store.terrainRenderCandidates).toEqual([
			{
				id: "terrain-tile/terrain/12340000",
				terrainTileId: "terrain-tile/terrain/12340000",
				landblockId: 0x12340000,
				sceneDomain: "exterior",
				bvhItemKeys: ["terrain:landblock:12340000:quad:0"],
				bvhFallbackReason: null,
			},
		]);
		expect(graph.retainedPreparedAssetIds()).toEqual(["terrain/12340000"]);

		const vertexBuffer = store.terrainTiles[0]?.vertexBuffer;
		const firstCandidate = store.terrainRenderCandidates[0];
		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState: createAssetState(),
			terrainScene,
			staticRenderableScene: createStaticRenderableScene([]),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [
				createChunkTransform({
					landblockId: 0x1234ffff,
					offset: { x: 40, y: 50, z: 60 },
				}),
			],
			rendererResourceGraph: graph,
		});

		expect(store.terrainTiles[0]?.vertexBuffer).toBe(vertexBuffer);
		expect(store.terrainTiles[0]?.modelMatrix[12]).toBe(40);
		expect(store.terrainRenderCandidates[0]).toEqual(firstCandidate);

		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState: createAssetState(),
			terrainScene: createTerrainScene([]),
			staticRenderableScene: createStaticRenderableScene([]),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [
				createChunkTransform({ landblockId: 0x1234ffff }),
			],
			rendererResourceGraph: graph,
		});

		expect(store.terrainTiles).toEqual([]);
		expect(store.terrainRenderCandidates).toEqual([]);
		expect(store.terrainTilesById.size).toBe(0);
		expect(graph.retainedPreparedAssetIds()).toEqual([]);
		expect(gl.deletedVertexArrays.length).toBeGreaterThan(0);
	});

	it("keeps layer-limit terrain draw slices ready for atlas rendering", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2WorldResourceStore();
		installTextureAtlasWorkerScheduler(store);
		const graph = new RendererResourceGraph();
		const terrainCodes = [1, 2, 3, 4, 5, 6, 7, 8, 9];
		const assetState = createAssetStateWithTerrainMaterials(terrainCodes);
		const terrainScene = createTerrainScene([
			createReadyTerrainTile({
				pcodes: terrainCodes.map(encodeUniformTerrainPcode),
			}),
		]);

		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState,
			terrainScene,
			staticRenderableScene: createStaticRenderableScene([]),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [
				createChunkTransform({ landblockId: 0x1234ffff }),
			],
			rendererResourceGraph: graph,
		});

		const tile = store.terrainTiles[0];
		expect(tile?.layerPlan?.blockers).toEqual([
			"terrain tile requires 9 layer entries; limit is 8",
		]);
		expect(tile?.oneDrawReadiness).toMatchObject({ status: "blocked" });
		expect(tile?.drawSlices).toHaveLength(2);
		expect(
			tile?.drawSlices.map((slice) => slice.oneDrawReadiness.status),
		).toEqual(["ready", "ready"]);
		expect(
			tile?.drawSlices.map((slice) => slice.texturePageBindings.length),
		).toEqual([8, 1]);
		expect(
			tile?.texturePageBlockers.includes(
				"terrain tile has no terrain blend page inputs",
			),
		).toBe(false);
		expect(
			store.texturePageAtlasPlan?.families.map((family) => family.family),
		).toContain("terrain-color");
	});

	it("realizes worker terrain artifacts from artifact geometry and page refs", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2WorldResourceStore();
		installTextureAtlasWorkerScheduler(store);
		const graph = new RendererResourceGraph();
		const renderSurfaceId = 0x06000010;
		const terrainTile = createWorkerArtifactTerrainTile({
			pcode: encodeUniformTerrainPcode(1),
			renderSurfaceId,
		});

		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState: createAssetState(),
			terrainScene: createTerrainScene([terrainTile]),
			staticRenderableScene: createStaticRenderableScene([]),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [
				createChunkTransform({ landblockId: 0x1234ffff }),
			],
			rendererResourceGraph: graph,
		});

		const tile = store.terrainTiles[0];
		expect(tile?.id).toBe("terrain-tile/terrain-artifact/12340000");
		expect(tile?.geometrySignature).toContain(
			"terrain-artifact/12340000/slice/0",
		);
		expect(tile?.terrainArtifactTexturePageRefs).toHaveLength(1);
		expect(tile?.drawSlices).toEqual([]);
		expect(tile?.layerPlanBlockers).toEqual([]);
		expect(store.terrainAtlasRefCount).toBe(1);
		expect(store.terrainAtlasCandidateCount).toBe(1);
		expect(store.texturePageAtlasPlan.preparedTextureAssetIds).toEqual([
			"terrain-artifact-texture/terrain-artifact/12340000/terrain-page:color:surface-texture/05000010:100663312:21",
		]);
		expect(
			store.texturePageAtlasPlan.families.map((family) => family.family),
		).toContain("terrain-color");
		expect(
			tile?.texturePageBlockers.includes(
				"terrain tile has no terrain blend page inputs",
			),
		).toBe(false);
	});

	it("disposes orphaned draw units and graph leases", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2WorldResourceStore();
		const graph = new RendererResourceGraph();

		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState: createAssetState(),
			terrainScene: createTerrainScene(),
			staticRenderableScene: createStaticRenderableScene([createStaticPart()]),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform()],
			rendererResourceGraph: graph,
		});
		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState: createAssetState(),
			terrainScene: createTerrainScene(),
			staticRenderableScene: createStaticRenderableScene([]),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform()],
			rendererResourceGraph: graph,
		});

		expect(store.drawUnits).toEqual([]);
		expect(gl.deletedVertexArrays).toHaveLength(1);
		expect(gl.deletedBuffers).toHaveLength(2);
		expect(graph.retainedPreparedAssetIds()).toEqual([]);
	});

	it("disposes all retained resources", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2WorldResourceStore();

		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState: createAssetState(),
			terrainScene: createTerrainScene(),
			staticRenderableScene: createStaticRenderableScene([createStaticPart()]),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform()],
		});
		destroyWebgl2WorldResources(store);

		expect(store.drawUnits).toEqual([]);
		expect(gl.deletedVertexArrays).toHaveLength(1);
		expect(gl.deletedBuffers).toHaveLength(2);
	});

	it("does not clear the element buffer from an already-bound draw VAO during sync", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2WorldResourceStore();
		const previouslyBoundVertexArray = gl.createVertexArray();
		const previousIndexBuffer = gl.createBuffer();
		gl.bindVertexArray(previouslyBoundVertexArray);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, previousIndexBuffer);

		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState: createAssetState(),
			terrainScene: createTerrainScene(),
			staticRenderableScene: createStaticRenderableScene([createStaticPart()]),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform()],
		});

		expect(gl.elementArrayBufferFor(previouslyBoundVertexArray)).toBe(
			previousIndexBuffer,
		);
	});

	it("realizes direct-texture draw units with UV buffers and cached textures", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2WorldResourceStore();
		const materialSurfaceId = 0x08000002;
		const renderSurfaceId = 0x06000002;

		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState: createAssetState({ materialSurfaceId, renderSurfaceId }),
			terrainScene: createTerrainScene(),
			staticRenderableScene: createStaticRenderableScene([
				createStaticPart({
					materialSlots: [createMaterialSlot(0, materialSurfaceId)],
				}),
			]),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform()],
		});

		expect(store.drawUnits).toHaveLength(1);
		expect(store.drawUnits[0]?.materialKind).toBe("direct-texture");
		expect(store.drawUnits[0]?.uvBuffer).not.toBeNull();
		expect(store.drawUnits[0]?.directGeometryLayout).toBe("position-uv");
		expect(store.drawUnits[0]?.texture).not.toBeNull();
		expect(store.textureCount).toBe(1);
		expect(gl.createdTextures).toHaveLength(1);
		expect(
			gl.textureUploads.map(({ width, height }) => ({ width, height })),
		).toEqual([{ width: 1, height: 1 }]);
		expect(store.compactionBypassSamples).toContain("non-static");
		expect(gl.generatedMipmapCount).toBe(1);
		expect(store.textureSamplingPolicyCounts).toEqual({
			"wrap=clamp/clamp;filter=linear/linear/linear;color=srgb;aniso=1;mips=on;flipY=off": 1,
		});

		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState: createAssetState({ materialSurfaceId, renderSurfaceId }),
			terrainScene: createTerrainScene(),
			staticRenderableScene: createStaticRenderableScene([]),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform()],
		});

		expect(store.textureCount).toBe(0);
		expect(gl.deletedTextures).toHaveLength(1);
	});

	it("applies WebGL2 texture filtering mode and anisotropy capability to direct uploads", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2WorldResourceStore();
		const materialSurfaceId = 0x08000002;
		const renderSurfaceId = 0x06000002;
		const scene = createStaticRenderableScene([
			createStaticPart({
				materialSlots: [createMaterialSlot(0, materialSurfaceId)],
			}),
		]);

		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState: createAssetState({ materialSurfaceId, renderSurfaceId }),
			terrainScene: createTerrainScene(),
			staticRenderableScene: scene,
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform()],
			materialTextureCapabilities: {
				supportsS3tc: false,
				supportsS3tcSrgb: false,
				supportsPackedRgb565: false,
				supportsPackedRgba4444: true,
				maxAnisotropy: 8,
			},
			textureFilteringMode: "anisotropic-4x",
		});

		expect(store.textureSamplingPolicyCounts).toEqual({
			"wrap=clamp/clamp;filter=linear/linear/linear;color=srgb;aniso=4;mips=on;flipY=off": 1,
		});
		expect(gl.textureParameters).toContainEqual({
			pname: gl.TEXTURE_MIN_FILTER,
			param: gl.LINEAR_MIPMAP_LINEAR,
		});
		expect(gl.textureParameters).toContainEqual({
			pname: gl.TEXTURE_MAG_FILTER,
			param: gl.LINEAR,
		});

		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState: createAssetState({ materialSurfaceId, renderSurfaceId }),
			terrainScene: createTerrainScene(),
			staticRenderableScene: scene,
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform()],
			materialTextureCapabilities: {
				supportsS3tc: false,
				supportsS3tcSrgb: false,
				supportsPackedRgb565: false,
				supportsPackedRgba4444: true,
				maxAnisotropy: 8,
			},
			textureFilteringMode: "nearest",
		});

		expect(store.textureSamplingPolicyCounts).toEqual({
			"wrap=clamp/clamp;filter=nearest/nearest/none;color=srgb;aniso=1;mips=off;flipY=off": 1,
		});
		expect(gl.generatedMipmapCount).toBe(1);
		expect(gl.deletedTextures).toHaveLength(1);
		expect(gl.textureParameters).toContainEqual({
			pname: gl.TEXTURE_MIN_FILTER,
			param: gl.NEAREST,
		});
		expect(gl.textureParameters).toContainEqual({
			pname: gl.TEXTURE_MAG_FILTER,
			param: gl.NEAREST,
		});
	});

	it("realizes building region detail overlays for direct-texture draw units", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2WorldResourceStore();
		const materialSurfaceId = 0x08000002;
		const renderSurfaceId = 0x06000002;
		const detailTextureId = 0x05001787;
		const detailRenderSurfaceId = 0x06001787;

		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState: createAssetState({
				materialSurfaceId,
				renderSurfaceId,
				detailTextureId,
				detailRenderSurfaceId,
			}),
			terrainScene: createTerrainScene(),
			staticRenderableScene: createStaticRenderableScene([
				createStaticPart({
					kind: "building",
					detailRoleKind: "building",
					materialSlots: [createMaterialSlot(0, materialSurfaceId)],
				}),
			]),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform()],
		});

		expect(store.drawUnits[0]?.materialKind).toBe("direct-texture");
		expect(store.drawUnits[0]?.detailOverlay).toMatchObject({
			tiling: 8,
			blendMode: "dst-color",
		});
		expect(store.textureCount).toBe(2);
		expect(store.detailTextureCount).toBe(1);
		expect(gl.createdTextures).toHaveLength(2);
	});

	it("reports atlas-eligible direct materials without changing preview direct rendering", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2WorldResourceStore();
		installTextureAtlasWorkerScheduler(store);
		installCompactedGeometryWorkerScheduler(store);
		const materialSurfaceId = 0x08000002;
		const renderSurfaceId = 0x06000002;

		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState: createAssetState({
				materialSurfaceId,
				renderSurfaceId,
				compressedAtlasReady: true,
			}),
			terrainScene: createTerrainScene(),
			staticRenderableScene: createStaticRenderableScene([
				createStaticPart({
					materialSlots: [createMaterialSlot(0, materialSurfaceId)],
				}),
			]),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform()],
		});

		expect(store.drawUnits[0]?.materialKind).toBe("direct-texture");
		expect(store.texturePageReadyMaterialCount).toBe(1);
		expect(store.atlasCandidateEntryCount).toBe(1);
		expect(store.atlasCandidateMaterialSlotCount).toBe(1);
	});

	it("keys compacted indexed worker jobs by indexed atlas plan identity", () => {
		const plan = createIndexedCompactionPlanFixture();
		const drawUnits = [createIndexedStagedDrawUnitFixture()];
		const renderChunkTransforms = [createChunkTransform()];
		const firstBatchPlan = createIndexedPalettedCompactedLandblockBatchPlans({
			plan,
			drawUnits,
			renderChunkTransforms,
			indexedResourceAtlasPlan: createIndexedResourceAtlasPlanFixture(
				"indexed-atlas-plan/a",
			),
		})[0];
		const secondBatchPlan = createIndexedPalettedCompactedLandblockBatchPlans({
			plan,
			drawUnits,
			renderChunkTransforms,
			indexedResourceAtlasPlan: createIndexedResourceAtlasPlanFixture(
				"indexed-atlas-plan/b",
			),
		})[0];

		expect(firstBatchPlan?.desiredJobKey).toBeDefined();
		expect(secondBatchPlan?.desiredJobKey).toBeDefined();
		expect(firstBatchPlan?.desiredJobKey).not.toBe(
			secondBatchPlan?.desiredJobKey,
		);
	});

});

class FakeRenderResourceWorker implements RenderResourceWorkerLike {
	onmessage:
		| ((event: MessageEvent<RenderResourceWorkerResponseMessage>) => void)
		| null = null;
	onerror: ((event: Event | ErrorEvent) => void) | null = null;
	readonly messages: RenderResourceWorkerRequestMessage[] = [];
	readonly transferLists: Transferable[][] = [];
	readonly completedRequestIds = new Set<string>();
	wasTerminated = false;

	postMessage(
		message: RenderResourceWorkerRequestMessage,
		transferables: Transferable[] = [],
	): void {
		this.messages.push(message);
		this.transferLists.push(transferables);
	}

	terminate(): void {
		this.wasTerminated = true;
	}

}

function installTextureAtlasWorkerScheduler(
	store: Webgl2WorldResourceStore,
): FakeRenderResourceWorker {
	const worker = new FakeRenderResourceWorker();
	store.textureAtlasWorkerScheduler = new TextureAtlasWorkerScheduler({
		client: new RenderResourceWorkerClient(() => worker),
		onReadyResult() {
			return;
		},
	});
	return worker;
}

function installCompactedGeometryWorkerScheduler(
	store: Webgl2WorldResourceStore,
): FakeRenderResourceWorker {
	const worker = new FakeRenderResourceWorker();
	store.compactedGeometryWorkerScheduler = new CompactedGeometryWorkerScheduler(
		{
			client: new RenderResourceWorkerClient(() => worker),
			onReadyResult() {
				return;
			},
		},
	);
	return worker;
}

function createIndexedCompactionPlanFixture(): CompactionFamilyPlan {
	const emptyPlan = createEmptyCompactionFamilyPlan();
	const materialRecord = createIndexedMaterialTableRecordFixture();
	const drawSlice = {
		key: "indexed-slice/stable",
		indexFormat: "p8",
		indexPageKey: materialRecord.indexPageKey,
		palettePageKey: materialRecord.palettePageKey,
		indexAtlasTextureIndex: 0,
		paletteAtlasTextureIndex: 0,
		renderStateKey: "indexed-opaque",
		materialTableSlotStart: 0,
		materialTableSlotCount: 1,
		materialSlotKeys: [materialRecord.key],
		drawUnitIds: ["indexed-draw-unit"],
	} as const;
	const indexedFamily = {
		kind: "indexed-paletted",
		compactableDrawUnitIds: ["indexed-draw-unit"],
		materialTableRecords: [materialRecord],
		drawUnitMaterialSlots: [
			{
				drawUnitId: "indexed-draw-unit",
				materialSlotKey: materialRecord.key,
			},
		],
		drawSlices: [drawSlice],
		partitions: [
			{
				key: "indexed-partition/stable",
				compactableDrawUnitIds: ["indexed-draw-unit"],
				materialTableRecords: [materialRecord],
				drawUnitMaterialSlots: [
					{
						drawUnitId: "indexed-draw-unit",
						materialSlotKey: materialRecord.key,
					},
				],
				drawSlices: [drawSlice],
			},
		],
	} satisfies CompactionFamilyPlan["renderFamilies"]["indexedPaletted"];
	return {
		...emptyPlan,
		key: "compaction-plan/stable",
		renderFamilies: {
			...emptyPlan.renderFamilies,
			indexedPaletted: indexedFamily,
		},
		compactableDrawUnitIds: ["indexed-draw-unit"],
		texturePageAtlasPlan: createEmptyTexturePageAtlasPlan(),
		indexedMaterialTableRecords: [materialRecord],
		triangleCount: 1,
	};
}

function createIndexedMaterialTableRecordFixture(): IndexedPalettedFamilyMaterialTableRecord {
	return {
		key: "indexed-material/stable",
		sourceMaterialKey: "material/indexed",
		indexPageKey: "index-texture/stable",
		palettePageKey: "palette/stable",
		indexFormat: "p8",
		indexPageWidth: 2,
		indexPageHeight: 1,
		paletteColorCount: 2,
		clipThreshold: 0,
		wrapS: "clamp",
		wrapT: "clamp",
		color: [1, 1, 1, 1],
		detailAtlasEntryKey: null,
		detailTiling: 1,
		alphaPolicy: "opaque",
		filteringMode: "shader-palette-linear",
	};
}

function createIndexedStagedDrawUnitFixture(): StagedWorldDrawUnitAssembly {
	return {
		id: "indexed-draw-unit",
		kind: "static",
		renderDomain: WORLD_RENDER_DOMAIN.exteriorStatic,
		owningLandblockId: 0x12340000,
		geometry: {
			signature: "geometry/stable",
			positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
			uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
			indices: new Uint16Array([0, 1, 2]),
			vertexCount: 3,
			triangleCount: 1,
		},
		modelMatrix: createIdentityMat4(),
		material: {
			kind: "indexed-paletted",
		} as StagedWorldDrawUnitAssembly["material"],
		preparedAssetIds: [],
		bvhBinding: {
			itemKeys: [],
			fallbackReason: null,
		},
		staticPartCount: 1,
		staticObjectKeys: ["static-object/stable"],
	};
}

function createIndexedResourceAtlasPlanFixture(
	key: string,
): IndexedResourceAtlasPlan {
	const indexPlacement = {
		indexTextureKey: "index-texture/stable",
		format: "p8",
		atlasTextureIndex: 0,
		x: 0,
		y: 0,
		width: 2,
		height: 1,
		sourceBytes: new Uint8Array([0, 1]),
	} as const;
	const palettePlacement = {
		paletteTextureKey: "palette/stable",
		atlasTextureIndex: 0,
		x: 0,
		y: 0,
		colorCount: 2,
		rgbaBytes: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]),
	} as const;
	return {
		key,
		indexReadyDrawUnitIds: ["indexed-draw-unit"],
		paletteReadyDrawUnitIds: ["indexed-draw-unit"],
		failures: [],
		p8IndexAtlasTextures: [
			{
				format: "p8",
				textureIndex: 0,
				width: 2,
				height: 1,
				placements: [indexPlacement],
			},
		],
		index16AtlasTextures: [],
		paletteAtlasTextures: [
			{
				textureIndex: 0,
				width: 2,
				height: 1,
				placements: [palettePlacement],
			},
		],
		indexPlacementsByTextureKey: new Map([
			[indexPlacement.indexTextureKey, indexPlacement],
		]),
		palettePlacementsByTextureKey: new Map([
			[palettePlacement.paletteTextureKey, palettePlacement],
		]),
	};
}

function createIdentityMat4(): RenderMat4 {
	return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

class FakeWebgl2 {
	readonly ARRAY_BUFFER = 1;
	readonly ELEMENT_ARRAY_BUFFER = 2;
	readonly STATIC_DRAW = 3;
	readonly FLOAT = 4;
	readonly UNSIGNED_SHORT = 5;
	readonly UNSIGNED_INT = 6;
	readonly TEXTURE_2D = 7;
	readonly RGBA = 8;
	readonly RGB = 9;
	readonly RED = 10;
	readonly RG = 101;
	readonly RGBA8 = 11;
	readonly RGB8 = 12;
	readonly R8 = 13;
	readonly RG8 = 131;
	readonly RGBA4 = 14;
	readonly UNSIGNED_BYTE = 15;
	readonly UNSIGNED_SHORT_4_4_4_4 = 16;
	readonly RGBA16UI = 161;
	readonly RGBA_INTEGER = 162;
	readonly CLAMP_TO_EDGE = 17;
	readonly REPEAT = 18;
	readonly NEAREST = 19;
	readonly LINEAR = 20;
	readonly NEAREST_MIPMAP_NEAREST = 21;
	readonly NEAREST_MIPMAP_LINEAR = 22;
	readonly LINEAR_MIPMAP_NEAREST = 23;
	readonly LINEAR_MIPMAP_LINEAR = 24;
	readonly TEXTURE_WRAP_S = 25;
	readonly TEXTURE_WRAP_T = 26;
	readonly TEXTURE_MIN_FILTER = 27;
	readonly TEXTURE_MAG_FILTER = 28;
	readonly NO_ERROR = 0;
	readonly createdBuffers: object[] = [];
	readonly deletedBuffers: object[] = [];
	readonly createdVertexArrays: object[] = [];
	readonly deletedVertexArrays: object[] = [];
	readonly createdTextures: object[] = [];
	readonly deletedTextures: object[] = [];
	readonly textureUploads: {
		width: number;
		height: number;
		internalFormat: GLenum;
		format: GLenum;
		type: GLenum;
		data: TexImageSource | ArrayBufferView | null;
	}[] = [];
	readonly textureParameters: { pname: GLenum; param: GLenum }[] = [];
	generatedMipmapCount = 0;
	private currentVertexArray: WebGLVertexArrayObject | null = null;
	private readonly elementArrayBuffersByVertexArray = new Map<
		WebGLVertexArrayObject,
		WebGLBuffer | null
	>();
	bufferUploads: BufferSource[] = [];

	asContext(): WebGL2RenderingContext {
		return this as unknown as WebGL2RenderingContext;
	}

	createBuffer(): WebGLBuffer {
		const buffer = {};
		this.createdBuffers.push(buffer);
		return buffer as WebGLBuffer;
	}

	bindBuffer(target: GLenum, buffer: WebGLBuffer | null): void {
		if (target === this.ELEMENT_ARRAY_BUFFER && this.currentVertexArray) {
			this.elementArrayBuffersByVertexArray.set(
				this.currentVertexArray,
				buffer,
			);
		}
	}

	bufferData(_target: GLenum, data: BufferSource | null): void {
		if (data) {
			this.bufferUploads.push(data);
		}
	}

	deleteBuffer(buffer: WebGLBuffer): void {
		this.deletedBuffers.push(buffer);
	}

	createVertexArray(): WebGLVertexArrayObject {
		const vertexArray = {};
		this.createdVertexArrays.push(vertexArray);
		return vertexArray as WebGLVertexArrayObject;
	}

	bindVertexArray(vertexArray: WebGLVertexArrayObject | null): void {
		this.currentVertexArray = vertexArray;
	}

	deleteVertexArray(vertexArray: WebGLVertexArrayObject): void {
		this.deletedVertexArrays.push(vertexArray);
	}

	enableVertexAttribArray(): void {
		return;
	}

	vertexAttribPointer(): void {
		return;
	}

	createTexture(): WebGLTexture {
		const texture = {};
		this.createdTextures.push(texture);
		return texture as WebGLTexture;
	}

	bindTexture(): void {
		return;
	}

	texImage2D(
		_target: GLenum,
		_level: number,
		internalFormat: GLenum,
		widthOrFormat: GLenum,
		heightOrType: GLenum,
		_borderOrSource?: GLenum | TexImageSource,
		format?: GLenum,
		type?: GLenum,
		data?: TexImageSource | ArrayBufferView | null,
	): void {
		if (typeof _borderOrSource === "number") {
			this.textureUploads.push({
				width: widthOrFormat,
				height: heightOrType,
				internalFormat,
				format: format ?? 0,
				type: type ?? 0,
				data: (data ?? null) as TexImageSource | ArrayBufferView | null,
			});
			return;
		}
		this.textureUploads.push({
			width: 0,
			height: 0,
			internalFormat,
			format: widthOrFormat,
			type: heightOrType,
			data: (_borderOrSource ?? null) as
				| TexImageSource
				| ArrayBufferView
				| null,
		});
	}

	texParameteri(_target: GLenum, pname: GLenum, param: GLenum): void {
		this.textureParameters.push({ pname, param });
	}

	texParameterf(): void {
		return;
	}

	generateMipmap(): void {
		this.generatedMipmapCount += 1;
	}

	getExtension(): null {
		return null;
	}

	getError(): GLenum {
		return this.NO_ERROR;
	}

	deleteTexture(texture: WebGLTexture): void {
		this.deletedTextures.push(texture);
	}

	elementArrayBufferFor(
		vertexArray: WebGLVertexArrayObject,
	): WebGLBuffer | null | undefined {
		return this.elementArrayBuffersByVertexArray.get(vertexArray);
	}
}

function createAssetState({
	materialSurfaceId,
	renderSurfaceId,
	compressedAtlasReady = false,
	indexed = false,
	indexedFormat = "p8",
	detailTextureId,
	detailRenderSurfaceId,
}: {
	materialSurfaceId?: number;
	renderSurfaceId?: number;
	compressedAtlasReady?: boolean;
	indexed?: boolean;
	indexedFormat?: "p8" | "index16";
	detailTextureId?: number;
	detailRenderSurfaceId?: number;
} = {}): AssetChannelState {
	const state = createInitialAssetChannelState();
	state.preparedByAssetId["gfx-obj/01000001"] = {
		payload: {
			kind: "gfx-obj",
			renderGeometry:
				materialSurfaceId !== undefined
					? createMaterialSlotGfxGeometry()
					: createStaticGfxGeometry(),
		},
	} as AssetChannelState["preparedAsset"];
	if (materialSurfaceId !== undefined && renderSurfaceId !== undefined) {
		state.preparedByAssetId[
			`material/${materialSurfaceId.toString(16).padStart(8, "0")}`
		] = {
			payload: createTextureMaterialRecipe(
				materialSurfaceId,
				renderSurfaceId,
				indexed ? 0x04000001 : null,
			),
		} as AssetChannelState["preparedAsset"];
		state.preparedByAssetId[
			`render-surface/${renderSurfaceId.toString(16).padStart(8, "0")}`
		] = {
			payload: createRenderSurfacePayload({
				renderSurfaceId,
				compressed: compressedAtlasReady,
				indexed,
				indexedFormat,
			}),
		} as AssetChannelState["preparedAsset"];
		if (indexed) {
			state.preparedByAssetId["palette/04000001"] = {
				payload: createPalettePayload(
					0x04000001,
					indexedFormat === "index16" ? 258 : 2,
				),
			} as AssetChannelState["preparedAsset"];
		}
		if (compressedAtlasReady) {
			const preparedTexture =
				createAtlasPreparedTexturePayload(renderSurfaceId);
			state.preparedByAssetId[
				formatAtlasReadyPreparedTextureAssetId({
					renderSurfaceId,
					usage: "raw",
				})
			] = {
				payload: preparedTexture,
			} as AssetChannelState["preparedAsset"];
		}
	}
	if (detailTextureId !== undefined && detailRenderSurfaceId !== undefined) {
		state.preparedByAssetId["region-render-profile/1"] = {
			payload: createRegionRenderProfilePayload({
				textureId: detailTextureId,
				renderSurfaceId: detailRenderSurfaceId,
			}),
		} as AssetChannelState["preparedAsset"];
		state.preparedByAssetId[
			`surface-texture/${detailTextureId.toString(16).padStart(8, "0")}`
		] = {
			payload: createSurfaceTexturePayload({
				textureId: detailTextureId,
				renderSurfaceId: detailRenderSurfaceId,
			}),
		} as AssetChannelState["preparedAsset"];
		state.preparedByAssetId[
			`render-surface/${detailRenderSurfaceId.toString(16).padStart(8, "0")}`
		] = {
			payload: createRenderSurfacePayload({
				renderSurfaceId: detailRenderSurfaceId,
				compressed: false,
			}),
		} as AssetChannelState["preparedAsset"];
	}
	return state;
}

function createAssetStateWithTerrainMaterials(
	terrainCodes: readonly number[],
): AssetChannelState {
	const state = createAssetState();
	const terrainTypes = terrainCodes.map((terrainCode) => {
		const textureId = 0x05000000 + terrainCode;
		const renderSurfaceId = 0x06000000 + terrainCode;
		state.preparedByAssetId[`surface-texture/${formatHex32(textureId)}`] = {
			payload: createSurfaceTexturePayload({ textureId, renderSurfaceId }),
		} as AssetChannelState["preparedAsset"];
		state.preparedByAssetId[`render-surface/${formatHex32(renderSurfaceId)}`] =
			{
				payload: createRenderSurfacePayload({
					renderSurfaceId,
					compressed: false,
				}),
			} as AssetChannelState["preparedAsset"];
		state.preparedByAssetId[
			formatAtlasReadyPreparedTextureAssetId({
				renderSurfaceId,
				usage: "raw",
			})
		] = {
			payload: createAtlasPreparedTexturePayload(renderSurfaceId),
		} as AssetChannelState["preparedAsset"];
		return {
			terrainType: terrainCode,
			textureAssetId: `surface-texture/${formatHex32(textureId)}`,
			textureDid: textureId,
			tiling: 4,
			colorVariation: null,
		};
	});
	state.preparedByAssetId["terrain-material/1"] = {
		payload: {
			kind: "terrain-material",
			sourceAssetKind: "terrain-material",
			residencyKind: "unknown",
			provenance: {
				source: "repo-local-hba",
				sourceAssetKind: "terrain-material",
				errorCode: null,
				detail: null,
			},
			regionNumber: 1,
			materialKind: "tex-merge-table",
			terrainTypes,
			terrainAlphaMaps: [],
			roadAlphaMaps: [],
			pcodeEncoding: {
				terrainCodeBits: 5,
				roadCodeBits: 2,
				sizeBitMask: 1 << 28,
			},
			dependencies: {
				surfaceTextureAssetIds: terrainTypes.map(
					(terrain) => terrain.textureAssetId,
				),
				renderSurfaceAssetIds: terrainCodes.map(
					(terrainCode) =>
						`render-surface/${formatHex32(0x06000000 + terrainCode)}`,
				),
				paletteAssetIds: [],
			},
		},
	} as AssetChannelState["preparedAsset"];
	return state;
}

function createStaticGfxGeometry(): PreparedPolygonSetRenderGeometry {
	return {
		sourceId: 1,
		vertexCount: 3,
		triangleCount: 1,
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		normals: [],
		uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
		triangles: [{ polygonId: 0, surfaceId: null, firstVertex: 0 }],
		surfaceIds: [],
		bounds: null,
	};
}

function createMaterialSlotGfxGeometry(): PreparedPolygonSetRenderGeometry {
	return {
		...createStaticGfxGeometry(),
		triangles: [{ polygonId: 0, surfaceId: 0, firstVertex: 0 }],
		surfaceIds: [0],
	};
}

function createStaticRenderableScene(parts: StaticRenderablePart[]) {
	return {
		...createEmptyStaticRenderableSceneModel(),
		partsByRenderGroupKey: new Map(),
		parts,
	};
}

function createStaticPart({
	kind = "scenery",
	detailRoleKind = "object",
	instanceId = "appearance-preview/instance-a",
	landblockId = 0x12340000,
	owningEnvCellId = null,
	renderDomain = WORLD_RENDER_DOMAIN.exteriorStatic,
	materialSlots = [],
	chunkLocalOrigin = { x: 1, y: 2, z: 3 },
}: {
	kind?: StaticRenderablePart["kind"];
	detailRoleKind?: StaticRenderablePart["detailRoleKind"];
	instanceId?: string;
	landblockId?: number;
	owningEnvCellId?: StaticRenderablePart["owningEnvCellId"];
	renderDomain?: StaticRenderablePart["renderDomain"];
	materialSlots?: readonly ResolvedMaterialSlot[];
	chunkLocalOrigin?: RenderChunkTransform["offset"];
} = {}): StaticRenderablePart {
	const landblockKey = `landblock/${landblockId.toString(16).padStart(8, "0")}`;
	return {
		renderKey: `static/${instanceId}`,
		renderDomain,
		instanceId,
		sourceAssetId: "gfx-obj/01000001",
		sourceDid: 0x01000001,
		owningLandblockId: landblockId,
		regionNumber: 1,
		owningEnvCellId,
		renderChunk: {
			chunkKey: landblockKey,
			chunkLandblockId: landblockId,
		},
		kind,
		partIndex: 0,
		gfxObjId: 0x01000001,
		gfxObjAssetId: "gfx-obj/01000001",
		materialAppearanceContext: createBaseMaterialAppearanceContext("base"),
		materialSlots,
		materialSignature: materialSlots.length > 0 ? "textured" : "base",
		parentPlacements: [],
		chunkLocalInstancePlacement: createPlacement(chunkLocalOrigin),
		partPlacements: [],
		scale: { x: 1, y: 1, z: 1 },
		debugColorKey: instanceId,
		textureVelocity: null,
		textureVelocitySignature: "uv:none",
		detailRoleKind,
		detailSignature: "detail:none",
	};
}

function createRegionRenderProfilePayload({
	textureId,
	renderSurfaceId,
}: {
	textureId: number;
	renderSurfaceId: number;
}) {
	const textureAssetId = `surface-texture/${textureId
		.toString(16)
		.padStart(8, "0")}`;
	return {
		kind: "region-render-profile",
		sourceAssetKind: "region-render-profile",
		residencyKind: "unknown",
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "region-render-profile",
			errorCode: null,
			detail: null,
		},
		regionNumber: 1,
		detailRoles: {
			landscape: null,
			building: {
				role: "building",
				sourceTerrainDescIndex: 0,
				textureAssetId,
				textureDid: textureId,
				tiling: 8,
				fadeNear: 10,
				fadeFar: 50,
			},
			environment: null,
			object: null,
		},
		dependencies: {
			surfaceTextureAssetIds: [textureAssetId],
			renderSurfaceAssetIds: [
				`render-surface/${renderSurfaceId.toString(16).padStart(8, "0")}`,
			],
			paletteAssetIds: [],
		},
	};
}

function createSurfaceTexturePayload({
	textureId,
	renderSurfaceId,
}: {
	textureId: number;
	renderSurfaceId: number;
}) {
	return {
		kind: "surface-texture",
		sourceAssetKind: "surface-texture",
		residencyKind: "unknown",
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "surface-texture",
			errorCode: null,
			detail: null,
		},
		surfaceTextureId: textureId,
		textureType: 0,
		unknown: 0,
		selectedRenderSurfaceId: renderSurfaceId,
		renderSurfaceIds: [renderSurfaceId],
		dependencies: {
			renderSurfaceAssetIds: [
				`render-surface/${renderSurfaceId.toString(16).padStart(8, "0")}`,
			],
		},
	};
}

function createMaterialSlot(
	slotIndex: number,
	surfaceId: number,
): ResolvedMaterialSlot {
	return {
		slotIndex,
		surfaceId,
		materialAssetId: `material/${surfaceId.toString(16).padStart(8, "0")}`,
		materialVariantSignature: null,
	};
}

function createTextureMaterialRecipe(
	surfaceId: number,
	renderSurfaceId: number,
	paletteId: number | null = null,
): PreparedMaterialRecipePayload {
	return {
		kind: "material-recipe",
		sourceAssetKind: "material-recipe",
		residencyKind: "unknown",
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "material-recipe",
			errorCode: null,
			detail: null,
		},
		surfaceId,
		surfaceType: 1,
		source: {
			kind: "texture",
			surfaceTextureId: renderSurfaceId,
			selectedRenderSurfaceId: renderSurfaceId,
			paletteId,
			renderSurfaceDefaultPaletteIds: [],
		},
		translucency: 0,
		luminosity: 0,
		diffuse: 1,
		dependencies: {
			surfaceTextureAssetIds: [],
			renderSurfaceAssetIds: [
				`render-surface/${renderSurfaceId.toString(16).padStart(8, "0")}`,
			],
			paletteAssetIds: [],
		},
	};
}

function createRenderSurfacePayload({
	renderSurfaceId,
	compressed,
	indexed = false,
	indexedFormat = "p8",
}: {
	renderSurfaceId: number;
	compressed: boolean;
	indexed?: boolean;
	indexedFormat?: "p8" | "index16";
}): PreparedRenderSurfacePayload {
	const sourceBytes = indexed
		? indexedFormat === "index16"
			? new Uint8Array([0x00, 0x00, 0x01, 0x01])
			: new Uint8Array([0, 1])
		: new Uint8Array([0x10, 0x20, 0x30, 0xff]);
	return {
		kind: "render-surface",
		sourceAssetKind: "render-surface",
		residencyKind: "unknown",
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "render-surface",
			errorCode: null,
			detail: null,
		},
		renderSurfaceId,
		unknown: 0,
		width: indexed ? 2 : 1,
		height: 1,
		formatRaw: indexed
			? indexedFormat === "index16"
				? 0x65
				: 0x29
			: compressed
				? 0x3154_5844
				: 0x15,
		format: indexed
			? indexedFormat === "index16"
				? "Index16"
				: "P8"
			: compressed
				? "DXT1"
				: "A8R8G8B8",
		sourceByteLength: sourceBytes.byteLength,
		sourceBytes,
		defaultPaletteId: indexed ? 0x04000001 : null,
		dependencies: { paletteAssetIds: indexed ? ["palette/04000001"] : [] },
	};
}

function createPalettePayload(
	paletteId: number,
	colorCount = 2,
): PreparedPalettePayload {
	return {
		kind: "palette",
		sourceAssetKind: "palette",
		residencyKind: "unknown",
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "palette",
			errorCode: null,
			detail: null,
		},
		paletteId,
		colorCount,
		colorsArgb: createPaletteColors(colorCount),
	};
}

function createPaletteColors(colorCount: number): Uint32Array {
	const colors = new Uint32Array(colorCount);
	for (let index = 0; index < colorCount; index += 1) {
		colors[index] = 0xff000000 | index;
	}
	return colors;
}

function createAtlasPreparedTexturePayload(
	renderSurfaceId: number,
): PreparedTexturePayload {
	const bytes = new Uint8Array([0x10, 0x20, 0x30, 0xff]);
	return {
		kind: "prepared-texture",
		sourceAssetKind: "prepared-texture",
		residencyKind: "unknown",
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "prepared-texture",
			errorCode: null,
			detail: null,
		},
		renderSurfaceId,
		usage: "raw",
		outputFormat: "rgba8",
		mipPolicy: "none",
		colorSpace: "linear",
		sourceFormatRaw: 0x3154_5844,
		sourceFormat: "DXT1",
		sourceWidth: 1,
		sourceHeight: 1,
		sourceByteLength: bytes.byteLength,
		sourceHash: `hash-${renderSurfaceId}`,
		levels: [
			{
				level: 0,
				width: 1,
				height: 1,
				formatRaw: 0x15,
				format: "A8R8G8B8",
				byteLength: bytes.byteLength,
				bytes,
			},
		],
		dependencies: {
			renderSurfaceAssetIds: [
				`render-surface/${renderSurfaceId.toString(16).padStart(8, "0")}`,
			],
		},
		diagnostics: {
			generatedLevelCount: 1,
			generatedByteLength: bytes.byteLength,
			decodeMs: 0,
			downsampleMs: 0,
			encodeMs: 0,
			totalMs: 0,
		},
	};
}

function createPlacement(origin: RenderChunkTransform["offset"]) {
	return {
		origin,
		orientation: { w: 1, x: 0, y: 0, z: 0 },
	};
}

function createChunkTransform({
	landblockId = 0x12340000,
	offset = { x: 10, y: 20, z: 30 },
}: {
	landblockId?: number;
	offset?: RenderChunkTransform["offset"];
} = {}): RenderChunkTransform {
	return {
		chunkKey: `landblock/${landblockId.toString(16).padStart(8, "0")}`,
		chunkLandblockId: landblockId,
		offset,
	};
}

function createStaticLandblockArtifactSnapshot(
	layers: readonly StaticObjectBundleArtifact[],
	product: LandblockRenderProductWorkerResult["product"] = "outdoor",
): StaticLandblockRenderArtifactStoreSnapshot {
	const landblockId = layers[0]?.landblockId ?? 0x1234;
	return createStaticLandblockProductArtifactSnapshot([
		createStaticLandblockProductArtifact({
			landblockId,
			product,
			layers,
		}),
	]);
}

function createStaticLandblockProductArtifactSnapshot(
	artifacts: readonly LandblockRenderProductWorkerResult[],
): StaticLandblockRenderArtifactStoreSnapshot {
	const residentCount = artifacts.length;
	return {
		artifacts,
		desiredCount: residentCount,
		residentCount,
		inFlightCount: 0,
		staleResultCount: 0,
		committedResultCount: residentCount,
		evictedResultCount: 0,
		errorCount: 0,
		latestDesiredIdentityKeys: [],
	};
}

function createStaticLandblockProductArtifact({
	landblockId,
	product,
	layers,
}: {
	landblockId: number;
	product: LandblockRenderProductWorkerResult["product"];
	layers: readonly StaticObjectBundleArtifact[];
}): LandblockRenderProductWorkerResult {
	const artifacts: LandblockRenderProductWorkerResult["artifacts"] =
		product === "outdoor"
			? layers
			: [
					...layers,
					{
						artifactKind: "detailed-landblock",
						key: `detailed:${landblockId}:${product}`,
						landblockId,
						product,
						requestId: "request",
						buildPolicyRevision: "build:v1",
						texturePagePolicyRevision: "pages:v1",
						selectedEnvCellIds: [],
						structuredInteriorMaterialRecords: [],
						structuredInteriorTexturePageRefs: [],
						structuredInteriorTexturePages: [],
						structuredInteriorCells: [],
						cellStructureMetadata: [],
						portalLinks: [],
						portalApertures: [],
						visibility: {
							objectVisibilityRecords: [],
							cellVisibilityRecords: [],
						},
						spatial: {
							envCellResidencyBvh: {
								coordinateSpace: "landblock-topology-residency",
								nodes: [],
								items: [],
							},
							envCellLocalBvhs: [],
						},
					},
				];
	return {
		type: "landblock-render-product-built" as const,
		jobId: `job:${landblockId}:${product}`,
		landblockId,
		product,
		requestId: "request",
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "pages:v1",
		artifacts,
		diagnostics: {
			status: "ready" as const,
			messages: [],
		},
	};
}

function createDetailedLandblockProductArtifact(
	cell: StructuredInteriorCell,
): LandblockRenderProductWorkerResult {
	const landblockId = cell.renderChunk.chunkLandblockId;
	return {
		type: "landblock-render-product-built",
		jobId: `job:${landblockId}:outdoor-env-cells`,
		landblockId,
		product: "outdoor-env-cells",
		requestId: "request",
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "pages:v1",
		artifacts: [
			{
				artifactKind: "detailed-landblock",
				key: `detailed:${landblockId}:outdoor-env-cells`,
				landblockId,
				product: "outdoor-env-cells",
				requestId: "request",
				buildPolicyRevision: "build:v1",
				texturePagePolicyRevision: "pages:v1",
				selectedEnvCellIds: [cell.envCellId],
				structuredInteriorMaterialRecords: [
					{
						key: "interior-material",
						familyKey: "rgba-texture-page",
						texturePageRefKeys: ["interior-texture-ref"],
						isTransparent: false,
					},
				],
				structuredInteriorTexturePageRefs: [
					{
						key: "interior-texture-ref",
						sourceAssetId: "prepared-texture/06000001/raw",
						usageBucket: "base-color",
						sampleClass: "rgba-color",
						width: 1,
						height: 1,
						wrapS: "clamp",
						wrapT: "clamp",
						samplingDomain: "color",
						lookup: "color-filtered",
					},
				],
				structuredInteriorTexturePages: [
					{
						key: "interior-texture-page",
						scopeKey: `detailed:${landblockId}:outdoor-env-cells`,
						pageKind: "single-entry",
						usageBucket: "base-color",
						sampleClass: "rgba-color",
						width: 1,
						height: 1,
						bytes: new Uint8Array([255, 255, 255, 255]),
						entries: [
							{
								virtualRefKey: "interior-texture-ref",
								sourceAssetId: "prepared-texture/06000001/raw",
								rect: [0, 0, 1, 1],
							},
						],
					},
				],
				structuredInteriorCells: [
					{
						key: `structured-interior-cell:${cell.envCellId}`,
						envCellId: cell.envCellId,
						landblockId,
						regionNumber: cell.regionNumber,
						environmentId: cell.environmentId,
						cellStructureId: cell.cellStructureId,
						renderChunk: cell.renderChunk,
						localPlacement: cell.chunkLocalPlacement,
						surfaceIds: cell.surfaceIds,
						portals: [],
						portalApertureKeys: [],
						staticObjectCount: cell.staticObjectCount,
						cellBsp: cell.cellBsp ?? createLeafBspNode(),
						renderGeometry: cell.renderGeometry,
						materialSlices: [
							{
								key: `structured-interior-cell:${cell.envCellId}:material:0`,
								cellKey: `structured-interior-cell:${cell.envCellId}`,
								envCellId: cell.envCellId,
								materialSlotIndex: 0,
								surfaceId: cell.surfaceIds[0] ?? 0,
								geometrySurfaceId: cell.surfaceIds[0] ?? 0,
								materialRecordKey: "interior-material",
								materialVariantSignature: null,
								positions: createStaticTrianglePositions(),
								uvs: createStaticTriangleUvs(),
								indices: new Uint16Array([0, 1, 2]),
								triangleCount: 1,
							},
						],
					},
				],
				cellStructureMetadata: [],
				portalLinks: [],
				portalApertures: [],
				visibility: {
					objectVisibilityRecords: [],
					cellVisibilityRecords: [],
				},
				spatial: {
					envCellResidencyBvh: {
						coordinateSpace: "landblock-topology-residency",
						nodes: [],
						items: [],
					},
					envCellLocalBvhs: [],
				},
			},
		],
		diagnostics: {
			status: "ready",
			messages: [],
		},
	};
}

function createStaticBundleLayer(
	key: string,
	sourceRevision: string,
	options: {
		landblockId?: number;
		bundleKind?: StaticObjectBundleArtifact["bundleKind"];
		envCellId?: number;
	} = {},
): StaticObjectBundleArtifact {
	const landblockId = options.landblockId ?? 0x1234;
	const bundleKind = options.bundleKind ?? "outdoor-buildings";
	const scope =
		options.envCellId === undefined
			? {
					kind: "landblock" as const,
					landblockId,
					bundleKind,
				}
			: {
					kind: "env-cell" as const,
					landblockId,
					envCellId: options.envCellId,
					bundleKind,
				};
	return {
		artifactKind: "static-object-bundle",
		key,
		scope,
		landblockId,
		bundleKind,
		sourceRevision,
		rootAssetIds: ["landblock/00001234/outdoor"],
		preparedAssetIds: [],
		renderChunks: [
			{
				key: "chunk",
				landblockId,
				bounds: null,
			},
		],
		compactedBatches: [
			{
				key: "compacted",
				renderChunkKey: "chunk",
				familyKey: "rgba-texture-page",
				materialRecordKey: "material",
				objectKeys: ["object-a"],
				positions: createStaticTrianglePositions(),
				normals: createStaticTriangleNormals(),
				uvs: createStaticTriangleUvs(),
				indices: new Uint16Array([0, 1, 2]),
			},
		],
		directEntries: [
			{
				key: "direct",
				renderChunkKey: "chunk",
				materialRecordKey: "material",
				objectKey: "object-b",
				positions: createStaticTrianglePositions(),
				normals: createStaticTriangleNormals(),
				uvs: createStaticTriangleUvs(),
				indices: new Uint32Array([0, 1, 2]),
				bounds: null,
			},
		],
		materialRecords: [
			{
				key: "material",
				familyKey: "rgba-texture-page",
				texturePageRefKeys: ["texture-ref"],
				isTransparent: false,
			},
		],
		texturePageRefs: [
			{
				key: "texture-ref",
				sourceAssetId: "prepared-texture/06000001/raw",
				usageBucket: "base-color",
				sampleClass: "rgba-color",
				width: 1,
				height: 1,
				wrapS: "clamp",
				wrapT: "clamp",
				samplingDomain: "color",
				lookup: "color-filtered",
			},
		],
		texturePages: [
			{
				key: "texture-page",
				scopeKey: `landblock:${landblockId}:${bundleKind}`,
				pageKind: "single-entry",
				usageBucket: "base-color",
				sampleClass: "rgba-color",
				width: 1,
				height: 1,
				bytes: new Uint8Array([255, 255, 255, 255]),
				entries: [
					{
						virtualRefKey: "texture-ref",
						sourceAssetId: "prepared-texture/06000001/raw",
						rect: [0, 0, 1, 1],
					},
				],
			},
		],
		objectRecords: [],
		diagnostics: {
			sourceObjectCount: 2,
			compactedSurfaceCount: 1,
			directSurfaceCount: 1,
			skippedSurfaceCount: 0,
			missingAssetIds: [],
			skippedReasons: [],
		},
	};
}

function createStaticTrianglePositions(): Float32Array {
	return new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
}

function createStaticTriangleNormals(): Float32Array {
	return new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
}

function createStaticTriangleUvs(): Float32Array {
	return new Float32Array([0, 0, 1, 0, 0, 1]);
}

function createTerrainScene(
	tiles: TerrainSceneModel["tiles"] = [],
): TerrainSceneModel {
	return {
		focusLandblockId: null,
		statusText: "test",
		cacheText: "test",
		dataSourceText: "test",
		tiles,
	};
}

function createTerrainTile(): TerrainSceneModel["tiles"][number] {
	return {
		assetId: "terrain/12340000",
		landblockId: 0x12340000,
		label: "1234",
		isFocus: true,
		chunkLocalOffset: { x: 0, y: 0, z: 0 },
		mesh: createTerrainMesh(),
		materialResources: {
			kind: "terrain-material-resource-plan",
			regionNumber: 1,
			terrainMaterialAssetId: "terrain-material/1",
			status: "missing-table",
			signature: "terrain:1:missing-table:p=1",
			terrainTypeCount: 0,
			terrainAlphaMapCount: 0,
			roadAlphaMapCount: 0,
			uniquePcodeCount: 1,
			referencedTerrainCodes: [1],
			missingTerrainTypes: [1],
			missingSurfaceTextureAssetIds: [],
			missingRenderSurfaceAssetIds: [],
			unsupportedRenderSurfaceAssetIds: [],
			hasTerrainAlphaMaps: false,
			hasRoadAlphaMaps: false,
			diagnostics: ["Missing terrain material table terrain-material/1."],
		},
		terrainArtifact: null,
		dataSource: "repo-local-cell-landblock",
	};
}

function createReadyTerrainTile({
	pcodes,
}: {
	pcodes: readonly number[];
}): TerrainSceneModel["tiles"][number] {
	return {
		...createTerrainTile(),
		mesh: createTerrainMeshForPcodes(pcodes),
		materialResources: {
			kind: "terrain-material-resource-plan",
			regionNumber: 1,
			terrainMaterialAssetId: "terrain-material/1",
			status: "ready",
			signature: `terrain:1:ready:p=${pcodes.length}`,
			terrainTypeCount: pcodes.length,
			terrainAlphaMapCount: 0,
			roadAlphaMapCount: 0,
			uniquePcodeCount: pcodes.length,
			referencedTerrainCodes: pcodes.map((pcode) => pcode & 0x1f),
			missingTerrainTypes: [],
			missingSurfaceTextureAssetIds: [],
			missingRenderSurfaceAssetIds: [],
			unsupportedRenderSurfaceAssetIds: [],
			hasTerrainAlphaMaps: false,
			hasRoadAlphaMaps: false,
			diagnostics: [],
		},
	};
}

function createWorkerArtifactTerrainTile({
	pcode,
	renderSurfaceId,
}: {
	pcode: number;
	renderSurfaceId: number;
}): TerrainSceneModel["tiles"][number] {
	const mesh = createTerrainMeshForPcodes([pcode]);
	const materialResources = {
		kind: "terrain-material-resource-plan" as const,
		regionNumber: 1,
		terrainMaterialAssetId: "terrain-material/1",
		status: "ready" as const,
		signature: "terrain-artifact:ready",
		terrainTypeCount: 1,
		terrainAlphaMapCount: 0,
		roadAlphaMapCount: 0,
		uniquePcodeCount: 1,
		referencedTerrainCodes: [pcode & 0x1f],
		missingTerrainTypes: [],
		missingSurfaceTextureAssetIds: [],
		missingRenderSurfaceAssetIds: [],
		unsupportedRenderSurfaceAssetIds: [],
		hasTerrainAlphaMaps: false,
		hasRoadAlphaMaps: false,
		diagnostics: [],
	};
	const artifact = createTerrainArtifactFixture({
		mesh,
		materialResources,
		pcode,
		renderSurfaceId,
	});
	return {
		assetId: artifact.key,
		landblockId: artifact.landblockId,
		label: "1234",
		isFocus: true,
		chunkLocalOffset: { x: 0, y: 0, z: 0 },
		mesh,
		materialResources,
		terrainArtifact: artifact,
		dataSource: "worker-landblock-render-artifact",
	};
}

function createTerrainArtifactFixture({
	mesh,
	materialResources,
	pcode,
	renderSurfaceId,
}: {
	mesh: PreparedTerrainMesh;
	materialResources: TerrainSceneModel["tiles"][number]["materialResources"];
	pcode: number;
	renderSurfaceId: number;
}): LandblockTerrainRenderArtifact {
	const renderSurface = createRenderSurfacePayload({
		renderSurfaceId,
		compressed: false,
	});
	const terrainRef = {
		textureAssetId: "surface-texture/05000010",
		renderSurface,
		tiling: 4,
		wrap: "repeat" as const,
		role: "color" as const,
	};
	const layerPlan: TerrainTileLayerPlan = {
		layerEntries: [
			{
				slot: 0,
				pcode,
				plan: {
					pcode,
					base: terrainRef,
					overlays: [],
					roads: [],
					allRoad: false,
				},
				colorRefCount: 1,
				maskRefCount: 0,
			},
		],
		layerSlotByPcode: new Map([[pcode, 0]]),
		blockers: [],
		signature: "terrain-artifact-layer",
	};
	const geometry = buildTerrainTileLayerGeometry({
		mesh,
		plan: layerPlan,
		sourceSignature: "terrain-artifact/12340000/slice/0",
	});
	const preparedTexture = createAtlasPreparedTexturePayload(renderSurfaceId);
	const level = preparedTexture.levels[0];
	if (!level) {
		throw new Error("Prepared texture fixture must include a base mip level.");
	}
	return {
		type: "landblock-terrain-render-artifact",
		artifactKind: "terrain",
		key: "terrain-artifact/12340000",
		requestId: "request",
		landblockId: 0x12340000,
		regionNumber: 1,
		assetId: "landblock/12340000/outdoor",
		artifactRevision: "terrain-artifact-revision",
		buildPolicyRevision: "build:v1",
		cpuTexturePagePolicyRevision: "pages:v1",
		diagnosticRootAssetIds: [],
		diagnosticPreparedAssetIds: [],
		mesh,
		materialResources,
		blendPlanSignature: "blend:artifact",
		texturePageRefs: [
			{
				key: [
					"terrain-page",
					"color",
					terrainRef.textureAssetId,
					renderSurfaceId,
					renderSurface.formatRaw,
				].join(":"),
				sourceAssetId: formatAtlasReadyPreparedTextureAssetId({
					renderSurfaceId,
					usage: "raw",
				}),
				renderSurfaceId,
				role: "color",
				width: level.width,
				height: level.height,
				formatRaw: level.formatRaw,
				format: level.format,
				wrapS: "repeat",
				wrapT: "repeat",
				tiling: 4,
				bytes: level.bytes,
			},
		],
		layerPlan,
		drawSlices: [
			{
				key: "terrain-artifact/12340000/slice/0",
				slicePlan: {
					id: "slice/0",
					reason: "artifact fixture",
					layerPlan,
					pcodes: [pcode],
				},
				geometry,
			},
		],
		debugFallbackGeometry: {
			signature: "terrain-artifact/12340000/fallback",
			positions: new Float32Array(),
			uvs: null,
			indices: new Uint16Array(),
			vertexCount: 0,
			triangleCount: 0,
		},
		bvh: {
			coordinateSpace: "landblock-outdoor-terrain-local",
			nodes: [],
			items: [],
		},
		bvhItemKeys: [],
		diagnostics: {
			status: "ready",
			quadCount: mesh.quads.length,
			triangleCount: mesh.triangles.length,
			texturePageRefCount: 1,
			drawSliceCount: 1,
			materialDiagnostics: [],
			blendDiagnostics: [],
			fallbackReasons: [],
		},
	};
}

function createTerrainMesh(): PreparedTerrainMesh {
	const bounds = {
		min: { x: 0, y: 0, z: 0 },
		max: { x: 16, y: 0, z: 16 },
	};
	return {
		landblockId: 0x12340000,
		gridSize: 2,
		tileSize: 16,
		vertices: [
			{ x: 0, y: 0, z: 0 },
			{ x: 16, y: 0, z: 0 },
			{ x: 0, y: 16, z: 0 },
			{ x: 16, y: 16, z: 0 },
		],
		triangles: [
			{
				a: 0,
				b: 1,
				c: 2,
				quadIndex: 0,
				triangleInQuad: 0,
				debugTerrainPcode: 1,
				averageHeight: 0,
			},
			{
				a: 2,
				b: 1,
				c: 3,
				quadIndex: 0,
				triangleInQuad: 1,
				debugTerrainPcode: 1,
				averageHeight: 0,
			},
		],
		quads: [
			{
				terrainQuadId: "terrain/12340000/quad/0",
				row: 0,
				col: 0,
				quadIndex: 0,
				sourceTerrainIndices: [0, 1, 2, 3],
				vertexIndices: [0, 1, 2, 3],
				triangleIndices: [0, 1],
				diagonal: "southwest-northeast",
				cornerTerrainCodes: [1, 1, 1, 1],
				pcode: 1,
				averageHeight: 0,
				bounds,
			},
		],
		minHeight: 0,
		maxHeight: 0,
	};
}

function createTerrainMeshForPcodes(
	pcodes: readonly number[],
): PreparedTerrainMesh {
	const vertices: PreparedTerrainMesh["vertices"] = [];
	const triangles: PreparedTerrainMesh["triangles"] = [];
	const quads: PreparedTerrainMesh["quads"] = [];
	for (const [quadIndex, pcode] of pcodes.entries()) {
		const x = quadIndex * 16;
		const firstVertex = vertices.length;
		vertices.push(
			{ x, y: 0, z: 0 },
			{ x: x + 16, y: 0, z: 0 },
			{ x, y: 16, z: 0 },
			{ x: x + 16, y: 16, z: 0 },
		);
		const firstTriangle = triangles.length;
		triangles.push(
			{
				a: firstVertex,
				b: firstVertex + 1,
				c: firstVertex + 2,
				quadIndex,
				triangleInQuad: 0,
				debugTerrainPcode: pcode,
				averageHeight: 0,
			},
			{
				a: firstVertex + 2,
				b: firstVertex + 1,
				c: firstVertex + 3,
				quadIndex,
				triangleInQuad: 1,
				debugTerrainPcode: pcode,
				averageHeight: 0,
			},
		);
		const terrainCode = pcode & 0x1f;
		quads.push({
			terrainQuadId: `terrain/12340000/quad/${quadIndex}`,
			row: 0,
			col: quadIndex,
			quadIndex,
			sourceTerrainIndices: [0, 1, 2, 3],
			vertexIndices: [
				firstVertex,
				firstVertex + 1,
				firstVertex + 2,
				firstVertex + 3,
			],
			triangleIndices: [firstTriangle, firstTriangle + 1],
			diagonal: "southwest-northeast",
			cornerTerrainCodes: [terrainCode, terrainCode, terrainCode, terrainCode],
			pcode,
			averageHeight: 0,
			bounds: {
				min: { x, y: 0, z: 0 },
				max: { x: x + 16, y: 0, z: 16 },
			},
		});
	}
	return {
		landblockId: 0x12340000,
		gridSize: pcodes.length,
		tileSize: 16,
		vertices,
		triangles,
		quads,
		minHeight: 0,
		maxHeight: 0,
	};
}

function encodeUniformTerrainPcode(terrainCode: number): number {
	return (
		((terrainCode & 0x1f) << 15) |
		((terrainCode & 0x1f) << 10) |
		((terrainCode & 0x1f) << 5) |
		(terrainCode & 0x1f)
	);
}

function createStructuredInteriorCell({
	landblockId = 0x12340000,
	envCellId = landblockId | 0x100,
	materialSlots = [],
}: {
	landblockId?: number;
	envCellId?: number;
	materialSlots?: readonly ResolvedMaterialSlot[];
} = {}): StructuredInteriorCell {
	const landblockKey = `landblock/${landblockId.toString(16).padStart(8, "0")}`;
	return {
		renderKey: `interior/env-cell/${envCellId.toString(16).padStart(8, "0")}`,
		envCellId,
		regionNumber: 1,
		renderChunk: {
			chunkKey: landblockKey,
			chunkLandblockId: landblockId,
		},
		environmentId: 0x0d000001,
		cellStructureId: 0x0d000001,
		isFocus: false,
		chunkLocalPlacement: createPlacement({ x: 1, y: 2, z: 3 }),
		surfaceIds: [materialSlots[0]?.surfaceId ?? 0],
		portalCount: 0,
		portals: [],
		portalApertures: [],
		staticObjectCount: 0,
		cellStructure: null,
		cellBsp: null,
		renderGeometry:
			materialSlots.length > 0
				? createMaterialSlotGfxGeometry()
				: createStaticGfxGeometry(),
		debugColorKey: "interior-test",
		detailSignature: "detail:none",
	};
}

function createLeafBspNode(): PreparedPolygonSetBspNode {
	return {
		kind: "leaf",
		index: 0,
		solid: 0,
		sphere: null,
		polyIds: [],
	};
}

function createTransitionPortalModel() {
	return createEmptyTransitionPortalCandidateModel();
}

function createTextureAtlasGeneration(
	key: string,
	disposedKeys: string[],
): Webgl2TextureAtlasGenerationResource {
	return {
		key,
		textures: [],
		placements: [],
		detailTextures: [],
		detailPlacements: [],
		preparedTextureAssetIds: [],
		rgbaAtlasReadyDrawUnitIds: [],
		dispose() {
			disposedKeys.push(key);
		},
	};
}

function createIndexedAtlasGeneration(
	key: string,
	disposedKeys: string[],
): Webgl2IndexedResourceAtlasGenerationResource {
	return {
		key,
		indexTextures: [],
		paletteTextures: [],
		indexPlacements: [],
		palettePlacements: [],
		indexReadyDrawUnitIds: [],
		paletteReadyDrawUnitIds: [],
		dispose() {
			disposedKeys.push(key);
		},
	};
}
