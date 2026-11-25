import { describe, expect, it, vi } from "vitest";
import { runClientApiCommand } from "./api-command";
import type { ClientApiState, ClientChatMessage } from "./host-contract";

describe("runClientApiCommand", () => {
	const noopSend = async () => {};

	it("ignores unrelated messages", async () => {
		const messages: ClientChatMessage[] = [];
		const setPaused = vi.fn(async () => {});
		const sendMessage = vi.fn(async () => {});
		const handled = await runClientApiCommand(
			"/scan drudge",
			() => null,
			setPaused,
			sendMessage,
			(m) => messages.push(m),
		);
		expect(handled).toBe(false);
		expect(messages).toEqual([]);
		expect(setPaused).not.toHaveBeenCalled();
		expect(sendMessage).not.toHaveBeenCalled();
	});

	it("reports inactive, active, and paused status", async () => {
		const messages: ClientChatMessage[] = [];
		const setPaused = vi.fn(async () => {});

		await runClientApiCommand(
			"/api",
			() => null,
			setPaused,
			noopSend,
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
			noopSend,
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
			noopSend,
			(m) => messages.push(m),
		);
		expect(setPaused).toHaveBeenCalledWith(true);
		expect(messages.at(-1)?.message).toBe("Live API automation paused.");

		await runClientApiCommand(
			"/api resume",
			() => state,
			setPaused,
			noopSend,
			(m) => messages.push(m),
		);
		expect(setPaused).toHaveBeenCalledWith(false);
		expect(messages.at(-1)?.message).toBe("Live API automation resumed.");

		await runClientApiCommand(
			"/api bogus",
			() => state,
			setPaused,
			noopSend,
			(m) => messages.push(m),
		);
		expect(messages.at(-1)?.message).toBe(
			"Usage: /api [status|pause|resume|clear|mute [on|off]|prompt|say <message>]",
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
			noopSend,
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
			noopSend,
			(m) => messages.push(m),
			async () => {
				throw new Error("clipboard unavailable");
			},
		);
		expect(messages.at(-1)?.message).toBe(copied[0]);
	});

	it("sends local user messages via /api say and /bot preserving case", async () => {
		const messages: ClientChatMessage[] = [];
		const sent: string[] = [];
		const active: ClientApiState = {
			active: true,
			paused: true,
			endpoint: "http://127.0.0.1:42000",
		};
		const sendMessage = vi.fn(async (text: string) => {
			sent.push(text);
		});

		await runClientApiCommand(
			"/api say Switch to Fire Wand",
			() => active,
			async () => {},
			sendMessage,
			(m) => messages.push(m),
		);
		expect(sent).toEqual(["Switch to Fire Wand"]);
		expect(messages.at(-1)).toEqual({
			kind: "system",
			message: "[API] You: Switch to Fire Wand",
		});

		await runClientApiCommand(
			"@bot Wait at Holtburg Lifestone",
			() => active,
			async () => {},
			sendMessage,
			(m) => messages.push(m),
		);
		expect(sent).toEqual(["Switch to Fire Wand", "Wait at Holtburg Lifestone"]);
		expect(messages.at(-1)).toEqual({
			kind: "system",
			message: "[API] You: Wait at Holtburg Lifestone",
		});

		await runClientApiCommand(
			"/bot   ",
			() => active,
			async () => {},
			sendMessage,
			(m) => messages.push(m),
		);
		expect(messages.at(-1)?.message).toBe("Usage: /bot <message>");

		await runClientApiCommand(
			"/bot hello",
			() => null,
			async () => {},
			sendMessage,
			(m) => messages.push(m),
		);
		expect(messages.at(-1)).toEqual({
			kind: "error",
			message: "Live API is not active for this launch.",
		});
	});

	it("clears overlays and toggles/sets session-local audio mute with status reflection", async () => {
		const messages: ClientChatMessage[] = [];
		const active: ClientApiState = {
			active: true,
			paused: false,
			endpoint: "http://127.0.0.1:42000",
		};
		let muted = false;
		let hadOverlays = true;
		const controls = {
			clearOverlays: () => {
				const prev = hadOverlays;
				hadOverlays = false;
				return prev;
			},
			isAudioMuted: () => muted,
			setAudioMuted: (next: boolean) => {
				muted = next;
			},
		};

		await runClientApiCommand(
			"/api clear",
			() => active,
			async () => {},
			noopSend,
			(m) => messages.push(m),
			undefined,
			controls,
		);
		expect(messages.at(-1)?.message).toBe("Cleared Live API overlays.");

		await runClientApiCommand(
			"/api clear",
			() => active,
			async () => {},
			noopSend,
			(m) => messages.push(m),
			undefined,
			controls,
		);
		expect(messages.at(-1)?.message).toBe("No active Live API overlays.");

		await runClientApiCommand(
			"/api mute",
			() => active,
			async () => {},
			noopSend,
			(m) => messages.push(m),
			undefined,
			controls,
		);
		expect(muted).toBe(true);
		expect(messages.at(-1)?.message).toBe(
			"Live API audio cues muted for this session.",
		);

		await runClientApiCommand(
			"/api status",
			() => active,
			async () => {},
			noopSend,
			(m) => messages.push(m),
			undefined,
			controls,
		);
		expect(messages.at(-1)?.message).toBe(
			"Live API: Active · Audio muted (http://127.0.0.1:42000)",
		);

		await runClientApiCommand(
			"/api mute off",
			() => active,
			async () => {},
			noopSend,
			(m) => messages.push(m),
			undefined,
			controls,
		);
		expect(muted).toBe(false);
		expect(messages.at(-1)?.message).toBe("Live API audio cues unmuted.");
	});
});
