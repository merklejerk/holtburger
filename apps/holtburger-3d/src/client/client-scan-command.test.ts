import { describe, expect, it, vi } from "vitest";
import { runClientScanCommand } from "./client-scan-command";

/** Public name and distance are the only entity facts consumed by scanning. */
function row(guid: number, name: string, distance: number | null) {
	return {
		guid,
		facts: {
			name,
			category: "monster" as const,
			vendor: false,
			stackCount: null,
			structure: { current: null, max: null },
		},
		distance,
	};
}

describe("scan command", () => {
	it.each(["/scan ORC", "@SCAN orc"])(
		"prefers name quality over distance for %s",
		(command) => {
			const select = vi.fn(() => true);
			const append = vi.fn();
			expect(
				runClientScanCommand(
					command,
					() => [row(2, "Orchid", 1), row(3, "Orc", 20)],
					select,
					append,
				),
			).toBe(true);
			expect(select).toHaveBeenCalledExactlyOnceWith(3);
			expect(append).not.toHaveBeenCalled();
		},
	);
	it("breaks equal match ranks by distance, then GUID, independently of input order", () => {
		const rows = [
			row(1, "Ice Golem", null),
			row(8, "Ice Golem", 10),
			row(7, "Iron Golem", 5),
			row(6, "Iron Golem", 5),
		];
		for (const candidates of [rows, rows.toReversed()]) {
			const select = vi.fn(() => true);
			runClientScanCommand("/scan golem", () => candidates, select, vi.fn());
			expect(select).toHaveBeenCalledExactlyOnceWith(6);
		}
	});
	it("selects multiword abbreviations", () => {
		const select = vi.fn(() => true);
		runClientScanCommand(
			"/scan dmnd glm",
			() => [row(7, "Diamond Golem", 5)],
			select,
			vi.fn(),
		);
		expect(select).toHaveBeenCalledExactlyOnceWith(7);
	});
	it.each([{ rows: [] }, { rows: [row(7, "Diamond Golem", 5)] }])(
		"reports a missing match without touching selection",
		({ rows }) => {
			const select = vi.fn(() => true);
			const append = vi.fn();
			runClientScanCommand("/scan drudge", () => rows, select, append);
			expect(select).not.toHaveBeenCalled();
			expect(append).toHaveBeenCalledExactlyOnceWith({
				kind: "error",
				message: "No entity found",
			});
		},
	);
	it("reports a match rejected by the selection owner", () => {
		const append = vi.fn();
		runClientScanCommand(
			"/scan golem",
			() => [row(7, "Diamond Golem", 5)],
			() => false,
			append,
		);
		expect(append).toHaveBeenCalledExactlyOnceWith({
			kind: "error",
			message: "No entity found",
		});
	});
	it.each(["/scan", "/scan   ", "/scan ..."])(
		"shows usage without sampling for %s",
		(command) => {
			const read = vi.fn(() => []);
			const append = vi.fn();
			runClientScanCommand(command, read, vi.fn(), append);
			expect(read).not.toHaveBeenCalled();
			expect(append).toHaveBeenCalledExactlyOnceWith({
				kind: "system",
				message: "Usage: /scan <name>",
			});
		},
	);
	it.each(["hello", "/scanner golem", "/scan-other"])(
		"leaves unrelated input alone: %s",
		(command) => {
			const read = vi.fn(() => []);
			expect(runClientScanCommand(command, read, vi.fn(), vi.fn())).toBe(false);
			expect(read).not.toHaveBeenCalled();
		},
	);
});
