import type { LandblockOwnerId } from "../game-types";
import { createObjectGeometryKey } from "../geometry/types";
import { Mat4 } from "../math/types";
import type { SceneNodeId } from "../scene";
import type { PreparedDynamicDepth } from "./dynamic-depth-preparation";

/** Inject a compiled material-free contract into selection/pass unit tests without GPU allocation. */
export function createDynamicDepthTestFixture(
	nodeId: SceneNodeId,
	landblockId: LandblockOwnerId,
	indexCount: number,
): PreparedDynamicDepth {
	return {
		nodeId,
		landblockId,
		renderScopes: [{ kind: "outdoor" }],
		geometry: createObjectGeometryKey(`depth-fixture:${nodeId}`),
		appearance: {
			kind: "drawable",
			table: {} as WebGLTexture,
			indexBuffer: {} as WebGLBuffer,
			// Pass tests consume the prepared spans, not cold material compilation (tested separately).
			plan: {
				indices: new Uint32Array(indexCount),
				batches: [],
				ranges: [],
				physicalRanges: [],
			},
		},
		parts: [
			{
				frameInstance: {
					color: { a: 1, b: 1, g: 1, r: 1 },
					sourceToLandblock: Mat4.identity(),
				},
			},
		],
		ranges: [{ cullFace: "back", indexStart: 0, indexCount }],
		selectedPartCount: 1,
		selectedTriangleCount: indexCount / 3,
	};
}
