import type {
	BehaviorTarget,
	EffectCommandPort,
} from "../behavior/behavior-event-router";
import {
	multiplyQuaternion,
	rotationVectorQuaternion,
	retailRotationVectorQuaternion,
} from "../animation/animation-playback";
import {
	createRotationMat4,
	createScaleMat4,
	multiplyMat4,
} from "../math/matrices";
import { Mat4, Quat, Vec3 } from "../math/types";
import type { SceneNodeId } from "../scene";
import type { PartRenderState } from "./components";

/** Retail schedules an `FPHook` only at or above this duration. */
const MINIMUM_TIMED_EFFECT_SECONDS = 0.0002;

/** A linear ramp toward a whole-object uniform scale, as retail's `SetScale` interpolates. */
interface ScaleRamp {
	readonly durationSeconds: number;
	readonly end: number;
	readonly start: number;
	elapsedSeconds: number;
}

interface TranslucencyRamp {
	readonly durationSeconds: number;
	readonly end: number;
	elapsedSeconds: number;
	readonly start: number;
}

interface EffectState {
	committedOrientation: Quat;
	omega: Vec3;
	/**
	 * Whole-object uniform scale multiplier applied on top of the source and per-part scales.
	 *
	 * Retail writes one scalar across the entire part array and composes it multiplicatively with
	 * each part's setup `default_scale` (acclient.c:313786-313797), so this is a modifier, not a
	 * replacement.
	 */
	scale: number;
	scaleRamp: ScaleRamp | null;
	readonly partTranslucencies: number[];
	readonly translucencyRamps: Array<TranslucencyRamp | null>;
}

/** Render-cadence effect facts computed without exposing mutable effect state. */
export interface EffectPresentationSample {
	readonly partRenderStates: readonly PartRenderState[];
	/**
	 * Object-local root modifier: `SetOmega` rotation composed with `Scale`'s uniform factor.
	 *
	 * One matrix rather than two fields, because both are whole-object modifiers applied at the
	 * same seam and a consumer that needed them apart would have to recombine them anyway.
	 */
	readonly rootTransformModifier: Mat4;
}

/**
 * Owns persistent visual-effect state and nothing else.
 *
 * A pure consumer since Phase 3: producers own clocks and traversal, the router owns dispatch
 * decisions and their provenance, and this system owns only the state those decisions mutate.
 */
export class EffectSystem implements EffectCommandPort {
	readonly #states = new Map<SceneNodeId, EffectState>();
	#appliedCommandCount = 0;

	install(nodeId: SceneNodeId, partCount: number): void {
		if (this.#states.has(nodeId))
			throw new Error(`Effect state for ${nodeId} already exists.`);
		if (!Number.isInteger(partCount) || partCount <= 0)
			throw new Error("Effect state requires a positive part count.");
		this.#states.set(nodeId, {
			committedOrientation: Quat.identity(),
			omega: Vec3.zero(),
			scale: 1,
			scaleRamp: null,
			partTranslucencies: Array.from({ length: partCount }, () => 0),
			translucencyRamps: Array.from({ length: partCount }, () => null),
		});
	}

	/** Advance exactly one committed behavior step before that step departs animation frames. */
	advanceSemanticStep(nodeId: SceneNodeId, stepSeconds: number): void {
		if (!Number.isFinite(stepSeconds) || stepSeconds <= 0)
			throw new Error("Effect behavior step must be finite and positive.");
		const state = this.#requiredState(nodeId);
		if (state.scaleRamp) {
			state.scaleRamp.elapsedSeconds += stepSeconds;
			if (state.scaleRamp.elapsedSeconds >= state.scaleRamp.durationSeconds) {
				state.scale = state.scaleRamp.end;
				state.scaleRamp = null;
			} else {
				state.scale = sampleScaleRamp(
					state.scaleRamp,
					state.scaleRamp.elapsedSeconds,
				);
			}
		}
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

	/**
	 * Ramp the whole-object scale toward `end`.
	 *
	 * Retail interpolates linearly **from the object's current scale**, not from a fixed base, so a
	 * second command mid-ramp continues from wherever the first one had reached
	 * (`SetScale`, acclient.c:328862-328903).
	 */
	applyScale(
		target: BehaviorTarget,
		values: { readonly end: number; readonly durationSeconds: number },
	): void {
		const state = this.#requiredState(target.nodeId);
		this.#appliedCommandCount += 1;
		if (values.durationSeconds < MINIMUM_TIMED_EFFECT_SECONDS) {
			state.scale = values.end;
			state.scaleRamp = null;
			return;
		}
		state.scaleRamp = {
			durationSeconds: values.durationSeconds,
			elapsedSeconds: 0,
			end: values.end,
			start: state.scale,
		};
	}

	applySetOmega(target: BehaviorTarget, omega: Vec3): void {
		const state = this.#requiredState(target.nodeId);
		state.omega = new Vec3(omega.x, omega.y, omega.z);
		this.#appliedCommandCount += 1;
	}

	/**
	 * Start or immediately settle one part's translucency ramp.
	 *
	 * Deliberately identical during replay and live execution. A ramp is persistent state, so
	 * replaying it and then advancing the remaining elapsed steps lands on exactly the translucency
	 * the part should show now — which is not the same as its endpoint, and jumping there would
	 * discard a ramp still in flight when the owner became observable.
	 */
	applyTransparentPart(
		target: BehaviorTarget,
		values: {
			readonly partIndex: number;
			readonly start: number;
			readonly end: number;
			readonly durationSeconds: number;
		},
	): void {
		const state = this.#requiredState(target.nodeId);
		if (values.partIndex >= state.partTranslucencies.length)
			throw new Error(
				`TransparentPart index ${values.partIndex} is out of range for active effect state.`,
			);
		this.#appliedCommandCount += 1;
		if (values.durationSeconds < MINIMUM_TIMED_EFFECT_SECONDS) {
			state.partTranslucencies[values.partIndex] = values.end;
			state.translucencyRamps[values.partIndex] = null;
			return;
		}
		state.partTranslucencies[values.partIndex] = values.start;
		state.translucencyRamps[values.partIndex] = {
			durationSeconds: values.durationSeconds,
			elapsedSeconds: 0,
			end: values.end,
			start: values.start,
		};
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
			rootTransformModifier: multiplyMat4(
				createRotationMat4(
					multiplyQuaternion(delta, state.committedOrientation),
				),
				createScaleMat4(sampledScale(state, fractionalSeconds)),
			),
		};
	}

	remove(nodeId: SceneNodeId): void {
		this.#states.delete(nodeId);
	}

	getDiagnostics() {
		return {
			appliedCommandCount: this.#appliedCommandCount,
			residentEffectStateCount: this.#states.size,
		};
	}

	#requiredState(nodeId: SceneNodeId): EffectState {
		const state = this.#states.get(nodeId);
		if (!state) throw new Error(`Effect state for ${nodeId} does not exist.`);
		return state;
	}
}

/** Scale at a fractional instant, without committing that time to the ramp. */
function sampledScale(state: EffectState, fractionalSeconds: number): Vec3 {
	const scale = state.scaleRamp
		? sampleScaleRamp(
				state.scaleRamp,
				state.scaleRamp.elapsedSeconds + fractionalSeconds,
			)
		: state.scale;
	return new Vec3(scale, scale, scale);
}

function sampleScaleRamp(ramp: ScaleRamp, elapsedSeconds: number): number {
	if (elapsedSeconds >= ramp.durationSeconds) return ramp.end;
	return (
		ramp.start +
		(ramp.end - ramp.start) * (elapsedSeconds / ramp.durationSeconds)
	);
}

function sampleRamp(ramp: TranslucencyRamp, elapsedSeconds: number): number {
	if (elapsedSeconds >= ramp.durationSeconds) return ramp.end;
	return (
		ramp.start +
		(ramp.end - ramp.start) * (elapsedSeconds / ramp.durationSeconds)
	);
}
