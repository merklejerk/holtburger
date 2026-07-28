import type { GeometryResourceKey } from "./resource-manager";
import type { PortalRenderWorkPlan } from "./portal-render-graph";
import { WebGL2ResourceManager } from "./webgl2-resource-manager";

export const FIXTURE_IDENTITY_CLIP_FROM_LOCAL = new Float32Array([
	1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);

/** Allocate one material-free aperture used only by production-WebGL fixtures. */
export function createPortalFixtureGeometry(
	resources: WebGL2ResourceManager,
	geometry: {
		readonly indices: Uint16Array;
		readonly positions: Float32Array;
	},
): GeometryResourceKey {
	return resources.createGeometry({
		indices: geometry.indices,
		kind: "portal-aperture",
		positions: geometry.positions,
	});
}

/** Zeroed projection counters for hand-authored executor plans. */
export function emptyFixtureProjectionDiagnostics(): PortalRenderWorkPlan["diagnostics"]["projection"] {
	return {
		broadPhaseRejectedPairCount: 0,
		createdClipVertexCount: 0,
		createdNdcVertexCount: 0,
		createdPolygonCount: 0,
		emptyExactIntersectionCount: 0,
		exactIntersectionPairCount: 0,
		homogeneousClippedPolygonCount: 0,
		homogeneousRejectedTriangleCount: 0,
		inputTriangleCount: 0,
		outputFragmentCount: 0,
		outputVertexCount: 0,
	};
}
