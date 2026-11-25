import { LOCAL_COMMANDS } from "./command-catalog";
import type { ClientApiState, ClientChatMessage } from "./host-contract";

/** Format the one-sentence starter prompt for external AI agents. */
function formatLiveApiAgentPrompt(endpoint: string): string {
	return `My Asheron's Call client (Holtburger) has a local Live API at ${endpoint} (read GET / for the agent guide, no auth).`;
}

/** Handle `/api [status|pause|resume|prompt|say MESSAGE]` and `/bot MESSAGE` locally. */
export async function runClientApiCommand(
	message: string,
	readApiState: () => ClientApiState | null,
	setAutomationPaused: (paused: boolean) => Promise<void>,
	sendApiMessage: (text: string) => Promise<void>,
	appendMessage: (message: ClientChatMessage) => void,
	copyText: (text: string) => Promise<void> = (text) =>
		navigator.clipboard.writeText(text),
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
		await dispatchUserMessage(sayMatch[1] ?? "", "/api say MESSAGE");
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
		const endpoint = state.endpoint === null ? "" : ` (${state.endpoint})`;
		appendMessage({
			kind: "system",
			message: `Live API: ${mode}${endpoint}`,
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
