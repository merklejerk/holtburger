import {
	portalModelFootprintCardinality,
	type PortalModelBatchId,
	type PortalModelDomainId,
	type PortalModelFragment,
	type PortalModelFragmentId,
	type PortalModelScene,
	type PortalModelScopeId,
	type PortalModelSubmissionId,
} from "./portal-model";
import { allocatePortalViewLabels } from "./portal-ownership-executor";
import type {
	PortalReferenceFrame,
	PortalReferencePath,
} from "./portal-reference-compositor";
import {
	createPortalPotentialViewPlan,
	type PortalPotentialView,
	type PortalPotentialViewPlan,
} from "./portal-potential-view-plan";

/** RGBA8 color plus DEPTH24_STENCIL8 depth/stencil in the abstract target contract. */
const PORTAL_MODEL_COLOR_DEPTH_BYTES_PER_PIXEL = 8;

/** One R32F exit-depth sample per path-specific scope segment. */
const PORTAL_MODEL_VISIBILITY_BYTES_PER_PIXEL = 4;

export type PortalExecutorFamily =
	| "exterior-cache-view-stencil"
	| "recursive-offscreen-atlas"
	| "shared-view-stencil-replay";

/** Frontend-owned identity needed to constrain first-cut caching to the expensive exterior. */
export interface PortalExecutorCostInput {
	/** Exact exterior content domain, or null when this frame has no cache candidate. */
	readonly exteriorDomainId: PortalModelDomainId | null;
}

/** Exact symbolic work vector; no field is collapsed into a guessed weighted score. */
interface PortalExecutorCostVector {
	readonly additiveRunCount: number;
	readonly attachmentReadWritePixelCount: number;
	readonly colorDepthTargetBytes: number;
	readonly compositeDrawCount: number;
	readonly contentPreparationCount: number;
	readonly framebufferChangeCount: number;
	readonly maskDrawCount: number;
	readonly offscreenTargetCount: number;
	readonly opaqueDrawBatchCount: number;
	readonly orderedTransparentRunCount: number;
	readonly ownershipLabelCount: number;
	readonly particleDrawBatchCount: number;
	readonly particleUploadCount: number;
	readonly repeatedContentPreparationCount: number;
	readonly resetPixelCount: number;
	readonly topologyWorkItemCount: number;
	readonly visibilityAttachmentBytes: number;
	readonly visibilityAttachmentCount: number;
	readonly visibilitySubmissionCount: number;
}

/** One correct executor family paired with its auditable structural work. */
export interface PortalExecutorCostCandidate {
	readonly family: PortalExecutorFamily;
	readonly cachedDomainIds: readonly PortalModelDomainId[];
	readonly cost: PortalExecutorCostVector;
}

interface CostIndex {
	readonly fragmentById: ReadonlyMap<
		PortalModelFragmentId,
		PortalModelFragment
	>;
	readonly scopeCountByDomain: ReadonlyMap<PortalModelDomainId, number>;
}

interface DeferredOccurrence {
	readonly batchId: PortalModelBatchId;
	readonly depth: number;
	readonly kind: "additive" | "alpha" | "particle-additive" | "particle-alpha";
	readonly paths: readonly PortalReferencePath[];
	readonly scopeId: PortalModelScopeId;
	readonly submissionId: PortalModelSubmissionId;
}

interface DeferredReplayCost {
	readonly additiveRunCount: number;
	readonly maskDrawCount: number;
	readonly orderedTransparentRunCount: number;
	readonly particleDrawBatchCount: number;
	readonly runCount: number;
}

/** Compare correct scheduling families over one completed symbolic reference frame. */
export function costPortalExecutorFamilies(
	scene: PortalModelScene,
	frame: PortalReferenceFrame,
	input: PortalExecutorCostInput,
): readonly PortalExecutorCostCandidate[] {
	const index = indexScene(scene);
	const potentialPlan = createPortalPotentialViewPlan(scene);
	const labelsByViewId = allocatePortalViewLabels(potentialPlan);
	const deferred = collectDeferredOccurrences(frame, index);
	const cachedDomainIds = exteriorCacheDomainIds(
		scene,
		potentialPlan,
		index,
		input,
	);
	const common = commonCost(scene, potentialPlan, deferred);
	const visibilityEnvelopeDrawCount = potentialPlan.views.length;
	const visibilityEnvelopeWritePixels = potentialPlan.views.reduce(
		(total, view) => total + portalModelFootprintCardinality(view.coverage),
		0,
	);
	const childViews = potentialPlan.views.filter(
		({ parentViewId }) => parentViewId !== null,
	);
	const childCoveragePixels = coveredViewPixels(childViews);
	const recursiveTargetCount = potentialPlan.maximumPathLength + 1;
	const recursiveOpaqueDrawBatchCount = opaqueBatchCountByView(
		scene,
		potentialPlan.views,
	);
	const recursive: PortalExecutorCostCandidate = Object.freeze({
		cachedDomainIds: Object.freeze([]),
		cost: Object.freeze({
			...common,
			attachmentReadWritePixelCount:
				common.attachmentReadWritePixelCount +
				visibilityEnvelopeWritePixels +
				childCoveragePixels * 2,
			colorDepthTargetBytes:
				recursiveTargetCount *
				scene.pixelCount *
				PORTAL_MODEL_COLOR_DEPTH_BYTES_PER_PIXEL,
			compositeDrawCount: childViews.length,
			framebufferChangeCount: potentialPlan.views.length + childViews.length,
			maskDrawCount: childViews.length + visibilityEnvelopeDrawCount,
			offscreenTargetCount: recursiveTargetCount,
			opaqueDrawBatchCount: recursiveOpaqueDrawBatchCount,
			resetPixelCount: childCoveragePixels,
		}),
		family: "recursive-offscreen-atlas",
	});
	const replay = deferredReplayCost(deferred);
	const sharedStencil: PortalExecutorCostCandidate = Object.freeze({
		cachedDomainIds: Object.freeze([]),
		cost: Object.freeze({
			...common,
			attachmentReadWritePixelCount:
				common.attachmentReadWritePixelCount +
				childCoveragePixels +
				replay.maskDrawCount * scene.pixelCount,
			additiveRunCount: replay.additiveRunCount,
			colorDepthTargetBytes:
				scene.pixelCount * PORTAL_MODEL_COLOR_DEPTH_BYTES_PER_PIXEL,
			compositeDrawCount: 0,
			framebufferChangeCount: 1,
			maskDrawCount: childViews.length + replay.maskDrawCount,
			offscreenTargetCount: 1,
			opaqueDrawBatchCount: opaqueBatchCountByLabel(
				scene,
				potentialPlan.views,
				labelsByViewId,
			),
			orderedTransparentRunCount: replay.orderedTransparentRunCount,
			ownershipLabelCount: new Set(labelsByViewId.values()).size,
			particleDrawBatchCount: replay.particleDrawBatchCount,
			resetPixelCount: childCoveragePixels + replay.runCount * scene.pixelCount,
			visibilityAttachmentBytes: 0,
			visibilityAttachmentCount: 0,
		}),
		family: "shared-view-stencil-replay",
	});
	const cachedDomainSet = new Set(cachedDomainIds);
	const exteriorCacheOpaqueDrawBatchCount =
		opaqueBatchCountByLabel(
			scene,
			potentialPlan.views.filter(
				({ domainId }) => !cachedDomainSet.has(domainId),
			),
			labelsByViewId,
		) + opaqueBatchCountByDomain(scene, cachedDomainIds);
	const cachedAppearanceCount = potentialPlan.views.filter(({ domainId }) =>
		cachedDomainSet.has(domainId),
	).length;
	const cachedAppearancePixels = coveredViewPixels(
		potentialPlan.views.filter(({ domainId }) => cachedDomainSet.has(domainId)),
	);
	const exteriorCacheTargetCount = 1 + cachedDomainIds.length;
	const exteriorCache: PortalExecutorCostCandidate = Object.freeze({
		cachedDomainIds: Object.freeze(cachedDomainIds),
		cost: Object.freeze({
			...common,
			attachmentReadWritePixelCount:
				common.attachmentReadWritePixelCount +
				visibilityEnvelopeWritePixels +
				cachedAppearancePixels * 2,
			colorDepthTargetBytes:
				exteriorCacheTargetCount *
				scene.pixelCount *
				PORTAL_MODEL_COLOR_DEPTH_BYTES_PER_PIXEL,
			compositeDrawCount: cachedAppearanceCount,
			framebufferChangeCount: 1 + cachedDomainIds.length,
			maskDrawCount: childViews.length + visibilityEnvelopeDrawCount,
			offscreenTargetCount: exteriorCacheTargetCount,
			opaqueDrawBatchCount: exteriorCacheOpaqueDrawBatchCount,
			ownershipLabelCount: new Set(labelsByViewId.values()).size,
			resetPixelCount: childCoveragePixels,
		}),
		family: "exterior-cache-view-stencil",
	});
	return Object.freeze([recursive, sharedStencil, exteriorCache]);
}

function exteriorCacheDomainIds(
	scene: PortalModelScene,
	plan: PortalPotentialViewPlan,
	index: CostIndex,
	input: PortalExecutorCostInput,
): readonly PortalModelDomainId[] {
	const exteriorDomainId = input.exteriorDomainId;
	if (exteriorDomainId === null) return Object.freeze([]);
	const scopeCount = index.scopeCountByDomain.get(exteriorDomainId);
	if (scopeCount === undefined) {
		throw new Error(`Missing exterior cache domain ${exteriorDomainId}.`);
	}
	if (scopeCount !== 1) {
		throw new Error(
			`Exterior cache domain ${exteriorDomainId} must own exactly one scope; found ${scopeCount}.`,
		);
	}
	const appearanceCount = plan.views.filter(
		({ domainId }) => domainId === exteriorDomainId,
	).length;
	const opaqueBatchCount = opaqueBatchCountByDomain(scene, [exteriorDomainId]);
	return appearanceCount > 1 && opaqueBatchCount > 0
		? Object.freeze([exteriorDomainId])
		: Object.freeze([]);
}

function commonCost(
	scene: PortalModelScene,
	potentialPlan: PortalPotentialViewPlan,
	deferred: readonly DeferredOccurrence[],
): PortalExecutorCostVector {
	const alpha = deferred
		.filter(({ kind }) => kind === "alpha" || kind === "particle-alpha")
		.sort((left, right) => right.depth - left.depth);
	const additive = deferred.filter(
		({ kind }) => kind === "additive" || kind === "particle-additive",
	);
	const particle = deferred.filter(({ kind }) => kind.startsWith("particle-"));
	const contentDomainIds = new Set(
		potentialPlan.views.map(({ domainId }) => domainId),
	);
	return {
		additiveRunCount: compatibleRunCount(additive, false, false),
		attachmentReadWritePixelCount: 0,
		colorDepthTargetBytes: 0,
		compositeDrawCount: 0,
		contentPreparationCount: contentDomainIds.size,
		framebufferChangeCount: 0,
		maskDrawCount: 0,
		offscreenTargetCount: 0,
		opaqueDrawBatchCount: 0,
		orderedTransparentRunCount: compatibleRunCount(alpha, true, false),
		ownershipLabelCount: 0,
		particleDrawBatchCount: compatibleRunCount(particle, false, false),
		particleUploadCount: new Set(
			particle.map(({ submissionId }) => submissionId),
		).size,
		repeatedContentPreparationCount: 0,
		resetPixelCount: 0,
		topologyWorkItemCount: potentialPlan.raySegmentCount,
		visibilityAttachmentBytes:
			new Set(potentialPlan.views.map(({ scopeId }) => scopeId)).size *
			scene.pixelCount *
			PORTAL_MODEL_VISIBILITY_BYTES_PER_PIXEL,
		visibilityAttachmentCount: new Set(
			potentialPlan.views.map(({ scopeId }) => scopeId),
		).size,
		visibilitySubmissionCount: potentialPlan.views.length,
	};
}

function collectDeferredOccurrences(
	frame: PortalReferenceFrame,
	index: CostIndex,
): DeferredOccurrence[] {
	const occurrenceByKey = new Map<string, DeferredOccurrence>();
	for (const pixel of frame.pixels) {
		for (const visible of [...pixel.alphaBlended, ...pixel.additive]) {
			const fragment = index.fragmentById.get(visible.fragmentId);
			if (!fragment) {
				throw new Error(`Missing cost fragment ${visible.fragmentId}.`);
			}
			const existing = occurrenceByKey.get(fragment.submissionId);
			if (existing) {
				const paths = [...existing.paths];
				for (const path of visible.paths) {
					if (
						!paths.some((candidate) => pathKey(candidate) === pathKey(path))
					) {
						paths.push(path);
					}
				}
				occurrenceByKey.set(fragment.submissionId, {
					...existing,
					paths: Object.freeze(paths),
				});
				continue;
			}
			occurrenceByKey.set(fragment.submissionId, {
				batchId: fragment.batchId,
				depth: fragment.depth,
				kind: deferredKind(fragment),
				paths: Object.freeze([...visible.paths]),
				scopeId: fragment.scopeId,
				submissionId: fragment.submissionId,
			});
		}
	}
	return [...occurrenceByKey.values()];
}

function opaqueBatchCountByDomain(
	scene: PortalModelScene,
	domainIds: readonly PortalModelDomainId[],
): number {
	const domainById = new Map(
		scene.domains.map((domain) => [domain.id, domain]),
	);
	let count = 0;
	for (const domainId of domainIds) {
		const domain = domainById.get(domainId);
		if (!domain) throw new Error(`Missing cost domain ${domainId}.`);
		count += new Set(
			domain.fragments
				.filter(
					(fragment) =>
						fragment.kind === "opaque" || fragment.kind === "alpha-test",
				)
				.map(({ batchId }) => batchId),
		).size;
	}
	return count;
}

function opaqueBatchCountByView(
	scene: PortalModelScene,
	views: readonly PortalPotentialView[],
): number {
	const fragmentsByScope = opaqueFragmentsByScope(scene);
	return views.reduce(
		(total, view) =>
			total +
			new Set(
				(fragmentsByScope.get(view.scopeId) ?? []).map(
					({ batchId }) => batchId,
				),
			).size,
		0,
	);
}

function opaqueBatchCountByLabel(
	scene: PortalModelScene,
	views: readonly PortalPotentialView[],
	labelsByViewId: ReadonlyMap<PortalPotentialView["id"], number>,
): number {
	const fragmentsByScope = opaqueFragmentsByScope(scene);
	const batchRuns = new Set<string>();
	for (const view of views) {
		const label = labelsByViewId.get(view.id);
		if (label === undefined)
			throw new Error(`Costed portal view ${view.id} has no ownership label.`);
		for (const fragment of fragmentsByScope.get(view.scopeId) ?? []) {
			batchRuns.add(`${label}:${fragment.batchId}`);
		}
	}
	return batchRuns.size;
}

function opaqueFragmentsByScope(
	scene: PortalModelScene,
): ReadonlyMap<PortalModelScopeId, readonly PortalModelFragment[]> {
	const fragmentsByScope = new Map<PortalModelScopeId, PortalModelFragment[]>();
	for (const domain of scene.domains) {
		for (const fragment of domain.fragments) {
			if (fragment.kind !== "opaque" && fragment.kind !== "alpha-test")
				continue;
			const fragments = fragmentsByScope.get(fragment.scopeId) ?? [];
			fragments.push(fragment);
			fragmentsByScope.set(fragment.scopeId, fragments);
		}
	}
	return fragmentsByScope;
}

function compatibleRunCount(
	occurrences: readonly DeferredOccurrence[],
	ordered: boolean,
	includeVisibilitySignature: boolean,
): number {
	if (occurrences.length === 0) return 0;
	if (!ordered) {
		return new Set(
			occurrences.map((occurrence) =>
				deferredCompatibilityKey(occurrence, includeVisibilitySignature),
			),
		).size;
	}
	let count = 0;
	let previousKey: string | null = null;
	for (const occurrence of occurrences) {
		const key = deferredCompatibilityKey(
			occurrence,
			includeVisibilitySignature,
		);
		if (key !== previousKey) count += 1;
		previousKey = key;
	}
	return count;
}

function coveredViewPixels(views: readonly PortalPotentialView[]): number {
	return views.reduce(
		(total, view) => total + portalModelFootprintCardinality(view.coverage),
		0,
	);
}

function deferredReplayCost(
	occurrences: readonly DeferredOccurrence[],
): DeferredReplayCost {
	const alpha = occurrences
		.filter(({ kind }) => kind === "alpha" || kind === "particle-alpha")
		.sort((left, right) => right.depth - left.depth);
	const additive = occurrences.filter(
		({ kind }) => kind === "additive" || kind === "particle-additive",
	);
	let maskDrawCount = 0;
	let orderedTransparentRunCount = 0;
	let previousKey: string | null = null;
	for (const occurrence of alpha) {
		const key = deferredCompatibilityKey(occurrence, true);
		if (key === previousKey) continue;
		orderedTransparentRunCount += 1;
		maskDrawCount += occurrence.paths.length;
		previousKey = key;
	}
	const additiveKeys = new Set<string>();
	for (const occurrence of additive) {
		const key = deferredCompatibilityKey(occurrence, true);
		if (additiveKeys.has(key)) continue;
		additiveKeys.add(key);
		maskDrawCount += occurrence.paths.length;
	}
	const particle = occurrences.filter(({ kind }) =>
		kind.startsWith("particle-"),
	);
	return {
		additiveRunCount: additiveKeys.size,
		maskDrawCount,
		orderedTransparentRunCount,
		particleDrawBatchCount: compatibleRunCount(particle, false, true),
		runCount: orderedTransparentRunCount + additiveKeys.size,
	};
}

function deferredCompatibilityKey(
	occurrence: DeferredOccurrence,
	includeVisibilitySignature: boolean,
): string {
	return includeVisibilitySignature
		? `${occurrence.batchId}:${occurrence.scopeId}:${occurrence.paths.map(pathKey).sort().join("|")}`
		: occurrence.batchId;
}

function pathKey(path: PortalReferencePath): string {
	return JSON.stringify(path.crossingIds);
}

function deferredKind(
	fragment: PortalModelFragment,
): DeferredOccurrence["kind"] {
	switch (fragment.kind) {
		case "additive":
			return "additive";
		case "alpha-blended":
			return "alpha";
		case "particle":
			return fragment.blend === "additive"
				? "particle-additive"
				: "particle-alpha";
		case "alpha-test":
		case "opaque":
			throw new Error(`Opaque fragment ${fragment.id} entered deferred cost.`);
	}
}

function indexScene(scene: PortalModelScene): CostIndex {
	const fragmentById = new Map<PortalModelFragmentId, PortalModelFragment>();
	for (const domain of scene.domains) {
		for (const fragment of domain.fragments)
			fragmentById.set(fragment.id, fragment);
	}
	const scopeCountByDomain = new Map<PortalModelDomainId, number>();
	for (const scope of scene.scopes) {
		scopeCountByDomain.set(
			scope.domainId,
			(scopeCountByDomain.get(scope.domainId) ?? 0) + 1,
		);
	}
	return { fragmentById, scopeCountByDomain };
}
