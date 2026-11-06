import { APP_BUILD_LABEL } from "../app/app-build";
import type { ClientChatMessage } from "./client-host-contract";
import type { ClientSelectedEntity } from "./client-selected-entity";

/** Capture the current client projection, preserving absent facts and scene data as null. */
function formatEntityReport(selected: ClientSelectedEntity): string {
	const description = selected.facts?.description;
	return JSON.stringify(
		{
			report: "h3d selected entity",
			build: APP_BUILD_LABEL,
			capturedAt: new Date().toISOString(),
			scope:
				"Client entity facts and latest host presentation; not a complete server entity dump. World poses use AC coordinates and wxyz quaternions. Null facts or presentation mean unavailable.",
			guidHex: hexId(selected.guid),
			wcidHex:
				description?.kind === "known" && description.wcid !== null
					? hexId(description.wcid)
					: null,
			...selected,
		},
		null,
		2,
	);
}

/** Keep numeric IDs in the payload and provide common lookup identifiers in hexadecimal. */
function hexId(id: number): string {
	return `0x${id.toString(16).padStart(8, "0")}`;
}

/** Snapshot selection before awaiting clipboard access; recover the full report in chat on failure. */
export async function runClientCopyEntityCommand(
	message: string,
	readSelected: () => ClientSelectedEntity | null,
	appendMessage: (message: ClientChatMessage) => void,
): Promise<boolean> {
	if (!/^[/@]copyent(?:\s|$)/i.test(message.trim())) return false;
	if (!/^[/@]copyent$/i.test(message.trim()))
		throw new Error("Usage: /copyent (copies the currently selected entity).");
	const selected = readSelected();
	if (selected === null)
		throw new Error("Select an entity before using /copyent.");
	const report = formatEntityReport(selected);
	try {
		await navigator.clipboard.writeText(report);
	} catch (error) {
		appendMessage({ kind: "system", message: report });
		throw new Error(
			`Entity report printed in chat, but clipboard copy failed: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}
	appendMessage({
		kind: "system",
		message: `Entity ${hexId(selected.guid)} report copied to clipboard.`,
	});
	return true;
}
