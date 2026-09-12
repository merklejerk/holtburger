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
		viewport.cancel();
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

	it("retains the cancellation boundary without a game controller", () => {
		const viewport = new ViewportInputGate();
		const keyboard = new KeyboardInputPolicy(viewport);
		const cancel = vi.spyOn(keyboard, "cancel");
		viewport.cancel();
		expect(cancel).toHaveBeenCalledOnce();
	});
});
