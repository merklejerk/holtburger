import { describe, expect, it } from "vitest";

import type {
	PreparedBounds,
	PreparedEnvCellPayload,
	PreparedLandblockBvhNode,
	PreparedLandblockOutdoorPayload,
	PreparedLandblockTopologyPayload,
	PreparedOutdoorBvh,
	PreparedTerrainBvh,
} from "../assets/types";
import type { PlacementTransformDto } from "../host/contracts";
import {
	envPortalBvhItemKey,
	envRenderGeometryBvhItemKey,
	envStaticBvhItemKey,
	outdoorStaticBvhItemKey,
	queryEnvCellLocalBvhVisibility,
	queryLoadedEnvCellBvhVisibility,
	queryOutdoorBvhVisibility,
	queryTerrainBvhVisibility,
	residencyCellBvhItemKey,
	terrainBvhItemKey,
} from "./prepared-bvh-visibility";
import {
	translateRenderBounds,
	type RenderFrustum,
} from "./render-spatial-math";

describe("prepared BVH visibility", () => {
	it("constructs scoped item keys", () => {
		expect(terrainBvhItemKey(0x0203ffff, 7)).toBe(
			"terrain:landblock:0203ffff:quad:7",
		);
		expect(outdoorStaticBvhItemKey(0x0203ffff, "static/a")).toBe(
			"outdoor-static:landblock:0203ffff:instance:static/a",
		);
		expect(envStaticBvhItemKey(0x02030100, "static/a")).toBe(
			"env-static:cell:02030100:instance:static/a",
		);
		expect(envRenderGeometryBvhItemKey(0x02030100)).toBe(
			"env-render-geometry:cell:02030100",
		);
		expect(envPortalBvhItemKey(0x02030100, "portal/1")).toBe(
			"env-portal:cell:02030100:portal:portal/1",
		);
		expect(residencyCellBvhItemKey(0x02030100)).toBe(
			"residency-cell:cell:02030100",
		);
	});

	it("traverses prepared terrain BVH nodes from root index zero", () => {
		const result = queryTerrainBvhVisibility({
			terrainBvh: {
				coordinateSpace: "landblock-outdoor-terrain-local",
				nodes: [
					node(bounds(-1, 1, -22, -2, -1, 1), 1, 2, []),
					node(bounds(-1, 1, -4, -2, -1, 1), null, null, [0]),
					node(bounds(-1, 1, -22, -20, -1, 1), null, null, [1]),
				],
				items: [
					{ row: 0, col: 0, quadIndex: 10, triangleIndices: [0, 1] },
					{ row: 0, col: 1, quadIndex: 11, triangleIndices: [2, 3] },
				],
			},
			landblockId: 0x0203ffff,
			frustum: unitFrustumWithZRange(0, 10),
			chunkOffset: { x: 0, y: 0, z: 0 },
		});

		expect([...result.visibleItemKeys]).toEqual([
			"terrain:landblock:0203ffff:quad:10",
		]);
		expect(result.counters.nodesVisited).toBe(3);
		expect(result.counters.nodesIntersected).toBe(2);
		expect(result.fallbackReasons).toEqual([]);
	});

	it("transforms terrain BVH bounds from AC terrain local coordinates into render coordinates", () => {
		const result = queryTerrainBvhVisibility({
			terrainBvh: {
				coordinateSpace: "landblock-outdoor-terrain-local",
				nodes: [
					node(bounds(0, 24, 24, 48, 2, 4), null, null, [0]),
				],
				items: [
					{ row: 1, col: 0, quadIndex: 8, triangleIndices: [16, 17] },
				],
			},
			landblockId: 0x0203ffff,
			frustum: renderFrustum({
				minX: -10,
				maxX: 30,
				minY: 0,
				maxY: 10,
				minZ: -50,
				maxZ: -20,
			}),
			chunkOffset: { x: 0, y: 0, z: 0 },
		});

		expect([...result.visibleItemKeys]).toEqual([
			"terrain:landblock:0203ffff:quad:8",
		]);
	});

	it("uses the containing outdoor payload landblock for overhanging static keys", () => {
		const payload = createOutdoorPayload({
			landblockId: 0x0203ffff,
			outdoorBvh: {
				coordinateSpace: "landblock-render-local",
				nodes: [node(bounds(199, 201, 1, 3, 3, 7), null, null, [0])],
				items: [{ kind: "static", instanceId: "overhang" }],
			},
		});

		const result = queryOutdoorBvhVisibility({
			payload,
			frustum: unitFrustumWithZRange(0, 10),
			chunkOffset: { x: -200, y: 0, z: 0 },
		});

		expect([...result.visibleItemKeys]).toEqual([
			"outdoor-static:landblock:0203ffff:instance:overhang",
		]);
	});

	it("requests fallback when a prepared BVH coordinate space is unexpected", () => {
		const payload = createOutdoorPayload({
			landblockId: 0x0203ffff,
			outdoorBvh: {
				coordinateSpace: "neighbor-normalized-space",
				nodes: [node(bounds(-1, 1, -1, 1, 2, 4), null, null, [0])],
				items: [{ kind: "static", instanceId: "overhang" }],
			} as PreparedOutdoorBvh,
		});

		const result = queryOutdoorBvhVisibility({
			payload,
			frustum: unitFrustumWithZRange(0, 10),
			chunkOffset: { x: 0, y: 0, z: 0 },
		});

		expect([...result.visibleItemKeys]).toEqual([]);
		expect(result.fallbackReasons[0]).toContain(
			"expected BVH coordinate space landblock-render-local",
		);
	});

	it("queries env-cell local BVHs with cell-scoped item keys", () => {
		const result = queryEnvCellLocalBvhVisibility({
			payload: createEnvCellPayload({
				envCellId: 0x02030100,
				localBvh: {
					coordinateSpace: "env-cell-local",
					nodes: [node(bounds(-1, 1, -1, 1, 2, 4), null, null, [0, 1, 2])],
					items: [
						{
							kind: "render-geometry",
							polygonId: null,
							triangleRange: [0, 6],
						},
						{ kind: "static", instanceId: "chair" },
						{ kind: "portal", portalId: "portal/0" },
					],
				},
			}),
			frustum: unitFrustumWithZRange(0, 10),
			boundsToRendererBounds: (bounds) =>
				translateRenderBounds(bounds, { x: 0, y: 0, z: 0 }),
		});

		expect([...result.visibleItemKeys]).toEqual([
			"env-render-geometry:cell:02030100",
			"env-static:cell:02030100:instance:chair",
			"env-portal:cell:02030100:portal:portal/0",
		]);
	});

	it("recurses into loaded env-cell local BVHs after residency visibility", () => {
		const loadedEnvCell = createEnvCellPayload({
			envCellId: 0x02030100,
			localBvh: {
				coordinateSpace: "env-cell-local",
				nodes: [node(bounds(-1, 1, -1, 1, 2, 4), null, null, [0])],
				items: [
					{
						kind: "render-geometry",
						polygonId: null,
						triangleRange: [0, 3],
					},
				],
			},
		});
		const result = queryLoadedEnvCellBvhVisibility({
			topology: createTopologyPayload({
				landblockId: 0x0203ffff,
				envCellResidencyBvh: {
					coordinateSpace: "landblock-topology-residency",
					nodes: [node(bounds(-1, 1, -1, 1, 2, 4), null, null, [0])],
					items: [
						{
							envCellId: 0x02030100,
							memberId: "cell/0",
							assetId: "env-cell/02030100",
							source: "derived",
						},
					],
				},
			}),
			loadedEnvCellsById: new Map([[loadedEnvCell.envCellId, loadedEnvCell]]),
			frustum: unitFrustumWithZRange(0, 10),
			topologyChunkOffset: { x: 0, y: 0, z: 0 },
			envCellBoundsToRendererBounds: (_envCell, bounds) =>
				translateRenderBounds(bounds, { x: 0, y: 0, z: 0 }),
		});

		expect(result.consideredEnvCellIds).toEqual([0x02030100]);
		expect(result.missingEnvCellIds).toEqual([]);
		expect([...result.visibleItemKeys]).toEqual([
			"residency-cell:cell:02030100",
			"env-render-geometry:cell:02030100",
		]);
	});
});

function node(
	boundsValue: PreparedBounds,
	left: number | null,
	right: number | null,
	itemIndices: number[],
): PreparedLandblockBvhNode {
	return {
		bounds: boundsValue,
		left,
		right,
		itemIndices,
		kindMask: 0,
	};
}

function bounds(
	minX: number,
	maxX: number,
	minY: number,
	maxY: number,
	minZ: number,
	maxZ: number,
): PreparedBounds {
	return {
		min: { x: minX, y: minY, z: minZ },
		max: { x: maxX, y: maxY, z: maxZ },
	};
}

function unitFrustumWithZRange(minZ: number, maxZ: number): RenderFrustum {
	return renderFrustum({
		minX: -10,
		maxX: 10,
		minY: -10,
		maxY: 10,
		minZ,
		maxZ,
	});
}

function renderFrustum({
	minX,
	maxX,
	minY,
	maxY,
	minZ,
	maxZ,
}: {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
	minZ: number;
	maxZ: number;
}): RenderFrustum {
	return {
		planes: [
			{ normal: { x: 1, y: 0, z: 0 }, constant: -minX },
			{ normal: { x: -1, y: 0, z: 0 }, constant: maxX },
			{ normal: { x: 0, y: 1, z: 0 }, constant: -minY },
			{ normal: { x: 0, y: -1, z: 0 }, constant: maxY },
			{ normal: { x: 0, y: 0, z: 1 }, constant: -minZ },
			{ normal: { x: 0, y: 0, z: -1 }, constant: maxZ },
		],
	};
}

function createOutdoorPayload(options: {
	landblockId: number;
	outdoorBvh: PreparedOutdoorBvh | null;
}): PreparedLandblockOutdoorPayload {
	return {
		kind: "landblock-outdoor",
		sourceAssetKind: "landblock-outdoor",
		residencyKind: "outdoor-landblock",
		provenance: provenance(),
		landblockId: options.landblockId,
		regionId: 0,
		regionNumber: 0,
		classification: "outdoor",
		terrain: {
			gridSize: 0,
			tileSize: 24,
			vertices: [],
			triangles: [],
			quads: [],
			terrainBvh: emptyTerrainBvh(),
			minHeight: 0,
			maxHeight: 0,
			bounds: null,
		},
		statics: [],
		outdoorBvh: options.outdoorBvh,
		dependencies: {
			renderableSourceAssetIds: [],
			materialAssetIds: [],
		},
		diagnostics: emptyDiagnostics(),
	};
}

function createTopologyPayload(options: {
	landblockId: number;
	envCellResidencyBvh: PreparedLandblockTopologyPayload["envCellResidencyBvh"];
}): PreparedLandblockTopologyPayload {
	return {
		kind: "landblock-topology",
		sourceAssetKind: "landblock-topology",
		residencyKind: "landblock",
		provenance: provenance(),
		landblockId: options.landblockId,
		landblockInfoId: options.landblockId & 0xfffffffe,
		classification: "outdoor",
		envCells: [],
		portalLinks: [],
		envCellResidencyBvh: options.envCellResidencyBvh,
		diagnostics: emptyDiagnostics(),
	};
}

function createEnvCellPayload(options: {
	envCellId: number;
	localBvh: PreparedEnvCellPayload["localBvh"];
}): PreparedEnvCellPayload {
	return {
		kind: "env-cell",
		sourceAssetKind: "env-cell",
		residencyKind: "interior-cell",
		provenance: provenance(),
		envCellId: options.envCellId,
		environmentId: 0,
		cellStructureId: 0,
		regionNumber: 0,
		localPlacement: identityPlacement(),
		surfaces: [],
		portals: [],
		visibleEnvCellIds: [],
		portalApertures: [],
		statics: [],
		renderGeometry: {
			sourceId: 0,
			vertexCount: 0,
			triangleCount: 0,
			positions: [],
			normals: [],
			uvs: [],
			triangles: [],
			surfaceIds: [],
			bounds: null,
		},
		cellBsp: null,
		localBvh: options.localBvh,
		dependencies: {
			renderableSourceAssetIds: [],
			materialAssetIds: [],
		},
		diagnostics: emptyDiagnostics(),
	};
}

function emptyTerrainBvh(): PreparedTerrainBvh {
	return {
		coordinateSpace: "landblock-outdoor-terrain-local",
		nodes: [],
		items: [],
	};
}

function identityPlacement(): PlacementTransformDto {
	return {
		origin: { x: 0, y: 0, z: 0 },
		orientation: { w: 1, x: 0, y: 0, z: 0 },
	};
}

function provenance() {
	return {
		source: "repo-local-hba" as const,
		sourceAssetKind: null,
		errorCode: null,
		detail: null,
	};
}

function emptyDiagnostics() {
	return {
		sourceRecords: [],
		omissions: [],
		errors: [],
	};
}
