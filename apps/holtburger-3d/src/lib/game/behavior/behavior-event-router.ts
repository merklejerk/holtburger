import type { AcVector3 } from "../../assets/ac-frame";
import type { DatAssetId } from "../game-types";
import {
	behaviorCommandLabel,
	type PreparedBehaviorCommand,
} from "./prepared-behavior-command";

/** Which clock scheduled a command, and where in its asset it was authored. */
export interface BehaviorCommandProvenance {
	readonly producer: "animation" | "physics-script";
	readonly assetId: DatAssetId;
	/** Frame index for animations; authored record time in seconds for scripts. */
	readonly authoredPosition: number;
	/** Authored order within that position, the stable tiebreak among simultaneous commands. */
	readonly authoredOrder: number;
}

declare const behaviorTargetSpace: unique symbol;

/**
 * Identity of one behavior dispatch target, minted by whichever module owns the target.
 *
 * Deliberately not `SceneNodeId`. Most targets are scene-graph residents, but not all: sky objects
 * are viewer-centered and owned by the sky module, which has no scene residency at all. Borrowing
 * the scene's id type would have forced them into the scene graph purely to be addressable.
 *
 * Producers mint their own ids in their own namespace, and the composition root — the one place
 * that knows every residency — resolves an id back to a frame. No consumer branches on which kind
 * it holds; they take origins and rotations as injected functions.
 */
export type BehaviorTargetId = string & {
	readonly [behaviorTargetSpace]: true;
};

/**
 * Assert that a string is a behavior target id.
 *
 * Every call is a claim that the caller owns the namespace it is minting into.
 */
export function behaviorTargetId(id: string): BehaviorTargetId {
	return id as BehaviorTargetId;
}

/**
 * One dispatch target, identified strongly enough to detect reuse.
 *
 * An id alone is not sufficient: ids are recycled, so a queued command could otherwise land on
 * whatever now occupies the slot. The generation makes that detectable.
 */
export interface BehaviorTarget {
	readonly targetId: BehaviorTargetId;
	readonly generation: number;
}

/**
 * How a command is being dispatched.
 *
 * `initial-state` is deterministic replay of authored time that elapsed before the owner became
 * observable; `live` is ordinary forward execution.
 */
export type BehaviorDispatchMode = "initial-state" | "live";

/** Exactly one outcome is recorded per dispatched command; none may be silent. */
export type BehaviorDispatchOutcome =
	/** A consumer applied it. */
	| "executed"
	/** Persistent state absorbed it during replay, with elapsed time accounted for. */
	| "folded-initial-state"
	/** An ephemeral effect was deliberately not emitted during replay. */
	| "suppressed-initial-state"
	/** A chained activation was queued rather than run inline. */
	| "scheduled"
	/** Meaningful to the producer, with nothing for any consumer to do. */
	| "semantic"
	/** Decoded and understood, but its consumer arrives in a later phase. */
	| "no-consumer"
	/** Faithfully reproduced by doing nothing, because retail does nothing either. */
	| "intentionally-inert"
	/** The target was removed or replaced before the command could run. */
	| "rejected-stale-target";

/** One recorded dispatch decision, retained for diagnostics rather than for control flow. */
export interface BehaviorObservation {
	readonly targetId: BehaviorTargetId;
	readonly generation: number;
	readonly command: string;
	readonly outcome: BehaviorDispatchOutcome;
	readonly provenance: BehaviorCommandProvenance;
}

/** Persistent visual and material state. Widened only by proven commands, never speculatively. */
export interface EffectCommandPort {
	applyScale(
		target: BehaviorTarget,
		values: { readonly end: number; readonly durationSeconds: number },
	): void;
	applySetOmega(target: BehaviorTarget, omega: Vec3Like): void;
	applyTransparentPart(
		target: BehaviorTarget,
		values: {
			readonly partIndex: number;
			readonly start: number;
			readonly end: number;
			readonly durationSeconds: number;
		},
	): void;
}

interface Vec3Like {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

/** Chained script activation, owned by the script clock rather than by the router. */
interface ScriptActivationPort {
	scheduleActivation(
		target: BehaviorTarget,
		activation: {
			readonly scriptId: DatAssetId;
			/** Upper bound of a uniform random delay; below the instant threshold it chains directly. */
			readonly pauseSeconds: number;
		},
	): void;
}

/**
 * Authored particle emission.
 *
 * The port takes the emitter's DID rather than a prepared emitter: resolving it is the consumer's
 * job, and the router must not hold asset handles.
 */
interface ParticleCommandPort {
	createEmitter(
		target: BehaviorTarget,
		command: {
			readonly emitterInfoId: DatAssetId;
			readonly partIndex: number;
			readonly offsetOrigin: AcVector3;
			readonly emitterId: number;
		},
	): "created" | "unprepared";
}

/**
 * Authored one-shot sound playback.
 *
 * Takes the sound's DID and its authored parameters; resolving the asset and placing the voice are
 * the consumer's job. `unprepared` covers both a missing asset and a sound retail would not have
 * played, so the router records the difference between "no consumer" and "deliberately silent".
 */
interface AudioCommandPort {
	playSound(
		target: BehaviorTarget,
		sound: {
			readonly soundId: DatAssetId;
			readonly probability: number;
			readonly volume: number;
		},
	): "played" | "suppressed" | "unprepared";
	/**
	 * Play a sound selected from the target's own installed sound table.
	 *
	 * The key is resolved by the consumer, not here: the table belongs to the *object*, so two
	 * residents running the same script can resolve one key to different sounds.
	 */
	playSoundTableKey(
		target: BehaviorTarget,
		soundType: number,
	): "played" | "suppressed" | "unprepared";
}

/** Decides whether a target still exists at the generation a command was queued against. */
interface BehaviorTargetRegistry {
	isLive(target: BehaviorTarget): boolean;
}

export interface BehaviorConsumers {
	readonly audio: AudioCommandPort;
	readonly effects: EffectCommandPort;
	readonly particles: ParticleCommandPort;
	readonly scheduler: ScriptActivationPort;
	readonly targets: BehaviorTargetRegistry;
}

/**
 * Routes one prepared command from either producer to its consumer, synchronously and exactly once.
 *
 * Deliberately owns nothing: no clocks, no queues, no effect state, no resources. Producers own
 * their own time and call in already knowing *when* a command should run; the router decides only
 * *where it goes* and *what happened*, and records that decision. Introduced now rather than
 * earlier because this is the first moment two real producers target overlapping consumers.
 *
 * Temporal order is the producers' fact, not the router's: commands arrive in the order they must
 * execute and the router never reorders, batches, or defers them.
 */
export class BehaviorEventRouter {
	readonly #consumers: BehaviorConsumers;
	readonly #observations: BehaviorObservation[] = [];
	readonly #outcomeCounts = new Map<BehaviorDispatchOutcome, number>();
	readonly #observationLimit: number;

	constructor(consumers: BehaviorConsumers, observationLimit: number) {
		if (!Number.isInteger(observationLimit) || observationLimit <= 0)
			throw new Error("Router observation limit must be a positive integer.");
		this.#consumers = consumers;
		this.#observationLimit = observationLimit;
	}

	/** Dispatch one command and return the single outcome recorded for it. */
	dispatch(
		command: PreparedBehaviorCommand,
		target: BehaviorTarget,
		provenance: BehaviorCommandProvenance,
		mode: BehaviorDispatchMode,
	): BehaviorDispatchOutcome {
		const outcome = this.#route(command, target, mode);
		this.#observe(command, target, provenance, outcome);
		return outcome;
	}

	getObservations(): readonly BehaviorObservation[] {
		return [...this.#observations];
	}

	getDiagnostics() {
		return {
			observations: this.getObservations(),
			outcomeCounts: Object.fromEntries(this.#outcomeCounts),
		};
	}

	#route(
		command: PreparedBehaviorCommand,
		target: BehaviorTarget,
		mode: BehaviorDispatchMode,
	): BehaviorDispatchOutcome {
		// Checked before every dispatch, not once per batch: a consumer reached earlier in this same
		// batch may already have removed the target.
		if (!this.#consumers.targets.isLive(target)) return "rejected-stale-target";

		switch (command.kind) {
			case "set-omega":
				// Persistent orientation state; replaying it simply lands on the last authored value.
				this.#consumers.effects.applySetOmega(target, command.omega);
				return mode === "initial-state" ? "folded-initial-state" : "executed";

			case "transparent-part":
				// The consumer does not branch on mode: a ramp is persistent state either way, and the
				// remaining replay steps advance it to where it should be now. Only the recorded
				// outcome distinguishes replay from live execution.
				this.#consumers.effects.applyTransparentPart(target, command);
				return mode === "initial-state" ? "folded-initial-state" : "executed";

			case "call-pes":
				// Never executed inline: a self-calling script would recurse forever. The script
				// clock owns activation timing, including the random pause roll.
				this.#consumers.scheduler.scheduleActivation(target, command);
				return "scheduled";

			case "sound-tweaked": {
				// Ephemeral by nature. Replaying elapsed audio would emit a burst of sounds for time
				// the viewer never experienced, which is exactly what retail's catch-up cliff avoids.
				if (mode === "initial-state") return "suppressed-initial-state";
				const outcome = this.#consumers.audio.playSound(target, command);
				if (outcome === "unprepared") return "no-consumer";
				// A sound that lost its probability roll or fell below the audible floor executed
				// correctly by not being heard; that is not a missing consumer.
				return "executed";
			}

			case "sound-table": {
				if (mode === "initial-state") return "suppressed-initial-state";
				const outcome = this.#consumers.audio.playSoundTableKey(
					target,
					command.soundType,
				);
				// A key the resident's table does not author is retail's silent miss; ours reports
				// it rather than pretending a sound played.
				if (outcome === "unprepared") return "no-consumer";
				return "executed";
			}

			case "scale":
				// Persistent whole-object state, so replay behaves exactly as live execution does:
				// the ramp continues from the object's current scale and the remaining replay steps
				// advance it to where it should be now.
				this.#consumers.effects.applyScale(target, command);
				return mode === "initial-state" ? "folded-initial-state" : "executed";

			case "create-particle": {
				// Replay is delegated rather than decided here: persistence is a property of the
				// emitter asset, which the particle consumer owns and the router deliberately does
				// not. A finite burst that already completed is suppressed; a persistent emitter is
				// created and back-dated.
				const outcome = this.#consumers.particles.createEmitter(
					target,
					command,
				);
				if (outcome === "unprepared") return "no-consumer";
				return mode === "initial-state" ? "folded-initial-state" : "executed";
			}

			case "texture-velocity":
			case "texture-velocity-part":
				// Decoded losslessly and deliberately unconsumed. The whole-object arm previously
				// reported a distinct "applied at preparation" outcome, claiming a staging-time
				// resolver carried it as a material fact — but that resolver had no callers, so the
				// outcome was a lie and nothing ever scrolled. Both the resolver and the outcome
				// are gone rather than left as vocabulary nothing produces. Binding it is a render-contract change with zero measured
				// consumers: the workload authors none, and an archive census found no part-scoped
				// hook anywhere. Reporting honestly is better than a resolved-looking no-op.
				return "no-consumer";

			case "replace-object":
				// Intentionally inert, not merely unimplemented: retail has no `Execute` for hook
				// type 5, so doing nothing *is* the faithful behavior. Recorded with provenance so
				// the decision stays visible rather than looking like a gap.
				return "intentionally-inert";

			case "unimplemented":
				return "no-consumer";

			case "semantic":
				return "semantic";
		}
	}

	#observe(
		command: PreparedBehaviorCommand,
		target: BehaviorTarget,
		provenance: BehaviorCommandProvenance,
		outcome: BehaviorDispatchOutcome,
	): void {
		this.#outcomeCounts.set(
			outcome,
			(this.#outcomeCounts.get(outcome) ?? 0) + 1,
		);
		this.#observations.push({
			command: behaviorCommandLabel(command),
			generation: target.generation,
			targetId: target.targetId,
			outcome,
			provenance,
		});
		if (this.#observations.length > this.#observationLimit)
			this.#observations.shift();
	}
}
