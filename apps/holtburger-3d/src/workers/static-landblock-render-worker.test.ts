import { describe, expect, it } from "vitest";

import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
} from "../lib/host/contracts";
import { formatPreparedTextureAssetId } from "../lib/assets/types";
import {
	formatEnvCellAssetId,
	formatLandblockOutdoorAssetId,
	formatLandblockTopologyAssetId,
	formatRegionRenderProfileAssetId,
	formatTerrainMaterialAssetId,
} from "../lib/landblocks";
import {
	getDetailedLandblockRenderArtifacts,
	getLandblockTerrainRenderArtifact,
	getStaticObjectBundleArtifacts,
	type LandblockRenderProductWorkerJob,
} from "../lib/world-display/landblock-render-product";
import {
	collectStaticLandblockRenderWorkerResultTransferables,
	runStaticLandblockRenderWorkerJob,
} from "./static-landblock-render-worker";

describe("static landblock render worker", () => {
	it("builds an outdoor-terrain product without exterior static bundles", async () => {
		const landblockId = 0xda55ffff;
		const lookup = new Map<string, AssetLookupResponseDto>(
			[
				createResponse(
					formatLandblockOutdoorAssetId(landblockId),
					createOutdoorPayload(landblockId),
				),
				createResponse(
					formatTerrainMaterialAssetId(1),
					createTerrainMaterial(),
				),
				createResponse(
					formatRegionRenderProfileAssetId(1),
					createRegionRenderProfile(),
				),
			].map((response) => [response.assetId, response] as const),
		);
		const requestedAssetIds: string[] = [];

		const result = await runStaticLandblockRenderWorkerJob(
			createJob("outdoor-terrain"),
			{
				async lookupBinaryAssets(requests: readonly AssetLookupRequestDto[]) {
					requestedAssetIds.push(...requests.map((request) => request.assetId));
					return {
						responses: requests.map((request) => {
							const response = lookup.get(request.assetId);
							if (!response) {
								throw new Error(`Missing test response ${request.assetId}.`);
							}
							return response;
						}),
					};
				},
			},
		);

		expect(requestedAssetIds).toContain(
			formatLandblockOutdoorAssetId(landblockId),
		);
		expect(requestedAssetIds).not.toContain(
			formatLandblockTopologyAssetId(landblockId),
		);
		expect(result.product).toBe("outdoor-terrain");
		expect(getLandblockTerrainRenderArtifact(result)?.landblockId).toBe(
			landblockId,
		);
		expect(getStaticObjectBundleArtifacts(result)).toEqual([]);
	});

	it("builds an outdoor-buildings product without terrain or detail artifacts", async () => {
		const landblockId = 0xda55ffff;
		const buildingSourceAssetId = "gfx-obj/01000010";
		const detailSourceAssetId = "gfx-obj/01000020";
		const lookup = new Map<string, AssetLookupResponseDto>(
			[
				createResponse(
					formatLandblockOutdoorAssetId(landblockId),
					createOutdoorPayload(landblockId, [
						createOutdoorStaticMember({
							kind: "building",
							sourceAssetId: buildingSourceAssetId,
							sourceDid: 0x01000010,
						}),
						createOutdoorStaticMember({
							kind: "generated-scenery",
							sourceAssetId: detailSourceAssetId,
							sourceDid: 0x01000020,
						}),
					]),
				),
				createResponse(
					formatRegionRenderProfileAssetId(1),
					createRegionRenderProfile(),
				),
				createResponse(buildingSourceAssetId, createGfxObjPayload(0x01000010)),
			].map((response) => [response.assetId, response] as const),
		);
		const requestedAssetIds: string[] = [];

		const result = await runStaticLandblockRenderWorkerJob(
			createJob("outdoor-buildings"),
			{
				async lookupBinaryAssets(requests: readonly AssetLookupRequestDto[]) {
					requestedAssetIds.push(...requests.map((request) => request.assetId));
					return {
						responses: requests.map((request) => {
							const response = lookup.get(request.assetId);
							if (!response) {
								throw new Error(`Missing test response ${request.assetId}.`);
							}
							return response;
						}),
					};
				},
			},
		);

		expect(result.product).toBe("outdoor-buildings");
		expect(requestedAssetIds).toContain(buildingSourceAssetId);
		expect(requestedAssetIds).not.toContain(detailSourceAssetId);
		expect(getLandblockTerrainRenderArtifact(result)).toBeNull();
		expect(
			getStaticObjectBundleArtifacts(result).map((layer) => layer.bundleKind),
		).toEqual(["outdoor-buildings"]);
	});

	it("builds an outdoor-detail product without terrain or building artifacts", async () => {
		const landblockId = 0xda55ffff;
		const buildingSourceAssetId = "gfx-obj/01000010";
		const detailSourceAssetId = "gfx-obj/01000020";
		const lookup = new Map<string, AssetLookupResponseDto>(
			[
				createResponse(
					formatLandblockOutdoorAssetId(landblockId),
					createOutdoorPayload(landblockId, [
						createOutdoorStaticMember({
							kind: "building",
							sourceAssetId: buildingSourceAssetId,
							sourceDid: 0x01000010,
						}),
						createOutdoorStaticMember({
							kind: "generated-scenery",
							sourceAssetId: detailSourceAssetId,
							sourceDid: 0x01000020,
						}),
					]),
				),
				createResponse(
					formatRegionRenderProfileAssetId(1),
					createRegionRenderProfile(),
				),
				createResponse(detailSourceAssetId, createGfxObjPayload(0x01000020)),
			].map((response) => [response.assetId, response] as const),
		);
		const requestedAssetIds: string[] = [];

		const result = await runStaticLandblockRenderWorkerJob(
			createJob("outdoor-detail"),
			{
				async lookupBinaryAssets(requests: readonly AssetLookupRequestDto[]) {
					requestedAssetIds.push(...requests.map((request) => request.assetId));
					return {
						responses: requests.map((request) => {
							const response = lookup.get(request.assetId);
							if (!response) {
								throw new Error(`Missing test response ${request.assetId}.`);
							}
							return response;
						}),
					};
				},
			},
		);

		expect(result.product).toBe("outdoor-detail");
		expect(requestedAssetIds).not.toContain(buildingSourceAssetId);
		expect(requestedAssetIds).toContain(detailSourceAssetId);
		expect(getLandblockTerrainRenderArtifact(result)).toBeNull();
		expect(
			getStaticObjectBundleArtifacts(result).map((layer) => layer.bundleKind),
		).toEqual(["outdoor-detail"]);
	});

	it("builds an outdoor-env-cells product without loading outdoor roots", async () => {
		const landblockId = 0xda55ffff;
		const lookup = new Map<string, AssetLookupResponseDto>(
			[
				createResponse(
					formatLandblockTopologyAssetId(landblockId),
					createTopologyPayload(landblockId),
				),
				createResponse(
					formatEnvCellAssetId(0xda550100),
					createEnvCellPayload(0xda550100),
				),
				createResponse(
					formatRegionRenderProfileAssetId(1),
					createRegionRenderProfile(),
				),
			].map((response) => [response.assetId, response] as const),
		);
		const requestedAssetIds: string[] = [];

		const result = await runStaticLandblockRenderWorkerJob(createJob(), {
			async lookupBinaryAssets(requests: readonly AssetLookupRequestDto[]) {
				requestedAssetIds.push(...requests.map((request) => request.assetId));
				return {
					responses: requests.map((request) => {
						const response = lookup.get(request.assetId);
						if (!response) {
							throw new Error(`Missing test response ${request.assetId}.`);
						}
						return response;
					}),
				};
			},
		});

		expect(requestedAssetIds).not.toContain(
			formatLandblockOutdoorAssetId(landblockId),
		);
		expect(requestedAssetIds).toContain(
			formatLandblockTopologyAssetId(landblockId),
		);
		expect(result).toMatchObject({
			type: "landblock-render-product-built",
			landblockId,
			product: "outdoor-env-cells",
			requestId: "request:worker",
			buildPolicyRevision: "build:v1",
			texturePagePolicyRevision: "texture-pages:v1",
		});
		const detailedArtifacts = getDetailedLandblockRenderArtifacts(result);
		expect(getLandblockTerrainRenderArtifact(result)).toBeNull();
		expect(
			getStaticObjectBundleArtifacts(result).map((layer) => layer.bundleKind),
		).toEqual([]);
		expect(detailedArtifacts?.selectedEnvCellIds).toEqual([0xda550100]);
		expect(detailedArtifacts?.structuredInteriorCells).toHaveLength(1);
		expect(detailedArtifacts?.portalApertures).toHaveLength(1);
		expect(detailedArtifacts?.visibility.cellVisibilityRecords).toEqual([
			{
				envCellId: 0xda550100,
				visibilityKeys: [
					"residency-cell:cell:da550100",
					"env-render-geometry:cell:da550100",
				],
				visibleEnvCellIds: [0xda550101],
			},
		]);
		expect(detailedArtifacts?.spatial.envCellResidencyBvh.coordinateSpace).toBe(
			"landblock-topology-residency",
		);
		expect(
			getStaticObjectBundleArtifacts(result).every(
				(layer) => layer.rootAssetIds.length > 0,
			),
		).toBe(true);
		expect(detailedArtifacts).not.toBeNull();
		expect(
			collectStaticLandblockRenderWorkerResultTransferables(result),
		).toContain(
			detailedArtifacts!.structuredInteriorCells[0]?.renderGeometry.positions
				.buffer,
		);
	});

	it("emits structured-interior material records and owned texture pages", async () => {
		const landblockId = 0xda55ffff;
		const materialAssetId = "material/08000001";
		const renderSurfaceAssetId = "render-surface/06000001";
		const rawPreparedTextureAssetId = formatPreparedTextureAssetId({
			renderSurfaceId: 0x06000001,
			usage: "raw",
			outputFormat: "rgba8",
			mipPolicy: "none",
			colorSpace: "linear",
		});
		const detailPreparedTextureAssetId = formatPreparedTextureAssetId({
			renderSurfaceId: 0x06000001,
			usage: "detail",
			outputFormat: "rgba8",
			mipPolicy: "none",
			colorSpace: "linear",
		});
		const detailRefKey = `texture:region-detail:1:environment:${detailPreparedTextureAssetId}`;
		const lookup = new Map<string, AssetLookupResponseDto>(
			[
				createResponse(
					formatLandblockTopologyAssetId(landblockId),
					createTopologyPayload(landblockId),
				),
				createResponse(
					formatEnvCellAssetId(0xda550100),
					createEnvCellPayload(0xda550100, {
						materialAssetId,
						surfaceId: 0x08000001,
					}),
				),
				createResponse(materialAssetId, createMaterialPayload()),
				createResponse(renderSurfaceAssetId, createRenderSurfacePayload()),
				createResponse(
					rawPreparedTextureAssetId,
					createPreparedTexturePayload({
						assetId: rawPreparedTextureAssetId,
						usage: "raw",
					}),
				),
				createResponse(
					detailPreparedTextureAssetId,
					createPreparedTexturePayload({
						assetId: detailPreparedTextureAssetId,
						usage: "detail",
					}),
				),
				createResponse(
					formatRegionRenderProfileAssetId(1),
					createRegionRenderProfileWithEnvironmentDetail(),
				),
				createResponse(
					"surface-texture/05000013",
					createSurfaceTexturePayload(),
				),
			].map((response) => [response.assetId, response] as const),
		);

		const result = await runStaticLandblockRenderWorkerJob(createJob(), {
			async lookupBinaryAssets(requests: readonly AssetLookupRequestDto[]) {
				return {
					responses: requests.map((request) => {
						const response = lookup.get(request.assetId);
						if (!response) {
							throw new Error(`Missing test response ${request.assetId}.`);
						}
						return response;
					}),
				};
			},
		});

		const detailedArtifacts = getDetailedLandblockRenderArtifacts(result);
		expect(detailedArtifacts).not.toBeNull();
		expect(detailedArtifacts!.structuredInteriorMaterialRecords).toHaveLength(
			1,
		);
		expect(
			detailedArtifacts!.structuredInteriorMaterialRecords[0],
		).toMatchObject({
			key: `material:${materialAssetId}:variant:base:detail=${detailRefKey}`,
			detailOverlay: {
				textureRefKey: detailRefKey,
				roleKind: "environment",
				blendMode: "dst-color",
				fadeMode: "constant",
				tiling: 9,
				fadeNear: 0,
				fadeFar: 1,
			},
			detailTextureRefKey: detailRefKey,
			detailTiling: 9,
			texturePageRefKeys: expect.arrayContaining([
				`texture:material:${materialAssetId}:variant:base:${rawPreparedTextureAssetId}`,
				detailRefKey,
			]),
		});
		expect(
			detailedArtifacts!.structuredInteriorTexturePageRefs.map(
				(ref) => ref.sourceAssetId,
			),
		).toEqual([rawPreparedTextureAssetId, detailPreparedTextureAssetId]);
		expect(detailedArtifacts!.structuredInteriorTexturePages).toHaveLength(2);
		expect(
			detailedArtifacts!.structuredInteriorCells[0]?.materialSlices[0],
		).toMatchObject({
			envCellId: 0xda550100,
			surfaceId: 0x08000001,
			geometrySurfaceId: 0,
			materialRecordKey: `material:${materialAssetId}:variant:base:detail=${detailRefKey}`,
			normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
			triangleCount: 1,
		});
		const materialSlice =
			detailedArtifacts!.structuredInteriorCells[0]?.materialSlices[0];
		const transferables =
			collectStaticLandblockRenderWorkerResultTransferables(result);
		expect(transferables).toContain(
			materialSlice?.positions instanceof Float32Array
				? materialSlice.positions.buffer
				: undefined,
		);
		expect(transferables).toContain(
			materialSlice?.normals instanceof Float32Array
				? materialSlice.normals.buffer
				: undefined,
		);
	});

	it("keeps structured-interior sampler variants as distinct material records", async () => {
		const landblockId = 0xda55ffff;
		const materialAssetId = "material/08000001";
		const renderSurfaceAssetId = "render-surface/06000001";
		const rawPreparedTextureAssetId = formatPreparedTextureAssetId({
			renderSurfaceId: 0x06000001,
			usage: "raw",
			outputFormat: "rgba8",
			mipPolicy: "none",
			colorSpace: "linear",
		});
		const lookup = new Map<string, AssetLookupResponseDto>(
			[
				createResponse(
					formatLandblockTopologyAssetId(landblockId),
					createTopologyPayload(landblockId),
				),
				createResponse(
					formatEnvCellAssetId(0xda550100),
					createEnvCellPayload(0xda550100, {
						materialAssetId,
						surfaceId: 0x08000001,
						materialVariantSignatures: ["sampler=clamp", "sampler=repeat"],
					}),
				),
				createResponse(materialAssetId, createMaterialPayload()),
				createResponse(renderSurfaceAssetId, createRenderSurfacePayload()),
				createResponse(
					rawPreparedTextureAssetId,
					createPreparedTexturePayload({
						assetId: rawPreparedTextureAssetId,
						usage: "raw",
					}),
				),
				createResponse(
					formatRegionRenderProfileAssetId(1),
					createRegionRenderProfile(),
				),
			].map((response) => [response.assetId, response] as const),
		);

		const result = await runStaticLandblockRenderWorkerJob(createJob(), {
			async lookupBinaryAssets(requests: readonly AssetLookupRequestDto[]) {
				return {
					responses: requests.map((request) => {
						const response = lookup.get(request.assetId);
						if (!response) {
							throw new Error(`Missing test response ${request.assetId}.`);
						}
						return response;
					}),
				};
			},
		});

		const detailedArtifacts = getDetailedLandblockRenderArtifacts(result);
		expect(detailedArtifacts).not.toBeNull();
		expect(
			detailedArtifacts!.structuredInteriorMaterialRecords.map(
				(record) => record.key,
			),
		).toEqual([
			`material:${materialAssetId}:variant:sampler=clamp`,
			`material:${materialAssetId}:variant:sampler=repeat`,
		]);
		expect(
			detailedArtifacts!.structuredInteriorTexturePageRefs.map((ref) => ({
				key: ref.key,
				wrapS: ref.wrapS,
				wrapT: ref.wrapT,
			})),
		).toEqual([
			{
				key: `texture:material:${materialAssetId}:variant:sampler=clamp:${rawPreparedTextureAssetId}`,
				wrapS: "clamp",
				wrapT: "clamp",
			},
			{
				key: `texture:material:${materialAssetId}:variant:sampler=repeat:${rawPreparedTextureAssetId}`,
				wrapS: "repeat",
				wrapT: "repeat",
			},
		]);
		expect(
			detailedArtifacts!.structuredInteriorCells[0]?.materialSlices.map(
				(slice) => ({
					materialRecordKey: slice.materialRecordKey,
					materialVariantSignature: slice.materialVariantSignature,
					triangleCount: slice.triangleCount,
				}),
			),
		).toEqual([
			{
				materialRecordKey: `material:${materialAssetId}:variant:sampler=clamp`,
				materialVariantSignature: "sampler=clamp",
				triangleCount: 1,
			},
			{
				materialRecordKey: `material:${materialAssetId}:variant:sampler=repeat`,
				materialVariantSignature: "sampler=repeat",
				triangleCount: 1,
			},
		]);
	});

	it("builds a dungeon-env-cells product through the topology/env-cell path", async () => {
		const landblockId = 0xda55ffff;
		const lookup = new Map<string, AssetLookupResponseDto>(
			[
				createResponse(
					formatLandblockTopologyAssetId(landblockId),
					createTopologyPayload(landblockId, "dungeon"),
				),
				createResponse(
					formatEnvCellAssetId(0xda550100),
					createEnvCellPayload(0xda550100),
				),
				createResponse(
					formatRegionRenderProfileAssetId(1),
					createRegionRenderProfile(),
				),
			].map((response) => [response.assetId, response] as const),
		);
		const requestedAssetIds: string[] = [];

		const result = await runStaticLandblockRenderWorkerJob(
			createJob("dungeon-env-cells"),
			{
				async lookupBinaryAssets(requests: readonly AssetLookupRequestDto[]) {
					requestedAssetIds.push(...requests.map((request) => request.assetId));
					return {
						responses: requests.map((request) => {
							const response = lookup.get(request.assetId);
							if (!response) {
								throw new Error(`Missing test response ${request.assetId}.`);
							}
							return response;
						}),
					};
				},
			},
		);

		expect(requestedAssetIds).not.toContain(
			formatLandblockOutdoorAssetId(landblockId),
		);
		expect(result.product).toBe("dungeon-env-cells");
		expect(getLandblockTerrainRenderArtifact(result)).toBeNull();
		expect(
			getStaticObjectBundleArtifacts(result).map((layer) => layer.bundleKind),
		).toEqual([]);
		expect(getDetailedLandblockRenderArtifacts(result)?.product).toBe(
			"dungeon-env-cells",
		);
	});

	it("cancels before loading product roots", async () => {
		let lookupCount = 0;

		await expect(
			runStaticLandblockRenderWorkerJob(
				createJob("outdoor-terrain"),
				{
					async lookupBinaryAssets() {
						lookupCount += 1;
						return { responses: [] };
					},
				},
				{ isCanceled: () => true },
			),
		).rejects.toThrow("canceled");
		expect(lookupCount).toBe(0);
	});
});

function createJob(
	product: LandblockRenderProductWorkerJob["product"] = "outdoor-env-cells",
	artifactFilter: LandblockRenderProductWorkerJob["artifactFilter"] = null,
): LandblockRenderProductWorkerJob {
	return {
		type: "build-landblock-render-product",
		jobId: `landblock-render-product:3663069183:${product}:build:v1:texture-pages:v1:artifacts:${artifactFilter?.join(",") ?? "all"}`,
		landblockId: 0xda55ffff,
		product,
		requestId: "request:worker",
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "texture-pages:v1",
		buildPolicy: {
			atlasLayout: {
				maxTextureSize: 64,
				maxTextureCount: 4,
				gutterPixels: 0,
			},
			terrainMaxLayerEntries: 8,
		},
		artifactFilter,
	};
}

function createResponse(
	assetId: string,
	payload: Record<string, unknown>,
): AssetLookupResponseDto {
	return {
		requestId: `response:${assetId}`,
		assetId,
		payloadKind: "json",
		payload,
	};
}

function createOutdoorPayload(
	landblockId: number,
	statics: Record<string, unknown>[] = [],
): Record<string, unknown> {
	const bounds = {
		min: { x: 0, y: 0, z: 0 },
		max: { x: 16, y: 16, z: 0 },
	};
	return {
		kind: "landblock-outdoor",
		sourceAssetKind: "landblock-outdoor",
		residencyKind: "outdoor-landblock",
		provenance: createProvenance("landblock-outdoor"),
		landblockId,
		regionId: 0x13000000,
		regionNumber: 1,
		classification: "outdoor",
		terrain: {
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
					terrainTriangleId: "terrain/tri/0",
					quadIndex: 0,
					triangleInQuad: 0,
					vertexIndices: [0, 1, 2],
					averageHeight: 0,
					bounds,
				},
				{
					terrainTriangleId: "terrain/tri/1",
					quadIndex: 0,
					triangleInQuad: 1,
					vertexIndices: [2, 1, 3],
					averageHeight: 0,
					bounds,
				},
			],
			quads: [
				{
					terrainQuadId: "terrain/quad/0",
					row: 0,
					col: 0,
					quadIndex: 0,
					sourceTerrainIndices: [0, 1, 2, 3],
					vertexIndices: [0, 1, 2, 3],
					triangleIndices: [0, 1],
					diagonal: "southwest-northeast",
					cornerTerrainCodes: [1, 1, 1, 1],
					pcode: 0x8421,
					averageHeight: 0,
					bounds,
				},
			],
			terrainBvh: {
				coordinateSpace: "landblock-outdoor-terrain-local",
				nodes: [],
				items: [{ row: 0, col: 0, quadIndex: 0, triangleIndices: [0, 1] }],
			},
			minHeight: 0,
			maxHeight: 0,
			bounds,
		},
		statics,
		outdoorBvh: null,
		diagnostics: { sourceRecords: [], errors: [], omissions: [] },
	};
}

function createOutdoorStaticMember(options: {
	kind: "explicit-object" | "building" | "generated-scenery";
	sourceAssetId: string;
	sourceDid: number;
}): Record<string, unknown> {
	const bounds = createBounds();
	return {
		kind: options.kind,
		instanceId: `static/${options.sourceAssetId}`,
		sourceDid: options.sourceDid,
		sourceAssetId: options.sourceAssetId,
		sourceIndex: 0,
		localPlacement: createPlacement(),
		sourceScale: { x: 1, y: 1, z: 1 },
		sourceBounds: bounds,
		instanceBounds: bounds,
		building:
			options.kind === "building"
				? {
						numLeaves: 0,
						portals: [],
					}
				: null,
		generated:
			options.kind === "generated-scenery"
				? {
						terrainIndex: 0,
						sceneId: 0,
						sceneTemplateIndex: 0,
					}
				: null,
	};
}

function createTopologyPayload(
	landblockId: number,
	classification = "outdoor",
): Record<string, unknown> {
	return {
		kind: "landblock-topology",
		sourceAssetKind: "landblock-topology",
		residencyKind: "landblock",
		provenance: createProvenance("landblock-topology"),
		landblockId,
		landblockInfoId: landblockId,
		classification,
		envCells: [
			{
				memberId: "env-cell-member/da550100",
				envCellId: 0xda550100,
				assetId: formatEnvCellAssetId(0xda550100),
				localPlacement: createPlacement(),
				visibleEnvCellIds: [0xda550101],
				restrictionObjectId: null,
				seenOutside: true,
			},
		],
		portalLinks: [],
		envCellResidencyBvh: {
			coordinateSpace: "landblock-topology-residency",
			nodes: [createBvhNode()],
			items: [
				{
					memberId: "env-cell-member/da550100",
					envCellId: 0xda550100,
					assetId: formatEnvCellAssetId(0xda550100),
					bounds: createBounds(),
					source: "env-cell-placement",
				},
			],
		},
		diagnostics: { sourceRecords: [], errors: [], omissions: [] },
	};
}

function createEnvCellPayload(
	envCellId: number,
	material?: {
		materialAssetId: string;
		slotId?: number;
		surfaceId: number;
		materialVariantSignatures?: readonly (string | null)[];
	},
): Record<string, unknown> {
	const materialSlotId = material?.slotId ?? 0;
	const materialVariantSignatures = material?.materialVariantSignatures ?? [
		null,
	];
	const triangleCount = material ? materialVariantSignatures.length : 1;
	const positions = new Float32Array(triangleCount * 9);
	const normals = new Float32Array(triangleCount * 9);
	const uvs = new Float32Array(triangleCount * 6);
	for (
		let triangleIndex = 0;
		triangleIndex < triangleCount;
		triangleIndex += 1
	) {
		const xOffset = triangleIndex * 2;
		positions.set(
			[xOffset, 0, 0, xOffset + 1, 0, 0, xOffset, 1, 0],
			triangleIndex * 9,
		);
		normals.set([0, 0, 1, 0, 0, 1, 0, 0, 1], triangleIndex * 9);
		uvs.set([0, 0, 1, 0, 0, 1], triangleIndex * 6);
	}
	return {
		kind: "env-cell",
		sourceAssetKind: "env-cell",
		residencyKind: "interior-cell",
		provenance: createProvenance("env-cell"),
		envCellId,
		regionId: 0x13000000,
		regionNumber: 1,
		environmentId: 0x01000001,
		cellStructureId: 0x02000002,
		localPlacement: createPlacement(),
		surfaces: material
			? [
					{
						slotId: materialSlotId,
						surfaceId: material.surfaceId,
						materialAssetId: material.materialAssetId,
					},
				]
			: [],
		portals: [
			{
				portalId: "portal/0",
				sourceIndex: 0,
				flags: 1,
				polygonId: 7,
				otherCellId: 0x0101,
				otherPortalId: 2,
				targetEnvCellId: 0xda550101,
				isOutsideTransition: true,
			},
		],
		visibleEnvCellIds: [0xda550101],
		portalApertures: [
			{
				portalId: "portal/0",
				sourceIndex: 0,
				polygonId: 7,
				points: [
					{ x: 0, y: 0, z: 0 },
					{ x: 1, y: 0, z: 0 },
					{ x: 0, y: 1, z: 0 },
				],
				plane: {
					normal: { x: 0, y: 0, z: 1 },
					constant: 0,
					source: "derived-from-render-points",
				},
			},
		],
		statics: [],
		renderGeometry: {
			sourceId: 0x02000002,
			vertexCount: triangleCount * 3,
			triangleCount,
			positions,
			normals,
			uvs,
			triangles: Array.from({ length: triangleCount }, (_, triangleIndex) => ({
				polygonId: 7,
				surfaceId: material ? materialSlotId : null,
				firstVertex: triangleIndex * 3,
				materialVariantSignature: material
					? (materialVariantSignatures[triangleIndex] ?? null)
					: null,
			})),
			surfaceIds: material ? [materialSlotId] : [],
			invalidPolygons: [],
			skippedPolygonCount: 0,
			bounds: createBounds(),
		},
		cellBsp: {
			kind: "leaf",
			index: 0,
			solid: 0,
			sphere: null,
			polyIds: [7],
		},
		localBvh: {
			coordinateSpace: "env-cell-local",
			nodes: [createBvhNode()],
			items: [
				{
					kind: "render-geometry",
					polygonId: 7,
					triangleRange: [0, 1],
				},
				{ kind: "portal", portalId: "portal/0" },
			],
		},
	};
}

function createGfxObjPayload(gfxObjId: number): Record<string, unknown> {
	return {
		kind: "gfx-obj",
		sourceAssetKind: "gfx-obj",
		residencyKind: "unknown",
		provenance: createProvenance("gfx-obj"),
		gfxObjId,
		flags: null,
		surfaceIds: [],
		vertexArray: {
			vertexType: null,
			vertexCount: 0,
			vertices: [],
		},
		drawingPolygons: [],
		drawingBsp: null,
		dependencies: {
			materialAssetIds: [],
		},
		physicsWitness: {
			polygonCount: 0,
			hasBsp: false,
		},
		renderGeometry: {
			sourceId: gfxObjId,
			vertexCount: 0,
			triangleCount: 0,
			positions: [],
			normals: [],
			uvs: [],
			triangles: [],
			surfaceIds: [],
			invalidPolygons: [],
			skippedPolygonCount: 0,
			bounds: null,
		},
		sortCenter: null,
		didDegrade: null,
	};
}

function createMaterialPayload(): Record<string, unknown> {
	return {
		kind: "material-recipe",
		sourceAssetKind: "material-recipe",
		residencyKind: "unknown",
		provenance: createProvenance("material-recipe"),
		surfaceId: 0x08000001,
		surfaceType: 0,
		source: {
			kind: "texture",
			surfaceTextureId: 0x05000001,
			selectedRenderSurfaceId: 0x06000001,
			paletteId: null,
			renderSurfaceDefaultPaletteIds: [],
		},
		translucency: 0,
		luminosity: 0,
		diffuse: 0,
		dependencies: {
			surfaceTextureAssetIds: [],
			renderSurfaceAssetIds: ["render-surface/06000001"],
			paletteAssetIds: [],
		},
	};
}

function createRenderSurfacePayload(): Record<string, unknown> {
	return {
		kind: "render-surface",
		sourceAssetKind: "render-surface",
		residencyKind: "unknown",
		provenance: createProvenance("render-surface"),
		renderSurfaceId: 0x06000001,
		unknown: 0,
		width: 1,
		height: 1,
		formatRaw: 0x15,
		format: "a8r8g8b8",
		sourceByteLength: 4,
		sourceBytes: new Uint8Array([255, 0, 0, 255]),
		defaultPaletteId: null,
		dependencies: {
			paletteAssetIds: [],
		},
	};
}

function createSurfaceTexturePayload(): Record<string, unknown> {
	return {
		kind: "surface-texture",
		sourceAssetKind: "surface-texture",
		residencyKind: "unknown",
		provenance: createProvenance("surface-texture"),
		surfaceTextureId: 0x05000013,
		textureType: 0,
		unknown: 0,
		selectedRenderSurfaceId: 0x06000001,
		renderSurfaceIds: [0x06000001],
		dependencies: {
			renderSurfaceAssetIds: ["render-surface/06000001"],
		},
	};
}

function createPreparedTexturePayload(options: {
	assetId: string;
	usage: "raw" | "detail";
}): Record<string, unknown> {
	return {
		kind: "prepared-texture",
		sourceAssetKind: "prepared-texture",
		residencyKind: "unknown",
		provenance: createProvenance("prepared-texture"),
		renderSurfaceId: 0x06000001,
		usage: options.usage,
		outputFormat: "rgba8",
		mipPolicy: "none",
		colorSpace: "linear",
		sourceFormatRaw: 0x15,
		sourceFormat: "a8r8g8b8",
		sourceWidth: 1,
		sourceHeight: 1,
		sourceByteLength: 4,
		sourceHash: options.assetId,
		levels: [
			{
				level: 0,
				width: 1,
				height: 1,
				formatRaw: 0x15,
				format: "rgba8",
				byteLength: 4,
				bytes: new Uint8Array(
					options.usage === "raw" ? [255, 0, 0, 255] : [0, 255, 0, 255],
				),
			},
		],
		dependencies: {
			renderSurfaceAssetIds: ["render-surface/06000001"],
		},
		diagnostics: {
			generatedLevelCount: 1,
			generatedByteLength: 4,
			decodeMs: 0,
			downsampleMs: 0,
			encodeMs: 0,
			totalMs: 0,
		},
	};
}

function createPlacement(): Record<string, unknown> {
	return {
		origin: { x: 0, y: 0, z: 0 },
		orientation: { w: 1, x: 0, y: 0, z: 0 },
	};
}

function createBounds(): Record<string, unknown> {
	return {
		min: { x: 0, y: 0, z: 0 },
		max: { x: 1, y: 1, z: 1 },
	};
}

function createBvhNode(): Record<string, unknown> {
	return {
		bounds: createBounds(),
		left: null,
		right: null,
		itemIndices: [0],
		kindMask: 1,
	};
}

function createTerrainMaterial(): Record<string, unknown> {
	return {
		kind: "terrain-material",
		sourceAssetKind: "terrain-material",
		residencyKind: "unknown",
		provenance: createProvenance("terrain-material"),
		regionNumber: 1,
		materialKind: "tex-merge-table",
		terrainTypes: [],
		terrainAlphaMaps: [],
		roadAlphaMaps: [],
		pcodeEncoding: { terrainCodeBits: 5, roadCodeBits: 2, sizeBitMask: 0 },
		dependencies: {
			surfaceTextureAssetIds: [],
			renderSurfaceAssetIds: [],
			paletteAssetIds: [],
		},
	};
}

function createRegionRenderProfile(): Record<string, unknown> {
	return {
		kind: "region-render-profile",
		sourceAssetKind: "region-render-profile",
		residencyKind: "unknown",
		provenance: createProvenance("region-render-profile"),
		regionNumber: 1,
		detailRoles: {
			landscape: null,
			building: null,
			environment: null,
			object: null,
		},
		dependencies: {
			surfaceTextureAssetIds: [],
			renderSurfaceAssetIds: [],
			paletteAssetIds: [],
		},
	};
}

function createRegionRenderProfileWithEnvironmentDetail(): Record<
	string,
	unknown
> {
	return {
		kind: "region-render-profile",
		sourceAssetKind: "region-render-profile",
		residencyKind: "unknown",
		provenance: createProvenance("region-render-profile"),
		regionNumber: 1,
		detailRoles: {
			landscape: null,
			building: null,
			environment: {
				role: "environment",
				sourceTerrainDescIndex: 0,
				textureAssetId: "surface-texture/05000013",
				textureDid: 0x05000013,
				tiling: 9,
				fadeNear: 0,
				fadeFar: 1,
			},
			object: null,
		},
		dependencies: {
			surfaceTextureAssetIds: ["surface-texture/05000013"],
			renderSurfaceAssetIds: ["render-surface/06000001"],
			paletteAssetIds: [],
		},
	};
}

function createProvenance(sourceAssetKind: string): Record<string, unknown> {
	return {
		source: "repo-local-hba",
		sourceAssetKind,
		errorCode: null,
		detail: null,
	};
}
