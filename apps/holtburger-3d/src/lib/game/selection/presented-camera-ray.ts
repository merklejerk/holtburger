import {
	type AcVector3,
	type LandblockVector3,
	landblockVector3,
	renderVector3,
	renderVectorToAc,
} from "../../assets/ac-frame";
import { createLandblockWorldOrigin } from "../landblocks";
import { rotateRenderVector } from "../math/camera-orientation";
import { Vec3 } from "../math/types";
import type { PrimaryCameraView } from "../runtime/types";
import type { PresentedSelectionRay } from "./entity-selection-intersection";

/** Render-space and AC landblock-space rays sampled from one presented primary camera view. */
export interface SampledPresentedCameraRay {
	readonly refinement: PresentedSelectionRay;
	readonly acStart: LandblockVector3;
	readonly acDirection: AcVector3;
}

/**
 * Compute world-space and AC-space selection rays from the exact primary camera view and canvas
 * rect that produced the most recently presented frame.
 */
export function samplePresentedCameraRay(
	view: PrimaryCameraView,
	canvas: HTMLCanvasElement,
	clientX: number,
	clientY: number,
): SampledPresentedCameraRay | null {
	const bounds = canvas.getBoundingClientRect();
	if (
		bounds.width <= 0 ||
		bounds.height <= 0 ||
		view.extent.width <= 0 ||
		view.extent.height <= 0
	)
		return null;
	const normalizedX = ((clientX - bounds.left) / bounds.width) * 2 - 1;
	const normalizedY = 1 - ((clientY - bounds.top) / bounds.height) * 2;
	if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
		return null;
	}
	const tangent = Math.tan((view.camera.fov * Math.PI) / 360);
	const aspect = view.extent.width / view.extent.height;
	const localDirection = new Vec3(
		normalizedX * tangent * aspect,
		normalizedY * tangent,
		-1,
	);
	const localLength = Math.hypot(
		localDirection.x,
		localDirection.y,
		localDirection.z,
	);
	const renderDirection = rotateRenderVector(
		new Vec3(
			localDirection.x / localLength,
			localDirection.y / localLength,
			localDirection.z / localLength,
		),
		view.camera.placement.rotation,
	);
	const acDirection = renderVectorToAc(
		renderVector3([renderDirection.x, renderDirection.y, renderDirection.z]),
	);
	const landblockOrigin = createLandblockWorldOrigin(
		view.camera.placement.landblockId,
	);
	const acStart = renderVectorToAc(
		renderVector3([
			view.camera.placement.position.x - landblockOrigin.x,
			view.camera.placement.position.y - landblockOrigin.y,
			view.camera.placement.position.z - landblockOrigin.z,
		]),
	);
	return {
		refinement: {
			direction: renderDirection,
			start: view.camera.placement.position.clone(),
		},
		acStart: landblockVector3(acStart),
		acDirection,
	};
}
