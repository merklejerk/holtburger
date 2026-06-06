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
import { createBaseMaterialAppearanceContext } from "./material-appearance";
import type { ResolvedMaterialSlot } from "./material-plan";
import { WORLD_RENDER_DOMAIN } from "./render-domains";
import { RendererResourceGraph } from "./renderer-resource-graph";
import type { RenderChunkTransform } from "./render-anchor";
import {
	createEmptyStaticRenderableSceneModel,
	type StaticRenderablePart,
} from "./static-renderables";
import type { StructuredInteriorCell } from "./structured-interior-scene";
import type { LandblockTerrainRenderArtifact } from "./terrain-render-artifact";
import {
	getDetailedLandblockRenderArtifacts,
	type LandblockRenderProductWorkerResult,
} from "./landblock-render-product";
import type { TerrainSceneModel } from "./terrain-scene";
import {
	buildTerrainTileFallbackGeometry,
	buildTerrainTileLayerGeometry,
	type TerrainTileLayerPlan,
} from "./terrain-tile-plan";
import {
	commitWebgl2TransitionPortalProductMaskResources,
	commitWebgl2TerrainProductResources,
	createWebgl2WorldResourceStore,
	destroyWebgl2WorldResources,
	evictWebgl2TransitionPortalProductMaskResources,
	evictWebgl2TerrainProductResources,
	syncWebgl2WorldResources,
	updateWebgl2TerrainProductSamplerPolicy,
} from "./webgl2-world-resources";
import {
	commitWebgl2StructuredInteriorProductResources,
	evictWebgl2StructuredInteriorProductResources,
} from "./webgl2/resources/structured-interior-resources";

describe("webgl2 world resources", () => {
	it("commits and evicts detailed structured interiors by product key", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2WorldResourceStore();
		const cell = createStructuredInteriorCell();
		const product = createDetailedLandblockProductArtifact([cell]);
		const artifact = getDetailedLandblockRenderArtifacts(product);
		expect(artifact).not.toBeNull();
		const productKey = {
			landblockId: product.landblockId,
			product: product.product,
			buildPolicyRevision: product.buildPolicyRevision,
			texturePagePolicyRevision: product.texturePagePolicyRevision,
		};

		commitWebgl2StructuredInteriorProductResources({
			gl: gl.asContext(),
			store: store.structuredInteriorResources,
			productKey,
			artifact: artifact!,
			renderChunkTransforms: [createChunkTransform()],
			textureFilteringMode: "linear",
		});

		expect(store.structuredInteriorResources.productsByKey.size).toBe(1);
		expect(store.structuredInteriorResources.cellsByKey.size).toBe(1);
		expect(gl.createdTextures).toHaveLength(1);
		expect(gl.createdBuffers).toHaveLength(3);

		commitWebgl2StructuredInteriorProductResources({
			gl: gl.asContext(),
			store: store.structuredInteriorResources,
			productKey,
			artifact: artifact!,
			renderChunkTransforms: [createChunkTransform()],
			textureFilteringMode: "nearest",
		});

		expect(gl.createdTextures).toHaveLength(1);
		expect(gl.createdBuffers).toHaveLength(3);
		expect(gl.textureParameters).toContainEqual({
			pname: gl.TEXTURE_MIN_FILTER,
			param: gl.NEAREST,
		});

		evictWebgl2StructuredInteriorProductResources({
			store: store.structuredInteriorResources,
			productKey,
		});

		expect(store.structuredInteriorResources.productsByKey.size).toBe(0);
		expect(store.structuredInteriorResources.cellsByKey.size).toBe(0);
		expect(gl.deletedTextures).toHaveLength(1);
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
			staticRenderableScene: createStaticRenderableScene([part]),			renderChunkTransforms: [createChunkTransform()],
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
			staticRenderableScene: createStaticRenderableScene([part]),			renderChunkTransforms: [
				createChunkTransform({ offset: { x: 40, y: 50, z: 60 } }),
			],
			rendererResourceGraph: graph,
		});

		expect(store.drawUnits[0]?.vertexBuffer).toBe(vertexBuffer);
		expect(store.drawUnits[0]?.modelMatrix[12]).toBe(40);
		expect(gl.deletedBuffers).toHaveLength(0);
	});

	it("realizes terrain tile resources without generic draw-unit output", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2WorldResourceStore();
		const graph = new RendererResourceGraph();
		const terrainScene = createTerrainScene([createTerrainTile()]);

		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState: createAssetState(),
			terrainScene,
			staticRenderableScene: createStaticRenderableScene([]),			renderChunkTransforms: [
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
			staticRenderableScene: createStaticRenderableScene([]),			renderChunkTransforms: [
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
			staticRenderableScene: createStaticRenderableScene([]),			renderChunkTransforms: [
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
			staticRenderableScene: createStaticRenderableScene([]),			renderChunkTransforms: [
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
			staticRenderableScene: createStaticRenderableScene([]),			renderChunkTransforms: [
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

	it("reuses unchanged worker terrain artifact draw-slice buffers", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2WorldResourceStore();
		const graph = new RendererResourceGraph();
		const renderSurfaceId = 0x06000010;
		const terrainTile = createWorkerArtifactTerrainTile({
			pcode: encodeUniformTerrainPcode(1),
			renderSurfaceId,
			forceMultiSlice: true,
		});
		const terrainScene = createTerrainScene([terrainTile]);

		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState: createAssetState(),
			terrainScene,
			staticRenderableScene: createStaticRenderableScene([]),			renderChunkTransforms: [
				createChunkTransform({ landblockId: 0x1234ffff }),
			],
			rendererResourceGraph: graph,
		});

		const firstTile = store.terrainTiles[0];
		const firstDrawSlices = [...(firstTile?.drawSlices ?? [])];
		const createdBufferCount = gl.createdBuffers.length;
		const createdVertexArrayCount = gl.createdVertexArrays.length;
		expect(firstDrawSlices).toHaveLength(2);

		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState: createAssetState(),
			terrainScene,
			staticRenderableScene: createStaticRenderableScene([]),			renderChunkTransforms: [
				createChunkTransform({
					landblockId: 0x1234ffff,
					offset: { x: 40, y: 50, z: 60 },
				}),
			],
			rendererResourceGraph: graph,
		});

		expect(store.terrainTiles[0]?.drawSlices).toEqual(firstDrawSlices);
		expect(gl.createdBuffers).toHaveLength(createdBufferCount);
		expect(gl.createdVertexArrays).toHaveLength(createdVertexArrayCount);
		expect(gl.deletedBuffers).toHaveLength(0);
		expect(gl.deletedVertexArrays).toHaveLength(0);
		expect(store.terrainTiles[0]?.modelMatrix[12]).toBe(40);
		expect(store.terrainTiles[0]?.drawSlices[0]?.modelMatrix[12]).toBe(40);
	});

	it("commits, refreshes, and evicts worker terrain artifacts by product key", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2WorldResourceStore();
		const terrainTile = createWorkerArtifactTerrainTile({
			pcode: encodeUniformTerrainPcode(1),
			renderSurfaceId: 0x06000010,
		});
		const artifact = terrainTile.terrainArtifact;
		if (!artifact) {
			throw new Error("Worker terrain fixture must include an artifact.");
		}
		const productKey = {
			landblockId: artifact.landblockId,
			product: "outdoor" as const,
			buildPolicyRevision: artifact.buildPolicyRevision,
			texturePagePolicyRevision: artifact.cpuTexturePagePolicyRevision,
		};

		commitWebgl2TerrainProductResources({
			gl: gl.asContext(),
			store,
			productKey,
			artifact,
			renderChunkTransforms: [
				createChunkTransform({ landblockId: 0x1234ffff }),
			],
			textureFilteringMode: "linear",
		});

		const firstTile = store.terrainTiles[0];
		expect(firstTile?.id).toBe("terrain-tile/terrain-artifact/12340000");
		expect(firstTile?.texturePageBindings).toHaveLength(1);
		expect(firstTile?.oneDrawReadiness).toMatchObject({ status: "ready" });
		expect(store.terrainTileIdsByProductKey.size).toBe(1);
		expect(store.terrainTexturePageCount).toBe(1);
		expect(store.productTerrainTexturePagesByKey.size).toBe(1);
		expect(store.terrainTexturePagesByKey.size).toBe(0);
		expect(gl.createdBuffers).toHaveLength(4);
		expect(gl.createdVertexArrays).toHaveLength(1);
		expect(gl.createdTextures).toHaveLength(1);
		const firstTexturePage =
			[...store.productTerrainTexturePagesByKey.values()][0] ?? null;

		commitWebgl2TerrainProductResources({
			gl: gl.asContext(),
			store,
			productKey,
			artifact,
			renderChunkTransforms: [
				createChunkTransform({
					landblockId: 0x1234ffff,
					offset: { x: 40, y: 50, z: 60 },
				}),
			],
			textureFilteringMode: "linear",
		});

		expect(store.terrainTiles[0]).toBe(firstTile);
		expect(store.terrainTiles[0]?.modelMatrix[12]).toBe(40);
		expect(gl.createdBuffers).toHaveLength(4);
		expect(gl.createdVertexArrays).toHaveLength(1);
		expect(gl.createdTextures).toHaveLength(1);

		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState: createAssetState(),
			terrainScene: createTerrainScene([]),
			staticRenderableScene: createStaticRenderableScene([]),
			renderChunkTransforms: [
				createChunkTransform({ landblockId: 0x1234ffff }),
			],
		});

		expect(store.terrainTiles[0]).toBe(firstTile);
		expect(store.productTerrainTexturePagesByKey.size).toBe(1);
		expect(store.terrainTexturePagesByKey.size).toBe(0);
		expect(store.terrainTiles[0]?.texturePageBindings[0]?.texturePage).toBe(
			firstTexturePage,
		);
		expect(gl.createdTextures).toHaveLength(1);
		expect(gl.deletedTextures).toHaveLength(0);

		updateWebgl2TerrainProductSamplerPolicy({
			gl: gl.asContext(),
			store,
			textureFilteringMode: "nearest",
		});

		expect(gl.createdBuffers).toHaveLength(4);
		expect(gl.createdTextures).toHaveLength(2);
		expect(gl.deletedTextures).toHaveLength(1);
		expect(gl.textureParameters).toContainEqual({
			pname: gl.TEXTURE_MIN_FILTER,
			param: gl.NEAREST,
		});

		evictWebgl2TerrainProductResources({
			gl: gl.asContext(),
			store,
			productKey,
			textureFilteringMode: "nearest",
		});

		expect(store.terrainTiles).toEqual([]);
		expect(store.terrainTilesById.size).toBe(0);
		expect(store.terrainTileIdsByProductKey.size).toBe(0);
		expect(store.productTerrainTexturePagesByKey.size).toBe(0);
		expect(store.terrainTexturePageCount).toBe(0);
		expect(gl.deletedBuffers).toHaveLength(4);
		expect(gl.deletedVertexArrays).toHaveLength(1);
		expect(gl.deletedTextures).toHaveLength(2);
	});

	it("commits and evicts portal mask draw units by product key", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2WorldResourceStore();
		const productKey = {
			landblockId: 0x1234ffff,
			product: "outdoor-env-cells" as const,
			buildPolicyRevision: "build:v1",
			texturePagePolicyRevision: "pages:v1",
		};

		commitWebgl2TransitionPortalProductMaskResources({
			gl: gl.asContext(),
			store,
			productKey,
			transitionPortalModel: createTransitionPortalCandidateModel(),
			renderChunkTransforms: [createChunkTransform({ landblockId: 0x1234ffff })],
		});

		expect(store.portalMaskDrawUnitIdsByProductKey.size).toBe(1);
		expect(store.drawUnitsById.size).toBe(1);
		expect([...store.drawUnitsById.values()][0]?.kind).toBe("portal-mask");
		expect(gl.createdBuffers).toHaveLength(2);
		expect(gl.createdVertexArrays).toHaveLength(1);

		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState: createAssetState(),
			terrainScene: createTerrainScene([]),
			staticRenderableScene: createStaticRenderableScene([]),
			renderChunkTransforms: [createChunkTransform({ landblockId: 0x1234ffff })],
		});

		expect(store.drawUnits).toHaveLength(1);
		expect(store.drawUnits[0]?.kind).toBe("portal-mask");
		expect(store.drawUnitsById.size).toBe(1);

		evictWebgl2TransitionPortalProductMaskResources({ store, productKey });

		expect(store.portalMaskDrawUnitIdsByProductKey.size).toBe(0);
		expect(store.drawUnitsById.size).toBe(0);
		expect(gl.deletedBuffers).toHaveLength(2);
		expect(gl.deletedVertexArrays).toHaveLength(1);
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
			staticRenderableScene: createStaticRenderableScene([createStaticPart()]),			renderChunkTransforms: [createChunkTransform()],
			rendererResourceGraph: graph,
		});
		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState: createAssetState(),
			terrainScene: createTerrainScene(),
			staticRenderableScene: createStaticRenderableScene([]),			renderChunkTransforms: [createChunkTransform()],
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
			staticRenderableScene: createStaticRenderableScene([createStaticPart()]),			renderChunkTransforms: [createChunkTransform()],
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
			staticRenderableScene: createStaticRenderableScene([createStaticPart()]),			renderChunkTransforms: [createChunkTransform()],
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
			]),			renderChunkTransforms: [createChunkTransform()],
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
			staticRenderableScene: createStaticRenderableScene([]),			renderChunkTransforms: [createChunkTransform()],
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
			staticRenderableScene: scene,			renderChunkTransforms: [createChunkTransform()],
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
			staticRenderableScene: scene,			renderChunkTransforms: [createChunkTransform()],
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
			]),			renderChunkTransforms: [createChunkTransform()],
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
			]),			renderChunkTransforms: [createChunkTransform()],
		});

		expect(store.drawUnits[0]?.materialKind).toBe("direct-texture");
		expect(store.texturePageReadyMaterialCount).toBe(1);
		expect(store.atlasCandidateEntryCount).toBe(1);
		expect(store.atlasCandidateMaterialSlotCount).toBe(1);
	});

});

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

function createDetailedLandblockProductArtifact(
	input: StructuredInteriorCell | readonly StructuredInteriorCell[],
): LandblockRenderProductWorkerResult {
	const cells = Array.isArray(input) ? input : [input];
	const firstCell = cells[0];
	if (!firstCell) {
		throw new Error("Detailed landblock product fixture requires a cell.");
	}
	const landblockId = firstCell.renderChunk.chunkLandblockId;
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
				selectedEnvCellIds: cells.map((cell) => cell.envCellId),
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
				structuredInteriorCells: cells.map((cell) => ({
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
					})),
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

function createStaticTrianglePositions(): Float32Array {
	return new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
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
	forceMultiSlice = false,
}: {
	pcode: number;
	renderSurfaceId: number;
	forceMultiSlice?: boolean;
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
		forceMultiSlice,
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
	forceMultiSlice = false,
}: {
	mesh: PreparedTerrainMesh;
	materialResources: TerrainSceneModel["tiles"][number]["materialResources"];
	pcode: number;
	renderSurfaceId: number;
	forceMultiSlice?: boolean;
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
	const secondGeometry = buildTerrainTileLayerGeometry({
		mesh,
		plan: layerPlan,
		sourceSignature: "terrain-artifact/12340000/slice/1",
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
			...(forceMultiSlice
				? [
						{
							key: "terrain-artifact/12340000/slice/1",
							slicePlan: {
								id: "slice/1",
								reason: "artifact fixture overflow",
								layerPlan,
								pcodes: [pcode],
							},
							geometry: secondGeometry,
						},
					]
				: []),
		],
		debugFallbackGeometry: buildTerrainTileFallbackGeometry(
			mesh,
			"terrain-artifact/12340000/fallback",
		),
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

function createTransitionPortalCandidateModel() {
	return {
		candidates: [
			{
				id: "portal/1234/0",
				source: "browser-free-camera" as const,
				outdoorPortalId: "building/portal/0",
				aperture: {
					id: "portal/0",
					source: {
						kind: "env-cell" as const,
						envCellId: 0x12340001,
						portalId: "portal/0",
						sourceIndex: 0,
						polygonId: 7,
						flags: 0,
						otherPortalId: 0,
					},
					renderChunk: {
						chunkKey: "landblock/1234ffff",
						chunkLandblockId: 0x1234ffff,
						chunkLocalOffset: { x: 0, y: 0, z: 0 },
					},
					chunkLocalPlacement: {
						origin: { x: 0, y: 0, z: 0 },
						orientation: { w: 1, x: 0, y: 0, z: 0 },
					},
					points: [
						{ x: 0, y: 0, z: 0 },
						{ x: 1, y: 0, z: 0 },
						{ x: 0, y: 1, z: 0 },
					],
					plane: {
						normal: { x: 0, y: 0, z: 1 },
						constant: 0,
						source: "derived-from-render-points" as const,
					},
					visibleSide: "positive" as const,
					targetEnvCellId: 0x12340002,
					targetStatus: "loaded-visible" as const,
					outsideTransition: true,
				},
				insideVisibleSide: "positive" as const,
				outsideVisibleSide: "negative" as const,
				renderChunk: {
					chunkKey: "landblock/1234ffff",
					chunkLandblockId: 0x1234ffff,
					chunkLocalOffset: { x: 0, y: 0, z: 0 },
				},
				entryEnvCellId: 0x12340001,
				requestedInteriorEnvCellIds: [0x12340001],
				targetStatus: "loaded-visible" as const,
				stencilRef: 1,
			},
		],
		diagnostics: {
			loadedEnvCellPortalFactCount: 1,
			topologyPortalCount: 1,
			linkedTopologyPortalCount: 1,
			apertureCandidateCount: 1,
			workItemCandidateCount: 1,
			skippedMissingApertureCount: 0,
			skippedMissingPolygonCount: 0,
			truncatedInteriorGroupCount: 0,
		},
	};
}
