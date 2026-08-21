/** Semantic character input accepted by the host-owned grounded controller. */
export interface CharacterDrive {
	readonly gait: "run" | "walk";
	readonly lateral: "left" | "right" | null;
	readonly longitudinal: "backward" | "forward" | null;
	readonly turn: "left" | "right" | null;
}

/** Keys that participate in retail-style character drive or jump input. */
export type CharacterInputKey =
	| "a"
	| "c"
	| "d"
	| "s"
	| "shift"
	| "space"
	| "w"
	| "z";

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
	readonly onDrive: (drive: CharacterDrive) => void;
	readonly onEdge: (edge: CharacterInputEdge) => void;
}

interface ActiveCharge {
	/** Begin edge that owns this optimistic presentation lifetime. */
	readonly beginSequence: number;
	readonly startedAt: number;
}

const MINIMUM_RETAIL_JUMP_EXTENT = 0.001;

/**
 * Frontend-only raw-key arbitration and charge timing.
 *
 * Each opposed axis is a newest-first held list, matching retail `CommandList::AddCommand` and
 * removal behavior (`acclient.c:681378-683004`). The host sees semantics, never browser keys.
 */
export class CharacterInputController {
	#fullChargeDurationMs: number;
	readonly #now: () => number;
	readonly #onDrive: (drive: CharacterDrive) => void;
	readonly #onEdge: (edge: CharacterInputEdge) => void;
	readonly #held = new Set<CharacterInputKey>();
	readonly #longitudinal: CharacterInputKey[] = [];
	readonly #lateral: CharacterInputKey[] = [];
	readonly #turn: CharacterInputKey[] = [];
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

	/** Applies one browser edge; key-repeat cannot rewrite newest-first precedence. */
	applyKey(key: CharacterInputKey, pressed: boolean, repeat = false): void {
		if (pressed) {
			if (repeat || this.#held.has(key)) return;
			this.#held.add(key);
			if (key === "space") {
				this.#beginJump();
				return;
			}
			this.#axisFor(key)?.unshift(key);
			this.#onDrive(this.drive());
			return;
		}

		if (!this.#held.delete(key)) return;
		if (key === "space") {
			this.#releaseJump();
			return;
		}
		const axis = this.#axisFor(key);
		if (axis !== null) axis.splice(axis.indexOf(key), 1);
		this.#onDrive(this.drive());
	}

	/** Latest semantic snapshot, composed independently across all three axes. */
	drive(): CharacterDrive {
		return {
			gait: this.#held.has("shift") ? "walk" : "run",
			lateral:
				this.#lateral[0] === "z"
					? "left"
					: this.#lateral[0] === "c"
						? "right"
						: null,
			longitudinal:
				this.#longitudinal[0] === "w"
					? "forward"
					: this.#longitudinal[0] === "s"
						? "backward"
						: null,
			turn:
				this.#turn[0] === "a" ? "left" : this.#turn[0] === "d" ? "right" : null,
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
		this.#onDrive(this.drive());
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

	#axisFor(key: CharacterInputKey): CharacterInputKey[] | null {
		if (key === "w" || key === "s") return this.#longitudinal;
		if (key === "z" || key === "c") return this.#lateral;
		if (key === "a" || key === "d") return this.#turn;
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
		this.#activeCharge = null;
	}
}
