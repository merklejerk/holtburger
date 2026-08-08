import {
	createSkyBehaviorTarget,
	skyBehaviorTargetId,
} from "../environment/sky-behavior-targets";
import type { SceneVector3 } from "../../assets/ac-frame";
import type {
	BehaviorTarget,
	BehaviorTargetId,
} from "../behavior/behavior-event-router";
import type { PreparedPhysicsScriptClosure } from "../behavior/physics-script-repository";
import type { DatAssetId } from "../game-types";
import type { ResolvedSkyState } from "../environment/sky-state";
import type { SkyBehaviorTarget } from "../environment/sky-behavior-targets";

/** A sky object that authors no script uses the all-zero DAT id, retail's absent-id marker. */
const NO_SCRIPT_ID = "0x00000000";

/** Everything the sky script runtime needs from the composition root, injected for testability. */
export interface SkyScriptSystemDependencies {
	/** Stage one script and its transitive `CallPES` closure. */
	readonly acquireClosure: (
		scriptId: DatAssetId,
	) => Promise<PreparedPhysicsScriptClosure>;
	/** Stage one emitter definition the closure can reach. */
	readonly acquireEmitter: (emitterInfoId: DatAssetId) => Promise<{
		release: () => void;
	}>;
	/** Make every particle mesh a staged closure can name resident. */
	readonly installMeshes: (
		closure: PreparedPhysicsScriptClosure,
	) => Promise<void>;
	readonly installScript: (
		target: BehaviorTarget,
		closure: PreparedPhysicsScriptClosure,
		timeSeconds: number,
	) => void;
	readonly removeScript: (targetId: BehaviorTargetId) => void;
	readonly registerTarget: (
		targetId: BehaviorTargetId,
		target: SkyBehaviorTarget,
	) => void;
	readonly unregisterTarget: (targetId: BehaviorTargetId) => void;
	/** The viewer's current scene-frame origin, read on demand by every sky target. */
	readonly viewerOrigin: () => SceneVector3;
	readonly clock: () => number;
}

/** One activated sky script, retained so it can be torn down exactly once. */
interface ActiveSkyScript {
	readonly target: BehaviorTarget;
	/** Which script id is running, so a gfx replacement that swaps it forces a restart. */
	readonly scriptId: DatAssetId;
}

/** One script's staged assets, shared by every target running it and released only at destroy. */
interface StagedSkyAssets {
	readonly closure: PreparedPhysicsScriptClosure;
	readonly emitterHandles: readonly { release: () => void }[];
}

/**
 * Runs the physics scripts authored on sky objects.
 *
 * Reconciling rather than event-driven, because that is what the sky itself is: retail rebuilds its
 * sky object set every tick and reuses an existing object only when its identity still matches
 * (`GameSky::CreateDeletePhysicsObjects`, acclient.c:307587). Feeding it each resolved sky state and
 * letting it diff reproduces that without the caller having to detect day-group rollovers, window
 * transitions, or weather toggles separately — they are all just a changed desired set.
 *
 * Owns no clock, no particle state, and no audio: it stages assets, installs on the shared script
 * runtime, and registers a frame provider. Everything downstream reaches sky objects through the
 * composition root's residency lookup and never learns they are not scene residents.
 */
export class SkyScriptSystem {
	readonly #dependencies: SkyScriptSystemDependencies;
	readonly #active = new Map<BehaviorTargetId, ActiveSkyScript>();
	/** In-flight target activations, so a target is not activated twice while its assets load. */
	readonly #pending = new Map<BehaviorTargetId, number>();
	/**
	 * Staged assets per script id, retained for the system's lifetime rather than per activation.
	 *
	 * The sky's script set is closed and tiny — four scripts plus their `CallPES` closures and a
	 * handful of emitter infos — exactly the argument the sky pass uses for loading its meshes
	 * eagerly. Releasing on teardown instead would evict them: `PreparedAssetRepository` drops a
	 * ready entry once its last handle releases, and sky scripts have no other owner, so every
	 * weather toggle, day-group rollover, and authored window transition would re-fetch them.
	 */
	readonly #retained = new Map<DatAssetId, StagedSkyAssets>();
	/** Stagings in flight per script id, so two targets sharing a script stage it once. */
	readonly #staging = new Map<DatAssetId, Promise<StagedSkyAssets>>();
	/**
	 * Monotonic activation counter, minted per activation rather than per target.
	 *
	 * This is the generation that makes a queued command detectably stale: a sky object whose window
	 * closes and reopens is a new activation with a new script clock, and commands from the old one
	 * must be rejected rather than landing on it.
	 */
	#nextGeneration = 1;
	#destroyed = false;

	constructor(dependencies: SkyScriptSystemDependencies) {
		this.#dependencies = dependencies;
	}

	/** Currently running sky scripts, for diagnostics. */
	get activeCount(): number {
		return this.#active.size;
	}

	/**
	 * Bring running scripts into line with the sky as it is now resolved.
	 *
	 * Weather objects are gated on the same switch that gates their drawing, so disabling weather
	 * tears their scripts down rather than leaving them running silently — which is the observable
	 * half of retail's recreate-on-toggle.
	 */
	sync(sky: ResolvedSkyState | null, weatherEnabled: boolean): void {
		if (this.#destroyed) return;
		const desired = new Map<BehaviorTargetId, DesiredSkyScript>();
		for (const object of sky?.objects ?? []) {
			if (object.particleEffectId === NO_SCRIPT_ID) continue;
			if (object.placement.kind === "weather" && !weatherEnabled) continue;
			desired.set(skyBehaviorTargetId(sky!.dayGroupIndex, object.authoredIndex), {
				scriptId: object.particleEffectId as DatAssetId,
				placement: object.placement,
				orientation: object.orientation,
			});
		}

		for (const [targetId, active] of [...this.#active]) {
			const wanted = desired.get(targetId);
			// A target whose script id changed is a different activation, not the same one: a gfx
			// replacement can swap the object under a stable authored index.
			if (wanted === undefined || wanted.scriptId !== active.scriptId) {
				this.#teardown(targetId);
			}
		}

		for (const [targetId, wanted] of desired) {
			if (this.#active.has(targetId) || this.#pending.has(targetId)) continue;
			void this.#activate(targetId, wanted);
		}
	}

	/** Tear down every running sky script and release the region's staged sky assets. */
	destroy(): void {
		this.#destroyed = true;
		for (const targetId of [...this.#active.keys()]) this.#teardown(targetId);
		this.#pending.clear();
		for (const staged of this.#retained.values()) releaseStaged(staged);
		this.#retained.clear();
	}

	async #activate(
		targetId: BehaviorTargetId,
		wanted: DesiredSkyScript,
	): Promise<void> {
		const generation = this.#nextGeneration++;
		this.#pending.set(targetId, generation);
		let staged: StagedSkyAssets;
		try {
			staged = await this.#stage(wanted.scriptId);
		} catch (cause) {
			this.#pending.delete(targetId);
			throw cause;
		}

		// Staging is asynchronous, so the sky may have moved on: the day group rolled over, the
		// object's window closed, or weather was switched off. The assets stay retained either way —
		// only this activation is abandoned.
		const superseded =
			this.#destroyed || this.#pending.get(targetId) !== generation;
		this.#pending.delete(targetId);
		if (superseded) return;

		const target: BehaviorTarget = { generation, targetId };
		this.#dependencies.registerTarget(
			targetId,
			createSkyBehaviorTarget(
				wanted.placement,
				wanted.orientation,
				this.#dependencies.viewerOrigin,
			),
		);
		this.#active.set(targetId, { scriptId: wanted.scriptId, target });
		// Registered before installing: the script's first records run on the installing tick, and a
		// `CreateParticle` at t=0 resolves its origin through the residency lookup immediately.
		this.#dependencies.installScript(
			target,
			staged.closure,
			this.#dependencies.clock(),
		);
	}

	/**
	 * Stage one script's assets once and keep them.
	 *
	 * Two targets running the same script share one staging rather than racing to load it twice,
	 * which the shipped content needs: a Rainy day group authors up to five instances of the same
	 * emitter Setup.
	 */
	async #stage(scriptId: DatAssetId): Promise<StagedSkyAssets> {
		const retained = this.#retained.get(scriptId);
		if (retained) return retained;
		const inflight = this.#staging.get(scriptId) ?? this.#stageFresh(scriptId);
		this.#staging.set(scriptId, inflight);
		return inflight;
	}

	async #stageFresh(scriptId: DatAssetId): Promise<StagedSkyAssets> {
		const closure = await this.#dependencies.acquireClosure(scriptId);
		const emitterHandles: { release: () => void }[] = [];
		try {
			const emitterIds = new Set(
				[...closure.scripts.values()].flatMap(
					(script) => script.dependencies.emitterInfoIds,
				),
			);
			for (const emitterInfoId of emitterIds) {
				emitterHandles.push(
					await this.#dependencies.acquireEmitter(emitterInfoId),
				);
			}
			await this.#dependencies.installMeshes(closure);
		} catch (cause) {
			for (const handle of emitterHandles) handle.release();
			closure.release();
			this.#staging.delete(scriptId);
			throw cause;
		}
		const staged: StagedSkyAssets = { closure, emitterHandles };
		this.#staging.delete(scriptId);
		// A staging that lands after teardown owns assets nothing will ever release, so it releases
		// them itself rather than entering the retained set.
		if (this.#destroyed) {
			releaseStaged(staged);
			return staged;
		}
		this.#retained.set(scriptId, staged);
		return staged;
	}

	#teardown(targetId: BehaviorTargetId): void {
		// Cancels any in-flight staging for this target as well, which the supersession check reads.
		this.#pending.delete(targetId);
		const active = this.#active.get(targetId);
		if (!active) return;
		this.#active.delete(targetId);
		this.#dependencies.removeScript(targetId);
		this.#dependencies.unregisterTarget(targetId);
		// Deliberately does not release: staged assets are region-scoped and outlive any single
		// activation, so a weather toggle or window transition costs a clock, not a reload.
	}
}

function releaseStaged(staged: StagedSkyAssets): void {
	for (const handle of staged.emitterHandles) handle.release();
	staged.closure.release();
}

/** One sky object that should be running a script right now. */
interface DesiredSkyScript {
	readonly scriptId: DatAssetId;
	readonly placement: ResolvedSkyState["objects"][number]["placement"];
	readonly orientation: ResolvedSkyState["objects"][number]["orientation"];
}
