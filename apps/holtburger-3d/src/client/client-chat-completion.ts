import type { ClientSoulEmotes } from "./client-soul-emotes";
import { presentSoulEmote } from "./client-emote-wheel";
import { CLIENT_COMMANDS } from "./client-command-catalog";

/** Prepared editor replacement; the editor never reconstructs syntax from presentation text. */
interface ChatCompletionChoice {
	/** Stable identity within the visible suggestions. */
	readonly id: string;
	/** Primary dropdown wording, including invocation/usage where helpful. */
	readonly label: string;
	/** Short explanation authored by the command or content catalog. */
	readonly detail: string;
	/** Exact text inserted into the active replacement range; accepting never submits. */
	readonly replacement: string;
}

/** One eligible editor range and its contextual suggestions. */
export interface ChatCompletion {
	/** Inclusive start and exclusive end; all surrounding text is preserved. */
	readonly start: number;
	readonly end: number;
	readonly choices: readonly ChatCompletionChoice[];
}

/** App-local discovery; command names work even when the static emote catalog is unavailable. */
export function chatCompletion(
	text: string,
	caret: number,
	local: boolean,
	emotes: ClientSoulEmotes | null,
): ChatCompletion | null {
	return (
		completeCommand(text, caret) ??
		(emotes === null ? null : completeSoulEmote(text, caret, local, emotes))
	);
}

/** Complete only a command's opening name. Fixed command paths may be inserted before arguments exist. */
function completeCommand(text: string, caret: number): ChatCompletion | null {
	const match = /^\s*([/@])(\S*)/.exec(text);
	if (match === null) return null;
	const prefix = match[1];
	const tokenEnd = match[0].length;
	const nameStart = tokenEnd - match[2].length;
	if (caret < nameStart || caret > tokenEnd) return null;
	const query = text.slice(nameStart, caret).toLowerCase();
	const tail = text.slice(tokenEnd);
	const hasArguments = tail.trim().length > 0;
	const choices = CLIENT_COMMANDS.flatMap((command) => {
		// Never duplicate an existing argument body by inserting a fixed multiword invocation.
		const matches = command.invocations.filter(
			(name) =>
				name.startsWith(query) && (!hasArguments || !name.includes(" ")),
		);
		const name = matches.find((name) => name === query) ?? matches[0];
		if (name === undefined) return [];
		const syntax = `${prefix}${command.syntax.slice(1)}`;
		return [
			{
				id: `command:${command.invocations[0]}`,
				label:
					name === command.invocations[0]
						? syntax
						: `${syntax} · ${prefix}${name}`,
				detail: command.description,
				replacement: `${prefix}${name} `,
			},
		];
	}).sort((a, b) => a.replacement.localeCompare(b.replacement, "en"));
	// Replace one existing separator so acceptance leaves the caret ready for arguments without doubling it.
	const end = tokenEnd + (/^\s/.test(tail) ? 1 : 0);
	return choices.length === 0 ? null : { start: nameStart - 1, end, choices };
}

/** Complete only local speech or a standalone gesture overriding the destination picker. */
function completeSoulEmote(
	text: string,
	caret: number,
	local: boolean,
	catalog: ClientSoulEmotes,
): ChatCompletion | null {
	const say = /^\s*[/@]say\s+/i.exec(text);
	if (/^\s*[/@]/.test(text) && say === null) return null;
	const offset = say === null ? 0 : say[0].length;
	const prefix = text.slice(offset, caret);
	const stars = [...prefix.matchAll(/\*/g)];
	if (stars.length % 2 === 0) return null;
	const opening = stars.at(-1);
	if (opening === undefined) return null;
	const start = offset + opening.index;
	const closing = text.indexOf("*", caret);
	const end = closing < 0 ? text.length : closing + 1;
	if (
		!local &&
		say === null &&
		(text.slice(0, start).trim() !== "" || text.slice(end).trim() !== "")
	)
		return null;
	const query = text.slice(start + 1, caret).toLowerCase();
	const choices = catalog.references
		.flatMap((reference) => {
			const presentation = presentSoulEmote(reference);
			const matches = reference.aliases.filter((alias) =>
				alias.toLowerCase().startsWith(query),
			);
			const alias =
				matches.find(
					(alias) => alias.toLowerCase() === presentation.alias.toLowerCase(),
				) ?? matches[0];
			return alias === undefined
				? []
				: [
						{
							id: `emote:${reference.id}`,
							label: `${presentation.label} · *${alias}*`,
							detail:
								reference.myEmote ?? reference.otherEmote ?? reference.pose,
							replacement: `*${alias}*`,
						},
					];
		})
		.sort((a, b) => a.replacement.localeCompare(b.replacement, "en"));
	return choices.length === 0 ? null : { start, end, choices };
}
