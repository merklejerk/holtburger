import { APP_BUILD_LABEL } from "../app/app-build";
import type { ClientChatMessage } from "./client-host-contract";

/** Reports frontend build identity locally without requiring a game-server connection. */
export function runClientVersionCommand(
	message: string,
	appendMessage: (message: ClientChatMessage) => void,
): boolean {
	if (!/^[/@]version$/i.test(message.trim())) return false;
	appendMessage({
		kind: "system",
		message: `Holtburger ${APP_BUILD_LABEL}`,
	});
	return true;
}
