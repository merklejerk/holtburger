import { describe, expect, it } from "vitest";
import type { RenderGeometryData } from "../renderer/geometry";
import { GeometryManager } from "../geometry/geometry-manager";
import type {
	GeometryResourceKey,
	RendererResourceManager,
	RenderResourceKey,
	Texture2DResourceKey,
	Texture2DUpload,
	TextureArrayDescription,
	TextureArrayLayerUpload,
	TextureArrayResourceKey,
} from "../renderer/resource-manager";
import { AABB3, Mat4, Vec3 } from "../math/types";
import { SceneGraph } from "../scene";
import { TextureManager } from "../textures/texture-manager";
import type { TexturePreparer } from "../textures/texture-preparer";
import type { TextureFact } from "../textures/types";
import type { TerrainGenerator } from "./terrain-generator";
import { TerrainSystem } from "./terrain-system";
import { resolveTerrainTextureFacts, TERRAIN_MESH_STRIDES } from "./types";
import type {
	TerrainGenerationResult,
	TerrainGenerationSource,
	TerrainMeshStride,
	TerrainSurfaceField,
	TerrainTransitionDirection,
} from "./types";

const STRIDES = TERRAIN_MESH_STRIDES;
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

describe("TerrainSystem", () => {
	it("generates once, realizes complete output, and selects a frame-time variant", async () => {
		const generator = new DeferredTerrainGenerator();
		const resources = new FakeRendererResourceManager();
		const terrain = createTerrainSystem(generator, resources);
		const installation = createInstallation();
		const nodeId = installTerrain(terrain, installation);
		installTerrain(terrain, installation);
		expect(generator.inputs).toEqual([installation.generation]);

		generator.resolve(createGenerationResult());
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(terrain.getDrawUnit(nodeId, installation.landblockId)).toMatchObject(
			{
				composition: "terrain-composition:1",
				geometry: "terrain-geometry:0x1111ffff",
				indexCount: 3,
				indexStart: 0,
				landblockId: "0x1111ffff",
				surfaceField: "terrain-surface:0x1111ffff/1",
				textures: {
					blendMasks: "texture-array:terrain-blend-mask:terrain-region:1",
					colors: "texture-array:terrain-color:terrain-region:1",
					detail: "asset-texture:terrain-detail:0x05000004",
					roadMasks: "texture-array:terrain-road-mask:terrain-region:1",
				},
			},
		);

		terrain.removeOwner(ownerId(installation.landblockId));
		expect(resources.released).toHaveLength(resources.created.length);
		expect(new Set(resources.released)).toEqual(new Set(resources.created));
	});

	it("shares one composition resource across interested landblocks in a region", () => {
		const resources = new FakeRendererResourceManager();
		const terrain = createTerrainSystem(
			new DeferredTerrainGenerator(),
			resources,
		);
		const first = createInstallation("0x1111ffff");
		const second = createInstallation("0x1211ffff");
		installTerrain(terrain, first);
		installTerrain(terrain, second);
		expect(resources.createdTextures).toEqual(["texture-2d-resource:0"]);

		terrain.removeOwner(ownerId(first.landblockId));
		expect(resources.released).toEqual([]);

		terrain.removeOwner(ownerId(second.landblockId));
		expect(resources.released).toEqual(["texture-2d-resource:0"]);
	});
});

function createTerrainSystem(
	generator: TerrainGenerator,
	resources: RendererResourceManager,
): TerrainSystem<string, string> {
	const textures = new TextureManager(resources, new FixtureTexturePreparer());
	const geometry = new GeometryManager<string>(resources);
	return new TerrainSystem<string, string>(
		new SceneGraph(),
		generator,
		geometry,
		textures,
		(landblockId) => `terrain-resource:${landblockId}`,
	);
}

function installTerrain(
	terrain: TerrainSystem<string, string>,
	source: ReturnType<typeof createInstallation>,
): string {
	return terrain.install(ownerId(source.landblockId), {
		localBounds: AABB3.zero(),
		placement: {
			envCellId: null,
			landblockId: source.landblockId,
			localTransform: Mat4.identity(),
		},
		source,
	});
}

function ownerId(landblockId: string): `terrain-resource:${string}` {
	return `terrain-resource:${landblockId}`;
}

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

class FixtureTexturePreparer implements TexturePreparer {
	async prepare(fact: TextureFact) {
		if (fact.kind === "asset") {
			return {
				height: 2,
				key: fact.key,
				pixels: new Uint8Array(16),
				purpose: fact.purpose,
				sourceAssetId: fact.sourceAssetId,
				width: 2,
			};
		}
		return {
			height: 2,
			key: fact.key,
			layers: fact.sourceAssetIds.map((sourceAssetId) => ({
				pixels: new Uint8Array(16),
				sourceAssetId,
			})),
			purpose: fact.purpose,
			width: 2,
		};
	}

	async destroy(): Promise<void> {}
}

class FakeRendererResourceManager implements RendererResourceManager {
	readonly created: RenderResourceKey[] = [];
	readonly createdTextures: Texture2DResourceKey[] = [];
	readonly released: RenderResourceKey[] = [];
	#nextGeometry = 0;
	#nextTexture = 0;
	#nextTextureArray = 0;

	createGeometry(geometry: RenderGeometryData): GeometryResourceKey {
		void geometry;
		const key: GeometryResourceKey = `geometry-resource:${this.#nextGeometry++}`;
		this.created.push(key);
		return key;
	}

	replaceGeometry(
		key: GeometryResourceKey,
		geometry: RenderGeometryData,
	): void {
		void key;
		void geometry;
	}

	createTexture2D(upload: Texture2DUpload): Texture2DResourceKey {
		void upload;
		const key: Texture2DResourceKey = `texture-2d-resource:${this.#nextTexture++}`;
		this.created.push(key);
		this.createdTextures.push(key);
		return key;
	}

	replaceTexture2D(key: Texture2DResourceKey, upload: Texture2DUpload): void {
		void key;
		void upload;
	}

	createTextureArray(
		description: TextureArrayDescription,
	): TextureArrayResourceKey {
		void description;
		const key: TextureArrayResourceKey = `texture-array-resource:${this.#nextTextureArray++}`;
		this.created.push(key);
		return key;
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
