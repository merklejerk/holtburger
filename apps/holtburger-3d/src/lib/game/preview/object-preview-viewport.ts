import { Quat, type Mat4, type Vec3 } from "../math/types";
import { createRotationMat4 } from "../math/matrices";
import type { RenderExtent } from "../renderer/render-extent";
import { validateRenderExtent } from "../renderer/render-extent";

/** Independent preview policy stays frontend-owned: orbit the camera or turn the subject. */
type ObjectPreviewRotation =
	| { readonly kind: "orbit"; readonly yawRadians: number }
	| {
			readonly kind: "subject";
			readonly headingRadians: number;
			/** Fixed viewpoint chosen by the frontend, independent of subject rotation. */
			readonly cameraYawRadians: number;
	  };

/** Face focus is authored by the creator's body policy, independent of any human head-part index. */
export type ObjectPreviewFraming =
	| { readonly kind: "body" }
	| {
			readonly kind: "face";
			/** Focus in unrotated subject coordinates, using render axes. */
			readonly center: Vec3;
			/** Vertical focus span; framing still adapts to the current aspect ratio. */
			readonly height: number;
	  };

/** Cold surface policy; null at the controller boundary suspends drawing and animation time. */
export interface ObjectPreviewViewport {
	/** Physical canvas extent, bounded by the surface owner. */
	readonly extent: RenderExtent;
	/** Positive cadence interval, independent of browser refresh rate. */
	readonly minimumFrameIntervalSeconds: number;
	/** Explicit camera-orbit or independent subject-heading policy. */
	readonly rotation: ObjectPreviewRotation;
	/** Body/equipment fit or creator-owned face focus. */
	readonly framing: ObjectPreviewFraming;
}

/** Derived once at viewport admission; pose and camera consumers read the same rotation facts. */
export interface ResolvedObjectPreviewViewport {
	/** Validated physical extent. */
	readonly extent: RenderExtent;
	/** Validated positive interval. */
	readonly minimumFrameIntervalSeconds: number;
	/** Camera yaw; zero when turning the subject. */
	readonly cameraYawRadians: number;
	/** Subject rotation computed once; identity when orbiting the camera. */
	readonly subjectTransform: Mat4;
	/** Explicit frontend framing policy. */
	readonly framing: ObjectPreviewFraming;
}

/** Admit cold policy and eliminate the rotation-mode branch from frame consumers. */
export function resolveObjectPreviewViewport(
	viewport: ObjectPreviewViewport,
): ResolvedObjectPreviewViewport {
	validateRenderExtent(viewport.extent, "Object preview canvas");
	const cameraYawRadians =
		viewport.rotation.kind === "orbit"
			? viewport.rotation.yawRadians
			: viewport.rotation.cameraYawRadians;
	const subjectHeadingRadians =
		viewport.rotation.kind === "subject" ? viewport.rotation.headingRadians : 0;
	if (
		!Number.isFinite(viewport.minimumFrameIntervalSeconds) ||
		viewport.minimumFrameIntervalSeconds <= 0
	)
		throw new Error(
			"Object preview frame interval must be positive and finite.",
		);
	if (
		!Number.isFinite(cameraYawRadians) ||
		!Number.isFinite(subjectHeadingRadians)
	)
		throw new Error("Object preview rotation must be finite.");
	if (viewport.framing.kind === "face") {
		if (
			!Number.isFinite(viewport.framing.height) ||
			viewport.framing.height <= 0
		)
			throw new Error("Object preview face span must be positive and finite.");
		const { x, y, z } = viewport.framing.center;
		if (![x, y, z].every(Number.isFinite))
			throw new Error("Object preview face focus must be finite.");
	}
	return {
		extent: viewport.extent,
		minimumFrameIntervalSeconds: viewport.minimumFrameIntervalSeconds,
		cameraYawRadians,
		subjectTransform: createRotationMat4(
			new Quat(
				Math.cos(subjectHeadingRadians / 2),
				0,
				Math.sin(subjectHeadingRadians / 2),
				0,
			),
		),
		framing: viewport.framing,
	};
}
