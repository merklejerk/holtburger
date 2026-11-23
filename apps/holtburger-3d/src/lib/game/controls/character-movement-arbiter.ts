import type { CharacterAction } from "../../input/input-contract";
import type { CharacterInputController } from "./character-input-controller";

/** Ordinary character movement operations consumed by the forward/autorun arbiter. */
export type OrdinaryCharacterInput = Pick<
	CharacterInputController,
	"applyAction" | "reset" | "setPersistentForward" | "releaseHeldActions"
>;

/** Physical forward holds that must release independently. */
export type CharacterForwardSource =
	"keyboard" | "middle-button" | "both-buttons";

/**
 * Forward-source merger and persistent auto-run lifecycle for grounded character input.
 *
 * Used by Explorer possession so mouse-forward chords, `W`/`S`, auto-run, and focus loss
 * match Client's grounded movement semantics without precise-jump targeting.
 */
export class CharacterMovementArbiter {
	readonly #ordinary: OrdinaryCharacterInput;
	readonly #onAutoRunChanged: (enabled: boolean) => void;
	readonly #held = new Set<CharacterAction>();
	readonly #forwardSources = new Set<CharacterForwardSource>();
	#autoRun = false;

	constructor(options: {
		readonly ordinary: OrdinaryCharacterInput;
		readonly onAutoRunChanged?: (enabled: boolean) => void;
	}) {
		this.#ordinary = options.ordinary;
		this.#onAutoRunChanged = options.onAutoRunChanged ?? (() => {});
	}

	get autoRun(): boolean {
		return this.#autoRun;
	}

	/** Toggle persistent forward drive. */
	toggleAutoRun(): boolean {
		if (this.#autoRun) {
			this.#retireAutoRun(false);
			return false;
		}
		this.#autoRun = true;
		this.#ordinary.setPersistentForward(true, "acquire");
		this.#onAutoRunChanged(true);
		return true;
	}

	/** Retire auto-run cleanly without acquiring control from another movement source. */
	cancelAutoRun(): boolean {
		return this.#retireAutoRun(false);
	}

	/** Merge physical forward holds before semantic axis arbitration. */
	applyForward(source: CharacterForwardSource, down: boolean): void {
		const wasHeld = this.#forwardSources.size !== 0;
		if (down) this.#forwardSources.add(source);
		else this.#forwardSources.delete(source);
		const held = this.#forwardSources.size !== 0;
		if (wasHeld !== held) this.#applyOrdinaryAction("forward", held);
	}

	applyAction(action: CharacterAction, down: boolean): void {
		if (action === "forward") this.applyForward("keyboard", down);
		else this.#applyOrdinaryAction(action, down);
	}

	#applyOrdinaryAction(action: CharacterAction, down: boolean): void {
		if (down) {
			if (this.#held.has(action)) return;
			this.#held.add(action);
		} else {
			this.#held.delete(action);
		}
		if (this.#ordinary.applyAction(action, down)) {
			this.#retireAutoRun(true);
		}
	}

	/** Focus loss or UI handoff drops physical controls while preserving auto-run. */
	releaseHeldActions(): void {
		this.#held.clear();
		this.#forwardSources.clear();
		this.#ordinary.releaseHeldActions(this.#autoRun);
	}

	/** Lifecycle loss owns a hard cancellation and never restores stale held actions. */
	reset(): void {
		this.#held.clear();
		this.#forwardSources.clear();
		this.#ordinary.reset();
		this.#retireAutoRun(true);
	}

	/** Retire auto-run once; callers report whether the composed drive already retired it. */
	#retireAutoRun(driveAlreadyRetired: boolean): boolean {
		if (!this.#autoRun) return false;
		this.#autoRun = false;
		if (!driveAlreadyRetired) {
			this.#ordinary.setPersistentForward(false, "synchronize");
		}
		this.#onAutoRunChanged(false);
		return true;
	}
}
