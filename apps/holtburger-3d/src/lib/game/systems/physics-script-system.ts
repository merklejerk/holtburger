import type {
	BehaviorEventRouter,
	BehaviorTarget,
	BehaviorTargetId,
} from "../behavior/behavior-event-router";
import type {
	PreparedPhysicsScript,
	PreparedPhysicsScriptClosure,
} from "../behavior/physics-script-repository";
import type { DatAssetId } from "../game-types";

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
	/** Immutable scripts retained by generation-owned closure handles outside this clock. */
	readonly scripts: Map<DatAssetId, PreparedPhysicsScript>;
	/** First installed root used by the bounded runaway resynchronization policy. */
	readonly primaryRoot: PreparedPhysicsScript;
	readonly target: BehaviorTarget;
	activations: ScriptActivation[];
	pending: PendingActivation[];
	lastTimeSeconds: number | null;
	/** Set once a runaway budget was exhausted, so the condition is reportable, not just handled. */
	runawayCount: number;
}

/** Fully validated replacement generation held outside active script clocks until commit. */
export interface StagedPhysicsScriptOwner {
	commit(): void;
	release(): void;
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
	readonly #records = new Map<BehaviorTargetId, ScriptRecord>();
	readonly #owners = new Map<TOwnerId, Set<BehaviorTargetId>>();
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
		if (this.#records.has(target.targetId))
			throw new Error(`Script state for ${target.targetId} already exists.`);
		this.#records.set(
			target.targetId,
			createScriptRecord(target, closure, timeSeconds),
		);
		let targets = this.#owners.get(ownerId);
		if (!targets) {
			targets = new Set();
			this.#owners.set(ownerId, targets);
		}
		targets.add(target.targetId);
	}

	/**
	 * Append another fully staged root to one entity's retail-shaped script manager.
	 *
	 * Returns false for a stale generation. The caller still owns and must release the supplied
	 * closure; this system borrows its immutable scripts for exactly as long as the owner remains.
	 */
	appendRoot(
		ownerId: TOwnerId,
		target: BehaviorTarget,
		closure: PreparedPhysicsScriptClosure,
		timeSeconds: number,
	): boolean {
		if (this.#destroyed)
			throw new Error("Cannot append into a destroyed physics script system.");
		if (!Number.isFinite(timeSeconds))
			throw new Error("Script activation time must be finite.");
		const existing = this.#records.get(target.targetId);
		if (!existing) {
			this.install(ownerId, target, closure, timeSeconds);
			return true;
		}
		if (existing.target.generation !== target.generation) return false;
		const ownedTargets = this.#owners.get(ownerId);
		if (!ownedTargets?.has(target.targetId)) {
			throw new Error(
				`Script target ${target.targetId} is not owned by ${ownerId}.`,
			);
		}
		for (const [scriptId, script] of closure.scripts) {
			const retained = existing.scripts.get(scriptId);
			if (retained !== undefined && retained !== script) {
				throw new Error(
					`Script ${scriptId} was prepared twice with different immutable values.`,
				);
			}
		}
		for (const [scriptId, script] of closure.scripts)
			existing.scripts.set(scriptId, script);
		const root = existing.scripts.get(closure.rootId);
		if (!root)
			throw new Error(
				`Script closure for ${closure.rootId} does not contain its root.`,
			);
		existing.pending.push({
			scriptId: root.id,
			startTime: Math.max(timeSeconds, this.#chainedStartTime(existing)),
		});
		return true;
	}

	/** Stage a complete owner replacement without dispatching against unpublished targets. */
	stageOwner(
		ownerId: TOwnerId,
		installations: readonly {
			readonly target: BehaviorTarget;
			readonly closure: PreparedPhysicsScriptClosure;
			readonly timeSeconds: number;
		}[],
	): StagedPhysicsScriptOwner {
		if (this.#destroyed)
			throw new Error("Cannot stage into a destroyed physics script system.");
		const records = new Map<BehaviorTargetId, ScriptRecord>();
		for (const installation of installations) {
			if (
				records.has(installation.target.targetId) ||
				this.#records.has(installation.target.targetId)
			) {
				throw new Error(
					`Script state for ${installation.target.targetId} already exists.`,
				);
			}
			records.set(
				installation.target.targetId,
				createScriptRecord(
					installation.target,
					installation.closure,
					installation.timeSeconds,
				),
			);
		}
		let state: "staged" | "committed" | "released" = "staged";
		return {
			commit: () => {
				if (state !== "staged")
					throw new Error(`Cannot commit script stage in state ${state}.`);
				if (this.#destroyed)
					throw new Error(
						"Cannot commit into a destroyed physics script system.",
					);
				this.removeOwner(ownerId);
				for (const [targetId, record] of records)
					this.#records.set(targetId, record);
				if (records.size > 0)
					this.#owners.set(ownerId, new Set(records.keys()));
				state = "committed";
			},
			release: () => {
				if (state === "staged") state = "released";
			},
		};
	}

	/** Whether this system still holds the exact target and generation a command targets. */
	holds(target: BehaviorTarget): boolean {
		const record = this.#records.get(target.targetId);
		return record?.target.generation === target.generation;
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

	/**
	 * Remove one target's clocks and queued activations as one operation.
	 *
	 * The staged closure is **borrowed, not owned**: whoever acquired it releases it, because that
	 * owner must also release it when preparation fails or is superseded — before any clock exists.
	 * Releasing here as well would be a double release, which the repository correctly rejects.
	 */
	remove(ownerId: TOwnerId, targetId: BehaviorTargetId): void {
		const record = this.#records.get(targetId);
		if (!record) return;
		this.#records.delete(targetId);
		const targets = this.#owners.get(ownerId);
		targets?.delete(targetId);
		if (targets && targets.size === 0) this.#owners.delete(ownerId);
	}

	removeOwner(ownerId: TOwnerId): void {
		for (const targetId of [...(this.#owners.get(ownerId) ?? [])])
			this.remove(ownerId, targetId);
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		// Closures are borrowed; their owner releases them.
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
				`Script clock for ${record.target.targetId} moved backwards.`,
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
		const script = record.scripts.get(pending.scriptId);
		// The closure is staged transitively before activation, so a miss is a staging defect.
		if (!script)
			throw new Error(
				`Script ${pending.scriptId} is not staged for ${record.target.targetId}.`,
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
		record.activations = [
			{
				nextRecordIndex: 0,
				script: record.primaryRoot,
				startTime: timeSeconds,
			},
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
		const record = this.#records.get(target.targetId);
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
		for (const pending of record.pending) {
			const script = record.scripts.get(pending.scriptId);
			if (!script)
				throw new Error(
					`Pending script ${pending.scriptId} is not staged for ${record.target.targetId}.`,
				);
			const end = pending.startTime + script.lengthSeconds;
			if (latest === null || end > latest) latest = end;
		}
		return latest ?? record.lastTimeSeconds ?? 0;
	}
}

function createScriptRecord(
	target: BehaviorTarget,
	closure: PreparedPhysicsScriptClosure,
	timeSeconds: number,
): ScriptRecord {
	if (!Number.isFinite(timeSeconds))
		throw new Error("Script activation time must be finite.");
	const root = closure.scripts.get(closure.rootId);
	if (!root)
		throw new Error(
			`Script closure for ${closure.rootId} does not contain its root.`,
		);
	return {
		activations: [{ nextRecordIndex: 0, script: root, startTime: timeSeconds }],
		primaryRoot: root,
		scripts: new Map(closure.scripts),
		lastTimeSeconds: timeSeconds,
		pending: [],
		runawayCount: 0,
		target,
	};
}
