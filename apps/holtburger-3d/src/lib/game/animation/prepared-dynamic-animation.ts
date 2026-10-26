import {
	animationHookBlocksActivation,
	animationHookCommand,
	type DecodedAnimationHook,
} from "../../assets/decode-animation-record";
import { AABB3, Vec3 } from "../math/types";
import type {
	ObjectVisualTemplate,
	PartVisualTemplate,
} from "../systems/object-visual-template-repository";
import type { PreparedAnimation } from "./animation-asset-repository";
import { turnsVisualRoot, type PlayingClip } from "./animation-playback";
import { createModelFit, type ModelFit } from "../geometry/model-fit";
import type { Mat4 } from "../math/types";

/** Complete animation preparation outcome consumed by the later atomic activation gate. */
export type PreparedDynamicAnimation =
	| {
			/** Explicit resolved sequence or setup pose, exclusive of source-owned playback. */
			readonly kind: "sequence";
			/** All windows are bound to retained animation assets. */
			readonly clips: readonly PlayingClip[];
			/** Null means setup pose or a finite noncyclic sequence. */
			readonly firstCyclicClip: number | null;
			/** Stable support from the same geometry and clips the scene will render. */
			readonly fit: ModelFit;
			/** Conservative continuous-pose bound for ordinary scene culling. */
			readonly localBounds: AABB3;
	  }
	| {
			/**
			 * The resident owns no default animation, so its parts keep their authored pose.
			 *
			 * Distinct from `retain-static-presentation`: nothing is being withheld. A script-only
			 * resident is fully activated, it simply has no playback to run.
			 */
			readonly kind: "none";
			readonly localBounds: AABB3;
	  }
	| {
			readonly kind: "activatable";
			readonly animation: PreparedAnimation;
			readonly localBounds: AABB3;
			readonly hasUnboundedVisualRootRotation: boolean;
	  }
	| {
			readonly kind: "retain-static-presentation";
			readonly animation: PreparedAnimation;
			/** Hooks that would misrender this owner, so it keeps its static presentation. */
			readonly blockingHooks: readonly DecodedAnimationHook[];
			readonly localBounds: AABB3;
	  };

/** Prepare explicit windows without changing setup behavior or substituting a whole default clip. */
export function prepareDynamicSequence(
	clips: readonly PlayingClip[],
	firstCyclicClip: number | null,
	template: Pick<ObjectVisualTemplate, "parts">,
	setupPose: readonly Mat4[],
	scale: Vec3,
	staticBounds: AABB3,
): Extract<PreparedDynamicAnimation, { kind: "sequence" }> {
	const localBounds = staticBounds.clone();
	for (const animation of new Set(clips.map((clip) => clip.animation))) {
		const prepared = prepareDynamicAnimation(
			animation,
			template,
			scale,
			staticBounds,
		);
		if (prepared.kind === "retain-static-presentation")
			throw new Error(
				`Resolved animation ${animation.id} contains unsupported visual hooks: ${prepared.blockingHooks.map(animationHookCommand).join(", ")}.`,
			);
		localBounds.union(prepared.localBounds);
	}
	const rotatesVisualRoot = clips.some((clip) =>
		turnsVisualRoot(clip.animation),
	);
	return {
		kind: "sequence",
		clips,
		firstCyclicClip,
		localBounds,
		fit: createModelFit(
			template.parts,
			setupPose,
			scale,
			clips,
			rotatesVisualRoot,
		),
	};
}

/** Validate one clip against its resolved appearance and precompute activation-time bounds. */
export function prepareDynamicAnimation(
	animation: PreparedAnimation,
	template: Pick<ObjectVisualTemplate, "parts">,
	sourceScale: Vec3,
	staticBounds: AABB3,
): PreparedDynamicAnimation {
	const blockingHooks = animation.hooks.filter(animationHookBlocksActivation);
	if (blockingHooks.length > 0) {
		return {
			animation,
			blockingHooks,
			kind: "retain-static-presentation",
			localBounds: staticBounds,
		};
	}
	const bounds = sweepAnimationPartBounds(
		animation,
		template.parts,
		sourceScale,
		staticBounds,
	);
	const hasUnboundedVisualRootRotation = animation.hooks.some(
		(hook) => hook.kind === "set-omega",
	);
	// An applied authored root frame turns the whole part cloud, so the swept bound no longer
	// covers it. The envelope is used rather than a second sweep because the population is one
	// clip whose bound is already small, and a rotation-invariant box is provably correct where a
	// hand-rolled sweep of two composed rotations would have to be argued.
	return {
		animation,
		hasUnboundedVisualRootRotation,
		kind: "activatable",
		localBounds:
			hasUnboundedVisualRootRotation || turnsVisualRoot(animation)
				? rotationInvariantBounds(bounds)
				: bounds,
	};
}

/** Conservatively union one animation's rigid-part frames into an existing setup bound. */
function sweepAnimationPartBounds(
	animation: PreparedAnimation,
	parts: readonly PartVisualTemplate[],
	sourceScale: Vec3,
	staticBounds: AABB3,
): AABB3 {
	const result = staticBounds.clone();
	for (const part of parts) {
		// An unauthored setup part retains static coverage; flattening it would alias a later frame.
		if (part.partIndex >= animation.partCount) continue;
		if (part.localBounds === null) continue;
		const radius = scaledPartRadius(
			part.localBounds,
			sourceScale,
			part.defaultScale,
		);
		for (
			let frameIndex = 0;
			frameIndex < animation.frameCount;
			frameIndex += 1
		) {
			const pose =
				animation.partFrames[frameIndex * animation.partCount + part.partIndex];
			if (!pose) continue;
			// Translation interpolates linearly and rigid rotation preserves this radius, so the
			// endpoint sphere AABBs cover every slerped pose between authored frames.
			const center = new Vec3(
				pose.translation.x * sourceScale.x,
				pose.translation.y * sourceScale.y,
				pose.translation.z * sourceScale.z,
			);
			const partBounds = new AABB3(
				new Vec3(center.x - radius, center.y - radius, center.z - radius),
				new Vec3(center.x + radius, center.y + radius, center.z + radius),
			);
			result.union(partBounds);
		}
	}
	return result;
}

/** Radius of the setup-scaled geometry box about the rigid part's authored origin. */
function scaledPartRadius(
	bounds: AABB3,
	sourceScale: Vec3,
	defaultScale: Vec3,
): number {
	const xScale = sourceScale.x * defaultScale.x;
	const yScale = sourceScale.y * defaultScale.y;
	const zScale = sourceScale.z * defaultScale.z;
	let radiusSquared = 0;
	for (const x of [bounds.min.x, bounds.max.x]) {
		for (const y of [bounds.min.y, bounds.max.y]) {
			for (const z of [bounds.min.z, bounds.max.z]) {
				radiusSquared = Math.max(
					radiusSquared,
					(x * xScale) ** 2 + (y * yScale) ** 2 + (z * zScale) ** 2,
				);
			}
		}
	}
	return Math.sqrt(radiusSquared);
}

/** Any continuous visual-root rotation maps the complete sweep into this origin-centered envelope. */
function rotationInvariantBounds(bounds: AABB3): AABB3 {
	let radiusSquared = 0;
	for (const x of [bounds.min.x, bounds.max.x]) {
		for (const y of [bounds.min.y, bounds.max.y]) {
			for (const z of [bounds.min.z, bounds.max.z]) {
				radiusSquared = Math.max(radiusSquared, x * x + y * y + z * z);
			}
		}
	}
	const radius = Math.sqrt(radiusSquared);
	return new AABB3(
		new Vec3(-radius, -radius, -radius),
		new Vec3(radius, radius, radius),
	);
}
