import type { PreparedPolygonSetBspNode } from "../assets/types";
import type { Vec3Dto } from "../host/contracts";
import { transformPointByMat4, type RenderMat4 } from "./render-math";

const CELL_BSP_PLANE_EPSILON = 0.0002;

export function renderLocalPointToAcLocalPoint(point: Vec3Dto): Vec3Dto {
	return {
		x: point.x,
		y: -point.z,
		z: point.y,
	};
}

export function landblockRenderPointToCellAcLocalPoint(
	point: Vec3Dto,
	inverseCellRenderMatrix: RenderMat4,
): Vec3Dto {
	return renderLocalPointToAcLocalPoint(
		transformPointByMat4(point, inverseCellRenderMatrix),
	);
}

export function pointInsideCellBsp(
	node: PreparedPolygonSetBspNode,
	point: Vec3Dto,
	epsilon = CELL_BSP_PLANE_EPSILON,
): boolean {
	let current: PreparedPolygonSetBspNode | null = node;
	while (current) {
		if (current.kind === "leaf") {
			return true;
		}

		const signedDistance =
			current.plane.normal.x * point.x +
			current.plane.normal.y * point.y +
			current.plane.normal.z * point.z +
			current.plane.d;
		if (signedDistance < -epsilon) {
			return false;
		}

		current = current.pos;
		if (!current) {
			return true;
		}
	}

	return true;
}
