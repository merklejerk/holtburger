import { bindingAction } from "./client-action-item";
import {
	actionDigitIndex,
	type ActionCellAddress,
	type ActionContent,
} from "./client-action-bar-state";
import type { ContentsSortMode } from "./client-container-contents";
import type { ClientEntityRead } from "./client-entity-mirror";
import type { ClientHouseCrystalState } from "./client-house-crystal-state";
import type { ClientInventoryIntent } from "./client-inventory-state";
import {
	EQUIPMENT_SLOTS,
	equipmentSlotAvailability,
} from "./client-inventory-equipment";
import type { ClientLifecycleSession } from "./client-lifecycle-session";
import type { ClientViewportTargetResult } from "./client-pointer-selection-controller";
import type { ClientSalvageState } from "./client-salvage-state";
import type { ClientTradeState } from "./client-trade-state";
import type { ClientVendorState } from "./client-vendor-state";

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
export interface ContentsSurface {
	readonly root: number;
	readonly view: ContentsDragView;
}

export interface DragSource {
	readonly item: number;
	/** Gesture origin is fixed even if authoritative rendering moves or detaches the cell. */
	readonly origin:
		| "contents"
		| "equipment"
		| "pack"
		| "main-pack"
		| "vendor"
		| ActionCellAddress;
	/** Captured surface identity prevents root replacement from retargeting a gesture. */
	readonly root: number | null;
	readonly element: HTMLElement;
}

export interface InventoryDragTarget {
	readonly kind: "inventory";
	readonly element: HTMLElement;
	readonly intent: ClientInventoryIntent;
	/** Destination context is checked again when asynchronous previews arrive. */
	readonly surface: ContentsSurface | null;
	readonly sequence: number;
}

/** Viewport resolution belongs to one exact pointer sample, never cached hover authority. */
export interface ViewportDragTarget {
	readonly kind: "viewport";
	readonly element: HTMLElement;
	readonly x: number;
	readonly y: number;
	result: ClientViewportTargetResult | null;
}

export type DragTarget =
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
			/** The queue accepts purchase offers; the catalog accepts owned sales only. */
			readonly acceptsPurchases: boolean;
	  }
	| {
			readonly kind: "action";
			readonly element: HTMLElement;
			readonly cell: ActionCellAddress;
	  };

/** Shortcut content has no inventory identity and cannot enter inventory targeting. */
export interface BindingDragSource {
	/** Current immutable draft; identity changes invalidate an active gesture. */
	readonly read: () => ActionContent | null;
	/** Successful action-cell placement discards the originating draft. */
	readonly placed: () => void;
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

export type PressedDragSource =
	| { readonly kind: "item"; readonly source: DragSource }
	| {
			readonly kind: "binding";
			readonly content: ActionContent;
			readonly element: HTMLElement;
			readonly source: ActionCellAddress | BindingDragSource;
	  }
	| {
			readonly kind: "draft";
			readonly boundary: HTMLElement;
			readonly remove: () => void;
			readonly element: HTMLElement;
	  };

export type DragFeatureAdapters = {
	readonly vendor: Pick<
		ClientVendorState,
		| "canDragOffer"
		| "acceptsDrop"
		| "acceptsSaleDrop"
		| "queueBuy"
		| "queueSell"
		| "captureRemoval"
	> | null;
	readonly salvage: Pick<
		ClientSalvageState,
		"acceptsDrop" | "add" | "captureRemoval"
	> | null;
	readonly trade: Pick<
		ClientTradeState,
		"acceptsDrop" | "add" | "reportFailure"
	> | null;
	readonly houseCrystal: Pick<
		ClientHouseCrystalState,
		"acceptsDrop" | "add" | "captureRow" | "clearRow"
	> | null;
};

export type ResolvedHitTarget =
	| { readonly kind: "none" }
	| {
			readonly kind: "immediate";
			readonly target: Exclude<
				DragTarget,
				ViewportDragTarget | InventoryDragTarget
			>;
			readonly dropState: "accepted" | "rejected";
	  }
	| { readonly kind: "viewport"; readonly element: HTMLElement }
	| {
			readonly kind: "inventory";
			readonly element: HTMLElement;
			readonly intent: ClientInventoryIntent;
	  };

/** DOM labels carry stable cell addresses independently of remappable key bindings. */
export function resolveActionCell(
	element: HTMLElement,
): ActionCellAddress | null {
	if (!element.hasAttribute("data-action-cell")) return null;
	const slot = actionDigitIndex(element.dataset.actionCell ?? "");
	const bar = Number(element.dataset.actionBar);
	if (slot === null || !Number.isSafeInteger(bar)) {
		throw new Error("Invalid action cell address");
	}
	return { bar, slot };
}

export function worldEntity(session: ItemDragSession, guid: number) {
	const read = session.entities.read();
	return read.kind === "current" ? read.level.entities.get(guid) : undefined;
}

/** Delayed previews and pointer release use current authority, independent of sampled DOM. */
export function isEquipmentAvailable(
	session: ItemDragSession,
	mask: number,
): boolean {
	const slot = EQUIPMENT_SLOTS.find((candidate) => candidate.mask === mask);
	if (slot === undefined) throw new Error("Unknown equipment strip slot");
	const read = session.entities.read();
	return (
		read.kind === "current" &&
		equipmentSlotAvailability(slot, read.level) === "available"
	);
}

/** Resolve presentation from its owner and access from the current session level. */
export function resolveContentsSurface(
	rootElement: HTMLElement,
	session: ItemDragSession,
	readContents: (root: number) => ContentsDragView | null,
	element: Element,
): ContentsSurface | null {
	const owner = element.closest<HTMLElement>("[data-contents-root]");
	if (owner === null || !owner.isConnected || !rootElement.contains(owner)) {
		return null;
	}
	const root = Number(owner.dataset.contentsRoot);
	const read = session.entities.read();
	if (
		read.kind !== "current" ||
		(read.level.playerGuid !== root &&
			(read.level.worldContainer.kind !== "open" ||
				read.level.worldContainer.root !== root))
	) {
		return null;
	}
	const view = readContents(root);
	return view === null || view.pending ? null : { root, view };
}

export function readContentsViews(
	root: HTMLElement,
	session: ItemDragSession,
	readContents: (root: number) => ContentsDragView | null,
): readonly unknown[] {
	const read = session.entities.read();
	return [
		read.kind === "current" ? read.level : null,
		...Array.from(
			root.querySelectorAll("[data-contents-root]"),
			(element) =>
				resolveContentsSurface(root, session, readContents, element)?.view,
		),
	];
}

export function canPayCrystal(
	adapters: DragFeatureAdapters,
	source: DragSource,
	crystal: number,
): boolean {
	return (
		typeof source.origin === "string" &&
		source.origin !== "vendor" &&
		adapters.houseCrystal?.acceptsDrop(crystal, source.item) === true
	);
}

/** Only owned inventory gestures can contribute to the local salvage draft. */
export function canSalvageItem(
	adapters: DragFeatureAdapters,
	source: DragSource,
): boolean {
	return (
		typeof source.origin === "string" &&
		source.origin !== "vendor" &&
		adapters.salvage?.acceptsDrop(source.item) === true
	);
}

/** Only owned inventory gestures can contribute to P2P offers. */
function canOfferTrade(
	adapters: DragFeatureAdapters,
	source: DragSource,
	partner: number,
	revision: number,
): boolean {
	return (
		typeof source.origin === "string" &&
		source.origin !== "vendor" &&
		adapters.trade?.acceptsDrop(partner, revision, source.item) === true
	);
}

/** Surface ownership is local; exact price and sale eligibility are quoted by world. */
export function canQueueVendor(
	adapters: DragFeatureAdapters,
	source: DragSource,
	target: Extract<DragTarget, { kind: "vendor" }>,
): boolean {
	const vendor = target.vendor;
	if (!adapters.vendor?.acceptsDrop(vendor)) return false;
	if (source.origin === "vendor") {
		return (
			target.acceptsPurchases &&
			source.root === vendor &&
			adapters.vendor.canDragOffer(vendor, source.item)
		);
	}
	return (
		typeof source.origin === "string" &&
		adapters.vendor.acceptsSaleDrop(vendor, source.item)
	);
}

export function resolveHitTarget(options: {
	readonly root: HTMLElement;
	readonly session: ItemDragSession;
	readonly readContents: (root: number) => ContentsDragView | null;
	readonly adapters: DragFeatureAdapters;
	readonly source: DragSource;
	readonly cursor: { readonly x: number; readonly y: number };
}): ResolvedHitTarget {
	const { root, session, readContents, adapters, source, cursor } = options;
	const hit = document.elementFromPoint(cursor.x, cursor.y);
	// Main Pack represents the character, so its gesture can only contribute page contents.
	if (
		source.origin === "main-pack" &&
		!hit?.closest(
			"[data-trade-offer], [data-vendor-queue], [data-vendor-catalog]",
		)
	) {
		return { kind: "none" };
	}

	const payment = hit?.closest<HTMLElement>("[data-housing-payment]");
	if (payment != null && root.contains(payment)) {
		const crystal = Number(payment.dataset.housingPayment);
		const wcid = Number(payment.dataset.housingWcid);
		return {
			kind: "immediate",
			target: { kind: "housing", element: payment, crystal, wcid },
			dropState: canPayCrystal(adapters, source, crystal)
				? "accepted"
				: "rejected",
		};
	}

	const salvageQueue = hit?.closest<HTMLElement>("[data-salvage-queue]");
	if (salvageQueue != null && root.contains(salvageQueue)) {
		return {
			kind: "immediate",
			target: { kind: "salvage", element: salvageQueue },
			dropState: canSalvageItem(adapters, source) ? "accepted" : "rejected",
		};
	}

	const offer = hit?.closest<HTMLElement>("[data-trade-offer]");
	if (offer != null && root.contains(offer)) {
		const partner = Number(offer.dataset.tradeOffer);
		const revision = Number(offer.dataset.tradeRevision);
		return {
			kind: "immediate",
			target: { kind: "trade", element: offer, partner, revision },
			dropState: canOfferTrade(adapters, source, partner, revision)
				? "accepted"
				: "rejected",
		};
	}

	const vendorDrop = hit?.closest<HTMLElement>(
		"[data-vendor-queue], [data-vendor-catalog]",
	);
	if (vendorDrop != null && root.contains(vendorDrop)) {
		const acceptsPurchases = vendorDrop.hasAttribute("data-vendor-queue");
		const target: Extract<DragTarget, { kind: "vendor" }> = {
			kind: "vendor",
			element: vendorDrop,
			acceptsPurchases,
			vendor: Number(
				acceptsPurchases
					? vendorDrop.dataset.vendorQueue
					: vendorDrop.dataset.vendorCatalog,
			),
		};
		return {
			kind: "immediate",
			target,
			dropState: canQueueVendor(adapters, source, target)
				? "accepted"
				: "rejected",
		};
	}

	if (source.origin === "vendor") return { kind: "none" };

	const actionElement = hit?.closest<HTMLElement>("[data-action-cell]");
	const cellAddress =
		actionElement != null && root.contains(actionElement)
			? resolveActionCell(actionElement)
			: null;
	if (cellAddress !== null && actionElement != null) {
		const bindable =
			typeof source.origin !== "string" ||
			bindingAction(worldEntity(session, source.item)) !== null;
		return {
			kind: "immediate",
			target: { kind: "action", element: actionElement, cell: cellAddress },
			dropState: bindable ? "accepted" : "rejected",
		};
	}

	if (
		typeof source.origin !== "string" ||
		hit === null ||
		!root.contains(hit)
	) {
		return { kind: "none" };
	}

	const sourceFacts = worldEntity(session, source.item);
	const surface = resolveContentsSurface(root, session, readContents, hit);
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
		sourceFacts?.ownedByPlayer
	) {
		return { kind: "viewport", element: hit };
	}
	if (equipment !== null && sourceFacts?.ownedByPlayer) {
		// Slot activation is independent of item coverage; locked/pending rows
		// must not advertise an accepted drop or submit an equipment request.
		const mask = Number(equipment.dataset.equipmentSlot);
		if (!isEquipmentAvailable(session, mask)) return { kind: "none" };
		return {
			kind: "inventory",
			element: equipment,
			intent: { item: source.item, target: { kind: "equipment", mask } },
		};
	}
	if (surface !== null && header !== null) {
		return {
			kind: "inventory",
			element: header,
			intent: {
				item: source.item,
				target: { kind: "container", guid: Number(header.dataset.itemGuid) },
			},
		};
	}
	if (surface !== null && cell !== null) {
		const guid = Number(cell.dataset.itemGuid);
		if (cell.closest(".contents-packs")) {
			// Only rearranging carried pack-strip entries uses the two-command swap.
			const read = session.entities.read();
			const carriedSwap =
				source.origin === "pack" &&
				sourceFacts?.ownedByPlayer &&
				read.kind === "current" &&
				surface.root === read.level.playerGuid;
			return {
				kind: "inventory",
				element: cell,
				intent: {
					item: source.item,
					target: { kind: carriedSwap ? "pack" : "container", guid },
				},
			};
		}
		const container = cell.closest<HTMLElement>("[data-container-guid]");
		const target: ClientInventoryIntent["target"] =
			surface.view.sortMode !== "native" &&
			source.origin === "equipment" &&
			container !== null
				? { kind: "container", guid: Number(container.dataset.containerGuid) }
				: {
						kind: surface.view.sortMode === "native" ? "item" : "stack",
						guid,
					};
		return {
			kind: "inventory",
			element: cell,
			intent: { item: source.item, target },
		};
	}
	if (surface !== null && hit.closest(".item-grid-cell") === null) {
		// Section background uses automatic insertion regardless of display sorting.
		// Disabled item cells still own their footprint; they must not become background targets.
		const section = hit.closest<HTMLElement>(
			".contents-scroll [data-container-guid]",
		);
		if (section !== null) {
			return {
				kind: "inventory",
				element: section,
				intent: {
					item: source.item,
					target: {
						kind: "container",
						guid: Number(section.dataset.containerGuid),
					},
				},
			};
		}
	}
	return { kind: "none" };
}

/** Resolve whichever binding, draft, vendor offer, or inventory item owns the pressed target. */
export function resolvePressedSource(options: {
	readonly targetNode: Element;
	readonly root: HTMLElement;
	readonly session: ItemDragSession;
	readonly readContents: (root: number) => ContentsDragView | null;
	readonly bindings: ActionDragBindings;
	readonly bindingSources: ReadonlyMap<HTMLElement, BindingDragSource>;
	readonly adapters: DragFeatureAdapters;
}): PressedDragSource | null {
	const {
		targetNode,
		root,
		session,
		readContents,
		bindings,
		bindingSources,
		adapters,
	} = options;

	const bindingElement = targetNode.closest<HTMLElement>(
		"[data-binding-source], [data-action-cell]:not([data-empty='true'])",
	);
	if (bindingElement !== null && root.contains(bindingElement)) {
		const cell = resolveActionCell(bindingElement);
		const registered = bindingSources.get(bindingElement);
		const content = cell === null ? registered?.read() : bindings.read(cell);
		const source = cell ?? registered;
		if (content?.kind === "loadout" && source !== undefined) {
			return {
				kind: "binding",
				content,
				element: bindingElement,
				source,
			};
		}
	}

	const queuedVendor = targetNode.closest<HTMLElement>(
		"[data-vendor-queue-key]",
	);
	if (queuedVendor !== null && root.contains(queuedVendor)) {
		const boundary = queuedVendor.closest<HTMLElement>("[data-vendor-queue]");
		const key = queuedVendor.getAttribute("data-vendor-queue-key");
		if (boundary === null || key === null) return null;
		const remove = adapters.vendor?.captureRemoval(key);
		if (remove == null) return null;
		return { kind: "draft", boundary, remove, element: queuedVendor };
	}

	const queuedSalvage = targetNode.closest<HTMLElement>("[data-salvage-item]");
	if (queuedSalvage !== null && root.contains(queuedSalvage)) {
		const boundary = queuedSalvage.closest<HTMLElement>("[data-salvage-queue]");
		const remove = adapters.salvage?.captureRemoval(
			Number(queuedSalvage.dataset.salvageItem),
		);
		if (boundary === null || remove == null) return null;
		return { kind: "draft", boundary, remove, element: queuedSalvage };
	}

	const requirement = targetNode.closest<HTMLElement>(
		"[data-housing-payment] .item-grid-cell",
	);
	if (requirement !== null && root.contains(requirement)) {
		const row = requirement.closest<HTMLElement>("[data-housing-wcid]");
		if (row === null) return null;
		const identity = adapters.houseCrystal?.captureRow(
			Number(row.dataset.housingWcid),
		);
		if (identity == null) return null;
		return {
			kind: "draft",
			boundary: requirement,
			remove: () => adapters.houseCrystal?.clearRow(identity),
			element: requirement,
		};
	}

	const offer = targetNode.closest<HTMLElement>(
		"[data-vendor-offer]:not(:disabled)",
	);
	if (offer !== null && root.contains(offer)) {
		const item = Number(offer.dataset.vendorOffer);
		const vendor = Number(offer.dataset.vendorGuid);
		if (!adapters.vendor?.canDragOffer(vendor, item)) return null;
		return {
			kind: "item",
			source: { item, origin: "vendor", root: vendor, element: offer },
		};
	}

	const element = targetNode.closest<HTMLElement>(
		".item-grid-cell[data-item-guid]:not(:disabled), .contents-header[data-item-guid]:not(:disabled), [data-action-cell][data-action-item]",
	);
	if (element === null || !root.contains(element)) return null;
	const read = session.entities.read();
	if (read.kind !== "current") return null;
	const actionCell = resolveActionCell(element);
	const surface = resolveContentsSurface(root, session, readContents, element);
	if (
		actionCell === null &&
		surface === null &&
		element.closest(".equipment-row") === null
	) {
		return null;
	}
	const bound = actionCell === null ? null : bindings.read(actionCell);
	if (bound?.kind === "loadout") return null;
	if (actionCell !== null && bound === null) return null;
	const item = bound === null ? Number(element.dataset.itemGuid) : bound.item;
	const origin =
		actionCell !== null
			? actionCell
			: surface?.root === item && item === read.level.playerGuid
				? "main-pack"
				: element.closest(".contents-packs") !== null
					? "pack"
					: element.closest(".equipment-row") !== null
						? "equipment"
						: "contents";
	if (actionCell === null) {
		const facts = worldEntity(session, item);
		if (
			facts?.description.kind !== "known" ||
			!(
				facts.ownedByPlayer ||
				facts.worldContainerContent ||
				origin === "main-pack"
			)
		) {
			return null;
		}
		if (surface?.root === item && origin !== "main-pack") return null;
		if (
			origin === "pack" &&
			(facts.location.kind !== "contained" ||
				facts.location.slot.kind !== "pack" ||
				facts.location.slot.entryKind !== "container")
		) {
			return null;
		}
	}
	return {
		kind: "item",
		source: { item, origin, element, root: surface?.root ?? null },
	};
}
