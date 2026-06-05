import type { PreparedBounds, PreparedEnvCellPayload } from "../assets/types";
import type { PlacementTransformDto } from "../host/contracts";
import type { RenderChunkTransform } from "./render-anchor";
import { buildAcPlacementMatrix, transformPointByMat4 } from "./render-math";
import {
	transformRenderBounds,
	translateRenderBounds,
	type RenderBounds,
	type RenderVec3,
} from "./render-spatial-math";

export function transformEnvCellLocalBounds(
	bounds: PreparedBounds,
	payload: PreparedEnvCellPayload,
	transform: RenderChunkTransform,
): RenderBounds {
	return transformEnvCellLocalBoundsByPlacement(
		bounds,
		payload.localPlacement,
		transform,
	);
}

export function transformEnvCellLocalBoundsByPlacement(
	bounds: PreparedBounds,
	localPlacement: PlacementTransformDto,
	transform: RenderChunkTransform,
): RenderBounds {
	const matrix = buildAcPlacementMatrix(
		localPlacement,
		{ x: 0, y: 0, z: 0 },
		{ x: 1, y: 1, z: 1 },
	);
	const transformedBounds = transformRenderBounds(bounds, (point) =>
		transformPointByMat4(point, matrix),
	);
	return {
		min: {
			x: transformedBounds.min.x + transform.offset.x,
			y: transformedBounds.min.y + transform.offset.y,
			z: transformedBounds.min.z + transform.offset.z,
		},
		max: {
			x: transformedBounds.max.x + transform.offset.x,
			y: transformedBounds.max.y + transform.offset.y,
			z: transformedBounds.max.z + transform.offset.z,
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
