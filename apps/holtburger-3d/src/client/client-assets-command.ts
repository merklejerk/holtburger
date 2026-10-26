import type { ClientChatMessage } from "./client-host-contract";

/** Reports the admitted launch selection locally, without sending a game-server command. */
export function runClientAssetsCommand(
	message: string,
	contentLocation: string | null,
	appendMessage: (message: ClientChatMessage) => void,
): boolean {
	if (!/^[/@]assets$/i.test(message.trim())) return false;
	appendMessage({
		kind: "system",
		message:
			contentLocation === null
				? "Asset location is unavailable."
				: `Assets: ${contentLocation}`,
	});
	return true;
}
