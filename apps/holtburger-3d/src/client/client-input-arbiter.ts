import type {
	CharacterInputController,
	CharacterInputKey,
} from "../lib/game/controls/character-input-controller";

const RESTORE_ORDER: readonly CharacterInputKey[] = [
	"shift",
	"w",
	"s",
	"a",
	"d",
	"z",
	"c",
];

/** Maps browser key names into the ordinary controller's canonical input vocabulary. */
export function clientInputKey(key: string): CharacterInputKey | null {
	const normalized = key.toLowerCase();
	switch (normalized) {
		case "w":
		case "s":
		case "a":
		case "d":
		case "z":
		case "c":
			return normalized;
		case " ":
			return "space";
		case "shift":
			return "shift";
		default:
			return null;
	}
}

/** Owns the handoff between ordinary character input and client-local precise-jump input. */
export class ClientInputArbiter {
	readonly #ordinary: Pick<CharacterInputController, "applyKey" | "reset">;
	readonly #onEnter: () => void;
	readonly #onActivate: () => void;
	readonly #onCancel: () => void;
	readonly #held = new Set<CharacterInputKey>();
	#precise = false;
	#suppressSpaceUntilRelease = false;

	constructor(options: {
		readonly ordinary: Pick<CharacterInputController, "applyKey" | "reset">;
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

	applyKey(key: CharacterInputKey, down: boolean, repeat = false): void {
		if (down) this.#held.add(key);
		else this.#held.delete(key);

		if (!down && key === "space" && this.#suppressSpaceUntilRelease) {
			this.#suppressSpaceUntilRelease = false;
			return;
		}
		if (this.#precise) {
			if (key === "space" && down && !repeat) {
				this.#suppressSpaceUntilRelease = true;
				this.#onActivate();
			}
			return;
		}
		this.#ordinary.applyKey(key, down, repeat);
	}

	/** Cancel ordinary input ownership and enter precise mode exactly once. */
	enterPrecise(): boolean {
		if (this.#precise) return false;
		this.#precise = true;
		this.#suppressSpaceUntilRelease = this.#held.has("space");
		this.#ordinary.reset();
		this.#onEnter();
		return true;
	}

	applyEscape(down: boolean, repeat = false): boolean {
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

	/** Leave precise mode and restore only ordinary keys still physically held. */
	deactivate(): void {
		if (!this.#precise) return;
		this.#precise = false;
		this.#ordinary.reset();
		for (const key of RESTORE_ORDER) {
			if (this.#held.has(key)) this.#ordinary.applyKey(key, true, false);
		}
	}

	/** Focus/lifecycle loss owns a hard cancellation and never restores stale held keys. */
	reset(): void {
		const cancel = this.#precise;
		this.#precise = false;
		this.#held.clear();
		this.#suppressSpaceUntilRelease = false;
		this.#ordinary.reset();
		if (cancel) this.#onCancel();
	}
}
