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

const MAX_RECENT_HOOK_OBSERVATIONS = 256;

interface HookState {
	committedOrientation: Quat;
	omega: Vec3;
}

/** Provenance for one semantic hook decision, retained independently from visual interpolation. */
export interface HookObservation {
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

/** Owns deterministic persistent visual-hook state and observable deferred-hook decisions. */
export class HookSystem {
	readonly #states = new Map<SceneNodeId, HookState>();
	readonly #observations: HookObservation[] = [];
	#deferredHookCount = 0;
	#executedHookCount = 0;

	install(
		nodeId: SceneNodeId,
		animation: PreparedAnimation,
		initialDepartedFrames: readonly number[],
	): void {
		if (this.#states.has(nodeId))
			throw new Error(`Hook state for ${nodeId} already exists.`);
		this.#states.set(nodeId, {
			committedOrientation: Quat.identity(),
			omega: Vec3.zero(),
		});
		this.#executeFrames(
			nodeId,
			animation,
			initialDepartedFrames,
			"forward",
			true,
		);
	}

	/** Apply one retail static-object behavior step using the authored per-update rotation vector. */
	advanceCommittedRotation(nodeId: SceneNodeId): void {
		const state = this.#requiredState(nodeId);
		const delta = retailRotationVectorQuaternion(state.omega);
		state.committedOrientation = multiplyQuaternion(
			delta,
			state.committedOrientation,
		);
	}

	executeDepartedFrames(
		nodeId: SceneNodeId,
		animation: PreparedAnimation,
		departedFrames: readonly number[],
		direction: PlaybackDirection,
	): void {
		this.#executeFrames(nodeId, animation, departedFrames, direction, false);
	}

	/** Interpolate one fraction of the next authored update without mutating hook state. */
	sampleVisualRoot(nodeId: SceneNodeId, semanticStepFraction: number): Mat4 {
		if (
			!Number.isFinite(semanticStepFraction) ||
			semanticStepFraction < 0 ||
			semanticStepFraction >= 1
		) {
			throw new Error("Visual-root step fraction must be within [0, 1).");
		}
		const state = this.#requiredState(nodeId);
		const delta = rotationVectorQuaternion(
			new Vec3(
				state.omega.x * semanticStepFraction,
				state.omega.y * semanticStepFraction,
				state.omega.z * semanticStepFraction,
			),
		);
		return createRotationMat4(
			multiplyQuaternion(delta, state.committedOrientation),
		);
	}

	remove(nodeId: SceneNodeId): void {
		this.#states.delete(nodeId);
	}

	getObservations(): readonly HookObservation[] {
		return [...this.#observations];
	}

	getDiagnostics() {
		return {
			activeHookStateCount: this.#states.size,
			deferredHookCount: this.#deferredHookCount,
			executedHookCount: this.#executedHookCount,
			observations: this.getObservations(),
		};
	}

	#executeFrames(
		nodeId: SceneNodeId,
		animation: PreparedAnimation,
		departedFrames: readonly number[],
		direction: PlaybackDirection,
		persistentOnly: boolean,
	): void {
		const state = this.#requiredState(nodeId);
		for (const frameIndex of departedFrames) {
			for (const hook of animation.hooks) {
				if (
					hook.frameIndex !== frameIndex ||
					!acceptsDirection(hook, direction)
				)
					continue;
				if (persistentOnly && hook.kind !== "set-omega") continue;
				if (hook.kind === "set-omega") {
					state.omega = hook.omega.clone();
					this.#observe(
						nodeId,
						animation,
						hook,
						persistentOnly ? "folded-initial-state" : "executed",
					);
					continue;
				}
				this.#observe(
					nodeId,
					animation,
					hook,
					hook.kind === "semantic" ? "semantic" : "deferred",
				);
			}
		}
	}

	#observe(
		nodeId: SceneNodeId,
		animation: PreparedAnimation,
		hook: DecodedAnimationHook,
		outcome: HookObservation["outcome"],
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
		if (this.#observations.length > MAX_RECENT_HOOK_OBSERVATIONS)
			this.#observations.shift();
	}

	#requiredState(nodeId: SceneNodeId): HookState {
		const state = this.#states.get(nodeId);
		if (!state) throw new Error(`Hook state for ${nodeId} does not exist.`);
		return state;
	}
}

function acceptsDirection(
	hook: DecodedAnimationHook,
	direction: PlaybackDirection,
): boolean {
	return hook.direction === "both" || hook.direction === direction;
}
