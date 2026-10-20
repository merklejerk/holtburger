import type {
	ClientChatFormattedSystemMessage,
	ClientChatTextRow,
} from "./client-chat-policy";
import { parseRecallCommand } from "./client-recall-command";
import {
	CLIENT_COMMANDS,
	HELP_COMMAND,
	DEATH_COMMANDS,
	RECALL_COMMANDS,
	LOCAL_COMMANDS,
	CHAT_COMMANDS,
	CHANNEL_COMMANDS,
	SOUL_EMOTE_HELP,
	type CommandHelp,
} from "./client-command-catalog";

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
	const normalized = rawTopic.trim().replace(/^[/@]/, "").toLowerCase();
	const topic =
		/^\*[^*]+\*$/.test(normalized) || normalized === "emotes"
			? "soulemotes"
			: normalized;
	if (topic === "")
		return {
			kind: "formatted-system",
			rows: [
				heading("Available commands"),
				commandRow(HELP_COMMAND),
				heading("Chat and NPC dialogue"),
				commandRow(SOUL_EMOTE_HELP),
				...Object.values(CHAT_COMMANDS).map(commandRow),
				...CHANNEL_COMMANDS.map(commandRow),
				heading("Death and corpses"),
				...Object.values(DEATH_COMMANDS).map(commandRow),
				heading("Recalls"),
				...Object.values(RECALL_COMMANDS).map(commandRow),
				heading("Map and diagnostics"),
				...Object.values(LOCAL_COMMANDS).map(commandRow),
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
				...Object.values(DEATH_COMMANDS).map(commandRow),
			],
		};
	const direct = CLIENT_COMMANDS.find((command) =>
		command.invocations.includes(topic),
	);
	const recall = direct === undefined ? parseRecallCommand(`/${topic}`) : null;
	const definition =
		direct ??
		CHANNEL_COMMANDS.find((entry) => entry.channel === topic) ??
		(recall === null ? undefined : RECALL_COMMANDS[recall]);
	const command = topic === "soulemotes" ? SOUL_EMOTE_HELP : definition;
	if (command === undefined)
		throw new Error(
			`No help available for '${rawTopic}'. Use /help to list commands.`,
		);
	return {
		kind: "formatted-system",
		rows: [
			heading("Command help"),
			commandRow(command),
			...(definition !== undefined && definition.invocations.length > 1
				? [
						`Aliases: ${definition.invocations
							.slice(1)
							.map((name) => `/${name}`)
							.join(", ")}`,
					]
				: []
			)
				.concat(command.details)
				.map((text): ClientChatTextRow => ({
					indented: true,
					spans: [{ kind: "plain", text }],
				})),
		],
	};
}
