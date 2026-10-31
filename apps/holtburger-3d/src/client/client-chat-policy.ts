import type { ClientChatSuppressionSettings } from "./client-settings-contract";

import type {
	ClientChatChannel,
	ClientChatMessage,
	ClientChatCategory,
} from "./client-host-contract";

/** One flat app-authored text run; strings remain text rather than markup. */
type ClientChatTextSpan =
	| {
			/** Plain prose, italic emphasis, or a monospace command/example. */
			readonly kind: "plain" | "emphasis" | "code";
			/** Literal displayed text; coordinate recognition still applies during history interaction. */
			readonly text: string;
	  }
	| {
			/** Explicit app-authored entity reference; never inferred from a displayed name. */
			readonly kind: "entity";
			/** Authoritative identity captured when the message was produced. */
			readonly guid: number;
			/** Historical display name, retained even after the entity disappears. */
			readonly text: string;
	  };

/** One displayed row, with a single optional indentation step for command descriptions. */
export interface ClientChatTextRow {
	/** Indent the complete row, including wrapped text. */
	readonly indented: boolean;
	/** Ordered text runs; no nested formatting or duplicated plain-text representation. */
	readonly spans: readonly ClientChatTextSpan[];
}

/** App-local formatted response; the host and server chat contracts remain plain text. */
export interface ClientChatFormattedSystemMessage {
	readonly kind: "formatted-system";
	/** All rows belong to one retained message and share its timestamp. */
	readonly rows: readonly ClientChatTextRow[];
}

/** Frontend presentation input before assigning retention identity and display time. */
export type ClientChatEntry =
	ClientChatMessage | ClientChatFormattedSystemMessage;

/** Retained chat line with app-local ordering and display time. */
export type ClientChatLine = ClientChatEntry & {
	readonly id: number;
	readonly receivedAt: Date;
	/** Originating composer lifetime; retained entity links reject later character/session generations. */
	readonly generation: number;
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

/** Labels preserve specific server meaning; generic notices and local chat need no prefix. */
const CHAT_CATEGORY_LABELS: Readonly<
	Record<Extract<ClientChatCategory, string>, string | null>
> = {
	broadcast: null,
	"all-channels": "All Channels",
	speech: null,
	tell: "Tell",
	"outgoing-tell": "Tell",
	system: null,
	combat: "Combat",
	magic: "Magic",
	channel: "Channel",
	"channel-send": "Channel →",
	social: "Social",
	"social-send": "Social →",
	emote: "Emote",
	advancement: "Advancement",
	abuse: "Abuse",
	help: "Help",
	appraisal: "Appraisal",
	spellcasting: "Spellcasting",
	allegiance: "Allegiance Notice",
	fellowship: "Party Notice",
	"world-broadcast": "World Broadcast",
	"combat-enemy": "Combat Enemy",
	"combat-self": "Combat Self",
	recall: "Recall",
	craft: "Crafting",
	salvaging: "Salvaging",
	"admin-tell": "Admin Tell",
};

/** Coarse UI family follows category semantics rather than the enclosing packet shape. */
function categoryFilter(
	category: ClientChatCategory,
): ClientChatFilterTag | null {
	if (typeof category !== "string") return null;
	switch (category) {
		case "combat":
		case "combat-enemy":
		case "combat-self":
		case "magic":
		case "spellcasting":
			return "combat";
		case "speech":
		case "tell":
		case "outgoing-tell":
		case "admin-tell":
		case "channel":
		case "channel-send":
		case "social":
		case "social-send":
		case "emote":
			return "chat";
		default:
			return null;
	}
}

function categoryTone(category: ClientChatCategory): ClientChatTone {
	if (typeof category !== "string") return "system";
	switch (category) {
		case "combat":
		case "combat-enemy":
		case "combat-self":
			return "combat";
		case "tell":
		case "outgoing-tell":
		case "admin-tell":
			return "tell";
		case "fellowship":
			return "party";
		case "allegiance":
			return "guild";
		case "speech":
			return "speech";
		case "emote":
			return "emote";
		default:
			return "system";
	}
}

/** Optional buffer label; emotes read as actions and local chat omits its category. */
export function clientChatMessageLabel(line: ClientChatLine): string | null {
	if (line.kind === "channel") {
		if (line.channel !== "unknown") return clientChatChannelLabel(line.channel);
		const origin = line.origin;
		return origin.kind === "legacy"
			? `Channel 0x${origin.channelId.toString(16).toUpperCase()}`
			: `Room 0x${origin.roomId.toString(16).toUpperCase()} (type 0x${origin.typeId.toString(16).toUpperCase()})`;
	}
	if ("category" in line) {
		const label =
			typeof line.category === "string"
				? CHAT_CATEGORY_LABELS[line.category]
				: `Unknown type 0x${line.category.raw.toString(16).toUpperCase()}`;
		if ("speakerKind" in line && line.speakerKind === "non-player")
			return label === null ? "NPC" : `NPC ${label}`;
		return label;
	}
	switch (line.kind) {
		case "emote":
		case "soul-emote":
			return null;
		case "combat":
			return "Combat";
		case "error":
			return "Error";
		case "system":
		case "formatted-system":
			return null;
	}
}

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
		case "formatted-system":
		case "system":
		case "error":
			return true;
		case "combat":
			return enabledTags.includes("combat");
		case "speech":
		case "server": {
			const tag = categoryFilter(line.category);
			return tag === null || enabledTags.includes(tag);
		}
		case "tell":
		case "emote":
		case "soul-emote":
			return enabledTags.includes("chat");
		case "channel":
			return (
				line.channel === "fellowship-broadcast" || enabledTags.includes("chat")
			);
	}
}

export function clientChatTone(line: ClientChatLine): ClientChatTone {
	if ("speakerKind" in line && line.speakerKind === "non-player") {
		return "npc";
	}
	switch (line.kind) {
		case "speech":
		case "server":
			return categoryTone(line.category);
		case "tell":
			return "tell";
		case "emote":
		case "soul-emote":
			return "emote";
		case "combat":
			return "combat";
		case "formatted-system":
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
		case "fellowship-broadcast":
			return "Party Notice";
		case "allegiance":
			return "Allegiance";
		case "allegiance-broadcast":
			return "Allegiance Broadcast";
		case "society-celestial-hand":
			return "Celestial Hand";
		case "society-eldrytch-web":
			return "Eldrytch Web";
		case "society-radiant-blood":
			return "Radiant Blood";
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
		case "fellowship-broadcast":
			return "party";
		case "allegiance":
		case "allegiance-broadcast":
		case "vassals":
		case "patron":
		case "monarch":
		case "co-vassals":
			return "guild";
		case "trade":
			return "trade";
		case "society":
		case "society-celestial-hand":
		case "society-eldrytch-web":
		case "society-radiant-blood":
			return "society";
		case "general":
		case "lfg":
		case "roleplay":
		case "olthoi":
		case "unknown":
			return "speech";
	}
}

/** Admission policy runs before retention, independently of the history visibility toggles. */
export function clientChatShouldSuppress(
	settings: ClientChatSuppressionSettings,
	message: ClientChatEntry,
): boolean {
	if (
		settings.hideSpellIncantations &&
		"category" in message &&
		message.category === "spellcasting"
	)
		return true;
	if (!settings.hideSelfEvasionsAndResists) return false;
	if (message.kind === "combat") return message.selfEvasion;
	// ACE WorldObject_Magic.cs:199 sends self resistance as Magic system chat, without punctuation.
	// Restrict to that source/category and require a caster name; ordinary speech must survive.
	return (
		message.kind === "server" &&
		message.category === "magic" &&
		message.message.startsWith("You resist the spell cast by ") &&
		message.message.length > "You resist the spell cast by ".length
	);
}
