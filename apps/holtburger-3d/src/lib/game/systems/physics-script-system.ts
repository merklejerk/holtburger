import type {
	BehaviorEventRouter,
	BehaviorTarget,
} from "../behavior/behavior-event-router";
import type {
	PreparedPhysicsScript,
	PreparedPhysicsScriptClosure,
} from "../behavior/physics-script-repository";
import type { DatAssetId } from "../game-types";
import type { SceneNodeId } from "../scene";

/**
 * Retail treats a `CallPES` pause below this as immediate rather than scheduling an `FPHook`
 * (`CPhysicsObj::CallPES`, acclient.c:307316-307345).
 */
const INSTANT_PAUSE_SECONDS = 0.0002;

/**
 * Dispatches one entity may perform in a single advance before it is considered runaway.
 *
 * Retail has no guard at all here: a zero-length script that self-calls with `pause = 0`
 * infinite-loops the shipped client with unbounded allocation. This budget serves two purposes at
 * once — it bounds that runaway, and it bounds catch-up after a long stall. Exhausting it
 * resynchronizes the entity to the current time and reports it, rather than silently discarding
 * elapsed time the way retail's 2-second cliff does.
 */
const MAXIMUM_DISPATCHES_PER_ADVANCE = 512;

/** One running script: which script, and the absolute time its record clock is anchored to. */
interface ScriptActivation {
	readonly script: PreparedPhysicsScript;
	/** Absolute seconds at which record time 0 occurs. */
	readonly startTime: number;
	/** Index of the next record to dispatch, so each record fires exactly once. */
	nextRecordIndex: number;
}

/** A chained activation waiting for its (possibly randomized) start time. */
interface PendingActivation {
	readonly scriptId: DatAssetId;
	readonly startTime: number;
}

interface ScriptRecord {
	readonly closure: PreparedPhysicsScriptClosure;
	readonly target: BehaviorTarget;
	activations: ScriptActivation[];
	pending: PendingActivation[];
	lastTimeSeconds: number | null;
	/** Set once a runaway budget was exhausted, so the condition is reportable, not just handled. */
	runawayCount: number;
}

export interface PhysicsScriptDiagnostics {
	readonly activeOwnerCount: number;
	readonly activeScriptCount: number;
	readonly pendingActivationCount: number;
	readonly resynchronizedCount: number;
	readonly lastAdvancementDurationMs: number;
}

/** Source of the uniform roll retail performs for a nonzero `CallPES` pause. */
export type UniformRoll = () => number;

/**
 * Owns per-entity physics-script clocks and chained activation, and nothing else.
 *
 * Independent of `AnimationSystem` by construction: neither advances nor observes the other's
 * clock, and an entity may run both. Scripts are wall-clock rather than frame-cadence — retail
 * anchors record times to `Timer::cur_time` and never sub-steps them — so this system does not
 * borrow the animation lane's fixed behavior step.
 */
export class PhysicsScriptSystem<TOwnerId extends string> {
	readonly #router: BehaviorEventRouter;
	readonly #roll: UniformRoll;
	readonly #records = new Map<SceneNodeId, ScriptRecord>();
	readonly #owners = new Map<TOwnerId, Set<SceneNodeId>>();
	#resynchronizedCount = 0;
	#lastAdvancementDurationMs = 0;
	#destroyed = false;

	/**
	 * @param roll Uniform [0, 1) source for `CallPES` pause deferral, injected so tests are
	 * deterministic and so the runtime's randomness stays explicit rather than ambient.
	 */
	constructor(router: BehaviorEventRouter, roll: UniformRoll) {
		this.#router = router;
		this.#roll = roll;
	}

	/**
	 * Begin running a staged script closure on one target.
	 *
	 * The root activates at `timeSeconds` with phase 0, matching retail: scripts start when they are
	 * added and there is no initial-phase randomization anywhere in the script path. Residents that
	 * should not run in lockstep get their spread from differing activation instants, exactly as in
	 * retail.
	 */
	install(
		ownerId: TOwnerId,
		target: BehaviorTarget,
		closure: PreparedPhysicsScriptClosure,
		timeSeconds: number,
	): void {
		if (this.#destroyed)
			throw new Error("Cannot install into a destroyed physics script system.");
		if (this.#records.has(target.nodeId))
			throw new Error(`Script state for ${target.nodeId} already exists.`);
		if (!Number.isFinite(timeSeconds))
			throw new Error("Script activation time must be finite.");
		const root = closure.scripts.get(closure.rootId);
		if (!root)
			throw new Error(
				`Script closure for ${closure.rootId} does not contain its root.`,
			);
		this.#records.set(target.nodeId, {
			activations: [
				{ nextRecordIndex: 0, script: root, startTime: timeSeconds },
			],
			closure,
			lastTimeSeconds: timeSeconds,
			pending: [],
			runawayCount: 0,
			target,
		});
		let nodes = this.#owners.get(ownerId);
		if (!nodes) {
			nodes = new Set();
			this.#owners.set(ownerId, nodes);
		}
		nodes.add(target.nodeId);
	}

	/** Advance every script clock to `timeSeconds`, dispatching every record it crosses. */
	advance(timeSeconds: number): void {
		if (this.#destroyed)
			throw new Error("Cannot advance a destroyed physics script system.");
		if (!Number.isFinite(timeSeconds))
			throw new Error("Script time must be finite.");
		const startedAt = performance.now();
		for (const record of this.#records.values())
			this.#advanceRecord(record, timeSeconds);
		this.#lastAdvancementDurationMs = performance.now() - startedAt;
	}

	/** Remove one target's clocks, queued activations, and staged closure as one operation. */
	remove(ownerId: TOwnerId, nodeId: SceneNodeId): void {
		const record = this.#records.get(nodeId);
		if (!record) return;
		this.#records.delete(nodeId);
		const nodes = this.#owners.get(ownerId);
		nodes?.delete(nodeId);
		if (nodes && nodes.size === 0) this.#owners.delete(ownerId);
		record.closure.release();
	}

	removeOwner(ownerId: TOwnerId): void {
		for (const nodeId of [...(this.#owners.get(ownerId) ?? [])])
			this.remove(ownerId, nodeId);
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		for (const record of this.#records.values()) record.closure.release();
		this.#records.clear();
		this.#owners.clear();
	}

	getDiagnostics(): PhysicsScriptDiagnostics {
		let activeScriptCount = 0;
		let pendingActivationCount = 0;
		for (const record of this.#records.values()) {
			activeScriptCount += record.activations.length;
			pendingActivationCount += record.pending.length;
		}
		return {
			activeOwnerCount: this.#records.size,
			activeScriptCount,
			lastAdvancementDurationMs: this.#lastAdvancementDurationMs,
			pendingActivationCount,
			resynchronizedCount: this.#resynchronizedCount,
		};
	}

	#advanceRecord(record: ScriptRecord, timeSeconds: number): void {
		const previous = record.lastTimeSeconds;
		record.lastTimeSeconds = timeSeconds;
		// A clock that moved backwards is a runtime fault, not authored content; refuse to invent an
		// interpretation for it.
		if (previous !== null && timeSeconds < previous)
			throw new Error(
				`Script clock for ${record.target.nodeId} moved backwards.`,
			);

		let dispatches = 0;
		while (this.#step(record, timeSeconds, "live")) {
			dispatches += 1;
			if (dispatches >= MAXIMUM_DISPATCHES_PER_ADVANCE) {
				this.#resynchronize(record, timeSeconds);
				return;
			}
		}
	}

	/**
	 * Perform the single earliest outstanding action, returning whether anything was done.
	 *
	 * Activations and record dispatches are interleaved by time rather than drained in separate
	 * passes, so a chained script that starts mid-interval still runs its own records in the right
	 * order relative to the caller's.
	 */
	#step(
		record: ScriptRecord,
		timeSeconds: number,
		mode: "initial-state" | "live",
	): boolean {
		const nextRecord = this.#nextDueRecord(record, timeSeconds);
		const nextPending = this.#nextDuePending(record, timeSeconds);
		if (!nextRecord && !nextPending) {
			this.#reapCompleted(record, timeSeconds);
			return false;
		}
		// Ties resolve toward starting the activation first: a script that begins at exactly this
		// instant may author a record at t=0 that must not be pushed behind an older one.
		if (
			nextPending &&
			(!nextRecord || nextPending.startTime <= nextRecord.time)
		) {
			this.#activate(record, nextPending);
			return true;
		}
		if (!nextRecord) return false;
		const { activation, command } = nextRecord;
		activation.nextRecordIndex += 1;
		this.#router.dispatch(
			command,
			record.target,
			{
				assetId: activation.script.id,
				authoredOrder: command.authoredOrder,
				authoredPosition: command.startTime,
				producer: "physics-script",
			},
			mode,
		);
		return true;
	}

	#nextDueRecord(
		record: ScriptRecord,
		timeSeconds: number,
	): {
		readonly activation: ScriptActivation;
		readonly command: PreparedPhysicsScript["records"][number];
		readonly time: number;
	} | null {
		let earliest: {
			activation: ScriptActivation;
			command: PreparedPhysicsScript["records"][number];
			time: number;
		} | null = null;
		for (const activation of record.activations) {
			const command = activation.script.records[activation.nextRecordIndex];
			if (!command) continue;
			const time = activation.startTime + command.startTime;
			if (time > timeSeconds) continue;
			if (!earliest || time < earliest.time)
				earliest = { activation, command, time };
		}
		return earliest;
	}

	#nextDuePending(
		record: ScriptRecord,
		timeSeconds: number,
	): PendingActivation | null {
		let earliest: PendingActivation | null = null;
		for (const pending of record.pending) {
			if (pending.startTime > timeSeconds) continue;
			if (!earliest || pending.startTime < earliest.startTime)
				earliest = pending;
		}
		return earliest;
	}

	#activate(record: ScriptRecord, pending: PendingActivation): void {
		record.pending = record.pending.filter((entry) => entry !== pending);
		const script = record.closure.scripts.get(pending.scriptId);
		// The closure is staged transitively before activation, so a miss is a staging defect.
		if (!script)
			throw new Error(
				`Script ${pending.scriptId} is not staged in the closure for ${record.closure.rootId}.`,
			);
		record.activations.push({
			nextRecordIndex: 0,
			script,
			startTime: pending.startTime,
		});
	}

	/** Drop activations whose records have all fired and whose authored length has elapsed. */
	#reapCompleted(record: ScriptRecord, timeSeconds: number): void {
		record.activations = record.activations.filter(
			(activation) =>
				activation.nextRecordIndex < activation.script.records.length ||
				timeSeconds < activation.startTime + activation.script.lengthSeconds,
		);
	}

	/**
	 * Abandon un-replayed history and restart the entity's scripts at the current instant.
	 *
	 * Reached only when an entity exhausts its dispatch budget in one advance, which means either a
	 * runaway zero-length cycle or a stall long enough that replaying it is not worth the work.
	 */
	#resynchronize(record: ScriptRecord, timeSeconds: number): void {
		record.runawayCount += 1;
		this.#resynchronizedCount += 1;
		const root = record.closure.scripts.get(record.closure.rootId)!;
		record.activations = [
			{ nextRecordIndex: 0, script: root, startTime: timeSeconds },
		];
		record.pending = [];
	}

	/**
	 * The router's chained-activation port.
	 *
	 * Kept as a method rather than a closure so the system's ownership of activation timing is
	 * visible at the type level: the router hands over a request and learns nothing about when it
	 * will run.
	 */
	scheduleActivation(
		target: BehaviorTarget,
		activation: {
			readonly scriptId: DatAssetId;
			readonly pauseSeconds: number;
		},
	): void {
		const record = this.#records.get(target.nodeId);
		if (!record || record.target.generation !== target.generation) return;
		const startTime =
			activation.pauseSeconds < INSTANT_PAUSE_SECONDS
				? this.#chainedStartTime(record)
				: (record.lastTimeSeconds ?? 0) +
					this.#roll() * activation.pauseSeconds;
		record.pending.push({ scriptId: activation.scriptId, startTime });
	}

	/**
	 * Where an immediately chained script begins.
	 *
	 * Retail queues it at `last.start_time + last.script.length` rather than at the current clock
	 * (`AddScriptInternal`, acclient.c:316331-316355), which is precisely why a self-calling script
	 * repeats at exactly its authored length with zero drift no matter how coarse the frame rate is.
	 */
	#chainedStartTime(record: ScriptRecord): number {
		let latest: number | null = null;
		for (const activation of record.activations) {
			const end = activation.startTime + activation.script.lengthSeconds;
			if (latest === null || end > latest) latest = end;
		}
		return latest ?? record.lastTimeSeconds ?? 0;
	}
}
