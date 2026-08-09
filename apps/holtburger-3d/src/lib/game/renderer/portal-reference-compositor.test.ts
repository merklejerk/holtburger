import { describe, expect, it } from "vitest";
import {
	createPortalModelAperture,
	createPortalModelScene,
	portalModelCrossingId,
	portalModelDepth,
	portalModelDomainId,
	portalModelFootprintHas,
	portalModelFragmentId,
	portalModelPixel,
	portalModelScopeId,
} from "./portal-model";
import {
	additiveFragment as additive,
	alphaBlendedFragment as alpha,
	alphaTestFragment as alphaTest,
	opaqueFragment as opaque,
	particleFragment as particle,
	portalModelTestScene as linearScene,
} from "./portal-model-test-support";
import { composePortalReferenceFrame } from "./portal-reference-compositor";

describe("portal reference compositor", () => {
	it("keeps outdoor root and outdoor re-entry as distinct views sharing one domain", () => {
		const scene = linearScene(
			[
				{
					domain: "outdoor",
					fragments: [opaque("exterior", 6)],
					scope: "outside",
				},
				{ domain: "inside-a", fragments: [], scope: "inside" },
			],
			[
				{ depth: 2, id: "outside-inside", source: "outside", target: "inside" },
				{ depth: 4, id: "inside-outside", source: "inside", target: "outside" },
			],
		);

		const frame = composePortalReferenceFrame(scene);

		expect(frame.pixels[0]?.opaque?.fragmentId).toBe(
			portalModelFragmentId("exterior"),
		);
		expect(frame.views.map(({ domainId }) => domainId)).toEqual([
			portalModelDomainId("outdoor"),
			portalModelDomainId("inside-a"),
			portalModelDomainId("outdoor"),
		]);
		expect(new Set(frame.views.map(({ id }) => id)).size).toBe(3);
		expect(frame.diagnostics.maximumPathLength).toBe(2);
	});

	it("follows the nearest deeper portal after repeated-domain re-entry", () => {
		const scene = linearScene(
			[
				{ domain: "outdoor", fragments: [], scope: "outside" },
				{ domain: "inside-a", fragments: [], scope: "inside-a" },
				{
					domain: "inside-b",
					fragments: [opaque("last-room", 8)],
					scope: "inside-b",
				},
			],
			[
				{ depth: 2, id: "outside-a", source: "outside", target: "inside-a" },
				{ depth: 4, id: "a-outside", source: "inside-a", target: "outside" },
				{ depth: 6, id: "outside-b", source: "outside", target: "inside-b" },
			],
		);

		const frame = composePortalReferenceFrame(scene);

		expect(frame.pixels[0]?.opaque?.fragmentId).toBe(
			portalModelFragmentId("last-room"),
		);
		expect(frame.views.at(-1)?.crossingIds).toEqual([
			portalModelCrossingId("outside-a"),
			portalModelCrossingId("a-outside"),
			portalModelCrossingId("outside-b"),
		]);
	});

	it("lets nearer parent opaque geometry block a portal", () => {
		const scene = linearScene(
			[
				{ domain: "root", fragments: [opaque("wall", 1)], scope: "root" },
				{ domain: "child", fragments: [opaque("child", 3)], scope: "child" },
			],
			[{ depth: 2, id: "door", source: "root", target: "child" }],
		);

		const frame = composePortalReferenceFrame(scene);

		expect(frame.pixels[0]?.opaque?.fragmentId).toBe(
			portalModelFragmentId("wall"),
		);
		expect(frame.views).toHaveLength(1);
	});

	it("globally composes parent, child, and particle alpha after opaque traversal", () => {
		const scene = linearScene(
			[
				{
					domain: "root",
					fragments: [alpha("root-glass", 1), alpha("root-behind-door", 7)],
					scope: "root",
				},
				{
					domain: "middle",
					fragments: [particle("middle-smoke", 3, "alpha-blended")],
					scope: "middle",
				},
				{
					domain: "leaf",
					fragments: [alpha("leaf-glass", 5), alphaTest("leaf-wall", 8, true)],
					scope: "leaf",
				},
			],
			[
				{ depth: 2, id: "root-middle", source: "root", target: "middle" },
				{ depth: 4, id: "middle-leaf", source: "middle", target: "leaf" },
			],
		);

		const pixel = composePortalReferenceFrame(scene).pixels[0]!;

		expect(pixel.opaque?.fragmentId).toBe(portalModelFragmentId("leaf-wall"));
		expect(pixel.alphaBlended.map(({ fragmentId }) => fragmentId)).toEqual([
			portalModelFragmentId("leaf-glass"),
			portalModelFragmentId("middle-smoke"),
			portalModelFragmentId("root-glass"),
		]);
		expect(pixel.alphaBlended[1]?.paths[0]?.crossingIds).toEqual([
			portalModelCrossingId("root-middle"),
		]);
	});

	it("treats particles exactly like equivalent alpha or additive fragments", () => {
		const particleScene = linearScene(
			[
				{
					domain: "root",
					fragments: [
						particle("alpha", 2, "alpha-blended"),
						particle("additive", 3, "additive"),
						opaque("wall", 5),
					],
					scope: "root",
				},
			],
			[],
		);
		const geometryScene = linearScene(
			[
				{
					domain: "root",
					fragments: [
						alpha("alpha", 2),
						additive("additive", 3),
						opaque("wall", 5),
					],
					scope: "root",
				},
			],
			[],
		);

		expect(composePortalReferenceFrame(particleScene).pixels).toEqual(
			composePortalReferenceFrame(geometryScene).pixels,
		);
	});

	it("permits target fragments to protrude in front of their entry plane", () => {
		const scene = linearScene(
			[
				{
					domain: "root",
					fragments: [opaque("root-behind", 7)],
					scope: "root",
				},
				{
					domain: "child",
					fragments: [opaque("protruding-child", 1)],
					scope: "child",
				},
			],
			[{ depth: 2, id: "door", source: "root", target: "child" }],
		);

		expect(
			composePortalReferenceFrame(scene).pixels[0]?.opaque?.fragmentId,
		).toBe(portalModelFragmentId("protruding-child"));
	});

	it("chooses the nearest overlapping sibling portal plane", () => {
		const scene = linearScene(
			[
				{ domain: "root", fragments: [], scope: "root" },
				{ domain: "near", fragments: [opaque("near-room", 7)], scope: "near" },
				{ domain: "far", fragments: [opaque("far-room", 8)], scope: "far" },
			],
			[
				{ depth: 2, id: "near-door", source: "root", target: "near" },
				{ depth: 4, id: "far-door", source: "root", target: "far" },
			],
		);

		const frame = composePortalReferenceFrame(scene);

		expect(frame.pixels[0]?.opaque?.fragmentId).toBe(
			portalModelFragmentId("near-room"),
		);
		expect(frame.views.map(({ scopeId }) => scopeId)).toEqual([
			portalModelScopeId("root"),
			portalModelScopeId("near"),
		]);
	});

	it("fails loudly on cross-view transparent depth ties", () => {
		const scene = linearScene(
			[
				{ domain: "root", fragments: [alpha("root-alpha", 1)], scope: "root" },
				{
					domain: "child",
					fragments: [alpha("child-alpha", 1)],
					scope: "child",
				},
			],
			[{ depth: 2, id: "door", source: "root", target: "child" }],
		);

		expect(() => composePortalReferenceFrame(scene)).toThrow(
			"unresolved transparent depth tie at pixel 0",
		);
	});

	it("records exact per-pixel path coverage", () => {
		const rootScope = portalModelScopeId("root");
		const childScope = portalModelScopeId("child");
		const scene = createPortalModelScene({
			crossings: [
				{
					aperture: createPortalModelAperture(2, [
						{ depth: portalModelDepth(2), pixel: portalModelPixel(1, 2) },
					]),
					id: portalModelCrossingId("door"),
					reciprocalCrossingId: null,
					relationship: "indoor-boundary",
					sourceScopeId: rootScope,
					targetScopeId: childScope,
				},
			],
			domains: [
				{ fragments: [], id: portalModelDomainId("root") },
				{ fragments: [], id: portalModelDomainId("child") },
			],
			pixelCount: 2,
			rootScopeId: rootScope,
			scopes: [
				{ domainId: portalModelDomainId("root"), id: rootScope },
				{ domainId: portalModelDomainId("child"), id: childScope },
			],
		});

		const frame = composePortalReferenceFrame(scene);
		const root = frame.views[0]!;
		const child = frame.views[1]!;

		expect(portalModelFootprintHas(root.coverage, portalModelPixel(0, 2))).toBe(
			true,
		);
		expect(portalModelFootprintHas(root.coverage, portalModelPixel(1, 2))).toBe(
			true,
		);
		expect(
			portalModelFootprintHas(child.coverage, portalModelPixel(0, 2)),
		).toBe(false);
		expect(
			portalModelFootprintHas(child.coverage, portalModelPixel(1, 2)),
		).toBe(true);
	});
});
