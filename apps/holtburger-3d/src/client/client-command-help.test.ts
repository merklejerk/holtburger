import { describe, expect, it, vi } from "vitest";
import { clientCommandHelp, runClientHelpCommand } from "./client-command-help";

function text(topic: string): string {
	return clientCommandHelp(topic)
		.rows.map((row) => row.spans.map((span) => span.text).join(""))
		.join("\n");
}

describe("h3d command help", () => {
	it.each(["/help", "/?", "@help", "@?"])(
		"routes %s without a character session",
		(command) => {
			const append = vi.fn();
			expect(runClientHelpCommand(command, append)).toBe(true);
			expect(append).toHaveBeenCalledExactlyOnceWith(clientCommandHelp(""));
			append.mockClear();
			expect(runClientHelpCommand(`${command} death`, append)).toBe(true);
			expect(append).toHaveBeenCalledExactlyOnceWith(
				clientCommandHelp("death"),
			);
			append.mockClear();
			expect(runClientHelpCommand(`${command} /consent`, append)).toBe(true);
			expect(append).toHaveBeenCalledExactlyOnceWith(
				clientCommandHelp("consent"),
			);
		},
	);
	it.each(["ordinary speech", "@helper", "/?extra"])(
		"leaves %s to ordinary routing",
		(command) => {
			const append = vi.fn();
			expect(runClientHelpCommand(command, append)).toBe(false);
			expect(append).not.toHaveBeenCalled();
		},
	);
	it("lists every supported command in the index and resolves each entry", () => {
		const index = clientCommandHelp("");
		const commands = index.rows
			.flatMap((row) => row.spans)
			.filter((span) => span.kind === "code")
			.map((span) => span.text);
		expect(commands).toEqual(
			expect.arrayContaining([
				"/help [command]",
				"/version",
				"/corpse",
				"/corpses",
				"/permit <player>",
				"/unpermit <player>",
				"/consent <operation> [player]",
				"/die",
				"/lifestone",
				"/marketplace",
				"/pkarena",
				"/pklarena",
				"/house recall",
				"/house mansion_recall",
				"/allegiance hometown",
				"/waypoint [coordinates|clear]",
				"/loc",
				"/tell <player>, <message>",
				"/tellselected <message>",
				"/reply <message>",
				"/retell <message>",
			]),
		);
		expect(new Set(commands).size).toBe(commands.length);
		for (const syntax of commands) {
			const topic = syntax.replace(/\s+[[<].*$/, "");
			expect(text(topic)).toContain(syntax);
		}
	});
	it.each([
		["/CORPSE", "corpse"],
		["@corpses", "corpses"],
		["rip", "die"],
		["?", "help"],
		["wp", "waypoint"],
		["ls", "lifestone"],
		["mp", "marketplace"],
		["pka", "pkarena"],
		["pla", "pklarena"],
		["hr", "house recall"],
		["hoa", "house mansion_recall"],
		["all ho", "allegiance hometown"],
		["t", "tell"],
		["ts", "tellselected"],
		["r", "reply"],
		["rt", "retell"],
	])("resolves help for %s", (alias, canonical) => {
		expect(clientCommandHelp(alias)).toEqual(clientCommandHelp(canonical));
	});
	it("explains command-specific behavior in targeted help", () => {
		expect(text("corpse")).toContain("does not confirm");
		expect(text("corpses")).toContain("may be stale");
		expect(text("permit")).toContain("Example: /permit Best Friend");
		expect(text("consent")).toContain("/consent remove <player>");
	});
	it("points unknown topics back to the index", () => {
		expect(() => clientCommandHelp("no-such-command")).toThrow(
			"Use /help to list commands.",
		);
	});
});
