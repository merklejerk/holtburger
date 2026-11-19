import { dragEdgeScrollFactor } from "../app/drag-edge-scroll";
import { pulseItemCell } from "../app/item-cell-pulse";
import { bindingAction } from "./client-action-item";
import type {
	ActionCellAddress,
	ActionContent,
} from "./client-action-bar-state";
import { filterDraggedEquipment } from "./client-equipment-strip-filter";
import type { ClientHouseCrystalState } from "./client-house-crystal-state";
import {
	nextInventoryPreviewSequence,
	type ClientInventoryIntent,
	type ClientInventoryPreviewResult,
} from "./client-inventory-state";
import {
	canPayCrystal,
	canQueueVendor,
	canSalvageItem,
	isEquipmentAvailable,
	readContentsViews,
	resolveActionCell,
	resolveContentsSurface,
	resolveHitTarget,
	resolvePressedSource,
	worldEntity,
	type ActionDragBindings,
	type BindingDragSource,
	type ContentsDragView,
	type DragFeatureAdapters,
	type DragSource,
	type DragTarget,
	type InventoryDragTarget,
	type ItemDragSession,
	type PressedDragSource,
	type ViewportDragTarget,
} from "./client-item-drag-targets";
import {
	clearDimming,
	clearDropHighlights,
	hideDragGhost,
	positionDragGhost,
	retireActiveDragVisuals,
	showDragGhost,
} from "./client-item-drag-visuals";
import type { ClientViewportTargetPicker } from "./client-pointer-selection-controller";
import type { ClientSalvageState } from "./client-salvage-state";
import type { ClientTradeState } from "./client-trade-state";
import { CLIENT_TUNING } from "./client-tuning";
import type { ClientVendorState } from "./client-vendor-state";

export type { ItemDragSession };

type ActiveDragPhase =
	| { readonly kind: "idle" }
	| {
			readonly kind: "pressed";
			readonly pointer: number;
			readonly x: number;
			readonly y: number;
			readonly press: PressedDragSource;
	  }
	| {
			readonly kind: "dragging-binding";
			readonly pointer: number;
			readonly source: ActionCellAddress | BindingDragSource;
			readonly content: ActionContent;
			readonly element: HTMLElement;
			highlightedCell: HTMLElement | null;
	  }
	| {
			readonly kind: "dragging-draft";
			readonly pointer: number;
			readonly boundary: HTMLElement;
			readonly remove: () => void;
			readonly element: HTMLElement;
	  }
	| {
			readonly kind: "dragging-item";
			readonly pointer: number;
			readonly source: DragSource;
			cursor: { x: number; y: number };
			target: DragTarget | null;
			scrollFrame: number | null;
			views: readonly unknown[];
			readonly mergeHints: Map<number, HTMLElement>;
	  }
	| {
			readonly kind: "awaiting-release";
			readonly source: DragSource;
			target: DragTarget;
	  };

/** Imperative pointer owner: only semantic target changes cross the host boundary. */
export class ClientItemDrag {
	readonly #root: HTMLElement;
	readonly #ghost: HTMLElement;
	readonly #abort = new AbortController();
	readonly #unsubscribe: () => void;
	readonly #bindingSources = new Map<HTMLElement, BindingDragSource>();
	readonly #adapters: DragFeatureAdapters;
	#timer: ReturnType<typeof setInterval> | null = null;
	#phase: ActiveDragPhase = { kind: "idle" };
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
			| "canDragOffer"
			| "acceptsDrop"
			| "acceptsSaleDrop"
			| "queueBuy"
			| "queueSell"
			| "captureRemoval"
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
		this.#adapters = { vendor, salvage, trade, houseCrystal };
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
						".item-grid-cell, .contents-header, [data-action-cell], [data-vendor-offer], [data-salvage-item]",
					)
				) {
					event.preventDefault();
				}
			},
			options,
		);
		this.#unsubscribe = this.session.subscribe((event) => {
			if (event.type === "inventory-preview") {
				this.#preview(event.result);
			} else if (event.type === "entities") {
				this.#validatePhase();
			} else if (
				event.type === "resyncing" ||
				event.type === "current-state" ||
				event.type === "exit-requested" ||
				(event.type === "lifecycle" && event.lifecycle.kind !== "in-world")
			) {
				this.#cancel();
			}
		});
	}

	/** Cancel only a pointer gesture; the HUD owns fallback interaction cancellation. */
	cancel(): boolean {
		if (this.#phase.kind === "idle") return false;
		this.#cancel();
		return true;
	}

	destroy(): void {
		this.#cancel();
		this.#abort.abort();
		this.#unsubscribe();
		this.#stopItemPolling();
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
			if (
				(this.#phase.kind === "pressed" &&
					this.#phase.press.kind === "binding" &&
					this.#phase.press.element === element) ||
				(this.#phase.kind === "dragging-binding" &&
					this.#phase.element === element)
			) {
				this.#cancel();
			}
			this.#bindingSources.delete(element);
			delete element.dataset.bindingSource;
		};
	}

	#enterPressed(event: PointerEvent, press: PressedDragSource): void {
		this.#cancel();
		this.#phase = {
			kind: "pressed",
			pointer: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			press,
		};
		event.stopPropagation();
	}

	#down = (event: PointerEvent): void => {
		// Suppression belongs to the completed gesture, never a later independent click.
		this.#suppressClick = false;
		if (
			event.button !== 0 ||
			!event.isPrimary ||
			this.#root.querySelector('[data-inventory-modal="true"]') !== null
		) {
			return;
		}
		const targetNode = event.target instanceof Element ? event.target : null;
		if (targetNode === null) return;
		const press = resolvePressedSource({
			targetNode,
			root: this.#root,
			session: this.session,
			readContents: this.readContents,
			bindings: this.bindings,
			bindingSources: this.#bindingSources,
			adapters: this.#adapters,
		});
		if (press !== null) this.#enterPressed(event, press);
	};

	#move = (event: PointerEvent): void => {
		if (!this.#validatePhase()) return;
		const phase = this.#phase;
		if (
			phase.kind === "idle" ||
			phase.kind === "awaiting-release" ||
			phase.pointer !== event.pointerId
		) {
			return;
		}
		if (phase.kind === "pressed") {
			if (
				Math.hypot(event.clientX - phase.x, event.clientY - phase.y) <
				CLIENT_TUNING.inventory.dragThresholdCssPixels
			) {
				return;
			}
			this.cancelInteraction();
			const nextPhase = this.#beginDragFromPress(phase, event);
			event.preventDefault();
			event.stopPropagation();
			positionDragGhost(this.#ghost, event);
			if (nextPhase.kind === "dragging-item") this.#target(nextPhase, false);
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		positionDragGhost(this.#ghost, event);
		if (phase.kind === "dragging-binding") {
			this.#highlightBindingTarget(phase, event);
			return;
		}
		if (phase.kind === "dragging-item") {
			phase.cursor = { x: event.clientX, y: event.clientY };
			this.#target(phase, false);
		}
	};

	#highlightBindingTarget(
		phase: Extract<ActiveDragPhase, { kind: "dragging-binding" }>,
		event: PointerEvent,
	): void {
		clearDropHighlights(this.#root);
		const target = document
			.elementFromPoint(event.clientX, event.clientY)
			?.closest<HTMLElement>("[data-action-cell]");
		if (target != null && this.#root.contains(target)) {
			target.dataset.inventoryDrop = "accepted";
			phase.highlightedCell = target;
		} else {
			phase.highlightedCell = null;
		}
	}

	#beginDragFromPress(
		pressed: Extract<ActiveDragPhase, { kind: "pressed" }>,
		event: PointerEvent,
	): ActiveDragPhase {
		const { press, pointer } = pressed;
		if (press.kind === "binding") {
			const next: ActiveDragPhase = {
				kind: "dragging-binding",
				pointer,
				source: press.source,
				content: press.content,
				element: press.element,
				highlightedCell: null,
			};
			this.#phase = next;
			showDragGhost(this.#root, this.#ghost, press.element);
			this.#highlightBindingTarget(next, event);
			return next;
		}
		if (press.kind === "draft") {
			const next: ActiveDragPhase = {
				kind: "dragging-draft",
				pointer,
				boundary: press.boundary,
				remove: press.remove,
				element: press.element,
			};
			this.#phase = next;
			showDragGhost(this.#root, this.#ghost, press.element);
			return next;
		}
		if (
			typeof press.source.origin === "string" &&
			press.source.origin !== "vendor"
		) {
			this.selectDragItem(press.source.item);
		}
		const next: Extract<ActiveDragPhase, { kind: "dragging-item" }> = {
			kind: "dragging-item",
			pointer,
			source: press.source,
			cursor: { x: event.clientX, y: event.clientY },
			target: null,
			scrollFrame: null,
			views: readContentsViews(this.#root, this.session, this.readContents),
			mergeHints: new Map(),
		};
		this.#phase = next;
		this.#startItemPolling();
		this.#startEdgeScroll(next);
		showDragGhost(this.#root, this.#ghost, press.source.element);
		this.#dimDropCandidates(next);
		return next;
	}

	#startItemPolling(): void {
		if (this.#timer !== null) return;
		this.#timer = setInterval(() => {
			if (this.#phase.kind !== "dragging-item") {
				this.#stopItemPolling();
				return;
			}
			if (!this.#validatePhase()) return;
			const phase = this.#phase;
			if (phase.kind !== "dragging-item") return;
			const views = readContentsViews(
				this.#root,
				this.session,
				this.readContents,
			);
			const changed =
				views.length !== phase.views.length ||
				views.some((view, index) => view !== phase.views[index]);
			if (changed) this.#dimDropCandidates(phase);
			this.#target(phase, changed);
			if (this.#phase === phase) phase.views = views;
		}, CLIENT_TUNING.inventory.displayIntervalMs);
	}

	#stopItemPolling(): void {
		if (this.#timer === null) return;
		clearInterval(this.#timer);
		this.#timer = null;
	}

	/** Keep pointer-rate geometry imperative and re-hit-test cells as they scroll underneath it. */
	#startEdgeScroll(
		phase: Extract<ActiveDragPhase, { kind: "dragging-item" }>,
	): void {
		let previous = performance.now();
		const frame = (now: number): void => {
			phase.scrollFrame = null;
			if (this.#phase !== phase) return;
			// A suspended frame must not jump through several packs when rendering resumes.
			const elapsed = Math.min(now - previous, 50) / 1_000;
			previous = now;
			const scroll = document
				.elementFromPoint(phase.cursor.x, phase.cursor.y)
				?.closest<HTMLElement>(".client-inventory .contents-scroll");
			if (scroll != null && this.#root.contains(scroll)) {
				const box = scroll.getBoundingClientRect();
				const tuning = CLIENT_TUNING.inventory;
				const before = scroll.scrollTop;
				scroll.scrollTop +=
					dragEdgeScrollFactor(
						phase.cursor.y,
						box.top,
						box.bottom,
						tuning.dragScrollEdgeCssPixels,
					) *
					tuning.dragScrollCssPixelsPerSecond *
					elapsed;
				if (scroll.scrollTop !== before) this.#target(phase, false);
			}
			if (this.#phase === phase) {
				phase.scrollFrame = requestAnimationFrame(frame);
			}
		};
		phase.scrollFrame = requestAnimationFrame(frame);
	}

	/** Dim blocked contents targets and filter equipment using the drag source. */
	#dimDropCandidates(
		phase: Extract<ActiveDragPhase, { kind: "dragging-item" }>,
	): void {
		if (
			phase.source.origin === "vendor" ||
			phase.source.origin === "main-pack" ||
			typeof phase.source.origin !== "string"
		) {
			return;
		}
		phase.mergeHints.clear();
		for (const cell of this.#root.querySelectorAll<HTMLElement>(
			".contents-scroll .item-grid-cell[data-item-guid]:not(:disabled)",
		)) {
			const surface = resolveContentsSurface(
				this.#root,
				this.session,
				this.readContents,
				cell,
			);
			if (
				phase.source.origin !== "equipment" &&
				surface?.view.sortMode !== "native" &&
				cell !== phase.source.element
			) {
				cell.dataset.inventoryDimmed = "true";
				const sequence = nextInventoryPreviewSequence();
				phase.mergeHints.set(sequence, cell);
				void this.session
					.previewInventory({
						sequence,
						intent: {
							item: phase.source.item,
							target: { kind: "stack", guid: Number(cell.dataset.itemGuid) },
						},
					})
					.catch((error: unknown) => {
						if (phase.mergeHints.has(sequence)) this.#failure(error);
					});
			} else {
				delete cell.dataset.inventoryDimmed;
			}
		}
		const source = worldEntity(this.session, phase.source.item);
		filterDraggedEquipment(
			this.#root,
			source?.ownedByPlayer && source.description.kind === "known"
				? source.description.equipLocations
				: null,
		);
	}

	#target(
		phase: Extract<ActiveDragPhase, { kind: "dragging-item" }>,
		force: boolean,
	): void {
		// Removing the source bar cancels rather than committing a stale address.
		if (
			typeof phase.source.origin !== "string" &&
			!phase.source.element.isConnected
		) {
			this.#cancel();
			return;
		}
		const resolved = resolveHitTarget({
			root: this.#root,
			session: this.session,
			readContents: this.readContents,
			adapters: this.#adapters,
			source: phase.source,
			cursor: phase.cursor,
		});
		if (resolved.kind === "none") {
			clearDropHighlights(this.#root);
			phase.target = null;
			return;
		}
		if (resolved.kind === "immediate") {
			clearDropHighlights(this.#root);
			phase.target = resolved.target;
			resolved.target.element.dataset.inventoryDrop = resolved.dropState;
			return;
		}
		if (resolved.kind === "viewport") {
			this.#worldTarget(phase, resolved.element, force);
			return;
		}
		if (
			!force &&
			phase.target?.kind === "inventory" &&
			phase.target.element === resolved.element &&
			JSON.stringify(phase.target.intent.target) ===
				JSON.stringify(resolved.intent.target)
		) {
			return;
		}
		clearDropHighlights(this.#root);
		phase.target = this.#request(resolved.element, resolved.intent);
	}

	/** Closing/recovery invalidates unsent work even before the sampled DOM catches up. */
	#validatePhase(): boolean {
		const phase = this.#phase;
		switch (phase.kind) {
			case "idle":
				return false;
			case "pressed":
				if (phase.press.kind === "binding") {
					if (!this.#bindingCurrent(phase.press)) {
						this.#cancel();
						return false;
					}
					return true;
				}
				if (phase.press.kind === "draft") {
					if (!phase.press.element.isConnected) {
						this.#cancel();
						return false;
					}
					return true;
				}
				return this.#validateItemSource(phase.press.source, null);
			case "dragging-binding":
				if (!this.#bindingCurrent(phase)) {
					this.#cancel();
					return false;
				}
				return true;
			case "dragging-draft":
				if (!phase.element.isConnected) {
					this.#cancel();
					return false;
				}
				return true;
			case "dragging-item":
			case "awaiting-release":
				return this.#validateItemSource(phase.source, phase.target);
		}
	}

	#validateItemSource(source: DragSource, target: DragTarget | null): boolean {
		const facts = worldEntity(this.session, source.item);
		const read = this.session.entities.read();
		const mainPackCurrent =
			source.origin === "main-pack" &&
			read.kind === "current" &&
			source.item === read.level.playerGuid &&
			source.root === source.item;
		const invalidSource =
			source.origin === "vendor"
				? source.root === null ||
					this.vendor?.canDragOffer(source.root, source.item) !== true
				: typeof source.origin === "string" &&
					(facts?.description.kind !== "known" ||
						!(
							facts.ownedByPlayer ||
							facts.worldContainerContent ||
							mainPackCurrent
						) ||
						(source.origin === "equipment" && !facts.ownedByPlayer) ||
						(source.origin === "main-pack" && !mainPackCurrent) ||
						(source.root !== null &&
							resolveContentsSurface(
								this.#root,
								this.session,
								this.readContents,
								source.element,
							)?.root !== source.root));
		const invalidTarget =
			target?.kind === "inventory" &&
			((target.surface !== null &&
				resolveContentsSurface(
					this.#root,
					this.session,
					this.readContents,
					target.element,
				)?.root !== target.surface.root) ||
				(target.intent.target.kind === "equipment" &&
					!isEquipmentAvailable(this.session, target.intent.target.mask)));
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

	#worldTarget(
		phase: Extract<ActiveDragPhase, { kind: "dragging-item" }>,
		element: HTMLElement,
		force: boolean,
	): void {
		const current = phase.target;
		if (
			!force &&
			current?.kind === "viewport" &&
			(current.result === null ||
				(current.x === phase.cursor.x && current.y === phase.cursor.y))
		) {
			return;
		}
		clearDropHighlights(this.#root);
		const target: ViewportDragTarget = {
			kind: "viewport",
			element,
			...phase.cursor,
			result: null,
		};
		phase.target = target;
		element.dataset.inventoryDrop = "pending";
		this.pickWorldTarget(target.x, target.y, {
			isCurrent: () => {
				const active = this.#phase;
				return (
					(active.kind === "dragging-item" ||
						active.kind === "awaiting-release") &&
					active.target === target
				);
			},
			commit: (result) => {
				const active = this.#phase;
				if (
					(active.kind !== "dragging-item" &&
						active.kind !== "awaiting-release") ||
					active.target !== target
				) {
					return;
				}
				target.result = result;
				// Keep one hover query in flight; refresh its newest point before highlighting the destination.
				if (
					active.kind === "dragging-item" &&
					(target.x !== active.cursor.x || target.y !== active.cursor.y)
				) {
					this.#target(active, false);
					return;
				}
				const recipient =
					result.kind === "entity"
						? worldEntity(this.session, result.guid)
						: null;
				element.dataset.inventoryDrop =
					result.kind === "empty" || recipient?.canReceiveGive
						? "accepted"
						: "rejected";
				if (active.kind === "awaiting-release") {
					this.#resolveWorldRelease(active, target);
				}
			},
		});
	}

	#resolveWorldRelease(
		phase: Extract<ActiveDragPhase, { kind: "awaiting-release" }>,
		target: ViewportDragTarget,
	): void {
		const result = target.result;
		if (result === null) return;
		if (result.kind === "unavailable") {
			this.#finishToIdle();
			this.reportNotice(result.reason);
			return;
		}
		if (
			result.kind === "entity" &&
			!worldEntity(this.session, result.guid)?.canReceiveGive
		) {
			this.#finishToIdle();
			this.reportNotice("This entity cannot receive an item.");
			return;
		}
		phase.target = this.#request(target.element, {
			item: phase.source.item,
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
			surface: resolveContentsSurface(
				this.#root,
				this.session,
				this.readContents,
				element,
			),
		};
		element.dataset.inventoryDrop = "pending";
		void this.session
			.previewInventory({ sequence: target.sequence, intent })
			.catch((error: unknown) => {
				const active = this.#phase;
				if (
					(active.kind === "dragging-item" ||
						active.kind === "awaiting-release") &&
					active.target?.kind === "inventory" &&
					active.target.sequence === target.sequence
				) {
					this.#failure(error);
				}
			});
		return target;
	}

	#preview(result: ClientInventoryPreviewResult): void {
		if (this.#phase.kind === "dragging-item") {
			const hint = this.#phase.mergeHints.get(result.sequence);
			if (hint !== undefined) {
				this.#phase.mergeHints.delete(result.sequence);
				hint.dataset.inventoryDimmed = String(result.preview.kind !== "merge");
				return;
			}
		}
		const phase = this.#phase;
		if (
			(phase.kind !== "dragging-item" && phase.kind !== "awaiting-release") ||
			phase.target?.kind !== "inventory" ||
			phase.target.sequence !== result.sequence
		) {
			return;
		}
		const target = phase.target;
		if (!this.#validatePhase()) return;
		if (target.surface !== null) {
			const current = resolveContentsSurface(
				this.#root,
				this.session,
				this.readContents,
				target.element,
			);
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
				if (
					result.preview.displaced.includes(Number(element.dataset.itemGuid))
				) {
					element.dataset.inventoryDisplaced = "true";
				}
			}
		}
		if (phase.kind !== "awaiting-release") return;
		const intent = target.intent;
		this.#finishToIdle();
		if (result.preview.kind === "rejected") {
			this.reportFailure(
				`${result.preview.reason}${intent.target.kind === "stack" ? " Positional drops require Native sorting." : ""}`,
			);
		}
		if (!rejected && result.preview.kind !== "noop") {
			// Background/container drops wait for arrival instead of pulsing an unrelated child.
			const cell =
				target.element.matches(".ui-item-cell") &&
				(intent.target.kind !== "container" ||
					Number(target.element.dataset.itemGuid) === intent.target.guid)
					? target.element
					: target.element.matches("[data-equipment-slot]")
						? target.element.querySelector<HTMLElement>(".ui-item-cell")
						: null;
			if (cell !== null) pulseItemCell(cell, "interaction");
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
		if (!this.#validatePhase()) return;
		const phase = this.#phase;
		if (
			phase.kind === "idle" ||
			phase.kind === "awaiting-release" ||
			phase.pointer !== event.pointerId
		) {
			return;
		}
		if (phase.kind === "pressed") {
			this.#cancel();
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.#suppressClick = true;
		this.#suppressDoubleClickUntil =
			performance.now() + CLIENT_TUNING.inventory.doubleClickSuppressionMs;

		if (phase.kind === "dragging-binding") {
			const targetElement = document
				.elementFromPoint(event.clientX, event.clientY)
				?.closest<HTMLElement>("[data-action-cell]");
			const target =
				targetElement != null && this.#root.contains(targetElement)
					? resolveActionCell(targetElement)
					: null;
			this.#finishToIdle();
			if ("bar" in phase.source) {
				this.bindings.transfer(phase.source, target);
			} else if (target !== null) {
				this.bindings.bind(target, phase.content);
				phase.source.placed();
			}
			return;
		}

		if (phase.kind === "dragging-draft") {
			const hit = document.elementFromPoint(event.clientX, event.clientY);
			const outside = !phase.boundary.contains(hit);
			this.#finishToIdle();
			if (outside) phase.remove();
			return;
		}

		this.#stopItemPolling();
		if (phase.scrollFrame !== null) {
			cancelAnimationFrame(phase.scrollFrame);
			phase.scrollFrame = null;
		}
		hideDragGhost(this.#ghost);
		clearDimming(this.#root, phase.mergeHints);
		phase.cursor = { x: event.clientX, y: event.clientY };
		this.#target(phase, true);
		if (this.#phase !== phase) return;

		if (phase.target?.kind === "housing") {
			const { source, target } = phase;
			const accepted = canPayCrystal(this.#adapters, source, target.crystal);
			this.#finishToIdle();
			if (accepted) {
				this.houseCrystal?.add(target.crystal, target.wcid, source.item);
			} else {
				this.reportNotice(
					"Drag a carried inventory item into this payment draft.",
				);
			}
			return;
		}

		if (phase.target?.kind === "salvage") {
			const source = phase.source;
			const accepted = canSalvageItem(this.#adapters, source);
			this.#finishToIdle();
			if (accepted) this.salvage?.add(source.item);
			else this.reportNotice("That item cannot join the salvage queue.");
			return;
		}

		if (phase.target?.kind === "trade") {
			const { source, target } = phase;
			this.#finishToIdle();
			if (typeof source.origin === "string" && source.origin !== "vendor") {
				this.trade?.add(target.partner, target.revision, source.item);
			} else {
				this.trade?.reportFailure("That item cannot join this trade.");
			}
			return;
		}

		if (phase.target?.kind === "vendor") {
			const { source, target } = phase;
			const accepted = canQueueVendor(this.#adapters, source, target);
			this.#finishToIdle();
			if (source.origin === "vendor" && accepted) {
				this.vendor?.queueBuy(source.item);
			} else if (
				typeof source.origin === "string" &&
				source.origin !== "vendor" &&
				this.vendor?.acceptsDrop(target.vendor)
			) {
				this.vendor.queueSell(source.item);
			} else {
				this.reportNotice("That vendor is not accepting this drop.");
			}
			return;
		}

		if (typeof phase.source.origin !== "string") {
			const target = phase.target?.kind === "action" ? phase.target.cell : null;
			const source = phase.source.origin;
			// Automatic supply replacement may change the binding during this pointer gesture.
			const current = this.bindings.read(source);
			if (
				current === null ||
				current.kind === "loadout" ||
				current.item !== phase.source.item
			) {
				this.#cancel();
				this.reportFailure("The action cell changed while dragging.");
				return;
			}
			this.#finishToIdle();
			this.bindings.transfer(source, target);
			return;
		}

		if (phase.target?.kind === "action") {
			const target = phase.target.cell;
			const item = phase.source.item;
			this.#finishToIdle();
			const content = bindingAction(worldEntity(this.session, item));
			if (content !== null) {
				this.bindings.bind(target, content);
			} else {
				this.reportFailure(
					"Only owned equippable or usable items can be bound to an action cell.",
				);
			}
			return;
		}

		if (phase.target === null) {
			this.#cancel();
			return;
		}

		retireActiveDragVisuals(this.#root, this.#ghost, {
			scrollFrame: phase.scrollFrame,
			mergeHints: phase.mergeHints,
			clearHighlights: false,
		});
		const awaiting: Extract<ActiveDragPhase, { kind: "awaiting-release" }> = {
			kind: "awaiting-release",
			source: phase.source,
			target: phase.target,
		};
		this.#phase = awaiting;
		if (awaiting.target.kind === "viewport") {
			this.#resolveWorldRelease(awaiting, awaiting.target);
		}
	};

	#finishToIdle(): void {
		this.#stopItemPolling();
		const phase = this.#phase;
		this.#phase = { kind: "idle" };
		retireActiveDragVisuals(this.#root, this.#ghost, {
			scrollFrame: phase.kind === "dragging-item" ? phase.scrollFrame : null,
			mergeHints: phase.kind === "dragging-item" ? phase.mergeHints : undefined,
			clearHighlights: true,
		});
	}

	#cancel = (): void => {
		if (
			this.#phase.kind === "dragging-item" ||
			this.#phase.kind === "dragging-binding" ||
			this.#phase.kind === "dragging-draft"
		) {
			this.#suppressClick = true;
			this.#suppressDoubleClickUntil =
				performance.now() + CLIENT_TUNING.inventory.doubleClickSuppressionMs;
		}
		this.#finishToIdle();
	};

	#bindingCurrent(binding: {
		readonly element: HTMLElement;
		readonly source: ActionCellAddress | BindingDragSource;
		readonly content: ActionContent;
	}): boolean {
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

	#failure(error: unknown): void {
		this.#cancel();
		this.reportFailure(`Inventory request failed: ${String(error)}`);
	}

	#cancelPointer = (event: PointerEvent): void => {
		if (
			this.#phase.kind !== "idle" &&
			this.#phase.kind !== "awaiting-release" &&
			this.#phase.pointer === event.pointerId
		) {
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
