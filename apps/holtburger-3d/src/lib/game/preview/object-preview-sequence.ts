import {
	advancePlayingFrame,
	clipEntryFrame,
	sampleAnimationPoseOver,
	sampleAuthoredRootTransform,
	type PlayingClip,
} from "../animation/animation-playback";
import type { Mat4 } from "../math/types";

/** One crossed segment, kept explicit so the shared hook dispatcher sees exact clip identity. */
export interface ObjectPreviewSequenceTraversal {
	readonly clip: PlayingClip;
	readonly departedFrames: readonly number[];
}

/** Stateful captured prefix/cyclic-tail traversal independent of rendering cadence. */
export class ObjectPreviewSequence {
	readonly #clips: readonly PlayingClip[];
	readonly #firstCyclicClip: number | null;
	readonly #setupPose: readonly Mat4[];
	#clipIndex = 0;
	#framePosition = 0;

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
			throw new Error("Object preview cyclic clip index is out of range.");
		this.#clips = clips;
		this.#firstCyclicClip = firstCyclicClip;
		this.#setupPose = setupPose.map((transform) => transform.clone());
		this.#framePosition = clips[0] ? clipEntryFrame(clips[0]) : 0;
	}

	advance(
		elapsedSeconds: number,
		dispatch: (traversal: ObjectPreviewSequenceTraversal) => void,
	): void {
		if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0)
			throw new Error(
				"Object preview sequence requires finite non-negative time.",
			);
		let remainingSeconds = elapsedSeconds;
		while (remainingSeconds > 0 && this.#clips.length > 0) {
			const clip = this.#clips[this.#clipIndex];
			if (!clip)
				throw new Error("Object preview cursor names no authored clip.");
			const rate = Math.abs(clip.framesPerSecond);
			if (rate === 0) return;
			const forward = clip.framesPerSecond > 0;
			const framesToBoundary = forward
				? clip.highFrame + 1 - this.#framePosition
				: this.#framePosition - clip.lowFrame;
			const secondsToBoundary = framesToBoundary / rate;
			const consumedSeconds = Math.min(remainingSeconds, secondsToBoundary);
			const advance = advancePlayingFrame(
				{ ...clip, completion: "hold" },
				this.#framePosition,
				consumedSeconds,
			);
			this.#framePosition = advance.framePosition;
			if (advance.departedFrames.length > 0)
				dispatch({ clip, departedFrames: advance.departedFrames });
			remainingSeconds -= consumedSeconds;
			if (consumedSeconds < secondsToBoundary) return;

			const nextIndex = this.#clipIndex + 1;
			if (nextIndex >= this.#clips.length && this.#firstCyclicClip === null)
				return;
			if (nextIndex < this.#clips.length) this.#clipIndex = nextIndex;
			else {
				const cyclicClip = this.#firstCyclicClip;
				if (cyclicClip === null)
					throw new Error("Object preview sequence has no cyclic clip.");
				this.#clipIndex = cyclicClip;
			}
			const next = this.#clips[this.#clipIndex];
			if (!next) throw new Error("Object preview sequence has no cyclic clip.");
			this.#framePosition = clipEntryFrame(next);
		}
	}

	/** Keep animation phase across appearance-only replacement, using the new model's setup pose.
	 * Changed animation identities/windows start normally; no past hooks are replayed. */
	replacement(
		clips: readonly PlayingClip[],
		firstCyclicClip: number | null,
		setupPose: readonly Mat4[],
	): ObjectPreviewSequence {
		const next = new ObjectPreviewSequence(clips, firstCyclicClip, setupPose);
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
		next.#clipIndex = this.#clipIndex;
		next.#framePosition = this.#framePosition;
		return next;
	}

	samplePose(): readonly Mat4[] {
		const clip = this.#clips[this.#clipIndex];
		return clip
			? sampleAnimationPoseOver(clip, this.#framePosition, this.#setupPose)
			: this.#setupPose;
	}

	sampleAuthoredRoot(): Mat4 | null {
		const clip = this.#clips[this.#clipIndex];
		return clip ? sampleAuthoredRootTransform(clip, this.#framePosition) : null;
	}
}
