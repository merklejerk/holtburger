import { describe, expect, it } from "vitest";

import {
	formatAtlasReadyPreparedTextureAssetId,
	type PreparedPolygonSetBspNode,
	type PreparedTerrainMesh,
	type PreparedPolygonSetRenderGeometry,
	type PreparedRenderSurfacePayload,
	type PreparedTexturePayload,
} from "../assets/types";
import type { ResolvedMaterialSlot } from "./material-plan";
import type { RenderChunkTransform } from "./render-anchor";
import { createStaticMaterialFamilyDescriptor } from "./static-material-artifacts";
import type { StructuredInteriorCell } from "./structured-interior-scene";
import type { LandblockTerrainRenderArtifact } from "./terrain-render-artifact";
import { createTestPreparedAssetResolver } from "../../../test-support/prepared-asset-resolver";
import {
	getDetailedLandblockRenderArtifacts,
	type LandblockRenderProductWorkerResult,
} from "./landblock-render-product";
import {
	buildTerrainTileFallbackGeometry,
	buildTerrainTileLayerGeometry,
	type TerrainTileLayerPlan,
} from "./terrain-tile-plan";
import {
	clearWebgl2TransitionPortalMaskResources,
	commitWebgl2TerrainProductResources,
	createWebgl2WorldResourceStore,
	evictWebgl2TerrainProductResources,
	syncWebgl2TransitionPortalMaskResources,
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
			textureFilteringMode: "linear",
		});

		expect(store.structuredInteriorResources.productsByKey.size).toBe(1);
		expect(store.structuredInteriorResources.cellsByKey.size).toBe(1);
		expect(gl.createdTextures).toHaveLength(1);
		expect(gl.createdBuffers).toHaveLength(4);

		commitWebgl2StructuredInteriorProductResources({
			gl: gl.asContext(),
			store: store.structuredInteriorResources,
			productKey,
			artifact: artifact!,
			textureFilteringMode: "nearest",
		});

		expect(gl.createdTextures).toHaveLength(1);
		expect(gl.createdBuffers).toHaveLength(4);
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

	it("commits, refreshes, and evicts worker terrain artifacts by product key", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2WorldResourceStore();
		const artifact = createWorkerTerrainArtifact({
			pcode: encodeUniformTerrainPcode(1),
			renderSurfaceId: 0x06000010,
		});
		const productKey = {
			landblockId: artifact.landblockId,
			product: "outdoor-terrain" as const,
			buildPolicyRevision: artifact.buildPolicyRevision,
			texturePagePolicyRevision: artifact.cpuTexturePagePolicyRevision,
		};

		commitWebgl2TerrainProductResources({
			gl: gl.asContext(),
			store,
			productKey,
			artifact,
			assetReadModel: emptyAssetReadModel(),
			textureFilteringMode: "linear",
		});

		const firstTile = store.terrainTiles[0];
		expect(firstTile?.id).toBe("terrain-tile/terrain-artifact/12340000");
		expect(firstTile?.texturePageBindings).toHaveLength(1);
		expect(firstTile?.oneDrawReadiness).toMatchObject({ status: "ready" });
		expect(store.terrainTileIdsByProductKey.size).toBe(1);
		expect(store.terrainTexturePageCount).toBe(1);
		expect(store.productTerrainTexturePagesByKey.size).toBe(1);
		expect(gl.createdBuffers).toHaveLength(4);
		expect(gl.createdVertexArrays).toHaveLength(1);
		expect(gl.createdTextures).toHaveLength(1);
		const firstTexturePage =
			[...store.productTerrainTexturePagesByKey.values()][0] ?? null;
		expect(firstTexturePage).toMatchObject({
			bucket: "terrain-color",
			textureIndex: 0,
			sampleClass: "rgba-color",
			pageKind: "packed-atlas",
			indexedFormat: null,
			mipmapsGenerated: true,
			entries: [
				{
					virtualRefKey: "terrain-page/color/06000010/21/1/1",
					sourceAssetId:
						"terrain-artifact-texture/terrain-artifact/12340000/terrain-page:color:surface-texture/05000010:100663312:21",
				},
			],
		});
		expect(firstTexturePage?.entries[0]?.rect).toEqual([96, 96, 1, 1]);
		expect(
			store.productTerrainTexturePagesByBucketIndex.get("terrain-color:0"),
		).toBe(firstTexturePage);

		commitWebgl2TerrainProductResources({
			gl: gl.asContext(),
			store,
			productKey,
			artifact,
			assetReadModel: emptyAssetReadModel(),
			textureFilteringMode: "linear",
		});

		expect(store.terrainTiles[0]).toBe(firstTile);
		expect(store.terrainTiles[0]?.renderChunkKey).toBe("landblock/1234ffff");
		expect(gl.createdBuffers).toHaveLength(4);
		expect(gl.createdVertexArrays).toHaveLength(1);
		expect(gl.createdTextures).toHaveLength(1);

		expect(store.terrainTiles[0]).toBe(firstTile);
		expect(store.productTerrainTexturePagesByKey.size).toBe(1);
		expect(store.terrainTiles[0]?.texturePageBindings[0]?.texturePage).toBe(
			firstTexturePage,
		);
		expect(gl.createdTextures).toHaveLength(1);
		expect(gl.deletedTextures).toHaveLength(0);

		updateWebgl2TerrainProductSamplerPolicy({
			gl: gl.asContext(),
			store,
			assetReadModel: emptyAssetReadModel(),
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
			assetReadModel: emptyAssetReadModel(),
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

	it("syncs and clears dedicated transition portal mask resources", () => {
		const gl = new FakeWebgl2();
		const store = createWebgl2WorldResourceStore();

		syncWebgl2TransitionPortalMaskResources({
			gl: gl.asContext(),
			store,
			transitionPortalModel: createTransitionPortalCandidateModel(),
		});

		expect(store.transitionPortalMasks).toHaveLength(1);
		expect(store.transitionPortalMasksById.size).toBe(1);
		expect(gl.createdBuffers).toHaveLength(2);
		expect(gl.createdVertexArrays).toHaveLength(1);

		clearWebgl2TransitionPortalMaskResources({ store });

		expect(store.transitionPortalMasks).toHaveLength(0);
		expect(store.transitionPortalMasksById.size).toBe(0);
		expect(gl.deletedBuffers).toHaveLength(2);
		expect(gl.deletedVertexArrays).toHaveLength(1);
	});
});

function emptyAssetReadModel() {
	return createTestPreparedAssetResolver([]);
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
						familyKey: "static:textured-opaque:alpha=opaque",
						family: createStaticMaterialFamilyDescriptor({
							family: "textured-opaque",
							alphaPolicy: "opaque",
						}),
						color: [1, 1, 1, 1],
						texturePageRefKeys: ["interior-texture-ref"],
						detailOverlay: null,
						detailTextureRefKey: null,
						detailTiling: 1,
						isTransparent: false,
					},
				],
				structuredInteriorTexturePageRefs: [
					{
						key: "interior-texture-ref",
						sourceAssetId: "prepared-texture/06000001/raw",
						role: "base-color",
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
						role: "base-color",
						sampleClass: "rgba-color",
						width: 1,
						height: 1,
						bytes: new Uint8Array([255, 255, 255, 255]),
						entries: [
							{
								sourcePlacementKey: "source-placement:interior-texture",
								virtualRefKey: "interior-texture-ref",
								virtualRefKeys: ["interior-texture-ref"],
								sourceAssetId: "prepared-texture/06000001/raw",
								role: "base-color",
								sampleClass: "rgba-color",
								samplingDomain: "color",
								lookup: "color-filtered",
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
							normals: createStaticTriangleNormals(),
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

function createStaticTriangleNormals(): Float32Array {
	return new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
}

function createWorkerTerrainArtifact({
	pcode,
	renderSurfaceId,
	forceMultiSlice = false,
}: {
	pcode: number;
	renderSurfaceId: number;
	forceMultiSlice?: boolean;
}): LandblockTerrainRenderArtifact {
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
	return artifact;
}

function createTerrainArtifactFixture({
	mesh,
	materialResources,
	pcode,
	renderSurfaceId,
	forceMultiSlice = false,
}: {
	mesh: PreparedTerrainMesh;
	materialResources: LandblockTerrainRenderArtifact["materialResources"];
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
