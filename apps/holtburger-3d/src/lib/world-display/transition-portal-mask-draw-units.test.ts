import { describe, expect, it } from "vitest";

import { envPortalBvhItemKey } from "./prepared-bvh-visibility";
import { deriveStructuredCellRenderChunk } from "./render-chunks";
import { buildTransitionPortalMaskDrawUnitAssemblies } from "./transition-portal-mask-draw-units";
import type {
	TransitionPortalCandidate,
	TransitionPortalCandidateModel,
} from "./transition-portal-work-items";

const IDENTITY_PLACEMENT = {
	origin: { x: 0, y: 0, z: 0 },
	orientation: { w: 1, x: 0, y: 0, z: 0 },
};

describe("transition portal mask draw units", () => {
	it("builds portal mask draw units from transition candidate aperture facts", () => {
		const candidate = createTransitionPortalCandidate();
		const drawUnits = buildTransitionPortalMaskDrawUnitAssemblies({
			chunkOffsetByKey: new Map([
				[candidate.renderChunk.chunkKey, { x: 10, y: 20, z: 30 }],
			]),
			transitionPortalModel: createTransitionPortalModel([candidate]),
		});

		expect(drawUnits).toHaveLength(1);
		expect(drawUnits[0]).toMatchObject({
			id: "portal-mask/outdoor-topology/00:cell-outside/01",
			kind: "portal-mask",
			staticPartCount: 0,
			staticObjectKeys: [],
			preparedAssetIds: [],
		});
		expect(drawUnits[0]?.geometry).toMatchObject({
			vertexCount: 3,
			triangleCount: 1,
			signature:
				"portal-mask:outdoor-topology/00:cell-outside/01:points=3",
		});
		expect(drawUnits[0]?.modelMatrix[12]).toBe(10);
		expect(drawUnits[0]?.bvhBinding.itemKeys).toEqual([
			envPortalBvhItemKey(0x016c0155, "cell-outside/01"),
		]);
	});

	it("skips portal masks until the render chunk offset is available", () => {
		const candidate = createTransitionPortalCandidate();

		expect(
			buildTransitionPortalMaskDrawUnitAssemblies({
				chunkOffsetByKey: new Map(),
				transitionPortalModel: createTransitionPortalModel([candidate]),
			}),
		).toEqual([]);
	});
});

function createTransitionPortalModel(
	candidates: readonly TransitionPortalCandidate[],
): TransitionPortalCandidateModel {
	return {
		candidates: [...candidates],
		diagnostics: {
			loadedEnvCellPortalFactCount: 1,
			topologyPortalCount: 1,
			linkedTopologyPortalCount: 1,
			apertureCandidateCount: candidates.length,
			workItemCandidateCount: candidates.length,
			skippedMissingApertureCount: 0,
			skippedMissingPolygonCount: 0,
			truncatedInteriorGroupCount: 0,
		},
	};
}

function createTransitionPortalCandidate(): TransitionPortalCandidate {
	const envCellId = 0x016c0155;
	return {
		id: "outdoor-topology/00:cell-outside/01",
		source: "browser-free-camera",
		outdoorPortalId: "outdoor-topology/00",
		aperture: {
			id: "cell-outside/01",
			source: {
				kind: "env-cell",
				envCellId,
				portalId: "cell-outside/01",
				sourceIndex: 0,
				polygonId: 7,
				flags: 0x4,
				otherPortalId: 0xffff,
			},
			renderChunk: deriveStructuredCellRenderChunk(envCellId),
			chunkLocalPlacement: IDENTITY_PLACEMENT,
			points: [
				{ x: 0, y: 2, z: -1 },
				{ x: 3, y: 2, z: -1 },
				{ x: 3, y: 5, z: -1 },
			],
			plane: {
				normal: { x: 0, y: 0, z: 1 },
				constant: -1,
				source: "derived-from-render-points",
			},
			visibleSide: "negative",
			targetEnvCellId: 0x016cffff,
			targetStatus: "outside",
			outsideTransition: true,
		},
		insideVisibleSide: "negative",
		outsideVisibleSide: "positive",
		renderChunk: deriveStructuredCellRenderChunk(envCellId),
		entryEnvCellId: envCellId,
		requestedInteriorEnvCellIds: [envCellId],
		targetStatus: "outside",
		stencilRef: 1,
	};
}
