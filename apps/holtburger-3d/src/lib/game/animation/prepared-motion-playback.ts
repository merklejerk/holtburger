import type {
	PreparedAnimation,
	PreparedMotionAssets,
} from "./animation-asset-repository";
import { animationHookBlocksActivation } from "../../assets/decode-animation-record";
import type { DatAssetId } from "../game-types";
import type { AABB3, Vec3 } from "../math/types";
import type { ObjectVisualTemplate } from "../systems/object-visual-template-repository";
import {
	computePartSweepRadii,
	sweepPartTranslationBounds,
} from "./prepared-dynamic-animation";

/**
 * Every clip one entity can play, with a single bound that covers all of them.
 *
 * A body driven by a motion table transitions between clips constantly, so per-clip bounds would
 * churn the culling volume on every transition. The union is computed once and never changes: it is
 * conservative rather than tight, which is the correct direction for a culling bound.
 *
 * Building it costs no more than building per-clip bounds would. Each immutable clip precomputes
 * its per-part unscaled translation envelope once during asset preparation, so the motion set
 * scales and expands those envelopes in one pass with each part's radius hoisted out of the clip
 * loop.
 */
export interface PreparedMotionPlayback {
	/** Conservative bound covering every playable clip, for the entity's whole life. */
	readonly localBounds: AABB3;
	/** Clips this entity can actually play, keyed by animation id. */
	readonly clips: ReadonlyMap<DatAssetId, PreparedAnimation>;
}

/** Why one available motion clip cannot be played. */
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
 * Prepares every playable available motion clip and the one bound that covers them.
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
	assets: PreparedMotionAssets,
	template: ObjectVisualTemplate,
	sourceScale: Vec3,
	staticBounds: AABB3,
): PreparedMotionPlayback {
	// Each part's radius depends only on template geometry and scale, never on a clip, so it is
	// computed once for the available motion set instead of once per clip.
	const radii = computePartSweepRadii(template.parts, sourceScale);

	const clips = new Map<DatAssetId, PreparedAnimation>();
	const bounds = staticBounds.clone();

	for (const [animationId, animation] of assets.animations) {
		const refusal = refuseClip(animation);
		if (refusal !== null) {
			complain(assets.motionTableId, animationId, refusal.kind, refusal.detail);
			continue;
		}
		sweepPartTranslationBounds(
			bounds,
			animation.partTranslationBounds,
			radii,
			sourceScale,
		);
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
	const hooks = animation.hooks;
	if (hooks.length === 0) return null;
	let blockingCount = 0;
	let hasSetOmega = false;
	for (let index = 0; index < hooks.length; index += 1) {
		const hook = hooks[index];
		if (hook === undefined) continue;
		if (animationHookBlocksActivation(hook)) blockingCount += 1;
		else if (hook.kind === "set-omega") hasSetOmega = true;
	}
	if (blockingCount > 0) {
		return {
			detail: `${blockingCount} hook(s) would misrender the object`,
			kind: "blocking-hooks",
		};
	}
	if (hasSetOmega) {
		return {
			// Playing it would need an origin-centred envelope, inflating the shared bound for every
			// other clip this entity can reach.
			detail: "continuous visual-root rotation has no bounded sweep",
			kind: "unbounded-root-rotation",
		};
	}
	return null;
}
