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
	it("documents migration-target landblock pack shared renderable extraction", () => {
		const response = createJsonResponse("landblock-pack/da55ffff", {
			kind: "landblock-pack",
			residencyKind: "landblock",
			sourceAssetKind: "landblock-pack",
			landblockId: 0xda55ffff,
			landblockInfoId: 0xda55fffe,
			classification: "outdoor",
			sourceFacts: {
				buildings: [],
			},
			prepared: {
				terrainMesh: null,
				outdoorStaticInstances: [],
				interiorCells: [],
				staticMeshes: [],
				spatialItems: [],
				staticLandblockBvh: null,
			},
			dependencies: {
				cellDatIds: [0xda55ffff, 0xda55fffe],
				portalDatIds: [],
				renderableAssetIds: [
					"setup-model/02000001",
					"gfx-obj/01000001",
					"setup-model/02000001",
				],
				missing: [],
				unsupported: [],
			},
			diagnostics: {
				sourceRecords: [],
				omissions: [],
				errors: [],
			},
			provenance,
		});

		expect(getAssetResponseDependencies(response)).toEqual([
			{ assetId: "gfx-obj/01000001" },
			{ assetId: "setup-model/02000001" },
		]);
	});

	it("extracts setup-model part gfx dependencies without default setup appearance", () => {
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
				setupAppearanceAssetId: "setup-appearance/02000010",
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

	it("extracts one terrain material table dependency per terrain region", () => {
		const response = createJsonResponse(
			"landblock/da55ffff/terrain",
			createLandblockTerrainPayload(),
		);

		expect(getAssetResponseDependencies(response)).toEqual([
			{ assetId: "terrain-material/1" },
		]);
	});

	it("extracts building shell dependencies without material leaves", () => {
		const response = createJsonResponse(
			"landblock/da55ffff/building-shells",
			createLandblockBuildingShellsPayload([
				createBuildingShellMember("shell-0", "setup-model/02000010"),
				createBuildingShellMember("shell-1", "gfx-obj/01000010"),
				createBuildingShellMember("shell-2", "setup-model/02000010"),
			]),
		);

		expect(getAssetResponseDependencies(response)).toEqual([
			{ assetId: "gfx-obj/01000010" },
			{ assetId: "setup-model/02000010" },
		]);
	});

	it("extracts granular scene and env-cell dependencies from typed members", () => {
		expect(
			getAssetResponseDependencies(
				createJsonResponse("landblock/da55ffff/scene", {
					...createLandblockScenePayload(),
					statics: [createSceneStaticMember("static-0", "gfx-obj/01000010")],
					buildings: [
						createSceneBuildingMember("building-0", "setup-model/02000010"),
					],
					envCells: [createSceneEnvCellMember(0xda550100)],
				}),
			),
		).toEqual([
			{ assetId: "env-cell/da550100" },
			{ assetId: "gfx-obj/01000010" },
			{ assetId: "setup-model/02000010" },
		]);

		expect(
			getAssetResponseDependencies(
				createJsonResponse("env-cell/da550100", createEnvCellPayload()),
			),
		).toEqual([
			{ assetId: "material/08000020" },
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
			terrainTypes: [createTerrainMaterialTypeEntry("render-texture/05000010")],
			terrainAlphaMaps: [
				{
					alphaIndex: 0,
					alphaTextureAssetId: "render-texture/05000011",
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
				renderTextureAssetIds: [
					"render-texture/05000010",
					"render-texture/05000011",
				],
				renderSurfaceAssetIds: ["render-surface/06000010"],
				paletteAssetIds: ["palette/04000010"],
			},
			provenance,
		});

		expect(getAssetResponseDependencies(response)).toEqual([
			{ assetId: "palette/04000010" },
			{ assetId: "render-surface/06000010" },
			{ assetId: "render-texture/05000010" },
			{ assetId: "render-texture/05000011" },
		]);
	});

	it("extracts prepared granular route dependencies with the same ownership rules", () => {
		expect(
			getPreparedAssetDependencies(
				createPreparedAssetRecord(
					"landblock/da55ffff/terrain",
					createLandblockTerrainPayload(),
				),
			),
		).toEqual([{ assetId: "terrain-material/1" }]);

		expect(
			getPreparedAssetDependencies(
				createPreparedAssetRecord(
					"landblock/da55ffff/building-shells",
					createLandblockBuildingShellsPayload([
						createBuildingShellMember("shell-0", "setup-model/02000010"),
					]),
				),
			),
		).toEqual([{ assetId: "setup-model/02000010" }]);
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
						renderTextureId: 0x05000010,
						renderSurfaceIds: [0x06000010],
						paletteId: 0x04000010,
						renderSurfaceDefaultPaletteIds: [],
					},
					translucency: 1,
					luminosity: 0,
					diffuse: 1,
					dependencies: {
						renderTextureAssetIds: ["render-texture/05000010"],
						renderSurfaceAssetIds: ["render-surface/06000010"],
						paletteAssetIds: ["palette/04000010"],
					},
					provenance,
				}),
			),
		).toEqual([
			{ assetId: "palette/04000010" },
			{ assetId: "render-surface/06000010" },
			{ assetId: "render-texture/05000010" },
		]);

		expect(
			getAssetResponseDependencies(
				createJsonResponse("render-texture/05000010", {
					kind: "render-texture",
					residencyKind: "unknown",
					sourceAssetKind: "render-texture",
					renderTextureId: 0x05000010,
					textureType: 1,
					unknown: 0,
					renderSurfaceIds: [0x06000010],
					dependencies: {
						renderSurfaceAssetIds: ["render-surface/06000010"],
					},
					provenance,
				}),
			),
		).toEqual([{ assetId: "render-surface/06000010" }]);
	});

	it("extracts dependency manifest asset ids", () => {
		const response = createJsonResponse("dependency-manifest/synthetic", {
			kind: "dependency-manifest",
			residencyKind: "unknown",
			dependencyAssetIds: [
				"gfx-obj/01000020",
				"setup-model/02000020",
				"gfx-obj/01000020",
			],
			provenance,
		});

		expect(getAssetResponseDependencies(response)).toEqual([
			{ assetId: "gfx-obj/01000020" },
			{ assetId: "setup-model/02000020" },
		]);
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

function createLandblockTerrainPayload() {
	return {
		kind: "landblock-terrain" as const,
		residencyKind: "outdoor-landblock" as const,
		sourceAssetKind: "landblock-terrain" as const,
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
				coordinateSpace: "landblock-terrain-local" as const,
				nodes: [],
				items: [],
			},
			minHeight: 0,
			maxHeight: 0,
			bounds: null,
		},
		diagnostics: emptyLandblockDiagnostics(),
		provenance,
	};
}

function createLandblockBuildingShellsPayload(
	shells: ReturnType<typeof createBuildingShellMember>[] = [],
) {
	return {
		kind: "landblock-building-shells" as const,
		residencyKind: "outdoor-landblock" as const,
		sourceAssetKind: "landblock-building-shells" as const,
		landblockId: 0xda55ffff,
		shells,
		shellBvh: {
			coordinateSpace: "landblock-local" as const,
			nodes: [],
			items: shells.map((shell) => ({
				kind: "building-shell" as const,
				shellId: shell.shellId,
			})),
		},
		diagnostics: emptyLandblockDiagnostics(),
		provenance,
	};
}

function createBuildingShellMember(shellId: string, sourceAssetId: string) {
	return {
		shellId,
		buildingIndex: 0,
		sourceDid: Number.parseInt(sourceAssetId.slice(-8), 16),
		sourceAssetId,
		localPlacement: identityPlacement(),
		sourceScale: { x: 1, y: 1, z: 1 },
		sourceBounds: null,
		instanceBounds: null,
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

function createLandblockScenePayload() {
	return {
		kind: "landblock-scene" as const,
		residencyKind: "landblock" as const,
		sourceAssetKind: "landblock-scene" as const,
		landblockId: 0xda55ffff,
		landblockInfoId: 0xda55fffe,
		classification: "outdoor" as const,
		statics: [],
		buildings: [],
		envCells: [],
		portalLinks: [],
		envCellResidencyBvh: {
			coordinateSpace: "landblock-scene-residency" as const,
			nodes: [],
			items: [],
		},
		outdoorBvh: null,
		diagnostics: emptyLandblockDiagnostics(),
		provenance,
	};
}

function createSceneStaticMember(instanceId: string, sourceAssetId: string) {
	return {
		...createScenePlacedSourceMember(instanceId, sourceAssetId),
		kind: "scenery" as const,
	};
}

function createSceneBuildingMember(instanceId: string, sourceAssetId: string) {
	return {
		...createScenePlacedSourceMember(instanceId, sourceAssetId),
		kind: "building" as const,
		numLeaves: 0,
		portals: [],
	};
}

function createScenePlacedSourceMember(
	instanceId: string,
	sourceAssetId: string,
) {
	return {
		instanceId,
		memberId: `member-${instanceId}`,
		sourceDid: Number.parseInt(sourceAssetId.slice(-8), 16),
		sourceAssetId,
		sourceIndex: 0,
		localPlacement: identityPlacement(),
		sourceScale: { x: 1, y: 1, z: 1 },
		sourceBounds: null,
		instanceBounds: null,
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
		environmentId: 0x0d000001,
		cellStructureId: 0x0d000002,
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
