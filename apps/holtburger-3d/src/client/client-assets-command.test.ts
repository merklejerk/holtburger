import { describe, expect, it, vi } from "vitest";
import { runClientAssetsCommand } from "./client-assets-command";
import { clientCommandHelp } from "./client-command-help";

describe("asset location command", () => {
	it("routes explicit retry locally and observes its completion", async () => {
		const append = vi.fn();
		const retry = vi.fn(async () => {});
		expect(
			runClientAssetsCommand("/assets retry", "/selected", append, retry),
		).toBe(true);
		await Promise.resolve();
		expect(retry).toHaveBeenCalledOnce();
		expect(append).toHaveBeenCalledWith(
			expect.objectContaining({ message: expect.stringContaining("Retried") }),
		);
	});
	it.each(["/assets", "@assets", " /ASSETS "])(
		"prints the admitted source for %s",
		(command) => {
			const append = vi.fn();
			expect(
				runClientAssetsCommand(
					command,
					"C:\\AC Data\\retail",
					append,
					async () => {},
				),
			).toBe(true);
			expect(append).toHaveBeenCalledExactlyOnceWith({
				kind: "system",
				message: "Assets: C:\\AC Data\\retail",
			});
		},
	);
	it("keeps missing diagnostic provenance explicit", () => {
		const append = vi.fn();
		expect(
			runClientAssetsCommand("/assets", null, append, async () => {}),
		).toBe(true);
		expect(append).toHaveBeenCalledExactlyOnceWith({
			kind: "system",
			message: "Asset location is unavailable.",
		});
	});
	it.each(["hello", "/asset", "/assets extra"])(
		"leaves %s to normal routing",
		(command) => {
			const append = vi.fn();
			expect(
				runClientAssetsCommand(command, "/selected", append, async () => {}),
			).toBe(false);
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
