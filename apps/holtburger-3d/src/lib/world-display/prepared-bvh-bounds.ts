import { Box3, Vector3 } from "three";

import type { PreparedBounds, PreparedEnvCellPayload } from "../assets/types";
import type { RenderChunkTransform } from "./render-anchor";
import {
	translateRenderBounds,
	type RenderBounds,
	type RenderVec3,
} from "./render-spatial-math";
import { buildAcPlacementMatrix } from "./static-renderable-geometry";

export function transformEnvCellLocalBounds(
	bounds: PreparedBounds,
	payload: PreparedEnvCellPayload,
	transform: RenderChunkTransform,
): RenderBounds {
	const matrix = buildAcPlacementMatrix(
		payload.localPlacement,
		{ x: 0, y: 0, z: 0 },
		{ x: 1, y: 1, z: 1 },
	);
	const box = new Box3(
		new Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
		new Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
	).applyMatrix4(matrix);
	return {
		min: {
			x: box.min.x + transform.offset.x,
			y: box.min.y + transform.offset.y,
			z: box.min.z + transform.offset.z,
		},
		max: {
			x: box.max.x + transform.offset.x,
			y: box.max.y + transform.offset.y,
			z: box.max.z + transform.offset.z,
		},
	};
}

export function transformTerrainLocalBounds(
	bounds: PreparedBounds,
	chunkOffset: RenderVec3,
): RenderBounds {
	return translateRenderBounds(
		{
			min: {
				x: bounds.min.x,
				y: bounds.min.z,
				z: -bounds.max.y,
			},
			max: {
				x: bounds.max.x,
				y: bounds.max.z,
				z: -bounds.min.y,
			},
		},
		chunkOffset,
	);
}
