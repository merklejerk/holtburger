import type {
	ClientChatFormattedSystemMessage,
	ClientChatTextRow,
} from "./client-chat-policy";
import type { RecallDestination } from "./client-host-contract";
import { parseRecallCommand } from "./client-recall-command";
import { CHAT_CHANNEL_DESTINATIONS } from "./client-chat-compose";

/** One app-owned command's index entry and targeted explanation. */
interface CommandHelp {
	/** Canonical invocation, including arguments. */
	readonly syntax: string;
	/** Short description shared by the index and targeted help. */
	readonly description: string;
	/** Details shown only when requesting this command's help. */
	readonly details: readonly string[];
}

const DEATH_HELP = {
	corpse: {
		syntax: "/corpse",
		description: "Show the saved last outdoor death location.",
		details: [
			"The saved location does not confirm that a corpse remains or still holds items. Click its coordinates in interactive chat history to set a map pin.",
		],
	},
	corpses: {
		syntax: "/corpses",
		description: "List approximate deaths observed this session.",
		details: [
			"Locations are approximate samples and may be stale or reflect a later position. They do not confirm that corpses or items remain. History is cleared when the character session ends.",
		],
	},
	permit: {
		syntax: "/permit <player>",
		description: "Grant access to your corpse.",
		details: ["Example: /permit Best Friend"],
	},
	unpermit: {
		syntax: "/unpermit <player>",
		description: "Revoke corpse access you granted.",
		details: ["Example: /unpermit Best Friend"],
	},
	consent: {
		syntax: "/consent <operation> [player]",
		description: "Manage corpse permissions received from other players.",
		details: [
			"/consent on or off accepts or declines incoming permission grants.",
			"/consent who lists permissions other players granted you.",
			"/consent remove <player> discards one received permission.",
			"/consent clear discards all received permissions.",
		],
	},
	die: {
		syntax: "/die",
		description: "Kill your character after confirmation.",
		details: [
			"Alias: /rip. You may drop items and accrue a vitae penalty. Cancel the confirmation to keep playing.",
		],
	},
} satisfies Record<string, CommandHelp>;

const RECALL_HELP: Record<RecallDestination, CommandHelp> = {
	lifestone: {
		syntax: "/lifestone",
		description: "Return to your bound lifestone.",
		details: ["Aliases: /lif, /ls"],
	},
	marketplace: {
		syntax: "/marketplace",
		description: "Recall to the marketplace.",
		details: ["Aliases: /mar, /mp"],
	},
	"pk-arena": {
		syntax: "/pkarena",
		description: "Recall to the PK arena.",
		details: ["Alias: /pka"],
	},
	"pk-lite-arena": {
		syntax: "/pklarena",
		description: "Recall to the PK Lite arena.",
		details: ["Alias: /pla"],
	},
	house: {
		syntax: "/house recall",
		description: "Recall to your house.",
		details: ["Aliases: /hou re, /hor, /hr"],
	},
	"allegiance-housing": {
		syntax: "/house mansion_recall",
		description: "Recall to allegiance housing.",
		details: ["Aliases: /house alleg_recall, /hou ma, /hom, /hoa"],
	},
	"allegiance-hometown": {
		syntax: "/allegiance hometown",
		description: "Recall to the allegiance hometown.",
		details: ["Alias: /all ho"],
	},
};

const HELP: CommandHelp = {
	syntax: "/help [command]",
	description: "List commands or show help for one command.",
	details: [
		"Alias: /?. Examples: /help corpse, /help permit, /? consent. Commands accept either / or @.",
	],
};

const LOCAL_HELP = {
	waypoint: {
		syntax: "/waypoint [coordinates|clear]",
		description: "Show, set, or clear your map waypoint.",
		details: [
			"Alias: @wp. Example: @waypoint 42.3N, 12.7E. Use @waypoint clear to remove the pin.",
		],
	},
	loc: {
		syntax: "/loc",
		description: "Print and copy player and camera locations.",
		details: [
			"Reports cells, positions, and orientations in their coordinate frames. The report remains in chat if copying to the clipboard fails.",
		],
	},
} satisfies Record<string, CommandHelp>;

const CHAT_HELP = {
	tell: {
		syntax: "/tell <player>, <message>",
		description: "Send a private message to a player by name.",
		details: [
			"Alias: /t. Example: /tell Some Player, hello. A comma ends the name; selection never changes this route.",
		],
	},
	tellselected: {
		syntax: "/tellselected <message>",
		description: "Tell the selected player or NPC.",
		details: [
			"Alias: /ts. Snapshots the selected recipient. Players use long-distance tells; NPCs use nearby direct dialogue. Example: select a professor, then /ts level 1.",
		],
	},
	reply: {
		syntax: "/reply <message>",
		description: "Reply to the last incoming addressable teller.",
		details: [
			"Alias: /r. An NPC tell can replace the previous player reply target. Check the destination preview before sending.",
		],
	},
	retell: {
		syntax: "/retell <message>",
		description: "Tell your last outgoing recipient again.",
		details: [
			"Alias: /rt. Remembers player or NPC recipients from the picker, /tell, /ts, and /reply. A later delivery failure does not clear this recipient.",
		],
	},
	say: {
		syntax: "/say <message>",
		description: "Send local speech for this message.",
		details: [],
	},
	emote: {
		syntax: "/emote <message>",
		description: "Describe an action in local chat.",
		details: [],
	},
} satisfies Record<string, CommandHelp>;

function channelHelp(
	entry: (typeof CHAT_CHANNEL_DESTINATIONS)[number],
): CommandHelp {
	return {
		syntax: `/${entry.aliases[0]} <message>`,
		description: `Send to ${entry.label}.`,
		details: [
			`Commands: ${entry.aliases.map((alias) => `/${alias}`).join(", ")}. Destination commands override only this message; the picker choice remains unchanged. ACE enforces membership and permissions.`,
		],
	};
}

function heading(text: string): ClientChatTextRow {
	return { indented: false, spans: [{ kind: "emphasis", text }] };
}

function commandRow(command: CommandHelp): ClientChatTextRow {
	return {
		indented: true,
		spans: [
			{ kind: "code", text: command.syntax },
			{ kind: "plain", text: ` — ${command.description}` },
		],
	};
}

/** Help is frontend presentation and can run without a character-session controller. */
export function runClientHelpCommand(
	text: string,
	append: (message: ClientChatFormattedSystemMessage) => void,
): boolean {
	const match = /^[/@](?:help|\?)(?:\s+(.*))?$/is.exec(text.trim());
	if (match === null) return false;
	append(clientCommandHelp(match[1] ?? ""));
	return true;
}

/** Render the frontend's complete index or targeted help without interpreting server text. */
export function clientCommandHelp(
	rawTopic: string,
): ClientChatFormattedSystemMessage {
	const topic = rawTopic.trim().replace(/^[/@]/, "").toLowerCase();
	if (topic === "")
		return {
			kind: "formatted-system",
			rows: [
				heading("Available commands"),
				commandRow(HELP),
				heading("Chat and NPC dialogue"),
				...Object.values(CHAT_HELP).map(commandRow),
				...CHAT_CHANNEL_DESTINATIONS.map((entry) =>
					commandRow(channelHelp(entry)),
				),
				heading("Death and corpses"),
				...Object.values(DEATH_HELP).map(commandRow),
				heading("Recalls"),
				...Object.values(RECALL_HELP).map(commandRow),
				heading("Map and diagnostics"),
				...Object.values(LOCAL_HELP).map(commandRow),
				{
					indented: false,
					spans: [
						{
							kind: "plain",
							text: "Use /help <command> for details. Alias: /?. Commands accept / or @.",
						},
					],
				},
			],
		};
	if (topic === "death")
		return {
			kind: "formatted-system",
			rows: [
				heading("Death and corpse commands"),
				...Object.values(DEATH_HELP).map(commandRow),
			],
		};
	const aliases: Readonly<Record<string, string>> = {
		rip: "die",
		wp: "waypoint",
		t: "tell",
		ts: "tellselected",
		r: "reply",
		rt: "retell",
	};
	const name = aliases[topic] ?? topic;
	const direct = Object.entries({
		...DEATH_HELP,
		...LOCAL_HELP,
		...CHAT_HELP,
	}).find(([key]) => key === name)?.[1];
	const recall = parseRecallCommand(`/${topic}`);
	const channel = CHAT_CHANNEL_DESTINATIONS.find(
		(entry) =>
			entry.channel === topic ||
			entry.aliases.some((alias) => alias === topic) ||
			(entry.channel === "allegiance-broadcast" &&
				topic === "allegiance broadcast"),
	);
	const command =
		topic === "help" || topic === "?"
			? HELP
			: (direct ??
				(channel === undefined ? undefined : channelHelp(channel)) ??
				(recall === null ? undefined : RECALL_HELP[recall]));
	if (command === undefined)
		throw new Error(
			`No help available for '${rawTopic}'. Use /help to list commands.`,
		);
	return {
		kind: "formatted-system",
		rows: [
			heading("Command help"),
			commandRow(command),
			...command.details.map((text): ClientChatTextRow => ({
				indented: true,
				spans: [{ kind: "plain", text }],
			})),
		],
	};
}
