import type { CharacterInputController } from "../lib/game/controls/character-input-controller";

import type { CharacterAction } from "../lib/input/input-contract";

/** Owns the handoff between ordinary character input and client-local precise-jump input. */
export class ClientInputArbiter {
	readonly #ordinary: Pick<
		CharacterInputController,
		"applyAction" | "restoreHeldAction" | "reset"
	>;
	readonly #onEnter: () => void;
	readonly #onActivate: () => void;
	readonly #onCancel: () => void;
	readonly #held = new Set<CharacterAction>();
	#precise = false;
	#suppressJumpUntilRelease = false;

	constructor(options: {
		readonly ordinary: Pick<
			CharacterInputController,
			"applyAction" | "restoreHeldAction" | "reset"
		>;
		readonly onEnter: () => void;
		readonly onActivate: () => void;
		readonly onCancel: () => void;
	}) {
		this.#ordinary = options.ordinary;
		this.#onEnter = options.onEnter;
		this.#onActivate = options.onActivate;
		this.#onCancel = options.onCancel;
	}

	get preciseActive(): boolean {
		return this.#precise;
	}

	applyAction(action: CharacterAction, down: boolean): void {
		if (down) {
			if (this.#held.has(action)) return;
			this.#held.add(action);
		} else this.#held.delete(action);

		if (!down && action === "jump" && this.#suppressJumpUntilRelease) {
			this.#suppressJumpUntilRelease = false;
			return;
		}
		if (this.#precise) {
			if (action === "jump" && down) {
				this.#suppressJumpUntilRelease = true;
				this.#onActivate();
			}
			return;
		}
		this.#ordinary.applyAction(action, down);
	}

	/** Cancel ordinary input ownership and enter precise mode exactly once. */
	enterPrecise(): boolean {
		if (this.#precise) return false;
		this.#precise = true;
		this.#suppressJumpUntilRelease = this.#held.has("jump");
		this.#ordinary.reset();
		this.#onEnter();
		return true;
	}

	applyCancel(down: boolean, repeat = false): boolean {
		if (!this.#precise) return false;
		if (down && !repeat) {
			this.#onCancel();
			this.deactivate();
		}
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
		this.#ordinary.reset();
		for (const action of this.#held) {
			if (action !== "jump") this.#ordinary.restoreHeldAction(action);
		}
	}

	/** Focus/lifecycle loss owns a hard cancellation and never restores stale held actions. */
	reset(): void {
		const cancel = this.#precise;
		this.#precise = false;
		this.#held.clear();
		this.#suppressJumpUntilRelease = false;
		this.#ordinary.reset();
		if (cancel) this.#onCancel();
	}
}
