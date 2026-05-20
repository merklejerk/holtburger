import { describe, expect, it } from "vitest";

import {
	createInitialAssetChannelState,
	type PreparedAssetRecord,
	type PreparedLandblockPackPayload,
	type PreparedLandblockStaticMesh,
} from "../assets/types";
import type {
	PlacementTransformDto,
	RuntimeBatchDto,
	Vec3Dto,
} from "../host/contracts";
import {
	deriveStaticRenderableSceneModel,
	formatStaticRenderableRenderGroupKey,
} from "./static-renderables";
import { WORLD_RENDER_DOMAIN } from "./render-domains";

const IDENTITY_PLACEMENT: PlacementTransformDto = {
	origin: { x: 0, y: 0, z: 0 },
	orientation: { w: 1, x: 0, y: 0, z: 0 },
};

const UNIT_SCALE: Vec3Dto = { x: 1, y: 1, z: 1 };

describe("static renderable scene model", () => {
	it("uses pack-prepared static mesh parts without legacy setup-model walking", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"gfx-obj/01000001": createPreparedGfxObjAsset(
				"gfx-obj/01000001",
				0x01000001,
			),
			"landblock-pack/0102ffff": createPreparedLandblockPackAsset(0x0102ffff),
		};

		const model = deriveStaticRenderableSceneModel(
			createRuntimeBatch(),
			assetState,
		);

		expect(model.sourceInstances).toHaveLength(1);
		expect(model.parts).toHaveLength(1);
		expect(model.parts[0]).toMatchObject({
			instanceId: "pack-static-0",
			sourceAssetId: "setup-model/02000001",
			gfxObjAssetId: "gfx-obj/01000001",
			partIndex: 2,
			partPlacements: [createPlacement({ x: 3, y: 4, z: 5 })],
			scale: { x: 2, y: 1, z: 1 },
		});
		expect(model.missingSourceAssetIds).toEqual([]);
		expect(model.missingGfxAssetIds).toEqual([]);
	});

	it("groups duplicate parts by chunk and gfx asset id for instancing", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"gfx-obj/01000001": createPreparedGfxObjAsset(
				"gfx-obj/01000001",
				0x01000001,
			),
			"landblock-pack/0102ffff": createPreparedLandblockPackAsset(0x0102ffff, [
				createPreparedLandblockStaticMesh({
					kind: "scenery",
					instanceId: "pack-static-1",
					sourceAssetId: "gfx-obj/01000001",
					gfxObjAssetId: "gfx-obj/01000001",
				}),
			]),
		};
		const runtimeBatch = createRuntimeBatch();

		const model = deriveStaticRenderableSceneModel(runtimeBatch, assetState);

		expect(model.parts).toHaveLength(2);
		expect(model.partsByRenderDomainChunkAndGfxAssetId.size).toBe(1);
		expect(
			model.partsByRenderDomainChunkAndGfxAssetId.get(
				formatStaticRenderableRenderGroupKey(
					WORLD_RENDER_DOMAIN.exteriorStatic,
					"landblock/0102ffff",
					"gfx-obj/01000001",
				),
			),
		).toHaveLength(2);
	});

	it("includes pack-backed outdoor-linked indoor static objects in outdoor scenes", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"gfx-obj/01000001": createPreparedGfxObjAsset(
				"gfx-obj/01000001",
				0x01000001,
			),
			"landblock-pack/0102ffff": createPreparedLandblockPackAsset(0x0102ffff, [
				createPreparedLandblockStaticMesh({
					kind: "indoor-static",
					instanceId: "pack-indoor-static-0",
					owningEnvCellId: 0x01020155,
					sourceAssetId: "gfx-obj/01000001",
					gfxObjAssetId: "gfx-obj/01000001",
				}),
			]),
		};

		const model = deriveStaticRenderableSceneModel(
			createRuntimeBatch(),
			assetState,
			null,
			1,
			{ envCellIds: [0x01020155], truncated: false },
		);

		expect(model.parts).toContainEqual(
			expect.objectContaining({
				kind: "indoor-static",
				owningEnvCellId: 0x01020155,
				renderChunk: {
					chunkKey: "landblock/0102ffff",
					chunkLandblockId: 0x0102ffff,
				},
				gfxObjAssetId: "gfx-obj/01000001",
			}),
		);
	});

	it("keeps static frames chunk-local across active landblocks", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"gfx-obj/01000001": createPreparedGfxObjAsset(
				"gfx-obj/01000001",
				0x01000001,
			),
			"landblock-pack/0102ffff": createPreparedLandblockPackAsset(
				0x0102ffff,
				[
					createPreparedLandblockStaticMesh({
						kind: "scenery",
						instanceId: "pack-static-0102",
						sourceAssetId: "gfx-obj/01000001",
						gfxObjAssetId: "gfx-obj/01000001",
						localPlacement: createPlacement({ x: 24, y: 48, z: 6 }),
					}),
				],
				false,
			),
			"landblock-pack/0203ffff": createPreparedLandblockPackAsset(
				0x0203ffff,
				[
					createPreparedLandblockStaticMesh({
						kind: "scenery",
						instanceId: "pack-static-0203",
						owningLandblockId: 0x0203ffff,
						sourceAssetId: "gfx-obj/01000001",
						gfxObjAssetId: "gfx-obj/01000001",
						localPlacement: createPlacement({ x: 24, y: 48, z: 6 }),
					}),
				],
				false,
			),
		};

		const model = deriveStaticRenderableSceneModel(
			createRuntimeBatch(),
			assetState,
			null,
			1,
		);

		expect(
			model.parts.map((part) => ({
				landblockId: part.owningLandblockId,
				chunkKey: part.renderChunk.chunkKey,
				placement: part.chunkLocalInstancePlacement,
			})),
		).toEqual([
			{
				landblockId: 0x0102ffff,
				chunkKey: "landblock/0102ffff",
				placement: createPlacement({ x: 24, y: 48, z: 6 }),
			},
			{
				landblockId: 0x0203ffff,
				chunkKey: "landblock/0203ffff",
				placement: createPlacement({ x: 24, y: 48, z: 6 }),
			},
		]);
		expect(model.partsByRenderDomainChunkAndGfxAssetId.size).toBe(2);
		expect(
			model.partsByRenderDomainChunkAndGfxAssetId.get(
				formatStaticRenderableRenderGroupKey(
					WORLD_RENDER_DOMAIN.exteriorStatic,
					"landblock/0102ffff",
					"gfx-obj/01000001",
				),
			),
		).toHaveLength(1);
		expect(
			model.partsByRenderDomainChunkAndGfxAssetId.get(
				formatStaticRenderableRenderGroupKey(
					WORLD_RENDER_DOMAIN.exteriorStatic,
					"landblock/0203ffff",
					"gfx-obj/01000001",
				),
			),
		).toHaveLength(1);
	});

	it("tracks missing prepared gfx assets and filters pack meshes outside active landblock coverage", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"gfx-obj/01000001": createPreparedGfxObjAsset(
				"gfx-obj/01000001",
				0x01000001,
			),
			"landblock-pack/0102ffff": createPreparedLandblockPackAsset(0x0102ffff, [
				createPreparedLandblockStaticMesh({
					kind: "scenery",
					instanceId: "pack-static-missing-gfx",
					sourceAssetId: "setup-model/02000002",
					gfxObjAssetId: "gfx-obj/01000002",
				}),
			]),
			"landblock-pack/0909ffff": createPreparedLandblockPackAsset(0x0909ffff, [
				createPreparedLandblockStaticMesh({
					kind: "scenery",
					instanceId: "pack-static-outside-active-landblock",
					owningLandblockId: 0x0909ffff,
					sourceAssetId: "gfx-obj/01000001",
					gfxObjAssetId: "gfx-obj/01000001",
				}),
			]),
		};
		const runtimeBatch = createRuntimeBatch();

		const model = deriveStaticRenderableSceneModel(runtimeBatch, assetState);

		expect(model.parts.map((part) => part.gfxObjAssetId)).toEqual([
			"gfx-obj/01000001",
		]);
		expect(model.missingGfxAssetIds).toEqual(["gfx-obj/01000002"]);
	});

	it("keeps pack-backed indoor and exterior statics in separate render-domain groups", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"gfx-obj/01000001": createPreparedGfxObjAsset(
				"gfx-obj/01000001",
				0x01000001,
			),
			"landblock-pack/0102ffff": createPreparedLandblockPackAsset(0x0102ffff, [
				createPreparedLandblockStaticMesh({
					kind: "indoor-static",
					instanceId: "pack-indoor-static-0",
					owningEnvCellId: 0x01020155,
					sourceAssetId: "gfx-obj/01000001",
					gfxObjAssetId: "gfx-obj/01000001",
				}),
			]),
		};

		const model = deriveStaticRenderableSceneModel(
			createRuntimeBatch(),
			assetState,
			null,
			1,
			{ envCellIds: [0x01020155], truncated: false },
		);

		expect(
			model.parts.map((part) => ({
				renderDomain: part.renderDomain,
				renderKey: part.renderKey,
			})),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					renderDomain: WORLD_RENDER_DOMAIN.exteriorStatic,
					renderKey: expect.stringMatching(/^exterior-static\//),
				}),
				expect.objectContaining({
					renderDomain: WORLD_RENDER_DOMAIN.interiorStatic,
					renderKey: expect.stringMatching(/^interior-static\//),
				}),
			]),
		);
		expect(model.partsByRenderDomainChunkAndGfxAssetId.size).toBe(2);
		expect(
			model.partsByRenderDomainChunkAndGfxAssetId.get(
				formatStaticRenderableRenderGroupKey(
					WORLD_RENDER_DOMAIN.exteriorStatic,
					"landblock/0102ffff",
					"gfx-obj/01000001",
				),
			),
		).toHaveLength(1);
		expect(
			model.partsByRenderDomainChunkAndGfxAssetId.get(
				formatStaticRenderableRenderGroupKey(
					WORLD_RENDER_DOMAIN.interiorStatic,
					"landblock/0102ffff",
					"gfx-obj/01000001",
				),
			),
		).toHaveLength(1);
	});
});

function createRuntimeBatch(): RuntimeBatchDto {
	return {
		tick: 11,
		entities: [],
		residency: {
			focusEntityId: 0x01020304,
			focusLandblockId: 0x0102ffff,
			focusCellId: 3,
			focusEnvCellId: null,
			visibleCellIds: [],
			seenOutside: null,
			environmentId: null,
			cellStructureId: null,
			focusLocationLabel: "100.40S, 101.55W, 1.0Z",
			indoors: false,
			trackedBodyCount: 1,
		},
	};
}

function createPreparedLandblockPackAsset(
	landblockId: number,
	extraStaticMeshes: PreparedLandblockStaticMesh[] = [],
	includeDefaultStatic = true,
): PreparedAssetRecord {
	const defaultStaticInstance = {
		instanceId: "pack-static-0",
		kind: "scenery" as const,
		owningLandblockId: landblockId,
		owningEnvCellId: null,
		sourceDid: 0x02000001,
		sourceAssetId: "setup-model/02000001",
		sourceIndex: 0,
		localPlacement: createPlacement({ x: 33, y: 44, z: 5 }),
		sourceScale: UNIT_SCALE,
	};
	const defaultStaticMesh: PreparedLandblockStaticMesh = {
		...defaultStaticInstance,
		partIndex: 2,
		gfxObjId: 0x01000001,
		gfxObjAssetId: "gfx-obj/01000001",
		partPlacements: [createPlacement({ x: 3, y: 4, z: 5 })],
		partScale: { x: 2, y: 1, z: 1 },
		sourceBounds: null,
		instanceBounds: null,
	};
	const payload: PreparedLandblockPackPayload = {
		kind: "landblock-pack",
		sourceAssetKind: "landblock-pack",
		residencyKind: "landblock",
		landblockId,
		landblockInfoId: landblockId & 0xfffffffe,
		classification: "outdoor",
		sourceFacts: {
			cellLandblock: null,
			landblockInfo: null,
			outdoor: {
				explicitObjects: [],
				buildings: [],
				generatedScenery: [],
			},
			interiors: {
				envCells: [],
				environments: [],
			},
		},
		prepared: {
			terrainMesh: null,
			outdoorStaticInstances: [
				...(includeDefaultStatic ? [defaultStaticInstance] : []),
				...extraStaticMeshes.map((mesh) => ({
					instanceId: mesh.instanceId,
					kind: mesh.kind,
					owningLandblockId: mesh.owningLandblockId,
					owningEnvCellId: mesh.owningEnvCellId,
					sourceDid: mesh.sourceDid,
					sourceAssetId: mesh.sourceAssetId,
					sourceIndex: mesh.sourceIndex,
					localPlacement: mesh.localPlacement,
					sourceScale: mesh.sourceScale,
				})),
			],
			interiorCells: [],
			staticMeshes: [
				...(includeDefaultStatic ? [defaultStaticMesh] : []),
				...extraStaticMeshes,
			],
			spatialItems: [],
			staticLandblockBvh: null,
		},
		dependencies: {
			cellDatIds: [],
			portalDatIds: [],
			renderableAssetIds: ["setup-model/02000001"],
		},
		diagnostics: {
			sourceRecords: [],
			errors: [],
		},
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "landblock-pack",
			errorCode: null,
			detail: "test",
		},
	};
	return createPreparedAsset(
		`landblock-pack/${landblockId.toString(16).padStart(8, "0")}`,
		payload,
	);
}

function createPreparedLandblockStaticMesh(options: {
	kind: "indoor-static" | "scenery" | "building" | "generated-scenery";
	instanceId: string;
	sourceAssetId: string;
	gfxObjAssetId: string;
	owningLandblockId?: number;
	owningEnvCellId?: number | null;
	localPlacement?: PlacementTransformDto;
}): PreparedLandblockStaticMesh {
	return {
		instanceId: options.instanceId,
		kind: options.kind,
		owningLandblockId: options.owningLandblockId ?? 0x0102ffff,
		owningEnvCellId: options.owningEnvCellId ?? null,
		sourceDid: Number.parseInt(options.sourceAssetId.slice(-8), 16),
		sourceAssetId: options.sourceAssetId,
		sourceIndex: 0,
		localPlacement: options.localPlacement ?? IDENTITY_PLACEMENT,
		sourceScale: UNIT_SCALE,
		partIndex: 0,
		gfxObjId: Number.parseInt(options.gfxObjAssetId.slice(-8), 16),
		gfxObjAssetId: options.gfxObjAssetId,
		partPlacements: [],
		partScale: UNIT_SCALE,
		sourceBounds: null,
		instanceBounds: null,
	};
}

function createPreparedGfxObjAsset(
	assetId: string,
	gfxObjId: number,
): PreparedAssetRecord {
	return createPreparedAsset(assetId, {
		kind: "gfx-obj",
		sourceAssetKind: "gfx-obj",
		residencyKind: "unknown",
		gfxObjId,
		flags: null,
		surfaceIds: [],
		vertexArray: {
			vertexType: null,
			vertexCount: 3,
			vertices: [],
		},
		drawingPolygons: [],
		drawingBsp: null,
		physicsWitness: {
			polygonCount: 0,
			hasBsp: false,
		},
		renderGeometry: {
			sourceId: gfxObjId,
			vertexCount: 3,
			triangleCount: 1,
			positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
			normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
			uvs: [0, 0, 1, 0, 0, 1],
			triangles: [{ polygonId: 1, surfaceId: null, firstVertex: 0 }],
			surfaceIds: [],
			bounds: {
				min: { x: 0, y: 0, z: 0 },
				max: { x: 1, y: 1, z: 0 },
			},
		},
		sortCenter: null,
		didDegrade: null,
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "gfx-obj",
			errorCode: null,
			detail: "test",
		},
	});
}

function createPreparedAsset(
	assetId: string,
	payload: PreparedAssetRecord["payload"],
): PreparedAssetRecord {
	return {
		request: {
			requestId: `test-${assetId}`,
			assetId,
			priority: "streaming",
		},
		response: {
			requestId: `test-${assetId}`,
			assetId,
			payloadKind: "json",
			payload: {},
		},
		payload,
		preparedAt: "2026-05-12T00:00:00.000Z",
	};
}

function createPlacement(origin: Vec3Dto): PlacementTransformDto {
	return {
		origin,
		orientation: IDENTITY_PLACEMENT.orientation,
	};
}
