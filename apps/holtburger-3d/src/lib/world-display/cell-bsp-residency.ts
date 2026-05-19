import { Matrix4, Vector3 } from "three";

import type { PreparedPolygonSetBspNode } from "../assets/types";
import type { Vec3Dto } from "../host/contracts";

const CELL_BSP_PLANE_EPSILON = 0.0002;

export function renderLocalPointToAcLocalPoint(point: Vector3): Vec3Dto {
	return {
		x: point.x,
		y: -point.z,
		z: point.y,
	};
}

export function landblockRenderPointToCellAcLocalPoint(
	point: Vector3,
	inverseCellRenderMatrix: Matrix4,
): Vec3Dto {
	return renderLocalPointToAcLocalPoint(
		point.clone().applyMatrix4(inverseCellRenderMatrix),
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
