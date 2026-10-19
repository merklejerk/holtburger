import type {
	ClientChatChannel,
	ClientChatMessage,
	ClientChatCategory,
} from "./client-host-contract";

/** One flat app-authored text run; strings remain text rather than markup. */
interface ClientChatTextSpan {
	/** Plain prose, italic emphasis, or a monospace command/example. */
	readonly kind: "plain" | "emphasis" | "code";
	/** Literal displayed text; coordinate recognition still applies during history interaction. */
	readonly text: string;
}

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

/** Labels preserve server meaning without adding new persisted filter groups. */
const CHAT_CATEGORY_LABELS: Readonly<
	Record<Extract<ClientChatCategory, string>, string>
> = {
	broadcast: "Broadcast",
	"all-channels": "All Channels",
	speech: "Local",
	tell: "Tell",
	"outgoing-tell": "Tell",
	system: "System",
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

/** Every line has a readable label independently of its color. */
export function clientChatMessageLabel(line: ClientChatLine): string {
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
		return "speakerKind" in line && line.speakerKind === "non-player"
			? `NPC ${label}`
			: label;
	}
	switch (line.kind) {
		case "emote":
			return "Emote";
		case "soul-emote":
			return "Soul Emote";
		case "combat":
			return "Combat";
		case "error":
			return "Error";
		case "system":
		case "formatted-system":
			return "System";
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
