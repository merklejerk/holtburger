import type { ClientSalvageState } from "./client-salvage-state";
import { showUiDragGhost, positionUiDragGhost } from "../app/ui-drag-ghost";
import { filterDraggedEquipment } from "./client-equipment-strip-filter";
import {
	EQUIPMENT_SLOTS,
	equipmentSlotAvailability,
} from "./client-inventory-equipment";
import type { ClientTradeState } from "./client-trade-state";
import type { ClientHouseCrystalState } from "./client-house-crystal-state";
import type {
	ClientViewportTargetPicker,
	ClientViewportTargetResult,
} from "./client-pointer-selection-controller";
import { bindingAction } from "./client-action-item";
import { nextInventoryPreviewSequence } from "./client-inventory-contract";
import type { ClientLifecycleSession } from "./client-lifecycle-session";
import type { ClientVendorState } from "./client-vendor-state";
import type { ClientEntityRead } from "./client-entity-mirror";
import type { ContentsSortMode } from "./client-container-contents";

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

/** Direct session authority shared by item gestures and action-bar activation. */
export interface ItemDragSession extends Pick<
	ClientLifecycleSession,
	| "previewInventory"
	| "submitInventory"
	| "applyEquipmentSet"
	| "subscribe"
	| "state"
> {
	/** Coherent world facts; gestures never read retained display records. */
	readonly entities: { read(): ClientEntityRead };
}
/** Current presentation policy of one mounted contents root. */
export interface ContentsDragView {
	/** Recovery disables all gestures on this surface. */
	readonly pending: boolean;
	/** Only native order admits positional destinations. */
	readonly sortMode: ContentsSortMode;
}
/** Root and policy captured together for a particular preview destination. */
interface ContentsSurface {
	readonly root: number;
	readonly view: ContentsDragView;
}

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
	readonly origin:
		"contents" | "equipment" | "pack" | "vendor" | ActionCellAddress;
	/** Captured surface identity prevents root replacement from retargeting a gesture. */
	readonly root: number | null;
	readonly element: HTMLElement;
}
interface InventoryDragTarget {
	readonly kind: "inventory";
	readonly element: HTMLElement;
	readonly intent: ClientInventoryIntent;
	/** Destination context is checked again when asynchronous previews arrive. */
	readonly surface: ContentsSurface | null;
	readonly sequence: number;
}
/** Viewport resolution belongs to one exact pointer sample, never cached hover authority. */
interface ViewportDragTarget {
	readonly kind: "viewport";
	readonly element: HTMLElement;
	readonly x: number;
	readonly y: number;
	result: ClientViewportTargetResult | null;
}
type DragTarget =
	| { readonly kind: "salvage"; readonly element: HTMLElement }
	| {
			readonly kind: "housing";
			readonly element: HTMLElement;
			readonly crystal: number;
			readonly wcid: number;
	  }
	| {
			readonly kind: "trade";
			readonly element: HTMLElement;
			readonly partner: number;
			readonly revision: number;
	  }
	| ViewportDragTarget
	| InventoryDragTarget
	| {
			readonly kind: "vendor";
			readonly element: HTMLElement;
			readonly vendor: number;
	  }
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

/** Shortcut content has no inventory identity and cannot enter inventory targeting. */
interface BindingDragSource {
	/** Current immutable draft; identity changes invalidate an active gesture. */
	readonly read: () => ActionContent | null;
	/** Successful action-cell placement discards the originating draft. */
	readonly placed: () => void;
}

/** Press-to-drag lifetime shared by builder snapshots and saved loadout cells. */
interface BindingGesture {
	/** Content identity captured at press, rechecked before every transfer. */
	readonly content: ActionContent;
	/** Original DOM source must remain connected. */
	readonly element: HTMLElement;
	/** A saved cell moves content; an unplaced draft binds a copy. */
	readonly source: ActionCellAddress | BindingDragSource;
	/** Only this pointer can continue the gesture. */
	readonly pointer: number;
	/** Press coordinates establish the ordinary drag threshold. */
	readonly x: number;
	readonly y: number;
	/** Threshold crossing enables the ghost and suppresses activation on release. */
	dragging: boolean;
}

/** Imperative pointer owner: only semantic target changes cross the host boundary. */
export class ClientItemDrag {
	readonly #root: HTMLElement;
	readonly #ghost: HTMLElement;
	readonly #abort = new AbortController();
	readonly #unsubscribe: () => void;
	readonly #timer: ReturnType<typeof setInterval>;
	#gesture: Gesture | null = null;
	readonly #bindingSources = new Map<HTMLElement, BindingDragSource>();
	#bindingGesture: BindingGesture | null = null;
	/** Local draft removals never enter inventory targeting or physical item transfer. */
	#draftGesture: {
		/** Releasing outside this feature-owned area removes the captured draft entry. */
		readonly boundary: HTMLElement;
		readonly remove: () => void;
		readonly element: HTMLElement;
		readonly pointer: number;
		readonly x: number;
		readonly y: number;
		dragging: boolean;
	} | null = null;
	#cursor = { x: 0, y: 0 };
	/** Last active gesture views; idle world clicks do not prepare contents sections. */
	#views: readonly unknown[] = [];
	/** Current host-owned merge eligibility queries, retired on view changes or drag end. */
	readonly #mergeHints = new Map<number, HTMLElement>();
	#suppressClick = false;
	#suppressDoubleClickUntil = 0;

	constructor(
		root: HTMLElement,
		private readonly session: ItemDragSession,
		private readonly readContents: (root: number) => ContentsDragView | null,
		private readonly reportFailure: (message: string) => void,
		private readonly bindings: ActionDragBindings,
		/** Actual dragging supersedes pending item target acquisition. */
		private readonly cancelInteraction: () => boolean,
		/** Item drags select their source; binding rearrangements do not. */
		private readonly selectDragItem: (guid: number) => void,
		/** Shared exact picker; the gesture owns completion and invalidation. */
		private readonly pickWorldTarget: ClientViewportTargetPicker,
		/** Coarse local refusals use the neutral notice surface. */
		private readonly reportNotice: (message: string) => void,
		/** Vendor offers and owned sources join a draft, never an inventory move. */
		private readonly vendor: Pick<
			ClientVendorState,
			"canDragOffer" | "acceptsDrop" | "queueBuy" | "queueSell"
		> | null,
		/** Salvage queue edits remain local; drag-out captures its exact draft lifetime. */
		private readonly salvage: Pick<
			ClientSalvageState,
			"acceptsDrop" | "add" | "captureRemoval"
		> | null,
		/** Confirmed P2P offers use their own guarded command path. */
		private readonly trade: Pick<
			ClientTradeState,
			"acceptsDrop" | "add" | "reportFailure"
		> | null,
		/** Housing selects draft IDs only; a drop never dispatches an inventory transfer. */
		private readonly houseCrystal: Pick<
			ClientHouseCrystalState,
			"acceptsDrop" | "add" | "captureRow" | "clearRow"
		> | null,
		/** The item interaction owner applies confirmation policy to every give path. */
		private readonly give: (source: number, recipient: number) => void,
	) {
		this.#root = root;
		this.#ghost = document.createElement("div");
		this.#ghost.className = "item-drag-ghost ui-drag-ghost";
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
					event.target.closest(
						".item-grid-cell, [data-action-cell], [data-vendor-offer], [data-salvage-item]",
					)
				)
					event.preventDefault();
			},
			options,
		);
		this.#unsubscribe = this.session.subscribe((event) => {
			if (event.type === "inventory-preview") this.#preview(event.result);
			else if (event.type === "entities") {
				this.#validateGesture();
			} else if (
				event.type === "resyncing" ||
				event.type === "current-state" ||
				event.type === "exit-requested" ||
				(event.type === "lifecycle" && event.lifecycle.kind !== "in-world")
			)
				this.#cancel();
		});
		this.#timer = setInterval(() => {
			if (this.#gesture === null) return;
			if (!this.#validateGesture()) return;
			const views = this.#readViews();
			const changed =
				views.length !== this.#views.length ||
				views.some((view, index) => view !== this.#views[index]);
			if (this.#gesture?.kind === "dragging") {
				if (changed) this.#dimDropCandidates();
				this.#target(changed);
			}
			this.#views = views;
		}, CLIENT_TUNING.inventory.displayIntervalMs);
	}

	/** Cancel only a pointer gesture; the HUD owns fallback interaction cancellation. */
	cancel(): boolean {
		if (
			this.#gesture === null &&
			this.#draftGesture === null &&
			this.#bindingGesture === null
		)
			return false;
		this.#cancel();
		return true;
	}
	destroy(): void {
		this.#cancel();
		this.#abort.abort();
		this.#unsubscribe();
		clearInterval(this.#timer);
		this.#ghost.remove();
		this.#bindingSources.clear();
	}

	/** Register a local draft source; disposing it cancels its active pointer lifetime. */
	registerBindingSource(
		element: HTMLElement,
		read: () => ActionContent | null,
		placed: () => void,
	): () => void {
		this.#bindingSources.set(element, { read, placed });
		element.dataset.bindingSource = "true";
		return () => {
			if (this.#bindingGesture?.element === element) this.#cancel();
			this.#bindingSources.delete(element);
			delete element.dataset.bindingSource;
		};
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
		const bindingElement =
			event.target instanceof Element
				? event.target.closest<HTMLElement>(
						"[data-binding-source], [data-action-cell]:not([data-empty='true'])",
					)
				: null;
		if (bindingElement !== null && this.#root.contains(bindingElement)) {
			const cell = this.#actionCell(bindingElement);
			const registered = this.#bindingSources.get(bindingElement);
			const content =
				cell === null ? registered?.read() : this.bindings.read(cell);
			const source = cell ?? registered;
			if (content?.kind === "loadout" && source !== undefined) {
				this.#cancel();
				this.#bindingGesture = {
					content,
					element: bindingElement,
					source,
					pointer: event.pointerId,
					x: event.clientX,
					y: event.clientY,
					dragging: false,
				};
				event.stopPropagation();
				return;
			}
		}
		const queuedSalvage =
			event.target instanceof Element
				? event.target.closest<HTMLElement>("[data-salvage-item]")
				: null;
		if (queuedSalvage !== null && this.#root.contains(queuedSalvage)) {
			const boundary = queuedSalvage.closest<HTMLElement>(
				"[data-salvage-queue]",
			);
			const remove = this.salvage?.captureRemoval(
				Number(queuedSalvage.dataset.salvageItem),
			);
			if (boundary === null || remove == null) return;
			this.#cancel();
			this.#draftGesture = {
				boundary,
				remove,
				element: queuedSalvage,
				pointer: event.pointerId,
				x: event.clientX,
				y: event.clientY,
				dragging: false,
			};
			event.stopPropagation();
			return;
		}
		const requirement =
			event.target instanceof Element
				? event.target.closest<HTMLElement>(
						"[data-housing-payment] .item-grid-cell",
					)
				: null;
		if (requirement !== null && this.#root.contains(requirement)) {
			const row = requirement.closest<HTMLElement>("[data-housing-wcid]");
			if (row === null) return;
			const identity = this.houseCrystal?.captureRow(
				Number(row.dataset.housingWcid),
			);
			if (identity == null) return;
			this.#cancel();
			this.#draftGesture = {
				boundary: requirement,
				remove: () => this.houseCrystal?.clearRow(identity),
				element: requirement,
				pointer: event.pointerId,
				x: event.clientX,
				y: event.clientY,
				dragging: false,
			};
			event.stopPropagation();
			return;
		}
		const offer =
			event.target instanceof Element
				? event.target.closest<HTMLElement>(
						"[data-vendor-offer]:not(:disabled)",
					)
				: null;
		if (offer !== null && this.#root.contains(offer)) {
			const item = Number(offer.dataset.vendorOffer);
			const vendor = Number(offer.dataset.vendorGuid);
			if (!this.vendor?.canDragOffer(vendor, item)) return;
			this.#cancel();
			this.#gesture = {
				kind: "pressed",
				source: { item, origin: "vendor", root: vendor, element: offer },
				pointer: event.pointerId,
				x: event.clientX,
				y: event.clientY,
			};
			event.stopPropagation();
			return;
		}
		const element =
			event.target instanceof Element
				? event.target.closest<HTMLElement>(
						".item-grid-cell[data-item-guid]:not(:disabled), [data-action-cell][data-action-item]",
					)
				: null;
		if (element === null || !this.#root.contains(element)) return;
		if (this.session.entities.read().kind !== "current") return;
		const actionCell = this.#actionCell(element);
		const surface = this.#surface(element);
		if (
			actionCell === null &&
			surface === null &&
			element.closest(".equipment-row") === null
		)
			return;
		const bound = actionCell === null ? null : this.bindings.read(actionCell);
		if (bound?.kind === "loadout") return;
		if (actionCell !== null && bound === null) return;
		const item = bound === null ? Number(element.dataset.itemGuid) : bound.item;
		const origin =
			actionCell !== null
				? actionCell
				: element.closest(".contents-packs") !== null
					? "pack"
					: element.closest(".equipment-row") !== null
						? "equipment"
						: "contents";
		if (actionCell === null) {
			const facts = this.#worldEntity(item);
			if (
				facts?.description.kind !== "known" ||
				!(facts.ownedByPlayer || facts.worldContainerContent)
			)
				return;
			if (surface?.root === item) return;
			if (
				origin === "pack" &&
				(facts.location.kind !== "contained" ||
					facts.location.slot.kind !== "pack" ||
					facts.location.slot.entryKind !== "container")
			)
				return;
		}
		this.#cancel();
		this.#gesture = {
			kind: "pressed",
			source: { item, origin, element, root: surface?.root ?? null },
			pointer: event.pointerId,
			x: event.clientX,
			y: event.clientY,
		};
		event.stopPropagation();
	};

	#move = (event: PointerEvent): void => {
		const binding = this.#bindingGesture;
		if (binding !== null) {
			if (event.pointerId !== binding.pointer) return;
			if (!this.#bindingCurrent(binding)) {
				this.#cancel();
				return;
			}
			if (!binding.dragging) {
				if (
					Math.hypot(event.clientX - binding.x, event.clientY - binding.y) <
					CLIENT_TUNING.inventory.dragThresholdCssPixels
				)
					return;
				binding.dragging = true;
				this.cancelInteraction();
				this.#showGhost(binding.element);
			}
			positionUiDragGhost(this.#ghost, event);
			this.#clearHighlight();
			const target = document
				.elementFromPoint(event.clientX, event.clientY)
				?.closest<HTMLElement>("[data-action-cell]");
			if (target != null && this.#root.contains(target))
				target.dataset.inventoryDrop = "accepted";
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		const draft = this.#draftGesture;
		if (draft !== null) {
			if (draft.pointer !== event.pointerId) return;
			if (!draft.element.isConnected) {
				this.#cancel();
				return;
			}
			if (
				!draft.dragging &&
				Math.hypot(event.clientX - draft.x, event.clientY - draft.y) <
					CLIENT_TUNING.inventory.dragThresholdCssPixels
			)
				return;
			if (!draft.dragging) {
				draft.dragging = true;
				this.cancelInteraction();
				this.#showGhost(draft.element);
			}
			positionUiDragGhost(this.#ghost, event);
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (!this.#validateGesture()) return;
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
			this.cancelInteraction();
			if (
				typeof gesture.source.origin === "string" &&
				gesture.source.origin !== "vendor"
			)
				this.selectDragItem(gesture.source.item);
			gesture = {
				kind: "dragging",
				source: gesture.source,
				pointer: gesture.pointer,
				target: null,
			};
			this.#gesture = gesture;
			this.#showGhost(gesture.source.element);
			// Initial hints already describe this view; the timer must not retire them as stale.
			this.#views = this.#readViews();
			this.#dimDropCandidates();
		}
		event.preventDefault();
		event.stopPropagation();
		positionUiDragGhost(this.#ghost, event);
		this.#target(false);
	};

	/** Dim blocked contents targets and filter equipment using the drag source. */
	#dimDropCandidates(): void {
		const gesture = this.#gesture;
		if (
			gesture?.kind !== "dragging" ||
			gesture.source.origin === "vendor" ||
			typeof gesture.source.origin !== "string"
		)
			return;
		this.#mergeHints.clear();
		for (const cell of this.#root.querySelectorAll<HTMLElement>(
			".contents-scroll .item-grid-cell[data-item-guid]:not(:disabled)",
		)) {
			if (
				gesture.source.origin !== "equipment" &&
				this.#surface(cell)?.view.sortMode !== "native" &&
				cell !== gesture.source.element
			) {
				cell.dataset.inventoryDimmed = "true";
				const sequence = nextInventoryPreviewSequence();
				this.#mergeHints.set(sequence, cell);
				void this.session
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
		const source = this.#worldEntity(gesture.source.item);
		filterDraggedEquipment(
			this.#root,
			source?.ownedByPlayer && source.description.kind === "known"
				? source.description.equipLocations
				: null,
		);
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
		const payment = hit?.closest<HTMLElement>("[data-housing-payment]");
		if (payment != null && this.#root.contains(payment)) {
			this.#clearHighlight();
			const crystal = Number(payment.dataset.housingPayment);
			const wcid = Number(payment.dataset.housingWcid);
			gesture.target = { kind: "housing", element: payment, crystal, wcid };
			payment.dataset.inventoryDrop = this.#canPay(gesture.source, crystal)
				? "accepted"
				: "rejected";
			return;
		}

		const salvageQueue = hit?.closest<HTMLElement>("[data-salvage-queue]");
		if (
			salvageQueue !== null &&
			salvageQueue !== undefined &&
			this.#root.contains(salvageQueue)
		) {
			this.#clearHighlight();
			gesture.target = { kind: "salvage", element: salvageQueue };
			salvageQueue.dataset.inventoryDrop = this.#canSalvage(gesture.source)
				? "accepted"
				: "rejected";
			return;
		}
		const offer = hit?.closest<HTMLElement>("[data-trade-offer]");
		if (offer != null && this.#root.contains(offer)) {
			this.#clearHighlight();
			const partner = Number(offer.dataset.tradeOffer);
			const revision = Number(offer.dataset.tradeRevision);
			gesture.target = { kind: "trade", element: offer, partner, revision };
			offer.dataset.inventoryDrop = this.#canOffer(
				gesture.source,
				partner,
				revision,
			)
				? "accepted"
				: "rejected";
			return;
		}
		const queue = hit?.closest<HTMLElement>("[data-vendor-queue]");
		if (queue != null && this.#root.contains(queue)) {
			this.#clearHighlight();
			const vendor = Number(queue.dataset.vendorQueue);
			gesture.target = { kind: "vendor", element: queue, vendor };
			queue.dataset.inventoryDrop = this.#canQueue(gesture.source, vendor)
				? "accepted"
				: "rejected";
			return;
		}
		if (gesture.source.origin === "vendor") {
			this.#clearHighlight();
			gesture.target = null;
			return;
		}
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
				this.#bindable(gesture.source.item)
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
			const source = this.#worldEntity(gesture.source.item);
			const surface = this.#surface(hit);
			const equipment = hit.closest<HTMLElement>("[data-equipment-slot]");
			const cell = hit.closest<HTMLElement>(
				".item-grid-cell[data-item-guid]:not(:disabled)",
			);
			const header = hit.closest<HTMLElement>(
				".contents-header[data-item-guid]:not(:disabled)",
			);
			if (
				hit instanceof HTMLElement &&
				hit.matches("[data-game-viewport]") &&
				source?.ownedByPlayer
			) {
				this.#worldTarget(hit, force);
				return;
			} else if (equipment !== null && source?.ownedByPlayer) {
				// Slot activation is independent of item coverage; locked/pending rows
				// must not advertise an accepted drop or submit an equipment request.
				if (this.#equipmentAvailable(Number(equipment.dataset.equipmentSlot))) {
					element = equipment;
					target = {
						kind: "equipment",
						mask: Number(equipment.dataset.equipmentSlot),
					};
				}
			} else if (surface !== null && header !== null) {
				element = header;
				target = { kind: "container", guid: Number(header.dataset.itemGuid) };
			} else if (surface !== null && cell !== null) {
				element = cell;
				const guid = Number(cell.dataset.itemGuid);
				if (cell.closest(".contents-packs")) {
					// Only rearranging carried pack-strip entries uses the two-command swap.
					const read = this.session.entities.read();
					const carriedSwap =
						gesture.source.origin === "pack" &&
						source?.ownedByPlayer &&
						read.kind === "current" &&
						surface.root === read.level.playerGuid;
					target = { kind: carriedSwap ? "pack" : "container", guid };
				} else {
					const container = cell.closest<HTMLElement>("[data-container-guid]");
					target =
						surface.view.sortMode !== "native" &&
						gesture.source.origin === "equipment" &&
						container !== null
							? {
									kind: "container",
									guid: Number(container.dataset.containerGuid),
								}
							: {
									kind: surface.view.sortMode === "native" ? "item" : "stack",
									guid,
								};
				}
			} else if (surface !== null && hit.closest(".item-grid-cell") === null) {
				// Section background appends regardless of display sorting. Disabled item
				// cells still own their footprint; they must not become background targets.
				const section = hit.closest<HTMLElement>(
					".contents-scroll [data-container-guid]",
				);
				if (section !== null) {
					element = section;
					target = {
						kind: "container",
						guid: Number(section.dataset.containerGuid),
					};
				}
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

	#canPay(source: DragSource, crystal: number): boolean {
		return (
			typeof source.origin === "string" &&
			source.origin !== "vendor" &&
			this.houseCrystal?.acceptsDrop(crystal, source.item) === true
		);
	}

	/** Only owned inventory gestures can contribute to the local salvage draft. */
	#canSalvage(source: DragSource): boolean {
		return (
			typeof source.origin === "string" &&
			source.origin !== "vendor" &&
			this.salvage?.acceptsDrop(source.item) === true
		);
	}

	/** Only owned inventory gestures can contribute to P2P offers. */
	#canOffer(source: DragSource, partner: number, revision: number): boolean {
		return (
			typeof source.origin === "string" &&
			source.origin !== "vendor" &&
			this.trade?.acceptsDrop(partner, revision, source.item) === true
		);
	}
	/** Surface ownership is local; exact price and sale eligibility are quoted by world. */
	#canQueue(source: DragSource, vendor: number): boolean {
		if (!this.vendor?.acceptsDrop(vendor)) return false;
		if (source.origin === "vendor")
			return (
				source.root === vendor && this.vendor.canDragOffer(vendor, source.item)
			);
		return (
			typeof source.origin === "string" &&
			this.#worldEntity(source.item)?.ownedByPlayer === true
		);
	}

	/** Resolve presentation from its owner and access from the current session level. */
	#surface(element: Element): ContentsSurface | null {
		const owner = element.closest<HTMLElement>("[data-contents-root]");
		if (owner === null || !owner.isConnected || !this.#root.contains(owner))
			return null;
		const root = Number(owner.dataset.contentsRoot);
		const read = this.session.entities.read();
		if (
			read.kind !== "current" ||
			(read.level.playerGuid !== root &&
				(read.level.worldContainer.kind !== "open" ||
					read.level.worldContainer.root !== root))
		)
			return null;
		const view = this.readContents(root);
		return view === null || view.pending ? null : { root, view };
	}
	#readViews(): readonly unknown[] {
		const read = this.session.entities.read();
		return [
			read.kind === "current" ? read.level : null,
			...Array.from(
				this.#root.querySelectorAll("[data-contents-root]"),
				(element) => this.#surface(element)?.view,
			),
		];
	}
	/** Closing/recovery invalidates unsent work even before the sampled DOM catches up. */
	#validateGesture(): boolean {
		const gesture = this.#gesture;
		if (gesture === null) return false;
		const source = gesture.source;
		const facts = this.#worldEntity(source.item);
		const invalidSource =
			source.origin === "vendor"
				? source.root === null ||
					this.vendor?.canDragOffer(source.root, source.item) !== true
				: typeof source.origin === "string" &&
					(facts?.description.kind !== "known" ||
						!(facts.ownedByPlayer || facts.worldContainerContent) ||
						(source.origin === "equipment" && !facts.ownedByPlayer) ||
						(source.root !== null &&
							this.#surface(source.element)?.root !== source.root));
		const target = gesture.kind === "pressed" ? null : gesture.target;
		const invalidTarget =
			target?.kind === "inventory" &&
			((target.surface !== null &&
				this.#surface(target.element)?.root !== target.surface.root) ||
				(target.intent.target.kind === "equipment" &&
					!this.#equipmentAvailable(target.intent.target.mask)));
		if (
			invalidSource ||
			invalidTarget ||
			!source.element.isConnected ||
			this.session.state().lifecycle?.kind !== "in-world" ||
			this.session.entities.read().kind !== "current" ||
			this.#root.querySelector('[data-inventory-modal="true"]') !== null
		) {
			this.#cancel();
			return false;
		}
		return true;
	}

	/** Delayed previews and pointer release use current authority, independent of sampled DOM. */
	#equipmentAvailable(mask: number): boolean {
		const slot = EQUIPMENT_SLOTS.find((slot) => slot.mask === mask);
		if (slot === undefined) throw new Error("Unknown equipment strip slot");
		const read = this.session.entities.read();
		return (
			read.kind === "current" &&
			equipmentSlotAvailability(slot, read.level) === "available"
		);
	}

	#worldEntity(guid: number) {
		const read = this.session.entities.read();
		return read.kind === "current" ? read.level.entities.get(guid) : undefined;
	}

	#worldTarget(element: HTMLElement, force: boolean): void {
		const gesture = this.#gesture;
		if (gesture?.kind !== "dragging") return;
		const current = gesture.target;
		if (
			!force &&
			current?.kind === "viewport" &&
			(current.result === null ||
				(current.x === this.#cursor.x && current.y === this.#cursor.y))
		)
			return;
		this.#clearHighlight();
		const target: ViewportDragTarget = {
			kind: "viewport",
			element,
			...this.#cursor,
			result: null,
		};
		gesture.target = target;
		element.dataset.inventoryDrop = "pending";
		this.pickWorldTarget(target.x, target.y, {
			isCurrent: () => {
				const active = this.#gesture;
				return (
					active !== null &&
					active.kind !== "pressed" &&
					active.target === target
				);
			},
			commit: (result) => {
				const active = this.#gesture;
				if (
					active === null ||
					active.kind === "pressed" ||
					active.target !== target
				)
					return;
				target.result = result;
				// Keep one hover query in flight; refresh its newest point before highlighting the destination.
				if (
					active.kind === "dragging" &&
					(target.x !== this.#cursor.x || target.y !== this.#cursor.y)
				) {
					this.#target(false);
					return;
				}
				const recipient =
					result.kind === "entity" ? this.#worldEntity(result.guid) : null;
				element.dataset.inventoryDrop =
					result.kind === "empty" || recipient?.canReceiveGive
						? "accepted"
						: "rejected";
				if (active.kind === "released")
					this.#resolveWorldRelease(active, target);
			},
		});
	}

	#resolveWorldRelease(
		gesture: Extract<Gesture, { kind: "released" }>,
		target: ViewportDragTarget,
	): void {
		const result = target.result;
		if (result === null) return;
		if (result.kind === "unavailable") {
			this.#finishGesture();
			this.reportNotice(result.reason);
			return;
		}
		if (
			result.kind === "entity" &&
			!this.#worldEntity(result.guid)?.canReceiveGive
		) {
			this.#finishGesture();
			this.reportNotice("This entity cannot receive an item.");
			return;
		}
		gesture.target = this.#request(target.element, {
			item: gesture.source.item,
			target:
				result.kind === "empty"
					? { kind: "ground" }
					: { kind: "give", guid: result.guid },
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
			surface: this.#surface(element),
		};
		element.dataset.inventoryDrop = "pending";
		void this.session
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
		if (!this.#validateGesture()) return;
		if (target.surface !== null) {
			const current = this.#surface(target.element);
			if (
				current === null ||
				current.root !== target.surface.root ||
				(target.intent.target.kind === "item" &&
					current.view.sortMode !== "native")
			) {
				this.#cancel();
				return;
			}
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
			this.reportFailure(
				`${result.preview.reason}${intent.target.kind === "stack" ? " Positional drops require Native sorting." : ""}`,
			);
		}
		if (!rejected && result.preview.kind !== "noop") {
			if (intent.target.kind === "give") {
				this.give(intent.item, intent.target.guid);
				return;
			}
			void this.session
				.submitInventory(intent)
				.catch((error: unknown) =>
					this.reportFailure(`Inventory request failed: ${String(error)}`),
				);
		}
	}

	#up = (event: PointerEvent): void => {
		const binding = this.#bindingGesture;
		if (binding !== null) {
			if (binding.pointer !== event.pointerId) return;
			if (!binding.dragging || !this.#bindingCurrent(binding)) {
				this.#cancel();
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			this.#suppressClick = true;
			this.#suppressDoubleClickUntil =
				performance.now() + CLIENT_TUNING.inventory.doubleClickSuppressionMs;
			const targetElement = document
				.elementFromPoint(event.clientX, event.clientY)
				?.closest<HTMLElement>("[data-action-cell]");
			const target =
				targetElement != null && this.#root.contains(targetElement)
					? this.#actionCell(targetElement)
					: null;
			this.#finishGesture();
			if ("bar" in binding.source)
				this.bindings.transfer(binding.source, target);
			else if (target !== null) {
				this.bindings.bind(target, binding.content);
				binding.source.placed();
			}
			return;
		}
		const draft = this.#draftGesture;
		if (draft !== null) {
			if (draft.pointer !== event.pointerId) return;
			if (draft.dragging) {
				event.preventDefault();
				event.stopPropagation();
				this.#suppressClick = true;
				this.#suppressDoubleClickUntil =
					performance.now() + CLIENT_TUNING.inventory.doubleClickSuppressionMs;
				const hit = document.elementFromPoint(event.clientX, event.clientY);
				const outside = !draft.boundary.contains(hit);
				this.#finishGesture();
				if (outside) draft.remove();
			} else this.#finishGesture();
			return;
		}
		if (!this.#validateGesture()) return;
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
		this.#suppressDoubleClickUntil =
			performance.now() + CLIENT_TUNING.inventory.doubleClickSuppressionMs;
		this.#ghost.hidden = true;
		this.#ghost.hidePopover();
		this.#clearDimming();
		this.#cursor = { x: event.clientX, y: event.clientY };
		this.#target(true);
		if (this.#gesture !== gesture) return;
		if (gesture.target?.kind === "housing") {
			const { source, target } = gesture;
			const accepted = this.#canPay(source, target.crystal);
			this.#finishGesture();
			if (accepted)
				this.houseCrystal?.add(target.crystal, target.wcid, source.item);
			else
				this.reportNotice(
					"Drag a carried inventory item into this payment draft.",
				);
			return;
		}

		if (gesture.target?.kind === "salvage") {
			const source = gesture.source;
			const accepted = this.#canSalvage(source);
			this.#finishGesture();
			if (accepted) this.salvage?.add(source.item);
			else this.reportNotice("That item cannot join the salvage queue.");
			return;
		}
		if (gesture.target?.kind === "trade") {
			const { source, target } = gesture;
			const accepted = this.#canOffer(source, target.partner, target.revision);
			this.#finishGesture();
			if (accepted)
				this.trade?.add(target.partner, target.revision, source.item);
			else this.trade?.reportFailure("That item cannot join this trade.");
			return;
		}
		if (gesture.target?.kind === "vendor") {
			const { source, target } = gesture;
			const accepted = this.#canQueue(source, target.vendor);
			this.#finishGesture();
			if (!accepted)
				this.reportNotice(
					"Drag a vendor offer or an owned item into this trade.",
				);
			else if (source.origin === "vendor") this.vendor?.queueBuy(source.item);
			else this.vendor?.queueSell(source.item);
			return;
		}

		if (typeof gesture.source.origin !== "string") {
			const target =
				gesture.target?.kind === "action" ? gesture.target.cell : null;
			const source = gesture.source.origin;
			// Automatic supply replacement may change the binding during this pointer gesture.
			const current = this.bindings.read(source);
			if (
				current === null ||
				current.kind === "loadout" ||
				current.item !== gesture.source.item
			) {
				this.#cancel();
				this.reportFailure("The action cell changed while dragging.");
				return;
			}
			this.#finishGesture();
			this.bindings.transfer(source, target);
			return;
		}
		if (gesture.target?.kind === "action") {
			const target = gesture.target.cell;
			const item = gesture.source.item;
			this.#finishGesture();
			const content = bindingAction(this.#worldEntity(item));
			if (content !== null) this.bindings.bind(target, content);
			else
				this.reportFailure(
					"Only owned equippable or usable items can be bound to an action cell.",
				);
			return;
		}
		if (gesture.target === null) {
			this.#cancel();
			return;
		}
		const released: Extract<Gesture, { kind: "released" }> = {
			kind: "released",
			source: gesture.source,
			target: gesture.target,
		};
		this.#gesture = released;
		if (released.target.kind === "viewport")
			this.#resolveWorldRelease(released, released.target);
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
	#bindable(item: number): boolean {
		return bindingAction(this.#worldEntity(item)) !== null;
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
		filterDraggedEquipment(this.#root, null);
		this.#clearDimming();
		this.#gesture = null;
		this.#draftGesture = null;
		this.#bindingGesture = null;
		this.#views = [];
		this.#ghost.hidden = true;
		this.#ghost.hidePopover();
		delete this.#root.dataset.itemDragging;
		this.#clearHighlight();
	}
	#cancel = (): void => {
		if (
			this.#gesture?.kind === "dragging" ||
			this.#bindingGesture?.dragging === true ||
			this.#draftGesture?.dragging === true
		) {
			this.#suppressClick = true;
			this.#suppressDoubleClickUntil =
				performance.now() + CLIENT_TUNING.inventory.doubleClickSuppressionMs;
		}
		this.#finishGesture();
	};

	#bindingCurrent(binding: BindingGesture): boolean {
		if (
			!binding.element.isConnected ||
			this.session.state().lifecycle?.kind !== "in-world"
		) {
			return false;
		}
		const content =
			"bar" in binding.source
				? this.bindings.read(binding.source)
				: binding.source.read();
		return content === binding.content;
	}

	/** Reuse authored artwork for all shortcut/item drags without another display lease. */
	#showGhost(source: HTMLElement): void {
		showUiDragGhost(
			this.#ghost,
			source,
			source.getAttribute("aria-label") ?? "",
		);
		this.#root.dataset.itemDragging = "true";
	}
	#failure(error: unknown): void {
		this.#cancel();
		this.reportFailure(`Inventory request failed: ${String(error)}`);
	}
	#cancelPointer = (event: PointerEvent): void => {
		if (this.#bindingGesture?.pointer === event.pointerId) this.#cancel();
		if (this.#draftGesture?.pointer === event.pointerId) this.#cancel();
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
