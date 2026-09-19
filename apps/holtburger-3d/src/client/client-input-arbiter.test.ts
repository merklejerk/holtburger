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
}

function fixture() {
	const ordinary = new FakeOrdinaryInput();
	const edges: string[] = [];
	const autoRunChanges: boolean[] = [];
	const arbiter = new ClientInputArbiter({
		ordinary,
		onEnter: () => edges.push("enter"),
		onActivate: () => edges.push("activate"),
		onCancel: () => edges.push("cancel"),
		onAutoRunChanged: (enabled) => autoRunChanges.push(enabled),
	});
	return { arbiter, autoRunChanges, edges, ordinary };
}

describe("ClientInputArbiter", () => {
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
			"reset",
			"turnLeft:restore",
			"auto-run:on:synchronize",
		]);
		expect(arbiter.toggleAutoRun()).toBe(false);
	});

	it("does not restore auto-run after longitudinal input during precise jump", () => {
		const { arbiter, autoRunChanges, ordinary } = fixture();
		arbiter.toggleAutoRun();
		arbiter.enterPrecise();
		ordinary.calls.length = 0;

		arbiter.applyAction("forward", true);
		arbiter.deactivate();

		expect(ordinary.calls).toEqual(["reset", "forward:restore"]);
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
