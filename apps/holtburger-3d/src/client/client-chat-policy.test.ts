import { describe, expect, it } from "vitest";

import {
	CLIENT_CHAT_FILTER_TAGS,
	clientChatChannelLabel,
	clientChatFiltersAllow,
	clientChatTone,
	type ClientChatErrorMessage,
	type ClientChatLine,
} from "./client-chat-policy";
import type { ClientChatMessage } from "./client-host-contract";

function line(
	message: ClientChatMessage | ClientChatErrorMessage,
): ClientChatLine {
	return { ...message, id: 1, receivedAt: new Date(0) } as ClientChatLine;
}

describe("client chat presentation policy", () => {
	it("combines independently enabled tags while always retaining system context", () => {
		const speech = line({
			kind: "speech",
			sender: "Mira",
			speakerKind: "player",
			message: "Hi",
		});
		const combat = line({
			kind: "combat",
			message: "You hit a Drudge.",
			emphasized: false,
		});
		const system = line({ kind: "system", message: "Welcome" });
		const error = line({ kind: "error", message: "Renderer failed" });

		expect(CLIENT_CHAT_FILTER_TAGS).toEqual(["chat", "combat"]);
		expect(clientChatFiltersAllow(CLIENT_CHAT_FILTER_TAGS, speech)).toBe(true);
		expect(clientChatFiltersAllow(CLIENT_CHAT_FILTER_TAGS, combat)).toBe(true);
		expect(clientChatFiltersAllow(["chat"], combat)).toBe(false);
		expect(clientChatFiltersAllow(["combat"], speech)).toBe(false);
		expect(clientChatFiltersAllow([], system)).toBe(true);
		expect(clientChatFiltersAllow([], error)).toBe(true);
	});

	it("assigns combat feedback its dedicated color family", () => {
		expect(
			clientChatTone(
				line({ kind: "combat", message: "You evade.", emphasized: false }),
			),
		).toBe("combat");
	});

	it("gives proven non-player speech its own color family", () => {
		expect(
			clientChatTone(
				line({
					kind: "speech",
					sender: "Ulgrim",
					speakerKind: "non-player",
					message: "Hrm.",
				}),
			),
		).toBe("npc");
	});

	it("uses the TUI channel color families while retaining exact channel identity", () => {
		expect(
			clientChatTone(
				line({
					kind: "channel",
					channel: "fellowship",
					sender: "Mira",
					speakerKind: "player",
					message: "Ready",
				}),
			),
		).toBe("party");
		expect(
			clientChatTone(
				line({
					kind: "channel",
					channel: "allegiance",
					sender: "Mira",
					speakerKind: "player",
					message: "Ready",
				}),
			),
		).toBe("guild");
		expect(clientChatChannelLabel("co-vassals")).toBe("Co-Vassals");
	});
});
