import { afterEach, describe, expect, it, vi } from "vitest";
import { entityFacts } from "./client-entity-mirror.test-support";
import { ClientItemDrag, type ItemDragSession } from "./client-item-drag";
import { CLIENT_TUNING } from "./client-tuning";

class FakeDOMElement {
	tagName = "div";
	dataset: Record<string, string> = {};
	hidden = false;
	isConnected = true;
	attributes: Record<string, string> = {};
	children: FakeDOMElement[] = [];
	parent: FakeDOMElement | null = null;
	className = "";
	popover = "";
	textContent = "";
	scrollTop = 0;
	style: Record<string, string> = {};
	readonly #listeners = new Map<string, Set<(event: unknown) => void>>();
	readonly #matcher?: (selector: string, el: FakeDOMElement) => boolean;

	constructor(
		tagName = "div",
		matcher?: (selector: string, el: FakeDOMElement) => boolean,
	) {
		this.tagName = tagName;
		this.#matcher = matcher;
	}

	closest(selector: string): FakeDOMElement | null {
		if (this.matches(selector)) return this;
		return this.parent?.closest(selector) ?? null;
	}

	matches(selector: string): boolean {
		return this.#matcher ? this.#matcher(selector, this) : false;
	}

	querySelector(selector: string): FakeDOMElement | null {
		return this.querySelectorAll(selector)[0] ?? null;
	}

	querySelectorAll(selector: string): FakeDOMElement[] {
		const results: FakeDOMElement[] = [];
		const walk = (node: FakeDOMElement) => {
			for (const child of node.children) {
				if (child.matches(selector)) results.push(child);
				walk(child);
			}
		};
		walk(this);
		return results;
	}

	contains(node: unknown): boolean {
		if (node === this) return true;
		return this.children.some((child) => child.contains(node));
	}

	append(...nodes: FakeDOMElement[]): void {
		for (const node of nodes) {
			node.parent = this;
			this.children.push(node);
		}
	}

	replaceChildren(): void {}

	remove(): void {
		if (this.parent !== null) {
			this.parent.children = this.parent.children.filter((c) => c !== this);
			this.parent = null;
		}
	}

	showPopover(): void {}
	hidePopover(): void {}

	getAttribute(name: string): string | null {
		return this.attributes[name] ?? null;
	}

	setAttribute(name: string, value: string): void {
		this.attributes[name] = value;
	}

	hasAttribute(name: string): boolean {
		return name in this.attributes;
	}

	addEventListener(
		type: string,
		listener: (event: unknown) => void,
		options?: { signal?: AbortSignal; capture?: boolean },
	): void {
		let set = this.#listeners.get(type);
		if (!set) {
			set = new Set();
			this.#listeners.set(type, set);
		}
		set.add(listener);
		options?.signal?.addEventListener("abort", () => set.delete(listener), {
			once: true,
		});
	}

	getBoundingClientRect(): {
		top: number;
		bottom: number;
		width: number;
		height: number;
	} {
		return { top: 0, bottom: 100, width: 32, height: 32 };
	}

	dispatch(type: string, event: unknown): void {
		for (const fn of this.#listeners.get(type) ?? []) fn(event);
	}
}

function makeFakeElement(
	tagName = "div",
	matcher?: (selector: string, el: FakeDOMElement) => boolean,
): FakeDOMElement {
	return new FakeDOMElement(tagName, matcher);
}

function dispatchFake(
	target: FakeDOMElement,
	type: string,
	event: unknown,
): void {
	target.dispatch(type, event);
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("ClientItemDrag", () => {
	it("runs polling timer only during active dragging-item and retires dragging visuals on async release", () => {
		vi.useFakeTimers();

		const windowListeners = new Map<string, Set<(event: unknown) => void>>();
		const fakeWindow = {
			addEventListener(
				type: string,
				listener: (event: unknown) => void,
				options?: { signal?: AbortSignal },
			) {
				let set = windowListeners.get(type);
				if (!set) {
					set = new Set();
					windowListeners.set(type, set);
				}
				set.add(listener);
				options?.signal?.addEventListener("abort", () => set.delete(listener), {
					once: true,
				});
			},
		};
		const emitWindow = (type: string, event: unknown) => {
			for (const fn of windowListeners.get(type) ?? []) fn(event);
		};

		let currentHit: FakeDOMElement | null = null;
		const root = makeFakeElement("div");
		const contentsRoot = makeFakeElement("div", (s) =>
			s.includes("[data-contents-root]"),
		);
		contentsRoot.dataset.contentsRoot = "1";
		const sourceCell = makeFakeElement(
			"button",
			(s, e) =>
				s.startsWith(".item-grid-cell") ||
				(s.includes("[data-inventory-drop]") && "inventoryDrop" in e.dataset),
		);
		sourceCell.dataset.itemGuid = "10";
		sourceCell.attributes["aria-label"] = "Health Potion";
		const targetCell = makeFakeElement(
			"button",
			(s, e) =>
				s.startsWith(".item-grid-cell") ||
				(s.includes("[data-inventory-drop]") && "inventoryDrop" in e.dataset),
		);
		targetCell.dataset.itemGuid = "11";
		contentsRoot.append(sourceCell, targetCell);
		root.append(contentsRoot);

		vi.stubGlobal("window", fakeWindow);
		vi.stubGlobal("Element", FakeDOMElement);
		vi.stubGlobal("HTMLElement", FakeDOMElement);
		vi.stubGlobal("requestAnimationFrame", () => 1);
		vi.stubGlobal("cancelAnimationFrame", () => {});
		vi.stubGlobal("document", {
			createElement: (tag: string) =>
				makeFakeElement(tag, (s) => s.includes(".ui-drag-ghost")),
			elementFromPoint: () => currentHit,
		});

		const listeners = new Set<(event: unknown) => void>();
		const previewRequests: number[] = [];
		const submitInventory = vi.fn().mockResolvedValue(undefined);
		const session: ItemDragSession = {
			state: () => ({ lifecycle: { kind: "in-world" } }) as never,
			entities: {
				read: () => ({
					kind: "current",
					level: {
						revision: 1,
						playerGuid: 1,
						worldContainer: { kind: "closed" },
						projectileSupply: { kind: "not-applicable" },
						player: {} as never,
						entities: new Map([
							[
								10,
								entityFacts(10, {
									ownedByPlayer: true,
									description: {
										kind: "known",
										name: "Health Potion",
										healthQuery: "ineligible",
										itemType: 0,
										hasAlternateEquipSide: false,
										builtInSpell: null,
										mapCategory: "other",
										objectFlags: 0,
										wcid: null,
										equipLocations: null,
										consumable: null,
										useCapability: "direct",
										cooldown: null,
										stackCount: null,
										structure: { current: null, max: null },
										icon: {
											base: null,
											overlay: null,
											underlay: null,
											uiEffects: 0,
										},
										equipmentCantrip: null,
									},
								}),
							],
							[11, entityFacts(11, { ownedByPlayer: true })],
						]),
					},
				}),
			},
			previewInventory: vi.fn(async (req) => {
				previewRequests.push(req.sequence);
			}),
			submitInventory,
			applyEquipmentSet: vi.fn(),
			subscribe: (listener) => {
				listeners.add(listener as (event: unknown) => void);
				return () => listeners.delete(listener as (event: unknown) => void);
			},
		};

		const drag = new ClientItemDrag(
			root as unknown as HTMLElement,
			session,
			() => ({ pending: false, sortMode: "native" }),
			() => {},
			{ read: () => null, bind: () => {}, transfer: () => {} },
			() => false,
			() => {},
			() => {},
			() => {},
			null,
			null,
			null,
			null,
			() => {},
		);

		// Idle: zero polling timers allocated.
		expect(vi.getTimerCount()).toBe(0);
		expect(drag.cancel()).toBe(false);

		// Press: still zero polling timers.
		dispatchFake(root, "pointerdown", {
			button: 0,
			isPrimary: true,
			pointerId: 1,
			clientX: 10,
			clientY: 10,
			target: sourceCell,
			stopPropagation: () => {},
		});
		expect(vi.getTimerCount()).toBe(0);

		// Cross threshold -> dragging-item starts polling timer and sets itemDragging.
		currentHit = targetCell;
		emitWindow("pointermove", {
			pointerId: 1,
			clientX: 10 + CLIENT_TUNING.inventory.dragThresholdCssPixels + 5,
			clientY: 10,
			preventDefault: () => {},
			stopPropagation: () => {},
		});
		expect(vi.getTimerCount()).toBe(1);
		expect(root.dataset.itemDragging).toBe("true");
		expect(targetCell.dataset.inventoryDrop).toBe("pending");

		// Release over target -> awaiting-release stops polling timer and retires itemDragging,
		// while preserving targetCell pending highlight until preview resolves.
		emitWindow("pointerup", {
			pointerId: 1,
			clientX: 10 + CLIENT_TUNING.inventory.dragThresholdCssPixels + 5,
			clientY: 10,
			preventDefault: () => {},
			stopPropagation: () => {},
		});
		expect(vi.getTimerCount()).toBe(0);
		expect(root.dataset.itemDragging).toBeUndefined();
		expect(targetCell.dataset.inventoryDrop).toBe("pending");

		// Preview result completes awaiting-release -> idle, clearing highlights and submitting.
		const sequence = previewRequests.at(-1);
		for (const listener of listeners) {
			listener({
				type: "inventory-preview",
				result: { sequence, preview: { kind: "move" } },
			});
		}
		expect(targetCell.dataset.inventoryDrop).toBeUndefined();
		expect(submitInventory).toHaveBeenCalledOnce();

		drag.destroy();
		expect(vi.getTimerCount()).toBe(0);
	});
});
