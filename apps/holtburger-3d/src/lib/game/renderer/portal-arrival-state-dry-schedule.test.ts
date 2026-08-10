import { describe, expect, it } from "vitest";
import { FRONTEND_TUNING } from "../../frontend-tuning";
import type { SceneScope } from "../scene";
import { scopeKey } from "../scene/scope";
import {
	createPortalArrivalStateDryScheduleTrace,
	type PortalArrivalStateDryPlan,
	type PortalDrySceneWorkload,
} from "./portal-arrival-state-dry-schedule";

const OUTDOOR: SceneScope = { kind: "outdoor" };
const INDOOR: SceneScope = {
	envCellId: "0xda550100",
	kind: "env-cell",
	landblockId: "0xda55ffff",
};

describe("createPortalArrivalStateDryScheduleTrace", () => {
	it("retains physical batches and one upload stream across arrival states", () => {
		const plan: PortalArrivalStateDryPlan = {
			atlasPixelCapacity: 10_000,
			commands: {
				crossingInstancePreparationCount: 2,
				frontierClearCommandCount: 2,
				maskPropagationCommandCount: 2,
				maskPropagationInstanceCount: 4,
				opaqueCompositeCommandCount: 1,
				opaqueCompositeInstanceCount: 2,
				scopeEnvelopeReductionCommandCount: 2,
				scopeEnvelopeReductionInstanceCount: 4,
				traversalDepth: 2,
			},
			selectedCrossingCount: 2,
			selectedScopeKeys: [scopeKey(OUTDOOR), scopeKey(INDOOR)],
			tilePixelCount: 10_000,
		};
		const workload: PortalDrySceneWorkload = {
			scopes: [
				{
					deferred: [
						{
							batchKey: "glass",
							distanceSquared: 20,
							kind: "transparent",
							submissionKey: "outdoor-glass",
						},
					],
					opaque: [{ batchKey: "terrain", preparationKey: "terrain" }],
					particles: [
						{
							batchKey: "flame",
							instanceCount: 12,
							sourceKey: "outdoor-flame",
						},
						{
							batchKey: "rain",
							instanceCount: 3,
							sourceKey: "outdoor-rain",
						},
					],
					scopeKey: scopeKey(OUTDOOR),
				},
				{
					...emptyScope(INDOOR),
					opaque: [{ batchKey: "wall", preparationKey: "wall" }],
				},
			],
		};

		const trace = createPortalArrivalStateDryScheduleTrace(plan, workload, {
			height: 50,
			width: 100,
		});

		expect(trace).toMatchObject({
			arrivalStateCount: 3,
			batchFormationInputCount: 2,
			contentPreparationCount: 1,
			frontierDepthAttachmentBytes: 20_000,
			frontierStateAttachmentBytes: 10_000,
			framebufferTargetCount: 4,
			maskInstancePreparationCount: 2,
			maskPropagationCommandCount: 2,
			maskPropagationInstanceCount: 4,
			nextFrontierClearCommandCount: 2,
			opaqueCompositeCommandCount: 1,
			opaqueCompositeInstanceCount: 2,
			opaqueSubmissionCount: 2,
			particleBatchCount: 2,
			particleInstancePackCount: 15,
			particleSourceCount: 2,
			particleUploadCount: 1,
			portalTargetBytes: 150_000,
			scopeAtlasPixelCapacity: 10_000,
			scopeAtlasSceneAttachmentBytes: 80_000,
			scopeAtlasTilePixelCount: 10_000,
			scopeAtlasVisibilityEnvelopeBytes: 40_000,
			scopeVisibilityEnvelopeCount: 2,
			scopeVisibilityEnvelopeInputCount: 3,
			scopeVisibilityEnvelopeReductionCommandCount: 2,
			scopeVisibilityEnvelopeReductionInstanceCount: 4,
			traversalCrossingCount: 2,
			traversalDepth: 2,
			transparentBatchKeyEvaluationCount: 1,
			transparentDepthBandClassificationCount: 1,
			transparentDepthBucketVisitCount:
				FRONTEND_TUNING.rendering.transparentObjects.depthBucketCount,
			transparentNearSquareRootCount: 1,
		});
	});
});

function emptyScope(scope: SceneScope) {
	return {
		deferred: [],
		opaque: [],
		particles: [],
		scopeKey: scopeKey(scope),
	};
}
