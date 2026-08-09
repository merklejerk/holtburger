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
		const selection = {
			maximumAuthoredApertureVertexCount: 7,
			maximumPathDepth: 3,
			maximumProjectionPrimitiveCount: 101,
			maximumScopeWindowWorkItemCount: 5,
			scopeAtlas: {
				columnCount: 2,
				maximumArrivalStateCount: 31,
				rowCount: 4,
			},
		};

		const policy = createPortalRenderCapacityPolicy(selection);
		const maximumVisibilityApertureVertexCount =
			selection.maximumAuthoredApertureVertexCount ** 2 +
			2 * selection.maximumAuthoredApertureVertexCount;

		expect(policy.culler).toEqual({
			maximumDepth: selection.maximumPathDepth,
			maximumProjectionPrimitiveCount:
				selection.maximumProjectionPrimitiveCount,
			maximumWorkItemCount: selection.maximumScopeWindowWorkItemCount,
			windowArena: {
				maximumApertureVertexCount: maximumVisibilityApertureVertexCount,
				maximumFragmentCount:
					1 + Math.floor(selection.maximumProjectionPrimitiveCount / 3),
				maximumTemporaryFragmentCount: Math.floor(
					selection.maximumProjectionPrimitiveCount / 3,
				),
				maximumTemporaryVertexCount: Math.max(
					selection.maximumProjectionPrimitiveCount,
					PORTAL_ROOT_WINDOW_VERTEX_COUNT +
						selection.maximumPathDepth *
							(maximumVisibilityApertureVertexCount +
								PORTAL_HOMOGENEOUS_CLIP_PLANE_COUNT),
				),
				maximumVertexCount:
					PORTAL_ROOT_WINDOW_VERTEX_COUNT +
					selection.maximumProjectionPrimitiveCount,
				maximumVerticesPerFragment:
					PORTAL_ROOT_WINDOW_VERTEX_COUNT +
					selection.maximumPathDepth *
						(maximumVisibilityApertureVertexCount +
							PORTAL_HOMOGENEOUS_CLIP_PLANE_COUNT),
				maximumWindowCount: selection.maximumScopeWindowWorkItemCount * 2 - 2,
			},
		});
		expect(policy.scopeAtlas).toEqual(selection.scopeAtlas);
	});

	it("publishes one immutable production policy", () => {
		expect(PORTAL_RENDER_CAPACITY_POLICY.culler.maximumDepth).toBe(
			PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth,
		);
		expect(Object.isFrozen(PORTAL_RENDER_CAPACITY_POLICY)).toBe(true);
		expect(Object.isFrozen(PORTAL_RENDER_CAPACITY_POLICY.culler)).toBe(true);
		expect(Object.isFrozen(PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas)).toBe(
			true,
		);
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
				scopeAtlas: {
					columnCount: 1,
					maximumArrivalStateCount: 1,
					rowCount: 1,
				},
			}),
		).toThrow("maximumAuthoredApertureVertexCount");
	});

	it("rejects invalid atlas extent multiples", () => {
		expect(() =>
			createPortalRenderCapacityPolicy({
				maximumAuthoredApertureVertexCount: 3,
				maximumPathDepth: 1,
				maximumProjectionPrimitiveCount: 1,
				maximumScopeWindowWorkItemCount: 1,
				scopeAtlas: {
					columnCount: 2,
					maximumArrivalStateCount: 1,
					rowCount: 0,
				},
			}),
		).toThrow("scopeAtlas.rowCount");
	});

	it("rejects an arrival-state format with no usable id", () => {
		expect(() =>
			createPortalRenderCapacityPolicy({
				maximumAuthoredApertureVertexCount: 3,
				maximumPathDepth: 1,
				maximumProjectionPrimitiveCount: 1,
				maximumScopeWindowWorkItemCount: 1,
				scopeAtlas: {
					columnCount: 1,
					maximumArrivalStateCount: 0,
					rowCount: 1,
				},
			}),
		).toThrow("scopeAtlas.maximumArrivalStateCount");
	});
});
