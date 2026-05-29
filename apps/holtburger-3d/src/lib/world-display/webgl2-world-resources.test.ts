import { describe, expect, it } from "vitest";

import {
	createInitialAssetChannelState,
	type AssetChannelState,
	type PreparedPolygonSetRenderGeometry,
} from "../assets/types";
import { createBaseMaterialAppearanceContext } from "./material-appearance";
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
});

class FakeWebgl2 {
	readonly ARRAY_BUFFER = 1;
	readonly ELEMENT_ARRAY_BUFFER = 2;
	readonly STATIC_DRAW = 3;
	readonly FLOAT = 4;
	readonly UNSIGNED_SHORT = 5;
	readonly UNSIGNED_INT = 6;
	readonly createdBuffers: object[] = [];
	readonly deletedBuffers: object[] = [];
	readonly createdVertexArrays: object[] = [];
	readonly deletedVertexArrays: object[] = [];
	bufferUploads: BufferSource[] = [];

	asContext(): WebGL2RenderingContext {
		return this as unknown as WebGL2RenderingContext;
	}

	createBuffer(): WebGLBuffer {
		const buffer = {};
		this.createdBuffers.push(buffer);
		return buffer as WebGLBuffer;
	}

	bindBuffer(): void {
		return;
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

	bindVertexArray(): void {
		return;
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
}

function createAssetState(): AssetChannelState {
	const state = createInitialAssetChannelState();
	state.preparedByAssetId["gfx-obj/01000001"] = {
		payload: {
			kind: "gfx-obj",
			renderGeometry: createStaticGfxGeometry(),
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

function createStaticRenderableScene(parts: StaticRenderablePart[]) {
	return {
		...createEmptyStaticRenderableSceneModel(),
		partsByRenderGroupKey: new Map(),
		parts,
	};
}

function createStaticPart(): StaticRenderablePart {
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
		materialSlots: [],
		materialSignature: "base",
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
