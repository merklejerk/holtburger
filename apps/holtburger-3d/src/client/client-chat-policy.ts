import type {
	ClientChatChannel,
	ClientChatMessage,
} from "./client-host-contract";

/** Frontend-authored diagnostic line routed to the durable chat surface. */
export interface ClientChatErrorMessage {
	readonly kind: "error";
	readonly message: string;
}

/** Retained chat line with app-local ordering and display time. */
export type ClientChatLine = (ClientChatMessage | ClientChatErrorMessage) & {
	readonly id: number;
	readonly receivedAt: Date;
};

/** Independently toggleable message family in the combined chat buffer. */
export type ClientChatFilterTag = "chat" | "combat";

/** Semantic color role derived once from message and named-channel identity. */
export type ClientChatTone =
	| "speech"
	| "npc"
	| "tell"
	| "emote"
	| "combat"
	| "system"
	| "error"
	| "party"
	| "guild"
	| "trade"
	| "society";

/** Stable filter order; every optional message family starts visible. */
export const CLIENT_CHAT_FILTER_TAGS: readonly ClientChatFilterTag[] = [
	"chat",
	"combat",
];

export function clientChatFilterLabel(tag: ClientChatFilterTag): string {
	switch (tag) {
		case "chat":
			return "Chat";
		case "combat":
			return "Combat";
	}
}

/** System and error context is unconditional; tagged families follow their independent toggles. */
export function clientChatFiltersAllow(
	enabledTags: readonly ClientChatFilterTag[],
	line: ClientChatLine,
): boolean {
	switch (line.kind) {
		case "system":
		case "error":
			return true;
		case "combat":
			return enabledTags.includes("combat");
		case "speech":
		case "tell":
		case "channel":
		case "emote":
			return enabledTags.includes("chat");
	}
}

export function clientChatTone(line: ClientChatLine): ClientChatTone {
	if ("speakerKind" in line && line.speakerKind === "non-player") {
		return "npc";
	}
	switch (line.kind) {
		case "speech":
			return "speech";
		case "tell":
			return "tell";
		case "emote":
			return "emote";
		case "combat":
			return "combat";
		case "system":
			return "system";
		case "error":
			return "error";
		case "channel":
			return channelTone(line.channel);
	}
}

export function clientChatChannelLabel(channel: ClientChatChannel): string {
	switch (channel) {
		case "fellowship":
			return "Party";
		case "allegiance":
			return "Guild";
		case "co-vassals":
			return "Co-Vassals";
		case "lfg":
			return "LFG";
		case "vassals":
		case "patron":
		case "monarch":
		case "general":
		case "trade":
		case "roleplay":
		case "society":
		case "olthoi":
			return channel[0]!.toUpperCase() + channel.slice(1);
		case "unknown":
			return "Unknown";
	}
}

function channelTone(channel: ClientChatChannel): ClientChatTone {
	switch (channel) {
		case "fellowship":
			return "party";
		case "allegiance":
		case "vassals":
		case "patron":
		case "monarch":
		case "co-vassals":
			return "guild";
		case "trade":
			return "trade";
		case "society":
			return "society";
		case "general":
		case "lfg":
		case "roleplay":
		case "olthoi":
		case "unknown":
			return "speech";
	}
}
