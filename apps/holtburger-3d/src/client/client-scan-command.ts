import { rankSearchTerms, textSearchWords } from "../app/text-search";
import { LOCAL_COMMANDS } from "./client-command-catalog";
import type { ClientChatMessage } from "./client-host-contract";
import type { NearbyRow } from "./client-nearby-policy";

/** Scan the unfiltered nearby population; selection eligibility stays with its existing owner. */
export function runClientScanCommand(
	message: string,
	readRows: () => readonly Pick<NearbyRow, "guid" | "facts" | "distance">[],
	select: (guid: number) => boolean,
	appendMessage: (message: ClientChatMessage) => void,
): boolean {
	const command = /^[/@]scan(?:\s+([\s\S]*))?$/i.exec(message.trim());
	if (command === null) return false;
	const terms = textSearchWords(command[1] ?? "");
	if (terms.length === 0) {
		appendMessage({
			kind: "system",
			message: `Usage: ${LOCAL_COMMANDS.scan.syntax}`,
		});
		return true;
	}
	const candidates = readRows().flatMap((row) => {
		const rank = rankSearchTerms(textSearchWords(row.facts.name), terms);
		return rank === null
			? []
			: [{ guid: row.guid, distance: row.distance, rank }];
	});
	candidates.sort((a, b) => {
		// Missing player distance sorts after measured distances; GUID resolves the remaining ties.
		const distanceOrder =
			a.distance === null
				? b.distance === null
					? 0
					: 1
				: b.distance === null
					? -1
					: a.distance - b.distance;
		return a.rank - b.rank || distanceOrder || a.guid - b.guid;
	});
	const best = candidates[0];
	if (best === undefined || !select(best.guid))
		appendMessage({ kind: "error", message: "No entity found" });
	return true;
}
