import type { PreparedAnimation } from "../animation/animation-asset-repository";
import { playingClip, type PlayingClip } from "../animation/animation-playback";
import type { DynamicEntityMotion } from "./dynamic-entity-feed";

/** How one accepted host motion level affects existing frontend playback. */
export type DynamicEntityMotionUpdate =
	"confirm" | "install" | "retime" | "unchanged";

/** One accepted host motion level paired with the result of applying it to frontend playback. */
export interface DynamicEntityMotionState {
	readonly level: DynamicEntityMotion;
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
	next: DynamicEntityMotion,
): DynamicEntityMotionUpdate {
	if (current === null) return "install";
	const previous = current.level;
	if (previous.kind === "playing" && next.kind === "playing") {
		const sameClip =
			previous.animationId === next.animationId &&
			previous.lowFrame === next.lowFrame &&
			previous.highFrame === next.highFrame &&
			previous.completion === next.completion;
		if (sameClip) {
			if (previous.framerate === next.framerate) return "unchanged";
			if (current.playback === "installed") return "retime";
		}
	} else if (
		previous.kind === "settled" &&
		next.kind === "settled" &&
		previous.animationId === next.animationId &&
		previous.frame === next.frame
	) {
		return "unchanged";
	}

	if (
		current.playback === "installed" &&
		current.level.kind === "playing" &&
		next.kind === "settled" &&
		current.level.animationId === next.animationId &&
		current.level.completion === "hold"
	) {
		const terminalFrame =
			current.level.framerate >= 0
				? current.level.highFrame
				: current.level.lowFrame;
		if (terminalFrame === next.frame) return "confirm";
	}
	return "install";
}

/** Resolve one host motion level into the clip sampled by frontend animation playback. */
export function playingClipForDynamicEntityMotion(
	animation: PreparedAnimation,
	motion: DynamicEntityMotion,
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
