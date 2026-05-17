import { describe, expect, it } from "vitest";

import type { BrowserLocationSelection } from "../../app/browser-mode";
import type { RuntimeBatchDto } from "../host/contracts";
import {
	commitRenderAnchorCandidate,
	deriveRenderAnchorCandidate,
	deriveRenderChunkTransforms,
	isOutsideRetainRadius,
} from "./render-anchor";
import {
	deriveStructuredCellRenderChunk,
	deriveTerrainTileRenderChunk,
} from "./render-chunks";

describe("render anchor coordination", () => {
	it("uses explicit browser destinations as immediate render anchors", () => {
		const candidate = deriveRenderAnchorCandidate(createRuntimeBatch(), {
			kind: "indoor-env-cell",
			label: "Env cell 0x016c0155",
			source: "manual",
			envCellId: 0x016c0155,
			landblockId: 0x016cffff,
		});

		expect(candidate).toEqual({
			anchor: { landblockId: 0x016cffff },
			source: "browser-destination",
			retainRadius: 0,
		});
		expect(
			commitRenderAnchorCandidate({ landblockId: 0xda55ffff }, candidate),
		).toEqual({
			anchor: { landblockId: 0x016cffff },
			committed: true,
			source: "browser-destination",
		});
	});

	it("uses runtime residency as the fallback anchor source", () => {
		const candidate = deriveRenderAnchorCandidate(createRuntimeBatch(), null);

		expect(candidate).toMatchObject({
			anchor: { landblockId: 0xda55ffff },
			source: "runtime-residency",
			retainRadius: 3,
		});
	});

	it("applies a retain radius to residency-backed focus changes", () => {
		const currentAnchor = { landblockId: 0xda55ffff };
		const nearbyCandidate = deriveRenderAnchorCandidate(
			createRuntimeBatch(0xdc57ffff),
			null,
		);
		const outsideCandidate = deriveRenderAnchorCandidate(
			createRuntimeBatch(0xde59ffff),
			null,
		);

		expect(isOutsideRetainRadius(0xda55ffff, 0xdc57ffff, 3)).toBe(false);
		expect(isOutsideRetainRadius(0xda55ffff, 0xde59ffff, 3)).toBe(true);
		expect(commitRenderAnchorCandidate(currentAnchor, nearbyCandidate)).toEqual(
			{
				anchor: currentAnchor,
				committed: false,
				source: "runtime-residency",
			},
		);
		expect(
			commitRenderAnchorCandidate(currentAnchor, outsideCandidate),
		).toEqual({
			anchor: { landblockId: 0xde59ffff },
			committed: true,
			source: "runtime-residency",
		});
	});

	it("derives deterministic chunk transforms from the committed anchor", () => {
		const transforms = deriveRenderChunkTransforms(
			{ landblockId: 0xda55ffff },
			[
				deriveTerrainTileRenderChunk(0xdb55ffff),
				deriveStructuredCellRenderChunk(0x016c0155),
				deriveTerrainTileRenderChunk(0xdb55ffff),
			],
		);

		expect(transforms).toEqual([
			{
				chunkKey: "landblock/016cffff",
				chunkLandblockId: 0x016cffff,
				offset: { x: -41664, y: 0, z: -4416 },
			},
			{
				chunkKey: "landblock/db55ffff",
				chunkLandblockId: 0xdb55ffff,
				offset: { x: 192, y: 0, z: 0 },
			},
		]);
	});

	it("resolves outdoor coordinate destinations through the browser location policy", () => {
		const destination: BrowserLocationSelection = {
			kind: "outdoor-location",
			label: "29.90S, 65.90W, 0.0Z",
			northSouth: 29.9,
			northSouthHemisphere: "S",
			eastWest: 65.9,
			eastWestHemisphere: "W",
			elevation: 0,
			source: "manual",
			landblockId: null,
		};

		expect(
			deriveRenderAnchorCandidate(createRuntimeBatch(), destination)?.anchor,
		).toEqual({ landblockId: 0x2d5affff });
	});
});

function createRuntimeBatch(focusLandblockId = 0xda55ffff): RuntimeBatchDto {
	return {
		tick: 13,
		entities: [],
		residency: {
			focusEntityId: null,
			focusLandblockId,
			focusCellId: null,
			focusEnvCellId: null,
			visibleCellIds: [],
			seenOutside: null,
			environmentId: null,
			cellStructureId: null,
			focusLocationLabel: "Runtime focus",
			indoors: false,
			trackedBodyCount: 0,
		},
	};
}
