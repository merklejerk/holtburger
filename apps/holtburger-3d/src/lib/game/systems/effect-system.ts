import type {
	BehaviorTarget,
	EffectCommandPort,
	BehaviorDispatchMode,
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
import { requireSceneNodeId } from "../scene/utils";
import type { SceneNodeId } from "../scene";
import type { PreparedBehaviorCommand } from "../behavior/prepared-behavior-command";
import type { PartRenderState } from "./components";

/** Retail's small-duration boundary in the authored f32 domain, including an exact threshold. */
export const MINIMUM_TIMED_EFFECT_SECONDS = Math.fround(0.0002);

/** A linear ramp toward a whole-object uniform scale, as retail's `SetScale` interpolates. */
interface ScaleRamp {
	readonly durationSeconds: number;
	readonly end: number;
	readonly start: number;
	elapsedSeconds: number;
}

/** A timed material write; newest hooks execute first and older hooks can write last. */
interface TranslucencyHook {
	readonly target:
		| { readonly kind: "object" }
		| { readonly kind: "part"; readonly part: PartEffectState };
	readonly durationSeconds: number;
	readonly start: number;
	readonly end: number;
	/** Relative to the committed clock; live insertion subtracts its current fractional phase. */
	elapsedSeconds: number;
}

/** Source facts required independently of any scripted/current part material values. */
export interface EffectMaterialSource {
	/** Original object-description floor, retained for this installed object's lifetime. */
	readonly translucency: number;
	/** Cloaked parts ignore material writes, including endpoints of completed hooks. */
	readonly cloaked: boolean;
}

/** Object-owned effects for one rigid part, retired together with its layout. */
interface PartEffectState {
	/** Committed physics-step value and the current frame's permitted fractional material write. */
	readonly translucency: { committed: number; sampled: number };
	/** U/V cycles per second, sampled against the shared renderer clock. */
	textureVelocity: readonly [number, number];
}

interface EffectState {
	/** Object-description baseline is not changed by current-value or script writes. */
	readonly originalTranslucency: number;
	/** Authoritative material write admission, supplied by the presentation owner. */
	cloaked: boolean;
	/** Both whole-object and part-local hooks coexist in newest-first execution order. */
	translucencyHooks: TranslucencyHook[];
	/**
	 * Whether this state has changed since it was last sampled.
	 *
	 * An inert resident — no ramp in flight, no omega — resolves to the same presentation every
	 * frame, and publishing it is pure cost. A state stays dirty while it is animating, because
	 * each committed step marks it again.
	 */
	dirty: boolean;
	committedOrientation: Quat;
	omega: Vec3;
	/**
	 * Whole-object uniform scale multiplier applied on top of the source and per-part scales.
	 *
	 * Retail writes one scalar across the entire part array and composes it multiplicatively
	 * with each part's setup `default_scale`, so this is a modifier, not a replacement.
	 */
	scale: number;
	scaleRamp: ScaleRamp | null;
	/** Complete effects indexed by the installed authored part layout. */
	readonly parts: PartEffectState[];
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
 * Retail's behavior tick, and the cadence every effect ramp advances on.
 *
 * Exported from the system that owns the clock. Animation imports it for its own hook cadence.
 */
export const BEHAVIOR_STEP_SECONDS = 1 / 30;
/** Absorbs timestamp subtraction noise at behavior-step and hook-completion boundaries. */
export const BEHAVIOR_CLOCK_EPSILON_SECONDS = 1e-9;

/** Owns the shared effect clock, committed visual state, and render-cadence material samples. */
export class EffectSystem implements EffectCommandPort {
	readonly #states = new Map<SceneNodeId, EffectState>();
	#appliedCommandCount = 0;
	/** Behavior-step accumulator, shared by every installed state. */
	#fractionalSeconds = 0;
	#lastTimeSeconds: number | null = null;

	install(
		nodeId: SceneNodeId,
		partCount: number,
		source: EffectMaterialSource,
	): void {
		if (this.#states.has(nodeId))
			throw new Error(`Effect state for ${nodeId} already exists.`);
		if (!Number.isInteger(partCount) || partCount <= 0)
			throw new Error("Effect state requires a positive part count.");
		if (
			!Number.isFinite(source.translucency) ||
			source.translucency < 0 ||
			source.translucency > 1
		)
			throw new Error(
				"Effect state requires initial translucency between zero and one.",
			);
		this.#states.set(nodeId, {
			originalTranslucency: source.translucency,
			cloaked: source.cloaked,
			translucencyHooks: [],
			committedOrientation: Quat.identity(),
			omega: Vec3.zero(),
			scale: 1,
			scaleRamp: null,
			dirty: true,
			parts: Array.from({ length: partCount }, () => ({
				translucency: {
					committed: source.cloaked ? 0 : source.translucency,
					sampled: source.cloaked ? 0 : source.translucency,
				},
				textureVelocity: [0, 0],
			})),
		});
	}

	/** Apply one current whole-object translucency level without disturbing part-local ramps. */
	applyObjectTranslucency(nodeId: SceneNodeId, translucency: number): void {
		if (!Number.isFinite(translucency) || translucency < 0 || translucency > 1)
			throw new Error("Object translucency must be between zero and one.");
		const state = this.#requiredState(nodeId);
		if (state.cloaked) return;
		for (const part of state.parts)
			writePartTranslucency(part, translucency, "committed");
		state.dirty = true;
	}

	/** Preserve permitted material values when cloak starts; ignored writes never replay later. */
	setCloaked(nodeId: SceneNodeId, cloaked: boolean): void {
		const state = this.#requiredState(nodeId);
		if (state.cloaked === cloaked) return;
		if (cloaked) {
			for (const part of state.parts)
				part.translucency.committed = part.translucency.sampled;
		}
		state.cloaked = cloaked;
		state.dirty = true;
	}

	/**
	 * Advance the shared behavior clock, committing whole steps to every installed state.
	 *
	 * Owned here rather than by a producer. Stepping used to hang off `AnimationSystem`, which holds
	 * a behavior clock per playback — so a resident with a script but no animation was never
	 * stepped at all, and its ramps, `SetOmega`, and `Scale` were silently inert. Neither producer
	 * is the right owner: giving it to `PhysicsScriptSystem` instead would leave the mirror-image
	 * gap for an animated-but-unscripted entity. The state lives here, so the clock does too.
	 *
	 * The cadence is now global rather than per playback, so every entity steps on the same phase.
	 * Retail's behavior tick is likewise global.
	 */
	advance(timeSeconds: number): void {
		if (!Number.isFinite(timeSeconds))
			throw new Error("Effect clock time must be finite.");
		const previous = this.#lastTimeSeconds;
		this.#lastTimeSeconds = timeSeconds;
		for (const state of this.#states.values()) {
			if (state.translucencyHooks.length > 0) state.dirty = true;
		}
		if (previous === null) {
			for (const state of this.#states.values()) {
				if (state.translucencyHooks.length > 0)
					sampleTranslucencyHooks(state, this.#fractionalSeconds);
			}
			return;
		}
		if (timeSeconds < previous)
			throw new Error("Effect clock moved backwards.");
		this.#fractionalSeconds += timeSeconds - previous;
		let committed = false;
		while (
			this.#fractionalSeconds + BEHAVIOR_CLOCK_EPSILON_SECONDS >=
			BEHAVIOR_STEP_SECONDS
		) {
			committed = true;
			this.#fractionalSeconds = Math.max(
				0,
				this.#fractionalSeconds - BEHAVIOR_STEP_SECONDS,
			);
			for (const nodeId of this.#states.keys()) {
				this.#commitStep(nodeId, BEHAVIOR_STEP_SECONDS);
			}
		}
		for (const state of this.#states.values()) {
			if (
				state.translucencyHooks.length > 0 &&
				(!committed || this.#fractionalSeconds > BEHAVIOR_CLOCK_EPSILON_SECONDS)
			)
				sampleTranslucencyHooks(state, this.#fractionalSeconds);
		}
	}

	/**
	 * Commit one behavior step to a single state, for install-time replay only.
	 *
	 * Distinct from {@link advance}, which is the per-frame cadence across every state. A newly
	 * installed playback folds its history forward to its authored independent phase, and the shared
	 * clock cannot do that: it steps everything once per elapsed step, not one node many times.
	 */
	foldSemanticStep(nodeId: SceneNodeId): void {
		this.#commitStep(nodeId, BEHAVIOR_STEP_SECONDS);
	}

	/** Join a newly replayed owner's fractional phase to the existing shared live clock. */
	finishReplay(nodeId: SceneNodeId, remainingSeconds: number): void {
		if (
			!Number.isFinite(remainingSeconds) ||
			remainingSeconds < 0 ||
			remainingSeconds >= BEHAVIOR_STEP_SECONDS
		)
			throw new Error(
				"Effect replay remainder must be within one behavior step.",
			);
		const state = this.#requiredState(nodeId);
		for (const hook of state.translucencyHooks)
			hook.elapsedSeconds += remainingSeconds;
		if (
			remainingSeconds > BEHAVIOR_CLOCK_EPSILON_SECONDS &&
			state.translucencyHooks.length > 0
		)
			sampleTranslucencyHooks(state, 0);
		// Hook age now includes the replay remainder. Remove the live clock's current remainder
		// from committed-relative age so the next shared update cannot count that time twice.
		for (const hook of state.translucencyHooks)
			hook.elapsedSeconds -= this.#fractionalSeconds;
	}

	/** Advance exactly one committed behavior step for one state. */
	#commitStep(nodeId: SceneNodeId, stepSeconds: number): void {
		const state = this.#requiredState(nodeId);
		// A state with nothing in flight presents identically after this step, so leaving it clean
		// is what lets an idle resident stop publishing.
		const animating =
			state.scaleRamp !== null ||
			state.omega.x !== 0 ||
			state.omega.y !== 0 ||
			state.omega.z !== 0 ||
			state.translucencyHooks.length > 0;
		if (animating) state.dirty = true;
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
		if (state.translucencyHooks.length > 0) {
			for (const hook of state.translucencyHooks) {
				hook.elapsedSeconds += stepSeconds;
				if (!state.cloaked)
					writeTranslucency(
						state,
						hook.target,
						sampleRamp(hook, hook.elapsedSeconds),
						"committed",
					);
			}
			// Retire after the endpoint write, preserving newest-first ordering on this boundary.
			state.translucencyHooks = state.translucencyHooks.filter(
				(hook) =>
					hook.elapsedSeconds + BEHAVIOR_CLOCK_EPSILON_SECONDS <
					hook.durationSeconds,
			);
		}
	}

	/**
	 * Ramp the whole-object scale toward `end`.
	 *
	 * Retail interpolates linearly **from the object's current scale**, not from a fixed base,
	 * so a second command mid-ramp continues from wherever the first one had reached
	 * (`SetScale`).
	 */
	applyScale(
		target: BehaviorTarget,
		values: { readonly end: number; readonly durationSeconds: number },
	): void {
		const state = this.#requiredState(
			requireSceneNodeId(target.targetId, "EffectSystem"),
		);
		state.dirty = true;
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

	/**
	 * Install a continuous spin on the resident's visual root.
	 *
	 * RETAIL DIVERGENCE: retail execute calls retail object omega assignment, which writes the
	 * *body's* angular velocity; the body then grotates its own world frame every update,
	 * carrying collision along with the visual. We keep the spin on the visual root instead,
	 * composed in retail's `delta * current` order.
	 *
	 * Consequence of "correcting" it: nothing, for any content that exists — and it would cost
	 * a second mechanism. The body *can* already carry this. `SpatialBody.omega` exists and
	 * `integrate_angular_velocity` applies it in retail's own `delta * rotation` order. The
	 * reason to keep it here is the carriers, not the capability.
	 *
	 * Census 2026-08-20, archive-wide: 8 `SetOmega` hooks in 8 animations, reached by 8
	 * setups. Five are scenery-only — no catalog template reaches them, so they own no spatial
	 * body to spin at all. The other three are spawnable (WCIDs 3654 "Sentinel Channel", 10698
	 * and 10699 "Butterflies!"), and every one is `ethereal + ignore_collisions`, resolving to
	 * `EntityCollisionParticipation::Suppressed`. So routing this to body omega would be
	 * impossible for five carriers and observationally identical for the other three, leaving
	 * two mechanisms for one hook in exchange for no behavioural change.
	 *
	 * `prepareDynamicAnimation` pays for the visual half with `rotationInvariantBounds`.
	 */
	applySetOmega(target: BehaviorTarget, omega: Vec3): void {
		const state = this.#requiredState(
			requireSceneNodeId(target.targetId, "EffectSystem"),
		);
		state.dirty = true;
		state.omega = new Vec3(omega.x, omega.y, omega.z);
		this.#appliedCommandCount += 1;
	}

	/**
	 * Schedule one ordered translucency write without replacing any earlier active hook.
	 * Retail behavior is to enqueue timed hooks without writing their start value; immediate
	 * commands write the endpoint and leave active hooks intact. Whole-object writes apply the
	 * original floor, while part-local writes do not. Both producers execute through this seam.
	 */
	applyTranslucency(
		target: BehaviorTarget,
		command: Extract<
			PreparedBehaviorCommand,
			{ kind: "transparent" | "transparent-part" }
		>,
		mode: BehaviorDispatchMode,
	): void {
		const state = this.#requiredState(
			requireSceneNodeId(target.targetId, "EffectSystem"),
		);
		let writeTarget: TranslucencyHook["target"];
		if (command.kind === "transparent") writeTarget = { kind: "object" };
		else {
			// A script's authored part need not exist in the setup it eventually runs on.
			const part = state.parts[command.partIndex];
			if (part === undefined) return;
			writeTarget = { kind: "part", part };
		}
		this.#appliedCommandCount += 1;
		if (command.durationSeconds < MINIMUM_TIMED_EFFECT_SECONDS) {
			if (!state.cloaked) {
				writeTranslucency(state, writeTarget, command.end, "committed");
				state.dirty = true;
			}
			return;
		}
		state.translucencyHooks.unshift({
			target: writeTarget,
			start: command.start,
			end: command.end,
			durationSeconds: command.durationSeconds,
			// Replay owns independent elapsed steps; live commands start at the current wall time,
			// rather than inheriting the shared clock's already elapsed fractional remainder.
			elapsedSeconds: mode === "live" ? -this.#fractionalSeconds : 0,
		});
		state.dirty = true;
	}

	/**
	 * RETAIL DIVERGENCE: assigns rates globally by GfxObj ID. We assign only this object's
	 * parts; other copies without hooks remain stationary. Restoring retail ownership would
	 * couple independent objects and require shared retention. Census 2026-09-10: 11
	 * whole-object script hooks, 11 direct setup carriers, 13 graphics assets; no animation or
	 * part-scoped hooks. The cell placement scan also found four direct non-hook copies
	 * (01002A63 in 00F10125/126/138; 01004D3C in 2C31FFFE), which now stay still. Generated
	 * scenery and server spawns were not included in that placement census.
	 */
	applyTextureVelocity(
		target: BehaviorTarget,
		command: Extract<
			PreparedBehaviorCommand,
			{ kind: "texture-velocity" | "texture-velocity-part" }
		>,
	): void {
		const state = this.#requiredState(
			requireSceneNodeId(target.targetId, "EffectSystem"),
		);
		let selected: readonly PartEffectState[] = state.parts;
		if (command.kind === "texture-velocity-part") {
			const part = state.parts[command.partIndex];
			if (part === undefined)
				throw new Error(
					`TextureVelocityPart index ${command.partIndex} is out of range for active effect state.`,
				);
			selected = [part];
		}
		const velocity: readonly [number, number] = [
			command.uSpeed,
			command.vSpeed,
		];
		for (const part of selected) {
			if (
				part.textureVelocity[0] === velocity[0] &&
				part.textureVelocity[1] === velocity[1]
			)
				continue;
			part.textureVelocity = velocity;
			state.dirty = true;
		}
		this.#appliedCommandCount += 1;
	}

	/**
	 * Sample one state's presentation, interpolated across the shared clock's current sub-step.
	 *
	 * Takes no time arguments: the phase is a property of the behavior clock, not of whichever
	 * caller happens to be sampling, and passing an animation record's phase in was how the two
	 * became coupled.
	 */
	samplePresentation(nodeId: SceneNodeId): EffectPresentationSample {
		const fractionalSeconds = this.#fractionalSeconds;
		const semanticStepFraction = fractionalSeconds / BEHAVIOR_STEP_SECONDS;
		const state = this.#requiredState(nodeId);
		state.dirty = false;
		const delta = rotationVectorQuaternion(
			new Vec3(
				state.omega.x * semanticStepFraction,
				state.omega.y * semanticStepFraction,
				state.omega.z * semanticStepFraction,
			),
		);
		return {
			partRenderStates: state.parts.map((part) => ({
				textureVelocity: part.textureVelocity,
				translucency: part.translucency.sampled,
			})),
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

	/** Whether this state would present differently from the last sample taken of it. */
	needsPresentation(nodeId: SceneNodeId): boolean {
		return this.#requiredState(nodeId).dirty;
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

function sampleRamp(ramp: TranslucencyHook, elapsedSeconds: number): number {
	if (elapsedSeconds + BEHAVIOR_CLOCK_EPSILON_SECONDS >= ramp.durationSeconds)
		return ramp.end;
	return (
		ramp.start +
		(ramp.end - ramp.start) *
			(Math.max(0, elapsedSeconds) / ramp.durationSeconds)
	);
}

/** Apply the target/floor rule once for both committed and fractional material writes. */
function writeTranslucency(
	state: EffectState,
	target: TranslucencyHook["target"],
	value: number,
	lane: "committed" | "sampled",
): void {
	if (target.kind === "object") {
		const floored = Math.max(value, state.originalTranslucency);
		for (const part of state.parts) writePartTranslucency(part, floored, lane);
	} else writePartTranslucency(target.part, value, lane);
}

/** Immediate commands keep their write visible until the next clock update. */
function writePartTranslucency(
	part: PartEffectState,
	value: number,
	lane: "committed" | "sampled",
): void {
	if (lane === "committed") part.translucency.committed = value;
	part.translucency.sampled = value;
}

/** Update fractional presentation without committing time or retiring hooks. */
function sampleTranslucencyHooks(
	state: EffectState,
	fractionalSeconds: number,
): void {
	if (state.cloaked) return;
	for (const part of state.parts)
		part.translucency.sampled = part.translucency.committed;
	for (const hook of state.translucencyHooks)
		writeTranslucency(
			state,
			hook.target,
			sampleRamp(hook, hook.elapsedSeconds + fractionalSeconds),
			"sampled",
		);
}
