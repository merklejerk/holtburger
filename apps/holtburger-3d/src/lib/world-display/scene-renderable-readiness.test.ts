import { describe, expect, it } from "vitest";

import {
	type PreparedAssetRecord,
	type PreparedPolygonSetRenderGeometry,
	type PreparedTerrainMesh,
} from "../assets/types";
import { createTestPreparedAssetResolver } from "../../../test-support/prepared-asset-resolver";
import { deriveSceneRenderableReadinessModel } from "./scene-renderable-readiness";
import type { StaticRenderableSceneModel } from "./static-renderables";
import type {
	StructuredInteriorCell,
	StructuredInteriorSceneModel,
} from "./structured-interior-scene";
import type { TerrainSceneModel, TerrainSceneTile } from "./terrain-scene";
import type {
	TransitionPortalCandidate,
	TransitionPortalCandidateModel,
} from "./transition-portal-work-items";

describe("deriveSceneRenderableReadinessModel", () => {
	it("keeps terrain fallback material state out of committed output by default", () => {
		const tile = createTerrainTile({
			materialStatus: "missing-table",
		});
		const readiness = deriveSceneRenderableReadinessModel({
			assetReadModel: emptyAssetReadModel(),
			terrainScene: createTerrainScene([tile]),
			structuredInteriorScene: createStructuredInteriorScene(),
			staticRenderableScene: createStaticRenderableScene(),
			transitionPortalModel: createTransitionPortalModel(),
		});

		expect(readiness.committedTerrainScene.tiles).toEqual([]);
		expect(readiness.records.map((record) => record.status)).toEqual([
			"fallback-resolved",
		]);
		expect(readiness.metrics.committedTerrainTileCount).toBe(0);
	});

	it("can commit terrain fallback material state when fallback policy is explicit", () => {
		const tile = createTerrainTile({
			materialStatus: "missing-table",
		});
		const readiness = deriveSceneRenderableReadinessModel({
			assetReadModel: emptyAssetReadModel(),
			commitPolicy: "allow-fallback",
			terrainScene: createTerrainScene([tile]),
			structuredInteriorScene: createStructuredInteriorScene(),
			staticRenderableScene: createStaticRenderableScene(),
			transitionPortalModel: createTransitionPortalModel(),
		});

		expect(readiness.committedTerrainScene.tiles).toEqual([tile]);
		expect(readiness.metrics.committedTerrainTileCount).toBe(1);
	});

	it("excludes terrain tiles with empty geometry", () => {
		const readiness = deriveSceneRenderableReadinessModel({
			assetReadModel: emptyAssetReadModel(),
			terrainScene: createTerrainScene([
				createTerrainTile({ mesh: createTerrainMesh({ triangleCount: 0 }) }),
			]),
			structuredInteriorScene: createStructuredInteriorScene(),
			staticRenderableScene: createStaticRenderableScene(),
			transitionPortalModel: createTransitionPortalModel(),
		});

		expect(readiness.committedTerrainScene.tiles).toEqual([]);
		expect(readiness.metrics.failedCount).toBe(1);
	});

	it("commits structured interior cells with geometry and records missing cell metadata", () => {
		const cell = createStructuredInteriorCell();
		const readiness = deriveSceneRenderableReadinessModel({
			assetReadModel: emptyAssetReadModel(),
			terrainScene: createTerrainScene(),
			structuredInteriorScene: createStructuredInteriorScene({
				cells: [cell],
				missingEnvCellAssetIds: ["env-cell/00010100"],
			}),
			staticRenderableScene: createStaticRenderableScene(),
			transitionPortalModel: createTransitionPortalModel(),
		});

		expect(readiness.committedStructuredInteriorScene.cells).toEqual([cell]);
		expect(readiness.records.map(statusKey)).toContain(
			"pending:structured-interior:source:env-cell/00010100",
		);
		expect(readiness.metrics.committedStructuredInteriorCellCount).toBe(1);
	});

	it("excludes structured interior cells with empty geometry", () => {
		const readiness = deriveSceneRenderableReadinessModel({
			assetReadModel: emptyAssetReadModel(),
			terrainScene: createTerrainScene(),
			structuredInteriorScene: createStructuredInteriorScene({
				cells: [
					createStructuredInteriorCell({
						renderGeometry: createRenderGeometry({ triangleCount: 0 }),
					}),
				],
			}),
			staticRenderableScene: createStaticRenderableScene(),
			transitionPortalModel: createTransitionPortalModel(),
		});

		expect(readiness.committedStructuredInteriorScene.cells).toEqual([]);
		expect(readiness.metrics.failedCount).toBe(1);
	});

	it("keeps portal no-render decisions explicit without committing fake candidates", () => {
		const readiness = deriveSceneRenderableReadinessModel({
			assetReadModel: emptyAssetReadModel(),
			terrainScene: createTerrainScene(),
			structuredInteriorScene: createStructuredInteriorScene(),
			staticRenderableScene: createStaticRenderableScene(),
			transitionPortalModel: createTransitionPortalModel({
				skippedMissingApertureCount: 2,
			}),
		});

		expect(readiness.committedTransitionPortalModel.candidates).toEqual([]);
		expect(readiness.records.map(statusKey)).toEqual([
			"fallback-resolved:portal:portal-aperture:none",
		]);
	});

	it("filters invalid portal aperture candidates from committed portal input", () => {
		const validCandidate = createPortalCandidate("portal/valid", 3);
		const invalidCandidate = createPortalCandidate("portal/invalid", 2);
		const readiness = deriveSceneRenderableReadinessModel({
			assetReadModel: emptyAssetReadModel(),
			terrainScene: createTerrainScene(),
			structuredInteriorScene: createStructuredInteriorScene(),
			staticRenderableScene: createStaticRenderableScene(),
			transitionPortalModel: createTransitionPortalModel({
				candidates: [validCandidate, invalidCandidate],
			}),
		});

		expect(readiness.committedTransitionPortalModel.candidates).toEqual([
			validCandidate,
		]);
		expect(readiness.metrics.failedCount).toBe(1);
	});

	it("keeps committed output stable when unrelated assets hydrate", () => {
		const tile = createTerrainTile();
		const first = deriveSceneRenderableReadinessModel({
			assetReadModel: emptyAssetReadModel(),
			terrainScene: createTerrainScene([tile]),
			structuredInteriorScene: createStructuredInteriorScene(),
			staticRenderableScene: createStaticRenderableScene(),
			transitionPortalModel: createTransitionPortalModel(),
		});
		const secondAssetReadModel = createTestPreparedAssetResolver([
			{
				request: {
					requestId: "unrelated/asset",
					assetId: "unrelated/asset",
					priority: "streaming",
				},
				response: {
					requestId: "unrelated/asset",
					assetId: "unrelated/asset",
					payloadKind: "json",
					payload: { kind: "unknown" },
				},
				payload: {
					kind: "unknown",
					sourceAssetKind: "unknown",
					residencyKind: "unknown",
					provenance: {
						source: "inline",
						sourceAssetKind: null,
						errorCode: null,
						detail: null,
					},
				},
				preparedAt: "2026-06-09T00:00:00.000Z",
			} satisfies PreparedAssetRecord,
		]);
		const second = deriveSceneRenderableReadinessModel({
			assetReadModel: secondAssetReadModel,
			terrainScene: createTerrainScene([tile]),
			structuredInteriorScene: createStructuredInteriorScene(),
			staticRenderableScene: createStaticRenderableScene(),
			transitionPortalModel: createTransitionPortalModel(),
		});

		expect(second.committedTerrainScene).toEqual(first.committedTerrainScene);
		expect(second.metrics.committedTerrainTileCount).toBe(1);
	});
});

function emptyAssetReadModel() {
	return createTestPreparedAssetResolver([]);
}

function statusKey(record: {
	status: string;
	family: string;
	dependencyClass: string;
	assetId: string | null;
}): string {
	return `${record.status}:${record.family}:${record.dependencyClass}:${record.assetId ?? "none"}`;
}

function createTerrainScene(tiles: TerrainSceneTile[] = []): TerrainSceneModel {
	return {
		focusLandblockId: 0x12340000,
		statusText: "terrain",
		cacheText: "cache",
		dataSourceText: "source",
		tiles,
	};
}

function createTerrainTile({
	mesh = createTerrainMesh(),
	materialStatus = "ready",
}: {
	mesh?: PreparedTerrainMesh;
	materialStatus?: TerrainSceneTile["materialResources"]["status"];
} = {}): TerrainSceneTile {
	return {
		assetId: "landblock-outdoor/12340000",
		landblockId: 0x12340000,
		label: "1234",
		isFocus: true,
		chunkLocalOffset: { x: 0, y: 0, z: 0 },
		mesh,
		materialResources: {
			kind: "terrain-material-resource-plan",
			regionNumber: 1,
			terrainMaterialAssetId: "terrain-material/00000001",
			status: materialStatus,
			signature: `terrain:${materialStatus}`,
			terrainTypeCount: 0,
			terrainAlphaMapCount: 0,
			roadAlphaMapCount: 0,
			uniquePcodeCount: 0,
			referencedTerrainCodes: [],
			missingTerrainTypes: [],
			missingSurfaceTextureAssetIds:
				materialStatus === "missing-texture-resources"
					? ["surface-texture/08000001"]
					: [],
			missingRenderSurfaceAssetIds: [],
			unsupportedRenderSurfaceAssetIds: [],
			hasTerrainAlphaMaps: false,
			hasRoadAlphaMaps: false,
			diagnostics: [],
		},
		terrainArtifact: null,
		dataSource: "unknown",
	};
}

function createTerrainMesh({
	triangleCount = 1,
}: {
	triangleCount?: number;
} = {}): PreparedTerrainMesh {
	return {
		landblockId: 0x12340000,
		gridSize: 1,
		tileSize: 24,
		vertices: [
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 0, z: 0 },
			{ x: 0, y: 1, z: 0 },
		],
		triangles:
			triangleCount === 0
				? []
				: [
						{
							a: 0,
							b: 1,
							c: 2,
							quadIndex: 0,
							triangleInQuad: 0,
							debugTerrainPcode: 0,
							averageHeight: 0,
						},
					],
		quads: [],
		minHeight: 0,
		maxHeight: 0,
	};
}

function createStructuredInteriorScene(
	overrides: Partial<StructuredInteriorSceneModel> = {},
): StructuredInteriorSceneModel {
	return {
		focusEnvCellId: null,
		activeEnvCellIds: [],
		cells: [],
		missingEnvCellAssetIds: [],
		missingInteriorGeometryAssetIds: [],
		missingCellStructureKeys: [],
		statusText: "interiors",
		cacheText: "cache",
		...overrides,
	};
}

function createStructuredInteriorCell(
	overrides: Partial<StructuredInteriorCell> = {},
): StructuredInteriorCell {
	return {
		renderKey: "interior/env-cell/00010100",
		envCellId: 0x00010100,
		regionNumber: 1,
		renderChunk: {
			chunkKey: "landblock/00010000",
			chunkLandblockId: 0x00010000,
		},
		environmentId: 1,
		cellStructureId: 1,
		isFocus: true,
		chunkLocalPlacement: {
			origin: { x: 0, y: 0, z: 0 },
			orientation: { w: 1, x: 0, y: 0, z: 0 },
		},
		surfaceIds: [],
		portalCount: 0,
		portals: [],
		portalApertures: [],
		staticObjectCount: 0,
		cellStructure: null,
		cellBsp: null,
		renderGeometry: createRenderGeometry(),
		debugColorKey: "cell",
		detailSignature: "detail:none",
		...overrides,
	};
}

function createRenderGeometry({
	triangleCount = 1,
}: {
	triangleCount?: number;
} = {}): PreparedPolygonSetRenderGeometry {
	return {
		sourceId: 1,
		vertexCount: triangleCount === 0 ? 0 : 3,
		triangleCount,
		positions: new Float32Array(),
		normals: [],
		uvs: [],
		triangles: [],
		surfaceIds: [],
		invalidPolygons: [],
		bounds: null,
	};
}

function createStaticRenderableScene(): StaticRenderableSceneModel {
	return {
		focusLandblockId: null,
		activeLandblockIds: [],
		sourceInstances: [],
		parts: [],
		partsByRenderGroupKey: new Map(),
		missingSourceAssetIds: [],
		missingGfxAssetIds: [],
		missingSetupAppearanceAssetIds: [],
	};
}

function createTransitionPortalModel({
	candidates = [],
	skippedMissingApertureCount = 0,
}: {
	candidates?: TransitionPortalCandidate[];
	skippedMissingApertureCount?: number;
} = {}): TransitionPortalCandidateModel {
	return {
		candidates,
		diagnostics: {
			loadedEnvCellPortalFactCount: 0,
			topologyPortalCount: 0,
			linkedTopologyPortalCount: 0,
			apertureCandidateCount: candidates.length,
			workItemCandidateCount: candidates.length,
			skippedMissingApertureCount,
			skippedMissingPolygonCount: 0,
			truncatedInteriorGroupCount: 0,
		},
	};
}

function createPortalCandidate(
	id: string,
	pointCount: number,
): TransitionPortalCandidate {
	return {
		id,
		aperture: {
			points: Array.from({ length: pointCount }, () => ({ x: 0, y: 0, z: 0 })),
		},
		renderChunk: {
			chunkKey: "landblock/12340000",
			chunkLandblockId: 0x12340000,
		},
	} as TransitionPortalCandidate;
}
