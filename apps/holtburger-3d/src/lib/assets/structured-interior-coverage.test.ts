import { describe, expect, it } from "vitest";

import type { PreparedAssetRecord } from "./types";
import {
	deriveBrowserFocusedStructuredInteriorMembershipPolicy,
	deriveStructuredInteriorCoverage,
} from "./structured-interior-coverage";

describe("structured interior coverage", () => {
	it("keeps direct membership exact and sorted", () => {
		const coverage = deriveStructuredInteriorCoverage(
			{ kind: "direct", envCellIds: [0x016c0157, 0x016c0155, 0x016c0155] },
			{},
		);

		expect(coverage).toEqual({
			envCellIds: [0x016c0155, 0x016c0157],
			truncated: false,
		});
	});

	it("starts landblock closure with only the seed when metadata is missing", () => {
		const coverage = deriveStructuredInteriorCoverage(
			{ kind: "landblock-closure", seedEnvCellIds: [0x016c0155] },
			{},
		);

		expect(coverage).toEqual({
			envCellIds: [0x016c0155],
			truncated: false,
		});
	});

	it("expands prepared landblock topology to its full env-cell inventory", () => {
		const preparedByAssetId = {
			"landblock/016cffff/topology": createPreparedLandblockTopologyAsset(
				0x016cffff,
				[0x016c0155, 0x016c0156, 0x016c0157],
			),
		};

		const coverage = deriveStructuredInteriorCoverage(
			{ kind: "landblock-closure", seedEnvCellIds: [0x016c0155] },
			preparedByAssetId,
		);

		expect(coverage).toEqual({
			envCellIds: [0x016c0155, 0x016c0156, 0x016c0157],
			truncated: false,
		});
	});

	it("uses landblock closure for browser-focused env cells", () => {
		expect(
			deriveBrowserFocusedStructuredInteriorMembershipPolicy(0x8a040100),
		).toEqual({
			kind: "landblock-closure",
			seedEnvCellIds: [0x8a040100],
		});
	});
});

function createPreparedLandblockTopologyAsset(
	landblockId: number,
	envCellIds: number[],
): PreparedAssetRecord {
	const assetId = `landblock/${landblockId.toString(16).padStart(8, "0")}/topology`;
	return {
		request: { requestId: assetId, assetId, priority: "streaming" },
		response: {
			requestId: assetId,
			assetId,
			payloadKind: "json",
			payload: {},
		},
		preparedAt: "2026-05-20T00:00:00.000Z",
		payload: {
			kind: "landblock-topology",
			sourceAssetKind: "landblock-topology",
			residencyKind: "landblock",
			provenance: {
				source: "repo-local-hba",
				sourceAssetKind: "landblock-topology",
				errorCode: null,
				detail: "test",
			},
			landblockId,
			landblockInfoId: (landblockId & 0xffff0000) | 0xfffe,
			classification: "dungeon",
			envCells: envCellIds.map((envCellId, index) => ({
				memberId: `env-cell-${index}`,
				envCellId,
				assetId: `env-cell/${envCellId.toString(16).padStart(8, "0")}`,
				localPlacement: {
					origin: { x: 0, y: 0, z: 0 },
					orientation: { w: 1, x: 0, y: 0, z: 0 },
				},
				visibleEnvCellIds: [],
				restrictionObjectId: null,
				seenOutside: null,
			})),
			portalLinks: [],
			envCellResidencyBvh: {
				coordinateSpace: "landblock-topology-residency",
				nodes: [],
				items: envCellIds.map((envCellId, index) => ({
					envCellId,
					memberId: `env-cell-${index}`,
					assetId: `env-cell/${envCellId.toString(16).padStart(8, "0")}`,
					source: "env-cell-placement",
				})),
			},
			diagnostics: { sourceRecords: [], omissions: [], errors: [] },
		},
	};
}
