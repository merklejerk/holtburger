import { describe, expect, it } from "vitest";
import {
	allocatePortalViewLabels,
	executePortalViewLabels,
} from "./portal-ownership-executor";
import { executePortalArrivalStateCompositor } from "./portal-arrival-state-compositor";
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
	type PortalModelScene,
} from "./portal-model";
import {
	alphaBlendedFragment,
	opaqueFragment,
	particleFragment,
	portalModelTestScene,
} from "./portal-model-test-support";
import { createPortalPotentialViewPlan } from "./portal-potential-view-plan";
import { composePortalReferenceFrame } from "./portal-reference-compositor";
import { executePortalViewLabelCompositor } from "./portal-view-label-compositor";

describe("portal model metamorphic properties", () => {
	it("is invariant under graph storage order and identity alpha-renaming", () => {
		const original = portalModelTestScene(
			[
				{ domain: "root-domain", fragments: [], scope: "root" },
				{
					domain: "child-domain",
					fragments: [opaqueFragment("wall", 5)],
					scope: "child",
				},
			],
			[{ depth: 2, id: "door", source: "root", target: "child" }],
		);
		const renamed = renameScene(original, "renamed-");

		expect(normalizeFrame(composePortalReferenceFrame(renamed))).toEqual(
			normalizeFrame(composePortalReferenceFrame(original)),
		);
		expect(
			normalizeFrame(executePortalArrivalStateCompositor(renamed)),
		).toEqual(normalizeFrame(executePortalArrivalStateCompositor(original)));
	});

	it("commutes when disjoint sibling crossings are reordered", () => {
		const forward = disjointSiblingScene(false);
		const reversed = disjointSiblingScene(true);

		expect(normalizeFrame(composePortalReferenceFrame(reversed))).toEqual(
			normalizeFrame(composePortalReferenceFrame(forward)),
		);
		expect(normalizeFrame(executePortalViewLabelCompositor(reversed))).toEqual(
			normalizeFrame(executePortalViewLabelCompositor(forward)),
		);
		expect(
			normalizeFrame(executePortalArrivalStateCompositor(reversed)),
		).toEqual(normalizeFrame(executePortalArrivalStateCompositor(forward)));
	});

	it("reuses one transient label across disjoint sibling views", () => {
		const scene = disjointSiblingScene(false);
		const plan = createPortalPotentialViewPlan(scene);
		const labels = allocatePortalViewLabels(plan);
		const childLabels = plan.views
			.filter(({ parentViewId }) => parentViewId !== null)
			.map(({ id }) => labels.get(id));

		expect(childLabels).toEqual([1, 1]);
		expect(
			executePortalViewLabels(scene, {
				labelsByViewId: labels,
				plan,
			}).pixels.map(({ opaqueFragmentId }) => opaqueFragmentId),
		).toEqual(["left-wall", "right-wall"]);
	});

	it("preserves output when one footprint is split into disjoint crossings", () => {
		const unsplit = splitFootprintScene(false);
		const split = splitFootprintScene(true);

		expect(normalizeFrame(composePortalReferenceFrame(split))).toEqual(
			normalizeFrame(composePortalReferenceFrame(unsplit)),
		);
		expect(normalizeFrame(executePortalViewLabelCompositor(split))).toEqual(
			normalizeFrame(executePortalViewLabelCompositor(unsplit)),
		);
		expect(normalizeFrame(executePortalArrivalStateCompositor(split))).toEqual(
			normalizeFrame(executePortalArrivalStateCompositor(unsplit)),
		);
	});

	it("ignores an unreachable cycle", () => {
		const root = portalModelTestScene(
			[
				{
					domain: "root",
					fragments: [opaqueFragment("root-wall", 3)],
					scope: "root",
				},
			],
			[],
		);
		const unreachable = createPortalModelScene({
			...root,
			crossings: [
				crossing(1, "u-v", "u", "v", 2, [0]),
				crossing(1, "v-u", "v", "u", 4, [0]),
			],
			domains: [
				...root.domains,
				{ fragments: [], id: portalModelDomainId("unreachable") },
			],
			scopes: [
				...root.scopes,
				{
					domainId: portalModelDomainId("unreachable"),
					id: portalModelScopeId("u"),
				},
				{
					domainId: portalModelDomainId("unreachable"),
					id: portalModelScopeId("v"),
				},
			],
		});

		expect(normalizeFrame(composePortalReferenceFrame(unreachable))).toEqual(
			normalizeFrame(composePortalReferenceFrame(root)),
		);
		expect(
			normalizeFrame(executePortalArrivalStateCompositor(unreachable)),
		).toEqual(normalizeFrame(executePortalArrivalStateCompositor(root)));
	});

	it("ignores a farther subsumed portal path at the same pixel", () => {
		const base = portalModelTestScene(
			[
				{ domain: "root", fragments: [], scope: "root" },
				{
					domain: "child",
					fragments: [opaqueFragment("child-wall", 8)],
					scope: "child",
				},
			],
			[{ depth: 2, id: "near", source: "root", target: "child" }],
		);
		const subsumed = createPortalModelScene({
			...base,
			crossings: [
				...base.crossings,
				crossing(1, "far", "root", "child", 4, [0]),
			],
		});

		expect(normalizeFrame(composePortalReferenceFrame(subsumed))).toEqual(
			normalizeFrame(composePortalReferenceFrame(base)),
		);
		expect(
			normalizeFrame(executePortalArrivalStateCompositor(subsumed)),
		).toEqual(normalizeFrame(executePortalArrivalStateCompositor(base)));
	});

	it("treats an alpha particle as its equivalent transparent fragment", () => {
		const transparent = portalModelTestScene(
			[
				{ domain: "root", fragments: [], scope: "root" },
				{
					domain: "child",
					fragments: [
						alphaBlendedFragment("effect", 4),
						opaqueFragment("wall", 8),
					],
					scope: "child",
				},
			],
			[{ depth: 2, id: "door", source: "root", target: "child" }],
		);
		const particle = portalModelTestScene(
			[
				{ domain: "root", fragments: [], scope: "root" },
				{
					domain: "child",
					fragments: [
						particleFragment("effect", 4, "alpha-blended"),
						opaqueFragment("wall", 8),
					],
					scope: "child",
				},
			],
			[{ depth: 2, id: "door", source: "root", target: "child" }],
		);

		expect(
			normalizeFrame(executePortalArrivalStateCompositor(particle)),
		).toEqual(normalizeFrame(executePortalArrivalStateCompositor(transparent)));
	});
});

function disjointSiblingScene(reversed: boolean): PortalModelScene {
	const crossings = [
		crossing(2, "left-door", "root", "left", 2, [0]),
		crossing(2, "right-door", "root", "right", 4, [1]),
	];
	if (reversed) crossings.reverse();
	return createPortalModelScene({
		crossings,
		domains: [
			{ fragments: [], id: portalModelDomainId("root") },
			{
				fragments: [opaqueSample("left-wall", "left", 0, 6)],
				id: portalModelDomainId("left"),
			},
			{
				fragments: [opaqueSample("right-wall", "right", 1, 8)],
				id: portalModelDomainId("right"),
			},
		],
		pixelCount: 2,
		rootScopeId: portalModelScopeId("root"),
		scopes: ["root", "left", "right"].map((id) => ({
			domainId: portalModelDomainId(id),
			id: portalModelScopeId(id),
		})),
	});
}

function splitFootprintScene(split: boolean): PortalModelScene {
	return createPortalModelScene({
		crossings: split
			? [
					crossing(2, "door-left", "root", "child", 2, [0]),
					crossing(2, "door-right", "root", "child", 2, [1]),
				]
			: [crossing(2, "door", "root", "child", 2, [0, 1])],
		domains: [
			{ fragments: [], id: portalModelDomainId("root") },
			{
				fragments: [
					opaqueSample("left", "child", 0, 6),
					opaqueSample("right", "child", 1, 6),
				],
				id: portalModelDomainId("child"),
			},
		],
		pixelCount: 2,
		rootScopeId: portalModelScopeId("root"),
		scopes: ["root", "child"].map((id) => ({
			domainId: portalModelDomainId(id),
			id: portalModelScopeId(id),
		})),
	});
}

function crossing(
	pixelCount: number,
	id: string,
	source: string,
	target: string,
	depth: number,
	pixels: readonly number[],
) {
	return {
		aperture: createPortalModelAperture(
			pixelCount,
			pixels.map((pixel) => ({
				depth: portalModelDepth(depth),
				pixel: portalModelPixel(pixel, pixelCount),
			})),
		),
		id: portalModelCrossingId(id),
		reciprocalCrossingId: null,
		relationship: "indoor-boundary" as const,
		sourceScopeId: portalModelScopeId(source),
		targetScopeId: portalModelScopeId(target),
	};
}

function opaqueSample(id: string, scope: string, pixel: number, depth: number) {
	return {
		batchId: portalModelBatchId(`${scope}-opaque`),
		depth: portalModelDepth(depth),
		id: portalModelFragmentId(id),
		kind: "opaque" as const,
		pixel: portalModelPixel(pixel, 2),
		scopeId: portalModelScopeId(scope),
		submissionId: portalModelSubmissionId(id),
	};
}

function normalizeFrame(
	frame: Pick<ReturnType<typeof composePortalReferenceFrame>, "pixels">,
) {
	return frame.pixels.map((pixel) => ({
		additiveDepths: pixel.additive.map(({ depth }) => depth),
		alphaDepths: pixel.alphaBlended.map(({ depth }) => depth),
		opaqueDepth: pixel.opaque?.depth ?? null,
	}));
}

function renameScene(
	scene: PortalModelScene,
	prefix: string,
): PortalModelScene {
	return createPortalModelScene({
		crossings: [...scene.crossings].reverse().map((crossing) => ({
			...crossing,
			id: portalModelCrossingId(`${prefix}${crossing.id}`),
			reciprocalCrossingId:
				crossing.reciprocalCrossingId === null
					? null
					: portalModelCrossingId(`${prefix}${crossing.reciprocalCrossingId}`),
			sourceScopeId: portalModelScopeId(`${prefix}${crossing.sourceScopeId}`),
			targetScopeId: portalModelScopeId(`${prefix}${crossing.targetScopeId}`),
		})),
		domains: [...scene.domains].reverse().map((domain) => ({
			fragments: domain.fragments.map((fragment) => ({
				...fragment,
				batchId: portalModelBatchId(`${prefix}${fragment.batchId}`),
				id: portalModelFragmentId(`${prefix}${fragment.id}`),
				scopeId: portalModelScopeId(`${prefix}${fragment.scopeId}`),
				submissionId: portalModelSubmissionId(
					`${prefix}${fragment.submissionId}`,
				),
			})),
			id: portalModelDomainId(`${prefix}${domain.id}`),
		})),
		pixelCount: scene.pixelCount,
		rootScopeId: portalModelScopeId(`${prefix}${scene.rootScopeId}`),
		scopes: [...scene.scopes].reverse().map((scope) => ({
			domainId: portalModelDomainId(`${prefix}${scope.domainId}`),
			id: portalModelScopeId(`${prefix}${scope.id}`),
		})),
	});
}
