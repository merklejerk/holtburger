import { describe, expect, it } from "vitest";

import {
	createInitialAssetChannelState,
	formatAtlasReadyPreparedTextureAssetId,
	type AssetChannelState,
	type PreparedMaterialRecipePayload,
	type PreparedPalettePayload,
	type PreparedPolygonSetRenderGeometry,
	type PreparedRenderSurfacePayload,
	type PreparedTexturePayload,
} from "../assets/types";
import { createBaseMaterialAppearanceContext } from "./material-appearance";
import type { ResolvedMaterialSlot } from "./material-plan";
import { WORLD_RENDER_DOMAIN } from "./render-domains";
import { RendererResourceGraph } from "./renderer-resource-graph";
import type { RenderChunkTransform } from "./render-anchor";
import {
	createEmptyStaticRenderableSceneModel,
	type StaticRenderablePart,
} from "./static-renderables";
import { createEmptyStructuredInteriorSceneModel } from "./structured-interior-scene";
import { createEmptyTransitionPortalCandidateModel } from "./transition-portal-work-items";
import {
	createWebgl2WorldResourceStore,
	destroyWebgl2WorldResources,
	syncWebgl2WorldResources,
} from "./webgl2-world-resources";

describe("webgl2 world resources", () => {
	it("realizes staged static draw units as retained WebGL2 resources", () => {
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
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform()],
			rendererResourceGraph: graph,
		});

		expect(store.drawUnits).toHaveLength(1);
		expect(store.staticDrawUnitCount).toBe(1);
		expect(store.staticInstanceCount).toBe(1);
		expect(store.triangleCount).toBe(1);
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
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform({ x: 40, y: 50, z: 60 })],
			rendererResourceGraph: graph,
		});

		expect(store.drawUnits[0]?.vertexBuffer).toBe(vertexBuffer);
		expect(store.drawUnits[0]?.modelMatrix[12]).toBe(40);
		expect(gl.deletedBuffers).toHaveLength(0);
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
			structuredInteriorScene: createStructuredInteriorScene(),
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
			structuredInteriorScene: createStructuredInteriorScene(),
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
			structuredInteriorScene: createStructuredInteriorScene(),
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
			structuredInteriorScene: createStructuredInteriorScene(),
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
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform()],
		});

		expect(store.drawUnits).toHaveLength(1);
		expect(store.drawUnits[0]?.materialKind).toBe("direct-texture");
		expect(store.drawUnits[0]?.uvBuffer).not.toBeNull();
		expect(store.drawUnits[0]?.texture).not.toBeNull();
		expect(store.textureCount).toBe(1);
		expect(gl.createdTextures).toHaveLength(1);
		expect(
			gl.textureUploads.map(({ width, height }) => ({ width, height })),
		).toEqual([{ width: 1, height: 1 }]);
		expect(gl.generatedMipmapCount).toBe(1);
		expect(store.textureSamplingPolicySamples).toEqual([
			"wrap=clamp/clamp;filter=linear/linear/linear;color=srgb;aniso=1;mips=on;flipY=off",
		]);

		syncWebgl2WorldResources({
			gl: gl.asContext(),
			store,
			assetState: createAssetState({ materialSurfaceId, renderSurfaceId }),
			terrainScene: createTerrainScene(),
			staticRenderableScene: createStaticRenderableScene([]),
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform()],
		});

		expect(store.textureCount).toBe(0);
		expect(gl.deletedTextures).toHaveLength(1);
	});

	it("reports atlas-eligible direct materials without changing staged rendering", () => {
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
			]),
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform()],
		});

		expect(store.drawUnits[0]?.materialKind).toBe("direct-texture");
		expect(store.atlasEligibleMaterialCount).toBe(1);
		expect(store.atlasCandidateEntryCount).toBe(1);
		expect(store.atlasCandidateMaterialSlotCount).toBe(1);
		expect(store.atlasCandidateSamples[0]).toContain("static");
		expect(store.atlasCandidateSamples[0]).toContain("atlas-entry");
	});

	it("realizes indexed/paletted draw units with separate index and palette textures", () => {
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
				indexed: true,
			}),
			terrainScene: createTerrainScene(),
			staticRenderableScene: createStaticRenderableScene([
				createStaticPart({
					materialSlots: [createMaterialSlot(0, materialSurfaceId)],
				}),
			]),
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform()],
		});

		expect(store.drawUnits).toHaveLength(1);
		expect(store.drawUnits[0]?.materialKind).toBe("indexed-paletted");
		expect(store.drawUnits[0]?.uvBuffer).not.toBeNull();
		expect(store.drawUnits[0]?.indexedMaterial).toMatchObject({
			indexFormat: "p8",
			width: 2,
			height: 1,
			paletteColorCount: 2,
		});
		expect(store.textureCount).toBe(2);
		expect(store.indexedTextureCount).toBe(1);
		expect(store.paletteTextureCount).toBe(1);
		expect(
			gl.textureUploads.map(({ width, height }) => ({ width, height })),
		).toEqual([
			{ width: 2, height: 1 },
			{ width: 2, height: 1 },
		]);
		expect(gl.generatedMipmapCount).toBe(0);
	});

	it("uploads Index16 draw units as RG byte-pair textures matching the Three indexed shader", () => {
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
				indexed: true,
				indexedFormat: "index16",
			}),
			terrainScene: createTerrainScene(),
			staticRenderableScene: createStaticRenderableScene([
				createStaticPart({
					materialSlots: [createMaterialSlot(0, materialSurfaceId)],
				}),
			]),
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform()],
		});

		expect(store.drawUnits[0]?.indexedMaterial).toMatchObject({
			indexFormat: "index16",
			width: 2,
			height: 1,
			paletteColorCount: 258,
		});
		expect(gl.textureUploads[0]).toMatchObject({
			width: 2,
			height: 1,
			internalFormat: gl.RG8,
			format: gl.RG,
			type: gl.UNSIGNED_BYTE,
		});
		expect(gl.textureUploads[0]?.data).toEqual(
			Uint8Array.from([0x00, 0x00, 0x01, 0x01]),
		);
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

	texParameteri(): void {
		return;
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
}: {
	materialSurfaceId?: number;
	renderSurfaceId?: number;
	compressedAtlasReady?: boolean;
	indexed?: boolean;
	indexedFormat?: "p8" | "index16";
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
	materialSlots = [],
}: {
	materialSlots?: readonly ResolvedMaterialSlot[];
} = {}): StaticRenderablePart {
	return {
		renderKey: "static/group",
		renderDomain: WORLD_RENDER_DOMAIN.exteriorStatic,
		instanceId: "instance-a",
		sourceAssetId: "gfx-obj/01000001",
		sourceDid: 0x01000001,
		owningLandblockId: 0x12340000,
		regionNumber: 1,
		owningEnvCellId: null,
		renderChunk: {
			chunkKey: "landblock/12340000",
			chunkLandblockId: 0x12340000,
		},
		kind: "scenery",
		partIndex: 0,
		gfxObjId: 0x01000001,
		gfxObjAssetId: "gfx-obj/01000001",
		materialAppearanceContext: createBaseMaterialAppearanceContext("base"),
		materialSlots,
		materialSignature: materialSlots.length > 0 ? "textured" : "base",
		parentPlacements: [],
		chunkLocalInstancePlacement: createPlacement({ x: 1, y: 2, z: 3 }),
		partPlacements: [],
		scale: { x: 1, y: 1, z: 1 },
		debugColorKey: "instance-a",
		textureVelocity: null,
		textureVelocitySignature: "uv:none",
		detailRoleKind: "scenery",
		detailSignature: "detail:none",
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

function createChunkTransform(
	offset: RenderChunkTransform["offset"] = { x: 10, y: 20, z: 30 },
): RenderChunkTransform {
	return {
		chunkKey: "landblock/12340000",
		chunkLandblockId: 0x12340000,
		offset,
	};
}

function createTerrainScene() {
	return {
		focusLandblockId: null,
		statusText: "test",
		cacheText: "test",
		dataSourceText: "test",
		tiles: [],
	};
}

function createStructuredInteriorScene() {
	return createEmptyStructuredInteriorSceneModel();
}

function createTransitionPortalModel() {
	return createEmptyTransitionPortalCandidateModel();
}
