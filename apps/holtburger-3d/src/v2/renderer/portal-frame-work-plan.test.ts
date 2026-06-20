import { describe, expect, it } from "vitest";
import {
	createLegacyPortalFrameWorkPlan,
	portalFrameWorkPlanEquals,
} from "./portal-frame-work-plan";
import type { PortalFrameWorkPlan } from "./types";

describe("portal frame work plan", () => {
	it("classifies legacy render pass modes explicitly", () => {
		expect(
			createLegacyPortalFrameWorkPlan({
				flatVisionModeEnabled: false,
				renderPassPlan: { kind: "single-surface-resident" },
			}),
		).toEqual({
			kind: "legacy-render-pass",
			mode: "single-surface-resident",
			renderPassPlan: { kind: "single-surface-resident" },
		});

		expect(
			createLegacyPortalFrameWorkPlan({
				flatVisionModeEnabled: true,
				renderPassPlan: { kind: "single-surface-resident" },
			}),
		).toEqual({
			kind: "legacy-render-pass",
			mode: "flat-resident-diagnostic",
			renderPassPlan: { kind: "single-surface-resident" },
		});

		expect(
			createLegacyPortalFrameWorkPlan({
				flatVisionModeEnabled: false,
				renderPassPlan: {
					baseScene: { kind: "exterior", landblockId: 0xf418ffff },
					kind: "portal-scene-domains",
					transitionDepthPolicy: { maxDepth: 2 },
				},
			}),
		).toEqual({
			kind: "legacy-render-pass",
			mode: "legacy-scene-domain-composite",
			renderPassPlan: {
				baseScene: { kind: "exterior", landblockId: 0xf418ffff },
				kind: "portal-scene-domains",
				transitionDepthPolicy: { maxDepth: 2 },
			},
		});
	});

	it("compares direct env-cell plans without naming an all-interior source target", () => {
		const plan = createDirectEnvCellPlan();

		expect(portalFrameWorkPlanEquals(plan, createDirectEnvCellPlan())).toBe(
			true,
		);
		expect(
			portalFrameWorkPlanEquals(plan, {
				...createDirectEnvCellPlan(),
				directEnvCellDraws: [
					{
						...createDirectEnvCellPlan().directEnvCellDraws[0]!,
						resourceState: "ready",
					},
				],
			}),
		).toBe(false);
	});
});

function createDirectEnvCellPlan(): PortalFrameWorkPlan {
	return {
		baseScene: {
			kind: "outdoor-target",
			landblockId: 0xf418ffff,
		},
		directEnvCellDraws: [
			{
				envCellId: 0xf4180103,
				envCellStaticObjectDrawUnitIds: [],
				landblockId: 0xf418ffff,
				portalStackId: "transition:f4180103/01",
				resourceState: "missing-resources",
				structuredInteriorDrawUnitIds: [],
				traversalDepth: 1,
			},
		],
		kind: "direct-env-cell",
		mode: "portal-traversal",
		portalApertureGeometryResources: [],
		portalApertureMaskPasses: [],
		transitionSceneCrossings: [
			{
				apertureBatchId: "transition-aperture-batch:f418ffff",
				from: { kind: "outdoor", landblockId: 0xf418ffff },
				landblockId: 0xf418ffff,
				linkedEnvCellIds: [0xf4180103],
				to: {
					envCellId: 0xf4180103,
					kind: "env-cell",
					landblockId: 0xf418ffff,
				},
			},
		],
	};
}
