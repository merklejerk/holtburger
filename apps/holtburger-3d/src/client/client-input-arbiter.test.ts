import { describe, expect, it } from "vitest";

import type { CharacterAction } from "../lib/input/input-contract";
import { ClientInputArbiter } from "./client-input-arbiter";
import { CharacterInputController } from "../lib/game/controls/character-input-controller";

class FakeOrdinaryInput {
	readonly calls: string[] = [];

	applyAction(action: CharacterAction, down: boolean): void {
		this.calls.push(`${action}:${down ? "down" : "up"}`);
	}

	reset(): void {
		this.calls.push("reset");
	}
}

function fixture() {
	const ordinary = new FakeOrdinaryInput();
	const edges: string[] = [];
	const arbiter = new ClientInputArbiter({
		ordinary,
		onEnter: () => edges.push("enter"),
		onActivate: () => edges.push("activate"),
		onCancel: () => edges.push("cancel"),
	});
	return { arbiter, edges, ordinary };
}

describe("ClientInputArbiter", () => {
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

		expect(ordinary.calls).toEqual(["reset", "forward:down"]);
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
