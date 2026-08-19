import {
	createPortalModelFootprint,
	portalModelPixel,
	portalModelViewId,
	validatePortalModelScene,
	type PortalModelCrossing,
	type PortalModelCrossingId,
	type PortalModelDepth,
	type PortalModelDomainId,
	type PortalModelScene,
	type PortalModelScopeId,
	type PortalModelViewId,
	portalEntryAdvanceAdmitted,
} from "./portal-model";

/** One CPU-planned scope appearance before opaque depth rejects portal pixels. */
export interface PortalPotentialView {
	readonly coverage: ReturnType<typeof createPortalModelFootprint>;
	readonly crossingIds: readonly PortalModelCrossingId[];
	readonly domainId: PortalModelDomainId;
	readonly entryDepthByPixel: readonly (PortalModelDepth | null)[];
	readonly id: PortalModelViewId;
	readonly parentViewId: PortalModelViewId | null;
	readonly scopeId: PortalModelScopeId;
}

/** Complete finite CPU visibility workload independent from scene fragments. */
export interface PortalPotentialViewPlan {
	readonly maximumPathLength: number;
	readonly raySegmentCount: number;
	readonly views: readonly PortalPotentialView[];
}

interface MutablePotentialView {
	readonly coverageByPixel: boolean[];
	readonly crossingIds: readonly PortalModelCrossingId[];
	readonly domainId: PortalModelDomainId;
	readonly entryDepthByPixel: (PortalModelDepth | null)[];
	readonly id: PortalModelViewId;
	readonly parentViewId: PortalModelViewId | null;
	readonly scopeId: PortalModelScopeId;
}

/** Enumerate every monotonically deeper portal path the CPU must conservatively schedule. */
export function createPortalPotentialViewPlan(
	scene: PortalModelScene,
): PortalPotentialViewPlan {
	validatePortalModelScene(scene);
	const crossingsByScope = new Map<PortalModelScopeId, PortalModelCrossing[]>();
	for (const crossing of scene.crossings) {
		const crossings = crossingsByScope.get(crossing.sourceScopeId) ?? [];
		crossings.push(crossing);
		crossingsByScope.set(crossing.sourceScopeId, crossings);
	}
	const domainByScope = new Map(
		scene.scopes.map((scope) => [scope.id, scope.domainId]),
	);
	const viewByPath = new Map<string, MutablePotentialView>();
	let maximumPathLength = 0;
	let raySegmentCount = 0;
	for (let pixelValue = 0; pixelValue < scene.pixelCount; pixelValue += 1) {
		const pixel = portalModelPixel(pixelValue, scene.pixelCount);
		const visit = (
			scopeId: PortalModelScopeId,
			entryDepth: PortalModelDepth | null,
			incomingCrossing: PortalModelCrossing | null,
			crossingIds: readonly PortalModelCrossingId[],
		): void => {
			raySegmentCount += 1;
			maximumPathLength = Math.max(maximumPathLength, crossingIds.length);
			recordPotentialView(
				scene,
				domainByScope,
				viewByPath,
				pixel,
				scopeId,
				entryDepth,
				crossingIds,
			);
			const reciprocalId = incomingCrossing?.reciprocalCrossingId ?? null;
			for (const crossing of crossingsByScope.get(scopeId) ?? []) {
				if (crossing.id === reciprocalId) continue;
				const depth = crossing.aperture.depthByPixel[pixel];
				if (
					depth === null ||
					!portalEntryAdvanceAdmitted(
						incomingCrossing,
						entryDepth,
						crossing,
						depth,
					)
				) {
					continue;
				}
				visit(crossing.targetScopeId, depth, crossing, [
					...crossingIds,
					crossing.id,
				]);
			}
		};
		visit(scene.rootScopeId, null, null, []);
	}
	const views = [...viewByPath.values()]
		.sort(
			(left, right) =>
				left.crossingIds.length - right.crossingIds.length ||
				left.id.localeCompare(right.id),
		)
		.map((view): PortalPotentialView =>
			Object.freeze({
				coverage: createPortalModelFootprint(
					scene.pixelCount,
					view.coverageByPixel.flatMap((covered, pixel) =>
						covered ? [pixel] : [],
					),
				),
				crossingIds: Object.freeze([...view.crossingIds]),
				domainId: view.domainId,
				entryDepthByPixel: Object.freeze([...view.entryDepthByPixel]),
				id: view.id,
				parentViewId: view.parentViewId,
				scopeId: view.scopeId,
			}),
		);
	return Object.freeze({
		maximumPathLength,
		raySegmentCount,
		views: Object.freeze(views),
	});
}

function recordPotentialView(
	scene: PortalModelScene,
	domainByScope: ReadonlyMap<PortalModelScopeId, PortalModelDomainId>,
	viewByPath: Map<string, MutablePotentialView>,
	pixel: ReturnType<typeof portalModelPixel>,
	scopeId: PortalModelScopeId,
	entryDepth: PortalModelDepth | null,
	crossingIds: readonly PortalModelCrossingId[],
): void {
	const key = pathKey(crossingIds);
	const existing = viewByPath.get(key);
	if (existing) {
		existing.coverageByPixel[pixel] = true;
		existing.entryDepthByPixel[pixel] = entryDepth;
		return;
	}
	const domainId = domainByScope.get(scopeId);
	if (!domainId)
		throw new Error(`Potential portal scope ${scopeId} has no domain.`);
	const entryDepthByPixel = Array<PortalModelDepth | null>(
		scene.pixelCount,
	).fill(null);
	entryDepthByPixel[pixel] = entryDepth;
	const coverageByPixel = Array<boolean>(scene.pixelCount).fill(false);
	coverageByPixel[pixel] = true;
	viewByPath.set(key, {
		coverageByPixel,
		crossingIds: Object.freeze([...crossingIds]),
		domainId,
		entryDepthByPixel,
		id: viewId(crossingIds),
		parentViewId:
			crossingIds.length === 0 ? null : viewId(crossingIds.slice(0, -1)),
		scopeId,
	});
}

function viewId(
	crossingIds: readonly PortalModelCrossingId[],
): PortalModelViewId {
	return portalModelViewId(
		crossingIds.length === 0
			? "portal-potential-view:root"
			: `portal-potential-view:${crossingIds.join(">")}`,
	);
}

function pathKey(crossingIds: readonly PortalModelCrossingId[]): string {
	return JSON.stringify(crossingIds);
}
