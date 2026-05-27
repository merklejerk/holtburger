import { describe, expect, it } from "vitest";

import type { AssetLookupResponseDto } from "../host/contracts";
import { getAssetResponseDependencies } from "./dependencies";
import type { PreparedAssetRecord, PreparedAssetPayload } from "./types";
import { getPreparedAssetDependencies } from "./types";

const provenance = {
	source: "repo-local-hba" as const,
	sourceAssetKind: "synthetic",
	errorCode: null,
	detail: null,
};

describe("asset response dependencies", () => {
	it("extracts setup-model part gfx dependencies for graph walking", () => {
		const response = createJsonResponse("setup-model/02000010", {
			kind: "setup-model",
			residencyKind: "unknown",
			sourceAssetKind: "setup-model",
			setupModelId: 0x02000010,
			flags: null,
			parts: [
				createSetupPart(0, "gfx-obj/01000010"),
				createSetupPart(1, "gfx-obj/01000011"),
				createSetupPart(2, "gfx-obj/01000010"),
			],
			holdingLocations: [],
			connectionPoints: [],
			placementSets: [],
			collisionWitness: {
				cylSphereCount: 0,
				sphereCount: 0,
			},
			height: null,
			radius: null,
			stepUp: null,
			stepDown: null,
			sortingSphere: null,
			selectionSphere: null,
			lights: [],
			defaultAnimation: null,
			defaultScript: null,
			defaultMotionTable: null,
			defaultSoundTable: null,
			defaultScriptTable: null,
			dependencies: {
				gfxObjAssetIds: [
					"gfx-obj/01000010",
					"gfx-obj/01000011",
					"gfx-obj/01000010",
				],
			},
			provenance,
		});

		expect(getAssetResponseDependencies(response)).toEqual([
			{ assetId: "gfx-obj/01000010" },
			{ assetId: "gfx-obj/01000011" },
		]);
	});

	it("uses typed gfx material dependencies instead of inferring from source surface ids", () => {
		const response = createJsonResponse("gfx-obj/01000010", {
			kind: "gfx-obj",
			residencyKind: "unknown",
			sourceAssetKind: "gfx-obj",
			gfxObjId: 0x01000010,
			flags: null,
			surfaceIds: [0x08000020],
			vertexArray: { vertexType: null, vertexCount: 0, vertices: [] },
			drawingPolygons: [],
			drawingBsp: null,
			dependencies: {
				materialAssetIds: ["material/08000010"],
			},
			physicsWitness: { polygonCount: 0, hasBsp: false },
			renderGeometry: {
				sourceId: 0x01000010,
				vertexCount: 0,
				triangleCount: 0,
				positions: [],
				normals: [],
				uvs: [],
				triangles: [],
				surfaceIds: [0x08000020],
				invalidPolygons: [],
				skippedPolygonCount: 0,
				bounds: null,
			},
			sortCenter: null,
			didDegrade: null,
			provenance,
		});

		expect(getAssetResponseDependencies(response)).toEqual([
			{ assetId: "material/08000010" },
		]);
	});

	it("extracts outdoor and topology dependencies from route-specific members", () => {
		expect(
			getAssetResponseDependencies(
				createJsonResponse(
					"landblock/da55ffff/outdoor",
					createLandblockOutdoorPayload([
						createOutdoorStaticMember("static-0", "gfx-obj/01000010"),
						createOutdoorStaticMember("building-0", "setup-model/02000010"),
					]),
				),
			),
		).toEqual([
			{ assetId: "gfx-obj/01000010" },
			{ assetId: "region-render-profile/1" },
			{ assetId: "setup-model/02000010" },
			{ assetId: "terrain-material/1" },
		]);

		expect(
			getAssetResponseDependencies(
				createJsonResponse(
					"landblock/da55ffff/topology",
					createLandblockTopologyPayload([
						createSceneEnvCellMember(0xda550100),
					]),
				),
			),
		).toEqual([{ assetId: "env-cell/da550100" }]);
	});

	it("extracts env-cell render dependencies from typed members", () => {
		expect(
			getAssetResponseDependencies(
				createJsonResponse("env-cell/da550100", createEnvCellPayload()),
			),
		).toEqual([
			{ assetId: "material/08000020" },
			{ assetId: "region-render-profile/1" },
			{ assetId: "setup-model/02000020" },
		]);
	});

	it("extracts terrain material render resource dependencies", () => {
		const response = createJsonResponse("terrain-material/1", {
			kind: "terrain-material",
			residencyKind: "unknown",
			sourceAssetKind: "terrain-material",
			regionNumber: 1,
			materialKind: "tex-merge-table",
			terrainTypes: [createTerrainMaterialTypeEntry("surface-texture/05000010")],
			terrainAlphaMaps: [
				{
					alphaIndex: 0,
					alphaTextureAssetId: "surface-texture/05000011",
					alphaTextureDid: 0x05000011,
					selector: 2,
				},
			],
			roadAlphaMaps: [],
			pcodeEncoding: {
				terrainCodeBits: 5,
				roadCodeBits: 2,
				sizeBitMask: 0x10000000,
			},
			dependencies: {
				surfaceTextureAssetIds: [
					"surface-texture/05000010",
					"surface-texture/05000011",
				],
				renderSurfaceAssetIds: ["render-surface/06000010"],
				paletteAssetIds: ["palette/04000010"],
			},
			provenance,
		});

		expect(getAssetResponseDependencies(response)).toEqual([
			{ assetId: "palette/04000010" },
			{ assetId: "render-surface/06000010" },
			{ assetId: "surface-texture/05000010" },
			{ assetId: "surface-texture/05000011" },
		]);
	});

	it("extracts prepared granular route dependencies with the same ownership rules", () => {
		expect(
			getPreparedAssetDependencies(
				createPreparedAssetRecord(
					"landblock/da55ffff/outdoor",
					createLandblockOutdoorPayload([
						createOutdoorStaticMember("static-0", "gfx-obj/01000010"),
					]),
				),
			),
		).toEqual([
			{ assetId: "gfx-obj/01000010" },
			{ assetId: "region-render-profile/1" },
			{ assetId: "terrain-material/1" },
		]);

		expect(
			getPreparedAssetDependencies(
				createPreparedAssetRecord(
					"landblock/da55ffff/topology",
					createLandblockTopologyPayload([
						createSceneEnvCellMember(0xda550100),
					]),
				),
			),
		).toEqual([{ assetId: "env-cell/da550100" }]);
	});

	it("extracts material dependencies from gfx and setup appearance payloads", () => {
		expect(
			getAssetResponseDependencies(
				createJsonResponse("gfx-obj/01000010", {
					kind: "gfx-obj",
					residencyKind: "unknown",
					sourceAssetKind: "gfx-obj",
					gfxObjId: 0x01000010,
					flags: null,
					surfaceIds: [0x08000010],
					vertexArray: { vertexType: null, vertexCount: 0, vertices: [] },
					drawingPolygons: [],
					drawingBsp: null,
					dependencies: {
						materialAssetIds: ["material/08000010"],
					},
					physicsWitness: { polygonCount: 0, hasBsp: false },
					renderGeometry: {
						sourceId: 0x01000010,
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
					provenance,
				}),
			),
		).toEqual([{ assetId: "material/08000010" }]);

		expect(
			getAssetResponseDependencies(
				createJsonResponse("setup-appearance/02000010", {
					kind: "setup-appearance",
					residencyKind: "unknown",
					sourceAssetKind: "setup-appearance",
					setupModelId: 0x02000010,
					appearanceKey: "setup:0x02000010|base",
					parts: [],
					textureChanges: [],
					animPartChanges: [],
					paletteId: null,
					subPalettes: [],
					dependencies: {
						materialAssetIds: ["material/08000010"],
						paletteAssetIds: ["palette/04000010"],
					},
					provenance,
				}),
			),
		).toEqual([
			{ assetId: "material/08000010" },
			{ assetId: "palette/04000010" },
		]);
	});

	it("extracts render resource dependencies from material payloads", () => {
		expect(
			getAssetResponseDependencies(
				createJsonResponse("material/08000010", {
					kind: "material-recipe",
					residencyKind: "unknown",
					sourceAssetKind: "material-recipe",
					surfaceId: 0x08000010,
					surfaceType: 2,
					source: {
						kind: "texture",
						surfaceTextureId: 0x05000010,
						selectedRenderSurfaceId: 0x06000010,
						paletteId: 0x04000010,
						renderSurfaceDefaultPaletteIds: [],
					},
					translucency: 1,
					luminosity: 0,
					diffuse: 1,
					dependencies: {
						surfaceTextureAssetIds: ["surface-texture/05000010"],
						renderSurfaceAssetIds: ["render-surface/06000010"],
						paletteAssetIds: ["palette/04000010"],
					},
					provenance,
				}),
			),
		).toEqual([
			{ assetId: "palette/04000010" },
			{ assetId: "render-surface/06000010" },
			{ assetId: "surface-texture/05000010" },
		]);

		expect(
			getAssetResponseDependencies(
				createJsonResponse("surface-texture/05000010", {
					kind: "surface-texture",
					residencyKind: "unknown",
					sourceAssetKind: "surface-texture",
					surfaceTextureId: 0x05000010,
					textureType: 1,
					unknown: 0,
					selectedRenderSurfaceId: 0x06000010,
					renderSurfaceIds: [0x06000010],
					dependencies: {
						renderSurfaceAssetIds: ["render-surface/06000010"],
					},
					provenance,
				}),
			),
		).toEqual([{ assetId: "render-surface/06000010" }]);
	});

	it("does not request derived prepared textures from generic render-surface graph dependencies", () => {
		expect(
			getPreparedAssetDependencies(
				createPreparedAssetRecord("render-surface/06000010", {
					kind: "render-surface",
					residencyKind: "unknown",
					sourceAssetKind: "render-surface",
					renderSurfaceId: 0x06000010,
					unknown: 0,
					width: 128,
					height: 128,
					formatRaw: 0x3154_5844,
					format: "Dxt1",
					sourceByteLength: 8192,
					sourceBytes: new Uint8Array(8192),
					defaultPaletteId: null,
					dependencies: { paletteAssetIds: [] },
					provenance,
				}),
			),
		).toEqual([]);
	});

	it("returns no dependencies for unknown payloads", () => {
		expect(
			getAssetResponseDependencies(
				createJsonResponse("unknown/synthetic", {
					kind: "unknown-synthetic",
					residencyKind: "unknown",
					provenance,
				}),
			),
		).toEqual([]);
	});
});

function createJsonResponse(
	assetId: string,
	payload: unknown,
): AssetLookupResponseDto {
	return {
		requestId: `request-${assetId}`,
		assetId,
		payloadKind: "json",
		payload,
	};
}

function createPreparedAssetRecord(
	assetId: string,
	payload: PreparedAssetPayload,
): PreparedAssetRecord {
	return {
		request: {
			requestId: `request-${assetId}`,
			assetId,
			priority: "streaming",
		},
		response: createJsonResponse(assetId, payload),
		payload,
		preparedAt: "2026-05-23T00:00:00.000Z",
	};
}

function createSetupPart(partIndex: number, gfxObjAssetId: string) {
	return {
		partIndex,
		gfxObjId: 0x01000010 + partIndex,
		gfxObjAssetId,
		parentIndex: null,
		scale: null,
	};
}

function createLandblockOutdoorTerrainPayload() {
	return {
		landblockId: 0xda55ffff,
		regionId: 0x13000000,
		regionNumber: 1,
		terrain: {
			gridSize: 9,
			tileSize: 24,
			vertices: [],
			triangles: [],
			quads: [
				createTerrainQuad(0, 0, 0, 1234),
				createTerrainQuad(0, 1, 1, 1234),
				createTerrainQuad(1, 0, 2, 5678),
			],
			terrainBvh: {
				coordinateSpace: "landblock-outdoor-terrain-local" as const,
				nodes: [],
				items: [],
			},
			minHeight: 0,
			maxHeight: 0,
			bounds: null,
		},
	};
}

function createLandblockOutdoorPayload(
	statics: ReturnType<typeof createOutdoorStaticMember>[] = [],
) {
	const terrainPayload = createLandblockOutdoorTerrainPayload();
	return {
		kind: "landblock-outdoor" as const,
		residencyKind: "outdoor-landblock" as const,
		sourceAssetKind: "landblock-outdoor" as const,
		landblockId: terrainPayload.landblockId,
		regionId: terrainPayload.regionId,
		regionNumber: terrainPayload.regionNumber,
		classification: "outdoor" as const,
		terrain: terrainPayload.terrain,
		statics,
		outdoorBvh: null,
		dependencies: {
			renderableSourceAssetIds: statics.map((member) => member.sourceAssetId),
			materialAssetIds: [],
		},
		diagnostics: emptyLandblockDiagnostics(),
		provenance,
	};
}

function createOutdoorStaticMember(instanceId: string, sourceAssetId: string) {
	return {
		kind: "explicit-object" as const,
		instanceId,
		sourceDid: Number.parseInt(sourceAssetId.slice(-8), 16),
		sourceAssetId,
		sourceIndex: 0,
		localPlacement: identityPlacement(),
		sourceScale: { x: 1, y: 1, z: 1 },
		sourceBounds: null,
		instanceBounds: null,
		building: null,
		generated: null,
	};
}

function createLandblockTopologyPayload(
	envCells: ReturnType<typeof createSceneEnvCellMember>[] = [],
) {
	return {
		kind: "landblock-topology" as const,
		residencyKind: "landblock" as const,
		sourceAssetKind: "landblock-topology" as const,
		landblockId: 0xda55ffff,
		landblockInfoId: 0xda55fffe,
		classification: "outdoor" as const,
		envCells,
		portalLinks: [],
		envCellResidencyBvh: {
			coordinateSpace: "landblock-topology-residency" as const,
			nodes: [],
			items: [],
		},
		diagnostics: emptyLandblockDiagnostics(),
		provenance,
	};
}

function createTerrainQuad(
	row: number,
	col: number,
	quadIndex: number,
	pcode: number,
) {
	return {
		terrainQuadId: `terrain-quad-${row}-${col}`,
		row,
		col,
		quadIndex,
		sourceTerrainIndices: [0, 1, 9, 10] as [number, number, number, number],
		vertexIndices: [0, 1, 9, 10] as [number, number, number, number],
		triangleIndices: [quadIndex * 2, quadIndex * 2 + 1] as [number, number],
		diagonal: "southwest-northeast" as const,
		cornerTerrainCodes: [1, 2, 3, 4] as [number, number, number, number],
		pcode,
		averageHeight: 0,
		bounds: emptyBounds(),
	};
}

function createSceneEnvCellMember(envCellId: number) {
	return {
		memberId: "env-cell-member-0",
		envCellId,
		assetId: "env-cell/da550100",
		localPlacement: identityPlacement(),
		visibleEnvCellIds: [],
		restrictionObjectId: null,
		seenOutside: null,
	};
}

function createEnvCellPayload() {
	return {
		kind: "env-cell" as const,
		residencyKind: "interior-cell" as const,
		sourceAssetKind: "env-cell" as const,
		envCellId: 0xda550100,
		regionId: 0x13000000,
		regionNumber: 1,
		environmentId: 0x0d000001,
		cellStructureId: 0x0d000002,
		localPlacement: identityPlacement(),
		surfaces: [
			{
				slotId: 1,
				surfaceId: 0x08000020,
				materialAssetId: "material/08000020",
			},
		],
		portals: [],
		visibleEnvCellIds: [],
		portalApertures: [],
		statics: [
			{
				instanceId: "cell-static-0",
				sourceDid: 0x02000020,
				sourceAssetId: "setup-model/02000020",
				sourceIndex: 0,
				localPlacement: identityPlacement(),
				sourceScale: { x: 1, y: 1, z: 1 },
				sourceBounds: null,
				instanceBounds: null,
			},
		],
		renderGeometry: emptyRenderGeometry(0x0d000002),
		cellBsp: {
			kind: "leaf" as const,
			index: 0,
			solid: 0,
			sphere: null,
			polyIds: [],
		},
		localBvh: {
			coordinateSpace: "env-cell-local" as const,
			nodes: [],
			items: [],
		},
		dependencies: {
			renderableSourceAssetIds: ["setup-model/02000020"],
			materialAssetIds: ["material/08000020"],
		},
		provenance,
	};
}

function createTerrainMaterialTypeEntry(textureAssetId: string) {
	return {
		terrainType: 1,
		textureAssetId,
		textureDid: 0x05000010,
		tiling: 1,
		detail: null,
		colorVariation: null,
	};
}

function emptyRenderGeometry(sourceId: number) {
	return {
		sourceId,
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
	};
}

function identityPlacement() {
	return {
		origin: { x: 0, y: 0, z: 0 },
		orientation: { w: 1, x: 0, y: 0, z: 0 },
	};
}

function emptyBounds() {
	return {
		min: { x: 0, y: 0, z: 0 },
		max: { x: 0, y: 0, z: 0 },
	};
}

function emptyLandblockDiagnostics() {
	return {
		sourceRecords: [],
		omissions: [],
		errors: [],
	};
}
