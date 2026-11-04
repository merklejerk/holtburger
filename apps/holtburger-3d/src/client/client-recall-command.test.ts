import { describe, expect, it, vi } from "vitest";
import type { RecallDestination } from "./client-host-contract";
import { parseRecallCommand, runRecallCommand } from "./client-recall-command";

describe("client recall commands", () => {
	it.each<[RecallDestination, string[]]>([
		["lifestone", ["ls", "lif", "lifestone"]],
		["marketplace", ["mp", "mar", "marketplace"]],
		["house", ["hr", "hor", "house recall", "hou re"]],
		[
			"allegiance-housing",
			["hom", "hoa", "house mansion_recall", "house alleg_recall", "hou ma"],
		],
		["allegiance-hometown", ["allegiance hometown", "all ho"]],
		["pk-arena", ["pkarena", "pka"]],
		["pk-lite-arena", ["pklarena", "pla"]],
	])("maps %s aliases with both prefixes and case", (destination, aliases) => {
		for (const alias of aliases) {
			for (const prefix of ["/", "@"]) {
				expect(parseRecallCommand(`  ${prefix}${alias.toUpperCase()}  `)).toBe(
					destination,
				);
			}
		}
	});
	it.each([
		"hello",
		"meet me at @ls",
		"@house guest add Someone",
		"@allegiance info",
	])("preserves ordinary or unhandled text: %s", async (text) => {
		const recall = vi.fn();
		expect(await runRecallCommand(text, recall)).toBe(false);
		expect(recall).not.toHaveBeenCalled();
	});
	it.each(["@ls extra", "/house recall extra"])(
		"rejects malformed recall %s locally",
		async (text) => {
			const recall = vi.fn();
			await expect(runRecallCommand(text, recall)).rejects.toThrow(
				"do not accept extra arguments",
			);
			expect(recall).not.toHaveBeenCalled();
		},
	);
	it("dispatches one typed request and propagates host rejection", async () => {
		const recall = vi.fn().mockResolvedValue(undefined);
		expect(await runRecallCommand("@ls", recall)).toBe(true);
		expect(recall).toHaveBeenCalledExactlyOnceWith("lifestone");
		recall.mockRejectedValueOnce(new Error("session retired"));
		await expect(runRecallCommand("/mp", recall)).rejects.toThrow(
			"session retired",
		);
	});
	it("preserves retail hometown trailing-argument handling", () => {
		expect(parseRecallCommand("@all ho extra")).toBe("allegiance-hometown");
	});
});
