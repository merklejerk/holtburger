import { describe, expect, it } from "vitest";
import { FRONTEND_TUNING } from "../../frontend-tuning";
import { AABB2, Vec2 } from "../math/types";
import type { SceneScope } from "../scene";
import { scopeKey } from "../scene/scope";
import {
	createPortalArrivalStateDryScheduleTrace,
	createPortalPathViewDrySchedule,
	type PortalArrivalStateDryPlan,
	type PortalDrySceneWorkload,
} from "./portal-path-view-schedule";
import type {
	PortalContentDomainId,
	PortalPathView,
	PortalPathViewPlan,
} from "./portal-path-view-planner";
import { createEmptyCameraNearClipDiagnostics } from "./portal-near-plane";
import {
	createEmptyPortalWindowProjectionDiagnostics,
	createFullPortalViewWindow,
} from "./portal-view-window";

const OUTDOOR: SceneScope = { kind: "outdoor" };
const INDOOR: SceneScope = {
	envCellId: "0xda550100",
	kind: "env-cell",
	landblockId: "0xda55ffff",
};
const EXTERIOR = "portal-content-domain:outdoor" as PortalContentDomainId;
const INTERIOR = "portal-content-domain:interior" as PortalContentDomainId;

describe("createPortalPathViewDrySchedule", () => {
	it("prepares physical content once while composing repeated exterior appearances", () => {
		const plan = portalPlan([
			view("root", OUTDOOR, EXTERIOR, 0, 0),
			view("inside", INDOOR, INTERIOR, 1, 1),
			view("outside-again", OUTDOOR, EXTERIOR, 2, 2),
		]);
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
							batchKey: "flame-mesh/motion-1",
							instanceCount: 12,
							sourceKey: "outdoor-flame",
						},
					],
					scopeKey: scopeKey(OUTDOOR),
				},
				{
					deferred: [
						{
							batchKey: "smoke",
							distanceSquared: 10,
							kind: "additive",
							submissionKey: "indoor-smoke",
						},
					],
					opaque: [{ batchKey: "wall", preparationKey: "cell-wall" }],
					particles: [],
					scopeKey: scopeKey(INDOOR),
				},
			],
		};

		const schedule = createPortalPathViewDrySchedule(plan, workload);

		expect(schedule.opaqueSubmissions).toEqual([
			{ batchKey: "terrain", destination: "exterior-cache" },
			{ batchKey: "wall", destination: "ownership-label:1" },
		]);
		expect(schedule.visibilityEnvelopes.map(({ viewIds }) => viewIds)).toEqual([
			["portal-path-view:inside"],
			["portal-path-view:root", "portal-path-view:outside-again"],
		]);
		expect(schedule.trace).toMatchObject({
			compositeSubmissionCount: 2,
			contentPreparationCount: 2,
			maskSubmissionCount: 2,
			opaqueSubmissionCount: 2,
			particleBatchCount: 1,
			particleInstancePackCount: 12,
			particleSourceCount: 1,
			particleUploadCount: 1,
			sceneResolutionCount: 2,
			sceneResolutionScopeInputCount: 2,
			visibilityEnvelopeInputCount: 3,
			visibilitySubmissionCount: 2,
		});
	});

	it("merges compatible disjoint-label opaque appearances without multiplying preparation", () => {
		const secondIndoor: SceneScope = {
			envCellId: "0xda550101",
			kind: "env-cell",
			landblockId: "0xda55ffff",
		};
		const plan = portalPlan(
			[
				view("root", OUTDOOR, EXTERIOR, 0, 0),
				view("left", INDOOR, INTERIOR, 1, 1),
				view("right", secondIndoor, INTERIOR, 1, 1),
			],
			null,
		);
		const workload: PortalDrySceneWorkload = {
			scopes: [
				emptyScope(OUTDOOR),
				{
					...emptyScope(INDOOR),
					opaque: [{ batchKey: "shared-wall", preparationKey: "shared-wall" }],
				},
				{
					...emptyScope(secondIndoor),
					opaque: [{ batchKey: "shared-wall", preparationKey: "shared-wall" }],
				},
			],
		};

		const schedule = createPortalPathViewDrySchedule(plan, workload);

		expect(schedule.opaqueSubmissions).toEqual([
			{ batchKey: "shared-wall", destination: "ownership-label:1" },
		]);
		expect(schedule.trace.batchFormationInputCount).toBe(2);
		expect(schedule.trace.opaquePhysicalBatchCount).toBe(1);
		expect(schedule.trace.opaqueSubmissionCount).toBe(1);
	});

	it("exposes ownership-label draw expansion separately from physical opaque batches", () => {
		const plan = portalPlan(
			[
				view("root", OUTDOOR, EXTERIOR, 0, 0),
				view("first-appearance", INDOOR, INTERIOR, 1, 1),
				view("second-appearance", INDOOR, INTERIOR, 2, 2),
			],
			null,
		);
		const schedule = createPortalPathViewDrySchedule(plan, {
			scopes: [
				emptyScope(OUTDOOR),
				{
					...emptyScope(INDOOR),
					opaque: [{ batchKey: "wall", preparationKey: "physical-wall" }],
				},
			],
		});

		expect(schedule.trace.opaquePhysicalBatchCount).toBe(1);
		expect(schedule.trace.batchFormationInputCount).toBe(2);
		expect(schedule.trace.opaqueSubmissionCount).toBe(2);
	});

	it("fails loudly when a selected scope has no resolved workload", () => {
		const plan = portalPlan([view("root", OUTDOOR, EXTERIOR, 0, 0)], null);
		expect(() => createPortalPathViewDrySchedule(plan, { scopes: [] })).toThrow(
			"missing selected scope outdoor",
		);
	});
});

describe("createPortalArrivalStateDryScheduleTrace", () => {
	it("quotients reference paths while retaining physical batches and one upload stream", () => {
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

function portalPlan(
	views: readonly PortalPathView[],
	exteriorCacheDomainId: PortalContentDomainId | null = EXTERIOR,
): PortalPathViewPlan {
	return {
		contentDomainIds: [...new Set(views.map(({ domainId }) => domainId))],
		exteriorCacheDomainId,
		ownershipLabelCount:
			Math.max(...views.map(({ ownershipLabel }) => ownershipLabel)) + 1,
		topologyRevision: 1,
		trace: {
			anchorApertureVertexTransformCount: 0,
			attemptedCrossingCount: 0,
			conflictBoundsRejectedPairCount: 0,
			conflictFragmentPairCount: 0,
			conflictPairCount: 0,
			conflictPrimitiveCount: 0,
			conflictVertexEdgeTestCount: 0,
			constructedPathViewCount: views.length,
			nearClip: createEmptyCameraNearClipDiagnostics(),
			pathAncestryElementCopyCount: 0,
			pathIdentityTestCount: 0,
			peakCandidateFrontierCount: 0,
			peakRetainedPathViewCount: views.length,
			projection: createEmptyPortalWindowProjectionDiagnostics(),
			projectionPrimitiveCount: 0,
			topologyWorkItemCount: 0,
			topologyPreparation: {
				apertureCount: 0,
				canonicalOutgoingComparisonCount: 0,
				convexityVertexTestCount: 0,
				crossingCount: 0,
				duplicateApertureScalarComparisonCount: 0,
				mergeEdgePairTestCount: 0,
				scopeCount: 0,
				triangleCount: 0,
			},
		},
		truncation: null,
		views,
	};
}

function view(
	id: string,
	scope: SceneScope,
	domainId: PortalContentDomainId,
	pathDepth: number,
	ownershipLabel: number,
): PortalPathView {
	const window = createFullPortalViewWindow();
	return {
		bounds: new AABB2(new Vec2(-1, -1), new Vec2(1, 1)),
		crossingIds: [],
		domainId,
		id: `portal-path-view:${id}`,
		incomingCrossingId: pathDepth === 0 ? null : `portal-crossing:${id}`,
		ownershipLabel,
		parentViewId: pathDepth === 0 ? null : "portal-path-view:root",
		pathDepth,
		requiresOwnershipTransition: pathDepth > 0,
		scope,
		window,
	};
}
