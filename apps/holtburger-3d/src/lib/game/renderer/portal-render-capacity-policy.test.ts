import { describe, expect, it } from "vitest";
import {
	createPortalRenderCapacityPolicy,
	PORTAL_RENDER_CAPACITY_POLICY,
} from "./portal-render-capacity-policy";
import {
	PORTAL_HOMOGENEOUS_CLIP_PLANE_COUNT,
	PORTAL_ROOT_WINDOW_VERTEX_COUNT,
} from "./portal-window-arena";

describe("portal render capacity policy", () => {
	it("owns the accepted depth and derives every arena dimension", () => {
		const limits = {
			maximumAuthoredApertureVertexCount: 7,
			maximumPathDepth: 3,
			maximumProjectionPrimitiveCount: 101,
			maximumScopeWindowWorkItemCount: 5,
		};

		const policy = createPortalRenderCapacityPolicy(limits);
		const maximumVisibilityApertureVertexCount =
			limits.maximumAuthoredApertureVertexCount ** 2 +
			2 * limits.maximumAuthoredApertureVertexCount;

		expect(policy.culler).toEqual({
			maximumDepth: limits.maximumPathDepth,
			maximumProjectionPrimitiveCount: limits.maximumProjectionPrimitiveCount,
			maximumWorkItemCount: limits.maximumScopeWindowWorkItemCount,
			windowArena: {
				maximumApertureVertexCount: maximumVisibilityApertureVertexCount,
				maximumFragmentCount:
					1 + Math.floor(limits.maximumProjectionPrimitiveCount / 3),
				maximumTemporaryFragmentCount: Math.floor(
					limits.maximumProjectionPrimitiveCount / 3,
				),
				maximumTemporaryVertexCount: Math.max(
					limits.maximumProjectionPrimitiveCount,
					PORTAL_ROOT_WINDOW_VERTEX_COUNT +
						limits.maximumPathDepth *
							(maximumVisibilityApertureVertexCount +
								PORTAL_HOMOGENEOUS_CLIP_PLANE_COUNT),
				),
				maximumVertexCount:
					PORTAL_ROOT_WINDOW_VERTEX_COUNT +
					limits.maximumProjectionPrimitiveCount,
				maximumVerticesPerFragment:
					PORTAL_ROOT_WINDOW_VERTEX_COUNT +
					limits.maximumPathDepth *
						(maximumVisibilityApertureVertexCount +
							PORTAL_HOMOGENEOUS_CLIP_PLANE_COUNT),
				maximumWindowCount: limits.maximumScopeWindowWorkItemCount * 2 - 2,
			},
		});
	});

	it("publishes one immutable production policy", () => {
		expect(PORTAL_RENDER_CAPACITY_POLICY.culler.maximumDepth).toBe(
			PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth,
		);
		expect(Object.isFrozen(PORTAL_RENDER_CAPACITY_POLICY)).toBe(true);
		expect(Object.isFrozen(PORTAL_RENDER_CAPACITY_POLICY.culler)).toBe(true);
		expect(
			Object.isFrozen(PORTAL_RENDER_CAPACITY_POLICY.culler.windowArena),
		).toBe(true);
	});

	it("rejects invalid independent limits before deriving storage", () => {
		expect(() =>
			createPortalRenderCapacityPolicy({
				maximumAuthoredApertureVertexCount: 2,
				maximumPathDepth: 1,
				maximumProjectionPrimitiveCount: 1,
				maximumScopeWindowWorkItemCount: 1,
			}),
		).toThrow("maximumAuthoredApertureVertexCount");
	});
});
