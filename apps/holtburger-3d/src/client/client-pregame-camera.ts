import { sceneVec3, type SceneVec3 } from "../lib/assets/ac-frame";
import type { ObjectPreviewFraming } from "../lib/game/preview/object-preview-viewport";
import { rotateRenderVector } from "../lib/game/math/camera-orientation";
import { type Quat, Vec3 } from "../lib/game/math/types";
import {
	createYawSweep,
	yawSweepSupport,
	type ModelFit,
} from "../lib/game/geometry/model-fit";

/** Keep the camera in front of its focus even when tuning requests a zero or negative distance. */
const MINIMUM_CAMERA_DISTANCE = 0.001;

/** CSS rectangle measured relative to the world canvas, independent of render density. */
export interface PregameCharacterRectangle {
	/** Horizontal offset from the canvas's left edge. */
	readonly left: number;
	/** Vertical offset from the canvas's top edge. */
	readonly top: number;
	/** Reserved horizontal span in CSS pixels. */
	readonly width: number;
	/** Reserved vertical span in CSS pixels. */
	readonly height: number;
}

/** Dimensionless camera preferences applied to the full-turn framing distance. */
export interface PregameCameraOffset {
	/** World-up focus shift as a fraction of the body or face-focus height; 0.1 means 10%. */
	readonly heightOffsetFraction: number;
	/** Signed change from the full-turn fit distance; negative values zoom in and may crop the frame. */
	readonly distanceOffsetFraction: number;
}

/** Composition facts keep source-local support separate from its canonical scene placement. */
export interface PregameCameraRequest {
	/** Installed support and focus, including the model's original source scale. */
	readonly fit: ModelFit;
	/** UI focus changes the camera target, never the body's scene scale or spatial support. */
	readonly framing: ObjectPreviewFraming;
	/** Per-focus camera preference applied before fitting. */
	readonly offset: PregameCameraOffset;
	/** Upright staging transform; source scale is already contained in the prepared fit. */
	readonly subject: {
		readonly position: SceneVec3;
		/** User rotation relative to facing the fitted camera. */
		readonly yawOffsetRadians: number;
	};
	/** Live UI space reserved for this subject. */
	readonly rectangle: PregameCharacterRectangle;
	/** Full world viewport in the same CSS coordinate system as the rectangle. */
	readonly canvas: { readonly width: number; readonly height: number };
	/** Fixed camera viewing basis; subject orientation is resolved from the framing ray. */
	readonly rotation: Quat;
	/** World projection retained while the camera translates to fit the subject. */
	readonly projection: {
		/** Full vertical field of view. */
		readonly fovDegrees: number;
		/** Actual drawing-buffer aspect, including resolution-scale rounding. */
		readonly aspectRatio: number;
	};
	/** Inset on every edge of the reserved rectangle, in CSS pixels. */
	readonly margin: number;
}

/** Hidden layouts suspend; visible layouts require enough space for the framing margin. */
type PregameCameraOutcome =
	| { readonly kind: "suspended" }
	| { readonly kind: "limited" }
	| {
			readonly kind: "ready";
			readonly position: SceneVec3;
			readonly rotation: Quat;
			/** Upright subject heading used by both fitting and scene placement. */
			readonly headingRadians: number;
	  };

/** Fit through the full canvas's symmetric projection by camera translation alone. */
export function resolvePregameCamera(
	request: PregameCameraRequest,
): PregameCameraOutcome {
	const { rectangle, canvas, projection, margin, rotation, subject } = request;
	if (
		rectangle.width <= 0 ||
		rectangle.height <= 0 ||
		canvas.width <= 0 ||
		canvas.height <= 0
	)
		return { kind: "suspended" };
	// Responsive pages can scroll or extend past the canvas; only their visible area can frame a subject.
	const visibleLeft = Math.max(0, rectangle.left);
	const visibleTop = Math.max(0, rectangle.top);
	const visibleRight = Math.min(canvas.width, rectangle.left + rectangle.width);
	const visibleBottom = Math.min(
		canvas.height,
		rectangle.top + rectangle.height,
	);
	if (visibleRight <= visibleLeft || visibleBottom <= visibleTop)
		return { kind: "suspended" };
	if (
		visibleRight - visibleLeft <= 2 * margin ||
		visibleBottom - visibleTop <= 2 * margin
	)
		return { kind: "limited" };
	const left = (2 * (visibleLeft + margin)) / canvas.width - 1;
	const right = (2 * (visibleRight - margin)) / canvas.width - 1;
	const bottom = 1 - (2 * (visibleBottom - margin)) / canvas.height;
	const top = 1 - (2 * (visibleTop + margin)) / canvas.height;
	const cx = (left + right) / 2;
	const cy = (bottom + top) / 2;
	const vertical = Math.tan((projection.fovDegrees * Math.PI) / 360);
	const horizontal = vertical * projection.aspectRatio;
	const forward = rotateRenderVector(new Vec3(0, 0, -1), rotation);
	const rightAxis = rotateRenderVector(new Vec3(1, 0, 0), rotation);
	const up = rotateRenderVector(new Vec3(0, 1, 0), rotation);
	// The reserved rectangle can be off-center. Its ray determines the actual camera-to-focus
	// direction independently of fit distance, so heading and camera placement share one fact.
	const viewRay = new Vec3(
		forward.x + cx * horizontal * rightAxis.x + cy * vertical * up.x,
		forward.y + cx * horizontal * rightAxis.y + cy * vertical * up.y,
		forward.z + cx * horizontal * rightAxis.z + cy * vertical * up.z,
	);
	const headingRadians =
		Math.atan2(viewRay.x, viewRay.z) + subject.yawOffsetRadians;
	const fit = pregameCharacterFit(request.fit, request.framing);
	if (
		!Number.isFinite(request.offset.heightOffsetFraction) ||
		!Number.isFinite(request.offset.distanceOffsetFraction)
	)
		throw new Error("Pregame camera offsets must be finite.");
	const envelope = createYawSweep(fit.supportPoints, Vec3.zero());
	const focusHeight =
		fit.center.y +
		(envelope.maximumY - envelope.minimumY) *
			request.offset.heightOffsetFraction;
	// The focus stays on the staging axis while the body or face turns around it.
	const sweep = {
		...envelope,
		minimumY: envelope.minimumY - focusHeight,
		maximumY: envelope.maximumY - focusHeight,
	};
	const center = new Vec3(
		subject.position.x,
		subject.position.y + focusHeight,
		subject.position.z,
	);
	const support = (x: number, y: number, z: number): number =>
		yawSweepSupport(
			sweep,
			new Vec3(
				x * rightAxis.x + y * up.x + z * forward.x,
				x * rightAxis.y + y * up.y + z * forward.y,
				x * rightAxis.z + y * up.z + z * forward.z,
			),
		);
	// Solve each projection edge over the complete turn, independently of the current heading.
	const distanceToFit = Math.max(
		support(-1 / horizontal, 0, left) / (cx - left),
		support(1 / horizontal, 0, -right) / (right - cx),
		support(0, -1 / vertical, bottom) / (cy - bottom),
		support(0, 1 / vertical, -top) / (top - cy),
	);
	const distance = Math.max(
		MINIMUM_CAMERA_DISTANCE,
		distanceToFit * (1 + request.offset.distanceOffsetFraction),
	);
	const position = sceneVec3(
		new Vec3(
			center.x - distance * viewRay.x,
			center.y - distance * viewRay.y,
			center.z - distance * viewRay.z,
		),
	);
	return { kind: "ready", position, rotation, headingRadians };
}

/** Face policy supplies a focus volume independent of the body envelope. */
function pregameCharacterFit(
	body: ModelFit,
	framing: ObjectPreviewFraming,
): ModelFit {
	if (framing.kind === "body") return body;
	const half = framing.height / 2;
	if (!Number.isFinite(half) || half <= 0)
		throw new Error("Pregame face focus height must be finite and positive.");
	const { center } = framing;
	const points: number[] = [];
	for (const x of [-half, half])
		for (const y of [-half, half])
			for (const z of [-half, half])
				points.push(center.x + x, center.y + y, center.z + z);
	return { center, supportPoints: new Float32Array(points) };
}
