import type { PlayingClip } from "../animation/animation-playback";
import { sampleAnimationPoseOver } from "../animation/animation-playback";
import { transformPoint3 } from "../math/matrices";
import { type AABB3, type Mat4, Vec3 } from "../math/types";
import { composeObjectPartTransform } from "../resolution/object-part-transform";
import type { PartVisualTemplate } from "../systems/object-visual-template-repository";

/** Stable articulated support volume consumed by the analytic preview camera. */
export interface ObjectPreviewFit {
	readonly center: Vec3;
	/** Packed XYZ triples; immutable after preparation and scanned only when camera policy changes. */
	readonly supportPoints: Float32Array;
}

/**
 * Sample each rigid part's own transformed box across the selected idle sequence.
 *
 * Keeping the boxes separate avoids the impossible corners introduced by one union AABB while
 * retaining a stable camera over animation. Quarter-frame sampling matches the preview animation
 * envelope policy and includes every authored endpoint.
 */
export function createObjectPreviewFit(
	parts: readonly PartVisualTemplate[],
	setupPose: readonly Mat4[],
	scale: Vec3,
	clips: readonly PlayingClip[],
	rotationInvariant: boolean,
): ObjectPreviewFit {
	const points: number[] = [];
	appendPoseSupport(points, parts, setupPose, scale);
	for (const clip of clips) {
		for (
			let framePosition = clip.lowFrame;
			framePosition <= clip.highFrame;
			framePosition += 0.25
		)
			appendPoseSupport(
				points,
				parts,
				sampleAnimationPoseOver(clip, framePosition, setupPose),
				scale,
			);
	}
	if (points.length === 0)
		throw new Error("The object preview visual has no bounded geometry.");
	return rotationInvariant
		? horizontalRotationInvariantFit(points)
		: fitFromSupportPoints(points);
}

function appendPoseSupport(
	output: number[],
	parts: readonly PartVisualTemplate[],
	pose: readonly Mat4[],
	scale: Vec3,
): void {
	for (const part of parts) {
		if (part.localBounds === null) continue;
		const transform = pose[part.partIndex];
		if (!transform)
			throw new Error(
				`Object preview pose has no frame for setup part ${part.partIndex}.`,
			);
		const partToPreview = composeObjectPartTransform(
			transform,
			scale,
			part.defaultScale,
		);
		for (const corner of boundsCorners(part.localBounds)) {
			const point = transformPoint3(partToPreview, corner);
			output.push(point.x, point.y, point.z);
		}
	}
}

function horizontalRotationInvariantFit(
	points: readonly number[],
): ObjectPreviewFit {
	let radiusSquared = 0;
	let minimumY = Number.POSITIVE_INFINITY;
	let maximumY = Number.NEGATIVE_INFINITY;
	for (let offset = 0; offset < points.length; offset += 3) {
		const x = points[offset];
		const y = points[offset + 1];
		const z = points[offset + 2];
		if (x === undefined || y === undefined || z === undefined)
			throw new Error(
				"Object preview fit support is not composed of XYZ triples.",
			);
		radiusSquared = Math.max(radiusSquared, x * x + z * z);
		minimumY = Math.min(minimumY, y);
		maximumY = Math.max(maximumY, y);
	}
	const radius = Math.sqrt(radiusSquared);
	return fitFromSupportPoints(
		boundsCorners({
			min: new Vec3(-radius, minimumY, -radius),
			max: new Vec3(radius, maximumY, radius),
		}).flatMap((point) => [point.x, point.y, point.z]),
	);
}

function fitFromSupportPoints(points: readonly number[]): ObjectPreviewFit {
	let minimumX = Number.POSITIVE_INFINITY;
	let minimumY = Number.POSITIVE_INFINITY;
	let minimumZ = Number.POSITIVE_INFINITY;
	let maximumX = Number.NEGATIVE_INFINITY;
	let maximumY = Number.NEGATIVE_INFINITY;
	let maximumZ = Number.NEGATIVE_INFINITY;
	for (let offset = 0; offset < points.length; offset += 3) {
		const x = points[offset];
		const y = points[offset + 1];
		const z = points[offset + 2];
		if (x === undefined || y === undefined || z === undefined)
			throw new Error(
				"Object preview fit support is not composed of XYZ triples.",
			);
		minimumX = Math.min(minimumX, x);
		minimumY = Math.min(minimumY, y);
		minimumZ = Math.min(minimumZ, z);
		maximumX = Math.max(maximumX, x);
		maximumY = Math.max(maximumY, y);
		maximumZ = Math.max(maximumZ, z);
	}
	return {
		center: new Vec3(
			(minimumX + maximumX) / 2,
			(minimumY + maximumY) / 2,
			(minimumZ + maximumZ) / 2,
		),
		supportPoints: new Float32Array(points),
	};
}

function boundsCorners(bounds: Pick<AABB3, "min" | "max">): Vec3[] {
	const corners: Vec3[] = [];
	for (const x of [bounds.min.x, bounds.max.x])
		for (const y of [bounds.min.y, bounds.max.y])
			for (const z of [bounds.min.z, bounds.max.z])
				corners.push(new Vec3(x, y, z));
	return corners;
}
