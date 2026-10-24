import type { PlayingClip } from "../animation/animation-playback";
import {
	sampleAnimationPoseOver,
	sampleAuthoredRootTransform,
} from "../animation/animation-playback";
import { transformPoint3, multiplyMat4 } from "../math/matrices";
import { type AABB3, Mat4, Vec3 } from "../math/types";
import {
	composeObjectPartFrame,
	composeObjectPartTransform,
} from "../resolution/object-part-transform";
import type { PartVisualTemplate } from "../systems/object-visual-template-repository";

/** Stable articulated support volume consumed by the analytic preview camera. */
export interface ObjectPreviewFit {
	readonly center: Vec3;
	/** Packed XYZ triples; immutable after preparation and scanned only when camera policy changes. */
	readonly supportPoints: Float32Array;
}

/** Narrow subject facts needed to sweep directly attached equipment through its animation. */
interface FitSubject {
	/** Already computed body support. */
	readonly fit: ObjectPreviewFit;
	/** Authored body pose used when no clip animates a part. */
	readonly setupPose: readonly Mat4[];
	/** Source scale affects rigid part translation independently from geometry scale. */
	readonly scale: Vec3;
	/** Ordered authored preview clips. */
	readonly clips: readonly PlayingClip[];
	/** Repeatable authored turns require a heading-invariant support envelope. */
	readonly rotatesVisualRoot: boolean;
}

/** One child's independent animation envelope carried by a resolved holding location. */
interface FitAttachment {
	/** Subject part carrying the item. */
	readonly parentPartIndex: number;
	/** Authored rigid holding offset. */
	readonly offsetTransform: Mat4;
	/** Child support already includes its own source/default scales and placement. */
	readonly fit: ObjectPreviewFit;
}

/** Fit body and held geometry together; callers deliberately exclude background models. */
export function composeObjectPreviewFit(
	body: FitSubject,
	attachments: readonly FitAttachment[],
): ObjectPreviewFit {
	if (attachments.length === 0) return body.fit;
	const points = Array.from(body.fit.supportPoints);
	const visit = (pose: readonly Mat4[], root: Mat4): void => {
		for (const attachment of attachments) {
			const part = pose[attachment.parentPartIndex];
			if (part === undefined)
				throw new Error(
					"Preview holding location names an absent subject part.",
				);
			const rigid = composeObjectPartFrame(part, body.scale, Mat4.identity());
			const frame = multiplyMat4(
				root,
				multiplyMat4(rigid, attachment.offsetTransform),
			);
			const support = attachment.fit.supportPoints;
			for (let index = 0; index < support.length; index += 3) {
				const x = support[index];
				const y = support[index + 1];
				const z = support[index + 2];
				if (x === undefined || y === undefined || z === undefined)
					throw new Error(
						"Preview equipment support is not composed of XYZ triples.",
					);
				const point = transformPoint3(frame, new Vec3(x, y, z));
				points.push(point.x, point.y, point.z);
			}
		}
	};
	visit(body.setupPose, Mat4.identity());
	for (const clip of body.clips)
		for (let frame = clip.lowFrame; frame <= clip.highFrame; frame += 0.25) {
			visit(
				sampleAnimationPoseOver(clip, frame, body.setupPose),
				sampleAuthoredRootTransform(clip, frame) ?? Mat4.identity(),
			);
		}
	return body.rotatesVisualRoot
		? horizontalRotationInvariantFit(points)
		: fitFromSupportPoints(points);
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
