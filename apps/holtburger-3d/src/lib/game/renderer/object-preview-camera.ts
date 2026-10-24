import {
	createCameraLookAtAngles,
	createCameraRotationRadians,
	rotateRenderVector,
} from "../math/camera-orientation";
import { createTranslationMat4, transformPoint3 } from "../math/matrices";
import { type Mat4, type Quat, Vec3 } from "../math/types";
import type { ObjectPreviewFit } from "../preview/object-preview-fit";
import type { ResolvedObjectPreviewViewport } from "../preview/object-preview-viewport";
import type { RenderExtent } from "./render-extent";

/** Vertical projection shared by preview fitting and the renderer camera. */
export const OBJECT_PREVIEW_VERTICAL_FOV_DEGREES = 48;

const OBJECT_PREVIEW_CAMERA_PITCH_RADIANS = -0.18;
const OBJECT_PREVIEW_FRAME_FILL = 0.96;
const OBJECT_PREVIEW_NEAR_CLEARANCE = 0.1;

/** Complete yaw-camera placement and centered object transform for one preview frame. */
export interface ObjectPreviewViewTransform {
	readonly cameraPosition: Vec3;
	readonly cameraRotation: Quat;
	readonly farPlane: number;
	readonly nearPlane: number;
	readonly objectRoot: Mat4;
}

/**
 * Fit every corner of an upright model into the current aspect ratio.
 *
 * AC local +Y forward converts to render -Z, so yaw zero deliberately places the camera on -Z.
 * The fixed camera elevation keeps the presentation readable while yaw remains the only user axis.
 */
export function resolveObjectPreviewViewTransform(
	fit: ObjectPreviewFit,
	yawRadians: number,
	extent: RenderExtent,
): ObjectPreviewViewTransform {
	if (
		!Number.isFinite(yawRadians) ||
		!Number.isInteger(extent.width) ||
		!Number.isInteger(extent.height) ||
		extent.width <= 0 ||
		extent.height <= 0
	)
		throw new Error(
			"Object preview camera requires finite yaw and a positive integer extent.",
		);
	const center = fit.center;
	const orbitDirection = new Vec3(
		Math.sin(yawRadians) * Math.cos(OBJECT_PREVIEW_CAMERA_PITCH_RADIANS),
		-Math.sin(OBJECT_PREVIEW_CAMERA_PITCH_RADIANS),
		-Math.cos(yawRadians) * Math.cos(OBJECT_PREVIEW_CAMERA_PITCH_RADIANS),
	);
	const look = createCameraLookAtAngles(orbitDirection, Vec3.zero());
	const cameraRotation = createCameraRotationRadians(
		look.yawRadians,
		look.pitchRadians,
	);
	const forward = rotateRenderVector(new Vec3(0, 0, -1), cameraRotation);
	const right = rotateRenderVector(new Vec3(1, 0, 0), cameraRotation);
	const up = rotateRenderVector(new Vec3(0, 1, 0), cameraRotation);
	const verticalTangent =
		Math.tan((OBJECT_PREVIEW_VERTICAL_FOV_DEGREES * Math.PI) / 360) *
		OBJECT_PREVIEW_FRAME_FILL;
	const horizontalTangent = verticalTangent * (extent.width / extent.height);
	let distance = OBJECT_PREVIEW_NEAR_CLEARANCE;
	let minimumForwardOffset = Number.POSITIVE_INFINITY;
	let maximumForwardOffset = Number.NEGATIVE_INFINITY;
	const points = fit.supportPoints;
	for (let offset = 0; offset < points.length; offset += 3) {
		const x = points[offset];
		const y = points[offset + 1];
		const z = points[offset + 2];
		if (x === undefined || y === undefined || z === undefined)
			throw new Error(
				"Object preview fit support is not composed of XYZ triples.",
			);
		const centeredX = x - center.x;
		const centeredY = y - center.y;
		const centeredZ = z - center.z;
		const forwardOffset =
			centeredX * forward.x + centeredY * forward.y + centeredZ * forward.z;
		const rightOffset =
			centeredX * right.x + centeredY * right.y + centeredZ * right.z;
		const upOffset = centeredX * up.x + centeredY * up.y + centeredZ * up.z;
		minimumForwardOffset = Math.min(minimumForwardOffset, forwardOffset);
		maximumForwardOffset = Math.max(maximumForwardOffset, forwardOffset);
		distance = Math.max(
			distance,
			Math.abs(rightOffset) / horizontalTangent - forwardOffset,
			Math.abs(upOffset) / verticalTangent - forwardOffset,
			OBJECT_PREVIEW_NEAR_CLEARANCE - forwardOffset,
		);
	}
	const depthSpan = maximumForwardOffset - minimumForwardOffset;
	const planePadding = Math.max(
		OBJECT_PREVIEW_NEAR_CLEARANCE,
		depthSpan * 0.05,
	);
	return {
		cameraPosition: new Vec3(
			orbitDirection.x * distance,
			orbitDirection.y * distance,
			orbitDirection.z * distance,
		),
		cameraRotation,
		farPlane: distance + maximumForwardOffset + planePadding,
		nearPlane: Math.max(0.001, distance + minimumForwardOffset - planePadding),
		objectRoot: createTranslationMat4(
			new Vec3(-center.x, -center.y, -center.z),
		),
	};
}

/** Fit the subject independently from its optional backdrop, which only extends depth coverage. */
export function resolveObjectPreviewCompositionView(
	subject: ObjectPreviewFit,
	background: ObjectPreviewFit | null,
	viewport: Pick<
		ResolvedObjectPreviewViewport,
		"extent" | "cameraYawRadians" | "subjectTransform" | "framing"
	>,
): ObjectPreviewViewTransform {
	const foreground = transformFit(subject, viewport.subjectTransform);
	const framing =
		viewport.framing.kind === "body"
			? foreground
			: transformFit(
					faceFit(viewport.framing.center, viewport.framing.height),
					viewport.subjectTransform,
				);
	const camera = resolveObjectPreviewViewTransform(
		framing,
		viewport.cameraYawRadians,
		viewport.extent,
	);
	const forward = rotateRenderVector(new Vec3(0, 0, -1), camera.cameraRotation);
	let nearPlane = camera.nearPlane;
	let farPlane = camera.farPlane;
	for (const fit of background === null
		? [foreground]
		: [foreground, background]) {
		const points = fit.supportPoints;
		for (let index = 0; index < points.length; index += 3) {
			const x = points[index],
				y = points[index + 1],
				z = points[index + 2];
			if (x === undefined || y === undefined || z === undefined)
				throw new Error(
					"Preview clipping support is not composed of XYZ triples.",
				);
			const point = transformPoint3(camera.objectRoot, new Vec3(x, y, z));
			const depth =
				(point.x - camera.cameraPosition.x) * forward.x +
				(point.y - camera.cameraPosition.y) * forward.y +
				(point.z - camera.cameraPosition.z) * forward.z;
			if (depth <= 0) continue;
			nearPlane = Math.min(
				nearPlane,
				Math.max(0.001, depth - OBJECT_PREVIEW_NEAR_CLEARANCE),
			);
			farPlane = Math.max(farPlane, depth + OBJECT_PREVIEW_NEAR_CLEARANCE);
		}
	}
	return { ...camera, nearPlane, farPlane };
}

function transformFit(
	fit: ObjectPreviewFit,
	transform: Mat4,
): ObjectPreviewFit {
	const supportPoints = new Float32Array(fit.supportPoints.length);
	for (let index = 0; index < fit.supportPoints.length; index += 3) {
		const x = fit.supportPoints[index],
			y = fit.supportPoints[index + 1],
			z = fit.supportPoints[index + 2];
		if (x === undefined || y === undefined || z === undefined)
			throw new Error("Preview fit support is not composed of XYZ triples.");
		const point = transformPoint3(transform, new Vec3(x, y, z));
		supportPoints.set([point.x, point.y, point.z], index);
	}
	return { center: transformPoint3(transform, fit.center), supportPoints };
}

function faceFit(center: Vec3, height: number): ObjectPreviewFit {
	const half = height / 2;
	return {
		center,
		supportPoints: Float32Array.of(
			center.x - half,
			center.y - half,
			center.z,
			center.x + half,
			center.y - half,
			center.z,
			center.x + half,
			center.y + half,
			center.z,
			center.x - half,
			center.y + half,
			center.z,
		),
	};
}
