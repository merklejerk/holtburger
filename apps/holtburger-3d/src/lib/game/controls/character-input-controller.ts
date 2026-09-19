import type { CharacterAction } from "../../input/input-contract";
/** Semantic character input accepted by the host-owned grounded controller. */
export interface CharacterDrive {
	readonly gait: "run" | "walk";
	readonly lateral: "left" | "right" | null;
	readonly longitudinal: "backward" | "forward" | null;
	readonly turn: "left" | "right" | null;
}

/** Whether a drive command acquires, reconciles, or releases manual movement ownership. */
export type CharacterDriveIntent = "acquire" | "release" | "synchronize";

/** Non-coalescible lifecycle edge sent in frontend order. */
export type CharacterInputEdge =
	| {
			readonly drive: CharacterDrive;
			readonly kind: "begin-jump";
			readonly sequence: number;
	  }
	| {
			readonly drive: CharacterDrive;
			readonly extent: number;
			readonly kind: "release-jump";
			readonly sequence: number;
	  }
	| {
			readonly kind: "reset";
			readonly sequence: number;
	  };

interface CharacterInputControllerOptions {
	/** Retail/app profile duration used by both the displayed and released extent. */
	readonly fullChargeDurationMs: number;
	/** Injectable monotonic clock. */
	readonly now: () => number;
	readonly onDrive: (
		drive: CharacterDrive,
		intent: CharacterDriveIntent,
	) => void;
	readonly onEdge: (edge: CharacterInputEdge) => void;
}

interface ActiveCharge {
	/** Begin edge that owns this optimistic presentation lifetime. */
	readonly beginSequence: number;
	readonly startedAt: number;
}

const MINIMUM_RETAIL_JUMP_EXTENT = 0.001;

/**
 * Frontend-only action arbitration and charge timing.
 *
 * Each opposed axis is a newest-first held list, matching retail `CommandList::AddCommand` and
 * removal behavior (`acclient.c:681378-683004`). The host sees semantics, never browser keys.
 */
export class CharacterInputController {
	#fullChargeDurationMs: number;
	readonly #now: () => number;
	readonly #onDrive: (
		drive: CharacterDrive,
		intent: CharacterDriveIntent,
	) => void;
	readonly #onEdge: (edge: CharacterInputEdge) => void;
	readonly #held = new Set<CharacterAction>();
	readonly #longitudinal: CharacterAction[] = [];
	readonly #lateral: CharacterAction[] = [];
	readonly #turn: CharacterAction[] = [];
	#persistentForward = false;
	#activeCharge: ActiveCharge | null = null;
	#sequence = 0;

	constructor(options: CharacterInputControllerOptions) {
		if (
			!Number.isFinite(options.fullChargeDurationMs) ||
			options.fullChargeDurationMs <= 0
		) {
			throw new Error(
				"Character jump charge duration must be finite and positive.",
			);
		}
		this.#fullChargeDurationMs = options.fullChargeDurationMs;
		this.#now = options.now;
		this.#onDrive = options.onDrive;
		this.#onEdge = options.onEdge;
	}

	/** Applies one action edge and reports whether it retired persistent forward. */
	applyAction(action: CharacterAction, pressed: boolean): boolean {
		return this.#applyAction(
			action,
			pressed,
			pressed ? "acquire" : "synchronize",
		);
	}

	/** Restores a held drive action without manufacturing a new movement acquisition. */
	restoreHeldAction(action: Exclude<CharacterAction, "jump">): void {
		this.#applyAction(action, true, "synchronize");
	}

	/** Installs a forward fallback without conflating it with a physically held action. */
	setPersistentForward(enabled: boolean, intent: CharacterDriveIntent): void {
		if (this.#persistentForward === enabled) return;
		this.#persistentForward = enabled;
		this.#publishDrive(intent);
	}

	#applyAction(
		action: CharacterAction,
		pressed: boolean,
		intent: CharacterDriveIntent,
	): boolean {
		if (pressed) {
			if (this.#held.has(action)) return false;
			this.#held.add(action);
			const cancelledPersistentForward =
				this.#persistentForward &&
				(action === "forward" || action === "backward");
			// Retail clears auto-run before admitting either longitudinal command
			// (`CommandInterpreter::HandleNewForwardMovement`, acclient.c:682181-682186).
			if (cancelledPersistentForward) this.#persistentForward = false;
			if (action === "jump") {
				this.#beginJump();
				return cancelledPersistentForward;
			}
			this.#axisFor(action)?.unshift(action);
			this.#publishDrive(intent);
			return cancelledPersistentForward;
		}

		if (!this.#held.delete(action)) return false;
		if (action === "jump") {
			this.#releaseJump();
			return false;
		}
		const axis = this.#axisFor(action);
		if (axis !== null) axis.splice(axis.indexOf(action), 1);
		this.#publishDrive(intent);
		return false;
	}

	/** Publish an idle snapshot as an explicit, scoped release instead of a passive update. */
	#publishDrive(intent: CharacterDriveIntent): void {
		const drive = this.drive();
		const moving =
			drive.longitudinal !== null ||
			drive.lateral !== null ||
			drive.turn !== null;
		this.#onDrive(
			drive,
			!moving && this.#activeCharge === null ? "release" : intent,
		);
	}

	/** Latest semantic snapshot, composed independently across all three axes. */
	drive(): CharacterDrive {
		return {
			gait: this.#held.has("walk") ? "walk" : "run",
			lateral:
				this.#lateral[0] === "strafeLeft"
					? "left"
					: this.#lateral[0] === "strafeRight"
						? "right"
						: null,
			longitudinal:
				this.#longitudinal[0] === "forward"
					? "forward"
					: this.#longitudinal[0] === "backward"
						? "backward"
						: this.#persistentForward
							? "forward"
							: null,
			turn:
				this.#turn[0] === "turnLeft"
					? "left"
					: this.#turn[0] === "turnRight"
						? "right"
						: null,
		};
	}

	/** Current optimistic power-bar extent, or `null` outside a charge. */
	chargeExtent(): number | null {
		const charge = this.#activeCharge;
		return charge === null ? null : this.#extentAt(this.#now(), charge);
	}

	/** Updates live stance timing without restarting the active charge clock. */
	setFullChargeDurationMs(fullChargeDurationMs: number): void {
		if (!Number.isFinite(fullChargeDurationMs) || fullChargeDurationMs <= 0)
			throw new Error(
				"Character jump charge duration must be finite and positive.",
			);
		this.#fullChargeDurationMs = fullChargeDurationMs;
	}

	/** Cancels only the optimistic charge owned by a rejected begin edge. */
	rejectBegin(beginSequence: number): void {
		if (this.#activeCharge?.beginSequence === beginSequence)
			this.#activeCharge = null;
	}

	/** Clears held state and emits one ordered ownership-reset edge. */
	reset(): void {
		this.#clear();
		this.#onEdge({ kind: "reset", sequence: this.#nextSequence() });
	}

	/** Drops frontend ownership without sending an edge to an already-retired host generation. */
	releaseOwnership(): void {
		this.#clear();
	}

	#beginJump(): void {
		const sequence = this.#nextSequence();
		this.#activeCharge = { beginSequence: sequence, startedAt: this.#now() };
		this.#onEdge({ drive: this.drive(), kind: "begin-jump", sequence });
	}

	#releaseJump(): void {
		const charge = this.#activeCharge;
		if (charge === null) return;
		this.#activeCharge = null;
		this.#onEdge({
			drive: this.drive(),
			extent: this.#extentAt(this.#now(), charge),
			kind: "release-jump",
			sequence: this.#nextSequence(),
		});
	}

	#extentAt(now: number, charge: ActiveCharge): number {
		const elapsed = Math.max(0, now - charge.startedAt);
		return Math.max(
			MINIMUM_RETAIL_JUMP_EXTENT,
			Math.min(1, elapsed / this.#fullChargeDurationMs),
		);
	}

	#axisFor(action: CharacterAction): CharacterAction[] | null {
		if (action === "forward" || action === "backward")
			return this.#longitudinal;
		if (action === "strafeLeft" || action === "strafeRight")
			return this.#lateral;
		if (action === "turnLeft" || action === "turnRight") return this.#turn;
		return null;
	}

	#nextSequence(): number {
		return this.#sequence++;
	}

	#clear(): void {
		this.#held.clear();
		this.#longitudinal.length = 0;
		this.#lateral.length = 0;
		this.#turn.length = 0;
		this.#persistentForward = false;
		this.#activeCharge = null;
	}
}
