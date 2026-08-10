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
			selectedScopeRenderDomainOrdinals: [0, 1],
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
					opaque: [
						{
							batchKey: "terrain",
							kind: "terrain",
							preparationKey: "terrain",
						},
					],
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
					opaque: [
						{ batchKey: "wall", kind: "object", preparationKey: "wall" },
					],
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
			opaqueAuthoredScopeTransitionCount: 1,
			opaqueRenderDomainTransitionCount: 2,
			opaqueSubmissionCount: 2,
			opaqueTileResolutionCount: 2,
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

	it("separates authored-scope lookups from packed-domain viewport transitions", () => {
		const scopes = Array.from({ length: 7 }, (_, ordinal) => ({
			envCellId: `0xda5501${ordinal.toString(16).padStart(2, "0")}`,
			kind: "env-cell" as const,
			landblockId: "0xda55ffff",
		}));
		const plan: PortalArrivalStateDryPlan = {
			atlasPixelCapacity: 10_000,
			commands: {
				crossingInstancePreparationCount: 0,
				frontierClearCommandCount: 0,
				maskPropagationCommandCount: 0,
				maskPropagationInstanceCount: 0,
				opaqueCompositeCommandCount: 1,
				opaqueCompositeInstanceCount: 1,
				scopeEnvelopeReductionCommandCount: 0,
				scopeEnvelopeReductionInstanceCount: 0,
				traversalDepth: 0,
			},
			selectedCrossingCount: 0,
			selectedScopeKeys: scopes.map(scopeKey),
			selectedScopeRenderDomainOrdinals: scopes.map(() => 0),
			tilePixelCount: 10_000,
		};
		const workload: PortalDrySceneWorkload = {
			scopes: scopes.map((scope, scopeOrdinal) => ({
				...emptyScope(scope),
				opaque: Array.from(
					{ length: scopeOrdinal < 6 ? 4 : 3 },
					(_, batchOrdinal) => ({
						batchKey: `batch-${scopeOrdinal}-${batchOrdinal}`,
						kind: "object" as const,
						preparationKey: `object-${scopeOrdinal}-${batchOrdinal}`,
					}),
				),
			})),
		};

		const trace = createPortalArrivalStateDryScheduleTrace(plan, workload, {
			height: 50,
			width: 100,
		});

		expect(trace.opaqueSubmissionCount).toBe(27);
		expect(trace.opaqueAuthoredScopeTransitionCount).toBe(7);
		expect(trace.opaqueTileResolutionCount).toBe(7);
		expect(trace.opaqueRenderDomainTransitionCount).toBe(1);
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
