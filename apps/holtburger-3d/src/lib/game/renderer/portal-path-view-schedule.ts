import { scopeKey } from "../scene/scope";
import type {
	PortalContentDomainId,
	PortalPathViewId,
	PortalPathViewPlan,
} from "./portal-path-view-planner";
import type { PortalRenderWorkPlan } from "./portal-render-graph";
import type { PortalScopeAtlasFrameView } from "./portal-scope-atlas-planner";
import {
	orderTransparentObjectRanges,
	type TransparentObjectOrderingTrace,
} from "./object-rendering-policy";

/** Stable resolved opaque compatibility consumed without rediscovering material policy. */
export interface PortalDryOpaqueBatch {
	/** Final renderer compatibility identity for one physical batch. */
	readonly batchKey: string;
	/** Physical preparation identity; repeated appearances must retain this value. */
	readonly preparationKey: string;
}

/** One physical transparent or additive submission prepared once per frame. */
export interface PortalDryDeferredSubmission {
	/** Final adjacent-run compatibility after blend/material/program policy resolution. */
	readonly batchKey: string;
	/** Squared camera distance consumed by the production bounded-band ordering policy. */
	readonly distanceSquared: number;
	/** Blend-order family already resolved by the renderer-neutral material planner. */
	readonly kind: "additive" | "transparent";
	/** Physical identity shared by every portal appearance of this source. */
	readonly submissionKey: string;
}

/** One live particle source before final mesh/motion recoalescing. */
export interface PortalDryParticleSource {
	/** Mesh and motion compatibility used by the final instanced draw. */
	readonly batchKey: string;
	/** Live instances copied into the packed frame stream. */
	readonly instanceCount: number;
	/** Physical emitter/source identity; portal appearances must not duplicate it. */
	readonly sourceKey: string;
}

/** Resolved physical contributions owned by one authored scene scope. */
interface PortalDryScopeWorkload {
	/** Deferred object ranges already classified and assigned sort facts. */
	readonly deferred: readonly PortalDryDeferredSubmission[];
	/** Opaque/alpha-test batches after ordinary compatibility coalescing. */
	readonly opaque: readonly PortalDryOpaqueBatch[];
	/** Live source cohorts before domain routing and final packing. */
	readonly particles: readonly PortalDryParticleSource[];
	/** Canonical scene scope key matching `scopeKey`. */
	readonly scopeKey: string;
}

/** Exact resolved scene workload paired with one completed visibility plan. */
export interface PortalDrySceneWorkload {
	/** Every selected physical scope exactly once; unselected resident scopes are excluded. */
	readonly scopes: readonly PortalDryScopeWorkload[];
}

/** One planner-owned opaque submission; the executor only iterates this array. */
interface PortalDryOpaqueSubmission {
	/** Final compatible batch. */
	readonly batchKey: string;
	/** Cache target or ownership label selecting the submission destination. */
	readonly destination: "exterior-cache" | `ownership-label:${number}`;
}

/** One scope envelope reduction over all retained appearances of that scope. */
interface PortalDryVisibilityEnvelope {
	/** Canonical scene scope key. */
	readonly scopeKey: string;
	/** Path appearances reduced into this one deferred visibility predicate. */
	readonly viewIds: readonly PortalPathViewId[];
}

/** Fully materialized CPU schedule consumed mechanically by the future executor. */
export interface PortalPathViewDrySchedule {
	/** Reusable domains whose selected scopes are resolved and prepared once. */
	readonly preparedDomainIds: readonly PortalContentDomainId[];
	/** Physical deferred submissions in final global execution order. */
	readonly deferredSubmissionKeys: readonly string[];
	/** Opaque submissions after label merging and exterior-cache selection. */
	readonly opaqueSubmissions: readonly PortalDryOpaqueSubmission[];
	/** Unweighted deterministic schedule construction and projected execution work. */
	readonly trace: PortalPathViewDryScheduleTrace;
	/** One completed deferred predicate per selected physical scope. */
	readonly visibilityEnvelopes: readonly PortalDryVisibilityEnvelope[];
}

/** Unweighted operation/allocation vector; no guessed CPU weights are embedded. */
export interface PortalPathViewDryScheduleTrace {
	/** Additive compatibility runs after grouped coalescing. */
	readonly additiveRunCount: number;
	/** Physical resolved batches inspected while forming opaque submissions. */
	readonly batchFormationInputCount: number;
	/** Exterior-cache appearance composites, zero when caching is not selected. */
	readonly compositeSubmissionCount: number;
	/** Reusable content-domain resolution/preparation operations. */
	readonly contentPreparationCount: number;
	/** Physical deferred submissions inspected once during deduplication. */
	readonly deferredPreparationInputCount: number;
	/** Target changes: main target plus an exterior cache target when selected. */
	readonly framebufferTargetCount: number;
	/** Child ownership transitions projected from retained path views. */
	readonly maskSubmissionCount: number;
	/** Final opaque/cache draw submissions. */
	readonly opaqueSubmissionCount: number;
	/** Unique selected physical opaque batches before ownership-destination expansion. */
	readonly opaquePhysicalBatchCount: number;
	/** Compatible final particle batches. */
	readonly particleBatchCount: number;
	/** Live particle instances copied into frame upload storage. */
	readonly particleInstancePackCount: number;
	/** Physical particle sources routed exactly once. */
	readonly particleSourceCount: number;
	/** Contiguous particle frame-stream uploads; zero or one for the selected population. */
	readonly particleUploadCount: number;
	/** Maximum retained cardinality among schedule-owned maps/arrays. */
	readonly peakLiveRecordCount: number;
	/** Physical selected scope queries, independent from appearance count. */
	readonly sceneResolutionCount: number;
	/** Selected scopes supplied across the domain-batched scene resolutions. */
	readonly sceneResolutionScopeInputCount: number;
	/** Stable cohort-key evaluations performed by transparent ordering. */
	readonly transparentBatchKeyEvaluationCount: number;
	/** Far/near classifications performed by transparent ordering. */
	readonly transparentDepthBandClassificationCount: number;
	/** Fixed bounded-band slots visited while emitting transparent work. */
	readonly transparentDepthBucketVisitCount: number;
	/** Square roots performed for near transparent candidates. */
	readonly transparentNearSquareRootCount: number;
	/** Adjacent compatible runs in globally ordered alpha submissions. */
	readonly transparentRunCount: number;
	/** Scope-appearance records reduced into visibility envelopes. */
	readonly visibilityEnvelopeInputCount: number;
	/** Completed visibility-envelope submissions. */
	readonly visibilitySubmissionCount: number;
}

/** Drawing-buffer facts used for exact conservative scope-atlas allocation accounting. */
export interface PortalArrivalStateDrawingBuffer {
	readonly height: number;
	readonly width: number;
}

/** Immutable offline snapshot of the production arena frame consumed by the dry scheduler. */
export interface PortalArrivalStateDryPlan {
	/** Fixed atlas pixel capacity backing every packed scope tile. */
	readonly atlasPixelCapacity: number;
	/** Exact command counts emitted by the production atlas planner. */
	readonly commands: Pick<
		PortalScopeAtlasFrameView["commands"],
		| "crossingInstancePreparationCount"
		| "frontierClearCommandCount"
		| "maskPropagationCommandCount"
		| "maskPropagationInstanceCount"
		| "opaqueCompositeCommandCount"
		| "opaqueCompositeInstanceCount"
		| "scopeEnvelopeReductionCommandCount"
		| "scopeEnvelopeReductionInstanceCount"
		| "traversalDepth"
	>;
	/** Canonical physical scopes retained by the production culler. */
	readonly selectedScopeKeys: readonly string[];
	/** Selected directed crossings encoded into arrival states. */
	readonly selectedCrossingCount: number;
	/** Sum of committed packed scope-tile areas, excluding atlas gaps. */
	readonly tilePixelCount: number;
}

/** Copy one non-retained production frame into an owned offline scheduling contract. */
export function snapshotPortalArrivalStateDryPlan(
	frame: PortalScopeAtlasFrameView,
): PortalArrivalStateDryPlan {
	const selectedScopeKeys = Array.from(
		{ length: frame.visibility.selectedScopeCount },
		(_, ordinal) => scopeKey(frame.visibility.selectedScope(ordinal)),
	);
	return Object.freeze({
		atlasPixelCapacity: frame.trace.atlasPixelCapacity,
		commands: Object.freeze({
			crossingInstancePreparationCount:
				frame.commands.crossingInstancePreparationCount,
			frontierClearCommandCount: frame.commands.frontierClearCommandCount,
			maskPropagationCommandCount: frame.commands.maskPropagationCommandCount,
			maskPropagationInstanceCount: frame.commands.maskPropagationInstanceCount,
			opaqueCompositeCommandCount: frame.commands.opaqueCompositeCommandCount,
			opaqueCompositeInstanceCount: frame.commands.opaqueCompositeInstanceCount,
			scopeEnvelopeReductionCommandCount:
				frame.commands.scopeEnvelopeReductionCommandCount,
			scopeEnvelopeReductionInstanceCount:
				frame.commands.scopeEnvelopeReductionInstanceCount,
			traversalDepth: frame.commands.traversalDepth,
		}),
		selectedCrossingCount: frame.visibility.selectedCrossingCount,
		selectedScopeKeys: Object.freeze(selectedScopeKeys),
		tilePixelCount: frame.trace.tilePixelCount,
	});
}

/** Structural schedule for the path-free arrival-state/scope-atlas candidate. */
export interface PortalArrivalStateDryScheduleTrace {
	/** Root plus one conservatively reserved state for each selected directed crossing. */
	readonly arrivalStateCount: number;
	/** Compatible additive runs over physical submissions. */
	readonly additiveRunCount: number;
	/** Unique physical opaque/alpha-test batches inspected once. */
	readonly batchFormationInputCount: number;
	/** One global selected-scope scene resolution and contribution-preparation pass. */
	readonly contentPreparationCount: number;
	/** Physical deferred submissions inspected once before global ordering. */
	readonly deferredPreparationInputCount: number;
	/** Shared full-screen nearest-crossing `DEPTH_COMPONENT24` plane. */
	readonly frontierDepthAttachmentBytes: number;
	/** Two ping-pong full-screen `R8UI` frontier-state planes. */
	readonly frontierStateAttachmentBytes: number;
	/** Four portal-owned framebuffers: scene, two frontiers, and envelope. */
	readonly framebufferTargetCount: number;
	/** Selected physical crossings encoded once into the reusable propagation batch. */
	readonly maskInstancePreparationCount: number;
	/** One batched propagation command per completed crossing frontier. */
	readonly maskPropagationCommandCount: number;
	/** GPU logical crossing instances; the same prepared batch is reused each frontier. */
	readonly maskPropagationInstanceCount: number;
	/** One explicit next-frontier clear before each batched portal propagation draw. */
	readonly nextFrontierClearCommandCount: number;
	/** One instanced resolve command for every non-empty scope layer. */
	readonly opaqueCompositeCommandCount: number;
	/** Scope-layer tiles resolved by the single opaque composite command. */
	readonly opaqueCompositeInstanceCount: number;
	/** Final physical opaque submissions; equal to the physical batch count. */
	readonly opaqueSubmissionCount: number;
	/** Compatible physical particle batches. */
	readonly particleBatchCount: number;
	/** Live particle instances copied into frame upload storage. */
	readonly particleInstancePackCount: number;
	/** Physical particle sources routed once. */
	readonly particleSourceCount: number;
	/** One contiguous upload when the selected physical particle population is non-empty. */
	readonly particleUploadCount: number;
	/** Exact fixed attachment bytes for the accepted drawing-buffer generation. */
	readonly portalTargetBytes: number;
	/** Physical selected scopes supplied to the one scene resolution. */
	readonly sceneResolutionScopeCount: number;
	/** Fixed atlas pixel capacity, including gaps between packed scope tiles. */
	readonly scopeAtlasPixelCapacity: number;
	/** Packed `RGBA8` color plus `DEPTH_COMPONENT24` local-depth bytes. */
	readonly scopeAtlasSceneAttachmentBytes: number;
	/** Sum of committed packed scope-tile areas, excluding atlas gaps. */
	readonly scopeAtlasTilePixelCount: number;
	/** Fixed atlas `DEPTH_COMPONENT32F` scope-envelope bytes. */
	readonly scopeAtlasVisibilityEnvelopeBytes: number;
	/** Completed authored-scope envelopes. */
	readonly scopeVisibilityEnvelopeCount: number;
	/** Arrival states reduced into the completed authored-scope envelopes. */
	readonly scopeVisibilityEnvelopeInputCount: number;
	/** One instanced scope-envelope reduction draw per completed crossing frontier. */
	readonly scopeVisibilityEnvelopeReductionCommandCount: number;
	/** GPU scope-tile instances evaluated across all completed frontiers. */
	readonly scopeVisibilityEnvelopeReductionInstanceCount: number;
	/** Stable cohort-key evaluations performed by transparent ordering. */
	readonly transparentBatchKeyEvaluationCount: number;
	/** Far/near classifications performed by transparent ordering. */
	readonly transparentDepthBandClassificationCount: number;
	/** Fixed bounded-band slots visited while emitting transparent work. */
	readonly transparentDepthBucketVisitCount: number;
	/** Square roots performed for near transparent candidates. */
	readonly transparentNearSquareRootCount: number;
	/** Adjacent compatible physical alpha runs after sorting. */
	readonly transparentRunCount: number;
	/** Selected physical crossings with a selected source scope. */
	readonly traversalCrossingCount: number;
	/** Proven propagation-round bound emitted by the production planner. */
	readonly traversalDepth: number;
}

/** Materialize arrival-state execution from a snapshot of the production scope-atlas plan. */
export function createPortalArrivalStateDryScheduleTrace(
	plan: PortalArrivalStateDryPlan,
	workload: PortalDrySceneWorkload,
	drawingBuffer: PortalArrivalStateDrawingBuffer,
): PortalArrivalStateDryScheduleTrace {
	validateDrawingBuffer(drawingBuffer);
	const workloadByScope = indexWorkload(workload);
	const selectedScopeKeys = new Set(plan.selectedScopeKeys);
	const selectedWorkloads = [...selectedScopeKeys].sort().map((key) => {
		const scope = workloadByScope.get(key);
		if (!scope) {
			throw new Error(
				`Portal arrival-state dry workload is missing selected scope ${key}.`,
			);
		}
		return scope;
	});
	const traversalCrossingCount = plan.selectedCrossingCount;
	const traversalDepth = plan.commands.traversalDepth;
	const opaquePhysicalBatchCount =
		uniqueOpaquePhysicalBatchCount(selectedWorkloads);
	const deferredInput = selectedWorkloads.flatMap((scope) => scope.deferred);
	const deferred = uniqueByKey(
		deferredInput,
		({ submissionKey }) => submissionKey,
		"arrival-state deferred submission",
	);
	const transparent = orderPhysicalTransparent(
		deferred.filter(({ kind }) => kind === "transparent"),
	);
	const additiveRunCount = new Set(
		deferred
			.filter(({ kind }) => kind === "additive")
			.map(({ batchKey }) => batchKey),
	).size;
	const particleInput = selectedWorkloads.flatMap((scope) => scope.particles);
	const particles = uniqueByKey(
		particleInput,
		({ sourceKey }) => sourceKey,
		"arrival-state particle source",
	);
	const particleBatchCount = new Set(particles.map(({ batchKey }) => batchKey))
		.size;
	const fullScreenPixelCount = drawingBuffer.width * drawingBuffer.height;
	const scopeAtlasSceneAttachmentBytes = plan.atlasPixelCapacity * 8;
	const scopeAtlasVisibilityEnvelopeBytes = plan.atlasPixelCapacity * 4;
	const frontierDepthAttachmentBytes = fullScreenPixelCount * 4;
	const frontierStateAttachmentBytes = fullScreenPixelCount * 2;
	return Object.freeze({
		additiveRunCount,
		arrivalStateCount: 1 + traversalCrossingCount,
		batchFormationInputCount: opaquePhysicalBatchCount,
		contentPreparationCount: 1,
		deferredPreparationInputCount: deferredInput.length,
		frontierDepthAttachmentBytes,
		frontierStateAttachmentBytes,
		framebufferTargetCount: 4,
		maskInstancePreparationCount:
			plan.commands.crossingInstancePreparationCount,
		maskPropagationCommandCount: plan.commands.maskPropagationCommandCount,
		maskPropagationInstanceCount: plan.commands.maskPropagationInstanceCount,
		nextFrontierClearCommandCount: plan.commands.frontierClearCommandCount,
		opaqueCompositeCommandCount: plan.commands.opaqueCompositeCommandCount,
		opaqueCompositeInstanceCount: plan.commands.opaqueCompositeInstanceCount,
		opaqueSubmissionCount: opaquePhysicalBatchCount,
		particleBatchCount,
		particleInstancePackCount: particles.reduce(
			(total, particle) => total + particle.instanceCount,
			0,
		),
		particleSourceCount: particles.length,
		particleUploadCount: hasLiveParticleInstances(particles) ? 1 : 0,
		portalTargetBytes:
			scopeAtlasSceneAttachmentBytes +
			scopeAtlasVisibilityEnvelopeBytes +
			frontierDepthAttachmentBytes +
			frontierStateAttachmentBytes,
		sceneResolutionScopeCount: selectedScopeKeys.size,
		scopeAtlasPixelCapacity: plan.atlasPixelCapacity,
		scopeAtlasSceneAttachmentBytes,
		scopeAtlasTilePixelCount: plan.tilePixelCount,
		scopeAtlasVisibilityEnvelopeBytes,
		scopeVisibilityEnvelopeCount: selectedScopeKeys.size,
		scopeVisibilityEnvelopeInputCount: 1 + traversalCrossingCount,
		scopeVisibilityEnvelopeReductionCommandCount:
			plan.commands.scopeEnvelopeReductionCommandCount,
		scopeVisibilityEnvelopeReductionInstanceCount:
			plan.commands.scopeEnvelopeReductionInstanceCount,
		transparentBatchKeyEvaluationCount:
			transparent.trace.batchKeyEvaluationCount,
		transparentDepthBandClassificationCount:
			transparent.trace.depthBandClassificationCount,
		transparentDepthBucketVisitCount: transparent.trace.depthBucketVisitCount,
		transparentNearSquareRootCount: transparent.trace.nearSquareRootCount,
		transparentRunCount: adjacentRunCount(
			transparent.values.map(({ batchKey }) => batchKey),
		),
		traversalCrossingCount,
		traversalDepth,
	});
}

/** Complete execution policy from planner facts plus already-resolved physical content facts. */
export function createPortalPathViewDrySchedule(
	plan: PortalPathViewPlan,
	workload: PortalDrySceneWorkload,
): PortalPathViewDrySchedule {
	const workloadByScope = indexWorkload(workload);
	const selectedScopeKeys = new Set(
		plan.views.map(({ scope }) => scopeKey(scope)),
	);
	for (const selectedScopeKey of selectedScopeKeys) {
		if (!workloadByScope.has(selectedScopeKey)) {
			throw new Error(
				`Portal dry workload is missing selected scope ${selectedScopeKey}.`,
			);
		}
	}
	const selectedWorkloads = [...selectedScopeKeys]
		.sort()
		.map((key) => workloadByScope.get(key)!);
	const envelopes = createEnvelopes(plan);
	const opaque = createOpaqueSubmissions(plan, selectedWorkloads);
	const deferredInput = selectedWorkloads.flatMap((scope) => scope.deferred);
	const deferredByKey = uniqueByKey(
		deferredInput,
		({ submissionKey }) => submissionKey,
		"deferred submission",
	);
	const transparent = deferredByKey.filter(
		({ kind }) => kind === "transparent",
	);
	const additive = deferredByKey.filter(({ kind }) => kind === "additive");
	const orderedTransparent = orderPhysicalTransparent(transparent);
	const particlesInput = selectedWorkloads.flatMap((scope) => scope.particles);
	const particles = uniqueByKey(
		particlesInput,
		({ sourceKey }) => sourceKey,
		"particle source",
	);
	const particleBatchKeys = new Set(particles.map(({ batchKey }) => batchKey));
	const opaquePhysicalBatchCount =
		uniqueOpaquePhysicalBatchCount(selectedWorkloads);
	const transparentRunCount = adjacentRunCount(
		orderedTransparent.values.map(({ batchKey }) => batchKey),
	);
	const additiveRunCount = new Set(additive.map(({ batchKey }) => batchKey))
		.size;
	const trace: PortalPathViewDryScheduleTrace = Object.freeze({
		additiveRunCount,
		batchFormationInputCount: opaque.inputCount,
		compositeSubmissionCount: opaque.compositeCount,
		contentPreparationCount: plan.contentDomainIds.length,
		deferredPreparationInputCount: deferredInput.length,
		framebufferTargetCount: plan.exteriorCacheDomainId === null ? 1 : 2,
		maskSubmissionCount: plan.views.filter(
			({ requiresOwnershipTransition }) => requiresOwnershipTransition,
		).length,
		opaqueSubmissionCount: opaque.submissions.length,
		opaquePhysicalBatchCount,
		particleBatchCount: particleBatchKeys.size,
		particleInstancePackCount: particles.reduce(
			(total, source) => total + source.instanceCount,
			0,
		),
		particleSourceCount: particles.length,
		particleUploadCount: hasLiveParticleInstances(particles) ? 1 : 0,
		peakLiveRecordCount: Math.max(
			workloadByScope.size,
			opaque.submissions.length,
			deferredByKey.length,
			particles.length,
			envelopes.length,
		),
		sceneResolutionCount: plan.contentDomainIds.length,
		sceneResolutionScopeInputCount: selectedScopeKeys.size,
		transparentBatchKeyEvaluationCount:
			orderedTransparent.trace.batchKeyEvaluationCount,
		transparentDepthBandClassificationCount:
			orderedTransparent.trace.depthBandClassificationCount,
		transparentDepthBucketVisitCount:
			orderedTransparent.trace.depthBucketVisitCount,
		transparentNearSquareRootCount:
			orderedTransparent.trace.nearSquareRootCount,
		transparentRunCount,
		visibilityEnvelopeInputCount: plan.views.length,
		visibilitySubmissionCount: envelopes.length,
	});
	return Object.freeze({
		deferredSubmissionKeys: Object.freeze([
			...orderedTransparent.values.map(({ submissionKey }) => submissionKey),
			...additive
				.toSorted((left, right) =>
					left.submissionKey.localeCompare(right.submissionKey),
				)
				.map(({ submissionKey }) => submissionKey),
		]),
		opaqueSubmissions: Object.freeze(opaque.submissions),
		preparedDomainIds: plan.contentDomainIds,
		trace,
		visibilityEnvelopes: Object.freeze(envelopes),
	});
}

/** Trace the current domain-owned render-layer schedule over the identical resolved workload. */
export function createCurrentPortalDryScheduleTrace(
	plan: PortalRenderWorkPlan,
	workload: PortalDrySceneWorkload,
): PortalPathViewDryScheduleTrace {
	const workloadByScope = indexWorkload(workload);
	const nodeScopes = new Map(
		plan.nodes.map((node) => [
			node.id,
			node.scopes.map((scope) => {
				const workload = workloadByScope.get(scopeKey(scope));
				if (!workload) {
					throw new Error(
						`Current portal dry workload is missing scope ${scopeKey(scope)}.`,
					);
				}
				return workload;
			}),
		]),
	);
	const groups: (readonly PortalDryScopeWorkload[])[] = [];
	let maskSubmissionCount = 0;
	for (const layer of plan.renderLayers) {
		for (const contribution of layer.contributions) {
			maskSubmissionCount += contribution.maskEdgeIds.length;
			if (contribution.kind === "indoor") {
				groups.push(
					contribution.renderNodeIds.flatMap((id) =>
						requireNodeScopes(nodeScopes, id),
					),
				);
				continue;
			}
			groups.push(requireNodeScopes(nodeScopes, contribution.outdoorNodeId));
			if (contribution.suffix) {
				maskSubmissionCount += contribution.suffix.maskEdgeIds.length;
				groups.push(
					contribution.suffix.submissions.flatMap(({ renderNodeIds }) =>
						renderNodeIds.flatMap((id) => requireNodeScopes(nodeScopes, id)),
					),
				);
			}
		}
	}
	let additiveRunCount = 0;
	let batchFormationInputCount = 0;
	let deferredPreparationInputCount = 0;
	let opaqueSubmissionCount = 0;
	let particleUploadCount = 0;
	let transparentBatchKeyEvaluationCount = 0;
	let transparentDepthBandClassificationCount = 0;
	let transparentDepthBucketVisitCount = 0;
	let transparentNearSquareRootCount = 0;
	let transparentRunCount = 0;
	let peakLiveRecordCount = nodeScopes.size;
	for (const group of groups) {
		const opaque = group.flatMap((scope) => scope.opaque);
		batchFormationInputCount += opaque.length;
		opaqueSubmissionCount += new Set(
			opaque.map(
				({ batchKey, preparationKey }) => `${batchKey}\0${preparationKey}`,
			),
		).size;
		const deferredInput = group.flatMap((scope) => scope.deferred);
		deferredPreparationInputCount += deferredInput.length;
		const deferred = uniqueByKey(
			deferredInput,
			({ submissionKey }) => submissionKey,
			"current deferred submission",
		);
		const ordered = orderPhysicalTransparent(
			deferred.filter(({ kind }) => kind === "transparent"),
		);
		transparentBatchKeyEvaluationCount += ordered.trace.batchKeyEvaluationCount;
		transparentDepthBandClassificationCount +=
			ordered.trace.depthBandClassificationCount;
		transparentDepthBucketVisitCount += ordered.trace.depthBucketVisitCount;
		transparentNearSquareRootCount += ordered.trace.nearSquareRootCount;
		transparentRunCount += adjacentRunCount(
			ordered.values.map(({ batchKey }) => batchKey),
		);
		additiveRunCount += new Set(
			deferred
				.filter(({ kind }) => kind === "additive")
				.map(({ batchKey }) => batchKey),
		).size;
		const particles = uniqueByKey(
			group.flatMap((scope) => scope.particles),
			({ sourceKey }) => sourceKey,
			"current particle source",
		);
		if (hasLiveParticleInstances(particles)) particleUploadCount += 1;
		peakLiveRecordCount = Math.max(
			peakLiveRecordCount,
			opaque.length,
			deferred.length,
			particles.length,
		);
	}
	const selectedScopes = [
		...new Set(plan.nodes.flatMap(({ scopes }) => scopes.map(scopeKey))),
	];
	const selectedWorkloads = selectedScopes.map(
		(key) => workloadByScope.get(key)!,
	);
	const particleSources = uniqueByKey(
		selectedWorkloads.flatMap((scope) => scope.particles),
		({ sourceKey }) => sourceKey,
		"current selected particle source",
	);
	return Object.freeze({
		additiveRunCount,
		batchFormationInputCount,
		compositeSubmissionCount: 0,
		contentPreparationCount: plan.nodes.length,
		deferredPreparationInputCount,
		framebufferTargetCount: 1,
		maskSubmissionCount,
		opaqueSubmissionCount,
		opaquePhysicalBatchCount: uniqueOpaquePhysicalBatchCount(selectedWorkloads),
		particleBatchCount: new Set(particleSources.map(({ batchKey }) => batchKey))
			.size,
		particleInstancePackCount: particleSources.reduce(
			(total, source) => total + source.instanceCount,
			0,
		),
		particleSourceCount: particleSources.length,
		particleUploadCount,
		peakLiveRecordCount,
		sceneResolutionCount: plan.nodes.length,
		sceneResolutionScopeInputCount: selectedScopes.length,
		transparentBatchKeyEvaluationCount,
		transparentDepthBandClassificationCount,
		transparentDepthBucketVisitCount,
		transparentNearSquareRootCount,
		transparentRunCount,
		visibilityEnvelopeInputCount: 0,
		visibilitySubmissionCount: 0,
	});
}

function uniqueOpaquePhysicalBatchCount(
	workloads: readonly PortalDryScopeWorkload[],
): number {
	return new Set(
		workloads.flatMap((scope) =>
			scope.opaque.map(
				({ batchKey, preparationKey }) => `${preparationKey}\0${batchKey}`,
			),
		),
	).size;
}

function hasLiveParticleInstances(
	sources: readonly PortalDryParticleSource[],
): boolean {
	return sources.some(({ instanceCount }) => instanceCount > 0);
}

function requireNodeScopes(
	byNode: ReadonlyMap<string, readonly PortalDryScopeWorkload[]>,
	nodeId: string,
): readonly PortalDryScopeWorkload[] {
	const scopes = byNode.get(nodeId);
	if (!scopes)
		throw new Error(`Current portal dry schedule lost node ${nodeId}.`);
	return scopes;
}

function indexWorkload(
	workload: PortalDrySceneWorkload,
): ReadonlyMap<string, PortalDryScopeWorkload> {
	const byScope = new Map<string, PortalDryScopeWorkload>();
	for (const scope of workload.scopes) {
		if (byScope.has(scope.scopeKey)) {
			throw new Error(`Portal dry workload repeats scope ${scope.scopeKey}.`);
		}
		for (const deferred of scope.deferred) {
			if (
				deferred.kind === "transparent" &&
				(!Number.isFinite(deferred.distanceSquared) ||
					deferred.distanceSquared < 0)
			) {
				throw new Error(
					`Transparent submission ${deferred.submissionKey} has invalid squared camera distance.`,
				);
			}
		}
		for (const particle of scope.particles) {
			if (
				!Number.isSafeInteger(particle.instanceCount) ||
				particle.instanceCount < 0
			) {
				throw new Error(
					`Particle source ${particle.sourceKey} has invalid instance count.`,
				);
			}
		}
		byScope.set(scope.scopeKey, scope);
	}
	return byScope;
}

function createEnvelopes(
	plan: PortalPathViewPlan,
): PortalDryVisibilityEnvelope[] {
	const viewIdsByScope = new Map<string, PortalPathViewId[]>();
	for (const view of plan.views) {
		const key = scopeKey(view.scope);
		const viewIds = viewIdsByScope.get(key) ?? [];
		viewIds.push(view.id);
		viewIdsByScope.set(key, viewIds);
	}
	return [...viewIdsByScope]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, viewIds]) =>
			Object.freeze({ scopeKey: key, viewIds: Object.freeze(viewIds) }),
		);
}

function createOpaqueSubmissions(
	plan: PortalPathViewPlan,
	workloads: readonly PortalDryScopeWorkload[],
): {
	readonly compositeCount: number;
	readonly inputCount: number;
	readonly submissions: readonly PortalDryOpaqueSubmission[];
} {
	const workloadByScope = new Map(
		workloads.map((scope) => [scope.scopeKey, scope]),
	);
	const destinationsByScope = new Map<
		string,
		Set<PortalDryOpaqueSubmission["destination"]>
	>();
	let compositeCount = 0;
	for (const view of plan.views) {
		const key = scopeKey(view.scope);
		const destinations = destinationsByScope.get(key) ?? new Set();
		if (view.domainId === plan.exteriorCacheDomainId) {
			destinations.add("exterior-cache");
			compositeCount += 1;
		} else {
			destinations.add(`ownership-label:${view.ownershipLabel}`);
		}
		destinationsByScope.set(key, destinations);
	}
	const keys = new Set<string>();
	const submissions: PortalDryOpaqueSubmission[] = [];
	let inputCount = 0;
	for (const [scope, destinations] of [...destinationsByScope].sort(
		([left], [right]) => left.localeCompare(right),
	)) {
		const workload = workloadByScope.get(scope);
		if (!workload)
			throw new Error(`Portal opaque schedule lost scope ${scope}.`);
		for (const batch of workload.opaque) {
			for (const destination of [...destinations].sort()) {
				inputCount += 1;
				const key = `${destination}\0${batch.batchKey}\0${batch.preparationKey}`;
				if (keys.has(key)) continue;
				keys.add(key);
				submissions.push({ batchKey: batch.batchKey, destination });
			}
		}
	}
	return {
		compositeCount,
		inputCount,
		submissions: submissions.sort(
			(left, right) =>
				(left.destination === "exterior-cache" ? -1 : 0) -
					(right.destination === "exterior-cache" ? -1 : 0) ||
				left.destination.localeCompare(right.destination) ||
				left.batchKey.localeCompare(right.batchKey),
		),
	};
}

function validateDrawingBuffer(
	drawingBuffer: PortalArrivalStateDrawingBuffer,
): void {
	if (
		!Number.isSafeInteger(drawingBuffer.width) ||
		drawingBuffer.width <= 0 ||
		!Number.isSafeInteger(drawingBuffer.height) ||
		drawingBuffer.height <= 0
	) {
		throw new Error(
			"Portal arrival-state drawing-buffer dimensions must be positive safe integers.",
		);
	}
}

function uniqueByKey<Value>(
	values: readonly Value[],
	keyFor: (value: Value) => string,
	label: string,
): Value[] {
	const byKey = new Map<string, Value>();
	for (const value of values) {
		const key = keyFor(value);
		if (byKey.has(key)) continue;
		if (key.length === 0)
			throw new Error(`Portal ${label} identity must not be empty.`);
		byKey.set(key, value);
	}
	return [...byKey.values()];
}

function orderPhysicalTransparent(
	values: readonly PortalDryDeferredSubmission[],
): {
	readonly trace: TransparentObjectOrderingTrace;
	readonly values: readonly PortalDryDeferredSubmission[];
} {
	const ordered = orderTransparentObjectRanges(
		values.map((range) => ({
			distanceSquared: range.distanceSquared,
			range,
		})),
		({ batchKey }) => batchKey,
	);
	return {
		trace: ordered.trace,
		values: [
			...ordered.far.map(({ range }) => range),
			...ordered.near.map(({ range }) => range),
		],
	};
}

function adjacentRunCount(keys: readonly string[]): number {
	let count = 0;
	let previous: string | null = null;
	for (const key of keys) {
		if (key !== previous) count += 1;
		previous = key;
	}
	return count;
}
