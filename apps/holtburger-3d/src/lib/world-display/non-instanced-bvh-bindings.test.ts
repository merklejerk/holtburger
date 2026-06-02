import { Object3D } from "three";
import { describe, expect, it } from "vitest";

import {
	debugCellOverlayBatchId,
	debugPortalOverlayBatchId,
	deriveDebugCellOverlayBatchBvhBinding,
	deriveDebugPortalOverlayBatchBvhBinding,
	deriveStructuredInteriorCellBatchBvhBinding,
	deriveTerrainTileBatchBvhBinding,
	deriveTransitionPortalMaskBatchBvhBinding,
	readNonInstancedBatchId,
	registerNonInstancedBatchId,
	structuredInteriorCellBatchId,
	terrainTileBatchId,
	transitionPortalMaskBatchId,
} from "./non-instanced-bvh-bindings";
import type { CellDebugOverlay, PortalDebugOverlay } from "./debug-overlays";
import type { StructuredInteriorCell } from "./structured-interior-scene";
import type { TerrainSceneTile } from "./terrain-scene";
import type { TransitionPortalCandidate } from "./transition-portal-work-items";

describe("non-instanced BVH bindings", () => {
	it("binds terrain batches to all landblock terrain quad keys", () => {
		expect(
			deriveTerrainTileBatchBvhBinding(
				terrainTile({
					assetId: "landblock/0203ffff/outdoor",
					landblockId: 0x0203ffff,
					quadIndices: [7, 7, 9],
				}),
			),
		).toEqual({
			batchId: "terrain:landblock/0203ffff/outdoor",
			itemKeys: [
				"terrain:landblock:0203ffff:quad:7",
				"terrain:landblock:0203ffff:quad:9",
			],
			fallbackReason: null,
		});
	});

	it("fallback-includes terrain batches with no quad keys", () => {
		expect(
			deriveTerrainTileBatchBvhBinding(
				terrainTile({
					assetId: "landblock/0203ffff/outdoor",
					quadIndices: [],
				}),
			).fallbackReason,
		).toBe("terrain batch landblock/0203ffff/outdoor contains no terrain quad keys");
	});

	it("binds structured cell render geometry batches by env cell", () => {
		expect(
			deriveStructuredInteriorCellBatchBvhBinding(
				structuredCell({
					renderKey: "interior-cell-shell/02030100",
					envCellId: 0x02030100,
				}),
			),
		).toEqual({
			batchId: "structured-interior:interior-cell-shell/02030100",
			itemKeys: ["env-render-geometry:cell:02030100"],
			fallbackReason: null,
		});
	});

	it("binds debug cell overlays by env cell render geometry", () => {
		expect(
			deriveDebugCellOverlayBatchBvhBinding(
				debugCell({
					renderKey: "interior-cell-shell/02030100",
					envCellId: 0x02030100,
				}),
			),
		).toEqual({
			batchId: "debug-cell:interior-cell-shell/02030100",
			itemKeys: ["env-render-geometry:cell:02030100"],
			fallbackReason: null,
		});
	});

	it("binds debug portal overlays and transition masks by env-cell portal key", () => {
		expect(
			deriveDebugPortalOverlayBatchBvhBinding(
				debugPortal({ sourceEnvCellId: 0x02030100, portalId: "portal/1" }),
			),
		).toEqual({
			batchId: "debug-portal:02030100:portal/1",
			itemKeys: ["env-portal:cell:02030100:portal:portal/1"],
			fallbackReason: null,
		});
		expect(
			deriveTransitionPortalMaskBatchBvhBinding(
				transitionCandidate({
					id: "outdoor/1:portal/1",
					sourceEnvCellId: 0x02030100,
					portalId: "portal/1",
				}),
			),
		).toEqual({
			batchId: "transition-portal-mask:outdoor/1:portal/1",
			itemKeys: ["env-portal:cell:02030100:portal:portal/1"],
			fallbackReason: null,
		});
	});

	it("formats stable non-instanced batch ids", () => {
		expect(terrainTileBatchId("asset/a")).toBe("terrain:asset/a");
		expect(structuredInteriorCellBatchId("cell/a")).toBe(
			"structured-interior:cell/a",
		);
		expect(debugCellOverlayBatchId("cell/a")).toBe("debug-cell:cell/a");
		expect(debugPortalOverlayBatchId(0x02030100, "portal/1")).toBe(
			"debug-portal:02030100:portal/1",
		);
		expect(transitionPortalMaskBatchId("candidate/a")).toBe(
			"transition-portal-mask:candidate/a",
		);
	});

	it("stores non-instanced batch ids on Three.js objects", () => {
		const object = new Object3D();
		expect(readNonInstancedBatchId(object)).toBeNull();

		registerNonInstancedBatchId(object, "batch/a");

		expect(readNonInstancedBatchId(object)).toBe("batch/a");
	});
});

function terrainTile(options: {
	assetId?: string;
	landblockId?: number;
	quadIndices: number[];
}): TerrainSceneTile {
	return {
		assetId: options.assetId ?? "landblock/0203ffff/outdoor",
		landblockId: options.landblockId ?? 0x0203ffff,
		label: "0203",
		isFocus: false,
		chunkLocalOffset: { x: 0, y: 0, z: 0 },
		mesh: {
			landblockId: options.landblockId ?? 0x0203ffff,
			gridSize: 1,
			tileSize: 24,
			vertices: [],
			triangles: [],
			quads: options.quadIndices.map((quadIndex) => ({ quadIndex })),
			minHeight: 0,
			maxHeight: 0,
		},
		materialResources: {
			signature: "terrain",
			textureEntries: [],
			missingTextureIds: [],
			missingSurfaceIds: [],
			dataSourceCounts: {},
		},
		dataSource: "unknown",
	} as TerrainSceneTile;
}

function structuredCell(
	overrides: Partial<StructuredInteriorCell>,
): StructuredInteriorCell {
	return {
		renderKey: "interior-cell-shell/02030100",
		envCellId: 0x02030100,
		...overrides,
	} as StructuredInteriorCell;
}

function debugCell(overrides: Partial<CellDebugOverlay>): CellDebugOverlay {
	return {
		renderKey: "interior-cell-shell/02030100",
		envCellId: 0x02030100,
		...overrides,
	} as CellDebugOverlay;
}

function debugPortal(
	overrides: Partial<PortalDebugOverlay>,
): PortalDebugOverlay {
	return {
		sourceEnvCellId: 0x02030100,
		portalId: "portal/1",
		...overrides,
	} as PortalDebugOverlay;
}

function transitionCandidate(options: {
	id: string;
	sourceEnvCellId: number;
	portalId: string;
}): TransitionPortalCandidate {
	return {
		id: options.id,
		aperture: {
			id: options.portalId,
			source: {
				envCellId: options.sourceEnvCellId,
			},
		},
	} as TransitionPortalCandidate;
}
