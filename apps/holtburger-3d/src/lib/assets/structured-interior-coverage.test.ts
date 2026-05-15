import { describe, expect, it } from "vitest";

import type { PreparedAssetRecord } from "./types";
import {
	createDefaultStructuredInteriorCoverageOptions,
	deriveStructuredInteriorCoverage,
	formatIndoorEnvCellAssetId,
} from "./structured-interior-coverage";

const DEFAULT_COVERAGE_OPTIONS =
	createDefaultStructuredInteriorCoverageOptions();

describe("structured interior coverage", () => {
	it("keeps direct membership from expanding through prepared visible cells", () => {
		const preparedByAssetId = {
			[formatIndoorEnvCellAssetId(0x016c0155)]:
				createPreparedIndoorEnvCellAsset(0x016c0155, [0x016c0156]),
		};

		const coverage = deriveStructuredInteriorCoverage(
			{ kind: "direct", envCellIds: [0x016c0155] },
			preparedByAssetId,
			DEFAULT_COVERAGE_OPTIONS,
		);

		expect(coverage).toEqual({
			envCellIds: [0x016c0155],
			truncated: false,
		});
	});

	it("starts visible-cell closure with only the seed when metadata is missing", () => {
		const coverage = deriveStructuredInteriorCoverage(
			{ kind: "visible-cell-closure", seedEnvCellIds: [0x016c0155] },
			{},
			DEFAULT_COVERAGE_OPTIONS,
		);

		expect(coverage.envCellIds).toEqual([0x016c0155]);
		expect(coverage.truncated).toBe(false);
	});

	it("recursively expands visible-cell closure as prepared metadata arrives", () => {
		const preparedByAssetId = {
			[formatIndoorEnvCellAssetId(0x016c0155)]:
				createPreparedIndoorEnvCellAsset(0x016c0155, [0x016c0156]),
			[formatIndoorEnvCellAssetId(0x016c0156)]:
				createPreparedIndoorEnvCellAsset(0x016c0156, [0x016c0157]),
		};

		const coverage = deriveStructuredInteriorCoverage(
			{ kind: "visible-cell-closure", seedEnvCellIds: [0x016c0155] },
			preparedByAssetId,
			DEFAULT_COVERAGE_OPTIONS,
		);

		expect(coverage.envCellIds).toEqual([0x016c0155, 0x016c0156, 0x016c0157]);
		expect(coverage.truncated).toBe(false);
	});

	it("truncates visible-cell closure when traversal reaches the configured depth", () => {
		const preparedByAssetId = {
			[formatIndoorEnvCellAssetId(0x016c0155)]:
				createPreparedIndoorEnvCellAsset(0x016c0155, [0x016c0156]),
			[formatIndoorEnvCellAssetId(0x016c0156)]:
				createPreparedIndoorEnvCellAsset(0x016c0156, [0x016c0157]),
		};

		const coverage = deriveStructuredInteriorCoverage(
			{ kind: "visible-cell-closure", seedEnvCellIds: [0x016c0155] },
			preparedByAssetId,
			{ maxEnvCells: 10, maxVisibleCellDepth: 1 },
		);

		expect(coverage.envCellIds).toEqual([0x016c0155, 0x016c0156]);
		expect(coverage.truncated).toBe(true);
	});

	it("truncates visible-cell closure deterministically at the configured max", () => {
		const preparedByAssetId = {
			[formatIndoorEnvCellAssetId(0x016c0155)]:
				createPreparedIndoorEnvCellAsset(
					0x016c0155,
					[0x016c0158, 0x016c0156, 0x016c0157],
				),
		};

		const coverage = deriveStructuredInteriorCoverage(
			{ kind: "visible-cell-closure", seedEnvCellIds: [0x016c0155] },
			preparedByAssetId,
			{ maxEnvCells: 3, maxVisibleCellDepth: 16 },
		);

		expect(coverage.envCellIds).toEqual([0x016c0155, 0x016c0156, 0x016c0157]);
		expect(coverage.truncated).toBe(true);
	});
});

function createPreparedIndoorEnvCellAsset(
	envCellId: number,
	visibleCellIds: number[],
): PreparedAssetRecord {
	const assetId = formatIndoorEnvCellAssetId(envCellId);
	return {
		request: { requestId: assetId, assetId, priority: "streaming" },
		response: {
			requestId: assetId,
			assetId,
			payloadKind: "json",
			payload: {},
		},
		payload: {
			kind: "indoor-env-cell",
			sourceAssetKind: "env-cell",
			residencyKind: "indoor-env-cell",
			provenance: {
				source: "repo-local-hba",
				sourceAssetKind: "env-cell",
				errorCode: null,
				detail: "test",
			},
			debugPresentation: {
				primitive: "indoor-env-cell-metadata",
				paletteKey: assetId,
			},
			envCellId,
			environmentId: null,
			cellStructureId: null,
			localPlacement: {
				origin: { x: 0, y: 0, z: 0 },
				orientation: { w: 1, x: 0, y: 0, z: 0 },
			},
			visibleCellIds,
			seenOutside: false,
			surfaceIds: [],
			portalCount: 0,
			portals: [],
			staticObjectCount: 0,
			staticObjects: [],
		},
		preparedAt: "2026-05-15T00:00:00.000Z",
	};
}
