import { APP_INPUT } from "../lib/input/app-input";
import type { InputDigitIndex } from "../lib/input/input-contract";

/** Gameplay dispatch shared by the app and its browser fixture, after scope arbitration. */
export function handleSpellBarKeydown(
	event: KeyboardEvent,
	enabled: boolean,
	selectTab: (index: InputDigitIndex) => void,
	activateCell: (index: InputDigitIndex) => void,
): boolean {
	if (!enabled || event.defaultPrevented || event.isComposing) return false;
	const command = APP_INPUT.spellBarCommand(event);
	if (command === null) return false;
	event.preventDefault();
	if (!event.repeat) {
		if (command.kind === "tabs") selectTab(command.index);
		else activateCell(command.index);
	}
	return true;
}
