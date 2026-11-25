import { describe, expect, it, vi } from "vitest";
import { runClientApiCommand } from "./api-command";
import type { ClientApiState, ClientChatMessage } from "./host-contract";

describe("runClientApiCommand", () => {
	it("ignores unrelated messages", async () => {
		const messages: ClientChatMessage[] = [];
		const setPaused = vi.fn(async () => {});
		const handled = await runClientApiCommand(
			"/scan drudge",
			() => null,
			setPaused,
			(m) => messages.push(m),
		);
		expect(handled).toBe(false);
		expect(messages).toEqual([]);
		expect(setPaused).not.toHaveBeenCalled();
	});

	it("reports inactive, active, and paused status", async () => {
		const messages: ClientChatMessage[] = [];
		const setPaused = vi.fn(async () => {});

		await runClientApiCommand(
			"/api",
			() => null,
			setPaused,
			(m) => messages.push(m),
		);
		expect(messages.at(-1)?.message).toContain("Inactive");

		const active: ClientApiState = {
			active: true,
			paused: false,
			endpoint: "http://127.0.0.1:42000",
		};
		await runClientApiCommand(
			"@api status",
			() => active,
			setPaused,
			(m) => messages.push(m),
		);
		expect(messages.at(-1)).toEqual({
			kind: "system",
			message: "Live API: Active (http://127.0.0.1:42000)",
		});
	});

	it("pauses and resumes active automation and rejects invalid subcommands", async () => {
		const messages: ClientChatMessage[] = [];
		let state: ClientApiState = {
			active: true,
			paused: false,
			endpoint: "http://127.0.0.1:42000",
		};
		const setPaused = vi.fn(async (paused: boolean) => {
			state = { ...state, paused };
		});

		await runClientApiCommand(
			"/api pause",
			() => state,
			setPaused,
			(m) => messages.push(m),
		);
		expect(setPaused).toHaveBeenCalledWith(true);
		expect(messages.at(-1)?.message).toBe("Live API automation paused.");

		await runClientApiCommand(
			"/api resume",
			() => state,
			setPaused,
			(m) => messages.push(m),
		);
		expect(setPaused).toHaveBeenCalledWith(false);
		expect(messages.at(-1)?.message).toBe("Live API automation resumed.");

		await runClientApiCommand(
			"/api bogus",
			() => state,
			setPaused,
			(m) => messages.push(m),
		);
		expect(messages.at(-1)?.message).toBe(
			"Usage: /api [status|pause|resume|prompt]",
		);
	});

	it("copies the concise agent prompt or falls back to chat", async () => {
		const messages: ClientChatMessage[] = [];
		const active: ClientApiState = {
			active: true,
			paused: false,
			endpoint: "http://127.0.0.1:42000",
		};
		const copied: string[] = [];

		await runClientApiCommand(
			"/api prompt",
			() => active,
			async () => {},
			(m) => messages.push(m),
			async (text) => {
				copied.push(text);
			},
		);
		expect(copied).toEqual([
			"My Asheron's Call client (Holtburger) has a local Live API at http://127.0.0.1:42000 (read GET / for the agent guide, no auth).",
		]);
		expect(messages.at(-1)?.message).toBe(
			"Copied Live API agent prompt to clipboard.",
		);

		await runClientApiCommand(
			"/api prompt",
			() => active,
			async () => {},
			(m) => messages.push(m),
			async () => {
				throw new Error("clipboard unavailable");
			},
		);
		expect(messages.at(-1)?.message).toBe(copied[0]);
	});
});
