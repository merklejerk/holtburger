import {
	SPELL_BAR_INDICES,
	type SpellCellAddress,
} from "./client-spell-bar-state";
import { CLIENT_TUNING } from "./client-tuning";

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
	/** Retire incompatible item interactions when the pointer crosses the threshold. */
	readonly begin: () => void;
	/** Read current HUD visibility policy at the pointer event. */
	readonly available: () => boolean;
}
/** Pointer-rate gesture facts remain imperative until one completed transfer. */
interface SpellGesture {
	/** Original element whose removal or hiding cancels the gesture. */
	readonly element: HTMLElement;
	/** Null denotes a spellbook source that must never be removed. */
	readonly origin: SpellCellAddress | null;
	/** Captured identity, revalidated against bound sources before release. */
	readonly spell: number;
	/** Only this pointer can advance or release the gesture. */
	readonly pointer: number;
	/** Initial client-space horizontal position for the drag threshold. */
	readonly x: number;
	/** Initial client-space vertical position for the drag threshold. */
	readonly y: number;
	/** Crossing the threshold enables transfer and suppresses the trailing click. */
	dragging: boolean;
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
/** Narrow spell shortcut gesture owner; spellbook entries are copied, bindings are moved. */
export class ClientSpellDrag {
	readonly #abort = new AbortController();
	readonly #observer: MutationObserver;
	readonly #ghost: HTMLElement;
	#gesture: SpellGesture | null = null;
	#suppressClick = false;
	#target: HTMLElement | null = null;
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
			attributeFilter: ["hidden", "data-spell-tab", "data-bound-spell"],
		});
	}
	/** Return whether Escape or another interaction actually retired a gesture. */
	readonly cancel = (): boolean => {
		const gesture = this.#gesture;
		if (gesture === null) return false;
		if (gesture.dragging) this.#suppressClick = true;
		this.#gesture = null;
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
		if (gesture.origin === null) return true;
		const current = address(gesture.element);
		return (
			current?.tab === gesture.origin.tab &&
			current.slot === gesture.origin.slot &&
			this.bindings.read(gesture.origin) === gesture.spell
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
			"[data-spell-cell], [data-spell-drag-source]",
		);
		if (element === null || !this.root.contains(element)) return;
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
		this.cancel();
		this.#gesture = {
			element,
			origin,
			spell,
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
		if (!gesture.dragging) {
			if (
				Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) <
				CLIENT_TUNING.inventory.dragThresholdCssPixels
			)
				return;
			this.bindings.begin();
			gesture.dragging = true;
			const icon = gesture.element.querySelector(".ui-icon, .ui-icon-fallback");
			const bounds = gesture.element.getBoundingClientRect();
			this.#ghost.style.width = `${bounds.height}px`;
			this.#ghost.style.height = `${bounds.height}px`;
			this.#ghost.replaceChildren(
				icon?.cloneNode(true) ?? `Spell ${gesture.spell}`,
			);
			this.#ghost.hidden = false;
			this.#ghost.showPopover();
		}
		this.#ghost.style.left = `${event.clientX + 12}px`;
		this.#ghost.style.top = `${event.clientY + 12}px`;
		const target =
			document
				.elementFromPoint(event.clientX, event.clientY)
				?.closest<HTMLElement>("[data-spell-cell]") ?? null;
		this.#highlight(
			target !== null && this.root.contains(target) ? target : null,
		);
		event.preventDefault();
	};
	#up = (event: PointerEvent): void => {
		const gesture = this.#gesture;
		if (gesture === null || gesture.pointer !== event.pointerId) return;
		if (!gesture.dragging || !this.#valid(gesture)) {
			this.cancel();
			return;
		}
		const hit = document.elementFromPoint(event.clientX, event.clientY);
		const cell = hit?.closest<HTMLElement>("[data-spell-cell]");
		const target =
			cell === undefined || cell === null || !this.root.contains(cell)
				? null
				: address(cell);
		// Retire DOM state before mutation can unmount a source or change its identity.
		this.cancel();
		if (target !== null) {
			if (gesture.origin === null) this.bindings.bind(target, gesture.spell);
			else this.bindings.transfer(gesture.origin, target);
		} else if (
			gesture.origin !== null &&
			!hit?.closest("[data-spell-bar-surface]")
		)
			this.bindings.transfer(gesture.origin, null);
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
