import type { AdvancedAnimationFrame } from "../systems/animation-system";
import type { RendererFrameFeedback } from "../renderer/renderer";
import type { SceneNodeId } from "../scene";

/** Product cadence for offscreen visual sampling; zero remains the full-cadence baseline. */
export const DEFAULT_OFFSCREEN_ANIMATION_SAMPLE_INTERVAL_SECONDS = 0.1;

const TIME_EPSILON_SECONDS = 1e-9;

/** One frame's cadence decision, computed once for animation sampling and diagnostics. */
export interface AnimationPresentationSelection {
	/** Offscreen roots whose configured interval elapsed during this frame. */
	readonly offscreenNodeCount: number;
	/** Unique active roots selected for presentation sampling. */
	readonly selectedNodeIds: readonly SceneNodeId[];
	/** Previously visible roots selected at render cadence. */
	readonly visibleNodeCount: number;
}

/** Runtime cadence facts with distinct consumers in the harness and Explorer diagnostics. */
export interface AnimationPresentationSchedulerDiagnostics {
	/** Current offscreen sampling interval; zero means full cadence. */
	readonly offscreenSampleIntervalSeconds: number;
	/** Offscreen roots selected by the latest cadence decision. */
	readonly lastOffscreenSampleCount: number;
	/** Animated roots entering visibility in the latest completed renderer frame. */
	readonly lastNewlyVisiblePlaybackCount: number;
	/** Oldest sampled pose used by an animated root in the latest completed frame. */
	readonly lastMaximumVisiblePresentationAgeSeconds: number;
	/** Active roots omitted from visual sampling by the latest cadence decision. */
	readonly lastSkippedSampleCount: number;
	/** Previously visible roots selected by the latest cadence decision. */
	readonly lastVisibleSampleCount: number;
	/** Active animated roots selected in the previous completed renderer frame. */
	readonly previousFrameVisibleCount: number;
	/** Active playback identities retained by the latest reconciliation. */
	readonly trackedPlaybackCount: number;
}

/** Owns binary previous-frame-visible versus timed-offscreen presentation cadence. */
export class AnimationPresentationScheduler {
	readonly #lastSampleTimeSeconds = new Map<SceneNodeId, number>();
	#activeNodeIds = new Set<SceneNodeId>();
	#offscreenSampleIntervalSeconds =
		DEFAULT_OFFSCREEN_ANIMATION_SAMPLE_INTERVAL_SECONDS;
	#previousVisibleNodeIds = new Set<SceneNodeId>();
	#diagnostics: AnimationPresentationSchedulerDiagnostics = {
		lastMaximumVisiblePresentationAgeSeconds: 0,
		lastNewlyVisiblePlaybackCount: 0,
		lastOffscreenSampleCount: 0,
		lastSkippedSampleCount: 0,
		lastVisibleSampleCount: 0,
		offscreenSampleIntervalSeconds:
			DEFAULT_OFFSCREEN_ANIMATION_SAMPLE_INTERVAL_SECONDS,
		previousFrameVisibleCount: 0,
		trackedPlaybackCount: 0,
	};

	setOffscreenSampleIntervalSeconds(intervalSeconds: number): void {
		if (!Number.isFinite(intervalSeconds) || intervalSeconds < 0) {
			throw new Error(
				"Offscreen animation sample interval must be finite and non-negative.",
			);
		}
		this.#offscreenSampleIntervalSeconds = intervalSeconds;
		this.#diagnostics = {
			...this.#diagnostics,
			offscreenSampleIntervalSeconds: intervalSeconds,
		};
	}

	/** Select presentations after semantics advance, using only the prior frame's feedback. */
	select(
		frame: AdvancedAnimationFrame,
		timeSeconds: number,
	): AnimationPresentationSelection {
		if (!Number.isFinite(timeSeconds))
			throw new Error("Animation presentation time must be finite.");
		const activeNodeIds = new Set(frame.activeNodeIds);
		if (activeNodeIds.size !== frame.activeNodeIds.length)
			throw new Error("Advanced animation frame contains duplicate node IDs.");
		for (const nodeId of this.#lastSampleTimeSeconds.keys()) {
			if (!activeNodeIds.has(nodeId))
				this.#lastSampleTimeSeconds.delete(nodeId);
		}
		this.#activeNodeIds = activeNodeIds;

		const selectedNodeIds: SceneNodeId[] = [];
		let offscreenNodeCount = 0;
		let visibleNodeCount = 0;
		for (const nodeId of frame.activeNodeIds) {
			const visible = this.#previousVisibleNodeIds.has(nodeId);
			const lastSampleTime = this.#lastSampleTimeSeconds.get(nodeId);
			const offscreenDue =
				!visible &&
				(this.#offscreenSampleIntervalSeconds === 0 ||
					lastSampleTime === undefined ||
					timeSeconds < lastSampleTime ||
					timeSeconds - lastSampleTime + TIME_EPSILON_SECONDS >=
						this.#offscreenSampleIntervalSeconds);
			if (!visible && !offscreenDue) continue;
			selectedNodeIds.push(nodeId);
			this.#lastSampleTimeSeconds.set(nodeId, timeSeconds);
			if (visible) visibleNodeCount += 1;
			else offscreenNodeCount += 1;
		}

		this.#diagnostics = {
			...this.#diagnostics,
			lastOffscreenSampleCount: offscreenNodeCount,
			lastSkippedSampleCount:
				frame.activeNodeIds.length - selectedNodeIds.length,
			lastVisibleSampleCount: visibleNodeCount,
			offscreenSampleIntervalSeconds: this.#offscreenSampleIntervalSeconds,
			previousFrameVisibleCount: this.#previousVisibleNodeIds.size,
			trackedPlaybackCount: this.#lastSampleTimeSeconds.size,
		};
		return {
			offscreenNodeCount,
			selectedNodeIds: Object.freeze(selectedNodeIds),
			visibleNodeCount,
		};
	}

	/** Replace visibility with the deduplicated selection from one completed renderer frame. */
	completeFrame(feedback: RendererFrameFeedback, timeSeconds: number): void {
		if (!Number.isFinite(timeSeconds))
			throw new Error("Renderer feedback time must be finite.");
		const selectedDynamicNodeIds = new Set(feedback.selectedDynamicNodeIds);
		if (
			selectedDynamicNodeIds.size !== feedback.selectedDynamicNodeIds.length
		) {
			throw new Error("Renderer feedback contains duplicate dynamic node IDs.");
		}
		const visibleNodeIds = new Set(
			feedback.selectedDynamicNodeIds.filter((nodeId) =>
				this.#activeNodeIds.has(nodeId),
			),
		);
		let maximumVisiblePresentationAgeSeconds = 0;
		let newlyVisiblePlaybackCount = 0;
		for (const nodeId of visibleNodeIds) {
			if (!this.#previousVisibleNodeIds.has(nodeId))
				newlyVisiblePlaybackCount += 1;
			const lastSampleTime = this.#lastSampleTimeSeconds.get(nodeId);
			if (lastSampleTime === undefined) {
				throw new Error(
					`Visible animation ${nodeId} has no published presentation time.`,
				);
			}
			maximumVisiblePresentationAgeSeconds = Math.max(
				maximumVisiblePresentationAgeSeconds,
				Math.max(0, timeSeconds - lastSampleTime),
			);
		}
		this.#previousVisibleNodeIds = visibleNodeIds;
		this.#diagnostics = {
			...this.#diagnostics,
			lastMaximumVisiblePresentationAgeSeconds:
				maximumVisiblePresentationAgeSeconds,
			lastNewlyVisiblePlaybackCount: newlyVisiblePlaybackCount,
			previousFrameVisibleCount: visibleNodeIds.size,
		};
	}

	getDiagnostics(): AnimationPresentationSchedulerDiagnostics {
		return this.#diagnostics;
	}

	clear(): void {
		this.#lastSampleTimeSeconds.clear();
		this.#activeNodeIds.clear();
		this.#previousVisibleNodeIds.clear();
		this.#diagnostics = {
			...this.#diagnostics,
			lastMaximumVisiblePresentationAgeSeconds: 0,
			lastNewlyVisiblePlaybackCount: 0,
			lastOffscreenSampleCount: 0,
			lastSkippedSampleCount: 0,
			lastVisibleSampleCount: 0,
			previousFrameVisibleCount: 0,
			trackedPlaybackCount: 0,
		};
	}
}
