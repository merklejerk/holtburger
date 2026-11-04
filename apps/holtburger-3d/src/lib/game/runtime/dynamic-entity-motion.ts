import type { PreparedAnimation } from "../animation/animation-asset-repository";
import { playingClip, type PlayingClip } from "../animation/animation-playback";
import type {
	DynamicEntityClip,
	DynamicEntityMotionLayer,
} from "./dynamic-entity-feed";

/** How one accepted host motion level affects existing frontend playback. */
export type DynamicEntityMotionUpdate =
	"confirm" | "install" | "retime" | "unchanged";

/** One accepted host motion level paired with the result of applying it to frontend playback. */
export interface DynamicEntityMotionState {
	readonly level: DynamicEntityMotionLayer;
	readonly playback: "installed" | "unplayable";
}

/**
 * Classify a host level without inspecting the frontend cursor. Rate-only updates preserve phase.
 *
 * A matching settled successor confirms the terminal pose already owned by a successfully
 * installed hold-transition. Reinstalling it would re-anchor playback early under network jitter.
 */
export function classifyDynamicEntityMotionUpdate(
	current: DynamicEntityMotionState | null,
	next: DynamicEntityMotionLayer,
): DynamicEntityMotionUpdate {
	if (current === null) return "install";
	const nextClip = next.clip;
	// A settled successor is a separate authored node, but can confirm this terminal pose.
	if (
		current.playback === "installed" &&
		current.level.clip.kind === "playing" &&
		nextClip.kind === "settled" &&
		current.level.clip.animationId === nextClip.animationId &&
		current.level.clip.completion === "hold"
	) {
		const terminalFrame =
			current.level.clip.framerate >= 0
				? current.level.clip.highFrame
				: current.level.clip.lowFrame;
		if (terminalFrame === nextClip.frame) return "confirm";
	}
	if (current.level.playbackId !== next.playbackId) return "install";
	const previous = current.level.clip;
	if (previous.kind === "playing" && nextClip.kind === "playing") {
		const sameClip =
			previous.animationId === nextClip.animationId &&
			previous.lowFrame === nextClip.lowFrame &&
			previous.highFrame === nextClip.highFrame &&
			previous.completion === nextClip.completion;
		if (sameClip) {
			if (previous.framerate === nextClip.framerate) return "unchanged";
			if (current.playback === "installed") return "retime";
		}
	} else if (
		previous.kind === "settled" &&
		nextClip.kind === "settled" &&
		previous.animationId === nextClip.animationId &&
		previous.frame === nextClip.frame
	) {
		return "unchanged";
	}

	return "install";
}

/** Resolve one host motion level into the clip sampled by frontend animation playback. */
export function playingClipForDynamicEntityMotion(
	animation: PreparedAnimation,
	motion: DynamicEntityClip,
): PlayingClip {
	return motion.kind === "playing"
		? playingClip(
				animation,
				motion.lowFrame,
				motion.highFrame,
				motion.framerate,
				motion.completion,
			)
		: playingClip(animation, motion.frame, motion.frame, 0, "hold");
}
