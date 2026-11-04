import {
	advancePlayingFrame,
	clipEntryFrame,
	sampleAnimationPoseOver,
	sampleAuthoredRootTransform,
	type PlayingClip,
} from "./animation-playback";
import type { Mat4 } from "../math/types";

/** One crossed segment, kept explicit so the shared hook dispatcher sees exact clip identity. */
export interface AnimationSequenceTraversal {
	/** Authored window whose frames were crossed. */
	readonly clip: PlayingClip;
	/** Frame order from the shared retail-compatible clip traversal. */
	readonly departedFrames: readonly number[];
}

/** Coherent semantic cursor; render interpolation reads a projected cursor without publishing it. */
interface SequenceCursor {
	/** Current window in the resolved clip order. */
	readonly clipIndex: number;
	/** Current authored frame within that window. */
	readonly framePosition: number;
}

/** One complete articulated sample shared by scene pose publication. */
export interface AnimationSequencePose {
	/** Complete setup pose with the current clip's authored part prefix overlaid. */
	readonly partToObjectTransforms: readonly Mat4[];
	/** Authored visual-root rotation, independent of authoritative world placement. */
	readonly authoredRootTransform: Mat4 | null;
}

/** Resolved prefix/cyclic-tail traversal independent of rendering cadence. */
export class AnimationSequence {
	readonly #clips: readonly PlayingClip[];
	readonly #firstCyclicClip: number | null;
	readonly #setupPose: readonly Mat4[];
	#cursor: SequenceCursor;

	constructor(
		clips: readonly PlayingClip[],
		firstCyclicClip: number | null,
		setupPose: readonly Mat4[],
	) {
		if (
			firstCyclicClip !== null &&
			(!Number.isInteger(firstCyclicClip) ||
				firstCyclicClip < 0 ||
				firstCyclicClip >= clips.length)
		)
			throw new Error("Animation cyclic clip index is out of range.");
		this.#clips = clips;
		this.#firstCyclicClip = firstCyclicClip;
		this.#setupPose = setupPose.map((transform) => transform.clone());
		this.#cursor = {
			clipIndex: 0,
			framePosition: clips[0] ? clipEntryFrame(clips[0]) : 0,
		};
	}

	advance(
		elapsedSeconds: number,
		dispatch: (traversal: AnimationSequenceTraversal) => void,
	): void {
		this.#cursor = this.#traverse(elapsedSeconds, dispatch);
	}

	/** Render interpolation crosses clip boundaries without advancing semantic state or hooks. */
	sample(elapsedSeconds: number): AnimationSequencePose {
		const cursor = this.#traverse(elapsedSeconds, null);
		const clip = this.#clips[cursor.clipIndex];
		return {
			partToObjectTransforms: clip
				? sampleAnimationPoseOver(clip, cursor.framePosition, this.#setupPose)
				: this.#setupPose,
			authoredRootTransform: clip
				? sampleAuthoredRootTransform(clip, cursor.framePosition)
				: null,
		};
	}

	#traverse(
		elapsedSeconds: number,
		dispatch: ((traversal: AnimationSequenceTraversal) => void) | null,
	): SequenceCursor {
		if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0)
			throw new Error("Animation sequence requires finite non-negative time.");
		let { clipIndex, framePosition } = this.#cursor;
		let remainingSeconds = elapsedSeconds;
		while (remainingSeconds > 0 && this.#clips.length > 0) {
			const clip = this.#clips[clipIndex];
			if (!clip) throw new Error("Animation cursor names no authored clip.");
			const rate = Math.abs(clip.framesPerSecond);
			if (rate === 0) return { clipIndex, framePosition };
			const forward = clip.framesPerSecond > 0;
			const framesToBoundary = forward
				? clip.highFrame + 1 - framePosition
				: framePosition - clip.lowFrame;
			const secondsToBoundary = framesToBoundary / rate;
			const consumedSeconds = Math.min(remainingSeconds, secondsToBoundary);
			const advance = advancePlayingFrame(
				{ ...clip, completion: "hold" },
				framePosition,
				consumedSeconds,
			);
			framePosition = advance.framePosition;
			if (advance.departedFrames.length > 0)
				dispatch?.({ clip, departedFrames: advance.departedFrames });
			remainingSeconds -= consumedSeconds;
			if (consumedSeconds < secondsToBoundary)
				return { clipIndex, framePosition };

			const nextIndex = clipIndex + 1;
			if (nextIndex >= this.#clips.length && this.#firstCyclicClip === null)
				return { clipIndex, framePosition };
			if (nextIndex < this.#clips.length) clipIndex = nextIndex;
			else {
				const cyclicClip = this.#firstCyclicClip;
				if (cyclicClip === null)
					throw new Error("Animation sequence has no cyclic clip.");
				clipIndex = cyclicClip;
			}
			const next = this.#clips[clipIndex];
			if (!next) throw new Error("Animation sequence has no cyclic clip.");
			framePosition = clipEntryFrame(next);
		}
		return { clipIndex, framePosition };
	}

	/** Keep animation phase across appearance-only replacement, using the new model's setup pose.
	 * Changed animation identities/windows start normally; no past hooks are replayed. */
	replacement(
		clips: readonly PlayingClip[],
		firstCyclicClip: number | null,
		setupPose: readonly Mat4[],
	): AnimationSequence {
		const next = new AnimationSequence(clips, firstCyclicClip, setupPose);
		if (
			this.#firstCyclicClip !== firstCyclicClip ||
			this.#clips.length !== clips.length
		)
			return next;
		for (const [index, clip] of clips.entries()) {
			const previous = this.#clips[index];
			if (
				previous === undefined ||
				previous.animation.id !== clip.animation.id ||
				previous.lowFrame !== clip.lowFrame ||
				previous.highFrame !== clip.highFrame ||
				previous.framesPerSecond !== clip.framesPerSecond
			)
				return next;
		}
		next.#cursor = this.#cursor;
		return next;
	}

	samplePose(): readonly Mat4[] {
		const clip = this.#clips[this.#cursor.clipIndex];
		return clip
			? sampleAnimationPoseOver(
					clip,
					this.#cursor.framePosition,
					this.#setupPose,
				)
			: this.#setupPose;
	}

	sampleAuthoredRoot(): Mat4 | null {
		const clip = this.#clips[this.#cursor.clipIndex];
		return clip
			? sampleAuthoredRootTransform(clip, this.#cursor.framePosition)
			: null;
	}
}
