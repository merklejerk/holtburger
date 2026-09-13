import { nextInventoryPreviewSequence } from "./client-inventory-contract";
import type { ClientInventoryState } from "./client-inventory-state";
import type {
	ClientInventoryIntent,
	ClientInventoryPreviewResult,
} from "./client-inventory-contract";
import { CLIENT_TUNING } from "./client-tuning";

interface DragSource {
	readonly item: number;
	/** Gesture origin is fixed even if authoritative rendering moves or detaches the cell. */
	readonly origin: "contents" | "equipment" | "pack";
	readonly element: HTMLElement;
}
interface DragTarget {
	readonly element: HTMLElement;
	readonly intent: ClientInventoryIntent;
	readonly sequence: number;
}
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
export class ClientInventoryDrag {
	readonly #root: HTMLElement;
	readonly #inventory: ClientInventoryState;
	readonly #ghost: HTMLElement;
	readonly #abort = new AbortController();
	readonly #unsubscribe: () => void;
	readonly #timer: ReturnType<typeof setInterval>;
	#gesture: Gesture | null = null;
	#cursor = { x: 0, y: 0 };
	#view: ReturnType<ClientInventoryState["read"]>;
	/** Current host-owned merge eligibility queries, retired on view changes or drag end. */
	readonly #mergeHints = new Map<number, HTMLElement>();
	#suppressClick = false;
	#suppressDoubleClickUntil = 0;

	constructor(root: HTMLElement, inventory: ClientInventoryState) {
		this.#root = root;
		this.#inventory = inventory;
		this.#view = inventory.read();
		this.#ghost = document.createElement("div");
		this.#ghost.className = "inventory-drag-ghost";
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
		window.addEventListener("keydown", this.#key, {
			...options,
			capture: true,
		});
		root.addEventListener("click", this.#click, { ...options, capture: true });
		root.addEventListener("dblclick", this.#doubleClick, {
			...options,
			capture: true,
		});
		root.addEventListener(
			"dragstart",
			(event) => event.preventDefault(),
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
			const view = inventory.read();
			if (view.pending || this.#root.dataset.inventoryModal === "true") {
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
		clearInterval(this.#timer);
		this.#ghost.remove();
	}

	#down = (event: PointerEvent): void => {
		if (
			event.button !== 0 ||
			!event.isPrimary ||
			this.#root.dataset.inventoryModal === "true" ||
			this.#inventory.read().pending
		)
			return;
		const element =
			event.target instanceof Element
				? event.target.closest<HTMLElement>(
						".item-grid-cell[data-item-guid]:not(:disabled)",
					)
				: null;
		if (element === null || !this.#root.contains(element)) return;
		const item = Number(element.dataset.itemGuid);
		const origin =
			element.closest(".inventory-pack-strip") !== null
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
			this.#root.dataset.inventoryDragging = "true";
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
		if (gesture?.kind !== "dragging") return;
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
		const hit = document.elementFromPoint(this.#cursor.x, this.#cursor.y);
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
			gesture.target?.element === element &&
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

	#request(element: HTMLElement, intent: ClientInventoryIntent): DragTarget {
		const target = {
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
					gesture.target?.sequence === target.sequence
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
			gesture.target?.sequence !== result.sequence
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
		this.#ghost.hidden = true;
		this.#ghost.hidePopover();
		delete this.#root.dataset.inventoryDragging;
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
	#key = (event: KeyboardEvent): void => {
		if (event.key === "Escape" && this.#gesture !== null) {
			event.stopImmediatePropagation();
			event.preventDefault();
			this.#cancel();
		}
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
