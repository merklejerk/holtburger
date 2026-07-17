import { describe, expect, it } from "vitest";
import type { RenderGeometryData } from "../renderer/geometry";
import type {
	GeometryResourceKey,
	RendererResourceManager,
	RenderResourceKey,
	TerrainCompositionResourceKey,
	TerrainSurfaceResourceKey,
	Texture2DResourceKey,
	Texture2DUpload,
	TextureArrayDescription,
	TextureArrayLayerUpload,
	TextureArrayResourceKey,
} from "../renderer/resource-manager";
import { AABB3, Vec3 } from "../math/types";
import type { TerrainGenerator } from "./terrain-generator";
import { TerrainService } from "./terrain-service";
import { resolveTerrainTextureFacts } from "./types";
import type {
	TerrainGenerationResult,
	TerrainGenerationSource,
	TerrainMeshStride,
	TerrainSurfaceField,
	TerrainTransitionDirection,
} from "./types";

const STRIDES: readonly TerrainMeshStride[] = [1, 2, 4, 8];
const TRANSITION_DIRECTIONS: readonly TerrainTransitionDirection[] = [
	"viewer-block",
	"north",
	"northeast",
	"east",
	"southeast",
	"south",
	"southwest",
	"west",
	"northwest",
];

describe("TerrainService", () => {
	it("generates once, realizes complete output, and selects a frame-time variant", async () => {
		const generator = new DeferredTerrainGenerator();
		const resources = new FakeRendererResourceManager();
		const terrain = new TerrainService(generator, resources);
		const installation = createInstallation();

		terrain.installSource(installation);
		terrain.installSource(installation);
		expect(generator.inputs).toEqual([installation.generation]);

		generator.resolve(createGenerationResult());
		await Promise.resolve();
		await Promise.resolve();

		expect(
			terrain.getDrawResources(
				installation.landblockId,
				installation.landblockId,
			),
		).toMatchObject({
			composition: "terrain-composition-resource:0",
			geometry: "geometry-resource:0",
			indexCount: 3,
			indexStart: 0,
			surfaceField: "terrain-surface-resource:0",
			textures: {
				blendMasks: "texture-array:terrain-blend-mask:terrain-region:1",
				colors: "texture-array:terrain-color:terrain-region:1",
				detail: "standalone-texture:terrain-detail:0x05000004",
				roadMasks: "texture-array:terrain-road-mask:terrain-region:1",
			},
		});

		terrain.removeSource(installation.landblockId);
		expect(resources.released).toEqual([
			"geometry-resource:0",
			"terrain-surface-resource:0",
			"terrain-surface-resource:1",
			"terrain-surface-resource:2",
			"terrain-surface-resource:3",
			"terrain-composition-resource:0",
		]);
	});

	it("shares one composition resource across interested landblocks in a region", () => {
		const resources = new FakeRendererResourceManager();
		const terrain = new TerrainService(
			new DeferredTerrainGenerator(),
			resources,
		);
		const first = createInstallation("0x1111ffff");
		const second = createInstallation("0x1211ffff");

		terrain.installSource(first);
		terrain.installSource(second);
		expect(resources.createdCompositions).toEqual([
			"terrain-composition-resource:0",
		]);

		terrain.removeSource(first.landblockId);
		expect(resources.released).toEqual([]);

		terrain.removeSource(second.landblockId);
		expect(resources.released).toEqual(["terrain-composition-resource:0"]);
	});
});

function createInstallation(landblockId = "0x1111ffff") {
	const composition = {
		cornerTerrainAlphaMaps: [
			{ blendMaskTextureId: "0x05000002", terrainCode: 1 },
		],
		landscapeDetail: { textureId: "0x05000004", tiling: 1 },
		regionNumber: 1,
		roadAlphaMaps: [{ roadCode: 1, roadMaskTextureId: "0x05000003" }],
		sideTerrainAlphaMaps: [
			{ blendMaskTextureId: "0x05000002", terrainCode: 3 },
		],
		terrainTypes: [
			{
				colorTextureId: "0x05000001",
				colorVariation: TERRAIN_VARIATION,
				terrainType: 0,
				tiling: 1,
			},
		],
	} as const;
	return {
		generation: {
			heightBytes: new Uint8Array(81),
			terrainSamples: new Uint16Array(81),
		},
		landblockId,
		presentation: {
			composition,
			textures: resolveTerrainTextureFacts(composition),
		},
	} as const;
}

const TERRAIN_VARIATION = {
	maxVertexBrightness: 0,
	maxVertexHue: 0,
	maxVertexSaturation: 0,
	minVertexBrightness: 0,
	minVertexHue: 0,
	minVertexSaturation: 0,
} as const;

function createGenerationResult(): TerrainGenerationResult {
	return {
		geometry: {
			indices: new Uint16Array([0, 1, 2]),
			kind: "terrain",
			normals: new Float32Array(9),
			positions: new Float32Array(9),
			textureCoordinates: new Float32Array(6),
		},
		surfaceFields: STRIDES.map(createSurfaceField),
		variants: STRIDES.flatMap((stride) =>
			TRANSITION_DIRECTIONS.map((transitionDirection) => ({
				bounds: new AABB3(Vec3.zero(), Vec3.zero()),
				indexCount: 3,
				indexStart: 0,
				variant: { stride, transitionDirection },
			})),
		),
	};
}

function createSurfaceField(stride: TerrainMeshStride): TerrainSurfaceField {
	const dimension = 8 / stride;
	return {
		cellPcodes: new Uint32Array(dimension * dimension),
		height: dimension,
		stride,
		width: dimension,
	};
}

class DeferredTerrainGenerator implements TerrainGenerator {
	readonly inputs: TerrainGenerationSource[] = [];
	#resolve: ((result: TerrainGenerationResult) => void) | undefined;

	generate(source: TerrainGenerationSource): Promise<TerrainGenerationResult> {
		this.inputs.push(source);
		return new Promise((resolve) => {
			this.#resolve = resolve;
		});
	}

	resolve(result: TerrainGenerationResult): void {
		if (!this.#resolve) throw new Error("Terrain generation is not pending.");
		this.#resolve(result);
	}

	async destroy(): Promise<void> {}
}

class FakeRendererResourceManager implements RendererResourceManager {
	readonly createdCompositions: TerrainCompositionResourceKey[] = [];
	readonly released: RenderResourceKey[] = [];
	#nextGeometry = 0;
	#nextSurface = 0;
	#nextComposition = 0;

	createGeometry(geometry: RenderGeometryData): GeometryResourceKey {
		void geometry;
		return `geometry-resource:${this.#nextGeometry++}`;
	}

	replaceGeometry(
		key: GeometryResourceKey,
		geometry: RenderGeometryData,
	): void {
		void key;
		void geometry;
	}

	createTerrainSurface(field: TerrainSurfaceField): TerrainSurfaceResourceKey {
		void field;
		return `terrain-surface-resource:${this.#nextSurface++}`;
	}

	createTerrainComposition(): TerrainCompositionResourceKey {
		const key: TerrainCompositionResourceKey = `terrain-composition-resource:${this.#nextComposition++}`;
		this.createdCompositions.push(key);
		return key;
	}

	createTexture2D(upload: Texture2DUpload): Texture2DResourceKey {
		void upload;
		throw new Error("Textures are not used by terrain service tests.");
	}

	replaceTexture2D(key: Texture2DResourceKey, upload: Texture2DUpload): void {
		void key;
		void upload;
	}

	createTextureArray(
		description: TextureArrayDescription,
	): TextureArrayResourceKey {
		void description;
		throw new Error("Textures are not used by terrain service tests.");
	}

	uploadTextureArrayLayer(
		key: TextureArrayResourceKey,
		upload: TextureArrayLayerUpload,
	): void {
		void key;
		void upload;
	}

	generateTextureArrayMipmaps(key: TextureArrayResourceKey): void {
		void key;
	}

	releaseResource(key: RenderResourceKey): boolean {
		this.released.push(key);
		return true;
	}

	async destroy(): Promise<void> {}
}
