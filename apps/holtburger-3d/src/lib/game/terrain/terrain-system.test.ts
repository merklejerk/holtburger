import { describe, expect, it, vi } from "vitest";
import type { RenderGeometryData } from "../renderer/geometry";
import { GeometryManager } from "../geometry/geometry-manager";
import type {
	GeometryResourceKey,
	InstanceStreamResourceKey,
	RendererResourceManager,
	RenderResourceKey,
	Texture2DResourceKey,
	Texture2DUpload,
	TextureArrayDescription,
	TextureArrayLayerUpload,
	TextureArrayResourceKey,
} from "../renderer/resource-manager";
import type { StaticInstanceStreamData } from "../systems/static-resources";
import { AABB3, Mat4, Vec3 } from "../math/types";
import { SceneGraph, type SceneNodeId } from "../scene";
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
	TerrainPcodeField,
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
				composition: "terrain-composition:test-region",
				geometry: "terrain-geometry:0x1111ffff",
				indexCount: 3,
				indexStart: 0,
				landblockId: "0x1111ffff",
				surfaceField: "terrain-surface:0x1111ffff/1",
				textures: {
					blendMasks:
						"texture-array:terrain-blend-mask:terrain-active-region:test-region",
					colors:
						"texture-array:terrain-color:terrain-active-region:test-region",
					detail: "asset-texture:terrain-detail:0x05000004",
					roadMasks:
						"texture-array:terrain-road-mask:terrain-active-region:test-region",
				},
			},
		);

		terrain.removeOwner(ownerId(installation.landblockId));
		expect(resources.released).toHaveLength(resources.created.length);
		expect(new Set(resources.released)).toEqual(new Set(resources.created));
	});

	it("publishes the selected render variant bounds when its anchor changes", async () => {
		const generator = new DeferredTerrainGenerator();
		const scene = new SceneGraph();
		const terrain = createTerrainSystem(
			generator,
			new FakeRendererResourceManager(),
			scene,
		);
		const installation = createInstallation();
		const nodeId = installTerrain(terrain, installation);
		const result = createGenerationResult();
		const updateBounds = vi.spyOn(scene, "updateBounds");

		terrain.updateSceneBoundsForAnchor(installation.landblockId);
		generator.resolve(result);
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(scene.getNode(nodeId)?.localBounds).toEqual(
			variantFor(result, 1, "viewer-block").bounds,
		);

		updateBounds.mockClear();
		terrain.updateSceneBoundsForAnchor(installation.landblockId);
		expect(updateBounds).not.toHaveBeenCalled();

		terrain.updateSceneBoundsForAnchor("0x1311ffff");
		expect(scene.getNode(nodeId)?.localBounds).toEqual(
			variantFor(result, 2, "west").bounds,
		);
		expect(updateBounds).toHaveBeenCalledWith(
			nodeId,
			variantFor(result, 2, "west").bounds,
		);
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

	it("retains every terrain texture fact independently of terrain generation", async () => {
		const resources = new FakeRendererResourceManager();
		const preparer = new RecordingTexturePreparer();
		const terrain = new TerrainSystem<string, string>(
			new SceneGraph(),
			new DeferredTerrainGenerator(),
			new GeometryManager<string>(resources),
			new TextureManager(resources, preparer),
			(landblockId) => `terrain-resource:${landblockId}`,
		);

		installTerrain(terrain, createInstallation());
		await Promise.resolve();
		await Promise.resolve();

		expect(preparer.facts.map(({ key }) => key)).toEqual([
			"texture-array:terrain-color:terrain-active-region:test-region",
			"texture-array:terrain-blend-mask:terrain-active-region:test-region",
			"texture-array:terrain-road-mask:terrain-active-region:test-region",
			"asset-texture:terrain-detail:0x05000004",
		]);
	});

	it("releases source-owned resources when generated surface realization fails", async () => {
		const generator = new DeferredTerrainGenerator();
		const resources = new FakeRendererResourceManager();
		const terrain = new TerrainSystem<string, string>(
			new SceneGraph(),
			generator,
			new GeometryManager<string>(resources),
			new TextureManager(resources, new PendingTexturePreparer()),
			(landblockId) => `terrain-resource:${landblockId}`,
		);
		const installation = createInstallation();
		const nodeId = installTerrain(terrain, installation);

		resources.failTexture2DCreationAt = 1;
		generator.resolve(createGenerationResult());
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(terrain.getDrawUnit(nodeId, installation.landblockId)).toBeNull();
		expect(resources.released).toEqual([
			"texture-2d-resource:0",
			"geometry-resource:0",
		]);
	});
});

function createTerrainSystem(
	generator: TerrainGenerator,
	resources: RendererResourceManager,
	scene = new SceneGraph(),
): TerrainSystem<string, string> {
	const textures = new TextureManager(resources, new FixtureTexturePreparer());
	const geometry = new GeometryManager<string>(resources);
	return new TerrainSystem<string, string>(
		scene,
		generator,
		geometry,
		textures,
		(landblockId) => `terrain-resource:${landblockId}`,
	);
}

function installTerrain(
	terrain: TerrainSystem<string, string>,
	source: ReturnType<typeof createInstallation>,
): SceneNodeId {
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
		activeRegionKey: "test-region",
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
			gridSize: 9,
			heightIndices: new Uint8Array(81),
			heights: new Float32Array(81),
			landblockId,
			terrainSamples: new Uint16Array(81),
			tileSize: 24,
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
	const variants = STRIDES.flatMap((stride) =>
		TRANSITION_DIRECTIONS.map((transitionDirection, directionIndex) => ({
			bounds: new AABB3(
				new Vec3(stride, directionIndex, -stride),
				new Vec3(stride + 1, directionIndex + 1, 0),
			),
			indexCount: 3,
			indexStart:
				(STRIDES.indexOf(stride) * TRANSITION_DIRECTIONS.length +
					directionIndex) *
				3,
			variant: { stride, transitionDirection },
		})),
	);
	return {
		geometry: {
			indices: new Uint16Array(variants.flatMap(() => [0, 1, 2])),
			kind: "terrain",
			normals: new Float32Array(9),
			positions: new Float32Array(9),
			textureCoordinates: new Float32Array(6),
		},
		surfaceFields: STRIDES.map(createSurfaceField),
		variants,
	};
}

function variantFor(
	result: TerrainGenerationResult,
	stride: TerrainMeshStride,
	transitionDirection: TerrainTransitionDirection,
) {
	const variant = result.variants.find(
		(candidate) =>
			candidate.variant.stride === stride &&
			candidate.variant.transitionDirection === transitionDirection,
	);
	if (!variant)
		throw new Error("Terrain test fixture is missing a requested variant.");
	return variant;
}

function createSurfaceField(stride: TerrainMeshStride): TerrainPcodeField {
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

class RecordingTexturePreparer extends FixtureTexturePreparer {
	readonly facts: TextureFact[] = [];

	override async prepare(fact: TextureFact) {
		this.facts.push(fact);
		return super.prepare(fact);
	}
}

/** Keeps asset preparation pending so the test isolates generated-resource realization. */
class PendingTexturePreparer implements TexturePreparer {
	async prepare(fact: TextureFact): Promise<never> {
		void fact;
		return new Promise<never>(() => {});
	}

	async destroy(): Promise<void> {}
}

class FakeRendererResourceManager implements RendererResourceManager {
	readonly created: RenderResourceKey[] = [];
	readonly createdTextures: Texture2DResourceKey[] = [];
	readonly released: RenderResourceKey[] = [];
	/** Zero-based creation ordinal at which a two-dimensional texture upload fails. */
	failTexture2DCreationAt: number | undefined;
	#nextGeometry = 0;
	#nextTexture = 0;
	#nextTextureArray = 0;

	createGeometry(geometry: RenderGeometryData): GeometryResourceKey {
		void geometry;
		const key: GeometryResourceKey = `geometry-resource:${this.#nextGeometry++}`;
		this.created.push(key);
		return key;
	}

	createStaticInstanceStream(
		data: StaticInstanceStreamData,
	): InstanceStreamResourceKey {
		void data;
		throw new Error("Terrain system tests do not create instance streams.");
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
		if (this.failTexture2DCreationAt === this.#nextTexture) {
			throw new Error("Synthetic generated texture upload failure.");
		}
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
