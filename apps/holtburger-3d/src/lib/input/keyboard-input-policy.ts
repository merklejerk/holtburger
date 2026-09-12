import type { ViewportInputGate } from "./viewport-input-gate";

/** One keyboard consumer; native browser behavior survives unless a handler prevents it. */
export interface KeyboardConsumer {
	/** Receives presses only while this consumer owns the keyboard. */
	readonly keydown: (event: KeyboardEvent) => void;
	/** Receives releases only for presses delivered to this consumer. */
	readonly keyup: (event: KeyboardEvent) => void;
	/** Drop held actions without triggering release actions such as charged jumps. */
	readonly cancel: () => void;
}

/** An explicitly activatable UI surface, also used by editors nested within it. */
export interface KeyboardScope {
	/** Optional command that enters this scope from the game or another explicit scope. */
	readonly activation?: (event: KeyboardEvent) => boolean;
	/** Scope-local behavior runs before native editing. */
	readonly keydown: (event: KeyboardEvent) => void;
	/** Optional release handling for custom surfaces with held actions. */
	readonly keyup?: (event: KeyboardEvent) => void;
	/** Clear held scope actions when needed; native editors need no cancellation callback. */
	readonly cancel?: () => void;
}

/** A modal retains the prior interaction independently of DOM focus restoration. */
interface ModalOwnership {
	/** Native top-layer boundary owned by this registration. */
	readonly element: HTMLDialogElement;
	/** Editor or explicit scope to restore if it remains eligible. */
	readonly previous: HTMLElement | null;
}

/** Native controls whose keyboard interaction is intentional; toggles and ranges stay mouse controls. */
function isEditor(element: HTMLElement): boolean {
	return (
		element.isContentEditable ||
		element instanceof HTMLTextAreaElement ||
		element instanceof HTMLSelectElement ||
		(element instanceof HTMLInputElement &&
			![
				"button",
				"submit",
				"reset",
				"checkbox",
				"radio",
				"range",
				"color",
				"file",
				"hidden",
			].includes(element.type))
	);
}

/** App-local ownership and DOM routing; pointer availability remains with the viewport gate. */
export class KeyboardInputPolicy {
	/** Mounted UI endpoints; registration alone grants no keyboard ownership. */
	readonly #scopes = new Map<HTMLElement, KeyboardScope>();
	/** Native modal order, with the innermost interaction last. */
	readonly #modals: ModalOwnership[] = [];
	/** Physical presses observed by this boundary, including native editor input. */
	readonly #presses = new Map<string, "active" | "cancelled">();
	/** Focused editor or intentional UI surface; null selects the game. */
	#owner: HTMLElement | null = null;
	/** One mode-specific controller, independent of pointer handlers. */
	#game: KeyboardConsumer | null = null;
	/** The DOM boundary exists only during the mounted app lifetime. */
	#document: Document | null = null;

	constructor(private readonly viewport: ViewportInputGate) {
		// The gate and policy share the app lifetime, including periods without a game controller.
		viewport.attach(() => this.cancel());
	}

	/** Whether keyboard commands can currently enter the world context. */
	get gameActive(): boolean {
		return (
			this.#owner === null && this.#modals.length === 0 && this.viewport.allowed
		);
	}

	/** Install the sole app keyboard boundary and focus policy for this document. */
	mount(document: Document): () => void {
		if (this.#document !== null)
			throw new Error("Keyboard policy is already mounted.");
		const window = document.defaultView;
		if (window === null) throw new Error("Keyboard policy requires a window.");
		this.#document = document;
		const observer = new MutationObserver(() => this.#validateOwner());
		observer.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["disabled", "hidden", "inert", "open"],
		});
		const blur = () => this.viewport.cancel();
		const visibility = () => {
			if (document.hidden) blur();
		};
		window.addEventListener("keydown", this.keydown, true);
		window.addEventListener("keyup", this.keyup, true);
		window.addEventListener("blur", blur);
		document.addEventListener("visibilitychange", visibility);
		document.addEventListener("focusin", this.#focusIn);
		document.addEventListener("focusout", this.#focusOut);
		document.addEventListener("pointerdown", this.#pointerDown, true);
		return () => {
			window.removeEventListener("keydown", this.keydown, true);
			window.removeEventListener("keyup", this.keyup, true);
			window.removeEventListener("blur", blur);
			document.removeEventListener("visibilitychange", visibility);
			document.removeEventListener("focusin", this.#focusIn);
			document.removeEventListener("focusout", this.#focusOut);
			document.removeEventListener("pointerdown", this.#pointerDown, true);
			this.cancel();
			this.#owner = null;
			this.#presses.clear();
			observer.disconnect();
			this.#document = null;
		};
	}

	/** Register the current game/controller lifetime without owning its mouse handlers. */
	bindGame(consumer: KeyboardConsumer): () => void {
		if (this.#game !== null)
			throw new Error("A game keyboard consumer is already registered.");
		this.cancel();
		this.#game = consumer;
		return () => {
			if (this.#game !== consumer) return;
			this.cancel();
			this.#game = null;
		};
	}

	/** Svelte action: registration alone does not activate a keyboard scope. */
	readonly scope = (
		element: HTMLElement,
		scope: KeyboardScope,
	): { destroy: () => void } => {
		this.#scopes.set(element, scope);
		return {
			destroy: () => {
				if (this.#owner !== null && element.contains(this.#owner))
					this.returnToGame();
				this.#scopes.delete(element);
			},
		};
	};

	/** Activate a registered surface, constrained to the top modal when one is open. */
	activate(element: HTMLElement): void {
		if (!this.#scopes.has(element))
			throw new Error("Keyboard scope is not registered.");
		if (!this.#eligible(element)) return;
		this.#setOwner(element);
		element.focus({ preventScroll: true });
	}

	/** Svelte action: acquire modality, open safely, and restore the prior valid interaction. */
	readonly modal = (element: HTMLDialogElement): { destroy: () => void } => {
		const entry = { element, previous: this.#owner };
		// An existing blocker leaves UI scopes active; nested modality must cancel them too.
		if (!this.viewport.allowed) this.cancel();
		const release = this.viewport.block();
		this.#modals.push(entry);
		// block() already cancelled the outgoing owner.
		this.#owner = element;
		try {
			element.showModal();
			element.focus({ preventScroll: true });
		} catch (error) {
			this.#modals.pop();
			release();
			this.#setOwner(entry.previous);
			throw error;
		}
		return {
			destroy: () => {
				const index = this.#modals.indexOf(entry);
				if (index === -1) return;
				const wasTop = this.#modals.at(-1) === entry;
				this.#modals.splice(index, 1);
				element.close();
				release();
				if (!wasTop) return;
				const previous = entry.previous;
				if (previous !== null && this.#eligible(previous)) {
					this.#setOwner(previous);
					previous.focus({ preventScroll: true });
				} else this.returnToGame();
			},
		};
	};

	/** End an intentional interaction; an open modal remains the outer keyboard owner. */
	returnToGame(): void {
		const modal = this.#modals.at(-1);
		this.#setOwner(modal?.element ?? null);
		if (modal !== undefined) modal.element.focus({ preventScroll: true });
		else {
			const focused = this.#document?.activeElement;
			if (focused !== undefined && focused instanceof HTMLElement)
				focused.blur();
		}
	}

	/** Cancel without release edges, and quarantine physical presses until they are released. */
	cancel(): void {
		for (const key of this.#presses.keys()) this.#presses.set(key, "cancelled");
		if (this.#owner === null) this.#game?.cancel();
		else this.#scopeFor(this.#owner)?.cancel?.();
	}

	/** Capture routing also prevents native button activation from competing with game commands. */
	readonly keydown = (event: KeyboardEvent): void => {
		this.#validateOwner();
		const key = event.code || event.key;
		const fresh = !event.repeat;
		// A non-repeat press is fresh even when focus loss hid the preceding release.
		if (fresh) this.#presses.set(key, "active");
		// Composition belongs to the browser, including repeats of a composing key.
		if (event.isComposing) {
			if (event.key === "Tab") event.preventDefault();
			this.#presses.set(key, "cancelled");
			return;
		}
		if (this.#presses.get(key) !== "active") {
			event.preventDefault();
			event.stopImmediatePropagation();
			return;
		}
		const owner = this.#owner;
		const editor = owner !== null && isEditor(owner);
		// The active interaction gets first refusal before another scope’s activation command.
		if (owner !== null) this.#scopeFor(owner)?.keydown(event);
		if (
			!event.defaultPrevented &&
			this.#owner === owner &&
			!editor &&
			this.#modals.length === 0 &&
			this.viewport.allowed &&
			fresh
		) {
			for (const [element, scope] of this.#scopes) {
				if (scope.activation?.(event) && this.#eligible(element)) {
					this.activate(element);
					event.preventDefault();
					event.stopImmediatePropagation();
					return;
				}
			}
		}
		if (owner !== null) {
			if (
				!event.defaultPrevented &&
				this.#owner === owner &&
				event.key === "Escape" &&
				this.#modals.length === 0
			) {
				this.returnToGame();
				event.preventDefault();
			}
		} else if (this.gameActive) this.#game?.keydown(event);
		else this.#presses.set(key, "cancelled");
		// A configured Tab command can run, but the browser must never traverse focus.
		if (event.key === "Tab") event.preventDefault();
		if (event.defaultPrevented) event.stopImmediatePropagation();
	};

	/** A release belonging to an outgoing owner never reaches the replacement owner. */
	readonly keyup = (event: KeyboardEvent): void => {
		const key = event.code || event.key;
		const press = this.#presses.get(key);
		this.#presses.delete(key);
		if (press !== "active") return;
		if (this.gameActive) this.#game?.keyup(event);
		else if (this.#owner !== null) this.#scopeFor(this.#owner)?.keyup?.(event);
		if (event.defaultPrevented) event.stopImmediatePropagation();
	};

	#scopeFor(element: HTMLElement): KeyboardScope | undefined {
		for (
			let current: HTMLElement | null = element;
			current !== null;
			current = current.parentElement
		) {
			const scope = this.#scopes.get(current);
			if (scope !== undefined) return scope;
			if (current === this.#modals.at(-1)?.element) break;
		}
		return undefined;
	}

	#eligible(element: HTMLElement): boolean {
		const modal = this.#modals.at(-1);
		return (
			element.isConnected &&
			!element.closest("[inert], [disabled], [hidden], dialog:not([open])") &&
			(modal === undefined
				? isEditor(element) || this.#scopes.has(element)
				: modal.element.contains(element))
		);
	}

	#setOwner(owner: HTMLElement | null): void {
		if (this.#owner === owner) return;
		this.cancel();
		this.#owner = owner;
	}

	#validateOwner(): void {
		if (this.#owner !== null && !this.#eligible(this.#owner))
			this.returnToGame();
	}

	readonly #focusIn = (event: FocusEvent): void => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		if (isEditor(target) || this.#modals.at(-1)?.element.contains(target)) {
			this.#setOwner(target);
		} else if (target !== this.#owner) {
			// Native range drags and label activation keep their pointer defaults, but not keyboard ownership.
			target.blur();
			if (this.#owner !== null && this.#eligible(this.#owner))
				this.#owner.focus({ preventScroll: true });
		}
	};

	readonly #focusOut = (): void => {
		// Focusout precedes focusin; resolve after the complete browser focus transition.
		queueMicrotask(() => {
			if (this.#document === null) return;
			this.#validateOwner();
			if (
				this.#owner !== null &&
				isEditor(this.#owner) &&
				this.#document.activeElement !== this.#owner
			)
				this.returnToGame();
		});
	};

	readonly #pointerDown = (event: PointerEvent): void => {
		const target = event.target;
		if (!(target instanceof Element)) return;
		if (target.closest("[data-game-viewport]") && this.#modals.length === 0)
			this.returnToGame();
		// Preventing focus on buttons leaves clicks intact. Other native controls retain their gestures.
		if (this.#modals.length === 0 && target.closest("button, [role='button']"))
			event.preventDefault();
	};
}
