import { describe, expect, it, vi } from "vitest";
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
import { SceneGraph, type SceneNodeId } from "../scene";
import { TextureManager } from "../textures/texture-manager";
import type {
	PreparedTextureSource,
	TexturePreparer,
} from "../textures/texture-preparer";
import { TexturePurpose, type TextureFact } from "../textures/types";
import type { TerrainGenerator } from "./terrain-generator";
import type { ClosedWorkerPoolDiagnostics } from "../workers/closed-worker";
import { TerrainSystem } from "./terrain-system";
import { compileTerrainCompositionTable } from "./composition-table";
import { resolveTerrainMaterialTable } from "./terrain-materials";
import { TERRAIN_TYPE_COUNT } from "./pcode";
import { resolveTerrainTextureFacts, TERRAIN_GRID_CELLS } from "./types";
import type { TerrainGenerationResult, TerrainGenerationSource } from "./types";

/** Distinctive bounds so a published value is traceable to the generation result. */
const GENERATED_BOUNDS = new AABB3(new Vec3(0, -3, -192), new Vec3(192, 7, 0));

describe("TerrainSystem", () => {
	it("generates once and realizes one complete draw unit", async () => {
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

		expect(terrain.getDrawUnit(nodeId)).toMatchObject({
			composition: "terrain-composition:test-region",
			geometry: "terrain-geometry:0x1111ffff",
			landblockId: "0x1111ffff",
			surfaceField: "terrain-surface:0x1111ffff",
			textures: {
				blendMasks:
					"texture-array:terrain-blend-mask:terrain-active-region:test-region",
				colors: "texture-array:terrain-color:terrain-active-region:test-region",
				detail: "asset-texture:terrain-detail:0x05000004",
				roadMasks:
					"texture-array:terrain-road-mask:terrain-active-region:test-region",
			},
		});

		terrain.removeOwner(ownerId(installation.landblockId));
		expect(resources.released).toHaveLength(resources.created.length);
		expect(new Set(resources.released)).toEqual(new Set(resources.created));
	});

	it("publishes the generated mesh bounds once the landblock realizes", async () => {
		const generator = new DeferredTerrainGenerator();
		const scene = new SceneGraph();
		const terrain = createTerrainSystem(
			generator,
			new FakeRendererResourceManager(),
			scene,
		);
		const installation = createInstallation();
		const nodeId = installTerrain(terrain, installation);
		const updateBounds = vi.spyOn(scene, "updateBounds");

		generator.resolve(createGenerationResult());
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(scene.getNode(nodeId)?.localBounds).toEqual(GENERATED_BOUNDS);
		expect(updateBounds).toHaveBeenCalledWith(nodeId, GENERATED_BOUNDS);
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

	it("publishes no draw unit until the complete regional palette becomes resident", async () => {
		const generator = new DeferredTerrainGenerator();
		const resources = new FakeRendererResourceManager();
		const preparer = new DeferredTerrainTexturePreparer();
		const terrain = new TerrainSystem<string, string>(
			new SceneGraph(),
			generator,
			new GeometryManager<string>(resources),
			new TextureManager(resources, preparer),
			(landblockId) => `terrain-resource:${landblockId}`,
		);
		const installation = createInstallation();
		const nodeId = installTerrain(terrain, installation);

		generator.resolve(createGenerationResult());
		await Promise.resolve();
		await Promise.resolve();
		expect(
			resources.created.some((key) => key.startsWith("geometry-resource:")),
		).toBe(true);
		expect(terrain.getDrawUnit(nodeId)).toBeNull();

		preparer.resolveConventionalTextures();
		await Promise.resolve();
		await Promise.resolve();
		expect(terrain.getDrawUnit(nodeId)).toBeNull();

		preparer.resolveTerrainColor();
		await Promise.resolve();
		await Promise.resolve();
		expect(terrain.getDrawUnit(nodeId)).not.toBeNull();
		expect(generator.inputs).toHaveLength(1);
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

		expect(terrain.getDrawUnit(nodeId)).toBeNull();
		expect(resources.released).toEqual([
			"texture-2d-resource:0",
			"geometry-resource:0",
		]);
	});

	it("discards a generation result that settles after its installation is evicted", async () => {
		const generator = new DeferredTerrainGenerator();
		const resources = new FakeRendererResourceManager();
		const terrain = createTerrainSystem(generator, resources);
		const installation = createInstallation();
		const nodeId = installTerrain(terrain, installation);
		const reportError = vi.spyOn(console, "error").mockImplementation(() => {});

		terrain.removeOwner(ownerId(installation.landblockId));
		generator.resolve(createGenerationResult());
		await Promise.resolve();
		await Promise.resolve();

		expect(terrain.getDrawUnit(nodeId)).toBeNull();
		expect(resources.created).toEqual(["texture-2d-resource:0"]);
		expect(resources.released).toEqual(["texture-2d-resource:0"]);
		expect(reportError).not.toHaveBeenCalled();
		reportError.mockRestore();
	});

	it("discards both running and queued generation after their installations are evicted", async () => {
		const generator = new QueuedTerrainGenerator();
		const resources = new FakeRendererResourceManager();
		const terrain = createTerrainSystem(generator, resources);
		const running = createInstallation("0x1111ffff");
		const queued = createInstallation("0x1211ffff");
		const runningNodeId = installTerrain(terrain, running);
		const queuedNodeId = installTerrain(terrain, queued);
		const reportError = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(generator.states).toEqual(["running", "queued"]);

		terrain.removeOwner(ownerId(running.landblockId));
		terrain.removeOwner(ownerId(queued.landblockId));
		generator.completeRunning(createGenerationResult());
		await Promise.resolve();
		expect(generator.states).toEqual(["running"]);
		generator.completeRunning(createGenerationResult());
		await Promise.resolve();
		await Promise.resolve();

		expect(terrain.getDrawUnit(runningNodeId)).toBeNull();
		expect(terrain.getDrawUnit(queuedNodeId)).toBeNull();
		expect(
			resources.created.filter((key) => key.startsWith("geometry-resource:")),
		).toEqual([]);
		expect(reportError).not.toHaveBeenCalled();
		reportError.mockRestore();
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
		terrainMaterials: resolveTerrainMaterialTable([
			{
				colorTextureId: "0x05000001",
				colorVariation: TERRAIN_VARIATION,
				terrainType: 0,
				tiling: 1,
			},
		]),
	} as const;
	const textures = resolveTerrainTextureFacts(composition);
	return {
		generation: {
			cellDiagonals: new Uint8Array(64),
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
			compositionTable: compileTerrainCompositionTable(composition, textures),
			textures,
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
		bounds: GENERATED_BOUNDS,
		geometry: {
			indices: new Uint16Array([0, 1, 2]),
			kind: "terrain",
			normals: new Float32Array(9),
			positions: new Float32Array(9),
			terrainColorCodes: new Uint8Array(3),
			textureCoordinates: new Float32Array(6),
		},
		surfaceField: {
			cellPcodes: new Uint32Array(TERRAIN_GRID_CELLS * TERRAIN_GRID_CELLS),
			height: TERRAIN_GRID_CELLS,
			width: TERRAIN_GRID_CELLS,
		},
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

	getDiagnostics(): ClosedWorkerPoolDiagnostics {
		return {
			activeJobCount: 0,
			completedJobCount: 0,
			peakQueuedJobCount: 0,
			queuedJobCount: 0,
			totalExecutionDurationMs: 0,
			totalQueueDelayMs: 0,
			transferredBytes: 0,
			workerCount: 1,
		};
	}

	async destroy(): Promise<void> {}
}

/** One-slot scheduler fixture that makes running versus queued settlement explicit. */
class QueuedTerrainGenerator implements TerrainGenerator {
	readonly #jobs: {
		resolve: (result: TerrainGenerationResult) => void;
		state: "queued" | "running";
	}[] = [];

	get states(): readonly ("queued" | "running")[] {
		return this.#jobs.map(({ state }) => state);
	}

	generate(): Promise<TerrainGenerationResult> {
		return new Promise((resolve) => {
			this.#jobs.push({
				resolve,
				state: this.#jobs.some(({ state }) => state === "running")
					? "queued"
					: "running",
			});
		});
	}

	completeRunning(result: TerrainGenerationResult): void {
		const runningIndex = this.#jobs.findIndex(
			({ state }) => state === "running",
		);
		if (runningIndex < 0) throw new Error("Terrain generation is not running.");
		const running = this.#jobs[runningIndex];
		if (!running) throw new Error("Running terrain job disappeared.");
		this.#jobs.splice(runningIndex, 1);
		running.resolve(result);
		if (this.#jobs[0]) this.#jobs[0].state = "running";
	}

	getDiagnostics(): ClosedWorkerPoolDiagnostics {
		return {
			activeJobCount: this.#jobs.some(({ state }) => state === "running")
				? 1
				: 0,
			completedJobCount: 0,
			peakQueuedJobCount: 1,
			queuedJobCount: this.#jobs.filter(({ state }) => state === "queued")
				.length,
			totalExecutionDurationMs: 0,
			totalQueueDelayMs: 0,
			transferredBytes: 0,
			workerCount: 1,
		};
	}

	async destroy(): Promise<void> {}
}

class FixtureTexturePreparer implements TexturePreparer {
	async prepare(fact: TextureFact): Promise<PreparedTextureSource> {
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
		const source = {
			height: 2,
			key: fact.key,
			layers: fact.sourceAssetIds.map((sourceAssetId) => ({
				pixels: new Uint8Array(16),
				sourceAssetId,
			})),
			purpose: fact.purpose,
			width: 2,
		};
		if (fact.purpose === TexturePurpose.TerrainColor) {
			return {
				...source,
				palette: { colors: new Float32Array(TERRAIN_TYPE_COUNT * 3) },
				purpose: fact.purpose,
			};
		}
		return { ...source, purpose: fact.purpose };
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

class DeferredTerrainTexturePreparer implements TexturePreparer {
	readonly #pending: {
		fact: TextureFact;
		resolve: (source: PreparedTextureSource) => void;
	}[] = [];

	prepare(fact: TextureFact): Promise<PreparedTextureSource> {
		return new Promise((resolve) => this.#pending.push({ fact, resolve }));
	}

	resolveConventionalTextures(): void {
		this.#resolveMatching(
			({ purpose }) => purpose !== TexturePurpose.TerrainColor,
		);
	}

	resolveTerrainColor(): void {
		this.#resolveMatching(
			({ purpose }) => purpose === TexturePurpose.TerrainColor,
		);
	}

	#resolveMatching(predicate: (fact: TextureFact) => boolean): void {
		for (let index = this.#pending.length - 1; index >= 0; index -= 1) {
			const pending = this.#pending[index];
			if (!pending) throw new Error("Pending terrain texture disappeared.");
			if (!predicate(pending.fact)) continue;
			this.#pending.splice(index, 1);
			pending.resolve(preparedTextureSource(pending.fact));
		}
	}

	async destroy(): Promise<void> {}
}

function preparedTextureSource(fact: TextureFact): PreparedTextureSource {
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
	const source = {
		height: 2,
		key: fact.key,
		layers: fact.sourceAssetIds.map((sourceAssetId) => ({
			pixels: new Uint8Array(16),
			sourceAssetId,
		})),
		width: 2,
	};
	if (fact.purpose === TexturePurpose.TerrainColor) {
		return {
			...source,
			palette: { colors: new Float32Array(TERRAIN_TYPE_COUNT * 3) },
			purpose: fact.purpose,
		};
	}
	return { ...source, purpose: fact.purpose };
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

	updateTexture2DRegions(): void {
		throw new Error("Texture region updates are outside this fixture.");
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
