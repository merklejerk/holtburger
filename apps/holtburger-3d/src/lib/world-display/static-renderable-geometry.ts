import {
	BufferAttribute,
	BufferGeometry,
	Color,
	Matrix4,
	Quaternion as ThreeQuaternion,
	Vector3,
} from "three";

import type { PreparedGfxObjRenderGeometry } from "../assets/types";
import type { StaticRenderablePart } from "./static-renderables";

export function buildStaticRenderablePartMatrix(
	part: StaticRenderablePart,
): Matrix4 {
	const matrix = frameToMatrix(part.instanceFrame, part.landblockWorldOffset, {
		x: 1,
		y: 1,
		z: 1,
	});
	for (const placementFrame of part.placementFrames) {
		matrix.multiply(
			frameToMatrix(placementFrame, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }),
		);
	}
	matrix.multiply(
		new Matrix4().makeScale(part.scale.x, part.scale.z, part.scale.y),
	);
	return matrix;
}

export function buildGfxObjGeometry(
	renderGeometry: PreparedGfxObjRenderGeometry,
): BufferGeometry {
	const geometry = new BufferGeometry();
	geometry.setAttribute(
		"position",
		new BufferAttribute(convertAcVectorTriplets(renderGeometry.positions), 3),
	);
	if (renderGeometry.normals.length === renderGeometry.positions.length) {
		geometry.setAttribute(
			"normal",
			new BufferAttribute(convertAcVectorTriplets(renderGeometry.normals), 3),
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

function frameToMatrix(
	frame: StaticRenderablePart["instanceFrame"],
	landblockWorldOffset: StaticRenderablePart["landblockWorldOffset"],
	scale: { x: number; y: number; z: number },
): Matrix4 {
	return new Matrix4().compose(
		new Vector3(
			frame.origin.x + landblockWorldOffset.x,
			frame.origin.z + landblockWorldOffset.z,
			-(frame.origin.y + landblockWorldOffset.y),
		),
		convertAcQuaternion(frame.orientation),
		new Vector3(scale.x, scale.y, scale.z),
	);
}

function convertAcQuaternion(
	quaternion: StaticRenderablePart["instanceFrame"]["orientation"],
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

function convertAcVectorTriplets(values: number[]): Float32Array {
	const converted = new Float32Array(values.length);
	for (let index = 0; index < values.length; index += 3) {
		converted[index] = values[index] ?? 0;
		converted[index + 1] = values[index + 2] ?? 0;
		converted[index + 2] = -(values[index + 1] ?? 0);
	}
	return converted;
}
