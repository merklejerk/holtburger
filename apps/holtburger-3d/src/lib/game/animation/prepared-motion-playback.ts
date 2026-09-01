import type { PreparedMotionClosure } from "./animation-asset-repository";
import type { PreparedAnimation } from "./animation-asset-repository";
import { animationHookBlocksActivation } from "../../assets/decode-animation-record";
import type { DatAssetId } from "../game-types";
import { AABB3, Vec3 } from "../math/types";
import type {
	ObjectVisualTemplate,
	PartVisualTemplate,
} from "../systems/object-visual-template-repository";

/**
 * Every clip one entity can play, with a single bound that covers all of them.
 *
 * A body driven by a motion table transitions between clips constantly, so per-clip bounds would
 * churn the culling volume on every transition. The union is computed once and never changes: it is
 * conservative rather than tight, which is the correct direction for a culling bound.
 *
 * Building it costs no more than building per-clip bounds would. The sweep is a union of per-part,
 * per-frame boxes and `AABB3.union` is associative, so the whole closure is one pass with the
 * accumulator never reset — and each part's radius is hoisted out of the clip loop instead of being
 * recomputed for every clip.
 */
export interface PreparedMotionPlayback {
	/** Conservative bound covering every playable clip, for the entity's whole life. */
	readonly localBounds: AABB3;
	/** Clips this entity can actually play, keyed by animation id. */
	readonly clips: ReadonlyMap<DatAssetId, PreparedAnimation>;
}

/** Why one clip in a closure cannot be played. */
type ClipRefusal = "blocking-hooks" | "unbounded-root-rotation";

const reported = new Set<string>();

/**
 * Complains once per table and clip rather than once per entity.
 *
 * A defect in a commonly reached clip would otherwise log on every spawn, and a console nobody
 * reads is the same as no console at all.
 */
function complain(
	motionTableId: DatAssetId,
	animationId: DatAssetId,
	refusal: ClipRefusal,
	detail: string,
): void {
	const key = `${motionTableId}/${animationId}/${refusal}`;
	if (reported.has(key)) return;
	reported.add(key);
	console.warn(
		`Motion table ${motionTableId} reaches ${animationId}, which cannot be played (${refusal}): ${detail}. Skipping the clip.`,
	);
}

/**
 * Prepares every playable clip in a closure and the one bound that covers them.
 *
 * An unplayable clip is skipped rather than failing the entity: it is a content defect, and an
 * entity that animates from the rest of its table is more useful than one that refuses to spawn.
 * Skipped clips are absent from `clips`, so a projection naming one holds the current pose.
 *
 * Host-owned simulation hooks are presentation-safe even though the behavior dispatcher does not
 * execute them. The archive census still says no table-reachable clip carries a genuinely visual
 * blocking hook or `SetOmega`.
 * Clips that author fewer parts than the appearance remain playable: retail overlays their
 * authored prefix and retains the remaining setup-part transforms.
 */
export function prepareMotionPlayback(
	closure: PreparedMotionClosure,
	template: ObjectVisualTemplate,
	sourceScale: Vec3,
	staticBounds: AABB3,
): PreparedMotionPlayback {
	// Each part's radius depends only on template geometry and scale, never on a clip, so it is
	// computed once for the whole closure instead of once per clip.
	const radii = template.parts.map((part) => ({
		part,
		radius:
			part.localBounds === null
				? null
				: scaledPartRadius(part.localBounds, sourceScale, part.defaultScale),
	}));

	const clips = new Map<DatAssetId, PreparedAnimation>();
	const bounds = staticBounds.clone();

	for (const [animationId, animation] of closure.animations) {
		const refusal = refuseClip(animation);
		if (refusal !== null) {
			complain(
				closure.motionTableId,
				animationId,
				refusal.kind,
				refusal.detail,
			);
			continue;
		}
		sweepInto(bounds, animation, radii, sourceScale);
		clips.set(animationId, animation);
	}

	return {
		clips,
		localBounds: bounds,
	};
}

function refuseClip(
	animation: PreparedAnimation,
): { kind: ClipRefusal; detail: string } | null {
	const blocking = animation.hooks.filter(animationHookBlocksActivation);
	if (blocking.length > 0) {
		return {
			detail: `${blocking.length} hook(s) would misrender the object`,
			kind: "blocking-hooks",
		};
	}
	if (animation.hooks.some((hook) => hook.kind === "set-omega")) {
		return {
			// Playing it would need an origin-centred envelope, inflating the shared bound for every
			// other clip this entity can reach.
			detail: "continuous visual-root rotation has no bounded sweep",
			kind: "unbounded-root-rotation",
		};
	}
	return null;
}

function sweepInto(
	accumulated: AABB3,
	animation: PreparedAnimation,
	radii: readonly { part: PartVisualTemplate; radius: number | null }[],
	sourceScale: Vec3,
): void {
	for (const { part, radius } of radii) {
		if (radius === null) continue;
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
				pose.m41 * sourceScale.x,
				pose.m42 * sourceScale.y,
				pose.m43 * sourceScale.z,
			);
			const partBounds = new AABB3(
				new Vec3(center.x - radius, center.y - radius, center.z - radius),
				new Vec3(center.x + radius, center.y + radius, center.z + radius),
			);
			accumulated.union(partBounds);
		}
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
