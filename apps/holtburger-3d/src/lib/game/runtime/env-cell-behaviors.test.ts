import { expect, it, vi } from "vitest";
import { EnvCellBehaviors } from "./env-cell-behaviors";
import type { StaticLayerCompanionPublication } from "./static-layer-realizer";

it("releases stale preparation when a cell leaves and re-enters before its first assets arrive", async () => {
	const pending: ((stage: StaticLayerCompanionPublication) => void)[] = [];
	const retire = vi.fn();
	const groups = new EnvCellBehaviors(
		new Map([["room", []]]),
		() => new Promise((resolve) => pending.push(resolve)),
		retire,
	);
	const first = groups.reconcile(() => true);
	await groups.reconcile(() => false);
	const second = groups.reconcile(() => true);
	const fresh = { commit: vi.fn(), release: vi.fn() };
	const stale = { commit: vi.fn(), release: vi.fn() };
	pending[1](fresh);
	await second;
	pending[0](stale);
	await first;
	expect(stale.release).toHaveBeenCalledOnce();
	expect(stale.commit).not.toHaveBeenCalled();
	expect(fresh.commit).toHaveBeenCalledOnce();
	await groups.reconcile(() => false);
	expect(retire).toHaveBeenCalledExactlyOnceWith("room");
});

it("invalidates pending cells even if a preceding cell fails to retire", async () => {
	const staged = { commit: vi.fn(), release: vi.fn() };
	let finish!: (stage: StaticLayerCompanionPublication) => void;
	const pending = new Promise<StaticLayerCompanionPublication>((resolve) => {
		finish = resolve;
	});
	const groups = new EnvCellBehaviors(
		new Map([
			["old", false],
			["pending", true],
		]),
		async (_cell, delayed) =>
			delayed ? pending : { commit: vi.fn(), release: vi.fn() },
		() => {
			throw Error("release failed");
		},
	);
	await groups.reconcile((cell) => cell === "old");
	const entering = groups.reconcile(() => true);
	await expect(groups.reconcile(() => false)).rejects.toThrow();
	finish(staged);
	await entering;
	expect(staged.release).toHaveBeenCalledOnce();
	expect(staged.commit).not.toHaveBeenCalled();
});

it("reports a stale stage's cleanup failure after withdrawal", async () => {
	const release = vi.fn(() => {
		throw Error("stale resource retained");
	});
	const groups = new EnvCellBehaviors(
		new Map([["room", []]]),
		async () => ({ commit: vi.fn(), release }),
		vi.fn(),
	);
	const entering = groups.reconcile(() => true);
	await groups.reconcile(() => false);
	await expect(entering).rejects.toMatchObject({
		errors: [expect.objectContaining({ message: "stale resource retained" })],
	});
	expect(release).toHaveBeenCalledOnce();
});
