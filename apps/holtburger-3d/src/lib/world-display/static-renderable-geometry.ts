import {
	BufferAttribute,
	BufferGeometry,
	Color,
	Matrix4,
	Quaternion as ThreeQuaternion,
	Vector3,
} from "three";

import type { PreparedPolygonSetRenderGeometry } from "../assets/types";
import type { PlacementTransformDto, Vec3Dto } from "../host/contracts";
import type { StaticRenderablePart } from "./static-renderables";

export function buildStaticRenderablePartMatrix(
	part: StaticRenderablePart,
): Matrix4 {
	const matrix = new Matrix4();
	for (const parentPlacement of part.parentPlacements) {
		matrix.multiply(
			buildAcPlacementMatrix(
				parentPlacement,
				{ x: 0, y: 0, z: 0 },
				{ x: 1, y: 1, z: 1 },
			),
		);
	}
	matrix.multiply(
		buildAcPlacementMatrix(part.instancePlacement, part.landblockWorldOffset, {
			x: 1,
			y: 1,
			z: 1,
		}),
	);
	for (const partPlacement of part.partPlacements) {
		matrix.multiply(
			buildAcPlacementMatrix(
				partPlacement,
				{ x: 0, y: 0, z: 0 },
				{ x: 1, y: 1, z: 1 },
			),
		);
	}
	matrix.multiply(
		new Matrix4().makeScale(part.scale.x, part.scale.z, part.scale.y),
	);
	return matrix;
}

export function buildGfxObjGeometry(
	renderGeometry: PreparedPolygonSetRenderGeometry,
): BufferGeometry {
	const geometry = new BufferGeometry();
	geometry.setAttribute(
		"position",
		new BufferAttribute(new Float32Array(renderGeometry.positions), 3),
	);
	if (renderGeometry.normals.length === renderGeometry.positions.length) {
		geometry.setAttribute(
			"normal",
			new BufferAttribute(new Float32Array(renderGeometry.normals), 3),
		);
	} else {
		geometry.computeVertexNormals();
	}
	if (renderGeometry.uvs.length > 0) {
		geometry.setAttribute(
			"uv",
			new BufferAttribute(new Float32Array(renderGeometry.uvs), 2),
		);
	}
	return geometry;
}

export function buildStaticRenderableColor(debugColorKey: string): Color {
	let hash = 0;
	for (let index = 0; index < debugColorKey.length; index += 1) {
		hash = (hash * 31 + debugColorKey.charCodeAt(index)) >>> 0;
	}

	return new Color().setHSL((hash % 360) / 360, 0.54, 0.48);
}

export function buildAcPlacementMatrix(
	placement: PlacementTransformDto,
	worldOffset: Vec3Dto,
	scale: { x: number; y: number; z: number },
): Matrix4 {
	return new Matrix4().compose(
		new Vector3(
			placement.origin.x + worldOffset.x,
			placement.origin.z + worldOffset.z,
			-(placement.origin.y + worldOffset.y),
		),
		convertAcQuaternion(placement.orientation),
		new Vector3(scale.x, scale.y, scale.z),
	);
}

function convertAcQuaternion(
	quaternion: PlacementTransformDto["orientation"],
): ThreeQuaternion {
	const acRotation = new Matrix4().makeRotationFromQuaternion(
		new ThreeQuaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w),
	);
	const acToThree = new Matrix4().set(
		1,
		0,
		0,
		0,
		0,
		0,
		1,
		0,
		0,
		-1,
		0,
		0,
		0,
		0,
		0,
		1,
	);
	const threeToAc = acToThree.clone().invert();
	const threeRotation = acToThree.multiply(acRotation).multiply(threeToAc);
	return new ThreeQuaternion().setFromRotationMatrix(threeRotation);
}
