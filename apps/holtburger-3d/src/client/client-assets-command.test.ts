import { describe, expect, it, vi } from "vitest";
import { runClientAssetsCommand } from "./client-assets-command";
import { clientCommandHelp } from "./client-command-help";

describe("asset location command", () => {
	it.each(["/assets", "@assets", " /ASSETS "])(
		"prints the admitted source for %s",
		(command) => {
			const append = vi.fn();
			expect(
				runClientAssetsCommand(command, "C:\\AC Data\\retail", append),
			).toBe(true);
			expect(append).toHaveBeenCalledExactlyOnceWith({
				kind: "system",
				message: "Assets: C:\\AC Data\\retail",
			});
		},
	);
	it("keeps missing diagnostic provenance explicit", () => {
		const append = vi.fn();
		expect(runClientAssetsCommand("/assets", null, append)).toBe(true);
		expect(append).toHaveBeenCalledExactlyOnceWith({
			kind: "system",
			message: "Asset location is unavailable.",
		});
	});
	it.each(["hello", "/asset", "/assets extra"])(
		"leaves %s to normal routing",
		(command) => {
			const append = vi.fn();
			expect(runClientAssetsCommand(command, "/selected", append)).toBe(false);
			expect(append).not.toHaveBeenCalled();
		},
	);
	it("exposes the command in targeted help", () => {
		const help = clientCommandHelp("assets");
		expect(
			help.rows
				.flatMap((row) => row.spans)
				.map((span) => span.text)
				.join(" "),
		).toContain("Print the active asset location.");
	});
});
