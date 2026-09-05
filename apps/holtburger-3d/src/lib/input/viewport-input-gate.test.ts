import { describe, expect, it, vi } from "vitest";
import { ViewportInputGate } from "./viewport-input-gate";
import { InputContext } from "./input-context";

describe("ViewportInputGate", () => {
	it("finishes sibling cancellation and rolls back an unreturned blocker on failure", () => {
		const gate = new ViewportInputGate();
		const failure = new Error("Broken participant");
		gate.attach(() => {
			throw failure;
		});
		const sibling = vi.fn();
		gate.attach(sibling);
		expect(() => gate.block()).toThrow(AggregateError);
		expect(sibling).toHaveBeenCalledOnce();
		expect(gate.allowed).toBe(true);
	});

	it("does not retain a participant whose blocked attachment fails", () => {
		const gate = new ViewportInputGate();
		const release = gate.block();
		const failed = vi.fn(() => {
			throw new Error("Cannot attach");
		});
		expect(() => gate.attach(failed)).toThrow("Cannot attach");
		release();
		gate.cancel();
		expect(failed).toHaveBeenCalledOnce();
	});
	it("cancels all participants once on blocking and keeps independent blockers active", () => {
		const gate = new ViewportInputGate();
		const keyboard = vi.fn();
		const pointer = vi.fn();
		gate.attach(keyboard);
		gate.attach(pointer);
		const leaveChat = gate.block();
		const closeModal = gate.block();
		expect(keyboard).toHaveBeenCalledOnce();
		expect(pointer).toHaveBeenCalledOnce();
		leaveChat();
		leaveChat();
		expect(gate.allowed).toBe(false);
		closeModal();
		expect(gate.allowed).toBe(true);
		expect(keyboard).toHaveBeenCalledOnce();
	});

	it("cancels a newly mounted participant while blocked and cancels it once on detach", () => {
		const gate = new ViewportInputGate();
		const release = gate.block();
		const outgoing = vi.fn();
		const detach = gate.attach(outgoing);
		expect(outgoing).toHaveBeenCalledOnce();
		detach();
		detach();
		gate.cancel();
		release();
		expect(outgoing).toHaveBeenCalledTimes(2);
	});

	it("focus cancellation leaves availability unchanged and never synthesizes a jump release", () => {
		const gate = new ViewportInputGate();
		const action = vi.fn();
		const context = new InputContext({ jump: [{ key: "x" }] }, action);
		gate.attach(() => context.reset());
		const event = { key: "x", code: "KeyX", shiftKey: false };
		context.apply(event, true);
		gate.cancel();
		expect(gate.allowed).toBe(true);
		context.apply({ ...event, repeat: true }, true);
		context.apply(event, false);
		expect(action.mock.calls).toEqual([["jump", true]]);
		context.apply(event, true);
		expect(action.mock.calls).toEqual([
			["jump", true],
			["jump", true],
		]);
	});

	it("unregisters the outgoing participant before cancelling it", () => {
		const gate = new ViewportInputGate();
		const cancel = vi.fn(() => gate.cancel());
		const detach = gate.attach(cancel);
		detach();
		expect(cancel).toHaveBeenCalledOnce();
	});
});
