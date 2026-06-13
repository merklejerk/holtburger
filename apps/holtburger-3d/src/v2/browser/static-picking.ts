import type { FrameState } from "../renderer/types";
import type {
	StaticScenePickContext,
	StaticScenePickRequest,
} from "../runtime/static-scene-query";

const V2_RENDERER_VERTICAL_FOV_RADIANS = Math.PI / 3;

export interface BrowserStaticPickRayInput {
	readonly camera: FrameState["camera"];
	readonly context: StaticScenePickContext;
	readonly filters?: StaticScenePickRequest["filters"];
	readonly clientX: number;
	readonly clientY: number;
	readonly viewport: DOMRectLike;
}

interface DOMRectLike {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

export function createBrowserStaticPickRay(
	input: BrowserStaticPickRayInput,
): StaticScenePickRequest {
	const normalizedX =
		((input.clientX - input.viewport.left) / input.viewport.width) * 2 - 1;
	const normalizedY =
		1 - ((input.clientY - input.viewport.top) / input.viewport.height) * 2;
	const aspect = input.viewport.width / input.viewport.height;
	const tanHalfFov = Math.tan(V2_RENDERER_VERTICAL_FOV_RADIANS / 2);
	const axes = createCameraAxes(input.camera);
	const direction = normalizeVec3(
		addVec3(
			axes.forward,
			addVec3(
				scaleVec3(axes.right, normalizedX * aspect * tanHalfFov),
				scaleVec3(axes.up, normalizedY * tanHalfFov),
			),
		),
	);

	return {
		context: input.context,
		filters: input.filters,
		ray: {
			direction,
			origin: {
				x: input.camera.position[0],
				y: input.camera.position[1],
				z: input.camera.position[2],
			},
		},
	};
}

function createCameraAxes(camera: FrameState["camera"]): {
	readonly forward: Vec3;
	readonly right: Vec3;
	readonly up: Vec3;
} {
	const cosPitch = Math.cos(camera.pitchRadians);
	const forward = normalizeVec3({
		x: Math.sin(camera.yawRadians) * cosPitch,
		y: Math.sin(camera.pitchRadians),
		z: -Math.cos(camera.yawRadians) * cosPitch,
	});
	const right = normalizeVec3(crossVec3(forward, { x: 0, y: 1, z: 0 }));
	const up = normalizeVec3(crossVec3(right, forward));

	return { forward, right, up };
}

interface Vec3 {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

function addVec3(left: Vec3, right: Vec3): Vec3 {
	return {
		x: left.x + right.x,
		y: left.y + right.y,
		z: left.z + right.z,
	};
}

function scaleVec3(vector: Vec3, scale: number): Vec3 {
	return {
		x: vector.x * scale,
		y: vector.y * scale,
		z: vector.z * scale,
	};
}

function crossVec3(left: Vec3, right: Vec3): Vec3 {
	return {
		x: left.y * right.z - left.z * right.y,
		y: left.z * right.x - left.x * right.z,
		z: left.x * right.y - left.y * right.x,
	};
}

function normalizeVec3(vector: Vec3): Vec3 {
	const length = Math.hypot(vector.x, vector.y, vector.z);
	if (length === 0) {
		return { x: 0, y: 0, z: -1 };
	}

	return {
		x: vector.x / length,
		y: vector.y / length,
		z: vector.z / length,
	};
}
