import type { ClientEntityFacts } from "./client-entity-mirror";
import type {
	ClientChatDestination,
	ClientChatRequest,
	ClientChatTellTarget,
} from "./client-host-contract";

/** A completed persistent choice; a temporarily edited recipient is kept in the component. */
export type ChatSendDestination =
	| { readonly kind: "speech" }
	| { readonly kind: "tell"; readonly target: ClientChatTellTarget }
	| { readonly kind: "channel"; readonly channel: ClientChatDestination };

/** Selection admission reuses world-owned creature and player classification. */
export type ChatSelection =
	| { readonly kind: "none" | "pending" | "ineligible" }
	| { readonly kind: "target"; readonly target: ClientChatTellTarget };

/** Full destination wording and its compact button presentation are resolved together. */
interface ChatComposeLabels {
	/** Full name retained for tooltips and accessible context. */
	readonly label: string;
	/** Abbreviated destination text shown beside the chat icon. */
	readonly buttonLabel: string;
	/** Effective private versus public messaging, including incomplete tell commands. */
	readonly buttonIcon: "speech" | "tell";
}

/** One resolution feeds both destination preview and submission. */
export type ChatComposeResolution = ChatComposeLabels &
	(
		| { readonly kind: "send"; readonly request: ClientChatRequest }
		| { readonly kind: "app-command" }
		| { readonly kind: "error"; readonly message: string }
	);

/** Only session-local convenience facts enter command resolution. */
export interface ChatComposeContext {
	/** The picker retains its completed destination until a recipient dialog commits. */
	readonly destination: ChatSendDestination;
	readonly reply: ClientChatTellTarget | null;
	readonly retell: ClientChatTellTarget | null;
	readonly selection: ChatSelection;
}

/** Shared picker/help/command vocabulary. Retail channel aliases: acclient.c:405475-406080, 408170-408800. */
export const CHAT_CHANNEL_DESTINATIONS = [
	{
		channel: "fellowship",
		label: "Party",
		buttonLabel: "Pty",
		aliases: ["f", "fellowship", "party"],
	},
	{
		channel: "allegiance",
		label: "Allegiance",
		buttonLabel: "Alleg",
		aliases: ["a", "guild", "gu"],
	},
	{
		channel: "allegiance-broadcast",
		label: "Allegiance Broadcast",
		buttonLabel: "Alleg BC",
		aliases: ["ab"],
	},
	{
		channel: "vassals",
		label: "Vassals",
		buttonLabel: "Vas",
		aliases: ["v", "vassals"],
	},
	{
		channel: "patron",
		label: "Patron",
		buttonLabel: "Pat",
		aliases: ["p", "patron"],
	},
	{
		channel: "monarch",
		label: "Monarch",
		buttonLabel: "Mon",
		aliases: ["m", "monarch"],
	},
	{
		channel: "co-vassals",
		label: "Co-Vassals",
		buttonLabel: "CoV",
		aliases: ["c", "co-vassals"],
	},
	{
		channel: "general",
		label: "General",
		buttonLabel: "Gen",
		aliases: ["general", "cg"],
	},
	{
		channel: "trade",
		label: "Trade",
		buttonLabel: "Trd",
		aliases: ["trade", "ct"],
	},
	{
		channel: "lfg",
		label: "LFG",
		buttonLabel: "LFG",
		aliases: ["lfg", "clfg"],
	},
	{
		channel: "roleplay",
		label: "Roleplay",
		buttonLabel: "RP",
		aliases: ["roleplay", "crp"],
	},
	{
		channel: "society",
		label: "Society",
		buttonLabel: "Soc",
		aliases: ["society", "soc"],
	},
	{
		channel: "olthoi",
		label: "Olthoi",
		buttonLabel: "Olth",
		aliases: ["olthoi", "o"],
	},
] as const satisfies readonly {
	readonly channel: ClientChatDestination;
	readonly label: string;
	/** Compact wording is used only by the composer button. */
	readonly buttonLabel: string;
	readonly aliases: readonly string[];
}[];

/** A label also identifies NPC targeting before submission; it never controls routing. */
function tellTargetLabels(target: ClientChatTellTarget): ChatComposeLabels {
	const recipient = `${target.name}${target.kind === "npc" ? " (NPC)" : ""}`;
	return {
		label: `Tell → ${recipient}`,
		buttonLabel: target.name,
		buttonIcon: "tell",
	};
}

function chatDestinationLabels(
	destination: ChatSendDestination,
): ChatComposeLabels {
	switch (destination.kind) {
		case "speech":
			return { label: "Local", buttonLabel: "Say", buttonIcon: "speech" };
		case "tell":
			return tellTargetLabels(destination.target);
		case "channel": {
			const definition = CHAT_CHANNEL_DESTINATIONS.find(
				(entry) => entry.channel === destination.channel,
			);
			if (definition === undefined)
				throw new Error("Chat destination is missing its definition.");
			return {
				label: definition.label,
				buttonLabel: definition.buttonLabel,
				buttonIcon: "speech",
			};
		}
	}
}

/** No raw ID ranges, packet flags, nearby-name lookup, or map-color inference enters this action. */
export function selectedChatRecipient(
	guid: number | null,
	record: ClientEntityFacts | undefined,
): ChatSelection {
	if (guid === null) return { kind: "none" };
	if (record === undefined || record.description.kind === "pending")
		return { kind: "pending" };
	if (record.targeting !== "creature") return { kind: "ineligible" };
	const name = record.description.name;
	if (name.trim().length === 0) return { kind: "pending" };
	return {
		kind: "target",
		target:
			record.description.mapCategory === "player"
				? { kind: "player", name }
				: { kind: "npc", guid: record.guid, name },
	};
}

function error(
	labels: ChatComposeLabels,
	message: string,
): ChatComposeResolution {
	return { kind: "error", ...labels, message };
}

function send(
	destination: ChatSendDestination,
	message: string,
): ChatComposeResolution {
	const labels = chatDestinationLabels(destination);
	return message.length === 0
		? error(labels, "Chat message must contain visible text.")
		: { kind: "send", ...labels, request: { ...destination, message } };
}

/** Chat commands override one message; unrecognized commands remain with the existing app dispatcher. */
export function resolveChatCompose(
	text: string,
	context: ChatComposeContext,
): ChatComposeResolution {
	const trimmed = text.trim();
	const command = /^[/@](\S+)(?:\s+([\s\S]*))?$/.exec(trimmed);
	if (command === null) {
		if (trimmed.startsWith("@") || trimmed.startsWith("/"))
			return {
				kind: "app-command",
				label: "Command",
				buttonLabel: "Cmd",
				buttonIcon: "speech",
			};
		return send(context.destination, trimmed);
	}
	const verb = command[1].toLowerCase();
	const body = (command[2] ?? "").trim();
	if (verb === "t" || verb === "tell") {
		const comma = body.indexOf(",");
		if (comma < 0)
			return error(
				{
					label: "Tell (recipient required)",
					buttonLabel: "Tell…",
					buttonIcon: "tell",
				},
				"Usage: /tell <player name>, <message>",
			);
		const name = body.slice(0, comma).trim();
		if (name.length === 0)
			return error(
				{
					label: "Tell (recipient required)",
					buttonLabel: "Tell…",
					buttonIcon: "tell",
				},
				"Tell recipient name must contain visible text.",
			);
		return send(
			{ kind: "tell", target: { kind: "player", name } },
			body.slice(comma + 1).trim(),
		);
	}
	if (verb === "ts" || verb === "tellselected") {
		switch (context.selection.kind) {
			case "none":
				return error(
					{ label: "Tell selected", buttonLabel: "T sel.", buttonIcon: "tell" },
					"Select a player or NPC before using /tellselected.",
				);
			case "pending":
				return error(
					{ label: "Tell selected", buttonLabel: "T sel.", buttonIcon: "tell" },
					"The selected entity's description is not available yet.",
				);
			case "ineligible":
				return error(
					{ label: "Tell selected", buttonLabel: "T sel.", buttonIcon: "tell" },
					"The selected entity cannot receive a tell.",
				);
			case "target":
				return send({ kind: "tell", target: context.selection.target }, body);
		}
	}
	if (verb === "r" || verb === "reply" || verb === "rt" || verb === "retell") {
		const reply = verb === "r" || verb === "reply";
		const target = reply ? context.reply : context.retell;
		return target === null
			? error(
					{
						label: reply ? "Reply" : "Retell",
						buttonLabel: reply ? "R" : "RT",
						buttonIcon: "tell",
					},
					reply
						? "No incoming tell to reply to yet."
						: "No outgoing tell destination to retell yet.",
				)
			: send({ kind: "tell", target }, body);
	}
	if (verb === "say") return send({ kind: "speech" }, body);
	if (verb === "emote")
		return body.length === 0
			? error(
					{ label: "Emote", buttonLabel: "Em", buttonIcon: "speech" },
					"Emote text must contain visible text.",
				)
			: {
					kind: "send",
					label: "Emote",
					buttonLabel: "Em",
					buttonIcon: "speech",
					request: { kind: "emote", message: body },
				};
	// The allegiance command namespace also contains hometown and administration commands.
	const broadcast = verb === "allegiance" && /^broadcast(?:\s|$)/i.test(body);
	if (broadcast)
		return send(
			{ kind: "channel", channel: "allegiance-broadcast" },
			body.replace(/^broadcast\s*/i, ""),
		);
	const definition = CHAT_CHANNEL_DESTINATIONS.find((entry) =>
		entry.aliases.some((alias) => alias === verb),
	);
	if (definition !== undefined)
		return send({ kind: "channel", channel: definition.channel }, body);
	return {
		kind: "app-command",
		label: "Command",
		buttonLabel: "Cmd",
		buttonIcon: "speech",
	};
}
