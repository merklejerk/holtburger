import type {
	ClientChatFormattedSystemMessage,
	ClientChatTextRow,
} from "./client-chat-policy";
import type { RecallDestination } from "./client-host-contract";
import { parseRecallCommand } from "./client-recall-command";

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
	const name = topic === "rip" ? "die" : topic === "wp" ? "waypoint" : topic;
	const direct = Object.entries({ ...DEATH_HELP, ...LOCAL_HELP }).find(
		([key]) => key === name,
	)?.[1];
	const recall = parseRecallCommand(`/${topic}`);
	const command =
		topic === "help" || topic === "?"
			? HELP
			: (direct ?? (recall === null ? undefined : RECALL_HELP[recall]));
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
