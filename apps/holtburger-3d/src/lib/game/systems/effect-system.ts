import {
	animationHookCommand,
	type DecodedAnimationHook,
} from "../../assets/decode-animation-record";
import type { PreparedAnimation } from "../animation/animation-asset-repository";
import {
	multiplyQuaternion,
	rotationVectorQuaternion,
	retailRotationVectorQuaternion,
	type PlaybackDirection,
} from "../animation/animation-playback";
import { createRotationMat4 } from "../math/matrices";
import { Mat4, Quat, Vec3 } from "../math/types";
import type { SceneNodeId } from "../scene";
import type { PartRenderState } from "./components";

const MAX_RECENT_EFFECT_OBSERVATIONS = 256;
/** Retail schedules an `FPHook` only at or above this duration. */
const MINIMUM_TIMED_EFFECT_SECONDS = 0.0002;

interface TranslucencyRamp {
	readonly durationSeconds: number;
	readonly end: number;
	elapsedSeconds: number;
	readonly start: number;
}

interface EffectState {
	committedOrientation: Quat;
	omega: Vec3;
	readonly partTranslucencies: number[];
	readonly translucencyRamps: Array<TranslucencyRamp | null>;
}

/** Render-cadence effect facts computed without exposing mutable effect state. */
export interface EffectPresentationSample {
	readonly partRenderStates: readonly PartRenderState[];
	/** Object-local rotation accumulated from authored `SetOmega` hooks. */
	readonly rootRotationModifier: Mat4;
}

/** Provenance for one semantic hook decision, retained independently from interpolation. */
export interface EffectObservation {
	readonly nodeId: SceneNodeId;
	readonly animationId: string;
	readonly frameIndex: number;
	readonly authoredOrder: number;
	readonly command: string;
	readonly outcome:
		| "executed"
		| "deferred"
		| "semantic"
		| "folded-initial-state";
}

/** Owns persistent visual-effect state while animation retains clocks and traversal. */
export class EffectSystem {
	readonly #states = new Map<SceneNodeId, EffectState>();
	readonly #observations: EffectObservation[] = [];
	#deferredHookCount = 0;
	#executedHookCount = 0;

	install(nodeId: SceneNodeId, partCount: number): void {
		if (this.#states.has(nodeId))
			throw new Error(`Effect state for ${nodeId} already exists.`);
		if (!Number.isInteger(partCount) || partCount <= 0)
			throw new Error("Effect state requires a positive part count.");
		this.#states.set(nodeId, {
			committedOrientation: Quat.identity(),
			omega: Vec3.zero(),
			partTranslucencies: Array.from({ length: partCount }, () => 0),
			translucencyRamps: Array.from({ length: partCount }, () => null),
		});
	}

	/** Advance exactly one committed behavior step before that step departs animation frames. */
	advanceSemanticStep(nodeId: SceneNodeId, stepSeconds: number): void {
		if (!Number.isFinite(stepSeconds) || stepSeconds <= 0)
			throw new Error("Effect behavior step must be finite and positive.");
		const state = this.#requiredState(nodeId);
		const delta = retailRotationVectorQuaternion(state.omega);
		state.committedOrientation = multiplyQuaternion(
			delta,
			state.committedOrientation,
		);
		for (
			let partIndex = 0;
			partIndex < state.translucencyRamps.length;
			partIndex += 1
		) {
			const ramp = state.translucencyRamps[partIndex];
			if (!ramp) continue;
			ramp.elapsedSeconds += stepSeconds;
			if (ramp.elapsedSeconds >= ramp.durationSeconds) {
				state.partTranslucencies[partIndex] = ramp.end;
				state.translucencyRamps[partIndex] = null;
				continue;
			}
			state.partTranslucencies[partIndex] = sampleRamp(
				ramp,
				ramp.elapsedSeconds,
			);
		}
	}

	executeDepartedFrames(
		nodeId: SceneNodeId,
		animation: PreparedAnimation,
		departedFrames: readonly number[],
		direction: PlaybackDirection,
		mode: "initial-state" | "live",
	): void {
		const state = this.#requiredState(nodeId);
		for (const frameIndex of departedFrames) {
			for (const hook of animation.hooks) {
				if (
					hook.frameIndex !== frameIndex ||
					!acceptsDirection(hook, direction)
				)
					continue;
				if (
					mode === "initial-state" &&
					hook.kind !== "set-omega" &&
					hook.kind !== "transparent-part"
				)
					continue;
				this.#applyHook(nodeId, animation, hook, state, mode);
			}
		}
	}

	/** Sample fractional visual state without committing time or emitting semantic hooks. */
	samplePresentation(
		nodeId: SceneNodeId,
		fractionalSeconds: number,
		semanticStepFraction: number,
	): EffectPresentationSample {
		if (!Number.isFinite(fractionalSeconds) || fractionalSeconds < 0)
			throw new Error("Effect sample time must be finite and non-negative.");
		if (
			!Number.isFinite(semanticStepFraction) ||
			semanticStepFraction < 0 ||
			semanticStepFraction >= 1
		) {
			throw new Error("Effect step fraction must be within [0, 1).");
		}
		const state = this.#requiredState(nodeId);
		const delta = rotationVectorQuaternion(
			new Vec3(
				state.omega.x * semanticStepFraction,
				state.omega.y * semanticStepFraction,
				state.omega.z * semanticStepFraction,
			),
		);
		return {
			partRenderStates: state.partTranslucencies.map(
				(translucency, partIndex) => {
					const ramp = state.translucencyRamps[partIndex];
					return {
						translucency:
							ramp === null
								? translucency
								: sampleRamp(ramp, ramp.elapsedSeconds + fractionalSeconds),
					};
				},
			),
			rootRotationModifier: createRotationMat4(
				multiplyQuaternion(delta, state.committedOrientation),
			),
		};
	}

	remove(nodeId: SceneNodeId): void {
		this.#states.delete(nodeId);
	}

	getObservations(): readonly EffectObservation[] {
		return [...this.#observations];
	}

	getDiagnostics() {
		return {
			residentEffectStateCount: this.#states.size,
			deferredHookCount: this.#deferredHookCount,
			executedHookCount: this.#executedHookCount,
			observations: this.getObservations(),
		};
	}

	#applyHook(
		nodeId: SceneNodeId,
		animation: PreparedAnimation,
		hook: DecodedAnimationHook,
		state: EffectState,
		mode: "initial-state" | "live",
	): void {
		const executedOutcome =
			mode === "initial-state" ? "folded-initial-state" : "executed";
		if (hook.kind === "set-omega") {
			state.omega = hook.omega.clone();
			this.#observe(nodeId, animation, hook, executedOutcome);
			return;
		}
		if (hook.kind === "transparent-part") {
			const partIndex = hook.partIndex;
			if (partIndex >= state.partTranslucencies.length)
				throw new Error(
					`TransparentPart index ${partIndex} is out of range for active effect state.`,
				);
			if (hook.durationSeconds < MINIMUM_TIMED_EFFECT_SECONDS) {
				state.partTranslucencies[partIndex] = hook.end;
				state.translucencyRamps[partIndex] = null;
			} else {
				state.partTranslucencies[partIndex] = hook.start;
				state.translucencyRamps[partIndex] = {
					durationSeconds: hook.durationSeconds,
					elapsedSeconds: 0,
					end: hook.end,
					start: hook.start,
				};
			}
			this.#observe(nodeId, animation, hook, executedOutcome);
			return;
		}
		this.#observe(
			nodeId,
			animation,
			hook,
			hook.kind === "semantic" ? "semantic" : "deferred",
		);
	}

	#observe(
		nodeId: SceneNodeId,
		animation: PreparedAnimation,
		hook: DecodedAnimationHook,
		outcome: EffectObservation["outcome"],
	): void {
		if (outcome === "deferred") this.#deferredHookCount += 1;
		if (outcome === "executed" || outcome === "folded-initial-state")
			this.#executedHookCount += 1;
		this.#observations.push({
			animationId: animation.id,
			authoredOrder: hook.authoredOrder,
			command: animationHookCommand(hook),
			frameIndex: hook.frameIndex,
			nodeId,
			outcome,
		});
		if (this.#observations.length > MAX_RECENT_EFFECT_OBSERVATIONS)
			this.#observations.shift();
	}

	#requiredState(nodeId: SceneNodeId): EffectState {
		const state = this.#states.get(nodeId);
		if (!state) throw new Error(`Effect state for ${nodeId} does not exist.`);
		return state;
	}
}

function sampleRamp(ramp: TranslucencyRamp, elapsedSeconds: number): number {
	if (elapsedSeconds >= ramp.durationSeconds) return ramp.end;
	return (
		ramp.start +
		(ramp.end - ramp.start) * (elapsedSeconds / ramp.durationSeconds)
	);
}

function acceptsDirection(
	hook: DecodedAnimationHook,
	direction: PlaybackDirection,
): boolean {
	return hook.direction === "both" || hook.direction === direction;
}
