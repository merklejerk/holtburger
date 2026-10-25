import type { RecallDestination } from "./client-host-contract";
import { CHAT_CHANNEL_DESTINATIONS } from "./client-chat-compose";

/** Display facts shared by the help index and targeted help. */
export interface CommandHelp {
	/** Canonical invocation including documented parameters. */
	readonly syntax: string;
	/** Short explanation also shown by command completion. */
	readonly description: string;
	/** Additional paragraphs used only by targeted help. */
	readonly details: readonly string[];
}

/** App-owned command discovery; execution and argument validation stay with existing handlers. */
export interface ClientCommandDefinition extends CommandHelp {
	/** Canonical prefix-free invocation followed by accepted aliases, including fixed command paths. */
	readonly invocations: readonly [string, ...string[]];
}

/** Compute the help syntax once from the same names used by completion and alias lookup. */
function invocation(
	invocations: ClientCommandDefinition["invocations"],
	parameters: string,
): Pick<ClientCommandDefinition, "invocations" | "syntax"> {
	return {
		invocations,
		syntax: `/${invocations[0]}${parameters === "" ? "" : ` ${parameters}`}`,
	};
}

export const DEATH_COMMANDS = {
	corpse: {
		...invocation(["corpse"], ""),
		description: "Show the saved last outdoor death location.",
		details: [
			"The saved location does not confirm that a corpse remains or still holds items. Click its coordinates in interactive chat history to set a map pin.",
		],
	},
	corpses: {
		...invocation(["corpses"], ""),
		description: "List approximate deaths observed this session.",
		details: [
			"Locations are approximate samples and may be stale or reflect a later position. They do not confirm that corpses or items remain. History is cleared when the character session ends.",
		],
	},
	permit: {
		...invocation(["permit"], "<player>"),
		description: "Grant access to your corpse.",
		details: ["Example: /permit Best Friend"],
	},
	unpermit: {
		...invocation(["unpermit"], "<player>"),
		description: "Revoke corpse access you granted.",
		details: ["Example: /unpermit Best Friend"],
	},
	consent: {
		...invocation(["consent"], "<operation> [player]"),
		description: "Manage corpse permissions received from other players.",
		details: [
			"/consent on or off accepts or declines incoming permission grants.",
			"/consent who lists permissions other players granted you.",
			"/consent remove <player> discards one received permission.",
			"/consent clear discards all received permissions.",
		],
	},
	die: {
		...invocation(["die", "rip"], ""),
		description: "Kill your character after confirmation.",
		details: [
			"You may drop items and accrue a vitae penalty. Cancel the confirmation to keep playing.",
		],
	},
} satisfies Record<string, ClientCommandDefinition>;

export const RECALL_COMMANDS: Record<
	RecallDestination,
	ClientCommandDefinition
> = {
	lifestone: {
		...invocation(["lifestone", "lif", "ls"], ""),
		description: "Return to your bound lifestone.",
		details: [],
	},
	marketplace: {
		...invocation(["marketplace", "mar", "mp"], ""),
		description: "Recall to the marketplace.",
		details: [],
	},
	"pk-arena": {
		...invocation(["pkarena", "pka"], ""),
		description: "Recall to the PK arena.",
		details: [],
	},
	"pk-lite-arena": {
		...invocation(["pklarena", "pla"], ""),
		description: "Recall to the PK Lite arena.",
		details: [],
	},
	house: {
		...invocation(
			["house recall", "hou recall", "house re", "hou re", "hor", "hr"],
			"",
		),
		description: "Recall to your house.",
		details: [],
	},
	"allegiance-housing": {
		...invocation(
			[
				"house mansion_recall",
				"house alleg_recall",
				"house ma",
				"hou mansion_recall",
				"hou alleg_recall",
				"hou ma",
				"hom",
				"hoa",
			],
			"",
		),
		description: "Recall to allegiance housing.",
		details: [],
	},
	"allegiance-hometown": {
		...invocation(
			["allegiance hometown", "allegiance ho", "all hometown", "all ho"],
			"",
		),
		description: "Recall to the allegiance hometown.",
		details: [],
	},
};

export const HELP_COMMAND: ClientCommandDefinition = {
	...invocation(["help", "?"], "[command]"),
	description: "List commands or show help for one command.",
	details: [
		"Examples: /help corpse, /help permit, /? consent. Commands accept either / or @.",
	],
};

export const LOCAL_COMMANDS = {
	assets: {
		...invocation(["assets"], ""),
		description: "Print the active asset location.",
		details: [
			"Shows the location selected for this launch, including temporary command-line overrides. This command does not change asset sources.",
		],
	},
	waypoint: {
		...invocation(["waypoint", "wp"], "[coordinates|clear]"),
		description: "Show, set, or clear your map waypoint.",
		details: [
			"Example: @waypoint 42.3N, 12.7E. Use @waypoint clear to remove the pin.",
		],
	},
	loc: {
		...invocation(["loc"], ""),
		description: "Print and copy player and camera locations.",
		details: [
			"Reports cells, positions, and orientations in their coordinate frames. The report remains in chat if copying to the clipboard fails.",
		],
	},
} satisfies Record<string, ClientCommandDefinition>;

export const CHAT_COMMANDS = {
	tell: {
		...invocation(["tell", "t"], "<player>, <message>"),
		description: "Send a private message to a player by name.",
		details: [
			"Example: /tell Some Player, hello. A comma ends the name; selection never changes this route.",
		],
	},
	tellselected: {
		...invocation(["tellselected", "ts"], "<message>"),
		description: "Tell the selected player or NPC.",
		details: [
			"Snapshots the selected recipient. Players use long-distance tells; NPCs use nearby direct dialogue. Example: select a professor, then /ts level 1.",
		],
	},
	reply: {
		...invocation(["reply", "r"], "<message>"),
		description: "Reply to the last incoming addressable teller.",
		details: [
			"An NPC tell can replace the previous player reply target. Check the destination preview before sending.",
		],
	},
	retell: {
		...invocation(["retell", "rt"], "<message>"),
		description: "Tell your last outgoing recipient again.",
		details: [
			"Remembers player or NPC recipients from the picker, /tell, /ts, and /reply. A later delivery failure does not clear this recipient.",
		],
	},
	say: {
		...invocation(["say"], "<message>"),
		description: "Send local speech for this message.",
		details: [],
	},
	emote: {
		...invocation(["emote"], "<message>"),
		description: "Describe an action in local chat.",
		details: [],
	},
} satisfies Record<string, ClientCommandDefinition>;

function channelCommand(
	entry: (typeof CHAT_CHANNEL_DESTINATIONS)[number],
): ClientCommandDefinition {
	return {
		...invocation(
			[
				entry.aliases[0],
				...entry.aliases.slice(1),
				...(entry.channel === "allegiance-broadcast"
					? ["allegiance broadcast"]
					: []),
			],
			"<message>",
		),
		description: `Send to ${entry.label}.`,
		details: [
			"Destination commands override only this message; the picker choice remains unchanged. ACE enforces membership and permissions.",
		],
	};
}

export const SOUL_EMOTE_HELP: CommandHelp = {
	syntax: "*<emote>*",
	description: "Perform a local soul emote, such as *wave*.",
	details: [
		"Type * to discover emotes. Tab or Enter accepts a suggestion; Enter submits the completed command. Local speech can include gestures: Hello *wave*. Explicit tell/channel and /emote bodies remain literal. Hold the Open emotes binding to browse social shortcuts; release to dismiss, and click, Space, or Enter to select. The binding is rebindable in input settings. The Emotes HUD button also opens the wheel. Recent saves queued attempts on this local user profile, shared across characters and servers.",
	],
};

/** Channel identities retain non-invocable help topics without inventing executable aliases. */
export const CHANNEL_COMMANDS = CHAT_CHANNEL_DESTINATIONS.map((entry) => ({
	...channelCommand(entry),
	channel: entry.channel,
}));

/** One discovery catalog for supported command names; soul-emote syntax is a separate help entry. */
export const CLIENT_COMMANDS: readonly ClientCommandDefinition[] = [
	HELP_COMMAND,
	...Object.values(CHAT_COMMANDS),
	...CHANNEL_COMMANDS,
	...Object.values(DEATH_COMMANDS),
	...Object.values(RECALL_COMMANDS),
	...Object.values(LOCAL_COMMANDS),
];
