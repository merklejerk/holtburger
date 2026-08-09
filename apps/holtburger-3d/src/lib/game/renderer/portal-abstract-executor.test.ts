import { describe, expect, it } from "vitest";
import {
	executeDomainOwnedPortalModel,
	executeUnconstrainedPathLabelPortalModel,
	findPortalFrameDivergence,
} from "./portal-abstract-executor";
import { portalModelFragmentId } from "./portal-model";
import {
	alphaBlendedFragment,
	opaqueFragment,
	particleFragment,
	portalModelTestScene,
} from "./portal-model-test-support";
import { composePortalReferenceFrame } from "./portal-reference-compositor";

describe("abstract domain-owned portal execution", () => {
	it("reproduces the missing exterior at repeated-domain re-entry", () => {
		const scene = portalModelTestScene(
			[
				{
					domain: "outdoor",
					fragments: [opaqueFragment("exterior", 6)],
					scope: "outside",
				},
				{ domain: "inside", fragments: [], scope: "inside" },
			],
			[
				{ depth: 2, id: "outside-inside", source: "outside", target: "inside" },
				{ depth: 4, id: "inside-outside", source: "inside", target: "outside" },
			],
		);
		const expected = composePortalReferenceFrame(scene);
		const actual = executeDomainOwnedPortalModel(scene);

		expect(findPortalFrameDivergence(expected.pixels, actual.pixels)).toEqual({
			actual: [],
			expected: [portalModelFragmentId("exterior")],
			field: "opaque",
			pixel: 0,
		});
		expect(actual.operations.at(-1)).toMatchObject({
			domainId: "outdoor",
			kind: "reject-repeated-domain-view",
		});
	});

	it("reproduces sky before the final room in alternating re-entry", () => {
		const scene = portalModelTestScene(
			[
				{ domain: "outdoor", fragments: [], scope: "outside" },
				{ domain: "inside-a", fragments: [], scope: "inside-a" },
				{
					domain: "inside-b",
					fragments: [opaqueFragment("last-room", 8)],
					scope: "inside-b",
				},
			],
			[
				{ depth: 2, id: "outside-a", source: "outside", target: "inside-a" },
				{ depth: 4, id: "a-outside", source: "inside-a", target: "outside" },
				{ depth: 6, id: "outside-b", source: "outside", target: "inside-b" },
			],
		);
		const expected = composePortalReferenceFrame(scene);
		const actual = executeDomainOwnedPortalModel(scene);

		expect(
			findPortalFrameDivergence(expected.pixels, actual.pixels),
		).toMatchObject({
			actual: [],
			expected: [portalModelFragmentId("last-room")],
			field: "opaque",
		});
	});

	it("reproduces parent particle clipping from complete-domain ordering", () => {
		const scene = portalModelTestScene(
			[
				{
					domain: "root",
					fragments: [
						alphaBlendedFragment("glass", 1),
						particleFragment("smoke", 2, "alpha-blended"),
					],
					scope: "root",
				},
				{
					domain: "child",
					fragments: [opaqueFragment("child-wall", 6)],
					scope: "child",
				},
			],
			[{ depth: 4, id: "door", source: "root", target: "child" }],
		);
		const expected = composePortalReferenceFrame(scene);
		const actual = executeDomainOwnedPortalModel(scene);

		expect(findPortalFrameDivergence(expected.pixels, actual.pixels)).toEqual({
			actual: [],
			expected: [
				portalModelFragmentId("smoke"),
				portalModelFragmentId("glass"),
			],
			field: "alphaBlended",
			pixel: 0,
		});
		expect(actual.operations.at(-1)).toMatchObject({
			fragmentIds: [
				portalModelFragmentId("smoke"),
				portalModelFragmentId("glass"),
			],
			kind: "overwrite-parent-transparency",
		});
	});

	it("agrees for a single terminal domain without deferred parent work", () => {
		const scene = portalModelTestScene(
			[
				{
					domain: "root",
					fragments: [
						alphaBlendedFragment("glass", 1),
						opaqueFragment("wall", 4),
					],
					scope: "root",
				},
			],
			[],
		);
		const expected = composePortalReferenceFrame(scene);
		const actual = executeDomainOwnedPortalModel(scene);

		expect(
			findPortalFrameDivergence(expected.pixels, actual.pixels),
		).toBeNull();
	});

	it("reproduces a child label escaping over parent opaque geometry", () => {
		const scene = portalModelTestScene(
			[
				{
					domain: "root",
					fragments: [opaqueFragment("wall", 1)],
					scope: "root",
				},
				{
					domain: "child",
					fragments: [opaqueFragment("escaped-child", 3)],
					scope: "child",
				},
			],
			[{ depth: 2, id: "door", source: "root", target: "child" }],
		);
		const expected = composePortalReferenceFrame(scene);
		const actual = executeUnconstrainedPathLabelPortalModel(scene);

		expect(findPortalFrameDivergence(expected.pixels, actual.pixels)).toEqual({
			actual: [portalModelFragmentId("escaped-child")],
			expected: [portalModelFragmentId("wall")],
			field: "opaque",
			pixel: 0,
		});
	});

	it("keeps a depth-continuous same-domain crossing inside one contribution", () => {
		const scene = portalModelTestScene(
			[
				{ domain: "island", fragments: [], scope: "root-cell" },
				{
					domain: "island",
					fragments: [opaqueFragment("next-cell-wall", 4)],
					scope: "next-cell",
				},
			],
			[
				{
					depth: 2,
					id: "internal-door",
					relationship: "depth-continuous",
					source: "root-cell",
					target: "next-cell",
				},
			],
		);
		const expected = composePortalReferenceFrame(scene);
		const actual = executeDomainOwnedPortalModel(scene);

		expect(
			findPortalFrameDivergence(expected.pixels, actual.pixels),
		).toBeNull();
		expect(
			actual.operations.some(
				(operation) => operation.kind === "reject-repeated-domain-view",
			),
		).toBe(false);
	});
});
