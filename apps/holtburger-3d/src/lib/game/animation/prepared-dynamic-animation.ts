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
import type {
	PartTranslationBounds,
	PreparedAnimation,
} from "./animation-asset-repository";
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
	let playable = true;
	for (const animation of new Set(clips.map((clip) => clip.animation))) {
		const prepared = prepareDynamicAnimation(
			animation,
			template,
			scale,
			staticBounds,
		);
		if (prepared.kind === "retain-static-presentation") {
			console.warn(
				`Resolved animation ${animation.id} contains unsupported visual hooks: ${prepared.blockingHooks.map(animationHookCommand).join(", ")}. Retaining setup pose for the sequence.`,
			);
			playable = false;
		}
		localBounds.union(prepared.localBounds);
	}
	const playableClips = playable ? clips : [];
	const rotatesVisualRoot = playableClips.some((clip) =>
		turnsVisualRoot(clip.animation),
	);
	return {
		kind: "sequence",
		clips: playableClips,
		firstCyclicClip: playable ? firstCyclicClip : null,
		localBounds: playable ? localBounds : staticBounds,
		fit: createModelFit(
			template.parts,
			setupPose,
			scale,
			playableClips,
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
	const bounds = staticBounds.clone();
	sweepPartTranslationBounds(
		bounds,
		animation.partTranslationBounds,
		computePartSweepRadii(template.parts, sourceScale),
		sourceScale,
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

/** Precomputed scaled bounding radius for one bounded setup part. */
export interface PartSweepRadius {
	readonly partIndex: number;
	readonly radius: number;
}

/**
 * Compute each bounded part's rotation-invariant radius once for an entity's setup and scale.
 *
 * Parts with `localBounds === null` are omitted so clip sweeps never visit them.
 */
export function computePartSweepRadii(
	parts: readonly PartVisualTemplate[],
	sourceScale: Vec3,
): readonly PartSweepRadius[] {
	const radii: PartSweepRadius[] = [];
	for (const part of parts) {
		if (part.localBounds === null) continue;
		radii.push({
			partIndex: part.partIndex,
			radius: scaledPartRadius(
				part.localBounds,
				sourceScale,
				part.defaultScale,
			),
		});
	}
	return radii;
}

/**
 * Conservatively union one clip's precomputed per-part translation envelopes into `accumulated`.
 *
 * Translation interpolates linearly and rigid rotation preserves each part's radius, so scaling
 * `[min, max]` of per-frame translations and expanding by `radius` is mathematically identical to
 * unioning every frame's endpoint sphere AABB without per-frame iteration or allocation.
 */
export function sweepPartTranslationBounds(
	accumulated: AABB3,
	partTranslationBounds: readonly PartTranslationBounds[],
	radii: readonly PartSweepRadius[],
	sourceScale: Vec3,
): void {
	const partCount = partTranslationBounds.length;
	if (partCount === 0) return;
	const { x: sx, y: sy, z: sz } = sourceScale;
	const accMin = accumulated.min;
	const accMax = accumulated.max;
	for (let index = 0; index < radii.length; index += 1) {
		const entry = radii[index];
		if (entry === undefined) continue;
		// An unauthored setup part retains static coverage; flattening it would alias a later frame.
		if (entry.partIndex >= partCount) continue;
		const envelope = partTranslationBounds[entry.partIndex];
		if (envelope === undefined) continue;
		const radius = entry.radius;
		const x0 = envelope.minX * sx;
		const x1 = envelope.maxX * sx;
		const minX = (x0 < x1 ? x0 : x1) - radius;
		const maxX = (x0 < x1 ? x1 : x0) + radius;
		if (minX < accMin.x) accMin.x = minX;
		if (maxX > accMax.x) accMax.x = maxX;
		const y0 = envelope.minY * sy;
		const y1 = envelope.maxY * sy;
		const minY = (y0 < y1 ? y0 : y1) - radius;
		const maxY = (y0 < y1 ? y1 : y0) + radius;
		if (minY < accMin.y) accMin.y = minY;
		if (maxY > accMax.y) accMax.y = maxY;
		const z0 = envelope.minZ * sz;
		const z1 = envelope.maxZ * sz;
		const minZ = (z0 < z1 ? z0 : z1) - radius;
		const maxZ = (z0 < z1 ? z1 : z0) + radius;
		if (minZ < accMin.z) accMin.z = minZ;
		if (maxZ > accMax.z) accMax.z = maxZ;
	}
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
