import { createFrustumFromClipMatrix, type Frustum } from "../math/frustum";
import {
	createOrthographicMat4,
	createRotationMat4,
	multiplyMat4,
} from "../math/matrices";
import { Mat4, Quat, Vec3 } from "../math/types";
import { crossVec3, normalizeVec3 } from "../math/vector-utils";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import {
	createOutdoorPssmSettings,
	type OutdoorPssmSettings,
} from "./entity-shadow-policy";

/** Anchor-relative camera facts required to construct directional shadow cascades. */
export interface OutdoorPssmCamera {
	readonly position: Vec3;
	readonly rotation: Quat;
	readonly verticalFovDegrees: number;
	readonly aspectRatio: number;
	readonly near: number;
	readonly far: number;
}

/** Pure inputs for one frame's outdoor cascade construction. */
export interface OutdoorPssmBuildInput {
	readonly camera: OutdoorPssmCamera;
	/** Regional vector toward the sun; magnitude is ignored by light-view construction. */
	readonly sunVector: Vec3;
	readonly settings: OutdoorPssmSettings;
}

/** Conservatively retain a landblock whose horizontal footprint reaches shadow distance. */
export function terrainLandblockIntersectsShadowDistance(
	coordinates: Readonly<{ x: number; y: number }>,
	anchorCoordinates: Readonly<{ x: number; y: number }>,
	cameraPosition: Readonly<{ x: number; z: number }>,
	maximumDistance: number,
): boolean {
	const minimumX =
		(coordinates.x - anchorCoordinates.x) * OUTDOOR_LANDBLOCK_WORLD_SIZE;
	const maximumX = minimumX + OUTDOOR_LANDBLOCK_WORLD_SIZE;
	const maximumZ =
		-(coordinates.y - anchorCoordinates.y) * OUTDOOR_LANDBLOCK_WORLD_SIZE;
	const minimumZ = maximumZ - OUTDOOR_LANDBLOCK_WORLD_SIZE;
	const distanceX = Math.max(
		minimumX - cameraPosition.x,
		0,
		cameraPosition.x - maximumX,
	);
	const distanceZ = Math.max(
		minimumZ - cameraPosition.z,
		0,
		cameraPosition.z - maximumZ,
	);
	return (
		distanceX * distanceX + distanceZ * distanceZ <=
		maximumDistance * maximumDistance
	);
}

/** One camera slice and the stable directional-light volume fitted around it. */
export interface OutdoorPssmCascade {
	readonly index: number;
	/** Near edge represented by this map, including predecessor blend overlap. */
	readonly coverageNear: number;
	readonly splitNear: number;
	readonly splitFar: number;
	/** Camera distance where blending into the next cascade begins. */
	readonly transitionStart: number;
	/** Eight anchor-relative camera-slice corners, near plane first. */
	readonly sliceCorners: readonly Vec3[];
	readonly lightView: Mat4;
	readonly lightProjection: Mat4;
	readonly lightClip: Mat4;
	/** Query volume extracted from the exact clip transform used by caster rendering. */
	readonly lightFrustum: Frustum;
	/** World-space width and height represented by one depth texel. */
	readonly texelWorldSize: number;
}

type MutableOutdoorPssmCascade = {
	-readonly [Field in keyof OutdoorPssmCascade]: OutdoorPssmCascade[Field];
};

/** Build practical split endpoints including the exact near and far boundaries. */
export function createPracticalCascadeSplits(
	near: number,
	far: number,
	cascadeCount: number,
	lambda: number,
	out: number[] = [],
): number[] {
	if (
		!Number.isFinite(near) ||
		!Number.isFinite(far) ||
		near <= 0 ||
		far <= near
	) {
		throw new Error(
			"PSSM splits require a finite non-empty positive camera interval.",
		);
	}
	if (!Number.isInteger(cascadeCount) || cascadeCount <= 0) {
		throw new Error("PSSM split cascade count must be a positive integer.");
	}
	if (!Number.isFinite(lambda) || lambda < 0 || lambda > 1) {
		throw new Error("PSSM split lambda must be finite and within [0, 1].");
	}
	out.length = cascadeCount + 1;
	out[0] = near;
	for (let index = 1; index < cascadeCount; index += 1) {
		const ratio = index / cascadeCount;
		const uniform = near + (far - near) * ratio;
		const logarithmic = near * Math.pow(far / near, ratio);
		out[index] = uniform + (logarithmic - uniform) * lambda;
	}
	out[cascadeCount] = far;
	return out;
}

/** Reconstruct one perspective camera slice into optional caller-owned corner storage. */
export function writeFrustumSliceCorners(
	camera: OutdoorPssmCamera,
	sliceNear: number,
	sliceFar: number,
	out: Vec3[] = [],
): Vec3[] {
	validateCamera(camera);
	if (
		!Number.isFinite(sliceNear) ||
		!Number.isFinite(sliceFar) ||
		sliceNear < camera.near ||
		sliceFar > camera.far ||
		sliceFar <= sliceNear
	) {
		throw new Error(
			"PSSM frustum slice must lie inside the camera's non-empty interval.",
		);
	}
	const axes = cameraAxes(camera.rotation);
	const tangent = Math.tan((camera.verticalFovDegrees * Math.PI) / 360);
	writePlaneCorners(
		out,
		0,
		camera.position,
		axes,
		sliceNear,
		tangent,
		camera.aspectRatio,
	);
	writePlaneCorners(
		out,
		4,
		camera.position,
		axes,
		sliceFar,
		tangent,
		camera.aspectRatio,
	);
	out.length = 8;
	return out;
}

/** Build stable square light fits into one caller-owned cascade array. */
export function buildOutdoorPssmCascades(
	input: OutdoorPssmBuildInput,
	out: OutdoorPssmCascade[] = [],
): OutdoorPssmCascade[] {
	validateCamera(input.camera);
	const settings = createOutdoorPssmSettings(input.settings);
	const sunLength = Math.hypot(
		input.sunVector.x,
		input.sunVector.y,
		input.sunVector.z,
	);
	if (!Number.isFinite(sunLength) || sunLength <= Number.EPSILON) {
		throw new Error("Outdoor PSSM requires a finite non-zero sun vector.");
	}
	const coveredFar = Math.min(input.camera.far, settings.maximumDistance);
	if (coveredFar <= input.camera.near) {
		throw new Error(
			"Outdoor PSSM maximum distance must extend beyond the camera near plane.",
		);
	}
	const splits = createPracticalCascadeSplits(
		input.camera.near,
		coveredFar,
		settings.cascadeCount,
		settings.splitLambda,
	);
	const directionTowardSun = normalizeVec3(input.sunVector);
	const lightForward = new Vec3(
		-directionTowardSun.x,
		-directionTowardSun.y,
		-directionTowardSun.z,
	);
	const upReference =
		Math.abs(lightForward.y) < 0.95 ? new Vec3(0, 1, 0) : new Vec3(0, 0, 1);
	const lightRight = normalizeVec3(crossVec3(lightForward, upReference));
	const lightUp = crossVec3(lightRight, lightForward);

	for (let index = 0; index < settings.cascadeCount; index += 1) {
		const existing = out[index] as MutableOutdoorPssmCascade | undefined;
		const splitNear = splits[index]!;
		const splitFar = splits[index + 1]!;
		const coverageNear =
			index === 0
				? splitNear
				: splitNear -
					(splits[index]! - splits[index - 1]!) * settings.transitionFraction;
		const corners = writeFrustumSliceCorners(
			input.camera,
			coverageNear,
			splitFar,
			existing?.sliceCorners as Vec3[] | undefined,
		);
		const center = averagePoints(corners);
		let radius = 0;
		for (const corner of corners) {
			radius = Math.max(
				radius,
				Math.hypot(
					corner.x - center.x,
					corner.y - center.y,
					corner.z - center.z,
				),
			);
		}
		// One nominal texel of guard band contains the at-most-half-texel center snap.
		const halfExtent = radius * (1 + 2 / settings.mapResolution);
		const texelWorldSize = (2 * halfExtent) / settings.mapResolution;
		const snappedCenterX =
			Math.round(dot(center, lightRight) / texelWorldSize) * texelWorldSize;
		const snappedCenterY =
			Math.round(dot(center, lightUp) / texelWorldSize) * texelWorldSize;
		let minimumForward = Number.POSITIVE_INFINITY;
		let maximumForward = Number.NEGATIVE_INFINITY;
		for (const corner of corners) {
			const forward = dot(corner, lightForward);
			minimumForward = Math.min(minimumForward, forward);
			maximumForward = Math.max(maximumForward, forward);
		}
		const eyeForward = minimumForward - settings.casterSearchPadding;
		const eye = new Vec3(
			lightRight.x * snappedCenterX +
				lightUp.x * snappedCenterY +
				lightForward.x * eyeForward,
			lightRight.y * snappedCenterX +
				lightUp.y * snappedCenterY +
				lightForward.y * eyeForward,
			lightRight.z * snappedCenterX +
				lightUp.z * snappedCenterY +
				lightForward.z * eyeForward,
		);
		const lightView = createDirectionalView(
			lightRight,
			lightUp,
			lightForward,
			eye,
			existing?.lightView,
		);
		const lightProjection = createOrthographicMat4(
			-halfExtent,
			halfExtent,
			-halfExtent,
			halfExtent,
			0,
			maximumForward - eyeForward,
			existing?.lightProjection,
		);
		const lightClip = multiplyMat4(
			lightProjection,
			lightView,
			existing?.lightClip,
		);
		const transitionStart =
			index + 1 < settings.cascadeCount
				? splitFar - (splitFar - splitNear) * settings.transitionFraction
				: splitFar;
		const lightFrustum = createFrustumFromClipMatrix(
			lightClip,
			eye,
			existing?.lightFrustum,
		);
		const resolved: OutdoorPssmCascade = existing ?? {
			index,
			coverageNear,
			splitNear,
			splitFar,
			transitionStart,
			sliceCorners: corners,
			lightView,
			lightProjection,
			lightClip,
			lightFrustum,
			texelWorldSize,
		};
		if (existing) {
			existing.index = index;
			existing.coverageNear = coverageNear;
			existing.splitNear = splitNear;
			existing.splitFar = splitFar;
			existing.transitionStart = transitionStart;
			existing.sliceCorners = corners;
			existing.lightView = lightView;
			existing.lightProjection = lightProjection;
			existing.lightClip = lightClip;
			existing.lightFrustum = lightFrustum;
			existing.texelWorldSize = texelWorldSize;
		}
		out[index] = resolved;
	}
	out.length = settings.cascadeCount;
	return out;
}

interface OrthonormalAxes {
	readonly forward: Vec3;
	readonly right: Vec3;
	readonly up: Vec3;
}

function cameraAxes(rotation: Quat): OrthonormalAxes {
	const length = Math.hypot(rotation.w, rotation.x, rotation.y, rotation.z);
	const normalized = new Quat(
		rotation.w / length,
		rotation.x / length,
		rotation.y / length,
		rotation.z / length,
	);
	const matrix = createRotationMat4(normalized);
	return {
		right: new Vec3(matrix.m11, matrix.m12, matrix.m13),
		up: new Vec3(matrix.m21, matrix.m22, matrix.m23),
		forward: new Vec3(-matrix.m31, -matrix.m32, -matrix.m33),
	};
}

function writePlaneCorners(
	out: Vec3[],
	start: number,
	position: Vec3,
	axes: OrthonormalAxes,
	distance: number,
	verticalTangent: number,
	aspectRatio: number,
): void {
	const halfHeight = distance * verticalTangent;
	const halfWidth = halfHeight * aspectRatio;
	const centerX = position.x + axes.forward.x * distance;
	const centerY = position.y + axes.forward.y * distance;
	const centerZ = position.z + axes.forward.z * distance;
	const signs = [
		[-1, -1],
		[1, -1],
		[-1, 1],
		[1, 1],
	] as const;
	for (let index = 0; index < signs.length; index += 1) {
		const [rightSign, upSign] = signs[index]!;
		const target = out[start + index] ?? Vec3.zero();
		target.x =
			centerX +
			axes.right.x * halfWidth * rightSign +
			axes.up.x * halfHeight * upSign;
		target.y =
			centerY +
			axes.right.y * halfWidth * rightSign +
			axes.up.y * halfHeight * upSign;
		target.z =
			centerZ +
			axes.right.z * halfWidth * rightSign +
			axes.up.z * halfHeight * upSign;
		out[start + index] = target;
	}
}

function averagePoints(points: readonly Vec3[]): Vec3 {
	const center = Vec3.zero();
	for (const point of points) {
		center.x += point.x;
		center.y += point.y;
		center.z += point.z;
	}
	center.x /= points.length;
	center.y /= points.length;
	center.z /= points.length;
	return center;
}

function createDirectionalView(
	right: Vec3,
	up: Vec3,
	forward: Vec3,
	eye: Vec3,
	targetMatrix?: Mat4,
): Mat4 {
	const back = new Vec3(-forward.x, -forward.y, -forward.z);
	const target = targetMatrix ?? Mat4.zero();
	target.m11 = right.x;
	target.m12 = up.x;
	target.m13 = back.x;
	target.m14 = 0;
	target.m21 = right.y;
	target.m22 = up.y;
	target.m23 = back.y;
	target.m24 = 0;
	target.m31 = right.z;
	target.m32 = up.z;
	target.m33 = back.z;
	target.m34 = 0;
	target.m41 = -dot(right, eye);
	target.m42 = -dot(up, eye);
	target.m43 = -dot(back, eye);
	target.m44 = 1;
	return target;
}

function dot(left: Vec3, right: Vec3): number {
	return left.x * right.x + left.y * right.y + left.z * right.z;
}

function validateCamera(camera: OutdoorPssmCamera): void {
	if (
		!Number.isFinite(camera.verticalFovDegrees) ||
		camera.verticalFovDegrees <= 0 ||
		camera.verticalFovDegrees >= 180 ||
		!Number.isFinite(camera.aspectRatio) ||
		camera.aspectRatio <= 0
	) {
		throw new Error(
			"Outdoor PSSM camera framing must be finite and non-degenerate.",
		);
	}
	if (
		!Number.isFinite(camera.near) ||
		!Number.isFinite(camera.far) ||
		camera.near <= 0 ||
		camera.far <= camera.near
	) {
		throw new Error(
			"Outdoor PSSM camera depth interval must be finite and non-empty.",
		);
	}
	if (
		![camera.position.x, camera.position.y, camera.position.z].every(
			Number.isFinite,
		)
	) {
		throw new Error("Outdoor PSSM camera position must be finite.");
	}
	const rotationLength = Math.hypot(
		camera.rotation.w,
		camera.rotation.x,
		camera.rotation.y,
		camera.rotation.z,
	);
	if (!Number.isFinite(rotationLength) || rotationLength <= Number.EPSILON) {
		throw new Error(
			"Outdoor PSSM camera rotation must be finite and non-zero.",
		);
	}
}
