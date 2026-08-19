import {
	createPortalModelAperture,
	createPortalModelScene,
	portalModelBatchId,
	portalModelCrossingId,
	portalModelDepth,
	portalModelDomainId,
	portalModelFragmentId,
	portalModelPixel,
	portalModelScopeId,
	portalModelSubmissionId,
	type PortalModelFragment,
	type PortalModelScene,
	type PortalModelScopeId,
} from "./portal-model";

interface PortalModelTestScopeInput {
	readonly domain: string;
	readonly fragments: readonly PortalModelTestFragmentInput[];
	readonly scope: string;
}

interface PortalModelTestCrossingInput {
	readonly depth: number;
	readonly id: string;
	readonly junctionGroupId?: number | null;
	readonly relationship?:
		"depth-continuous" | "exterior-boundary" | "indoor-boundary";
	readonly source: string;
	readonly target: string;
}

type PortalModelTestFragmentInput = PortalModelFragment extends infer Fragment
	? Fragment extends PortalModelFragment
		? Omit<Fragment, "pixel" | "scopeId">
		: never
	: never;

/** Build concise one-pixel semantic fixtures without weakening runtime model validation. */
export function portalModelTestScene(
	scopeInputs: readonly PortalModelTestScopeInput[],
	crossingInputs: readonly PortalModelTestCrossingInput[],
): PortalModelScene {
	const pixelCount = 1;
	const pixel = portalModelPixel(0, pixelCount);
	const root = scopeInputs[0];
	if (!root)
		throw new Error("A portal model test scene requires a root scope.");
	const scopeById = new Map(
		scopeInputs.map((input) => [input.scope, portalModelScopeId(input.scope)]),
	);
	const domainIds = [...new Set(scopeInputs.map(({ domain }) => domain))].map(
		portalModelDomainId,
	);
	return createPortalModelScene({
		crossings: crossingInputs.map((crossing) => ({
			aperture: createPortalModelAperture(pixelCount, [
				{ depth: portalModelDepth(crossing.depth), pixel },
			]),
			id: portalModelCrossingId(crossing.id),
			junctionGroupId: crossing.junctionGroupId ?? null,
			reciprocalCrossingId: null,
			relationship: crossing.relationship ?? "indoor-boundary",
			sourceScopeId: requiredScope(scopeById, crossing.source),
			targetScopeId: requiredScope(scopeById, crossing.target),
		})),
		domains: domainIds.map((domainId) => ({
			fragments: scopeInputs.flatMap((scope) => {
				if (portalModelDomainId(scope.domain) !== domainId) return [];
				return scope.fragments.map((fragment): PortalModelFragment =>
					placeFragment(fragment, requiredScope(scopeById, scope.scope), pixel),
				);
			}),
			id: domainId,
		})),
		pixelCount,
		rootScopeId: requiredScope(scopeById, root.scope),
		scopes: scopeInputs.map((scope) => ({
			domainId: portalModelDomainId(scope.domain),
			id: requiredScope(scopeById, scope.scope),
		})),
	});
}

export function opaqueFragment(
	id: string,
	depth: number,
): PortalModelTestFragmentInput {
	return {
		batchId: portalModelBatchId(id),
		depth: portalModelDepth(depth),
		id: portalModelFragmentId(id),
		kind: "opaque",
		submissionId: portalModelSubmissionId(id),
	};
}

export function alphaTestFragment(
	id: string,
	depth: number,
	passes: boolean,
): PortalModelTestFragmentInput {
	return {
		batchId: portalModelBatchId(id),
		depth: portalModelDepth(depth),
		id: portalModelFragmentId(id),
		kind: "alpha-test",
		passes,
		submissionId: portalModelSubmissionId(id),
	};
}

export function alphaBlendedFragment(
	id: string,
	depth: number,
): PortalModelTestFragmentInput {
	return {
		batchId: portalModelBatchId(id),
		depth: portalModelDepth(depth),
		id: portalModelFragmentId(id),
		kind: "alpha-blended",
		submissionId: portalModelSubmissionId(id),
	};
}

export function additiveFragment(
	id: string,
	depth: number,
): PortalModelTestFragmentInput {
	return {
		batchId: portalModelBatchId(id),
		depth: portalModelDepth(depth),
		id: portalModelFragmentId(id),
		kind: "additive",
		submissionId: portalModelSubmissionId(id),
	};
}

export function particleFragment(
	id: string,
	depth: number,
	blend: "additive" | "alpha-blended",
): PortalModelTestFragmentInput {
	return {
		batchId: portalModelBatchId(id),
		blend,
		depth: portalModelDepth(depth),
		id: portalModelFragmentId(id),
		kind: "particle",
		submissionId: portalModelSubmissionId(id),
	};
}

function requiredScope(
	scopeById: ReadonlyMap<string, PortalModelScopeId>,
	id: string,
): PortalModelScopeId {
	const scopeId = scopeById.get(id);
	if (!scopeId) throw new Error(`Missing test scope ${id}.`);
	return scopeId;
}

function placeFragment(
	fragment: PortalModelTestFragmentInput,
	scopeId: PortalModelScopeId,
	pixel: ReturnType<typeof portalModelPixel>,
): PortalModelFragment {
	switch (fragment.kind) {
		case "additive":
		case "alpha-blended":
		case "alpha-test":
		case "opaque":
		case "particle":
			return { ...fragment, pixel, scopeId };
	}
}
