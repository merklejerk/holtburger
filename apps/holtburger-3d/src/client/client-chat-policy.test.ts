import { describe, expect, it } from "vitest";

import {
	CLIENT_CHAT_FILTER_TAGS,
	clientChatChannelLabel,
	clientChatFiltersAllow,
	clientChatTone,
	clientChatMessageLabel,
	type ClientChatEntry,
	type ClientChatLine,
} from "./client-chat-policy";

function line(message: ClientChatEntry): ClientChatLine {
	return { ...message, id: 1, receivedAt: new Date(0) };
}

describe("client chat presentation policy", () => {
	it("preserves server text categories while keeping the existing coarse filters", () => {
		const outgoing = line({
			kind: "server",
			category: "outgoing-tell",
			message: 'You tell Mira, "hello"',
		});
		expect(clientChatMessageLabel(outgoing)).toBe("Tell");
		expect(clientChatTone(outgoing)).toBe("tell");
		expect(clientChatFiltersAllow([], outgoing)).toBe(false);
		for (const category of ["combat", "combat-enemy", "combat-self"] as const) {
			const feedback = line({
				kind: "server",
				category,
				message: "combat feedback",
			});
			expect(clientChatTone(feedback)).toBe("combat");
			expect(clientChatFiltersAllow(["chat"], feedback)).toBe(false);
			expect(clientChatFiltersAllow(["combat"], feedback)).toBe(true);
		}
		for (const category of ["fellowship", "advancement", "craft"] as const) {
			const notice = line({ kind: "server", category, message: "notice" });
			expect(clientChatFiltersAllow([], notice)).toBe(true);
			expect(clientChatMessageLabel(notice)).not.toBe("System");
		}
		const unknown = line({
			kind: "server",
			category: { raw: 0xabcdef },
			message: "unknown",
		});
		expect(clientChatMessageLabel(unknown)).toBe("Unknown type 0xABCDEF");
		expect(clientChatFiltersAllow([], unknown)).toBe(true);
	});

	it.each([
		["magic", "Magic"],
		["spellcasting", "Spellcasting"],
	] as const)(
		"filters %s with Combat while preserving its label",
		(category, label) => {
			for (const message of [
				{ kind: "server", category, message: "Spell feedback" },
				{
					kind: "speech",
					category,
					sender: "Mira",
					speakerKind: "player",
					message: "Spell feedback",
				},
			] as const) {
				const feedback = line(message);
				expect(clientChatFiltersAllow([], feedback)).toBe(false);
				expect(clientChatFiltersAllow(["chat"], feedback)).toBe(false);
				expect(clientChatFiltersAllow(["combat"], feedback)).toBe(true);
				expect(clientChatMessageLabel(feedback)).toBe(label);
			}
		},
	);

	it("labels specific channels and retains unknown numeric namespaces", () => {
		for (const [channel, label] of [
			["allegiance-broadcast", "Allegiance Broadcast"],
			["fellowship-broadcast", "Party Notice"],
			["society-celestial-hand", "Celestial Hand"],
			["society-eldrytch-web", "Eldrytch Web"],
			["society-radiant-blood", "Radiant Blood"],
		] as const) {
			expect(clientChatChannelLabel(channel)).toBe(label);
		}
		for (const channelSource of ["legacy", "turbine"] as const) {
			const message = line({
				kind: "channel",
				channel: "unknown",
				origin:
					channelSource === "legacy"
						? { kind: "legacy", channelId: 0xcafe }
						: { kind: "turbine", roomId: 0xcafe, typeId: 0x1234 },
				sender: "Mira",
				speakerKind: "unknown",
				message: "hello",
			});
			expect(clientChatMessageLabel(message)).toBe(
				channelSource === "legacy"
					? "Channel 0xCAFE"
					: "Room 0xCAFE (type 0x1234)",
			);
		}
		const npc = line({
			kind: "tell",
			category: "tell",
			target: { kind: "npc", guid: 0x80000001, name: "Professor" },
			sender: "Professor",
			speakerKind: "non-player",
			message: "Choose a level.",
		});
		expect(clientChatMessageLabel(npc)).toBe("NPC Tell");
	});
	it("combines independently enabled tags while always retaining system context", () => {
		const speech = line({
			kind: "speech",
			category: "speech",
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
		const formatted = line({
			kind: "formatted-system",
			rows: [{ indented: false, spans: [{ kind: "emphasis", text: "Help" }] }],
		});
		expect(clientChatFiltersAllow([], formatted)).toBe(true);
		expect(clientChatTone(formatted)).toBe("system");
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
					category: "speech",
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
					origin: { kind: "legacy", channelId: 2048 },
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
					origin: { kind: "turbine", roomId: 1, typeId: 1 },
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
