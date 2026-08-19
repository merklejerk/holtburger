import { scopeKey } from "../scene/scope";
import type { PortalScopeAtlasFrameView } from "./portal-scope-atlas-planner";
import {
	orderTransparentObjectRanges,
	type TransparentObjectOrderingTrace,
} from "./object-rendering-policy";

/** Stable resolved opaque compatibility consumed without rediscovering material policy. */
export interface PortalDryOpaqueBatch {
	/** Final renderer compatibility identity for one physical batch. */
	readonly batchKey: string;
	/** Production submission pass; terrain routes once while objects route by authored scope. */
	readonly kind: "object" | "terrain";
	/** Physical preparation identity; repeated appearances must retain this value. */
	readonly preparationKey: string;
}

/** One physical transparent or additive submission prepared once per frame. */
export interface PortalDryDeferredSubmission {
	/** Final adjacent-run compatibility after blend/material/program policy resolution. */
	readonly batchKey: string;
	/** Signed distance along the camera's forward axis used for nearby ordering. */
	readonly cameraDepth: number;
	/** Squared radial camera distance used to select nearby ordering. */
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
	/** Live emitter slot ranges before domain routing. */
	readonly particles: readonly PortalDryParticleSource[];
	/** Canonical scene scope key matching `scopeKey`. */
	readonly scopeKey: string;
}

/** Exact resolved scene workload paired with one completed visibility plan. */
export interface PortalDrySceneWorkload {
	/** Every selected physical scope exactly once; unselected resident scopes are excluded. */
	readonly scopes: readonly PortalDryScopeWorkload[];
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
	/** Render-domain tile ordinal aligned with each selected authored scope. */
	readonly selectedScopeRenderDomainOrdinals: readonly number[];
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
		selectedScopeRenderDomainOrdinals: Object.freeze(
			selectedScopeKeys.map((_, ordinal) =>
				frame.visibility.selectedScopeRenderDomainOrdinal(ordinal),
			),
		),
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
	/** First object scope plus adjacent authored-scope changes in final physical opaque order. */
	readonly opaqueAuthoredScopeTransitionCount: number;
	/** Tile resolutions after terrain-pass and adjacent authored-object scope reuse. */
	readonly opaqueTileResolutionCount: number;
	/** First packed domain plus adjacent domain changes across terrain and opaque objects. */
	readonly opaqueRenderDomainTransitionCount: number;
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
	/** Stable cohort-key evaluations performed for far transparent batching. */
	readonly transparentFarBatchKeyEvaluationCount: number;
	/** Far/near classifications performed by transparent ordering. */
	readonly transparentDistanceClassificationCount: number;
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
	if (
		plan.selectedScopeRenderDomainOrdinals.length !==
		plan.selectedScopeKeys.length
	) {
		throw new Error(
			"Portal arrival-state dry plan scope and render-domain counts differ.",
		);
	}
	const selectedWorkloads = plan.selectedScopeKeys.map((key, ordinal) => {
		const scope = workloadByScope.get(key);
		if (!scope) {
			throw new Error(
				`Portal arrival-state dry workload is missing selected scope ${key}.`,
			);
		}
		const renderDomainOrdinal = plan.selectedScopeRenderDomainOrdinals[ordinal];
		if (
			renderDomainOrdinal === undefined ||
			!Number.isSafeInteger(renderDomainOrdinal) ||
			renderDomainOrdinal < 0
		) {
			throw new Error(
				`Portal arrival-state dry scope ${key} has an invalid render domain.`,
			);
		}
		return { renderDomainOrdinal, workload: scope };
	});
	const orderedWorkloads = selectedWorkloads.map(({ workload }) => workload);
	const traversalCrossingCount = plan.selectedCrossingCount;
	const traversalDepth = plan.commands.traversalDepth;
	const opaquePhysicalBatchCount =
		uniqueOpaquePhysicalBatchCount(orderedWorkloads);
	const opaqueRouting = traceOpaqueRouting(selectedWorkloads);
	const deferredInput = orderedWorkloads.flatMap((scope) => scope.deferred);
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
	const particleInput = orderedWorkloads.flatMap((scope) => scope.particles);
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
		opaqueAuthoredScopeTransitionCount:
			opaqueRouting.authoredScopeTransitionCount,
		opaqueRenderDomainTransitionCount:
			opaqueRouting.renderDomainTransitionCount,
		opaqueTileResolutionCount: opaqueRouting.tileResolutionCount,
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
		transparentDistanceClassificationCount:
			transparent.trace.distanceClassificationCount,
		transparentFarBatchKeyEvaluationCount:
			transparent.trace.farBatchKeyEvaluationCount,
		transparentRunCount: adjacentRunCount(
			transparent.values.map(({ batchKey }) => batchKey),
		),
		traversalCrossingCount,
		traversalDepth,
	});
}

function traceOpaqueRouting(
	selected: readonly {
		readonly renderDomainOrdinal: number;
		readonly workload: PortalDryScopeWorkload;
	}[],
): {
	readonly authoredScopeTransitionCount: number;
	readonly renderDomainTransitionCount: number;
	readonly tileResolutionCount: number;
} {
	let activeRenderDomainOrdinal = -1;
	let authoredScopeTransitionCount = 0;
	let renderDomainTransitionCount = 0;
	let tileResolutionCount = 0;
	const outdoor = selected.find(
		({ workload }) => workload.scopeKey === "outdoor",
	);
	if (outdoor?.workload.opaque.some(({ kind }) => kind === "terrain")) {
		activeRenderDomainOrdinal = outdoor.renderDomainOrdinal;
		renderDomainTransitionCount += 1;
		tileResolutionCount += 1;
	}
	for (const { renderDomainOrdinal, workload } of selected) {
		if (!workload.opaque.some(({ kind }) => kind === "object")) continue;
		// Scene selection is scope-contiguous, and opaque instance grouping includes render scope in
		// its compatibility key. One selected scope therefore remains one adjacent routing run.
		authoredScopeTransitionCount += 1;
		tileResolutionCount += 1;
		if (activeRenderDomainOrdinal !== renderDomainOrdinal) {
			activeRenderDomainOrdinal = renderDomainOrdinal;
			renderDomainTransitionCount += 1;
		}
	}
	return {
		authoredScopeTransitionCount,
		renderDomainTransitionCount,
		tileResolutionCount,
	};
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
			stableId: range.submissionKey,
		})),
		({ batchKey }) => batchKey,
		({ cameraDepth }) => cameraDepth,
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
