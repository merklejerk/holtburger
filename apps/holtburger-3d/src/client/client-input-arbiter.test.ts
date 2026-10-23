import { INPUT_DEFAULTS } from "../lib/input/input-defaults";
import { describe, expect, it } from "vitest";

import type { CharacterAction } from "../lib/input/input-contract";
import { ClientInputArbiter } from "./client-input-arbiter";
import {
	CharacterInputController,
	type CharacterDriveIntent,
} from "../lib/game/controls/character-input-controller";

class FakeOrdinaryInput {
	readonly calls: string[] = [];
	#persistentForward = false;

	applyAction(action: CharacterAction, down: boolean): boolean {
		this.calls.push(`${action}:${down ? "down" : "up"}`);
		const cancelled =
			down &&
			this.#persistentForward &&
			(action === "forward" || action === "backward");
		if (cancelled) this.#persistentForward = false;
		return cancelled;
	}

	restoreHeldAction(action: Exclude<CharacterAction, "jump">): void {
		this.calls.push(`${action}:restore`);
	}

	setPersistentForward(enabled: boolean, intent: CharacterDriveIntent): void {
		this.calls.push(`auto-run:${enabled ? "on" : "off"}:${intent}`);
		this.#persistentForward = enabled;
	}

	reset(): void {
		this.calls.push("reset");
		this.#persistentForward = false;
	}

	releaseHeldActions(persistentForward: boolean): void {
		this.calls.push(`release-held:${persistentForward}`);
		this.#persistentForward = persistentForward;
	}
}

function fixture() {
	const ordinary = new FakeOrdinaryInput();
	const edges: string[] = [];
	const autoRunChanges: boolean[] = [];
	const arbiter = new ClientInputArbiter({
		powerBindings: INPUT_DEFAULTS.preciseJump,
		ordinary,
		onEnter: () => edges.push("enter"),
		onActivate: () => edges.push("activate"),
		onCancel: () => edges.push("cancel"),
		onAutoRunChanged: (enabled) => autoRunChanges.push(enabled),
	});
	return { arbiter, autoRunChanges, edges, ordinary };
}

describe("ClientInputArbiter", () => {
	it("preserves autorun across editor handoffs and still hard-cancels afterward", () => {
		const { arbiter, ordinary, autoRunChanges, edges } = fixture();
		arbiter.toggleAutoRun();
		arbiter.applyAction("turnLeft", true);
		arbiter.enterPrecise();
		ordinary.calls.length = 0;
		arbiter.releaseHeldActions();
		arbiter.releaseHeldActions();
		expect(ordinary.calls).toEqual(["release-held:true", "release-held:true"]);
		expect(autoRunChanges).toEqual([true]);
		expect(edges).toEqual(["enter", "cancel"]);
		expect(arbiter.preciseActive).toBe(false);
		arbiter.enterPrecise();
		arbiter.deactivate();
		expect(ordinary.calls).not.toContain("turnLeft:restore");
		arbiter.reset();
		expect(autoRunChanges).toEqual([true, false]);
	});

	it("uses independent held power controls only during precise mode", () => {
		const { arbiter, ordinary } = fixture();
		const up = { key: "i", code: "KeyI", shiftKey: false };
		const down = { key: "k", code: "KeyK", shiftKey: false };
		arbiter.replacePowerBindings({
			increasePower: [{ key: "i" }],
			decreasePower: [{ key: "k" }],
		});
		expect(arbiter.applyPowerKey(up, true)).toBe(false);
		arbiter.enterPrecise();
		arbiter.applyAction("forward", true);
		expect(arbiter.precisePowerDirection).toBe(0);
		expect(arbiter.applyPowerKey(up, true)).toBe(true);
		expect(arbiter.precisePowerDirection).toBe(1);
		arbiter.applyPowerKey(down, true);
		expect(arbiter.precisePowerDirection).toBe(0);
		arbiter.applyPowerKey(up, false);
		expect(arbiter.precisePowerDirection).toBe(-1);
		arbiter.cancelPrecise();
		expect(arbiter.precisePowerDirection).toBe(0);
		expect(ordinary.calls).toEqual(["reset", "reset"]);
		arbiter.enterPrecise();
		arbiter.applyPowerKey({ ...down, repeat: true }, true);
		expect(arbiter.precisePowerDirection).toBe(0);
		arbiter.applyPowerKey(down, false);
		arbiter.applyPowerKey(down, true);
		expect(arbiter.precisePowerDirection).toBe(-1);
	});
	it("clears held power on focus loss and binding replacement", () => {
		const { arbiter } = fixture();
		arbiter.replacePowerBindings({
			increasePower: [{ key: "i" }],
			decreasePower: [],
		});
		arbiter.enterPrecise();
		arbiter.applyPowerKey({ key: "i", shiftKey: false }, true);
		expect(arbiter.precisePowerDirection).toBe(1);
		arbiter.replacePowerBindings({
			increasePower: [{ key: "u" }],
			decreasePower: [],
		});
		expect(arbiter.precisePowerDirection).toBe(0);
		expect(arbiter.applyPowerKey({ key: "i", shiftKey: false }, true)).toBe(
			false,
		);
		arbiter.applyPowerKey({ key: "u", shiftKey: false }, true);
		expect(arbiter.precisePowerDirection).toBe(1);
		arbiter.reset();
		arbiter.enterPrecise();
		expect(arbiter.precisePowerDirection).toBe(0);
	});
	it("does not convert pre-existing held movement into a power sweep", () => {
		const { arbiter } = fixture();
		arbiter.applyAction("forward", true);
		arbiter.enterPrecise();
		expect(arbiter.precisePowerDirection).toBe(0);
	});

	it("allows live turning while precise input suppresses translation", () => {
		const ordinary = new CharacterInputController({
			fullChargeDurationMs: 1000,
			now: () => 0,
			onDrive() {},
			onEdge() {},
		});
		const arbiter = new ClientInputArbiter({
			powerBindings: INPUT_DEFAULTS.preciseJump,
			ordinary,
			onEnter() {},
			onActivate() {},
			onCancel() {},
			onAutoRunChanged() {},
		});
		arbiter.applyAction("forward", true);
		arbiter.applyAction("turnLeft", true);
		arbiter.enterPrecise();
		expect(ordinary.drive()).toMatchObject({
			longitudinal: null,
			lateral: null,
			turn: "left",
		});
		arbiter.applyAction("turnRight", true);
		arbiter.applyAction("strafeLeft", true);
		expect(ordinary.drive()).toMatchObject({
			longitudinal: null,
			lateral: null,
			turn: "right",
		});
		arbiter.applyAction("turnRight", false);
		expect(ordinary.drive().turn).toBe("left");
		arbiter.applyAction("turnLeft", false);
		expect(ordinary.drive().turn).toBeNull();
		arbiter.reset();
		expect(ordinary.drive()).toMatchObject({
			longitudinal: null,
			lateral: null,
			turn: null,
		});
	});

	it("cancels precise mode once and restores held movement", () => {
		const { arbiter, edges, ordinary } = fixture();
		arbiter.applyAction("forward", true);
		arbiter.enterPrecise();
		expect(arbiter.cancelPrecise()).toBe(true);
		expect(arbiter.cancelPrecise()).toBe(false);
		expect(arbiter.preciseActive).toBe(false);
		expect(edges).toEqual(["enter", "cancel"]);
		expect(ordinary.calls).toContain("forward:restore");
	});
	it("preserves opposing action precedence across precise mode", () => {
		const ordinary = new CharacterInputController({
			fullChargeDurationMs: 1000,
			now: () => 0,
			onDrive() {},
			onEdge() {},
		});
		const arbiter = new ClientInputArbiter({
			powerBindings: INPUT_DEFAULTS.preciseJump,
			ordinary,
			onEnter() {},
			onActivate() {},
			onCancel() {},
			onAutoRunChanged() {},
		});
		arbiter.applyAction("turnRight", true);
		arbiter.applyAction("turnLeft", true);
		expect(ordinary.drive().turn).toBe("left");
		arbiter.enterPrecise();
		arbiter.deactivate();
		expect(ordinary.drive().turn).toBe("left");
		arbiter.applyAction("turnLeft", false);
		expect(ordinary.drive().turn).toBe("right");
	});
	it("enters precise mode once and resets ordinary input ownership", () => {
		const { arbiter, edges, ordinary } = fixture();
		expect(arbiter.enterPrecise()).toBe(true);
		expect(arbiter.enterPrecise()).toBe(false);

		expect(ordinary.calls).toEqual(["reset"]);
		expect(edges).toEqual(["enter"]);
		expect(arbiter.preciseActive).toBe(true);
	});

	it("routes walking and jumping through the ordinary controller", () => {
		const { arbiter, edges, ordinary } = fixture();
		arbiter.applyAction("walk", true);
		arbiter.applyAction("jump", true);
		arbiter.applyAction("jump", false);

		expect(ordinary.calls).toEqual(["walk:down", "jump:down", "jump:up"]);
		expect(edges).toEqual([]);
		expect(arbiter.preciseActive).toBe(false);
	});

	it("toggles persistent forward and clears it at the hard cancellation boundary", () => {
		const { arbiter, autoRunChanges, ordinary } = fixture();
		expect(arbiter.toggleAutoRun()).toBe(true);
		expect(arbiter.toggleAutoRun()).toBe(false);
		expect(ordinary.calls).toEqual([
			"auto-run:on:acquire",
			"auto-run:off:synchronize",
		]);
		expect(autoRunChanges).toEqual([true, false]);

		arbiter.toggleAutoRun();
		ordinary.calls.length = 0;
		arbiter.reset();
		expect(ordinary.calls).toEqual(["reset"]);
		expect(autoRunChanges).toEqual([true, false, true, false]);
		expect(arbiter.toggleAutoRun()).toBe(true);
	});

	it("cancels auto-run atomically when longitudinal input acquires movement", () => {
		const { arbiter, autoRunChanges, ordinary } = fixture();
		arbiter.toggleAutoRun();
		ordinary.calls.length = 0;

		arbiter.applyAction("backward", true);

		expect(ordinary.calls).toEqual(["backward:down"]);
		expect(autoRunChanges).toEqual([true, false]);
		expect(arbiter.toggleAutoRun()).toBe(true);
	});

	it("synchronizes cancellation without acquiring server-controlled motion", () => {
		const { arbiter, autoRunChanges, ordinary } = fixture();
		arbiter.toggleAutoRun();
		ordinary.calls.length = 0;

		expect(arbiter.cancelAutoRun()).toBe(true);
		expect(arbiter.cancelAutoRun()).toBe(false);

		expect(ordinary.calls).toEqual(["auto-run:off:synchronize"]);
		expect(autoRunChanges).toEqual([true, false]);
	});

	it("pauses auto-run during precise jump and restores it as synchronization", () => {
		const { arbiter, ordinary } = fixture();
		arbiter.toggleAutoRun();
		arbiter.applyAction("turnLeft", true);
		ordinary.calls.length = 0;

		arbiter.enterPrecise();
		arbiter.deactivate();

		expect(ordinary.calls).toEqual([
			"reset",
			"turnLeft:restore",
			"reset",
			"turnLeft:restore",
			"auto-run:on:synchronize",
		]);
		expect(arbiter.toggleAutoRun()).toBe(false);
	});

	it("power input retires auto-run and returns to idle on mode exit", () => {
		const { arbiter, autoRunChanges, ordinary } = fixture();
		arbiter.toggleAutoRun();
		arbiter.enterPrecise();
		ordinary.calls.length = 0;

		arbiter.applyPowerKey({ key: "w", shiftKey: false }, true);
		arbiter.deactivate();

		expect(ordinary.calls).toEqual(["reset"]);
		expect(arbiter.precisePowerDirection).toBe(0);
		expect(autoRunChanges).toEqual([true, false]);
	});

	it("activates once for each fresh jump press", () => {
		const { arbiter, edges } = fixture();
		arbiter.enterPrecise();
		arbiter.applyAction("jump", true);
		arbiter.applyAction("jump", true);

		expect(edges).toEqual(["enter", "activate"]);
	});

	it("cancels a button-owned charge and swallows its held jump release", () => {
		const { arbiter, edges, ordinary } = fixture();
		arbiter.applyAction("jump", true);
		arbiter.enterPrecise();
		arbiter.applyAction("jump", false);

		expect(ordinary.calls).toEqual(["jump:down", "reset"]);
		expect(edges).toEqual(["enter"]);
		expect(arbiter.preciseActive).toBe(true);
	});

	it("restores held movement after ordinary mode resumes but never restores jump", () => {
		const { arbiter, ordinary } = fixture();
		arbiter.applyAction("forward", true);
		arbiter.enterPrecise();
		ordinary.calls.length = 0;

		arbiter.deactivate();

		expect(ordinary.calls).toEqual(["reset", "forward:restore"]);
		expect(arbiter.precisePowerDirection).toBe(0);
	});

	it("hard-cancels on focus loss without replaying held actions", () => {
		const { arbiter, edges, ordinary } = fixture();
		arbiter.enterPrecise();
		arbiter.applyAction("forward", true);
		ordinary.calls.length = 0;

		arbiter.reset();

		expect(ordinary.calls).toEqual(["reset"]);
		expect(edges).toEqual(["enter", "cancel"]);
		expect(arbiter.preciseActive).toBe(false);
	});
});
