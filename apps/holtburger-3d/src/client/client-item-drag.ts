import { isBindingEquipment } from "./client-action-equipment";
import type { KeyboardInputPolicy } from "../lib/input/keyboard-input-policy";
import { nextInventoryPreviewSequence } from "./client-inventory-contract";
import type { ClientInventoryState } from "./client-inventory-state";
import type {
	ClientInventoryIntent,
	ClientInventoryPreviewResult,
} from "./client-inventory-contract";
import { CLIENT_TUNING } from "./client-tuning";

import type {
	ActionCellAddress,
	ActionContent,
} from "./client-action-bar-state";
import { actionDigitIndex } from "./client-action-bar-state";

/** Local binding edits supplied by the action-bar collection owner. */
export interface ActionDragBindings {
	readonly read: (cell: ActionCellAddress) => ActionContent | null;
	readonly bind: (cell: ActionCellAddress, content: ActionContent) => void;
	readonly transfer: (
		source: ActionCellAddress,
		target: ActionCellAddress | null,
	) => void;
}

interface DragSource {
	readonly item: number;
	/** Gesture origin is fixed even if authoritative rendering moves or detaches the cell. */
	readonly origin: "contents" | "equipment" | "pack" | ActionCellAddress;
	readonly element: HTMLElement;
}
interface InventoryDragTarget {
	readonly kind: "inventory";
	readonly element: HTMLElement;
	readonly intent: ClientInventoryIntent;
	readonly sequence: number;
}
type DragTarget =
	| InventoryDragTarget
	| {
			readonly kind: "action";
			readonly element: HTMLElement;
			readonly cell: ActionCellAddress;
	  };

type Gesture =
	| {
			kind: "pressed";
			source: DragSource;
			pointer: number;
			x: number;
			y: number;
	  }
	| {
			kind: "dragging";
			source: DragSource;
			pointer: number;
			target: DragTarget | null;
	  }
	| { kind: "released"; source: DragSource; target: DragTarget };

/** Imperative pointer owner: only semantic target changes cross the host boundary. */
export class ClientItemDrag {
	readonly #root: HTMLElement;
	readonly #inventory: ClientInventoryState;
	readonly #ghost: HTMLElement;
	readonly #abort = new AbortController();
	readonly #unsubscribe: () => void;
	readonly #releaseEscape: () => void;
	readonly #timer: ReturnType<typeof setInterval>;
	#gesture: Gesture | null = null;
	#cursor = { x: 0, y: 0 };
	/** Last active gesture view; idle world clicks do not prepare inventory sections. */
	#view: ReturnType<ClientInventoryState["read"]> | null = null;
	/** Current host-owned merge eligibility queries, retired on view changes or drag end. */
	readonly #mergeHints = new Map<number, HTMLElement>();
	#suppressClick = false;
	#suppressDoubleClickUntil = 0;

	constructor(
		root: HTMLElement,
		inventory: ClientInventoryState,
		private readonly bindings: ActionDragBindings,
		keyboard: KeyboardInputPolicy,
	) {
		this.#root = root;
		this.#inventory = inventory;
		this.#ghost = document.createElement("div");
		this.#ghost.className = "item-drag-ghost";
		// The top layer escapes panel backdrop-filter containing blocks and clipping.
		this.#ghost.popover = "manual";
		this.#ghost.setAttribute("aria-hidden", "true");
		this.#ghost.hidden = true;
		root.append(this.#ghost);
		const options = { signal: this.#abort.signal };
		root.addEventListener("pointerdown", this.#down, options);
		window.addEventListener("pointermove", this.#move, options);
		window.addEventListener("pointerup", this.#up, options);
		window.addEventListener("pointercancel", this.#cancelPointer, options);
		window.addEventListener("blur", this.#cancel, options);
		this.#releaseEscape = keyboard.bindEscapeCancellation(() => {
			if (this.#gesture === null) return false;
			this.#cancel();
			return true;
		});
		root.addEventListener("click", this.#click, { ...options, capture: true });
		root.addEventListener("dblclick", this.#doubleClick, {
			...options,
			capture: true,
		});
		root.addEventListener(
			"dragstart",
			(event) => {
				if (
					event.target instanceof Element &&
					event.target.closest(".item-grid-cell, [data-action-cell]")
				)
					event.preventDefault();
			},
			options,
		);
		this.#unsubscribe = inventory.interactions.subscribe((event) => {
			if (event.type === "inventory-preview") this.#preview(event.result);
			else if (
				event.type === "resyncing" ||
				event.type === "exit-requested" ||
				(event.type === "lifecycle" && event.lifecycle.kind !== "in-world")
			)
				this.#cancel();
		});
		this.#timer = setInterval(() => {
			if (this.#gesture === null) return;
			const view = inventory.read();
			if (
				view.pending ||
				this.#root.querySelector('[data-inventory-modal="true"]') !== null
			) {
				this.#cancel();
				return;
			}
			if (this.#gesture?.kind === "dragging") {
				if (view !== this.#view) this.#dimDropCandidates();
				this.#target(view !== this.#view);
			}
			this.#view = view;
		}, CLIENT_TUNING.inventory.displayIntervalMs);
	}

	destroy(): void {
		this.#cancel();
		this.#abort.abort();
		this.#unsubscribe();
		this.#releaseEscape();
		clearInterval(this.#timer);
		this.#ghost.remove();
	}

	#down = (event: PointerEvent): void => {
		// Suppression belongs to the completed gesture, never a later independent click.
		this.#suppressClick = false;
		if (
			event.button !== 0 ||
			!event.isPrimary ||
			this.#root.querySelector('[data-inventory-modal="true"]') !== null
		)
			return;
		const element =
			event.target instanceof Element
				? event.target.closest<HTMLElement>(
						".item-grid-cell[data-item-guid]:not(:disabled), [data-action-cell][data-action-item]",
					)
				: null;
		if (element === null || !this.#root.contains(element)) return;
		if (this.#inventory.read().pending) return;
		const actionCell = this.#actionCell(element);
		const bound = actionCell === null ? null : this.bindings.read(actionCell);
		if (actionCell !== null && bound === null) return;
		const item = bound === null ? Number(element.dataset.itemGuid) : bound.item;
		const origin =
			actionCell !== null
				? actionCell
				: element.closest(".inventory-pack-strip") !== null
					? "pack"
					: element.closest(".equipment-row") !== null
						? "equipment"
						: "contents";
		if (origin === "pack") {
			const facts = this.#inventory
				.read()
				.packSlots.find((entry) => entry?.guid === item);
			if (
				facts?.location.kind !== "contained" ||
				facts.location.slot.kind !== "pack" ||
				facts.location.slot.entryKind !== "container"
			)
				return;
		}
		this.#cancel();
		this.#gesture = {
			kind: "pressed",
			source: { item, origin, element },
			pointer: event.pointerId,
			x: event.clientX,
			y: event.clientY,
		};
		event.stopPropagation();
	};

	#move = (event: PointerEvent): void => {
		let gesture = this.#gesture;
		if (
			gesture === null ||
			gesture.kind === "released" ||
			gesture.pointer !== event.pointerId
		)
			return;
		this.#cursor = { x: event.clientX, y: event.clientY };
		if (gesture.kind === "pressed") {
			if (
				Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) <
				CLIENT_TUNING.inventory.dragThresholdCssPixels
			)
				return;
			gesture = {
				kind: "dragging",
				source: gesture.source,
				pointer: gesture.pointer,
				target: null,
			};
			this.#gesture = gesture;
			const source = gesture.source.element;
			const icon = source.querySelector(".item-icon, .item-icon-fallback");
			const bounds = source.getBoundingClientRect();
			this.#ghost.style.width = `${bounds.width}px`;
			this.#ghost.style.height = `${bounds.height}px`;
			// Reuse the prepared artwork without acquiring another icon-cache lease.
			this.#ghost.replaceChildren(
				icon?.cloneNode(true) ?? source.getAttribute("aria-label") ?? "",
			);
			this.#ghost.hidden = false;
			this.#ghost.showPopover();
			this.#root.dataset.itemDragging = "true";
			// Initial hints already describe this view; the timer must not retire them as stale.
			this.#view = this.#inventory.read();
			this.#dimDropCandidates();
		}
		event.preventDefault();
		event.stopPropagation();
		this.#ghost.style.transform = `translate(${event.clientX + 12}px, ${event.clientY + 12}px)`;
		this.#target(false);
	};

	/** Dim blocked contents targets and mirror the equipment location-mask hint. */
	#dimDropCandidates(): void {
		const gesture = this.#gesture;
		if (
			gesture?.kind !== "dragging" ||
			typeof gesture.source.origin !== "string"
		)
			return;
		const blocksContents =
			this.#inventory.read().sortMode !== "native" &&
			gesture.source.origin === "contents";
		this.#mergeHints.clear();
		for (const cell of this.#root.querySelectorAll<HTMLElement>(
			".inventory-sections .item-grid-cell",
		)) {
			if (blocksContents && cell !== gesture.source.element) {
				cell.dataset.inventoryDimmed = "true";
				const sequence = nextInventoryPreviewSequence();
				this.#mergeHints.set(sequence, cell);
				void this.#inventory.interactions
					.previewInventory({
						sequence,
						intent: {
							item: gesture.source.item,
							target: { kind: "stack", guid: Number(cell.dataset.itemGuid) },
						},
					})
					.catch((error: unknown) => {
						if (this.#mergeHints.has(sequence)) this.#failure(error);
					});
			} else delete cell.dataset.inventoryDimmed;
		}
		const source = this.#inventory
			.read()
			.sections.flatMap((section) => section.items)
			.find((item) => item.guid === gesture.source.item);
		const locations =
			source?.description.kind === "known"
				? source.description.equipLocations
				: null;
		for (const row of this.#root.querySelectorAll<HTMLElement>(
			"[data-equipment-slot]",
		)) {
			if (source?.description.kind !== "known")
				delete row.dataset.inventoryDimmed;
			else
				row.dataset.inventoryDimmed = String(
					locations === null ||
						(locations & Number(row.dataset.equipmentSlot)) === 0,
				);
		}
	}

	#clearDimming(): void {
		this.#mergeHints.clear();
		for (const row of this.#root.querySelectorAll<HTMLElement>(
			"[data-inventory-dimmed]",
		))
			delete row.dataset.inventoryDimmed;
	}

	#target(force: boolean): void {
		const gesture = this.#gesture;
		if (gesture?.kind !== "dragging") return;
		// Removing the source bar cancels rather than committing a stale address.
		if (
			typeof gesture.source.origin !== "string" &&
			!gesture.source.element.isConnected
		) {
			this.#cancel();
			return;
		}
		const hit = document.elementFromPoint(this.#cursor.x, this.#cursor.y);

		const actionElement = hit?.closest<HTMLElement>("[data-action-cell]");
		const cell =
			actionElement === undefined ||
			actionElement === null ||
			!this.#root.contains(actionElement)
				? null
				: this.#actionCell(actionElement);
		if (
			cell !== null &&
			actionElement !== undefined &&
			actionElement !== null
		) {
			this.#clearHighlight();
			gesture.target = { kind: "action", element: actionElement, cell };
			actionElement.dataset.inventoryDrop =
				typeof gesture.source.origin !== "string" ||
				this.#equippable(gesture.source.item)
					? "accepted"
					: "rejected";
			return;
		}
		if (typeof gesture.source.origin !== "string") {
			this.#clearHighlight();
			gesture.target = null;
			return;
		}
		let element: HTMLElement | null = null;
		let target: ClientInventoryIntent["target"] | null = null;
		if (hit !== null && this.#root.contains(hit)) {
			// Sorted contents allow equipment and merge-only targets, but no inventory moves.
			const allowsInventoryDrop =
				this.#inventory.read().sortMode === "native" ||
				gesture.source.origin !== "contents";
			const equipment = hit.closest<HTMLElement>("[data-equipment-slot]");
			const cell = hit.closest<HTMLElement>(".item-grid-cell[data-item-guid]");
			const header = hit.closest<HTMLElement>(
				".inventory-header[data-item-guid]",
			);
			if (gesture.source.origin === "pack") {
				if (cell?.closest(".inventory-pack-strip")) {
					element = cell;
					target = { kind: "pack", guid: Number(cell.dataset.itemGuid) };
				}
			} else if (equipment !== null) {
				element = equipment;
				target = {
					kind: "equipment",
					mask: Number(equipment.dataset.equipmentSlot),
				};
			} else if (allowsInventoryDrop && header !== null) {
				element = header;
				target = { kind: "container", guid: Number(header.dataset.itemGuid) };
			} else if (cell?.closest(".inventory-sections")) {
				element = cell;
				const container = cell.closest<HTMLElement>("[data-container-guid]");
				target =
					this.#inventory.read().sortMode === "native"
						? { kind: "item", guid: Number(cell.dataset.itemGuid) }
						: !allowsInventoryDrop
							? { kind: "stack", guid: Number(cell.dataset.itemGuid) }
							: container === null
								? null
								: {
										kind: "container",
										guid: Number(container.dataset.containerGuid),
									};
			}
		}
		if (
			!force &&
			gesture.target?.kind === "inventory" &&
			gesture.target.element === element &&
			JSON.stringify(gesture.target.intent.target) === JSON.stringify(target)
		)
			return;
		this.#clearHighlight();
		if (element === null || target === null) {
			gesture.target = null;
			return;
		}
		gesture.target = this.#request(element, {
			item: gesture.source.item,
			target,
		});
	}

	#request(
		element: HTMLElement,
		intent: ClientInventoryIntent,
	): InventoryDragTarget {
		const target: InventoryDragTarget = {
			kind: "inventory",
			element,
			intent,
			sequence: nextInventoryPreviewSequence(),
		};
		element.dataset.inventoryDrop = "pending";
		void this.#inventory.interactions
			.previewInventory({ sequence: target.sequence, intent })
			.catch((error: unknown) => {
				const gesture = this.#gesture;
				if (
					gesture !== null &&
					gesture.kind !== "pressed" &&
					gesture.target?.kind === "inventory" &&
					gesture.target.sequence === target.sequence
				)
					this.#failure(error);
			});
		return target;
	}

	#preview(result: ClientInventoryPreviewResult): void {
		const hint = this.#mergeHints.get(result.sequence);
		if (hint !== undefined) {
			this.#mergeHints.delete(result.sequence);
			hint.dataset.inventoryDimmed = String(result.preview.kind !== "merge");
			return;
		}
		const gesture = this.#gesture;
		if (
			gesture === null ||
			gesture.kind === "pressed" ||
			gesture.target?.kind !== "inventory" ||
			gesture.target.sequence !== result.sequence
		)
			return;
		const target = gesture.target;
		if (
			gesture.kind === "released" &&
			(target.intent.target.kind === "item" ||
				(gesture.source.origin === "contents" &&
					target.intent.target.kind !== "equipment" &&
					target.intent.target.kind !== "stack")) &&
			this.#inventory.read().sortMode !== "native"
		) {
			// Sorting changed after release; retire the stale positional intent.
			this.#cancel();
			return;
		}
		const rejected = result.preview.kind === "rejected";
		target.element.dataset.inventoryDrop = rejected ? "rejected" : "accepted";
		if (result.preview.kind === "equip") {
			for (const element of this.#root.querySelectorAll<HTMLElement>(
				".equipment-row [data-item-guid]",
			)) {
				if (result.preview.displaced.includes(Number(element.dataset.itemGuid)))
					element.dataset.inventoryDisplaced = "true";
			}
		}
		if (gesture.kind !== "released") return;
		const intent = target.intent;
		this.#finishGesture();
		if (result.preview.kind === "rejected") {
			this.#inventory.reportFailure(
				`${result.preview.reason}${intent.target.kind === "stack" ? " Positional drops require Native sorting." : ""}`,
			);
		}
		if (!rejected && result.preview.kind !== "noop") {
			void this.#inventory.interactions
				.submitInventory(intent)
				.catch((error: unknown) =>
					this.#inventory.reportFailure(
						`Inventory request failed: ${String(error)}`,
					),
				);
		}
	}

	#up = (event: PointerEvent): void => {
		const gesture = this.#gesture;
		if (
			gesture === null ||
			gesture.kind === "released" ||
			gesture.pointer !== event.pointerId
		)
			return;
		if (gesture.kind === "pressed") {
			this.#cancel();
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.#suppressClick = true;
		this.#suppressDoubleClickUntil = performance.now() + 500;
		this.#ghost.hidden = true;
		this.#ghost.hidePopover();
		this.#clearDimming();
		this.#cursor = { x: event.clientX, y: event.clientY };
		this.#target(true);
		if (this.#gesture !== gesture) return;

		if (typeof gesture.source.origin !== "string") {
			const target =
				gesture.target?.kind === "action" ? gesture.target.cell : null;
			const source = gesture.source.origin;
			this.#finishGesture();
			this.bindings.transfer(source, target);
			return;
		}
		if (gesture.target?.kind === "action") {
			const target = gesture.target.cell;
			const item = gesture.source.item;
			this.#finishGesture();
			if (this.#equippable(item))
				this.bindings.bind(target, { kind: "equipment", item });
			else
				this.#inventory.reportFailure(
					"Only owned equipment can be bound to an action cell.",
				);
			return;
		}
		if (gesture.target === null) {
			this.#cancel();
			return;
		}
		this.#gesture = {
			kind: "released",
			source: gesture.source,
			target: gesture.target,
		};
	};

	/** DOM labels carry stable cell addresses independently of remappable key bindings. */
	#actionCell(element: HTMLElement): ActionCellAddress | null {
		if (!element.hasAttribute("data-action-cell")) return null;
		const slot = actionDigitIndex(element.dataset.actionCell ?? "");
		const bar = Number(element.dataset.actionBar);
		if (slot === null || !Number.isSafeInteger(bar))
			throw new Error("Invalid action cell address");
		return { bar, slot };
	}
	#equippable(item: number): boolean {
		return isBindingEquipment(this.#inventory.readItem(item));
	}

	#clearHighlight(): void {
		for (const element of this.#root.querySelectorAll<HTMLElement>(
			"[data-inventory-drop], [data-inventory-displaced]",
		)) {
			delete element.dataset.inventoryDrop;
			delete element.dataset.inventoryDisplaced;
		}
	}
	#finishGesture(): void {
		this.#clearDimming();
		this.#gesture = null;
		this.#view = null;
		this.#ghost.hidden = true;
		this.#ghost.hidePopover();
		delete this.#root.dataset.itemDragging;
		this.#clearHighlight();
	}
	#cancel = (): void => {
		if (this.#gesture?.kind === "dragging") {
			this.#suppressClick = true;
			this.#suppressDoubleClickUntil = performance.now() + 500;
		}
		this.#finishGesture();
	};
	#failure(error: unknown): void {
		this.#cancel();
		this.#inventory.reportFailure(`Inventory request failed: ${String(error)}`);
	}
	#cancelPointer = (event: PointerEvent): void => {
		if (
			this.#gesture?.kind !== "released" &&
			this.#gesture?.pointer === event.pointerId
		)
			this.#cancel();
	};
	#click = (event: MouseEvent): void => {
		if (this.#suppressClick) {
			this.#suppressClick = false;
			event.stopImmediatePropagation();
			event.preventDefault();
		}
	};
	#doubleClick = (event: MouseEvent): void => {
		if (performance.now() < this.#suppressDoubleClickUntil) {
			event.stopImmediatePropagation();
			event.preventDefault();
		}
	};
}
