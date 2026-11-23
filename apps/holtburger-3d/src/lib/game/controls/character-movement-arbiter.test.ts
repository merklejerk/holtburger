import { describe, expect, it, vi } from "vitest";
import {
	CharacterMovementArbiter,
	type OrdinaryCharacterInput,
} from "./character-movement-arbiter";

function createFakeOrdinary(retireOnAction = false): {
	readonly ordinary: OrdinaryCharacterInput;
	readonly calls: unknown[];
} {
	const calls: unknown[] = [];
	const ordinary: OrdinaryCharacterInput = {
		applyAction(action, down) {
			calls.push(["applyAction", action, down]);
			return retireOnAction;
		},
		reset() {
			calls.push(["reset"]);
		},
		setPersistentForward(enabled, mode) {
			calls.push(["setPersistentForward", enabled, mode]);
		},
		releaseHeldActions(preserveAutoRun) {
			calls.push(["releaseHeldActions", preserveAutoRun]);
		},
	};
	return { ordinary, calls };
}

describe("CharacterMovementArbiter", () => {
	it("merges independent forward sources until the last source releases", () => {
		const { ordinary, calls } = createFakeOrdinary();
		const arbiter = new CharacterMovementArbiter({ ordinary });

		arbiter.applyAction("forward", true);
		arbiter.applyForward("both-buttons", true);
		arbiter.applyAction("forward", false);
		expect(calls).toEqual([["applyAction", "forward", true]]);

		arbiter.applyForward("both-buttons", false);
		expect(calls).toEqual([
			["applyAction", "forward", true],
			["applyAction", "forward", false],
		]);
	});

	it("preserves auto-run across focus release and retires it on toggle, cancel, or reset", () => {
		const { ordinary, calls } = createFakeOrdinary();
		const autoRunStates: boolean[] = [];
		const arbiter = new CharacterMovementArbiter({
			ordinary,
			onAutoRunChanged: (enabled) => autoRunStates.push(enabled),
		});

		expect(arbiter.toggleAutoRun()).toBe(true);
		expect(arbiter.autoRun).toBe(true);
		arbiter.releaseHeldActions();
		expect(arbiter.autoRun).toBe(true);
		expect(calls.at(-1)).toEqual(["releaseHeldActions", true]);

		expect(arbiter.cancelAutoRun()).toBe(true);
		expect(arbiter.autoRun).toBe(false);
		expect(arbiter.cancelAutoRun()).toBe(false);

		arbiter.toggleAutoRun();
		arbiter.reset();
		expect(arbiter.autoRun).toBe(false);
		expect(autoRunStates).toEqual([true, false, true, false]);
	});

	it("retires auto-run once when ordinary applyAction reports drive retirement", () => {
		const { ordinary, calls } = createFakeOrdinary(true);
		const onAutoRunChanged = vi.fn();
		const arbiter = new CharacterMovementArbiter({
			ordinary,
			onAutoRunChanged,
		});

		arbiter.toggleAutoRun();
		arbiter.applyAction("backward", true);
		expect(arbiter.autoRun).toBe(false);
		expect(onAutoRunChanged).toHaveBeenLastCalledWith(false);
		// Should not call setPersistentForward(false, "synchronize") because drive already retired it.
		expect(calls).toEqual([
			["setPersistentForward", true, "acquire"],
			["applyAction", "backward", true],
		]);
	});
});
