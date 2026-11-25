import { LOCAL_COMMANDS } from "./command-catalog";
import type { ClientApiState, ClientChatMessage } from "./host-contract";

/** Format the one-sentence starter prompt for external AI agents. */
function formatLiveApiAgentPrompt(endpoint: string): string {
	return `My Asheron's Call client (Holtburger) has a local Live API at ${endpoint} (read GET / for the agent guide, no auth).`;
}

export interface ClientApiLocalHudControls {
	/** Clears all active Live API 3D world markers and entity callouts; returns true if any existed. */
	readonly clearOverlays: () => boolean;
	/** Returns whether session-local Live API audio cues are currently muted. */
	readonly isAudioMuted: () => boolean;
	/** Updates session-local Live API audio cue mute state. */
	readonly setAudioMuted: (muted: boolean) => void;
}

/** Handle `/api [status|pause|resume|clear|mute [on|off]|prompt|say MESSAGE]` and `/bot MESSAGE` locally. */
export async function runClientApiCommand(
	message: string,
	readApiState: () => ClientApiState | null,
	setAutomationPaused: (paused: boolean) => Promise<void>,
	sendApiMessage: (text: string) => Promise<void>,
	appendMessage: (message: ClientChatMessage) => void,
	copyText: (text: string) => Promise<void> = (text) =>
		navigator.clipboard.writeText(text),
	hudControls?: ClientApiLocalHudControls,
): Promise<boolean> {
	const trimmed = message.trim();
	const botMatch = /^[/@]bot(?:\s+([\s\S]*))?$/i.exec(trimmed);
	const apiMatch =
		botMatch === null ? /^[/@]api(?:\s+([\s\S]*))?$/i.exec(trimmed) : null;
	if (botMatch === null && apiMatch === null) return false;

	const state = readApiState();

	async function dispatchUserMessage(rawText: string, usage: string) {
		const text = rawText.trim();
		if (text === "") {
			appendMessage({ kind: "system", message: `Usage: ${usage}` });
			return;
		}
		if (state === null || !state.active) {
			appendMessage({
				kind: "error",
				message: "Live API is not active for this launch.",
			});
			return;
		}
		await sendApiMessage(text);
		appendMessage({ kind: "system", message: `[API] You: ${text}` });
	}

	if (botMatch !== null) {
		await dispatchUserMessage(botMatch[1] ?? "", LOCAL_COMMANDS.bot.syntax);
		return true;
	}

	const rawArg = (apiMatch?.[1] ?? "").trim();
	const sayMatch = /^say(?:\s+([\s\S]*))?$/i.exec(rawArg);
	if (sayMatch !== null) {
		await dispatchUserMessage(sayMatch[1] ?? "", "/api say <message>");
		return true;
	}

	const subcommand = rawArg.toLowerCase();

	if (subcommand === "" || subcommand === "status") {
		if (state === null || !state.active) {
			appendMessage({
				kind: "system",
				message:
					"Live API: Inactive (enable in Settings -> Live API or launch with --api).",
			});
			return true;
		}
		const mode = state.paused ? "Paused" : "Active";
		const audioNote = hudControls?.isAudioMuted() ? " · Audio muted" : "";
		const endpoint = state.endpoint === null ? "" : ` (${state.endpoint})`;
		appendMessage({
			kind: "system",
			message: `Live API: ${mode}${audioNote}${endpoint}`,
		});
		return true;
	}

	if (subcommand === "clear") {
		if (state === null || !state.active) {
			appendMessage({
				kind: "error",
				message: "Live API is not active for this launch.",
			});
			return true;
		}
		const removed = hudControls?.clearOverlays() ?? false;
		appendMessage({
			kind: "system",
			message: removed
				? "Cleared Live API overlays."
				: "No active Live API overlays.",
		});
		return true;
	}

	const muteMatch = /^mute(?:\s+(on|off))?$/i.exec(rawArg);
	if (muteMatch !== null) {
		if (state === null || !state.active) {
			appendMessage({
				kind: "error",
				message: "Live API is not active for this launch.",
			});
			return true;
		}
		const currentlyMuted = hudControls?.isAudioMuted() ?? false;
		const arg = muteMatch[1]?.toLowerCase();
		const targetMuted =
			arg === "on" ? true : arg === "off" ? false : !currentlyMuted;
		if (currentlyMuted === targetMuted && arg !== undefined) {
			appendMessage({
				kind: "system",
				message: targetMuted
					? "Live API audio cues are already muted."
					: "Live API audio cues are already unmuted.",
			});
			return true;
		}
		hudControls?.setAudioMuted(targetMuted);
		appendMessage({
			kind: "system",
			message: targetMuted
				? "Live API audio cues muted for this session."
				: "Live API audio cues unmuted.",
		});
		return true;
	}

	if (subcommand === "prompt") {
		if (state === null || !state.active || state.endpoint === null) {
			appendMessage({
				kind: "error",
				message: "Live API is not active for this launch.",
			});
			return true;
		}
		const prompt = formatLiveApiAgentPrompt(state.endpoint);
		try {
			await copyText(prompt);
			appendMessage({
				kind: "system",
				message: "Copied Live API agent prompt to clipboard.",
			});
		} catch {
			appendMessage({ kind: "system", message: prompt });
		}
		return true;
	}

	if (subcommand === "pause" || subcommand === "resume") {
		const targetPaused = subcommand === "pause";
		if (state === null || !state.active) {
			appendMessage({
				kind: "error",
				message: "Live API is not active for this launch.",
			});
			return true;
		}
		if (state.paused === targetPaused) {
			appendMessage({
				kind: "system",
				message: targetPaused
					? "Live API automation is already paused."
					: "Live API automation is already active.",
			});
			return true;
		}
		await setAutomationPaused(targetPaused);
		appendMessage({
			kind: "system",
			message: targetPaused
				? "Live API automation paused."
				: "Live API automation resumed.",
		});
		return true;
	}

	appendMessage({
		kind: "system",
		message: `Usage: ${LOCAL_COMMANDS.api.syntax}`,
	});
	return true;
}
