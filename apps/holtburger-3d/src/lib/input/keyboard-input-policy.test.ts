import { describe, expect, it, vi } from "vitest";
import { KeyboardInputPolicy } from "./keyboard-input-policy";
import { ViewportInputGate } from "./viewport-input-gate";

/** Node supplies Event; the keyboard fields are explicit test inputs. */
function keyEvent(key: string, repeat = false): KeyboardEvent {
	return Object.assign(new Event("keydown", { cancelable: true }), {
		key,
		code: key,
		repeat,
		isComposing: false,
	}) as KeyboardEvent;
}

function fixture() {
	const viewport = new ViewportInputGate();
	const keyboard = new KeyboardInputPolicy(viewport);
	const game = { keydown: vi.fn(), keyup: vi.fn(), cancel: vi.fn() };
	const detach = keyboard.bindGame(game);
	return { viewport, keyboard, game, detach };
}

describe("game keyboard routing", () => {
	it("dismisses a hint before routing a fresh Escape, without draining on repeat", () => {
		const { keyboard, game } = fixture();
		const dismiss = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
		const retire = keyboard.bindHintDismissal(dismiss);
		keyboard.keydown(keyEvent("Escape"));
		keyboard.keydown(keyEvent("Escape", true));
		expect(dismiss).toHaveBeenCalledOnce();
		expect(game.keydown).not.toHaveBeenCalled();
		keyboard.keyup(keyEvent("Escape"));
		keyboard.keydown(keyEvent("Escape"));
		expect(game.keydown).toHaveBeenCalledOnce();
		retire();
		keyboard.keydown(keyEvent("Escape"));
		expect(dismiss).toHaveBeenCalledTimes(2);
	});

	it("keeps gesture cancellation ahead of hints and enforces one hint owner", () => {
		const { keyboard } = fixture();
		const dismiss = vi.fn(() => true);
		const retire = keyboard.bindHintDismissal(dismiss);
		expect(() => keyboard.bindHintDismissal(dismiss)).toThrow(
			"already registered",
		);
		keyboard.bindEscapeCancellation(() => true);
		keyboard.keydown(keyEvent("Escape"));
		expect(dismiss).not.toHaveBeenCalled();
		retire();
		const replacement = keyboard.bindHintDismissal(dismiss);
		retire();
		expect(() => keyboard.bindHintDismissal(dismiss)).toThrow(
			"already registered",
		);
		replacement();
	});
	it("routes unhandled keys and repeats to the foreground page and restores the previous page on teardown", () => {
		const { keyboard } = fixture();
		const element = () =>
			({ isConnected: true, closest: () => null }) as unknown as HTMLElement;
		const firstAction = vi.fn();
		const secondAction = vi.fn((event: KeyboardEvent) =>
			event.preventDefault(),
		);
		const first = keyboard.nativePage(element(), firstAction);
		const second = keyboard.nativePage(element(), secondAction);
		keyboard.keydown(keyEvent("Enter"));
		keyboard.keydown(keyEvent("Enter", true));
		expect(secondAction).toHaveBeenCalledTimes(2);
		expect(firstAction).not.toHaveBeenCalled();
		keyboard.keyup(keyEvent("Enter"));
		second.destroy();
		keyboard.keydown(keyEvent("Enter"));
		expect(firstAction).toHaveBeenCalledOnce();
		// A native press must still reach page policy on repeat so it can suppress resubmission.
		keyboard.keydown(keyEvent("Enter", true));
		expect(firstAction).toHaveBeenCalledTimes(2);
		first.destroy();
	});

	it("allows initial Tab and Shift+Tab on a native page, then restores gameplay suppression on teardown", () => {
		const { keyboard, game } = fixture();
		const page = keyboard.nativePage({
			isConnected: true,
			closest: () => null,
		} as unknown as HTMLElement);
		expect(keyboard.gameActive).toBe(false);
		for (const shiftKey of [false, true]) {
			const tab = Object.assign(keyEvent("Tab"), { shiftKey });
			keyboard.keydown(tab);
			expect(tab.defaultPrevented).toBe(false);
			keyboard.keyup(tab);
		}
		keyboard.keydown(keyEvent("KeyW"));
		expect(game.keydown).not.toHaveBeenCalled();
		page.destroy();
		keyboard.keyup(keyEvent("KeyW"));
		expect(game.keyup).not.toHaveBeenCalled();
		expect(keyboard.gameActive).toBe(true);
		const gameTab = keyEvent("Tab");
		keyboard.keydown(gameTab);
		expect(gameTab.defaultPrevented).toBe(true);
		expect(game.keydown).toHaveBeenCalledOnce();
	});
	it("cancels held game keys when a native page appears without sending their releases to it or back to gameplay", () => {
		const { keyboard, game } = fixture();
		keyboard.keydown(keyEvent("KeyW"));
		const page = keyboard.nativePage({
			isConnected: true,
			closest: () => null,
		} as unknown as HTMLElement);
		expect(game.cancel).toHaveBeenCalledOnce();
		keyboard.keydown(keyEvent("KeyW", true));
		keyboard.keyup(keyEvent("KeyW"));
		expect(game.keydown).toHaveBeenCalledOnce();
		expect(game.keyup).not.toHaveBeenCalled();
		page.destroy();
	});
	it("keeps native navigation effective until all overlapping page lifetimes retire", () => {
		const { keyboard } = fixture();
		const first = keyboard.nativePage({
			isConnected: true,
			closest: () => null,
		} as unknown as HTMLElement);
		const second = keyboard.nativePage({
			isConnected: true,
			closest: () => null,
		} as unknown as HTMLElement);
		first.destroy();
		const nativeTab = keyEvent("Tab");
		keyboard.keydown(nativeTab);
		expect(nativeTab.defaultPrevented).toBe(false);
		second.destroy();
		const gameTab = keyEvent("Tab");
		keyboard.keydown(gameTab);
		expect(gameTab.defaultPrevented).toBe(true);
	});
	it("does not prepare activation state for a detached scope", () => {
		const { keyboard } = fixture();
		const activation = vi.fn(() => true);
		const scope = keyboard.scope({ isConnected: false } as HTMLElement, {
			activation,
			keydown: vi.fn(),
		});
		keyboard.keydown(keyEvent("F8"));
		expect(activation).not.toHaveBeenCalled();
		scope.destroy();
	});

	it("ends a held UI lifetime after ownership cancellation without releasing a game action", () => {
		const { keyboard, game } = fixture();
		const press = keyEvent("KeyT");
		keyboard.keydown(press);
		const released = vi.fn();
		keyboard.bindKeyRelease(press, released);
		keyboard.cancel();
		keyboard.keyup(keyEvent("KeyW"));
		expect(released).not.toHaveBeenCalled();
		keyboard.keyup(Object.assign(keyEvent("KeyT"), { shiftKey: true }));
		keyboard.keyup(keyEvent("KeyT"));
		expect(released).toHaveBeenCalledOnce();
		expect(game.keyup).not.toHaveBeenCalled();
	});
	it("retires a release observation when selection already ended its interaction", () => {
		const { keyboard } = fixture();
		const press = keyEvent("KeyT");
		keyboard.keydown(press);
		const oldRelease = vi.fn();
		const detach = keyboard.bindKeyRelease(press, oldRelease);
		detach();
		const replacement = vi.fn();
		keyboard.bindKeyRelease(press, replacement);
		// Retiring an earlier lifetime must not erase its replacement.
		detach();
		keyboard.cancel();
		keyboard.keyup(press);
		expect(oldRelease).not.toHaveBeenCalled();
		expect(replacement).toHaveBeenCalledOnce();
	});
	it("offers Escape to the active item gesture before game commands", () => {
		const { keyboard, game } = fixture();
		const cancel = vi.fn(() => true);
		const release = keyboard.bindEscapeCancellation(cancel);
		const event = keyEvent("Escape");
		keyboard.keydown(event);
		expect(cancel).toHaveBeenCalledOnce();
		expect(event.defaultPrevented).toBe(true);
		expect(game.keydown).not.toHaveBeenCalled();
		release();
		keyboard.keydown(keyEvent("Escape"));
		expect(game.keydown).toHaveBeenCalledOnce();
	});

	it("cancels promoted app contexts in recency order without draining on repeat", () => {
		const { keyboard, game } = fixture();
		const cancelled: string[] = [];
		const inventory = keyboard.bindEscapeContext(() =>
			cancelled.push("inventory"),
		);
		keyboard.bindEscapeContext(() => cancelled.push("attack"));
		inventory.promote();

		keyboard.keydown(keyEvent("Escape"));
		keyboard.keydown(keyEvent("Escape", true));
		expect(cancelled).toEqual(["inventory"]);
		expect(game.keydown).not.toHaveBeenCalled();

		keyboard.keyup(keyEvent("Escape"));
		keyboard.keydown(keyEvent("Escape"));
		expect(cancelled).toEqual(["inventory", "attack"]);
		expect(game.keydown).not.toHaveBeenCalled();
	});

	it("removes released contexts and lets dismissed contexts be promoted again", () => {
		const { keyboard } = fixture();
		const cancelled: string[] = [];
		const retained = keyboard.bindEscapeContext(() =>
			cancelled.push("retained"),
		);
		const released = keyboard.bindEscapeContext(() =>
			cancelled.push("released"),
		);
		released.release();

		keyboard.keydown(keyEvent("Escape"));
		retained.promote();
		keyboard.keydown(keyEvent("Escape"));
		expect(cancelled).toEqual(["retained", "retained"]);
	});

	it("publishes visual order from the same promotions and removals as Escape", () => {
		const { keyboard } = fixture();
		const inventoryOrder = vi.fn();
		const inspectionOrder = vi.fn();
		const closeInventory = vi.fn();
		const stopAttack = vi.fn();
		const inventory = keyboard.bindEscapeContext(closeInventory, {
			onOrder: inventoryOrder,
		});
		const attack = keyboard.bindEscapeContext(stopAttack);
		const inspection = keyboard.bindEscapeContext(vi.fn(), {
			onOrder: inspectionOrder,
		});
		expect(inventoryOrder).toHaveBeenLastCalledWith(0);
		expect(inspectionOrder).toHaveBeenLastCalledWith(1);
		inventory.promote();
		expect(inventoryOrder).toHaveBeenLastCalledWith(1);
		expect(inspectionOrder).toHaveBeenLastCalledWith(0);
		attack.promote();
		expect(inventoryOrder).toHaveBeenLastCalledWith(1);
		inspection.release();
		expect(inventoryOrder).toHaveBeenLastCalledWith(0);
		inventory.release();
		inventory.promote();
		keyboard.keydown(keyEvent("Escape"));
		keyboard.keydown(keyEvent("Escape"));
		// Permanently released windows cannot be resurrected by a stale callback.
		expect(closeInventory).not.toHaveBeenCalled();
		expect(stopAttack).toHaveBeenCalledOnce();
	});

	it("suppresses repeats before gesture cancellation even when ownership stays in game", () => {
		const { keyboard, game } = fixture();
		const gesture = vi.fn(() => true);
		const window = vi.fn();
		keyboard.bindEscapeCancellation(gesture);
		keyboard.bindEscapeContext(window);
		keyboard.keydown(keyEvent("Escape"));
		keyboard.keydown(keyEvent("Escape", true));
		expect(gesture).toHaveBeenCalledOnce();
		expect(window).not.toHaveBeenCalled();
		expect(game.keydown).not.toHaveBeenCalled();
	});

	it("keeps UI Escape contexts available while world controls are blocked", () => {
		const { keyboard, viewport, game } = fixture();
		const cancel = vi.fn();
		keyboard.bindEscapeContext(cancel);
		viewport.block();
		keyboard.keydown(keyEvent("Escape"));
		keyboard.keydown(keyEvent("Escape", true));
		expect(cancel).toHaveBeenCalledOnce();
		expect(game.keydown).not.toHaveBeenCalled();
	});

	it("routes app shortcuts independently of world controls and quarantines consumed releases", () => {
		const { keyboard, viewport, game } = fixture();
		const shortcut = vi.fn((event: KeyboardEvent) => event.preventDefault());
		const retire = keyboard.bindShortcuts(shortcut);
		expect(() => keyboard.bindShortcuts(shortcut)).toThrow(
			"already registered",
		);
		const reveal = viewport.block();
		keyboard.keydown(keyEvent("KeyB"));
		expect(shortcut).toHaveBeenCalledOnce();
		reveal();
		keyboard.keyup(keyEvent("KeyB"));
		expect(game.keyup).not.toHaveBeenCalled();
		retire();
		const replacement = keyboard.bindShortcuts(shortcut);
		retire();
		keyboard.keydown(keyEvent("KeyB"));
		expect(shortcut).toHaveBeenCalledTimes(2);
		expect(game.keydown).not.toHaveBeenCalled();
		replacement();
		keyboard.keydown(keyEvent("KeyB"));
		expect(game.keydown).toHaveBeenCalledOnce();
	});

	it("preserves editor input and held UI releases across world suspension and consumer replacement", () => {
		const { keyboard, viewport, game, detach } = fixture();
		const shortcut = vi.fn();
		keyboard.bindShortcuts(shortcut);
		const keydown = vi.fn();
		const keyup = vi.fn();
		const cancel = vi.fn();
		const editor = {
			isConnected: true,
			isContentEditable: true,
			parentElement: null,
			closest: () => null,
			focus: vi.fn(),
		} as unknown as HTMLElement;
		keyboard.scope(editor, {
			activation: (event) => event.key === "Enter",
			keydown,
			keyup,
			cancel,
		});
		const reveal = viewport.block();
		keyboard.keydown(keyEvent("Enter"));
		expect(editor.focus).toHaveBeenCalledOnce();
		keyboard.keyup(keyEvent("Enter"));
		keyboard.keydown(keyEvent("KeyA"));
		const release = vi.fn();
		keyboard.bindKeyRelease(keyEvent("KeyA"), release);
		const before = cancel.mock.calls.length;
		viewport.cancel("reset");
		detach();
		keyboard.bindGame(game);
		expect(cancel).toHaveBeenCalledTimes(before);
		keyboard.keyup(keyEvent("KeyA"));
		expect(release).toHaveBeenCalledOnce();
		expect(keyup).toHaveBeenCalledOnce();
		expect(shortcut).not.toHaveBeenCalled();
		reveal();
		keyboard.keydown(keyEvent("KeyB"));
		expect(keydown).toHaveBeenCalledTimes(2);
		expect(game.keydown).not.toHaveBeenCalled();
	});

	it("keeps foreground pages ahead of app shortcuts during recovery", () => {
		const { keyboard, viewport } = fixture();
		const shortcut = vi.fn();
		keyboard.bindShortcuts(shortcut);
		viewport.block();
		const page = keyboard.nativePage({
			isConnected: true,
			closest: () => null,
		} as unknown as HTMLElement);
		keyboard.keydown(keyEvent("KeyB"));
		expect(shortcut).not.toHaveBeenCalled();
		page.destroy();
	});

	it("cancels without release actions and rejects repeats across scene availability", () => {
		const { viewport, keyboard, game } = fixture();
		keyboard.keydown(keyEvent("Space"));
		const reveal = viewport.block();
		expect(game.cancel).toHaveBeenCalledOnce();
		reveal();
		keyboard.keydown(keyEvent("Space", true));
		keyboard.keyup(keyEvent("Space"));
		expect(game.keydown).toHaveBeenCalledTimes(1);
		expect(game.keyup).not.toHaveBeenCalled();
		keyboard.keydown(keyEvent("Space"));
		keyboard.keyup(keyEvent("Space"));
		expect(game.keydown).toHaveBeenCalledTimes(2);
		expect(game.keyup).toHaveBeenCalledOnce();
	});

	it("does not replay releases into a replacement consumer", () => {
		const { keyboard, game, detach } = fixture();
		keyboard.keydown(keyEvent("KeyW"));
		detach();
		const next = { keydown: vi.fn(), keyup: vi.fn(), cancel: vi.fn() };
		keyboard.bindGame(next);
		keyboard.keyup(keyEvent("KeyW"));
		expect(game.cancel).toHaveBeenCalledOnce();
		expect(next.keyup).not.toHaveBeenCalled();
	});

	it("quarantines keys pressed before a game consumer was installed", () => {
		const { keyboard, detach } = fixture();
		detach();
		keyboard.keydown(keyEvent("KeyW"));
		const next = { keydown: vi.fn(), keyup: vi.fn(), cancel: vi.fn() };
		keyboard.bindGame(next);
		keyboard.keydown(keyEvent("KeyW", true));
		keyboard.keyup(keyEvent("KeyW"));
		expect(next.keydown).not.toHaveBeenCalled();
		expect(next.keyup).not.toHaveBeenCalled();
	});

	it("accepts a fresh press when window focus hid an earlier key release", () => {
		const { keyboard, viewport, game } = fixture();
		keyboard.keydown(keyEvent("KeyW"));
		viewport.cancel("release-held");
		keyboard.keydown(keyEvent("KeyW", true));
		keyboard.keydown(keyEvent("KeyW"));
		expect(game.keydown).toHaveBeenCalledTimes(2);
	});

	it("keeps independent availability blockers effective and ignores orphan releases", () => {
		const { keyboard, viewport, game } = fixture();
		const scene = viewport.block();
		const modal = viewport.block();
		scene();
		keyboard.keydown(keyEvent("KeyW"));
		keyboard.keyup(keyEvent("KeyW"));
		expect(game.keydown).not.toHaveBeenCalled();
		expect(game.keyup).not.toHaveBeenCalled();
		keyboard.keydown(keyEvent("KeyS"));
		modal();
		keyboard.keyup(keyEvent("KeyS"));
		keyboard.keyup(keyEvent("KeyA"));
		expect(game.keyup).not.toHaveBeenCalled();
	});

	it("suppresses Tab traversal and leaves composing input out of game bindings", () => {
		const { keyboard, game } = fixture();
		game.keydown.mockImplementation((event: KeyboardEvent) => {
			expect(event.defaultPrevented).toBe(false);
		});
		const tab = keyEvent("Tab");
		keyboard.keydown(tab);
		expect(tab.defaultPrevented).toBe(true);
		const composing = Object.assign(keyEvent("KeyW"), { isComposing: true });
		keyboard.keydown(composing);
		const repeat = Object.assign(keyEvent("KeyW", true), { isComposing: true });
		keyboard.keydown(repeat);
		keyboard.keyup(keyEvent("KeyW"));
		expect(composing.defaultPrevented).toBe(false);
		expect(repeat.defaultPrevented).toBe(false);
		expect(game.keydown).toHaveBeenCalledTimes(1);
		expect(game.keyup).not.toHaveBeenCalled();
	});

	it("rejects a missing dialog focus target before opening or acquiring modality", () => {
		const { keyboard, viewport, game } = fixture();
		const dialog = {
			querySelector: vi.fn(() => null),
			showModal: vi.fn(),
		} as unknown as HTMLDialogElement;
		expect(() => keyboard.modal(dialog, "input")).toThrow(
			"Dialog initial focus target is missing",
		);
		expect(dialog.showModal).not.toHaveBeenCalled();
		expect(viewport.allowed).toBe(true);
		keyboard.keydown(keyEvent("KeyW"));
		expect(game.keydown).toHaveBeenCalledOnce();
	});

	it("releases modal admission when the outgoing UI cancellation fails", () => {
		const { keyboard, viewport } = fixture();
		const editor = {
			isConnected: true,
			isContentEditable: true,
			parentElement: null,
			closest: () => null,
			focus: vi.fn(),
		} as unknown as HTMLElement;
		keyboard.scope(editor, {
			keydown: vi.fn(),
			cancel: () => {
				throw new Error("Outgoing UI cancellation failed.");
			},
		});
		keyboard.activate(editor);
		const dialog = { showModal: vi.fn() } as unknown as HTMLDialogElement;

		expect(() => keyboard.modal(dialog)).toThrow(
			"Outgoing UI cancellation failed.",
		);
		expect(dialog.showModal).not.toHaveBeenCalled();
		expect(keyboard.activeModal).toBeNull();
		expect(viewport.allowed).toBe(true);
	});

	it.each(["release-held", "reset"] as const)(
		"forwards %s cancellation and quarantines stale releases",
		(mode) => {
			const { keyboard, viewport, game } = fixture();
			keyboard.keydown(keyEvent("KeyW"));
			viewport.cancel(mode);
			expect(game.cancel).toHaveBeenCalledExactlyOnceWith(mode);
			keyboard.keydown(keyEvent("KeyW", true));
			keyboard.keyup(keyEvent("KeyW"));
			expect(game.keydown).toHaveBeenCalledOnce();
			expect(game.keyup).not.toHaveBeenCalled();
		},
	);
});

it("keeps a server-delayed window ahead of gameplay until its owner releases it", () => {
	const { keyboard, game } = fixture();
	const close = vi.fn();
	const window = keyboard.bindEscapeContext(close, { untilRelease: true });
	keyboard.keydown(keyEvent("Escape"));
	keyboard.keydown(keyEvent("Escape", true));
	keyboard.keydown(keyEvent("Escape"));
	expect(close).toHaveBeenCalledTimes(2);
	expect(game.keydown).not.toHaveBeenCalled();
	window.release();
	keyboard.keydown(keyEvent("Escape"));
	expect(game.keydown).toHaveBeenCalledOnce();
});
