import type {
	BehaviorEventRouter,
	BehaviorTarget,
} from "../behavior/behavior-event-router";
import type { BehaviorDispatchMode } from "../behavior/behavior-event-router";
import type { PlayingClip } from "./animation-playback";

/** Route crossed animation hooks in authored order under retail direction filtering. */
export function dispatchAnimationHooks(
	router: BehaviorEventRouter,
	target: BehaviorTarget,
	clip: PlayingClip,
	departedFrames: readonly number[],
	mode: BehaviorDispatchMode,
): void {
	const playbackDirection = clip.framesPerSecond < 0 ? "backward" : "forward";
	for (const frameIndex of departedFrames) {
		for (const hook of clip.animation.hooks) {
			if (hook.frameIndex !== frameIndex) continue;
			if (hook.direction !== "both" && hook.direction !== playbackDirection)
				continue;
			router.dispatch(
				hook,
				target,
				{
					assetId: clip.animation.id,
					authoredOrder: hook.authoredOrder,
					authoredPosition: hook.frameIndex,
					producer: "animation",
				},
				mode,
			);
		}
	}
}
