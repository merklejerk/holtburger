import type {
	InputCancellationMode,
	ViewportInputGate,
} from "./viewport-input-gate";

/** One keyboard consumer; native browser behavior survives unless a handler prevents it. */
export interface KeyboardConsumer {
	/** Receives presses only while this consumer owns the keyboard. */
	readonly keydown: (event: KeyboardEvent) => void;
	/** Receives releases only for presses delivered to this consumer. */
	readonly keyup: (event: KeyboardEvent) => void;
	/** Drop held actions without triggering release actions such as charged jumps. */
	readonly cancel: (reason: InputCancellationMode) => void;
}

/** An explicitly activatable UI surface, also used by editors nested within it. */
export interface KeyboardScope {
	/** Unhandled presses continue to game controls without cancelling held game actions. */
	readonly passthrough?: boolean;
	/** One-shot command scopes end on cancellation and are not restored after modals. */
	readonly transient?: boolean;
	/** Allow deliberate keyboard focus and Tab traversal; pointer clicks do not acquire ownership. */
	readonly nativeControls?: boolean;
	/** Explicit interactive text surfaces may reacquire their scope when clicked for selection. */
	readonly pointerActivation?: boolean;
	/** Optional command that enters this scope from the game or another explicit scope. */
	readonly activation?: (event: KeyboardEvent) => boolean;
	/** Scope-local behavior runs before native editing. */
	readonly keydown: (event: KeyboardEvent) => void;
	/** Optional release handling for custom surfaces with held actions. */
	readonly keyup?: (event: KeyboardEvent) => void;
	/** Observe physical modifier state even when a release belongs to passthrough game controls. */
	readonly modifiersChanged?: (
		modifiers: Pick<
			KeyboardEvent,
			"shiftKey" | "ctrlKey" | "altKey" | "metaKey"
		>,
	) => void;
	/** Clear held scope actions when needed; native editors need no cancellation callback. */
	readonly cancel?: () => void;
}

/** Opt-in cancellation lifetime whose recency determines the next contextual Escape action. */
export interface EscapeContextHandle {
	/** Make this context the next contextual Escape action. */
	readonly promote: () => void;
	/** Permanently remove this context from Escape routing. */
	readonly release: () => void;
}

/** Context routing options owned by the feature's cancellation lifetime. */
export interface EscapeContextOptions {
	/** Floating surfaces receive their depth among other floating surfaces. */
	readonly onOrder?: (depth: number) => void;
	/** Keep routing to a visible surface until its owner releases it, including server-delayed closes. */
	readonly untilRelease?: boolean;
}

/** One registered contextual cancellation. */
interface EscapeContextEntry {
	/** Existing feature operation invoked for one Escape press. */
	readonly cancel: () => void;
	/** Feature lifetime and optional visual-order projection. */
	readonly options: EscapeContextOptions | undefined;
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
		// In-page select pickers focus their option elements instead of the select itself.
		(element instanceof HTMLOptionElement &&
			element.closest("select") !== null) ||
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

/** Preserve the browser's copy command when non-editor UI currently owns a document selection. */
function isNativeCopyOfDocumentSelection(
	event: KeyboardEvent,
	document: Document,
): boolean {
	if (
		event.key.toLowerCase() !== "c" ||
		event.shiftKey ||
		event.altKey ||
		(!event.ctrlKey && !event.metaKey)
	)
		return false;
	const selection = document.getSelection();
	return (
		selection !== null && selection.rangeCount > 0 && !selection.isCollapsed
	);
}

/** App-local ownership and DOM routing; pointer availability remains with the viewport gate. */
export class KeyboardInputPolicy {
	/** Mounted UI endpoints; registration alone grants no keyboard ownership. */
	readonly #scopes = new Map<HTMLElement, KeyboardScope>();
	/** Mounted native pages own the default interaction even before any control has focus. */
	readonly #nativePages = new Set<HTMLElement>();
	/** Native modal order, with the innermost interaction last. */
	readonly #modals: ModalOwnership[] = [];
	/** Physical presses retain their game release destination across pass-through scopes. */
	readonly #presses = new Map<
		string,
		"active" | "game" | "native" | "cancelled"
	>();
	/** Explicit held UI lifetimes survive an ownership transfer until their physical key is released. */
	readonly #keyReleases = new Map<string, () => void>();
	/** Focused editor or intentional UI surface; null selects the game. */
	#owner: HTMLElement | null = null;
	/** Native focus caused by this pointer control must not activate a non-editor UI scope. */
	#pointerControl: HTMLElement | null = null;
	/** The viewport gesture returning from an editor cannot also act on the world. */
	#focusReturnGesture: {
		readonly pointerId: number;
		readonly button: number;
		released: boolean;
	} | null = null;
	/** A pointer gesture must see Escape before a focused scope consumes it. */
	#escapeCancellation: (() => boolean) | null = null;
	/** Opt-in app contexts ordered from least to most recently engaged. */
	readonly #escapeContexts: EscapeContextEntry[] = [];
	/** One mode-specific controller, independent of pointer handlers. */
	#game: KeyboardConsumer | null = null;
	/** The DOM boundary exists only during the mounted app lifetime. */
	#document: Document | null = null;

	constructor(private readonly viewport: ViewportInputGate) {
		// The gate and policy share the app lifetime, including periods without a game controller.
		viewport.attach((mode) => this.#cancel(mode));
	}

	/** Whether keyboard commands can currently enter the world context. */
	get gameActive(): boolean {
		return (
			!this.#nativePageActive &&
			this.#allowsGame(this.#owner) &&
			this.#modals.length === 0 &&
			this.viewport.allowed
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
		const blur = () => this.viewport.cancel("release-held");
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
		for (const type of ["pointermove", "pointerup", "pointercancel"] as const)
			document.addEventListener(type, this.#focusReturnPointer, true);
		for (const type of ["click", "auxclick", "contextmenu"] as const)
			document.addEventListener(type, this.#focusReturnClick, true);
		document.addEventListener("click", this.#click, true);
		return () => {
			window.removeEventListener("keydown", this.keydown, true);
			window.removeEventListener("keyup", this.keyup, true);
			window.removeEventListener("blur", blur);
			document.removeEventListener("visibilitychange", visibility);
			document.removeEventListener("focusin", this.#focusIn);
			document.removeEventListener("focusout", this.#focusOut);
			document.removeEventListener("pointerdown", this.#pointerDown, true);
			for (const type of ["pointermove", "pointerup", "pointercancel"] as const)
				document.removeEventListener(type, this.#focusReturnPointer, true);
			for (const type of ["click", "auxclick", "contextmenu"] as const)
				document.removeEventListener(type, this.#focusReturnClick, true);
			document.removeEventListener("click", this.#click, true);
			this.cancel();
			this.#owner = null;
			this.#pointerControl = null;
			this.#presses.clear();
			this.#keyReleases.clear();
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

	/** Register the app gesture cancellation edge; true means a gesture was cancelled. */
	bindEscapeCancellation(cancel: () => boolean): () => void {
		if (this.#escapeCancellation !== null)
			throw new Error("Escape cancellation is already registered.");
		this.#escapeCancellation = cancel;
		return () => {
			if (this.#escapeCancellation === cancel) this.#escapeCancellation = null;
		};
	}

	/** Register cancellation; optional visual-depth publication keeps floating surfaces in the same order. */
	bindEscapeContext(
		cancel: () => void,
		options?: EscapeContextOptions,
	): EscapeContextHandle {
		const entry: EscapeContextEntry = { cancel, options };
		let released = false;
		const promote = () => {
			if (released) return;
			const index = this.#escapeContexts.indexOf(entry);
			if (index !== -1 && index === this.#escapeContexts.length - 1) return;
			if (index !== -1) this.#escapeContexts.splice(index, 1);
			this.#escapeContexts.push(entry);
			this.#publishEscapeOrder();
		};
		promote();
		return {
			promote,
			release: () => {
				if (released) return;
				released = true;
				const index = this.#escapeContexts.indexOf(entry);
				if (index !== -1) {
					this.#escapeContexts.splice(index, 1);
					this.#publishEscapeOrder();
				}
			},
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

	/** Svelte action: a foreground form page uses browser defaults for its entire mounted lifetime. */
	readonly nativePage = (element: HTMLElement): { destroy: () => void } => {
		const registration = this.scope(element, {
			nativeControls: true,
			keydown: () => {},
		});
		this.#nativePages.add(element);
		this.cancel();
		if (this.#owner !== null && !element.contains(this.#owner))
			this.returnToGame();
		return {
			destroy: () => {
				this.#nativePages.delete(element);
				registration.destroy();
			},
		};
	};

	get #nativePageActive(): boolean {
		return [...this.#nativePages].some(
			(element) =>
				element.isConnected && element.closest("[hidden], [inert]") === null,
		);
	}

	/** Activate a registered surface, constrained to the top modal when one is open. */
	activate(element: HTMLElement): void {
		if (!this.#scopes.has(element))
			throw new Error("Keyboard scope is not registered.");
		if (!this.#eligible(element)) return;
		this.#setOwner(element);
		element.focus({ preventScroll: true });
	}

	/** Svelte action: acquire modality, open safely, and restore the prior valid interaction. */
	readonly modal = (
		element: HTMLDialogElement,
		initialFocusSelector?: string,
	): { destroy: () => void } => {
		const initialFocus =
			initialFocusSelector === undefined
				? element
				: element.querySelector<HTMLElement>(initialFocusSelector);
		if (initialFocus === null)
			throw new Error(
				`Dialog initial focus target is missing: ${initialFocusSelector}`,
			);
		const previous = this.#owner;
		const entry = {
			element,
			previous:
				previous !== null && this.#scopeFor(previous)?.transient
					? null
					: previous,
		};
		// An existing blocker leaves UI scopes active; nested modality must cancel them too.
		if (!this.viewport.allowed) this.cancel();
		const release = this.viewport.block();
		this.#modals.push(entry);
		// block() already cancelled the outgoing owner.
		this.#owner = element;
		try {
			element.showModal();
			initialFocus.focus({ preventScroll: true });
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

	/** Observe just this press's physical release across modal focus changes; never routes a game action.
	 * The feature must dispose the registration when its interaction ends before keyup.
	 */
	bindKeyRelease(
		event: Pick<KeyboardEvent, "code" | "key">,
		onRelease: () => void,
	): () => void {
		const key = event.code || event.key;
		if (!this.#presses.has(key))
			throw new Error("Release observation requires a held key.");
		if (this.#keyReleases.has(key))
			throw new Error("Physical key release already has an owner.");
		this.#keyReleases.set(key, onRelease);
		return () => {
			if (this.#keyReleases.get(key) === onRelease)
				this.#keyReleases.delete(key);
		};
	}

	/** Cancel without release edges, and quarantine physical presses until they are released. */
	cancel(): void {
		this.#cancel("reset");
	}

	#cancel(reason: InputCancellationMode): void {
		this.#focusReturnGesture = null;
		for (const key of this.#presses.keys()) this.#presses.set(key, "cancelled");
		this.#game?.cancel(reason);
		if (this.#owner !== null) {
			const owner = this.#owner;
			const scope = this.#scopeFor(owner);
			scope?.cancel?.();
			if (scope?.transient) {
				this.#owner = null;
				if (this.#document?.activeElement === owner) owner.blur();
			}
		}
	}

	/** Capture routing also prevents native button activation from competing with game commands. */
	readonly keydown = (event: KeyboardEvent): void => {
		// Subsequent native Tab/arrow navigation is deliberate keyboard interaction.
		this.#pointerControl = null;
		this.#validateOwner();
		const nativePage = this.#nativePageActive;
		if (this.#owner !== null)
			this.#scopeFor(this.#owner)?.modifiersChanged?.(event);
		const key = event.code || event.key;
		const fresh = !event.repeat;
		// A non-repeat press is fresh even when focus loss hid the preceding release.
		if (fresh) {
			this.#presses.set(key, "active");
		}
		// Composition belongs to the browser, including repeats of a composing key.
		if (event.isComposing) {
			if (event.key === "Tab") event.preventDefault();
			this.#presses.set(key, "cancelled");
			return;
		}
		// A held Escape must not reach a replacement gesture, editor, modal, or game context.
		if (event.key === "Escape" && !fresh) {
			event.preventDefault();
			event.stopImmediatePropagation();
			return;
		}
		if (!this.#presses.has(key) || this.#presses.get(key) === "cancelled") {
			event.preventDefault();
			event.stopImmediatePropagation();
			return;
		}
		// A native press retains its release destination even if selection changes while held.
		if (this.#presses.get(key) === "native") return;
		// An open select owns navigation and dismissal before panel/game Escape handlers.
		// This mirrors external pickers, whose keyboard events never entered the document.
		if (this.#owner?.closest("select:open")) {
			this.#presses.set(key, "native");
			return;
		}
		// Selection does not focus an ordinary element. Keep its native copy command ahead of game
		// bindings without turning every selectable panel into a persistent keyboard scope.
		if (
			this.#document !== null &&
			isNativeCopyOfDocumentSelection(event, this.#document)
		) {
			this.#presses.set(key, "native");
			return;
		}
		if (event.key === "Escape" && this.#escapeCancellation?.()) {
			this.returnToGame();
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
			(owner === null || !this.#nativeControlsFor(owner)) &&
			this.#modals.length === 0 &&
			this.viewport.allowed &&
			!nativePage &&
			fresh
		) {
			for (const [element, scope] of this.#scopes) {
				if (this.#eligible(element) && scope.activation?.(event)) {
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
		}
		if (
			!event.defaultPrevented &&
			this.#owner === null &&
			this.#modals.length === 0 &&
			this.viewport.allowed &&
			!nativePage &&
			fresh &&
			event.key === "Escape" &&
			this.#cancelEscapeContext()
		) {
			event.preventDefault();
			event.stopImmediatePropagation();
			this.#presses.set(key, "cancelled");
			return;
		}
		if (!event.defaultPrevented && this.gameActive) {
			this.#presses.set(key, "game");
			this.#game?.keydown(event);
		} else if (owner === null)
			this.#presses.set(key, nativePage ? "native" : "cancelled");
		// Native UI scopes retain Tab traversal; gameplay keeps its configured Tab commands.
		if (
			event.key === "Tab" &&
			!nativePage &&
			(this.#owner === null || !this.#nativeControlsFor(this.#owner))
		)
			event.preventDefault();
		if (event.defaultPrevented) event.stopImmediatePropagation();
	};

	/** Route one press to one context; visible surfaces retain ownership until actually closed. */
	#cancelEscapeContext(): boolean {
		const entry = this.#escapeContexts.at(-1);
		if (entry === undefined) return false;
		if (!entry.options?.untilRelease) {
			this.#escapeContexts.pop();
			this.#publishEscapeOrder();
		}
		entry.cancel();
		return true;
	}

	/** Visual depth is a projection of cancellation order, never a separately maintained stack. */
	#publishEscapeOrder(): void {
		let depth = 0;
		for (const entry of this.#escapeContexts) {
			if (entry.options?.onOrder !== undefined) entry.options.onOrder(depth++);
		}
	}

	/** Retire explicit held UI lifetimes first; ordinary outgoing releases never reach a replacement owner. */
	readonly keyup = (event: KeyboardEvent): void => {
		if (this.#owner !== null)
			this.#scopeFor(this.#owner)?.modifiersChanged?.(event);
		const key = event.code || event.key;
		const press = this.#presses.get(key);
		this.#presses.delete(key);
		const release = this.#keyReleases.get(key);
		this.#keyReleases.delete(key);
		release?.();
		if (press === undefined || press === "cancelled" || press === "native")
			return;
		if (press === "game") this.#game?.keyup(event);
		else if (this.#owner !== null) this.#scopeFor(this.#owner)?.keyup?.(event);
		if (event.defaultPrevented) event.stopImmediatePropagation();
	};

	#registeredScopeFor(
		element: HTMLElement,
	):
		| { readonly element: HTMLElement; readonly scope: KeyboardScope }
		| undefined {
		for (
			let current: HTMLElement | null = element;
			current !== null;
			current = current.parentElement
		) {
			const scope = this.#scopes.get(current);
			if (scope !== undefined) return { element: current, scope };
			if (current === this.#modals.at(-1)?.element) break;
		}
		return undefined;
	}

	#scopeFor(element: HTMLElement): KeyboardScope | undefined {
		return this.#registeredScopeFor(element)?.scope;
	}

	#nativeControlsFor(element: HTMLElement): boolean {
		return this.#scopeFor(element)?.nativeControls === true;
	}

	#eligible(element: HTMLElement): boolean {
		const modal = this.#modals.at(-1);
		return (
			element.isConnected &&
			!element.closest("[inert], [disabled], [hidden], dialog:not([open])") &&
			(modal === undefined
				? isEditor(element) ||
					this.#scopes.has(element) ||
					this.#nativeControlsFor(element)
				: modal.element.contains(element))
		);
	}

	/** Editors remain exclusive even when nested inside a pass-through surface. */
	#allowsGame(owner: HTMLElement | null): boolean {
		return (
			owner === null ||
			(!isEditor(owner) && this.#scopeFor(owner)?.passthrough === true)
		);
	}

	#setOwner(owner: HTMLElement | null): void {
		if (this.#owner === owner) return;
		// Option navigation changes DOM focus inside one editor, not keyboard ownership.
		const select = owner?.closest("select");
		if (select?.contains(this.#owner)) {
			this.#owner = owner;
			return;
		}
		const scope =
			this.#owner === null ? undefined : this.#scopeFor(this.#owner);
		// Native modal buttons may move DOM focus inside one exclusive interaction.
		// Editors still acquire/cancel independently, including inside pass-through scopes.
		if (
			this.#owner !== null &&
			owner !== null &&
			scope !== undefined &&
			!isEditor(this.#owner) &&
			!isEditor(owner) &&
			this.#scopeFor(owner) === scope
		) {
			this.#owner = owner;
			return;
		}
		if (this.#allowsGame(this.#owner) && this.#allowsGame(owner)) {
			// Selecting or completing a command surface must not interrupt movement.
			for (const key of this.#presses.keys()) {
				if (this.#presses.get(key) !== "game")
					this.#presses.set(key, "cancelled");
			}
			if (this.#owner !== null) this.#scopeFor(this.#owner)?.cancel?.();
		} else {
			// Modality and viewport blockers retain their hard cancellation boundary.
			this.#cancel(
				this.#modals.length === 0 && this.viewport.allowed
					? "release-held"
					: "reset",
			);
		}
		this.#owner = owner;
	}

	#validateOwner(): void {
		if (this.#owner !== null && !this.#eligible(this.#owner))
			this.returnToGame();
	}

	readonly #focusIn = (event: FocusEvent): void => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		const registered = this.#registeredScopeFor(target);
		// Native dialogs can focus child buttons. Exclusive custom interactions retain their
		// registered surface as keyboard owner, so replacing a child does not orphan the scope.
		if (
			!isEditor(target) &&
			this.#modals.at(-1)?.element.contains(target) &&
			registered !== undefined &&
			registered.scope.nativeControls !== true
		) {
			this.#setOwner(registered.element);
			return;
		}
		if (
			isEditor(target) ||
			this.#scopes.get(target)?.pointerActivation === true ||
			(this.#nativeControlsFor(target) && target !== this.#pointerControl) ||
			this.#modals.at(-1)?.element.contains(target)
		) {
			this.#setOwner(target);
		} else if (target !== this.#owner) {
			// Native range drags and label activation keep their pointer defaults, but not keyboard ownership.
			target.blur();
			if (this.#owner !== null && this.#eligible(this.#owner))
				this.#owner.focus({ preventScroll: true });
		}
	};

	readonly #focusOut = (event: FocusEvent): void => {
		const next = event.relatedTarget;
		// Picker dismissal can run microtasks before the select's restoring focusin.
		// An explicit editor-to-editor handoff must finish before releasing ownership.
		if (next instanceof HTMLElement && isEditor(next) && this.#eligible(next))
			return;
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

	readonly #click = (): void => {
		const control = this.#pointerControl;
		// Label activation focuses its input after click listeners; keep the identity through that
		// browser default, then retire it so later deliberate programmatic focus is unaffected.
		setTimeout(() => {
			if (this.#pointerControl === control) this.#pointerControl = null;
		}, 0);
	};

	/** Consume the entire focus-return drag, even when its release lands outside the viewport. */
	readonly #focusReturnPointer = (event: PointerEvent): void => {
		const gesture = this.#focusReturnGesture;
		if (
			gesture === null ||
			gesture.pointerId !== event.pointerId ||
			gesture.released
		)
			return;
		event.preventDefault();
		event.stopImmediatePropagation();
		if (event.type === "pointercancel") this.#focusReturnGesture = null;
		else if (event.type === "pointerup") gesture.released = true;
	};

	/** Click and context-menu defaults survive preventing pointerdown; suppress those trailing edges too. */
	readonly #focusReturnClick = (event: MouseEvent): void => {
		const gesture = this.#focusReturnGesture;
		if (
			gesture === null ||
			gesture.button !== event.button ||
			!(event.target instanceof Element) ||
			!event.target.closest("[data-game-viewport]")
		)
			return;
		event.preventDefault();
		event.stopImmediatePropagation();
		// Auxiliary click and context-menu order can differ; keep their guard until the next press.
		if (event.type === "click") this.#focusReturnGesture = null;
	};

	readonly #pointerDown = (event: PointerEvent): void => {
		// A drag may end without a click. A new press always retires its trailing-click guard.
		this.#focusReturnGesture = null;
		if (this.#nativePageActive) {
			this.#pointerControl = null;
			return;
		}
		const target = event.target;
		if (!(target instanceof Element)) return;
		// Labels focus their associated input, and icon children focus their enclosing button.
		const control = target.closest<HTMLElement>(
			"button, [role='button'], input, select, textarea, summary, a[href], [tabindex], [contenteditable], label",
		);
		this.#pointerControl =
			control instanceof HTMLLabelElement ? control.control : control;
		if (this.#modals.length !== 0) return;
		if (target.closest("[data-game-viewport]")) {
			const wasEditing = this.#owner !== null && isEditor(this.#owner);
			this.returnToGame();
			if (wasEditing) {
				this.#focusReturnGesture = {
					pointerId: event.pointerId,
					button: event.button,
					released: false,
				};
				event.preventDefault();
				event.stopImmediatePropagation();
			}
		} else if (
			(this.#pointerControl === null || !isEditor(this.#pointerControl)) &&
			this.#owner !== null &&
			!target.closest("[data-editor-accessory]") &&
			(isEditor(this.#owner) || this.#nativeControlsFor(this.#owner))
		) {
			// Ordinary panel actions end editing/navigation without acquiring keyboard ownership.
			// data-editor-accessory marks controls, such as completions, that remain part of editing.
			this.returnToGame();
		}
		// Prevent button focus, preserving click actions. Ranges/toggles retain their native gestures;
		// focusin rejects their pointer-acquired focus even inside a native-control scope.
		if (target.closest("button, [role='button']")) event.preventDefault();
	};
}
