import { describe, expect, it, vi } from "vitest";
import { ClientContractNotifications } from "./client-contract-notifications";

function fixture() {
	const timers = new Map<number, () => void>();
	let next = 0;
	const publish = vi.fn<(message: string) => void>();
	const schedule = vi.fn((callback: () => void) => {
		const id = ++next;
		timers.set(id, callback);
		return id;
	});
	const owner = new ClientContractNotifications({
		publish,
		batchMs: 10,
		scheduler: {
			schedule,
			cancel: (id) => {
				timers.delete(id);
			},
		},
	});
	const flush = () => {
		for (const [id, callback] of timers) {
			timers.delete(id);
			callback();
		}
	};
	return { owner, publish, schedule, timers, flush };
}

describe("contract notifications", () => {
	it("uses authored names and explicit unresolved identities for accepted activity", () => {
		const { owner, publish, flush } = fixture();
		owner.receive({
			type: "contract-membership-change",
			change: { kind: "added", id: 1, name: "A quest" },
		});
		expect(publish).not.toHaveBeenCalled();
		flush();
		expect(publish).toHaveBeenLastCalledWith("Added to journal: A quest");
		owner.accept({ kind: "removed", id: 99, name: null });
		flush();
		expect(publish).toHaveBeenLastCalledWith(
			"Removed from journal: Contract #99",
		);
	});
	it("summarizes bursts without extending the first delivery window", () => {
		const { owner, publish, flush, schedule } = fixture();
		owner.accept({ kind: "removed", id: 1, name: "One" });
		owner.accept({ kind: "removed", id: 2, name: "Two" });
		expect(schedule).toHaveBeenCalledTimes(1);
		flush();
		expect(publish).toHaveBeenLastCalledWith(
			"2 contracts removed from journal",
		);
		owner.accept({ kind: "added", id: 1, name: "One" });
		owner.accept({ kind: "removed", id: 2, name: "Two" });
		flush();
		expect(publish).toHaveBeenLastCalledWith(
			"Journal updated: 1 added, 1 removed",
		);
		owner.accept({ kind: "added", id: 1, name: "One" });
		owner.accept({ kind: "added", id: 2, name: "Two" });
		flush();
		expect(publish).toHaveBeenLastCalledWith("2 contracts added to journal");
	});
	it("cancels undelivered activity on recovery, retirement, and disposal while preserving portal travel", () => {
		const { owner, publish, flush, timers } = fixture();
		owner.accept({ kind: "added", id: 1, name: "Quest" });
		owner.receive({
			type: "lifecycle",
			lifecycle: {
				kind: "portal-space",
				cause: "teleport",
				worldGeneration: 2,
			},
		});
		expect(timers.size).toBe(1);
		owner.receive({ type: "resyncing" });
		expect(timers.size).toBe(0);
		owner.accept({ kind: "removed", id: 1, name: "Quest" });
		owner.receive({
			type: "lifecycle",
			lifecycle: { kind: "character-selection", maxSlots: 11, characters: [] },
		});
		flush();
		expect(publish).not.toHaveBeenCalled();
		owner.accept({ kind: "added", id: 1, name: "Quest" });
		owner.reset();
		flush();
		expect(publish).not.toHaveBeenCalled();
	});
	it("rejects invalid batch durations", () => {
		for (const batchMs of [0, -1, Infinity, NaN])
			expect(
				() =>
					new ClientContractNotifications({
						batchMs,
						publish: () => {},
						scheduler: { schedule: () => 1, cancel: () => {} },
					}),
			).toThrow("batch duration");
	});
});
