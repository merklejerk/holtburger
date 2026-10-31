import type { ClientChatMessage } from "./client-host-contract";
import { formatError } from "../lib/format-error";

/** Reports the admitted launch selection locally, without sending a game-server command. */
export function runClientAssetsCommand(
	message: string,
	contentLocation: string | null,
	appendMessage: (message: ClientChatMessage) => void,
	retryPresentation: () => Promise<void>,
): boolean {
	if (/^[/@]assets\s+retry$/i.test(message.trim())) {
		void retryPresentation().then(
			() =>
				appendMessage({
					kind: "system",
					message:
						"Retried failed presentation content using the active asset location.",
				}),
			(error: unknown) =>
				appendMessage({
					kind: "system",
					message: `Asset retry failed: ${formatError(error)}`,
				}),
		);
		return true;
	}
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
