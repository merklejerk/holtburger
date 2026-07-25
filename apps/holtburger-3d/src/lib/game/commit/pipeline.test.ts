import { describe, expect, it } from "vitest";
import type { LandblockBuildingSource } from "../../assets/landblock-building-source";
import type { LandblockTerrainSource } from "../../assets/landblock-terrain-source";
import type { TexturePixelSource } from "../../assets/texture-pixel-source";
import {
	createAssetTextureKey,
	TexturePixelFormat,
	TexturePurpose,
} from "../textures/types";
import { Mat4, Vec3 } from "../math/types";
import type { ResolvedObjectLayerSource } from "../resolution/landblock-layer";
import type { ResolvedTerrainLayerSource } from "../resolution/landblock-layer";
import {
	LandblockLayerKind,
	type LandblockIdLayer,
} from "../runtime/scene-interest";
import { resolveTerrainTextureFacts } from "../terrain/types";
import { bakeBuildingGeometry } from "./building-geometry-worker";
import { packBuildingTextures } from "./building-texture-worker";
import { BuildingWorkers } from "./building-workers";
import type {
	ClosedWorkerPort,
	ClosedWorkerRequest,
	ClosedWorkerResponse,
} from "../workers/closed-worker";
import { StandardCommitPipeline } from "./pipeline";

describe("StandardCommitPipeline", () => {
	it("commits terrain facts without preparing pixels or generated geometry", async () => {
		const source = createTerrainSource("0x0001ffff");
		const assets = new FakeTerrainSource(
			new Map([[source.landblockId, source]]),
		);
	const pipeline = await StandardCommitPipeline.build({ terrainSource: assets });

		const [bundle] = await pipeline.prepareLandblockLayers(
			new Set([terrainLayer(source.landblockId)]),
		);

		expect(bundle).toMatchObject({
			commit: {
				generation: source.generation,
				presentation: source.presentation,
			},
			kind: 0,
			landblockId: source.landblockId,
			layer: LandblockLayerKind.Terrain,
		});
		await pipeline.destroy();
	});

	it("overlaps closed geometry and pixel preparation, then publishes one complete building artifact", async () => {
		const source = createBuildingSource("0xda55ffff");
		const geometryGate = deferred<void>();
		const pixelsGate = deferred<void>();
		let geometryStarted = false;
		let pixelsStarted = false;
		const workers = new BuildingWorkers({
			createGeometryWorker: () =>
				createWorker(async (job) => {
					geometryStarted = true;
					await geometryGate.promise;
					return bakeBuildingGeometry(job);
				}),
			createTextureWorker: () => createWorker(packBuildingTextures),
		});
		const pixels: TexturePixelSource = {
			async loadTexturePixels(request) {
				pixelsStarted = true;
				await pixelsGate.promise;
				return {
					kind: request.kind,
					purpose: request.purpose,
					surface: {
						format: TexturePixelFormat.RGBA8,
						height: 1,
						pixels: Uint8Array.from([0xff, 0x88, 0x44, 0xff]),
						sourceAssetId: request.sourceAssetId,
						width: 1,
					},
				};
			},
		};
		const pipeline = await StandardCommitPipeline.build({
			buildingSource: new FakeBuildingSource(source),
			buildingWorkers: workers,
			terrainSource: new FakeTerrainSource(new Map()),
			texturePixelSource: pixels,
		});
		const pending = pipeline.prepareLandblockLayers(
			new Set([{ id: source.landblockId, layer: LandblockLayerKind.Buildings }]),
		);

		await Promise.resolve();
		await Promise.resolve();
		expect(geometryStarted).toBe(true);
		expect(pixelsStarted).toBe(true);
		geometryGate.resolve();
		pixelsGate.resolve();

		const [bundle] = await pending;
		expect(bundle).toMatchObject({
			dynamicEntities: [],
			landblockId: source.landblockId,
			layer: LandblockLayerKind.Buildings,
		});
		const artifact = bundle?.commit.staticObjects;
		expect(artifact?.objects).toHaveLength(1);
		expect(artifact?.geometry).toHaveLength(1);
		expect(artifact?.texturePages).toHaveLength(1);
		expect(artifact?.textureRequirements).toEqual([
			{
				kind: "asset",
				key: createAssetTextureKey(
					TexturePurpose.ObjectDirectColor,
					"0x05000001",
				),
				purpose: TexturePurpose.ObjectDirectColor,
				sourceAssetId: "0x05000001",
			},
		]);
		await pipeline.destroy();
	});

	it("excludes promoted residents from static geometry and texture preparation", async () => {
		const source = {
			...createBuildingSource("0xda55ffff"),
			dynamicResidents: [buildingResident("promoted")],
			staticResidents: [],
		};
		let pixelRequests = 0;
		const workers = new BuildingWorkers({
			createGeometryWorker: () => createWorker(bakeBuildingGeometry),
			createTextureWorker: () => createWorker(packBuildingTextures),
		});
		const pipeline = await StandardCommitPipeline.build({
			buildingSource: new FakeBuildingSource(source),
			buildingWorkers: workers,
			terrainSource: new FakeTerrainSource(new Map()),
			texturePixelSource: {
				async loadTexturePixels() {
					pixelRequests += 1;
					throw new Error("Promoted residents must not request pixels.");
				},
			},
		});

		const [bundle] = await pipeline.prepareLandblockLayers(
			new Set([{ id: source.landblockId, layer: LandblockLayerKind.Buildings }]),
		);
		expect(bundle?.commit.staticObjects).toBeNull();
		expect(bundle?.dynamicEntities).toEqual(source.dynamicResidents);
		expect(pixelRequests).toBe(0);
		await pipeline.destroy();
	});

	it("refuses to publish a baked range without every physical texture placement", async () => {
		const source = createBuildingSource("0xda55ffff");
		const workers = new BuildingWorkers({
			createGeometryWorker: () => createWorker(bakeBuildingGeometry),
			createTextureWorker: () =>
				createWorker(() => ({ pages: [], packedBytes: 0, workerDurationMs: 0 })),
		});
		const pipeline = await StandardCommitPipeline.build({
			buildingSource: new FakeBuildingSource(source),
			buildingWorkers: workers,
			terrainSource: new FakeTerrainSource(new Map()),
			texturePixelSource: immediatePixels(),
		});

		await expect(
			pipeline.prepareLandblockLayers(
				new Set([{ id: source.landblockId, layer: LandblockLayerKind.Buildings }]),
			),
		).rejects.toThrow("lacks a physical texture placement");
		await pipeline.destroy();
	});
});

function terrainLayer(id: string): LandblockIdLayer {
	return { id, layer: LandblockLayerKind.Terrain };
}

function createTerrainSource(landblockId: string): ResolvedTerrainLayerSource {
	const composition = {
		cornerTerrainAlphaMaps: [
			{ blendMaskTextureId: "0x05000002", terrainCode: 1 },
		],
		landscapeDetail: { textureId: "0x05000004", tiling: 1 },
		activeRegionKey: "test-region",
		roadAlphaMaps: [
			{
				roadMaskTextureId: "0x05000003",
				roadCode: 1,
			},
		],
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
		kind: LandblockLayerKind.Terrain,
		landblockId,
		presentation: {
			composition,
			textures: resolveTerrainTextureFacts(composition),
		},
	};
}

const TERRAIN_VARIATION = {
	maxVertexBrightness: 0,
	maxVertexHue: 0,
	maxVertexSaturation: 0,
	minVertexBrightness: 0,
	minVertexHue: 0,
	minVertexSaturation: 0,
} as const;

class FakeTerrainSource implements LandblockTerrainSource {
	constructor(
		readonly sources: ReadonlyMap<string, ResolvedTerrainLayerSource>,
	) {}

	async loadTerrainSource(landblockId: string) {
		const source = this.sources.get(landblockId);
		if (source === undefined) throw new Error(`Missing source ${landblockId}.`);
		return source;
	}
}

class FakeBuildingSource implements LandblockBuildingSource {
	constructor(readonly source: ResolvedObjectLayerSource) {}

	async loadBuildingSource(landblockId: string): Promise<ResolvedObjectLayerSource> {
		if (landblockId !== this.source.landblockId) {
			throw new Error(`Missing building source ${landblockId}.`);
		}
		return this.source;
	}
}

function createBuildingSource(landblockId: string): ResolvedObjectLayerSource {
	return {
		dynamicResidents: [],
		kind: LandblockLayerKind.Buildings,
		landblockId,
		staticResidents: [buildingResident("static", landblockId)],
	};
}

function buildingResident(id: string, landblockId = "0xda55ffff") {
	return {
		appearance: null,
		id: `resident:${id}`,
		localBounds: null,
		placement: { envCellId: null, landblockId, localTransform: Mat4.identity() },
		presentation: {
			effects: {
				animationId: null,
				physicsScriptId: null,
				physicsScriptTableId: null,
				soundTableId: null,
			},
			id: `presentation:${id}` as const,
			motion: null,
			parts: [
				{
					defaultScale: new Vec3(1, 1, 1),
					geometry: {
						bounds: null,
						id: `geometry:${id}` as const,
						indices: Uint32Array.from([0, 1, 2]),
						materialSideKinds: Uint8Array.from([0]),
						materialSideTypes: Uint8Array.from([0]),
						materialSlotIndices: Uint16Array.from([0]),
						materialStippling: Uint8Array.from([0]),
						materialWrapModes: Uint8Array.from([0]),
						normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]),
						positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
						textureCoordinates: Float32Array.from([0, 0, 1, 0, 0, 1]),
					},
					materials: [
						{
							colorTextureId: "0x05000001",
							diffuseScale: 1,
							id: "material:test" as const,
							kind: "texture" as const,
							luminosity: 0,
							paletteTextureId: null,
							rawSurfaceFlags: 0,
							renderSurfaceId: "0x06000001",
							textureEncoding: "direct-color" as const,
							translucency: 0,
						},
					],
					parentPartIndex: null,
					partIndex: 0,
				},
			],
			placementPoses: new Map([[0, { partTransforms: [Mat4.identity()], placementId: 0 }]]),
			selectionBounds: null,
			sortingBounds: null,
			sourceAssetId: "0x01000001",
		},
		scale: new Vec3(1, 1, 1),
	};
}

function createWorker<TInput, TResult>(
	execute: (input: TInput) => TResult | Promise<TResult>,
): ClosedWorkerPort {
	const worker: ClosedWorkerPort = {
		onerror: null,
		onmessage: null,
		postMessage(message: ClosedWorkerRequest<unknown>): void {
			void Promise.resolve(execute(message.input as TInput)).then(
				(result) => worker.onmessage?.({
					data: { id: message.id, ok: true, result } satisfies ClosedWorkerResponse<unknown>,
				} as MessageEvent<ClosedWorkerResponse<unknown>>),
				(error: unknown) => worker.onmessage?.({
					data: {
						error: error instanceof Error ? error.message : String(error),
						id: message.id,
						ok: false,
					} satisfies ClosedWorkerResponse<unknown>,
				} as MessageEvent<ClosedWorkerResponse<unknown>>),
			);
		},
		terminate(): void {},
	};
	return worker;
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	return {
		promise: new Promise<T>((accept) => {
			resolve = accept;
		}),
		resolve,
	};
}

function immediatePixels(): TexturePixelSource {
	return {
		async loadTexturePixels(request) {
			return {
				kind: request.kind,
				purpose: request.purpose,
				surface: {
					format: TexturePixelFormat.RGBA8,
					height: 1,
					pixels: Uint8Array.from([0xff, 0x88, 0x44, 0xff]),
					sourceAssetId: request.sourceAssetId,
					width: 1,
				},
			};
		},
	};
}
