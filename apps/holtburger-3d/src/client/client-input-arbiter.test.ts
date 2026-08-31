import { describe, expect, it } from "vitest";

import type { CharacterInputKey } from "../lib/game/controls/character-input-controller";
import { clientInputKey, ClientInputArbiter } from "./client-input-arbiter";

describe("clientInputKey", () => {
	it("normalizes browser letter and modifier key names", () => {
		expect(clientInputKey("W")).toBe("w");
		expect(clientInputKey("Shift")).toBe("shift");
		expect(clientInputKey(" ")).toBe("space");
		expect(clientInputKey("Control")).toBeNull();
	});
});

class FakeOrdinaryInput {
	readonly calls: string[] = [];

	applyKey(key: CharacterInputKey, down: boolean, repeat = false): void {
		this.calls.push(`${key}:${down ? "down" : "up"}:${repeat}`);
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
	it("enters precise mode once and resets ordinary input ownership", () => {
		const { arbiter, edges, ordinary } = fixture();
		expect(arbiter.enterPrecise()).toBe(true);
		expect(arbiter.enterPrecise()).toBe(false);

		expect(ordinary.calls).toEqual(["reset"]);
		expect(edges).toEqual(["enter"]);
		expect(arbiter.preciseActive).toBe(true);
	});

	it("leaves Shift+Space on the ordinary walk-jump path", () => {
		const { arbiter, edges, ordinary } = fixture();
		arbiter.applyKey("shift", true);
		arbiter.applyKey("space", true);
		arbiter.applyKey("space", false);

		expect(ordinary.calls).toEqual([
			"shift:down:false",
			"space:down:false",
			"space:up:false",
		]);
		expect(edges).toEqual([]);
		expect(arbiter.preciseActive).toBe(false);
	});

	it("uses only a fresh subsequent Space edge to activate", () => {
		const { arbiter, edges } = fixture();
		arbiter.enterPrecise();
		arbiter.applyKey("space", true, true);
		arbiter.applyKey("space", true);

		expect(edges).toEqual(["enter", "activate"]);
	});

	it("cancels a button-owned charge and swallows its held Space release", () => {
		const { arbiter, edges, ordinary } = fixture();
		arbiter.applyKey("space", true);
		arbiter.enterPrecise();
		arbiter.applyKey("space", false);

		expect(ordinary.calls).toEqual(["space:down:false", "reset"]);
		expect(edges).toEqual(["enter"]);
		expect(arbiter.preciseActive).toBe(true);
	});

	it("restores held movement after ordinary mode resumes but never restores Space", () => {
		const { arbiter, ordinary } = fixture();
		arbiter.applyKey("w", true);
		arbiter.enterPrecise();
		ordinary.calls.length = 0;

		arbiter.deactivate();

		expect(ordinary.calls).toEqual(["reset", "w:down:false"]);
	});

	it("hard-cancels on focus loss without replaying held keys", () => {
		const { arbiter, edges, ordinary } = fixture();
		arbiter.enterPrecise();
		arbiter.applyKey("w", true);
		ordinary.calls.length = 0;

		arbiter.reset();

		expect(ordinary.calls).toEqual(["reset"]);
		expect(edges).toEqual(["enter", "cancel"]);
		expect(arbiter.preciseActive).toBe(false);
	});
});
