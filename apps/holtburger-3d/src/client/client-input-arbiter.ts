import type { CharacterInputController } from "../lib/game/controls/character-input-controller";

import type {
	CharacterAction,
	InputBindings,
	InputKeyEvent,
	PreciseJumpAction,
} from "../lib/input/input-contract";
import { InputContext } from "../lib/input/input-context";

/** Owns client-local auto-run and the handoff between ordinary and precise-jump input. */
export class ClientInputArbiter {
	readonly #ordinary: Pick<
		CharacterInputController,
		"applyAction" | "restoreHeldAction" | "reset" | "setPersistentForward"
	>;
	readonly #onEnter: () => void;
	readonly #onActivate: () => void;
	readonly #onCancel: () => void;
	readonly #onAutoRunChanged: (enabled: boolean) => void;
	readonly #held = new Set<CharacterAction>();
	/** Power presses have their own key lifetimes and never become movement on exit. */
	readonly #powerHeld = new Set<PreciseJumpAction>();
	readonly #powerInput: InputContext<PreciseJumpAction>;
	#precise = false;
	#autoRun = false;
	#suppressJumpUntilRelease = false;

	constructor(options: {
		readonly powerBindings: InputBindings<PreciseJumpAction>;
		readonly ordinary: Pick<
			CharacterInputController,
			"applyAction" | "restoreHeldAction" | "reset" | "setPersistentForward"
		>;
		readonly onEnter: () => void;
		readonly onActivate: () => void;
		readonly onCancel: () => void;
		readonly onAutoRunChanged: (enabled: boolean) => void;
	}) {
		this.#powerInput = new InputContext(
			options.powerBindings,
			(action, down) => {
				if (down) {
					this.#powerHeld.add(action);
					this.cancelAutoRun();
				} else this.#powerHeld.delete(action);
			},
		);
		this.#ordinary = options.ordinary;
		this.#onEnter = options.onEnter;
		this.#onActivate = options.onActivate;
		this.#onCancel = options.onCancel;
		this.#onAutoRunChanged = options.onAutoRunChanged;
	}

	get preciseActive(): boolean {
		return this.#precise;
	}

	/** Opposing held controls cancel; pre-existing movement does not start a power sweep. */
	get precisePowerDirection(): -1 | 0 | 1 {
		if (!this.#precise) return 0;
		if (
			this.#powerHeld.has("increasePower") ===
			this.#powerHeld.has("decreasePower")
		)
			return 0;
		return this.#powerHeld.has("increasePower") ? 1 : -1;
	}

	/** Precise controls take priority over ordinary keys only while targeting. */
	applyPowerKey(event: InputKeyEvent, down: boolean): boolean {
		return this.#precise && this.#powerInput.apply(event, down);
	}

	/** Settings changes retire held power before accepting the new map. */
	replacePowerBindings(bindings: InputBindings<PreciseJumpAction>): void {
		this.#powerHeld.clear();
		this.#powerInput.replaceBindings(bindings);
	}

	/** Toggle client-local forward drive, paused while precise jump owns movement. */
	toggleAutoRun(): boolean {
		if (this.#autoRun) {
			this.#retireAutoRun(false);
			return false;
		}
		this.#autoRun = true;
		if (!this.#precise) this.#ordinary.setPersistentForward(true, "acquire");
		this.#onAutoRunChanged(true);
		return true;
	}

	/** Retire auto-run without acquiring control from a server-directed movement source. */
	cancelAutoRun(): boolean {
		return this.#retireAutoRun(false);
	}

	applyAction(action: CharacterAction, down: boolean): void {
		if (this.#precise && (action === "forward" || action === "backward")) {
			this.#held.delete(action);
			return;
		}
		if (down) {
			if (this.#held.has(action)) return;
			this.#held.add(action);
		} else this.#held.delete(action);

		if (!down && action === "jump" && this.#suppressJumpUntilRelease) {
			this.#suppressJumpUntilRelease = false;
			return;
		}
		if (this.#precise) {
			if (action === "turnLeft" || action === "turnRight") {
				this.#ordinary.applyAction(action, down);
				return;
			}
			if (action === "jump" && down) {
				this.#suppressJumpUntilRelease = true;
				this.#onActivate();
			}
			return;
		}
		if (this.#ordinary.applyAction(action, down)) {
			this.#retireAutoRun(true);
		}
	}

	/** Cancel ordinary input ownership and enter precise mode exactly once. */
	enterPrecise(): boolean {
		if (this.#precise) return false;
		this.#precise = true;
		this.#suppressJumpUntilRelease = this.#held.has("jump");
		this.#ordinary.reset();
		for (const action of this.#held) {
			if (action === "turnLeft" || action === "turnRight")
				this.#ordinary.restoreHeldAction(action);
		}
		this.#onEnter();
		return true;
	}

	/** End precise targeting and restore ordinary held movement without a jump release. */
	cancelPrecise(): boolean {
		if (!this.#precise) return false;
		this.#onCancel();
		this.deactivate();
		return true;
	}

	activatePointer(): boolean {
		if (!this.#precise) return false;
		this.#onActivate();
		return true;
	}

	/** Restore held drive actions in press order, preserving newest-first axis precedence. */
	deactivate(): void {
		if (!this.#precise) return;
		this.#precise = false;
		this.#powerHeld.clear();
		this.#powerInput.reset();
		this.#ordinary.reset();
		for (const action of this.#held) {
			if (action !== "jump") this.#ordinary.restoreHeldAction(action);
		}
		if (this.#autoRun) this.#ordinary.setPersistentForward(true, "synchronize");
	}

	/** Focus/lifecycle loss owns a hard cancellation and never restores stale held actions. */
	reset(): void {
		const cancel = this.#precise;
		this.#precise = false;
		this.#held.clear();
		this.#powerHeld.clear();
		this.#powerInput.reset();
		this.#suppressJumpUntilRelease = false;
		this.#ordinary.reset();
		this.#retireAutoRun(true);
		if (cancel) this.#onCancel();
	}

	/** Retires the mode once; callers report whether the composed drive is already clear. */
	#retireAutoRun(driveAlreadyRetired: boolean): boolean {
		if (!this.#autoRun) return false;
		this.#autoRun = false;
		if (!driveAlreadyRetired && !this.#precise)
			this.#ordinary.setPersistentForward(false, "synchronize");
		this.#onAutoRunChanged(false);
		return true;
	}
}
