import { dragEdgeScrollFactor } from "../../app/drag-edge-scroll";
import { showUiDragGhost, positionUiDragGhost } from "../../app/ui-drag-ghost";
import { SPELL_BAR_INDICES, type SpellCellAddress } from "./spell-bar-state";
import type { InputDigitIndex } from "../../lib/input/input-contract";
import { CLIENT_TUNING } from "../settings/tuning";

/** Mutations and availability belong to the HUD composition, not DOM elements. */
interface SpellDragBindings {
	/** Resolve the current source binding before accepting a transfer. */
	readonly read: (address: SpellCellAddress) => number | null | undefined;
	/** Copy a spellbook entry into a destination cell. */
	readonly bind: (address: SpellCellAddress, spell: number) => void;
	/** Swap bound cells, or clear the source on a completed drag off the bar. */
	readonly transfer: (
		source: SpellCellAddress,
		target: SpellCellAddress | null,
	) => void;
	/** Exchange complete tab contents through the existing configuration owner. */
	readonly swapTabs: (source: InputDigitIndex, target: InputDigitIndex) => void;
	/** Retire incompatible item interactions when the pointer crosses the threshold. */
	readonly begin: () => void;
	/** Read current HUD visibility policy at the pointer event. */
	readonly available: () => boolean;
}
/** Pointer-rate gesture facts remain imperative until one completed transfer. */
interface SpellGesture {
	/** Original element whose removal or hiding cancels the gesture. */
	readonly element: HTMLElement;
	/** Spell payload and whole-tab gestures have disjoint source and drop rules. */
	readonly source:
		| {
				/** A single spell copied or moved into a cell. */
				readonly kind: "spell";
				/** Null identifies a spellbook copy source. */
				readonly origin: SpellCellAddress | null;
				/** Captured spell identity, revalidated before a bound source moves. */
				readonly spell: number;
		  }
		| {
				/** Whole tabs only accept tab destinations. */
				readonly kind: "tab";
				/** Fixed numeric source identity, independent of selection. */
				readonly tab: InputDigitIndex;
		  };
	/** Only this pointer can advance or release the gesture. */
	readonly pointer: number;
	/** Initial client-space horizontal position for the drag threshold. */
	readonly x: number;
	/** Initial client-space vertical position for the drag threshold. */
	readonly y: number;
	/** Crossing the threshold enables transfer and suppresses the trailing click. */
	dragging: boolean;
}
/** Read the fixed numeric identity of a tab drag handle. */
function tabIdentity(element: HTMLElement): InputDigitIndex | undefined {
	return SPELL_BAR_INDICES.find(
		(index) => String(index) === element.dataset.spellTabSource,
	);
}
/** Parse tab identities and any nonnegative cell address emitted by SpellCell. */
function address(element: HTMLElement): SpellCellAddress | null {
	const tab = SPELL_BAR_INDICES.find(
		(index) => String(index) === element.dataset.spellTab,
	);
	const slot = Number(element.dataset.spellCell);
	return tab === undefined || !Number.isSafeInteger(slot) || slot < 0
		? null
		: { tab, slot };
}
/** Spell shortcut gestures copy spellbook entries, move cells, or exchange complete tabs. */
export class ClientSpellDrag {
	readonly #abort = new AbortController();
	readonly #observer: MutationObserver;
	readonly #ghost: HTMLElement;
	#gesture: SpellGesture | null = null;
	#suppressClick = false;
	#target: HTMLElement | null = null;
	/** Latest client-space pointer position; scrolling continues without pointer events. */
	#cursor = { x: 0, y: 0 };
	/** Owned by the active drag and retired through the common cancellation path. */
	#scrollFrame: number | null = null;
	constructor(
		private readonly root: HTMLElement,
		private readonly bindings: SpellDragBindings,
	) {
		this.#ghost = document.createElement("div");
		this.#ghost.className = "spell-drag-ghost ui-drag-ghost";
		this.#ghost.popover = "manual";
		this.#ghost.hidden = true;
		this.#ghost.setAttribute("aria-hidden", "true");
		root.append(this.#ghost);
		const options = { signal: this.#abort.signal };
		root.addEventListener("pointerdown", this.#down, options);
		window.addEventListener("pointermove", this.#move, options);
		window.addEventListener("pointerup", this.#up, options);
		window.addEventListener("pointercancel", this.#pointerCancel, options);
		window.addEventListener("blur", this.cancel, options);
		root.addEventListener("click", this.#click, { ...options, capture: true });
		root.addEventListener("dblclick", this.#click, {
			...options,
			capture: true,
		});
		this.#observer = new MutationObserver(() => {
			if (this.#gesture !== null && !this.#valid(this.#gesture)) this.cancel();
		});
		this.#observer.observe(root, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: [
				"hidden",
				"data-spell-tab",
				"data-bound-spell",
				"data-spell-tab-source",
			],
		});
	}
	/** Return whether Escape or another interaction actually retired a gesture. */
	readonly cancel = (): boolean => {
		const gesture = this.#gesture;
		if (gesture === null) return false;
		if (gesture.dragging) this.#suppressClick = true;
		this.#gesture = null;
		if (this.#scrollFrame !== null) cancelAnimationFrame(this.#scrollFrame);
		this.#scrollFrame = null;
		this.#ghost.hidePopover();
		this.#ghost.hidden = true;
		this.#highlight(null);
		return true;
	};
	destroy(): void {
		this.cancel();
		this.#observer.disconnect();
		this.#abort.abort();
		this.#ghost.remove();
	}
	#valid(gesture: SpellGesture): boolean {
		if (
			!this.bindings.available() ||
			!gesture.element.isConnected ||
			gesture.element.closest("[hidden]")
		)
			return false;
		const source = gesture.source;
		if (source.kind === "tab")
			return tabIdentity(gesture.element) === source.tab;
		if (source.origin === null) return true;
		const current = address(gesture.element);
		return (
			current?.tab === source.origin.tab &&
			current.slot === source.origin.slot &&
			this.bindings.read(source.origin) === source.spell
		);
	}
	#down = (event: PointerEvent): void => {
		this.#suppressClick = false;
		if (
			event.button !== 0 ||
			!this.bindings.available() ||
			!(event.target instanceof Element)
		)
			return;
		const element = event.target.closest<HTMLElement>(
			"[data-spell-cell], [data-spell-drag-source], [data-spell-tab-source]",
		);
		if (element === null || !this.root.contains(element)) return;
		const tab = tabIdentity(element);
		let source: SpellGesture["source"];
		if (tab !== undefined) source = { kind: "tab", tab };
		else {
			const origin = address(element);
			const spell =
				origin === null
					? Number(element.dataset.spellDragSource)
					: this.bindings.read(origin);
			if (
				spell === null ||
				spell === undefined ||
				!Number.isSafeInteger(spell) ||
				spell <= 0
			)
				return;
			source = { kind: "spell", origin, spell };
		}
		this.cancel();
		this.#gesture = {
			element,
			source,
			pointer: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			dragging: false,
		};
		event.preventDefault();
	};
	#move = (event: PointerEvent): void => {
		const gesture = this.#gesture;
		if (gesture === null || gesture.pointer !== event.pointerId) return;
		if (!this.#valid(gesture)) {
			this.cancel();
			return;
		}
		this.#cursor = { x: event.clientX, y: event.clientY };
		if (!gesture.dragging) {
			if (
				Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) <
				CLIENT_TUNING.inventory.dragThresholdCssPixels
			)
				return;
			this.bindings.begin();
			gesture.dragging = true;
			if (gesture.source.kind === "spell") this.#startEdgeScroll();
			showUiDragGhost(
				this.#ghost,
				gesture.element,
				gesture.source.kind === "spell"
					? `Spell ${gesture.source.spell}`
					: `Tab ${(gesture.source.tab + 1) % 10}`,
			);
		}
		positionUiDragGhost(this.#ghost, event);
		this.#updateTarget();
		event.preventDefault();
	};
	/** Re-hit-test after scrolling moves a new cell underneath a stationary pointer. */
	#updateTarget(): void {
		const target =
			document
				.elementFromPoint(this.#cursor.x, this.#cursor.y)
				?.closest<HTMLElement>(
					this.#gesture?.source.kind === "tab"
						? "[data-spell-tab-source]"
						: "[data-spell-cell]",
				) ?? null;
		this.#highlight(
			target !== null && this.root.contains(target) ? target : null,
		);
	}
	#startEdgeScroll(): void {
		let previous = performance.now();
		const frame = (now: number): void => {
			this.#scrollFrame = null;
			const gesture = this.#gesture;
			if (gesture === null) return;
			if (!this.#valid(gesture)) {
				this.cancel();
				return;
			}
			// Cap suspended frames so returning to the window cannot jump across the strip.
			const elapsed = Math.min(now - previous, 50) / 1_000;
			previous = now;
			const scroll = document
				.elementFromPoint(this.#cursor.x, this.#cursor.y)
				?.closest<HTMLElement>("[data-spell-scroll-viewport]");
			if (scroll != null && this.root.contains(scroll)) {
				const surface = scroll.closest<HTMLElement>(
					"[data-spell-scroll-container]",
				);
				if (surface === null)
					throw new Error("Spell viewport has no scroll container");
				const box = scroll.getBoundingClientRect();
				const clip = surface.getBoundingClientRect();
				const tuning = CLIENT_TUNING.spells;
				// Exclude a native scrollbar and preserve the HUD's CSS zoom in client space.
				const clipRight =
					clip.left + surface.clientWidth * (clip.width / surface.offsetWidth);
				// The outer HUD can clip the strip on a constrained viewport.
				const delta =
					dragEdgeScrollFactor(
						this.#cursor.x,
						Math.max(box.left, clip.left),
						Math.min(box.right, clipRight),
						tuning.dragScrollEdgeCssPixels,
					) *
					tuning.dragScrollCssPixelsPerSecond *
					elapsed;
				const before = scroll.scrollLeft;
				scroll.scrollLeft += delta;
				// Once the strip reaches its end, reveal the portion clipped by the HUD.
				surface.scrollLeft += delta - (scroll.scrollLeft - before);
			}
			this.#updateTarget();
			this.#scrollFrame = requestAnimationFrame(frame);
		};
		this.#scrollFrame = requestAnimationFrame(frame);
	}

	#up = (event: PointerEvent): void => {
		const gesture = this.#gesture;
		if (gesture === null || gesture.pointer !== event.pointerId) return;
		if (!gesture.dragging || !this.#valid(gesture)) {
			this.cancel();
			return;
		}
		const hit = document.elementFromPoint(event.clientX, event.clientY);
		const source = gesture.source;
		if (source.kind === "tab") {
			const tab = hit?.closest<HTMLElement>("[data-spell-tab-source]");
			const target =
				tab != null && this.root.contains(tab) ? tabIdentity(tab) : undefined;
			this.cancel();
			if (target !== undefined && target !== source.tab) {
				// Reset presentation only when the visible tab receives different contents.
				if (
					gesture.element.getAttribute("aria-pressed") === "true" ||
					tab?.getAttribute("aria-pressed") === "true"
				) {
					const surface = gesture.element.closest("[data-spell-bar-surface]");
					if (surface === null) throw new Error("Spell tab has no bar surface");
					for (const viewport of surface.querySelectorAll<HTMLElement>(
						"[data-spell-scroll-viewport], [data-spell-scroll-container]",
					))
						viewport.scrollLeft = 0;
				}
				this.bindings.swapTabs(source.tab, target);
			}
			event.preventDefault();
			return;
		}
		const cell = hit?.closest<HTMLElement>("[data-spell-cell]");
		const target =
			cell === undefined || cell === null || !this.root.contains(cell)
				? null
				: address(cell);
		// Retire DOM state before mutation can unmount a source or change its identity.
		this.cancel();
		if (target !== null) {
			if (source.origin === null) this.bindings.bind(target, source.spell);
			else this.bindings.transfer(source.origin, target);
		} else if (
			source.origin !== null &&
			!hit?.closest("[data-spell-bar-surface]")
		)
			this.bindings.transfer(source.origin, null);
		event.preventDefault();
	};
	#pointerCancel = (event: PointerEvent): void => {
		if (this.#gesture?.pointer === event.pointerId) this.cancel();
	};
	#click = (event: MouseEvent): void => {
		if (!this.#suppressClick) return;
		event.preventDefault();
		event.stopImmediatePropagation();
	};
	#highlight(target: HTMLElement | null): void {
		if (this.#target === target) return;
		this.#target?.removeAttribute("data-spell-drop");
		this.#target = target;
		target?.setAttribute("data-spell-drop", "true");
	}
}
